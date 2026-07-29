/* =========================================================
   economy.js — market with daily price swings, buying and
   selling, town income and the daily food upkeep.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config;

  /* what the trader is willing to sell you */
  const BUYABLE = [
    'seed_wheat', 'seed_carrot', 'seed_potato', 'seed_corn', 'seed_tomato',
    'seed_pumpkin', 'seed_melon', 'seed_grape',
    'wood', 'stone', 'clay', 'fiber', 'coal', 'plank', 'brick', 'cloth', 'iron',
    'bread', 'heart_flask'
  ];

  function Economy(game) {
    this.game = game;
    this.mult = Object.create(null);
    this.prev = Object.create(null);
    this.day = 0;
    this.rollPrices();
  }

  Economy.prototype.rollPrices = function () {
    for (const id in C.ITEMS) {
      this.prev[id] = this.mult[id] || 1;
      const drift = 0.72 + Math.random() * 0.62;              // 0.72 .. 1.34
      const smooth = this.prev[id] * 0.45 + drift * 0.55;
      this.mult[id] = U.clamp(smooth, 0.65, 1.45);
    }
  };

  Economy.prototype.marketBonus = function () {
    const b = this.game.building;
    if (!b) return 0;
    let lv = 0;
    for (const x of b.list) if (x.defId === 'market' || x.defId === 'tavern') lv += x.level;
    return Math.min(0.35, lv * 0.035);
  };

  /* Everything in the market trades dearer than it used to. Buying scales
     harder than selling, so stocking a town is a real cost while a good
     harvest is still worth carrying in. */
  Economy.prototype.sellPrice = function (id) {
    const it = C.ITEMS[id];
    if (!it) return 0;
    return Math.max(1, Math.round(it.value * C.PRICE.sell * (this.mult[id] || 1) * (1 + this.marketBonus())));
  };
  Economy.prototype.buyPrice = function (id) {
    const it = C.ITEMS[id];
    if (!it) return 0;
    return Math.max(1, Math.round(it.value * C.PRICE.buy * (this.mult[id] || 1)));
  };
  Economy.prototype.trend = function (id) {
    const a = this.mult[id] || 1, b = this.prev[id] || 1;
    if (a > b * 1.04) return 1;
    if (a < b * 0.96) return -1;
    return 0;
  };

  Economy.prototype.buyable = function () {
    const out = [];
    for (const id of BUYABLE) {
      if (!C.ITEMS[id]) continue;
      // seeds unlock with the matching farming level
      let lock = 0;
      for (const cid in C.CROPS) if (C.CROPS[cid].seed === id) lock = C.CROPS[cid].lvl;
      if (lock && this.game.progress.skill('farming').level < lock) {
        out.push({ id: id, locked: lock });
      } else out.push({ id: id, locked: 0 });
    }
    return out;
  };

  Economy.prototype.buy = function (id, qty) {
    const g = this.game;
    qty = qty || 1;
    const price = this.buyPrice(id) * qty;
    if (g.inv.coins < price) { g.ui.toast('💰 سکه کافی نداری', 'bad'); return false; }
    let lock = 0;
    for (const cid in C.CROPS) if (C.CROPS[cid].seed === id) lock = C.CROPS[cid].lvl;
    if (lock && g.progress.skill('farming').level < lock) {
      g.ui.toast('🔒 به کشاورزی سطح ' + U.fa(lock) + ' نیاز داری', 'bad'); return false;
    }
    const got = g.inv.add(id, qty);
    if (!got) return false;
    g.inv.addCoins(-this.buyPrice(id) * got);
    g.audio.coin();
    g.ui.toast('🛒 ' + U.fa(got) + '× ' + C.ITEMS[id].name + ' خریدی', 'good');
    return true;
  };

  Economy.prototype.sell = function (id, qty) {
    const g = this.game;
    qty = Math.min(qty || 1, g.inv.count(id));
    if (qty <= 0) return false;
    const total = this.sellPrice(id) * qty;
    g.inv.remove(id, qty);
    g.inv.addCoins(total);
    g.progress.stat('sold', qty);
    g.progress.addXp(Math.max(1, Math.round(total / 30)));
    g.audio.coin();
    g.ui.toast('💰 ' + U.fa(qty) + '× ' + C.ITEMS[id].name + ' فروختی (+' + U.fa(total) + ')', 'gold');
    return true;
  };

  Economy.prototype.sellAll = function (cats) {
    const g = this.game;
    let total = 0, n = 0;
    for (const row of g.inv.list()) {
      if (cats && cats.indexOf(row.def.cat) < 0) continue;
      total += this.sellPrice(row.id) * row.n;
      n += row.n;
      g.inv.remove(row.id, row.n);
    }
    if (!n) { g.ui.toast('چیزی برای فروش نیست', 'bad'); return; }
    g.inv.addCoins(total);
    g.progress.stat('sold', n);
    g.audio.coin();
    g.ui.toast('💰 ' + U.fa(n) + ' قلم فروخته شد (+' + U.fa(total) + ' سکه)', 'gold');
  };

  /* ===================== DAILY TICK ===================== */
  Economy.prototype.onNewDay = function () {
    const g = this.game;
    this.rollPrices();

    const income = g.building ? g.building.dailyIncome() : 0;
    if (income > 0) g.inv.addCoins(income);
    if (g.settlers) g.settlers.onNewDay();

    // townsfolk need feeding
    const pop = g.progress.population;
    const need = Math.ceil(pop / 4);
    let fed = 0;
    if (need > 0) {
      const order = ['bread', 'stew', 'cheese', 'salad', 'jam', 'fish_carp', 'fish_trout',
        'meat', 'egg', 'milk', 'carrot', 'potato', 'tomato', 'corn', 'wheat'];
      for (const id of order) {
        if (fed >= need) break;
        const have = g.inv.count(id);
        if (!have) continue;
        const take = Math.min(have, need - fed);
        g.inv.remove(id, take);
        fed += take;
      }
    }
    const short = need - fed;
    g.progress.foodMood = short > 0 ? -Math.min(30, short * 5) : Math.min(10, fed * 2);

    let msg = '📅 روز ' + U.fa(g.time.day) + ' — ';
    if (income > 0) msg += 'درآمد ' + U.fa(income) + ' سکه';
    else msg += 'روز تازه‌ای آغاز شد';
    if (need > 0) msg += ' · خوراک اهالی: ' + U.fa(fed) + '/' + U.fa(need);
    g.ui.toast(msg, short > 0 ? 'bad' : 'gold');
    if (short > 0) g.ui.toast('😟 غذای اهالی کم است — شادی کاهش یافت', 'bad');
  };

  G.Economy = Economy;
})(window.GAME = window.GAME || {});
