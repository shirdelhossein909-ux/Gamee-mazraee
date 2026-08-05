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
    guard: { shirt: 0x8a3a3a, hat: 0x6a6a72 },
    music: { shirt: 0x6a3a8a, hat: 0x8a5aa8 }
  };
  /* A hired specialist wears the same trade colours in a brighter cut, with
     a diamond at the collar — spot the expensive one across the field. */
  const EXPERT_LOOK = {
    wood: { shirt: 0x2f9ec4, hat: 0x1f7fa8 },
    stone: { shirt: 0x3fa6c8, hat: 0x2a86a8 },
    hunt: { shirt: 0x2fb0a0, hat: 0x1f8f82 },
    farm: { shirt: 0x46b8c8, hat: 0x2f96a8 },
    guard: { shirt: 0x5a86d8, hat: 0x3f62b0 },
    music: { shirt: 0x9a5ad8, hat: 0x6a3ab0 }
  };
  const HUNT_RANGE = 9;      // a hunter draws his bow from here
  /* straight on first, then wider and wider sidesteps around an obstacle */
  const SIDESTEPS = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9];
  const STUCK_GIVEUP = 3.0;  // seconds of getting nowhere before writing a target off
  const SKIP_FOR = 75;       // and how long to leave it alone afterwards

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
      v.shopCd = Math.max(0, (v.shopCd || 0) - dt);
      v.gateCd = Math.max(0, (v.gateCd || 0) - dt);
      if (v.skip) for (const k in v.skip) { if ((v.skip[k] -= dt) <= 0) delete v.skip[k]; }
      v.think -= dt;
      if (v.think <= 0) {
        v.think = 2.5 + Math.random() * 3;
        /* someone already swinging at a living target is left alone —
           the think tick only ever looks for *new* work */
        if (!v.working || !this._targetValid(v)) this._retarget(v);
      }

      /* A guard's quarry moves, so hold station on it every frame rather
         than on the spot where it used to be. With no threat in sight they
         check back often — a raid should not have to wait out a five
         second think tick before anyone reacts. */
      if (v.job === 'guard') {
        if (v.foe && !v.foe.dead) {
          const fx = v.foe.x, fz = v.foe.z;
          const fd = Math.hypot(fx - v.x, fz - v.z) || 1;
          /* no clean shot a moment ago: get right on top of it instead */
          const off = v.pressIn > 0 ? 2.2 : C.GUARD.standOff;
          const back = Math.min(fd, off);
          v.tx = fx - ((fx - v.x) / fd) * back;
          v.tz = fz - ((fz - v.z) / fd) * back;
          if (v.working && fd > C.GUARD.shootRange) v.working = false;   // give chase
        } else {
          v.think = Math.min(v.think, 1.4);
        }
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

      /* head for the detour waypoint while one is live, otherwise the goal */
      let goalX = v.tx, goalZ = v.tz;
      /* a gate walk outranks a detour: it is the way through, not a way round */
      if (v.gate) {
        const p = g.building ? g.building.gateStep(v.gate, v.x, v.z, dt) : null;
        // through (or given up): judge progress afresh from where we now are
        if (!p) { v.gate = null; v.bestD = undefined; v.noProgress = 0; }
        else { goalX = p.x; goalZ = p.z; v.detour = null; }
      }
      if (!v.gate && v.detour) {
        v.detour.t -= dt;
        if (v.detour.t <= 0 || U.dist(v.x, v.z, v.detour.x, v.detour.z) < 1.6) v.detour = null;
        else { goalX = v.detour.x; goalZ = v.detour.z; }
      }
      const dx = goalX - v.x, dz = goalZ - v.z;
      const d = Math.hypot(dx, dz);
      let moving = false;

      if (v.working) {
        /* standing at the work site — an expert swings faster too, and a
           trade with its own pace (a farmhand) gets that on top */
        const tickMul = C.WORKER.tickMul * (v.expert ? C.EXPERT.tickMul : 1) *
          (C.JOB_SPEED[v.job] || 1);
        v.workT += hours * tickMul;
        v.swing = (v.swing || 0) - dt;
        if (v.swing <= 0) { v.swing = 0.75 / tickMul; v.swingAnim = 1; }
        if (v.workT >= C.JOB_TICK) { v.workT = 0; this._yield(v); }
      } else if (d > 1.1) {
        const step = v.speed * v.mul * dt;
        /* Are we actually getting anywhere?

           A step that succeeds is not the same as progress. Sidestepping is
           what carries a walker around a rock, and against a town wall it
           does its job perfectly — it finds a way past the obstacle every
           single frame, forever, shuffling sideways along the stonework and
           never once reporting itself blocked. That is what "the workers get
           stuck behind the walls" looks like from the inside: not a villager
           standing still, but a villager walking briskly and arriving
           nowhere. So watch the distance to the goal instead of the step,
           and when it stops shrinking, go and find the gate. */
        if (!v.gate) {
          const gd = Math.hypot(v.tx - v.x, v.tz - v.z);
          if (v.bestD === undefined || gd < v.bestD - 0.3) { v.bestD = gd; v.noProgress = 0; }
          else if ((v.noProgress = (v.noProgress || 0) + dt) > NO_PROGRESS) {
            if (this._gateWay(v)) v.noProgress = 0;
          }
        }
        if (this._tryStep(v, dx / d, dz / d, step, world)) {
          moving = true;
          v.stuckT = 0;
          /* walking again, so whatever the nudge freed them from is behind
             them: the unstick budget counts *consecutive* failures only */
          v.unstuck = 0;
        } else if (!v.detour && (v.stuckT || 0) + dt > 0.4 &&
          this._detour(v, dx / d, dz / d, world)) {
          /* boxed in against something long — go round it */
          v.stuckT = 0;
        } else {
          /* Boxed in. Sidestepping handles a rock or a wall in the way, but a
             vein partway up a cliff can never be reached at all — and picking
             the *nearest* node every time would send this worker back to the
             same impossible spot forever. Give up on it and let someone else
             have a turn at a different one. */
          v.stuckT = (v.stuckT || 0) + dt;
          if (v.stuckT > STUCK_GIVEUP) {
            /* no step and no way round: lift them onto walkable ground
               before writing the target off, so a pinned worker cannot
               quietly blacklist the whole field */
            if (!this._unstick(v, dx / d, dz / d, world)) {
              v.stuckT = 0;
              this._giveUp(v);
            }
          }
          v.think = Math.min(v.think, 0.35);
        }
        v.yaw += U.angleDelta(v.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
      } else if (v.job !== 'idle' && v.hasTarget && !v.detour) {
        v.working = true;                      // arrived — get to work
        v.stuckT = 0;
        v.unstuck = 0;
        /* got here in the end, so this target is not a lost cause after all */
        if (v.fails) {
          const id = v.node ? v.node.id : (v.plot ? 'p' + v.plot.gx + ',' + v.plot.gz : null);
          if (id !== null) delete v.fails[id];
        }
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

    /* Standing near someone playing is genuinely restful — you get your
       wind back faster, which is the point of paying for a musician. */
    const near = this.musicNear(pp.x, pp.z);
    if (near !== null) {
      const p = g.player;
      const gain = hours * C.MUSIC_JOB.energyPerHour * near;
      p.energy = Math.min(100, p.energy + gain);
      p.stamina = Math.min(p.maxStamina, p.stamina + gain * 2);
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

  /* One walking step, sidestepping whatever is in the way. Returns false only
     when nothing within a wide arc is walkable. */
  Villagers.prototype._tryStep = function (v, dx, dz, step, world) {
    const g = this.game;
    const walkable = (x, z) => {
      const h = world.heightAt(x, z);
      return h > C.WORLD.waterLevel + 0.2 && Math.abs(h - v.y) < 1.8 &&
        !(g.building && g.building.blocks(x, z, true));
    };
    for (const turn of SIDESTEPS) {
      const c = Math.cos(turn), s = Math.sin(turn);
      const ax = dx * c - dz * s, az = dx * s + dz * c;
      const nx = v.x + ax * step, nz = v.z + az * step;
      if (!walkable(nx, nz)) continue;
      v.x = nx; v.z = nz; v.y = world.heightAt(nx, nz);
      return true;
    }
    return false;
  };

  /* Sidestepping gets you past a rock. It does not get you past your own
     row of houses: the step turns aside, the next frame re-aims straight at
     the goal, and the villager ping-pongs against the wall forever. That is
     what made guards look broken — they could see the raid on the far side
     of town and simply could not walk there.

     So when a step keeps failing, commit to a waypoint off to one side and
     walk to *that* for a few seconds before resuming. Whichever way worked
     last time is tried first, so a long wall gets followed rather than
     argued with. */
  /* Blocked, and the town has a gate: walk to the gate. Sidestepping along a
     rampart works in the end, but a wall long enough to be worth building is
     also long enough that "in the end" arrives after the working day does.

     The waypoint is the gate itself, held long enough to actually reach it.
     Once there the normal steering takes over, and because the gate opens for
     anyone on your side, the straight line onward runs clean through it. */
  const GATE_HOLD = 18;          // seconds committed to a gate walk
  const GATE_RETRY = 22;         // …and how long before trying that gate again
  const NO_PROGRESS = 2.5;       // seconds of walking without closing the gap
  Villagers.prototype._gateWay = function (v) {
    const g = this.game;
    if (!g.building || (v.gateCd || 0) > 0) return false;
    const walk = g.building.gateWalk(v.x, v.z, v.tx, v.tz, GATE_HOLD);
    if (!walk) return false;
    v.gate = walk;
    v.gateCd = GATE_RETRY;
    return true;
  };

  Villagers.prototype._detour = function (v, dirX, dirZ, world) {
    const g = this.game;
    // a doorway beats a scramble along the wall
    if (this._gateWay(v)) return true;
    /* The same test a step uses, including the climb limit — offering a
       detour up a cliff face is worse than offering none, because the
       walker commits to it and then stands there for six seconds. */
    const open = (x, z, fromY) => {
      const h = world.heightAt(x, z);
      return h > C.WORLD.waterLevel + 0.2 && Math.abs(h - fromY) < 1.7 &&
        !(g.building && g.building.blocks(x, z, true));
    };
    const px = -dirZ, pz = dirX;                    // perpendicular to the blockage
    const first = v.detourSide || 1;
    for (const dist of [7, 12, 18, 26]) {
      for (const side of [first, -first]) {
        const x = v.x + px * side * dist + dirX * 2;
        const z = v.z + pz * side * dist + dirZ * 2;
        let clear = true, lastY = v.y;
        for (let t = 0.12; t <= 1.001; t += 0.12) {
          const sx = v.x + (x - v.x) * t, sz = v.z + (z - v.z) * t;
          if (!open(sx, sz, lastY)) { clear = false; break; }
          lastY = world.heightAt(sx, sz);
        }
        if (!clear) continue;
        v.detour = { x: x, z: z, t: 6 };
        v.detourSide = side;
        return true;
      }
    }
    return false;
  };

  /* The last resort: a worker who has been unable to move for a long time is
     nudged onto walkable ground in the direction they were trying to go.
     Nothing else guarantees progress — a villager pinned between a cliff and
     a wall has no step and no detour, and used to stand there drifting until
     the job was abandoned. The game already relocates people when you build
     on top of them; this is the same courtesy.

     Two limits keep it honest. It is a nudge of a few metres, not a jump —
     freeing someone by flinging them thirty metres across the valley is not
     a fix, it is a teleport you can watch happen. And it respects the same
     climb limit walking does, so nobody is unstuck up the side of a cliff.
     After a few nudges with nothing to show for it the target really is
     unreachable, and giving up on it is the right answer. */
  const UNSTICK_TRIES = 2;
  const UNSTICK_AHEAD = [3, 5, 7];
  const UNSTICK_RISE = 1.5;      // metres of climb allowed between samples
  Villagers.prototype._unstick = function (v, dirX, dirZ, world) {
    const g = this.game;
    if ((v.unstuck || 0) >= UNSTICK_TRIES) return false;
    /* Somewhere they could plausibly have walked to: dry, unbuilt, and up a
       slope rather than up a wall. Sampling the line rather than comparing
       the two endpoints is what lets a quarrier be nudged up a hillside to
       a vein while still refusing to lift anyone over a cliff. */
    const ok = (x, z) => {
      const h = world.heightAt(x, z);
      if (h <= C.WORLD.waterLevel + 0.3) return false;
      if (g.building && g.building.blocks(x, z, true)) return false;
      let ph = v.y;
      for (let i = 1; i <= 4; i++) {
        const sh = world.heightAt(v.x + (x - v.x) * i / 4, v.z + (z - v.z) * i / 4);
        if (Math.abs(sh - ph) > UNSTICK_RISE) return false;
        ph = sh;
      }
      return true;
    };
    for (const ahead of UNSTICK_AHEAD) {
      const cx = v.x + dirX * ahead, cz = v.z + dirZ * ahead;
      for (let r = 0; r <= 3.6; r += 1.2) {
        const n = r < 0.1 ? 1 : 10;
        for (let a = 0; a < n; a++) {
          const ang = (a / n) * 6.283;
          const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
          if (!ok(x, z)) continue;
          v.x = x; v.z = z; v.y = world.heightAt(x, z);
          v.detour = null; v.stuckT = 0;
          v.unstuck = (v.unstuck || 0) + 1;
          return true;
        }
      }
    }
    return false;
  };

  /* Write off the current target and go find another — but escalate rather
     than slam the door. Being blocked once is usually a passing thing (a
     neighbour in the way, a corner taken badly); a vein halfway up a cliff
     fails every time. So the first couple of failures earn a short cool-off
     and only a persistent one gets the long ban.

     This matters most on a farm: four hands sharing twenty-one rows used to
     blacklist the entire field inside a minute and then stand around, which
     looked exactly like farmhands that do not work. */
  const GIVEUP_STEPS = [5, 14, SKIP_FOR];
  Villagers.prototype._giveUp = function (v) {
    if (!v.skip) v.skip = Object.create(null);
    if (!v.fails) v.fails = Object.create(null);
    const id = v.node ? v.node.id : (v.plot ? 'p' + v.plot.gx + ',' + v.plot.gz : null);
    if (id !== null) {
      const n = (v.fails[id] = (v.fails[id] || 0) + 1);
      v.skip[id] = GIVEUP_STEPS[Math.min(n - 1, GIVEUP_STEPS.length - 1)];
    }
    v.node = null; v.plot = null; v.prey = null;
    v.detour = null;
    v.hasTarget = false;
    v.working = false;
    v.think = 0;
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
    const S = this.game.settlers;
    const jobs = S.jobList();                       // flat array, one per worker
    /* The specialists you paid for take the first seats on their own trade,
       so hiring a miner really does put a miner on the rocks. */
    const left = Object.create(null);
    for (const j of C.JOBS) left[j.id] = S.expertsOn(j.id);
    for (let i = 0; i < this.list.length; i++) {
      const want = jobs[i] || 'idle';
      const v = this.list[i];
      const expert = want !== 'idle' && left[want] > 0;
      if (expert) left[want]--;
      if (v.job !== want || v.expert !== expert) {
        v.job = want;
        v.expert = expert;
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
      /* A farmhand stays on the row they walked out to until they have
         done something to it. Only counting a *ripe* plot as valid sent
         them back to the job board mid-stride on every watering. */
      case 'farm': return !!(v.plot && this.game.farming.plots.has(U.key(v.plot.gx, v.plot.gz)));
      /* a guard sticks with the thing they were sent after, until it falls */
      case 'guard': return !!(v.foe && !v.foe.dead && this.game.wildlife.animals.indexOf(v.foe) >= 0);
      /* a player stays put: as long as there is somewhere to play, the
         gig continues and they are not sent looking for new work */
      case 'music': return !!this.stage();
      default: return false;
    }
  };

  Villagers.prototype._retarget = function (v) {
    const g = this.game;
    v.working = false;
    v.hasTarget = false;
    v.unstuck = 0;                    // a new target deserves a fresh budget
    v.gate = null; v.gateCd = 0;      // and a fresh look at the doorways
    v.bestD = undefined; v.noProgress = 0;
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
        const a = this._pickPrey(v);
        if (a) {
          v.prey = a;
          v.hasTarget = true;
          v.tx = a.x; v.tz = a.z;
          return;
        }
        break;
      }
      case 'farm': {
        const plot = this._farmJob(v);
        if (plot) {
          v.plot = plot;
          v.hasTarget = true;
          v.tx = plot.x + 1.2; v.tz = plot.z;
          return;
        }
        break;
      }
      case 'guard': {
        /* Trouble first. A guard who keeps walking a pretty circle while
           a wolf eats the barn is the whole reason guards looked broken. */
        const foe = this._threatNear(v);
        if (foe) {
          v.foe = foe.animal || null;
          v.hasTarget = true;
          const sx = foe.x - v.x, sz = foe.z - v.z;
          const d = Math.hypot(sx, sz) || 1;
          const back = Math.min(d, C.GUARD.standOff);
          v.tx = foe.x - (sx / d) * back;
          v.tz = foe.z - (sz / d) * back;
          return;
        }
        v.foe = null;
        // nothing doing: walk the perimeter, sized to the settlement
        const border = this._border();
        const ang = Math.random() * 6.283;
        const r = border * (C.GUARD.patrolMin + Math.random() * (C.GUARD.patrolMax - C.GUARD.patrolMin));
        v.tx = home.x + Math.cos(ang) * r;
        v.tz = home.z + Math.sin(ang) * r;
        return;
      }
      case 'music': {
        /* play where people are: the garden first, then a fountain, a
           gazebo, the inn, the council table — failing all that, the
           middle of town. */
        const spot = this.stage();
        if (spot) {
          const a = Math.random() * 6.283;
          v.tx = spot.x + Math.cos(a) * (spot.r || 1.5);
          v.tz = spot.z + Math.sin(a) * (spot.r || 1.5);
          v.hasTarget = true;
          return;
        }
        break;
      }
    }
    /* nothing to work on: drift toward wherever the town is pleasant —
       a garden, or whoever is playing — and otherwise stroll */
    const rest = this.restSpot();
    if (rest && Math.random() < 0.75) {
      const a = Math.random() * 6.283, r = Math.random() * rest.r;
      v.tx = rest.x + Math.cos(a) * r;
      v.tz = rest.z + Math.sin(a) * r;
      return;
    }
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

  /* ===================== MUSIC & REST =====================
     A musician needs somewhere worth standing, and everyone off duty
     needs somewhere worth going. Both come from the same short list of
     places a town builds for pleasure rather than for profit. */
  const STAGE_ORDER = ['garden', 'fountain', 'gazebo', 'cascade', 'tavern', 'council', 'town_hall'];
  Villagers.prototype.stage = function () {
    const b = this.game.building;
    if (!b || !b.list.length) return null;
    for (const id of STAGE_ORDER) {
      let best = null;
      for (const s of b.list) {
        if (s.defId !== id) continue;
        if (!best || s.level > best.level) best = s;
      }
      if (best) return { x: best.x, z: best.z, r: id === 'garden' ? 3.2 : 1.8, b: best };
    }
    const c = this.center();
    return { x: c.x, z: c.z, r: 2.5, b: null };
  };

  /** the nicest place in town to be when you are not working */
  Villagers.prototype.restSpot = function () {
    const b = this.game.building;
    if (!b || !b.list.length) return null;
    /* a musician at work outranks even the garden — people gather round */
    for (const v of this.list) {
      if (v.job === 'music' && v.working) {
        return { x: v.x, z: v.z, r: C.MUSIC_JOB.restRadius };
      }
    }
    let best = null, bestR = 0;
    for (const s of b.list) {
      const eff = s.def.effects ? s.def.effects(s.level) : {};
      if (!eff.restRadius) continue;
      if (eff.restRadius > bestR) { bestR = eff.restRadius; best = s; }
    }
    return best ? { x: best.x, z: best.z, r: bestR } : null;
  };

  /** town-wide happiness from everyone currently playing */
  Villagers.prototype.musicHappy = function () {
    let n = 0;
    for (const v of this.list) if (v.job === 'music' && v.working) n++;
    return n * C.MUSIC_JOB.happyPerPlayer;
  };

  /** 0..1 — how close the nearest playing musician is, or null if none */
  Villagers.prototype.musicNear = function (x, z) {
    const R = C.MUSIC_JOB.radius;
    let best = null;
    for (const v of this.list) {
      if (v.job !== 'music' || !v.working) continue;
      const d = U.dist(x, z, v.x, v.z);
      if (d > R) continue;
      const k = 1 - d / R;
      if (best === null || k > best) best = k;
    }
    return best;
  };

  Villagers.prototype._nearestNode = function (v, kind, radius) {
    const list = this.game.world.nodesNear(v.x, v.z, radius);
    const skip = v.skip;
    let best = null, bd = radius * radius;
    for (const n of list) {
      if (n.kind !== kind) continue;
      if (skip && skip[n.id] > 0) continue;        // proved unreachable lately
      const d = U.dist2(v.x, v.z, n.x, n.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  /* Hunters used to all take the nearest animal, so the whole party walked
     shoulder to shoulder round the edge of town. Each one now claims its own
     quarry — nobody else's — and is drawn to game further out, so they fan
     away from the settlement instead of tripping over each other. */
  Villagers.prototype._pickPrey = function (v) {
    const g = this.game;
    const home = this.center();
    const taken = Object.create(null);
    for (const o of this.list) {
      if (o !== v && o.job === 'hunt' && o.prey && !o.prey.dead) taken[o.prey.uid] = 1;
    }
    let best = null, bs = -1;
    for (const a of g.wildlife.animals) {
      if (a.dead || a.def.hostile) continue;
      if (taken[a.uid]) continue;                          // someone else's kill
      const d = U.dist(v.x, v.z, a.x, a.z);
      if (d > 95) continue;
      const out = U.dist(a.x, a.z, home.x, home.z);         // distance from town
      /* close enough to reach, far enough out to be worth the walk */
      const score = Math.min(out, 70) * 0.9 - d;
      if (score > bs) { bs = score; best = a; }
    }
    return best;
  };

  /* What is there to do on the farm? Ripe crops first, then thirsty ones,
     then bare tilled soil waiting on seed — a farmhand who only ever
     harvested looked broken on a field that was still growing. */
  /* ===================== FARMHANDS =====================
     A farmhand runs the field on their own. All they need from you is
     ground that has been broken; after that they sow, water and harvest,
     and when the seed bin is empty they go and buy more with your coin. */

  /** every crop this town's farming skill is allowed to plant */
  Villagers.prototype._unlockedCrops = function () {
    const lvl = this.game.progress.skill('farming').level;
    const out = [];
    for (const id in C.CROPS) if (C.CROPS[id].lvl <= lvl) out.push(C.CROPS[id]);
    return out;
  };

  /** a seed already in the store that a farmhand may plant */
  Villagers.prototype._seedInStock = function () {
    const inv = this.game.inv;
    const crops = this._unlockedCrops();
    /* prefer the seed you have picked for yourself, then the most valuable
       thing there is enough of — a field of grapes beats a field of wheat */
    if (inv.selectedSeed && inv.count(inv.selectedSeed) > 0) {
      for (const c of crops) if (c.seed === inv.selectedSeed) return c.seed;
    }
    let best = null, bv = -1;
    for (const c of crops) {
      if (inv.count(c.seed) <= 0) continue;
      const v = C.ITEMS[c.id].value;
      if (v > bv) { bv = v; best = c.seed; }
    }
    return best;
  };

  /** what a farmhand could afford to go and buy, if the bin is empty */
  Villagers.prototype._seedToBuy = function () {
    const g = this.game;
    if (!C.FARMER.buySeeds) return null;
    const purse = g.inv.coins - C.FARMER.reserve;
    if (purse <= 0) return null;
    const budget = Math.min(purse, g.inv.coins * C.FARMER.purseShare);
    let best = null, bv = -1;
    for (const c of this._unlockedCrops()) {
      const unit = g.economy.buyPrice(c.seed);
      if (unit <= 0 || unit > budget) continue;
      const v = C.ITEMS[c.id].value;
      if (v > bv) { bv = v; best = { seed: c.seed, unit: unit, crop: c }; }
    }
    return best;
  };

  /** is there any way at all for this farmhand to put a seed in the ground? */
  Villagers.prototype._canSeed = function () {
    return !!(this._seedInStock() || this._seedToBuy());
  };

  /** the market run: buy a batch out of your purse */
  Villagers.prototype._restockSeeds = function (v) {
    const g = this.game;
    if (v.shopCd > 0) return null;
    const pick = this._seedToBuy();
    if (!pick) { v.shopCd = C.FARMER.restockGap; return null; }
    const budget = Math.min(g.inv.coins - C.FARMER.reserve, g.inv.coins * C.FARMER.purseShare);
    const n = Math.max(1, Math.min(C.FARMER.batch, Math.floor(budget / pick.unit)));
    v.shopCd = C.FARMER.restockGap;
    const before = g.inv.count(pick.seed);
    const bought = g.economy.buy(pick.seed, n);
    const got = g.inv.count(pick.seed) - before;
    if (got <= 0) {
      /* A full store swallows the purchase and the farmhand looks idle for
         no visible reason. Say which of the two problems it actually is. */
      if (!this._shopWarn || U.now() - this._shopWarn > 25000) {
        this._shopWarn = U.now();
        g.ui.toast(bought
          ? '📦 انبار پر است — بذری که کشاورزها خریدند جا نشد. سیلو یا انبار بساز.'
          : '🌱 کشاورزها نتوانستند بذر بخرند — سکه یا جای انبار کم است', 'bad');
      }
      return null;
    }
    g.ui.toast('🌾 کشاورزها ' + U.fa(got) + ' بذر ' + pick.crop.name + ' از بازار خریدند', 'good');
    return pick.seed;
  };

  Villagers.prototype._farmJob = function (v) {
    const f = this.game.farming;
    const skip = v.skip;
    let best = null, bd = 1e9, bestRank = 9;
    /* sowing is only worth walking to if a seed can be had — in the bin
       or at the market */
    const canSow = this._canSeed();
    f.plots.forEach(function (p) {
      const id = 'p' + p.gx + ',' + p.gz;
      if (skip && skip[id] > 0) return;
      let rank;
      if (p.crop && p.stage >= 3) rank = 0;                 // harvest
      else if (p.crop && p.moisture < 0.3) rank = 1;        // water
      else if (!p.crop && canSow) rank = 2;                 // sow
      else return;
      const d = U.dist2(v.x, v.z, p.x, p.z);
      if (d > 120 * 120) return;
      if (rank < bestRank || (rank === bestRank && d < bd)) { bestRank = rank; bd = d; best = p; }
    });
    if (best) v.farmAct = bestRank;
    return best;
  };

  /* ===================== WORK OUTPUT ===================== */
  Villagers.prototype._yield = function (v) {
    const g = this.game;
    const skillBonus = 1 + g.progress.skill('building').level * 0.02;
    const load = C.WORKER.yieldMul * (v.expert ? C.EXPERT.yieldMul : 1);
    const got = [];
    let full = false;
    const give = (id, n) => {
      n = Math.max(1, Math.round(n * skillBonus * load));
      if (g.inv.add(id, n, true)) got.push(C.ITEMS[id].icon + U.fa(n));
      else full = true;
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
        if (!p || !g.farming.plots.has(U.key(p.gx, p.gz))) { v.think = 0; v.working = false; return; }
        if (p.crop && p.stage >= 3) {
          const crop = p.crop;
          g.farming.harvest(p);
          // a trained hand gets more out of the same row
          if (load > 1 && C.CROPS[crop]) {
            const bonus = Math.round((load - 1) * 1.5);
            if (bonus > 0) g.inv.add(crop, bonus, true);
          }
        } else if (p.crop && p.moisture < 0.3) {
          /* the farmhand carries their own water — no bucket errands */
          p.moisture = Math.min(1, p.moisture + C.FARMER.waterTo);
          g.farming._refreshSoil(p);
        } else if (!p.crop) {
          /* Sow. If the seed bin is empty they go and buy some out of your
             purse — that is the whole point of hiring one. */
          let seed = this._seedInStock();
          if (!seed) seed = this._restockSeeds(v);
          if (seed) {
            /* Two hands can reach for the last seed in the bin at once. That
               is a moment's bad luck, not a reason to write the row off for
               a minute — come back to it shortly. */
            if (!g.farming.plant(p, seed)) {
              if (!v.skip) v.skip = Object.create(null);
              v.skip['p' + p.gx + ',' + p.gz] = 3;
            }
          } else {
            /* nothing to plant and nothing to buy: leave this row alone
               for a while rather than pacing back to it every few seconds */
            if (!v.skip) v.skip = Object.create(null);
            v.skip['p' + p.gx + ',' + p.gz] = 20;
            if (!this._seedWarn || U.now() - this._seedWarn > 30000) {
              this._seedWarn = U.now();
              g.ui.toast('🌱 کشاورزها نه بذر دارند نه پول بذر — سکه یا بذر بگذار', 'bad');
            }
          }
        }
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
    } else if (full) {
      /* Workers used to fail silently against a full store, which looks
         exactly like workers that do not work. Say so — but rarely. */
      if (!this._fullWarn || U.now() - this._fullWarn > 20000) {
        this._fullWarn = U.now();
        g.ui.toast('📦 انبار پر است — کارگرها جایی برای گذاشتن ندارند. سیلو یا انبار بساز.', 'bad');
      }
    }
  };

  /* ===================== ARCHERY =====================
     A bow is not a rifle. The old aim added a flat nudge to the vertical,
     which overshoots at three metres and falls short at thirty. Work out
     how long the arrow is in the air and lift by exactly the drop that
     buys — the same maths for a guard, a hunter or a tower. */
  const ARROW_SPEED = 52, ARROW_G = 9;
  Villagers.prototype._aim = function (v, a) {
    const eye = v.y + 1.35;
    const dx = a.x - v.x, dz = a.z - v.z;
    const dy = (a.y + a.def.size * 0.6) - eye;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const t = dist / ARROW_SPEED;
    const ly = dy + 0.5 * ARROW_G * t * t;
    const nl = Math.hypot(dx, ly, dz) || 1;
    return {
      x: dx / nl, y: ly / nl, z: dz / nl,
      eye: eye, flat: Math.hypot(dx, dz), dist: dist,
      ty: a.y + a.def.size * 0.6
    };
  };

  /** can this archer actually land one on that? */
  Villagers.prototype._canShoot = function (v, a, aim) {
    return this.game.wildlife.lineOfSight(v.x, aim.eye, v.z, a.x, aim.ty, a.z);
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
    /* Village hunters draw a good deal slower than they used to — meat was
       arriving faster than anything else in the game. An expert still nocks
       arrows quicker than a plain hand. */
    const aim = this._aim(v, a);
    /* a hill in the way means walking round it, not emptying the quiver
       into the slope */
    if (!this._canShoot(v, a, aim)) { v.working = false; return; }
    v.shootCd = 2.2 * C.HUNTER_SLOW / (v.expert ? C.EXPERT.tickMul : 1);
    v.swingAnim = 1;
    g.wildlife.shoot(
      new THREE.Vector3(v.x, aim.eye, v.z),
      new THREE.Vector3(aim.x, aim.y, aim.z),
      14 + g.progress.level * 0.9, 30
    );
    g.audio.bow();
  };

  /* ===================== GUARDS =====================
     How far out a guard cares. Scales with the settlement, so a camp is
     watched to its fence and a metropolis to its outskirts. */
  Villagers.prototype._border = function () {
    const t = this.game.progress ? this.game.progress.tier : 0;
    return (C.TIERS[t] ? C.TIERS[t].border : 34);
  };

  /* Anything worth walking across town for: a predator inside the watch
     circle, or — more urgently — whatever is currently chewing on one of
     your buildings, wherever that is. */
  Villagers.prototype._threatNear = function (v) {
    const g = this.game;
    if (!g.wildlife) return null;
    const home = this.center();
    const watch = Math.max(C.GUARD.watchMin, this._border() * C.GUARD.watch);
    let best = null, bs = 1e9;
    for (const a of g.wildlife.animals) {
      if (a.dead) continue;
      const raiding = a.raid && a.raidTarget;
      if (!raiding && !a.def.hostile && !a.angry) continue;
      /* is it near the town at all? a wolf two valleys over is not our
         problem — but one at the wall is, and a raider always is */
      const dHome = U.dist(a.x, a.z, home.x, home.z);
      if (!raiding && dHome > watch) continue;
      /* score: raiders first, then whoever is closest to this guard */
      const s = U.dist(a.x, a.z, v.x, v.z) * (raiding ? 0.4 : 1);
      if (s < bs) { bs = s; best = a; }
    }
    return best ? { animal: best, x: best.x, z: best.z } : null;
  };

  Villagers.prototype._guard = function (v, dt) {
    const g = this.game;
    v.shootCd = Math.max(-1, (v.shootCd || 0) - dt);
    /* Re-aim at whatever we came for; if it died or wandered off, ask for
       a new assignment on the next think instead of standing about. */
    if (v.foe && (v.foe.dead || g.wildlife.animals.indexOf(v.foe) < 0)) {
      v.foe = null;
      v.think = Math.min(v.think, 0.25);
      v.hasTarget = false;
    }
    const a = v.foe && !v.foe.dead
      ? v.foe
      : g.wildlife.nearest(v.x, v.z, C.GUARD.shootRange, true);
    if (!a) return;
    /* face the threat even between arrows — a guard staring the wrong way
       while something closes in looks exactly like a guard doing nothing */
    const dx = a.x - v.x, dz = a.z - v.z;
    v.yaw += U.angleDelta(v.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
    const flat = Math.hypot(dx, dz);
    v.pressIn = Math.max(0, (v.pressIn || 0) - dt);
    if (flat > C.GUARD.shootRange) return;      // still closing in
    if (v.shootCd > 0) return;
    const aim = this._aim(v, a);
    if (!this._canShoot(v, a, aim)) {
      /* ground in the way. Close on it rather than filling the hillside
         with arrows — this, more than anything, is what made a line of
         guards look like it was ignoring a raid. */
      v.pressIn = 1.5;
      v.working = false;
      return;
    }
    v.shootCd = C.GUARD.shootCd;
    v.swingAnim = 1;
    /* three times the arrow a town guard used to loose */
    const dmg = (C.GUARD.baseDamage + g.progress.level * C.GUARD.perLevel) * C.GUARD.damage;
    g.wildlife.shoot(
      new THREE.Vector3(v.x, aim.eye, v.z),
      new THREE.Vector3(aim.x, aim.y, aim.z),
      dmg, C.GUARD.shootRange + 6
    );
    g.audio.bow();
  };

  /* ===================== SPAWN / DESPAWN ===================== */
  Villagers.prototype._look = function (v) {
    const j = (v.expert ? EXPERT_LOOK : JOB_LOOK)[v.job];
    return {
      shirt: j ? j.shirt : v.baseShirt,
      pants: v.expert ? 0x2a3a52 : v.basePants,
      hair: v.baseHair,
      hat: j ? j.hat : (v.baseHat ? 0xc7a24d : null),
      apron: v.job === 'farm',
      gem: !!v.expert
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
        : v.job === 'farm' ? 'hoe' : v.job === 'music' ? 'tar' : null;
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
