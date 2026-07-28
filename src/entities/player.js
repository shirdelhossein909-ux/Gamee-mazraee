/* =========================================================
   player.js — character controller, third-person camera rig
   and procedural walk / swing animation.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;
  const PC = C.PLAYER, W = C.WORLD;

  function Player(game) {
    this.game = game;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.onGround = true;
    this.inWater = false;

    this.hp = PC.hp; this.maxHp = PC.hp;
    this.energy = PC.energy; this.maxEnergy = PC.energy;
    this.stamina = PC.stamina; this.maxStamina = PC.stamina;

    this.object = M.humanoid({ shirt: 0x3f7a9e, pants: 0x4a4438, hat: 0xc7a24d });
    this.object.castShadow = true;
    game.scene.add(this.object);

    this.walkPhase = 0;
    this.swingT = 0;
    this.swingKind = 'swing';
    this.heldId = null;
    this.held = null;
    this.hurtCooldown = 0;
    this.attackCooldown = 0;
    this.energyTick = 0;

    /* camera rig */
    this.camYaw = 0.6;
    this.camPitch = 0.42;
    this.camDist = 8.5;
    this.camWant = 8.5;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this._firstFrame = true;

    this.reset(game.world.spawnPoint());
  }

  Player.prototype.reset = function (p) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.object.position.copy(p);
    this.camLook.copy(p).y += 1.4;
    this._firstFrame = true;
  };

  /* ===================== EQUIPMENT ===================== */
  Player.prototype.equip = function (toolId) {
    if (this.heldId === toolId) return;
    const hand = this.object.userData.hand;
    if (this.held) { hand.remove(this.held); this.held = null; }
    this.heldId = toolId;
    if (!toolId) return;
    const lvl = this.game.progress ? this.game.progress.toolLevel(toolId) : 1;
    const m = M.toolModel(toolId, lvl);
    if (m) {
      m.rotation.set(-0.4, 0, -0.15);
      m.position.set(0.02, 0, 0.06);
      hand.add(m);
      this.held = m;
    }
  };
  Player.prototype.refreshTool = function () {
    const id = this.heldId; this.heldId = null; this.equip(id);
  };

  /* ===================== ACTIONS ===================== */
  Player.prototype.swing = function (kind) {
    this.swingT = 1;
    this.swingKind = kind || 'swing';
  };

  Player.prototype.damage = function (n, fromX, fromZ) {
    if (this.hurtCooldown > 0) return false;
    this.hp = Math.max(0, this.hp - n);
    this.hurtCooldown = 0.55;
    if (fromX !== undefined) {
      const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
      const l = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / l) * 6;
      this.vel.z += (dz / l) * 6;
      this.vel.y = Math.max(this.vel.y, 3);
    }
    this.game.bus.emit('playerhurt', n);
    if (this.hp <= 0) this.game.bus.emit('playerdown');
    return true;
  };

  Player.prototype.heal = function (n) { this.hp = Math.min(this.maxHp, this.hp + n); };
  Player.prototype.feed = function (n) { this.energy = Math.min(this.maxEnergy, this.energy + n); };
  Player.prototype.spend = function (n) {
    if (this.stamina < n) return false;
    this.stamina -= n;
    this.energy = Math.max(0, this.energy - n * 0.18);
    return true;
  };

  /* ===================== UPDATE ===================== */
  Player.prototype.update = function (dt) {
    const IN = G.Input, world = this.game.world;

    /* ---- camera look ---- */
    const sens = 0.0022 * IN.sensitivity;
    if (IN.enabled) {
      this.camYaw -= IN.dx * sens;
      this.camPitch = U.clamp(this.camPitch + IN.dy * sens, -0.85, 1.15);
      if (IN.wheel) this.camWant = U.clamp(this.camWant + IN.wheel * 1.1, 2.2, 18);
    }
    this.camDist = U.damp(this.camDist, this.camWant, 9, dt);

    /* ---- movement ---- */
    const ax = IN.axis();
    const moving = ax.x !== 0 || ax.y !== 0;
    const wantRun = IN.down('ShiftLeft') || IN.down('ShiftRight');
    const canRun = wantRun && this.stamina > 1 && moving;
    let speed = PC.speed * (canRun ? PC.runMul : 1);
    if (this.energy <= 0) speed *= 0.55;
    if (this.inWater) speed *= 0.62;

    const cy = this.camYaw;
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    const rx = Math.cos(cy), rz = -Math.sin(cy);
    let dx = fx * ax.y + rx * ax.x;
    let dz = fz * ax.y + rz * ax.x;
    const dl = Math.hypot(dx, dz);
    if (dl > 0) { dx /= dl; dz /= dl; }

    const targetVX = dx * speed, targetVZ = dz * speed;
    const accel = this.onGround ? 14 : 4.5;
    this.vel.x = U.damp(this.vel.x, targetVX, accel, dt);
    this.vel.z = U.damp(this.vel.z, targetVZ, accel, dt);

    if (canRun) {
      this.stamina = Math.max(0, this.stamina - dt * 11);
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + dt * (moving ? 5 : 13));
    }

    /* ---- vertical ---- */
    this.vel.y -= PC.gravity * dt;
    if (this.onGround && IN.down('Space') && !this._jumpLock) {
      this.vel.y = PC.jump;
      this.onGround = false;
      this._jumpLock = true;
    }
    if (!IN.down('Space')) this._jumpLock = false;

    /* ---- integrate with collision ---- */
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    if (this._canStand(nx, this.pos.z)) this.pos.x = nx; else this.vel.x *= 0.2;
    if (this._canStand(this.pos.x, nz)) this.pos.z = nz; else this.vel.z *= 0.2;

    this.pos.y += this.vel.y * dt;

    const ground = world.heightAt(this.pos.x, this.pos.z);
    this.inWater = ground < W.waterLevel - 0.25;
    const floor = this.inWater ? Math.max(ground, W.waterLevel - 1.15) : ground;
    if (this.pos.y <= floor) {
      this.pos.y = floor;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > floor + 0.06) {
      this.onGround = false;
    }

    /* ---- facing ---- */
    if (moving) {
      const want = Math.atan2(dx, dz);
      this.yaw += U.angleDelta(this.yaw, want) * Math.min(1, dt * 13);
    } else if (this.swingT > 0.01) {
      const want = this.camYaw + Math.PI;
      this.yaw += U.angleDelta(this.yaw, want) * Math.min(1, dt * 16);
    }

    /* ---- vitals ---- */
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.energyTick += dt;
    if (this.energyTick > 4) {
      this.energyTick = 0;
      this.energy = Math.max(0, this.energy - (moving ? 0.55 : 0.3));
      if (this.energy <= 0) this.hp = Math.max(1, this.hp - 1);
      else if (this.energy > 40 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 0.8);
    }

    /* ---- animation ---- */
    this._animate(dt, moving, canRun);
    this._camera(dt);
  };

  /** blocked by deep water or a solid building */
  Player.prototype._canStand = function (x, z) {
    const h = this.game.world.heightAt(x, z);
    if (h < W.waterLevel - 1.7) return false;
    if (this.game.building && this.game.building.blocks(x, z, true)) return false;
    return true;
  };

  Player.prototype._animate = function (dt, moving, running) {
    const ud = this.object.userData;
    const o = this.object;
    o.position.lerp(this.pos, Math.min(1, dt * 22));
    o.rotation.y = this.yaw;

    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * (2.6 + spd * 1.25);
    const sw = Math.sin(this.walkPhase * 2) * Math.min(1, spd / 5) * (running ? 1.15 : 0.85);

    if (this.onGround) {
      ud.legL.rotation.x = sw * 0.85;
      ud.legR.rotation.x = -sw * 0.85;
      ud.armL.rotation.x = -sw * 0.7;
      ud.torso.position.y = 0.86 + Math.abs(Math.sin(this.walkPhase * 2)) * 0.045 * Math.min(1, spd / 4);
      ud.head.position.y = 1.34 + Math.abs(Math.sin(this.walkPhase * 2)) * 0.03 * Math.min(1, spd / 4);
    } else {
      ud.legL.rotation.x = -0.5; ud.legR.rotation.x = 0.35;
      ud.armL.rotation.x = -1.2;
    }
    ud.torso.rotation.z = Math.sin(this.walkPhase) * 0.03;

    /* right arm: swing action overrides walk */
    if (this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt * 3.4);
      const t = 1 - this.swingT;                    // 0..1
      const e = Math.sin(Math.min(1, t * 1.35) * Math.PI);
      if (this.swingKind === 'bow') {
        ud.armR.rotation.x = -1.5 + e * 0.15;
        ud.armL.rotation.x = -1.4;
      } else if (this.swingKind === 'water' || this.swingKind === 'plant') {
        ud.armR.rotation.x = -0.6 - e * 0.9;
      } else if (this.swingKind === 'cast') {
        ud.armR.rotation.x = -0.5 - e * 1.7;
      } else {
        ud.armR.rotation.x = -2.5 * e + 0.2;
        ud.torso.rotation.y = -e * 0.35;
      }
    } else {
      ud.armR.rotation.x = U.damp(ud.armR.rotation.x, moving ? sw * 0.7 : 0, 12, dt);
      ud.torso.rotation.y = U.damp(ud.torso.rotation.y, 0, 12, dt);
      ud.armL.rotation.x = U.damp(ud.armL.rotation.x, moving ? -sw * 0.7 : 0, 12, dt);
    }
    // hurt flash: lean back
    if (this.hurtCooldown > 0.3) ud.torso.rotation.x = -0.25 * (this.hurtCooldown - 0.3) / 0.25;
    else ud.torso.rotation.x = U.damp(ud.torso.rotation.x, 0, 10, dt);
  };

  Player.prototype._camera = function (dt) {
    const cam = this.game.camera, world = this.game.world;
    const targetY = this.pos.y + 1.45;
    const want = this.camDist;
    const STEPS = 6;

    /* How far can the boom extend at a given pitch before terrain comes
       between the camera and the player? */
    const clearanceAt = (pitch) => {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const dx = Math.sin(this.camYaw) * cp, dz = Math.cos(this.camYaw) * cp;
      for (let i = 1; i <= STEPS; i++) {
        const t = (i / STEPS) * want;
        if (targetY + sp * t < world.heightAt(this.pos.x + dx * t, this.pos.z + dz * t) + 0.7) {
          return ((i - 1) / STEPS) * want;
        }
      }
      return want;
    };

    /* Against a hillside, climb to a steeper angle and look down over it —
       collapsing the boom onto the player's back instead is disorienting. */
    let pitch = this.camPitch, d = clearanceAt(this.camPitch);
    if (d < want - 0.01) {
      for (let a = 1; a <= 3; a++) {
        const p2 = Math.min(1.32, this.camPitch + a * 0.25);
        const c = clearanceAt(p2);
        if (c > d) { d = c; pitch = p2; }
        if (c >= want - 0.01 || p2 >= 1.32) break;
      }
    }
    d = Math.max(2.4, d);

    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dirX = Math.sin(this.camYaw) * cp;
    const dirZ = Math.cos(this.camYaw) * cp;
    const wantX = this.pos.x + dirX * d;
    const wantZ = this.pos.z + dirZ * d;
    let wantY = targetY + sp * d;
    wantY = Math.max(wantY, world.heightAt(wantX, wantZ) + 0.85);

    if (this._firstFrame) {
      this.camPos.set(wantX, wantY, wantZ);
      this.camLook.set(this.pos.x, targetY, this.pos.z);
      this._firstFrame = false;
    } else {
      const k = 16;
      this.camPos.x = U.damp(this.camPos.x, wantX, k, dt);
      this.camPos.y = U.damp(this.camPos.y, wantY, k, dt);
      this.camPos.z = U.damp(this.camPos.z, wantZ, k, dt);
      this.camLook.x = U.damp(this.camLook.x, this.pos.x, 18, dt);
      this.camLook.y = U.damp(this.camLook.y, targetY, 18, dt);
      this.camLook.z = U.damp(this.camLook.z, this.pos.z, 18, dt);
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  };

  /* ray from the crosshair into the world */
  const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
  Player.prototype.aimRay = function () {
    const cam = this.game.camera;
    cam.getWorldPosition(_ro);
    cam.getWorldDirection(_rd);
    return { origin: _ro, dir: _rd };
  };

  /** point in front of the player at ground level */
  Player.prototype.frontPoint = function (dist) {
    const d = dist === undefined ? 1.6 : dist;
    return new THREE.Vector3(
      this.pos.x + Math.sin(this.yaw) * d, 0,
      this.pos.z + Math.cos(this.yaw) * d
    );
  };

  Player.prototype.serialize = function () {
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw,
      hp: this.hp, energy: this.energy, stamina: this.stamina,
      camYaw: this.camYaw, camPitch: this.camPitch, camDist: this.camWant,
      maxHp: this.maxHp
    };
  };
  Player.prototype.deserialize = function (d) {
    this.pos.set(d.x, d.y, d.z);
    this.object.position.copy(this.pos);
    this.yaw = d.yaw || 0;
    this.hp = d.hp; this.energy = d.energy; this.stamina = d.stamina;
    this.maxHp = d.maxHp || PC.hp;
    this.camYaw = d.camYaw || 0; this.camPitch = d.camPitch || 0.4;
    this.camWant = this.camDist = d.camDist || 8.5;
    this._firstFrame = true;
  };

  G.Player = Player;
})(window.GAME = window.GAME || {});
