/* =========================================================
   props.js — procedural low-poly model factory.
   Every model is assembled from shared primitives and then
   MERGED into a single BufferGeometry with vertex colors,
   so a whole house / tree / animal costs one draw call.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config;
  const M = {};

  /* ---------------- shared primitives ---------------- */
  const P = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1),
    cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1),
    cyl4: new THREE.CylinderGeometry(0.5, 0.5, 1, 4, 1),
    cone: new THREE.ConeGeometry(0.5, 1, 10, 1),
    cone5: new THREE.ConeGeometry(0.5, 1, 5, 1),
    pyr: new THREE.ConeGeometry(0.72, 1, 4, 1),
    sph: new THREE.SphereGeometry(0.5, 8, 6),
    ico: new THREE.IcosahedronGeometry(0.5, 0),
    plane: new THREE.PlaneGeometry(1, 1),
    ring: new THREE.RingGeometry(0.42, 0.5, 20)
  };
  P.taper = function (rTop, rBot, seg) { return new THREE.CylinderGeometry(rTop, rBot, 1, seg || 8, 1); };
  M.P = P;

  /* ---------------- palette ---------------- */
  const COL = {
    wood: 0x8a6034, woodDark: 0x5e4224, woodLight: 0xb08553,
    plank: 0xc09a63, roofRed: 0xa8402f, roofBlue: 0x3d5f8a, roofGreen: 0x3f6f45,
    roofOrange: 0xc06a2a, thatch: 0xc7a24d,
    stone: 0x8f8f8a, stoneDark: 0x6d6d68, brick: 0xa8523c, marble: 0xdcd8cc,
    iron: 0x6e737a, gold: 0xf0c437, glass: 0x9fd8e8, glassLit: 0xffdd88,
    cloth: 0xd8d2c0, dirt: 0x6b4d31, dirtWet: 0x4a3421, grass: 0x6ba24e,
    white: 0xf2f2ee, black: 0x2a2a2a, red: 0xc0392b
  };
  M.COL = COL;

  /* ---------------- materials ---------------- */
  const MAT = {
    solid: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
    // window/lamp light: one shared material whose opacity follows dusk
    window: new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, transparent: true, opacity: 1 }),
    ghostOk: new THREE.MeshLambertMaterial({ color: 0x55ff88, transparent: true, opacity: 0.45, depthWrite: false }),
    ghostBad: new THREE.MeshLambertMaterial({ color: 0xff5555, transparent: true, opacity: 0.45, depthWrite: false }),
    terrain: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    ring: new THREE.MeshBasicMaterial({ color: 0xffd15c, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    ringBad: new THREE.MeshBasicMaterial({ color: 0xff5c5c, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
  };
  M.MAT = MAT;

  /* ---------------- geometry merge ---------------- */
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

  /** parts: [{g, c, p:[x,y,z], r:[rx,ry,rz], s:[sx,sy,sz], glow}] */
  function merge(parts) {
    let n = 0;
    const prepped = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
      const pos = p.p || [0, 0, 0], rot = p.r || [0, 0, 0], sc = p.s || [1, 1, 1];
      _v.set(pos[0], pos[1], pos[2]);
      _e.set(rot[0], rot[1], rot[2]);
      _q.setFromEuler(_e);
      _s.set(sc[0], sc[1], sc[2]);
      _m4.compose(_v, _q, _s);
      g.applyMatrix4(_m4);
      if (!g.attributes.normal) g.computeVertexNormals();
      n += g.attributes.position.count;
      prepped.push({ g: g, c: p.c === undefined ? 0xffffff : p.c });
    }
    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    let o = 0;
    for (let i = 0; i < prepped.length; i++) {
      const g = prepped[i].g;
      const pa = g.attributes.position.array, na = g.attributes.normal.array;
      const cnt = g.attributes.position.count;
      _c.setHex(prepped[i].c);
      for (let k = 0; k < cnt; k++) {
        const a = (o + k) * 3, b = k * 3;
        position[a] = pa[b]; position[a + 1] = pa[b + 1]; position[a + 2] = pa[b + 2];
        normal[a] = na[b]; normal[a + 1] = na[b + 1]; normal[a + 2] = na[b + 2];
        color[a] = _c.r; color[a + 1] = _c.g; color[a + 2] = _c.b;
      }
      o += cnt;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
  M.merge = merge;

  /** build a Group: one solid mesh (+ one unlit "glow" mesh for windows/lamps) */
  function assemble(parts, noShadow) {
    const grp = new THREE.Group();
    const solid = [], glow = [];
    for (const p of parts) (p.glow ? glow : solid).push(p);
    if (solid.length) {
      const mesh = new THREE.Mesh(merge(solid), MAT.solid);
      mesh.castShadow = !noShadow; mesh.receiveShadow = true;
      grp.add(mesh); grp.userData.solid = mesh;
    }
    if (glow.length) {
      const mesh = new THREE.Mesh(merge(glow), MAT.glow);
      mesh.userData.isGlow = true;      // toggled on at night
      grp.add(mesh); grp.userData.glow = mesh;
    }
    return grp;
  }
  M.assemble = assemble;

  /* ---------------- small part helpers ---------------- */
  /** gable (A-shaped) roof made of two slanted slabs */
  function gable(parts, ox, oy, oz, w, d, h, color) {
    const half = d / 2;
    const slope = Math.atan2(h, half);
    const len = Math.hypot(h, half) + 0.12;
    const t = 0.18;
    parts.push({ g: P.box, c: color, p: [ox, oy + h / 2, oz + half / 2], r: [-slope, 0, 0], s: [w, t, len] });
    parts.push({ g: P.box, c: color, p: [ox, oy + h / 2, oz - half / 2], r: [slope, 0, 0], s: [w, t, len] });
    // ridge beam
    parts.push({ g: P.box, c: color, p: [ox, oy + h + 0.02, oz], s: [w * 1.02, 0.14, 0.2] });
  }
  /** 4-sided pyramid roof */
  function pyramid(parts, ox, oy, oz, w, d, h, color) {
    parts.push({ g: P.pyr, c: color, p: [ox, oy + h / 2, oz], r: [0, Math.PI / 4, 0], s: [w, h, d] });
  }
  /** a row of windows on the +Z / -Z faces */
  function windows(parts, ox, oy, oz, w, d, count, lit) {
    const step = w / (count + 1);
    for (let i = 1; i <= count; i++) {
      const x = ox - w / 2 + step * i;
      for (const sz of [d / 2 + 0.03, -d / 2 - 0.03]) {
        parts.push({ g: P.box, c: lit ? COL.glassLit : COL.glass, glow: !!lit, p: [x, oy, oz + sz], s: [0.55, 0.62, 0.06] });
        parts.push({ g: P.box, c: COL.woodDark, p: [x, oy, oz + sz * 1.001], s: [0.66, 0.09, 0.05] });
      }
    }
  }
  function door(parts, ox, oy, oz, color) {
    parts.push({ g: P.box, c: color || COL.woodDark, p: [ox, oy + 0.55, oz], s: [0.8, 1.1, 0.08] });
    parts.push({ g: P.sph, c: COL.gold, p: [ox + 0.28, oy + 0.6, oz + 0.04], s: [0.1, 0.1, 0.1] });
  }

  /* =========================================================
     TREES
     ========================================================= */
  M.tree = function (kind, rnd) {
    const d = C.TREES[kind] || C.TREES.oak;
    const h = U.randRange(rnd, d.h[0], d.h[1]);
    const parts = [];
    const tw = 0.26 + h * 0.045;

    if (kind === 'pine') {
      parts.push({ g: P.cyl6, c: d.trunk, p: [0, h * 0.4, 0], s: [tw, h * 0.85, tw] });
      const tiers = 4;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const y = h * (0.32 + t * 0.62);
        const r = (1.9 - t * 1.25) * (0.55 + h * 0.055);
        parts.push({ g: P.cone, c: i % 2 ? d.leaf : (d.leaf + 0x030c03), p: [0, y, 0], s: [r, h * 0.34, r] });
      }
    } else if (kind === 'birch') {
      parts.push({ g: P.cyl6, c: d.trunk, p: [0, h * 0.45, 0], s: [tw * 0.75, h * 0.9, tw * 0.75] });
      for (let i = 0; i < 3; i++) {
        parts.push({ g: P.box, c: 0x4a4a44, p: [0, h * (0.25 + i * 0.2), tw * 0.4], s: [tw * 0.6, 0.07, 0.05] });
      }
      for (let i = 0; i < 3; i++) {
        const a = rnd() * 6.28;
        parts.push({
          g: P.ico, c: d.leaf,
          p: [Math.cos(a) * 0.5, h * (0.82 + rnd() * 0.2), Math.sin(a) * 0.5],
          s: [h * 0.4, h * 0.34, h * 0.4]
        });
      }
    } else if (kind === 'palm') {
      const bend = (rnd() - 0.5) * 0.5;
      for (let i = 0; i < 5; i++) {
        const t = i / 5;
        parts.push({
          g: P.cyl6, c: d.trunk,
          p: [bend * t * t * 3, h * (t + 0.1), 0], r: [0, 0, -bend * t],
          s: [tw * (1 - t * 0.35), h * 0.24, tw * (1 - t * 0.35)]
        });
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * 6.283;
        parts.push({
          g: P.box, c: d.leaf,
          p: [bend * 3 + Math.cos(a) * 1.5, h * 1.05 - 0.35, Math.sin(a) * 1.5],
          r: [0, -a, 0.42], s: [3.4, 0.09, 0.6]
        });
      }
      parts.push({ g: P.sph, c: 0x7a5a2a, p: [bend * 3, h * 1.02, 0], s: [0.5, 0.4, 0.5] });
    } else if (kind === 'dead') {
      parts.push({ g: P.cyl6, c: d.trunk, p: [0, h * 0.5, 0], s: [tw, h, tw] });
      for (let i = 0; i < 4; i++) {
        const a = rnd() * 6.28, y = h * (0.45 + rnd() * 0.45);
        parts.push({
          g: P.cyl6, c: d.trunk, p: [Math.cos(a) * 0.55, y, Math.sin(a) * 0.55],
          r: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], s: [0.13, 1.5, 0.13]
        });
      }
    } else {
      /* oak / ancient — round canopy of blobs */
      const big = kind === 'ancient';
      parts.push({ g: P.taper(0.8, 1.15, 7), c: d.trunk, p: [0, h * 0.3, 0], s: [tw * 1.5, h * 0.62, tw * 1.5] });
      if (big) {
        for (let i = 0; i < 3; i++) {
          const a = i * 2.1 + rnd();
          parts.push({
            g: P.cyl6, c: d.trunk, p: [Math.cos(a) * 0.7, h * 0.55, Math.sin(a) * 0.7],
            r: [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7], s: [0.24, 2.4, 0.24]
          });
        }
      }
      const blobs = big ? 6 : 4;
      const cr = (big ? 1.5 : 1.0) * (1.1 + h * 0.14);
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * 6.283 + rnd() * 0.6;
        const rr = i === 0 ? 0 : cr * 0.42;
        parts.push({
          g: P.ico, c: i % 2 ? d.leaf : d.leaf - 0x040c04,
          p: [Math.cos(a) * rr, h * (0.78 + (i === 0 ? 0.14 : 0)) + rnd() * 0.3, Math.sin(a) * rr],
          r: [rnd(), rnd(), rnd()],
          s: [cr * (0.85 + rnd() * 0.35), cr * (0.8 + rnd() * 0.3), cr * (0.85 + rnd() * 0.35)]
        });
      }
    }
    const g = assemble(parts);
    g.userData.height = h;
    return g;
  };

  /* =========================================================
     ROCKS / ORE VEINS
     ========================================================= */
  M.rock = function (kind, rnd) {
    const d = C.ORES[kind] || C.ORES.stone;
    const parts = [];
    const s = 0.9 + rnd() * 0.7 + (kind === 'gem' || kind === 'gold' ? 0.4 : 0);
    const blobs = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < blobs; i++) {
      const a = rnd() * 6.28, r = i === 0 ? 0 : 0.5 * s;
      parts.push({
        g: P.ico, c: i % 2 ? d.c : d.c - 0x0a0a0a,
        p: [Math.cos(a) * r, s * (i === 0 ? 0.42 : 0.24 + rnd() * 0.24), Math.sin(a) * r],
        r: [rnd() * 3, rnd() * 3, rnd() * 3],
        s: [s * (0.7 + rnd() * 0.6), s * (0.6 + rnd() * 0.5), s * (0.7 + rnd() * 0.6)]
      });
    }
    if (kind !== 'stone') {
      const n = kind === 'gem' ? 5 : 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283 + rnd();
        parts.push({
          g: kind === 'gem' ? P.ico : P.cone5, c: d.crystal,
          glow: kind === 'gem',
          p: [Math.cos(a) * s * 0.42, s * (0.45 + rnd() * 0.35), Math.sin(a) * s * 0.42],
          r: [(rnd() - 0.5) * 0.8, rnd() * 3, (rnd() - 0.5) * 0.8],
          s: [0.26 * s, 0.42 * s, 0.26 * s]
        });
      }
    }
    return assemble(parts);
  };

  /* =========================================================
     BUSHES / DECOR
     ========================================================= */
  M.bush = function (kind, rnd) {
    const d = C.BUSHES[kind] || C.BUSHES.grass;
    const parts = [];
    if (kind === 'grass') {
      for (let i = 0; i < 5; i++) {
        const a = rnd() * 6.28, r = rnd() * 0.34;
        parts.push({
          g: P.cone5, c: i % 2 ? d.c : d.b,
          p: [Math.cos(a) * r, 0.28 + rnd() * 0.18, Math.sin(a) * r],
          r: [(rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5],
          s: [0.2, 0.62 + rnd() * 0.35, 0.2]
        });
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const a = rnd() * 6.28, r = i === 0 ? 0 : 0.26;
        parts.push({
          g: P.ico, c: d.c, p: [Math.cos(a) * r, 0.34 + rnd() * 0.14, Math.sin(a) * r],
          r: [rnd(), rnd(), rnd()], s: [0.75, 0.62, 0.75]
        });
      }
      for (let i = 0; i < 5; i++) {
        const a = rnd() * 6.28;
        parts.push({ g: P.sph, c: d.b, p: [Math.cos(a) * 0.36, 0.42 + rnd() * 0.28, Math.sin(a) * 0.36], s: [0.15, 0.15, 0.15] });
      }
    }
    return assemble(parts, true);
  };

  /** merged decorative grass tufts for a whole chunk (1 draw call) */
  M.grassField = function (points) {
    const parts = [];
    for (const p of points) {
      const c = p.c;
      for (let i = 0; i < 3; i++) {
        const a = p.r0 + i * 2.1;
        parts.push({
          g: P.cone5, c: c,
          p: [p.x + Math.cos(a) * 0.16, p.y + 0.2, p.z + Math.sin(a) * 0.16],
          r: [(p.r1 - 0.5) * 0.4, a, (p.r2 - 0.5) * 0.4],
          s: [0.13, 0.42 + p.r1 * 0.3, 0.13]
        });
      }
    }
    if (!parts.length) return null;
    const mesh = new THREE.Mesh(merge(parts), MAT.solid);
    mesh.receiveShadow = true;
    return mesh;
  };

  /* =========================================================
     CROPS — 4 growth stages
     ========================================================= */
  M.crop = function (cropId, stage) {
    const d = C.CROPS[cropId];
    const parts = [];
    const t = stage / 3;                    // 0..1
    const hh = (0.25 + t * 0.95) * (d.tall || 1);

    if (stage === 0) {
      parts.push({ g: P.cone5, c: d.colA, p: [0, 0.12, 0], s: [0.16, 0.3, 0.16] });
      parts.push({ g: P.cone5, c: d.colA, p: [0.1, 0.1, 0.08], r: [0.3, 1, 0.2], s: [0.12, 0.24, 0.12] });
    } else {
      const stalks = stage === 1 ? 3 : 4;
      for (let i = 0; i < stalks; i++) {
        const a = (i / stalks) * 6.283;
        const r = 0.15 + stage * 0.045;
        parts.push({
          g: P.cyl4, c: d.colA,
          p: [Math.cos(a) * r * 0.5, hh * 0.5, Math.sin(a) * r * 0.5],
          r: [Math.sin(a) * 0.14, 0, -Math.cos(a) * 0.14],
          s: [0.075, hh, 0.075]
        });
        // leaves
        parts.push({
          g: P.box, c: d.colA, p: [Math.cos(a) * r * 1.5, hh * 0.55, Math.sin(a) * r * 1.5],
          r: [0, -a, 0.5], s: [0.42, 0.04, 0.13]
        });
      }
      if (stage >= 2) {
        const fruits = stage === 2 ? 2 : 4;
        for (let i = 0; i < fruits; i++) {
          const a = (i / fruits) * 6.283 + 0.4;
          const fs = (stage === 3 ? 0.3 : 0.19) * (d.tall > 1 ? 0.8 : 1.15);
          parts.push({
            g: cropId === 'wheat' || cropId === 'corn' ? P.cone5 : P.ico,
            c: d.colB,
            p: [Math.cos(a) * 0.2, hh * (d.tall > 1 ? 0.9 : 0.42) + (d.tall > 1 ? 0 : 0.06), Math.sin(a) * 0.2],
            r: [0, a, cropId === 'wheat' ? 0 : 0.3],
            s: [fs, fs * (cropId === 'wheat' ? 2.2 : 1), fs]
          });
        }
      }
    }
    return assemble(parts, true);
  };

  /** Tilled soil tile. Tiles are exactly one grid cell wide and the furrows
      repeat on the same local offsets, so a block of plots reads as one
      continuous, evenly ploughed field instead of separate patches. */
  M.soil = function (size, watered) {
    const parts = [];
    const bed = watered ? COL.dirtWet : COL.dirt;
    const cut = watered ? 0x3a2917 : 0x574026;
    // deep slab: terraced plots still meet the hillside without floating
    parts.push({ g: P.box, c: bed, p: [0, -0.45, 0], s: [size, 1.1, size] });
    // furrows run along X at a fixed spacing that tiles seamlessly
    const rows = 4, step = size / rows;
    for (let i = 0; i < rows; i++) {
      parts.push({
        g: P.box, c: cut,
        p: [0, 0.09, -size / 2 + step * (i + 0.5)],
        s: [size, 0.06, step * 0.42]
      });
    }
    const m = new THREE.Mesh(merge(parts), MAT.solid);
    m.receiveShadow = true;
    return m;
  };

  /* =========================================================
     BUILDINGS
     ========================================================= */
  const BM = {};

  BM.tent = function (l) {
    const p = [];
    const w = 1.9, h = 1.5 + l * 0.25;
    p.push({ g: P.cyl6, c: COL.wood, p: [0, h / 2, 0], s: [0.1, h, 0.1] });
    for (const sx of [-1, 1]) {
      p.push({ g: P.box, c: l > 1 ? 0xc25e3a : COL.cloth, p: [sx * w * 0.32, h / 2, 0], r: [0, 0, sx * 0.42], s: [0.08, Math.hypot(h, w * 0.6), w * 1.5] });
    }
    p.push({ g: P.box, c: COL.woodDark, p: [0, 0.06, 0], s: [w * 1.4, 0.12, w * 1.6] });
    if (l >= 2) { p.push({ g: P.box, c: COL.woodDark, p: [0, 0.4, w * 0.8], s: [0.9, 0.8, 0.08] }); }
    if (l >= 3) {
      p.push({ g: P.cyl, c: 0x3a3a3a, p: [w * 0.9, 0.16, w * 0.6], s: [0.5, 0.2, 0.5] });
      p.push({ g: P.cone5, c: 0xff8c1a, glow: true, p: [w * 0.9, 0.35, w * 0.6], s: [0.3, 0.45, 0.3] });
    }
    return assemble(p);
  };

  /* A street of identical houses is the fastest way to make a town look
     cheap, so every house draws a small palette and a couple of trimmings
     from its own position — same level, different home. */
  const ROOFS = [0xa8402f, 0x3d5f8a, 0x3f6f45, 0xc06a2a, 0x6a4a7a, 0x8a6a2a, 0x2f6a6a];
  const DOORS = [0x5e4224, 0x2f4f6a, 0x6a2f2f, 0x3f5a3a, 0x4a3a5a];
  const TRIM = [COL.white, COL.plank, COL.thatch, 0xd8cfc0];

  BM.house = function (l, def, mask, variant) {
    const p = [];
    const v = (variant || 0) | 0;
    const w = 3.4, d = 3.4;
    const floors = Math.min(3, Math.ceil(l / 2));
    const fh = 1.7;
    const wallCol = l >= 4 ? COL.marble : (l >= 2 ? COL.plank : COL.wood);
    const roofCol = def && def.roof ? def.roof
      : (l >= 4 ? ROOFS[(v + 1) % ROOFS.length] : ROOFS[v % ROOFS.length]);
    const doorCol = DOORS[v % DOORS.length];
    const trimCol = TRIM[(v >> 2) % TRIM.length];
    const porch = (v & 1) === 1;

    // stone footing, slightly proud of the walls
    p.push({ g: P.box, c: COL.stoneDark, p: [0, 0.12, 0], s: [w + 0.35, 0.24, d + 0.35] });
    p.push({ g: P.box, c: COL.stone, p: [0, 0.26, 0], s: [w + 0.18, 0.1, d + 0.18] });

    for (let f = 0; f < floors; f++) {
      const y = 0.24 + f * fh;
      const fw = w - f * 0.22, fd = d - f * 0.22;
      p.push({ g: P.box, c: f % 2 && l >= 3 ? COL.plank : wallCol, p: [0, y + fh / 2, 0], s: [fw, fh, fd] });
      // corner beams + a painted band between floors
      if (l >= 2) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          p.push({ g: P.box, c: COL.woodDark, p: [sx * fw / 2, y + fh / 2, sz * fd / 2], s: [0.18, fh, 0.18] });
        }
        p.push({ g: P.box, c: trimCol, p: [0, y + 0.06, 0], s: [fw + 0.12, 0.14, fd + 0.12] });
      }
      const wy = y + fh * 0.58;
      windows(p, 0, wy, 0, fw, fd, f === 0 ? 2 : Math.min(3, 1 + l), true);
      // shutters and window boxes make the front read as a home
      if (l >= 2) {
        const step = fw / ((f === 0 ? 2 : Math.min(3, 1 + l)) + 1);
        for (let i = 1; i <= (f === 0 ? 2 : Math.min(3, 1 + l)); i++) {
          const x = -fw / 2 + step * i;
          for (const sx of [-1, 1]) {
            p.push({ g: P.box, c: trimCol, p: [x + sx * 0.42, wy, fd / 2 + 0.05], s: [0.2, 0.66, 0.05] });
          }
          if (l >= 3) {
            p.push({ g: P.box, c: COL.woodDark, p: [x, wy - 0.42, fd / 2 + 0.12], s: [0.7, 0.16, 0.24] });
            p.push({ g: P.ico, c: 0xd8506a, p: [x - 0.16, wy - 0.3, fd / 2 + 0.14], s: [0.18, 0.16, 0.16] });
            p.push({ g: P.ico, c: 0xf0c040, p: [x + 0.16, wy - 0.3, fd / 2 + 0.14], s: [0.16, 0.15, 0.15] });
          }
        }
      }
    }
    const top = 0.24 + floors * fh;
    gable(p, 0, top, 0, w + 0.5, d + 0.5, 1.0 + l * 0.14, roofCol);
    // eaves: a thin lip under the roof edge, and rafter ends poking out
    p.push({ g: P.box, c: COL.woodDark, p: [0, top - 0.04, 0], s: [w + 0.62, 0.1, d + 0.62] });
    for (let i = -2; i <= 2; i++) {
      p.push({ g: P.box, c: COL.woodDark, p: [i * 0.75, top + 0.02, d / 2 + 0.28], s: [0.1, 0.12, 0.34] });
    }
    door(p, 0, 0.24, d / 2 + 0.02, doorCol);
    // a step, and on some houses a little covered porch
    p.push({ g: P.box, c: COL.stone, p: [0, 0.3, d / 2 + 0.42], s: [1.2, 0.16, 0.6] });
    if (porch && l >= 2) {
      for (const sx of [-1, 1]) {
        p.push({ g: P.cyl6, c: COL.wood, p: [sx * 0.72, 1.0, d / 2 + 0.72], s: [0.14, 1.5, 0.14] });
      }
      p.push({ g: P.box, c: roofCol, p: [0, 1.78, d / 2 + 0.55], r: [-0.24, 0, 0], s: [1.9, 0.12, 1.1] });
    }
    if (l >= 3) {
      // chimney with a stone cap
      p.push({ g: P.box, c: COL.brick, p: [w * 0.32, top + 0.9, -d * 0.2], s: [0.45, 1.5, 0.45] });
      p.push({ g: P.box, c: COL.stoneDark, p: [w * 0.32, top + 1.68, -d * 0.2], s: [0.58, 0.12, 0.58] });
    }
    if (l >= 5) {
      p.push({ g: P.cone5, c: COL.gold, p: [0, top + 1.0 + l * 0.14, 0], s: [0.3, 0.6, 0.3] });
      for (const sx of [-1, 1]) p.push({ g: P.box, c: 0x4a7c3a, p: [sx * (w / 2 + 0.3), 0.5, d / 2 + 0.1], s: [0.5, 0.4, 0.5] });
    }
    return assemble(p);
  };

  BM.tavern = function (l) {
    const g = BM.house(l, { roof: COL.roofOrange });
    const p = [];
    p.push({ g: P.box, c: COL.woodDark, p: [2.1, 2.3, 1.9], s: [0.12, 0.12, 1.1] });
    p.push({ g: P.box, c: COL.plank, p: [2.1, 1.95, 2.4], s: [0.9, 0.62, 0.08] });
    p.push({ g: P.sph, c: 0xffc94d, glow: true, p: [2.1, 1.95, 2.46], s: [0.3, 0.3, 0.1] });
    const extra = assemble(p);
    while (extra.children.length) g.add(extra.children[0]);
    return g;
  };

  BM.school = function (l) {
    const g = BM.house(l, { roof: COL.roofGreen });
    const p = [];
    p.push({ g: P.box, c: COL.marble, p: [0, 0.24, 2.0], s: [2.4, 0.3, 0.9] });
    for (let i = -1; i <= 1; i++) p.push({ g: P.cyl, c: COL.marble, p: [i * 0.9, 1.1, 2.0], s: [0.24, 1.7, 0.24] });
    p.push({ g: P.box, c: COL.marble, p: [0, 2.0, 2.0], s: [2.5, 0.24, 1.0] });
    const extra = assemble(p);
    while (extra.children.length) g.add(extra.children[0]);
    return g;
  };

  BM.barn = function (l) {
    const p = [];
    const w = 4.4, d = 3.4, h = 2.2 + l * 0.16;
    p.push({ g: P.box, c: COL.stoneDark, p: [0, 0.1, 0], s: [w + 0.3, 0.2, d + 0.3] });
    p.push({ g: P.box, c: l >= 3 ? 0xb8402f : 0xa8402f, p: [0, 0.2 + h / 2, 0], s: [w, h, d] });
    // the white cross-braces every red barn wears, on the front and both ends
    for (let i = -1; i <= 1; i += 2) {
      p.push({ g: P.box, c: COL.white, p: [i * w * 0.3, 0.2 + h / 2, d / 2 + 0.02], r: [0, 0, 0.5], s: [0.14, h * 0.9, 0.06] });
      p.push({ g: P.box, c: COL.white, p: [i * w * 0.3, 0.2 + h / 2, d / 2 + 0.02], r: [0, 0, -0.5], s: [0.14, h * 0.9, 0.06] });
      p.push({ g: P.box, c: COL.white, p: [i * (w / 2 + 0.02), 0.2 + h / 2, 0], r: [0.5, 0, 0], s: [0.06, h * 0.9, 0.14] });
    }
    p.push({ g: P.box, c: COL.white, p: [0, 0.2 + h - 0.12, d / 2 + 0.03], s: [w * 0.98, 0.14, 0.06] });
    // split sliding doors on a rail
    for (const sx of [-1, 1]) {
      p.push({ g: P.box, c: COL.woodDark, p: [sx * 0.42, 0.2 + h * 0.42, d / 2 + 0.04], s: [0.82, h * 0.8, 0.08] });
    }
    p.push({ g: P.box, c: COL.iron, p: [0, 0.2 + h * 0.82, d / 2 + 0.09], s: [2.0, 0.09, 0.07] });
    gable(p, 0, 0.2 + h, 0, w + 0.35, d + 0.35, 1.3, 0x8a3325);
    // hay loft: door, hoist beam and a bale swinging under it
    p.push({ g: P.box, c: COL.thatch, p: [0, 0.2 + h + 0.6, d / 2 - 0.05], s: [0.8, 0.75, 0.1] });
    p.push({ g: P.box, c: COL.woodDark, p: [0, 0.2 + h + 1.05, d / 2 + 0.45], s: [0.14, 0.14, 1.0] });
    if (l >= 2) {
      p.push({ g: P.cyl6, c: 0xd8cfc0, p: [0, 0.2 + h + 0.72, d / 2 + 0.85], s: [0.05, 0.5, 0.05] });
      p.push({ g: P.box, c: COL.thatch, p: [0, 0.2 + h + 0.38, d / 2 + 0.85], r: [0, 0.3, 0], s: [0.5, 0.36, 0.5] });
    }
    if (l >= 3) {
      // weather vane on the ridge
      p.push({ g: P.cyl6, c: COL.iron, p: [-w * 0.3, 0.2 + h + 1.4, 0], s: [0.06, 0.7, 0.06] });
      p.push({ g: P.cone5, c: COL.gold, p: [-w * 0.3, 0.2 + h + 1.85, 0.22], r: [1.5708, 0, 0], s: [0.18, 0.4, 0.18] });
      p.push({ g: P.box, c: COL.gold, p: [-w * 0.3, 0.2 + h + 1.85, -0.16], s: [0.05, 0.22, 0.3] });
    }
    // paddock rails down the side, longer as the barn grows
    if (l >= 2) {
      const posts = Math.min(5, 2 + l);
      for (let i = 0; i < posts; i++) {
        const z = -d * 0.4 + i * (d * 0.9 / (posts - 1));
        p.push({ g: P.cyl6, c: COL.woodDark, p: [-w / 2 - 1.7, 0.45, z], s: [0.13, 0.9, 0.13] });
      }
      for (const y of [0.3, 0.62]) {
        p.push({ g: P.box, c: COL.wood, p: [-w / 2 - 1.7, y, 0], s: [0.1, 0.1, d * 0.95] });
      }
      p.push({ g: P.box, c: COL.woodDark, p: [-w * 0.62, 0.28, d * 0.42], s: [0.65, 0.36, 1.3] });   // trough
    }
    return assemble(p);
  };

  BM.coop = function (l) {
    const p = [];
    const w = 2.2, d = 2.0, h = 1.2 + l * 0.12;
    // raised on stilts, as a coop should be
    for (let i = 0; i < 4; i++) {
      p.push({ g: P.cyl4, c: COL.woodDark, p: [(i % 2 ? 1 : -1) * w * 0.42, 0.14, (i < 2 ? 1 : -1) * d * 0.42], s: [0.15, 0.4, 0.15] });
    }
    p.push({ g: P.box, c: COL.woodDark, p: [0, 0.32, 0], s: [w + 0.1, 0.12, d + 0.1] });
    p.push({ g: P.box, c: COL.wood, p: [0, 0.38 + h / 2, 0], s: [w, h, d] });
    // plank lines across the front so it is not one flat slab
    for (let i = 0; i < 3; i++) {
      p.push({ g: P.box, c: COL.woodDark, p: [0, 0.5 + i * (h / 3.2), d / 2 + 0.02], s: [w * 0.98, 0.05, 0.04] });
    }
    gable(p, 0, 0.38 + h, 0, w + 0.34, d + 0.34, 0.85, COL.roofRed);
    // pop-hole with a ramp, and a perch bar beside it
    p.push({ g: P.box, c: 0x1c1410, p: [0.35, 0.66, d / 2 + 0.03], s: [0.46, 0.55, 0.05] });
    p.push({ g: P.box, c: COL.woodDark, p: [0.35, 0.26, d / 2 + 0.62], r: [-0.5, 0, 0], s: [0.5, 0.06, 1.25] });
    for (let i = 0; i < 3; i++) {
      p.push({ g: P.box, c: COL.wood, p: [0.35, 0.3 + i * 0.16, d / 2 + 0.4 + i * 0.2], s: [0.5, 0.05, 0.05] });
    }
    p.push({ g: P.cyl6, c: COL.wood, p: [-w * 0.62, 0.9, d / 2 + 0.5], r: [0, 0, 1.5708], s: [0.06, 1.1, 0.06] });
    // nest boxes bolted to the side, with a lift-up lid
    p.push({ g: P.box, c: COL.plank, p: [-w / 2 - 0.32, 0.7, 0], s: [0.62, 0.55, d * 0.8] });
    p.push({ g: P.box, c: COL.roofRed, p: [-w / 2 - 0.36, 1.0, 0], r: [0, 0, -0.28], s: [0.78, 0.08, d * 0.86] });
    // a hen or two on the perch
    const hens = Math.min(3, l);
    for (let i = 0; i < hens; i++) {
      const x = -0.55 + i * 0.55;
      p.push({ g: P.ico, c: i % 2 ? COL.white : 0xd8cfc0, p: [x, 1.02, d / 2 + 0.5], s: [0.3, 0.3, 0.36] });
      p.push({ g: P.sph, c: i % 2 ? COL.white : 0xd8cfc0, p: [x, 1.2, d / 2 + 0.62], s: [0.18, 0.18, 0.18] });
      p.push({ g: P.cone5, c: 0xd23b32, p: [x, 1.32, d / 2 + 0.62], s: [0.1, 0.12, 0.1] });
      p.push({ g: P.cone5, c: 0xe8a33a, p: [x, 1.19, d / 2 + 0.74], r: [1.5708, 0, 0], s: [0.07, 0.12, 0.07] });
    }
    if (l >= 3) {
      // wire run alongside, with a feed bowl
      for (let i = 0; i < 4; i++) {
        p.push({ g: P.cyl4, c: COL.woodDark, p: [w * 0.55 + (i % 2) * 1.5, 0.45, -d * 0.4 + (i < 2 ? 0 : d * 0.8)], s: [0.1, 0.9, 0.1] });
      }
      p.push({ g: P.box, c: COL.wood, p: [w * 0.55 + 0.75, 0.86, 0], s: [1.7, 0.07, d * 0.85] });
      p.push({ g: P.cyl6, c: COL.stone, p: [w * 0.55 + 0.75, 0.12, 0], s: [0.45, 0.16, 0.45] });
      p.push({ g: P.cyl6, c: COL.thatch, p: [w * 0.55 + 0.75, 0.2, 0], s: [0.34, 0.1, 0.34] });
    }
    if (l >= 4) {
      p.push({ g: P.cone5, c: 0xd23b32, p: [0, 0.38 + h + 1.05, 0], s: [0.2, 0.34, 0.2] });
    }
    return assemble(p);
  };

  BM.shed = function (l) {
    const p = [];
    const w = 4.4, d = 3.4, h = 1.9 + l * 0.22;
    p.push({ g: P.box, c: COL.stoneDark, p: [0, 0.1, 0], s: [w + 0.3, 0.2, d + 0.3] });
    p.push({ g: P.box, c: l >= 3 ? COL.plank : COL.wood, p: [0, 0.2 + h / 2, 0], s: [w, h, d] });
    for (let i = 0; i < 4; i++) p.push({ g: P.box, c: COL.woodDark, p: [-w / 2 + 0.4 + i * (w / 3.4), 0.2 + h / 2, 0], s: [0.12, h, d + 0.04] });
    p.push({ g: P.box, c: COL.iron, p: [0, 0.2 + h * 0.45, d / 2 + 0.04], s: [1.8, h * 0.8, 0.08] });
    gable(p, 0, 0.2 + h, 0, w + 0.3, d + 0.3, 0.9, COL.stoneDark);
    for (let i = 0; i < Math.min(l, 4); i++) {
      p.push({ g: P.box, c: COL.thatch, p: [w / 2 + 0.7, 0.35 + i * 0.55, -d * 0.2 + (i % 2) * 0.6], r: [0, i * 0.4, 0], s: [0.9, 0.5, 0.9] });
    }
    return assemble(p);
  };

  BM.workshop = function (l) {
    const g = BM.shed(l);
    const p = [];
    p.push({ g: P.box, c: COL.brick, p: [-1.6, 3.0, -1.0], s: [0.5, 1.6, 0.5] });
    p.push({ g: P.cyl, c: COL.iron, p: [1.6, 1.0, 2.0], s: [0.9, 0.16, 0.9] });
    p.push({ g: P.box, c: COL.woodDark, p: [1.6, 0.5, 2.0], s: [0.14, 1.0, 0.14] });
    p.push({ g: P.box, c: COL.iron, p: [1.2, 1.2, 2.0], r: [0, 0, 0.4], s: [0.7, 0.1, 0.14] });
    const e = assemble(p); while (e.children.length) g.add(e.children[0]);
    return g;
  };

  BM.silo = function (l) {
    const p = [];
    const h = 3.0 + l * 0.65, r = 1.15;
    p.push({ g: P.cyl, c: COL.stoneDark, p: [0, 0.12, 0], s: [r * 2.4, 0.24, r * 2.4] });
    p.push({ g: P.cyl, c: l >= 3 ? COL.iron : 0xb8b2a4, p: [0, 0.24 + h / 2, 0], s: [r * 2, h, r * 2] });
    for (let i = 0; i < 4; i++) p.push({ g: P.cyl, c: 0x8e887a, p: [0, 0.5 + i * (h / 4), 0], s: [r * 2.08, 0.1, r * 2.08] });
    p.push({ g: P.cone, c: COL.roofRed, p: [0, 0.24 + h + 0.5, 0], s: [r * 2.3, 1.1, r * 2.3] });
    p.push({ g: P.box, c: COL.woodDark, p: [0, 0.8, r * 2 * 0.5], s: [0.6, 1.1, 0.1] });
    for (let i = 0; i < 6; i++) p.push({ g: P.box, c: COL.iron, p: [r * 1.05, 0.4 + i * 0.55, 0], s: [0.5, 0.07, 0.07] });
    return assemble(p);
  };

  BM.well = function (l) {
    const p = [];
    p.push({ g: P.cyl, c: COL.stone, p: [0, 0.42, 0], s: [1.7, 0.84, 1.7] });
    p.push({ g: P.cyl, c: 0x2a4a6a, p: [0, 0.78, 0], s: [1.4, 0.1, 1.4] });
    for (const sx of [-1, 1]) p.push({ g: P.cyl6, c: COL.wood, p: [sx * 0.7, 1.35, 0], s: [0.16, 1.9, 0.16] });
    p.push({ g: P.cyl, c: COL.woodDark, p: [0, 2.05, 0], r: [0, 0, Math.PI / 2], s: [0.14, 1.6, 0.14] });
    gable(p, 0, 2.15, 0, 2.0, 1.6, 0.55, l >= 2 ? COL.roofBlue : COL.thatch);
    p.push({ g: P.box, c: COL.woodDark, p: [0, 1.5, 0], s: [0.35, 0.4, 0.35] });
    if (l >= 3) {
      p.push({ g: P.cyl, c: COL.stone, p: [1.6, 0.2, 1.6], s: [0.9, 0.4, 0.9] });
      p.push({ g: P.cyl, c: 0x3a7fa8, p: [1.6, 0.42, 1.6], s: [0.78, 0.05, 0.78] });
    }
    return assemble(p);
  };

  BM.fountain = function (l) {
    const p = [];
    p.push({ g: P.cyl, c: COL.marble, p: [0, 0.28, 0], s: [2.7, 0.56, 2.7] });
    p.push({ g: P.cyl, c: 0x3a8fc8, p: [0, 0.5, 0], s: [2.35, 0.14, 2.35] });
    p.push({ g: P.cyl, c: COL.marble, p: [0, 0.85, 0], s: [0.55, 0.9, 0.55] });
    p.push({ g: P.cyl, c: COL.marble, p: [0, 1.3, 0], s: [1.35, 0.16, 1.35] });
    if (l >= 2) {
      p.push({ g: P.cyl, c: COL.marble, p: [0, 1.7, 0], s: [0.34, 0.7, 0.34] });
      p.push({ g: P.cyl, c: COL.marble, p: [0, 2.0, 0], s: [0.8, 0.13, 0.8] });
    }
    if (l >= 3) p.push({ g: P.sph, c: COL.gold, p: [0, 2.3, 0], s: [0.45, 0.45, 0.45] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.283;
      p.push({ g: P.box, c: 0x9fd8e8, glow: true, p: [Math.cos(a) * 0.75, 1.15, Math.sin(a) * 0.75], r: [0, -a, 0.6], s: [0.7, 0.06, 0.06] });
    }
    return assemble(p);
  };

  BM.mill = function (l) {
    const g = new THREE.Group();
    const p = [];
    const h = 3.4 + l * 0.35;
    p.push({ g: P.taper(0.78, 1, 8), c: l >= 3 ? COL.marble : COL.stone, p: [0, h / 2, 0], s: [3.0, h, 3.0] });
    p.push({ g: P.cyl, c: COL.stoneDark, p: [0, 0.14, 0], s: [3.4, 0.28, 3.4] });
    p.push({ g: P.cone, c: COL.roofRed, p: [0, h + 0.55, 0], s: [2.9, 1.3, 2.9] });
    p.push({ g: P.box, c: COL.woodDark, p: [0, 0.75, 1.2], s: [0.8, 1.4, 0.1] });
    windows(p, 0, h * 0.62, 0, 1.6, 2.2, 1, true);
    const shell = assemble(p);
    while (shell.children.length) g.add(shell.children[0]);

    // rotating blades
    const bp = [];
    bp.push({ g: P.cyl, c: COL.iron, p: [0, 0, 0], r: [0, 0, Math.PI / 2], s: [0.3, 0.5, 0.3] });
    const blades = 4;
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * 6.283;
      bp.push({ g: P.box, c: COL.wood, p: [0, Math.cos(a) * 1.6, Math.sin(a) * 1.6], r: [-a, 0, 0], s: [0.14, 3.0, 0.24] });
      bp.push({ g: P.box, c: COL.cloth, p: [0, Math.cos(a) * 1.9, Math.sin(a) * 1.9], r: [-a, 0, 0], s: [0.06, 2.2, 0.75] });
    }
    const spin = assemble(bp);
    spin.position.set(0, h * 0.78, 1.6);
    g.add(spin);
    g.userData.spin = spin;
    return g;
  };

  BM.smelter = function (l) {
    const p = [];
    p.push({ g: P.box, c: COL.stoneDark, p: [0, 0.12, 0], s: [3.0, 0.24, 3.0] });
    p.push({ g: P.box, c: COL.brick, p: [0, 1.0, 0], s: [2.4, 1.8, 2.4] });
    p.push({ g: P.taper(0.5, 0.9, 6), c: COL.brick, p: [0, 2.4, 0], s: [1.9, 1.2, 1.9] });
    p.push({ g: P.cyl, c: 0x6a4436, p: [0, 3.4 + l * 0.16, 0], s: [0.85, 1.4 + l * 0.3, 0.85] });
    p.push({ g: P.box, c: 0xff7a1a, glow: true, p: [0, 0.75, 1.22], s: [1.1, 0.85, 0.06] });
    p.push({ g: P.box, c: COL.iron, p: [0, 0.75, 1.28], s: [1.3, 0.14, 0.06] });
    for (const sx of [-1, 1]) p.push({ g: P.box, c: COL.iron, p: [sx * 1.3, 0.8, 0], s: [0.14, 1.5, 1.6] });
    if (l >= 3) { p.push({ g: P.cyl, c: COL.iron, p: [1.7, 0.6, 1.3], s: [0.6, 1.1, 0.6] }); }
    if (l >= 4) { p.push({ g: P.box, c: COL.gold, p: [0, 2.0, 1.25], s: [0.5, 0.3, 0.1] }); }
    return assemble(p);
  };

  BM.mine = function (l) {
    const p = [];
    p.push({ g: P.box, c: COL.stoneDark, p: [0, 0.9, -0.8], s: [3.6, 1.8, 2.2] });
    p.push({ g: P.box, c: 0x14100e, glow: false, p: [0, 0.85, 0.4], s: [1.7, 1.7, 0.4] });
    for (const sx of [-1, 1]) p.push({ g: P.box, c: COL.wood, p: [sx * 1.0, 0.95, 0.45], s: [0.28, 1.9, 0.34] });
    p.push({ g: P.box, c: COL.wood, p: [0, 1.95, 0.45], s: [2.4, 0.3, 0.34] });
    p.push({ g: P.box, c: COL.woodDark, p: [0, 2.2, 0.45], s: [1.4, 0.24, 0.2] });
    // rails + cart
    for (let i = 0; i < 4; i++) p.push({ g: P.box, c: COL.woodDark, p: [0, 0.08, 0.9 + i * 0.55], s: [1.5, 0.1, 0.16] });
    for (const sx of [-1, 1]) p.push({ g: P.box, c: COL.iron, p: [sx * 0.5, 0.16, 1.7], s: [0.09, 0.08, 2.2] });
    if (l >= 2) {
      p.push({ g: P.box, c: 0x5a5a5a, p: [0, 0.45, 2.2], s: [1.0, 0.6, 1.0] });
      p.push({ g: P.ico, c: 0x3a3a3a, p: [0, 0.8, 2.2], s: [0.7, 0.4, 0.7] });
      for (const sx of [-1, 1]) p.push({ g: P.cyl, c: COL.iron, p: [sx * 0.5, 0.2, 2.2], r: [0, 0, Math.PI / 2], s: [0.34, 0.12, 0.34] });
    }
    if (l >= 3) {
      p.push({ g: P.cyl6, c: COL.wood, p: [-2.0, 1.4, 1.0], s: [0.2, 2.8, 0.2] });
      p.push({ g: P.sph, c: 0xffc94d, glow: true, p: [-2.0, 2.7, 1.0], s: [0.32, 0.32, 0.32] });
    }
    return assemble(p);
  };

  BM.quarry = function (l) {
    const p = [];
    p.push({ g: P.box, c: COL.stoneDark, p: [0, 0.12, 0], s: [4.0, 0.24, 4.0] });
    for (let i = 0; i < 4 + l; i++) {
      const a = (i / (4 + l)) * 6.283;
      p.push({
        g: P.ico, c: i % 2 ? COL.stone : COL.stoneDark,
        p: [Math.cos(a) * 1.3, 0.4 + (i % 3) * 0.25, Math.sin(a) * 1.3],
        r: [a, a * 2, a], s: [0.9, 0.7, 0.9]
      });
    }
    p.push({ g: P.box, c: COL.wood, p: [0, 1.3, -1.4], s: [2.6, 0.16, 1.4] });
    for (const sx of [-1, 1]) p.push({ g: P.cyl6, c: COL.wood, p: [sx * 1.1, 0.7, -1.4], s: [0.2, 1.4, 0.2] });
    p.push({ g: P.box, c: COL.iron, p: [0, 1.7, -1.4], r: [0.4, 0, 0], s: [1.6, 0.1, 1.2] });
    if (l >= 3) p.push({ g: P.box, c: COL.brick, p: [1.6, 0.5, 1.6], s: [1.0, 0.8, 1.0] });
    return assemble(p);
  };

  BM.sawmill = function (l) {
    const g = new THREE.Group();
    const p = [];
    p.push({ g: P.box, c: COL.stoneDark, p: [0, 0.12, 0], s: [4.0, 0.24, 3.4] });
    p.push({ g: P.box, c: COL.wood, p: [0, 1.0, -1.0], s: [3.4, 1.7, 1.3] });
    gable(p, 0, 1.85, -1.0, 3.7, 1.6, 0.7, COL.roofGreen);
    for (const sx of [-1, 1]) p.push({ g: P.cyl6, c: COL.woodDark, p: [sx * 1.6, 0.7, 1.2], s: [0.22, 1.2, 0.22] });
    p.push({ g: P.box, c: COL.plank, p: [0, 1.3, 1.2], s: [3.6, 0.16, 1.3] });
    for (let i = 0; i < 3 + l; i++) {
      p.push({ g: P.cyl, c: COL.wood, p: [-1.4 + (i % 3) * 1.2, 0.42 + Math.floor(i / 3) * 0.5, 1.8], r: [0, 0, Math.PI / 2], s: [0.45, 1.0, 0.45] });
    }
    g.add(assemble(p).children[0]);

    const bp = [{ g: P.cyl, c: 0xcfcfcf, p: [0, 0, 0], r: [Math.PI / 2, 0, 0], s: [1.5, 0.06, 1.5] }];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.283;
      bp.push({ g: P.box, c: 0xe8e8e8, p: [Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0], r: [0, 0, a], s: [0.16, 0.16, 0.05] });
    }
    const saw = assemble(bp, true);
    saw.position.set(0, 1.55, 1.2);
    g.add(saw);
    g.userData.spin = saw;
    g.userData.spinAxis = 'z';
    return g;
  };

  BM.shop = function (l) {
    const p = [];
    const w = 3.4, d = 2.4, h = 2.0 + l * 0.14;
    p.push({ g: P.box, c: COL.stoneDark, p: [0, 0.1, 0], s: [w + 0.3, 0.2, d + 0.3] });
    p.push({ g: P.box, c: l >= 3 ? COL.marble : COL.plank, p: [0, 0.2 + h / 2, -0.2], s: [w, h, d * 0.8] });
    gable(p, 0, 0.2 + h, -0.2, w + 0.3, d * 0.9, 0.75, COL.roofBlue);
    // striped awning
    const stripes = 6;
    for (let i = 0; i < stripes; i++) {
      p.push({
        g: P.box, c: i % 2 ? COL.red : COL.white,
        p: [-w / 2 + (i + 0.5) * (w / stripes), 1.72, 0.85], r: [-0.42, 0, 0], s: [w / stripes, 0.07, 1.4]
      });
    }
    for (const sx of [-1, 1]) p.push({ g: P.cyl6, c: COL.woodDark, p: [sx * (w / 2 - 0.15), 0.75, 1.35], s: [0.13, 1.5, 0.13] });
    p.push({ g: P.box, c: COL.wood, p: [0, 1.0, 0.9], s: [w * 0.85, 0.16, 0.7] });
    for (let i = 0; i < 3; i++) {
      p.push({ g: P.ico, c: [0xd23b32, 0xe08a25, 0x7b4bab][i], p: [-0.9 + i * 0.9, 1.18, 0.9], s: [0.3, 0.28, 0.3] });
    }
    if (l >= 2) { p.push({ g: P.box, c: COL.gold, p: [0, 2.35, 0.62], s: [1.6, 0.4, 0.08] }); }
    if (l >= 4) for (const sx of [-1, 1]) {
      p.push({ g: P.cyl6, c: COL.woodDark, p: [sx * 2.2, 0.9, 1.0], s: [0.14, 1.8, 0.14] });
      p.push({ g: P.sph, c: COL.glassLit, glow: true, p: [sx * 2.2, 1.85, 1.0], s: [0.28, 0.28, 0.28] });
    }
    return assemble(p);
  };

  BM.bakery = function (l) {
    const g = BM.shop(l);
    const p = [];
    p.push({ g: P.box, c: COL.brick, p: [-1.3, 3.0, -0.9], s: [0.5, 1.4, 0.5] });
    p.push({ g: P.cyl, c: 0x6a6a6a, p: [-1.3, 3.75, -0.9], s: [0.6, 0.2, 0.6] });
    const e = assemble(p); while (e.children.length) g.add(e.children[0]);
    return g;
  };

  BM.hall = function (l) {
    const p = [];
    const w = 5.2, d = 4.2, h = 2.6 + l * 0.3;
    p.push({ g: P.box, c: COL.marble, p: [0, 0.2, 0], s: [w + 1.0, 0.4, d + 1.0] });
    p.push({ g: P.box, c: COL.marble, p: [0, 0.1, d / 2 + 0.9], s: [3.0, 0.2, 1.2] });
    p.push({ g: P.box, c: l >= 3 ? COL.marble : COL.stone, p: [0, 0.4 + h / 2, 0], s: [w, h, d] });
    // colonnade
    const cols = 4 + Math.min(2, l - 1);
    for (let i = 0; i < cols; i++) {
      const x = -w / 2 + (i + 0.5) * (w / cols);
      p.push({ g: P.cyl, c: COL.marble, p: [x, 0.4 + h / 2, d / 2 + 0.45], s: [0.4, h, 0.4] });
    }
    p.push({ g: P.box, c: COL.marble, p: [0, 0.4 + h + 0.16, d / 2 + 0.45], s: [w + 0.2, 0.32, 1.0] });
    windows(p, 0, 0.4 + h * 0.6, 0, w, d, 3, true);
    door(p, 0, 0.4, d / 2 + 0.03, COL.woodDark);
    gable(p, 0, 0.4 + h, 0, w + 0.8, d + 1.2, 1.2 + l * 0.15, l >= 4 ? COL.roofBlue : COL.roofRed);
    // clock tower
    if (l >= 2) {
      const th = 2.2 + l * 0.5;
      p.push({ g: P.box, c: COL.marble, p: [w * 0.32, 0.4 + h + th / 2, -d * 0.15], s: [1.5, th, 1.5] });
      p.push({ g: P.cyl, c: COL.white, p: [w * 0.32, 0.4 + h + th * 0.75, -d * 0.15 + 0.78], r: [Math.PI / 2, 0, 0], s: [0.9, 0.08, 0.9] });
      p.push({ g: P.box, c: COL.black, p: [w * 0.32, 0.4 + h + th * 0.75, -d * 0.15 + 0.84], r: [0, 0, 0.6], s: [0.06, 0.55, 0.04] });
      pyramid(p, w * 0.32, 0.4 + h + th, -d * 0.15, 1.9, 1.9, 1.2, COL.roofBlue);
      if (l >= 4) p.push({ g: P.sph, c: COL.gold, p: [w * 0.32, 0.4 + h + th + 1.35, -d * 0.15], s: [0.35, 0.35, 0.35] });
    }
    if (l >= 3) {
      for (const sx of [-1, 1]) {
        p.push({ g: P.cyl6, c: COL.wood, p: [sx * (w / 2 + 1.1), 1.6, d / 2 + 1.0], s: [0.16, 3.2, 0.16] });
        p.push({ g: P.box, c: 0x2f7a4a, p: [sx * (w / 2 + 1.1) + sx * 0.5, 2.9, d / 2 + 1.0], s: [1.0, 0.7, 0.06] });
      }
    }
    return assemble(p);
  };

  BM.tower = function (l) {
    const g = new THREE.Group();
    const p = [];
    const h = 3.4 + l * 0.75;
    p.push({ g: P.box, c: COL.stoneDark, p: [0, 0.16, 0], s: [2.6, 0.32, 2.6] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      p.push({ g: P.cyl6, c: COL.wood, p: [sx * 0.85, h / 2, sz * 0.85], r: [sz * 0.05, 0, -sx * 0.05], s: [0.24, h, 0.24] });
    }
    for (let i = 1; i <= 3; i++) {
      const y = h * (i / 4);
      for (const sx of [-1, 1]) {
        p.push({ g: P.box, c: COL.woodDark, p: [sx * 0.85, y, 0], s: [0.1, 0.1, 1.75] });
        p.push({ g: P.box, c: COL.woodDark, p: [0, y, sx * 0.85], s: [1.75, 0.1, 0.1] });
      }
    }
    p.push({ g: P.box, c: COL.plank, p: [0, h + 0.1, 0], s: [2.6, 0.2, 2.6] });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      p.push({ g: P.box, c: l >= 3 ? COL.stone : COL.wood, p: [Math.cos(a) * 1.2, h + 0.55, Math.sin(a) * 1.2], r: [0, -a, 0], s: [0.16, 0.75, 2.6] });
    }
    pyramid(p, 0, h + 0.9, 0, 3.2, 3.2, 1.1 + l * 0.1, COL.roofRed);
    if (l >= 2) { p.push({ g: P.box, c: 0xffc94d, glow: true, p: [0, h + 0.45, 0], s: [0.5, 0.14, 0.5] }); }
    if (l >= 4) for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.78;
      p.push({ g: P.box, c: COL.iron, p: [Math.cos(a) * 1.35, h + 1.0, Math.sin(a) * 1.35], r: [0, -a, 0.5], s: [0.9, 0.1, 0.1] });
    }
    const body = assemble(p);
    while (body.children.length) g.add(body.children[0]);
    g.userData.top = h + 0.6;
    return g;
  };

  /* ---------------------------------------------------------
     Defensive pieces are neighbour-aware. Each one fills a whole
     grid cell and grows an arm toward every adjacent wall piece,
     so a run of them meets edge-to-edge with no seam and corners
     turn properly. `mask` bits: 1=+X 2=-X 4=+Z 8=-Z.
     --------------------------------------------------------- */
  const CELL_HALF = C.WORLD.gridSize / 2;      // arm length: centre -> cell edge

  function armDirs(mask) {
    if (!mask) mask = 3;                        // lone piece reads as an east-west run
    const out = [];
    if (mask & 1) out.push([1, 0]);
    if (mask & 2) out.push([-1, 0]);
    if (mask & 4) out.push([0, 1]);
    if (mask & 8) out.push([0, -1]);
    return out;
  }

  /* --------------------------------------------------------
     The last two upgrades change what a wall is *made of*, not just how
     tall it stands. One below the top it is grown from crystal — pale
     blue, faceted, lit from inside. At the top it is bone: a rib cage of
     a wall with skulls set into the pillars. You should be able to tell
     how far a city has come from the other side of the valley.
     -------------------------------------------------------- */
  const SKIN = {
    bone: { main: 0xe8e4d4, dark: 0xbdb49c, trim: 0x2e2a24, glow: 0xff5a3a },
    gem: { main: 0x9fe8ff, dark: 0x3f9ec4, trim: 0xdcecf4, glow: 0x9fe8ff }
  };
  /** which material a defensive piece is at this level: null | 'gem' | 'bone' */
  function wallTier(l, max) {
    if (l >= max) return 'bone';
    if (l >= max - 1) return 'gem';
    return null;
  }
  M.wallTier = wallTier;

  /** a skull, facing +Z, sized to fit a wall pillar */
  function skullParts(p, x, y, z, s, col) {
    const c = col === undefined ? SKIN.bone.main : col;
    p.push({ g: P.ico, c: c, p: [x, y, z], s: [0.62 * s, 0.6 * s, 0.58 * s] });
    p.push({ g: P.box, c: c, p: [x, y - 0.24 * s, z + 0.16 * s], s: [0.34 * s, 0.24 * s, 0.3 * s] });
    for (const sx of [-1, 1]) {
      p.push({ g: P.box, c: SKIN.bone.trim, glow: false, p: [x + sx * 0.15 * s, y + 0.06 * s, z + 0.26 * s], s: [0.17 * s, 0.19 * s, 0.1 * s] });
      p.push({ g: P.ico, c: SKIN.bone.glow, glow: true, p: [x + sx * 0.15 * s, y + 0.06 * s, z + 0.29 * s], s: [0.1 * s, 0.11 * s, 0.06 * s] });
    }
    for (let i = -1; i <= 1; i++) {
      p.push({ g: P.box, c: SKIN.bone.trim, p: [x + i * 0.11 * s, y - 0.3 * s, z + 0.28 * s], s: [0.06 * s, 0.12 * s, 0.05 * s] });
    }
  }
  /** a curved rib, springing from a spine at (x,y,z) */
  function ribParts(p, x, y, z, dirX, dirZ, s, col) {
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      p.push({
        g: P.box, c: col,
        p: [x + dirX * (0.2 + t * 0.5) * s, y + (0.35 + t * 0.55) * s, z + dirZ * (0.2 + t * 0.5) * s],
        r: [dirZ * (0.5 - t * 0.9), 0, -dirX * (0.5 - t * 0.9)],
        s: [0.16 * s, 0.42 * s, 0.16 * s]
      });
    }
  }
  /** a cluster of crystal shards */
  function shardParts(p, x, y, z, s, n, seed) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + (seed || 0);
      const r = 0.16 + (i % 3) * 0.09;
      p.push({
        g: P.cone5, c: i % 2 ? SKIN.gem.main : SKIN.gem.dark, glow: i % 2 === 0,
        p: [x + Math.cos(a) * r * s, y + (0.25 + (i % 3) * 0.14) * s, z + Math.sin(a) * r * s],
        r: [Math.sin(a) * 0.3, a, -Math.cos(a) * 0.3],
        s: [0.2 * s, (0.5 + (i % 3) * 0.24) * s, 0.2 * s]
      });
    }
  }

  BM.fence = function (l, def, mask) {
    const p = [];
    const tier = wallTier(l, (def && def.max) || 3);
    if (tier) return boneOrGemFence(l, tier, mask);
    const col = l >= 3 ? COL.plank : (l >= 2 ? COL.wood : COL.woodDark);
    const H = 1.24, L = CELL_HALF;
    // centre post
    p.push({ g: P.box, c: col, p: [0, H / 2, 0], s: [0.26, H, 0.26] });
    for (const d of armDirs(mask)) {
      const cx = d[0] * L / 2, cz = d[1] * L / 2;
      const sx = d[0] ? L : 0.13, sz = d[1] ? L : 0.13;
      for (const y of [0.92, 0.55]) p.push({ g: P.box, c: col, p: [cx, y, cz], s: [sx, 0.14, sz] });
      if (l >= 2) {
        p.push({
          g: P.box, c: col, p: [cx, 0.74, cz],
          r: d[0] ? [0, 0, 0.5] : [0.5, 0, 0],
          s: d[0] ? [L * 0.95, 0.09, 0.09] : [0.09, 0.09, L * 0.95]
        });
      }
    }
    if (l >= 3) p.push({ g: P.cone5, c: COL.woodDark, p: [0, H + 0.16, 0], s: [0.32, 0.3, 0.32] });
    return assemble(p);
  };

  /** the top two grades of palisade: a rib fence, or a crystal one */
  function boneOrGemFence(l, tier, mask) {
    const p = [];
    const S = tier === 'bone' ? SKIN.bone : SKIN.gem;
    const H = 1.55, L = CELL_HALF;
    p.push({ g: P.box, c: S.dark, p: [0, 0.1, 0], s: [0.5, 0.2, 0.5] });
    p.push({ g: P.cyl6, c: S.main, p: [0, H / 2, 0], s: [0.3, H, 0.3] });
    if (tier === 'bone') skullParts(p, 0, H + 0.24, 0, 0.85);
    else shardParts(p, 0, H - 0.1, 0, 1.1, 5, 0.4);
    for (const d of armDirs(mask)) {
      const cx = d[0] * L / 2, cz = d[1] * L / 2;
      const sx = d[0] ? L : 0.16, sz = d[1] ? L : 0.16;
      // the spine
      p.push({ g: P.box, c: S.main, p: [cx, 0.95, cz], s: [sx, 0.18, sz] });
      p.push({ g: P.box, c: S.dark, p: [cx, 0.5, cz], s: [sx, 0.12, sz] });
      if (tier === 'bone') {
        for (const t of [0.45, 0.9]) {
          ribParts(p, d[0] * t, 0.55, d[1] * t, d[1], -d[0], 0.62, S.main);
          ribParts(p, d[0] * t, 0.55, d[1] * t, -d[1], d[0], 0.62, S.main);
        }
      } else {
        for (const t of [0.4, 0.85]) shardParts(p, d[0] * t, 0.8, d[1] * t, 0.7, 3, t * 3);
      }
    }
    return assemble(p);
  }

  /** the top two grades of curtain wall */
  function boneOrGemWall(l, tier, mask) {
    const p = [];
    const S = tier === 'bone' ? SKIN.bone : SKIN.gem;
    const h = 1.5 + l * 0.45, T = 0.82, L = CELL_HALF;
    p.push({ g: P.box, c: S.main, p: [0, h / 2, 0], s: [T, h, T] });
    p.push({ g: P.box, c: S.dark, p: [0, h + 0.18, 0], s: [T * 1.06, 0.36, T * 1.06] });
    if (tier === 'bone') {
      skullParts(p, 0, h + 0.72, 0, 1.15);
      for (const sx of [-1, 1]) {
        p.push({ g: P.cone5, c: S.main, p: [sx * 0.42, h + 0.95, -0.1], r: [-0.3, 0, sx * 0.55], s: [0.2, 0.75, 0.2] });
      }
    } else {
      shardParts(p, 0, h + 0.3, 0, 1.5, 6, 0.7);
    }
    for (const d of armDirs(mask)) {
      const cx = d[0] * L / 2, cz = d[1] * L / 2;
      const sx = d[0] ? L : T, sz = d[1] ? L : T;
      p.push({ g: P.box, c: S.main, p: [cx, h / 2, cz], s: [sx, h, sz] });
      // banded courses
      for (let i = 0; i < 3; i++) {
        p.push({
          g: P.box, c: i % 2 ? S.dark : S.main,
          p: [cx, h * (0.22 + i * 0.26), cz],
          s: [d[0] ? L * 0.98 : T * 1.05, 0.2, d[1] ? L * 0.98 : T * 1.05]
        });
      }
      if (tier === 'bone') {
        // a rib cage rising out of the parapet
        for (const t of [0.35, 0.75]) {
          for (const s2 of [-1, 1]) {
            ribParts(p, d[0] * t, h - 0.5, d[1] * t, d[1] * s2, -d[0] * s2, 0.7, S.main);
          }
        }
        for (let i = 0; i < 2; i++) {
          const t = 0.3 + i * 0.45;
          p.push({
            g: P.cone5, c: S.main, p: [d[0] * t, h + 0.45, d[1] * t],
            s: [0.26, 0.7, 0.26]
          });
        }
      } else {
        for (let i = 0; i < 2; i++) {
          const t = 0.3 + i * 0.45;
          shardParts(p, d[0] * t, h - 0.05, d[1] * t, 0.95, 4, t * 4);
        }
        // a vein of light running along the course
        p.push({ g: P.box, c: S.glow, glow: true, p: [cx, h * 0.62, cz], s: [d[0] ? L * 0.9 : T * 1.07, 0.09, d[1] ? L * 0.9 : T * 1.07] });
      }
    }
    return assemble(p);
  }

  BM.wall = function (l, def, mask) {
    const tier = wallTier(l, (def && def.max) || 3);
    if (tier) return boneOrGemWall(l, tier, mask);
    const p = [];
    const h = 1.5 + l * 0.35, T = 0.78, L = CELL_HALF;
    // centre pillar keeps corners solid
    p.push({ g: P.box, c: COL.stone, p: [0, h / 2, 0], s: [T, h, T] });
    p.push({ g: P.box, c: COL.stoneDark, p: [0, h + 0.16, 0], s: [T * 1.04, 0.32, T * 1.04] });
    for (const d of armDirs(mask)) {
      const cx = d[0] * L / 2, cz = d[1] * L / 2;
      const sx = d[0] ? L : T, sz = d[1] ? L : T;
      p.push({ g: P.box, c: COL.stone, p: [cx, h / 2, cz], s: [sx, h, sz] });
      // stone courses for texture
      for (let i = 0; i < 2; i++) {
        const t = 0.28 + i * 0.44;
        p.push({
          g: P.box, c: i % 2 ? COL.stoneDark : COL.stone,
          p: [d[0] * t, h * 0.3 + i * 0.3, d[1] * t],
          s: [d[0] ? 0.36 : T * 1.03, 0.28, d[1] ? 0.36 : T * 1.03]
        });
      }
      // crenellations along the arm
      for (let i = 0; i < 2; i++) {
        const t = 0.3 + i * 0.45;
        p.push({
          g: P.box, c: COL.stoneDark,
          p: [d[0] * t, h + 0.16, d[1] * t],
          s: [d[0] ? 0.34 : T * 1.05, 0.32, d[1] ? 0.34 : T * 1.05]
        });
      }
      if (l >= 3) p.push({ g: P.box, c: COL.iron, p: [cx, h + 0.02, cz], s: [sx, 0.1, sz] });
    }
    return assemble(p);
  };

  /* =========================================================
     THE CITY GATE
     Two towers, a battlemented arch across the top, and two leaves on
     real hinges. The leaves come back as their own groups so building.js
     can swing them — everything else is merged as usual.
     The footprint runs along X; building.js turns the whole thing to face
     whichever way the wall runs.
     ========================================================= */
  BM.gatehouse = function (l, def) {
    const max = (def && def.max) || 3;
    const tier = wallTier(l, max);
    const S = tier === 'bone' ? SKIN.bone : tier === 'gem' ? SKIN.gem : null;
    const stone = S ? S.main : COL.stone;
    const dark = S ? S.dark : COL.stoneDark;
    const timber = S ? S.dark : COL.woodDark;
    const band = S ? S.trim : COL.wood;
    const metal = S ? S.trim : COL.iron;

    const g = new THREE.Group();
    const p = [];
    /* the opening is 4 wide; towers stand either side of it */
    const HALF = 2.0;                 // half the footprint along the wall
    const OPEN = 1.5;                 // half the doorway
    const TW = HALF - OPEN;           // tower width
    const th = 5.4 + l * 1.1;         // tower height
    const dz = 1.35;                  // how deep the gatehouse is

    for (const sx of [-1, 1]) {
      const cx = sx * (OPEN + TW / 2);
      // tower shaft
      p.push({ g: P.box, c: stone, p: [cx, th / 2, 0], s: [TW, th, dz * 2] });
      p.push({ g: P.box, c: dark, p: [cx, 0.35, 0], s: [TW * 1.18, 0.7, dz * 2.2] });
      // courses
      for (let i = 0; i < 4; i++) {
        p.push({ g: P.box, c: i % 2 ? dark : stone, p: [cx, 1.1 + i * 1.15, 0], s: [TW * 1.05, 0.34, dz * 2.05] });
      }
      // corbelled head and crenellations
      p.push({ g: P.box, c: dark, p: [cx, th + 0.3, 0], s: [TW * 1.35, 0.6, dz * 2.4] });
      for (let i = 0; i < 3; i++) {
        for (const sz of [-1, 1]) {
          p.push({
            g: P.box, c: stone,
            p: [cx + (i - 1) * TW * 0.34, th + 0.95, sz * (dz * 1.05)],
            s: [TW * 0.28, 0.7, 0.32]
          });
        }
      }
      // arrow slits, lit from within
      for (const sz of [-1, 1]) {
        for (const y of [2.4, 4.0]) {
          p.push({ g: P.box, c: metal, p: [cx, y, sz * (dz + 0.03)], s: [0.2, 0.95, 0.08] });
          p.push({ g: P.box, c: S ? S.glow : 0xffdd88, glow: true, p: [cx, y, sz * (dz + 0.07)], s: [0.11, 0.72, 0.05] });
        }
      }
      // a banner down the face
      p.push({ g: P.box, c: sx > 0 ? 0x9e2b2b : 0x2f4a7a, p: [cx, th * 0.55, dz + 0.09], s: [TW * 0.5, th * 0.5, 0.05] });
      p.push({ g: P.box, c: band, p: [cx, th * 0.8 + 0.1, dz + 0.12], s: [TW * 0.55, 0.14, 0.06] });
      if (tier === 'bone') {
        skullParts(p, cx, th + 1.6, dz * 0.4, 1.5);
        for (const sz of [-1, 1]) ribParts(p, cx, th * 0.35, sz * dz, 0, sz, 1.1, stone);
      } else if (tier === 'gem') {
        shardParts(p, cx, th + 0.9, 0, 1.9, 6, sx);
      } else {
        p.push({ g: P.cone5, c: COL.roofRed, p: [cx, th + 1.7, 0], s: [TW * 1.5, 1.9, dz * 2.5] });
        p.push({ g: P.sph, c: COL.gold, p: [cx, th + 2.7, 0], s: [0.34, 0.4, 0.34] });
      }
    }

    /* the arch over the doorway, drawn as a fan of voussoirs */
    const ah = th * 0.62;
    for (let i = 0; i <= 9; i++) {
      const a = Math.PI * (i / 9);
      p.push({
        g: P.box, c: i % 2 ? dark : stone,
        p: [Math.cos(a) * OPEN, ah + Math.sin(a) * (OPEN * 0.72), 0],
        r: [0, 0, -a + Math.PI / 2],
        s: [0.62, 0.5, dz * 2.05]
      });
    }
    /* the lintel and walkway across the top, joining the two towers */
    p.push({ g: P.box, c: stone, p: [0, th * 0.94, 0], s: [OPEN * 2 + 0.4, 0.8, dz * 2.05] });
    p.push({ g: P.box, c: dark, p: [0, th + 0.3, 0], s: [OPEN * 2 + 0.6, 0.6, dz * 2.4] });
    for (let i = 0; i < 5; i++) {
      for (const sz of [-1, 1]) {
        p.push({
          g: P.box, c: stone, p: [(i - 2) * 0.62, th + 0.95, sz * (dz * 1.05)],
          s: [0.36, 0.7, 0.32]
        });
      }
    }
    /* murder-holes / portcullis teeth under the arch */
    for (let i = 0; i < 6; i++) {
      p.push({ g: P.cone5, c: metal, p: [(i - 2.5) * 0.5, ah - 0.15, 0], r: [Math.PI, 0, 0], s: [0.16, 0.5, 0.16] });
    }
    /* a lantern on each side of the passage */
    for (const sx of [-1, 1]) {
      p.push({ g: P.cyl6, c: metal, p: [sx * (OPEN - 0.2), 3.0, dz - 0.12], s: [0.1, 0.5, 0.1] });
      p.push({ g: P.taper(0.9, 0.5, 4), c: S ? S.glow : 0xffdd88, glow: true, p: [sx * (OPEN - 0.2), 2.65, dz - 0.12], s: [0.4, 0.46, 0.4] });
    }
    /* the sill you walk over */
    p.push({ g: P.box, c: dark, p: [0, 0.09, 0], s: [OPEN * 2, 0.18, dz * 1.9] });

    g.add(assemble(p));

    /* --- the two leaves --- */
    const leafH = ah - 0.2;
    const leaves = [];
    for (const sx of [-1, 1]) {
      const lp = [];
      /* built from the hinge outward, so rotating the group swings it */
      const w = OPEN;
      lp.push({ g: P.box, c: timber, p: [-sx * w / 2, leafH / 2, 0], s: [w, leafH, 0.26] });
      for (let i = 0; i < 4; i++) {
        lp.push({
          g: P.box, c: band,
          p: [-sx * (0.2 + i * (w - 0.4) / 3), leafH / 2, 0.16],
          s: [0.19, leafH * 0.96, 0.09]
        });
      }
      for (const y of [leafH * 0.24, leafH * 0.72]) {
        lp.push({ g: P.box, c: metal, p: [-sx * w / 2, y, 0.2], s: [w * 0.96, 0.19, 0.1] });
        for (let i = 0; i < 3; i++) {
          lp.push({ g: P.sph, c: metal, p: [-sx * (0.28 + i * 0.4), y, 0.27], s: [0.13, 0.13, 0.1] });
        }
      }
      // a heavy ring handle at the free edge
      lp.push({ g: P.ring, c: metal, p: [-sx * (w - 0.3), leafH * 0.5, 0.22], r: [0, 0, 0], s: [0.72, 0.72, 0.72] });
      if (tier === 'bone') skullParts(lp, -sx * (w * 0.5), leafH * 0.78, 0.24, 0.8);
      else if (tier === 'gem') shardParts(lp, -sx * (w * 0.5), leafH * 0.62, 0.22, 0.8, 4, sx);
      const leaf = assemble(lp);
      /* hinge post sits at the inner face of the tower */
      leaf.position.set(sx * OPEN, 0, 0);
      g.add(leaf);
      leaves.push(leaf);
    }
    g.userData.leaves = leaves;
    g.userData.isGate = true;
    return g;
  };

  BM.gate = function (l, def, mask) {
    const p = [];
    const h = 2.2 + l * 0.2;
    // the barrier lies along whichever axis the wall run follows
    const alongX = !mask ? true : !!(mask & 3);
    const ax = alongX ? 1 : 0, az = alongX ? 0 : 1;
    const L = CELL_HALF;
    for (const s2 of [-1, 1]) {
      p.push({
        g: P.box, c: COL.stone,
        p: [ax * s2 * (L - 0.22), h / 2, az * s2 * (L - 0.22)],
        s: [alongX ? 0.55 : 0.9, h, alongX ? 0.9 : 0.55]
      });
    }
    p.push({
      g: P.box, c: COL.woodDark, p: [0, h + 0.2, 0],
      s: [alongX ? L * 2 : 0.92, 0.4, alongX ? 0.92 : L * 2]
    });
    for (let i = 0; i < 4; i++) {
      const t = (i - 1.5) * 0.31;
      p.push({
        g: P.box, c: COL.wood, p: [ax * t, h * 0.45, az * t],
        s: [alongX ? 0.28 : 0.24, h * 0.9, alongX ? 0.24 : 0.28]
      });
    }
    for (const y of [h * 0.65, h * 0.28]) {
      p.push({
        g: P.box, c: COL.iron, p: [ax * 0, y, az * 0 + (alongX ? 0.14 : 0)],
        s: [alongX ? 1.35 : 0.09, 0.16, alongX ? 0.09 : 1.35]
      });
    }
    if (l >= 2) for (const s2 of [-1, 1]) {
      p.push({
        g: P.cone5, c: COL.roofRed,
        p: [ax * s2 * (L - 0.22), h + 0.62, az * s2 * (L - 0.22)],
        s: [alongX ? 0.8 : 1.1, 0.7, alongX ? 1.1 : 0.8]
      });
    }
    if (l >= 3) p.push({ g: P.sph, c: COL.gold, p: [0, h + 0.55, 0], s: [0.35, 0.35, 0.35] });
    return assemble(p);
  };

  BM.lamp = function (l) {
    const p = [];
    const h = 2.4 + l * 0.3;
    p.push({ g: P.cyl6, c: COL.stoneDark, p: [0, 0.12, 0], s: [0.6, 0.24, 0.6] });
    p.push({ g: P.cyl6, c: COL.iron, p: [0, h / 2, 0], s: [0.16, h, 0.16] });
    p.push({ g: P.box, c: COL.iron, p: [0, h + 0.12, 0], s: [0.42, 0.1, 0.42] });
    p.push({ g: P.taper(0.9, 0.5, 4), c: 0xffdd88, glow: true, p: [0, h + 0.38, 0], s: [0.5, 0.55, 0.5] });
    p.push({ g: P.cone5, c: COL.iron, p: [0, h + 0.75, 0], s: [0.55, 0.3, 0.55] });
    if (l >= 2) for (const sx of [-1, 1]) p.push({ g: P.box, c: COL.iron, p: [sx * 0.28, h - 0.25, 0], r: [0, 0, sx * 0.7], s: [0.5, 0.07, 0.07] });
    return assemble(p, true);
  };

  BM.council = function (l) {
    const p = [];
    const w = 4.6, d = 2.6, top = 1.0;
    // flagged canopy poles at the corners
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      p.push({ g: P.cyl6, c: COL.woodDark, p: [sx * (w / 2 + 0.35), 1.35, sz * (d / 2 + 0.75)], s: [0.18, 2.7, 0.18] });
    }
    if (l >= 2) {
      gable(p, 0, 2.7, 0, w + 1.2, d + 2.0, 0.7, l >= 3 ? COL.roofBlue : COL.thatch);
    }
    // the table itself
    p.push({ g: P.box, c: l >= 3 ? COL.marble : COL.plank, p: [0, top, 0], s: [w, 0.18, d] });
    p.push({ g: P.box, c: COL.woodDark, p: [0, top - 0.12, 0], s: [w * 0.92, 0.1, d * 0.9] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      p.push({ g: P.box, c: COL.woodDark, p: [sx * (w / 2 - 0.4), top / 2, sz * (d / 2 - 0.35)], s: [0.24, top, 0.24] });
    }
    // benches all the way round, so the whole tribe can sit
    for (const sz of [-1, 1]) {
      p.push({ g: P.box, c: COL.wood, p: [0, 0.55, sz * (d / 2 + 0.75)], s: [w * 0.88, 0.14, 0.5] });
      for (const sx of [-1, 1]) p.push({ g: P.box, c: COL.woodDark, p: [sx * (w * 0.34), 0.28, sz * (d / 2 + 0.75)], s: [0.16, 0.55, 0.4] });
    }
    // map, plans and a lantern on the table top
    p.push({ g: P.box, c: 0xe8e0c8, p: [-0.7, top + 0.11, 0], r: [0, 0.2, 0], s: [1.6, 0.04, 1.1] });
    p.push({ g: P.box, c: 0x8a6034, p: [-0.7, top + 0.14, 0], r: [0, 0.2, 0], s: [0.9, 0.03, 0.5] });
    p.push({ g: P.cyl, c: COL.iron, p: [1.5, top + 0.2, 0.4], s: [0.26, 0.22, 0.26] });
    p.push({ g: P.taper(0.7, 0.4, 5), c: 0xffdd88, glow: true, p: [1.5, top + 0.42, 0.4], s: [0.34, 0.4, 0.34] });
    for (let i = 0; i < 3; i++) {
      p.push({ g: P.box, c: [0xd23b32, 0x3f7a9e, 0x4a8040][i], p: [0.4 + i * 0.35, top + 0.14, -0.6], r: [0, i * 0.4, 0], s: [0.28, 0.05, 0.4] });
    }
    if (l >= 2) p.push({ g: P.box, c: COL.gold, p: [0, top + 0.2, 0.9], s: [0.7, 0.06, 0.24] });
    if (l >= 3) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      p.push({ g: P.box, c: 0xd23b32, p: [sx * (w / 2 + 0.35), 2.35, sz * (d / 2 + 0.75)], s: [0.06, 0.5, 0.7] });
    }
    return assemble(p);
  };

  /* A ring of stones, a stack of logs and a flame. The flame is `isGlow`
     so it lights up at dusk with the rest of the town's windows, and it is
     kept in userData so the fire system can hide it when the fuel runs out. */
  function fireParts(p, scale, l) {
    const s = scale;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.283;
      p.push({
        g: P.ico, c: i % 2 ? COL.stone : COL.stoneDark,
        p: [Math.cos(a) * 0.72 * s, 0.11 * s, Math.sin(a) * 0.72 * s],
        r: [0, a, 0], s: [0.34 * s, 0.26 * s, 0.3 * s]
      });
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 3.14;
      p.push({
        g: P.cyl6, c: i % 2 ? COL.woodDark : COL.wood,
        p: [Math.cos(a) * 0.16 * s, 0.3 * s, Math.sin(a) * 0.16 * s],
        r: [Math.sin(a) * 0.5, a, Math.cos(a) * 0.5],
        s: [0.15 * s, 1.0 * s, 0.15 * s]
      });
    }
    p.push({ g: P.cone5, c: 0xff7a1e, glow: true, p: [0, 0.72 * s, 0], s: [0.62 * s, 0.95 * s, 0.62 * s] });
    p.push({ g: P.cone5, c: 0xffd15c, glow: true, p: [0, 0.6 * s, 0], s: [0.38 * s, 0.7 * s, 0.38 * s] });
    if (l >= 3) p.push({ g: P.cone5, c: 0xfff0b0, glow: true, p: [0, 0.5 * s, 0], s: [0.2 * s, 0.44 * s, 0.2 * s] });
  }

  BM.campfire = function (l) {
    const p = [];
    fireParts(p, 0.85 + l * 0.07, l);
    if (l >= 2) {
      // a spit over the flames
      for (const sx of [-1, 1]) {
        p.push({ g: P.cyl6, c: COL.woodDark, p: [sx * 0.85, 0.62, 0], r: [0, 0, sx * 0.28], s: [0.11, 1.4, 0.11] });
      }
      p.push({ g: P.cyl6, c: COL.iron, p: [0, 1.3, 0], r: [0, 0, 1.5708], s: [0.06, 2.0, 0.06] });
    }
    if (l >= 4) for (let i = 0; i < 3; i++) {
      p.push({ g: P.box, c: COL.wood, p: [-1.15, 0.16 + i * 0.19, 0.3 - i * 0.1], r: [0, 0.3, 0], s: [0.9, 0.17, 0.17] });
    }
    return assemble(p);
  };

  BM.watchfire = function (l) {
    const p = [];
    // stone plinth
    p.push({ g: P.cyl6, c: COL.stoneDark, p: [0, 0.28, 0], s: [2.4, 0.56, 2.4] });
    p.push({ g: P.cyl6, c: COL.stone, p: [0, 0.72, 0], s: [1.9, 0.36, 1.9] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.283;
      p.push({ g: P.box, c: COL.stone, p: [Math.cos(a) * 1.05, 1.05, Math.sin(a) * 1.05], r: [0, a, 0], s: [0.5, 0.42, 0.3] });
    }
    const fp = [];
    fireParts(fp, 1.15 + l * 0.09, l);
    for (const q of fp) { q.p[1] += 1.0; p.push(q); }
    if (l >= 2) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      p.push({ g: P.cyl6, c: COL.woodDark, p: [sx * 1.35, 1.5, sz * 1.35], s: [0.16, 2.6, 0.16] });
    }
    if (l >= 3) {
      p.push({ g: P.box, c: COL.iron, p: [0, 2.85, 0], s: [3.2, 0.14, 3.2] });
      p.push({ g: P.cone5, c: 0x3a3a42, p: [0, 3.25, 0], s: [2.6, 0.8, 2.6] });
    }
    if (l >= 5) p.push({ g: P.box, c: COL.gold, p: [0, 0.72, 1.6], s: [1.4, 0.3, 0.1] });
    return assemble(p);
  };

  /** a horse on its own — tamed ones wear a halter and a lead rope */
  M.horse = function (coat, tamed) {
    const g = new THREE.Group();
    const c = coat === undefined ? 0x6b4a2c : coat;
    const p = [];
    p.push({ g: P.ico, c: c, p: [0, 1.05, 0], s: [0.85, 0.95, 2.0] });
    p.push({ g: P.cyl6, c: c, p: [0, 1.5, 0.75], r: [0.55, 0, 0], s: [0.42, 1.1, 0.42] });
    p.push({ g: P.ico, c: c, p: [0, 1.95, 1.15], s: [0.4, 0.42, 0.8] });
    p.push({ g: P.box, c: 0x2a2a2a, p: [0, 1.85, 1.5], s: [0.26, 0.2, 0.22] });
    for (const sx of [-1, 1]) p.push({ g: P.cone5, c: c, p: [sx * 0.16, 2.2, 1.0], s: [0.14, 0.26, 0.14] });
    for (let i = 0; i < 4; i++) p.push({ g: P.box, c: 0x2a1c12, p: [0, 1.65 + i * 0.13, 0.95 - i * 0.2], s: [0.14, 0.26, 0.2] });
    p.push({ g: P.cone5, c: 0x2a1c12, p: [0, 1.2, -1.05], r: [-0.6, 0, 0], s: [0.26, 0.9, 0.26] });
    if (tamed) {
      // saddle, girth, halter and a coiled lead rope
      p.push({ g: P.box, c: 0x6a3a1e, p: [0, 1.55, -0.1], s: [0.72, 0.18, 0.85] });
      p.push({ g: P.box, c: 0x4a2a14, p: [0, 1.28, -0.1], s: [0.9, 0.5, 0.16] });
      p.push({ g: P.box, c: 0xb08553, p: [0, 1.9, 1.32], s: [0.44, 0.09, 0.5] });
      p.push({ g: P.box, c: 0xb08553, p: [0, 1.78, 1.12], r: [0, 0, 1.5708], s: [0.09, 0.5, 0.44] });
      for (let i = 0; i < 3; i++) {
        p.push({ g: P.cyl6, c: 0xd8c8a0, p: [0.24, 1.72 - i * 0.16, 0.9 - i * 0.14], r: [0.6, 0, 0.3], s: [0.05, 0.5, 0.05] });
      }
    }
    g.add(assemble(p));
    const legGeo = merge([{ g: P.cyl6, c: c, p: [0, -0.42, 0], s: [0.2, 0.92, 0.2] },
    { g: P.box, c: 0x2a2a2a, p: [0, -0.86, 0.02], s: [0.24, 0.14, 0.28] }]);
    const legs = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(legGeo, MAT.solid);
      m.castShadow = true;
      m.position.set((i % 2 ? 1 : -1) * 0.34, 1.0, (i < 2 ? 1 : -1) * 0.65);
      m.userData.phase = (i % 2 ? 0 : Math.PI) + (i < 2 ? 0 : Math.PI);
      g.add(m); legs.push(m);
    }
    g.userData.legs = legs;
    return g;
  };

  /* A real stable: one long hall with a central aisle and ten boxes, five
     down each side. Horses you lead inside stand in their own stall — see
     stallSpot() in horses.js for where each one parks. */
  BM.stable = function (l) {
    const p = [];
    const W = 13.4, D = 8.4;                 // hall footprint
    const wall = 2.9 + l * 0.12;
    const half = W / 2, hd = D / 2;

    // stone footing + packed-earth aisle
    p.push({ g: P.box, c: COL.stoneDark, p: [0, 0.1, 0], s: [W + 0.7, 0.2, D + 0.7] });
    p.push({ g: P.box, c: COL.stone, p: [0, 0.21, 0], s: [W + 0.2, 0.06, D + 0.2] });
    p.push({ g: P.box, c: 0x6b5540, p: [0, 0.25, 0], s: [W - 0.6, 0.05, 2.5] });

    // long side walls, with a window per stall
    const wallCol = l >= 3 ? COL.plank : COL.wood;
    for (const sz of [-1, 1]) {
      p.push({ g: P.box, c: wallCol, p: [0, 0.24 + wall / 2, sz * hd], s: [W, wall, 0.3] });
      for (let i = 0; i < 5; i++) {
        const x = -half + 1.34 + i * 2.68;
        p.push({ g: P.box, c: COL.glassLit, glow: true, p: [x, 0.24 + wall * 0.72, sz * (hd + 0.03)], s: [0.85, 0.62, 0.1] });
        p.push({ g: P.box, c: COL.woodDark, p: [x, 0.24 + wall * 0.72, sz * (hd + 0.07)], s: [0.97, 0.1, 0.06] });
        p.push({ g: P.box, c: COL.woodDark, p: [x, 0.24 + wall * 0.72, sz * (hd + 0.07)], r: [0, 0, 1.5708], s: [0.1, 0.97, 0.06] });
      }
    }
    // gable ends with big double doors
    for (const sx of [-1, 1]) {
      p.push({ g: P.box, c: wallCol, p: [sx * half, 0.24 + wall / 2, 0], s: [0.3, wall, D] });
      for (const off of [-0.72, 0.72]) {
        p.push({ g: P.box, c: COL.woodDark, p: [sx * (half + 0.04), 0.24 + wall * 0.44, off], s: [0.1, wall * 0.86, 1.34] });
      }
      p.push({ g: P.box, c: COL.iron, p: [sx * (half + 0.1), 0.24 + wall * 0.86, 0], s: [0.07, 0.1, 3.0] });
      p.push({ g: P.box, c: COL.thatch, p: [sx * (half + 0.05), 0.24 + wall + 0.75, 0], s: [0.12, 0.8, 1.1] });
    }

    // ten boxes: divider walls off each side wall, leaving the aisle clear
    for (const sz of [-1, 1]) {
      for (let i = 0; i <= 5; i++) {
        const x = -half + 0.15 + i * 2.62;
        p.push({ g: P.box, c: COL.woodDark, p: [x, 0.24 + 1.05, sz * (hd - 1.35)], s: [0.16, 2.1, 2.5] });
      }
      for (let i = 0; i < 5; i++) {
        const x = -half + 1.46 + i * 2.62;
        // half-door onto the aisle, open at the top, with an iron latch
        p.push({ g: P.box, c: l >= 2 ? COL.plank : COL.wood, p: [x, 0.24 + 0.6, sz * 1.28], s: [2.3, 1.2, 0.14] });
        p.push({ g: P.box, c: COL.woodDark, p: [x, 0.24 + 1.24, sz * 1.28], s: [2.4, 0.14, 0.2] });
        for (let b = 0; b < 4; b++) {
          p.push({ g: P.cyl6, c: COL.iron, p: [x - 0.8 + b * 0.53, 0.24 + 1.62, sz * 1.28], s: [0.06, 0.78, 0.06] });
        }
        p.push({ g: P.sph, c: COL.gold, p: [x + 1.0, 0.24 + 0.75, sz * 1.36], s: [0.13, 0.13, 0.13] });
        // manger and a bucket at the back of each box
        p.push({ g: P.box, c: COL.woodDark, p: [x, 0.42, sz * (hd - 0.5)], s: [1.5, 0.36, 0.5] });
        p.push({ g: P.box, c: COL.thatch, p: [x, 0.6, sz * (hd - 0.5)], s: [1.2, 0.16, 0.36] });
      }
    }

    // roof: long gable along the hall, with a vented cupola on the ridge
    gable(p, 0, 0.24 + wall, 0, W + 1.0, D + 1.0, 2.4, l >= 4 ? 0x5a4a6a : 0x7a4a28);
    p.push({ g: P.box, c: COL.woodDark, p: [0, 0.24 + wall - 0.08, 0], s: [W + 1.2, 0.14, D + 1.2] });
    for (let i = -3; i <= 3; i++) {
      for (const sz of [-1, 1]) {
        p.push({ g: P.box, c: COL.woodDark, p: [i * 1.9, 0.24 + wall + 0.06, sz * (hd + 0.42)], s: [0.12, 0.14, 0.5] });
      }
    }
    const ridge = 0.24 + wall + 2.4;
    p.push({ g: P.box, c: wallCol, p: [0, ridge + 0.45, 0], s: [2.2, 0.9, 1.6] });
    p.push({ g: P.box, c: 0x1c1410, p: [0, ridge + 0.5, 0.82], s: [1.5, 0.5, 0.06] });
    p.push({ g: P.pyr, c: l >= 4 ? 0x5a4a6a : 0x7a4a28, p: [0, ridge + 1.15, 0], s: [2.6, 0.9, 2.0] });
    if (l >= 2) {
      // weather vane: a running horse
      p.push({ g: P.cyl6, c: COL.iron, p: [0, ridge + 1.9, 0], s: [0.07, 0.9, 0.07] });
      p.push({ g: P.box, c: COL.gold, p: [0, ridge + 2.4, 0], s: [0.9, 0.34, 0.07] });
      p.push({ g: P.box, c: COL.gold, p: [0.38, ridge + 2.62, 0], s: [0.24, 0.3, 0.07] });
    }

    // yard: paddock rail, water trough, hay stack, mounting block
    p.push({ g: P.box, c: COL.woodDark, p: [0, 0.42, hd + 3.3], s: [1.9, 0.5, 1.0] });
    p.push({ g: P.box, c: 0x3f7fa8, p: [0, 0.6, hd + 3.3], s: [1.6, 0.14, 0.78] });
    for (let i = 0; i < 6; i++) {
      p.push({ g: P.cyl6, c: COL.woodDark, p: [-half + 0.6 + i * 2.4, 0.72, hd + 4.6], s: [0.16, 1.4, 0.16] });
    }
    for (const y of [0.6, 1.05]) {
      p.push({ g: P.box, c: COL.wood, p: [0, y, hd + 4.6], s: [W - 0.6, 0.11, 0.11] });
    }
    p.push({ g: P.box, c: COL.thatch, p: [half - 1.6, 0.75, hd + 2.9], r: [0, 0.35, 0], s: [2.0, 1.4, 2.0] });
    p.push({ g: P.box, c: COL.stone, p: [-half + 1.6, 0.4, hd + 2.6], s: [1.1, 0.4, 0.9] });
    p.push({ g: P.box, c: COL.stone, p: [-half + 1.6, 0.72, hd + 2.85], s: [1.1, 0.3, 0.5] });
    if (l >= 3) {
      for (const sx of [-1, 1]) {
        p.push({ g: P.cyl6, c: COL.woodDark, p: [sx * (half + 0.55), 1.3, hd + 0.3], s: [0.14, 2.6, 0.14] });
        p.push({ g: P.sph, c: COL.glassLit, glow: true, p: [sx * (half + 0.55), 2.5, hd + 0.3], s: [0.3, 0.34, 0.3] });
      }
    }
    if (l >= 5) {
      p.push({ g: P.box, c: COL.gold, p: [0, 0.24 + wall + 0.55, hd + 0.62], s: [4.2, 0.5, 0.12] });
    }
    return assemble(p);
  };

  BM.dock = function (l) {
    const p = [];
    const len = 4.4 + l * 0.6;
    p.push({ g: P.box, c: COL.plank, p: [0, 0.42, 0], s: [2.4, 0.16, len] });
    for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
      p.push({ g: P.cyl6, c: COL.woodDark, p: [sx * 0.95, 0.0, -len / 2 + 0.5 + i * (len / 3.4)], s: [0.2, 1.7, 0.2] });
    }
    for (let i = 0; i < 6; i++) p.push({ g: P.box, c: COL.wood, p: [0, 0.5, -len / 2 + 0.4 + i * (len / 6)], s: [2.5, 0.06, 0.16] });
    if (l >= 2) {
      p.push({ g: P.cyl6, c: COL.wood, p: [0.9, 1.1, len / 2 - 0.5], s: [0.16, 1.5, 0.16] });
      p.push({ g: P.box, c: 0xd23b32, p: [1.3, 1.6, len / 2 - 0.5], s: [0.8, 0.5, 0.05] });
    }
    if (l >= 3) {
      p.push({ g: P.box, c: COL.wood, p: [-1.6, 0.35, 0], r: [0, 0, 0.1], s: [1.4, 0.3, 2.6] });
      p.push({ g: P.box, c: COL.woodDark, p: [-1.6, 0.6, 0], s: [1.0, 0.2, 2.0] });
    }
    return assemble(p);
  };

  /* =========================================================
     THE PERSIAN GARDEN — چهارباغ
     Four planted quarters split by a cross of water channels, a tiled
     pool where the arms meet, cypresses at the corners, pomegranates
     inside and roses along the walks. Lanterns come on at dusk.
     ========================================================= */
  const TILE_BLUE = 0x2f6fa8, TILE_LIGHT = 0x63a8d8, WATER_BLUE = 0x3a8fc8;

  /** a slim cypress: stacked cones narrowing to a point */
  function cypressParts(p, x, y, z, h, c) {
    const dark = 0x24523c;
    p.push({ g: P.cyl6, c: COL.woodDark, p: [x, y + 0.2, z], s: [0.16, 0.4, 0.16] });
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      p.push({
        g: P.cone5, c: i % 2 ? c : dark,
        p: [x, y + 0.4 + h * (0.18 + t * 0.72), z],
        s: [(0.86 - t * 0.42) * (h * 0.28), h * 0.42, (0.86 - t * 0.42) * (h * 0.28)]
      });
    }
  }
  /** a small round fruit tree with dots of fruit */
  function fruitTreeParts(p, x, y, z, h, leaf, fruit, rnd) {
    p.push({ g: P.cyl6, c: 0x6b4a2c, p: [x, y + h * 0.28, z], s: [0.2, h * 0.56, 0.2] });
    p.push({ g: P.ico, c: leaf, p: [x, y + h * 0.78, z], s: [h * 0.68, h * 0.52, h * 0.68] });
    p.push({ g: P.ico, c: leaf, p: [x + h * 0.16, y + h * 0.62, z - h * 0.14], s: [h * 0.42, h * 0.34, h * 0.42] });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.283 + (rnd || 0);
      p.push({
        g: P.sph, c: fruit,
        p: [x + Math.cos(a) * h * 0.38, y + h * (0.68 + (i % 3) * 0.08), z + Math.sin(a) * h * 0.38],
        s: [0.17, 0.19, 0.17]
      });
    }
  }
  /** a rose: a green cushion with red buds on top */
  function roseParts(p, x, y, z, s, col) {
    p.push({ g: P.ico, c: 0x4a8040, p: [x, y + 0.16 * s, z], s: [0.5 * s, 0.3 * s, 0.5 * s] });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 6.283;
      p.push({ g: P.ico, c: col || 0xc2344f, p: [x + Math.cos(a) * 0.16 * s, y + 0.34 * s, z + Math.sin(a) * 0.16 * s], s: [0.15 * s, 0.15 * s, 0.15 * s] });
    }
  }

  BM.garden = function (l) {
    const p = [];
    const R = 5.6;                       // half the 12x12 footprint, minus the wall
    const chan = 0.9;                    // half-width of the water channels

    /* low retaining wall all the way round, with a gap on each side */
    for (const s of [-1, 1]) {
      for (const seg of [[-1, -2.1], [1, 2.1]]) {
        p.push({ g: P.box, c: COL.brick, p: [seg[1] * 1.65, 0.28, s * R], s: [4.2, 0.56, 0.4] });
        p.push({ g: P.box, c: s > 0 ? TILE_BLUE : TILE_LIGHT, p: [seg[1] * 1.65, 0.58, s * R], s: [4.2, 0.08, 0.44] });
        p.push({ g: P.box, c: COL.brick, p: [s * R, 0.28, seg[1] * 1.65], s: [0.4, 0.56, 4.2] });
        p.push({ g: P.box, c: s > 0 ? TILE_LIGHT : TILE_BLUE, p: [s * R, 0.58, seg[1] * 1.65], s: [0.44, 0.08, 4.2] });
      }
      // corner posts
      for (const s2 of [-1, 1]) p.push({ g: P.box, c: COL.stone, p: [s * R, 0.42, s2 * R], s: [0.6, 0.84, 0.6] });
    }

    /* the four planted quarters */
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = sx * 3.0, cz = sz * 3.0;
      p.push({ g: P.box, c: 0x4d7a3a, p: [cx, 0.06, cz], s: [3.9, 0.12, 3.9] });
      p.push({ g: P.box, c: COL.stone, p: [cx, 0.09, cz], s: [4.1, 0.06, 4.1] });
      fruitTreeParts(p, cx + sx * 0.7, 0.12, cz + sz * 0.7, 1.9 + l * 0.12, 0x3f7a3c, 0xc0392b, sx * sz);
      roseParts(p, cx - sx * 1.2, 0.12, cz - sz * 1.2, 1, 0xc2344f);
      roseParts(p, cx - sx * 1.3, 0.12, cz + sz * 0.9, 1, 0xe8b0c0);
      roseParts(p, cx + sx * 1.1, 0.12, cz - sz * 1.4, 1, 0xd8d0e8);
      if (l >= 2) roseParts(p, cx, 0.12, cz - sz * 0.4, 0.9, 0xf0c437);
    }

    /* cross of water channels — the whole point of a chahar bagh */
    for (const axis of [0, 1]) {
      const w = axis ? chan * 2 : R * 2, d = axis ? R * 2 : chan * 2;
      p.push({ g: P.box, c: COL.stone, p: [0, 0.08, 0], s: [w + 0.5, 0.16, d + 0.5] });
      p.push({ g: P.box, c: TILE_BLUE, p: [0, 0.14, 0], s: [w, 0.1, d] });
      p.push({ g: P.box, c: WATER_BLUE, glow: true, p: [0, 0.2, 0], s: [w - 0.24, 0.04, d - 0.24] });
    }

    /* the pool at the crossing */
    p.push({ g: P.cyl, c: COL.marble, p: [0, 0.2, 0], s: [3.5, 0.4, 3.5] });
    p.push({ g: P.cyl, c: TILE_BLUE, p: [0, 0.34, 0], s: [3.0, 0.2, 3.0] });
    p.push({ g: P.cyl, c: WATER_BLUE, glow: true, p: [0, 0.42, 0], s: [2.8, 0.06, 2.8] });
    if (l >= 2) {
      p.push({ g: P.cyl, c: COL.marble, p: [0, 0.6, 0], s: [0.5, 0.5, 0.5] });
      p.push({ g: P.cyl, c: COL.marble, p: [0, 0.9, 0], s: [1.1, 0.14, 1.1] });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.283;
        p.push({ g: P.box, c: 0x9fd8e8, glow: true, p: [Math.cos(a) * 0.62, 0.78, Math.sin(a) * 0.62], r: [0, -a, 0.55], s: [0.6, 0.05, 0.05] });
      }
    }
    if (l >= 4) p.push({ g: P.sph, c: COL.gold, p: [0, 1.15, 0], s: [0.36, 0.36, 0.36] });

    /* cypresses at the four corners, growing with the level */
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      cypressParts(p, sx * (R - 0.9), 0.1, sz * (R - 0.9), 3.4 + l * 0.4, 0x2c5f34);
    }

    /* lantern posts along the walks, lit at night */
    const lamps = l >= 3 ? 8 : 4;
    for (let i = 0; i < lamps; i++) {
      const a = (i / lamps) * 6.283 + 0.39;
      const lx = Math.cos(a) * (R - 2.0), lz = Math.sin(a) * (R - 2.0);
      p.push({ g: P.cyl6, c: COL.iron, p: [lx, 0.7, lz], s: [0.12, 1.4, 0.12] });
      p.push({ g: P.taper(0.9, 0.5, 4), c: 0xffdd88, glow: true, p: [lx, 1.55, lz], s: [0.4, 0.44, 0.4] });
      p.push({ g: P.cone5, c: COL.iron, p: [lx, 1.85, lz], s: [0.44, 0.24, 0.44] });
    }

    /* benches on the cross walks, so people have somewhere to sit */
    if (l >= 2) for (const s of [-1, 1]) {
      p.push({ g: P.box, c: COL.plank, p: [s * (R - 1.5), 0.46, 0], r: [0, 1.57, 0], s: [1.7, 0.12, 0.5] });
      p.push({ g: P.box, c: COL.woodDark, p: [s * (R - 1.5), 0.24, 0], s: [0.4, 0.44, 1.4] });
      p.push({ g: P.box, c: COL.plank, p: [0, 0.46, s * (R - 1.5)], s: [1.7, 0.12, 0.5] });
      p.push({ g: P.box, c: COL.woodDark, p: [0, 0.24, s * (R - 1.5)], s: [1.4, 0.44, 0.4] });
    }
    return assemble(p);
  };

  /* =========================================================
     DECORATION — small pieces you buy purely because they look good
     ========================================================= */
  /** stepped stone plinth shared by most of the statuary */
  function plinth(p, w, h, c) {
    p.push({ g: P.box, c: c || COL.stoneDark, p: [0, h * 0.25, 0], s: [w, h * 0.5, w] });
    p.push({ g: P.box, c: c || COL.stone, p: [0, h * 0.68, 0], s: [w * 0.82, h * 0.36, w * 0.82] });
  }

  BM.statue = function (l) {
    const p = [];
    plinth(p, 1.5, 0.9);
    const c = l >= 3 ? COL.marble : COL.stone;
    p.push({ g: P.box, c: c, p: [0, 1.55, 0], s: [0.5, 0.9, 0.32] });        // torso
    p.push({ g: P.box, c: c, p: [0, 2.18, 0], s: [0.34, 0.36, 0.32] });      // head
    p.push({ g: P.cyl, c: l >= 2 ? COL.gold : c, p: [0, 2.42, 0], s: [0.42, 0.14, 0.42] });
    for (const sx of [-1, 1]) p.push({ g: P.box, c: c, p: [sx * 0.34, 1.6, 0], r: [0, 0, sx * 0.35], s: [0.17, 0.8, 0.17] });
    for (const sx of [-1, 1]) p.push({ g: P.box, c: c, p: [sx * 0.15, 1.0, 0], s: [0.2, 0.34, 0.22] });
    p.push({ g: P.cyl6, c: l >= 2 ? COL.gold : COL.iron, p: [0.42, 1.75, 0], r: [0, 0, 0.2], s: [0.07, 1.6, 0.07] });
    return assemble(p);
  };

  BM.horse_statue = function (l) {
    const p = [];
    plinth(p, 2.4, 0.8);
    const c = l >= 3 ? COL.gold : (l >= 2 ? 0xb08a4a : 0x8a7a5a);
    p.push({ g: P.ico, c: c, p: [0, 1.75, 0], s: [0.85, 1.0, 2.1] });        // barrel
    p.push({ g: P.cyl6, c: c, p: [0, 2.2, 0.75], r: [0.7, 0, 0], s: [0.45, 1.1, 0.45] });   // neck
    p.push({ g: P.ico, c: c, p: [0, 2.7, 1.15], r: [0.35, 0, 0], s: [0.42, 0.44, 0.86] });  // head
    for (const sx of [-1, 1]) p.push({ g: P.cone5, c: c, p: [sx * 0.16, 2.98, 1.0], s: [0.16, 0.26, 0.16] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      p.push({ g: P.cyl6, c: c, p: [sx * 0.38, 1.0, sz * 0.75], r: [sz * 0.22, 0, 0], s: [0.24, 1.5, 0.24] });
    }
    // mane and tail
    for (let i = 0; i < 5; i++) p.push({ g: P.box, c: COL.stoneDark, p: [0, 2.5 - i * 0.14, 0.5 + i * 0.12], r: [0.6, 0, 0], s: [0.12, 0.4, 0.2] });
    p.push({ g: P.cone5, c: COL.stoneDark, p: [0, 1.95, -1.1], r: [-0.7, 0, 0], s: [0.3, 1.0, 0.3] });
    return assemble(p);
  };

  BM.lion = function (l) {
    const p = [];
    plinth(p, 2.0, 0.6);
    const c = l >= 2 ? COL.marble : 0x9a8f78;
    p.push({ g: P.ico, c: c, p: [0, 1.1, -0.1], s: [0.9, 0.85, 2.0] });
    p.push({ g: P.ico, c: c, p: [0, 1.6, 0.85], s: [0.85, 0.85, 0.8] });        // mane
    p.push({ g: P.box, c: c, p: [0, 1.55, 1.2], s: [0.45, 0.42, 0.4] });        // muzzle
    for (const sx of [-1, 1]) p.push({ g: P.sph, c: l >= 3 ? COL.gold : 0x3a3a3a, p: [sx * 0.17, 1.66, 1.4], s: [0.12, 0.12, 0.08] });
    for (const sx of [-1, 1]) {
      p.push({ g: P.box, c: c, p: [sx * 0.38, 0.9, 0.75], s: [0.28, 1.0, 0.3] });   // front legs, planted
      p.push({ g: P.ico, c: c, p: [sx * 0.4, 0.75, -0.85], s: [0.36, 0.7, 0.7] });  // haunches
    }
    p.push({ g: P.cyl4, c: c, p: [0, 1.2, -1.15], r: [-0.5, 0, 0], s: [0.14, 0.9, 0.14] });
    return assemble(p);
  };

  BM.column = function (l) {
    const p = [];
    const h = 4.2 + l * 0.7;
    p.push({ g: P.cyl, c: COL.stoneDark, p: [0, 0.18, 0], s: [1.7, 0.36, 1.7] });
    p.push({ g: P.cyl, c: COL.marble, p: [0, 0.5, 0], s: [1.3, 0.3, 1.3] });
    // fluting: a ring of thin staves around the shaft
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.283;
      p.push({ g: P.cyl6, c: i % 2 ? COL.marble : 0xcac6ba, p: [Math.cos(a) * 0.5, 0.65 + h / 2, Math.sin(a) * 0.5], s: [0.19, h, 0.19] });
    }
    p.push({ g: P.cyl, c: COL.marble, p: [0, 0.65 + h, 0], s: [1.25, 0.26, 1.25] });
    if (l >= 2) {
      // the twin bull capital
      for (const sz of [-1, 1]) {
        p.push({ g: P.ico, c: 0xd8d2c0, p: [0, 1.05 + h, sz * 0.62], s: [0.5, 0.55, 0.9] });
        p.push({ g: P.box, c: 0xd8d2c0, p: [0, 1.3 + h, sz * 1.1], s: [0.34, 0.36, 0.4] });
        for (const sx of [-1, 1]) p.push({ g: P.cone5, c: COL.gold, p: [sx * 0.2, 1.55 + h, sz * 1.05], r: [sz * 0.5, 0, sx * 0.4], s: [0.12, 0.34, 0.12] });
      }
    }
    return assemble(p);
  };

  BM.archway = function (l) {
    const p = [];
    const w = 4.4, h = 4.6 + l * 0.4;
    for (const sx of [-1, 1]) {
      p.push({ g: P.box, c: COL.brick, p: [sx * (w / 2 - 0.5), h / 2, 0], s: [1.0, h, 1.4] });
      p.push({ g: P.box, c: TILE_BLUE, p: [sx * (w / 2 - 0.5), h * 0.55, 0.72], s: [0.62, h * 0.6, 0.06] });
      p.push({ g: P.box, c: TILE_BLUE, p: [sx * (w / 2 - 0.5), h * 0.55, -0.72], s: [0.62, h * 0.6, 0.06] });
    }
    // the pointed arch, drawn as a fan of small blocks
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, a = Math.PI * t;
      const r = w / 2 - 0.5;
      p.push({
        g: P.box, c: i % 2 ? COL.brick : TILE_LIGHT,
        p: [Math.cos(a) * r, h + Math.sin(a) * 1.5, 0], r: [0, 0, -a + Math.PI / 2], s: [0.55, 0.5, 1.4]
      });
    }
    p.push({ g: P.box, c: COL.brick, p: [0, h + 1.9, 0], s: [w + 0.6, 0.5, 1.7] });
    p.push({ g: P.box, c: TILE_BLUE, p: [0, h + 2.22, 0], s: [w + 0.5, 0.16, 1.75] });
    if (l >= 2) for (let i = 0; i < 5; i++) {
      p.push({ g: P.box, c: i % 2 ? TILE_BLUE : TILE_LIGHT, p: [-1.6 + i * 0.8, h + 2.55, 0], s: [0.6, 0.5, 1.5] });
    }
    if (l >= 3) p.push({ g: P.cone5, c: COL.gold, p: [0, h + 3.1, 0], s: [0.5, 0.8, 0.5] });
    // lanterns under the arch
    for (const sx of [-1, 1]) p.push({ g: P.taper(0.9, 0.5, 4), c: 0xffdd88, glow: true, p: [sx * 1.3, h + 0.6, 0], s: [0.4, 0.5, 0.4] });
    return assemble(p);
  };

  BM.obelisk = function (l) {
    const p = [];
    plinth(p, 1.6, 0.7);
    const h = 3.2 + l * 0.6;
    p.push({ g: P.taper(0.4, 0.75, 4), c: l >= 2 ? COL.marble : COL.stone, p: [0, 0.7 + h / 2, 0], r: [0, 0.785, 0], s: [1.1, h, 1.1] });
    p.push({ g: P.pyr, c: l >= 3 ? COL.gold : COL.stoneDark, p: [0, 0.7 + h + 0.3, 0], r: [0, 0.785, 0], s: [0.62, 0.62, 0.62] });
    // an inscription nobody reads
    for (let i = 0; i < 5; i++) p.push({ g: P.box, c: COL.stoneDark, p: [0, 1.2 + i * 0.5, 0.29], s: [0.34, 0.06, 0.03] });
    return assemble(p);
  };

  BM.urn = function (l) {
    const p = [];
    const s = 0.9 + l * 0.12;
    p.push({ g: P.cyl, c: 0x8a5a3a, p: [0, 0.08 * s, 0], s: [0.5 * s, 0.16 * s, 0.5 * s] });
    p.push({ g: P.sph, c: 0xa8663a, p: [0, 0.5 * s, 0], s: [0.95 * s, 0.9 * s, 0.95 * s] });
    p.push({ g: P.taper(0.55, 0.85, 8), c: 0xa8663a, p: [0, 0.95 * s, 0], s: [0.6 * s, 0.34 * s, 0.6 * s] });
    p.push({ g: P.cyl, c: 0x8a5a3a, p: [0, 1.13 * s, 0], s: [0.42 * s, 0.09 * s, 0.42 * s] });
    for (const sx of [-1, 1]) p.push({ g: P.box, c: 0x8a5a3a, p: [sx * 0.45 * s, 0.78 * s, 0], r: [0, 0, sx * 0.5], s: [0.1 * s, 0.42 * s, 0.1 * s] });
    if (l >= 2) for (let i = 0; i < 3; i++) p.push({ g: P.box, c: TILE_BLUE, p: [0, (0.4 + i * 0.18) * s, 0.47 * s], s: [0.5 * s, 0.05 * s, 0.05 * s] });
    return assemble(p);
  };

  BM.flowerbed = function (l) {
    const p = [];
    p.push({ g: P.box, c: COL.brick, p: [0, 0.14, 0], s: [1.9, 0.28, 1.9] });
    p.push({ g: P.box, c: COL.dirt, p: [0, 0.26, 0], s: [1.6, 0.1, 1.6] });
    const cols = [0xc2344f, 0xf0c437, 0xd8d0e8, 0xe8b0c0, 0xffffff, 0xe07b2a];
    const n = 5 + l * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 * 1.618, r = 0.2 + (i % 3) * 0.24;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      p.push({ g: P.cyl6, c: 0x4a8040, p: [x, 0.4, z], s: [0.06, 0.24, 0.06] });
      p.push({ g: P.ico, c: cols[i % cols.length], p: [x, 0.55, z], s: [0.19, 0.15, 0.19] });
    }
    return assemble(p, true);
  };

  BM.rosebush = function (l) {
    const p = [];
    p.push({ g: P.cyl, c: COL.dirt, p: [0, 0.06, 0], s: [0.8, 0.12, 0.8] });
    roseParts(p, 0, 0.1, 0, 1.1 + l * 0.15, 0xc2344f);
    if (l >= 2) { roseParts(p, 0.28, 0.1, -0.2, 0.8, 0xe8b0c0); roseParts(p, -0.26, 0.1, 0.24, 0.8, 0xd8d0e8); }
    return assemble(p);
  };

  BM.cypress = function (l) { const p = []; cypressParts(p, 0, 0, 0, 4.0 + l * 0.9, 0x2c5f34); return assemble(p); };

  BM.pomegranate = function (l) {
    const p = [];
    fruitTreeParts(p, 0, 0, 0, 2.4 + l * 0.5, 0x3f7a3c, 0xc0392b, 0.4);
    return assemble(p);
  };

  BM.pool = function (l) {
    const p = [];
    const r = 1.85;
    p.push({ g: P.box, c: COL.marble, p: [0, 0.2, 0], s: [r * 2, 0.4, r * 2] });
    p.push({ g: P.box, c: TILE_BLUE, p: [0, 0.34, 0], s: [r * 2 - 0.6, 0.16, r * 2 - 0.6] });
    p.push({ g: P.box, c: WATER_BLUE, glow: true, p: [0, 0.44, 0], s: [r * 2 - 0.75, 0.05, r * 2 - 0.75] });
    // a border of alternating tiles
    for (let i = 0; i < 8; i++) {
      const t = -r + 0.25 + i * ((r * 2 - 0.5) / 7);
      for (const s of [-1, 1]) {
        p.push({ g: P.box, c: i % 2 ? TILE_BLUE : TILE_LIGHT, p: [t, 0.42, s * (r - 0.15)], s: [0.4, 0.06, 0.3] });
        p.push({ g: P.box, c: i % 2 ? TILE_LIGHT : TILE_BLUE, p: [s * (r - 0.15), 0.42, t], s: [0.3, 0.06, 0.4] });
      }
    }
    if (l >= 2) {
      p.push({ g: P.cyl, c: COL.marble, p: [0, 0.62, 0], s: [0.42, 0.44, 0.42] });
      p.push({ g: P.sph, c: 0x9fd8e8, glow: true, p: [0, 0.95, 0], s: [0.34, 0.34, 0.34] });
    }
    if (l >= 3) for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.283;
      p.push({ g: P.box, c: 0x9fd8e8, glow: true, p: [Math.cos(a) * 0.55, 0.82, Math.sin(a) * 0.55], r: [0, -a, 0.6], s: [0.55, 0.05, 0.05] });
    }
    return assemble(p, true);
  };

  BM.channel = function (l) {
    const p = [];
    p.push({ g: P.box, c: COL.stone, p: [0, 0.1, 0], s: [1.95, 0.2, 1.95] });
    p.push({ g: P.box, c: TILE_BLUE, p: [0, 0.17, 0], s: [1.3, 0.1, 1.98] });
    p.push({ g: P.box, c: WATER_BLUE, glow: true, p: [0, 0.23, 0], s: [1.15, 0.04, 1.99] });
    for (const sx of [-1, 1]) p.push({ g: P.box, c: l >= 2 ? TILE_LIGHT : COL.stoneDark, p: [sx * 0.78, 0.24, 0], s: [0.36, 0.12, 1.95] });
    return assemble(p, true);
  };

  BM.cascade = function (l) {
    const p = [];
    const steps = 2 + l;
    for (let i = 0; i < steps; i++) {
      const y = 0.25 + i * 0.45, w = 2.7 - i * 0.42;
      p.push({ g: P.box, c: COL.stone, p: [0, y, -i * 0.32], s: [w, 0.45, 1.5 - i * 0.15] });
      p.push({ g: P.box, c: TILE_BLUE, p: [0, y + 0.24, -i * 0.32], s: [w - 0.3, 0.06, 1.2 - i * 0.15] });
      p.push({ g: P.box, c: WATER_BLUE, glow: true, p: [0, y + 0.29, -i * 0.32 + 0.3], s: [w - 0.5, 0.05, 0.5] });
      // the sheet of water falling to the step below
      p.push({ g: P.box, c: 0x9fd8e8, glow: true, p: [0, y - 0.05, -i * 0.32 + 0.78], r: [0.3, 0, 0], s: [w - 0.7, 0.5, 0.05] });
    }
    p.push({ g: P.box, c: COL.marble, p: [0, 0.1, 1.15], s: [3.0, 0.2, 0.9] });
    p.push({ g: P.box, c: WATER_BLUE, glow: true, p: [0, 0.18, 1.15], s: [2.6, 0.05, 0.7] });
    return assemble(p);
  };

  BM.bench = function (l) {
    const p = [];
    const c = l >= 2 ? COL.plank : COL.wood;
    p.push({ g: P.box, c: c, p: [0, 0.46, 0], s: [1.8, 0.12, 0.55] });
    for (const sx of [-1, 1]) {
      p.push({ g: P.box, c: COL.woodDark, p: [sx * 0.72, 0.23, 0.2], s: [0.12, 0.46, 0.12] });
      p.push({ g: P.box, c: COL.woodDark, p: [sx * 0.72, 0.23, -0.2], s: [0.12, 0.46, 0.12] });
      p.push({ g: P.box, c: COL.woodDark, p: [sx * 0.72, 0.75, -0.24], s: [0.1, 0.62, 0.1] });
    }
    for (let i = 0; i < 3; i++) p.push({ g: P.box, c: c, p: [0, 0.72 + i * 0.16, -0.26], s: [1.7, 0.1, 0.08] });
    if (l >= 3) p.push({ g: P.box, c: 0xc2344f, p: [0, 0.53, 0], s: [1.5, 0.05, 0.42] });
    return assemble(p);
  };

  BM.gazebo = function (l) {
    const p = [];
    const r = 1.75, n = 8, h = 2.5;
    p.push({ g: P.cyl, c: COL.stone, p: [0, 0.1, 0], s: [r * 2.2, 0.2, r * 2.2] });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      p.push({ g: P.cyl6, c: COL.woodDark, p: [x, h / 2, z], s: [0.16, h, 0.16] });
      if (i % 2 === 0 && l >= 2) {
        // a bench between every other pair of posts
        const a2 = ((i + 1) / n) * 6.283, mx = (x + Math.cos(a2) * r) / 2, mz = (z + Math.sin(a2) * r) / 2;
        p.push({ g: P.box, c: COL.plank, p: [mx, 0.44, mz], r: [0, -a - 0.39, 0], s: [1.2, 0.1, 0.42] });
      }
    }
    p.push({ g: P.cone, c: l >= 3 ? 0x8a3f6a : COL.cloth, p: [0, h + 0.7, 0], s: [r * 2.6, 1.4, r * 2.6] });
    p.push({ g: P.cyl, c: COL.woodDark, p: [0, h + 0.06, 0], s: [r * 2.3, 0.12, r * 2.3] });
    p.push({ g: P.sph, c: COL.gold, p: [0, h + 1.5, 0], s: [0.3, 0.36, 0.3] });
    p.push({ g: P.taper(0.9, 0.5, 4), c: 0xffdd88, glow: true, p: [0, h + 0.15, 0], s: [0.42, 0.4, 0.42] });
    return assemble(p);
  };

  BM.swing = function (l) {
    const p = [];
    const h = 2.5;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      p.push({ g: P.cyl6, c: COL.wood, p: [sx * 0.85, h / 2, sz * 0.55], r: [0, 0, -sx * 0.3], s: [0.15, h, 0.15] });
    }
    p.push({ g: P.cyl6, c: COL.woodDark, p: [0, h - 0.06, 0], r: [0, 0, 1.57], s: [0.13, 2.4, 0.13] });
    for (const sx of [-1, 1]) p.push({ g: P.box, c: 0xc7a24d, p: [sx * 0.42, h * 0.6, 0], s: [0.05, h * 0.78, 0.05] });
    p.push({ g: P.box, c: l >= 2 ? COL.plank : COL.wood, p: [0, h * 0.22, 0], s: [1.0, 0.1, 0.42] });
    if (l >= 3) for (const sx of [-1, 1]) p.push({ g: P.box, c: 0xd23b32, p: [sx * 0.5, h * 0.35, 0], s: [0.06, 0.34, 0.34] });
    return assemble(p);
  };

  BM.hanglamp = function (l) {
    const p = [];
    const h = 2.6 + l * 0.25;
    p.push({ g: P.cyl6, c: COL.stoneDark, p: [0, 0.1, 0], s: [0.5, 0.2, 0.5] });
    p.push({ g: P.cyl6, c: COL.iron, p: [0, h / 2, 0], s: [0.13, h, 0.13] });
    // the crook at the top
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 1.4;
      p.push({ g: P.cyl6, c: COL.iron, p: [Math.sin(a) * 0.42, h - 0.02 + Math.cos(a) * 0.12, 0], r: [0, 0, -a], s: [0.1, 0.34, 0.1] });
    }
    const lx = 0.55;
    p.push({ g: P.box, c: COL.iron, p: [lx, h - 0.2, 0], s: [0.04, 0.3, 0.04] });
    const cols = [0xff8a3a, 0xd23b32, 0x3f7a9e, 0x8a3f6a];
    p.push({ g: P.taper(0.55, 0.95, 6), c: cols[(l - 1) % cols.length], glow: true, p: [lx, h - 0.58, 0], s: [0.46, 0.56, 0.46] });
    p.push({ g: P.cone5, c: COL.iron, p: [lx, h - 0.28, 0], s: [0.42, 0.2, 0.42] });
    p.push({ g: P.sph, c: COL.gold, p: [lx, h - 0.88, 0], s: [0.12, 0.14, 0.12] });
    return assemble(p, true);
  };

  BM.torch = function (l) {
    const p = [];
    const h = 1.9 + l * 0.2;
    p.push({ g: P.cyl6, c: COL.stoneDark, p: [0, 0.1, 0], s: [0.46, 0.2, 0.46] });
    p.push({ g: P.cyl6, c: COL.wood, p: [0, h / 2, 0], s: [0.16, h, 0.16] });
    p.push({ g: P.taper(0.95, 0.55, 6), c: COL.iron, p: [0, h + 0.14, 0], s: [0.4, 0.34, 0.4] });
    p.push({ g: P.cone5, c: 0xff7a1e, glow: true, p: [0, h + 0.48, 0], s: [0.36, 0.6, 0.36] });
    p.push({ g: P.cone5, c: 0xffd15c, glow: true, p: [0, h + 0.4, 0], s: [0.2, 0.4, 0.2] });
    return assemble(p, true);
  };

  BM.banner = function (l) {
    const p = [];
    const h = 4.0 + l * 0.6;
    p.push({ g: P.cyl6, c: COL.stoneDark, p: [0, 0.12, 0], s: [0.55, 0.24, 0.55] });
    p.push({ g: P.cyl6, c: COL.wood, p: [0, h / 2, 0], s: [0.13, h, 0.13] });
    p.push({ g: P.sph, c: COL.gold, p: [0, h + 0.15, 0], s: [0.22, 0.3, 0.22] });
    const cols = [0x2f7a4a, 0xd23b32, 0x3f5f9e];
    for (let i = 0; i < 4; i++) {
      p.push({ g: P.box, c: cols[(i + l) % cols.length], p: [0.55, h - 0.45 - i * 0.42, Math.sin(i * 0.9) * 0.12], r: [0, Math.sin(i * 0.9) * 0.18, 0], s: [1.0, 0.4, 0.05] });
    }
    if (l >= 2) p.push({ g: P.ico, c: COL.gold, p: [0.55, h - 1.1, 0.05], s: [0.24, 0.28, 0.06] });
    return assemble(p);
  };

  BM.signpost = function (l) {
    const p = [];
    p.push({ g: P.cyl6, c: COL.stoneDark, p: [0, 0.1, 0], s: [0.5, 0.2, 0.5] });
    p.push({ g: P.cyl6, c: COL.wood, p: [0, 1.2, 0], s: [0.15, 2.4, 0.15] });
    const dirs = [[1, 0.55], [-1, -0.9], [1, 2.2]];
    for (let i = 0; i < Math.min(3, 1 + l); i++) {
      const d = dirs[i % 3];
      p.push({ g: P.box, c: COL.plank, p: [d[0] * 0.5, 1.4 + i * 0.42, 0], r: [0, d[1], 0], s: [1.0, 0.28, 0.07] });
      p.push({ g: P.cone5, c: COL.plank, p: [d[0] * 1.0, 1.4 + i * 0.42, 0], r: [0, d[1], -d[0] * 1.57], s: [0.28, 0.3, 0.07] });
    }
    return assemble(p);
  };

  BM.paving = function (l) {
    const p = [];
    const shades = l >= 3 ? [COL.marble, 0xc8c4b8, TILE_LIGHT] : l >= 2 ? [0xa8a49a, 0x98948a, 0xb8b4aa] : [COL.stone, COL.stoneDark, 0x9a968c];
    for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 3; iz++) {
      p.push({
        g: P.box, c: shades[(ix + iz * 2) % shades.length],
        p: [-0.63 + ix * 0.63, 0.06, -0.63 + iz * 0.63], s: [0.58, 0.12, 0.58]
      });
    }
    return assemble(p, true);
  };

  BM.sundial = function (l) {
    const p = [];
    p.push({ g: P.cyl, c: COL.stoneDark, p: [0, 0.16, 0], s: [1.5, 0.32, 1.5] });
    p.push({ g: P.cyl, c: l >= 2 ? COL.marble : COL.stone, p: [0, 0.5, 0], s: [1.9, 0.4, 1.9] });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.283;
      p.push({ g: P.box, c: COL.stoneDark, p: [Math.cos(a) * 0.72, 0.71, Math.sin(a) * 0.72], r: [0, -a, 0], s: [0.28, 0.05, 0.07] });
    }
    p.push({ g: P.box, c: l >= 3 ? COL.gold : COL.iron, p: [0, 1.0, -0.15], r: [-0.7, 0, 0], s: [0.07, 1.0, 0.5] });
    return assemble(p);
  };

  BM.peacock = function (l) {
    const p = [];
    plinth(p, 1.3, 0.6);
    p.push({ g: P.ico, c: 0x2f7a8a, p: [0, 1.1, 0.1], s: [0.5, 0.62, 0.7] });
    p.push({ g: P.cyl6, c: 0x2f7a8a, p: [0, 1.55, 0.25], r: [0.3, 0, 0], s: [0.22, 0.7, 0.22] });
    p.push({ g: P.ico, c: 0x2f9ec4, p: [0, 1.92, 0.4], s: [0.3, 0.3, 0.36] });
    p.push({ g: P.cone5, c: COL.gold, p: [0, 1.9, 0.62], r: [1.57, 0, 0], s: [0.1, 0.24, 0.1] });
    for (let i = 0; i < 3; i++) p.push({ g: P.cyl4, c: 0x2fb0a0, p: [0, 2.16 + i * 0.04, 0.36 - i * 0.06], r: [-0.3, 0, (i - 1) * 0.4], s: [0.04, 0.28, 0.04] });
    // the fanned tail, in tiles
    const fan = 7 + l * 2;
    for (let i = 0; i < fan; i++) {
      const t = i / (fan - 1), a = (t - 0.5) * 2.3;
      const r = 1.5 + (l >= 2 ? 0.4 : 0);
      p.push({
        g: P.box, c: i % 2 ? TILE_BLUE : 0x2f9ec4,
        p: [Math.sin(a) * r * 0.8, 1.0 + Math.cos(a) * r * 0.72, -0.5], r: [0, 0, -a], s: [0.26, r * 1.1, 0.1]
      });
      p.push({
        g: P.ico, c: i % 2 ? COL.gold : 0x8a3f6a,
        p: [Math.sin(a) * r * 1.3, 1.0 + Math.cos(a) * r * 1.18, -0.46], s: [0.2, 0.24, 0.08]
      });
    }
    return assemble(p);
  };

  BM.carpetstand = function (l) {
    const p = [];
    for (const sx of [-1, 1]) {
      p.push({ g: P.cyl6, c: COL.woodDark, p: [sx * 0.9, 1.05, 0], s: [0.14, 2.1, 0.14] });
      p.push({ g: P.box, c: COL.woodDark, p: [sx * 0.9, 0.08, 0], s: [0.4, 0.16, 0.9] });
    }
    p.push({ g: P.cyl6, c: COL.wood, p: [0, 2.05, 0], r: [0, 0, 1.57], s: [0.11, 2.1, 0.11] });
    // the carpet itself: a field of knots in madder red and indigo
    const rows = 5 + l, cols = 6;
    const pal = [0x9e2b2b, 0x2f4a7a, 0xc7a24d, 0xe8dcc4, 0x3f6f45];
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      const border = (r === 0 || r === rows - 1 || c2 === 0 || c2 === cols - 1);
      const mid = (r === ((rows / 2) | 0) && c2 === ((cols / 2) | 0));
      p.push({
        g: P.box, c: border ? pal[1] : (mid ? pal[2] : pal[(r + c2) % 2 ? 0 : 3]),
        p: [-0.72 + c2 * 0.29, 1.85 - r * 0.26, 0.06], s: [0.28, 0.25, 0.05]
      });
    }
    if (l >= 2) for (let i = 0; i < 6; i++) p.push({ g: P.box, c: 0xe8dcc4, p: [-0.72 + i * 0.29, 1.85 - rows * 0.26 - 0.08, 0.06], s: [0.05, 0.16, 0.04] });
    return assemble(p);
  };

  BM.topiary = function (l) {
    const p = [];
    p.push({ g: P.taper(0.75, 1, 8), c: 0xa8663a, p: [0, 0.24, 0], s: [0.8, 0.48, 0.8] });
    p.push({ g: P.cyl6, c: COL.woodDark, p: [0, 0.66, 0], s: [0.14, 0.5, 0.14] });
    p.push({ g: P.sph, c: 0x3f7a3c, p: [0, 1.05, 0], s: [0.85, 0.8, 0.85] });
    if (l >= 2) p.push({ g: P.sph, c: 0x4c8c45, p: [0, 1.62, 0], s: [0.6, 0.56, 0.6] });
    if (l >= 3) p.push({ g: P.sph, c: 0x3f7a3c, p: [0, 2.05, 0], s: [0.4, 0.38, 0.4] });
    return assemble(p);
  };

  BM.birdbath = function (l) {
    const p = [];
    p.push({ g: P.cyl, c: COL.stoneDark, p: [0, 0.1, 0], s: [1.1, 0.2, 1.1] });
    p.push({ g: P.cyl6, c: l >= 2 ? COL.marble : COL.stone, p: [0, 0.62, 0], s: [0.34, 0.9, 0.34] });
    p.push({ g: P.cyl, c: l >= 2 ? COL.marble : COL.stone, p: [0, 1.14, 0], s: [1.5, 0.22, 1.5] });
    p.push({ g: P.cyl, c: TILE_BLUE, p: [0, 1.23, 0], s: [1.25, 0.08, 1.25] });
    p.push({ g: P.cyl, c: WATER_BLUE, glow: true, p: [0, 1.28, 0], s: [1.15, 0.04, 1.15] });
    if (l >= 2) {
      // a sparrow on the rim
      p.push({ g: P.ico, c: 0x8a7a5a, p: [0.55, 1.4, 0.2], s: [0.2, 0.2, 0.28] });
      p.push({ g: P.ico, c: 0x8a7a5a, p: [0.55, 1.54, 0.3], s: [0.14, 0.14, 0.14] });
      p.push({ g: P.cone5, c: 0xe8a020, p: [0.55, 1.54, 0.4], r: [1.57, 0, 0], s: [0.05, 0.1, 0.05] });
    }
    return assemble(p);
  };

  BM.brazier = function (l) {
    const p = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 6.283;
      p.push({ g: P.cyl6, c: COL.iron, p: [Math.cos(a) * 0.42, 0.5, Math.sin(a) * 0.42], r: [Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28], s: [0.11, 1.0, 0.11] });
    }
    p.push({ g: P.taper(1, 0.55, 8), c: l >= 2 ? 0xb87333 : COL.iron, p: [0, 1.15, 0], s: [1.3, 0.5, 1.3] });
    p.push({ g: P.cyl, c: 0x2a2a2a, p: [0, 1.3, 0], s: [1.1, 0.12, 1.1] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 3.14;
      p.push({ g: P.cyl6, c: COL.woodDark, p: [Math.cos(a) * 0.16, 1.45, Math.sin(a) * 0.16], r: [Math.sin(a) * 0.5, a, Math.cos(a) * 0.5], s: [0.12, 0.55, 0.12] });
    }
    p.push({ g: P.cone5, c: 0xff7a1e, glow: true, p: [0, 1.82, 0], s: [0.62, 0.85, 0.62] });
    p.push({ g: P.cone5, c: 0xffd15c, glow: true, p: [0, 1.72, 0], s: [0.36, 0.6, 0.36] });
    if (l >= 3) p.push({ g: P.cone5, c: 0xfff0b0, glow: true, p: [0, 1.64, 0], s: [0.2, 0.4, 0.2] });
    return assemble(p, true);
  };

  BM.bellarch = function (l) {
    const p = [];
    const h = 2.8;
    for (const sx of [-1, 1]) p.push({ g: P.cyl6, c: COL.wood, p: [sx * 0.8, h / 2, 0], s: [0.17, h, 0.17] });
    p.push({ g: P.box, c: COL.woodDark, p: [0, h + 0.06, 0], s: [2.1, 0.18, 0.24] });
    gable(p, 0, h + 0.15, 0, 2.3, 1.1, 0.45, COL.thatch);
    const n = Math.min(3, l);
    for (let i = 0; i < n; i++) {
      const bx = (i - (n - 1) / 2) * 0.62;
      p.push({ g: P.box, c: 0x8a6034, p: [bx, h - 0.18, 0], s: [0.04, 0.3, 0.04] });
      p.push({ g: P.taper(0.35, 1, 8), c: COL.gold, p: [bx, h - 0.55, 0], s: [0.44, 0.5, 0.44] });
      p.push({ g: P.sph, c: 0xb87333, p: [bx, h - 0.84, 0], s: [0.14, 0.16, 0.14] });
    }
    return assemble(p);
  };

  M.BUILDERS = BM;

  /** main entry: build a building model by definition + level */
  M.building = function (defId, level, mask, variant) {
    const def = C.BUILDINGS[defId];
    const fn = BM[def.model] || BM.shed;
    const g = fn(level || 1, def, mask, variant || 0);
    g.userData.defId = defId;
    return g;
  };

  /* =========================================================
     ANIMALS — generic quadruped with animated legs
     ========================================================= */
  const ANIM_STYLE = {
    rabbit: { body: 0xb8a894, belly: 0xe8e0d4, bl: 0.7, bh: 0.5, bw: 0.5, leg: 0.28, ear: 'long', tail: 'puff', head: 0.42 },
    chicken: { body: 0xe8e2d4, belly: 0xffffff, bl: 0.5, bh: 0.5, bw: 0.42, leg: 0.34, ear: 'beak', tail: 'fan', head: 0.34, legs: 2 },
    deer: { body: 0xa87a4a, belly: 0xd8c0a0, bl: 1.5, bh: 0.85, bw: 0.7, leg: 0.95, ear: 'up', tail: 'small', head: 0.5, antler: true, neck: 0.8 },
    fox: { body: 0xd06a2a, belly: 0xf0e4d4, bl: 1.1, bh: 0.55, bw: 0.48, leg: 0.42, ear: 'up', tail: 'bushy', head: 0.42 },
    boar: { body: 0x6a5240, belly: 0x4a3a2c, bl: 1.4, bh: 0.85, bw: 0.8, leg: 0.5, ear: 'up', tail: 'small', head: 0.55, tusk: true },
    wolf: { body: 0x7a7f88, belly: 0xb8bcc4, bl: 1.35, bh: 0.72, bw: 0.58, leg: 0.62, ear: 'up', tail: 'bushy', head: 0.46 },
    bear: { body: 0x4a3628, belly: 0x5e4636, bl: 1.7, bh: 1.1, bw: 1.0, leg: 0.68, ear: 'round', tail: 'small', head: 0.66 }
  };

  M.animal = function (type, tint, scale) {
    /* the White Div is built at his own scale and animated by the same
       leg/head rig every other creature uses */
    if (type === 'div') return M.div();
    const base = ANIM_STYLE[type] || ANIM_STYLE.wolf;
    // a tint lets one model serve several species (wolf vs dire wolf)
    const s = tint ? Object.assign({}, base, { body: tint }) : base;
    const g = new THREE.Group();
    const legY = s.leg;

    /* body + head as one merged mesh */
    const bp = [];
    bp.push({ g: P.ico, c: s.body, p: [0, legY + s.bh * 0.5, 0], s: [s.bw, s.bh, s.bl] });
    bp.push({ g: P.ico, c: s.belly, p: [0, legY + s.bh * 0.28, 0], s: [s.bw * 0.85, s.bh * 0.5, s.bl * 0.85] });
    g.add(assemble(bp));

    /* head group (can look around) */
    const hp = [];
    const hy = legY + s.bh * (s.neck ? 1.15 : 0.72);
    const hz = s.bl * 0.55;
    if (s.neck) {
      hp.push({ g: P.cyl6, c: s.body, p: [0, -s.neck * 0.4, -0.12], r: [0.5, 0, 0], s: [0.28, s.neck, 0.28] });
    }
    hp.push({ g: P.ico, c: s.body, p: [0, 0, 0.05], s: [s.head, s.head * 0.9, s.head * 1.25] });
    hp.push({ g: P.box, c: s.belly, p: [0, -s.head * 0.15, s.head * 0.72], s: [s.head * 0.45, s.head * 0.35, s.head * 0.5] });
    // eyes
    for (const sx of [-1, 1]) hp.push({ g: P.sph, c: 0x151515, p: [sx * s.head * 0.35, s.head * 0.15, s.head * 0.5], s: [0.11, 0.11, 0.08] });
    // ears
    if (s.ear === 'long') for (const sx of [-1, 1]) hp.push({ g: P.ico, c: s.body, p: [sx * 0.15, s.head * 0.9, -0.05], r: [0.2, 0, sx * 0.2], s: [0.16, 0.55, 0.16] });
    if (s.ear === 'up') for (const sx of [-1, 1]) hp.push({ g: P.cone5, c: s.body, p: [sx * s.head * 0.5, s.head * 0.6, -0.05], s: [0.22, 0.3, 0.22] });
    if (s.ear === 'round') for (const sx of [-1, 1]) hp.push({ g: P.sph, c: s.body, p: [sx * s.head * 0.6, s.head * 0.6, -0.05], s: [0.24, 0.24, 0.14] });
    if (s.ear === 'beak') {
      hp.push({ g: P.cone5, c: 0xe8a020, p: [0, 0, s.head * 0.75], r: [Math.PI / 2, 0, 0], s: [0.16, 0.28, 0.16] });
      hp.push({ g: P.ico, c: 0xd23b32, p: [0, s.head * 0.7, 0.05], s: [0.14, 0.26, 0.2] });
    }
    if (s.tusk) for (const sx of [-1, 1]) hp.push({ g: P.cone5, c: 0xe8e2d0, p: [sx * 0.2, -0.1, s.head * 0.7], r: [-0.6, 0, 0], s: [0.09, 0.28, 0.09] });
    if (s.antler) for (const sx of [-1, 1]) {
      hp.push({ g: P.cyl4, c: 0x8a6a3a, p: [sx * 0.2, s.head * 0.85, -0.05], r: [0, 0, sx * 0.35], s: [0.08, 0.6, 0.08] });
      hp.push({ g: P.cyl4, c: 0x8a6a3a, p: [sx * 0.42, s.head * 1.2, 0.05], r: [0.4, 0, sx * 0.7], s: [0.07, 0.42, 0.07] });
      hp.push({ g: P.cyl4, c: 0x8a6a3a, p: [sx * 0.38, s.head * 1.25, -0.25], r: [-0.5, 0, sx * 0.6], s: [0.07, 0.38, 0.07] });
    }
    const head = assemble(hp, true);
    head.position.set(0, hy, hz);
    g.add(head);
    g.userData.head = head;

    /* tail */
    const tp = [];
    if (s.tail === 'puff') tp.push({ g: P.sph, c: 0xffffff, p: [0, 0, 0], s: [0.28, 0.28, 0.28] });
    else if (s.tail === 'bushy') tp.push({ g: P.ico, c: s.body, p: [0, 0.05, -0.3], r: [0.5, 0, 0], s: [0.28, 0.28, 0.75] });
    else if (s.tail === 'fan') for (let i = 0; i < 4; i++) tp.push({ g: P.box, c: s.body, p: [0, 0.15 + i * 0.06, -0.2], r: [-0.6 - i * 0.12, 0, 0], s: [0.28, 0.05, 0.5] });
    else tp.push({ g: P.cyl4, c: s.body, p: [0, 0.05, -0.15], r: [-0.9, 0, 0], s: [0.09, 0.36, 0.09] });
    const tail = assemble(tp, true);
    tail.position.set(0, legY + s.bh * 0.55, -s.bl * 0.52);
    g.add(tail);
    g.userData.tail = tail;

    /* legs — separate meshes so they can swing */
    const legs = [];
    const nLegs = s.legs === 2 ? 2 : 4;
    const legGeo = merge([{ g: P.cyl6, c: s.body, p: [0, -legY / 2, 0], s: [0.19 * (s.bw / 0.6), legY, 0.19 * (s.bw / 0.6)] },
    { g: P.box, c: 0x35302a, p: [0, -legY + 0.04, 0.04], s: [0.24, 0.12, 0.3] }]);
    for (let i = 0; i < nLegs; i++) {
      const mesh = new THREE.Mesh(legGeo, MAT.solid);
      mesh.castShadow = true;
      const fx = nLegs === 2 ? 0 : (i < 2 ? 1 : -1);
      mesh.position.set((i % 2 ? 1 : -1) * s.bw * 0.42, legY, fx * s.bl * 0.34);
      mesh.userData.phase = (i % 2 ? 0 : Math.PI) + (i < 2 ? 0 : Math.PI);
      g.add(mesh);
      legs.push(mesh);
    }
    g.userData.legs = legs;
    g.userData.style = s;
    return g;
  };

  /* =========================================================
     HUMANOID (player + villagers)
     ========================================================= */
  M.humanoid = function (opt) {
    opt = opt || {};
    const skin = opt.skin || 0xe0ac7e;
    const shirt = opt.shirt || 0x3f7a9e;
    const pants = opt.pants || 0x4a4438;
    const hat = opt.hat === undefined ? 0xc7a24d : opt.hat;
    const g = new THREE.Group();

    /* torso */
    const tp = [];
    tp.push({ g: P.box, c: shirt, p: [0, 0.32, 0], s: [0.62, 0.68, 0.36] });
    tp.push({ g: P.box, c: pants, p: [0, -0.05, 0], s: [0.64, 0.22, 0.38] });
    if (opt.apron) tp.push({ g: P.box, c: 0xd8d2c0, p: [0, 0.25, 0.2], s: [0.44, 0.6, 0.04] });
    if (opt.gem) {
      // a hired specialist wears a diamond at the collar
      tp.push({ g: P.box, c: 0xdcecf4, p: [0, 0.58, 0], s: [0.66, 0.1, 0.4] });
      tp.push({ g: P.ico, c: 0x9fe8ff, glow: true, p: [0, 0.5, 0.2], s: [0.17, 0.22, 0.17] });
      for (const sx of [-1, 1]) {
        tp.push({ g: P.box, c: 0xdcecf4, p: [sx * 0.33, 0.34, 0], s: [0.06, 0.62, 0.37] });
      }
    }
    const torso = assemble(tp, false);
    torso.position.y = 0.86;
    g.add(torso);

    /* head */
    const hp = [];
    hp.push({ g: P.box, c: skin, p: [0, 0.22, 0], s: [0.42, 0.44, 0.4] });
    hp.push({ g: P.box, c: opt.hair || 0x4a3628, p: [0, 0.42, -0.02], s: [0.45, 0.14, 0.43] });
    for (const sx of [-1, 1]) hp.push({ g: P.sph, c: 0x1a1a1a, p: [sx * 0.11, 0.25, 0.2], s: [0.08, 0.09, 0.06] });
    hp.push({ g: P.box, c: 0xc98a6a, p: [0, 0.14, 0.21], s: [0.12, 0.05, 0.04] });
    if (hat !== null) {
      hp.push({ g: P.cyl, c: hat, p: [0, 0.48, 0], s: [0.78, 0.08, 0.78] });
      hp.push({ g: P.cyl, c: hat, p: [0, 0.56, 0], s: [0.44, 0.2, 0.44] });
    }
    const head = assemble(hp, false);
    head.position.y = 1.34;
    g.add(head);

    /* arms & legs */
    function limb(color, len, w) {
      const geo = merge([{ g: P.box, c: color, p: [0, -len / 2, 0], s: [w, len, w] },
      { g: P.box, c: skin, p: [0, -len + 0.06, 0], s: [w * 0.95, 0.14, w * 0.95] }]);
      const m = new THREE.Mesh(geo, MAT.solid);
      m.castShadow = true;
      return m;
    }
    const armL = limb(shirt, 0.6, 0.19), armR = limb(shirt, 0.6, 0.19);
    armL.position.set(-0.4, 1.16, 0); armR.position.set(0.4, 1.16, 0);
    const legL = limb(pants, 0.62, 0.22), legR = limb(pants, 0.62, 0.22);
    legL.position.set(-0.16, 0.64, 0); legR.position.set(0.16, 0.64, 0);
    g.add(armL, armR, legL, legR);

    /* held tool anchor */
    const hand = new THREE.Group();
    hand.position.set(0, -0.55, 0);
    armR.add(hand);

    g.userData = { torso, head, armL, armR, legL, legR, hand };
    return g;
  };

  /* held tool models (small, attached to the hand) */
  M.toolModel = function (id, level) {
    const p = [];
    const metal = level >= 4 ? COL.gold : (level >= 2 ? 0xc8ccd4 : COL.iron);
    switch (id) {
      case 'axe':
        p.push({ g: P.cyl6, c: COL.wood, p: [0, 0.25, 0], s: [0.07, 1.0, 0.07] });
        p.push({ g: P.box, c: metal, p: [0.14, 0.68, 0], r: [0, 0, -0.2], s: [0.34, 0.3, 0.09] });
        p.push({ g: P.box, c: metal, p: [-0.08, 0.66, 0], s: [0.16, 0.16, 0.11] });
        break;
      case 'pickaxe':
        p.push({ g: P.cyl6, c: COL.wood, p: [0, 0.25, 0], s: [0.07, 1.0, 0.07] });
        p.push({ g: P.box, c: metal, p: [0, 0.7, 0], r: [0, 0, 0.15], s: [0.9, 0.11, 0.11] });
        p.push({ g: P.cone5, c: metal, p: [0.42, 0.62, 0], r: [0, 0, -1.2], s: [0.13, 0.24, 0.13] });
        p.push({ g: P.cone5, c: metal, p: [-0.42, 0.76, 0], r: [0, 0, 1.2], s: [0.13, 0.24, 0.13] });
        break;
      case 'hoe':
        p.push({ g: P.cyl6, c: COL.wood, p: [0, 0.25, 0], s: [0.07, 1.0, 0.07] });
        p.push({ g: P.box, c: metal, p: [0.16, 0.68, 0], r: [0, 0, 0.5], s: [0.38, 0.1, 0.22] });
        break;
      case 'sword':
        p.push({ g: P.box, c: COL.woodDark, p: [0, 0, 0], s: [0.1, 0.26, 0.1] });
        p.push({ g: P.box, c: metal, p: [0, 0.18, 0], s: [0.34, 0.08, 0.11] });
        p.push({ g: P.box, c: metal, p: [0, 0.68, 0], s: [0.13, 1.0, 0.05] });
        p.push({ g: P.cone5, c: metal, p: [0, 1.22, 0], s: [0.13, 0.2, 0.05] });
        break;
      case 'bow':
        for (let i = -2; i <= 2; i++) {
          p.push({ g: P.box, c: COL.wood, p: [0, i * 0.22, Math.abs(i) * 0.05 - 0.1], r: [i * 0.22, 0, 0], s: [0.07, 0.25, 0.07] });
        }
        p.push({ g: P.box, c: 0xe8e0d0, p: [0, 0, 0.03], s: [0.02, 1.15, 0.02] });
        break;
      case 'rod':
        p.push({ g: P.taper(0.3, 1, 5), c: COL.wood, p: [0, 0.5, 0], r: [-0.4, 0, 0], s: [0.06, 1.5, 0.06] });
        p.push({ g: P.cyl, c: metal, p: [0, 0.12, 0.06], r: [Math.PI / 2, 0, 0], s: [0.16, 0.1, 0.16] });
        break;
      case 'can':
        p.push({ g: P.cyl, c: metal, p: [0, 0.2, 0], s: [0.36, 0.4, 0.36] });
        p.push({ g: P.cyl6, c: metal, p: [0.28, 0.3, 0], r: [0, 0, -0.7], s: [0.09, 0.5, 0.09] });
        p.push({ g: P.cyl, c: metal, p: [0.42, 0.42, 0], s: [0.16, 0.1, 0.16] });
        p.push({ g: P.box, c: metal, p: [-0.22, 0.42, 0], r: [0, 0, 0.4], s: [0.06, 0.3, 0.06] });
        break;
      case 'seeds':
        p.push({ g: P.box, c: 0xc7a24d, p: [0, 0.16, 0], s: [0.3, 0.34, 0.22] });
        p.push({ g: P.sph, c: 0x8fbf5c, p: [0, 0.34, 0], s: [0.2, 0.12, 0.16] });
        break;
      case 'food':
        p.push({ g: P.ico, c: 0xd8a05a, p: [0, 0.14, 0], s: [0.34, 0.24, 0.3] });
        break;
      case 'tar':
        /* a long-necked tar: two joined bowls, a skin face and a fretted neck */
        p.push({ g: P.sph, c: 0x6b4a2c, p: [0, 0.06, 0], s: [0.4, 0.34, 0.24] });
        p.push({ g: P.sph, c: 0x6b4a2c, p: [0, 0.34, 0], s: [0.3, 0.28, 0.2] });
        p.push({ g: P.sph, c: 0xe8dcc4, p: [0, 0.1, 0.1], s: [0.34, 0.26, 0.1] });
        p.push({ g: P.box, c: COL.woodDark, p: [0, 0.78, 0], s: [0.1, 0.72, 0.07] });
        p.push({ g: P.box, c: 0x2a2a2a, p: [0, 1.16, 0], s: [0.13, 0.2, 0.09] });
        for (const sx of [-1, 1]) p.push({ g: P.cyl4, c: COL.gold, p: [sx * 0.1, 1.18, 0], r: [0, 0, 1.57], s: [0.04, 0.14, 0.04] });
        p.push({ g: P.box, c: 0xf0e8d0, p: [0, 0.6, 0.05], s: [0.03, 1.1, 0.02] });
        break;
      default:
        return null;
    }
    return assemble(p, true);
  };

  /* =========================================================
     VEHICLES
     ========================================================= */
  M.boat = function (level) {
    const p = [];
    const l = 4.2 + (level - 1) * 0.5, w = 1.9;
    const hull = level >= 3 ? COL.plank : COL.wood;
    // hull: stacked planks tapering to a point at the bow
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      p.push({ g: P.box, c: i % 2 ? hull : COL.woodDark, p: [0, 0.24 + i * 0.17, 0], s: [w - t * 0.35, 0.18, l - t * 0.5] });
    }
    p.push({ g: P.cone5, c: hull, p: [0, 0.5, l * 0.55], r: [Math.PI / 2, 0, 0], s: [w * 0.55, 1.1, 0.7] });
    p.push({ g: P.box, c: COL.woodDark, p: [0, 0.18, 0], s: [w * 0.9, 0.14, l * 0.96] });
    // benches
    for (const z of [-l * 0.22, l * 0.14]) p.push({ g: P.box, c: COL.plank, p: [0, 0.72, z], s: [w * 0.85, 0.12, 0.45] });
    // oars
    for (const sx of [-1, 1]) {
      p.push({ g: P.cyl6, c: COL.wood, p: [sx * (w * 0.6), 0.78, -0.2], r: [0, 0, sx * 1.15], s: [0.1, 2.0, 0.1] });
      p.push({ g: P.box, c: COL.woodDark, p: [sx * (w * 0.6 + 0.85), 0.42, -0.2], r: [0, 0, sx * 1.15], s: [0.14, 0.6, 0.34] });
    }
    if (level >= 2) {
      p.push({ g: P.cyl6, c: COL.wood, p: [0, 1.9, -l * 0.1], s: [0.13, 2.6, 0.13] });
      p.push({ g: P.box, c: COL.cloth, p: [0, 2.1, -l * 0.1 + 0.35], s: [0.06, 1.8, 1.5] });
    }
    if (level >= 3) p.push({ g: P.box, c: 0xd23b32, p: [0, 1.0, l * 0.3], s: [w * 0.7, 0.1, 0.5] });
    const g = assemble(p);
    g.userData.length = l;
    return g;
  };

  M.car = function (level) {
    const p = [];
    const body = [0xc0392b, 0x2e6da4, 0x2f8f4e, 0xd9a520, 0x8e44ad][Math.min(4, level - 1)];
    const l = 4.0, w = 2.0;
    p.push({ g: P.box, c: body, p: [0, 0.72, 0], s: [w, 0.62, l] });
    p.push({ g: P.box, c: body, p: [0, 1.22, -0.25], s: [w * 0.86, 0.55, l * 0.44] });
    // glass
    p.push({ g: P.box, c: COL.glass, p: [0, 1.24, -0.25 + l * 0.22], s: [w * 0.78, 0.42, 0.06] });
    p.push({ g: P.box, c: COL.glass, p: [0, 1.24, -0.25 - l * 0.22], s: [w * 0.78, 0.42, 0.06] });
    for (const sx of [-1, 1]) p.push({ g: P.box, c: COL.glass, p: [sx * w * 0.44, 1.24, -0.25], s: [0.06, 0.4, l * 0.4] });
    // bumpers + lights
    p.push({ g: P.box, c: COL.iron, p: [0, 0.55, l * 0.51], s: [w * 0.98, 0.22, 0.16] });
    p.push({ g: P.box, c: COL.iron, p: [0, 0.55, -l * 0.51], s: [w * 0.98, 0.22, 0.16] });
    for (const sx of [-1, 1]) {
      p.push({ g: P.box, c: 0xfff0b0, glow: true, p: [sx * w * 0.32, 0.82, l * 0.5], s: [0.4, 0.24, 0.08] });
      p.push({ g: P.box, c: 0xd23b32, glow: true, p: [sx * w * 0.32, 0.82, -l * 0.5], s: [0.34, 0.18, 0.08] });
    }
    // wheels
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      p.push({
        g: P.cyl, c: 0x232323, p: [sx * (w * 0.5 + 0.06), 0.42, sz * l * 0.3],
        r: [0, 0, Math.PI / 2], s: [0.84, 0.26, 0.84]
      });
      p.push({
        g: P.cyl, c: 0xb8b8b8, p: [sx * (w * 0.5 + 0.14), 0.42, sz * l * 0.3],
        r: [0, 0, Math.PI / 2], s: [0.42, 0.1, 0.42]
      });
    }
    if (level >= 3) {
      p.push({ g: P.box, c: COL.iron, p: [0, 1.56, -0.25], s: [w * 0.7, 0.1, 1.0] });
      p.push({ g: P.box, c: COL.woodDark, p: [0, 1.7, -0.25], s: [w * 0.62, 0.2, 0.85] });
    }
    if (level >= 4) p.push({ g: P.box, c: COL.gold, p: [0, 1.0, l * 0.47], s: [w * 0.5, 0.12, 0.1] });
    if (level >= 5) for (const sx of [-1, 1]) {
      p.push({ g: P.box, c: 0x9fd8e8, glow: true, p: [sx * w * 0.52, 0.5, 0], s: [0.06, 0.08, l * 0.7] });
    }
    return assemble(p);
  };

  /** rider on a horse — used by the recruiter expeditions */
  M.horseRider = function (level) {
    const g = new THREE.Group();
    const p = [];
    const coat = [0x6b4a2c, 0x3a2a1e, 0xd8c8a8, 0x8a8a8a, 0x1e1e1e][Math.min(4, level - 1)];
    // horse body + neck + head
    p.push({ g: P.ico, c: coat, p: [0, 1.05, 0], s: [0.85, 0.95, 2.0] });
    p.push({ g: P.cyl6, c: coat, p: [0, 1.5, 0.75], r: [0.55, 0, 0], s: [0.42, 1.1, 0.42] });
    p.push({ g: P.ico, c: coat, p: [0, 1.95, 1.15], s: [0.4, 0.42, 0.8] });
    p.push({ g: P.box, c: 0x2a2a2a, p: [0, 1.85, 1.5], s: [0.26, 0.2, 0.22] });
    for (const sx of [-1, 1]) p.push({ g: P.cone5, c: coat, p: [sx * 0.16, 2.2, 1.0], s: [0.14, 0.26, 0.14] });
    // mane + tail
    for (let i = 0; i < 4; i++) p.push({ g: P.box, c: 0x2a1c12, p: [0, 1.65 + i * 0.13, 0.95 - i * 0.2], s: [0.14, 0.26, 0.2] });
    p.push({ g: P.cone5, c: 0x2a1c12, p: [0, 1.2, -1.05], r: [-0.6, 0, 0], s: [0.26, 0.9, 0.26] });
    // saddle
    p.push({ g: P.box, c: 0x6a3a1e, p: [0, 1.55, -0.1], s: [0.7, 0.16, 0.8] });
    const horse = assemble(p);
    g.add(horse);
    // legs
    const legGeo = merge([{ g: P.cyl6, c: coat, p: [0, -0.42, 0], s: [0.2, 0.92, 0.2] },
    { g: P.box, c: 0x2a2a2a, p: [0, -0.86, 0.02], s: [0.24, 0.14, 0.28] }]);
    const legs = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(legGeo, MAT.solid);
      m.castShadow = true;
      m.position.set((i % 2 ? 1 : -1) * 0.34, 1.0, (i < 2 ? 1 : -1) * 0.65);
      m.userData.phase = (i % 2 ? 0 : Math.PI) + (i < 2 ? 0 : Math.PI);
      g.add(m); legs.push(m);
    }
    g.userData.legs = legs;
    // rider
    const rider = M.humanoid({ shirt: 0x4a5a8a, pants: 0x3a3226, hat: 0x7a4a24 });
    rider.position.set(0, 1.62, -0.1);
    rider.scale.setScalar(0.9);
    rider.userData.legL.rotation.x = -1.3;
    rider.userData.legR.rotation.x = -1.3;
    rider.userData.armL.rotation.x = -1.1;
    rider.userData.armR.rotation.x = -1.1;
    g.add(rider);
    g.userData.rider = rider;
    return g;
  };

  /* =========================================================
     MISC FX
     ========================================================= */
  M.arrow = function () {
    const p = [];
    p.push({ g: P.cyl6, c: COL.wood, p: [0, 0, 0], r: [Math.PI / 2, 0, 0], s: [0.045, 1.0, 0.045] });
    p.push({ g: P.cone5, c: 0xd0d4da, p: [0, 0, 0.55], r: [Math.PI / 2, 0, 0], s: [0.1, 0.24, 0.1] });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 6.283;
      p.push({ g: P.box, c: 0xf0e8d8, p: [Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.42], r: [0, 0, a], s: [0.02, 0.16, 0.22] });
    }
    return assemble(p, true);
  };

  /* =========================================================
     MYTH — the Simorgh, the White Div, and the two companions
     ========================================================= */

  /** سیمرغ: a bird the size of a house, all copper and peacock-blue,
      with wings that beat and a plume of tail feathers behind her. */
  M.simorgh = function () {
    const g = new THREE.Group();
    const body = 0xb87333, under = 0xd8a05a, jewel = 0x2f7a8a, flame = 0xf0c437;

    const bp = [];
    bp.push({ g: P.ico, c: body, p: [0, 0, 0], s: [2.2, 2.0, 4.6] });
    bp.push({ g: P.ico, c: under, p: [0, -0.55, 0.3], s: [1.8, 1.1, 3.6] });
    // neck and head, held high
    bp.push({ g: P.cyl6, c: body, p: [0, 1.5, 1.9], r: [0.5, 0, 0], s: [0.85, 2.4, 0.85] });
    bp.push({ g: P.ico, c: jewel, p: [0, 2.7, 2.85], s: [0.95, 0.95, 1.35] });
    bp.push({ g: P.cone5, c: flame, p: [0, 2.55, 3.7], r: [1.35, 0, 0], s: [0.34, 0.95, 0.34] });
    for (const sx of [-1, 1]) bp.push({ g: P.sph, c: flame, glow: true, p: [sx * 0.42, 2.9, 3.15], s: [0.24, 0.26, 0.18] });
    // the crest
    for (let i = 0; i < 4; i++) {
      bp.push({ g: P.cone5, c: i % 2 ? flame : jewel, p: [0, 3.2 + i * 0.06, 2.75 - i * 0.32], r: [-0.5 - i * 0.15, 0, 0], s: [0.14, 0.85, 0.14] });
    }
    // legs, tucked but visible
    for (const sx of [-1, 1]) {
      bp.push({ g: P.cyl6, c: 0x8a6a3a, p: [sx * 0.7, -1.2, -0.2], r: [0.3, 0, 0], s: [0.3, 1.3, 0.3] });
      for (let t = -1; t <= 1; t++) bp.push({ g: P.cone5, c: 0x6a5238, p: [sx * 0.7 + t * 0.2, -1.85, 0.35], r: [1.3, 0, 0], s: [0.14, 0.6, 0.14] });
    }
    // the long tail plumes
    for (let i = 0; i < 7; i++) {
      const t = (i - 3) / 3;
      bp.push({ g: P.box, c: i % 2 ? jewel : body, p: [t * 1.1, -0.1 + Math.abs(t) * 0.35, -3.6 - Math.abs(t) * 0.3], r: [0.12, t * 0.22, 0], s: [0.34, 0.1, 3.2] });
      bp.push({ g: P.ico, c: flame, glow: true, p: [t * 1.7, -0.05 + Math.abs(t) * 0.5, -5.2 - Math.abs(t) * 0.4], s: [0.4, 0.12, 0.55] });
    }
    g.add(assemble(bp));

    /* wings hinge at the shoulders so they can beat */
    const wings = [];
    for (const sx of [-1, 1]) {
      const wp = [];
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        wp.push({
          g: P.box, c: i % 2 ? body : jewel,
          p: [sx * (0.8 + t * 4.4), -t * 0.5, 0.6 - t * 1.1],
          r: [0, sx * t * 0.25, sx * -t * 0.22],
          s: [1.7, 0.16, 3.4 - t * 1.8]
        });
      }
      for (let i = 0; i < 5; i++) {
        wp.push({ g: P.box, c: flame, p: [sx * (2.0 + i * 0.9), -0.45 - i * 0.1, -1.4 - i * 0.28], r: [0, sx * 0.2, 0], s: [0.7, 0.1, 2.4] });
      }
      const w = assemble(wp, true);
      g.add(w);
      wings.push(w);
    }
    g.userData.wings = wings;
    g.userData.isSimorgh = true;
    return g;
  };

  /** دیو سپید: a chalk-white ogre, horned and chained, three times your height. */
  /* Everything below is laid out around his hips, which puts the soles of
     his feet 1.8 under the origin — so the whole rig is lifted by that much
     and he stands ON the ground instead of shin-deep in it. */
  const DIV_LIFT = 1.82;
  M.div = function () {
    const g = new THREE.Group();
    const skin = 0xd8d4c8, dark = 0x9a968a, iron = 0x4a4a52, eye = 0xd23b32;

    const bp = [];
    bp.push({ g: P.ico, c: skin, p: [0, 2.55, 0], s: [2.3, 2.3, 1.7] });            // chest
    bp.push({ g: P.ico, c: dark, p: [0, 1.55, 0.1], s: [2.0, 1.3, 1.5] });          // gut
    bp.push({ g: P.box, c: iron, p: [0, 2.4, 0], r: [0, 0, 0.35], s: [2.6, 0.28, 1.8] });  // chains
    bp.push({ g: P.box, c: iron, p: [0, 2.0, 0], r: [0, 0, -0.3], s: [2.5, 0.24, 1.8] });
    // head
    bp.push({ g: P.ico, c: skin, p: [0, 4.15, 0.1], s: [1.35, 1.35, 1.3] });
    bp.push({ g: P.box, c: dark, p: [0, 3.85, 0.65], s: [0.9, 0.5, 0.5] });
    for (const sx of [-1, 1]) {
      bp.push({ g: P.sph, c: eye, glow: true, p: [sx * 0.36, 4.35, 0.6], s: [0.3, 0.26, 0.16] });
      // horns, curling back
      for (let i = 0; i < 4; i++) {
        bp.push({
          g: P.cone5, c: 0x3a3630,
          p: [sx * (0.75 + i * 0.24), 4.85 + i * 0.32, -i * 0.28],
          r: [-0.35 - i * 0.2, 0, sx * (0.4 + i * 0.12)], s: [0.42 - i * 0.06, 0.62, 0.42 - i * 0.06]
        });
      }
      // tusks
      bp.push({ g: P.cone5, c: 0xe8e2d0, p: [sx * 0.3, 3.75, 0.75], r: [-2.6, 0, 0], s: [0.18, 0.55, 0.18] });
    }
    const body = assemble(bp);
    body.position.y = DIV_LIFT;
    g.add(body);

    /* arms and legs are separate so he can swing and stride */
    const limbs = {};
    const arm = (sx) => {
      const ap = [];
      ap.push({ g: P.ico, c: skin, p: [0, -0.9, 0], s: [0.95, 2.2, 0.95] });
      ap.push({ g: P.ico, c: dark, p: [0, -2.1, 0.15], s: [1.0, 1.5, 1.0] });
      ap.push({ g: P.ico, c: skin, p: [0, -3.0, 0.2], s: [1.1, 0.9, 1.1] });
      for (let i = 0; i < 3; i++) ap.push({ g: P.box, c: iron, p: [0, -1.4 - i * 0.45, 0], s: [1.05, 0.16, 1.05] });
      void sx;
      const m = assemble(ap, false);
      return m;
    };
    const leg = () => {
      const lp = [];
      lp.push({ g: P.ico, c: dark, p: [0, -1.0, 0], s: [1.0, 2.3, 1.0] });
      lp.push({ g: P.ico, c: skin, p: [0, -2.2, 0.1], s: [0.9, 1.2, 0.9] });
      lp.push({ g: P.box, c: 0x3a3630, p: [0, -2.85, 0.3], s: [1.0, 0.5, 1.5] });
      return assemble(lp, false);
    };
    limbs.armL = arm(-1); limbs.armL.position.set(-1.9, 3.4 + DIV_LIFT, 0);
    limbs.armR = arm(1); limbs.armR.position.set(1.9, 3.4 + DIV_LIFT, 0);
    limbs.legL = leg(); limbs.legL.position.set(-0.85, 1.3 + DIV_LIFT, 0);
    limbs.legR = leg(); limbs.legR.position.set(0.85, 1.3 + DIV_LIFT, 0);
    g.add(limbs.armL, limbs.armR, limbs.legL, limbs.legR);

    /* the club: a torn-up tree trunk, held in the right hand */
    const cp = [];
    cp.push({ g: P.taper(0.55, 1, 7), c: 0x5e4224, p: [0, -1.6, 0], s: [1.0, 3.4, 1.0] });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.283;
      cp.push({ g: P.cone5, c: 0x3a3630, p: [Math.cos(a) * 0.55, -2.6 - (i % 2) * 0.4, Math.sin(a) * 0.55], r: [Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2], s: [0.28, 0.7, 0.28] });
    }
    const club = assemble(cp, false);
    /* held clear of the turf: any lower and the tip ploughs the ground,
       which drags his whole silhouette down with it */
    club.position.set(0, -1.6, 0.45);
    limbs.armR.add(club);

    /* expose the rig the way the animal stepper expects it, so the shared
       walk/attack animation drives him with no special case */
    limbs.legL.userData.phase = 0;
    limbs.legR.userData.phase = Math.PI;
    limbs.armL.userData.phase = Math.PI;
    limbs.armR.userData.phase = 0;
    g.userData.legs = [limbs.legL, limbs.legR, limbs.armL, limbs.armR];
    g.userData.head = null;
    g.userData.limbs = limbs;
    g.userData.isDiv = true;
    return g;
  };

  /** باز شکاری — small, sharp, and folds its wings when perched */
  M.falcon = function (coat) {
    const g = new THREE.Group();
    const c = coat === undefined ? 0x8a6a48 : coat;
    const bp = [];
    bp.push({ g: P.ico, c: c, p: [0, 0, 0], s: [0.32, 0.42, 0.62] });
    bp.push({ g: P.ico, c: 0xe8dcc4, p: [0, -0.08, 0.1], s: [0.26, 0.28, 0.5] });
    bp.push({ g: P.ico, c: 0x4a4038, p: [0, 0.3, 0.2], s: [0.26, 0.26, 0.3] });
    bp.push({ g: P.cone5, c: 0xf0c437, p: [0, 0.28, 0.4], r: [1.3, 0, 0], s: [0.1, 0.22, 0.1] });
    for (const sx of [-1, 1]) bp.push({ g: P.sph, c: 0xf0c437, glow: true, p: [sx * 0.11, 0.36, 0.28], s: [0.09, 0.09, 0.06] });
    for (let i = 0; i < 4; i++) {
      const t = (i - 1.5) / 1.5;
      bp.push({ g: P.box, c: i % 2 ? c : 0x4a4038, p: [t * 0.09, -0.05, -0.55], r: [0.1, t * 0.16, 0], s: [0.09, 0.04, 0.55] });
    }
    for (const sx of [-1, 1]) bp.push({ g: P.cyl4, c: 0xf0c437, p: [sx * 0.12, -0.32, 0.05], s: [0.06, 0.28, 0.06] });
    g.add(assemble(bp, true));

    const wings = [];
    for (const sx of [-1, 1]) {
      const wp = [];
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        wp.push({ g: P.box, c: i % 2 ? c : 0x6a5238, p: [sx * (0.2 + t * 0.55), -t * 0.05, -t * 0.16], r: [0, 0, sx * -t * 0.15], s: [0.3, 0.05, 0.55 - t * 0.2] });
      }
      const w = assemble(wp, true);
      g.add(w);
      wings.push(w);
    }
    g.userData.wings = wings;
    return g;
  };

  /** یوزپلنگ ایرانی — a long-legged spotted cat */
  M.cheetah = function (coat) {
    const g = M.animal('fox', coat === undefined ? 0xd8b878 : coat, 1);
    // longer in the leg and leaner than a fox, with a tear-line and spots
    g.scale.set(1.15, 1.4, 1.5);
    const sp = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * 6.283 * 2.3;
      sp.push({
        g: P.sph, c: 0x2a2018,
        p: [Math.cos(a) * 0.3, 0.62 + Math.sin(i * 1.7) * 0.2, -0.5 + (i / 22) * 1.2],
        s: [0.12, 0.1, 0.12]
      });
    }
    const spots = assemble(sp, true);
    g.add(spots);
    g.userData.isCheetah = true;
    return g;
  };

  M.selectRing = function (bad) {
    const geo = new THREE.RingGeometry(0.55, 0.72, 26);
    geo.rotateX(-Math.PI / 2);
    return new THREE.Mesh(geo, bad ? MAT.ringBad : MAT.ring);
  };

  /** simple particle burst pool (leaves, sparks, splashes) */
  M.burst = function (color, count) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: color, size: 0.22, transparent: true, opacity: 1, sizeAttenuation: true });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  };

  G.Meshes = M;
})(window.GAME = window.GAME || {});
