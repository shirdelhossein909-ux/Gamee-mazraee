/* =========================================================
   game.js — renderer/scene setup, boot sequence, the main
   loop and all input wiring. Entry point of the whole game.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;

  /* =========================================================
     PARTICLE FX
     ========================================================= */
  function FX(game) {
    this.game = game;
    this.pool = [];
    this.active = [];
    for (let i = 0; i < 14; i++) {
      const n = 26;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const mat = new THREE.PointsMaterial({ size: 0.22, transparent: true, depthWrite: false });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      game.scene.add(pts);
      this.pool.push({ pts: pts, n: n, vel: new Float32Array(n * 3), t: 0 });
    }
  }
  FX.prototype.hitBurst = function (x, y, z, color, count) {
    const b = this.pool.find(function (p) { return p.t <= 0; });
    if (!b) return;
    const n = Math.min(b.n, count || 12);
    const pos = b.pts.geometry.attributes.position.array;
    for (let i = 0; i < b.n; i++) {
      const i3 = i * 3;
      if (i < n) {
        pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
        const a = Math.random() * 6.283, up = 1.5 + Math.random() * 3.5, sp = 1.4 + Math.random() * 2.6;
        b.vel[i3] = Math.cos(a) * sp; b.vel[i3 + 1] = up; b.vel[i3 + 2] = Math.sin(a) * sp;
      } else { pos[i3 + 1] = -9999; b.vel[i3] = b.vel[i3 + 1] = b.vel[i3 + 2] = 0; }
    }
    b.pts.geometry.attributes.position.needsUpdate = true;
    b.pts.material.color.setHex(color);
    b.pts.material.opacity = 1;
    b.pts.visible = true;
    b.t = 0.75;
  };
  FX.prototype.update = function (dt) {
    for (const b of this.pool) {
      if (b.t <= 0) continue;
      b.t -= dt;
      const pos = b.pts.geometry.attributes.position.array;
      for (let i = 0; i < b.n; i++) {
        const i3 = i * 3;
        b.vel[i3 + 1] -= 11 * dt;
        pos[i3] += b.vel[i3] * dt;
        pos[i3 + 1] += b.vel[i3 + 1] * dt;
        pos[i3 + 2] += b.vel[i3 + 2] * dt;
      }
      b.pts.geometry.attributes.position.needsUpdate = true;
      b.pts.material.opacity = U.clamp01(b.t / 0.75);
      if (b.t <= 0) b.pts.visible = false;
    }
  };

  /* =========================================================
     GAME
     ========================================================= */
  function Game() {
    this.bus = new U.Bus();
    this.audio = new G.Audio(this);
    this.started = false;
    this.paused = false;
    this.quality = 'mid';
    this.shadows = true;
    this.seed = 1;
    this._autosave = 0;
    this._acc = 0;
  }

  Game.prototype.boot = function () {
    const canvas = document.getElementById('scene');
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: true, powerPreference: 'high-performance', stencil: false
      });
    } catch (e) {
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('nowebgl').classList.remove('hidden');
      return;
    }
    if (THREE.ColorManagement) THREE.ColorManagement.enabled = true;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ('outputEncoding' in this.renderer && THREE.sRGBEncoding !== undefined) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }

    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.12, 1400);
    this.camera.position.set(0, 12, 14);

    G.Input.init(canvas);
    const self = this;
    addEventListener('resize', function () {
      self.camera.aspect = innerWidth / innerHeight;
      self.camera.updateProjectionMatrix();
      self.renderer.setSize(innerWidth, innerHeight);
    });

    /* menu */
    const save = G.SaveSystem.peek();
    const cont = document.getElementById('btn-continue');
    if (save) {
      cont.classList.remove('hidden');
      cont.textContent = '▶ ادامه بازی (روز ' + U.fa(save.day) + ' — ' + C.TIERS[save.tier || 0].name + ')';
      cont.onclick = function () { self.start(G.SaveSystem.load()); };
    }
    const unlock = function () { self.audio.resume(); };
    addEventListener('pointerdown', unlock, { passive: true });
    addEventListener('keydown', unlock);

    document.getElementById('btn-new').onclick = function () {
      const raw = document.getElementById('seed-input').value.trim();
      const seed = raw ? U.strSeed(raw) : (Math.random() * 2147483647) | 0;
      self.start(null, seed);
    };
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('mainmenu').classList.remove('hidden');

    // keep rendering the (empty) scene so resizes stay clean
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1418);
  };

  /* ---------------- start a world ---------------- */
  Game.prototype.start = function (saveData, seed) {
    const self = this;
    this.seed = saveData ? saveData.seed : (seed === undefined ? 1 : seed);
    document.getElementById('mainmenu').classList.add('hidden');
    const loading = document.getElementById('loading');
    const fill = document.getElementById('load-fill');
    const text = document.getElementById('load-text');
    loading.classList.remove('hidden');

    const steps = [
      ['ساخت صحنه…', function () { self._buildScene(); }],
      ['شکل‌دهی زمین و کوه‌ها…', function () { self._buildWorld(); }],
      ['کاشتن جنگل‌ها و معادن…', function () { self.world.generateAll(); }],
      ['آسمان، خورشید و ابرها…', function () { self._buildSky(); }],
      ['آماده‌سازی شخصیت و سامانه‌ها…', function () { self._buildSystems(); }],
      ['بازگرداندن پیشرفت…', function () { self._applySave(saveData); }],
      ['آماده!', function () { self._begin(); }]
    ];

    let i = 0;
    function step() {
      if (i >= steps.length) {
        loading.classList.add('hidden');
        return;
      }
      text.textContent = steps[i][1] ? steps[i][0] : '';
      fill.style.width = Math.round((i / steps.length) * 100) + '%';
      const fn = steps[i][1];
      i++;
      requestAnimationFrame(function () {
        try { fn(); } catch (err) {
          console.error(err);
          text.textContent = 'خطا: ' + err.message;
          return;
        }
        step();
      });
    }
    step();
  };

  Game.prototype._buildScene = function () {
    if (this.scene) this._teardown();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x9fc6e0, 60, 240);
    this.fx = new FX(this);
  };

  Game.prototype._buildWorld = function () {
    this.world = new G.World(this, this.seed);
    this.scene.add(this.world.group);
  };

  Game.prototype._buildSky = function () {
    this.sky = new G.Sky(this);
  };

  Game.prototype._buildSystems = function () {
    this.bus = new U.Bus();          // fresh bus: restarts must not stack listeners
    this.markers = [];               // map waypoints
    this.markerSeq = 0;
    this.inv = new G.Inventory(this);
    this.progress = new G.Progression(this);
    this.player = new G.Player(this);
    this.farming = new G.Farming(this);
    this.building = new G.Building(this);
    this.settlers = new G.Settlers(this);
    this.wildlife = new G.Wildlife(this);
    this.villagers = new G.Villagers(this);
    this.vehicles = new G.Vehicles(this);
    this.horses = new G.Horses(this);
    this.companions = new G.Companions(this);
    this.economy = new G.Economy(this);
    this.gather = new G.Gathering(this);
    /* the chronicle listens to the bus, so it has to exist before anything
       worth recording happens */
    this.chronicle = new G.Chronicle(this);
    this.myth = new G.Myth(this);
    this.disasters = new G.Disasters(this);
    this.ui = new G.UI(this);
    this.myth.findPeak();

    const self = this;
    this.bus.on('item', function () { self.ui.dirtyRes = true; self.ui.dirtyHot = true; });
    this.bus.on('coins', function () { self.ui.dirtyRes = true; });
    this.bus.on('build', function () { self.ui.dirtyRes = true; self.progress.recalc(); });
    this.bus.on('newday', function () { self.economy.onNewDay(); });
    this.bus.on('playerhurt', function () { self.ui.hurt(); });
    this.bus.on('playerdown', function () { self._respawn(); });
  };

  Game.prototype._applySave = function (d) {
    if (d) G.SaveSystem.apply(this, d);
    else {
      // fresh world: drop the player on the homestead
      const sp = this.world.spawnPoint();
      this.player.reset(sp);
      this.inv.water = 8;
    }
    this.progress.recalc();
  };

  Game.prototype._begin = function () {
    this.started = true;
    document.getElementById('hud').classList.remove('hidden');
    this.ui.dirtyRes = true;
    this.ui.dirtyHot = true;
    this.ui.select(0);
    G.Input.enabled = true;
    this._last = U.now();
    if (!this._looping) { this._looping = true; this._loop(); }

    const p = this.progress;
    if (p.get('till') === 0 && p.level === 1) {
      const self = this;
      setTimeout(function () { self.ui.toast('👋 به مزرعه‌ات خوش آمدی! با کلیک روی صفحه دوربین قفل می‌شود.', 'gold'); }, 600);
      setTimeout(function () { self.ui.toast('🪏 با کلید ۱ بیل را بردار و زمین را شخم بزن، بعد با ۳ بذر بکار.', 'good'); }, 3400);
      setTimeout(function () { self.ui.toast('🏗️ با کلید B منوی ساخت‌وساز باز می‌شود — از یک چادر شروع کن.', 'good'); }, 6600);
    }
  };

  Game.prototype._teardown = function () {
    if (this.world) this.world.dispose();
    if (this.wildlife) this.wildlife.clear();
    if (this.villagers) this.villagers.clear();
    if (this.vehicles) this.vehicles.clear();
    if (this.horses) this.horses.clear();
    if (this.companions) this.companions.clear();
    if (this.myth) this.myth.clear();
    if (this.settlers) this.settlers.clear();
    if (this.audio) this.audio.engineStop();
    if (this.building) {
      this.building.cancel();      // a move in progress puts its building back
      while (this.building.list.length) this.building.demolish(this.building.list[0], false);
    }
    if (this.farming) {
      this.farming.plots.forEach(function (p) {
        p.group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      });
      this.farming.plots.clear();
    }
    if (this.ui) {
      if (this.ui.map) this.ui.closeMap();
      this.ui.closePanel(true);
      for (const f of this.ui.floaters) f.el.remove();
      this.ui.floaters.length = 0;
    }
    this.renderer.renderLists.dispose();
  };

  Game.prototype.restart = function (saveData, seed) {
    this.started = false;
    document.getElementById('hud').classList.add('hidden');
    this.start(saveData, seed);
  };

  Game.prototype._respawn = function () {
    const p = this.player;
    if (this.vehicles.mounted) this.vehicles.dismount();
    if (this.horses.mounted) this.horses.dismount();
    /* You come back whole. Waking up on half health next to whatever just
       killed you only ever meant dying twice. */
    p.hp = p.maxHp;
    p.stamina = p.maxStamina;
    p.energy = Math.max(60, p.energy);
    const loss = Math.floor(this.inv.coins * 0.1);
    if (loss > 0) this.inv.addCoins(-loss);
    const home = this.building.list.length
      ? { x: this.building.centerX, z: this.building.centerZ }
      : { x: 0, z: 0 };
    p.reset(new THREE.Vector3(home.x, this.world.heightAt(home.x, home.z), home.z));
    this.ui.toast('💀 از پا افتادی! با جان کامل به خانه برگشتی' +
      (loss ? ' و ' + U.fa(loss) + ' سکه از دست دادی' : ''), 'bad');
  };

  /* =========================================================
     SETTINGS
     ========================================================= */
  Game.prototype.setQuality = function (q) {
    this.quality = q;
    this.renderer.setPixelRatio(q === 'low' ? 1 : Math.min(devicePixelRatio || 1, q === 'high' ? 2 : 1.5));
    if (this.sky) this.sky.setQuality(q);
  };
  Game.prototype.setShadows = function (on) {
    this.shadows = on;
    this.renderer.shadowMap.enabled = on;
    if (this.sky) this.sky.setShadows(on);
    this.scene.traverse(function (o) { if (o.isMesh) o.material.needsUpdate = true; });
  };
  Game.prototype.setViewRadius = function (r) {
    if (!this.world) return;
    this.world.viewRadius = r;
    this.world._lastCx = 99999;
    C.WORLD.viewRadius = r;
  };

  /* =========================================================
     INPUT
     ========================================================= */
  Game.prototype._input = function (dt) {
    const IN = G.Input, ui = this.ui;

    /* panel toggles work even while a panel is open */
    if (IN.pressed('KeyI')) ui.openPanel('inventory');
    if (IN.pressed('KeyB')) ui.openPanel('build');
    if (IN.pressed('KeyM')) ui.openPanel('market');
    if (IN.pressed('KeyK')) ui.openPanel('skills');
    if (IN.pressed('KeyQ')) ui.openPanel('quests');
    if (IN.pressed('KeyP')) ui.openPanel('people');
    if (IN.pressed('KeyN')) ui.toggleMap();
    if (IN.pressed('KeyJ')) ui.openPanel('jobs');
    if (IN.pressed('KeyL')) ui.openPanel('chronicle');
    if (IN.pressed('Escape')) {
      if (this.ui.map && this.ui.map.open) this.ui.closeMap();
      else if (this.building.placing) this.building.cancel();
      else if (ui.anyPanelOpen()) ui.closePanel();
      else ui.openPanel('menu');
    }
    if (IN.pressed('KeyF')) { if (IN.locked) IN.unlock(); else IN.lock(); }
    /* G: grab whatever you are looking at and move it */
    if (IN.gpressed('KeyG') && !this.building.placing) {
      const t = this.gather.target;
      if (t && t.kind === 'building') this.building.startMove(t.building);
      else ui.toast('🔀 اول به ساختمانی که می‌خواهی جابه‌جا کنی نگاه کن', 'bad');
    }
    if (IN.gpressed('KeyV') && !this.building.placing) {
      /* one key for every saddle: horse first, then boat or car */
      if (this.horses.mounted || this.horses.nearest(this.player.pos.x, this.player.pos.z, 6, true)) {
        this.horses.toggle();
      } else this.vehicles.toggle();
    }

    if (!IN.enabled) return;

    /* hotbar */
    for (let i = 0; i < 9; i++) {
      // top row and numeric keypad both pick a tool
      if (IN.pressed('Digit' + (i + 1)) || IN.pressed('Numpad' + (i + 1))) ui.select(i);
    }

    /* R: rotate a ghost, otherwise cycle seed / food */
    if (IN.gpressed('KeyR')) {
      if (this.building.placing) this.building.rotate();
      else {
        const tool = ui.currentTool();
        if (tool === 'food') {
          const f = this.inv.cycleFood();
          if (f) ui.toast('🍽️ ' + C.ITEMS[f].name, 'good'); else ui.toast('غذایی نداری', 'bad');
        } else {
          const s = this.inv.cycleSeed();
          if (s) ui.toast('🌱 ' + C.ITEMS[s].name, 'good'); else ui.toast('بذری نداری', 'bad');
        }
        ui.dirtyHot = true;
      }
    }

    /* fishing can also be reeled in with space */
    if (this.gather.fishing && IN.gpressed('Space')) { this.gather.reelIn(); return; }

    /* left click */
    if (IN.clicked(0)) {
      if (this.building.placing) this.building.confirm();
      else if (this.player.mount) {
        /* One hand on the reins is enough for a blade, a bow or a bite —
           hunting from the saddle is half the point of having a horse. */
        const tool = ui.currentTool();
        if (tool === 'sword' || tool === 'bow' || tool === 'food') {
          ui.swingSlot();
          this.gather.use(tool);
        }
      } else {
        ui.swingSlot();
        this.gather.use(ui.currentTool());
      }
    }
    /* H: loose the falcon / set the cheetah on whatever you are looking at */
    if (IN.gpressed('KeyH') && !this.building.placing) this.companions.release();

    /* Interact. A wild horse — or a falcon or cheetah — in arm's reach turns
       E into a hold: you keep it down while the rope goes on or the bird
       settles. Everything else still fires the instant the key goes down, so
       no interaction ever feels laggy. */
    const p = this.player.pos;
    const busy = this.building.placing || this.player.mount;
    const wildHorse = !busy && this.horses.nearestWild(p.x, p.z, C.HORSE.tameRange);
    const wildPet = !busy && !wildHorse && this.companions.nearestWild(p.x, p.z);
    if (IN.gpressed('KeyE')) {
      if (this.building.placing) this.building.confirm();
      else if (wildHorse) { this._taming = 'horse'; }
      else if (wildPet) { this._taming = 'pet'; }
      /* the three legends answer E too — the peak rite and digging up a
         dream both happen here, before ordinary gathering gets a look in */
      else if (!this.myth.interact()) this.gather.interact();
    }
    if (this._taming === 'horse') {
      if (IN.down('KeyE') && wildHorse) this.horses.holdTame(dt);
      else { this.horses.cancelTame(); this._taming = null; }
    } else if (this._taming === 'pet') {
      if (IN.down('KeyE') && wildPet) this.companions.holdTame(dt);
      else { this.companions.cancelTame(); this._taming = null; }
    }
  };

  /* =========================================================
     MAIN LOOP
     ========================================================= */
  Game.prototype._loop = function () {
    const self = this;
    requestAnimationFrame(function () { self._loop(); });

    const now = U.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1;            // never simulate huge steps after a stall

    /* A rolling read on how much room this machine has to spare. When frames
       are already running long, world streaming stands down for a beat rather
       than piling generation work on top — that is what used to make the
       camera feel like it seized up as you walked into new ground. */
    this._frameAvg = this._frameAvg === undefined ? dt : this._frameAvg * 0.9 + dt * 0.1;
    this._lateFrame = this._frameAvg > 0.026;

    if (this.started) this.update(dt);
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
    G.Input.endFrame();
  };

  Game.prototype.update = function (dt) {
    this._input(dt);

    this.vehicles.update(dt);
    this.horses.update(dt);
    this.companions.update(dt);
    this.disasters.update(dt);
    this.player.update(dt);
    this.world.update(dt, this.player.pos.x, this.player.pos.z, this._lateFrame);
    this.sky.update(dt, this.player.pos);
    this.wildlife.update(dt);
    this.villagers.update(dt);
    this.settlers.update(dt);
    this.farming.update(dt);
    this.building.update(dt);
    this.progress.update(dt);
    this.myth.update(dt);

    if (!this.building.placing) this.gather.pickTarget();
    this.gather.update(dt);
    this.fx.update(dt);
    this.audio.update(dt);
    this.ui.update(dt);

    this._autosave += dt;
    if (this._autosave > 120) {
      this._autosave = 0;
      if (G.SaveSystem.save(this)) this.ui.toast('💾 ذخیره خودکار', 'good');
    }
  };

  /* =========================================================
     BOOT
     ========================================================= */
  G.Game = Game;
  const game = new Game();
  G.game = game;

  function ready() {
    try {
      game.boot();
    } catch (e) {
      console.error(e);
      const t = document.getElementById('load-text');
      if (t) t.textContent = 'خطا در راه‌اندازی: ' + e.message;
    }
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', ready);
  else ready();
})(window.GAME = window.GAME || {});
