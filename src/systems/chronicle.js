/* =========================================================
   chronicle.js — وقایع‌نامهٔ کِشتوَر

   The town writes its own history. Every entry is stamped with
   the year, season and day it happened on, so a save file stops
   being a save file and becomes a story you can read back.

   Nothing here changes the simulation — it only watches it.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config;

  const MAX = 260;                       // oldest entries fall off the end
  const DAYS_PER_YEAR = C.TIME.daysPerSeason * 4;

  function Chronicle(game) {
    this.game = game;
    this.entries = [];
    this.marks = Object.create(null);    // one-off events already written
    this._lastSeason = -1;
    this._bind();
  }

  /* ---------------- the date line ---------------- */
  Chronicle.prototype.stamp = function () {
    const t = this.game.time || { day: 1, hours: 8 };
    const day = t.day || 1;
    return {
      day: day,
      year: Math.floor((day - 1) / DAYS_PER_YEAR) + 1,
      season: Math.floor((day - 1) / C.TIME.daysPerSeason) % 4,
      inSeason: ((day - 1) % C.TIME.daysPerSeason) + 1,
      hours: t.hours || 0
    };
  };

  const ORD = ['یکم', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم', 'هفتم', 'هشتم', 'نهم', 'دهم'];
  Chronicle.prototype.dateText = function (e) {
    const y = ORD[e.year - 1] || U.fa(e.year);
    const s = C.SEASONS[e.season] ? C.SEASONS[e.season].name : '';
    const part = e.hours < 5 ? 'سحر' : e.hours < 11 ? 'بامداد'
      : e.hours < 15 ? 'نیم‌روز' : e.hours < 19 ? 'عصر' : 'شب';
    return 'سال ' + y + '، ' + s + '، روز ' + U.fa(e.inSeason) + '، ' + part;
  };

  /* ---------------- writing ---------------- */
  /** kind: plain | good | bad | gold | myth */
  Chronicle.prototype.write = function (icon, text, kind) {
    const e = this.stamp();
    e.icon = icon || '•';
    e.text = text;
    e.kind = kind || 'plain';
    this.entries.push(e);
    if (this.entries.length > MAX) this.entries.splice(0, this.entries.length - MAX);
    if (this.game.ui) this.game.ui.chronicleNew = true;
    return e;
  };

  /** write only the first time this key ever comes up */
  Chronicle.prototype.once = function (key, icon, text, kind) {
    if (this.marks[key]) return null;
    this.marks[key] = 1;
    return this.write(icon, text, kind);
  };

  Chronicle.prototype.has = function (key) { return !!this.marks[key]; };

  /* ---------------- what it watches on its own ---------------- */
  Chronicle.prototype._bind = function () {
    const self = this, g = this.game;
    if (!g.bus) return;

    g.bus.on('build', function (b) {
      if (!b || !b.def) return;
      /* the first of anything is a milestone; the tenth fence is not */
      self.once('built_' + b.defId, b.def.icon,
        'نخستین ' + b.def.name + ' کِشتوَر برپا شد.', 'good');
    });

    g.bus.on('newday', function (day) {
      const s = Math.floor((day - 1) / C.TIME.daysPerSeason) % 4;
      if (self._lastSeason === -1) { self._lastSeason = s; return; }
      if (s === self._lastSeason) return;
      self._lastSeason = s;
      const def = C.SEASONS[s];
      const pop = g.progress ? g.progress.population : 0;
      self.write(def.icon, def.name + ' رسید. ' +
        (pop ? U.fa(pop) + ' نفر در کِشتوَر زندگی می‌کنند.' : 'هنوز کسی اینجا زندگی نمی‌کند.'), 'plain');
    });
  };

  /* ---------------- persistence ---------------- */
  Chronicle.prototype.serialize = function () {
    return { entries: this.entries, marks: this.marks, lastSeason: this._lastSeason };
  };
  Chronicle.prototype.deserialize = function (d) {
    if (!d) return;
    this.entries = Array.isArray(d.entries) ? d.entries.slice(-MAX) : [];
    this.marks = Object.create(null);
    if (d.marks) for (const k in d.marks) this.marks[k] = d.marks[k];
    this._lastSeason = d.lastSeason === undefined ? -1 : d.lastSeason;
  };

  G.Chronicle = Chronicle;
})(window.GAME = window.GAME || {});
