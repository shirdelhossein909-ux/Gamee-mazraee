/* =========================================================
   vehicles.js — the free rowing boat and the paid car.
   Buy one, it parks next to you; press V (or E while
   looking at it) to get in and drive.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;
  const W = C.WORLD;

  function Vehicles(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.mounted = null;
    this._sfxT = 0;
  }

  /* ===================== OWNERSHIP ===================== */
  Vehicles.prototype.own = function (type) {
    for (const v of this.list) if (v.type === type) return v;
    return null;
  };

  Vehicles.prototype.buy = function (type) {
    const g = this.game, def = C.VEHICLES[type];
    if (!def) return false;
    if (this.own(type)) { g.ui.toast('همین حالا یکی داری — با دکمهٔ «فراخوانی» بیارش پیشت', 'bad'); return false; }
    if (!g.inv.canAfford(def.cost)) { g.ui.toast('⚠️ منابع کافی نداری', 'bad'); g.audio.deny(); return false; }
    const spot = this._parkSpot(def);
    if (!spot) { g.ui.toast('⚠️ ' + def.needWhy, 'bad'); g.audio.deny(); return false; }
    g.inv.pay(def.cost);
    this._spawn(type, spot.x, spot.z, 1);
    g.ui.toast(def.icon + ' ' + def.name + ' تحویل گرفتی! با کلید V سوار شو', 'gold');
    g.audio.upgrade();
    return true;
  };

  Vehicles.prototype.recall = function (type) {
    const g = this.game, v = this.own(type);
    if (!v) return false;
    if (v.mounted) return false;
    const spot = this._parkSpot(C.VEHICLES[type]);
    if (!spot) { g.ui.toast('⚠️ ' + C.VEHICLES[type].needWhy, 'bad'); g.audio.deny(); return false; }
    v.x = spot.x; v.z = spot.z;
    v.y = this._restY(v);
    v.yaw = g.player.yaw;
    g.ui.toast(C.VEHICLES[type].icon + ' ' + C.VEHICLES[type].name + ' آمد', 'good');
    g.audio.click();
    return true;
  };

  Vehicles.prototype.upgrade = function (type) {
    const g = this.game, v = this.own(type);
    if (!v) return false;
    const def = C.VEHICLES[type];
    if (v.level >= def.max) { g.ui.toast('در بالاترین سطح است', 'bad'); return false; }
    const cost = def.upgrade(v.level + 1);
    if (!g.inv.canAfford(cost)) { g.ui.toast('⚠️ منابع کافی نداری', 'bad'); g.audio.deny(); return false; }
    g.inv.pay(cost);
    v.level++;
    this._rebuild(v);
    g.ui.toast('⬆️ ' + def.name + ' به سطح ' + U.fa(v.level) + ' رسید', 'gold');
    g.audio.upgrade();
    return true;
  };

  /** a legal parking spot near the player (water for boats, land for cars) */
  Vehicles.prototype._parkSpot = function (def) {
    const g = this.game, p = g.player.pos;
    for (let r = 3; r <= 26; r += 2.5) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * 6.283 + r;
        const x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r;
        const h = g.world.heightAt(x, z);
        const wet = h < W.waterLevel - 0.9;
        if (def.water ? wet : (!wet && h > W.waterLevel + 0.2 && g.world.slopeAt(x, z) < 2)) {
          if (g.building && g.building.occupied(x, z, 1.5)) continue;
          return { x: x, z: z };
        }
      }
    }
    return null;
  };

  Vehicles.prototype._spawn = function (type, x, z, level) {
    const def = C.VEHICLES[type];
    const v = {
      type: type, def: def, level: level || 1,
      x: x, z: z, y: 0, yaw: this.game.player.yaw,
      vx: 0, vz: 0, speed: 0, mounted: false, obj: null, bob: Math.random() * 6.28
    };
    this.list.push(v);
    this._rebuild(v);
    v.y = this._restY(v);
    return v;
  };

  Vehicles.prototype._rebuild = function (v) {
    if (v.obj) {
      this.group.remove(v.obj);
      v.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    v.obj = v.type === 'boat' ? M.boat(v.level) : M.car(v.level);
    this.group.add(v.obj);
  };

  Vehicles.prototype._restY = function (v) {
    const h = this.game.world.heightAt(v.x, v.z);
    return v.def.water ? Math.max(h, W.waterLevel) - 0.28 : h;
  };

  /* ===================== MOUNTING ===================== */
  Vehicles.prototype.nearest = function (x, z, radius) {
    let best = null, bd = radius * radius;
    for (const v of this.list) {
      if (v.mounted) continue;
      const d = U.dist2(x, z, v.x, v.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  };

  Vehicles.prototype.toggle = function (target) {
    if (this.mounted) return this.dismount();
    const g = this.game;
    const v = target || this.nearest(g.player.pos.x, g.player.pos.z, 6);
    if (!v) { g.ui.toast('🚗 وسیله‌ای این نزدیکی نیست', 'bad'); return false; }
    return this.mount(v);
  };

  Vehicles.prototype.mount = function (v) {
    const g = this.game;
    if (U.dist(g.player.pos.x, g.player.pos.z, v.x, v.z) > 7) {
      g.ui.toast('خیلی دور است', 'bad'); return false;
    }
    this.mounted = v;
    v.mounted = true;
    g.player.mount = v;
    g.player.vel.set(0, 0, 0);
    if (v.type === 'car') g.audio.engineStart(); else g.audio.boatMove();
    g.ui.toast(v.def.icon + ' سوار شدی — ' + (v.type === 'boat' ? 'روی آب حرکت کن' : 'گاز بده!') + ' · V برای پیاده‌شدن', 'good');
    return true;
  };

  Vehicles.prototype.dismount = function () {
    const g = this.game, v = this.mounted;
    if (!v) return false;
    // step off onto the nearest walkable ground
    let ox = v.x, oz = v.z, found = false;
    for (let r = 2.2; r <= 14 && !found; r += 1.6) {
      for (let a = 0; a < 10; a++) {
        const ang = (a / 10) * 6.283 + v.yaw;
        const x = v.x + Math.cos(ang) * r, z = v.z + Math.sin(ang) * r;
        const h = g.world.heightAt(x, z);
        if (h > W.waterLevel + 0.25 && !(g.building && g.building.blocks(x, z, true))) {
          ox = x; oz = z; found = true; break;
        }
      }
    }
    v.mounted = false;
    this.mounted = null;
    g.player.mount = null;
    g.player.pos.set(ox, Math.max(g.world.heightAt(ox, oz), W.waterLevel - 0.6), oz);
    g.player.vel.set(0, 0, 0);
    g.audio.engineStop();
    if (!found) g.ui.toast('🏊 پریدی توی آب!', 'bad');
    return true;
  };

  /* ===================== UPDATE ===================== */
  Vehicles.prototype.update = function (dt) {
    const g = this.game, IN = G.Input;
    const mounted = this.mounted;

    for (const v of this.list) {
      if (v === mounted) continue;
      v.y = U.damp(v.y, this._restY(v), 6, dt);
      v.bob += dt;
      if (v.obj) {
        v.obj.position.set(v.x, v.y + (v.def.water ? Math.sin(v.bob * 1.4) * 0.07 : 0), v.z);
        v.obj.rotation.set(v.def.water ? Math.sin(v.bob * 1.1) * 0.035 : 0, v.yaw, 0);
      }
    }

    if (!mounted) return;

    /* ---- driving ---- */
    const stat = mounted.def.stat(mounted.level);
    const ax = IN.enabled ? IN.axis() : { x: 0, y: 0 };
    const boost = IN.down('ShiftLeft') || IN.down('ShiftRight');
    const maxSpeed = stat.speed * (boost ? 1.35 : 1);

    // steer relative to the camera, same feel as walking
    const cy = g.player.camYaw;
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    const rx = Math.cos(cy), rz = -Math.sin(cy);
    let dx = fx * ax.y + rx * ax.x;
    let dz = fz * ax.y + rz * ax.x;
    const dl = Math.hypot(dx, dz);
    const throttle = dl > 0.01 ? 1 : 0;
    if (dl > 0) { dx /= dl; dz /= dl; }

    mounted.vx = U.damp(mounted.vx, dx * maxSpeed * throttle, stat.accel, dt);
    mounted.vz = U.damp(mounted.vz, dz * maxSpeed * throttle, stat.accel, dt);
    mounted.speed = Math.hypot(mounted.vx, mounted.vz);

    const nx = mounted.x + mounted.vx * dt;
    const nz = mounted.z + mounted.vz * dt;
    if (this._passable(mounted, nx, mounted.z)) mounted.x = nx; else mounted.vx *= -0.15;
    if (this._passable(mounted, mounted.x, nz)) mounted.z = nz; else mounted.vz *= -0.15;

    if (mounted.speed > 0.2) {
      const want = Math.atan2(mounted.vx, mounted.vz);
      mounted.yaw += U.angleDelta(mounted.yaw, want) * Math.min(1, dt * stat.turn);
    }
    mounted.y = U.damp(mounted.y, this._restY(mounted), 8, dt);
    mounted.bob += dt * (1 + mounted.speed * 0.3);

    const tilt = mounted.def.water
      ? Math.sin(mounted.bob * 1.6) * 0.05 + mounted.speed * 0.012
      : Math.sin(mounted.bob * 7) * 0.012 * Math.min(1, mounted.speed / 6);
    mounted.obj.position.set(mounted.x, mounted.y + (mounted.def.water ? Math.sin(mounted.bob * 1.8) * 0.06 : 0), mounted.z);
    mounted.obj.rotation.set(tilt, mounted.yaw, 0);

    /* the player rides in the seat */
    const p = g.player;
    p.pos.set(mounted.x, mounted.y + mounted.def.seat, mounted.z);
    p.yaw += U.angleDelta(p.yaw, mounted.yaw) * Math.min(1, dt * 10);

    /* audio */
    if (mounted.type === 'car') {
      g.audio.engineRev(U.clamp01(mounted.speed / stat.speed));
    } else {
      this._sfxT -= dt;
      if (this._sfxT <= 0 && mounted.speed > 1.5) { this._sfxT = 0.75; g.audio.boatMove(); }
    }
    // riding burns a little fuel-of-the-soul: it is fast, so it costs energy
    p.energy = Math.max(0, p.energy - dt * 0.12 * (mounted.speed / Math.max(1, stat.speed)));
  };

  Vehicles.prototype._passable = function (v, x, z) {
    const h = this.game.world.heightAt(x, z);
    if (v.def.water) {
      if (h > W.waterLevel - 0.35) return false;             // boats need water
    } else {
      if (h < W.waterLevel + 0.15) return false;             // cars stay dry
      if (this.game.world.slopeAt(x, z, 1.6) > 4.2) return false;  // too steep
    }
    if (this.game.building && this.game.building.blocks(x, z, true)) return false;
    return true;
  };

  /* ===================== PERSISTENCE ===================== */
  Vehicles.prototype.serialize = function () {
    return this.list.map(function (v) {
      return [v.type, Math.round(v.x * 10) / 10, Math.round(v.z * 10) / 10, v.level];
    });
  };
  Vehicles.prototype.deserialize = function (arr) {
    if (this.mounted) this.dismount();
    for (const v of this.list) {
      this.group.remove(v.obj);
      v.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    this.list.length = 0;
    if (!arr) return;
    for (const r of arr) {
      if (!C.VEHICLES[r[0]]) continue;
      this._spawn(r[0], r[1], r[2], r[3] || 1);
    }
  };

  Vehicles.prototype.clear = function () { this.deserialize(null); };

  G.Vehicles = Vehicles;
})(window.GAME = window.GAME || {});
