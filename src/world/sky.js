/* =========================================================
   sky.js — clock, seasons, sun/moon lighting, gradient sky,
   stars, drifting clouds and weather particles (rain/snow).
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;
  const T = C.TIME;

  function Sky(game) {
    this.game = game;
    this.scene = game.scene;
    this.group = new THREE.Group();

    this.time = { hours: T.startHour, day: 1, season: 0, elapsed: 0 };
    game.time = this.time;

    this.weather = 'clear';
    this.weatherLeft = 3;
    this.nightFactor = 0;
    this.dayFactor = 1;
    /* weather changes are eased in over several seconds — snapping the
       light level the instant a storm rolls in reads as a hard flicker */
    this.wLight = 1;
    this.wFog = 1;
    this._flash = 0;
    this._windAngle = Math.random() * 6.283;

    this._buildLights();
    this._buildDome();
    this._buildStars();
    this._buildClouds();
    this._buildPrecip();
    this.scene.add(this.group);
    this.apply();
  }

  /* ===================== LIGHTS ===================== */
  Sky.prototype._buildLights = function () {
    this.hemi = new THREE.HemisphereLight(0xbfd8f0, 0x4a5a3a, 0.55);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.near = 1;
    s.camera.far = 260;
    // tighter frustum = more texels per metre = crisper, steadier shadows
    s.camera.left = -52; s.camera.right = 52;
    s.camera.top = 52; s.camera.bottom = -52;
    s.bias = -0.0009;
    s.normalBias = 0.035;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  };

  /* ===================== SKY DOME ===================== */
  const SKY_VS = [
    'varying vec3 vWorld;',
    'void main(){',
    '  vec4 wp = modelMatrix * vec4(position,1.0);',
    '  vWorld = wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  const SKY_FS = [
    'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;',
    'uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunPow;',
    'varying vec3 vWorld;',
    'void main(){',
    '  vec3 dir = normalize(vWorld - cameraPosition);',
    '  float h = clamp(dir.y*0.5+0.5, 0.0, 1.0);',
    '  vec3 col = mix(bottom, mid, smoothstep(0.42, 0.55, h));',
    '  col = mix(col, top, smoothstep(0.55, 0.92, h));',
    '  float sd = max(dot(dir, normalize(sunDir)), 0.0);',
    '  col += sunCol * pow(sd, 26.0) * sunPow * 1.6;',
    '  col += sunCol * pow(sd, 4.0) * sunPow * 0.20;',
    // uniforms arrive in linear space; the renderer does not run its own
    // output encoding on a custom ShaderMaterial, so convert here.
    '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);',
    '}'
  ].join('\n');

  Sky.prototype._buildDome = function () {
    this.uni = {
      top: { value: new THREE.Color(0x3f7fd0) },
      mid: { value: new THREE.Color(0x8fc4ec) },
      bottom: { value: new THREE.Color(0xcfe4f2) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunCol: { value: new THREE.Color(0xffd9a0) },
      sunPow: { value: 1 }
    };
    const geo = new THREE.SphereGeometry(1, 24, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uni, vertexShader: SKY_VS, fragmentShader: SKY_FS,
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.scale.setScalar(600);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // sun & moon billboards
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog: false, transparent: true });
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(11, 12, 10), sunMat);
    this.sunDisc.frustumCulled = false;
    this.group.add(this.sunDisc);

    const moonMat = new THREE.MeshBasicMaterial({ color: 0xf6f9ff, fog: false, transparent: true });
    this.moonDisc = new THREE.Mesh(new THREE.SphereGeometry(11, 12, 10), moonMat);
    this.moonDisc.frustumCulled = false;
    this.group.add(this.moonDisc);
  };

  /* ===================== STARS ===================== */
  Sky.prototype._buildStars = function () {
    const n = 900;
    const pos = new Float32Array(n * 3);
    const rnd = U.rng(1337);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * 6.283;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.9 + 0.06;
      pos[i * 3] = Math.cos(a) * r * 460;
      pos[i * 3 + 1] = y * 460;
      pos[i * 3 + 2] = Math.sin(a) * r * 460;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.group.add(this.stars);
  };

  /* ===================== CLOUDS ===================== */
  Sky.prototype._buildClouds = function () {
    const parts = [];
    const rnd = U.rng(4242);
    this.cloudData = [];
    for (let c = 0; c < 16; c++) {
      const cx = (rnd() - 0.5) * 900, cz = (rnd() - 0.5) * 900;
      const cy = 78 + rnd() * 45;
      const sc = 0.8 + rnd() * 1.5;
      for (let b = 0; b < 5; b++) {
        parts.push({
          g: M.P.ico, c: 0xffffff,
          p: [cx + (rnd() - 0.5) * 30 * sc, cy + (rnd() - 0.5) * 6, cz + (rnd() - 0.5) * 26 * sc],
          r: [rnd(), rnd(), rnd()],
          s: [(12 + rnd() * 14) * sc, (7 + rnd() * 6) * sc, (11 + rnd() * 12) * sc]
        });
      }
    }
    const geo = M.merge(parts);
    this.cloudMat = new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, opacity: 0.75, fog: false, depthWrite: false, flatShading: true
    });
    this.clouds = new THREE.Mesh(geo, this.cloudMat);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -998;
    this.group.add(this.clouds);
  };

  /* ===================== PRECIPITATION ===================== */
  Sky.prototype._buildPrecip = function () {
    const n = 2200;
    this.pN = n;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n);
    const rnd = U.rng(99);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 90;
      pos[i * 3 + 1] = rnd() * 46;
      pos[i * 3 + 2] = (rnd() - 0.5) * 90;
      vel[i] = 0.7 + rnd() * 0.6;
    }
    this.pPos = pos; this.pVel = vel;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.precipMat = new THREE.PointsMaterial({
      color: 0xaad4ff, size: 2, sizeAttenuation: false,
      transparent: true, opacity: 0.55, depthWrite: false, fog: false
    });
    this.precip = new THREE.Points(g, this.precipMat);
    this.precip.frustumCulled = false;
    this.precip.visible = false;
    this.group.add(this.precip);
  };

  /* ===================== WEATHER ===================== */
  Sky.prototype.rollWeather = function () {
    const s = C.SEASONS[this.time.season];
    const r = Math.random();
    let w = 'clear';
    if (r < s.snow) w = 'snow';
    else if (r < s.snow + s.rain) w = (Math.random() < 0.28 ? 'storm' : 'rain');
    else if (r < s.snow + s.rain + 0.2) w = 'cloudy';
    else if (r < s.snow + s.rain + 0.26) w = 'fog';
    this.setWeather(w);
    this.weatherLeft = 2 + Math.random() * 6;
  };

  Sky.prototype.setWeather = function (id) {
    if (!C.WEATHER[id]) id = 'clear';
    const changed = this.weather !== id;
    this.weather = id;
    const isRain = id === 'rain' || id === 'storm';
    const isSnow = id === 'snow';
    this.precip.visible = isRain || isSnow;
    if (isSnow) {
      this.precipMat.color.setHex(0xffffff);
      this.precipMat.size = 3.4;
      this.precipMat.opacity = 0.85;
    } else {
      this.precipMat.color.setHex(0xcfe6ff);
      this.precipMat.size = id === 'storm' ? 2.2 : 1.8;
      this.precipMat.opacity = 0.5;
    }
    if (changed && this.game.ui && this.game.started) {
      this.game.ui.toast(C.WEATHER[id].icon + ' هوا ' + C.WEATHER[id].name + ' شد');
    }
  };

  /* ===================== UPDATE ===================== */
  Sky.prototype.update = function (dt, player) {
    const t = this.time;
    const prevDay = t.day;
    t.elapsed += dt;
    t.hours += dt * (24 / T.dayLength);
    while (t.hours >= 24) {
      t.hours -= 24;
      t.day++;
      t.season = Math.floor((t.day - 1) / T.daysPerSeason) % 4;
    }
    if (t.day !== prevDay) this.game.bus.emit('newday', t.day);

    this.weatherLeft -= dt * (24 / T.dayLength);
    if (this.weatherLeft <= 0) this.rollWeather();

    // ease toward the new weather's light/fog instead of snapping to it
    const wt = C.WEATHER[this.weather];
    this.wLight = U.damp(this.wLight, wt.light, 0.5, dt);
    this.wFog = U.damp(this.wFog, wt.fog, 0.5, dt);

    this.apply(player);
    this._stepPrecip(dt, player);

    // clouds drift with the wind
    if (this.clouds) {
      const spd = this.weather === 'storm' ? 4.2 : 1.8;
      this.clouds.position.x += Math.cos(this._windAngle) * spd * dt;
      this.clouds.position.z += Math.sin(this._windAngle) * spd * dt;
      if (player) {
        // wrap so clouds always surround the player
        const dx = player.x - this.clouds.position.x, dz = player.z - this.clouds.position.z;
        if (Math.abs(dx) > 450) this.clouds.position.x += Math.sign(dx) * 900;
        if (Math.abs(dz) > 450) this.clouds.position.z += Math.sign(dz) * 900;
      }
    }
    // lightning
    if (this.weather === 'storm') {
      this._flash -= dt;
      if (this._flash < -0.2 && Math.random() < dt * 0.12) this._flash = 0.16;
    } else this._flash = -1;
  };

  /* The sun's arc is warped so daylight lasts dayStart→dayEnd (16h) and night
     the remaining 8h — a plain sine would always give an even 12/12 split. */
  const DAY_SPAN = T.dayEnd - T.dayStart;
  const NIGHT_SPAN = 24 - DAY_SPAN;
  /* how low the shadow light may ever hang, and how far it swings sideways.
     Both keep shadows short and slow — see the note in apply(). */
  const SHADOW_MIN_Y = 0.80;
  const SHADOW_SWEEP = 0.45;
  Sky.prototype.sunAngle = function (h) {
    if (h >= T.dayStart && h < T.dayEnd) return ((h - T.dayStart) / DAY_SPAN) * Math.PI;
    const t = h < T.dayStart ? (h + 24 - T.dayEnd) : (h - T.dayEnd);
    return Math.PI + (t / NIGHT_SPAN) * Math.PI;
  };

  Sky.prototype.apply = function (player) {
    const t = this.time;
    const w = C.WEATHER[this.weather];
    const a = this.sunAngle(t.hours);
    const sy = Math.sin(a), sx = Math.cos(a);

    // 0 at night, 1 at midday — every colour below blends on these two
    // factors so dawn and dusk roll in gradually instead of snapping.
    const day = U.smoothstep(-0.16, 0.30, sy);
    const golden = U.smoothstep(-0.05, 0.16, sy) * (1 - U.smoothstep(0.14, 0.42, sy));
    const nightF = 1 - U.smoothstep(-0.10, 0.15, sy);      // smooth day↔night blend
    const dayF = 1 - nightF;
    this.dayFactor = day;
    this.nightFactor = nightF;

    const px = player ? player.x : 0, pz = player ? player.z : 0;

    // sun / moon direction
    const dirX = sx * 0.55, dirY = sy, dirZ = sx * 0.42 + 0.55;
    const len = Math.hypot(dirX, dirY, dirZ) || 1;
    const upX = dirX / len, upY = dirY / len, upZ = dirZ / len;
    const below = sy < 0;
    const lx = below ? -upX : upX, ly = below ? -upY : upY, lz = below ? -upZ : upZ;

    /* ---- the shadow-casting direction is NOT the visual sun's ----
       A day here lasts twelve real minutes, so the real sun sweeps the sky
       a hundred times faster than life. Shadows that track it 1:1 visibly
       crawl across the ground while you stand still — and worst of all near
       dawn and dusk, where a shallow sun makes shadows enormously long and
       multiplies every degree of rotation into metres of travel.

       So the disc in the sky keeps its true arc (that is what sells the time
       of day) while the light that casts shadows rides a compressed one: it
       never drops below SHADOW_MIN_Y and swings through a fraction of the
       azimuth. Shadows still lean the right way morning and evening, they
       stay a believable length, and they no longer wander. */
    const dLen = Math.hypot(lx, lz) || 1;
    const sMinY = SHADOW_MIN_Y;
    const shY = Math.max(sMinY, Math.abs(ly));
    const flat = Math.sqrt(Math.max(0, 1 - shY * shY)) * SHADOW_SWEEP;
    const shX = (lx / dLen) * flat, shZ = (lz / dLen) * flat;
    const shLen = Math.hypot(shX, shY, shZ) || 1;
    const ux = shX / shLen, uy = shY / shLen, uz = shZ / shLen;

    /* Snap the frustum centre to whole texels *along the shadow map's own
       axes*. Snapping in world X/Z (which is what this used to do) lands
       between texels whenever the light is not axis-aligned, and the map
       still swims a fraction of a texel as you walk. */
    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const snap = Math.max(0.05, texel * 4);
    // shadow-space basis: right = up × dir, then forward = dir × right
    let rx = -uz, rz = ux;                    // (0,1,0) × dir, flattened
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const fx = uy * rz, fy = uz * rx - ux * rz, fz = -uy * rx;
    const fl = Math.hypot(fx, fy, fz) || 1;
    const gx = fx / fl, gz = fz / fl;
    // project the follow point onto that basis, round, project back
    const su = Math.round((px * rx + pz * rz) / snap) * snap;
    const sv = Math.round((px * gx + pz * gz) / snap) * snap;
    const det = rx * gz - rz * gx;
    let sxp = px, szp = pz;
    if (Math.abs(det) > 1e-6) {
      sxp = (su * gz - sv * rz) / det;
      szp = (sv * rx - su * gx) / det;
    }
    this.sun.position.set(sxp + ux * 120, uy * 130 + 12, szp + uz * 120);
    this.sun.target.position.set(sxp, 0, szp);
    this.sun.target.updateMatrixWorld();

    const flash = this._flash > 0 ? 1.6 : 0;
    const lightMul = this.wLight;
    /* The key light swaps from sun to moon exactly at the horizon, which
       would fling every shadow to the opposite side in one frame. Fading it
       almost to nothing across the crossover hides the swap completely —
       ambient and hemisphere light carry the scene for those few seconds. */
    const dip = 0.05 + 0.95 * U.smoothstep(0, 0.17, Math.abs(sy));
    this.sun.intensity = U.lerp(0.62, 0.35 + day * 0.95, dayF) * lightMul * dip + flash;
    mixHex(this.sun.color, 0xb6cdf4, 0xfff3dc, dayF);
    this.sun.color.lerp(tmpHex(0xffb072), golden * 0.85);

    this.hemi.intensity = (0.46 + day * 0.34) * lightMul + flash * 0.5;
    mixHex(this.hemi.color, 0x51689a, 0xbfd8f0, dayF);
    mixHex(this.hemi.groundColor, 0x36402f, 0x53603c, dayF);
    this.ambient.intensity = (0.30 + day * 0.06) * lightMul + flash * 0.4;
    mixHex(this.ambient.color, 0x8fa6d6, 0xffffff, dayF);

    // sky gradient
    const c = this.uni;
    const nightTop = 0x111a34, nightMid = 0x24355c, nightBot = 0x3d5074;
    const dayTop = 0x2f6fc8, dayMid = 0x86bde8, dayBot = 0xc9e3f3;
    const duskTop = 0x2b3f78, duskMid = 0xa85a6a, duskBot = 0xe8964a;
    mixHex(c.top.value, nightTop, dayTop, day);
    mixHex(c.mid.value, nightMid, dayMid, day);
    mixHex(c.bottom.value, nightBot, dayBot, day);
    /* no `if` guards here on purpose: a threshold makes the sky jump the
       instant it is crossed. A zero-weight lerp is already a no-op. */
    c.top.value.lerp(tmpHex(duskTop), golden * 0.85);
    c.mid.value.lerp(tmpHex(duskMid), golden * 0.9);
    c.bottom.value.lerp(tmpHex(duskBot), golden * 0.95);
    const gloom = U.smoothstep(0.95, 0.4, this.wLight);
    c.top.value.lerp(tmpHex(0x53616e), gloom * 0.75);
    c.mid.value.lerp(tmpHex(0x6b7885), gloom * 0.8);
    c.bottom.value.lerp(tmpHex(0x8b95a0), gloom * 0.8);
    if (flash) { c.top.value.addScalar(0.45); c.mid.value.addScalar(0.5); c.bottom.value.addScalar(0.5); }

    c.sunDir.value.set(upX, upY, upZ);
    c.sunCol.value.setHex(golden > 0.2 ? 0xff9a4a : 0xfff0c8);
    c.sunPow.value = Math.max(0, day * 0.9 + golden);

    this.dome.position.set(px, 0, pz);
    this.stars.position.set(px, 0, pz);
    this.starMat.opacity = U.clamp01(nightF * 1.4 - 0.25) * U.clamp01((this.wLight - 0.5) * 3);
    this.stars.visible = this.starMat.opacity > 0.02;

    this.sunDisc.position.set(px + upX * 430, upY * 430, pz + upZ * 430);
    this.sunDisc.visible = upY > -0.15;
    this.moonDisc.position.set(px - upX * 430, -upY * 430, pz - upZ * 430);
    this.moonDisc.visible = -upY > -0.15;
    this.cloudMat.opacity = 0.28 + (1 - this.wLight) * 0.62;
    mixHex(this.cloudMat.color, 0x8b96ad, 0xffffff, dayF);
    if (this.weather === 'storm') this.cloudMat.color.lerp(tmpHex(0x6a7078), 0.75);

    // fog follows the horizon colour
    const scene = this.scene;
    if (scene.fog) {
      scene.fog.color.copy(c.bottom.value).lerp(c.mid.value, 0.35);
      const base = C.WORLD.chunkSize * (C.WORLD.viewRadius + 0.35);
      scene.fog.near = base * 0.30 / this.wFog;
      scene.fog.far = base * 1.5 / this.wFog;
    }
    if (this.game.renderer) this.game.renderer.setClearColor(c.bottom.value);
  };

  const _tmp = new THREE.Color();
  function tmpHex(h) { return _tmp.setHex(h); }
  const _a = new THREE.Color(), _b = new THREE.Color();
  /** out = lerp(hexA, hexB, t) — used everywhere so nothing ever hard-switches */
  function mixHex(out, h1, h2, t) {
    _a.setHex(h1); _b.setHex(h2);
    out.copy(_a).lerp(_b, t);
  }

  Sky.prototype._stepPrecip = function (dt, player) {
    if (!this.precip.visible || !player) return;
    const snow = this.weather === 'snow';
    const base = snow ? 4.5 : 34;
    const drift = snow ? 2.2 : (this.weather === 'storm' ? 7 : 2.5);
    const pos = this.pPos, vel = this.pVel, n = this.pN;
    const wx = Math.cos(this._windAngle) * drift, wz = Math.sin(this._windAngle) * drift;
    const px = player.x, py = player.y, pz = player.z;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      pos[i3 + 1] -= base * vel[i] * dt;
      pos[i3] += wx * dt * vel[i];
      pos[i3 + 2] += wz * dt * vel[i];
      if (pos[i3 + 1] < -6) {
        pos[i3 + 1] = 40;
        pos[i3] = (Math.random() - 0.5) * 90;
        pos[i3 + 2] = (Math.random() - 0.5) * 90;
      }
      // keep the volume centred on the player
      const dx = pos[i3] - 0, dz = pos[i3 + 2] - 0;
      if (dx > 45) pos[i3] -= 90; else if (dx < -45) pos[i3] += 90;
      if (dz > 45) pos[i3 + 2] -= 90; else if (dz < -45) pos[i3 + 2] += 90;
    }
    this.precip.geometry.attributes.position.needsUpdate = true;
    this.precip.position.set(px, py, pz);
  };

  /* helpers used by the rest of the game */
  Sky.prototype.isNight = function () {
    return this.time.hours < T.dayStart + 0.6 || this.time.hours > T.dayEnd - 0.6;
  };
  Sky.prototype.phaseIcon = function () {
    const h = this.time.hours;
    if (h < T.dawn) return '🌙';
    if (h < T.sunrise + 1.2) return '🌅';
    if (h < T.sunset - 1.2) return '☀️';
    if (h < T.dusk) return '🌇';
    return '🌙';
  };
  Sky.prototype.rainAmount = function () { return C.WEATHER[this.weather].water; };
  Sky.prototype.setShadows = function (on) {
    this.sun.castShadow = on;
  };
  Sky.prototype.setQuality = function (q) {
    const size = q === 'low' ? 1024 : q === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  };

  G.Sky = Sky;
})(window.GAME = window.GAME || {});
