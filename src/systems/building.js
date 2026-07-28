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
    this.borderRing = null;
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

  Building.prototype._cells = function (b) {
    const out = [];
    const x0 = Math.floor((b.x - b.w / 2) / CELL), x1 = Math.floor((b.x + b.w / 2) / CELL);
    const z0 = Math.floor((b.z - b.d / 2) / CELL), z1 = Math.floor((b.z + b.d / 2) / CELL);
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

  /** does something solid stand here? gates let the player through */
  Building.prototype.blocks = function (x, z, forPlayer) {
    const arr = this._at(x, z);
    if (!arr) return false;
    for (const b of arr) {
      if (b.def.id === 'lamp') continue;
      if (!inside(b, x, z, 0.35)) continue;
      const eff = b.def.effects ? b.def.effects(b.level) : {};
      if (forPlayer && eff.passable) continue;
      return true;
    }
    return false;
  };

  Building.prototype.occupied = function (x, z, pad) {
    const arr = this._at(x, z);
    if (!arr) return false;
    for (const b of arr) if (inside(b, x, z, pad || 0)) return true;
    return false;
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

  Building.prototype.wellNear = function (x, z) {
    for (const b of this.list) {
      if (b.defId !== 'well') continue;
      const r = b.def.effects(b.level).water;
      if (U.dist2(x, z, b.x, b.z) < r * r) return true;
    }
    return false;
  };

  Building.prototype.borderRadius = function () {
    const tier = C.TIERS[this.game.progress.tier];
    return tier.border + this.totalEffect('border');
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
    this.placing = { defId: defId, def: def, obj: ghost, ring: ring, rot: 0, valid: false, x: 0, y: 0, z: 0 };
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

    if (U.dist(0, 0, x, z) > this.borderRadius()) return { ok: false, why: 'خارج از مرز شهر' };

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
    const obj = M.building(defId, level);
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    this.group.add(obj);

    const b = {
      uid: this.uid++, defId: defId, def: def, level: level,
      x: x, y: y, z: z, rot: rot, w: fp.w, d: fp.d,
      obj: obj, prodT: 0, stalled: false, towerCd: 0,
      hp: def.hp ? def.hp(level) : 70 * level + 40,
      maxHp: def.hp ? def.hp(level) : 70 * level + 40,
      glow: []
    };
    obj.traverse(function (o) {
      if (o.userData && o.userData.isGlow) { o.material = M.MAT.window; b.glow.push(o); }
    });
    this.list.push(b);
    this._index(b, true);
    this.invalidate();
    this._recenter();
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
    b.obj = M.building(b.defId, b.level);
    b.obj.position.set(b.x, b.y, b.z);
    b.obj.rotation.y = b.rot;
    this.group.add(b.obj);
    b.glow = [];
    b.obj.traverse(function (o) { if (o.userData && o.userData.isGlow) b.glow.push(o); });
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
    this._index(b, false);
    this.group.remove(b.obj);
    disposeTree(b.obj);
    U.swapRemove(this.list, i);
    this.invalidate();
    this._recenter();
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
     RAIDS
     ========================================================= */
  Building.prototype.raidTarget = function (x, z) {
    if (!this.list.length) return null;
    let best = null, bd = 1e9;
    for (const b of this.list) {
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
      /* lit windows — opacity is driven by the shared material above */
      if (b.glow.length) for (const gm of b.glow) gm.visible = night;

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

    this._updateLights(night, nightF);
    this._updateTracers(dt);

    if (this.placing) this.updatePlacement();
  };

  /** assign the 6 pooled point lights to the closest lit structures */
  Building.prototype._updateLights = function (night, nightF) {
    const p = this.game.player.pos;
    if (nightF === undefined) nightF = 1;
    if (!night) {
      for (const l of this._lights) l.visible = false;
      return;
    }
    const cand = [];
    for (const b of this.list) {
      if (!b.glow.length && b.defId !== 'lamp' && b.defId !== 'smelter') continue;
      const d = U.dist2(p.x, p.z, b.x, b.z);
      if (d < 60 * 60) cand.push({ b: b, d: d });
    }
    cand.sort((a, c) => a.d - c.d);
    for (let i = 0; i < this._lights.length; i++) {
      const l = this._lights[i];
      if (i < cand.length) {
        const b = cand[i].b;
        const isLamp = b.defId === 'lamp';
        l.position.set(b.x, b.y + (isLamp ? 2.8 + b.level * 0.3 : 2.2), b.z);
        l.intensity = (isLamp ? 1.5 + b.level * 0.35 : 0.9) * nightF;
        l.distance = isLamp ? 16 + b.level * 4 : 12;
        l.color.setHex(b.defId === 'smelter' ? 0xff7a2a : 0xffc069);
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
  Building.prototype.showBorder = function (on) {
    if (on) {
      const r = this.borderRadius();
      if (this.borderRing && this.borderRing.userData.r !== r) {
        this.game.scene.remove(this.borderRing);
        this.borderRing.geometry.dispose();
        this.borderRing = null;
      }
      if (!this.borderRing) {
        this.borderRing = M.territoryRing(r);
        this.borderRing.userData.r = r;
        this.game.scene.add(this.borderRing);
      }
      this.borderRing.visible = true;
      this.borderRing.position.y = C.WORLD.baseHeight + 0.4;
    } else if (this.borderRing) this.borderRing.visible = false;
  };

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
    this.invalidate();
  };

  G.Building = Building;
})(window.GAME = window.GAME || {});
