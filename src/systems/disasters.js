/* =========================================================
   disasters.js — زلزله

   Rare, loud, and expensive. A few seconds of low rumble with
   nothing visible, then the ground moves.

   Damage is scaled by what a building is made of: timber frames
   flex and mostly survive, stone and brick crack — which is how
   it actually goes, and it makes the cheap early buildings feel
   like a reasonable choice rather than a stopgap.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config;
  const Q = C.QUAKE;

  function Disasters(game) {
    this.game = game;
    this.state = 'calm';        // calm | warn | shaking
    this.t = 0;
    this.lastDay = -999;
    this.mag = 1;
    this._off = { x: 0, y: 0, z: 0 };
    this._bind();
  }

  Disasters.prototype._bind = function () {
    const self = this, g = this.game;
    if (!g.bus) return;
    g.bus.on('newday', function (day) {
      if (self.state !== 'calm') return;
      if (day < Q.minDay) return;
      if (day - self.lastDay < Q.quietDays) return;
      if (Math.random() > Q.chancePerDay) return;
      self.start();
    });
  };

  /** magnitude 0.6 .. 1.0 — small ones are a scare, big ones are a bill */
  Disasters.prototype.start = function (mag) {
    const g = this.game;
    this.state = 'warn';
    this.t = 0;
    this.mag = mag === undefined ? 0.6 + Math.random() * 0.4 : mag;
    this.lastDay = g.time.day;
    g.audio.rumble(Q.warn + Q.duration);
    g.ui.toast('〰️ زمین دارد می‌لرزد…', 'bad');
    return true;
  };

  Disasters.prototype.shaking = function () { return this.state === 'shaking'; };

  /** camera displacement for this frame, or null when the ground is still */
  Disasters.prototype.shakeOffset = function () {
    if (this.state === 'calm') return null;
    return this._off;
  };

  Disasters.prototype.update = function (dt) {
    if (this.state === 'calm') return;
    this.t += dt;

    if (this.state === 'warn') {
      /* a barely-there tremble while the rumble builds */
      const k = Math.min(1, this.t / Q.warn) * 0.12 * this.mag;
      this._jitter(k, 26);
      if (this.t >= Q.warn) {
        this.state = 'shaking';
        this.t = 0;
        this._strike();
      }
      return;
    }

    /* the shake itself: hard at first, tailing off */
    const k = Math.max(0, 1 - this.t / Q.duration);
    this._jitter(Q.shake * this.mag * k * k, 18);
    if (this.t >= Q.duration) {
      this.state = 'calm';
      this._off.x = this._off.y = this._off.z = 0;
    }
  };

  Disasters.prototype._jitter = function (amp, freq) {
    const t = this.game.time ? this.game.time.elapsed : 0;
    this._off.x = Math.sin(t * freq) * amp;
    this._off.y = Math.sin(t * freq * 1.63 + 1.1) * amp * 0.7;
    this._off.z = Math.cos(t * freq * 0.87 + 2.3) * amp;
  };

  /* ---------------- what the shock actually does ---------------- */
  Disasters.prototype._strike = function () {
    const g = this.game;
    const b = g.building;
    let broken = 0, lost = 0, hurt = 0, doused = 0;

    if (b) {
      for (let i = b.list.length - 1; i >= 0; i--) {
        const s = b.list[i];
        const share = Q.damage[0] + Math.random() * (Q.damage[1] - Q.damage[0]);
        const dmg = Math.round(s.maxHp * share * this.mag * materialFactor(s));
        if (dmg <= 0) continue;
        s.hp -= dmg;
        if (s.hp <= 0) {
          lost++;
          b.demolish(s, false);
        } else {
          broken++;
          if (b.isFire(s) && s.lit && Math.random() < Q.putOutFires) {
            s.fuel = 0; s.lit = false;
            b._paintFire(s);
            doused++;
          }
        }
      }
      b.invalidate();
    }

    /* everyone loses their footing */
    const p = g.player;
    if (p) {
      const d = Math.round(6 + 14 * this.mag);
      p.damage(d, p.pos.x, p.pos.z + 1);
      hurt++;
    }
    if (g.villagers) {
      for (const v of g.villagers.list) { v.working = false; v.think = 0; v.stuckT = 0; }
    }
    if (g.horses) for (const h of g.horses.list) h.spook = 2.5;
    if (g.wildlife) {
      for (const a of g.wildlife.animals) {
        if (a.dead || a.def.boss) continue;
        a.state = 'flee'; a.alertT = 12; a.timer = 8;
        a.raid = false; a.raidTarget = null;
      }
    }

    /* the one good thing: fresh rock shaken loose near town */
    const veins = this._exposeOre();

    g.audio.quake();
    g.ui.hurt();
    g.ui.levelUp('〰️ زلزله');
    const bits = [];
    if (lost) bits.push(U.fa(lost) + ' بنا فرو ریخت');
    if (broken) bits.push(U.fa(broken) + ' بنا آسیب دید');
    if (doused) bits.push(U.fa(doused) + ' آتش خاموش شد');
    if (veins) bits.push(U.fa(veins) + ' رگهٔ تازه بیرون زد');
    g.ui.toast('〰️ زلزله! ' + (bits.length ? bits.join('، ') : 'به‌خیر گذشت'), 'bad');
    g.chronicle.write('〰️', 'زمین لرزید. ' +
      (bits.length ? bits.join('، ') + '.' : 'خوشبختانه چیزی نشد.'), lost ? 'bad' : 'plain');
    void hurt;
  };

  /* stone and brick crack; timber frames ride it out */
  function materialFactor(s) {
    const cost = s.def.cost ? s.def.cost(s.level) : {};
    const wood = (cost.wood || 0) + (cost.plank || 0) * 2 + (cost.fiber || 0) * 0.5;
    const rock = (cost.stone || 0) + (cost.brick || 0) * 2 + (cost.tile || 0);
    if (rock > wood * 1.2) return Q.material.brick > Q.material.stone && cost.brick ? Q.material.brick : Q.material.stone;
    if (wood > rock * 1.2) return Q.material.wood;
    return Q.material.other;
  }

  Disasters.prototype._exposeOre = function () {
    const g = this.game, world = g.world;
    if (!world) return 0;
    const cx = g.building && g.building.list.length ? g.building.centerX : g.player.pos.x;
    const cz = g.building && g.building.list.length ? g.building.centerZ : g.player.pos.z;
    let made = 0;
    for (let i = 0; i < Q.exposeOre * 8 && made < Q.exposeOre; i++) {
      const a = Math.random() * 6.283;
      const d = 22 + Math.random() * 55;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const y = world.heightAt(x, z);
      if (y < C.WORLD.waterLevel + 0.8) continue;
      if (world.slopeAt(x, z) > 2.4) continue;
      if (g.building && g.building.occupied(x, z, 1.6)) continue;
      if (world.nodesNear(x, z, 3).length) continue;
      const type = Math.random() < 0.5 ? 'stone' : Math.random() < 0.65 ? 'coal' : 'iron';
      if (world.spawnNode && world.spawnNode('ore', type, x, z)) made++;
    }
    return made;
  };

  /* ---------------- persistence ---------------- */
  Disasters.prototype.serialize = function () { return { lastDay: this.lastDay }; };
  Disasters.prototype.deserialize = function (d) {
    if (d && d.lastDay !== undefined) this.lastDay = d.lastDay;
  };

  G.Disasters = Disasters;
})(window.GAME = window.GAME || {});
