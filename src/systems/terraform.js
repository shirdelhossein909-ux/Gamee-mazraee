/* =========================================================
   terraform.js — shaping the ground.

   The world's height field is a pure function of the seed, and
   terrain.js keeps one list of exceptions to it: squares you
   levelled and hills you raised. This file is everything that
   happens *around* an edit — deciding its height, paying for it,
   rebuilding the chunks it touches and putting everything that
   was standing there back on the ground afterwards.

   Two ways in:
     • the ⛰️ زمین tab of the build menu, for deliberate work
     • automatically, under everything you build, so a town on a
       slope ends up standing on one continuous flat plane
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config;
  const L = C.LEVEL;

  function Terraform(game) {
    this.game = game;
  }

  /* ---------------------------------------------------------
     WHAT HEIGHT SHOULD THIS PLATFORM SIT AT?

     Left alone, every building would level its own little terrace
     and a town on a hillside would come out as a staircase. So a
     new platform first looks for one already nearby and simply
     joins it. That is what turns a scatter of levelled footprints
     into the single flat expanse a city wants — and it is why the
     paving lines up, because every slab shares one datum.
     --------------------------------------------------------- */
  /**
   * The nearest platform, measured from the *edge* of the square we are about
   * to lay to the edge of the one already there.
   *
   * Measuring from the centre was wrong and it showed: two 28-metre squares
   * laid side by side have centres 28 metres apart, so the second one never
   * saw the first and levelled itself to its own local average. Two blocks
   * that touch have a gap of zero and always agree now.
   */
  Terraform.prototype.datumNear = function (x, z, reach, rx, rz) {
    const world = this.game.world;
    if (!world.edits.length) return null;
    reach = reach === undefined ? L.datumReach : reach;
    rx = rx || 0; rz = rz === undefined ? rx : rz;
    let best = null, bd = reach;
    for (const e of world.edits) {
      if (e.kind !== 'flat') continue;
      const dx = Math.max(0, Math.abs(x - e.x) - e.rx - rx);
      const dz = Math.max(0, Math.abs(z - e.z) - e.rz - rz);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  /** the height a platform here should adopt, and why */
  Terraform.prototype.datumFor = function (x, z, natural, opt) {
    opt = opt || {};
    const near = this.datumNear(x, z, opt.reach, opt.rx, opt.rz);
    /* Levelling by hand is a deliberate act: if you put a second square down
       against the first, you meant them to be one surface, and how deep the
       cut has to be is not the game's business. Levelling that happens by
       itself under a building is held to a tighter step, so a house never
       silently drags a cliff into the town. */
    const step = opt.step === undefined ? L.datumStep : opt.step;
    if (near && Math.abs(near.y - natural) <= step) return near.y;
    return Math.max(natural, C.WORLD.waterLevel + L.minY);
  };

  /* ---------------------------------------------------------
     LEVELLING
     --------------------------------------------------------- */

  /** is this square already flat, at this height, inside something we levelled? */
  Terraform.prototype._covered = function (x, z, rx, rz, y) {
    for (const e of this.game.world.edits) {
      if (e.kind !== 'flat' || Math.abs(e.y - y) > 0.08) continue;
      if (Math.abs(x - e.x) + rx <= e.rx + 0.01 && Math.abs(z - e.z) + rz <= e.rz + 0.01) return true;
    }
    return false;
  };

  /**
   * Level a block of ground.
   * @param {number} rx,rz half-extents of the dead-flat core
   * @param {object} opt   {edge, y, auto, quiet}
   * @returns the edit, or null if nothing needed doing
   */
  Terraform.prototype.level = function (x, z, rx, rz, opt) {
    opt = opt || {};
    const world = this.game.world;
    const f = world.footprint(x, z, rx * 2, rz * 2, 0);
    const y = opt.y === undefined
      ? this.datumFor(x, z, f.avg, { rx: rx, rz: rz, reach: opt.reach, step: opt.step })
      : opt.y;
    if (this._covered(x, z, rx, rz, y)) return null;      // already standing on it

    /* How far the rim takes to melt back into the hillside has to follow how
       much earth was moved. A fixed two metres is right under a shed and
       absurd under a thirty-metre plaza cut six metres into a slope — it
       would leave the square standing on a cliff. Widen the blend with the
       cut, and the plaza ends on a bank you can walk up. */
    const relief = Math.max(Math.abs(f.max - y), Math.abs(f.min - y));
    const edge = Math.min(L.edgeMax,
      Math.max(opt.edge === undefined ? L.edge : opt.edge, relief * L.edgePerMetre));

    const e = world.addEdit({ kind: 'flat', x: x, z: z, rx: rx, rz: rz, edge: edge, y: y, auto: !!opt.auto });
    this.settle(x, z, Math.max(rx, rz) + edge);
    return e;
  };

  /* The ground under everything you build. Runs before the building is
     placed, so it seats itself on the level it just made. Skipped when the
     ground is already even enough to be worth nothing. */
  Terraform.prototype.autoLevel = function (def, x, z, w, d) {
    if (!G.Settings.get('autoLevel')) return null;
    const world = this.game.world;
    const rx = w / 2 + L.margin, rz = d / 2 + L.margin;
    const f = world.footprint(x, z, rx * 2, rz * 2, 0);
    const y = this.datumFor(x, z, f.avg, { rx: rx, rz: rz });
    // nothing to gain: the ground is already flat and already at that height
    if (f.flat <= L.skipFlat && Math.abs(f.avg - y) <= L.skipFlat) return null;
    void def;
    return this.level(x, z, rx, rz, { edge: L.edge, y: y, auto: true });
  };

  /* ---------------------------------------------------------
     HILLS
     --------------------------------------------------------- */
  Terraform.prototype.raise = function (x, z, t) {
    const world = this.game.world;
    const r = t.r, top = r * (1 - (t.edgeF === undefined ? 0.95 : t.edgeF));
    const e = world.addEdit({
      kind: 'hill', x: x, z: z, rx: top, rz: top, round: true,
      edge: r - top, peak: t.peak, hk: t.kind
    });
    this.settle(x, z, r + 4);
    return e;
  };

  /* ---------------------------------------------------------
     UNDO
     --------------------------------------------------------- */
  Terraform.prototype.restoreAt = function (x, z) {
    const world = this.game.world;
    const e = world.editAt(x, z);
    if (!e) return null;
    const r = Math.max(e.rx, e.rz) + e.edge;
    world.removeEdit(e);
    this.settle(e.x, e.z, r + 4);
    return e;
  };

  /* ---------------------------------------------------------
     AFTER THE GROUND MOVES

     Rebuild the chunks, then put everything that was standing on
     the old surface back on the new one. Anything missed here
     would be left hanging in the air or buried to the knee.
     --------------------------------------------------------- */
  Terraform.prototype.settle = function (x, z, radius) {
    const g = this.game, world = g.world;
    world.rebuildArea(x, z, radius);

    const r2 = (radius + 6) * (radius + 6);
    const near = function (ex, ez) { return U.dist2(x, z, ex, ez) <= r2; };

    if (g.building) {
      for (const b of g.building.list) {
        if (!near(b.x, b.z)) continue;
        b.y = world.footprint(b.x, b.z, b.w, b.d, 0).avg;
        b.obj.position.y = b.y;
      }
      g.building._recenter();
    }
    if (g.farming) {
      g.farming.plots.forEach(function (p) {
        if (!near(p.x, p.z)) return;
        p.y = world.heightAt(p.x, p.z);
        p.group.position.y = p.y + 0.01;
      });
    }
    if (g.player) {
      const p = g.player.pos;
      if (near(p.x, p.z)) {
        const h = world.heightAt(p.x, p.z);
        if (p.y < h || p.y > h + 0.6) { p.y = h; g.player.vel.y = 0; }
      }
    }
    const drop = function (list) {
      if (!list) return;
      for (const o of list) {
        if (o.dead || !near(o.x, o.z)) continue;
        o.y = world.heightAt(o.x, o.z);
      }
    };
    if (g.villagers) drop(g.villagers.list);
    if (g.horses) drop(g.horses.list);
    if (g.wildlife) drop(g.wildlife.animals);
    /* boats, cars and companions already ease toward their own resting
       height every frame, so they find the new ground by themselves */
  };

  /* ---------------------------------------------------------
     THE BUILD-MENU TOOLS
     --------------------------------------------------------- */

  /* Levelling you asked for, rather than levelling that happened under a
     building: it reaches further for a neighbouring square to match, and it
     will match one however deep the cut has to be. Laying the second block
     against the first means you want one surface.

     The reach scales with the block, because "next to" means something
     different for a ten-metre yard and a twenty-eight-metre plaza. */
  const HAND = { step: 1e9 };
  function handOpt(def) {
    const w = def ? Math.max(def.size[0], def.size[1]) : 10;
    return { step: HAND.step, reach: Math.max(8, w * 0.8) };
  }

  /* ---------------------------------------------------------
     THE LATTICE

     The first square goes exactly where you aim. Every one after it snaps
     to the grid that square set up, so squares click together edge to edge
     instead of landing wherever the crosshair happened to be — which is
     what made matching heights feel like luck, and what turned levelling a
     yard into a dozen careful little steps.
     --------------------------------------------------------- */
  Terraform.prototype.latticeAnchor = function (def, x, z) {
    const world = this.game.world;
    if (!world.edits.length) return null;
    const rx = def.size[0] / 2, rz = def.size[1] / 2;
    const w = def.size[0], d = def.size[1];
    const span = Math.max(w, d) * 3.5;         // how far the grid keeps its hold
    let best = null, bd = span;
    for (const e of world.edits) {
      // only squares laid by hand, and only ones of this same size
      if (e.kind !== 'flat' || e.auto) continue;
      if (Math.abs(e.rx - rx) > 0.01 || Math.abs(e.rz - rz) > 0.01) continue;
      const dd = Math.max(Math.abs(x - e.x), Math.abs(z - e.z));
      if (dd < bd) { bd = dd; best = e; }
    }
    if (!best) return null;
    return {
      x: best.x + Math.round((x - best.x) / w) * w,
      z: best.z + Math.round((z - best.z) / d) * d,
      of: best
    };
  };

  /** can this land tool be used here? mirrors Building.validate's contract */
  Terraform.prototype.check = function (def, x, z) {
    const g = this.game, world = g.world, t = def.terrain;
    if (t.op === 'undo') {
      const e = world.editAt(x, z);
      if (!e) return { ok: false, why: 'اینجا زمین دست‌کاری‌شده‌ای نیست' };
      return { ok: true, y: world.heightAt(x, z) };
    }
    if (t.op === 'flat') {
      const rx = def.size[0] / 2, rz = def.size[1] / 2;
      const f = world.footprint(x, z, rx * 2, rz * 2, 0);
      if (f.max < C.WORLD.waterLevel + 0.2) return { ok: false, why: 'اینجا زیر آب است' };
      const opt = handOpt(def);
      opt.rx = rx; opt.rz = rz;
      const y = this.datumFor(x, z, f.avg, opt);
      if (this._covered(x, z, rx, rz, y)) return { ok: false, why: 'این زمین از قبل تخت است' };
      const near = this.datumNear(x, z, opt.reach, rx, rz);
      return { ok: true, y: y, note: near ? 'هم‌تراز قطعهٔ کناری' : null };
    }
    if (t.op === 'field') {
      const y = world.heightAt(x, z);
      if (y < C.WORLD.waterLevel + 0.4) return { ok: false, why: 'زمین زیر آب است' };
      /* Levelling comes first, so judge the block on the ground it will have
         rather than the ground it has — otherwise a field on a gentle slope
         refuses itself and then flattens perfectly the moment you move on. */
      const fits = this._fieldFits(def, x, z);
      if (!fits.any) return { ok: false, why: fits.why };
      return { ok: true, y: y, fits: fits.ok };
    }
    // a hill would bury whatever is standing there
    const r = t.r;
    for (const b of g.building.list) {
      if (U.dist2(x, z, b.x, b.z) < (r + Math.max(b.w, b.d) * 0.5) * (r + Math.max(b.w, b.d) * 0.5)) {
        return { ok: false, why: 'زیرش ساختمان هست — تپه رویش را می‌پوشاند' };
      }
    }
    let plot = false;
    g.farming.plots.forEach(function (p) { if (U.dist2(x, z, p.x, p.z) < r * r) plot = true; });
    if (plot) return { ok: false, why: 'زیرش زمین کشاورزی هست' };
    if (world.heightAt(x, z) < C.WORLD.waterLevel - 1.2) return { ok: false, why: 'وسط آب نمی‌شود تپه ساخت' };
    return { ok: true, y: world.heightAt(x, z) };
  };

  /* Would this field take? Anything already ploughed is fine — it just does
     not get ploughed twice — and slopes are forgiven by the width of what
     levelling is about to do to them. */
  Terraform.prototype._fieldFits = function (def, x, z) {
    const g = this.game;
    const n = def.terrain.n;
    const f = g.farming.blockFits(x, z, n);
    if (f.taken === f.total) return { any: false, why: 'اینجا از قبل شخم خورده' };
    if (f.ok === 0) {
      // levelling will fix a slope; a building or the sea it will not
      const free = f.total - f.taken;
      if (this._willLevelField(def, x, z)) return { any: true, ok: free };
      return { any: false, why: 'زمین اینجا خیلی شیب‌دار یا اشغال است' };
    }
    return { any: true, ok: f.ok };
  };

  Terraform.prototype._willLevelField = function (def, x, z) {
    if (!G.Settings.get('autoLevel')) return false;
    const w = this.game.world;
    const half = def.size[0] / 2;
    // nothing to level onto if it is water or somebody's roof
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const px = x + i * half, pz = z + j * half;
        if (w.heightAt(px, pz) < C.WORLD.waterLevel + 0.4) return false;
        if (this.game.building.occupied(px, pz)) return false;
      }
    }
    return true;
  };

  /** run the tool. Returns a message for the toast, or null on failure. */
  Terraform.prototype.apply = function (def, x, z) {
    const t = def.terrain;
    if (t.op === 'undo') return this.restoreAt(x, z) ? '↩️ زمین به شکل طبیعی خودش برگشت' : null;
    if (t.op === 'field') {
      /* Flatten first: a field wants to be one even bed, and the hoe refuses
         a slope steeper than it can plough. This is what makes a big field
         land in one piece on ground you would otherwise have to terrace. */
      if (G.Settings.get('autoLevel')) {
        this.level(x, z, def.size[0] / 2, def.size[1] / 2, { auto: true });
      }
      const made = this.game.farming.tillBlock(x, z, t.n);
      if (!made) return null;
      return '🌾 ' + U.fa(made) + ' قطعه زمین آماده شد';
    }
    if (t.op === 'flat') {
      const rx = def.size[0] / 2, rz = def.size[1] / 2;
      const opt = handOpt(def);
      // ask before levelling: afterwards the nearest square is our own
      const joined = !!this.datumNear(x, z, opt.reach, rx, rz);
      const e = this.level(x, z, rx, rz, { edge: t.edge, step: opt.step, reach: opt.reach });
      if (!e) return null;
      return joined ? '🟩 زمین تخت شد — هم‌تراز قطعهٔ کناری' : '🟩 زمین تخت شد';
    }
    return this.raise(x, z, t) ? '⛰️ ' + def.name + ' بالا آمد' : null;
  };

  G.Terraform = Terraform;
})(window.GAME = window.GAME || {});
