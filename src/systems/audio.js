/* =========================================================
   audio.js — the whole soundtrack is synthesised at runtime
   with the Web Audio API: no sample files, nothing to
   download, works offline from file://.

   Three buses: music (generative score), ambient (wind,
   birds, rain, water, crickets) and sfx (one-shots).
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config;

  function Audio(game) {
    this.game = game;
    this.ready = false;
    this.enabled = true;
    this.vol = { master: 0.8, music: 0.5, ambient: 0.6, sfx: 0.85 };
    this._stepT = 0;
    this._noteT = 0;
    this._barT = 0;
    this._chordIdx = 0;
    this._birdT = 3;
    this._voices = 0;
  }

  /* =========================================================
     SETUP  (must happen inside a user gesture)
     ========================================================= */
  Audio.prototype.init = function () {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC(); } catch (e) { return false; }

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.vol.master;
    // a gentle limiter keeps stacked voices from clipping
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -9;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.012;     // let transients through
    this.comp.release.value = 0.2;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.busMusic = ctx.createGain(); this.busMusic.gain.value = this.vol.music;
    this.busAmb = ctx.createGain(); this.busAmb.gain.value = this.vol.ambient;
    this.busSfx = ctx.createGain(); this.busSfx.gain.value = this.vol.sfx;

    // shared reverb built from a synthesised impulse response
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(1.5, 3.2);   // short, so tails do not smear
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.16;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    // musical echo
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.42;
    this.fb = ctx.createGain(); this.fb.gain.value = 0.31;
    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.value = 1900;
    this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.fb);
    this.fb.connect(this.delay);
    this.delay.connect(this.busMusic);

    this.busMusic.connect(this.master);
    this.busAmb.connect(this.master);
    this.busSfx.connect(this.master);
    this.busSfx.connect(this.verb);
    this.busMusic.connect(this.verb);

    this.noise = this._noiseBuffer(2.2);
    this._buildAmbient();
    this.ready = true;
    return true;
  };

  Audio.prototype.resume = function () {
    if (!this.ready && !this.init()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  };

  Audio.prototype._noiseBuffer = function (seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  };

  Audio.prototype._impulse = function (seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  };

  /* =========================================================
     LOW-LEVEL VOICES
     ========================================================= */
  /** short pitched note */
  Audio.prototype.tone = function (o) {
    if (!this.ready || !this.enabled || this._voices > 26) return;
    const ctx = this.ctx, t = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.dur || 0.2));
    if (o.detune) osc.detune.value = o.detune;

    const peak = (o.gain === undefined ? 0.3 : o.gain);
    const atk = o.attack === undefined ? 0.008 : o.attack;
    const dur = o.dur || 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.value = o.cutoff || 900;
      if (o.q) f.Q.value = o.q;
      osc.connect(f); node = f;
    }
    node.connect(g);
    g.connect(o.bus || this.busSfx);
    if (o.echo) g.connect(this.delay);
    this._voices++;
    const self = this;
    osc.onended = function () { self._voices--; try { g.disconnect(); } catch (e) { } };
    osc.start(t);
    osc.stop(t + dur + 0.05);
  };

  /** filtered noise burst — footsteps, impacts, splashes, wind gusts */
  Audio.prototype.burst = function (o) {
    if (!this.ready || !this.enabled || this._voices > 26) return;
    const ctx = this.ctx, t = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 800, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t + (o.dur || 0.2));
    const q = o.q === undefined ? 1.1 : o.q;
    f.Q.value = q;
    const g = ctx.createGain();
    /* A band-pass throws away most of the noise's energy, so a nominal gain
       of 0.3 lands ~40dB below a tone of the same figure. Compensate by the
       filter's bandwidth, otherwise every impact is drowned by the music. */
    const bw = f.type === 'bandpass' ? Math.min(3.4, 1.0 + q * 0.62) : 1.25;
    const peak = (o.gain === undefined ? 0.3 : o.gain) * bw;
    const dur = o.dur || 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || this.busSfx);
    this._voices++;
    const self = this;
    src.onended = function () { self._voices--; try { g.disconnect(); } catch (e) { } };
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.05);
  };

  /* =========================================================
     AMBIENT BEDS (always running, gain-controlled)
     ========================================================= */
  Audio.prototype._loopNoise = function (filterType, freq, q, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.busAmb);
    src.start(Math.random());
    return { src: src, filter: f, gain: g };
  };

  Audio.prototype._buildAmbient = function () {
    this.wind = this._loopNoise('lowpass', 420, 0.7, 0);
    /* Rain is NOT high-passed noise — that is exactly what TV static is.
       Real rain is a soft low-passed wash with a slow swell, plus separate
       droplet transients scheduled in update(). */
    this.rain = this._loopNoise('lowpass', 780, 0.5, 0);
    this.rainBody = this._loopNoise('bandpass', 320, 0.6, 0);
    this.water = this._loopNoise('bandpass', 520, 0.9, 0);
    // slow LFO so wind breathes instead of hissing
    const ctx = this.ctx;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.055;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 130;
    lfo.connect(lfoGain);
    lfoGain.connect(this.wind.filter.frequency);
    lfo.start();
    this.windLfo = lfo;

    // rain swells and eases instead of sitting at one flat level
    const rl = ctx.createOscillator();
    rl.type = 'sine';
    rl.frequency.value = 0.13;
    const rlg = ctx.createGain();
    rlg.gain.value = 190;
    rl.connect(rlg);
    rlg.connect(this.rain.filter.frequency);
    rl.start();
    this.rainLfo = rl;
    this._dropT = 0;
  };

  const _ramp = (param, v, ctx, time) => {
    param.setTargetAtTime(v, ctx.currentTime, time || 0.7);
  };

  /* =========================================================
     GENERATIVE MUSIC
     ========================================================= */
  const SCALE_DAY = [0, 2, 4, 7, 9, 12, 14, 16];        // major pentatonic
  const SCALE_NIGHT = [0, 3, 5, 7, 10, 12, 15, 17];     // minor pentatonic
  const CHORDS_DAY = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [2, 5, 9]];
  const CHORDS_NIGHT = [[0, 3, 7], [8, 12, 15], [5, 8, 12], [3, 7, 10]];
  const ROOT = 130.81;   // C3

  const midiFreq = (semi) => ROOT * Math.pow(2, semi / 12);

  Audio.prototype._music = function (dt) {
    if (!this.ready || this.vol.music <= 0.001) return;
    const night = this.game.sky ? this.game.sky.nightFactor > 0.55 : false;
    const storm = this.game.sky && this.game.sky.weather === 'storm';
    const beat = night ? 2.6 : 2.05;

    this._barT -= dt;
    if (this._barT <= 0) {
      this._barT = beat * 4;
      const chords = night ? CHORDS_NIGHT : CHORDS_DAY;
      this._chordIdx = (this._chordIdx + 1) % chords.length;
      const ch = chords[this._chordIdx];
      // pad
      for (let i = 0; i < ch.length; i++) {
        this.tone({
          freq: midiFreq(ch[i]), type: 'triangle', dur: beat * 4.2,
          gain: night ? 0.075 : 0.062, attack: 1.1, detune: (i - 1) * 6,
          filter: 'lowpass', cutoff: night ? 700 : 1200, bus: this.busMusic
        });
      }
      // bass
      this.tone({
        freq: midiFreq(ch[0] - 12), type: 'sine', dur: beat * 2.4,
        gain: 0.12, attack: 0.14, bus: this.busMusic
      });
    }

    this._noteT -= dt;
    if (this._noteT <= 0) {
      this._noteT = beat * (Math.random() < 0.42 ? 0.5 : 1);
      if (Math.random() < (storm ? 0.32 : 0.62)) {
        const scale = night ? SCALE_NIGHT : SCALE_DAY;
        const n = scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
        this.tone({
          freq: midiFreq(n), type: night ? 'sine' : 'triangle',
          dur: 0.9, gain: night ? 0.09 : 0.1, attack: 0.02,
          filter: 'lowpass', cutoff: 2600, bus: this.busMusic, echo: true
        });
      }
    }
  };

  /* =========================================================
     PER-FRAME
     ========================================================= */
  Audio.prototype.update = function (dt) {
    if (!this.ready || !this.enabled) return;
    const g = this.game, ctx = this.ctx;
    const sky = g.sky, p = g.player;
    if (!sky || !p) return;

    const w = sky.weather;
    const night = sky.nightFactor;
    const stormy = w === 'storm';

    /* wind: stronger in storms and up on the mountains */
    const alt = U.clamp01((p.pos.y - 8) / 40);
    let windLvl = 0.05 + alt * 0.08;
    if (w === 'cloudy') windLvl += 0.035;
    if (w === 'rain') windLvl += 0.045;
    if (w === 'snow') windLvl += 0.04;
    if (stormy) windLvl += 0.075;
    _ramp(this.wind.gain.gain, windLvl * 0.75, ctx, 2.2);
    // keep the storm dark and rumbling rather than a harsh hiss
    _ramp(this.wind.filter.frequency, stormy ? 300 : 380, ctx, 2.4);

    /* rain: soft wash + body, then discrete droplets on top */
    const rainLvl = w === 'rain' ? 0.075 : stormy ? 0.105 : w === 'snow' ? 0.012 : 0;
    _ramp(this.rain.gain.gain, rainLvl, ctx, 1.2);
    _ramp(this.rainBody.gain.gain, rainLvl * 0.55, ctx, 1.2);
    if (rainLvl > 0.02 && w !== 'snow') {
      this._dropT -= dt;
      if (this._dropT <= 0) {
        this._dropT = (stormy ? 0.045 : 0.085) * (0.5 + Math.random());
        this.drop();
      }
    }

    /* water lapping when near a shore */
    const nearWater = g.gather && g.gather.nearWater ? g.gather.nearWater() : false;
    _ramp(this.water.gain.gain, nearWater ? (p.swimming ? 0.13 : 0.07) : 0, ctx, 0.9);

    /* birds by day, crickets by night — quiet in bad weather */
    this._birdT -= dt;
    if (this._birdT <= 0) {
      const calm = w === 'clear' || w === 'cloudy' || w === 'fog';
      if (night < 0.35 && calm) {
        this._birdT = 1.4 + Math.random() * 5.5;
        this.bird();
      } else if (night > 0.6 && calm) {
        this._birdT = 0.5 + Math.random() * 1.4;
        this.cricket();
      } else {
        this._birdT = 2 + Math.random() * 4;
        if (Math.random() < 0.3) this.bird();
      }
    }

    /* a fire you are standing beside pops and crackles */
    this._fireT = (this._fireT || 0) - dt;
    if (this._fireT <= 0) {
      this._fireT = 0.35 + Math.random() * 0.5;
      const b = g.building;
      if (b && b.list.length) {
        let near = false;
        for (const s of b.list) {
          if (!s.lit) continue;
          if (U.dist2(p.pos.x, p.pos.z, s.x, s.z) < 100) { near = true; break; }
        }
        if (near) this.crackle();
      }
    }

    /* thunder follows the lightning flash */
    if (stormy && sky._flash > 0.16 && !this._thunderT) {
      this._thunderT = 0.5 + Math.random() * 1.6;
    }
    if (this._thunderT) {
      this._thunderT -= dt;
      if (this._thunderT <= 0) { this._thunderT = 0; this.thunder(); }
    }

    /* footsteps / swim strokes driven by actual movement */
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (p.mount) {
      this._stepT = 0.25;
    } else if (speed > 0.6 && (p.onGround || p.swimming)) {
      this._stepT -= dt * speed * (p.swimming ? 0.16 : 0.30);
      if (this._stepT <= 0) {
        this._stepT = 1;
        if (p.swimming) this.swimStroke(); else this.step();
      }
    } else this._stepT = 0.35;

    this._music(dt);
  };

  /* =========================================================
     SOUND EFFECTS
     ========================================================= */
  const A = Audio.prototype;

  A.step = function () {
    const g = this.game, p = g.player;
    const h = p.pos.y;
    let kind = 'grass';
    if (p.inWater) kind = 'water';
    else {
      const b = g.world.biomeAt(p.pos.x, p.pos.z, h);
      if (b === 'beach' || b === 'desert') kind = 'sand';
      else if (b === 'rocky' || b === 'snow') kind = 'stone';
    }
    const r = 0.85 + Math.random() * 0.3;
    if (kind === 'water') this.burst({ freq: 900 * r, to: 350, q: 0.7, dur: 0.19, gain: 0.16, filter: 'bandpass' });
    else if (kind === 'sand') this.burst({ freq: 1500 * r, to: 700, q: 0.6, dur: 0.13, gain: 0.09, filter: 'bandpass' });
    else if (kind === 'stone') { this.burst({ freq: 2200 * r, q: 2.2, dur: 0.09, gain: 0.11 }); this.tone({ freq: 150 * r, dur: 0.05, gain: 0.05, type: 'sine' }); }
    else this.burst({ freq: 700 * r, to: 320, q: 0.9, dur: 0.14, gain: 0.085, filter: 'bandpass' });
  };

  A.swimStroke = function () {
    this.burst({ freq: 700, to: 1500, q: 0.6, dur: 0.34, gain: 0.15, filter: 'bandpass', attack: 0.05 });
  };

  A.bird = function () {
    const base = 1700 + Math.random() * 1500;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this.tone({
        freq: base * (0.9 + Math.random() * 0.3), to: base * (1.25 + Math.random() * 0.5),
        type: 'sine', dur: 0.1 + Math.random() * 0.06, gain: 0.13,
        attack: 0.012, delay: i * (0.08 + Math.random() * 0.07), bus: this.busAmb
      });
    }
  };

  A.cricket = function () {
    const f = 4200 + Math.random() * 900;
    for (let i = 0; i < 3; i++) {
      this.burst({ freq: f, q: 18, dur: 0.05, gain: 0.11, delay: i * 0.07, bus: this.busAmb });
    }
  };

  /** a single rain droplet — short, pitched, slightly random */
  A.drop = function () {
    const f = 1500 + Math.random() * 2600;
    this.burst({
      freq: f, to: f * 0.45, q: 5.5, dur: 0.035 + Math.random() * 0.03,
      gain: 0.012 + Math.random() * 0.016, attack: 0.002, bus: this.busAmb
    });
  };

  A.thunder = function () {
    this.burst({ freq: 150, to: 40, q: 0.5, dur: 2.8, gain: 0.14, filter: 'lowpass', attack: 0.35, rate: 0.55, bus: this.busAmb });
    this.tone({ freq: 52, to: 26, type: 'sine', dur: 2.2, gain: 0.16, attack: 0.3, bus: this.busAmb });
  };

  A.chop = function () {
    this.burst({ freq: 420, to: 140, q: 1.4, dur: 0.22, gain: 0.16, filter: 'lowpass' });
    this.tone({ freq: 190, to: 95, type: 'triangle', dur: 0.18, gain: 0.2 });
  };
  A.treeFall = function () {
    this.burst({ freq: 700, to: 120, q: 0.8, dur: 1.5, gain: 0.3, filter: 'lowpass', attack: 0.2, rate: 0.75 });
    this.tone({ freq: 90, to: 42, type: 'sine', dur: 1.1, gain: 0.2, attack: 0.25 });
  };
  A.mine = function () {
    this.burst({ freq: 3000, q: 3, dur: 0.1, gain: 0.075 });
    this.tone({ freq: 900 + Math.random() * 300, to: 500, type: 'square', dur: 0.11, gain: 0.12, filter: 'lowpass', cutoff: 2400 });
    this.tone({ freq: 150, to: 80, type: 'sine', dur: 0.16, gain: 0.16 });
  };
  A.rockBreak = function () {
    this.burst({ freq: 900, to: 200, q: 0.8, dur: 0.7, gain: 0.3, filter: 'lowpass', rate: 0.85 });
  };
  A.till = function () {
    this.burst({ freq: 950, to: 260, q: 0.8, dur: 0.4, gain: 0.24, filter: 'bandpass', attack: 0.03 });
    this.tone({ freq: 120, to: 70, type: 'sine', dur: 0.22, gain: 0.28 });
  };
  A.plant = function () {
    this.tone({ freq: 620, to: 880, type: 'sine', dur: 0.18, gain: 0.26 });
    this.burst({ freq: 2400, q: 2, dur: 0.1, gain: 0.07 });
  };
  A.pour = function () {
    this.burst({ freq: 500, to: 2200, q: 0.7, dur: 0.75, gain: 0.16, filter: 'bandpass', attack: 0.12 });
  };
  A.harvest = function () {
    this.burst({ freq: 1300, to: 600, q: 1.2, dur: 0.18, gain: 0.12 });
    this.tone({ freq: 700, type: 'triangle', dur: 0.26, gain: 0.22 });
    this.tone({ freq: 1050, type: 'triangle', dur: 0.32, gain: 0.18, delay: 0.09 });
  };
  A.splash = function (big) {
    this.burst({ freq: 500, to: 2400, q: 0.5, dur: big ? 0.7 : 0.4, gain: big ? 0.3 : 0.18, filter: 'bandpass', attack: 0.02 });
    this.tone({ freq: big ? 200 : 320, to: 90, type: 'sine', dur: 0.32, gain: 0.24 });
  };
  A.cast = function () {
    this.burst({ freq: 2600, to: 700, q: 1.4, dur: 0.42, gain: 0.15, attack: 0.06 });
  };
  A.bite = function () {
    this.tone({ freq: 900, to: 1400, type: 'sine', dur: 0.13, gain: 0.3 });
    this.tone({ freq: 1400, to: 900, type: 'sine', dur: 0.13, gain: 0.28, delay: 0.11 });
  };
  A.reel = function () {
    for (let i = 0; i < 5; i++) this.burst({ freq: 1800, q: 6, dur: 0.04, gain: 0.07, delay: i * 0.05 });
  };
  A.swing = function () {
    this.burst({ freq: 1100, to: 320, q: 0.9, dur: 0.24, gain: 0.16, filter: 'bandpass', attack: 0.05 });
  };
  A.hit = function () {
    this.burst({ freq: 350, to: 110, q: 1.1, dur: 0.2, gain: 0.3, filter: 'lowpass' });
    this.tone({ freq: 130, to: 60, type: 'square', dur: 0.15, gain: 0.3, filter: 'lowpass', cutoff: 700 });
  };
  A.bow = function () {
    this.tone({ freq: 320, to: 150, type: 'sawtooth', dur: 0.16, gain: 0.3, filter: 'lowpass', cutoff: 1400 });
    this.burst({ freq: 2200, to: 900, q: 1.4, dur: 0.3, gain: 0.1, attack: 0.03 });
  };
  A.beast = function (big) {
    const f = big ? 130 : 260;
    this.tone({ freq: f, to: f * 0.55, type: 'sawtooth', dur: big ? 0.6 : 0.34, gain: 0.34, filter: 'lowpass', cutoff: big ? 500 : 900 });
    this.burst({ freq: f * 3, to: f, q: 1.1, dur: big ? 0.5 : 0.3, gain: 0.13, filter: 'bandpass' });
  };
  A.hurt = function () {
    this.tone({ freq: 420, to: 180, type: 'square', dur: 0.24, gain: 0.2, filter: 'lowpass', cutoff: 1100 });
    this.burst({ freq: 300, to: 120, q: 1, dur: 0.24, gain: 0.09, filter: 'lowpass' });
  };
  A.build = function () {
    this.burst({ freq: 420, to: 150, q: 1, dur: 0.3, gain: 0.26, filter: 'lowpass' });
    [523, 659, 784].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.32, gain: 0.2, delay: 0.06 + i * 0.07 }));
  };
  A.upgrade = function () {
    [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.42, gain: 0.12, delay: i * 0.075, echo: true }));
  };
  A.coin = function () {
    this.tone({ freq: 1760, type: 'triangle', dur: 0.19, gain: 0.24 });
    this.tone({ freq: 2637, type: 'triangle', dur: 0.24, gain: 0.18, delay: 0.055 });
  };
  A.levelUp = function () {
    [523, 659, 784, 1046, 1318].forEach((f, i) =>
      this.tone({ freq: f, type: 'triangle', dur: 0.55, gain: 0.13, delay: i * 0.085, echo: true }));
  };
  A.quest = function () {
    [659, 784, 988, 1318].forEach((f, i) =>
      this.tone({ freq: f, type: 'sine', dur: 0.7, gain: 0.13, delay: i * 0.11, echo: true }));
  };
  A.eat = function () {
    for (let i = 0; i < 3; i++) this.burst({ freq: 600 + i * 130, to: 260, q: 1.4, dur: 0.11, gain: 0.11, delay: i * 0.11 });
  };
  A.click = function () { this.tone({ freq: 1200, to: 1500, type: 'sine', dur: 0.09, gain: 0.16 }); };
  A.deny = function () {
    this.tone({ freq: 220, to: 150, type: 'square', dur: 0.2, gain: 0.2, filter: 'lowpass', cutoff: 900 });
  };
  A.alarm = function () {
    for (let i = 0; i < 2; i++) {
      this.tone({ freq: 620, to: 420, type: 'sawtooth', dur: 0.4, gain: 0.26, filter: 'lowpass', cutoff: 1300, delay: i * 0.42 });
    }
  };
  A.horse = function () {
    for (let i = 0; i < 6; i++) {
      this.burst({ freq: 260, to: 110, q: 1.6, dur: 0.1, gain: 0.13, filter: 'bandpass', delay: i * 0.135 + (i % 2) * 0.045 });
    }
  };
  /** one hoof-fall while riding — a soft thud with a little grit on top */
  A.hoof = function () {
    this.burst({ freq: 190 + Math.random() * 60, to: 80, q: 1.3, dur: 0.09, gain: 0.075, filter: 'bandpass' });
    this.burst({ freq: 1500 + Math.random() * 700, to: 700, q: 3.5, dur: 0.03, gain: 0.02, filter: 'bandpass', delay: 0.01 });
  };
  /** the crackle of a campfire — sparse, irregular pops */
  A.crackle = function () {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this.burst({
        freq: 900 + Math.random() * 1800, to: 400, q: 4.5,
        dur: 0.02 + Math.random() * 0.03, gain: 0.014 + Math.random() * 0.018,
        filter: 'bandpass', attack: 0.002, delay: Math.random() * 0.4, bus: this.busAmb
      });
    }
  };
  A.boatMove = function () {
    this.burst({ freq: 380, to: 900, q: 0.7, dur: 0.5, gain: 0.09, filter: 'bandpass', attack: 0.1 });
  };

  /** looping car engine, pitch follows the throttle */
  A.engineStart = function () {
    if (!this.ready || this.engine) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 27;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    osc.connect(f); osc2.connect(f); f.connect(g); g.connect(this.busSfx);
    osc.start(); osc2.start();
    g.gain.setTargetAtTime(0.07, ctx.currentTime, 0.25);
    this.engine = { osc: osc, osc2: osc2, gain: g, filter: f };
  };
  A.engineRev = function (throttle) {
    if (!this.engine) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const base = 52 + throttle * 68;
    this.engine.osc.frequency.setTargetAtTime(base, t, 0.12);
    this.engine.osc2.frequency.setTargetAtTime(base * 0.5, t, 0.12);
    this.engine.filter.frequency.setTargetAtTime(360 + throttle * 900, t, 0.15);
    this.engine.gain.gain.setTargetAtTime(0.045 + throttle * 0.06, t, 0.15);
  };
  A.engineStop = function () {
    if (!this.engine) return;
    const e = this.engine, ctx = this.ctx;
    this.engine = null;
    e.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.18);
    setTimeout(function () {
      try { e.osc.stop(); e.osc2.stop(); e.gain.disconnect(); } catch (x) { }
    }, 700);
  };

  /* =========================================================
     SETTINGS
     ========================================================= */
  Audio.prototype.setVolume = function (which, v) {
    this.vol[which] = v;
    if (!this.ready) return;
    if (which === 'master') this.master.gain.value = v;
    if (which === 'music') this.busMusic.gain.value = v;
    if (which === 'ambient') this.busAmb.gain.value = v;
    if (which === 'sfx') this.busSfx.gain.value = v;
  };
  Audio.prototype.setEnabled = function (on) {
    this.enabled = on;
    if (this.ready) this.master.gain.value = on ? this.vol.master : 0;
    if (!on) this.engineStop();
  };

  G.Audio = Audio;
})(window.GAME = window.GAME || {});
