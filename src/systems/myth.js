/* =========================================================
   myth.js — the three legends of کِشتوَر.

   سیمرغ      a rite you perform on purpose: climb the peak that has
              been on your map since the first minute, light a fire on
              it on the night of the full moon, and burn an offering.
              She comes, and she leaves you a feather.

   دیو سپید   an enemy your own success wakes. Once your settlement is
              a city he stirs in a cave in the mountains, and a day
              later he walks down to knock it over.

   رؤیا و گنج at first light you sometimes wake from a dream of your own
              town with the colours wrong — and one place in it burned
              into your memory. Go there and dig.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;
  const MY = C.MYTH, W = C.WORLD;

  function Myth(game) {
    this.game = game;

    /* ---- Simorgh ---- */
    this.peak = null;               // {x, y, z} — the rite happens here
    this.bird = null;               // the flying model while she is here
    this.riteDay = -999;            // day of the last successful rite
    this.blessUntil = -999;         // in-game day the blessing lapses
    this.feathersGiven = 0;

    /* ---- the Div ---- */
    this.divState = 'asleep';       // asleep | omen | active | slain
    this.divWakeDay = 0;
    this.divSlainDay = -999;
    this.divCave = null;
    this.div = null;                // the wildlife entry while he walks
    this.divPhase = 0;              // 0 none, 1 summoned, 2 enraged
    this.divThrow = 0;
    this.heartPower = 0;            // permanent damage bonus once carried home

    /* ---- dreams ---- */
    this.treasure = null;           // {x, z, kind}
    this.dreamDay = -999;

    this._bind();
  }

  /* =========================================================
     THE PEAK
     ========================================================= */
  /* Deterministic from the seed: the same world always has the same
     mountain, so the marker on your map is a promise, not a surprise. */
  Myth.prototype.findPeak = function () {
    const world = this.game.world;
    if (!world) return null;
    const S = MY.simorgh;
    const R = S.peakSearch, N = S.peakSamples;
    let best = null;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = -R + (2 * R) * (i / N);
        const z = -R + (2 * R) * (j / N);
        const y = world.heightAt(x, z);
        if (y < W.waterLevel + 4) continue;
        /* the rite needs ground you can stand a fire on, so a knife-edge
           ridge scores worse than a slightly lower shoulder */
        const score = y - world.slopeAt(x, z) * 2.2;
        if (!best || score > best.score) best = { x: x, y: y, z: z, score: score };
      }
    }
    if (!best) best = { x: 0, y: world.heightAt(0, 0), z: 0, score: 0 };
    // walk downhill-free: refine on a shrinking grid around the winner
    let step = (2 * R) / N;
    for (let pass = 0; pass < 5; pass++) {
      step *= 0.5;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          const x = best.x + dx * step, z = best.z + dz * step;
          const y = world.heightAt(x, z);
          const score = y - world.slopeAt(x, z) * 2.2;
          if (score > best.score) best = { x: x, y: y, z: z, score: score };
        }
      }
    }
    best.y = world.heightAt(best.x, best.z);
    this.peak = best;
    return best;
  };

  Myth.prototype.atPeak = function (x, z) {
    if (!this.peak) return false;
    return U.dist2(x, z, this.peak.x, this.peak.z) < MY.simorgh.ritualRange * MY.simorgh.ritualRange;
  };

  /** the lit fire standing on the peak, if there is one */
  Myth.prototype.peakFire = function () {
    const b = this.game.building;
    if (!b || !this.peak) return null;
    const r = MY.simorgh.ritualRange;
    for (const s of b.list) {
      if (!b.isFire(s) || !s.lit) continue;
      if (s.level < MY.simorgh.fireLevel) continue;
      if (U.dist2(s.x, s.z, this.peak.x, this.peak.z) < r * r) return s;
    }
    return null;
  };

  /* =========================================================
     THE RITE
     ========================================================= */
  /** everything the player still has to do, in the order they'll notice it */
  Myth.prototype.riteState = function () {
    const g = this.game;
    const S = MY.simorgh;
    const st = {
      atPeak: false, night: false, fullMoon: false, fire: null,
      offering: S.offering, hasOffering: false, cooldown: 0, ok: false, why: ''
    };
    if (!this.peak) return st;
    const p = g.player.pos;
    st.atPeak = this.atPeak(p.x, p.z);
    st.night = g.sky.isNight();
    st.fullMoon = g.sky.isFullMoon();
    st.fire = this.peakFire();
    st.hasOffering = g.inv.canAfford(S.offering);
    st.cooldown = Math.max(0, (this.riteDay + S.cooldownDays) - g.time.day);

    if (this.bird) { st.why = 'سیمرغ همین حالا اینجاست'; return st; }
    if (!st.atPeak) { st.why = 'باید روی قلهٔ سیمرغ باشی'; return st; }
    if (st.cooldown > 0) { st.why = 'سیمرغ تا ' + U.fa(Math.ceil(st.cooldown)) + ' روز دیگر پاسخ نمی‌دهد'; return st; }
    if (!st.night) { st.why = 'این کار فقط شب انجام می‌شود'; return st; }
    if (!st.fullMoon) {
      const d = g.sky.daysToFullMoon();
      st.why = 'باید شب ماه کامل باشد — ' + U.fa(d) + ' شب دیگر';
      return st;
    }
    if (!st.fire) { st.why = 'اینجا آتشی روشن کن (آتش اردو یا دیده‌بانی)'; return st; }
    if (!st.hasOffering) { st.why = 'پیشکش کم داری'; return st; }
    st.ok = true;
    return st;
  };

  Myth.prototype.performRite = function () {
    const g = this.game;
    const st = this.riteState();
    if (!st.ok) {
      g.ui.toast('🔥 ' + st.why, 'bad');
      g.audio.deny();
      return false;
    }
    g.inv.pay(MY.simorgh.offering);
    this.riteDay = g.time.day;
    this._spawnBird();
    g.audio.simorgh();
    g.ui.toast('🔥 اسپند در آتش ریختی… چیزی در آسمان تکان خورد', 'gold');
    g.ui.levelUp('🪶 سیمرغ می‌آید');
    g.chronicle.write('🪶', 'شب ماه کامل، بر قلهٔ سیمرغ آتش افروخته شد و اسپند در آن ریخت.', 'myth');
    return true;
  };

  /* ---------------- her flight ---------------- */
  Myth.prototype._spawnBird = function () {
    const S = MY.simorgh;
    const obj = M.simorgh();
    obj.scale.setScalar(S.scale);
    this.game.scene.add(obj);
    this.bird = {
      obj: obj, state: 'incoming', t: 0, ang: Math.random() * 6.283,
      r: S.circleRadius * 4, h: S.circleHeight * 3.2, flap: 0, gave: false
    };
  };

  Myth.prototype._despawnBird = function () {
    if (!this.bird) return;
    const o = this.bird.obj;
    this.game.scene.remove(o);
    o.traverse(function (m) { if (m.geometry) m.geometry.dispose(); });
    this.bird = null;
  };

  Myth.prototype._stepBird = function (dt) {
    const b = this.bird, S = MY.simorgh, pk = this.peak;
    if (!b || !pk) return;
    b.t += dt;
    b.ang += dt * (b.state === 'landed' ? 0 : 0.55);

    if (b.state === 'incoming') {
      const k = Math.min(1, b.t / S.arriveTime);
      b.r = S.circleRadius * (4 - 3 * k);
      b.h = S.circleHeight * (3.2 - 2.2 * k);
      if (k >= 1) { b.state = 'landing'; b.t = 0; }
    } else if (b.state === 'landing') {
      const k = Math.min(1, b.t / 3.5);
      b.r = S.circleRadius * (1 - k) + S.landRadius * k;
      b.h = S.circleHeight * (1 - k) + S.landHeight * k;
      if (k >= 1) {
        b.state = 'landed'; b.t = 0;
        if (!b.gave) { b.gave = true; this._giveFeather(); }
      }
    } else if (b.state === 'landed') {
      b.r = S.landRadius; b.h = S.landHeight;
      if (b.t > S.landTime) { b.state = 'leaving'; b.t = 0; }
    } else {
      const k = b.t / 9;
      b.r = S.landRadius + k * 180;
      b.h = S.landHeight + k * 90;
      if (k >= 1) { this._despawnBird(); return; }
    }

    const x = pk.x + Math.cos(b.ang) * b.r;
    const z = pk.z + Math.sin(b.ang) * b.r;
    /* Height is measured from the ground she is actually over, not from the
       summit — a peak drops away fast, so a fixed offset from the summit
       leaves her hanging several metres in the air off to one side. High
       above she keeps the summit's reference; on the way down she settles
       onto whatever is beneath her. */
    const settle = U.clamp01((S.circleHeight - b.h) / Math.max(1, S.circleHeight - S.landHeight));
    const base = U.lerp(pk.y, this.game.world.heightAt(x, z), settle);
    const y = base + b.h;
    b.obj.position.set(x, y, z);
    /* The model's nose points along +Z. In the air she looks where she is
       going — the tangent of the circle she is turning; on the ground she
       turns and looks straight at whoever called her. */
    if (b.state === 'landed') {
      b.obj.rotation.y = Math.atan2(-Math.cos(b.ang), -Math.sin(b.ang));
      b.obj.rotation.z = 0;
    } else {
      b.obj.rotation.y = Math.atan2(-Math.sin(b.ang), Math.cos(b.ang));
      b.obj.rotation.z = -0.28;
    }

    const beat = b.state === 'landed' ? 1.1 : 3.4;
    b.flap += dt * beat;
    const amp = b.state === 'landed' ? 0.12 : 0.55;
    const wings = b.obj.userData.wings;
    if (wings) {
      wings[0].rotation.z = Math.sin(b.flap) * amp;
      wings[1].rotation.z = -Math.sin(b.flap) * amp;
    }
  };

  Myth.prototype._giveFeather = function () {
    const g = this.game;
    g.inv.add('simorgh_feather', 1);       // a relic: capacity does not apply
    this.feathersGiven++;
    g.audio.levelUp();
    g.progress.addXp(600);
    g.progress.stat('simorgh', 1);
    g.ui.levelUp('🪶 پَر سیمرغ');
    g.ui.toast('🪶 سیمرغ پَری از سینه‌اش کند و پیش پایت گذاشت — در شهرت بسوزانش', 'gold');
    g.chronicle.write('🪶', 'سیمرغ بر قله فرود آمد و پَری بخشید.', 'myth');
  };

  /* ---------------- the blessing ---------------- */
  /* "In your own town" has to mean near something you built, not near the
     average of everything you built — one watchfire out on a mountain drags
     that average halfway across the map. Measure from the nearest roof. */
  const BURN_RANGE = 34;
  Myth.prototype.canBurnFeather = function () {
    const g = this.game;
    if (!g.inv.count('simorgh_feather')) return { ok: false, why: 'پَر سیمرغ نداری' };
    if (!g.building || !g.building.list.length) return { ok: false, why: 'باید در شهر خودت باشی' };
    const p = g.player.pos;
    let near = Infinity;
    for (const b of g.building.list) {
      const d = U.dist2(p.x, p.z, b.x, b.z);
      if (d < near) near = d;
    }
    if (near > BURN_RANGE * BURN_RANGE) return { ok: false, why: 'باید کنار ساختمان‌های شهرت باشی' };
    return { ok: true };
  };

  /** the payoff: burn it at home and everything is well, all at once */
  Myth.prototype.burnFeather = function () {
    const g = this.game;
    const chk = this.canBurnFeather();
    if (!chk.ok) { g.ui.toast('🪶 ' + chk.why, 'bad'); g.audio.deny(); return false; }
    g.inv.remove('simorgh_feather', 1);
    this.blessUntil = g.time.day + MY.simorgh.blessDays;

    /* you */
    const p = g.player;
    p.hp = p.maxHp;
    p.energy = 100;
    p.stamina = p.maxStamina;

    /* everyone: full contentment, and the mood that comes from a full belly */
    g.progress.foodMood = 25;
    g.progress.recalc();

    /* every villager drops what was frustrating them and starts fresh */
    let people = 0;
    if (g.villagers) {
      for (const v of g.villagers.list) {
        v.skip = Object.create(null);
        v.stuckT = 0;
        v.think = 0;
        v.working = false;
        v.cheer = 6;
        people++;
      }
    }

    /* every field ripens where it stands */
    let crops = 0;
    if (g.farming) {
      g.farming.plots.forEach(function (plot) {
        plot.moisture = 1;
        if (plot.crop && plot.stage < 3) {
          crops++;
          plot.growth = C.CROPS[plot.crop].growH;
          plot.stage = 3;
          g.farming._refreshPlant(plot);
        }
        g.farming._refreshSoil(plot);
      });
    }

    /* every roof mended, every fire fed */
    let mended = 0;
    if (g.building) {
      for (const b of g.building.list) {
        if (b.hp < b.maxHp) { b.hp = b.maxHp; mended++; }
        if (g.building.isFire(b)) {
          b.fuel = C.FIRE.fuelPerLog * C.FIRE.maxLogs;
          b.lit = true;
          g.building._paintFire(b);
        }
      }
      g.building.invalidate();
    }

    /* and the night is cleared of whatever was circling. Measured from
       where you are standing when you burn it — the town's average centre
       drifts miles off as soon as you own one outpost. */
    let scattered = 0;
    if (g.wildlife) {
      const cx = p.pos.x, cz = p.pos.z;
      for (const a of g.wildlife.animals) {
        if (a.dead || a.def.boss) continue;
        if (!a.def.hostile && !a.angry) continue;
        if (U.dist2(a.x, a.z, cx, cz) > 150 * 150) continue;
        a.angry = false; a.raid = false; a.raidTarget = null;
        a.state = 'flee'; a.alertT = 20; a.timer = 14;
        scattered++;
      }
    }

    /* horses come home rested too */
    if (g.horses) for (const h of g.horses.list) h.spook = 0;

    g.progress.addXp(900);
    g.audio.simorgh();
    g.audio.levelUp();
    g.ui.levelUp('🪶 برکت سیمرغ');
    g.ui.toast('🪶 پَر سوخت — رضایت همه ۱۰۰٪، ' + U.fa(crops) + ' محصول رسید، ' +
      U.fa(mended) + ' بنا ترمیم شد، ' + U.fa(scattered) + ' درنده گریخت', 'gold');
    g.chronicle.write('🪶', 'پَر سیمرغ در میدان کِشتوَر سوزانده شد. ' +
      U.fa(people) + ' نفر سرحال آمدند، کشتزارها یک‌شبه رسیدند و تا ' +
      U.fa(MY.simorgh.blessDays) + ' روز کسی به شهر نزدیک نشد.', 'myth');
    return true;
  };

  Myth.prototype.blessed = function () {
    return this.game.time ? this.game.time.day < this.blessUntil : false;
  };
  Myth.prototype.blessDaysLeft = function () {
    return Math.max(0, Math.ceil(this.blessUntil - this.game.time.day));
  };

  /* =========================================================
     THE WHITE DIV
     ========================================================= */
  Myth.prototype._pickCave = function () {
    const g = this.game, world = g.world;
    const cx = g.building && g.building.list.length ? g.building.centerX : 0;
    const cz = g.building && g.building.list.length ? g.building.centerZ : 0;
    let best = null;
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * 6.283 * 3.7;
      const d = 110 + (i % 9) * 12;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const y = world.heightAt(x, z);
      if (y < W.waterLevel + 2) continue;
      const biome = world.biomeAt(x, z, y);
      const score = y + (biome === 'rocky' ? 30 : biome === 'snow' ? 14 : 0);
      if (!best || score > best.score) best = { x: x, y: y, z: z, score: score };
    }
    this.divCave = best || { x: cx + 130, y: world.heightAt(cx + 130, cz), z: cz };
    return this.divCave;
  };

  Myth.prototype._omen = function () {
    const g = this.game;
    this.divState = 'omen';
    this.divWakeDay = g.time.day + MY.div.warnDays;
    this._pickCave();
    g.audio.omen();
    g.ui.levelUp('👹 چیزی بیدار شد');
    g.ui.toast('👹 زمین لرزید و از کوه صدایی آمد. دیو سپید بیدار شده — فردا شب می‌آید.', 'bad');
    g.chronicle.write('👹', 'کِشتوَر شهر شد، و همان شب از دل کوه غرشی برخاست. پیرمردها گفتند: دیو سپید بیدار شده.', 'myth');
  };

  Myth.prototype._raiseDiv = function () {
    const g = this.game;
    const cave = this.divCave || this._pickCave();
    /* he steps out of the mountain a short way from the cave mouth */
    const y = g.world.heightAt(cave.x, cave.z);
    const a = g.wildlife.spawn('whitediv', cave.x, y, cave.z);
    if (!a) return false;
    /* his own copy of the stat block, so his phases can change it without
       touching every other creature in the game */
    a.def = Object.assign({}, C.ANIMALS.whitediv);
    a.hp = MY.div.hp; a.maxHp = MY.div.hp;
    a.angry = true;
    const t = g.building ? g.building.raidTarget(a.x, a.z) : null;
    if (t) { a.raid = true; a.raidTarget = t; a.state = 'raid'; }
    this.div = a;
    this.divState = 'active';
    this.divPhase = 0;
    this.divThrow = MY.div.throwEvery;
    g.audio.omen();
    g.ui.levelUp('👹 دیو سپید');
    g.ui.toast('👹 دیو سپید از کوه پایین آمد! روی نقشه دنبالش بگرد.', 'bad');
    g.chronicle.write('👹', 'دیو سپید از غار بیرون آمد و رو به کِشتوَر گذاشت.', 'myth');
    return true;
  };

  Myth.prototype._stepDiv = function (dt) {
    const g = this.game, a = this.div;
    if (!a) return;
    if (a.dead) { this._divFell(); return; }
    const f = a.hp / a.maxHp;

    /* phase one: he whistles up a pack */
    if (this.divPhase < 1 && f <= MY.div.summonAt) {
      this.divPhase = 1;
      let n = 0;
      for (let i = 0; i < MY.div.summonPack; i++) {
        const ang = (i / MY.div.summonPack) * 6.283;
        const x = a.x + Math.cos(ang) * 7, z = a.z + Math.sin(ang) * 7;
        const y = g.world.heightAt(x, z);
        if (y < W.waterLevel + 0.4) continue;
        const w = g.wildlife.spawn('direwolf', x, y, z);
        if (w) { w.angry = true; w.state = 'chase'; n++; }
      }
      g.audio.omen();
      g.ui.toast('👹 دیو سوت کشید — ' + U.fa(n) + ' گرگ سیاه از تاریکی بیرون آمدند!', 'bad');
    }
    /* phase two: he loses his temper */
    if (this.divPhase < 2 && f <= MY.div.rageAt) {
      this.divPhase = 2;
      a.def.speed = MY.div.speed * MY.div.rageSpeed;
      a.def.dmg = Math.round(MY.div.dmg * MY.div.rageDmg);
      g.audio.omen();
      g.ui.toast('👹 دیو زخمی شد و به خشم آمد!', 'bad');
    }

    /* from phase two he tears rocks up and throws them */
    if (this.divPhase >= 2) {
      this.divThrow -= dt;
      const p = g.player.pos;
      const d = U.dist(a.x, a.z, p.x, p.z);
      if (this.divThrow <= 0 && d < MY.div.throwRange && d > 5) {
        this.divThrow = MY.div.throwEvery;
        a.swing = 0.5;
        g.fx.hitBurst(a.x, a.y + 4, a.z, 0x9a968a, 14);
        g.audio.beast(true);
        /* a thrown boulder is slow enough to dodge — it lands where you
           were standing, not where you are */
        const tx = p.x, tz = p.z;
        this._rock = { x: a.x, z: a.z, tx: tx, tz: tz, t: 0, dur: 0.9 };
      }
    }
    if (this._rock) {
      this._rock.t += dt;
      if (this._rock.t >= this._rock.dur) {
        const r = this._rock;
        this._rock = null;
        const p = g.player.pos;
        g.fx.hitBurst(r.tx, g.world.heightAt(r.tx, r.tz) + 0.5, r.tz, 0x9a968a, 20);
        if (U.dist(p.x, p.z, r.tx, r.tz) < 3.2) g.player.damage(MY.div.throwDmg, r.x, r.z);
      }
    }

    /* if he loses you completely he goes back to hammering the town */
    if (!a.raid && a.state !== 'chase') {
      const t = g.building ? g.building.raidTarget(a.x, a.z) : null;
      if (t) { a.raid = true; a.raidTarget = t; a.state = 'raid'; }
    }
  };

  Myth.prototype._divFell = function () {
    const g = this.game;
    this.div = null;
    this.divState = 'slain';
    this.divSlainDay = g.time.day;
    this.divCave = null;
    g.inv.addCoins(MY.div.coin);
    g.progress.addXp(MY.div.xp);
    g.progress.addSkill('combat', 900);
    g.progress.stat('div', 1);
    g.audio.levelUp();
    g.ui.levelUp('🖤 دیو سپید افتاد');
    g.ui.toast('🖤 دیو سپید کشته شد! +' + U.fa(MY.div.coin) + ' سکه — دلش را بردار، تا ابد ضربه‌ات را سنگین می‌کند', 'gold');
    g.chronicle.write('🖤', 'دیو سپید در برابر کِشتوَر بر خاک افتاد. سنگ‌ها تا صبح گرم بودند.', 'myth');
  };

  /** carrying the heart home makes every blow you land heavier, forever */
  Myth.prototype.useHeart = function () {
    const g = this.game;
    if (!g.inv.count('div_heart')) { g.ui.toast('🖤 دل دیو نداری', 'bad'); return false; }
    g.inv.remove('div_heart', 1);
    this.heartPower += MY.div.heartPower;
    g.audio.levelUp();
    g.ui.levelUp('🖤 نیروی دیو');
    g.ui.toast('🖤 دل دیو را فشردی — از این پس ' +
      U.fa(Math.round(this.heartPower * 100)) + '٪ محکم‌تر می‌زنی', 'gold');
    g.chronicle.write('🖤', 'دل سنگی دیو در دست فشرده شد و نیرویش در بازو نشست.', 'myth');
    return true;
  };

  /* =========================================================
     DREAMS & BURIED TREASURE
     ========================================================= */
  Myth.prototype._dream = function () {
    const g = this.game, D = MY.dream;
    if (this.treasure) return;                    // one hole at a time
    if (g.time.day < D.minDay) return;
    if (g.time.day - this.dreamDay < 2) return;
    if (Math.random() > D.chancePerNight) return;

    const cx = g.building && g.building.list.length ? g.building.centerX : g.player.pos.x;
    const cz = g.building && g.building.list.length ? g.building.centerZ : g.player.pos.z;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.283;
      const d = D.minDist + Math.random() * (D.maxDist - D.minDist);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const y = g.world.heightAt(x, z);
      if (y < W.waterLevel + 0.8) continue;
      if (g.world.slopeAt(x, z) > 2.4) continue;
      const biome = g.world.biomeAt(x, z, y);
      this.treasure = { x: x, z: z, biome: biome, day: g.time.day };
      this.dreamDay = g.time.day;
      const dir = compass(x - cx, z - cz);
      const bn = C.BIOMES[biome] ? C.BIOMES[biome].name : 'دشت';
      g.ui.dreamFlash(
        'خواب دیدی',
        'کِشتوَر را دیدی، ولی آسمانش بنفش بود و هیچ صدایی نبود. یک نفر — یا چیزی — ' +
        'دستت را گرفت و بُردت به ' + bn + '، ' + dir + 'ِ شهر. آنجا ایستاد و به زمین اشاره کرد.'
      );
      g.audio.dream();
      g.ui.toast('🌙 جای رؤیا روی نقشه علامت خورد — برو آنجا و کلید E را بزن', 'gold');
      g.chronicle.write('🌙', 'خوابی دیده شد: زمینی در ' + bn + '، ' + dir + 'ِ شهر.', 'plain');
      return;
    }
  };

  function compass(dx, dz) {
    const a = Math.atan2(dx, dz);
    const names = ['شمال', 'شمال‌شرقی', 'شرق', 'جنوب‌شرقی', 'جنوب', 'جنوب‌غربی', 'غرب', 'شمال‌غربی'];
    const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    return names[i];
  }

  Myth.prototype.nearTreasure = function (x, z) {
    if (!this.treasure) return false;
    const r = MY.dream.digRange;
    return U.dist2(x, z, this.treasure.x, this.treasure.z) < r * r;
  };

  Myth.prototype.digTreasure = function () {
    const g = this.game;
    if (!this.treasure) return false;
    const t = this.treasure;
    this.treasure = null;

    const opts = MY.dream.loot.map(function (l, i) { return [i, l.w]; });
    const pick = MY.dream.loot[U.weighted(opts)];
    const coin = Math.round(pick.coin[0] + Math.random() * (pick.coin[1] - pick.coin[0]));
    g.inv.addCoins(coin);
    const got = ['💰' + U.fa(coin)];
    if (pick.items) {
      for (const k in pick.items) {
        const v = pick.items[k];
        const n = Array.isArray(v) ? Math.round(v[0] + Math.random() * (v[1] - v[0])) : v;
        if (n > 0 && g.inv.add(k, n)) got.push(C.ITEMS[k].icon + U.fa(n));
      }
    }
    g.fx.hitBurst(t.x, g.world.heightAt(t.x, t.z) + 0.6, t.z, 0xf0c437, 22);
    g.audio.coin();
    g.audio.levelUp();
    g.progress.addXp(160);
    g.progress.stat('treasure', 1);
    g.ui.levelUp('🗝️ گنج');
    g.ui.toast('🗝️ خاک را کندی و به کوزه‌ای خوردی — ' + got.join(' '), 'gold');
    g.chronicle.write('🗝️', 'جایی که رؤیا نشان داده بود کنده شد و کوزه‌ای پر از ' + got.join(' و ') + ' بیرون آمد.', 'gold');
    return true;
  };

  /* =========================================================
     INTERACTION — one E for all three legends
     ========================================================= */
  /** returns true when it consumed the key press */
  Myth.prototype.interact = function () {
    const g = this.game, p = g.player.pos;
    if (this.nearTreasure(p.x, p.z)) return this.digTreasure();
    if (this.peak && this.atPeak(p.x, p.z)) {
      const st = this.riteState();
      if (st.ok) return this.performRite();
      /* standing on the peak with a fire going but the wrong night: say so
         rather than silently doing nothing */
      if (st.fire || st.hasOffering) { g.ui.toast('🪶 ' + st.why, 'bad'); return true; }
    }
    return false;
  };

  /** the prompt the HUD shows when one of these is within reach */
  Myth.prototype.hint = function () {
    const g = this.game, p = g.player.pos;
    if (this.nearTreasure(p.x, p.z)) return { icon: '🗝️', text: 'جای رؤیا — E برای کندن' };
    if (this.peak && this.atPeak(p.x, p.z)) {
      const st = this.riteState();
      return { icon: '🪶', text: st.ok ? 'قلهٔ سیمرغ — E برای انجام آیین' : 'قلهٔ سیمرغ — ' + st.why };
    }
    return null;
  };

  /* =========================================================
     FRAME
     ========================================================= */
  Myth.prototype.update = function (dt) {
    const g = this.game;
    if (!this.peak) this.findPeak();
    if (this.bird) this._stepBird(dt);

    if (this.divState === 'active') {
      /* the wildlife list owns him; if he was culled, close the story */
      if (this.div && g.wildlife.animals.indexOf(this.div) < 0 && !this.div.dead) {
        this.div = null;
        this.divState = 'asleep';
        this.divSlainDay = g.time.day - MY.div.returnDays + 2;
      } else this._stepDiv(dt);
    }
  };

  Myth.prototype._bind = function () {
    const self = this, g = this.game;
    if (!g.bus) return;
    g.bus.on('newday', function () {
      self._dream();
      /* the Div wakes with the city, then walks the following night */
      const day = g.time.day;
      if (self.divState === 'asleep' && g.progress.tier >= MY.div.tier &&
        day - self.divSlainDay >= MY.div.returnDays) {
        self._omen();
      } else if (self.divState === 'omen' && day >= self.divWakeDay) {
        self._raiseDiv();
      }
    });
  };

  /* =========================================================
     PERSISTENCE
     ========================================================= */
  Myth.prototype.serialize = function () {
    return {
      riteDay: this.riteDay, blessUntil: this.blessUntil, feathers: this.feathersGiven,
      divState: this.divState === 'active' ? 'omen' : this.divState,   // he re-enters on load
      divWakeDay: this.divWakeDay, divSlainDay: this.divSlainDay,
      divCave: this.divCave, heartPower: this.heartPower,
      treasure: this.treasure, dreamDay: this.dreamDay
    };
  };
  Myth.prototype.deserialize = function (d) {
    if (!d) return;
    this.riteDay = d.riteDay === undefined ? -999 : d.riteDay;
    this.blessUntil = d.blessUntil === undefined ? -999 : d.blessUntil;
    this.feathersGiven = d.feathers || 0;
    this.divState = d.divState || 'asleep';
    this.divWakeDay = d.divWakeDay || 0;
    this.divSlainDay = d.divSlainDay === undefined ? -999 : d.divSlainDay;
    this.divCave = d.divCave || null;
    this.heartPower = d.heartPower || 0;
    this.treasure = d.treasure || null;
    this.dreamDay = d.dreamDay === undefined ? -999 : d.dreamDay;
  };

  Myth.prototype.clear = function () {
    this._despawnBird();
    this.div = null;
    this._rock = null;
  };

  G.Myth = Myth;
})(window.GAME = window.GAME || {});
