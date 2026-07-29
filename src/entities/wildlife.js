/* =========================================================
   wildlife.js — animal spawning, steering AI, hunting,
   night raids on the settlement and arrow projectiles.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;
  const W = C.WORLD;

  function Wildlife(game) {
    this.game = game;
    this.animals = [];
    this.arrows = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.spawnTimer = 2;
    this.raidTimer = 0;
    this._pool = Object.create(null);
  }

  /* How tempting a target the settlement is. Drives raid frequency, which
     species turn up, and how many of them. A starting farm scores ~0.2. */
  Wildlife.prototype.threat = function () {
    const g = this.game, T = C.THREAT;
    const b = g.building ? g.building.list.length : 0;
    const pop = g.progress ? g.progress.population : 0;
    const tier = g.progress ? g.progress.tier : 0;
    const lvl = g.progress ? g.progress.level : 1;
    const score = b * T.perBuilding + pop * T.perPopulation +
      tier * T.perTier + lvl * T.perLevel;
    return U.clamp(score / T.divisor, 0, T.max);
  };

  Wildlife.prototype.cap = function () {
    const night = this.game.sky.isNight();
    const t = this.threat();
    return Math.round(night ? 11 + t * 2.6 : 10 + t * 1.4);
  };

  /* ===================== SPAWNING ===================== */
  Wildlife.prototype.update = function (dt) {
    const p = this.game.player;
    this._threatCache = this.threat();
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.6 + Math.random() * 2.2;
      if (this.animals.length < this.cap()) this._trySpawn(p);
    }
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      this._stepAnimal(a, dt, p);
      if (a.dead || U.dist2(a.x, a.z, p.pos.x, p.pos.z) > 165 * 165) this._despawn(i);
    }
    this._stepArrows(dt);
  };

  Wildlife.prototype._trySpawn = function (player) {
    const world = this.game.world;
    const night = this.game.sky.isNight();
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = Math.random() * 6.283;
      const d = 46 + Math.random() * 55;
      const x = player.pos.x + Math.cos(a) * d;
      const z = player.pos.z + Math.sin(a) * d;
      const h = world.heightAt(x, z);
      if (h < W.waterLevel + 0.6) continue;
      if (world.slopeAt(x, z) > 3) continue;
      const biome = world.biomeAt(x, z, h);
      // build a weighted list of species that live here
      const threat = this.threat();
      const opts = [];
      for (const id in C.ANIMALS) {
        const def = C.ANIMALS[id];
        if (def.biomes.indexOf(biome) < 0) continue;
        if (def.minThreat && threat < def.minThreat) continue;   // not yet
        let w = def.weight * (night ? def.night : 1);
        // predators stay scarce around a small settlement
        if (def.hostile) w *= U.clamp(0.18 + threat * 0.34, 0.18, 2.2);
        if (w <= 0) continue;
        opts.push([id, w]);
      }
      if (!opts.length) continue;
      this.spawn(U.weighted(opts), x, h, z);
      return true;
    }
    return false;
  };

  Wildlife.prototype.spawn = function (type, x, y, z) {
    const def = C.ANIMALS[type];
    if (!def) return null;
    const obj = M.animal(def.model, def.tint);
    obj.scale.setScalar(def.size);
    obj.position.set(x, y, z);
    this.group.add(obj);
    const a = {
      type: type, def: def, obj: obj,
      x: x, y: y, z: z, yaw: Math.random() * 6.283,
      hp: def.hp, maxHp: def.hp,
      state: 'wander', timer: Math.random() * 3, phase: Math.random() * 6.283,
      vx: 0, vz: 0, speedMul: 0.35, target: null, angry: false,
      attackCd: 0, raid: false, dead: false, alertT: 0
    };
    this.animals.push(a);
    return a;
  };

  Wildlife.prototype._despawn = function (i) {
    const a = this.animals[i];
    this.group.remove(a.obj);
    // every animal owns its geometry (built per spawn), so free it
    a.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    U.swapRemove(this.animals, i);
  };

  /* ===================== AI ===================== */
  Wildlife.prototype._stepAnimal = function (a, dt, player) {
    const world = this.game.world, def = a.def;
    /* Never let one end up inside a building. Without this an animal that
       clips a doorway while chasing gets wedged in the walls forever. */
    if (this.game.building) {
      const esc = this.game.building.escapeFrom(a.x, a.z, 0.25);
      if (esc) { a.x = esc.x; a.z = esc.z; a.y = world.heightAt(a.x, a.z); a.stuck = 0; }
    }
    const pdx = player.pos.x - a.x, pdz = player.pos.z - a.z;
    const pd = Math.hypot(pdx, pdz);
    const night = this.game.sky.isNight();
    a.timer -= dt;
    a.attackCd = Math.max(0, a.attackCd - dt);
    a.alertT = Math.max(0, a.alertT - dt);

    /* Daylight is safe: predators ignore you completely unless you struck
       first. After dark they hunt, and the bolder they get the bigger the
       settlement is. */
    const hostile = (def.hostile && night) || a.angry;
    const threat = this._threatCache;
    const aggro = (def.hostile && night ? 20 + threat * 2.5 : 0) + (a.angry ? 20 : 0);

    /* ---- pick a state ---- */
    if (hostile && pd < aggro && !this._playerSafe(player)) {
      a.state = 'chase'; a.target = null;
    } else if (def.flee && pd < (a.alertT > 0 ? 22 : 9)) {
      a.state = 'flee';
    } else if (a.raid && a.raidTarget) {
      a.state = 'raid';
    } else if (a.state === 'chase' || a.state === 'flee' || a.state === 'shy') {
      if (a.timer <= 0) { a.state = 'wander'; a.timer = 1 + Math.random() * 2; }
    }

    /* A burning fire drives predators back out of its circle — they will not
       press an attack, raid a wall, or even hold their ground inside it. */
    const fire = (def.hostile || def.thief || a.angry) && this.game.building
      ? this.game.building.wardedAt(a.x, a.z) : null;
    if (fire) {
      a.state = 'shy';
      a.shyX = fire.x; a.shyZ = fire.z;
      if (a.raid) { a.raid = false; a.raidTarget = null; }
    }

    /* Night raid — only after dark, and only if the town is worth the trip */
    if (!a.raid && !fire && (def.hostile || def.thief) && night && threat >= C.THREAT.raidMin &&
      Math.random() < dt * 0.009 * threat) {
      const t = this.game.building ? this.game.building.raidTarget(a.x, a.z) : null;
      if (t && U.dist(a.x, a.z, t.x, t.z) < 130) { a.raid = true; a.raidTarget = t; a.state = 'raid'; }
    }

    /* ---- steering ---- */
    let wantX = 0, wantZ = 0, speed = def.speed;
    switch (a.state) {
      case 'chase':
        wantX = pdx; wantZ = pdz; speed *= 1.0;
        if (pd < 1.9 + def.size && a.attackCd <= 0) {
          a.attackCd = 1.25;
          if (player.damage(def.dmg, a.x, a.z)) {
            this.game.audio.beast(def.size > 1.2);
            this.game.ui.toast('💢 ' + def.name + ' حمله کرد!', 'bad');
          }
          a.swing = 0.4;
        }
        break;
      case 'flee':
        wantX = -pdx; wantZ = -pdz; speed *= 1.12;
        break;
      case 'shy': {                            // backing out of firelight
        wantX = a.x - a.shyX; wantZ = a.z - a.shyZ;
        if (Math.abs(wantX) + Math.abs(wantZ) < 0.01) { wantX = Math.sin(a.yaw); wantZ = Math.cos(a.yaw); }
        speed *= 1.05;
        break;
      }
      case 'raid': {
        const t = a.raidTarget;
        if (!t || t.dead) { a.raid = false; a.state = 'wander'; break; }
        wantX = t.x - a.x; wantZ = t.z - a.z;
        const td = Math.hypot(wantX, wantZ);
        if (td < 2.4) {
          if (a.attackCd <= 0) {
            a.attackCd = 1.2;
            a.swing = 0.4;
            const done = this.game.building.attackStructure(t, def.dmg * 1.4);
            if (done) { a.raid = false; a.raidTarget = null; }
          }
          speed = 0;
        }
        break;
      }
      default: {
        if (a.timer <= 0) {
          a.timer = 1.5 + Math.random() * 3.5;
          a.wanderYaw = Math.random() * 6.283;
          a.speedMul = Math.random() < 0.35 ? 0 : 0.34 + Math.random() * 0.2;
        }
        wantX = Math.sin(a.wanderYaw || 0); wantZ = Math.cos(a.wanderYaw || 0);
        speed *= a.speedMul;
      }
    }

    const wl = Math.hypot(wantX, wantZ);
    if (wl > 0.0001 && speed > 0.01) {
      let dx = (wantX / wl) * speed, dz = (wantZ / wl) * speed;
      // steer around water and cliffs
      const nx = a.x + dx * dt, nz = a.z + dz * dt;
      const nh = world.heightAt(nx, nz);
      const blocked = nh < W.waterLevel + 0.15 || Math.abs(nh - a.y) > 2.4 ||
        (this.game.building && this.game.building.blocks(nx, nz, false));
      if (blocked) {
        // try sliding left / right, otherwise chew on whatever is in the way
        const alt = [0.9, -0.9, 1.9, -1.9];
        let moved = false;
        for (const t of alt) {
          const c = Math.cos(t), s = Math.sin(t);
          const ax2 = dx * c - dz * s, az2 = dx * s + dz * c;
          const tx = a.x + ax2 * dt, tz = a.z + az2 * dt;
          const th = world.heightAt(tx, tz);
          if (th >= W.waterLevel + 0.15 && Math.abs(th - a.y) < 2.4 &&
            !(this.game.building && this.game.building.blocks(tx, tz, false))) {
            a.x = tx; a.z = tz; a.y = th; moved = true;
            dx = ax2; dz = az2;
            break;
          }
        }
        if (!moved && (a.state === 'chase' || a.state === 'raid') && a.attackCd <= 0) {
          const s = this.game.building ? this.game.building.structureAt(nx, nz) : null;
          if (s) {
            a.attackCd = 1.1; a.swing = 0.4;
            this.game.building.attackStructure(s, def.dmg * 1.2);
          }
        }
        if (!moved) {
          a.timer = 0;
          a.wanderYaw = Math.random() * 6.283;
          a.moving = false;
          // penned in on every side: abandon the raid instead of jittering forever
          a.stuck = (a.stuck || 0) + dt;
          if (a.stuck > 6) {
            a.stuck = 0;
            a.raid = false; a.raidTarget = null;
            a.state = 'wander';
            a.angry = false;
          }
        }
      } else {
        a.x = nx; a.z = nz; a.y = nh;
        a.stuck = 0;
      }
      const want = Math.atan2(dx, dz);
      a.yaw += U.angleDelta(a.yaw, want) * Math.min(1, dt * 8);
      a.phase += dt * (3 + speed * 1.4);
      a.moving = true;
    } else {
      a.y = world.heightAt(a.x, a.z);
      a.moving = false;
    }

    /* ---- transform + animation ---- */
    const o = a.obj;
    o.position.set(a.x, a.y, a.z);
    o.rotation.y = a.yaw;
    const legs = o.userData.legs;
    if (legs) {
      const amp = a.moving ? Math.min(0.9, speed * 0.16) : 0;
      for (let i = 0; i < legs.length; i++) {
        legs[i].rotation.x = Math.sin(a.phase * 2 + legs[i].userData.phase) * amp;
      }
    }
    if (o.userData.head) {
      const bob = a.moving ? Math.sin(a.phase * 2) * 0.06 : Math.sin(a.phase * 0.6) * 0.05;
      o.userData.head.rotation.x = bob + (a.swing > 0 ? -0.6 : (a.state === 'wander' && !a.moving ? 0.5 : 0));
    }
    if (o.userData.tail) o.userData.tail.rotation.y = Math.sin(a.phase * 3) * 0.4;
    if (a.swing > 0) a.swing -= dt;

    // hurt tint reset
    if (a.flash > 0) {
      a.flash -= dt;
      o.scale.setScalar(def.size * (1 + Math.max(0, a.flash) * 0.35));
    }
  };

  /* Firelight is the one thing every predator respects. Stand inside the
     circle of a burning fire and nothing will come for you — which is what
     makes a 6-wood campfire the right first build on night one. */
  Wildlife.prototype._playerSafe = function (player) {
    const b = this.game.building;
    return !!(b && b.wardedAt(player.pos.x, player.pos.z));
  };

  /* ===================== DAMAGE / DEATH ===================== */
  Wildlife.prototype.hit = function (a, dmg, srcX, srcZ) {
    if (!a || a.dead) return;
    a.hp -= dmg;
    a.flash = 0.18;
    a.alertT = 8;
    if (a.def.retaliate || a.def.hostile) a.angry = true;
    if (srcX !== undefined) {
      const dx = a.x - srcX, dz = a.z - srcZ, l = Math.hypot(dx, dz) || 1;
      a.x += (dx / l) * 0.55; a.z += (dz / l) * 0.55;
    }
    this.game.fx.hitBurst(a.x, a.y + a.def.size * 0.6, a.z, 0xd83a3a, 8);
    this.game.audio.hit();
    if (a.hp <= 0) {
      this._kill(a);
    } else {
      this.game.audio.beast(a.def.size > 1.2);
      this.game.ui.damageNumber(a.obj, Math.round(dmg));
    }
  };

  Wildlife.prototype._kill = function (a) {
    a.dead = true;
    const inv = this.game.inv, prog = this.game.progress;
    const rnd = Math.random;
    const got = [];
    function roll(table) {
      for (const k in table) {
        const r = table[k];
        const n = Math.floor(r[0] + rnd() * (r[1] - r[0] + 1));
        if (n > 0 && inv.add(k, n)) got.push({ id: k, n: n });
      }
    }
    roll(a.def.drop);
    if (a.def.extra) roll(a.def.extra);
    prog.addSkill('combat', a.def.xp);
    prog.addXp(Math.round(a.def.xp * 0.6));
    prog.stat('hunt', 1);
    prog.stat('kill_' + a.type, 1);
    this.game.fx.hitBurst(a.x, a.y + 0.5, a.z, 0xffc94d, 16);
    this.game.audio.beast(a.def.size > 1.2);
    this.game.audio.coin();
    let msg = '🎯 ' + a.def.name + ' شکار شد';
    if (got.length) msg += ' — ' + got.map((g) => C.ITEMS[g.id].icon + U.fa(g.n)).join(' ');
    this.game.ui.toast(msg, 'good');
  };

  /* ===================== QUERIES ===================== */
  Wildlife.prototype.nearest = function (x, z, radius, hostileOnly) {
    let best = null, bd = radius * radius;
    for (const a of this.animals) {
      if (a.dead) continue;
      if (hostileOnly && !(a.def.hostile || a.angry || a.raid)) continue;
      const d = U.dist2(x, z, a.x, a.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  };

  /** ray/sphere test used for melee & arrow hits */
  Wildlife.prototype.rayPick = function (origin, dir, maxDist) {
    let best = null, bt = maxDist;
    for (const a of this.animals) {
      if (a.dead) continue;
      const r = 0.75 * a.def.size + 0.35;
      const ox = a.x - origin.x, oy = (a.y + a.def.size * 0.6) - origin.y, oz = a.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > bt) continue;
      const cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
      if (cx * cx + cy * cy + cz * cz <= r * r) { bt = t; best = a; }
    }
    return best ? { animal: best, dist: bt } : null;
  };

  /* ===================== ARROWS ===================== */
  Wildlife.prototype.shoot = function (origin, dir, dmg, range) {
    const obj = M.arrow();
    obj.position.copy(origin);
    obj.lookAt(origin.x + dir.x, origin.y + dir.y, origin.z + dir.z);
    this.group.add(obj);
    this.arrows.push({
      obj: obj, dmg: dmg,
      vx: dir.x * 52, vy: dir.y * 52, vz: dir.z * 52,
      life: Math.min(4, range / 52 + 0.4)
    });
  };

  Wildlife.prototype._stepArrows = function (dt) {
    const world = this.game.world;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const ar = this.arrows[i];
      ar.life -= dt;
      ar.vy -= 9 * dt;
      const p = ar.obj.position;
      const nx = p.x + ar.vx * dt, ny = p.y + ar.vy * dt, nz = p.z + ar.vz * dt;

      // hit an animal?
      let hitA = null;
      for (const a of this.animals) {
        if (a.dead) continue;
        const r = 0.8 * a.def.size + 0.4;
        if (U.dist2(nx, nz, a.x, a.z) < r * r && Math.abs(ny - (a.y + a.def.size * 0.6)) < r * 1.6) { hitA = a; break; }
      }
      if (hitA) {
        this.hit(hitA, ar.dmg, p.x, p.z);
        this._killArrow(i); continue;
      }
      if (ny <= world.heightAt(nx, nz) || ar.life <= 0) { this._killArrow(i); continue; }
      p.set(nx, ny, nz);
      ar.obj.lookAt(nx + ar.vx, ny + ar.vy, nz + ar.vz);
    }
  };

  Wildlife.prototype._killArrow = function (i) {
    const ar = this.arrows[i];
    this.group.remove(ar.obj);
    ar.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    U.swapRemove(this.arrows, i);
  };

  Wildlife.prototype.clear = function () {
    while (this.animals.length) this._despawn(this.animals.length - 1);
    while (this.arrows.length) this._killArrow(this.arrows.length - 1);
  };

  G.Wildlife = Wildlife;
})(window.GAME = window.GAME || {});
