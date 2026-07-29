/* =========================================================
   horses.js — wild horses, taming, riding and the stable.

   Wild horses graze the plains and shy away if you crowd them.
   Walk up, hold E, and a rope goes over the neck: now it is
   yours. A tamed horse follows you around, can be ridden with
   V (or E), and once you lead it inside the stable's paddock
   it is housed there — the stable's level decides how many.
   Stabled horses are handed out to working villagers, who
   ride them to their jobs and back.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;
  const W = C.WORLD, H = C.HORSE;

  function Horses(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.mounted = null;
    this.taming = null;         // { horse, t }
    this.uid = 1;
    this.spawnT = 4;
  }

  /* ===================== COUNTS ===================== */
  Horses.prototype.tamed = function () {
    let n = 0;
    for (const h of this.list) if (h.tame) n++;
    return n;
  };
  Horses.prototype.stabled = function () {
    let n = 0;
    for (const h of this.list) if (h.tame && h.stabled) n++;
    return n;
  };
  /** how many horses the stables can house */
  Horses.prototype.stableSpace = function () {
    let n = 0;
    const b = this.game.building;
    if (!b) return 0;
    for (const s of b.list) if (s.defId === 'stable') n += 1 + s.level;
    return n;
  };
  Horses.prototype.stableNear = function (x, z) {
    const b = this.game.building;
    if (!b) return null;
    for (const s of b.list) {
      if (s.defId !== 'stable') continue;
      if (U.dist2(x, z, s.x, s.z) < H.stableRange * H.stableRange) return s;
    }
    return null;
  };

  /* ===================== SPAWNING ===================== */
  Horses.prototype._wild = function () {
    let n = 0;
    for (const h of this.list) if (!h.tame) n++;
    return n;
  };

  Horses.prototype.spawnWild = function (x, z) {
    const world = this.game.world;
    const y = world.heightAt(x, z);
    if (y < W.waterLevel + 0.6) return null;
    return this._add({
      x: x, y: y, z: z, tame: false,
      coat: U.pick(H.coats), name: U.pick(H.names)
    });
  };

  Horses.prototype._add = function (o) {
    const h = {
      uid: this.uid++, x: o.x, y: o.y, z: o.z, yaw: Math.random() * 6.283,
      coat: o.coat, name: o.name, tame: !!o.tame, stabled: !!o.stabled,
      rider: null, mounted: false,
      vx: 0, vz: 0, speed: 0, phase: Math.random() * 6.283,
      timer: Math.random() * 3, wanderYaw: Math.random() * 6.283,
      spook: 0, obj: null
    };
    this.list.push(h);
    this._rebuild(h);
    return h;
  };

  Horses.prototype._rebuild = function (h) {
    if (h.obj) {
      this.group.remove(h.obj);
      h.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    h.obj = M.horse(h.coat, h.tame);
    h.obj.position.set(h.x, h.y, h.z);
    this.group.add(h.obj);
  };

  Horses.prototype._remove = function (i) {
    const h = this.list[i];
    if (h.obj) {
      this.group.remove(h.obj);
      h.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    U.swapRemove(this.list, i);
  };

  Horses.prototype._trySpawn = function () {
    const g = this.game, world = g.world, p = g.player.pos;
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * 6.283;
      const d = 40 + Math.random() * 50;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const y = world.heightAt(x, z);
      if (y < W.waterLevel + 0.8) continue;
      if (world.slopeAt(x, z) > 2.6) continue;
      const biome = world.biomeAt(x, z, y);
      if (biome !== 'plains' && biome !== 'savanna' && biome !== 'forest') continue;
      this.spawnWild(x, z);
      return true;
    }
    return false;
  };

  /* ===================== TAMING ===================== */
  Horses.prototype.nearestWild = function (x, z, radius) {
    let best = null, bd = radius * radius;
    for (const h of this.list) {
      if (h.tame) continue;
      const d = U.dist2(x, z, h.x, h.z);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  };

  Horses.prototype.nearest = function (x, z, radius, tameOnly) {
    let best = null, bd = radius * radius;
    for (const h of this.list) {
      if (h.mounted) continue;
      if (tameOnly && !h.tame) continue;
      const d = U.dist2(x, z, h.x, h.z);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  };

  /** called every frame while E is held down */
  Horses.prototype.holdTame = function (dt) {
    const g = this.game, p = g.player.pos;
    const h = this.nearestWild(p.x, p.z, H.tameRange);
    if (!h) { this.cancelTame(); return false; }
    if (!this.taming || this.taming.horse !== h) this.taming = { horse: h, t: 0 };
    this.taming.t += dt;
    h.spook = 0.6;                       // it holds still while you work on it
    if (this.taming.t >= H.tameTime) {
      const done = this.taming.horse;
      this.taming = null;
      this.tame(done);
    }
    return true;
  };

  Horses.prototype.cancelTame = function () { this.taming = null; };

  Horses.prototype.tame = function (h) {
    const g = this.game;
    if (!h || h.tame) return false;
    if (!g.inv.canAfford(H.ropeCost)) {
      g.ui.toast('🪢 برای طناب ' + U.fa(H.ropeCost.fiber) + ' الیاف لازم داری', 'bad');
      g.audio.deny();
      return false;
    }
    g.inv.pay(H.ropeCost);
    h.tame = true;
    this._rebuild(h);
    g.audio.horse();
    g.audio.levelUp();
    g.progress.addSkill('combat', 25);
    g.progress.addXp(45);
    g.progress.stat('tame', 1);
    g.ui.levelUp('🐎 ' + h.name + ' رام شد!');
    g.ui.toast('🐎 «' + h.name + '» رام شد — با V سوارش شو، ببرش کنار اصطبل تا آنجا بماند', 'gold');
    return true;
  };

  /* ===================== RIDING ===================== */
  Horses.prototype.toggle = function (target) {
    if (this.mounted) return this.dismount();
    const g = this.game;
    const h = target || this.nearest(g.player.pos.x, g.player.pos.z, 6, true);
    if (!h) return false;
    return this.mount(h);
  };

  Horses.prototype.mount = function (h) {
    const g = this.game;
    if (!h) return false;
    if (!h.tame) { g.ui.toast('🐎 اول باید رامش کنی — کلید E را نگه دار', 'bad'); g.audio.deny(); return false; }
    if (h.rider) { g.ui.toast('🐎 یکی از اهالی سوارش است', 'bad'); g.audio.deny(); return false; }
    if (U.dist(g.player.pos.x, g.player.pos.z, h.x, h.z) > 7) { g.ui.toast('خیلی دور است', 'bad'); return false; }
    if (g.vehicles.mounted) g.vehicles.dismount();
    this.mounted = h;
    h.mounted = true;
    h.stabled = false;
    g.player.mount = h;
    g.player.vel.set(0, 0, 0);
    g.audio.horse();
    g.ui.toast('🐎 سوار «' + h.name + '» شدی — V برای پیاده‌شدن', 'good');
    return true;
  };

  Horses.prototype.dismount = function () {
    const g = this.game, h = this.mounted;
    if (!h) return false;
    let ox = h.x, oz = h.z, found = false;
    for (let r = 2.0; r <= 12 && !found; r += 1.4) {
      for (let a = 0; a < 10; a++) {
        const ang = (a / 10) * 6.283 + h.yaw;
        const x = h.x + Math.cos(ang) * r, z = h.z + Math.sin(ang) * r;
        if (g.world.heightAt(x, z) > W.waterLevel + 0.25 &&
          !(g.building && g.building.blocks(x, z, true))) { ox = x; oz = z; found = true; break; }
      }
    }
    h.mounted = false;
    this.mounted = null;
    g.player.mount = null;
    g.player.pos.set(ox, Math.max(g.world.heightAt(ox, oz), W.waterLevel - 0.6), oz);
    g.player.vel.set(0, 0, 0);
    this._checkStable(h);
    return true;
  };

  /** leading a horse into the paddock houses it there */
  Horses.prototype._checkStable = function (h) {
    const g = this.game;
    const s = this.stableNear(h.x, h.z);
    if (!s) return false;
    if (h.stabled) return true;
    if (this.stabled() >= this.stableSpace()) {
      g.ui.toast('🏇 اصطبل جا ندارد — ارتقایش بده یا اصطبل تازه بساز', 'bad');
      return false;
    }
    h.stabled = true;
    h.home = { x: s.x, z: s.z };
    g.audio.coin();
    g.ui.toast('🏇 «' + h.name + '» در اصطبل جا گرفت (' + U.fa(this.stabled()) + '/' + U.fa(this.stableSpace()) + ')', 'gold');
    return true;
  };

  /** a working villager borrows a stabled horse */
  Horses.prototype.lend = function (v) {
    for (const h of this.list) {
      if (!h.tame || h.mounted || h.rider) continue;
      if (!h.stabled) continue;
      h.rider = v;
      return h;
    }
    return null;
  };
  Horses.prototype.giveBack = function (v) {
    for (const h of this.list) if (h.rider === v) { h.rider = null; h.vx = 0; h.vz = 0; }
  };

  /* ===================== FRAME ===================== */
  Horses.prototype.update = function (dt) {
    const g = this.game, world = g.world, p = g.player.pos;

    /* keep a few wild ones roaming nearby */
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 5 + Math.random() * 6;
      if (this._wild() < H.wildCap) this._trySpawn();
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      /* wild horses far away are forgotten; tamed ones are never dropped */
      if (!h.tame && U.dist2(h.x, h.z, p.x, p.z) > 170 * 170) { this._remove(i); continue; }
      if (h === this.mounted) { this._ride(h, dt); continue; }
      if (h.rider) { this._carry(h, dt); continue; }
      this._roam(h, dt, world, p);
    }

    if (this.taming) {
      const t = this.taming;
      if (!t.horse || t.horse.tame ||
        U.dist(p.x, p.z, t.horse.x, t.horse.z) > H.tameRange + 1.5) this.taming = null;
    }
  };

  Horses.prototype._roam = function (h, dt, world, p) {
    const pd = U.dist(h.x, h.z, p.x, p.z);
    h.timer -= dt;
    h.spook = Math.max(0, h.spook - dt);

    let wantX = 0, wantZ = 0, speed = 0;
    if (!h.tame && pd < H.spookRange && h.spook <= 0) {
      // shies away when crowded, but only a couple of steps
      wantX = h.x - p.x; wantZ = h.z - p.z; speed = 4.2;
    } else if (h.tame && !h.stabled && pd > 6 && pd < 70) {
      // a tamed horse trails after you
      wantX = p.x - h.x; wantZ = p.z - h.z;
      speed = Math.min(9, 2.6 + pd * 0.22);
    } else if (h.tame && h.stabled && h.home) {
      const hd = U.dist(h.x, h.z, h.home.x, h.home.z);
      if (hd > 5) { wantX = h.home.x - h.x; wantZ = h.home.z - h.z; speed = 3.4; }
      else speed = 0;
    } else {
      if (h.timer <= 0) {
        h.timer = 2.5 + Math.random() * 4;
        h.wanderYaw = Math.random() * 6.283;
        h.graze = Math.random() < 0.45;
      }
      if (!h.graze) { wantX = Math.sin(h.wanderYaw); wantZ = Math.cos(h.wanderYaw); speed = 2.2; }
    }
    this._step(h, wantX, wantZ, speed, dt, world);
    this._pose(h, dt, speed > 0.2);
  };

  /* a villager riding to work: the villager drives, the horse just carries */
  Horses.prototype._carry = function (h, dt) {
    const v = h.rider;
    if (!v || this.game.villagers.list.indexOf(v) < 0) { h.rider = null; return; }
    h.x = v.x; h.z = v.z;
    h.y = this.game.world.heightAt(h.x, h.z);
    h.yaw = v.yaw;
    this._pose(h, dt, !!v.moving);
  };

  Horses.prototype._step = function (h, wantX, wantZ, speed, dt, world) {
    const wl = Math.hypot(wantX, wantZ);
    if (wl < 0.0001 || speed < 0.05) {
      h.y = world.heightAt(h.x, h.z);
      h.moving = false;
      return;
    }
    const dx = (wantX / wl) * speed, dz = (wantZ / wl) * speed;
    const nx = h.x + dx * dt, nz = h.z + dz * dt;
    const nh = world.heightAt(nx, nz);
    const blocked = nh < W.waterLevel + 0.2 || Math.abs(nh - h.y) > 2.2 ||
      (this.game.building && this.game.building.blocks(nx, nz, false));
    if (blocked) { h.timer = 0; h.wanderYaw = Math.random() * 6.283; h.moving = false; }
    else { h.x = nx; h.z = nz; h.y = nh; h.moving = true; }
    h.yaw += U.angleDelta(h.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
    h.phase += dt * (2.2 + speed * 0.8);
  };

  Horses.prototype._pose = function (h, dt, moving) {
    const o = h.obj;
    if (!o) return;
    o.position.set(h.x, h.y, h.z);
    o.rotation.y = h.yaw;
    const legs = o.userData.legs;
    if (legs) {
      const amp = moving ? 0.55 : 0;
      for (let i = 0; i < legs.length; i++) {
        legs[i].rotation.x = Math.sin(h.phase * 2.4 + legs[i].userData.phase) * amp;
      }
    }
    o.visible = U.dist2(h.x, h.z, this.game.player.pos.x, this.game.player.pos.z) < 150 * 150;
  };

  /* ---- being ridden by the player ---- */
  Horses.prototype._ride = function (h, dt) {
    const g = this.game, IN = G.Input, world = g.world;
    const ax = IN.enabled ? IN.axis() : { x: 0, y: 0 };
    const gallop = IN.down('ShiftLeft') || IN.down('ShiftRight');
    const maxSpeed = H.speed * (gallop ? 1.4 : 1);

    const cy = g.player.camYaw;
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    const rx = Math.cos(cy), rz = -Math.sin(cy);
    let dx = fx * ax.y + rx * ax.x;
    let dz = fz * ax.y + rz * ax.x;
    const dl = Math.hypot(dx, dz);
    const throttle = dl > 0.01 ? 1 : 0;
    if (dl > 0) { dx /= dl; dz /= dl; }

    h.vx = U.damp(h.vx, dx * maxSpeed * throttle, H.accel, dt);
    h.vz = U.damp(h.vz, dz * maxSpeed * throttle, H.accel, dt);
    h.speed = Math.hypot(h.vx, h.vz);

    const passable = (x, z) => {
      const y = world.heightAt(x, z);
      if (y < W.waterLevel - 0.1) return false;              // horses will not swim
      if (g.building && g.building.blocks(x, z, true)) return false;
      return true;
    };
    const nx = h.x + h.vx * dt, nz = h.z + h.vz * dt;
    if (passable(nx, h.z)) h.x = nx; else h.vx *= -0.1;
    if (passable(h.x, nz)) h.z = nz; else h.vz *= -0.1;
    h.y = U.damp(h.y, world.heightAt(h.x, h.z), 10, dt);

    if (h.speed > 0.25) h.yaw += U.angleDelta(h.yaw, Math.atan2(h.vx, h.vz)) * Math.min(1, dt * H.turn);
    h.phase += dt * (2 + h.speed * 0.9);
    this._pose(h, dt, h.speed > 0.4);

    const p = g.player;
    p.pos.set(h.x - Math.sin(h.yaw) * H.seatBack, h.y + H.seat, h.z - Math.cos(h.yaw) * H.seatBack);
    p.yaw += U.angleDelta(p.yaw, h.yaw) * Math.min(1, dt * 10);

    this._hoofT = (this._hoofT || 0) - dt;
    if (this._hoofT <= 0 && h.speed > 2) { this._hoofT = gallop ? 0.28 : 0.42; g.audio.hoof(); }
    p.energy = Math.max(0, p.energy - dt * 0.06 * (h.speed / H.speed));
  };

  /* ===================== PERSISTENCE ===================== */
  Horses.prototype.serialize = function () {
    const out = [];
    for (const h of this.list) {
      if (!h.tame) continue;                 // wild ones respawn on their own
      out.push([Math.round(h.x * 10) / 10, Math.round(h.z * 10) / 10,
      h.coat, h.name, h.stabled ? 1 : 0]);
    }
    return out;
  };

  Horses.prototype.deserialize = function (arr) {
    this.clear();
    if (!arr) return;
    for (const r of arr) {
      const h = this._add({
        x: r[0], z: r[1], y: this.game.world.heightAt(r[0], r[1]),
        coat: r[2], name: r[3], tame: true, stabled: !!r[4]
      });
      if (h.stabled) {
        const s = this.stableNear(h.x, h.z);
        if (s) h.home = { x: s.x, z: s.z }; else h.stabled = false;
      }
    }
  };

  Horses.prototype.clear = function () {
    if (this.mounted) this.dismount();
    this.taming = null;
    while (this.list.length) this._remove(this.list.length - 1);
  };

  G.Horses = Horses;
})(window.GAME = window.GAME || {});
