/* =========================================================
   ui.js — HUD, hotbar, panels, minimap, toasts and every
   piece of DOM the game talks to.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config;
  const $ = (id) => document.getElementById(id);

  function UI(game) {
    this.game = game;
    this.selected = 0;
    this.panelOpen = null;
    this.marketMode = 'sell';
    this.buildCat = 'farm';
    this.invSel = null;
    this.structure = null;
    this.dirtyRes = true;
    this.dirtyHot = true;
    this._mmT = 0;
    this._mmX = 1e9; this._mmZ = 1e9;
    this.floaters = [];
    this._toastN = 0;
    this._lastFull = 0;

    this.el = {
      hud: $('hud'), res: $('resbar'), hotbar: $('hotbar'),
      hp: $('bar-hp'), st: $('bar-st'), xp: $('bar-xp'),
      thp: $('txt-hp'), tst: $('txt-st'), txp: $('txt-xp'),
      level: $('hud-level'), time: $('hud-time'), phase: $('hud-phase'),
      day: $('hud-day'), season: $('hud-season'), weather: $('hud-weather'),
      tier: $('hud-tier'), pop: $('hud-pop'), happy: $('hud-happy'),
      mm: $('minimap'), mmc: $('mm-coords'),
      cross: $('crosshair'), ti: $('target-info'),
      tiName: $('ti-name'), tiHint: $('ti-hint'), tiBar: $('ti-bar').firstElementChild,
      qtName: $('qt-name'), qtDesc: $('qt-desc'), qtFill: $('qt-fill'), qt: $('quest-track'),
      panels: $('panels'), toasts: $('toasts'),
      buildbar: $('buildbar'), bbTitle: $('bb-title'), bbCost: $('bb-cost'), bbWarn: $('bb-warn'),
      fishing: $('fishing'), fZone: $('fish-zone'), fMarker: $('fish-marker'), fTries: $('fish-tries'),
      dmg: $('dmg-flash'), lvlup: $('lvlup'), luText: $('lu-text')
    };
    this.mmCtx = this.el.mm.getContext('2d');
    this._bind();
  }

  /* =========================================================
     BINDINGS
     ========================================================= */
  UI.prototype._bind = function () {
    const self = this;

    // close buttons + backdrop
    const closers = document.querySelectorAll('.panel header .close');
    for (let i = 0; i < closers.length; i++) closers[i].onclick = () => self.closePanel();
    document.querySelector('.panel-shade').onclick = () => self.closePanel();

    // market tabs
    const mt = document.querySelectorAll('[data-mk]');
    for (let i = 0; i < mt.length; i++) {
      mt[i].onclick = function () {
        for (let k = 0; k < mt.length; k++) mt[k].classList.remove('active');
        this.classList.add('active');
        self.marketMode = this.getAttribute('data-mk');
        self.renderMarket();
      };
    }

    // build category tabs (cleared first — a restart rebuilds the UI)
    const bt = $('build-tabs');
    bt.innerHTML = '';
    for (const cat of C.BUILD_CATS) {
      const b = document.createElement('button');
      b.className = 'tab' + (cat.id === this.buildCat ? ' active' : '');
      b.textContent = cat.name;
      b.onclick = function () {
        const all = bt.querySelectorAll('.tab');
        for (let k = 0; k < all.length; k++) all[k].classList.remove('active');
        b.classList.add('active');
        self.buildCat = cat.id;
        self.renderBuild();
      };
      bt.appendChild(b);
    }

    // menu buttons
    $('btn-save').onclick = function () {
      if (G.SaveSystem.save(self.game)) self.toast('💾 بازی ذخیره شد', 'good');
    };
    $('btn-load').onclick = function () {
      const d = G.SaveSystem.load();
      if (!d) { self.toast('ذخیره‌ای پیدا نشد', 'bad'); return; }
      self.closePanel();
      self.game.restart(d);
    };
    $('btn-reset').onclick = function () {
      if (!confirm('همه پیشرفت پاک شود و بازی از نو شروع شود؟')) return;
      G.SaveSystem.clear();
      self.closePanel();
      self.game.restart(null, (Math.random() * 1e9) | 0);
    };

    // settings
    $('set-quality').onchange = function () { self.game.setQuality(this.value); };
    $('set-view').oninput = function () { self.game.setViewRadius(+this.value); };
    $('set-sens').oninput = function () { G.Input.sensitivity = +this.value; };
    $('set-shadow').onchange = function () { self.game.setShadows(this.checked); };

    // audio
    const vol = function (id, bus) {
      const el = $(id);
      if (!el) return;
      el.oninput = function () { self.game.audio.setVolume(bus, +this.value); };
    };
    vol('set-vol-master', 'master');
    vol('set-vol-music', 'music');
    vol('set-vol-amb', 'ambient');
    vol('set-vol-sfx', 'sfx');
    if ($('set-sound')) $('set-sound').onchange = function () { self.game.audio.setEnabled(this.checked); };

    // collapsible key-hint drawer
    const wrap = $('keyhints-wrap');
    $('keyhints-toggle').onclick = function () {
      wrap.classList.toggle('closed');
      try { localStorage.setItem('mz_hints', wrap.classList.contains('closed') ? '0' : '1'); } catch (e) { }
      self.game.audio.click();
    };
    try { if (localStorage.getItem('mz_hints') === '0') wrap.classList.add('closed'); } catch (e) { }

    this._initMap();

    // hotbar slots
    this.buildHotbar();
  };

  /* =========================================================
     HOTBAR
     ========================================================= */
  UI.prototype.buildHotbar = function () {
    const self = this;
    const bar = this.el.hotbar;
    bar.innerHTML = '';
    this.slots = [];
    const tools = [];
    for (const k in C.TOOLS) tools.push(C.TOOLS[k]);
    tools.sort((a, b) => a.slot - b.slot);
    tools.forEach(function (t, i) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.innerHTML = '<span class="k">' + (i + 1) + '</span><span class="ic">' + t.icon +
        '</span><span class="lv"></span><span class="cnt"></span>';
      d.onclick = function () { self.select(i); };
      bar.appendChild(d);
      self.slots.push({ el: d, tool: t, ic: d.querySelector('.ic'), lv: d.querySelector('.lv'), cnt: d.querySelector('.cnt') });
    });
    this.select(0);
  };

  UI.prototype.select = function (i) {
    if (i < 0 || i >= this.slots.length) return;
    this.selected = i;
    for (let k = 0; k < this.slots.length; k++) this.slots[k].el.classList.toggle('sel', k === i);
    this.game.player.equip(this.currentTool());
    this.dirtyHot = true;
  };
  UI.prototype.currentTool = function () {
    const s = this.slots[this.selected];
    return s ? s.tool.id : null;
  };
  UI.prototype.swingSlot = function () {
    const s = this.slots[this.selected];
    if (!s) return;
    s.el.classList.remove('swing');
    void s.el.offsetWidth;
    s.el.classList.add('swing');
  };

  UI.prototype.refreshHotbar = function () {
    const g = this.game, prog = g.progress, inv = g.inv;
    for (const s of this.slots) {
      const id = s.tool.id;
      if (id === 'seeds') {
        const sid = inv.selectedSeed;
        const cnt = inv.count(sid);
        let icon = '🌱';
        for (const cid in C.CROPS) if (C.CROPS[cid].seed === sid) icon = C.CROPS[cid].icon;
        s.ic.textContent = icon;
        s.cnt.textContent = cnt ? U.fa(cnt) : '';
        s.lv.textContent = '';
        s.el.classList.toggle('empty', !cnt);
      } else if (id === 'food') {
        const fid = inv.selectedFood;
        const cnt = inv.count(fid);
        s.ic.textContent = C.ITEMS[fid] ? C.ITEMS[fid].icon : '🍖';
        s.cnt.textContent = cnt ? U.fa(cnt) : '';
        s.lv.textContent = '';
        s.el.classList.toggle('empty', !cnt);
      } else {
        const lv = prog.toolLevel(id);
        s.ic.textContent = s.tool.icon;
        s.lv.textContent = lv ? U.fa(lv) : '';
        s.el.classList.toggle('empty', !lv);
        s.cnt.textContent = id === 'can' ? (inv.water ? '💧' + U.fa(inv.water) : '') : '';
      }
    }
    this.dirtyHot = false;
  };

  /* =========================================================
     HUD
     ========================================================= */
  UI.prototype.update = function (dt) {
    const g = this.game, p = g.player, prog = g.progress, e = this.el;

    e.hp.style.width = (p.hp / p.maxHp * 100) + '%';
    e.thp.textContent = U.fa(Math.ceil(p.hp)) + '/' + U.fa(Math.round(p.maxHp));
    e.st.style.width = (p.stamina / p.maxStamina * 100) + '%';
    e.tst.textContent = 'توان ' + U.fa(Math.round(p.stamina)) + ' · انرژی ' + U.fa(Math.round(p.energy));
    const need = C.playerXpNeeded(prog.level);
    e.xp.style.width = (prog.xp / need * 100) + '%';
    e.txp.textContent = 'XP ' + U.fa(Math.floor(prog.xp)) + '/' + U.fa(need);
    e.level.textContent = U.fa(prog.level);

    const t = g.time;
    const h = Math.floor(t.hours), m = Math.floor((t.hours - h) * 60);
    e.time.textContent = U.faTime(h, m);
    e.phase.textContent = g.sky.phaseIcon();
    e.day.textContent = 'روز ' + U.fa(t.day);
    const s = C.SEASONS[t.season];
    e.season.textContent = s.icon + ' ' + s.name;
    const w = C.WEATHER[g.sky.weather];
    e.weather.textContent = w.icon + ' ' + w.name;
    const tier = C.TIERS[prog.tier];
    e.tier.textContent = tier.icon + ' ' + tier.name;
    e.pop.textContent = U.fa(prog.population) + (g.settlers ? '/' + U.fa(g.settlers.housing()) : '');
    e.happy.textContent = U.fa(prog.happiness) + '٪';

    if (this.dirtyRes) this.renderRes();
    if (this.dirtyHot) this.refreshHotbar();

    this._quest();
    this._target();
    this._floaters(dt);

    this._mmT -= dt;
    if (this._mmT <= 0) {
      this._mmT = 0.35;
      this.drawMinimap();
    }
    if (this.map && this.map.open) this.drawMap();
  };

  const RES_SHOW = ['wood', 'stone', 'coal', 'iron_ore', 'iron', 'gold_ore', 'gem', 'fiber', 'plank', 'brick'];
  UI.prototype.renderRes = function () {
    const inv = this.game.inv;
    let html = '<div class="res"><span class="ic">💰</span><b>' + U.short(inv.coins) + '</b></div>';
    for (const id of RES_SHOW) {
      const n = inv.count(id);
      if (!n) continue;
      html += '<div class="res"><span class="ic">' + C.ITEMS[id].icon + '</span><b>' + U.short(n) + '</b></div>';
    }
    const cap = inv.capacity(), used = inv.used();
    html += '<div class="res" style="width:100%;opacity:.75"><span class="ic">📦</span><b>' +
      U.fa(used) + '/' + U.fa(cap) + '</b></div>';
    this.el.res.innerHTML = html;
    this.dirtyRes = false;
  };

  UI.prototype._quest = function () {
    const prog = this.game.progress;
    const q = prog.currentQuest();
    if (!q) {
      this.el.qtName.textContent = 'همه مأموریت‌ها تمام شد 🏆';
      this.el.qtDesc.textContent = 'حالا آزادانه شهرت را بزرگ‌تر کن';
      this.el.qtFill.style.width = '100%';
      return;
    }
    const st = prog.questState(q);
    this.el.qtName.textContent = q.name;
    this.el.qtDesc.textContent = q.desc + ' (' + U.fa(st.cur) + '/' + U.fa(st.need) + ')';
    this.el.qtFill.style.width = (st.pct * 100) + '%';
  };

  UI.prototype._target = function () {
    const g = this.game;
    const t = g.gather.target;
    const info = g.gather.describe(t);
    const showable = info && t && !(t.kind === 'ground');
    if (!showable || g.building.placing) {
      this.el.ti.classList.add('hidden');
      this.el.cross.classList.remove('active');
      return;
    }
    this.el.ti.classList.remove('hidden');
    this.el.cross.classList.toggle('active', !t.tooFar);
    this.el.tiName.textContent = info.name;
    this.el.tiHint.textContent = t.tooFar ? 'خیلی دور است — نزدیک‌تر برو' : info.hint;
    if (info.hp !== undefined) {
      this.el.tiBar.parentElement.style.display = '';
      this.el.tiBar.style.width = (U.clamp01(info.hp) * 100) + '%';
    } else this.el.tiBar.parentElement.style.display = 'none';
  };

  /* =========================================================
     MINIMAP
     ========================================================= */
  UI.prototype.drawMinimap = function () {
    const g = this.game, ctx = this.mmCtx;
    const size = this.el.mm.width;
    const p = g.player.pos;
    const range = 150;                       // world units across the map
    const px = size / range;

    // terrain is only re-sampled when the player has moved a bit
    if (!this._mmBuf || U.dist2(p.x, p.z, this._mmX, this._mmZ) > 144) {
      this._mmX = p.x; this._mmZ = p.z;
      const N = 38, step = range / N;
      if (!this._mmBuf) this._mmBuf = document.createElement('canvas');
      this._mmBuf.width = N; this._mmBuf.height = N;
      const b = this._mmBuf.getContext('2d');
      for (let iz = 0; iz < N; iz++) {
        for (let ix = 0; ix < N; ix++) {
          const wx = p.x + (ix - N / 2) * step;
          const wz = p.z + (iz - N / 2) * step;
          const h = g.world.heightAt(wx, wz);
          const bio = C.BIOMES[g.world.biomeAt(wx, wz, h)];
          let col = bio.c1;
          if (h < C.WORLD.waterLevel) col = h < -3 ? 0x1c4f6e : 0x2e7fa8;
          const shade = U.clamp(0.72 + h * 0.008, 0.55, 1.25);
          const r = ((col >> 16) & 255) * shade, gg = ((col >> 8) & 255) * shade, bb = (col & 255) * shade;
          b.fillStyle = 'rgb(' + (r | 0) + ',' + (gg | 0) + ',' + (bb | 0) + ')';
          b.fillRect(ix, iz, 1, 1);
        }
      }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, 6.283);
    ctx.clip();
    // offset the cached terrain by how far the player moved since sampling
    const offX = (p.x - this._mmX) * px, offZ = (p.z - this._mmZ) * px;
    ctx.drawImage(this._mmBuf, -offX, -offZ, size, size);

    const toX = (wx) => size / 2 + (wx - p.x) * px;
    const toZ = (wz) => size / 2 + (wz - p.z) * px;

    // farm plots
    ctx.fillStyle = '#6b4d31';
    g.farming.plots.forEach(function (pl) {
      const x = toX(pl.x), z = toZ(pl.z);
      if (x < 0 || z < 0 || x > size || z > size) return;
      ctx.fillRect(x - 1.5, z - 1.5, 3, 3);
      if (pl.crop && pl.stage >= 3) { ctx.fillStyle = '#ffd15c'; ctx.fillRect(x - 1, z - 1, 2, 2); ctx.fillStyle = '#6b4d31'; }
    });
    // buildings
    for (const b of g.building.list) {
      const x = toX(b.x), z = toZ(b.z);
      if (x < -4 || z < -4 || x > size + 4 || z > size + 4) continue;
      ctx.fillStyle = b.def.cat === 'def' ? '#d0743a' : b.def.cat === 'home' ? '#e8d9a0' : '#a8d8f0';
      const w = Math.max(2.5, b.w * px), d = Math.max(2.5, b.d * px);
      ctx.fillRect(x - w / 2, z - d / 2, w, d);
    }
    // animals
    for (const a of g.wildlife.animals) {
      const x = toX(a.x), z = toZ(a.z);
      if (x < 0 || z < 0 || x > size || z > size) continue;
      ctx.fillStyle = (a.def.hostile || a.angry) ? '#ff5a5a' : '#9fe08a';
      ctx.fillRect(x - 1.5, z - 1.5, 3, 3);
    }
    // waypoints
    for (const mk of g.markers) {
      const x = toX(mk.x), z = toZ(mk.z);
      const inside = x >= 4 && z >= 4 && x <= size - 4 && z <= size - 4;
      const dx = x - size / 2, dz = z - size / 2;
      const l = Math.hypot(dx, dz) || 1;
      const ex = inside ? x : size / 2 + (dx / l) * (size / 2 - 8);
      const ez = inside ? z : size / 2 + (dz / l) * (size / 2 - 8);
      ctx.fillStyle = '#ffd15c';
      ctx.strokeStyle = '#3a2600';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ex, ez, inside ? 3.5 : 3, 0, 6.283);
      ctx.fill(); ctx.stroke();
    }

    // player arrow
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-g.player.yaw + Math.PI);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();

    // compass ring
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 1, 0, 6.283); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', size / 2, 12);

    const wp = this.nearestMarker();
    this.el.mmc.textContent = Math.round(p.x) + ' , ' + Math.round(p.z) +
      (wp ? '   📍 ' + Math.round(wp.dist) + 'م' : '');
  };

  /* =========================================================
     WORLD MAP — pan, zoom and waypoints
     ========================================================= */
  UI.prototype._initMap = function () {
    const self = this, g = this.game;
    const cv = $('wm-canvas');
    this.map = {
      el: $('worldmap'), cv: cv, ctx: cv.getContext('2d'),
      cx: 0, cz: 0,               // world point at the centre of the view
      scale: 1.6,                 // pixels per world unit
      open: false, dirty: true,
      drag: null, buf: null, bufKey: ''
    };
    const m = this.map;

    const worldAt = (ev) => {
      const r = cv.getBoundingClientRect();
      return {
        x: m.cx + (ev.clientX - r.left - r.width / 2) / m.scale,
        z: m.cz + (ev.clientY - r.top - r.height / 2) / m.scale
      };
    };
    this._mapWorldAt = worldAt;

    cv.addEventListener('mousedown', function (ev) {
      if (ev.button === 2) {                       // right click removes a marker
        const w = worldAt(ev);
        self.removeMarkerNear(w.x, w.z, 14 / m.scale);
        ev.preventDefault();
        return;
      }
      m.drag = { x: ev.clientX, y: ev.clientY, cx: m.cx, cz: m.cz, moved: 0 };
      cv.classList.add('dragging');
    });
    addEventListener('mousemove', function (ev) {
      if (!m.drag) return;
      const dx = ev.clientX - m.drag.x, dy = ev.clientY - m.drag.y;
      m.drag.moved = Math.max(m.drag.moved, Math.hypot(dx, dy));
      m.cx = m.drag.cx - dx / m.scale;
      m.cz = m.drag.cz - dy / m.scale;
      m.dirty = true;
    });
    addEventListener('mouseup', function (ev) {
      if (!m.drag) return;
      const moved = m.drag.moved;
      m.drag = null;
      cv.classList.remove('dragging');
      if (moved < 4 && m.open && ev.target === cv) {     // a click, not a pan
        const w = worldAt(ev);
        self.addMarker(w.x, w.z);
      }
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', function (ev) {
      const before = worldAt(ev);
      m.scale = U.clamp(m.scale * (ev.deltaY < 0 ? 1.22 : 1 / 1.22), 0.09, 14);
      const after = worldAt(ev);
      m.cx += before.x - after.x;                   // zoom toward the cursor
      m.cz += before.z - after.z;
      m.dirty = true;
      ev.preventDefault();
    }, { passive: false });

    cv.addEventListener('mousemove', function (ev) {
      if (m.drag) return;
      const w = worldAt(ev);
      const h = g.world.heightAt(w.x, w.z);
      const b = C.BIOMES[g.world.biomeAt(w.x, w.z, h)];
      $('wm-info').textContent = Math.round(w.x) + ' , ' + Math.round(w.z) +
        '  ·  ' + b.name + '  ·  ارتفاع ' + Math.round(h);
    });

    $('wm-close').onclick = () => self.closeMap();
    $('wm-center').onclick = function () {
      m.cx = g.player.pos.x; m.cz = g.player.pos.z; m.dirty = true;
    };
    $('wm-home').onclick = function () {
      const b = g.building;
      m.cx = b.list.length ? b.centerX : 0;
      m.cz = b.list.length ? b.centerZ : 0;
      m.dirty = true;
    };
    $('wm-zin').onclick = function () { m.scale = U.clamp(m.scale * 1.35, 0.09, 14); m.dirty = true; };
    $('wm-zout').onclick = function () { m.scale = U.clamp(m.scale / 1.35, 0.09, 14); m.dirty = true; };
    $('wm-clear').onclick = function () {
      g.markers.length = 0;
      self.toast('🗑️ همهٔ نشان‌ها پاک شد', 'good');
      m.dirty = true;
    };
    // clicking the minimap opens the big map
    $('minimap-wrap').onclick = () => self.openMap();
  };

  UI.prototype.openMap = function () {
    const m = this.map, g = this.game;
    if (m.open) return;
    this.closePanel(true);
    m.open = true;
    m.cx = g.player.pos.x; m.cz = g.player.pos.z;
    m.dirty = true;
    m.el.classList.remove('hidden');
    G.Input.enabled = false;
    G.Input.unlock();
    this._resizeMap();
    g.audio.click();
  };

  UI.prototype.closeMap = function () {
    const m = this.map;
    if (!m.open) return;
    m.open = false;
    m.el.classList.add('hidden');
    G.Input.enabled = true;
    if (this.game.started) G.Input.lock();
  };

  UI.prototype.toggleMap = function () {
    if (this.map.open) this.closeMap(); else this.openMap();
  };

  UI.prototype._resizeMap = function () {
    const m = this.map;
    const r = m.cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.round(r.width)), h = Math.max(64, Math.round(r.height));
    if (m.cv.width !== w * dpr || m.cv.height !== h * dpr) {
      m.cv.width = w * dpr; m.cv.height = h * dpr;
      m.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      m.dirty = true;
    }
    m.w = w; m.h = h;
  };

  /* markers ------------------------------------------------ */
  UI.prototype.addMarker = function (x, z) {
    const g = this.game;
    if (g.markers.length >= 24) g.markers.shift();
    g.markers.push({ x: x, z: z, n: ++g.markerSeq });
    this.map.dirty = true;
    g.audio.coin();
    this.toast('📍 نشان ' + U.fa(g.markerSeq) + ' گذاشته شد', 'good');
  };
  UI.prototype.removeMarkerNear = function (x, z, radius) {
    const g = this.game;
    for (let i = g.markers.length - 1; i >= 0; i--) {
      if (U.dist(x, z, g.markers[i].x, g.markers[i].z) <= radius) {
        g.markers.splice(i, 1);
        this.map.dirty = true;
        g.audio.click();
        return true;
      }
    }
    return false;
  };
  UI.prototype.nearestMarker = function () {
    const g = this.game, p = g.player.pos;
    let best = null, bd = 1e18;
    for (const mk of g.markers) {
      const d = U.dist2(p.x, p.z, mk.x, mk.z);
      if (d < bd) { bd = d; best = mk; }
    }
    return best ? { m: best, dist: Math.sqrt(bd) } : null;
  };

  /* drawing ------------------------------------------------ */
  UI.prototype.drawMap = function () {
    const m = this.map, g = this.game;
    if (!m.open) return;
    this._resizeMap();
    const ctx = m.ctx, W = m.w, H = m.h;

    /* terrain layer is expensive, so re-sample only when the view changed */
    const key = Math.round(m.cx) + ':' + Math.round(m.cz) + ':' + m.scale.toFixed(3) + ':' + W + 'x' + H;
    if (m.dirty || key !== m.bufKey) {
      m.bufKey = key;
      m.dirty = false;
      const N = 190;                                  // sample grid width
      const NH = Math.max(24, Math.round(N * H / W));
      if (!m.buf) m.buf = document.createElement('canvas');
      m.buf.width = N; m.buf.height = NH;
      const b = m.buf.getContext('2d');
      const img = b.createImageData(N, NH);
      const d = img.data;
      const stepX = (W / m.scale) / N, stepZ = (H / m.scale) / NH;
      const x0 = m.cx - (W / m.scale) / 2, z0 = m.cz - (H / m.scale) / 2;
      for (let iz = 0; iz < NH; iz++) {
        for (let ix = 0; ix < N; ix++) {
          const wx = x0 + ix * stepX, wz = z0 + iz * stepZ;
          const h = g.world.heightAt(wx, wz);
          let col;
          if (h < C.WORLD.waterLevel) {
            col = h < -6 ? 0x16405c : h < -2 ? 0x1f5b7d : 0x2e7fa8;
          } else {
            col = C.BIOMES[g.world.biomeAt(wx, wz, h)].c1;
          }
          // shade by slope so ridges and valleys read
          const hx = g.world.heightAt(wx + stepX, wz);
          const sh = U.clamp(0.82 + (h - hx) * 0.12, 0.5, 1.35);
          const o = (iz * N + ix) * 4;
          d[o] = Math.min(255, ((col >> 16) & 255) * sh);
          d[o + 1] = Math.min(255, ((col >> 8) & 255) * sh);
          d[o + 2] = Math.min(255, (col & 255) * sh);
          d[o + 3] = 255;
        }
      }
      b.putImageData(img, 0, 0);
    }

    ctx.imageSmoothingEnabled = m.scale < 3;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(m.buf, 0, 0, W, H);

    const toX = (wx) => W / 2 + (wx - m.cx) * m.scale;
    const toZ = (wz) => H / 2 + (wz - m.cz) * m.scale;

    /* grid every 100 units so distances are readable */
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    const grid = m.scale > 2 ? 50 : m.scale > 0.6 ? 100 : m.scale > 0.25 ? 250 : 1000;
    const gx0 = Math.ceil((m.cx - W / m.scale / 2) / grid) * grid;
    for (let gx = gx0; gx < m.cx + W / m.scale / 2; gx += grid) {
      const px = toX(gx);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      ctx.fillText(gx, px + 3, 12);
    }
    const gz0 = Math.ceil((m.cz - H / m.scale / 2) / grid) * grid;
    for (let gz = gz0; gz < m.cz + H / m.scale / 2; gz += grid) {
      const pz = toZ(gz);
      ctx.beginPath(); ctx.moveTo(0, pz); ctx.lineTo(W, pz); ctx.stroke();
      ctx.fillText(gz, 3, pz - 3);
    }

    /* farm plots */
    const ps = Math.max(1.5, C.WORLD.gridSize * m.scale);
    g.farming.plots.forEach(function (pl) {
      const x = toX(pl.x), z = toZ(pl.z);
      if (x < -8 || z < -8 || x > W + 8 || z > H + 8) return;
      ctx.fillStyle = pl.crop && pl.stage >= 3 ? '#ffd15c' : '#6b4d31';
      ctx.fillRect(x - ps / 2, z - ps / 2, ps, ps);
    });

    /* buildings */
    for (const b of g.building.list) {
      const x = toX(b.x), z = toZ(b.z);
      if (x < -20 || z < -20 || x > W + 20 || z > H + 20) continue;
      ctx.fillStyle = b.def.cat === 'def' ? '#d0743a' : b.def.cat === 'home' ? '#e8d9a0'
        : b.def.cat === 'farm' ? '#8fbf5c' : '#a8d8f0';
      const w = Math.max(3, b.w * m.scale), d2 = Math.max(3, b.d * m.scale);
      ctx.fillRect(x - w / 2, z - d2 / 2, w, d2);
      if (m.scale > 2.2) {
        ctx.fillStyle = 'rgba(0,0,0,.75)';
        ctx.font = '11px sans-serif';
        ctx.fillText(b.def.icon, x - 6, z + 4);
      }
    }

    /* vehicles */
    for (const v of g.vehicles.list) {
      const x = toX(v.x), z = toZ(v.z);
      if (x < 0 || z < 0 || x > W || z > H) continue;
      ctx.font = '15px sans-serif';
      ctx.fillText(v.def.icon, x - 8, z + 5);
    }

    /* animals */
    for (const a of g.wildlife.animals) {
      const x = toX(a.x), z = toZ(a.z);
      if (x < 0 || z < 0 || x > W || z > H) continue;
      ctx.fillStyle = (a.def.hostile || a.angry) ? '#ff5a5a' : '#9fe08a';
      ctx.beginPath(); ctx.arc(x, z, 3, 0, 6.283); ctx.fill();
    }

    /* riders out on expedition */
    for (const r of g.settlers.riders) {
      if (r.state === 'idle' || r.state === 'away') continue;
      const x = toX(r.x), z = toZ(r.z);
      ctx.font = '15px sans-serif';
      ctx.fillText('🏇', x - 8, z + 5);
    }

    /* waypoints */
    for (const mk of g.markers) {
      const x = toX(mk.x), z = toZ(mk.z);
      if (x < -20 || z < -20 || x > W + 20 || z > H + 20) continue;
      ctx.fillStyle = '#ffd15c';
      ctx.strokeStyle = '#3a2600';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, z);
      ctx.lineTo(x - 6, z - 14);
      ctx.lineTo(x + 6, z - 14);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, z - 15, 6, 0, 6.283); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3a2600';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(mk.n, x, z - 12);
      ctx.textAlign = 'start';
    }

    /* the player */
    const px = toX(g.player.pos.x), pz = toZ(g.player.pos.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-g.player.yaw + Math.PI);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  };

  /* =========================================================
     TOASTS / FLOATERS
     ========================================================= */
  UI.prototype.toast = function (msg, kind) {
    if (this._toastN > 6) return;
    const d = document.createElement('div');
    d.className = 'toast' + (kind ? ' ' + kind : '');
    d.textContent = msg;
    this.el.toasts.appendChild(d);
    this._toastN++;
    const self = this;
    setTimeout(function () {
      d.classList.add('out');
      setTimeout(function () { d.remove(); self._toastN--; }, 320);
    }, 2600);
  };

  UI.prototype.warnFull = function () {
    const t = U.now();
    if (t - this._lastFull < 4000) return;
    this._lastFull = t;
    this.toast('📦 انبار پر است! بفروش یا انبار بساز', 'bad');
  };

  UI.prototype.levelUp = function (text) {
    this.el.luText.textContent = text;
    this.el.lvlup.classList.remove('hidden');
    const el = this.el.lvlup.firstElementChild;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this._luT);
    const self = this;
    this._luT = setTimeout(function () { self.el.lvlup.classList.add('hidden'); }, 2000);
  };

  UI.prototype.hurt = function () {
    this.el.dmg.classList.remove('on');
    void this.el.dmg.offsetWidth;
    this.el.dmg.classList.add('on');
  };

  /** floating damage / gain number anchored to a world object */
  UI.prototype.damageNumber = function (obj, n, yoff) {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;z-index:22;font-weight:800;font-size:15px;color:#ffd15c;' +
      'text-shadow:0 2px 6px #000;pointer-events:none;transform:translate(-50%,-50%)';
    d.textContent = '-' + U.fa(n);
    document.getElementById('app').appendChild(d);
    this.floaters.push({
      el: d, t: 0.9,
      x: obj.position.x, y: obj.position.y + (yoff || 1.2), z: obj.position.z
    });
  };

  const _v = new THREE.Vector3();
  UI.prototype._floaters = function (dt) {
    const cam = this.game.camera;
    const w = innerWidth, h = innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t -= dt;
      if (f.t <= 0) { f.el.remove(); U.swapRemove(this.floaters, i); continue; }
      _v.set(f.x, f.y + (0.9 - f.t) * 1.6, f.z);
      _v.project(cam);
      if (_v.z > 1) { f.el.style.display = 'none'; continue; }
      f.el.style.display = '';
      f.el.style.left = ((_v.x * 0.5 + 0.5) * w) + 'px';
      f.el.style.top = ((-_v.y * 0.5 + 0.5) * h) + 'px';
      f.el.style.opacity = U.clamp01(f.t * 1.6);
    }
  };

  /* =========================================================
     BUILD BAR & FISHING
     ========================================================= */
  UI.prototype.showBuildBar = function (def) {
    this.el.buildbar.classList.remove('hidden');
    this.el.bbTitle.textContent = def.icon + ' ' + def.name;
  };
  UI.prototype.updateBuildBar = function (def, res) {
    const inv = this.game.inv;
    const cost = def.cost(1);
    let html = '';
    for (const k in cost) {
      const have = k === 'coin' ? inv.coins : inv.count(k);
      const ok = have >= cost[k];
      const icon = k === 'coin' ? '💰' : (C.ITEMS[k] ? C.ITEMS[k].icon : '');
      html += '<span class="' + (ok ? 'ok' : 'no') + '">' + icon + ' ' + U.fa(have) + '/' + U.fa(cost[k]) + '</span>';
    }
    this.el.bbCost.innerHTML = html;
    if (res && !res.ok) {
      this.el.bbWarn.textContent = res.why;
      this.el.bbWarn.classList.remove('hidden');
    } else this.el.bbWarn.classList.add('hidden');
  };
  UI.prototype.hideBuildBar = function () { this.el.buildbar.classList.add('hidden'); };

  UI.prototype.showFishing = function (f) {
    this.el.fishing.classList.remove('hidden');
    this.updateFishing(f);
  };
  UI.prototype.updateFishing = function (f) {
    this.el.fZone.style.left = (f.zoneA * 100) + '%';
    this.el.fZone.style.width = (f.zoneW * 100) + '%';
    this.el.fMarker.style.left = 'calc(' + (f.pos * 100) + '% - 2px)';
    this.el.fMarker.style.opacity = f.biting ? '1' : '0.25';
    this.el.fTries.textContent = U.fa(f.tries);
  };
  UI.prototype.hideFishing = function () { this.el.fishing.classList.add('hidden'); };

  /* =========================================================
     PANELS
     ========================================================= */
  UI.prototype.anyPanelOpen = function () { return !!this.panelOpen; };

  UI.prototype.openPanel = function (id) {
    if (this.panelOpen === id) { this.closePanel(); return; }
    this.closePanel(true);
    const el = $('panel-' + id);
    if (!el) return;
    this.panelOpen = id;
    this.el.panels.classList.remove('hidden');
    el.classList.remove('hidden');
    G.Input.enabled = false;
    G.Input.unlock();
    switch (id) {
      case 'inventory': this.renderInventory(); break;
      case 'build': this.renderBuild(); break;
      case 'market': this.renderMarket(); break;
      case 'skills': this.renderSkills(); break;
      case 'quests': this.renderQuests(); break;
      case 'people': this.renderPeople(); break;
      case 'jobs': this.renderJobs(); break;
      case 'structure': this.renderStructure(); break;
    }
    if (this.game.audio) this.game.audio.click();
  };

  UI.prototype.closePanel = function (silent) {
    if (this.panelOpen) {
      const el = $('panel-' + this.panelOpen);
      if (el) el.classList.add('hidden');
    }
    this.panelOpen = null;
    this.el.panels.classList.add('hidden');
    if (!silent) {
      G.Input.enabled = true;
      if (this.game.started) G.Input.lock();
    }
  };

  /* ---------------- inventory ---------------- */
  UI.prototype.renderInventory = function () {
    const g = this.game, inv = g.inv, self = this;
    $('inv-cap').textContent = U.fa(inv.used()) + '/' + U.fa(inv.capacity());
    $('inv-coins').textContent = U.fa(inv.coins);
    const grid = $('inv-grid');
    grid.innerHTML = '';
    const rows = inv.list();
    if (!rows.length) grid.innerHTML = '<div style="color:var(--muted);font-size:12px">کوله‌ات خالی است</div>';
    for (const row of rows) {
      const d = document.createElement('div');
      d.className = 'icell' + (this.invSel === row.id ? ' sel' : '');
      d.innerHTML = row.def.icon + '<span class="n">' + U.fa(row.n) + '</span>';
      d.title = row.def.name;
      d.onclick = function () { self.invSel = row.id; self.renderInventory(); };
      grid.appendChild(d);
    }
    this.renderInvDetail();
  };

  UI.prototype.renderInvDetail = function () {
    const g = this.game, self = this;
    const box = $('inv-detail');
    const id = this.invSel;
    if (!id || !g.inv.count(id)) { box.innerHTML = 'یک آیتم را انتخاب کن'; return; }
    const it = C.ITEMS[id];
    const price = g.economy.sellPrice(id);
    let html = '<b>' + it.icon + ' ' + it.name + '</b> × ' + U.fa(g.inv.count(id)) +
      '<br>' + (it.desc || '') + '<br>ارزش فروش: 💰 ' + U.fa(price) + ' هر واحد';
    html += '<div class="row" id="inv-actions"></div>';
    box.innerHTML = html;
    const act = $('inv-actions');
    const mk = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (cls || '');
      b.textContent = label;
      b.onclick = fn;
      act.appendChild(b);
    };
    mk('فروش ۱', 'gold', function () { g.economy.sell(id, 1); self.renderInventory(); });
    mk('فروش همه', 'gold', function () { g.economy.sell(id, g.inv.count(id)); self.invSel = null; self.renderInventory(); });
    if (C.FOOD[id]) mk('خوردن', 'primary', function () {
      g.inv.selectedFood = id; g.gather.eat(); self.renderInventory(); self.dirtyHot = true;
    });
    if (it.cat === 'seed') mk('انتخاب برای کاشت', 'primary', function () {
      g.inv.selectedSeed = id; self.dirtyHot = true; self.toast('🌱 ' + it.name + ' انتخاب شد', 'good');
    });
  };

  /* ---------------- build ---------------- */
  UI.prototype.renderBuild = function () {
    const g = this.game, self = this;
    const grid = $('build-grid');
    grid.innerHTML = '';
    for (const id in C.BUILDINGS) {
      const def = C.BUILDINGS[id];
      if (def.cat !== this.buildCat) continue;
      const unlock = g.building.canUnlock(id);
      const cost = def.cost(1);
      const afford = g.inv.canAfford(cost);
      const d = document.createElement('div');
      d.className = 'card' + (unlock.ok ? '' : ' locked');
      let costHtml = '';
      for (const k in cost) {
        const have = k === 'coin' ? g.inv.coins : g.inv.count(k);
        const icon = k === 'coin' ? '💰' : (C.ITEMS[k] ? C.ITEMS[k].icon : k);
        costHtml += '<span class="' + (have >= cost[k] ? '' : 'no') + '">' + icon + ' ' + U.fa(cost[k]) + '</span>';
      }
      const built = g.building.countOf(id);
      d.innerHTML = '<div class="ci">' + def.icon + '</div><div class="cn">' + def.name +
        (built ? ' <span style="color:var(--muted);font-size:11px">×' + U.fa(built) + '</span>' : '') +
        '</div><div class="cd">' + def.desc + '</div><div class="cc">' + costHtml + '</div>' +
        (unlock.ok ? '' : '<div class="lock">🔒 ' + unlock.why + '</div>');
      if (unlock.ok) {
        d.onclick = function () {
          if (!afford) { self.toast('⚠️ منابع کافی نداری', 'bad'); return; }
          self.closePanel();
          g.building.start(id);
        };
      }
      grid.appendChild(d);
    }
  };

  /* ---------------- market ---------------- */
  UI.prototype.renderMarket = function () {
    const g = this.game, self = this;
    $('mk-coins').textContent = U.fa(g.inv.coins);
    const list = $('market-list');
    list.innerHTML = '';

    const row = function (id, price, locked, qty, onBuy) {
      const it = C.ITEMS[id];
      const tr = g.economy.trend(id);
      const d = document.createElement('div');
      d.className = 'mrow';
      d.innerHTML = '<span class="mi">' + it.icon + '</span>' +
        '<span class="mn">' + it.name + '<small>' + (locked ? '🔒 کشاورزی سطح ' + U.fa(locked) : (it.desc || it.cat)) + '</small></span>' +
        '<span class="trend ' + (tr > 0 ? 'up' : tr < 0 ? 'down' : '') + '">' + (tr > 0 ? '▲' : tr < 0 ? '▼' : '—') + '</span>' +
        '<span class="mp">💰 ' + U.fa(price) + (qty !== undefined ? ' × ' + U.fa(qty) : '') + '</span>';
      const btns = document.createElement('span');
      btns.className = 'mbtns';
      d.appendChild(btns);
      onBuy(btns, d);
      list.appendChild(d);
    };

    if (this.marketMode === 'sell') {
      const rows = g.inv.list();
      if (!rows.length) { list.innerHTML = '<div style="color:var(--muted);font-size:12.5px">چیزی برای فروش نداری</div>'; return; }
      const all = document.createElement('button');
      all.className = 'btn gold';
      all.style.marginBottom = '8px';
      all.textContent = '💰 فروش همه محصولات، ماهی و دام';
      all.onclick = function () { g.economy.sellAll(['crop', 'fish', 'animal', 'food']); self.renderMarket(); };
      list.appendChild(all);
      for (const r of rows) {
        row(r.id, g.economy.sellPrice(r.id), 0, r.n, function (btns) {
          [1, 10].forEach(function (n) {
            const b = document.createElement('button');
            b.textContent = 'فروش ' + U.fa(n);
            b.disabled = g.inv.count(r.id) < n;
            b.onclick = function () { g.economy.sell(r.id, n); self.renderMarket(); };
            btns.appendChild(b);
          });
          const ba = document.createElement('button');
          ba.textContent = 'همه';
          ba.onclick = function () { g.economy.sell(r.id, g.inv.count(r.id)); self.renderMarket(); };
          btns.appendChild(ba);
        });
      }
    } else {
      for (const e of g.economy.buyable()) {
        row(e.id, g.economy.buyPrice(e.id), e.locked, undefined, function (btns) {
          [1, 5, 10].forEach(function (n) {
            const b = document.createElement('button');
            b.textContent = '+' + U.fa(n);
            b.disabled = !!e.locked || g.inv.coins < g.economy.buyPrice(e.id) * n;
            b.onclick = function () { g.economy.buy(e.id, n); self.renderMarket(); };
            btns.appendChild(b);
          });
        });
      }
    }
  };

  /* ---------------- skills & tools ---------------- */
  UI.prototype.renderSkills = function () {
    const g = this.game, prog = g.progress, self = this;
    const list = $('skill-list');
    list.innerHTML = '';
    for (const s of C.SKILLS) {
      const p = prog.skillProgress(s.id);
      const d = document.createElement('div');
      d.className = 'skill';
      d.innerHTML = '<span class="si">' + s.icon + '</span>' +
        '<span class="sn"><b>' + s.name + '</b><small> — ' + s.desc + '</small>' +
        '<span class="sbar"><i style="width:' + (p.pct * 100) + '%"></i></span></span>' +
        '<span class="sl">' + U.fa(prog.skill(s.id).level) + '</span>';
      list.appendChild(d);
    }

    const tl = $('tool-list');
    tl.innerHTML = '';
    const workshop = g.building.maxLevelOf('workshop');
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11.5px;color:var(--muted);margin-bottom:10px';
    note.textContent = workshop ? 'کارگاه سطح ' + U.fa(workshop) + ' — سقف ارتقای ابزار: سطح ' + U.fa(workshop + 1)
      : 'برای ارتقای ابزار اول یک کارگاه بساز.';
    tl.appendChild(note);

    for (const id in C.TOOLS) {
      const def = C.TOOLS[id];
      if (def.max <= 1) continue;
      const lvl = prog.toolLevel(id);
      const req = prog.toolRequirement(id);
      const chk = prog.canUpgradeTool(id);
      const d = document.createElement('div');
      d.className = 'tool';
      let pips = '';
      for (let i = 1; i <= def.max; i++) pips += '<span class="pip' + (i <= lvl ? ' on' : '') + '"></span>';
      let costHtml = '';
      if (req.next <= req.max) {
        for (const k in req.cost) {
          const have = k === 'coin' ? g.inv.coins : g.inv.count(k);
          const icon = k === 'coin' ? '💰' : (C.ITEMS[k] ? C.ITEMS[k].icon : k);
          costHtml += '<span style="color:' + (have >= req.cost[k] ? 'inherit' : 'var(--red)') + '">' +
            icon + U.fa(req.cost[k]) + '</span> ';
        }
      }
      d.innerHTML = '<span class="ti">' + def.icon + '</span>' +
        '<span class="tn"><b>' + def.name + '</b> — سطح ' + U.fa(lvl) + '<small>' + def.desc + '</small>' +
        '<span class="pips">' + pips + '</span>' +
        '<small style="margin-top:4px;display:block">' + costHtml + '</small></span>';
      const b = document.createElement('button');
      b.className = 'btn' + (chk.ok ? ' primary' : '');
      b.textContent = req.next > req.max ? 'کامل' : (chk.ok ? 'ارتقا' : chk.why);
      b.disabled = !chk.ok;
      b.onclick = function () { prog.upgradeTool(id); self.renderSkills(); self.dirtyHot = true; };
      d.appendChild(b);
      tl.appendChild(d);
    }
  };

  /* ---------------- quests ---------------- */
  UI.prototype.renderQuests = function () {
    const g = this.game, prog = g.progress;
    const tb = $('tier-box');
    const tier = C.TIERS[prog.tier];
    const tp = prog.tierProgress();
    let html = '<div class="tt">' + tier.icon + ' ' + tier.name + '</div><div class="td">' + tier.desc + '</div>';
    if (tp) {
      html += '<div class="td">برای «' + tp.next.name + '»: 👥 ' + U.fa(tp.have.pop) + '/' + U.fa(tp.next.pop) +
        ' · 🏠 ' + U.fa(tp.have.bld) + '/' + U.fa(tp.next.bld) +
        (tp.next.hall ? ' · 🏛️ سطح ' + U.fa(tp.have.hall) + '/' + U.fa(tp.next.hall) : '') + '</div>' +
        '<div class="tbar"><i style="width:' + (tp.pct * 100) + '%"></i></div>';
    } else html += '<div class="td">به بالاترین سطح رسیدی! 🏆</div>';
    tb.innerHTML = html;

    const list = $('quest-list');
    list.innerHTML = '';
    const from = Math.max(0, prog.questIndex - 2);
    for (let i = from; i < Math.min(C.QUESTS.length, prog.questIndex + 4); i++) {
      const q = C.QUESTS[i];
      const done = i < prog.questIndex;
      const st = prog.questState(q);
      const d = document.createElement('div');
      d.className = 'quest' + (done ? ' done' : '');
      d.innerHTML = '<div class="qh"><span>' + (done ? '✅ ' : (i === prog.questIndex ? '🎯 ' : '🔒 ')) + q.name + '</span>' +
        '<span style="font-size:11px;color:var(--muted)">' + U.fa(done ? q.n : st.cur) + '/' + U.fa(q.n) + '</span></div>' +
        '<div class="qd">' + q.desc + '</div>' +
        '<div class="qb"><i style="width:' + (done ? 100 : st.pct * 100) + '%"></i></div>' +
        '<div class="qr">پاداش: 💰 ' + U.fa(q.coin) + ' · ⭐ ' + U.fa(q.xp) + ' XP</div>';
      list.appendChild(d);
    }
  };

  /* ---------------- job board (council table) ---------------- */
  UI.prototype.renderJobs = function () {
    const g = this.game, self = this, S = g.settlers;
    S.clampJobs();                       // never show more workers than we can staff
    const cap = S.jobCapacity(), used = S.jobsAssigned(), slots = S.jobSlots();

    const cell = (v, l, warn) =>
      '<div class="pop-cell' + (warn ? ' warn' : '') + '"><b>' + v + '</b><span>' + l + '</span></div>';
    $('job-hero').innerHTML =
      cell(U.fa(S.population()), 'اهالی') +
      cell(U.fa(slots), 'ظرفیت میز شورا') +
      cell(U.fa(used) + '/' + U.fa(cap), 'مشغول کار') +
      cell(U.fa(S.freeWorkers()), 'آزاد', S.freeWorkers() === 0 && cap > 0);

    $('job-note').innerHTML = slots > 0
      ? 'هر نفری که سر کار می‌گذاری خودش در دنیا راه می‌افتد و کارش را می‌کند: چوب‌بر می‌رود سراغ درخت، ' +
      'سنگ‌کار سراغ صخره، شکارچی دنبال حیوان، کشاورز محصول رسیده را برداشت می‌کند و نگهبان با کمان ' +
      'از شهر دفاع می‌کند. حاصل کارشان مستقیم به انبار تو اضافه می‌شود.<br>' +
      'ظرفیت = کمترینِ (تعداد اهالی، ظرفیت میز شورا). میز را ارتقا بده تا بیشتر شود.'
      : '🔒 برای وظیفه‌دادن اول یک <b>میز شورا</b> بساز (منوی ساخت‌وساز → دستهٔ شهری). ' +
      'بعد کنار میز برو و کلید <kbd>E</kbd> را بزن.';

    const list = $('job-list');
    list.innerHTML = '';
    for (const j of C.JOBS) {
      if (j.id === 'idle') continue;
      const n = S.jobs[j.id] || 0;
      const d = document.createElement('div');
      d.className = 'job' + (n > 0 ? ' on' : '');
      d.innerHTML = '<span class="ji">' + j.icon + '</span>' +
        '<span class="jn"><b>' + j.name + '</b><small>' + j.desc + '</small></span>' +
        '<span class="jcount">' + U.fa(n) + '</span>';
      const btns = document.createElement('span');
      btns.className = 'jbtns';
      const mk = (label, delta, dis) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.disabled = dis;
        b.onclick = function () { S.addJob(j.id, delta); self.renderJobs(); g.audio.click(); };
        btns.appendChild(b);
      };
      mk('−', -1, n <= 0);
      mk('+', 1, S.freeWorkers() <= 0);
      d.appendChild(btns);
      list.appendChild(d);
    }

    const idle = document.createElement('div');
    idle.className = 'job';
    idle.innerHTML = '<span class="ji">🚶</span><span class="jn"><b>بی‌کار</b>' +
      '<small>بقیهٔ اهالی آزادانه در شهر می‌گردند.</small></span>' +
      '<span class="jcount">' + U.fa(Math.max(0, S.population() - used)) + '</span>';
    list.appendChild(idle);
  };

  /* ---------------- people, riders & vehicles ---------------- */
  UI.prototype.renderPeople = function () {
    const g = this.game, self = this, S = g.settlers;
    const housing = S.housing(), res = S.residents, homeless = S.homeless();

    const cell = (v, l, warn) =>
      '<div class="pop-cell' + (warn ? ' warn' : '') + '"><b>' + v + '</b><span>' + l + '</span></div>';
    $('pop-hero').innerHTML =
      cell(U.fa(S.population()), 'جمعیت فعال') +
      cell(U.fa(res), 'ساکنان') +
      cell(U.fa(housing), 'ظرفیت خانه‌ها') +
      cell(U.fa(S.spareHomes()), 'خانهٔ خالی') +
      cell(U.fa(g.progress.happiness) + '٪', 'شادی', g.progress.happiness < 50) +
      (homeless ? cell(U.fa(homeless), 'بی‌خانمان', true) : '');

    const acts = $('pop-actions');
    acts.innerHTML = '';
    const mk = (parent, label, cls, fn, dis) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (cls || '');
      b.innerHTML = label;
      b.disabled = !!dis;
      b.onclick = fn;
      parent.appendChild(b);
      return b;
    };
    const wc = S.workerCost();
    mk(acts, '🧑‍🌾 استخدام کارگر — 💰 ' + U.fa(wc), 'primary',
      function () { S.hireWorker(); self.renderPeople(); },
      g.inv.coins < wc || S.spareHomes() < 1);

    /* riders */
    const maxR = S.maxRiders();
    $('rider-note').innerHTML = maxR
      ? 'اصطبل سطح ' + U.fa(maxR) + ' — تا ' + U.fa(maxR) + ' سوارکار می‌توانی داشته باشی.<br>' +
      'هر سوارکار به سفر می‌رود و مردم بی‌پناه را به شهرت می‌آورد. سطح ۱: ' +
      U.fa(C.SETTLERS.baseDays) + ' روز سفر و ۱ نفر · سطح ۵: حدود ' +
      U.fa(C.SETTLERS.minDays) + ' روز و ۵ نفر در هر سفر.'
      : '🔒 برای داشتن سوارکار اول یک <b>اصطبل</b> بساز (منوی ساخت‌وساز، دستهٔ شهری).';

    const rl = $('rider-list');
    rl.innerHTML = '';
    if (!S.riders.length) {
      rl.innerHTML = '<div style="color:var(--muted);font-size:12px">هنوز سوارکاری نداری</div>';
    }
    S.riders.forEach(function (r, i) {
      const st = S.riderStat(r.level);
      const away = r.state !== 'idle';
      const d = document.createElement('div');
      d.className = 'rider' + (away ? ' away' : '');
      const pct = away ? U.clamp01(r.trip / Math.max(0.01, r.tripLen)) * 100 : 0;
      d.innerHTML = '<span class="ri">🏇</span><span class="rn"><b>سوارکار ' + U.fa(i + 1) +
        '</b> — سطح ' + U.fa(r.level) + '<small>هر سفر ' + U.fa(st.bring) + ' نفر · مدت ' +
        U.fa(Math.round(st.days * 10) / 10) + ' روز</small>' +
        (away ? '<small>در سفر… ' + U.fa(Math.round(pct)) + '٪ (' +
          U.fa(Math.max(0, Math.round((r.tripLen - r.trip) * 10) / 10)) + ' روز مانده)</small>' +
          '<span class="rbar"><i style="width:' + pct + '%"></i></span>' : '') +
        '</span>';
      const btns = document.createElement('span');
      btns.className = 'vbtns';
      d.appendChild(btns);
      if (!away) {
        const tc = C.SETTLERS.tripCost(r.level);
        mk(btns, '🧭 اعزام', 'primary', function () { S.sendRider(r); self.renderPeople(); },
          !g.inv.canAfford(tc) || S.spareHomes() < st.bring);
        if (r.level < C.SETTLERS.riderMax) {
          const uc = C.SETTLERS.riderUpgrade(r.level + 1);
          mk(btns, '⬆️ ارتقا', 'gold', function () { S.upgradeRider(r); self.renderPeople(); },
            !g.inv.canAfford(uc));
        }
      }
      rl.appendChild(d);
    });

    const ra = $('rider-actions');
    ra.innerHTML = '';
    const rc = C.SETTLERS.riderCost(S.riders.length);
    mk(ra, '🏇 استخدام سوارکار — 💰 ' + U.fa(rc.coin) + ' + 🌾' + U.fa(rc.fiber), 'primary',
      function () { S.hireRider(); self.renderPeople(); },
      maxR < 1 || S.riders.length >= maxR || !g.inv.canAfford(rc));
    if (S.riders.some((r) => r.state === 'idle')) {
      mk(ra, '🧭 اعزام همه', '', function () { S.sendAll(); self.renderPeople(); });
    }

    /* vehicles */
    const vl = $('veh-list');
    vl.innerHTML = '';
    for (const id in C.VEHICLES) {
      const def = C.VEHICLES[id];
      const owned = g.vehicles.own(id);
      const free = !Object.keys(def.cost).length;
      let costHtml = free ? '<span class="free-tag">رایگان</span>' : '';
      if (!owned) {
        for (const k in def.cost) {
          const have = k === 'coin' ? g.inv.coins : g.inv.count(k);
          const icon = k === 'coin' ? '💰' : (C.ITEMS[k] ? C.ITEMS[k].icon : k);
          costHtml += '<span style="color:' + (have >= def.cost[k] ? 'var(--green)' : 'var(--red)') +
            ';margin-left:8px">' + icon + ' ' + U.fa(have) + '/' + U.fa(def.cost[k]) + '</span>';
        }
      }
      const d = document.createElement('div');
      d.className = 'veh';
      d.innerHTML = '<span class="vi">' + def.icon + '</span><span class="vn"><b>' + def.name +
        (owned ? ' — سطح ' + U.fa(owned.level) : '') + '</b><small>' + def.desc + '</small>' +
        '<small>' + costHtml + '</small>' +
        (owned ? '<small>سرعت: ' + U.fa(Math.round(def.stat(owned.level).speed)) + '</small>' : '') +
        '</span>';
      const btns = document.createElement('span');
      btns.className = 'vbtns';
      d.appendChild(btns);
      if (!owned) {
        mk(btns, free ? '🎁 دریافت رایگان' : '🛒 خرید', 'primary',
          function () { g.vehicles.buy(id); self.renderPeople(); }, !g.inv.canAfford(def.cost));
      } else {
        mk(btns, '📍 فراخوانی', '', function () { g.vehicles.recall(id); self.closePanel(); });
        mk(btns, '🔑 سوار شدن', 'primary', function () {
          self.closePanel(); g.vehicles.mount(owned);
        }, U.dist(g.player.pos.x, g.player.pos.z, owned.x, owned.z) > 7);
        if (owned.level < def.max) {
          const uc = def.upgrade(owned.level + 1);
          mk(btns, '⬆️ ارتقا', 'gold', function () { g.vehicles.upgrade(id); self.renderPeople(); },
            !g.inv.canAfford(uc));
        }
      }
      vl.appendChild(d);
    }
  };

  /* ---------------- structure ---------------- */
  UI.prototype.openStructure = function (b) {
    this.structure = b;
    this.openPanel('structure');
  };

  UI.prototype.renderStructure = function () {
    const g = this.game, self = this;
    const b = this.structure;
    if (!b || g.building.list.indexOf(b) < 0) { this.closePanel(); return; }
    $('st-name').textContent = b.def.name;
    const body = $('st-body');
    const eff = b.def.effects ? b.def.effects(b.level) : {};
    const rec = b.def.produce ? b.def.produce(b.level) : null;

    let stats = '';
    const stat = (v, l) => { stats += '<div class="st-stat"><b>' + v + '</b><span>' + l + '</span></div>'; };
    stat(U.fa(b.level) + '/' + U.fa(b.def.max), 'سطح');
    stat(U.fa(Math.ceil(b.hp)) + '/' + U.fa(b.maxHp), 'دوام');
    if (eff.pop) stat('+' + U.fa(eff.pop), 'جمعیت');
    if (eff.happy) stat((eff.happy > 0 ? '+' : '') + U.fa(eff.happy), 'شادی');
    if (eff.storage) stat('+' + U.fa(eff.storage), 'ظرفیت انبار');
    if (eff.income) stat('+' + U.fa(eff.income), 'درآمد روزانه');
    if (eff.defense) stat('+' + U.fa(eff.defense), 'دفاع');
    if (eff.range) stat(U.fa(Math.round(eff.range)), 'برد تیر');
    if (eff.dps) stat(U.fa(Math.round(eff.dps)), 'آسیب');
    if (eff.water) stat(U.fa(eff.water), 'شعاع آب');
    if (eff.xpBonus) stat('+' + U.fa(Math.round(eff.xpBonus * 100)) + '٪', 'تجربه');
    if (eff.fishing) stat('+' + U.fa(eff.fishing), 'شانس ماهی');
    if (eff.border) stat('+' + U.fa(eff.border), 'مرز شهر');

    let prod = '';
    if (rec) {
      const fmt = (o) => Object.keys(o).map((k) => C.ITEMS[k].icon + U.fa(o[k])).join(' ');
      prod = '<div style="font-size:12.5px;color:var(--muted);margin-bottom:12px">🔁 تولید هر ' +
        U.fa(rec.hours) + ' ساعت: ' + (rec.inp ? fmt(rec.inp) + ' ← ' : '') + fmt(rec.out) +
        ' <span style="color:var(--gold)">(' + U.fa(Math.round(b.prodT / rec.hours * 100)) + '٪)</span>' +
        (b.stalled ? ' <span style="color:var(--red)">— مواد اولیه کم است</span>' : '') + '</div>';
    }

    const next = b.level < b.def.max ? b.def.cost(b.level + 1) : null;
    let costHtml = '';
    if (next) {
      for (const k in next) {
        const have = k === 'coin' ? g.inv.coins : g.inv.count(k);
        const icon = k === 'coin' ? '💰' : (C.ITEMS[k] ? C.ITEMS[k].icon : k);
        costHtml += '<span style="color:' + (have >= next[k] ? 'var(--green)' : 'var(--red)') + ';margin-left:10px">' +
          icon + ' ' + U.fa(have) + '/' + U.fa(next[k]) + '</span>';
      }
    }

    body.innerHTML =
      '<div class="st-hero"><div class="sh-ic">' + b.def.icon + '</div><div class="sh-t"><b>' + b.def.name +
      '</b><div>' + b.def.desc + '</div></div></div>' +
      '<div class="st-stats">' + stats + '</div>' + prod +
      (next ? '<div style="font-size:12.5px;margin-bottom:10px">هزینه ارتقا به سطح ' + U.fa(b.level + 1) + ': ' + costHtml + '</div>' : '') +
      '<div class="st-actions" id="st-actions"></div>';

    const act = $('st-actions');
    const mk = (label, cls, fn, dis) => {
      const x = document.createElement('button');
      x.className = 'btn ' + (cls || '');
      x.textContent = label;
      x.disabled = !!dis;
      x.onclick = fn;
      act.appendChild(x);
    };
    if (next) mk('⬆️ ارتقا به سطح ' + U.fa(b.level + 1), 'primary', function () {
      if (g.building.upgrade(b)) self.renderStructure();
    });
    if (b.hp < b.maxHp) mk('🔧 تعمیر', 'gold', function () {
      if (g.building.repair(b)) self.renderStructure();
    });
    mk('🗑️ تخریب (نصف منابع برمی‌گردد)', 'danger', function () {
      if (!confirm('این ساختمان تخریب شود؟')) return;
      g.building.demolish(b);
      self.closePanel();
    });
  };

  G.UI = UI;
})(window.GAME = window.GAME || {});
