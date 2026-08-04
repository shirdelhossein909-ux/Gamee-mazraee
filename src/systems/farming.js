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
    this.moving = null;          // a plot lifted off the ground, following your aim
    this.ghost = null;
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

  /** closest plot to a point, optionally filtered — used so tools still work
      when the crosshair lands a little off the tile you are standing on */
  Farming.prototype.nearestPlot = function (x, z, radius, filter) {
    const cells = Math.ceil(radius / GS);
    const c = this.cell(x, z);
    let best = null, bd = radius * radius;
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dz = -cells; dz <= cells; dz++) {
        const p = this.plots.get(U.key(c.gx + dx, c.gz + dz));
        if (!p || (filter && !filter(p))) continue;
        const d = U.dist2(x, z, p.x, p.z);
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best;
  };

  /* ---------------- geometry caches ---------------- */
  Farming.prototype._soil = function (wet) {
    const k = wet ? 'w' : 'd';
    // exactly one grid cell — adjacent plots butt together with no seam
    if (!this._soilGeo[k]) this._soilGeo[k] = M.soil(GS, wet).geometry;
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
    let h = w.footprint(wx, wz, GS, GS, 0).avg;
    if (h < C.WORLD.waterLevel + 0.4) return { ok: false, why: 'زمین زیر آب است' };
    if (w.slopeAt(wx, wz, GS * 0.6) > 1.6) return { ok: false, why: 'زمین خیلی شیب‌دار است' };
    /* Terracing: a tile that touches an existing plot adopts its height, so a
       block of plots reads as one flat, evenly ploughed field rather than a
       staircase of separate patches. A big step starts a new terrace. */
    const nb = [this.plotAtCell(c.gx + 1, c.gz), this.plotAtCell(c.gx - 1, c.gz),
    this.plotAtCell(c.gx, c.gz + 1), this.plotAtCell(c.gx, c.gz - 1)];
    let sum = 0, n = 0;
    for (const p of nb) if (p && Math.abs(p.y - h) <= 1.6) { sum += p.y; n++; }
    if (n) h = sum / n;
    if (this.game.building && this.game.building.occupied(wx, wz)) return { ok: false, why: 'اینجا ساختمان است' };
    return { ok: true, gx: c.gx, gz: c.gz, x: wx, z: wz, y: h };
  };

  Farming.prototype.till = function (x, z) {
    const r = this.canTill(x, z);
    if (!r.ok) { this.game.ui.toast('⚠️ ' + r.why, 'bad'); return null; }
    const cost = C.toolStat('hoe', this.game.progress.toolLevel('hoe')).cost;
    if (!this.game.player.spend(cost)) { this.game.ui.toast('😮‍💨 انرژی کافی نداری', 'bad'); this.game.audio.deny(); return null; }
    this.game.audio.till();

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
    this.game.audio.plant();
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
    this.game.audio.pour();
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
    this.game.audio.harvest();
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
    /* soil and crop geometry is cached and shared between every plot, so
       this must NOT dispose it — only drop the group */
    this.group.remove(plot.group);
    this.plots.delete(U.key(plot.gx, plot.gz));
  };

  /* =========================================================
     EDITING A FIELD
     A ploughed strip in the wrong place used to be permanent. Now you
     can pick one up and set it down somewhere better, or clear it away
     entirely — with whatever was growing on it handled honestly.
     ========================================================= */

  /** clear a plot away. A ripe crop is harvested first; a young one is lost. */
  Farming.prototype.clear = function (plot) {
    const g = this.game;
    if (!plot) return false;
    let msg = '🪏 زمین برداشته شد';
    if (plot.crop && plot.stage >= 3) {
      this.harvest(plot);                       // do not throw away a ripe crop
      msg = '🪏 محصول برداشت شد و زمین هم برداشته شد';
    } else if (plot.crop) {
      const seed = C.CROPS[plot.crop] ? C.CROPS[plot.crop].seed : null;
      /* half the seed comes back — you did dig it up early */
      if (seed && Math.random() < 0.5) g.inv.add(seed, 1);
      msg = '🪏 زمین برداشته شد — کِشت نارس از بین رفت';
    }
    this.remove(plot);
    g.audio.till();
    g.fx.hitBurst(plot.x, plot.y + 0.3, plot.z, 0x7a5a3a, 8);
    g.ui.toast(msg, 'good');
    return true;
  };

  /** lift a plot off the ground; it follows the crosshair until you place it */
  Farming.prototype.startMove = function (plot) {
    const g = this.game;
    if (!plot) return false;
    if (this.moving) this.cancelMove();
    if (g.building.placing) g.building.cancel();
    /* remember everything worth keeping, then take it out of the world */
    this.moving = {
      crop: plot.crop, stage: plot.stage, growth: plot.growth,
      moisture: plot.moisture, from: { gx: plot.gx, gz: plot.gz },
      gx: plot.gx, gz: plot.gz, ok: true
    };
    this.remove(plot);
    this.ghost = new THREE.Group();
    this.ghost.add(new THREE.Mesh(this._soil(false).geometry.clone(), M.MAT.ghostOk));
    this.group.add(this.ghost);
    g.ui.toast('🪏 زمین را برداشتی — کلیک چپ بگذارش، ESC لغو', 'gold');
    if (g.ui.showBuildBar) g.ui.showBuildBar({ icon: '🪏', name: 'جابه‌جایی زمین کشاورزی' }, true);
    return true;
  };

  Farming.prototype.updateMove = function () {
    const g = this.game, m = this.moving;
    if (!m) return;
    const ray = g.player.aimRay();
    const hit = g.world.rayGround(ray.origin, ray.dir, 40);
    let x, z;
    if (hit) { x = hit.point.x; z = hit.point.z; }
    else { const f = g.player.frontPoint(6); x = f.x; z = f.z; }
    const c = this.cell(x, z);
    m.gx = c.gx; m.gz = c.gz;
    const r = this.canTill(c.gx * GS, c.gz * GS);
    m.ok = !!r.ok;
    m.why = r.why || '';
    const y = r.ok ? r.y : g.world.heightAt(c.gx * GS, c.gz * GS);
    this.ghost.position.set(c.gx * GS, y + 0.02, c.gz * GS);
    this.ghost.children[0].material = m.ok ? M.MAT.ghostOk : M.MAT.ghostBad;
    if (g.ui.updateBuildBar) g.ui.updateBuildBar({ icon: '🪏', name: 'جابه‌جایی زمین کشاورزی' }, m.ok ? null : m.why);
  };

  /** put it down where the ghost is */
  Farming.prototype.confirmMove = function () {
    const g = this.game, m = this.moving;
    if (!m) return false;
    if (!m.ok) { g.ui.toast('⚠️ ' + (m.why || 'اینجا نمی‌شود'), 'bad'); g.audio.deny(); return false; }
    const plot = this._restorePlot(m.gx, m.gz, m);
    this.moving = null;
    this._clearGhost();
    if (g.ui.hideBuildBar) g.ui.hideBuildBar();
    g.audio.build();
    g.ui.toast('🪏 زمین جابه‌جا شد', 'good');
    return !!plot;
  };

  Farming.prototype.cancelMove = function () {
    const m = this.moving;
    if (!m) return false;
    this.moving = null;
    this._clearGhost();
    /* always give it back, even if the old cell somehow will not take it */
    this._restorePlot(m.from.gx, m.from.gz, m);
    if (this.game.ui.hideBuildBar) this.game.ui.hideBuildBar();
    return true;
  };

  Farming.prototype._clearGhost = function () {
    if (!this.ghost) return;
    this.group.remove(this.ghost);
    this.ghost.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    this.ghost = null;
  };

  /** rebuild a plot at a cell, carrying its crop across */
  Farming.prototype._restorePlot = function (gx, gz, m) {
    const w = this.game.world;
    const wx = gx * GS, wz = gz * GS;
    const r = this.canTill(wx, wz);
    const y = r.ok ? r.y : w.footprint(wx, wz, GS, GS, 0).avg;
    const plot = {
      gx: gx, gz: gz, x: wx, z: wz, y: y,
      crop: m.crop, stage: m.stage, growth: m.growth, moisture: m.moisture,
      group: new THREE.Group(), soil: null, plant: null
    };
    plot.group.position.set(wx, y + 0.01, wz);
    this.group.add(plot.group);
    this.plots.set(U.key(gx, gz), plot);
    this._refreshSoil(plot);
    this._refreshPlant(plot);
    return plot;
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
    /* while the Simorgh's blessing holds, everything comes on in a rush */
    const bless = (this.game.myth && this.game.myth.blessed()) ? C.MYTH.simorgh.blessGrowth : 1;

    this.plots.forEach((plot) => {
      if (rain > 0) plot.moisture = Math.min(1, plot.moisture + dh * rain * 0.5);
      else if (plot.moisture > 0) plot.moisture = Math.max(0, plot.moisture - dh * 0.045);

      if (plot.crop && plot.stage < 3) {
        const def = C.CROPS[plot.crop];
        const mul = season.growth * (plot.moisture > 0.2 ? 1.6 : 1) * bless;
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
    this.game.audio.pour();
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
      const y = this.game.world.footprint(x, z, GS, GS, 0).avg;
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
