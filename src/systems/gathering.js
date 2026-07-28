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

  function nodeSphere(n) {
    if (n.kind === 'tree') {
      const h = n.obj.userData.height || 5;
      return { y: n.y + h * 0.45, r: Math.max(1.1, h * 0.22) };
    }
    if (n.kind === 'ore') return { y: n.y + 0.7, r: 1.15 };
    return { y: n.y + 0.4, r: 0.7 };
  }

  Gathering.prototype.pickTarget = function () {
    const g = this.game, p = g.player;
    const ray = p.aimRay();
    const reach = C.PLAYER.reach + 1.5;
    let best = null, bt = 1e9;

    /* animals */
    const ah = g.wildlife.rayPick(ray.origin, ray.dir, reach + 2.5);
    if (ah) { best = { kind: 'animal', animal: ah.animal, dist: ah.dist, x: ah.animal.x, z: ah.animal.z }; bt = ah.dist; }

    /* resource nodes near the player */
    const nodes = g.world.nodesNear(p.pos.x, p.pos.z, reach + 4);
    for (const n of nodes) {
      const s = nodeSphere(n);
      const t = sphereHit(ray.origin, ray.dir, n.x, s.y, n.z, s.r, reach + 2);
      if (t >= 0 && t < bt) { bt = t; best = { kind: 'node', node: n, dist: t, x: n.x, z: n.z }; }
    }

    /* buildings */
    if (g.building) {
      for (const b of g.building.list) {
        if (U.dist2(p.pos.x, p.pos.z, b.x, b.z) > 400) continue;
        const r = Math.max(b.def.size[0], b.def.size[1]) * 0.55 + 0.3;
        const t = sphereHit(ray.origin, ray.dir, b.x, b.y + 1.2, b.z, r, reach + 3);
        if (t >= 0 && t < bt) { bt = t; best = { kind: 'building', building: b, dist: t, x: b.x, z: b.z }; }
      }
    }

    /* ground / plots / water */
    const gr = g.world.rayGround(ray.origin, ray.dir, 60);
    if (gr && gr.dist < bt + 0.6) {
      const plot = g.farming.plotAt(gr.point.x, gr.point.z);
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
    if (best && best.kind !== 'ground' && best.kind !== 'water' && best.dist > C.PLAYER.reach + 2) {
      best.tooFar = true;
    }
    this.target = best;
    return best;
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
          hint: 'کلید E: اطلاعات و ارتقا',
          hp: b.maxHp ? b.hp / b.maxHp : 1
        };
      }
      case 'water':
        return { name: '💧 آب', hint: 'چوب ماهیگیری: ماهیگیری · آبپاش: پر کردن' };
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
        if (t && t.kind === 'node' && t.node.kind === 'tree' && !t.tooFar) return this._chop(t.node);
        if (t && t.kind === 'node' && t.node.kind === 'bush' && !t.tooFar) return this._forage(t.node);
        p.swing('swing'); this.cooldown = 0.35;
        break;
      }
      case 'pickaxe': {
        if (t && t.kind === 'node' && t.node.kind === 'ore' && !t.tooFar) return this._mine(t.node);
        p.swing('swing'); this.cooldown = 0.35;
        break;
      }
      case 'hoe': {
        const pt = t && t.point ? t.point : p.frontPoint(1.8);
        if (t && t.kind === 'plot') { g.ui.toast('این قطعه از قبل شخم خورده', 'bad'); return; }
        if (U.dist(p.pos.x, p.pos.z, pt.x, pt.z) > C.PLAYER.reach) { g.ui.toast('خیلی دور است', 'bad'); return; }
        p.swing('swing'); this.cooldown = 0.5;
        g.farming.till(pt.x, pt.z);
        break;
      }
      case 'seeds': {
        if (t && t.kind === 'plot' && !t.plot.crop && !t.tooFar) {
          p.swing('plant'); this.cooldown = 0.35;
          g.farming.plant(t.plot, g.inv.selectedSeed);
        } else g.ui.toast('🌱 روی یک قطعه شخم‌خورده نشانه بگیر', 'bad');
        break;
      }
      case 'can': {
        if (t && (t.kind === 'water') && !t.tooFar) { g.farming.tryRefill(); return; }
        if (t && t.kind === 'plot' && !t.tooFar) {
          const st = C.toolStat('can', prog.toolLevel('can'));
          p.swing('water'); this.cooldown = 0.35;
          g.farming.water(t.plot);
          if (st.radius) {
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
              if (!dx && !dz) continue;
              const o = g.farming.plotAtCell(t.plot.gx + dx, t.plot.gz + dz);
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
    if (!t) return;
    if (t.tooFar) { g.ui.toast('خیلی دور است', 'bad'); return; }
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
        return void g.ui.openStructure(t.building);
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
    if (!g.player.spend(st.cost)) { g.ui.toast('😮‍💨 انرژی کافی نداری', 'bad'); return; }
    g.player.swing('swing');
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
    if (!g.player.spend(st.cost)) { g.ui.toast('😮‍💨 انرژی کافی نداری', 'bad'); return; }
    g.player.swing('swing');
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
    this.cooldown = 0.45;
    const ray = p.aimRay();
    const hit = g.wildlife.rayPick(ray.origin, ray.dir, st.range + 1.5);
    const dmg = st.damage * (1 + prog.skill('combat').level * 0.05);
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
    this.cooldown = 0.62;
    const ray = p.aimRay();
    const origin = new THREE.Vector3(
      p.pos.x + ray.dir.x * 0.9,
      p.pos.y + 1.35 + ray.dir.y * 0.9,
      p.pos.z + ray.dir.z * 0.9
    );
    const dmg = st.damage * (1 + prog.skill('combat').level * 0.05);
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
