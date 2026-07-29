/* =========================================================
   gathering.js — everything the left mouse button does:
   targeting, chopping, mining, foraging, melee, archery,
   the fishing mini-game and eating.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config, M = G.Meshes;

  function Gathering(game) {
    this.game = game;
    this.target = null;
    this.fishing = null;
    this.cooldown = 0;
    this._shake = [];
  }

  /* =========================================================
     TARGETING
     ========================================================= */
  function sphereHit(origin, dir, cx, cy, cz, r, maxT) {
    const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
    const t = ox * dir.x + oy * dir.y + oz * dir.z;
    if (t < -r || t > maxT) return -1;
    const px = ox - dir.x * t, py = oy - dir.y * t, pz = oz - dir.z * t;
    if (px * px + py * py + pz * pz > r * r) return -1;
    return Math.max(0, t);
  }

  /** where hit sparks and damage numbers appear */
  function nodeSphere(n) {
    if (n.kind === 'tree') {
      const h = n.obj.userData.height || 5;
      return { y: n.y + h * 0.45, r: Math.max(1.1, h * 0.22) };
    }
    if (n.kind === 'ore') return { y: n.y + 0.7, r: 1.15 };
    return { y: n.y + 0.4, r: 0.7 };
  }

  /* A tree is a tall thin thing: one sphere in the canopy means aiming at the
     trunk — which is what you naturally do up close — misses entirely. Walk a
     few spheres up the trunk instead so the whole tree is clickable. */
  function nodeHit(n, origin, dir, maxT) {
    if (n.kind === 'tree') {
      const h = n.obj.userData.height || 5;
      const r = Math.max(0.95, h * 0.17);
      let best = -1;
      for (let i = 0; i < 4; i++) {
        const y = n.y + 0.55 + h * 0.78 * (i / 3);
        const t = sphereHit(origin, dir, n.x, y, n.z, i === 0 ? r * 0.8 : r, maxT);
        if (t >= 0 && (best < 0 || t < best)) best = t;
      }
      return best;
    }
    if (n.kind === 'ore') return sphereHit(origin, dir, n.x, n.y + 0.7, n.z, 1.25, maxT);
    return sphereHit(origin, dir, n.x, n.y + 0.4, n.z, 0.85, maxT);
  }

  Gathering.prototype.pickTarget = function () {
    const g = this.game, p = g.player;
    const ray = p.aimRay();
    /* The ray starts at the CAMERA, which sits several metres behind the
       player, so every ray budget has to include that offset — otherwise a
       tree two steps away sits past the cut-off and is never even seen. */
    const camOff = Math.hypot(
      ray.origin.x - p.pos.x,
      ray.origin.y - (p.pos.y + 1.4),
      ray.origin.z - p.pos.z
    );
    const reach = C.PLAYER.reach;
    const maxT = camOff + reach + 3;
    let best = null, bt = 1e9;

    /* animals */
    const ah = g.wildlife.rayPick(ray.origin, ray.dir, maxT + 2);
    if (ah) { best = { kind: 'animal', animal: ah.animal, dist: ah.dist, x: ah.animal.x, z: ah.animal.z }; bt = ah.dist; }

    /* resource nodes near the player */
    const nodes = g.world.nodesNear(p.pos.x, p.pos.z, reach + 6);
    for (const n of nodes) {
      const t = nodeHit(n, ray.origin, ray.dir, maxT);
      if (t >= 0 && t < bt) { bt = t; best = { kind: 'node', node: n, dist: t, x: n.x, z: n.z }; }
    }

    /* buildings */
    if (g.building) {
      for (const b of g.building.list) {
        if (U.dist2(p.pos.x, p.pos.z, b.x, b.z) > 900) continue;
        const r = Math.max(b.def.size[0], b.def.size[1]) * 0.55 + 0.3;
        const t = sphereHit(ray.origin, ray.dir, b.x, b.y + 1.2, b.z, r, maxT + 2);
        if (t >= 0 && t < bt) { bt = t; best = { kind: 'building', building: b, dist: t, x: b.x, z: b.z }; }
      }
    }

    /* vehicles */
    if (g.vehicles) {
      for (const v of g.vehicles.list) {
        if (v.mounted) continue;
        const t = sphereHit(ray.origin, ray.dir, v.x, v.y + 0.9, v.z, 1.7, maxT + 2);
        if (t >= 0 && t < bt) { bt = t; best = { kind: 'vehicle', vehicle: v, dist: t, x: v.x, z: v.z }; }
      }
    }

    /* horses */
    if (g.horses) {
      for (const h of g.horses.list) {
        if (h.mounted) continue;
        const t = sphereHit(ray.origin, ray.dir, h.x, h.y + 1.3, h.z, 1.5, maxT + 2);
        if (t >= 0 && t < bt) { bt = t; best = { kind: 'horse', horse: h, dist: t, x: h.x, z: h.z }; }
      }
    }

    /* ground / plots / water */
    const gr = g.world.rayGround(ray.origin, ray.dir, camOff + 60);
    if (gr && gr.dist < bt + 0.6) {
      // snap to a plot the crosshair lands just short of or beside
      const plot = g.farming.plotAt(gr.point.x, gr.point.z) ||
        g.farming.nearestPlot(gr.point.x, gr.point.z, C.WORLD.gridSize * 0.85);
      const water = gr.point.y < C.WORLD.waterLevel + 0.05;
      if (plot && gr.dist < bt) {
        best = { kind: 'plot', plot: plot, dist: gr.dist, point: gr.point, x: plot.x, z: plot.z };
      } else if (!best || gr.dist < bt) {
        best = {
          kind: water ? 'water' : 'ground', dist: gr.dist, point: gr.point,
          x: gr.point.x, z: gr.point.z
        };
      }
    }
    /* "too far" is about the PLAYER's arm, never the camera boom */
    if (best) {
      best.playerDist = U.dist(p.pos.x, p.pos.z, best.x, best.z);
      if (best.kind !== 'ground' && best.kind !== 'water') {
        let allow = reach;
        if (best.kind === 'node') allow += best.node.kind === 'tree' ? 1.6 : 1.0;
        if (best.kind === 'building') allow += Math.max(best.building.w, best.building.d) * 0.5;
        if (best.kind === 'vehicle') allow += 1.2;
        if (best.kind === 'horse') allow = Math.max(allow, C.HORSE.tameRange);
        best.tooFar = best.playerDist > allow;
      }
    }
    this.target = best;
    return best;
  };

  /* Which node does an axe/pickaxe swing at? The crosshair takes priority,
     but standing close to a tree makes you look slightly *past* or *below*
     it, so fall back to whatever matching node is in reach and in front. */
  Gathering.prototype.nodeFor = function (kind) {
    const t = this.target;
    if (t && t.kind === 'node' && t.node.kind === kind && !t.tooFar) return t.node;
    const p = this.game.player;
    const allow = C.PLAYER.reach + (kind === 'tree' ? 1.6 : 1.0);
    const list = this.game.world.nodesNear(p.pos.x, p.pos.z, allow);
    /* "in front" means where the camera is aimed — the body's yaw lags a few
       frames behind on the swing and would reject the tree you are facing */
    const dir = p.aimRay().dir;
    let fx = dir.x, fz = dir.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    let best = null, bs = -1;
    for (const n of list) {
      if (n.kind !== kind) continue;
      const dx = n.x - p.pos.x, dz = n.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > allow) continue;
      const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      if (dot < 0.15) continue;                  // roughly in front of us
      const score = dot - d * 0.08;
      if (score > bs) { bs = score; best = n; }
    }
    return best;
  };

  /* Which plot does a farming tool act on? Prefer what the crosshair is on,
     but fall back to the tile underfoot and then the closest one in reach —
     aiming precisely at a tile you are already standing on is fiddly. */
  Gathering.prototype.plotFor = function (filter) {
    const g = this.game, p = g.player;
    const t = this.target;
    if (t && t.kind === 'plot' && !t.tooFar && (!filter || filter(t.plot))) return t.plot;
    const under = g.farming.plotAt(p.pos.x, p.pos.z);
    if (under && (!filter || filter(under))) return under;
    let from = p.pos;
    if (t && t.point) from = t.point;
    return g.farming.nearestPlot(from.x, from.z, C.PLAYER.reach, filter) ||
      g.farming.nearestPlot(p.pos.x, p.pos.z, C.PLAYER.reach, filter);
  };

  /** short label + hint shown under the crosshair */
  Gathering.prototype.describe = function (t) {
    if (!t) return null;
    const prog = this.game.progress;
    switch (t.kind) {
      case 'animal':
        return {
          name: t.animal.def.icon + ' ' + t.animal.def.name,
          hint: 'کلیک چپ: حمله',
          hp: t.animal.hp / t.animal.maxHp
        };
      case 'node': {
        const n = t.node;
        if (n.kind === 'tree') {
          const need = n.def.lvl || 1;
          return {
            name: '🌳 ' + n.name,
            hint: prog.toolLevel('axe') >= need ? 'کلیک چپ با تبر' : '🔒 تبر سطح ' + U.fa(need) + ' لازم است',
            hp: n.hp / n.maxHp
          };
        }
        if (n.kind === 'ore') {
          const need = n.def.lvl;
          return {
            name: '⛏️ ' + n.name,
            hint: prog.toolLevel('pickaxe') >= need ? 'کلیک چپ با کلنگ' : '🔒 کلنگ سطح ' + U.fa(need) + ' لازم است',
            hp: n.hp / n.maxHp
          };
        }
        return { name: '🌿 ' + n.name, hint: 'کلید E: جمع‌آوری', hp: n.hp / n.maxHp };
      }
      case 'plot': {
        const p = t.plot;
        if (!p.crop) return { name: '🟫 زمین شخم‌خورده', hint: 'کلید E یا بذر: کاشت' };
        const cd = C.CROPS[p.crop];
        if (p.stage >= 3) return { name: cd.icon + ' ' + cd.name + ' (رسیده)', hint: 'کلید E: برداشت', hp: 1 };
        return {
          name: cd.icon + ' ' + cd.name + ' — مرحله ' + U.fa(p.stage + 1) + '/۴',
          hint: p.moisture > 0.25 ? '💧 آبیاری‌شده' : 'آبپاش: آبیاری',
          hp: p.growth / cd.growH
        };
      }
      case 'building': {
        const b = t.building;
        return {
          name: b.def.icon + ' ' + b.def.name + ' — سطح ' + U.fa(b.level),
          hint: b.defId === 'council' ? 'کلید E: تعیین وظیفهٔ اهالی' : 'کلید E: اطلاعات و ارتقا',
          hp: b.maxHp ? b.hp / b.maxHp : 1
        };
      }
      case 'vehicle': {
        const v = t.vehicle;
        return { name: v.def.icon + ' ' + v.def.name + ' — سطح ' + U.fa(v.level), hint: 'کلید E یا V: سوار شدن' };
      }
      case 'horse': {
        const h = t.horse;
        if (!h.tame) {
          return {
            name: '🐎 اسب وحشی',
            hint: 'کلید E را نگه دار تا با طناب رامش کنی (' + U.fa(C.HORSE.ropeCost.fiber) + ' الیاف)'
          };
        }
        return {
          name: '🐎 ' + h.name + (h.stabled ? ' — در اصطبل' : ''),
          hint: h.rider ? 'یکی از اهالی سوارش است' : 'کلید E یا V: سوار شدن · ببرش کنار اصطبل تا آنجا بماند'
        };
      }
      case 'water':
        return { name: '💧 آب', hint: 'چوب ماهیگیری: ماهیگیری · آبپاش: پر کردن · شنا: مستقیم برو داخل' };
      default:
        return null;
    }
  };

  /* =========================================================
     TOOL USE (left click)
     ========================================================= */
  Gathering.prototype.use = function (toolId) {
    const g = this.game, p = g.player, prog = g.progress;
    if (this.cooldown > 0) return;
    if (this.fishing) { this.reelIn(); return; }
    const t = this.target;

    switch (toolId) {
      case 'axe': {
        const tree = this.nodeFor('tree');
        if (tree) return this._chop(tree);
        const bush = this.nodeFor('bush');
        if (bush) return this._forage(bush);
        p.swing('swing'); g.audio.swing(); this.cooldown = 0.35;
        break;
      }
      case 'pickaxe': {
        const ore = this.nodeFor('ore');
        if (ore) return this._mine(ore);
        p.swing('swing'); g.audio.swing(); this.cooldown = 0.35;
        break;
      }
      case 'hoe': {
        let pt = t && t.point ? t.point : p.frontPoint(1.8);
        if (t && t.kind === 'plot') { g.ui.toast('این قطعه از قبل شخم خورده', 'bad'); return; }
        // aiming past arm's length still tills the ground right in front of you
        if (U.dist(p.pos.x, p.pos.z, pt.x, pt.z) > C.PLAYER.reach + 0.5) pt = p.frontPoint(2.0);
        p.swing('swing'); this.cooldown = 0.5;
        g.farming.till(pt.x, pt.z);
        break;
      }
      case 'seeds': {
        const plot = this.plotFor(function (x) { return !x.crop; });
        if (plot) {
          p.swing('plant'); this.cooldown = 0.35;
          g.farming.plant(plot, g.inv.selectedSeed);
        } else {
          g.ui.toast('🌱 اول زمین را شخم بزن (کلید ۱)', 'bad');
          g.audio.deny();
        }
        break;
      }
      case 'can': {
        if (t && t.kind === 'water' && !t.tooFar) { g.farming.tryRefill(); return; }
        /* An empty can beside a well or a stream fills itself first. Without
           this you would stand at the well swinging a dry can at the crops. */
        if (g.inv.water <= 0 && g.farming.tryRefill()) return;
        const plot = this.plotFor(function (x) { return x.moisture < 0.8; }) || this.plotFor();
        if (plot) {
          const st = C.toolStat('can', prog.toolLevel('can'));
          p.swing('water'); this.cooldown = 0.35;
          g.farming.water(plot);
          if (st.radius) {
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
              if (!dx && !dz) continue;
              const o = g.farming.plotAtCell(plot.gx + dx, plot.gz + dz);
              if (o && g.inv.water > 0) g.farming.water(o);
            }
          }
        } else if (!g.farming.tryRefill()) {
          g.ui.toast('🪣 نزدیک آب یا چاه برو تا پر شود', 'bad');
        }
        break;
      }
      case 'sword': return this._melee();
      case 'bow': return this._shoot();
      case 'rod': return this.castLine();
      case 'food': return this.eat();
      default:
        p.swing('swing'); this.cooldown = 0.3;
    }
  };

  /* =========================================================
     INTERACT (E)
     ========================================================= */
  Gathering.prototype.interact = function () {
    const g = this.game, t = this.target;
    if (this.fishing) { this.reelIn(); return; }
    /* a ripe crop in reach is always worth grabbing, even if the crosshair
       drifted onto the grass next to it */
    const ripe = this.plotFor(function (x) { return x.crop && x.stage >= 3; });
    if (ripe && (!t || t.kind !== 'building') && g.farming.harvest(ripe)) return;
    if (!t || t.kind === 'ground') {
      // nothing under the crosshair: forage or chop whatever is within arm's reach
      const n = this.nodeFor('bush') || this.nodeFor('tree') || this.nodeFor('ore');
      if (n) return n.kind === 'bush' ? this._forage(n) : n.kind === 'tree' ? this._chop(n) : this._mine(n);
    }
    if (!t) return;
    if (t.tooFar) { g.ui.toast('خیلی دور است', 'bad'); g.audio.deny(); return; }
    switch (t.kind) {
      case 'node':
        if (t.node.kind === 'bush') return this._forage(t.node);
        if (t.node.kind === 'tree') return this._chop(t.node);
        return this._mine(t.node);
      case 'plot':
        if (t.plot.crop && t.plot.stage >= 3) return void g.farming.harvest(t.plot);
        if (!t.plot.crop) return void g.farming.plant(t.plot, g.inv.selectedSeed);
        if (t.plot.moisture < 0.25) return void g.farming.water(t.plot);
        g.ui.toast('🌱 هنوز رسیده نیست', 'bad');
        return;
      case 'building':
        if (t.building.defId === 'council') return void g.ui.openPanel('jobs');
        // walking up to a well and pressing E should draw water, not open a panel
        if (t.building.defId === 'well' && g.farming.tryRefill()) return;
        return void g.ui.openStructure(t.building);
      case 'vehicle':
        return void g.vehicles.mount(t.vehicle);
      case 'horse':
        return void g.horses.mount(t.horse);
      case 'water':
        if (!g.farming.tryRefill()) this.castLine();
        return;
    }
  };

  /* =========================================================
     NODE HARVESTING
     ========================================================= */
  Gathering.prototype._chop = function (node) {
    const g = this.game, prog = g.progress;
    const lvl = prog.toolLevel('axe');
    if (lvl < 1) { g.ui.toast('🪓 تبر نداری', 'bad'); return; }
    if ((node.def.lvl || 1) > lvl) {
      g.ui.toast('🔒 برای ' + node.name + ' به تبر سطح ' + U.fa(node.def.lvl) + ' نیاز داری', 'bad'); return;
    }
    const st = C.toolStat('axe', lvl);
    if (!g.player.spend(st.cost)) { g.ui.toast('😮‍💨 انرژی کافی نداری', 'bad'); g.audio.deny(); return; }
    g.player.swing('swing');
    g.audio.chop();
    this.cooldown = 0.42;
    this._damageNode(node, st.power, 'woodcut', st.bonus, 0x4f7f3a);
  };

  Gathering.prototype._mine = function (node) {
    const g = this.game, prog = g.progress;
    const lvl = prog.toolLevel('pickaxe');
    if (lvl < 1) { g.ui.toast('⛏️ کلنگ نداری', 'bad'); return; }
    if (node.def.lvl > lvl) {
      g.ui.toast('🔒 برای ' + node.name + ' به کلنگ سطح ' + U.fa(node.def.lvl) + ' نیاز داری', 'bad'); return;
    }
    const st = C.toolStat('pickaxe', lvl);
    if (!g.player.spend(st.cost)) { g.ui.toast('😮‍💨 انرژی کافی نداری', 'bad'); g.audio.deny(); return; }
    g.player.swing('swing');
    g.audio.mine();
    this.cooldown = 0.45;
    this._damageNode(node, st.power, 'mining', st.bonus, node.def.crystal || 0x9c9c96);
  };

  Gathering.prototype._forage = function (node) {
    const g = this.game;
    g.player.swing('plant');
    this.cooldown = 0.3;
    this._damageNode(node, 99, 'farming', 0, node.def.b || 0x8fbf5c);
  };

  Gathering.prototype._damageNode = function (node, power, skillId, bonus, color) {
    const g = this.game;
    node.hp -= power;
    const s = nodeSphere(node);
    g.fx.hitBurst(node.x, s.y, node.z, color, 9);
    this._shake.push({ obj: node.obj, t: 0.32, x: node.x, y: node.y - 0.1, z: node.z });

    if (node.hp > 0) {
      g.ui.damageNumber(node.obj, Math.round(power), s.y - node.y);
      return;
    }

    /* collapsed — hand out drops */
    if (node.kind === 'tree') g.audio.treeFall();
    else if (node.kind === 'ore') g.audio.rockBreak();
    else g.audio.harvest();
    const prog = g.progress;
    const skillLvl = prog.skill(skillId).level;
    const got = [];
    const roll = (table, mul) => {
      for (const k in table) {
        const r = table[k];
        let n = Math.floor(r[0] + Math.random() * (r[1] - r[0] + 1));
        n = Math.round(n * (1 + bonus + skillLvl * 0.035) * (mul || 1));
        if (n > 0 && g.inv.add(k, n)) got.push({ id: k, n: n });
      }
    };
    roll(node.def.drop, 1);
    if (node.def.extra) roll(node.def.extra, 1);

    prog.addSkill(skillId, node.def.xp);
    prog.addXp(Math.round(node.def.xp * 0.5));
    for (const gitem of got) prog.stat('gather_' + gitem.id, gitem.n);
    prog.stat(node.kind === 'ore' ? 'mine' : node.kind === 'tree' ? 'chop' : 'forage', 1);

    if (got.length) {
      g.ui.toast(got.map((x) => C.ITEMS[x.id].icon + ' ' + U.fa(x.n) + '× ' + C.ITEMS[x.id].name).join('، '), 'good');
    }
    g.fx.hitBurst(node.x, s.y, node.z, color, 20);
    const respawn = node.kind === 'ore' ? 6 : node.kind === 'bush' ? 2 : C.WORLD.nodeRespawn;
    g.world.removeNode(node, respawn);
    this.target = null;
  };

  /* =========================================================
     COMBAT
     ========================================================= */
  Gathering.prototype._melee = function () {
    const g = this.game, p = g.player, prog = g.progress;
    const lvl = prog.toolLevel('sword');
    if (lvl < 1) { g.ui.toast('🗡️ شمشیر نداری', 'bad'); return; }
    const st = C.toolStat('sword', lvl);
    if (!p.spend(st.cost)) { g.ui.toast('😮‍💨 نفس کم آوردی', 'bad'); return; }
    p.swing('swing');
    g.audio.swing();
    this.cooldown = 0.45;
    const ray = p.aimRay();
    // swing from the player's chest, not from the camera behind them
    const from = new THREE.Vector3(p.pos.x, p.pos.y + 1.2, p.pos.z);
    const hit = g.wildlife.rayPick(from, ray.dir, st.range + 1.5);
    const dmg = st.damage * (1 + prog.skill('combat').level * 0.05) * prog.powerMul();
    if (hit) g.wildlife.hit(hit.animal, dmg, p.pos.x, p.pos.z);
    else {
      // wide sweep fallback so melee still connects at close range
      const a = g.wildlife.nearest(p.pos.x, p.pos.z, st.range * 0.8, false);
      if (a) g.wildlife.hit(a, dmg * 0.85, p.pos.x, p.pos.z);
    }
  };

  Gathering.prototype._shoot = function () {
    const g = this.game, p = g.player, prog = g.progress;
    const lvl = prog.toolLevel('bow');
    if (lvl < 1) { g.ui.toast('🏹 کمان نداری — در کارگاه بساز', 'bad'); return; }
    const st = C.toolStat('bow', lvl);
    if (!p.spend(st.cost)) { g.ui.toast('😮‍💨 نفس کم آوردی', 'bad'); return; }
    p.swing('bow');
    g.audio.bow();
    this.cooldown = 0.62;
    const ray = p.aimRay();
    const origin = new THREE.Vector3(
      p.pos.x + ray.dir.x * 0.9,
      p.pos.y + 1.35 + ray.dir.y * 0.9,
      p.pos.z + ray.dir.z * 0.9
    );
    const dmg = st.damage * (1 + prog.skill('combat').level * 0.05) * prog.powerMul();
    g.wildlife.shoot(origin, ray.dir.clone(), dmg, st.range);
  };

  /* =========================================================
     FISHING
     ========================================================= */
  Gathering.prototype.nearWater = function () {
    const p = this.game.player;
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * 6.283;
      for (const r of [2.5, 4.5, 6.5]) {
        if (this.game.world.isWater(p.pos.x + Math.cos(ang) * r, p.pos.z + Math.sin(ang) * r)) return true;
      }
    }
    return false;
  };

  Gathering.prototype.castLine = function () {
    const g = this.game, prog = g.progress;
    if (this.fishing) return;
    if (prog.toolLevel('rod') < 1) { g.ui.toast('🎣 چوب ماهیگیری نداری', 'bad'); return; }
    if (!this.nearWater()) { g.ui.toast('🎣 باید کنار آب باشی', 'bad'); return; }
    if (!g.player.spend(C.toolStat('rod', 1).cost)) { g.ui.toast('😮‍💨 انرژی کافی نداری', 'bad'); return; }

    g.player.swing('cast');
    g.audio.cast();
    const lvl = prog.toolLevel('rod');
    const skill = prog.skill('fishing').level;
    const zone = U.clamp(0.16 + lvl * 0.028 + skill * 0.006, 0.16, 0.44);
    this.fishing = {
      pos: 0, dir: 1,
      speed: 0.85 + Math.random() * 0.35 + Math.max(0, 0.5 - lvl * 0.06),
      zoneA: 0.12 + Math.random() * (0.88 - zone - 0.12),
      zoneW: zone,
      tries: 3, wait: 0.9 + Math.random() * 1.8, biting: false
    };
    g.ui.showFishing(this.fishing);
  };

  Gathering.prototype.updateFishing = function (dt) {
    const f = this.fishing;
    if (!f) return;
    if (!f.biting) {
      f.wait -= dt;
      if (f.wait <= 0) {
        f.biting = true;
        this.game.audio.bite();
        this.game.ui.toast('🎣 یک چیزی گیر کرد!', 'gold');
      } else return;
    }
    f.pos += f.dir * f.speed * dt;
    if (f.pos > 1) { f.pos = 1; f.dir = -1; }
    if (f.pos < 0) { f.pos = 0; f.dir = 1; }
    this.game.ui.updateFishing(f);
  };

  Gathering.prototype.reelIn = function () {
    const g = this.game, f = this.fishing;
    if (!f) return;
    if (!f.biting) { this.cancelFishing(); return; }
    const inZone = f.pos >= f.zoneA && f.pos <= f.zoneA + f.zoneW;
    if (inZone) { this._catch(); return; }
    f.tries--;
    g.ui.updateFishing(f);
    if (f.tries <= 0) {
      g.ui.toast('🐟 ماهی فرار کرد', 'bad');
      this.cancelFishing();
    } else {
      f.speed *= 1.12;
      f.zoneA = 0.12 + Math.random() * (0.88 - f.zoneW - 0.12);
    }
  };

  Gathering.prototype._catch = function () {
    const g = this.game, prog = g.progress;
    const rodLvl = prog.toolLevel('rod');
    const skill = prog.skill('fishing').level;
    const dock = g.building ? g.building.totalEffect('fishing') : 0;
    const opts = [];
    for (const f of C.FISH) {
      if (f.tier > rodLvl + 1) continue;
      let w = f.w;
      if (f.tier > 1) w *= 1 + skill * 0.08 + rodLvl * 0.18 + dock * 0.25;
      opts.push([f, w]);
    }
    const pickd = U.weighted(opts);
    const n = 1 + (Math.random() < skill * 0.02 ? 1 : 0);
    g.inv.add(pickd.id, n);
    prog.addSkill('fishing', pickd.xp);
    prog.addXp(Math.round(pickd.xp * 0.5));
    prog.stat('fish', 1);
    g.audio.reel();
    g.audio.splash(false);
    g.audio.harvest();
    g.ui.toast('🎣 ' + C.ITEMS[pickd.id].icon + ' ' + C.ITEMS[pickd.id].name + ' گرفتی!', 'good');
    g.fx.hitBurst(g.player.pos.x, g.player.pos.y + 1, g.player.pos.z, 0x5fc8ff, 14);
    this.cancelFishing();
  };

  Gathering.prototype.cancelFishing = function () {
    this.fishing = null;
    this.game.ui.hideFishing();
  };

  /* =========================================================
     EATING
     ========================================================= */
  Gathering.prototype.eat = function () {
    const g = this.game, inv = g.inv;
    let id = inv.selectedFood;
    if (!inv.has(id, 1)) {
      const l = inv.foodList();
      if (!l.length) { g.ui.toast('🍖 غذایی نداری', 'bad'); return; }
      id = inv.selectedFood = l[0];
    }
    const f = C.FOOD[id];
    inv.remove(id, 1);
    g.player.feed(f.energy);
    g.player.heal(f.hp);
    g.player.stamina = Math.min(g.player.maxStamina, g.player.stamina + f.energy * 0.6);
    g.player.swing('water');
    this.cooldown = 0.5;
    if (f.full) {
      g.player.hp = g.player.maxHp;
      g.player.stamina = g.player.maxStamina;
      g.audio.levelUp();
      g.fx.hitBurst(g.player.pos.x, g.player.pos.y + 1.3, g.player.pos.z, 0xff4d6a, 22);
      g.ui.toast('❤️ ' + C.ITEMS[id].name + ' — جانت کامل پر شد!', 'gold');
      return;
    }
    g.audio.eat();
    g.ui.toast('😋 ' + C.ITEMS[id].name + ' خوردی (+' + U.fa(f.energy) + ' انرژی)', 'good');
  };

  /* =========================================================
     PER-FRAME
     ========================================================= */
  Gathering.prototype.update = function (dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.updateFishing(dt);
    // little wobble on freshly hit props
    for (let i = this._shake.length - 1; i >= 0; i--) {
      const s = this._shake[i];
      s.t -= dt;
      const o = s.obj;
      if (!o.parent) { U.swapRemove(this._shake, i); continue; }
      if (s.t <= 0) {
        o.position.set(s.x, s.y, s.z);
        o.rotation.z = 0;
        if (o.matrixAutoUpdate === false) o.updateMatrix();
        U.swapRemove(this._shake, i);
      } else {
        const k = s.t * Math.sin(s.t * 55) * 0.12;
        o.position.set(s.x + k, s.y, s.z);
        o.rotation.z = k * 0.5;
        if (o.matrixAutoUpdate === false) o.updateMatrix();
      }
    }
    if (this.fishing && !this.nearWater()) this.cancelFishing();
  };

  G.Gathering = Gathering;
})(window.GAME = window.GAME || {});
