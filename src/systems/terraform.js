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
  Terraform.prototype.datumNear = function (x, z, reach) {
    const world = this.game.world;
    if (!world.edits.length) return null;
    reach = reach === undefined ? L.datumReach : reach;
    let best = null, bd = reach;
    for (const e of world.edits) {
      if (e.kind !== 'flat') continue;
      // distance from the point to the platform's flat core
      const dx = Math.max(0, Math.abs(x - e.x) - e.rx);
      const dz = Math.max(0, Math.abs(z - e.z) - e.rz);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  /** the height a platform here should adopt, and why */
  Terraform.prototype.datumFor = function (x, z, natural) {
    const near = this.datumNear(x, z);
    if (near && Math.abs(near.y - natural) <= L.datumStep) return near.y;
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
    const y = opt.y === undefined ? this.datumFor(x, z, f.avg) : opt.y;
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
    const y = this.datumFor(x, z, f.avg);
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
      const y = this.datumFor(x, z, f.avg);
      if (this._covered(x, z, rx, rz, y)) return { ok: false, why: 'این زمین از قبل تخت است' };
      return { ok: true, y: y };
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

  /** run the tool. Returns a message for the toast, or null on failure. */
  Terraform.prototype.apply = function (def, x, z) {
    const t = def.terrain;
    if (t.op === 'undo') return this.restoreAt(x, z) ? '↩️ زمین به شکل طبیعی خودش برگشت' : null;
    if (t.op === 'flat') {
      const e = this.level(x, z, def.size[0] / 2, def.size[1] / 2, { edge: t.edge });
      return e ? '🟩 زمین تخت شد' : null;
    }
    return this.raise(x, z, t) ? '⛰️ ' + def.name + ' بالا آمد' : null;
  };

  G.Terraform = Terraform;
})(window.GAME = window.GAME || {});
