/* =========================================================
   config.js — all game content & balance in one place.
   Items, crops, ores, tools, buildings, animals, skills,
   settlement tiers, quests, weather & seasons.
   ========================================================= */
(function (G) {
  'use strict';

  const C = {};

  /* ===================== WORLD ===================== */
  C.WORLD = {
    chunkSize: 48,        // world units per chunk edge
    segments: 24,         // terrain quads per chunk edge (2u each)
    viewRadius: 3,        // chunks kept alive around the player
    waterLevel: 0,        // world Y of sea/lake surface
    baseRadius: 30,       // flattened starting farm radius
    baseHeight: 2.4,      // Y of the starting plateau
    gridSize: 2,          // farming / building placement grid
    maxSlopeBuild: 0.5,   // max height delta allowed under a footprint
    nodeRespawn: 3        // in-game days before trees/bushes regrow
  };

  /* ===================== TIME ===================== */
  C.TIME = {
    dayLength: 720,       // real seconds for a full 24h cycle
    startHour: 7,
    daysPerSeason: 7,
    dawn: 5.5, sunrise: 7, sunset: 19, dusk: 20.5
  };

  C.SEASONS = [
    { id: 'spring', name: 'بهار', icon: '🌸', growth: 1.15, rain: 0.32, snow: 0 },
    { id: 'summer', name: 'تابستان', icon: '☀️', growth: 1.0, rain: 0.14, snow: 0 },
    { id: 'autumn', name: 'پاییز', icon: '🍂', growth: 0.85, rain: 0.38, snow: 0 },
    { id: 'winter', name: 'زمستان', icon: '❄️', growth: 0.55, rain: 0.15, snow: 0.45 }
  ];

  C.WEATHER = {
    clear: { name: 'صاف', icon: '☀️', fog: 0.9, light: 1.0, water: 0 },
    cloudy: { name: 'ابری', icon: '☁️', fog: 1.15, light: 0.78, water: 0 },
    rain: { name: 'بارانی', icon: '🌧️', fog: 1.5, light: 0.55, water: 0.5 },
    storm: { name: 'طوفانی', icon: '⛈️', fog: 1.9, light: 0.4, water: 1 },
    snow: { name: 'برفی', icon: '🌨️', fog: 1.7, light: 0.66, water: 0.2 },
    fog: { name: 'مه‌آلود', icon: '🌫️', fog: 2.6, light: 0.7, water: 0 }
  };

  /* ===================== BIOMES ===================== */
  C.BIOMES = {
    ocean: { name: 'دریا', c1: 0x2f6f8f, c2: 0x3a7f9c, tree: 0, rock: 0 },
    beach: { name: 'ساحل', c1: 0xdcc98a, c2: 0xcbb877, tree: 0.02, rock: 0.02 },
    plains: { name: 'دشت', c1: 0x6ba24e, c2: 0x7bb45a, tree: 0.10, rock: 0.05 },
    forest: { name: 'جنگل', c1: 0x3f7a3c, c2: 0x4c8c45, tree: 0.62, rock: 0.06 },
    desert: { name: 'کویر', c1: 0xd9c07e, c2: 0xe3cb8c, tree: 0.03, rock: 0.10 },
    savanna: { name: 'علفزار', c1: 0x9aad55, c2: 0xa8b962, tree: 0.14, rock: 0.07 },
    rocky: { name: 'کوهستان', c1: 0x8b8b86, c2: 0x9b9b95, tree: 0.06, rock: 0.42 },
    snow: { name: 'برف‌گیر', c1: 0xe9f0f4, c2: 0xdbe6ec, tree: 0.10, rock: 0.16 },
    swamp: { name: 'مرداب', c1: 0x51663f, c2: 0x5c7348, tree: 0.30, rock: 0.04 }
  };

  /* ===================== ITEMS ===================== */
  /* cat: res | crop | seed | food | animal | fish | craft */
  const IT = {};
  function item(id, name, icon, value, cat, desc) {
    IT[id] = { id, name, icon, value, cat, desc: desc || '' };
  }

  // raw resources
  item('wood', 'چوب', '🪵', 3, 'res', 'ماده اولیه اکثر ساختمان‌ها');
  item('plank', 'تخته', '🪑', 9, 'craft', 'چوب فرآوری‌شده برای بناهای پیشرفته');
  item('stone', 'سنگ', '🪨', 4, 'res', 'از معادن سنگ و صخره‌ها');
  item('brick', 'آجر', '🧱', 12, 'craft', 'سنگ پخته‌شده، محکم‌تر');
  item('clay', 'رس', '🟤', 5, 'res', 'کنار آب پیدا می‌شود');
  item('coal', 'زغال‌سنگ', '⚫', 8, 'res', 'سوخت کوره‌ها');
  item('iron_ore', 'سنگ‌آهن', '🪙', 12, 'res', 'در کوره به آهن تبدیل می‌شود');
  item('iron', 'شمش آهن', '⚙️', 30, 'craft', 'برای ابزار و ساختمان‌های سنگین');
  item('gold_ore', 'سنگ طلا', '🟡', 28, 'res', 'کمیاب، در دل کوه‌ها');
  item('gold', 'شمش طلا', '🥇', 70, 'craft', 'ارزشمندترین فلز');
  item('gem', 'جواهر', '💎', 160, 'res', 'بسیار کمیاب');
  item('fiber', 'الیاف', '🌾', 2, 'res', 'از بوته‌های علفی');
  item('cloth', 'پارچه', '🧵', 16, 'craft', 'از الیاف و پشم');

  // crops
  item('wheat', 'گندم', '🌾', 9, 'crop');
  item('carrot', 'هویج', '🥕', 12, 'crop');
  item('potato', 'سیب‌زمینی', '🥔', 14, 'crop');
  item('corn', 'ذرت', '🌽', 20, 'crop');
  item('tomato', 'گوجه', '🍅', 22, 'crop');
  item('pumpkin', 'کدوتنبل', '🎃', 34, 'crop');
  item('melon', 'هندوانه', '🍉', 42, 'crop');
  item('grape', 'انگور', '🍇', 55, 'crop');

  // animal products
  item('meat', 'گوشت', '🍖', 16, 'animal');
  item('hide', 'پوست خام', '🟫', 14, 'animal');
  item('leather', 'چرم', '👝', 32, 'craft');
  item('feather', 'پر', '🪶', 6, 'animal');
  item('milk', 'شیر', '🥛', 18, 'animal');
  item('egg', 'تخم‌مرغ', '🥚', 11, 'animal');
  item('wool', 'پشم', '🧶', 20, 'animal');

  // fish
  item('fish_carp', 'کپور', '🐟', 14, 'fish');
  item('fish_trout', 'قزل‌آلا', '🐠', 26, 'fish');
  item('fish_salmon', 'سالمون', '🍣', 48, 'fish');
  item('fish_gold', 'ماهی طلایی', '🐡', 130, 'fish');

  // food & processed
  item('flour', 'آرد', '🌾', 22, 'craft');
  item('bread', 'نان', '🍞', 40, 'food', 'بازیابی ۳۵ انرژی');
  item('stew', 'خورش', '🍲', 75, 'food', 'بازیابی ۶۰ انرژی و ۲۵ جان');
  item('jam', 'مربا', '🍯', 60, 'food', 'بازیابی ۴۵ انرژی');
  item('cheese', 'پنیر', '🧀', 55, 'food', 'بازیابی ۴۰ انرژی');
  item('salad', 'سالاد', '🥗', 38, 'food', 'بازیابی ۳۰ انرژی');

  C.ITEMS = IT;

  /* energy restored by edible items */
  C.FOOD = {
    bread: { energy: 35, hp: 5 },
    stew: { energy: 60, hp: 25 },
    jam: { energy: 45, hp: 8 },
    cheese: { energy: 40, hp: 10 },
    salad: { energy: 30, hp: 6 },
    milk: { energy: 18, hp: 4 },
    egg: { energy: 12, hp: 2 },
    meat: { energy: 26, hp: 12 },
    carrot: { energy: 10, hp: 1 },
    tomato: { energy: 10, hp: 1 },
    melon: { energy: 22, hp: 3 },
    grape: { energy: 16, hp: 2 },
    fish_carp: { energy: 20, hp: 6 },
    fish_trout: { energy: 26, hp: 9 },
    fish_salmon: { energy: 34, hp: 14 },
    fish_gold: { energy: 60, hp: 40 }
  };

  /* ===================== CROPS ===================== */
  /* growH = in-game hours to fully grow (watering ≈ x1.6) */
  const CR = {};
  function crop(id, name, icon, growH, seedPrice, yieldMin, yieldMax, lvl, colA, colB, tall) {
    const sid = 'seed_' + id;
    IT[sid] = { id: sid, name: 'بذر ' + name, icon: '🌱', value: Math.round(seedPrice * 0.5), cat: 'seed' };
    CR[id] = { id, seed: sid, name, icon, growH, seedPrice, yield: [yieldMin, yieldMax], lvl, colA, colB, tall, xp: Math.round(growH * 1.6) };
  }
  crop('wheat', 'گندم', '🌾', 8, 12, 2, 3, 1, 0x7ba842, 0xe0c164, 1.0);
  crop('carrot', 'هویج', '🥕', 10, 18, 2, 3, 1, 0x4f8b3a, 0xe07b2a, 0.55);
  crop('potato', 'سیب‌زمینی', '🥔', 12, 22, 2, 4, 2, 0x4a7c36, 0xc39a5e, 0.5);
  crop('corn', 'ذرت', '🌽', 16, 34, 2, 3, 3, 0x5d9440, 0xf2d24b, 1.5);
  crop('tomato', 'گوجه', '🍅', 14, 38, 3, 5, 4, 0x3f7a3c, 0xd23b32, 0.95);
  crop('pumpkin', 'کدوتنبل', '🎃', 20, 60, 1, 2, 6, 0x497a34, 0xe08a25, 0.6);
  crop('melon', 'هندوانه', '🍉', 24, 82, 1, 2, 8, 0x3e7a35, 0x4ea84a, 0.55);
  crop('grape', 'انگور', '🍇', 30, 120, 2, 4, 11, 0x4b7d3b, 0x7b4bab, 1.3);
  C.CROPS = CR;

  /* ===================== TREES / ROCKS / ORES ===================== */
  C.TREES = {
    oak: { name: 'بلوط', hp: 5, drop: { wood: [3, 5] }, extra: { fiber: [0, 2] }, xp: 6, trunk: 0x6b4a2c, leaf: 0x3f7f3a, h: [4.5, 7], lvl: 1 },
    pine: { name: 'کاج', hp: 6, drop: { wood: [4, 6] }, extra: {}, xp: 8, trunk: 0x5a3f28, leaf: 0x2f6b45, h: [6, 9.5], lvl: 1 },
    birch: { name: 'توس', hp: 4, drop: { wood: [3, 4] }, extra: { fiber: [1, 2] }, xp: 6, trunk: 0xd8d2c2, leaf: 0x8ab84e, h: [4.5, 6.5], lvl: 1 },
    palm: { name: 'نخل', hp: 5, drop: { wood: [2, 4] }, extra: {}, xp: 7, trunk: 0x9a7b43, leaf: 0x5fa04a, h: [6, 8], lvl: 1 },
    dead: { name: 'درخت خشک', hp: 3, drop: { wood: [2, 3] }, extra: {}, xp: 4, trunk: 0x6a5c4c, leaf: 0x6a5c4c, h: [3.5, 5], lvl: 1 },
    ancient: { name: 'درخت کهن', hp: 14, drop: { wood: [10, 16] }, extra: { fiber: [2, 5] }, xp: 30, trunk: 0x4e3a24, leaf: 0x2c5f34, h: [10, 14], lvl: 3 }
  };

  C.ORES = {
    stone: { name: 'صخره سنگی', hp: 5, drop: { stone: [3, 5] }, extra: { clay: [0, 1] }, xp: 6, lvl: 1, c: 0x8d8d88, crystal: 0x9c9c96, rare: 1.0 },
    coal: { name: 'رگه زغال', hp: 7, drop: { coal: [2, 4] }, extra: { stone: [1, 2] }, xp: 12, lvl: 2, c: 0x6e6e6e, crystal: 0x2a2a2a, rare: 0.45 },
    iron: { name: 'رگه آهن', hp: 10, drop: { iron_ore: [2, 3] }, extra: { stone: [1, 2] }, xp: 20, lvl: 3, c: 0x8a8177, crystal: 0xb98a5e, rare: 0.3 },
    gold: { name: 'رگه طلا', hp: 14, drop: { gold_ore: [1, 3] }, extra: { stone: [1, 2] }, xp: 38, lvl: 4, c: 0x8d8878, crystal: 0xf0c437, rare: 0.13 },
    gem: { name: 'رگه جواهر', hp: 20, drop: { gem: [1, 2] }, extra: { stone: [2, 3] }, xp: 70, lvl: 5, c: 0x77808d, crystal: 0x49d8e8, rare: 0.05 }
  };

  C.BUSHES = {
    berry: { name: 'بوته توت', hp: 2, drop: { fiber: [1, 2] }, extra: { jam: [0, 1] }, xp: 3, c: 0x4a8040, b: 0xc2344f },
    grass: { name: 'بوته علف', hp: 1, drop: { fiber: [1, 3] }, extra: { seed_wheat: [0, 1] }, xp: 2, c: 0x7aa84e, b: 0x8fbf5c }
  };

  /* ===================== TOOLS ===================== */
  /* slot = hotbar index (0-based) */
  C.TOOLS = {
    hoe: { id: 'hoe', name: 'بیل', icon: '🚜', slot: 0, max: 5, skill: 'farming', desc: 'شخم زدن زمین برای کاشت' },
    can: { id: 'can', name: 'آبپاش', icon: '🪣', slot: 1, max: 5, skill: 'farming', desc: 'آبیاری محصولات — رشد ۱.۶ برابر' },
    seeds: { id: 'seeds', name: 'بذر', icon: '🌱', slot: 2, max: 1, skill: 'farming', desc: 'کاشت بذر انتخاب‌شده (کلید R برای تعویض)' },
    axe: { id: 'axe', name: 'تبر', icon: '🪓', slot: 3, max: 5, skill: 'woodcut', desc: 'قطع درختان' },
    pickaxe: { id: 'pickaxe', name: 'کلنگ', icon: '⛏️', slot: 4, max: 5, skill: 'mining', desc: 'استخراج معادن — سطح بالاتر = معدن بهتر' },
    sword: { id: 'sword', name: 'شمشیر', icon: '🗡️', slot: 5, max: 5, skill: 'combat', desc: 'نبرد نزدیک با حیوانات وحشی' },
    bow: { id: 'bow', name: 'کمان', icon: '🏹', slot: 6, max: 5, skill: 'combat', desc: 'شکار از راه دور' },
    rod: { id: 'rod', name: 'چوب ماهیگیری', icon: '🎣', slot: 7, max: 5, skill: 'fishing', desc: 'ماهیگیری در آب' },
    food: { id: 'food', name: 'غذا', icon: '🍖', slot: 8, max: 1, skill: null, desc: 'خوردن غذا برای بازیابی انرژی' }
  };

  /* per-level stats */
  C.toolStat = function (id, lvl) {
    switch (id) {
      case 'hoe': return { power: 1, radius: lvl >= 4 ? 1 : 0, cost: Math.max(1, 4 - lvl * 0.5) };
      case 'can': return { capacity: 8 + lvl * 6, radius: lvl >= 3 ? 1 : 0 };
      case 'axe': return { power: 1 + lvl * 0.7, bonus: (lvl - 1) * 0.18, cost: Math.max(1.2, 4 - lvl * 0.4) };
      case 'pickaxe': return { power: 1 + lvl * 0.7, tier: lvl, bonus: (lvl - 1) * 0.18, cost: Math.max(1.2, 4.5 - lvl * 0.45) };
      case 'sword': return { damage: 9 + lvl * 7, range: 3.0 + lvl * 0.12, cost: Math.max(2, 6 - lvl * 0.5) };
      case 'bow': return { damage: 7 + lvl * 6, range: 26 + lvl * 5, cost: Math.max(2, 5 - lvl * 0.4) };
      case 'rod': return { tier: lvl, speed: 1 + lvl * 0.14, cost: 4 };
      default: return {};
    }
  };

  /* cost to go from lvl -> lvl+1 */
  C.toolUpgradeCost = function (id, lvl) {
    const f = Math.pow(2.05, lvl - 1);
    const base = {
      hoe: { wood: 6, stone: 4 }, can: { wood: 5, iron_ore: 1 },
      axe: { wood: 8, stone: 5 }, pickaxe: { wood: 6, stone: 8 },
      sword: { wood: 4, iron_ore: 4 }, bow: { wood: 10, fiber: 6 },
      rod: { wood: 8, fiber: 4 }
    }[id] || { wood: 5 };
    const out = { coin: Math.round(50 * f) };
    for (const k in base) out[k] = Math.max(1, Math.round(base[k] * f));
    if (lvl >= 2) out.iron = Math.max(1, Math.round(lvl * 1.5));
    if (lvl >= 4) out.gold = lvl - 2;
    return out;
  };

  /* ===================== SKILLS ===================== */
  C.SKILLS = [
    { id: 'farming', name: 'کشاورزی', icon: '🌾', desc: 'برداشت بیشتر و رشد سریع‌تر' },
    { id: 'mining', name: 'معدن‌کاری', icon: '⛏️', desc: 'استخراج سریع‌تر و منابع بیشتر' },
    { id: 'woodcut', name: 'چوب‌بری', icon: '🪓', desc: 'چوب بیشتر از هر درخت' },
    { id: 'fishing', name: 'ماهیگیری', icon: '🎣', desc: 'شانس ماهی کمیاب بالاتر' },
    { id: 'combat', name: 'نبرد', icon: '⚔️', desc: 'آسیب بیشتر و جان بالاتر' },
    { id: 'building', name: 'معماری', icon: '🏗️', desc: 'تخفیف ساخت و ساختمان‌های جدید' }
  ];
  C.skillXpNeeded = (lvl) => Math.round(60 * Math.pow(lvl, 1.55));
  C.playerXpNeeded = (lvl) => Math.round(150 * Math.pow(lvl, 1.42));

  /* ===================== BUILDINGS ===================== */
  /* cat: farm | home | prod | def | city  */
  const B = {};
  function bld(o) { B[o.id] = o; return o; }
  const scale = (base, lvl, f) => {
    const out = {}; const m = Math.pow(f || 1.8, lvl - 1);
    for (const k in base) out[k] = Math.max(1, Math.round(base[k] * m));
    return out;
  };

  bld({
    id: 'tent', name: 'چادر', icon: '⛺', cat: 'home', model: 'tent', size: [2, 2], max: 3, tier: 0, sk: 0,
    desc: 'سرپناه ساده. جای زندگی ۲ نفر.',
    cost: (l) => scale({ wood: 8, fiber: 6 }, l, 2.0),
    effects: (l) => ({ pop: 2 * l, happy: -1 })
  });
  bld({
    id: 'house', name: 'خانه', icon: '🏠', cat: 'home', model: 'house', size: [4, 4], max: 5, tier: 0, sk: 0,
    desc: 'خانه اهالی. با ارتقا طبقه اضافه می‌شود و جمعیت بیشتری جا می‌گیرد.',
    cost: (l) => Object.assign(scale({ wood: 30, stone: 10 }, l), { coin: Math.round(60 * Math.pow(1.9, l - 1)) }),
    effects: (l) => ({ pop: 4 + (l - 1) * 4, happy: 2 })
  });
  bld({
    id: 'well', name: 'چاه آب', icon: '⛲', cat: 'farm', model: 'well', size: [2, 2], max: 3, tier: 0, sk: 0,
    desc: 'پر کردن آبپاش بدون رفتن به رودخانه.',
    cost: (l) => scale({ stone: 20, wood: 8 }, l),
    effects: (l) => ({ water: 8 + l * 4, happy: 1 })
  });
  bld({
    id: 'silo', name: 'سیلو', icon: '🛢️', cat: 'farm', model: 'silo', size: [3, 3], max: 5, tier: 0, sk: 1,
    desc: 'ظرفیت نگهداری محصولات را افزایش می‌دهد.',
    cost: (l) => scale({ wood: 25, stone: 15 }, l),
    effects: (l) => ({ storage: 60 * l })
  });
  bld({
    id: 'warehouse', name: 'انبار بزرگ', icon: '🏚️', cat: 'city', model: 'shed', size: [5, 4], max: 5, tier: 1, sk: 3,
    desc: 'ظرفیت کل کوله‌پشتی و انبار را خیلی زیاد می‌کند.',
    cost: (l) => Object.assign(scale({ wood: 60, stone: 30, plank: 10 }, l), { coin: Math.round(120 * Math.pow(1.9, l - 1)) }),
    effects: (l) => ({ storage: 150 * l })
  });
  bld({
    id: 'coop', name: 'مرغداری', icon: '🐔', cat: 'farm', model: 'coop', size: [3, 3], max: 5, tier: 0, sk: 1,
    desc: 'تولید خودکار تخم‌مرغ و پر.',
    cost: (l) => scale({ wood: 22, fiber: 10 }, l),
    produce: (l) => ({ out: { egg: l, feather: Math.ceil(l / 2) }, hours: 10 }),
    effects: () => ({ happy: 1 })
  });
  bld({
    id: 'barn', name: 'طویله', icon: '🐄', cat: 'farm', model: 'barn', size: [5, 4], max: 5, tier: 1, sk: 2,
    desc: 'نگهداری دام؛ با مصرف گندم شیر و پشم تولید می‌کند.',
    cost: (l) => Object.assign(scale({ wood: 45, stone: 15 }, l), { coin: Math.round(90 * Math.pow(1.85, l - 1)) }),
    produce: (l) => ({ inp: { wheat: l }, out: { milk: l, wool: Math.ceil(l / 2) }, hours: 12 }),
    effects: () => ({ happy: 1 })
  });
  bld({
    id: 'sawmill', name: 'چوب‌بری', icon: '🪚', cat: 'prod', model: 'sawmill', size: [4, 4], max: 5, tier: 1, sk: 2,
    desc: 'چوب را به تخته تبدیل می‌کند و مقداری چوب هم خودش تولید می‌کند.',
    cost: (l) => scale({ wood: 40, stone: 20, iron: 2 }, l),
    produce: (l) => ({ inp: { wood: 2 * l }, out: { plank: l, wood: l }, hours: 8 })
  });
  bld({
    id: 'quarry', name: 'سنگ‌بری', icon: '🧱', cat: 'prod', model: 'quarry', size: [4, 4], max: 5, tier: 1, sk: 2,
    desc: 'تولید پیوستهٔ سنگ و آجر.',
    cost: (l) => scale({ wood: 30, stone: 40, iron: 2 }, l),
    produce: (l) => ({ inp: { coal: 1 }, out: { stone: 3 * l, brick: l }, hours: 9 })
  });
  bld({
    id: 'mine_shaft', name: 'دهانه معدن', icon: '⛏️', cat: 'prod', model: 'mine', size: [4, 4], max: 5, tier: 2, sk: 4,
    desc: 'استخراج خودکار زغال و سنگ‌آهن (و از سطح ۴، طلا).',
    cost: (l) => Object.assign(scale({ wood: 50, stone: 60, iron: 6 }, l), { coin: Math.round(200 * Math.pow(1.9, l - 1)) }),
    produce: (l) => ({ out: l >= 4 ? { coal: 2 * l, iron_ore: l, gold_ore: 1 } : { coal: 2 * l, iron_ore: Math.ceil(l / 2) }, hours: 10 })
  });
  bld({
    id: 'smelter', name: 'کوره ذوب', icon: '🔥', cat: 'prod', model: 'smelter', size: [3, 3], max: 5, tier: 2, sk: 4,
    desc: 'سنگ‌آهن و سنگ طلا را با زغال به شمش تبدیل می‌کند.',
    cost: (l) => scale({ stone: 55, brick: 10, iron: 4 }, l),
    produce: (l) => ({ inp: { iron_ore: l, coal: l }, out: { iron: l }, hours: 7 })
  });
  bld({
    id: 'windmill', name: 'آسیاب بادی', icon: '🌬️', cat: 'prod', model: 'mill', size: [4, 4], max: 5, tier: 1, sk: 3,
    desc: 'گندم را آرد می‌کند. پره‌هایش با باد می‌چرخد.',
    cost: (l) => Object.assign(scale({ wood: 55, stone: 25, cloth: 4 }, l), { coin: Math.round(140 * Math.pow(1.85, l - 1)) }),
    produce: (l) => ({ inp: { wheat: 2 * l }, out: { flour: l }, hours: 8 })
  });
  bld({
    id: 'bakery', name: 'نانوایی', icon: '🍞', cat: 'prod', model: 'bakery', size: [4, 3], max: 5, tier: 2, sk: 4,
    desc: 'آرد را نان می‌کند؛ نان انرژی و شادی می‌دهد.',
    cost: (l) => scale({ brick: 25, wood: 25, plank: 8 }, l),
    produce: (l) => ({ inp: { flour: l }, out: { bread: l }, hours: 6 }),
    effects: () => ({ happy: 3 })
  });
  bld({
    id: 'kitchen', name: 'آشپزخانه شهر', icon: '🍲', cat: 'prod', model: 'bakery', size: [4, 3], max: 5, tier: 2, sk: 5,
    desc: 'گوشت و سبزیجات را به خورش تبدیل می‌کند.',
    cost: (l) => scale({ brick: 30, plank: 12, iron: 4 }, l),
    produce: (l) => ({ inp: { meat: l, carrot: l, potato: l }, out: { stew: l }, hours: 10 }),
    effects: () => ({ happy: 4 })
  });
  bld({
    id: 'market', name: 'بازارچه', icon: '🏪', cat: 'city', model: 'shop', size: [4, 3], max: 5, tier: 1, sk: 3,
    desc: 'هر روز بر اساس جمعیت و شادی، درآمد سکه دارد.',
    cost: (l) => Object.assign(scale({ wood: 35, stone: 15, cloth: 3 }, l), { coin: Math.round(150 * Math.pow(1.9, l - 1)) }),
    effects: (l) => ({ income: 25 * l, happy: 2 })
  });
  bld({
    id: 'tavern', name: 'مهمان‌سرا', icon: '🍺', cat: 'city', model: 'tavern', size: [5, 4], max: 5, tier: 2, sk: 5,
    desc: 'شادی اهالی را بالا می‌برد و درآمد شبانه دارد.',
    cost: (l) => Object.assign(scale({ wood: 60, brick: 20, plank: 10 }, l), { coin: Math.round(260 * Math.pow(1.9, l - 1)) }),
    effects: (l) => ({ happy: 8 + l * 2, income: 18 * l, pop: 2 })
  });
  bld({
    id: 'workshop', name: 'کارگاه', icon: '🛠️', cat: 'city', model: 'workshop', size: [4, 4], max: 5, tier: 0, sk: 1,
    desc: 'برای ارتقای ابزارها لازم است. سطح کارگاه سقف سطح ابزار را تعیین می‌کند.',
    cost: (l) => scale({ wood: 30, stone: 20, iron: 1 }, l),
    effects: () => ({ happy: 1 })
  });
  bld({
    id: 'school', name: 'مدرسه', icon: '🏫', cat: 'city', model: 'school', size: [5, 4], max: 5, tier: 3, sk: 7,
    desc: 'تجربه بیشتری از همه کارها می‌گیری (+٪ به XP).',
    cost: (l) => Object.assign(scale({ brick: 45, plank: 25, iron: 8 }, l), { coin: Math.round(400 * Math.pow(1.85, l - 1)) }),
    effects: (l) => ({ happy: 5, xpBonus: 0.08 * l, pop: 2 })
  });
  bld({
    id: 'town_hall', name: 'تالار شهر', icon: '🏛️', cat: 'city', model: 'hall', size: [6, 5], max: 5, tier: 1, sk: 3,
    desc: 'قلب شهر. برای ارتقای سطح آبادی به شهر لازم است و مرزها را گسترش می‌دهد.',
    cost: (l) => Object.assign(scale({ wood: 70, stone: 60, plank: 15, iron: 5 }, l), { coin: Math.round(350 * Math.pow(2.0, l - 1)) }),
    effects: (l) => ({ happy: 6, pop: 3, income: 12 * l, border: 22 * l })
  });
  bld({
    id: 'fountain', name: 'فواره', icon: '⛲', cat: 'city', model: 'fountain', size: [3, 3], max: 3, tier: 2, sk: 4,
    desc: 'زیبایی شهر. شادی اهالی را زیاد می‌کند.',
    cost: (l) => scale({ stone: 45, brick: 15 }, l),
    effects: (l) => ({ happy: 7 * l })
  });
  bld({
    id: 'lamp', name: 'چراغ خیابان', icon: '🏮', cat: 'city', model: 'lamp', size: [1, 1], max: 3, tier: 0, sk: 1,
    desc: 'شب‌ها نور می‌دهد و حیوانات وحشی را دور نگه می‌دارد.',
    cost: (l) => scale({ wood: 6, iron: 1, coal: 2 }, l),
    effects: (l) => ({ happy: 1, defense: l })
  });
  bld({
    id: 'dock', name: 'اسکله', icon: '⚓', cat: 'farm', model: 'dock', size: [3, 5], max: 3, tier: 1, sk: 2,
    desc: 'باید کنار آب ساخته شود. شانس ماهی کمیاب را بالا می‌برد.',
    cost: (l) => scale({ wood: 30, plank: 6 }, l),
    effects: (l) => ({ fishing: l, happy: 1 }), water: true
  });
  bld({
    id: 'fence', name: 'حصار چوبی', icon: '🪵', cat: 'def', model: 'fence', size: [1, 1], max: 3, tier: 0, sk: 0,
    desc: 'جلوی حیوانات وحشی را می‌گیرد. ارزان و سریع.',
    cost: (l) => scale({ wood: 4 }, l, 2.2),
    effects: (l) => ({ defense: l, block: true }), hp: (l) => 40 * l
  });
  bld({
    id: 'stone_wall', name: 'دیوار سنگی', icon: '🧱', cat: 'def', model: 'wall', size: [1, 1], max: 3, tier: 1, sk: 2,
    desc: 'دیوار محکم؛ حیوانات بزرگ هم نمی‌توانند بشکنندش.',
    cost: (l) => scale({ stone: 8, brick: 2 }, l, 2.2),
    effects: (l) => ({ defense: 2 * l, block: true }), hp: (l) => 140 * l
  });
  bld({
    id: 'gate', name: 'دروازه', icon: '🚪', cat: 'def', model: 'gate', size: [2, 1], max: 3, tier: 1, sk: 2,
    desc: 'از آن رد می‌شوی ولی حیوانات نه.',
    cost: (l) => scale({ wood: 12, iron: 2 }, l),
    effects: (l) => ({ defense: l, block: true, passable: true }), hp: (l) => 100 * l
  });
  bld({
    id: 'guard_tower', name: 'برج نگهبانی', icon: '🗼', cat: 'def', model: 'tower', size: [3, 3], max: 5, tier: 1, sk: 3,
    desc: 'به حیوانات مهاجم نزدیک تیر می‌زند. برد و آسیبش با سطح زیاد می‌شود.',
    cost: (l) => Object.assign(scale({ wood: 40, stone: 30, iron: 4 }, l), { coin: Math.round(120 * Math.pow(1.9, l - 1)) }),
    effects: (l) => ({ defense: 4 * l, range: 16 + l * 4, dps: 6 + l * 5 }), hp: (l) => 200 * l
  });
  C.BUILDINGS = B;

  C.BUILD_CATS = [
    { id: 'farm', name: '🌾 مزرعه' },
    { id: 'home', name: '🏠 مسکونی' },
    { id: 'prod', name: '🏭 تولیدی' },
    { id: 'city', name: '🏛️ شهری' },
    { id: 'def', name: '🛡️ دفاعی' }
  ];

  /* ===================== ANIMALS ===================== */
  C.ANIMALS = {
    rabbit: {
      id: 'rabbit', name: 'خرگوش', icon: '🐇', model: 'rabbit', hostile: false, flee: true,
      hp: 8, speed: 5.2, dmg: 0, xp: 5, size: 0.55, biomes: ['plains', 'forest', 'savanna'],
      drop: { meat: [1, 1] }, extra: { hide: [0, 1] }, night: 0.4, weight: 3
    },
    chicken: {
      id: 'chicken', name: 'مرغ وحشی', icon: '🐓', model: 'chicken', hostile: false, flee: true,
      hp: 6, speed: 3.4, dmg: 0, xp: 4, size: 0.5, biomes: ['plains', 'savanna', 'beach'],
      drop: { meat: [1, 1], feather: [1, 3] }, extra: { egg: [0, 1] }, night: 0.2, weight: 2
    },
    deer: {
      id: 'deer', name: 'گوزن', icon: '🦌', model: 'deer', hostile: false, flee: true,
      hp: 22, speed: 6.4, dmg: 0, xp: 16, size: 1.15, biomes: ['forest', 'plains', 'snow'],
      drop: { meat: [2, 3], hide: [1, 2] }, extra: {}, night: 0.5, weight: 2.4
    },
    fox: {
      id: 'fox', name: 'روباه', icon: '🦊', model: 'fox', hostile: false, thief: true,
      hp: 16, speed: 5.6, dmg: 3, xp: 12, size: 0.7, biomes: ['forest', 'plains', 'snow'],
      drop: { meat: [1, 2], hide: [1, 1] }, extra: {}, night: 1.4, weight: 1.4
    },
    boar: {
      id: 'boar', name: 'گراز', icon: '🐗', model: 'boar', hostile: false, retaliate: true,
      hp: 40, speed: 4.6, dmg: 12, xp: 26, size: 1.0, biomes: ['forest', 'swamp', 'plains'],
      drop: { meat: [3, 4], hide: [1, 2] }, extra: {}, night: 0.8, weight: 1.6
    },
    wolf: {
      id: 'wolf', name: 'گرگ', icon: '🐺', model: 'wolf', hostile: true, pack: 3,
      hp: 34, speed: 6.2, dmg: 9, xp: 34, size: 0.95, biomes: ['forest', 'snow', 'rocky', 'plains'],
      drop: { meat: [1, 2], hide: [1, 2] }, extra: {}, night: 2.6, weight: 1.5
    },
    bear: {
      id: 'bear', name: 'خرس', icon: '🐻', model: 'bear', hostile: true,
      hp: 95, speed: 4.9, dmg: 22, xp: 90, size: 1.5, biomes: ['forest', 'snow', 'rocky'],
      drop: { meat: [4, 6], hide: [2, 4] }, extra: { leather: [0, 1] }, night: 1.5, weight: 0.5
    }
  };

  C.FISH = [
    { id: 'fish_carp', w: 60, tier: 1, xp: 8 },
    { id: 'fish_trout', w: 26, tier: 2, xp: 16 },
    { id: 'fish_salmon', w: 10, tier: 3, xp: 34 },
    { id: 'fish_gold', w: 2, tier: 4, xp: 90 }
  ];

  /* ===================== SETTLEMENT TIERS ===================== */
  C.TIERS = [
    { id: 0, name: 'اردوگاه', icon: '⛺', pop: 0, bld: 0, hall: 0, border: 34, desc: 'یک قطعه زمین و چند ابزار ساده.' },
    { id: 1, name: 'آبادی', icon: '🏕️', pop: 4, bld: 4, hall: 0, border: 52, desc: 'چند سرپناه و اولین مزرعه‌ها.' },
    { id: 2, name: 'روستا', icon: '🏘️', pop: 14, bld: 12, hall: 1, border: 76, desc: 'روستایی زنده با کارگاه و بازارچه.' },
    { id: 3, name: 'شهرک', icon: '🏙️', pop: 34, bld: 22, hall: 2, border: 104, desc: 'شهرکی رو به رشد با صنایع.' },
    { id: 4, name: 'شهر', icon: '🌆', pop: 70, bld: 36, hall: 3, border: 140, desc: 'شهری کامل با مدرسه و مهمان‌سرا.' },
    { id: 5, name: 'کلان‌شهر', icon: '🌇', pop: 140, bld: 55, hall: 5, border: 190, desc: 'بزرگ‌ترین شهر این سرزمین.' }
  ];

  /* ===================== QUESTS ===================== */
  C.QUESTS = [
    { id: 'q1', name: 'اولین قدم‌ها', desc: '۱۰ چوب از درختان جمع کن', type: 'gather', item: 'wood', n: 10, xp: 40, coin: 40 },
    { id: 'q2', name: 'زمین را آماده کن', desc: '۴ قطعه زمین را شخم بزن', type: 'till', n: 4, xp: 40, coin: 30 },
    { id: 'q3', name: 'اولین کاشت', desc: '۴ بذر بکار', type: 'plant', n: 4, xp: 50, coin: 40 },
    { id: 'q4', name: 'اولین برداشت', desc: '۶ محصول برداشت کن', type: 'harvest', n: 6, xp: 90, coin: 90, item_r: { seed_carrot: 3 } },
    { id: 'q5', name: 'سنگ و صخره', desc: '۱۵ سنگ استخراج کن', type: 'gather', item: 'stone', n: 15, xp: 80, coin: 60 },
    { id: 'q6', name: 'سرپناه', desc: 'یک چادر یا خانه بساز', type: 'build', any: ['tent', 'house'], n: 1, xp: 120, coin: 100 },
    { id: 'q7', name: 'آب برای مزرعه', desc: 'یک چاه آب بساز', type: 'build', any: ['well'], n: 1, xp: 110, coin: 80 },
    { id: 'q8', name: 'شکارچی', desc: '۳ حیوان شکار کن', type: 'hunt', n: 3, xp: 130, coin: 120 },
    { id: 'q9', name: 'ماهیگیر', desc: '۴ ماهی بگیر', type: 'fish', n: 4, xp: 130, coin: 120 },
    { id: 'q10', name: 'حصار بکش', desc: '۸ قطعه حصار یا دیوار بساز', type: 'build', any: ['fence', 'stone_wall', 'gate'], n: 8, xp: 150, coin: 130 },
    { id: 'q11', name: 'یک آبادی واقعی', desc: 'به سطح آبادی برس', type: 'tier', n: 1, xp: 200, coin: 200 },
    { id: 'q12', name: 'کارگاه بساز', desc: 'یک کارگاه بساز و ابزارت را ارتقا بده', type: 'build', any: ['workshop'], n: 1, xp: 180, coin: 150 },
    { id: 'q13', name: 'دل کوه', desc: '۱۰ سنگ‌آهن استخراج کن', type: 'gather', item: 'iron_ore', n: 10, xp: 220, coin: 200 },
    { id: 'q14', name: 'قلب روستا', desc: 'تالار شهر بساز', type: 'build', any: ['town_hall'], n: 1, xp: 300, coin: 300 },
    { id: 'q15', name: 'روستای من', desc: 'به سطح روستا برس', type: 'tier', n: 2, xp: 400, coin: 400 },
    { id: 'q16', name: 'نگهبانان', desc: '۲ برج نگهبانی بساز', type: 'build', any: ['guard_tower'], n: 2, xp: 350, coin: 320 },
    { id: 'q17', name: 'صنعت', desc: 'یک آسیاب و یک کوره ذوب بساز', type: 'build', any: ['windmill', 'smelter'], n: 2, xp: 420, coin: 400 },
    { id: 'q18', name: 'طلای ناب', desc: '۵ سنگ طلا استخراج کن', type: 'gather', item: 'gold_ore', n: 5, xp: 500, coin: 500 },
    { id: 'q19', name: 'شهرک‌نشین', desc: 'به سطح شهرک برس', type: 'tier', n: 3, xp: 700, coin: 800 },
    { id: 'q20', name: 'شهر بزرگ', desc: 'به سطح شهر برس', type: 'tier', n: 4, xp: 1200, coin: 1500 },
    { id: 'q21', name: 'کلان‌شهر', desc: 'به سطح کلان‌شهر برس — پایان سفر', type: 'tier', n: 5, xp: 3000, coin: 5000 }
  ];

  /* ===================== STARTING STATE ===================== */
  C.START = {
    coins: 120,
    items: { wood: 12, stone: 6, seed_wheat: 6, seed_carrot: 3, bread: 2 },
    tools: { hoe: 1, can: 1, seeds: 1, axe: 1, pickaxe: 1, sword: 1, bow: 0, rod: 1, food: 1 },
    baseStorage: 220
  };

  C.PLAYER = {
    speed: 6.2, runMul: 1.75, jump: 8.4, gravity: 24,
    hp: 100, energy: 100, stamina: 100,
    reach: 5.5, height: 1.8
  };

  G.Config = C;
})(window.GAME = window.GAME || {});
