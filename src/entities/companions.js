/* =========================================================
   companions.js — باز شکاری و یوزپلنگ ایرانی

   Two animals you win with patience rather than coins. Both are
   rare, both shy away if you crowd them, and both need bait in
   your pack before they will let you near.

     باز    perches on your shoulder. Press H and it drops off your
            arm, dives at whatever you are looking at, and comes
            back with what it caught.
     یوز    runs at your heel and goes for anything that comes at
            you. Press H to set it on your current target.

   Falconry and cheetah-coursing are about the oldest field sports
   this land has, so they are the two that belong here.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;
  const W = C.WORLD, CO = C.COMPANION;

  function Companions(game) {
    this.game = game;
    this.list = [];             // every one in the world, wild or tame
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.taming = null;         // { pet, t }
    this.uid = 1;
    this.spawnT = 9;
  }

  /* ===================== COUNTS ===================== */
  Companions.prototype.tamedOf = function (kind) {
    let n = 0;
    for (const c of this.list) if (c.tame && c.kind === kind) n++;
    return n;
  };
  Companions.prototype.wildCount = function () {
    let n = 0;
    for (const c of this.list) if (!c.tame) n++;
    return n;
  };
  Companions.prototype.tamed = function () {
    return this.list.filter(function (c) { return c.tame; });
  };

  /* ===================== SPAWNING ===================== */
  Companions.prototype.spawnWild = function (kind, x, z) {
    const def = CO[kind];
    if (!def) return null;
    const y = this.game.world.heightAt(x, z);
    if (y < W.waterLevel + 0.6) return null;
    return this._add({ kind: kind, x: x, y: y, z: z, coat: U.pick(def.coats) });
  };

  Companions.prototype._add = function (o) {
    const def = CO[o.kind];
    const c = {
      uid: this.uid++, kind: o.kind, def: def,
      x: o.x, y: o.y, z: o.z, yaw: Math.random() * 6.283,
      coat: o.coat === undefined ? def.coats[0] : o.coat,
      tame: !!o.tame, perched: false,
      state: 'wander', timer: Math.random() * 3, phase: Math.random() * 6.283,
      wanderYaw: Math.random() * 6.283, spook: 0, cd: 0,
      hunt: null, flight: 0, obj: null
    };
    this.list.push(c);
    this._rebuild(c);
    return c;
  };

  Companions.prototype._rebuild = function (c) {
    if (c.obj) {
      (c.obj.parent || this.group).remove(c.obj);
      c.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    c.obj = c.kind === 'falcon' ? M.falcon(c.coat) : M.cheetah(c.coat);
    c.obj.position.set(c.x, c.y, c.z);
    this.group.add(c.obj);
  };

  Companions.prototype._remove = function (i) {
    const c = this.list[i];
    if (c.obj) {
      (c.obj.parent || this.group).remove(c.obj);
      c.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    U.swapRemove(this.list, i);
  };

  Companions.prototype._trySpawn = function () {
    const g = this.game, world = g.world, p = g.player.pos;
    if (Math.random() > CO.spawnChance) return false;
    const kind = Math.random() < 0.62 ? 'falcon' : 'cheetah';
    const def = CO[kind];
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = Math.random() * 6.283;
      const d = 46 + Math.random() * 60;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const y = world.heightAt(x, z);
      if (y < W.waterLevel + 0.8) continue;
      if (world.slopeAt(x, z) > 2.8) continue;
      if (def.biomes.indexOf(world.biomeAt(x, z, y)) < 0) continue;
      this.spawnWild(kind, x, z);
      return true;
    }
    return false;
  };

  /* ===================== TAMING ===================== */
  /* The nearest wild one you could actually put a hand on. Each kind has
     its own patience, so the reach is per-animal rather than one number. */
  Companions.prototype.nearestWild = function (x, z, radius) {
    let best = null, bd = Infinity;
    for (const c of this.list) {
      if (c.tame) continue;
      const r = radius === undefined ? c.def.tameRange : Math.min(radius, c.def.tameRange);
      const d = U.dist2(x, z, c.x, c.z);
      if (d > r * r) continue;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  /** what still stands between you and this animal */
  Companions.prototype.tameCheck = function (c) {
    const g = this.game;
    if (!c) return { ok: false, why: '' };
    const def = c.def;
    if (this.tamedOf(c.kind) >= def.max) {
      return { ok: false, why: 'بیشتر از ' + U.fa(def.max) + ' ' + def.name + ' نمی‌توانی داشته باشی' };
    }
    if (g.progress.skill(def.skill).level < def.skillLevel) {
      return { ok: false, why: 'مهارت نبرد سطح ' + U.fa(def.skillLevel) + ' لازم است' };
    }
    if (!g.inv.canAfford(def.bait)) {
      const k = Object.keys(def.bait)[0];
      return { ok: false, why: U.fa(def.bait[k]) + ' ' + C.ITEMS[k].name + ' برای طعمه لازم داری' };
    }
    return { ok: true };
  };

  /** held down each frame while E is on a wild falcon or cheetah */
  Companions.prototype.holdTame = function (dt) {
    const g = this.game, p = g.player.pos;
    const c = this.nearestWild(p.x, p.z);
    if (!c) { this.cancelTame(); return false; }
    const chk = this.tameCheck(c);
    if (!chk.ok) {
      this.cancelTame();
      if (this._warnT === undefined || this._warnT <= 0) {
        this._warnT = 2.5;
        g.ui.toast('🪶 ' + chk.why, 'bad');
        g.audio.deny();
      }
      return false;
    }
    if (!this.taming || this.taming.pet !== c) this.taming = { pet: c, t: 0 };
    this.taming.t += dt;
    c.spook = 0.5;
    if (this.taming.t >= c.def.tameTime) {
      const done = this.taming.pet;
      this.taming = null;
      this.tame(done);
    }
    return true;
  };

  Companions.prototype.cancelTame = function () { this.taming = null; };

  Companions.prototype.tame = function (c) {
    const g = this.game;
    if (!c || c.tame) return false;
    const chk = this.tameCheck(c);
    if (!chk.ok) { g.ui.toast('🪶 ' + chk.why, 'bad'); g.audio.deny(); return false; }
    g.inv.pay(c.def.bait);
    c.tame = true;
    c.state = 'follow';
    if (c.kind === 'falcon') this._perch(c);
    g.audio.levelUp();
    g.progress.addSkill('combat', 60);
    g.progress.addXp(120);
    g.progress.stat('tame_' + c.kind, 1);
    g.ui.levelUp(c.def.icon + ' ' + c.def.name + ' رام شد!');
    g.ui.toast(c.def.icon + ' ' + c.def.name + ' رام شد — با کلید H به کار بگیرش', 'gold');
    g.chronicle.write(c.def.icon, c.def.name + ' رام شد و از آن پس همراه شکار شد.', 'good');
    return true;
  };

  /* ===================== THE FALCON'S PERCH ===================== */
  Companions.prototype._perch = function (c) {
    const g = this.game;
    const anchor = g.player.object || null;
    if (!anchor) return;
    if (c.obj.parent !== anchor) {
      (c.obj.parent || this.group).remove(c.obj);
      anchor.add(c.obj);
    }
    c.perched = true;
    c.obj.position.set(c.def.perch[0], c.def.perch[1], c.def.perch[2]);
    c.obj.rotation.set(0, 0, 0);
    c.obj.scale.setScalar(1);
  };

  Companions.prototype._unperch = function (c) {
    const g = this.game;
    if (!c.perched) return;
    c.obj.getWorldPosition(_v);
    (c.obj.parent || this.group).remove(c.obj);
    this.group.add(c.obj);
    c.perched = false;
    c.x = _v.x; c.z = _v.z; c.y = _v.y;
    c.obj.position.set(c.x, c.y, c.z);
  };
  const _v = new THREE.Vector3();

  /* ===================== SETTING THEM ON SOMETHING ===================== */
  /** H — send every ready companion after the current quarry */
  Companions.prototype.release = function () {
    const g = this.game;
    const pets = this.tamed();
    if (!pets.length) {
      g.ui.toast('🦅 هنوز باز یا یوزی رام نکرده‌ای — کنارشان برو و E را نگه دار', 'bad');
      g.audio.deny();
      return false;
    }
    /* whatever you are aiming at, else the nearest animal in front of you */
    const t = g.gather.target;
    let prey = (t && t.kind === 'animal' && !t.animal.dead) ? t.animal : null;
    if (!prey) {
      const p = g.player.pos;
      prey = g.wildlife.nearest(p.x, p.z, 30, false);
    }
    if (!prey) {
      g.ui.toast('🦅 شکاری در دید نیست', 'bad');
      g.audio.deny();
      return false;
    }
    let sent = 0;
    for (const c of pets) {
      if (c.cd > 0) continue;
      const d = U.dist(c.perched ? g.player.pos.x : c.x, c.perched ? g.player.pos.z : c.z, prey.x, prey.z);
      if (d > c.def.hunt.range) continue;
      if (c.perched) this._unperch(c);
      c.state = 'hunt';
      c.hunt = prey;
      c.cd = c.def.hunt.cooldown;
      c.flight = 0;
      sent++;
    }
    if (!sent) {
      g.ui.toast('🦅 هنوز آماده نیستند', 'bad');
      g.audio.deny();
      return false;
    }
    g.audio.beast(false);
    g.ui.toast('🦅 ' + U.fa(sent) + ' همراه رها شد — روی ' + prey.def.name, 'good');
    return true;
  };

  /* ===================== FRAME ===================== */
  Companions.prototype.update = function (dt) {
    const g = this.game, world = g.world, p = g.player.pos;
    if (this._warnT !== undefined) this._warnT -= dt;

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 12 + Math.random() * 14;
      if (this.wildCount() < CO.maxWild) this._trySpawn();
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.cd = Math.max(0, c.cd - dt);
      c.spook = Math.max(0, c.spook - dt);
      /* wild ones out of sight are forgotten; a tamed one never is */
      if (!c.tame && U.dist2(c.x, c.z, p.x, p.z) > 175 * 175) { this._remove(i); continue; }
      if (c.perched) { this._posePerched(c, dt); continue; }
      /* Only what walks can be wedged in a wall. Pushing a falcon out of a
         footprint it is flying *over* stopped it ever reaching your arm in
         a built-up town — it was shoved back once per frame. */
      if (g.building && c.kind !== 'falcon') {
        const esc = g.building.escapeFrom(c.x, c.z, 0.25, false);
        if (esc) { c.x = esc.x; c.z = esc.z; c.y = world.heightAt(c.x, c.z); }
      }
      if (c.state === 'hunt') this._stepHunt(c, dt, world);
      else this._stepRoam(c, dt, world, p);
    }

    if (this.taming) {
      const t = this.taming;
      if (!t.pet || t.pet.tame ||
        U.dist(p.x, p.z, t.pet.x, t.pet.z) > t.pet.def.tameRange + 1.5) this.taming = null;
    }
  };

  Companions.prototype._stepRoam = function (c, dt, world, p) {
    const pd = U.dist(c.x, c.z, p.x, p.z);
    c.timer -= dt;
    let wantX = 0, wantZ = 0, speed = 0;

    if (!c.tame && pd < c.def.spookRange && c.spook <= 0) {
      wantX = c.x - p.x; wantZ = c.z - p.z;
      speed = c.kind === 'falcon' ? 6.5 : 9;
    } else if (c.tame) {
      /* a loose falcon returns to the glove; a cheetah keeps to your heel */
      if (c.kind === 'falcon' && pd < 3.5) { this._perch(c); return; }
      const keep = c.kind === 'falcon' ? 2.5 : (c.def.follow || 6);
      if (pd > keep) {
        wantX = p.x - c.x; wantZ = p.z - c.z;
        speed = Math.min(c.def.speed || c.def.hunt.travel, 3 + pd * 0.9);
      }
      /* a cheetah goes for anything already coming at you */
      if (c.kind === 'cheetah' && c.cd <= 0) {
        const foe = this.game.wildlife.nearest(p.x, p.z, 17, true);
        if (foe && foe.angry) { c.state = 'hunt'; c.hunt = foe; c.cd = c.def.hunt.cooldown; }
      }
    } else {
      if (c.timer <= 0) {
        c.timer = 2 + Math.random() * 4;
        c.wanderYaw = Math.random() * 6.283;
        c.rest = Math.random() < 0.4;
      }
      if (!c.rest) { wantX = Math.sin(c.wanderYaw); wantZ = Math.cos(c.wanderYaw); speed = c.kind === 'falcon' ? 2.4 : 4.2; }
    }
    this._move(c, wantX, wantZ, speed, dt, world);
    this._pose(c, dt, speed > 0.2);
  };

  Companions.prototype._stepHunt = function (c, dt, world) {
    const g = this.game, prey = c.hunt;
    if (!prey || prey.dead || g.wildlife.animals.indexOf(prey) < 0) {
      c.hunt = null; c.state = c.tame ? 'follow' : 'wander';
      return;
    }
    c.flight += dt;
    const dx = prey.x - c.x, dz = prey.z - c.z;
    const d = Math.hypot(dx, dz);
    const H = c.def.hunt;
    if (d < 1.6 || c.flight > 7) {
      if (d < 2.4) {
        const dmg = H.dmg * g.progress.powerMul();
        g.wildlife.hit(prey, dmg, c.x, c.z);
        g.fx.hitBurst(prey.x, prey.y + 0.8, prey.z, c.kind === 'falcon' ? 0xf0c437 : 0xd8b878, 12);
        g.progress.addSkill('combat', 8);
      }
      c.hunt = null;
      c.state = c.tame ? 'follow' : 'wander';
      c.flight = 0;
      return;
    }
    this._move(c, dx, dz, H.travel, dt, world, true);
    this._pose(c, dt, true);
  };

  Companions.prototype._move = function (c, wantX, wantZ, speed, dt, world, fly) {
    const wl = Math.hypot(wantX, wantZ);
    if (wl < 0.0001 || speed < 0.05) {
      c.y = U.damp(c.y, this._restY(c, world), 8, dt);
      c.moving = false;
      return;
    }
    const dx = (wantX / wl) * speed, dz = (wantZ / wl) * speed;
    const nx = c.x + dx * dt, nz = c.z + dz * dt;
    const nh = world.heightAt(nx, nz);
    /* A falcon off the glove is a falcon in the air: it clears walls and
       rooftops on the way out and on the way home. Walking one back to your
       arm through a built-up town leaves it stuck against the first house. */
    const airborne = c.kind === 'falcon' && (fly || c.tame);
    const blocked = !airborne && (nh < W.waterLevel + 0.15 || Math.abs(nh - (c.y - this._lift(c))) > 2.2 ||
      (this.game.building && this.game.building.blocks(nx, nz, false)));
    if (blocked) { c.timer = 0; c.wanderYaw = Math.random() * 6.283; c.moving = false; }
    else { c.x = nx; c.z = nz; c.moving = true; }
    const target = airborne ? nh + 5.5 : this._restY(c, world);
    c.y = U.damp(c.y, target, 5, dt);
    c.yaw += U.angleDelta(c.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 7);
    c.phase += dt * (3 + speed * 0.6);
  };

  Companions.prototype._lift = function (c) { return c.kind === 'falcon' ? 0.45 : 0; };
  Companions.prototype._restY = function (c, world) {
    return world.heightAt(c.x, c.z) + this._lift(c);
  };

  Companions.prototype._pose = function (c, dt, moving) {
    const o = c.obj;
    o.position.set(c.x, c.y, c.z);
    o.rotation.y = c.yaw;
    if (c.kind === 'falcon') {
      const wings = o.userData.wings;
      if (wings) {
        const amp = moving ? 0.95 : 0.12;
        const beat = moving ? 9 : 1.6;
        const s = Math.sin(c.phase * beat) * amp;
        wings[0].rotation.set(0, 0, s);
        wings[1].rotation.set(0, 0, -s);
      }
      o.rotation.x = moving ? -0.18 : 0;
    } else {
      const legs = o.userData.legs;
      if (legs) {
        const amp = moving ? 0.85 : 0;
        for (let i = 0; i < legs.length; i++) {
          legs[i].rotation.x = Math.sin(c.phase * 2 + legs[i].userData.phase) * amp;
        }
      }
      if (o.userData.tail) o.userData.tail.rotation.y = Math.sin(c.phase * 2.5) * 0.5;
    }
  };

  /* On the glove: wings folded back along the flanks — a hawk at rest is
     a narrow thing, and spread wings on a shoulder look like a coat rack.
     A slow shuffle and a turn of the head keep it alive. */
  const PERCH_FOLD = 1.28;
  Companions.prototype._posePerched = function (c, dt) {
    c.phase += dt * 1.4;
    const o = c.obj;
    o.position.set(c.def.perch[0], c.def.perch[1] + Math.sin(c.phase) * 0.015, c.def.perch[2]);
    o.rotation.set(0, Math.sin(c.phase * 0.5) * 0.35, 0);
    const wings = o.userData.wings;
    if (wings) {
      const ruffle = Math.max(0, Math.sin(c.phase * 3)) * 0.14;
      wings[0].rotation.set(0, PERCH_FOLD, -0.25 - ruffle);
      wings[1].rotation.set(0, -PERCH_FOLD, 0.25 + ruffle);
    }
  };

  /* ===================== PERSISTENCE ===================== */
  Companions.prototype.serialize = function () {
    const out = [];
    for (const c of this.list) {
      if (!c.tame) continue;                 // wild ones respawn on their own
      out.push({ k: c.kind, x: c.x, z: c.z, coat: c.coat });
    }
    return out;
  };
  Companions.prototype.deserialize = function (arr) {
    this.clear();
    if (!Array.isArray(arr)) return;
    const world = this.game.world;
    for (const d of arr) {
      if (!CO[d.k]) continue;
      const c = this._add({
        kind: d.k, x: d.x, z: d.z, y: world.heightAt(d.x, d.z), coat: d.coat, tame: true
      });
      c.state = 'follow';
      if (c.kind === 'falcon') this._perch(c);
    }
  };

  Companions.prototype.clear = function () {
    while (this.list.length) this._remove(this.list.length - 1);
    this.taming = null;
  };

  G.Companions = Companions;
})(window.GAME = window.GAME || {});
