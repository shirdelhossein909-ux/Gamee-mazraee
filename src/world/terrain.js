/* =========================================================
   terrain.js — infinite procedural world.
   • deterministic height / biome field from one seed
   • chunk streaming around the player (generate + dispose)
   • resource nodes (trees, ore veins, bushes) with respawn
   • analytic ground raycast (no mesh picking needed)
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;
  const W = C.WORLD;

  function World(game, seed) {
    this.game = game;
    this.seed = seed >>> 0;
    this.noise = new U.Noise(this.seed);
    this.nz = {
      hills: new U.Noise(this.seed + 101),
      mount: new U.Noise(this.seed + 211),
      river: new U.Noise(this.seed + 331),
      temp: new U.Noise(this.seed + 457),
      moist: new U.Noise(this.seed + 587),
      detail: new U.Noise(this.seed + 701),
      scatter: new U.Noise(this.seed + 887)
    };

    this.group = new THREE.Group();
    this.group.name = 'world';
    this.chunks = new Map();     // "cx,cz" -> chunk
    this.pending = [];
    this.nodes = new Map();      // nodeId -> node
    this.harvested = Object.create(null); // nodeId -> in-game day it returns
    this.viewRadius = W.viewRadius;
    this._lastCx = 9999; this._lastCz = 9999;

    this._buildWater();
  }

  /* ===================== HEIGHT FIELD ===================== */
  World.prototype.heightAt = function (x, z) {
    const n = this.noise, nz = this.nz;
    // continental shelf
    let h = (n.fbm(x * 0.0026, z * 0.0026, 4) - 0.465) * 64;
    // rolling hills
    h += (nz.hills.fbm(x * 0.013, z * 0.013, 3) - 0.5) * 13;
    // mountain ranges (masked ridged noise)
    const mask = U.smoothstep(0.55, 0.86, nz.mount.fbm(x * 0.0042, z * 0.0042, 3));
    if (mask > 0.001) h += mask * nz.mount.ridged(x * 0.0085, z * 0.0085, 4) * 54;
    // surface detail
    h += (nz.detail.fbm(x * 0.06, z * 0.06, 2) - 0.5) * 2.2;
    const d = Math.sqrt(x * x + z * z);
    // home continent — a gentle land bias so the player never starts on a
    // barren islet. Fades out entirely by ~300 units from the origin.
    h += this.homeBias(d);
    // rivers — carve along the mid-band of a very low frequency field
    const rv = nz.river.fbm(x * 0.0015, z * 0.0015, 2);
    const river = 1 - U.smoothstep(0, 0.028, Math.abs(rv - 0.5));
    if (river > 0.001) h = U.lerp(h, Math.min(h, -1.8), river * 0.94 * (1 - mask * 0.75));
    // guaranteed fishing pond near the homestead
    const pond = this.pondDepth(x, z);
    if (pond > 0.001) h = U.lerp(h, Math.min(h, -2.8), pond);
    // the starting homestead is always a flat, dry plateau
    if (d < W.baseRadius * 1.6) {
      const b = 1 - U.smoothstep(W.baseRadius * 0.55, W.baseRadius * 1.55, d);
      h = U.lerp(h, W.baseHeight, b);
    }
    return h;
  };

  /** how much the homestead bias lifts the terrain at distance d from origin */
  World.prototype.homeBias = function (d) {
    return d < 280 ? (1 - U.smoothstep(45, 280, d)) * 9 : 0;
  };

  /* A pond is always carved a short walk from the farm so fishing, clay and
     watering-can refills are reachable on every seed. */
  const POND = { x: -38, z: -44, r: 19, inner: 7, depth: -2.8 };
  World.prototype.pondDepth = function (x, z) {
    const d = Math.hypot(x - POND.x, z - POND.z);
    return d < POND.r ? 1 - U.smoothstep(POND.inner, POND.r, d) : 0;
  };
  World.prototype.pondCenter = function () { return { x: POND.x, z: POND.z }; };

  World.prototype.slopeAt = function (x, z, s) {
    s = s || 1.2;
    const h = this.heightAt(x, z);
    return Math.max(
      Math.abs(this.heightAt(x + s, z) - h),
      Math.abs(this.heightAt(x - s, z) - h),
      Math.abs(this.heightAt(x, z + s) - h),
      Math.abs(this.heightAt(x, z - s) - h)
    );
  };

  World.prototype.isWater = function (x, z) { return this.heightAt(x, z) < W.waterLevel - 0.08; };
  World.prototype.isDeepWater = function (x, z) { return this.heightAt(x, z) < W.waterLevel - 1.6; };

  World.prototype.biomeAt = function (x, z, h) {
    if (h === undefined) h = this.heightAt(x, z);
    if (h < W.waterLevel - 0.1) return 'ocean';
    if (h < W.waterLevel + 1.0) return 'beach';
    const d = Math.sqrt(x * x + z * z);
    if (d < W.baseRadius * 1.14) return 'plains';
    // climate reads the *natural* elevation: the homestead land bias must not
    // turn the whole starting region into a mountain range.
    const hn = h - this.homeBias(d);
    if (hn > 32) return 'snow';
    const temp = this.nz.temp.fbm(x * 0.0017, z * 0.0017, 3) - U.smoothstep(24, 50, hn) * 0.26;
    const moist = this.nz.moist.fbm(x * 0.0021, z * 0.0021, 3);
    if (hn > 24) return temp < 0.33 ? 'snow' : 'rocky';
    if (temp < 0.28) return 'snow';
    if (temp > 0.63 && moist < 0.44) return 'desert';
    if (moist > 0.63) return h < W.waterLevel + 2.6 ? 'swamp' : 'forest';
    if (moist > 0.5) return 'forest';
    if (moist < 0.38) return 'savanna';
    return 'plains';
  };

  /* ===================== WATER ===================== */
  World.prototype._buildWater = function () {
    const span = (W.viewRadius * 2 + 3) * W.chunkSize;
    const geo = new THREE.PlaneGeometry(span, span, 44, 44);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({
      color: 0x2e7fa8, transparent: true, opacity: 0.82, depthWrite: false
    });
    const self = this;
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = self._waterTime = { value: 0 };
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'transformed.y += sin(transformed.x*0.22 + uTime*1.3)*0.19 + sin(transformed.z*0.29 - uTime*1.05)*0.16;'
      );
    };
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = W.waterLevel;
    this.water.renderOrder = 1;
    this.water.receiveShadow = false;
    this.group.add(this.water);
  };

  /* ===================== CHUNKS ===================== */
  World.prototype.chunkKeyOf = function (x, z) {
    return U.key(Math.floor(x / W.chunkSize + 0.5), Math.floor(z / W.chunkSize + 0.5));
  };

  World.prototype.update = function (dt, px, pz) {
    // water follows the camera & animates
    if (this._waterTime) this._waterTime.value += dt;
    this.water.position.x = Math.round(px / 8) * 8;
    this.water.position.z = Math.round(pz / 8) * 8;

    const cx = Math.round(px / W.chunkSize), cz = Math.round(pz / W.chunkSize);
    if (cx !== this._lastCx || cz !== this._lastCz) {
      this._lastCx = cx; this._lastCz = cz;
      this._refresh(cx, cz);
    }
    this._flushQueue();
  };

  World.prototype._refresh = function (cx, cz) {
    const R = this.viewRadius;
    const want = new Set();
    this.pending.length = 0;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > (R + 0.4) * (R + 0.4)) continue;
        const kx = cx + dx, kz = cz + dz, k = U.key(kx, kz);
        want.add(k);
        if (!this.chunks.has(k)) this.pending.push({ k: k, cx: kx, cz: kz, d: dx * dx + dz * dz });
      }
    }
    this.pending.sort((a, b) => a.d - b.d);
    // drop chunks that fell outside the view radius
    const dead = [];
    this.chunks.forEach((ch, k) => { if (!want.has(k)) dead.push(k); });
    for (const k of dead) this._disposeChunk(k);
  };

  /** generate a few chunks per frame so streaming never stalls the loop */
  World.prototype._flushQueue = function (all) {
    if (!this.pending.length) return;
    const t0 = U.now();
    let n = 0;
    while (this.pending.length) {
      const job = this.pending.shift();
      if (!this.chunks.has(job.k)) this._buildChunk(job.cx, job.cz);
      n++;
      // small budget: a long generation pass shows up as camera lag
      if (!all && (n >= 1 || U.now() - t0 > 7)) break;
    }
  };

  World.prototype.generateAll = function () { this._flushQueue(true); };

  World.prototype._buildChunk = function (cx, cz) {
    const size = W.chunkSize, segs = W.segments;
    const ox = cx * size, oz = cz * size;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const count = pos.count;
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    let minY = 1e9, maxY = -1e9;

    for (let i = 0; i < count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      const x = lx + ox, z = lz + oz;
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
      const b = C.BIOMES[this.biomeAt(x, z, h)];
      const t = this.nz.scatter.n2(x * 0.22, z * 0.22);
      c.setHex(t > 0.5 ? b.c1 : b.c2);
      // subtle luminance noise so large fields do not look flat
      const v = 0.9 + t * 0.2;
      col[i * 3] = c.r * v; col[i * 3 + 1] = c.g * v; col[i * 3 + 2] = c.b * v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, M.MAT.terrain);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    const chunk = { cx: cx, cz: cz, key: U.key(cx, cz), mesh: mesh, nodes: [], group: new THREE.Group() };
    chunk.group.add(mesh);
    this.group.add(chunk.group);
    this.chunks.set(chunk.key, chunk);

    this._populate(chunk, ox, oz, size);
    return chunk;
  };

  /* ---------------- resource nodes & decoration ---------------- */
  World.prototype._populate = function (chunk, ox, oz, size) {
    const rnd = U.rng(U.strSeed('c' + chunk.cx + '_' + chunk.cz + '_' + this.seed));
    const day = this.game.time ? this.game.time.day : 0;
    const tufts = [];
    const tries = 46;

    for (let i = 0; i < tries; i++) {
      const x = ox + (rnd() - 0.5) * size;
      const z = oz + (rnd() - 0.5) * size;
      const h = this.heightAt(x, z);
      if (h < W.waterLevel + 0.45) continue;
      const dHome = Math.sqrt(x * x + z * z);
      if (dHome < 13) continue;                       // keep the spawn clearing open
      const slope = this.slopeAt(x, z);
      if (slope > 2.6) continue;
      const bId = this.biomeAt(x, z, h);
      const b = C.BIOMES[bId];
      const near = dHome < W.baseRadius * 1.5 ? 0.45 : 1;   // thinner near home
      const hn = h - this.homeBias(dHome);                  // natural elevation
      const r = rnd();

      if (r < b.tree * near) {
        const kind = pickTree(bId, rnd, hn);
        this._addNode(chunk, 'tree', kind, x, h, z, i, rnd, day);
      } else if (r < (b.tree + b.rock) * near) {
        const kind = pickOre(rnd, hn, bId);
        this._addNode(chunk, 'ore', kind, x, h, z, i, rnd, day);
      } else if (r < b.tree + b.rock + 0.16) {
        const kind = (bId === 'forest' || bId === 'plains') && rnd() < 0.45 ? 'berry' : 'grass';
        this._addNode(chunk, 'bush', kind, x, h, z, i, rnd, day);
      } else if (r < 0.72 && bId !== 'ocean' && bId !== 'desert' && bId !== 'snow') {
        tufts.push({ x: x, y: h, z: z, c: rnd() > 0.5 ? b.c1 : b.c2, r0: rnd() * 6.28, r1: rnd(), r2: rnd() });
      }
    }
    if (tufts.length) {
      const gm = M.grassField(tufts);
      if (gm) { gm.matrixAutoUpdate = false; gm.updateMatrix(); chunk.group.add(gm); chunk.grass = gm; }
    }
    if (chunk.cx === 0 && chunk.cz === 0) this._starterProps(chunk, day);
  };

  /* The very first chunk always carries a guaranteed starter kit of trees,
     rocks and berry bushes so the opening quests are never impossible. */
  const STARTER = [
    ['tree', 'oak', 16, 0.35], ['tree', 'oak', 19, 1.45], ['tree', 'birch', 21, 2.55],
    ['tree', 'pine', 18, 3.65], ['tree', 'oak', 20, 4.75], ['tree', 'birch', 17, 5.85],
    ['ore', 'stone', 15, 0.95], ['ore', 'stone', 20, 3.15], ['ore', 'stone', 16, 5.25],
    ['bush', 'berry', 13, 2.1], ['bush', 'berry', 14, 4.5], ['bush', 'grass', 12, 0.6]
  ];
  World.prototype._starterProps = function (chunk, day) {
    const rnd = U.rng(U.strSeed('starter' + this.seed));
    let idx = 900;
    for (const s of STARTER) {
      const x = Math.cos(s[3]) * s[2], z = Math.sin(s[3]) * s[2];
      const h = this.heightAt(x, z);
      if (h < W.waterLevel + 0.4) continue;
      this._addNode(chunk, s[0], s[1], x, h, z, idx++, rnd, day);
    }
  };

  function pickTree(biome, rnd, h) {
    if (biome === 'desert' || biome === 'beach') return 'palm';
    if (biome === 'snow' || h > 22) return 'pine';
    if (biome === 'swamp') return rnd() < 0.5 ? 'dead' : 'oak';
    if (biome === 'savanna') return rnd() < 0.35 ? 'dead' : 'oak';
    const r = rnd();
    if (r < 0.04) return 'ancient';
    if (r < 0.36) return 'pine';
    if (r < 0.58) return 'birch';
    return 'oak';
  }

  function pickOre(rnd, h, biome) {
    const opts = [['stone', 1.0]];
    if (biome === 'rocky' || biome === 'snow' || h > 13) { opts.push(['coal', 0.55]); opts.push(['iron', 0.36]); }
    if (h > 21) opts.push(['gold', 0.18]);
    if (h > 27) opts.push(['gem', 0.07]);
    return U.weighted(opts, rnd);
  }

  World.prototype._addNode = function (chunk, kind, type, x, y, z, idx, rnd, day) {
    const id = chunk.cx + ':' + chunk.cz + ':' + idx;
    const back = this.harvested[id];
    if (back !== undefined && back > day) return;     // still regrowing
    if (back !== undefined) delete this.harvested[id];
    // never regrow inside a structure or on a tilled plot
    if (this.game.building && this.game.building.occupied(x, z, 0.9)) return;
    if (this.game.farming && this.game.farming.plotAt(x, z)) return;

    const def = kind === 'tree' ? C.TREES[type] : kind === 'ore' ? C.ORES[type] : C.BUSHES[type];
    let obj;
    if (kind === 'tree') obj = M.tree(type, rnd);
    else if (kind === 'ore') obj = M.rock(type, rnd);
    else obj = M.bush(type, rnd);

    obj.position.set(x, y - 0.1, z);
    obj.rotation.y = rnd() * 6.283;
    obj.matrixAutoUpdate = false;
    obj.updateMatrix();
    chunk.group.add(obj);

    const node = {
      id: id, kind: kind, type: type, def: def,
      x: x, y: y, z: z, obj: obj,
      hp: def.hp, maxHp: def.hp, chunk: chunk.key,
      name: def.name
    };
    chunk.nodes.push(node);
    this.nodes.set(id, node);
  };

  World.prototype.removeNode = function (node, respawnDays) {
    const ch = this.chunks.get(node.chunk);
    if (ch) {
      ch.group.remove(node.obj);
      const i = ch.nodes.indexOf(node);
      if (i >= 0) U.swapRemove(ch.nodes, i);
    }
    disposeObj(node.obj);
    this.nodes.delete(node.id);
    const day = this.game.time ? this.game.time.day : 0;
    this.harvested[node.id] = day + (respawnDays === undefined ? W.nodeRespawn : respawnDays);
  };

  World.prototype._disposeChunk = function (key) {
    const ch = this.chunks.get(key);
    if (!ch) return;
    for (const n of ch.nodes) this.nodes.delete(n.id);
    this.group.remove(ch.group);
    disposeObj(ch.group);
    this.chunks.delete(key);
  };

  function disposeObj(obj) {
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
    });
  }

  /* ===================== QUERIES ===================== */
  World.prototype.nodesNear = function (x, z, radius, out) {
    out = out || [];
    const r2 = radius * radius;
    this.nodes.forEach(function (n) {
      if (U.dist2(x, z, n.x, n.z) <= r2) out.push(n);
    });
    return out;
  };

  /** analytic ray-march against the height field — no colliders needed */
  const _rp = new THREE.Vector3();
  World.prototype.rayGround = function (origin, dir, maxDist) {
    maxDist = maxDist || 80;
    let t = 0.4, step = 0.5;
    if (dir.y > 0 && origin.y - this.heightAt(origin.x, origin.z) > 0.5) {
      // looking up from above ground: only hit if terrain rises fast, still march
    }
    while (t < maxDist) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y <= this.heightAt(x, z)) {
        let lo = Math.max(0, t - step), hi = t;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) * 0.5;
          const mx = origin.x + dir.x * mid, my = origin.y + dir.y * mid, mz = origin.z + dir.z * mid;
          if (my <= this.heightAt(mx, mz)) hi = mid; else lo = mid;
        }
        _rp.set(origin.x + dir.x * hi, origin.y + dir.y * hi, origin.z + dir.z * hi);
        _rp.y = this.heightAt(_rp.x, _rp.z);
        return { point: _rp.clone(), dist: hi };
      }
      step = Math.min(2.2, 0.4 + t * 0.06);
      t += step;
    }
    return null;
  };

  /** the flat-ish spot the game drops the player on at world start */
  World.prototype.spawnPoint = function () {
    return new THREE.Vector3(0, this.heightAt(0, 0), 0);
  };

  /** average height over a footprint — used to seat buildings */
  World.prototype.footprint = function (cx, cz, w, d, rot) {
    let min = 1e9, max = -1e9, sum = 0, n = 0;
    const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    const stepX = Math.max(1, w / 3), stepZ = Math.max(1, d / 3);
    for (let lx = -w / 2; lx <= w / 2 + 0.01; lx += stepX) {
      for (let lz = -d / 2; lz <= d / 2 + 0.01; lz += stepZ) {
        const x = cx + lx * c - lz * s;
        const z = cz + lx * s + lz * c;
        const h = this.heightAt(x, z);
        if (h < min) min = h;
        if (h > max) max = h;
        sum += h; n++;
      }
    }
    return { min: min, max: max, avg: sum / n, flat: max - min };
  };

  World.prototype.dispose = function () {
    const keys = [];
    this.chunks.forEach((v, k) => keys.push(k));
    for (const k of keys) this._disposeChunk(k);
    this.nodes.clear();
  };

  G.World = World;
})(window.GAME = window.GAME || {});
