/* =========================================================
   progression.js — player level, six skills, tool upgrades,
   settlement tiers, population / happiness and the quest
   chain that guides the player from tent to metropolis.
   ========================================================= */
(function (G) {
  'use strict';

  const U = G.Utils, C = G.Config;

  function Progression(game) {
    this.game = game;
    this.level = 1;
    this.xp = 0;
    this.skills = Object.create(null);
    for (const s of C.SKILLS) this.skills[s.id] = { xp: 0, level: 1 };
    this.tools = Object.create(null);
    for (const k in C.START.tools) this.tools[k] = C.START.tools[k];
    this.tier = 0;
    this.stats = Object.create(null);
    this.questIndex = 0;
    this.doneQuests = Object.create(null);
    this.population = 0;
    this.happiness = 100;
    this.foodMood = 0;
    this._recalcT = 0;
  }

  /* ===================== XP ===================== */
  Progression.prototype.xpMul = function () {
    return 1 + (this.game.building ? this.game.building.totalEffect('xpBonus') : 0);
  };

  Progression.prototype.addXp = function (n) {
    if (n <= 0) return;
    this.xp += n * this.xpMul();
    let need = C.playerXpNeeded(this.level);
    while (this.xp >= need) {
      this.xp -= need;
      this.level++;
      const p = this.game.player;
      p.maxHp = C.PLAYER.hp + (this.level - 1) * 8;
      p.hp = p.maxHp;
      p.maxStamina = C.PLAYER.stamina + (this.level - 1) * 5;
      p.stamina = p.maxStamina;
      this.game.audio.levelUp();
      this.game.ui.levelUp('سطح ' + U.fa(this.level) + '!');
      need = C.playerXpNeeded(this.level);
    }
  };

  Progression.prototype.skill = function (id) { return this.skills[id] || { xp: 0, level: 1 }; };

  Progression.prototype.addSkill = function (id, n) {
    const s = this.skills[id];
    if (!s || n <= 0) return;
    s.xp += n * this.xpMul();
    let need = C.skillXpNeeded(s.level);
    while (s.xp >= need) {
      s.xp -= need;
      s.level++;
      const def = C.SKILLS.filter((x) => x.id === id)[0];
      this.game.audio.levelUp();
      this.game.ui.levelUp(def.icon + ' ' + def.name + ' سطح ' + U.fa(s.level));
      this.game.ui.toast(def.icon + ' مهارت ' + def.name + ' به سطح ' + U.fa(s.level) + ' رسید', 'gold');
      need = C.skillXpNeeded(s.level);
    }
    this.addXp(Math.round(n * 0.35));
  };

  Progression.prototype.skillProgress = function (id) {
    const s = this.skill(id);
    return { cur: s.xp, need: C.skillXpNeeded(s.level), pct: U.clamp01(s.xp / C.skillXpNeeded(s.level)) };
  };

  /* ===================== TOOLS ===================== */
  Progression.prototype.toolLevel = function (id) { return this.tools[id] || 0; };

  Progression.prototype.toolRequirement = function (id) {
    const cur = this.toolLevel(id);
    const next = cur + 1;
    const def = C.TOOLS[id];
    const workshop = this.game.building ? this.game.building.maxLevelOf('workshop') : 0;
    return {
      next: next,
      max: def.max,
      cost: C.toolUpgradeCost(id, Math.max(1, cur)),
      needWorkshop: Math.max(0, next - 1),
      haveWorkshop: workshop,
      needSkill: def.skill ? (next - 1) * 3 : 0,
      haveSkill: def.skill ? this.skill(def.skill).level : 99
    };
  };

  Progression.prototype.canUpgradeTool = function (id) {
    const r = this.toolRequirement(id);
    if (r.next > r.max) return { ok: false, why: 'در بالاترین سطح است' };
    if (r.haveWorkshop < r.needWorkshop) return { ok: false, why: 'کارگاه سطح ' + U.fa(r.needWorkshop) + ' لازم است' };
    if (r.haveSkill < r.needSkill) return { ok: false, why: 'مهارت سطح ' + U.fa(r.needSkill) + ' لازم است' };
    if (!this.game.inv.canAfford(r.cost)) return { ok: false, why: 'منابع کافی نداری', cost: r.cost };
    return { ok: true, cost: r.cost };
  };

  Progression.prototype.upgradeTool = function (id) {
    const chk = this.canUpgradeTool(id);
    if (!chk.ok) { this.game.ui.toast('🔒 ' + chk.why, 'bad'); return false; }
    this.game.inv.pay(chk.cost);
    this.tools[id] = this.toolLevel(id) + 1;
    const def = C.TOOLS[id];
    this.game.audio.upgrade();
    this.game.ui.toast('🛠️ ' + def.icon + ' ' + def.name + ' به سطح ' + U.fa(this.tools[id]) + ' ارتقا یافت', 'gold');
    this.game.ui.levelUp(def.icon + ' ' + def.name + ' ' + U.fa(this.tools[id]));
    this.game.player.refreshTool();
    this.addXp(30);
    return true;
  };

  /* ===================== STATS ===================== */
  Progression.prototype.stat = function (key, n) {
    this.stats[key] = (this.stats[key] || 0) + (n || 1);
  };
  Progression.prototype.get = function (key) { return this.stats[key] || 0; };

  /* ===================== POPULATION / HAPPINESS ===================== */
  Progression.prototype.recalc = function () {
    const b = this.game.building, s = this.game.settlers;
    /* houses are capacity, settlers are actual people — the town only
       counts someone once they have both a home and a reason to stay */
    this.housing = b ? Math.max(0, b.totalEffect('pop')) : 0;
    this.population = s ? s.population() : this.housing;
    const happy = b ? b.totalEffect('happy') : 0;
    const crowding = s && s.homeless() > 0 ? -Math.min(25, s.homeless() * 4) : 0;
    this.happiness = Math.round(U.clamp(50 + happy + this.foodMood + crowding, 0, 100));
  };

  /* ===================== TIERS ===================== */
  Progression.prototype.tierProgress = function () {
    const next = C.TIERS[this.tier + 1];
    if (!next) return null;
    const b = this.game.building;
    const have = {
      pop: this.population,
      bld: b ? b.list.length : 0,
      hall: b ? b.maxLevelOf('town_hall') : 0
    };
    const pct = Math.min(1,
      ((next.pop ? Math.min(1, have.pop / next.pop) : 1) +
        (next.bld ? Math.min(1, have.bld / next.bld) : 1) +
        (next.hall ? Math.min(1, have.hall / next.hall) : 1)) / 3
    );
    return { next: next, have: have, pct: pct };
  };

  Progression.prototype.checkTier = function () {
    const p = this.tierProgress();
    if (!p) return;
    const n = p.next;
    if (p.have.pop >= n.pop && p.have.bld >= n.bld && p.have.hall >= n.hall) {
      this.tier++;
      this.game.audio.quest();
      this.game.ui.levelUp(n.icon + ' ' + n.name + '!');
      this.game.ui.toast('🎉 آبادی تو به «' + n.name + '» ارتقا یافت! مرزها گسترش یافت.', 'gold');
      this.addXp(200 * this.tier);
      this.game.inv.addCoins(150 * this.tier);
      if (this.game.building.borderRing) {
        this.game.scene.remove(this.game.building.borderRing);
        this.game.building.borderRing.geometry.dispose();
        this.game.building.borderRing = null;
      }
    }
  };

  /* ===================== QUESTS ===================== */
  Progression.prototype.questState = function (q) {
    if (!q) return { cur: 0, need: 1 };
    let cur = 0;
    switch (q.type) {
      case 'gather': cur = this.get('gather_' + q.item); break;
      case 'till': cur = this.get('till'); break;
      case 'plant': cur = this.get('plant'); break;
      case 'harvest': cur = this.get('harvest'); break;
      case 'hunt': cur = this.get('hunt'); break;
      case 'fish': cur = this.get('fish'); break;
      case 'tier': cur = this.tier; break;
      case 'build':
        for (const id of q.any) cur += this.get('build_' + id);
        break;
      default: cur = 0;
    }
    return { cur: Math.min(cur, q.n), need: q.n, pct: U.clamp01(cur / q.n), done: cur >= q.n };
  };

  Progression.prototype.currentQuest = function () {
    return C.QUESTS[this.questIndex] || null;
  };

  Progression.prototype.checkQuests = function () {
    const q = this.currentQuest();
    if (!q) return;
    const st = this.questState(q);
    if (!st.done) return;
    this.doneQuests[q.id] = 1;
    this.questIndex++;
    this.addXp(q.xp);
    this.game.inv.addCoins(q.coin);
    if (q.item_r) for (const k in q.item_r) this.game.inv.add(k, q.item_r[k]);
    this.game.ui.toast('✅ مأموریت «' + q.name + '» کامل شد! +' + U.fa(q.coin) + ' سکه، +' + U.fa(q.xp) + ' XP', 'gold');
    this.game.audio.quest();
    this.game.ui.levelUp('✅ ' + q.name);
  };

  /* ===================== PER-FRAME ===================== */
  Progression.prototype.update = function (dt) {
    this._recalcT -= dt;
    if (this._recalcT <= 0) {
      this._recalcT = 0.75;
      this.recalc();
      this.checkTier();
      this.checkQuests();
    }
  };

  /* ===================== PERSISTENCE ===================== */
  Progression.prototype.serialize = function () {
    return {
      level: this.level, xp: this.xp, skills: this.skills, tools: this.tools,
      tier: this.tier, stats: this.stats, questIndex: this.questIndex,
      doneQuests: this.doneQuests, foodMood: this.foodMood
    };
  };
  Progression.prototype.deserialize = function (d) {
    this.level = d.level || 1;
    this.xp = d.xp || 0;
    for (const s of C.SKILLS) {
      const src = d.skills && d.skills[s.id];
      this.skills[s.id] = { xp: src ? src.xp : 0, level: src ? src.level : 1 };
    }
    this.tools = Object.create(null);
    for (const k in C.START.tools) this.tools[k] = (d.tools && d.tools[k] !== undefined) ? d.tools[k] : C.START.tools[k];
    this.tier = d.tier || 0;
    this.stats = Object.create(null);
    if (d.stats) for (const k in d.stats) this.stats[k] = d.stats[k];
    this.questIndex = d.questIndex || 0;
    this.doneQuests = d.doneQuests || Object.create(null);
    this.foodMood = d.foodMood || 0;
    this.recalc();
  };

  G.Progression = Progression;
})(window.GAME = window.GAME || {});
