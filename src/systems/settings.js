/* =========================================================
   settings.js — the choices that belong to you, not to a save.

   Quality, view distance, shadows, mouse sensitivity and the four
   volume sliders are about your machine and your ears, not about
   this particular farm. They live in their own localStorage key so
   they survive a new world, a reset, and closing the game.
   ========================================================= */
(function (G) {
  'use strict';

  const KEY = 'mz_settings_v1';

  const DEFAULTS = {
    quality: 'mid',
    view: 3,
    sens: 1.2,
    shadow: true,
    sound: true,
    autoLevel: true,
    vol: { master: 0.8, music: 0.5, ambient: 0.6, sfx: 0.85 }
  };

  function clamp(v, lo, hi, dflt) {
    const n = +v;
    return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  }

  const S = {
    /** the values in force right now — always a complete object */
    current: null,

    load: function () {
      const out = {
        quality: DEFAULTS.quality, view: DEFAULTS.view, sens: DEFAULTS.sens,
        shadow: DEFAULTS.shadow, sound: DEFAULTS.sound, autoLevel: DEFAULTS.autoLevel,
        vol: {
          master: DEFAULTS.vol.master, music: DEFAULTS.vol.music,
          ambient: DEFAULTS.vol.ambient, sfx: DEFAULTS.vol.sfx
        }
      };
      let raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
      if (raw) {
        try {
          const d = JSON.parse(raw);
          if (d.quality === 'low' || d.quality === 'mid' || d.quality === 'high') out.quality = d.quality;
          out.view = Math.round(clamp(d.view, 2, 4, DEFAULTS.view));
          out.sens = clamp(d.sens, 0.5, 3, DEFAULTS.sens);
          if (typeof d.shadow === 'boolean') out.shadow = d.shadow;
          if (typeof d.sound === 'boolean') out.sound = d.sound;
          if (typeof d.autoLevel === 'boolean') out.autoLevel = d.autoLevel;
          if (d.vol) for (const k in out.vol) {
            if (d.vol[k] !== undefined) out.vol[k] = clamp(d.vol[k], 0, 1, out.vol[k]);
          }
        } catch (e) { /* corrupt: fall back to the defaults above */ }
      }
      this.current = out;
      return out;
    },

    /** the whole settings object, or one value from it when given a key */
    get: function (key) {
      const s = this.current || this.load();
      return key === undefined ? s : s[key];
    },

    /** merge a change in and write it straight back out */
    set: function (key, value) {
      const s = this.get();
      if (key === 'vol') return s;
      s[key] = value;
      this.save();
      return s;
    },
    setVolume: function (bus, value) {
      const s = this.get();
      s.vol[bus] = clamp(value, 0, 1, s.vol[bus]);
      this.save();
      return s;
    },

    save: function () {
      try { localStorage.setItem(KEY, JSON.stringify(this.get())); return true; }
      catch (e) { return false; }
    },

    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) { }
      this.current = null;
    },

    /** push the stored values into a running game and onto the controls */
    apply: function (game) {
      const s = this.get();
      if (game) {
        if (game.renderer) game.setQuality(s.quality);
        if (game.world) game.setViewRadius(s.view);
        if (game.renderer) game.setShadows(s.shadow);
        if (game.audio) {
          for (const k in s.vol) game.audio.setVolume(k, s.vol[k]);
          game.audio.setEnabled(s.sound);
        }
      }
      if (G.Input) G.Input.sensitivity = s.sens;
      this.syncControls();
      return s;
    },

    /** make the menu show what is actually in force */
    syncControls: function () {
      const s = this.get();
      const $ = (id) => document.getElementById(id);
      const set = (id, prop, v) => { const el = $(id); if (el) el[prop] = v; };
      set('set-quality', 'value', s.quality);
      set('set-view', 'value', s.view);
      set('set-sens', 'value', s.sens);
      set('set-shadow', 'checked', s.shadow);
      set('set-autolevel', 'checked', s.autoLevel);
      set('set-sound', 'checked', s.sound);
      set('set-vol-master', 'value', s.vol.master);
      set('set-vol-music', 'value', s.vol.music);
      set('set-vol-amb', 'value', s.vol.ambient);
      set('set-vol-sfx', 'value', s.vol.sfx);
    }
  };

  G.Settings = S;
})(window.GAME = window.GAME || {});
