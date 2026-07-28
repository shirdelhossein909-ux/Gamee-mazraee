/* =========================================================
   utils.js — math, deterministic noise, RNG, small helpers
   Everything the world generator needs to be reproducible
   from a single integer seed.
   ========================================================= */
(function (G) {
  'use strict';

  const U = {};

  /* ---------------- math ---------------- */
  U.PI2 = Math.PI * 2;
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  U.smoothstep = function (e0, e1, x) {
    const t = U.clamp01((x - e0) / (e1 - e0 || 1e-6));
    return t * t * (3 - 2 * t);
  };
  /* frame-rate independent exponential approach */
  U.damp = (a, b, lambda, dt) => U.lerp(a, b, 1 - Math.exp(-lambda * dt));
  U.mod = (a, n) => ((a % n) + n) % n;
  /* shortest signed angular difference */
  U.angleDelta = function (a, b) {
    let d = U.mod(b - a + Math.PI, U.PI2) - Math.PI;
    return d;
  };
  U.dist2 = (ax, az, bx, bz) => {
    const dx = ax - bx, dz = az - bz;
    return dx * dx + dz * dz;
  };
  U.dist = (ax, az, bx, bz) => Math.sqrt(U.dist2(ax, az, bx, bz));

  /* ---------------- RNG ---------------- */
  /** mulberry32 — small, fast, good enough, fully deterministic */
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.strSeed = function (str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  U.pick = (arr, rnd) => arr[Math.floor((rnd ? rnd() : Math.random()) * arr.length) % arr.length];
  U.weighted = function (entries, rnd) {
    // entries: [[value, weight], ...]
    let total = 0;
    for (const e of entries) total += e[1];
    let r = (rnd ? rnd() : Math.random()) * total;
    for (const e of entries) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return entries[entries.length - 1][0];
  };
  U.randRange = (rnd, a, b) => a + (b - a) * rnd();

  /* ---------------- hashed value noise ----------------
     Stateless integer hash → no permutation tables, so any
     chunk can be generated in any order, on demand.        */
  function ihash(x, y, s) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  U.ihash = ihash;

  U.Noise = function (seed) {
    this.seed = seed >>> 0;
  };
  U.Noise.prototype = {
    /** smooth value noise, returns 0..1 */
    n2: function (x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf);
      const v = yf * yf * (3 - 2 * yf);
      const s = this.seed;
      const a = ihash(xi, yi, s), b = ihash(xi + 1, yi, s);
      const c = ihash(xi, yi + 1, s), d = ihash(xi + 1, yi + 1, s);
      return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
    },
    /** fractal brownian motion, returns 0..1 */
    fbm: function (x, y, oct, lac, gain) {
      oct = oct || 4; lac = lac || 2.0; gain = gain || 0.5;
      let amp = 1, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) {
        sum += this.n2(x * freq, y * freq) * amp;
        norm += amp;
        amp *= gain;
        freq *= lac;
      }
      return sum / norm;
    },
    /** ridged noise — sharp crests, good for mountains, 0..1 */
    ridged: function (x, y, oct) {
      oct = oct || 4;
      let amp = 1, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) {
        const n = 1 - Math.abs(this.n2(x * freq, y * freq) * 2 - 1);
        sum += n * n * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      return sum / norm;
    },
    /** cheap 1-octave sample offset by a channel id, 0..1 */
    ch: function (x, y, c) {
      const old = this.seed;
      this.seed = (old + Math.imul(c, 0x9e3779b1)) >>> 0;
      const v = this.n2(x, y);
      this.seed = old;
      return v;
    }
  };

  /* ---------------- events ---------------- */
  U.Bus = function () { this.map = {}; };
  U.Bus.prototype = {
    on: function (ev, fn) { (this.map[ev] || (this.map[ev] = [])).push(fn); return fn; },
    off: function (ev, fn) {
      const l = this.map[ev]; if (!l) return;
      const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
    },
    emit: function (ev, a, b) {
      const l = this.map[ev]; if (!l) return;
      for (let i = 0; i < l.length; i++) l[i](a, b);
    }
  };

  /* ---------------- formatting (Persian) ---------------- */
  const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  U.fa = function (n) { return String(n).replace(/\d/g, (d) => FA[+d]); };
  U.pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  /** 1234 -> 1.2K  */
  U.short = function (n) {
    n = Math.floor(n);
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return '' + n;
  };
  U.faTime = function (h, m) { return U.fa(U.pad2(h) + ':' + U.pad2(m)); };

  /* ---------------- misc ---------------- */
  U.key = (a, b) => a + ',' + b;
  U.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** remove element from array in O(1) (order not preserved) */
  U.swapRemove = function (arr, i) {
    const last = arr.length - 1;
    if (i !== last) arr[i] = arr[last];
    arr.pop();
  };

  G.Utils = U;
})(window.GAME = window.GAME || {});
