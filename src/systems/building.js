/* =========================================================
   building.js — placement (ghost preview + grid snap),
   upgrades, production chains, defence towers, structure
   damage from raids and the town border.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;
  const GS = C.WORLD.gridSize;
  const CELL = 8;                       // spatial-hash cell size

  function Building(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.grid = new Map();              // "cx,cz" -> [buildings]
    this.placing = null;
    this.uid = 1;
    this.centerX = 0; this.centerZ = 0;
    this._lights = [];
    this._effCache = null;
    this._towerT = 0;
    this.tracers = [];
    this._initLights();
  }

  Building.prototype._initLights = function () {
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffc069, 0, 17, 2);
      l.visible = false;
      this.game.scene.add(l);
      this._lights.push(l);
    }
  };

  /* =========================================================
     LOOKUP HELPERS
     ========================================================= */
  function footprint(def, rot) {
    const swap = Math.abs(Math.round(rot / (Math.PI / 2))) % 2 === 1;
    return {
      w: (swap ? def.size[1] : def.size[0]),
      d: (swap ? def.size[0] : def.size[1])
    };
  }

  /* Index a structure into every cell its *padded* box touches. Without the
     margin a wall whose edge sits just inside cell 0 is invisible to a query
     one centimetre into cell 1 — which is exactly the seam an animal walks
     through, and the seam that leaves you half-buried in a fence. */
  const HASH_PAD = 1.2;
  Building.prototype._cells = function (b) {
    const out = [];
    const x0 = Math.floor((b.x - b.w / 2 - HASH_PAD) / CELL), x1 = Math.floor((b.x + b.w / 2 + HASH_PAD) / CELL);
    const z0 = Math.floor((b.z - b.d / 2 - HASH_PAD) / CELL), z1 = Math.floor((b.z + b.d / 2 + HASH_PAD) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) out.push(U.key(cx, cz));
    return out;
  };

  Building.prototype._index = function (b, add) {
    for (const k of this._cells(b)) {
      let arr = this.grid.get(k);
      if (add) { if (!arr) this.grid.set(k, (arr = [])); arr.push(b); }
      else if (arr) { const i = arr.indexOf(b); if (i >= 0) U.swapRemove(arr, i); }
    }
  };

  Building.prototype._at = function (x, z) {
    return this.grid.get(U.key(Math.floor(x / CELL), Math.floor(z / CELL))) || null;
  };

  function inside(b, x, z, pad) {
    pad = pad || 0;
    return Math.abs(x - b.x) <= b.w / 2 + pad && Math.abs(z - b.z) <= b.d / 2 + pad;
  }

  /* Same building, same level — but a row of identical houses looks cheap.
     Each plot gets a stable variant number from its own coordinates, so a
     house keeps its colours across saves and rebuilds. */
  function variantAt(x, z) {
    const h = U.strSeed('v' + Math.round(x * 4) + '_' + Math.round(z * 4));
    return (h >>> 3) & 1023;
  }

  const _bbox = new THREE.Box3();
  /** how tall this structure actually stands — measured from its geometry */
  function measureHeight(obj) {
    _bbox.setFromObject(obj);
    const h = _bbox.max.y - obj.position.y;
    return isFinite(h) && h > 0 ? h : 3;
  }

  const BLOCK_PAD = 0.35;               // how wide a body the collision test assumes

  function ghostly(b, forPlayer) {
    if (b.def.id === 'lamp') return true;
    if (!forPlayer) return false;
    const eff = b.def.effects ? b.def.effects(b.level) : {};
    return !!eff.passable;
  }

  /** does something solid stand here? gates let the player through */
  Building.prototype.blocks = function (x, z, forPlayer) {
    const arr = this._at(x, z);
    if (!arr) return false;
    for (const b of arr) {
      if (ghostly(b, forPlayer)) continue;
      if (inside(b, x, z, BLOCK_PAD)) return true;
    }
    return false;
  };

  /* Is this point in mid-air swallowed by a structure? Used by the camera
     boom — which passes forPlayer, because anywhere you can walk (the aisle
     of your own stable, a market awning) the camera has to be able to
     follow you, or it gets shoved outside and you stare at a wall. */
  Building.prototype.solidAt = function (x, y, z, pad, forPlayer) {
    const arr = this._at(x, z);
    if (!arr) return false;
    pad = pad || 0;
    for (const b of arr) {
      if (ghostly(b, forPlayer)) continue;
      if (!inside(b, x, z, pad)) continue;
      if (y >= b.y - 0.4 && y <= b.y + (b.h || 3) + pad) return true;
    }
    return false;
  };

  /** world-space height of the tallest roof over this spot, or -Infinity */
  Building.prototype.roofAt = function (x, z, pad, forPlayer) {
    const arr = this._at(x, z);
    if (!arr) return -Infinity;
    let top = -Infinity;
    for (const b of arr) {
      if (ghostly(b, forPlayer)) continue;
      if (!inside(b, x, z, pad || 0)) continue;
      const t = b.y + (b.h || 3);
      if (t > top) top = t;
    }
    return top;
  };

  Building.prototype.occupied = function (x, z, pad) {
    const arr = this._at(x, z);
    if (!arr) return false;
    for (const b of arr) if (inside(b, x, z, pad || 0)) return true;
    return false;
  };

  /* If a point ends up inside a solid footprint — an animal that clipped a
     doorway, or the player when a wall goes up around them — return the
     nearest point just outside it, pushed along the shallowest axis. */
  /** the structure this point is furthest inside, or null when it is clear */
  Building.prototype._deepestAt = function (x, z, pad, forPlayer) {
    const arr = this._at(x, z);
    if (!arr) return null;
    let worst = null, wd = 0;
    for (const b of arr) {
      if (ghostly(b, forPlayer)) continue;
      const px = (b.w / 2 + pad) - Math.abs(x - b.x);
      const pz = (b.d / 2 + pad) - Math.abs(z - b.z);
      if (px <= 0 || pz <= 0) continue;
      const depth = Math.min(px, pz);
      if (depth > wd) { wd = depth; worst = b; }
    }
    return worst;
  };

  /* Shove a body out of whatever it is standing inside.

     Two things make this harder than one push: a run of connecting walls is
     many separate structures, so escaping one can drop you straight into the
     next; and the exit must clear the *collision* pad, or blocks() still calls
     the new spot solid and the body stays welded to the wall forever — which
     is exactly how you end up frozen in a fence while wolves knock you about.
     So: resolve the deepest overlap first, always along an axis that actually
     comes out free, and repeat a few times for corners. */
  Building.prototype.escapeFrom = function (x, z, pad, forPlayer) {
    const out = Math.max(pad === undefined ? 0.2 : pad, BLOCK_PAD) + 0.06;
    let cx = x, cz = z, moved = false;
    for (let iter = 0; iter < 5; iter++) {
      const b = this._deepestAt(cx, cz, out, forPlayer);
      if (!b) break;
      const hw = b.w / 2 + out, hd = b.d / 2 + out;
      const dx = cx - b.x, dz = cz - b.z;
      const ax = b.x + (dx < 0 ? -hw : hw), az = b.z + (dz < 0 ? -hd : hd);
      const freeX = !this._deepestAt(ax, cz, out, forPlayer);
      const freeZ = !this._deepestAt(cx, az, out, forPlayer);
      const shallowX = (hw - Math.abs(dx)) <= (hd - Math.abs(dz));
      let useX;
      if (freeX === freeZ) useX = shallowX; else useX = freeX;
      if (useX) cx = ax; else cz = az;
      moved = true;
    }
    return moved ? { x: cx, z: cz } : null;
  };

  /* Last resort when even the push-out is boxed in on every side: walk a
     spiral outward and hand back the first standable spot. */
  Building.prototype.freeSpotNear = function (x, z, forPlayer) {
    const world = this.game.world;
    for (let r = 1.6; r <= 22; r += 1.4) {
      for (let a = 0; a < 14; a++) {
        const ang = (a / 14) * 6.283 + r;
        const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
        if (this.blocks(px, pz, forPlayer)) continue;
        if (world.heightAt(px, pz) < C.WORLD.waterLevel + 0.2) continue;
        return { x: px, z: pz };
      }
    }
    return null;
  };

  Building.prototype.structureAt = function (x, z) {
    const arr = this._at(x, z);
    if (!arr) return null;
    for (const b of arr) if (inside(b, x, z, 0.9)) return b;
    return null;
  };

  Building.prototype.countOf = function (id) {
    let n = 0;
    for (const b of this.list) if (b.defId === id) n++;
    return n;
  };
  Building.prototype.maxLevelOf = function (id) {
    let n = 0;
    for (const b of this.list) if (b.defId === id && b.level > n) n = b.level;
    return n;
  };

  Building.prototype.totalEffect = function (key) {
    if (!this._effCache) {
      const acc = Object.create(null);
      for (const b of this.list) {
        if (!b.def.effects) continue;
        const e = b.def.effects(b.level);
        for (const k in e) if (typeof e[k] === 'number') acc[k] = (acc[k] || 0) + e[k];
      }
      this._effCache = acc;
    }
    return this._effCache[key] || 0;
  };
  Building.prototype.invalidate = function () { this._effCache = null; };

  /* =========================================================
     WALL CONNECTIONS
     Fences, walls and gates fill a whole grid cell and grow arms
     toward their neighbours, so a run of them joins seamlessly.
     ========================================================= */
  const DIRS = [[1, 0, 1], [-1, 0, 2], [0, 1, 4], [0, -1, 8]];

  Building.prototype.wallMaskAt = function (x, z, skip) {
    let m = 0;
    for (const d of DIRS) {
      const s = this.structureAt(x + d[0] * GS, z + d[1] * GS);
      if (s && s !== skip && s.def.connects) m |= d[2];
    }
    return m;
  };

  Building.prototype._reshapeWall = function (b) {
    const mask = this.wallMaskAt(b.x, b.z, b);
    if (b.mask === mask) return;
    b.mask = mask;
    this.group.remove(b.obj);
    disposeTree(b.obj);
    b.obj = M.building(b.defId, b.level, mask, b.variant);
    b.obj.position.set(b.x, b.y, b.z);
    b.obj.rotation.y = 0;                       // shape comes from the mask
    this.group.add(b.obj);
    b.glow = [];
    b.obj.traverse(function (o) {
      if (o.userData && o.userData.isGlow) { o.material = M.MAT.window; b.glow.push(o); }
    });
    b.h = measureHeight(b.obj);
  };

  /** re-shape the piece at (x,z) and each of its four neighbours */
  Building.prototype.refreshWalls = function (x, z) {
    const spots = [[GS, 0], [-GS, 0], [0, GS], [0, -GS], [0, 0]];
    for (const sp of spots) {
      const b = this.structureAt(x + sp[0], z + sp[1]);
      if (b && b.def.connects) this._reshapeWall(b);
    }
  };

  Building.prototype.wellNear = function (x, z) {
    for (const b of this.list) {
      if (b.defId !== 'well') continue;
      const r = b.def.effects(b.level).water;
      if (U.dist2(x, z, b.x, b.z) < r * r) return true;
    }
    return false;
  };

  /* =========================================================
     PLACEMENT
     ========================================================= */
  Building.prototype.start = function (defId) {
    const def = C.BUILDINGS[defId];
    if (!def) return;
    const chk = this.canUnlock(defId);
    if (!chk.ok) { this.game.ui.toast('🔒 ' + chk.why, 'bad'); return; }
    this.cancel();
    const ghost = M.building(defId, 1);
    ghost.traverse(function (o) { if (o.isMesh) { o.material = M.MAT.ghostOk; o.castShadow = false; } });
    this.group.add(ghost);
    const fp = footprint(def, 0);
    const ring = M.selectRing();
    ring.scale.set(Math.max(fp.w, fp.d) * 0.9, 1, Math.max(fp.w, fp.d) * 0.9);
    this.group.add(ring);
    this.placing = { defId: defId, def: def, obj: ghost, ring: ring, rot: 0, valid: false, x: 0, y: 0, z: 0, mask: -1 };
    this.showBorder(true);
    this.game.ui.showBuildBar(def);
  };

  Building.prototype.cancel = function () {
    if (!this.placing) return;
    this.group.remove(this.placing.obj);
    this.group.remove(this.placing.ring);
    disposeTree(this.placing.obj);
    this.placing = null;
    this.showBorder(false);
    this.game.ui.hideBuildBar();
  };

  Building.prototype.rotate = function () {
    if (!this.placing) return;
    this.placing.rot = (this.placing.rot + Math.PI / 2) % (Math.PI * 2);
  };

  Building.prototype.canUnlock = function (defId) {
    const def = C.BUILDINGS[defId], prog = this.game.progress;
    if (prog.tier < def.tier) return { ok: false, why: 'به سطح آبادی «' + C.TIERS[def.tier].name + '» نیاز داری' };
    if (prog.skill('building').level < def.sk) return { ok: false, why: 'به معماری سطح ' + U.fa(def.sk) + ' نیاز داری' };
    return { ok: true };
  };

  /** validate a candidate spot; returns {ok, why} */
  Building.prototype.validate = function (defId, x, z, rot, level) {
    const def = C.BUILDINGS[defId];
    const fp = footprint(def, rot);
    const world = this.game.world;

    /* No territory limit: build anywhere in the world you like. Only the
       ground itself has an opinion — water, cliffs and things in the way. */
    const f = world.footprint(x, z, fp.w, fp.d, 0);
    const needWater = !!def.water;
    let waterNear = false;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * 6.283;
      if (world.isWater(x + Math.cos(ang) * (fp.w * 0.6 + 1.5), z + Math.sin(ang) * (fp.d * 0.6 + 1.5))) { waterNear = true; break; }
    }
    if (needWater && !waterNear) return { ok: false, why: 'باید کنار آب ساخته شود' };
    if (f.min < C.WORLD.waterLevel + 0.25 && !needWater) return { ok: false, why: 'زمین زیر آب است' };
    if (f.flat > 1.1 + fp.w * 0.14) return { ok: false, why: 'زمین ناهموار است' };

    // overlap with other buildings
    const half = Math.max(fp.w, fp.d) / 2 + CELL;
    for (let cx = Math.floor((x - half) / CELL); cx <= Math.floor((x + half) / CELL); cx++) {
      for (let cz = Math.floor((z - half) / CELL); cz <= Math.floor((z + half) / CELL); cz++) {
        const arr = this.grid.get(U.key(cx, cz));
        if (!arr) continue;
        for (const b of arr) {
          if (Math.abs(b.x - x) < (b.w + fp.w) / 2 - 0.15 && Math.abs(b.z - z) < (b.d + fp.d) / 2 - 0.15) {
            return { ok: false, why: 'روی ساختمان دیگری است' };
          }
        }
      }
    }
    // overlap with farm plots
    const gx0 = Math.round((x - fp.w / 2) / GS), gx1 = Math.round((x + fp.w / 2) / GS);
    const gz0 = Math.round((z - fp.d / 2) / GS), gz1 = Math.round((z + fp.d / 2) / GS);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      if (this.game.farming.plotAtCell(gx, gz)) return { ok: false, why: 'روی زمین کشاورزی است' };
    }
    // resource nodes in the way
    const nodes = this.game.world.nodesNear(x, z, Math.max(fp.w, fp.d) * 0.6 + 0.6);
    if (nodes.length) return { ok: false, why: 'اول ' + nodes[0].name + ' را بردار' };

    const cost = def.cost(level || 1);
    if (!this.game.inv.canAfford(cost)) return { ok: false, why: 'منابع کافی نداری', cost: cost };
    return { ok: true, y: f.avg, cost: cost };
  };

  Building.prototype.updatePlacement = function () {
    const p = this.placing;
    if (!p) return;
    const g = this.game;
    const ray = g.player.aimRay();
    const hit = g.world.rayGround(ray.origin, ray.dir, 46);
    let x, z;
    if (hit) { x = hit.point.x; z = hit.point.z; }
    else {
      const f = g.player.frontPoint(8);
      x = f.x; z = f.z;
    }
    // snap to the shared grid
    x = Math.round(x / GS) * GS;
    z = Math.round(z / GS) * GS;

    // preview the shape it will take once it links to its neighbours
    if (p.def.connects) {
      const mask = this.wallMaskAt(x, z, null);
      if (mask !== p.mask) {
        p.mask = mask;
        this.group.remove(p.obj);
        disposeTree(p.obj);
        p.obj = M.building(p.defId, 1, mask);
        p.obj.traverse(function (o) { if (o.isMesh) { o.material = M.MAT.ghostOk; o.castShadow = false; } });
        this.group.add(p.obj);
      }
      p.rot = 0;
    }
    const res = this.validate(p.defId, x, z, p.rot, 1);
    p.x = x; p.z = z;
    p.y = res.y !== undefined ? res.y : g.world.heightAt(x, z);
    p.valid = res.ok;
    p.obj.position.set(x, p.y, z);
    p.obj.rotation.y = p.rot;
    p.ring.position.set(x, p.y + 0.08, z);
    const mat = res.ok ? M.MAT.ghostOk : M.MAT.ghostBad;
    p.obj.traverse(function (o) { if (o.isMesh) o.material = mat; });
    p.ring.material = res.ok ? M.MAT.ring : M.MAT.ringBad;
    g.ui.updateBuildBar(p.def, res);
  };

  Building.prototype.confirm = function () {
    const p = this.placing;
    if (!p) return false;
    const res = this.validate(p.defId, p.x, p.z, p.rot, 1);
    if (!res.ok) { this.game.ui.toast('⚠️ ' + res.why, 'bad'); return false; }
    if (!this.game.inv.pay(res.cost)) return false;

    const b = this.place(p.defId, p.x, p.z, p.rot, 1);
    this.game.progress.addSkill('building', 6 + p.def.size[0] * 2);
    this.game.progress.addXp(12);
    this.game.progress.stat('build', 1);
    this.game.progress.stat('build_' + p.defId, 1);
    this.game.audio.build();
    this.game.ui.toast('🏗️ ' + p.def.icon + ' ' + p.def.name + ' ساخته شد', 'good');
    this.game.fx.hitBurst(b.x, b.y + 1, b.z, 0xffd15c, 22);

    // keep placing the same kind while resources last (fences, walls…)
    const keep = this.validate(p.defId, p.x, p.z, p.rot, 1);
    if (!keep.ok && keep.why === 'منابع کافی نداری') this.cancel();
    return true;
  };

  Building.prototype.place = function (defId, x, z, rot, level) {
    const def = C.BUILDINGS[defId];
    const fp = footprint(def, rot);
    const y = this.game.world.footprint(x, z, fp.w, fp.d, 0).avg;
    const variant = variantAt(x, z);
    const obj = M.building(defId, level, undefined, variant);
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    this.group.add(obj);

    const b = {
      uid: this.uid++, defId: defId, def: def, level: level, variant: variant,
      x: x, y: y, z: z, rot: rot, w: fp.w, d: fp.d,
      obj: obj, prodT: 0, stalled: false, towerCd: 0,
      hp: def.hp ? def.hp(level) : 70 * level + 40,
      maxHp: def.hp ? def.hp(level) : 70 * level + 40,
      glow: []
    };
    /* A flame burns just as brightly at noon, so it opts out of the shared
       window material that fades with the dusk. */
    const fire = this.isFire(b);
    obj.traverse(function (o) {
      if (o.userData && o.userData.isGlow) { o.material = fire ? M.MAT.glow : M.MAT.window; b.glow.push(o); }
    });
    b.h = measureHeight(obj);
    if (fire) {
      b.fuel = this.fireRate(b) * 3;      // arrives with a few logs already burning
      b.lit = true;
      b.autoFeed = true;
      this._paintFire(b);
    }
    this.list.push(b);
    this._index(b, true);
    this.invalidate();
    this._recenter();
    if (def.connects) {
      b.mask = -1;
      this._reshapeWall(b);           // itself, by reference
      this.refreshWalls(x, z);        // then the four neighbours
    }
    this.game.bus.emit('build', b);
    return b;
  };

  Building.prototype.upgrade = function (b) {
    if (!b || this.list.indexOf(b) < 0) return false;
    if (b.level >= b.def.max) { this.game.ui.toast('این ساختمان در بالاترین سطح است', 'bad'); return false; }
    const cost = b.def.cost(b.level + 1);
    if (!this.game.inv.canAfford(cost)) { this.game.ui.toast('⚠️ منابع کافی نداری', 'bad'); return false; }
    const needSk = b.def.sk + b.level;
    if (this.game.progress.skill('building').level < needSk) {
      this.game.ui.toast('🔒 به معماری سطح ' + U.fa(needSk) + ' نیاز داری', 'bad'); return false;
    }
    this.game.inv.pay(cost);
    b.level++;
    this.group.remove(b.obj);
    disposeTree(b.obj);
    b.obj = M.building(b.defId, b.level, b.def.connects ? b.mask : undefined, b.variant);
    b.obj.position.set(b.x, b.y, b.z);
    b.obj.rotation.y = b.def.connects ? 0 : b.rot;
    this.group.add(b.obj);
    b.glow = [];
    const fireUp = this.isFire(b);
    b.obj.traverse(function (o) {
      if (o.userData && o.userData.isGlow) { o.material = fireUp ? M.MAT.glow : M.MAT.window; b.glow.push(o); }
    });
    b.h = measureHeight(b.obj);
    if (fireUp) this._paintFire(b);
    b.maxHp = b.def.hp ? b.def.hp(b.level) : 70 * b.level + 40;
    b.hp = b.maxHp;
    this.invalidate();
    this.game.progress.addSkill('building', 10 + b.level * 5);
    this.game.progress.addXp(20);
    this.game.progress.stat('upgrade', 1);
    this.game.audio.upgrade();
    this.game.ui.toast('⬆️ ' + b.def.name + ' به سطح ' + U.fa(b.level) + ' ارتقا یافت', 'gold');
    this.game.fx.hitBurst(b.x, b.y + 2, b.z, 0xffd15c, 26);
    this.game.bus.emit('build', b);
    return true;
  };

  Building.prototype.repair = function (b) {
    if (b.hp >= b.maxHp) return false;
    const need = Math.ceil((b.maxHp - b.hp) / 12);
    const cost = { wood: need, coin: need * 4 };
    if (!this.game.inv.canAfford(cost)) { this.game.ui.toast('⚠️ برای تعمیر ' + U.fa(need) + ' چوب لازم است', 'bad'); return false; }
    this.game.inv.pay(cost);
    b.hp = b.maxHp;
    this.game.ui.toast('🔧 تعمیر شد', 'good');
    return true;
  };

  Building.prototype.demolish = function (b, refund) {
    const i = this.list.indexOf(b);
    if (i < 0) return;
    if (refund !== false) {
      const cost = b.def.cost(b.level);
      for (const k in cost) {
        const n = Math.floor(cost[k] * 0.5);
        if (n <= 0) continue;
        if (k === 'coin') this.game.inv.addCoins(n); else this.game.inv.add(k, n);
      }
    }
    const wasWall = b.def.connects, wx = b.x, wz = b.z;
    this._index(b, false);
    this.group.remove(b.obj);
    disposeTree(b.obj);
    U.swapRemove(this.list, i);
    this.invalidate();
    this._recenter();
    if (wasWall) this.refreshWalls(wx, wz);
    this.game.bus.emit('build', b);
  };

  Building.prototype._recenter = function () {
    if (!this.list.length) { this.centerX = 0; this.centerZ = 0; return; }
    let sx = 0, sz = 0;
    for (const b of this.list) { sx += b.x; sz += b.z; }
    this.centerX = sx / this.list.length;
    this.centerZ = sz / this.list.length;
  };

  /* =========================================================
     FIRE — the early-game answer to the dark
     ========================================================= */
  Building.prototype.isFire = function (b) {
    return b.def.effects && b.def.effects(b.level).ward > 0;
  };

  /** hours of burn one log buys this fire */
  Building.prototype.fireRate = function (b) {
    return C.FIRE.fuelPerLog / Math.pow(C.FIRE.burnPerLevel, b.level - 1);
  };

  /** feed the fire — returns how many logs actually went in */
  Building.prototype.feedFire = function (b, logs) {
    if (!this.isFire(b)) return 0;
    const room = C.FIRE.maxLogs - Math.floor(b.fuel / this.fireRate(b));
    let n = Math.min(logs, Math.max(0, room));
    n = Math.min(n, this.game.inv.count('wood'));
    if (n <= 0) return 0;
    this.game.inv.remove('wood', n);
    b.fuel += n * this.fireRate(b);
    if (!b.lit) { b.lit = true; this.game.audio.build(); }
    this._paintFire(b);
    return n;
  };

  Building.prototype._paintFire = function (b) {
    const on = !!b.lit;
    for (const o of b.glow) o.visible = on;
    if (b.obj) b.obj.userData.fireLit = on;
  };

  /** is (x,z) inside the safe circle of a burning fire? */
  Building.prototype.wardedAt = function (x, z) {
    for (const b of this.list) {
      if (!b.lit) continue;
      const r = b.def.effects(b.level).ward;
      if (!r) continue;
      if (U.dist2(x, z, b.x, b.z) < r * r) return b;
    }
    return null;
  };

  /** strongest ward reaching this point, 0 when none — used for spawn bias */
  Building.prototype.wardRadius = function () {
    let r = 0;
    for (const b of this.list) {
      if (!b.lit) continue;
      const w = b.def.effects(b.level).ward || 0;
      if (w > r) r = w;
    }
    return r;
  };

  Building.prototype._stepFires = function (hours) {
    const g = this.game;
    for (const b of this.list) {
      if (!this.isFire(b)) continue;
      if (!b.lit) continue;
      b.fuel -= hours;
      if (b.fuel <= 0) {
        b.fuel = 0;
        // an unattended fire tries to feed itself from your woodpile
        if (b.autoFeed && this.feedFire(b, C.FIRE.autoFeed) > 0) continue;
        b.lit = false;
        this._paintFire(b);
        g.ui.toast('🌑 ' + b.def.name + ' خاموش شد — هیزم بریز', 'bad');
        g.audio.deny();
      } else if (b.fuel < C.FIRE.lowWarn && !b.warned) {
        b.warned = true;
        g.ui.toast('🔥 ' + b.def.name + ' دارد تمام می‌شود', 'bad');
      }
      if (b.fuel > C.FIRE.lowWarn) b.warned = false;
    }
  };

  /* =========================================================
     RAIDS
     ========================================================= */
  Building.prototype.raidTarget = function (x, z) {
    if (!this.list.length) return null;
    let best = null, bd = 1e9;
    for (const b of this.list) {
      /* raiders will not walk into firelight to chew on a wall */
      if (this.wardedAt(b.x, b.z)) continue;
      const d = U.dist2(x, z, b.x, b.z);
      const pref = b.def.cat === 'farm' || b.def.cat === 'home' ? 0.55 : 1;
      if (d * pref < bd) { bd = d * pref; best = b; }
    }
    return best;
  };

  Building.prototype.attackStructure = function (b, dmg) {
    if (!b || this.list.indexOf(b) < 0) return true;
    b.hp -= dmg;
    b.hurt = 0.3;
    this.game.fx.hitBurst(b.x, b.y + 1, b.z, 0x8a6034, 6);
    this.game.audio.hit();
    if (b.hp <= 0) {
      this.game.audio.rockBreak();
      this.game.ui.toast('💥 ' + b.def.icon + ' ' + b.def.name + ' نابود شد!', 'bad');
      this.demolish(b, false);
      return true;
    }
    if (!this._warnT || U.now() - this._warnT > 6000) {
      this._warnT = U.now();
      this.game.audio.alarm();
      this.game.ui.toast('⚠️ به ' + b.def.name + ' حمله شد!', 'bad');
    }
    return false;
  };

  /* =========================================================
     PER-FRAME
     ========================================================= */
  Building.prototype.update = function (dt) {
    const g = this.game;
    const hours = dt * (24 / C.TIME.dayLength);
    /* smooth dusk factor: window lights fade up instead of popping on */
    const nightF = U.clamp01(g.sky.nightFactor * 1.25 - 0.15);
    const night = nightF > 0.02;
    M.MAT.window.opacity = nightF;

    for (const b of this.list) {
      /* animated parts */
      const spin = b.obj.userData.spin;
      if (spin) {
        const sp = (b.defId === 'windmill' ? 0.7 : 2.4) * (1 + b.level * 0.12);
        if (b.obj.userData.spinAxis === 'z') spin.rotation.z += dt * sp * 3;
        else spin.rotation.x += dt * sp;
      }
      /* lit windows — opacity is driven by the shared material above.
         Fires answer to their fuel instead, day or night. */
      if (b.glow.length) {
        if (b.fire === undefined) b.fire = this.isFire(b);
        if (b.fire) {
          const flick = 0.9 + Math.sin(U.now() * 0.011 + b.uid) * 0.08 +
            Math.sin(U.now() * 0.027 + b.uid * 2) * 0.05;
          for (const gm of b.glow) { gm.visible = !!b.lit; gm.scale.y = b.lit ? flick : 1; }
        } else {
          for (const gm of b.glow) gm.visible = night;
        }
      }

      /* production */
      if (b.def.produce) {
        const rec = b.def.produce(b.level);
        b.prodT += hours;
        if (b.prodT >= rec.hours) {
          b.prodT = 0;
          let ok = true;
          if (rec.inp) { for (const k in rec.inp) if (!g.inv.has(k, rec.inp[k])) ok = false; }
          if (ok) {
            if (rec.inp) for (const k in rec.inp) g.inv.remove(k, rec.inp[k]);
            const made = [];
            for (const k in rec.out) { if (g.inv.add(k, rec.out[k])) made.push(C.ITEMS[k].icon + U.fa(rec.out[k])); }
            b.stalled = false;
            if (made.length) g.ui.toast(b.def.icon + ' ' + b.def.name + ' → ' + made.join(' '), 'good');
          } else {
            b.stalled = true;
            b.prodT = rec.hours * 0.75;    // retry soon
          }
        }
      }
      /* towers */
      if (b.defId === 'guard_tower') {
        b.towerCd -= dt;
        if (b.towerCd <= 0) {
          const eff = b.def.effects(b.level);
          const a = g.wildlife.nearest(b.x, b.z, eff.range, true);
          if (a) {
            b.towerCd = 1.0;
            g.wildlife.hit(a, eff.dps, b.x, b.z);
            g.audio.bow();
            this._tracer(b.x, (b.obj.userData.top || 4) + b.y, b.z, a.x, a.y + 0.6, a.z);
          } else b.towerCd = 0.35;
        }
      }
      if (b.hurt > 0) {
        b.hurt -= dt;
        b.obj.position.x = b.x + (Math.random() - 0.5) * 0.1;
        b.obj.position.z = b.z + (Math.random() - 0.5) * 0.1;
        if (b.hurt <= 0) b.obj.position.set(b.x, b.y, b.z);
      }
    }

    this._stepFires(hours);
    this._updateLights(night, nightF);
    this._updateTracers(dt);

    if (this.placing) this.updatePlacement();
  };

  /** assign the 6 pooled point lights to the closest lit structures */
  Building.prototype._updateLights = function (night, nightF) {
    const p = this.game.player.pos;
    if (nightF === undefined) nightF = 1;
    const cand = [];
    for (const b of this.list) {
      const burning = b.fire && b.lit;
      /* a fire throws light whatever the hour; everything else waits for dusk */
      if (!burning && !night) continue;
      if (!burning && !b.glow.length && b.defId !== 'lamp' && b.defId !== 'smelter') continue;
      const d = U.dist2(p.x, p.z, b.x, b.z);
      if (d < 60 * 60) cand.push({ b: b, d: burning ? d * 0.25 : d });
    }
    if (!cand.length) { for (const l of this._lights) l.visible = false; return; }
    cand.sort((a, c) => a.d - c.d);
    for (let i = 0; i < this._lights.length; i++) {
      const l = this._lights[i];
      if (i < cand.length) {
        const b = cand[i].b;
        const isLamp = b.defId === 'lamp';
        const burning = b.fire && b.lit;
        l.position.set(b.x, b.y + (isLamp ? 2.8 + b.level * 0.3 : burning ? 1.3 : 2.2), b.z);
        l.intensity = burning
          ? (1.6 + b.level * 0.5) * (0.35 + nightF * 0.9)
          : (isLamp ? 1.5 + b.level * 0.35 : 0.9) * nightF;
        l.distance = burning ? (b.def.effects(b.level).ward || 12) * 0.75 : isLamp ? 16 + b.level * 4 : 12;
        l.color.setHex(burning ? 0xff9a3a : b.defId === 'smelter' ? 0xff7a2a : 0xffc069);
        l.visible = true;
      } else l.visible = false;
    }
  };

  /* tower shot tracer */
  Building.prototype._tracer = function (x1, y1, z1, x2, y2, z2) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x1, y1, z1, x2, y2, z2]), 3));
    const m = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(g, m);
    this.game.scene.add(line);
    this.tracers.push({ line: line, t: 0.18 });
  };
  Building.prototype._updateTracers = function (dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      t.line.material.opacity = Math.max(0, t.t / 0.18);
      if (t.t <= 0) {
        this.game.scene.remove(t.line);
        t.line.geometry.dispose(); t.line.material.dispose();
        U.swapRemove(this.tracers, i);
      }
    }
  };

  /* =========================================================
     BORDER RING
     ========================================================= */
  /* Kept as a no-op: building is unrestricted, so there is no ring to draw. */
  Building.prototype.showBorder = function () { };

  /* =========================================================
     DAILY INCOME
     ========================================================= */
  Building.prototype.dailyIncome = function () {
    const inc = this.totalEffect('income');
    const happy = this.game.progress.happiness / 100;
    const pop = this.game.progress.population;
    return Math.round(inc * (0.55 + happy * 0.75) + pop * 1.6);
  };

  function disposeTree(obj) {
    obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
  }

  /* =========================================================
     PERSISTENCE
     ========================================================= */
  Building.prototype.serialize = function () {
    return this.list.map(function (b) {
      return [b.defId, Math.round(b.x * 100) / 100, Math.round(b.z * 100) / 100, b.rot, b.level, Math.round(b.hp), Math.round(b.prodT * 10) / 10];
    });
  };
  Building.prototype.deserialize = function (arr) {
    while (this.list.length) this.demolish(this.list[0], false);
    if (!arr) return;
    for (const r of arr) {
      if (!C.BUILDINGS[r[0]]) continue;
      const b = this.place(r[0], r[1], r[2], r[3], r[4]);
      b.hp = Math.min(b.maxHp, r[5] || b.maxHp);
      b.prodT = r[6] || 0;
    }
    // every piece now knows its neighbours, so link the runs up
    for (const b of this.list) if (b.def.connects) { b.mask = -1; }
    for (const b of this.list) if (b.def.connects) this._reshapeWall(b);
    this.invalidate();
  };

  G.Building = Building;
})(window.GAME = window.GAME || {});
