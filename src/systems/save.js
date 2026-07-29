/* =========================================================
   save.js — localStorage persistence. Wrapped in try/catch
   because storage can be unavailable on file:// or in
   private browsing modes.
   ========================================================= */
(function (G) {
  'use strict';

  const KEY = 'mazrae_shahr_save_v1';

  const S = {
    available: function () {
      try {
        localStorage.setItem('__t', '1');
        localStorage.removeItem('__t');
        return true;
      } catch (e) { return false; }
    },

    has: function () {
      try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
    },

    peek: function () {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        return { day: d.time ? d.time.day : 1, tier: d.progress ? d.progress.tier : 0, at: d.at || 0 };
      } catch (e) { return null; }
    },

    save: function (game) {
      if (!game.started) return false;
      const data = {
        v: 1,
        at: Date.now(),
        seed: game.seed,
        time: { hours: game.time.hours, day: game.time.day, season: game.time.season },
        weather: game.sky.weather,
        player: game.player.serialize(),
        inv: game.inv.serialize(),
        farm: game.farming.serialize(),
        build: game.building.serialize(),
        progress: game.progress.serialize(),
        settlers: game.settlers.serialize(),
        vehicles: game.vehicles.serialize(),
        horses: game.horses.serialize(),
        markers: game.markers,
        harvested: game.world.harvested,
        economy: { mult: game.economy.mult }
      };
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
        return true;
      } catch (e) {
        game.ui.toast('⚠️ ذخیره ناموفق بود (فضای مرورگر پر است؟)', 'bad');
        return false;
      }
    },

    load: function () {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },

    /** apply a save onto an already-built game world (same seed) */
    apply: function (game, d) {
      if (!d) return false;
      if (d.time) {
        game.time.hours = d.time.hours;
        game.time.day = d.time.day;
        game.time.season = d.time.season || 0;
      }
      if (d.weather) game.sky.setWeather(d.weather);
      if (d.harvested) {
        game.world.harvested = Object.create(null);
        for (const k in d.harvested) game.world.harvested[k] = d.harvested[k];
      }
      if (d.progress) game.progress.deserialize(d.progress);
      if (d.inv) game.inv.deserialize(d.inv);
      if (d.player) game.player.deserialize(d.player);
      if (d.build) game.building.deserialize(d.build);
      game.settlers.deserialize(d.settlers);
      game.vehicles.deserialize(d.vehicles);
      game.horses.deserialize(d.horses);
      game.markers = Array.isArray(d.markers) ? d.markers : [];
      game.markerSeq = game.markers.reduce(function (a, m) { return Math.max(a, m.n || 0); }, 0);
      if (d.farm) game.farming.deserialize(d.farm);
      if (d.economy && d.economy.mult) game.economy.mult = d.economy.mult;
      game.progress.recalc();
      return true;
    },

    clear: function () {
      try { localStorage.removeItem(KEY); return true; } catch (e) { return false; }
    }
  };

  G.SaveSystem = S;
})(window.GAME = window.GAME || {});
