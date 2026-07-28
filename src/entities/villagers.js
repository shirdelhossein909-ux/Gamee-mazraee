/* =========================================================
   villagers.js — townsfolk that appear as the settlement
   grows. They stroll between buildings and give the town
   a sense of life. Count scales with population.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;

  const SHIRTS = [0x9e5f3f, 0x3f7a9e, 0x6a8a3f, 0x8a3f6a, 0xb5893f, 0x4a5a8a, 0x7a4a4a];
  const PANTS = [0x4a4438, 0x3a3a44, 0x5a4a38, 0x33443a];
  const HAIR = [0x2a1c12, 0x4a3628, 0x6a5238, 0x1a1a1a, 0x8a6a3a];

  function Villagers(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.timer = 0;
  }

  Villagers.prototype.desired = function () {
    const pop = this.game.progress ? this.game.progress.population : 0;
    return Math.min(16, Math.floor(pop / 2.5));
  };

  Villagers.prototype.center = function () {
    const b = this.game.building;
    if (b && b.list.length) return { x: b.centerX, z: b.centerZ };
    return { x: 0, z: 0 };
  };

  Villagers.prototype.update = function (dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 2.5;
      const want = this.desired();
      while (this.list.length < want) this._add();
      while (this.list.length > want) this._remove();
    }
    const world = this.game.world;
    const pp = this.game.player.pos;
    for (const v of this.list) {
      v.t -= dt;
      if (v.t <= 0) this._retarget(v);

      const dx = v.tx - v.x, dz = v.tz - v.z;
      const d = Math.hypot(dx, dz);
      let moving = false;
      if (d > 0.6) {
        const sp = v.speed;
        const nx = v.x + (dx / d) * sp * dt, nz = v.z + (dz / d) * sp * dt;
        const nh = world.heightAt(nx, nz);
        if (nh > C.WORLD.waterLevel + 0.2 && Math.abs(nh - v.y) < 1.8 &&
          !(this.game.building && this.game.building.blocks(nx, nz, true))) {
          v.x = nx; v.z = nz; v.y = nh; moving = true;
        } else { v.t = 0; }
        v.yaw += U.angleDelta(v.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
      }
      v.phase += dt * (moving ? 7 : 1.3);

      const o = v.obj;
      o.position.set(v.x, v.y, v.z);
      o.rotation.y = v.yaw;
      const ud = o.userData;
      const sw = moving ? Math.sin(v.phase) * 0.65 : 0;
      ud.legL.rotation.x = sw; ud.legR.rotation.x = -sw;
      ud.armL.rotation.x = -sw * 0.8; ud.armR.rotation.x = sw * 0.8;
      ud.torso.position.y = 0.86 + (moving ? Math.abs(Math.sin(v.phase)) * 0.04 : 0);
      // look at the player when close
      const pd = U.dist2(v.x, v.z, pp.x, pp.z);
      if (pd < 64 && !moving) {
        const want = Math.atan2(pp.x - v.x, pp.z - v.z);
        v.yaw += U.angleDelta(v.yaw, want) * Math.min(1, dt * 3);
      }
      // hide villagers far from the player to save draw calls
      o.visible = pd < 120 * 120;
    }
  };

  Villagers.prototype._retarget = function (v) {
    const b = this.game.building;
    v.t = 3 + Math.random() * 6;
    if (b && b.list.length && Math.random() < 0.72) {
      const t = b.list[Math.floor(Math.random() * b.list.length)];
      const a = Math.random() * 6.283, r = 2.5 + Math.random() * 3.5;
      v.tx = t.x + Math.cos(a) * r;
      v.tz = t.z + Math.sin(a) * r;
    } else {
      const c = this.center();
      const a = Math.random() * 6.283, r = Math.random() * 22;
      v.tx = c.x + Math.cos(a) * r;
      v.tz = c.z + Math.sin(a) * r;
    }
  };

  Villagers.prototype._add = function () {
    const c = this.center();
    const a = Math.random() * 6.283, r = 4 + Math.random() * 14;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    const obj = M.humanoid({
      shirt: U.pick(SHIRTS), pants: U.pick(PANTS), hair: U.pick(HAIR),
      hat: Math.random() < 0.4 ? 0xc7a24d : null,
      apron: Math.random() < 0.3
    });
    obj.scale.setScalar(0.92 + Math.random() * 0.14);
    this.group.add(obj);
    const v = {
      obj: obj, x: x, z: z, y: this.game.world.heightAt(x, z),
      yaw: Math.random() * 6.283, tx: x, tz: z, t: 0,
      speed: 1.6 + Math.random() * 1.2, phase: Math.random() * 6.283
    };
    this.list.push(v);
  };

  Villagers.prototype._remove = function () {
    const v = this.list.pop();
    if (!v) return;
    this.group.remove(v.obj);
    v.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
  };

  Villagers.prototype.clear = function () { while (this.list.length) this._remove(); };

  G.Villagers = Villagers;
})(window.GAME = window.GAME || {});
