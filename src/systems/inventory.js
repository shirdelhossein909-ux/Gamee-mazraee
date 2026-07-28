/* =========================================================
   inventory.js — items, coins, storage capacity and the
   hotbar selection state.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config;

  function Inventory(game) {
    this.game = game;
    this.items = Object.create(null);
    this.coins = C.START.coins;
    this.selectedSeed = 'seed_wheat';
    this.selectedFood = 'bread';
    this.water = 0;              // watering-can charge
    for (const k in C.START.items) this.items[k] = C.START.items[k];
  }

  Inventory.prototype.capacity = function () {
    let cap = C.START.baseStorage;
    const b = this.game.building;
    if (b) cap += b.totalEffect('storage');
    return cap;
  };

  Inventory.prototype.used = function () {
    let n = 0;
    for (const k in this.items) n += this.items[k];
    return n;
  };

  Inventory.prototype.count = function (id) { return this.items[id] || 0; };
  Inventory.prototype.has = function (id, n) { return (this.items[id] || 0) >= (n || 1); };

  /** returns the amount actually stored (0 when full) */
  Inventory.prototype.add = function (id, n, silent) {
    if (!C.ITEMS[id] || n <= 0) return 0;
    const room = this.capacity() - this.used();
    if (room <= 0) {
      if (!silent) this.game.ui.warnFull();
      return 0;
    }
    const put = Math.min(n, room);
    this.items[id] = (this.items[id] || 0) + put;
    this.game.bus.emit('item', { id: id, n: put });
    if (put < n && !silent) this.game.ui.warnFull();
    return put;
  };

  Inventory.prototype.remove = function (id, n) {
    n = n || 1;
    const have = this.items[id] || 0;
    if (have < n) return false;
    if (have === n) delete this.items[id]; else this.items[id] = have - n;
    this.game.bus.emit('item', { id: id, n: -n });
    return true;
  };

  Inventory.prototype.addCoins = function (n) {
    this.coins = Math.max(0, this.coins + n);
    this.game.bus.emit('coins', n);
  };

  /* ---- costs: {wood:3, coin:50, ...} ---- */
  Inventory.prototype.canAfford = function (cost) {
    if (!cost) return true;
    for (const k in cost) {
      if (k === 'coin') { if (this.coins < cost[k]) return false; }
      else if ((this.items[k] || 0) < cost[k]) return false;
    }
    return true;
  };

  Inventory.prototype.pay = function (cost) {
    if (!this.canAfford(cost)) return false;
    for (const k in cost) {
      if (k === 'coin') this.addCoins(-cost[k]);
      else this.remove(k, cost[k]);
    }
    return true;
  };

  Inventory.prototype.missing = function (cost) {
    const out = [];
    for (const k in cost) {
      const have = k === 'coin' ? this.coins : (this.items[k] || 0);
      if (have < cost[k]) out.push({ id: k, need: cost[k] - have });
    }
    return out;
  };

  /** items sorted by category then value — used by the inventory panel */
  Inventory.prototype.list = function () {
    const order = { res: 0, craft: 1, crop: 2, seed: 3, animal: 4, fish: 5, food: 6 };
    const out = [];
    for (const k in this.items) {
      if (!C.ITEMS[k]) continue;
      out.push({ id: k, n: this.items[k], def: C.ITEMS[k] });
    }
    out.sort(function (a, b) {
      const d = (order[a.def.cat] || 9) - (order[b.def.cat] || 9);
      return d !== 0 ? d : b.def.value - a.def.value;
    });
    return out;
  };

  Inventory.prototype.seedList = function () {
    const out = [];
    for (const id in C.CROPS) {
      const s = C.CROPS[id].seed;
      if (this.items[s]) out.push(s);
    }
    return out;
  };

  Inventory.prototype.foodList = function () {
    const out = [];
    for (const id in C.FOOD) if (this.items[id]) out.push(id);
    return out;
  };

  Inventory.prototype.cycleSeed = function () {
    const l = this.seedList();
    if (!l.length) return null;
    let i = l.indexOf(this.selectedSeed);
    i = (i + 1) % l.length;
    this.selectedSeed = l[i];
    return this.selectedSeed;
  };

  Inventory.prototype.cycleFood = function () {
    const l = this.foodList();
    if (!l.length) return null;
    let i = l.indexOf(this.selectedFood);
    i = (i + 1) % l.length;
    this.selectedFood = l[i];
    return this.selectedFood;
  };

  Inventory.prototype.serialize = function () {
    return { items: this.items, coins: this.coins, seed: this.selectedSeed, food: this.selectedFood, water: this.water };
  };
  Inventory.prototype.deserialize = function (d) {
    this.items = Object.create(null);
    for (const k in d.items) if (C.ITEMS[k]) this.items[k] = d.items[k];
    this.coins = d.coins || 0;
    this.selectedSeed = d.seed || 'seed_wheat';
    this.selectedFood = d.food || 'bread';
    this.water = d.water || 0;
  };

  G.Inventory = Inventory;
})(window.GAME = window.GAME || {});
