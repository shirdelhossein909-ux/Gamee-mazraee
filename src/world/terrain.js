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
    this.unpopulated = [];         // ground down, props still owed
    this._starved = 0;
    /* ground the player has re-shaped: levelled squares and raised hills.
       See the LAND EDITS block below — the list is empty on a fresh world,
       and heightAt() pays nothing at all while it stays that way. */
    this.edits = [];
    this.editGrid = new Map();
    this.editSeq = 0;
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
    // and last of all, whatever the player has levelled or raised
    return this.edits.length ? this._shape(x, z, h) : h;
  };

  /* ===================== LAND EDITS =====================
     Everything above is a pure function of the seed. This is the one place
     the world remembers what you did to it: squares you levelled flat and
     hills you raised. An edit is a shape with a core and a soft rim —

       weight = 1 inside the core, smoothstepping to 0 across `edge`

     — so a levelled plaza is dead flat in the middle and melts into the
     natural ground at its border instead of ending in a cliff.

     They are indexed into coarse cells because heightAt() is the hottest
     function in the game: a chunk alone asks it a thousand times. A lookup
     touches only the handful of edits that can possibly reach the point. */
  const ECELL = 24;

  function editWeight(e, x, z) {
    const dx = Math.abs(x - e.x), dz = Math.abs(z - e.z);
    let od;                                    // metres outside the core
    if (e.round) od = Math.sqrt(dx * dx + dz * dz) - e.rx;
    else od = Math.max(dx - e.rx, dz - e.rz);
    if (od <= 0) return 1;
    if (od >= e.edge) return 0;
    const t = od / e.edge;
    return 1 - t * t * (3 - 2 * t);
  }
  World.editWeight = editWeight;

  /* Silhouettes. `pow` bends the dome: 1 is a plain hill, below 1 spreads it
     into a broad swell, above 1 draws it up into a peak. `rough` breaks the
     surface with ridged noise so a rock face never looks turned on a lathe. */
  const HILL = {
    sand: { pow: 1.00, rough: 0.05, freq: 0.055, biome: 'desert' },
    flower: { pow: 0.85, rough: 0.04, freq: 0.070, biome: 'meadow' },
    rock: { pow: 1.25, rough: 0.30, freq: 0.045, biome: 'rocky' },
    snow: { pow: 1.10, rough: 0.13, freq: 0.050, biome: 'snow' },
    peak: { pow: 1.80, rough: 0.45, freq: 0.035, biome: 'rocky', cap: 'snow', capAt: 0.62 }
  };
  World.HILL = HILL;

  World.prototype._editsAt = function (x, z) {
    return this.editGrid.get(U.key(Math.floor(x / ECELL), Math.floor(z / ECELL)));
  };

  World.prototype._shape = function (x, z, h) {
    const list = this._editsAt(x, z);
    if (!list) return h;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const w = editWeight(e, x, z);
      if (w <= 0) continue;
      if (e.kind === 'flat') h += (e.y - h) * w;
      else h += this._lift(e, x, z, w);
    }
    return h;
  };

  World.prototype._lift = function (e, x, z, w) {
    const p = HILL[e.hk] || HILL.sand;
    let lift = e.peak * Math.pow(w, p.pow);
    if (p.rough) {
      const r = this.nz.mount.ridged(x * p.freq, z * p.freq, 3);
      lift += (r - 0.42) * p.rough * e.peak * w * w;
    }
    return lift;
  };

  /** the hill standing at this point, if any — the last one wins */
  World.prototype.hillAt = function (x, z, minW) {
    if (!this.edits.length) return null;
    const list = this._editsAt(x, z);
    if (!list) return null;
    let out = null;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.kind !== 'hill') continue;
      if (editWeight(e, x, z) > (minW === undefined ? 0.22 : minW)) out = e;
    }
    return out;
  };

  /** is this point inside ground the player levelled? */
  World.prototype.levelled = function (x, z, minW) {
    if (!this.edits.length) return false;
    const list = this._editsAt(x, z);
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.kind === 'flat' && editWeight(e, x, z) > (minW === undefined ? 0.55 : minW)) return true;
    }
    return false;
  };

  /** the edit whose core covers this point — what a restore tool undoes */
  World.prototype.editAt = function (x, z) {
    if (!this.edits.length) return null;
    const list = this._editsAt(x, z);
    if (!list) return null;
    let out = null;
    for (let i = 0; i < list.length; i++) if (editWeight(list[i], x, z) > 0.5) out = list[i];
    return out;
  };

  World.prototype._indexEdit = function (e, add) {
    const r = Math.max(e.rx, e.rz) + e.edge;
    for (let cx = Math.floor((e.x - r) / ECELL); cx <= Math.floor((e.x + r) / ECELL); cx++) {
      for (let cz = Math.floor((e.z - r) / ECELL); cz <= Math.floor((e.z + r) / ECELL); cz++) {
        const k = U.key(cx, cz);
        let arr = this.editGrid.get(k);
        if (add) {
          if (!arr) this.editGrid.set(k, arr = []);
          arr.push(e);
        } else if (arr) {
          const i = arr.indexOf(e);
          if (i >= 0) arr.splice(i, 1);       // order matters: not swapRemove
          if (!arr.length) this.editGrid.delete(k);
        }
      }
    }
  };

  /** record a new piece of shaped ground. Does not rebuild — see rebuildArea */
  World.prototype.addEdit = function (e) {
    e.id = ++this.editSeq;
    if (e.edge === undefined) e.edge = 2.5;
    if (e.rz === undefined) e.rz = e.rx;
    this.edits.push(e);
    this._indexEdit(e, true);
    return e;
  };

  World.prototype.removeEdit = function (e) {
    const i = this.edits.indexOf(e);
    if (i < 0) return false;
    this.edits.splice(i, 1);
    this._indexEdit(e, false);
    return true;
  };

  /** the ground you shaped, small enough to sit in a save file */
  World.prototype.serializeEdits = function () {
    return this.edits.map(function (e) {
      return {
        k: e.kind === 'hill' ? 1 : 0, x: e.x, z: e.z, rx: e.rx, rz: e.rz,
        e: e.edge, y: e.y, o: e.round ? 1 : 0, p: e.peak, hk: e.hk, a: e.auto ? 1 : 0
      };
    });
  };

  World.prototype.loadEdits = function (rows) {
    this.edits.length = 0;
    this.editGrid.clear();
    this.editSeq = 0;
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      this.addEdit({
        kind: r.k ? 'hill' : 'flat', x: r.x, z: r.z, rx: r.rx, rz: r.rz,
        edge: r.e, y: r.y, round: !!r.o, peak: r.p, hk: r.hk, auto: !!r.a
      });
    }
  };

  /* Throw away every loaded chunk that the shaped ground touches and build
     it again. A deliberate act by the player is worth one visible hitch —
     streaming it in over the next second would show holes in the world. */
  World.prototype.rebuildArea = function (x, z, radius) {
    const half = W.chunkSize * 0.5, keys = [];
    this.chunks.forEach(function (ch, k) {
      if (Math.abs(ch.cx * W.chunkSize - x) <= radius + half &&
        Math.abs(ch.cz * W.chunkSize - z) <= radius + half) keys.push(k);
    });
    for (const k of keys) {
      const ch = this.chunks.get(k);
      const cx = ch.cx, cz = ch.cz;
      this._disposeChunk(k);
      const nc = this._buildChunk(cx, cz);
      this._populateChunk(nc, 0);
      const q = this.unpopulated.indexOf(nc);
      if (q >= 0) this.unpopulated.splice(q, 1);
    }
    return keys.length;
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
    /* a hill you raised wears its own skin — sand, rock, snow or flowers —
       out to the point where its rim melts back into the countryside */
    if (this.edits.length) {
      const hill = this.hillAt(x, z);
      if (hill) {
        const p = HILL[hill.hk] || HILL.sand;
        if (p.cap && editWeight(hill, x, z) > p.capAt) return p.cap;
        return p.biome;
      }
    }
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

  World.prototype.update = function (dt, px, pz, lateFrame) {
    // water follows the camera & animates
    if (this._waterTime) this._waterTime.value += dt;
    this.water.position.x = Math.round(px / 8) * 8;
    this.water.position.z = Math.round(pz / 8) * 8;

    const cx = Math.round(px / W.chunkSize), cz = Math.round(pz / W.chunkSize);
    if (cx !== this._lastCx || cz !== this._lastCz) {
      this._lastCx = cx; this._lastCz = cz;
      this._refresh(cx, cz);
    }
    this._flushQueue(false, lateFrame);
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

  /* Streaming, split so no single frame carries a whole chunk.

     Ground geometry and the trees/rocks that stand on it each cost a few
     milliseconds. Doing both together overran the frame every time you
     crossed a chunk boundary, and since crossing one queues a whole new row
     of chunks the overrun repeated for several frames in a row — which is
     what made the camera feel like it locked up while walking. Now a frame
     does one half of one chunk, and it does nothing at all on a frame that
     is already running late. */
  World.prototype._flushQueue = function (all, lateFrame) {
    if (all) {
      while (this.pending.length) {
        const job = this.pending.shift();
        if (!this.chunks.has(job.k)) this._buildChunk(job.cx, job.cz);
      }
      while (this.unpopulated.length) this._populateChunk(this.unpopulated.shift(), 0);
      return;
    }
    if (!this.pending.length && !this.unpopulated.length) { this._starved = 0; return; }
    /* Standing down is only ever a delay. On a machine that never has a
       spare frame this would otherwise stall the world forever, so after a
       few skips we build regardless — a brief hitch beats missing ground. */
    if (lateFrame && ++this._starved < 4) return;
    this._starved = 0;

    // props for a chunk whose ground is already down come first: it is
    // already visible, and bare ground reads as a bug
    if (this.unpopulated.length) {
      if (this._populateChunk(this.unpopulated[0])) this.unpopulated.shift();
      return;
    }
    const job = this.pending.shift();
    if (!this.chunks.has(job.k)) this._buildChunk(job.cx, job.cz);
  };

  /* Build the whole starting neighbourhood up front, ground and props alike.
     The opening quests need the guaranteed trees and rocks at the homestead
     to exist the moment the player takes their first step — streaming them
     in a slice at a time is for ground you walk towards later. */
  World.prototype.generateAll = function (cx, cz) {
    // default to wherever we are already centred; 0,0 only on a cold world
    const fresh = this._lastCx === 9999;
    this._lastCx = cx !== undefined ? cx : (fresh ? 0 : this._lastCx);
    this._lastCz = cz !== undefined ? cz : (fresh ? 0 : this._lastCz);
    this._refresh(this._lastCx, this._lastCz);
    this._flushQueue(true);
  };

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

    // props follow on a later frame — see _flushQueue
    this.unpopulated.push(chunk);
    return chunk;
  };

  /* Props are by far the costliest part of a chunk — every tree and rock is
     its own merged geometry — so they are laid down a slice at a time.
     Returns true once the chunk is finished. */
  World.prototype._populateChunk = function (chunk, slice) {
    if (!chunk || chunk.populated) return true;
    if (!this.chunks.has(chunk.key)) { chunk.populated = true; return true; }
    const size = W.chunkSize;
    const done = this._populate(chunk, chunk.cx * size, chunk.cz * size, size,
      slice === undefined ? PROP_SLICE : slice);
    if (done) chunk.populated = true;
    return done;
  };

  /* ---------------- resource nodes & decoration ---------------- */
  const PROP_TRIES = 46;
  const PROP_SLICE = 10;               // props attempted per frame
  World.prototype._populate = function (chunk, ox, oz, size, slice) {
    let st = chunk.popState;
    if (!st) {
      st = chunk.popState = {
        i: 0,
        rnd: U.rng(U.strSeed('c' + chunk.cx + '_' + chunk.cz + '_' + this.seed)),
        tufts: []
      };
    }
    const rnd = st.rnd;
    const day = this.game.time ? this.game.time.day : 0;
    const tufts = st.tufts;
    const tries = PROP_TRIES;
    const stop = slice > 0 ? Math.min(tries, st.i + slice) : tries;

    for (let i = st.i; i < stop; i++) {
      const x = ox + (rnd() - 0.5) * size;
      const z = oz + (rnd() - 0.5) * size;
      const h = this.heightAt(x, z);
      if (h < W.waterLevel + 0.45) continue;
      const dHome = Math.sqrt(x * x + z * z);
      if (dHome < 13) continue;                       // keep the spawn clearing open
      // ground you levelled is prepared ground: nothing grows back on it
      if (this.levelled(x, z)) continue;
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
    st.i = stop;
    if (st.i < tries) return false;                  // more slices to come

    if (tufts.length) {
      const gm = M.grassField(tufts);
      if (gm) { gm.matrixAutoUpdate = false; gm.updateMatrix(); chunk.group.add(gm); chunk.grass = gm; }
    }
    if (this.edits.length) this._hillFlora(chunk, ox, oz, size);
    if (chunk.cx === 0 && chunk.cz === 0) this._starterProps(chunk, day);
    chunk.popState = null;
    return true;
  };

  /* A flower hill has to actually be full of flowers, and the thin scatter
     that dresses ordinary countryside is nowhere near enough. Any flowered
     hill overlapping this chunk gets its own dense pass, merged into a
     single mesh so the whole hillside costs one draw call. */
  const FLOWERS_PER_CHUNK = 460;
  World.prototype._hillFlora = function (chunk, ox, oz, size) {
    let any = false;
    for (const e of this.edits) {
      if (e.kind !== 'hill' || e.hk !== 'flower') continue;
      const r = Math.max(e.rx, e.rz) + e.edge + size * 0.5;
      if (Math.abs(e.x - ox) > r || Math.abs(e.z - oz) > r) continue;
      any = true; break;
    }
    if (!any) return;
    const rnd = U.rng(U.strSeed('fl' + chunk.cx + '_' + chunk.cz + '_' + this.seed));
    const pts = [];
    for (let i = 0; i < FLOWERS_PER_CHUNK; i++) {
      const x = ox + (rnd() - 0.5) * size, z = oz + (rnd() - 0.5) * size;
      const hill = this.hillAt(x, z, 0.16);
      if (!hill || hill.hk !== 'flower') continue;
      if (this.levelled(x, z)) continue;
      pts.push({ x: x, y: this.heightAt(x, z), z: z, r0: rnd() * 6.28, r1: rnd(), r2: rnd() });
    }
    const fm = M.flowerField(pts);
    if (fm) { fm.matrixAutoUpdate = false; fm.updateMatrix(); chunk.group.add(fm); chunk.flowers = fm; }
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
    // never regrow inside a structure, on a tilled plot or on levelled ground
    if (this.game.building && this.game.building.occupied(x, z, 0.9)) return;
    if (this.game.farming && this.game.farming.plotAt(x, z)) return;
    if (this.levelled(x, z)) return;

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

  /* Drop a node into the world at runtime, outside the usual chunk pass —
     an earthquake shaking fresh veins out of the ground, say. It lands in
     whichever chunk is loaded there, so it streams and disposes like any
     other prop. Returns the node, or null if that chunk is not resident. */
  World.prototype.spawnNode = function (kind, type, x, z) {
    const chunk = this.chunks.get(this.chunkKeyOf(x, z));
    if (!chunk) return null;
    const y = this.heightAt(x, z);
    const idx = 900000 + (this._extraSeq = (this._extraSeq || 0) + 1);
    const rnd = U.rng(U.strSeed('q' + Math.round(x * 8) + '_' + Math.round(z * 8) + '_' + idx));
    const before = chunk.nodes.length;
    this._addNode(chunk, kind, type, x, y, z, idx, rnd, this.game.time ? this.game.time.day : 0);
    return chunk.nodes.length > before ? chunk.nodes[chunk.nodes.length - 1] : null;
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
    const q = this.unpopulated.indexOf(ch);
    if (q >= 0) this.unpopulated.splice(q, 1);
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
