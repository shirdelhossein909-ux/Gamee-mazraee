/* =========================================================
   villagers.js — the townsfolk.

   Everyone belongs to the tribe, and from the council table you
   hand out jobs: woodcutter, quarrier, hunter, farmer or guard.
   A worker walks to a real target in the world, works it, and
   brings the yield home. Guards shoot raiders with bows.
   Anyone without a job just strolls around town.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;

  const SHIRTS = [0x9e5f3f, 0x3f7a9e, 0x6a8a3f, 0x8a3f6a, 0xb5893f, 0x4a5a8a, 0x7a4a4a];
  const PANTS = [0x4a4438, 0x3a3a44, 0x5a4a38, 0x33443a];
  const HAIR = [0x2a1c12, 0x4a3628, 0x6a5238, 0x1a1a1a, 0x8a6a3a];
  /* jobs get a recognisable outfit so you can see who is doing what */
  const JOB_LOOK = {
    wood: { shirt: 0x6a4a2a, hat: 0x8a5a2a },
    stone: { shirt: 0x5a5a62, hat: 0x9a9a9a },
    hunt: { shirt: 0x3f6a3a, hat: 0x2f5a2a },
    farm: { shirt: 0x8a8a3a, hat: 0xc7a24d },
    guard: { shirt: 0x8a3a3a, hat: 0x6a6a72 }
  };
  const HUNT_RANGE = 9;      // a hunter draws his bow from here

  function Villagers(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.timer = 0;
  }

  Villagers.prototype.desired = function () {
    const pop = this.game.progress ? this.game.progress.population : 0;
    return Math.min(18, pop);
  };

  Villagers.prototype.center = function () {
    const b = this.game.building;
    if (b && b.list.length) return { x: b.centerX, z: b.centerZ };
    return { x: 0, z: 0 };
  };

  /* ===================== FRAME ===================== */
  Villagers.prototype.update = function (dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 2.0;
      const want = this.desired();
      while (this.list.length < want) this._add();
      while (this.list.length > want) this._remove();
      this._assignJobs();
    }

    const g = this.game, world = g.world;
    const pp = g.player.pos;
    const hours = dt * (24 / C.TIME.dayLength);

    /* stabled horses are handed to whoever has the longest walk */
    if (g.horses) this._mountUp();

    for (const v of this.list) {
      v.mul = v.horse ? 2.3 : 1;                  // a rider covers ground faster
      v.think -= dt;
      if (v.think <= 0) {
        v.think = 2.5 + Math.random() * 3;
        /* someone already swinging at a living target is left alone —
           the think tick only ever looks for *new* work */
        if (!v.working || !this._targetValid(v)) this._retarget(v);
      }

      /* a hunter's quarry walks away, so re-aim every frame and hold
         at bow range instead of walking into the animal */
      if (v.job === 'hunt' && v.prey && !v.prey.dead) {
        const ax = v.prey.x, az = v.prey.z;
        const pd = Math.hypot(ax - v.x, az - v.z) || 1;
        const back = Math.min(pd, HUNT_RANGE);
        v.tx = ax - ((ax - v.x) / pd) * back;
        v.tz = az - ((az - v.z) / pd) * back;
        if (v.working && pd > HUNT_RANGE + 3) v.working = false;   // give chase again
      }

      const dx = v.tx - v.x, dz = v.tz - v.z;
      const d = Math.hypot(dx, dz);
      let moving = false;

      if (v.working) {
        /* standing at the work site */
        v.workT += hours;
        v.swing = (v.swing || 0) - dt;
        if (v.swing <= 0) { v.swing = 0.75; v.swingAnim = 1; }
        if (v.workT >= C.JOB_TICK) { v.workT = 0; this._yield(v); }
      } else if (d > 1.1) {
        const nx = v.x + (dx / d) * v.speed * v.mul * dt, nz = v.z + (dz / d) * v.speed * v.mul * dt;
        const nh = world.heightAt(nx, nz);
        if (nh > C.WORLD.waterLevel + 0.2 && Math.abs(nh - v.y) < 1.8 &&
          !(g.building && g.building.blocks(nx, nz, true))) {
          v.x = nx; v.z = nz; v.y = nh; moving = true;
        } else { v.think = 0; }
        v.yaw += U.angleDelta(v.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
      } else if (v.job !== 'idle' && v.hasTarget) {
        v.working = true;                      // arrived — get to work
      }

      /* guards and hunters shoot rather than walk into a bear's jaws */
      if (v.job === 'guard') this._guard(v, dt);
      else if (v.job === 'hunt') this._hunt(v, dt);

      /* never end up wedged inside a structure */
      if (g.building) {
        const esc = g.building.escapeFrom(v.x, v.z, 0.2, true);
        if (esc) { v.x = esc.x; v.z = esc.z; v.y = world.heightAt(v.x, v.z); }
      }

      v.phase += dt * (moving ? 7 : 1.3);
      this._pose(v, moving, dt);

      const pd = U.dist2(v.x, v.z, pp.x, pp.z);
      if (pd < 64 && !moving && !v.working) {
        const want = Math.atan2(pp.x - v.x, pp.z - v.z);
        v.yaw += U.angleDelta(v.yaw, want) * Math.min(1, dt * 3);
      }
      v.obj.visible = pd < 140 * 140;
    }
  };

  Villagers.prototype._pose = function (v, moving, dt) {
    const o = v.obj, ud = o.userData;
    o.position.set(v.x, v.y, v.z);
    o.rotation.y = v.yaw;
    if (v.horse) {                              // sitting in the saddle
      o.position.y += C.HORSE.seat;
      ud.legL.rotation.x = -1.3; ud.legR.rotation.x = -1.3;
      ud.armL.rotation.x = -1.05; ud.armR.rotation.x = -1.05;
      ud.torso.position.y = 0.86;
      return;
    }
    const sw = moving ? Math.sin(v.phase) * 0.65 : 0;
    ud.legL.rotation.x = sw; ud.legR.rotation.x = -sw;
    ud.armL.rotation.x = -sw * 0.8;
    if (v.swingAnim > 0) {
      v.swingAnim = Math.max(0, v.swingAnim - dt * 3.2);
      const e = Math.sin(Math.min(1, (1 - v.swingAnim) * 1.4) * Math.PI);
      ud.armR.rotation.x = -2.3 * e + 0.2;
    } else {
      ud.armR.rotation.x = U.damp(ud.armR.rotation.x, sw * 0.8, 10, dt);
    }
    ud.torso.position.y = 0.86 + (moving ? Math.abs(Math.sin(v.phase)) * 0.04 : 0);
  };

  /* ===================== HORSES ===================== */
  /* Whoever has a job and a long way to go gets the next free stabled horse;
     idlers and anyone already at their work site give theirs back. */
  Villagers.prototype._mountUp = function () {
    const H = this.game.horses;
    for (const v of this.list) {
      const wants = v.job !== 'idle' && v.hasTarget && !v.working &&
        U.dist2(v.x, v.z, v.tx, v.tz) > 18 * 18;
      if (wants && !v.horse) {
        const h = H.lend(v);
        if (h) v.horse = h;
      } else if (!wants && v.horse) {
        H.giveBack(v);
        v.horse = null;
      }
    }
  };

  /* ===================== JOB ASSIGNMENT ===================== */
  Villagers.prototype._assignJobs = function () {
    const jobs = this.game.settlers.jobList();      // flat array, one per worker
    for (let i = 0; i < this.list.length; i++) {
      const want = jobs[i] || 'idle';
      const v = this.list[i];
      if (v.job !== want) {
        v.job = want;
        v.working = false;
        v.hasTarget = false;
        v.think = 0;
        v.workT = 0;
        this._reskin(v);
      }
    }
  };

  /* ===================== TARGETING ===================== */
  /** is the thing this worker walked all the way out to still worth working? */
  Villagers.prototype._targetValid = function (v) {
    const g = this.game;
    switch (v.job) {
      case 'wood':
      case 'stone': return !!(v.node && g.world.nodes.has(v.node.id));
      case 'hunt': return !!(v.prey && !v.prey.dead);
      case 'farm': return !!(v.plot && v.plot.crop && v.plot.stage >= 3);
      default: return false;
    }
  };

  Villagers.prototype._retarget = function (v) {
    const g = this.game;
    v.working = false;
    v.hasTarget = false;
    const home = this.center();

    switch (v.job) {
      case 'wood':
      case 'stone': {
        const kind = v.job === 'wood' ? 'tree' : 'ore';
        const n = this._nearestNode(v, kind, 80);
        if (n) {
          v.node = n;
          v.hasTarget = true;
          const a = Math.atan2(v.x - n.x, v.z - n.z);
          v.tx = n.x + Math.sin(a) * 1.6;
          v.tz = n.z + Math.cos(a) * 1.6;
          return;
        }
        break;
      }
      case 'hunt': {
        const a = g.wildlife.nearest(v.x, v.z, 85, false);
        if (a && !a.dead) {
          v.prey = a;
          v.hasTarget = true;
          v.tx = a.x; v.tz = a.z;
          return;
        }
        break;
      }
      case 'farm': {
        const plot = this._ripePlot(v);
        if (plot) {
          v.plot = plot;
          v.hasTarget = true;
          v.tx = plot.x + 1.2; v.tz = plot.z;
          return;
        }
        break;
      }
      case 'guard': {
        // patrol the edge of town
        const ang = Math.random() * 6.283;
        const r = 12 + Math.random() * 14;
        v.tx = home.x + Math.cos(ang) * r;
        v.tz = home.z + Math.sin(ang) * r;
        return;
      }
    }
    // nothing to work on: stroll
    const b = g.building;
    if (b && b.list.length && Math.random() < 0.7) {
      const t = b.list[Math.floor(Math.random() * b.list.length)];
      const a = Math.random() * 6.283, r = 2.5 + Math.random() * 3.5;
      v.tx = t.x + Math.cos(a) * r;
      v.tz = t.z + Math.sin(a) * r;
    } else {
      const a = Math.random() * 6.283, r = Math.random() * 22;
      v.tx = home.x + Math.cos(a) * r;
      v.tz = home.z + Math.sin(a) * r;
    }
  };

  Villagers.prototype._nearestNode = function (v, kind, radius) {
    const list = this.game.world.nodesNear(v.x, v.z, radius);
    let best = null, bd = radius * radius;
    for (const n of list) {
      if (n.kind !== kind) continue;
      const d = U.dist2(v.x, v.z, n.x, n.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  Villagers.prototype._ripePlot = function (v) {
    const f = this.game.farming;
    let best = null, bd = 90 * 90;
    f.plots.forEach(function (p) {
      if (!p.crop || p.stage < 3) return;
      const d = U.dist2(v.x, v.z, p.x, p.z);
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  };

  /* ===================== WORK OUTPUT ===================== */
  Villagers.prototype._yield = function (v) {
    const g = this.game;
    const skillBonus = 1 + g.progress.skill('building').level * 0.02;
    const got = [];
    const give = (id, n) => {
      n = Math.max(1, Math.round(n * skillBonus));
      if (g.inv.add(id, n)) got.push(C.ITEMS[id].icon + U.fa(n));
    };

    switch (v.job) {
      case 'wood':
        if (!v.node || !g.world.nodes.has(v.node.id)) { v.think = 0; return; }
        give('wood', 2 + Math.floor(Math.random() * 3));
        if (Math.random() < 0.3) give('fiber', 1);
        break;
      case 'stone': {
        if (!v.node || !g.world.nodes.has(v.node.id)) { v.think = 0; return; }
        const t = v.node.type;
        if (t === 'coal') give('coal', 1 + Math.floor(Math.random() * 2));
        else if (t === 'iron') give('iron_ore', 1);
        else if (t === 'gold') { if (Math.random() < 0.6) give('gold_ore', 1); }
        else if (t === 'gem') { if (Math.random() < 0.3) give('gem', 1); }
        else give('stone', 2 + Math.floor(Math.random() * 3));
        if (Math.random() < 0.35) give('stone', 1);
        break;
      }
      case 'hunt':
        return;                              // _hunt() shoots; the kill drops the meat
      case 'farm': {
        const p = v.plot;
        if (!p || !p.crop || p.stage < 3) { v.think = 0; return; }
        g.farming.harvest(p);
        v.think = 0; v.working = false;
        return;
      }
      default:
        return;
    }
    if (got.length) {
      g.progress.stat('villagerWork', 1);
      if (Math.random() < 0.35) {
        g.ui.toast('👷 ' + C.JOBS.filter((j) => j.id === v.job)[0].icon + ' اهالی آوردند: ' + got.join(' '), 'good');
      }
    }
  };

  /* ===================== HUNTERS ===================== */
  Villagers.prototype._hunt = function (v, dt) {
    const g = this.game;
    const a = v.prey;
    v.shootCd = (v.shootCd || 0) - dt;
    if (!a || a.dead) { if (a && a.dead) v.think = Math.min(v.think, 0.3); return; }
    const dx = a.x - v.x, dz = a.z - v.z;
    if (dx * dx + dz * dz > (HUNT_RANGE + 4) * (HUNT_RANGE + 4)) return;   // still closing in
    v.yaw += U.angleDelta(v.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
    if (v.shootCd > 0) return;
    v.shootCd = 2.2;
    v.swingAnim = 1;
    const dy = (a.y + a.def.size * 0.5) - (v.y + 1.3);
    const l = Math.hypot(dx, dy, dz) || 1;
    g.wildlife.shoot(
      new THREE.Vector3(v.x, v.y + 1.35, v.z),
      new THREE.Vector3(dx / l, dy / l + 0.04, dz / l),
      14 + g.progress.level * 0.9, 30
    );
    g.audio.bow();
  };

  /* ===================== GUARDS ===================== */
  Villagers.prototype._guard = function (v, dt) {
    const g = this.game;
    v.shootCd = (v.shootCd || 0) - dt;
    if (v.shootCd > 0) return;
    const a = g.wildlife.nearest(v.x, v.z, 26, true);
    if (!a) return;
    v.shootCd = 1.5;
    v.swingAnim = 1;
    const dx = a.x - v.x, dz = a.z - v.z;
    const dy = (a.y + a.def.size * 0.6) - (v.y + 1.3);
    const l = Math.hypot(dx, dy, dz) || 1;
    const dmg = 12 + g.progress.level * 0.8;
    g.wildlife.shoot(
      new THREE.Vector3(v.x, v.y + 1.35, v.z),
      new THREE.Vector3(dx / l, dy / l + 0.05, dz / l),
      dmg, 30
    );
    g.audio.bow();
    v.yaw = Math.atan2(dx, dz);
  };

  /* ===================== SPAWN / DESPAWN ===================== */
  Villagers.prototype._look = function (v) {
    const j = JOB_LOOK[v.job];
    return {
      shirt: j ? j.shirt : v.baseShirt,
      pants: v.basePants,
      hair: v.baseHair,
      hat: j ? j.hat : (v.baseHat ? 0xc7a24d : null),
      apron: v.job === 'farm'
    };
  };

  Villagers.prototype._reskin = function (v) {
    const pos = v.obj ? v.obj.position.clone() : null;
    if (v.obj) {
      this.group.remove(v.obj);
      v.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    v.obj = M.humanoid(this._look(v));
    v.obj.scale.setScalar(v.scale);
    if (pos) v.obj.position.copy(pos);
    this.group.add(v.obj);
    // a guard carries a bow, a worker a tool
    const held = v.job === 'guard' ? 'bow' : v.job === 'wood' ? 'axe'
      : v.job === 'stone' ? 'pickaxe' : v.job === 'hunt' ? 'bow'
        : v.job === 'farm' ? 'hoe' : null;
    if (held) {
      const m = M.toolModel(held, 2);
      if (m) {
        m.scale.setScalar(0.9);
        m.rotation.set(-0.4, 0, -0.15);
        v.obj.userData.hand.add(m);
      }
    }
  };

  Villagers.prototype._add = function () {
    const c = this.center();
    const a = Math.random() * 6.283, r = 4 + Math.random() * 14;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    const v = {
      obj: null, x: x, z: z, y: this.game.world.heightAt(x, z),
      yaw: Math.random() * 6.283, tx: x, tz: z, think: 0,
      speed: 1.7 + Math.random() * 1.2, phase: Math.random() * 6.283,
      job: 'idle', working: false, hasTarget: false, workT: 0, horse: null, mul: 1,
      swingAnim: 0, scale: 0.92 + Math.random() * 0.14,
      baseShirt: U.pick(SHIRTS), basePants: U.pick(PANTS),
      baseHair: U.pick(HAIR), baseHat: Math.random() < 0.4
    };
    this._reskin(v);
    this.list.push(v);
  };

  Villagers.prototype._remove = function () {
    const v = this.list.pop();
    if (!v) return;
    if (v.horse && this.game.horses) this.game.horses.giveBack(v);
    if (!v.obj) return;
    this.group.remove(v.obj);
    v.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
  };

  Villagers.prototype.clear = function () { while (this.list.length) this._remove(); };

  G.Villagers = Villagers;
})(window.GAME = window.GAME || {});
