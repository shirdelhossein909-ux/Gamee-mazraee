/* =========================================================
   settlers.js — the people of your town.

   Housing is capacity; residents are actual humans. You grow
   the population three ways:
     • natural immigration when there are spare homes
     • hiring a worker outright for coins
     • sending a mounted recruiter out on an expedition to
       find displaced people and escort them home
   A level-1 recruiter takes a week and brings one person; a
   level-5 recruiter is back in under two days with five.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;

  function Settlers(game) {
    this.game = game;
    this.residents = C.SETTLERS.start;
    this.riders = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.uid = 1;
  }

  /* ===================== POPULATION ===================== */
  Settlers.prototype.housing = function () {
    return this.game.building ? Math.max(0, this.game.building.totalEffect('pop')) : 0;
  };
  Settlers.prototype.population = function () {
    return Math.min(this.residents, this.housing());
  };
  Settlers.prototype.homeless = function () {
    return Math.max(0, this.residents - this.housing());
  };
  Settlers.prototype.spareHomes = function () {
    return Math.max(0, this.housing() - this.residents);
  };

  Settlers.prototype.addResidents = function (n, why) {
    if (n <= 0) return 0;
    this.residents += n;
    this.game.progress.recalc();
    if (why) this.game.ui.toast('👥 ' + U.fa(n) + ' نفر ' + why, 'gold');
    return n;
  };

  /* ===================== HIRING A WORKER ===================== */
  Settlers.prototype.workerCost = function () {
    return Math.round(C.SETTLERS.workerBase * Math.pow(C.SETTLERS.workerGrowth, this.residents));
  };

  Settlers.prototype.hireWorker = function () {
    const g = this.game;
    const cost = this.workerCost();
    if (this.spareHomes() < 1) {
      g.ui.toast('🏠 خانهٔ خالی نداری — اول خانه بساز', 'bad'); g.audio.deny(); return false;
    }
    if (g.inv.coins < cost) { g.ui.toast('💰 سکه کافی نداری', 'bad'); g.audio.deny(); return false; }
    g.inv.addCoins(-cost);
    this.addResidents(1);
    g.progress.stat('hire', 1);
    g.ui.toast('🧑‍🌾 یک کارگر استخدام شد (' + U.fa(cost) + ' سکه)', 'gold');
    g.audio.coin();
    return true;
  };

  /* ===================== RECRUITERS ===================== */
  Settlers.prototype.maxRiders = function () {
    return this.game.building ? this.game.building.maxLevelOf('stable') : 0;
  };

  Settlers.prototype.hireRider = function () {
    const g = this.game;
    if (this.maxRiders() < 1) { g.ui.toast('🏇 اول یک اصطبل بساز', 'bad'); g.audio.deny(); return false; }
    if (this.riders.length >= this.maxRiders()) {
      g.ui.toast('🏇 اصطبلت جا ندارد — ارتقایش بده', 'bad'); g.audio.deny(); return false;
    }
    const cost = C.SETTLERS.riderCost(this.riders.length);
    if (!g.inv.canAfford(cost)) { g.ui.toast('⚠️ منابع کافی نداری', 'bad'); g.audio.deny(); return false; }
    g.inv.pay(cost);
    const r = {
      id: this.uid++, level: 1, state: 'idle',
      trip: 0, tripLen: 0, bring: 0,
      obj: null, x: 0, z: 0, y: 0, yaw: 0, phase: 0, anim: 0
    };
    this.riders.push(r);
    g.ui.toast('🏇 یک سوارکار به خدمت درآمد', 'gold');
    g.audio.horse();
    return true;
  };

  Settlers.prototype.riderStat = function (level) {
    return {
      days: Math.max(C.SETTLERS.minDays, C.SETTLERS.baseDays - (level - 1) * C.SETTLERS.daysPerLevel),
      bring: level
    };
  };

  Settlers.prototype.upgradeRider = function (r) {
    const g = this.game;
    if (r.level >= C.SETTLERS.riderMax) { g.ui.toast('در بالاترین سطح است', 'bad'); return false; }
    if (r.state !== 'idle') { g.ui.toast('سوارکار در سفر است', 'bad'); return false; }
    const cost = C.SETTLERS.riderUpgrade(r.level + 1);
    if (!g.inv.canAfford(cost)) { g.ui.toast('⚠️ منابع کافی نداری', 'bad'); g.audio.deny(); return false; }
    g.inv.pay(cost);
    r.level++;
    const st = this.riderStat(r.level);
    g.ui.toast('⬆️ سوارکار سطح ' + U.fa(r.level) + ' — هر سفر ' + U.fa(st.bring) +
      ' نفر در ' + U.fa(Math.round(st.days * 10) / 10) + ' روز', 'gold');
    g.audio.upgrade();
    return true;
  };

  Settlers.prototype.sendRider = function (r) {
    const g = this.game;
    if (r.state !== 'idle') return false;
    const st = this.riderStat(r.level);
    if (this.spareHomes() < st.bring) {
      g.ui.toast('🏠 برای ' + U.fa(st.bring) + ' نفر خانهٔ خالی نداری', 'bad');
      g.audio.deny();
      return false;
    }
    const cost = C.SETTLERS.tripCost(r.level);
    if (!g.inv.canAfford(cost)) { g.ui.toast('⚠️ توشهٔ سفر کم است', 'bad'); g.audio.deny(); return false; }
    g.inv.pay(cost);
    r.state = 'leaving';
    r.trip = 0;
    r.tripLen = st.days;
    r.bring = st.bring;
    r.anim = 0;
    const b = this._stable();
    r.x = b ? b.x : 0; r.z = b ? b.z : 0;
    r.yaw = Math.random() * 6.283;
    this._show(r);
    g.ui.toast('🏇 سوارکار راهی سفر شد — ' + U.fa(Math.round(st.days * 10) / 10) + ' روز دیگر برمی‌گردد', 'good');
    g.audio.horse();
    return true;
  };

  Settlers.prototype.sendAll = function () {
    let n = 0;
    for (const r of this.riders) if (r.state === 'idle' && this.sendRider(r)) n++;
    if (!n) this.game.ui.toast('سوارکار آمادهٔ اعزام نداری', 'bad');
    return n;
  };

  Settlers.prototype._stable = function () {
    const b = this.game.building;
    if (!b) return null;
    for (const x of b.list) if (x.defId === 'stable') return x;
    return b.list.length ? { x: b.centerX, z: b.centerZ } : null;
  };

  Settlers.prototype._show = function (r) {
    if (r.obj) return;
    r.obj = M.horseRider(r.level);
    this.group.add(r.obj);
  };
  Settlers.prototype._hide = function (r) {
    if (!r.obj) return;
    this.group.remove(r.obj);
    r.obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    r.obj = null;
  };

  /* ===================== UPDATE ===================== */
  Settlers.prototype.update = function (dt) {
    const g = this.game;
    const hoursPerSec = 24 / C.TIME.dayLength;
    const days = dt * hoursPerSec / 24;
    const home = this._stable() || { x: 0, z: 0 };

    for (const r of this.riders) {
      if (r.state === 'idle') { this._hide(r); continue; }

      if (r.state === 'leaving' || r.state === 'arriving') {
        r.anim += dt;
        const away = 46;
        const t = U.clamp01(r.anim / 3.4);
        const dist = r.state === 'leaving' ? t * away : (1 - t) * away;
        r.x = home.x + Math.cos(r.yaw) * dist;
        r.z = home.z + Math.sin(r.yaw) * dist;
        r.y = g.world.heightAt(r.x, r.z);
        r.phase += dt * 9;
        if (r.obj) {
          r.obj.position.set(r.x, r.y, r.z);
          r.obj.rotation.y = r.state === 'leaving' ? r.yaw + Math.PI / 2 : r.yaw - Math.PI / 2;
          const legs = r.obj.userData.legs;
          if (legs) for (const l of legs) l.rotation.x = Math.sin(r.phase + l.userData.phase) * 0.85;
          r.obj.position.y += Math.abs(Math.sin(r.phase)) * 0.12;
        }
        if (t >= 1) {
          if (r.state === 'leaving') { r.state = 'away'; this._hide(r); }
          else { r.state = 'idle'; this._hide(r); this._deliver(r); }
        }
        continue;
      }

      if (r.state === 'away') {
        r.trip += days;
        if (r.trip >= r.tripLen) {
          r.state = 'arriving';
          r.anim = 0;
          this._show(r);
          g.audio.horse();
        }
      }
    }
  };

  Settlers.prototype._deliver = function (r) {
    const g = this.game;
    const room = this.spareHomes();
    const got = Math.min(r.bring, room);
    if (got > 0) {
      this.addResidents(got);
      g.progress.stat('rescued', got);
      g.ui.toast('🏇 سوارکار برگشت و ' + U.fa(got) + ' نفر بی‌پناه را آورد!', 'gold');
      g.ui.levelUp('👥 +' + U.fa(got));
      g.audio.quest();
    } else {
      g.ui.toast('🏇 سوارکار برگشت ولی خانهٔ خالی نبود — کسی نماند', 'bad');
    }
    r.bring = 0;
    r.trip = 0;
  };

  /* ===================== DAILY ===================== */
  Settlers.prototype.onNewDay = function () {
    const g = this.game;
    const spare = this.spareHomes();
    if (spare > 0 && g.progress.happiness >= C.SETTLERS.minHappy) {
      const n = Math.max(1, Math.ceil(spare * C.SETTLERS.immigrationRate));
      const got = Math.min(n, spare);
      this.addResidents(got);
      g.ui.toast('🚶 ' + U.fa(got) + ' نفر تازه‌وارد به آبادی آمدند', 'good');
    } else if (spare === 0 && this.housing() > 0) {
      g.ui.toast('🏠 همهٔ خانه‌ها پر است — برای رشد بیشتر خانه بساز', 'bad');
    }
    // homeless people slowly drift away
    const hl = this.homeless();
    if (hl > 0) {
      const leave = Math.ceil(hl * 0.5);
      this.residents = Math.max(0, this.residents - leave);
      g.ui.toast('😔 ' + U.fa(leave) + ' نفر به‌خاطر نبود خانه رفتند', 'bad');
      g.progress.recalc();
    }
  };

  /* ===================== PERSISTENCE ===================== */
  Settlers.prototype.serialize = function () {
    return {
      residents: this.residents,
      riders: this.riders.map(function (r) {
        return [r.level, r.state === 'idle' ? 'idle' : 'away',
        Math.round(r.trip * 100) / 100, r.tripLen, r.bring];
      })
    };
  };
  Settlers.prototype.deserialize = function (d) {
    for (const r of this.riders) this._hide(r);
    this.riders.length = 0;
    if (!d) { this.residents = C.SETTLERS.start; return; }
    this.residents = d.residents === undefined ? C.SETTLERS.start : d.residents;
    if (d.riders) {
      for (const r of d.riders) {
        this.riders.push({
          id: this.uid++, level: r[0] || 1, state: r[1] === 'away' ? 'away' : 'idle',
          trip: r[2] || 0, tripLen: r[3] || 0, bring: r[4] || 0,
          obj: null, x: 0, z: 0, y: 0, yaw: 0, phase: 0, anim: 0
        });
      }
    }
  };

  Settlers.prototype.clear = function () {
    for (const r of this.riders) this._hide(r);
    this.riders.length = 0;
  };

  G.Settlers = Settlers;
})(window.GAME = window.GAME || {});
