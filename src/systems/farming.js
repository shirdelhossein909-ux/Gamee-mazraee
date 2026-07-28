/* =========================================================
   farming.js — tilling, planting, watering, growth stages
   and harvesting. Plots live on a fixed world grid so they
   survive chunk streaming and saving.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;
  const GS = C.WORLD.gridSize;

  function Farming(game) {
    this.game = game;
    this.plots = new Map();
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this._soilGeo = {};
    this._cropGeo = {};
    this._stealTimer = 0;
  }

  /* ---------------- grid helpers ---------------- */
  Farming.prototype.cell = function (x, z) {
    return { gx: Math.round(x / GS), gz: Math.round(z / GS) };
  };
  Farming.prototype.plotAt = function (x, z) {
    const c = this.cell(x, z);
    return this.plots.get(U.key(c.gx, c.gz)) || null;
  };
  Farming.prototype.plotAtCell = function (gx, gz) { return this.plots.get(U.key(gx, gz)) || null; };

  /* ---------------- geometry caches ---------------- */
  Farming.prototype._soil = function (wet) {
    const k = wet ? 'w' : 'd';
    if (!this._soilGeo[k]) this._soilGeo[k] = M.soil(GS * 0.94, wet).geometry;
    const m = new THREE.Mesh(this._soilGeo[k], M.MAT.solid);
    m.receiveShadow = true;
    return m;
  };
  Farming.prototype._cropMesh = function (crop, stage) {
    const k = crop + stage;
    if (!this._cropGeo[k]) {
      const g = M.crop(crop, stage);
      this._cropGeo[k] = g.children[0].geometry;
    }
    const m = new THREE.Mesh(this._cropGeo[k], M.MAT.solid);
    m.castShadow = true;
    return m;
  };

  /* ---------------- actions ---------------- */
  Farming.prototype.canTill = function (x, z) {
    const w = this.game.world;
    const c = this.cell(x, z);
    if (this.plots.has(U.key(c.gx, c.gz))) return { ok: false, why: 'اینجا قبلاً شخم خورده' };
    const wx = c.gx * GS, wz = c.gz * GS;
    const h = w.heightAt(wx, wz);
    if (h < C.WORLD.waterLevel + 0.4) return { ok: false, why: 'زمین زیر آب است' };
    if (w.slopeAt(wx, wz, GS * 0.6) > 1.15) return { ok: false, why: 'زمین خیلی شیب‌دار است' };
    if (this.game.building && this.game.building.occupied(wx, wz)) return { ok: false, why: 'اینجا ساختمان است' };
    return { ok: true, gx: c.gx, gz: c.gz, x: wx, z: wz, y: h };
  };

  Farming.prototype.till = function (x, z) {
    const r = this.canTill(x, z);
    if (!r.ok) { this.game.ui.toast('⚠️ ' + r.why, 'bad'); return null; }
    const cost = C.toolStat('hoe', this.game.progress.toolLevel('hoe')).cost;
    if (!this.game.player.spend(cost)) { this.game.ui.toast('😮‍💨 انرژی کافی نداری', 'bad'); return null; }

    const plot = {
      gx: r.gx, gz: r.gz, x: r.x, z: r.z, y: r.y,
      crop: null, stage: 0, growth: 0, moisture: 0,
      group: new THREE.Group(), soil: null, plant: null
    };
    plot.group.position.set(r.x, r.y + 0.01, r.z);
    plot.soil = this._soil(false);
    plot.group.add(plot.soil);
    this.group.add(plot.group);
    this.plots.set(U.key(r.gx, r.gz), plot);

    this.game.progress.addSkill('farming', 2);
    this.game.progress.stat('till', 1);
    this.game.fx.hitBurst(r.x, r.y + 0.3, r.z, 0x7a5a3a, 7);
    return plot;
  };

  Farming.prototype.plant = function (plot, seedId) {
    if (!plot || plot.crop) return false;
    const inv = this.game.inv;
    seedId = seedId || inv.selectedSeed;
    let cropId = null;
    for (const id in C.CROPS) if (C.CROPS[id].seed === seedId) cropId = id;
    if (!cropId) { this.game.ui.toast('🌱 بذری انتخاب نشده', 'bad'); return false; }
    if (!inv.has(seedId, 1)) { this.game.ui.toast('🌱 بذر ' + C.CROPS[cropId].name + ' نداری', 'bad'); return false; }
    const need = C.CROPS[cropId].lvl;
    if (this.game.progress.skill('farming').level < need) {
      this.game.ui.toast('🔒 برای این بذر به کشاورزی سطح ' + U.fa(need) + ' نیاز داری', 'bad');
      return false;
    }
    inv.remove(seedId, 1);
    plot.crop = cropId;
    plot.stage = 0; plot.growth = 0;
    this._refreshPlant(plot);
    this.game.progress.addSkill('farming', 3);
    this.game.progress.stat('plant', 1);
    return true;
  };

  Farming.prototype.water = function (plot) {
    if (!plot) return false;
    const inv = this.game.inv;
    if (plot.moisture > 0.75) return false;
    if (inv.water <= 0) { this.game.ui.toast('🪣 آبپاش خالی است — کنار آب یا چاه پرش کن', 'bad'); return false; }
    inv.water--;
    plot.moisture = 1;
    this._refreshSoil(plot);
    this.game.fx.hitBurst(plot.x, plot.y + 0.4, plot.z, 0x5fc8ff, 9);
    this.game.progress.addSkill('farming', 1);
    return true;
  };

  Farming.prototype.harvest = function (plot) {
    if (!plot || !plot.crop || plot.stage < 3) return false;
    const def = C.CROPS[plot.crop];
    const prog = this.game.progress;
    const lvl = prog.skill('farming').level;
    let n = Math.floor(def.yield[0] + Math.random() * (def.yield[1] - def.yield[0] + 1));
    n += Math.floor(lvl / 4);                                   // skill bonus
    if (Math.random() < lvl * 0.012) n++;                        // rare double
    const got = this.game.inv.add(plot.crop, n);
    if (!got) return false;
    prog.addSkill('farming', def.xp);
    prog.addXp(Math.round(def.xp * 0.5));
    prog.stat('harvest', 1);
    prog.stat('harvest_' + plot.crop, 1);
    this.game.ui.toast('🌾 ' + U.fa(got) + '× ' + def.name + ' برداشت شد', 'good');
    this.game.fx.hitBurst(plot.x, plot.y + 0.5, plot.z, def.colB, 12);

    plot.crop = null; plot.stage = 0; plot.growth = 0;
    plot.moisture = Math.max(0, plot.moisture - 0.35);
    this._refreshPlant(plot);
    this._refreshSoil(plot);
    return true;
  };

  Farming.prototype.remove = function (plot) {
    if (!plot) return;
    this.group.remove(plot.group);
    this.plots.delete(U.key(plot.gx, plot.gz));
  };

  /* ---------------- visuals ---------------- */
  Farming.prototype._refreshSoil = function (plot) {
    const wet = plot.moisture > 0.25;
    if (plot._wet === wet && plot.soil) return;
    plot._wet = wet;
    if (plot.soil) plot.group.remove(plot.soil);
    plot.soil = this._soil(wet);
    plot.group.add(plot.soil);
  };

  Farming.prototype._refreshPlant = function (plot) {
    if (plot.plant) { plot.group.remove(plot.plant); plot.plant = null; }
    if (!plot.crop) return;
    plot.plant = this._cropMesh(plot.crop, plot.stage);
    plot.plant.position.y = 0.14;
    plot.group.add(plot.plant);
  };

  /* ---------------- growth ---------------- */
  Farming.prototype.update = function (dt) {
    const hoursPerSec = 24 / C.TIME.dayLength;
    const dh = dt * hoursPerSec;
    const season = C.SEASONS[this.game.time.season];
    const rain = this.game.sky.rainAmount();

    this.plots.forEach((plot) => {
      if (rain > 0) plot.moisture = Math.min(1, plot.moisture + dh * rain * 0.5);
      else if (plot.moisture > 0) plot.moisture = Math.max(0, plot.moisture - dh * 0.045);

      if (plot.crop && plot.stage < 3) {
        const def = C.CROPS[plot.crop];
        const mul = season.growth * (plot.moisture > 0.2 ? 1.6 : 1);
        plot.growth += dh * mul;
        const st = Math.min(3, Math.floor((plot.growth / def.growH) * 4));
        if (st !== plot.stage) {
          plot.stage = st;
          this._refreshPlant(plot);
          if (st === 3) this.game.bus.emit('cropready', plot);
        }
      }
      if (plot._wet !== (plot.moisture > 0.25)) this._refreshSoil(plot);
    });

    /* animals nibbling ripe crops */
    this._stealTimer -= dt;
    if (this._stealTimer <= 0) {
      this._stealTimer = 1.4;
      this._checkTheft();
    }
  };

  Farming.prototype._checkTheft = function () {
    const wl = this.game.wildlife;
    if (!wl || !this.plots.size) return;
    for (const a of wl.animals) {
      if (a.dead) continue;
      if (!(a.def.thief || a.def.hostile)) continue;
      const plot = this.plotAt(a.x, a.z);
      if (!plot || !plot.crop) continue;
      if (U.dist2(a.x, a.z, plot.x, plot.z) > 4) continue;
      if (Math.random() < 0.5) {
        const name = C.CROPS[plot.crop].name;
        plot.crop = null; plot.stage = 0; plot.growth = 0;
        this._refreshPlant(plot);
        this.game.ui.toast('🦊 ' + a.def.name + ' محصول ' + name + ' را خورد!', 'bad');
      }
    }
  };

  /* ---------------- water refill ---------------- */
  Farming.prototype.tryRefill = function () {
    const p = this.game.player, inv = this.game.inv;
    const cap = C.toolStat('can', this.game.progress.toolLevel('can')).capacity;
    if (inv.water >= cap) return false;
    // near natural water?
    let near = false;
    for (let a = 0; a < 8 && !near; a++) {
      const ang = (a / 8) * 6.283;
      if (this.game.world.isWater(p.pos.x + Math.cos(ang) * 3, p.pos.z + Math.sin(ang) * 3)) near = true;
    }
    // or inside a well's radius
    if (!near && this.game.building) near = this.game.building.wellNear(p.pos.x, p.pos.z);
    if (!near) return false;
    inv.water = cap;
    this.game.ui.toast('🪣 آبپاش پر شد (' + U.fa(cap) + ')', 'good');
    return true;
  };

  /* ---------------- persistence ---------------- */
  Farming.prototype.serialize = function () {
    const out = [];
    this.plots.forEach(function (p) {
      out.push([p.gx, p.gz, p.crop, p.stage, Math.round(p.growth * 10) / 10, Math.round(p.moisture * 100) / 100]);
    });
    return out;
  };
  Farming.prototype.deserialize = function (arr) {
    this.plots.forEach((p) => this.group.remove(p.group));
    this.plots.clear();
    if (!arr) return;
    for (const r of arr) {
      const x = r[0] * GS, z = r[1] * GS;
      const y = this.game.world.heightAt(x, z);
      const plot = {
        gx: r[0], gz: r[1], x: x, z: z, y: y,
        crop: r[2] && C.CROPS[r[2]] ? r[2] : null, stage: r[3] | 0, growth: r[4] || 0, moisture: r[5] || 0,
        group: new THREE.Group(), soil: null, plant: null
      };
      plot.group.position.set(x, y + 0.01, z);
      this.group.add(plot.group);
      this.plots.set(U.key(plot.gx, plot.gz), plot);
      this._refreshSoil(plot);
      this._refreshPlant(plot);
    }
  };

  G.Farming = Farming;
})(window.GAME = window.GAME || {});
