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
    startHour: 8,
    daysPerSeason: 7,
    /* Daylight runs 04:00 → 20:00 and night 20:00 → 04:00, so the day is
       exactly twice as long as the night. sky.js warps the sun's arc to
       match instead of the plain 12/12 split a raw sine would give. */
    dayStart: 4, dayEnd: 20,
    dawn: 3.6, sunrise: 4.8, sunset: 19.2, dusk: 20.6,
    /* The moon runs its own cycle so "the night of the full moon" is a real
       date you can wait for and plan around, not a random roll. */
    moonCycle: 8                 // days from one full moon to the next
  };
  C.MOON_PHASES = [
    { id: 0, name: 'ماه کامل', icon: '🌕', full: true },
    { id: 1, name: 'کوژ کاهنده', icon: '🌖', full: false },
    { id: 2, name: 'نیمه کاهنده', icon: '🌗', full: false },
    { id: 3, name: 'هلال کاهنده', icon: '🌘', full: false },
    { id: 4, name: 'ماه نو', icon: '🌑', full: false },
    { id: 5, name: 'هلال فزاینده', icon: '🌒', full: false },
    { id: 6, name: 'نیمه فزاینده', icon: '🌓', full: false },
    { id: 7, name: 'کوژ فزاینده', icon: '🌔', full: false }
  ];

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
    swamp: { name: 'مرداب', c1: 0x51663f, c2: 0x5c7348, tree: 0.30, rock: 0.04 },
    /* only ever appears on a hill you raised yourself */
    meadow: { name: 'گلزار', c1: 0x74b356, c2: 0x88c665, tree: 0.03, rock: 0.01 }
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
  item('meat', 'گوشت', '🍖', 3, 'animal');      // a fifth of its old value: hunting paid too well
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
  item('heart_flask', 'شیشهٔ قلب', '❤️', 120, 'food', 'با خوردنش جانت کاملاً پر می‌شود');

  // decoration & ritual goods — bought at the market, spent on beautifying the town
  item('tile', 'کاشی', '🟦', 26, 'craft', 'کاشی لاجوردی برای حوض و سردر و تزئینات');
  item('pottery', 'سفال', '🏺', 18, 'craft', 'خمره و گلدان سفالی');
  item('rug', 'فرش', '🧿', 90, 'craft', 'فرش دست‌باف — زیر پای مهمان و روی دیوار');
  item('rosewater', 'گلاب', '🌹', 44, 'craft', 'عطر باغ‌های ایرانی');
  item('saffron', 'زعفران', '🌺', 150, 'craft', 'گران‌ترین ادویهٔ دنیا');
  item('candle', 'شمع', '🕯️', 12, 'craft', 'برای فانوس‌ها و جشن‌ها');
  item('esfand', 'اسپند', '🌿', 20, 'craft', 'دود اسپند چشم بد را دور می‌کند — و شاید چیز دیگری را نزدیک');
  item('bell', 'زنگوله', '🔔', 34, 'craft', 'زنگولهٔ برنجی کاروان');

  // mythology
  item('simorgh_feather', 'پَر سیمرغ', '🪶', 0, 'craft',
    'پَری که سیمرغ به تو بخشید. در شهرت بسوزانش تا برکتش بر همه بنشیند. فروختنی نیست.');
  item('div_heart', 'دل دیو', '🖤', 0, 'craft',
    'دل سنگی دیو سپید. تا ابد ضربه‌ات را سنگین‌تر می‌کند. فروختنی نیست.');
  item('relic', 'یادگار کهن', '🗝️', 220, 'craft', 'از دل خاک بیرون آمده. کلکسیونرها بابتش پول خوبی می‌دهند.');

  /* Irreplaceable things. They ignore storage capacity, because losing one
     to a full backpack would be a bug however you look at it. */
  C.PRECIOUS = { simorgh_feather: 1, div_heart: 1 };

  C.ITEMS = IT;

  /* energy restored by edible items */
  C.FOOD = {
    heart_flask: { energy: 20, hp: 9999, full: true },   // full: heals to the brim
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
  /* Everything you build costs three times what it used to — the council
     table too. Wrapping cost() here keeps every definition below reading as
     its own base price. */
  C.BUILD_COST_MUL = 3;
  function bld(o) {
    const raw = o.cost;
    o.cost = function (l) {
      const c = raw(l), out = {};
      for (const k in c) out[k] = Math.max(1, Math.round(c[k] * C.BUILD_COST_MUL));
      return out;
    };
    B[o.id] = o;
    return o;
  }
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
    effects: (l) => ({ storage: 180 * l })          // x3, and still linear per level
  });
  bld({
    id: 'warehouse', name: 'انبار بزرگ', icon: '🏚️', cat: 'city', model: 'shed', size: [5, 4], max: 5, tier: 1, sk: 3,
    desc: 'ظرفیت کل کوله‌پشتی و انبار را خیلی زیاد می‌کند.',
    cost: (l) => Object.assign(scale({ wood: 60, stone: 30, plank: 10 }, l), { coin: Math.round(120 * Math.pow(1.9, l - 1)) }),
    effects: (l) => ({ storage: 750 * l })          // x5 — a real warehouse
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
  /* Defences got a serious pass: walls stand five times the punishment they
     used to, and towers hit three times as hard. A wall you built at some
     cost should hold a night, not fold to the first wolf. */
  C.WALL_MUL = 5;
  C.TOWER_MUL = 3;
  bld({
    id: 'fence', name: 'حصار چوبی', icon: '🪵', cat: 'def', model: 'fence', size: [2, 2], connects: true, max: 3, tier: 0, sk: 0,
    desc: 'جلوی حیوانات وحشی را می‌گیرد. ارزان و سریع — قطعه‌ها خودکار به هم می‌چسبند.',
    cost: (l) => scale({ wood: 4 }, l, 2.2),
    effects: (l) => ({ defense: l * C.WALL_MUL, block: true }), hp: (l) => 40 * l * C.WALL_MUL
  });
  bld({
    id: 'stone_wall', name: 'دیوار سنگی', icon: '🧱', cat: 'def', model: 'wall', size: [2, 2], connects: true, max: 3, tier: 1, sk: 2,
    desc: 'دیوار محکم؛ خودکار به دیوارهای کناری وصل می‌شود و گوشه می‌سازد.',
    cost: (l) => scale({ stone: 8, brick: 2 }, l, 2.2),
    effects: (l) => ({ defense: 2 * l * C.WALL_MUL, block: true }), hp: (l) => 140 * l * C.WALL_MUL
  });
  /* A city gate should look like the front door of a city. This one spans
     two wall cells, carries two towers and a battlemented arch, and its two
     leaves swing open for anyone who belongs here — you, your people, your
     horses, your falcon — and stay shut against everything else. */
  bld({
    id: 'gate', name: 'دروازهٔ شهر', icon: '🏯', cat: 'def', model: 'gatehouse', size: [4, 2],
    connects: true, gateway: true, max: 3, tier: 1, sk: 2,
    desc: 'دروازهٔ بزرگ دو لنگه با دو برج و طاق کنگره‌دار. خودش برای تو، اهالی، اسب‌ها و همراهانت باز می‌شود و جلوی حیوانات وحشی بسته می‌ماند. خودش هم در جهت دیوار می‌چرخد.',
    cost: (l) => scale({ wood: 26, stone: 20, iron: 6 }, l),
    effects: (l) => ({ defense: l * C.WALL_MUL * 2, block: true, passable: true }), hp: (l) => 220 * l * C.WALL_MUL
  });
  /* how the leaves behave */
  C.GATE = {
    openRange: 7.5,       // a friendly this close swings it open
    speed: 2.6,           // radians a second on the hinge
    swing: 1.95           // how far each leaf opens
  };
  bld({
    id: 'guard_tower', name: 'برج نگهبانی', icon: '🗼', cat: 'def', model: 'tower', size: [3, 3], max: 5, tier: 1, sk: 3,
    desc: 'به حیوانات مهاجم نزدیک تیر می‌زند. برد و آسیبش با سطح زیاد می‌شود.',
    cost: (l) => Object.assign(scale({ wood: 40, stone: 30, iron: 4 }, l), { coin: Math.round(120 * Math.pow(1.9, l - 1)) }),
    effects: (l) => ({ defense: 4 * l * C.TOWER_MUL, range: 16 + l * 4, dps: (6 + l * 5) * C.TOWER_MUL }),
    hp: (l) => 200 * l * C.TOWER_MUL
  });
  C.BUILDINGS = B;

  bld({
    id: 'stable', name: 'اصطبل', icon: '🏇', cat: 'city', model: 'stable', size: [14, 9], max: 5, tier: 1, sk: 3,
    desc: 'سالن بلند اصطبل با ده باکس جدا. اسب‌های رام‌شده را ببر داخل تا هرکدام توی باکس خودش بایستد. سوارکارها هم از همین‌جا به سفر می‌روند.',
    cost: (l) => Object.assign(scale({ wood: 90, stone: 45, plank: 20, fiber: 25 }, l), { coin: Math.round(420 * Math.pow(1.85, l - 1)) }),
    /* passable: you can walk down the aisle of your own stable */
    effects: (l) => ({ happy: 2, riders: l, stalls: C.HORSE.stallsPerStable, passable: true })
  });

  bld({
    id: 'council', name: 'میز شورا', icon: '🪑', cat: 'city', model: 'council', size: [6, 5], max: 5, tier: 0, sk: 0,
    desc: 'میز بزرگ قبیله. کنارش بایست و کلید E را بزن تا به هر کس وظیفه بدهی: چوب‌بری، سنگ‌کاری، شکار، کشاورزی یا نگهبانی. هر ارتقا جای کار بیشتری باز می‌کند.',
    /* deliberately one of the cheapest builds in the game — nothing else
       matters until you can put people to work. Slots are generous too: a
       table that seats only a handful leaves most of your town loitering. */
    cost: (l) => scale({ wood: 12, fiber: 4 }, l, 1.6),
    effects: (l) => ({ happy: 3, jobSlots: 4 + l * 4 })
  });

  bld({
    id: 'campfire', name: 'آتش اردو', icon: '🔥', cat: 'def', model: 'campfire', size: [2, 2], max: 4, tier: 0, sk: 0,
    desc: 'حیوانات از شعله می‌ترسند. تا وقتی هیزم دارد، دور تا دورش امن است. با ارتقا شعاعش بیشتر و سوختش کم‌مصرف‌تر می‌شود.',
    cost: (l) => scale({ wood: 6, stone: 4 }, l, 1.7),
    effects: (l) => ({ ward: 11 + l * 4, happy: 1 }), hp: (l) => 30 * l
  });
  bld({
    id: 'watchfire', name: 'آتش دیده‌بانی', icon: '🕯️', cat: 'def', model: 'watchfire', size: [3, 3], max: 5, tier: 1, sk: 2,
    desc: 'آتش بزرگ روی پایهٔ سنگی. شعاع امنش خیلی بیشتر است و کندتر هیزم می‌سوزاند.',
    cost: (l) => Object.assign(scale({ stone: 30, wood: 20, iron: 2 }, l), { coin: Math.round(90 * Math.pow(1.8, l - 1)) }),
    effects: (l) => ({ ward: 24 + l * 7, happy: 2 }), hp: (l) => 80 * l
  });

  /* ===================== THE PERSIAN GARDEN =====================
     Not a workshop and not a warehouse: the prettiest thing you can own.
     Four quadrants split by water channels around a tiled pool, with
     cypress, pomegranate and roses. It makes no goods at all — it makes
     the town somewhere people want to live, and off-duty villagers
     actually walk over and sit in it. */
  bld({
    id: 'garden', name: 'باغ ایرانی', icon: '🌹', cat: 'city', model: 'garden', size: [12, 12], max: 5, tier: 1, sk: 3,
    desc: 'چهارباغ: چهار قطعه، جوی آب صلیبی، حوض کاشی، سرو و انار و گل سرخ. هیچ محصولی نمی‌دهد — فقط شهرت را جای زندگی می‌کند. اهالی بی‌کار می‌روند آنجا می‌نشینند و خانواده‌ها همان‌جا شکل می‌گیرند.',
    cost: (l) => Object.assign(scale({ stone: 40, tile: 12, plank: 15, rosewater: 2 }, l, 1.75),
      { coin: Math.round(300 * Math.pow(1.9, l - 1)) }),
    effects: (l) => ({ happy: 10 + l * 4, births: 0.05 + l * 0.05, restRadius: 7 + l * 1.5, passable: true })
  });

  /* ===================== DECORATION =====================
     Pure beauty. Every piece adds a little happiness, most of them light
     up at night, and none of them produce anything. Small flat pieces are
     walkable so a paved square stays a square you can cross. */
  const dec = (id, name, icon, model, size, price, mats, happy, opt) => bld(Object.assign({
    id: id, name: name, icon: icon, cat: 'decor', model: model, size: size,
    max: 3, tier: 0, sk: 0, decor: true,
    desc: (opt && opt.desc) || 'تزئین شهر.',
    cost: (l) => Object.assign(scale(mats, l, 1.6), { coin: Math.round(price * Math.pow(1.7, l - 1)) }),
    effects: (l) => ({ happy: happy * l })
  }, opt || {}));

  dec('statue', 'مجسمهٔ سنگی', '🗿', 'statue', [2, 2], 90, { stone: 25 }, 3,
    { desc: 'پیکرهٔ سنگی یک پهلوان بر پایه‌ای بلند.' });
  dec('horse_statue', 'مجسمهٔ اسب', '🐎', 'horse_statue', [3, 3], 260, { stone: 30, iron: 4 }, 5,
    { desc: 'اسبی برنزی با یال افشان، بر پایهٔ سنگی.', sk: 2 });
  dec('lion', 'شیر سنگی', '🦁', 'lion', [3, 2], 200, { stone: 34 }, 4,
    { desc: 'شیر تخت‌جمشیدی. دو تا بگذار، دو طرف دروازه.', sk: 1 });
  dec('column', 'ستون تخت‌جمشیدی', '🏛️', 'column', [2, 2], 150, { stone: 28, brick: 4 }, 3,
    { desc: 'ستون شیاردار با سرستون دوسر گاو.', sk: 1 });
  dec('archway', 'سردر کاشی', '🕌', 'archway', [5, 2], 320, { brick: 20, tile: 10 }, 6,
    { desc: 'طاق بلند با کاشی لاجوردی. ورودی شهرت را شکوهمند کن.', sk: 2 });
  dec('obelisk', 'سنگ یادبود', '🪦', 'obelisk', [2, 2], 120, { stone: 22 }, 2,
    { desc: 'سنگ بلند یادبود، با کتیبه‌ای که کسی نمی‌خواندش.' });
  dec('urn', 'خمرهٔ سفالی', '🏺', 'urn', [1, 1], 40, { pottery: 3 }, 1,
    { desc: 'خمرهٔ بزرگ گلی، همان که سرش را با پارچه می‌بندند.' });
  dec('flowerbed', 'باغچهٔ گل', '🌷', 'flowerbed', [2, 2], 45, { fiber: 8, clay: 5 }, 2,
    { desc: 'یک تکه باغچهٔ پرگل. از رویش رد می‌شوی.', walkOver: true });
  dec('rosebush', 'بوتهٔ رز', '🌹', 'rosebush', [1, 1], 35, { fiber: 5 }, 1,
    { desc: 'گل سرخ محمدی، همان که گلاب از آن می‌گیرند.' });
  dec('cypress', 'سرو', '🌲', 'cypress', [2, 2], 70, { fiber: 6, clay: 4 }, 2,
    { desc: 'سرو بلند و راست — نماد پایداری.' });
  dec('pomegranate', 'درخت انار', '🍎', 'pomegranate', [2, 2], 85, { fiber: 6, clay: 4 }, 2,
    { desc: 'درخت انار پرثمر. شب یلدا بی این نمی‌شود.' });
  dec('pool', 'حوض کاشی', '💧', 'pool', [4, 4], 240, { stone: 25, tile: 10 }, 5,
    { desc: 'حوض کم‌عمق با کف لاجوردی که آسمان را برمی‌گرداند.', sk: 1 });
  dec('channel', 'جوی آب', '〰️', 'channel', [2, 2], 30, { stone: 8, tile: 2 }, 1,
    { desc: 'یک قطعه جوی سنگی. پشت‌سرهم بگذار تا آب در شهر راه بیفتد.', walkOver: true });
  dec('cascade', 'آبنمای پلکانی', '🌊', 'cascade', [3, 3], 300, { stone: 30, tile: 8 }, 6,
    { desc: 'آب از سه پله پایین می‌ریزد و صدایش تا آخر میدان می‌آید.', sk: 2 });
  dec('bench', 'نیمکت چوبی', '🪑', 'bench', [2, 1], 30, { plank: 4 }, 1,
    { desc: 'جایی برای نشستن و تماشای غروب.' });
  dec('gazebo', 'آلاچیق', '⛱️', 'gazebo', [4, 4], 280, { plank: 18, cloth: 6 }, 6,
    { desc: 'سایه‌بان هشت‌ضلعی با سقف پارچه‌ای و نیمکت دور تا دور.', sk: 2, passable: true });
  dec('swing', 'تاب', '🎠', 'swing', [2, 3], 90, { wood: 12, fiber: 6 }, 3,
    { desc: 'تاب چوبی. باد که می‌آید خودش تکان می‌خورد.' });
  dec('hanglamp', 'فانوس آویز', '🏮', 'hanglamp', [1, 1], 55, { iron: 1, candle: 2 }, 2,
    { desc: 'فانوس رنگی روی پایهٔ خمیده. شب‌ها روشن می‌شود.' });
  dec('torch', 'مشعل', '🔦', 'torch', [1, 1], 35, { wood: 4, coal: 2 }, 1,
    { desc: 'مشعل ساده روی تیرک. نور گرمی می‌دهد.' });
  dec('banner', 'پرچم قبیله', '🚩', 'banner', [1, 1], 60, { cloth: 3, wood: 5 }, 2,
    { desc: 'پرچم بلند کِشتوَر که در باد تکان می‌خورد.' });
  dec('signpost', 'تیرک راهنما', '🪧', 'signpost', [1, 1], 25, { wood: 5 }, 1,
    { desc: 'تیرکی با چند تختهٔ جهت‌نما.' });
  dec('paving', 'سنگفرش', '⬜', 'paving', [2, 2], 20, { stone: 6 }, 1,
    {
      desc: 'یک قطعه سنگفرش. روی شبکهٔ خودش می‌نشیند و نمی‌چرخد، پس هر چند تا که بگذاری یک کف یکدست می‌شود — بدون درز و بدون پستی و بلندی.',
      walkOver: true, tile: true
    });
  dec('sundial', 'ساعت آفتابی', '🕰️', 'sundial', [2, 2], 170, { stone: 16, iron: 2 }, 3,
    { desc: 'سایهٔ میله روی حلقهٔ سنگی ساعت را می‌گوید.', sk: 1 });
  dec('peacock', 'طاووس سنگی', '🦚', 'peacock', [2, 2], 210, { stone: 18, tile: 6 }, 4,
    { desc: 'طاووسی با دم کاشی‌کاری‌شده.', sk: 2 });
  dec('carpetstand', 'رَخت فرش', '🧿', 'carpetstand', [2, 2], 190, { rug: 1, wood: 8 }, 4,
    { desc: 'فرش دست‌باف روی چوب‌بست، رو به گذر.' });
  dec('topiary', 'بوتهٔ آراسته', '🌳', 'topiary', [1, 1], 50, { fiber: 6 }, 1,
    { desc: 'بوته‌ای که باغبان به شکل کره درش آورده.' });
  dec('birdbath', 'آبخوری پرندگان', '🐦', 'birdbath', [2, 2], 75, { stone: 12, tile: 2 }, 2,
    { desc: 'کاسهٔ سنگی آب. گنجشک‌ها عاشقش‌اند.' });
  dec('brazier', 'منقل مسی', '🔥', 'brazier', [2, 2], 110, { iron: 3, coal: 4 }, 3,
    { desc: 'منقل بزرگ مسی روی سه‌پایه. شب که می‌شود گُر می‌گیرد.' });
  dec('bellarch', 'زنگولهٔ کاروان', '🔔', 'bellarch', [2, 2], 130, { bell: 1, wood: 8 }, 3,
    { desc: 'زنگولهٔ برنجی زیر طاقی چوبی. باد که بیاید صدا می‌دهد.' });

  /* ===================== SHAPING THE LAND =====================
     These are not buildings. Nothing is ever placed: choosing one and
     clicking re-shapes the ground itself, and the change is permanent and
     saved. `terrain.op` says which way:

       flat — level a block dead flat, blending out at its rim
       hill — raise a hill of a given kind and size
       undo — put a piece of shaped ground back the way it was

     Levelling is priced in labour, not stone: moving earth costs your
     people's time, so the bill is coins with a little timber for the
     shoring. Raising a hill wants the material to raise it with. */
  const land = (id, name, icon, size, terrain, price, mats, desc, sk) => bld({
    id: id, name: name, icon: icon, cat: 'land',
    model: terrain.op === 'hill' ? 'hillghost' : 'levelpad',
    size: size, max: 1, tier: 0, sk: sk || 0, terrain: terrain, desc: desc,
    cost: () => Object.assign({}, mats, { coin: price })
  });

  land('level_s', 'تخت‌کردن زمین (کوچک)', '🟩', [10, 10],
    { op: 'flat', edge: 3 }, 18, { wood: 3 },
    'یک قطعهٔ ۱۰×۱۰ را کاملاً تخت می‌کند و لبه‌هایش را نرم به زمین اطراف می‌رساند. اگر کنارِ زمین تخت‌شدهٔ دیگری باشد، هم‌ترازِ همان می‌شود تا شهرت یک سطح یکدست شود.');
  land('level_l', 'تخت‌کردن زمین (بزرگ)', '🟢', [28, 28],
    { op: 'flat', edge: 5 }, 90, { wood: 12, stone: 6 },
    'یک قطعهٔ ۲۸×۲۸ را یک‌جا تخت می‌کند — اندازهٔ یک میدان. برای صاف کردن کل زمینِ شهر، همین را پشت‌سرهم بگذار.', 1);
  land('level_undo', 'بازگرداندن زمین', '↩️', [8, 8],
    { op: 'undo' }, 8, {},
    'زمینی که تخت کرده‌ای یا تپه‌ای که ساخته‌ای را به شکل طبیعی خودش برمی‌گرداند. نشانه بگیر و کلیک کن.');

  /* Fields you buy instead of ploughing. `n` is the block in tiles a side;
     one tile is one grid cell, exactly what a swing of the hoe breaks. */
  const field = (id, name, icon, n, price, mats, desc, sk) => bld({
    id: id, name: name, icon: icon, cat: 'farm', model: 'fieldpad',
    size: [n * C.WORLD.gridSize, n * C.WORLD.gridSize],
    max: 1, tier: 0, sk: sk || 0, terrain: { op: 'field', n: n }, desc: desc,
    cost: () => Object.assign({}, mats, { coin: price })
  });
  field('field_s', 'زمین کشاورزی (کوچک)', '🟫', 1, 4, {},
    'یک قطعه — دقیقاً همان‌قدر که یک ضربهٔ بیل شخم می‌زند. برای وقتی که فقط یک گوشه کم داری.');
  field('field_m', 'زمین کشاورزی (متوسط)', '🌾', 3, 26, { wood: 2 },
    'یک بلوک ۳×۳ — ۹ قطعه در ۶×۶ متر، با یک کلیک. زمین ناهموارش هم اول خودش تخت می‌شود.');
  field('field_l', 'زمین کشاورزی (بزرگ)', '🚜', 7, 120, { wood: 8, iron: 1 },
    'یک مزرعهٔ کامل ۷×۷ — ۴۹ قطعه در ۱۴×۱۴ متر. زمینش اول تخت می‌شود، بعد کشاورزها بقیه‌اش را خودشان می‌گردانند.', 1);

  /* size, height and looks of every hill you can buy */
  const HILLS = [
    ['sand', 'شنی', '🏜️', 'تپهٔ ماسه‌ای نرم و بی‌درخت، رنگ کویر.', 0xd9c07e],
    ['rock', 'سنگی', '🪨', 'تپهٔ سنگی ناهموار با تخته‌سنگ و رگه‌های معدن.', 0x8b8b86],
    ['snow', 'برفی', '🏔️', 'تپهٔ سفیدپوش با کاج‌های سوزنی.', 0xe9f0f4],
    ['flower', 'پرگل', '🌼', 'تپه‌ای که سرتاسرش گل وحشی است — رنگ‌به‌رنگ، هزارتا.', 0x88c665],
    ['peak', 'کوه', '⛰️', 'کوه بلند و تیز با تاج برفی. از آن سر دشت پیداست.', 0x9b9b95]
  ];
  const HILL_SIZE = [
    { key: 's', tag: 'کوچک', r: 9, peak: 5.5, edgeF: 0.94, price: 110, mats: { stone: 12, clay: 8 }, sk: 1 },
    { key: 'l', tag: 'بزرگ', r: 24, peak: 17, edgeF: 0.96, price: 520, mats: { stone: 60, clay: 30, wood: 20 }, sk: 3 }
  ];
  for (const h of HILLS) {
    for (const s of HILL_SIZE) {
      const peak = h[0] === 'peak' ? s.peak * 1.9 : h[0] === 'flower' ? s.peak * 0.7 : s.peak;
      land('hill_' + h[0] + '_' + s.key,
        'تپهٔ ' + h[1] + ' (' + s.tag + ')', h[2],
        [s.r * 2, s.r * 2],
        { op: 'hill', kind: h[0], r: s.r, peak: peak, edgeF: s.edgeF, tint: h[4] },
        Math.round(s.price * (h[0] === 'peak' ? 1.6 : 1)),
        s.mats, h[3] + ' بلندی حدود ' + Math.round(peak) + ' متر، پهنا ' + (s.r * 2) + ' متر.',
        s.sk + (h[0] === 'peak' ? 1 : 0));
    }
  }

  /* How the ground reshapes itself under what you build. */
  C.LEVEL = {
    margin: 0.7,        // metres of level ground round a footprint
    edge: 2.4,          // the least the level blends back into the hillside
    edgePerMetre: 1.6,  // …widened by this much per metre of earth moved
    edgeMax: 16,        // and never wider than this
    skipFlat: 0.12,     // ground already this even is left alone
    datumReach: 12,     // adopt a neighbouring platform's height from this far
    datumStep: 4.5,     // …but not if it would mean a step this big
    minY: 0.6           // levelled ground always stays this far above water
  };

  C.BUILD_CATS = [
    { id: 'farm', name: '🌾 مزرعه' },
    { id: 'home', name: '🏠 مسکونی' },
    { id: 'prod', name: '🏭 تولیدی' },
    { id: 'city', name: '🏛️ شهری' },
    { id: 'decor', name: '✨ تزئینات' },
    { id: 'land', name: '⛰️ زمین' },
    { id: 'def', name: '🛡️ دفاعی' },
    { id: 'crew', name: '👷 کارگرها' }
  ];

  /* ===================== FIRE (the early-game answer to night raids) =====
     A lit fire keeps predators out of a circle around it. It eats wood, so
     it is a real decision: burn your building material to sleep safely, or
     risk the dark. Higher levels burn slower and reach further. */
  C.FIRE = {
    fuelPerLog: 3.2,              // in-game hours of light per wood
    maxLogs: 12,                  // how much wood a fire can hold at once
    burnPerLevel: 0.86,           // each level multiplies fuel use by this
    autoFeed: 2,                  // logs an auto-feeding fire pulls per top-up
    lowWarn: 2.5                  // warn when fewer than this many hours are left
  };

  /* ===================== HIREABLE CREW =====================
     Bought from the build menu, then given a duty at the council table.
     A plain labourer is cheap; specialists cost a lot more but arrive
     already skilled at their trade. */
  const crew = (o) => { C.CREW[o.id] = o; };
  C.CREW = Object.create(null);
  /* Every hire of the same trade costs meaningfully more than the last, so
     a crew of ten is a real investment rather than a rounding error. `n` is
     how many of THAT specialist you already employ. */
  const hireCost = (base, growth) => (n) => Math.round(base * Math.pow(growth, n));
  crew({
    id: 'hand', name: 'کارگر ساده', icon: '🧑‍🌾', job: 'stone', expert: false,
    desc: 'ارزان‌ترین نیرو. برای جمع کردن سنگ و چوب و کارهای ساده عالی است. سر میز شورا هر وظیفه‌ای بخواهی به او می‌دهی.',
    cost: (n) => ({ coin: hireCost(140, 1.35)(n), bread: 1 + Math.floor(n / 3) })
  });
  crew({
    id: 'logger', name: 'چوب‌بُر کارکشته', icon: '🪓', job: 'wood', expert: true,
    desc: 'استاد تبر. سه برابر کارگر ساده چوب می‌آورد و الیاف بیشتری پیدا می‌کند.',
    cost: (n) => ({ coin: hireCost(620, 1.45)(n), plank: 6 + n * 2 })
  });
  crew({
    id: 'miner', name: 'معدن‌چی', icon: '⛏️', job: 'stone', expert: true,
    desc: 'رگه‌های زغال و آهن را می‌شناسد و سه برابر کارگر ساده استخراج می‌کند.',
    cost: (n) => ({ coin: hireCost(880, 1.45)(n), iron: 4 + n * 2 })
  });
  crew({
    id: 'reaper', name: 'کشاورز کارکشته', icon: '🌾', job: 'farm', expert: true,
    desc: 'مزرعه را خودش می‌چرخاند: می‌کارد، آب می‌دهد و سه برابر سریع‌تر برداشت می‌کند.',
    cost: (n) => ({ coin: hireCost(700, 1.45)(n), bread: 4 + n * 2 })
  });
  crew({
    id: 'ranger', name: 'شکارچی حرفه‌ای', icon: '🏹', job: 'hunt', expert: true,
    desc: 'کمان‌دار زبردست. حیوانات را از فاصلهٔ دور می‌زند و گوشت و پوست می‌آورد.',
    cost: (n) => ({ coin: hireCost(1500, 1.5)(n), iron: 8 + n * 3, cloth: 3 + n })
  });
  crew({
    id: 'warden', name: 'نگهبان جنگی', icon: '🛡️', job: 'guard', expert: true,
    desc: 'گران اما ارزشش را دارد: شب‌ها جلوی گله‌های مهاجم می‌ایستد.',
    cost: (n) => ({ coin: hireCost(2400, 1.5)(n), iron: 12 + n * 4, plank: 10 + n * 3 })
  });
  crew({
    id: 'minstrel', name: 'نوازنده', icon: '🎼', job: 'music', expert: true,
    desc: 'تارنواز دوره‌گرد. در میدان می‌نشیند و می‌نوازد؛ آهنگ شهر عوض می‌شود و مردم سرحال می‌آیند.',
    cost: (n) => ({ coin: hireCost(1100, 1.55)(n), cloth: 4 + n * 2, plank: 6 + n * 2 })
  });

  /* ===================== HORSES ===================== */
  C.HORSE = {
    tameTime: 2.6,                // seconds of holding E
    tameRange: 5.0,
    spookRange: 3.2,              // a wild horse backs off if you crowd it
    coats: [0x6b4a2c, 0x3a2a1e, 0xd8c8a8, 0x8a8a8a, 0x1e1e1e, 0x8a5a3a],
    names: ['باد', 'شهاب', 'رخش', 'صبا', 'طوفان', 'برق', 'آذر', 'سیمرغ', 'کهربا', 'دلدل'],
    wildCap: 4,                   // wild horses roaming near you at once
    seat: 0.98,                   // hips land on the saddle, not above it
    seatBack: 0.18,               // and a little behind the withers
    speed: 13.5, accel: 5.2, turn: 3.2,
    stableRange: 12,              // stand this close to the stable to house it
    stallsPerStable: 10,          // boxes in the hall, one horse each
    ropeCost: { fiber: 4 },       // thrown when you tame — cheap but not free
    followRange: 14
  };

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
      drop: { meat: [4, 6], hide: [2, 4] }, extra: { leather: [0, 1] }, night: 1.5, weight: 0.5,
      minThreat: 1.2
    },
    /* The rest only appear once the settlement is worth raiding. minThreat is
       compared against the town's power score, so a small farm is left alone
       and a metropolis gets serious visitors. */
    direwolf: {
      id: 'direwolf', name: 'گرگ سیاه', icon: '🐺', model: 'wolf', hostile: true, pack: 4,
      hp: 78, speed: 7.0, dmg: 17, xp: 110, size: 1.2, biomes: ['forest', 'snow', 'rocky', 'plains'],
      drop: { meat: [2, 3], hide: [2, 3] }, extra: { leather: [0, 1] }, night: 3.0, weight: 1.1,
      minThreat: 1.8, tint: 0x3a3f4a
    },
    tusker: {
      id: 'tusker', name: 'گراز غول‌پیکر', icon: '🐗', model: 'boar', hostile: true,
      hp: 150, speed: 5.4, dmg: 27, xp: 210, size: 1.7, biomes: ['forest', 'swamp', 'plains', 'savanna'],
      drop: { meat: [6, 9], hide: [3, 5] }, extra: { leather: [1, 2] }, night: 2.2, weight: 0.7,
      minThreat: 2.8
    },
    alphabear: {
      id: 'alphabear', name: 'خرس غول‌آسا', icon: '🐻‍❄️', model: 'bear', hostile: true,
      hp: 260, speed: 5.2, dmg: 38, xp: 420, size: 2.1, biomes: ['forest', 'snow', 'rocky'],
      drop: { meat: [9, 14], hide: [5, 8] }, extra: { leather: [2, 4], gem: [0, 1] }, night: 1.8, weight: 0.45,
      minThreat: 4.0
    },
    /* دیو سپید — never spawns on his own (weight 0). myth.js wakes him when
       your settlement is big enough to be worth destroying. */
    whitediv: {
      id: 'whitediv', name: 'دیو سپید', icon: '👹', model: 'div', hostile: true,
      hp: 2600, speed: 4.4, dmg: 46, xp: 4000, size: 1.0,
      hitR: 2.4, hitY: 4.4, reach: 4.2, aggro: 42,
      biomes: [], drop: { div_heart: [1, 1], gem: [4, 6], gold: [3, 5], leather: [6, 10] }, extra: {},
      night: 0, weight: 0,
      boss: true, always: true, fearless: true
    }
  };

  /* ===================== THREAT ===================== */
  /* Raids scale with how much there is to raid. A lone tent is ignored;
     a walled city with a big population draws packs of dire wolves. */
  C.THREAT = {
    perBuilding: 0.9,
    perPopulation: 1.5,
    perTier: 13,
    perLevel: 1.1,
    divisor: 34,
    max: 6,
    raidMin: 0.4,         // below this, nothing ever raids the town
    /* Nights were relentless. Both the odds of a raid starting and how many
       predators the dark spawns are cut to a third, so a night is a threat
       you brace for rather than a siege you never get out from under. */
    nightMul: 1 / 3
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

  /* ===================== VEHICLES ===================== */
  C.VEHICLES = {
    boat: {
      id: 'boat', name: 'قایق', icon: '⛵', max: 3, water: true, seat: 0.95,
      desc: 'رایگان است! روی دریاچه‌ها و دریا حرکت کن و به جزیره‌ها و سواحل دوردست برو.',
      needWhy: 'باید نزدیک آب باشی تا قایق را بیاورند',
      cost: {},                                   // free, as promised
      upgrade: (l) => ({ wood: 20 * l, plank: 6 * l, cloth: 2 * l, coin: 120 * l }),
      stat: (l) => ({ speed: 8.5 + l * 2.6, accel: 2.4, turn: 2.6 })
    },
    car: {
      id: 'car', name: 'خودرو', icon: '🚗', max: 5, water: false, seat: 1.15,
      desc: 'سریع‌ترین راه برای گشتن دنیا روی خشکی. سطح بالاتر = سرعت و شتاب بیشتر.',
      needWhy: 'جای صاف و خشکی برای پارک پیدا نشد',
      cost: { coin: 2500, iron: 25, plank: 20, gold: 3 },
      upgrade: (l) => ({ coin: 900 * l, iron: 12 * l, gold: 2 * l, plank: 8 * l }),
      stat: (l) => ({ speed: 15 + l * 3.4, accel: 4 + l * 0.5, turn: 3.4 })
    }
  };

  /* ===================== SETTLERS ===================== */
  C.SETTLERS = {
    start: 2,
    workerBase: 130,
    workerGrowth: 1.075,          // each hire costs a bit more
    immigrationRate: 0.4,         // share of empty homes filled per day
    minHappy: 50,
    riderMax: 5,
    baseDays: 3.5,                // level 1
    daysPerLevel: 0.675,          // level 5: under a day
    minDays: 0.75,
    riderCost: (owned) => ({ coin: Math.round(700 * Math.pow(1.7, owned)), fiber: 20 + owned * 10 }),
    riderUpgrade: (lvl) => ({ coin: Math.round(600 * Math.pow(1.85, lvl - 2)), wheat: 15 * lvl, iron: 4 * lvl }),
    tripCost: (lvl) => ({ bread: Math.max(1, 3 - Math.floor(lvl / 2)), coin: 60 + lvl * 20 })
  };

  /* ===================== VILLAGER JOBS ===================== */
  C.JOBS = [
    { id: 'idle', name: 'بی‌کار', icon: '🚶', desc: 'فقط در شهر می‌گردد.' },
    { id: 'wood', name: 'چوب‌بری', icon: '🪓', desc: 'به درخت‌ها می‌رود و چوب می‌آورد.' },
    { id: 'stone', name: 'سنگ‌کاری', icon: '⛏️', desc: 'از صخره‌ها سنگ و زغال و سنگ‌آهن می‌آورد.' },
    { id: 'hunt', name: 'شکارچی', icon: '🏹', desc: 'حیوانات را شکار می‌کند و گوشت و پوست می‌آورد.' },
    { id: 'farm', name: 'کشاورز', icon: '🌾', desc: 'محصولات رسیده را خودش برداشت می‌کند.' },
    { id: 'guard', name: 'نگهبان', icon: '🛡️', desc: 'با کمان از شهر در برابر حیوانات مهاجم دفاع می‌کند.' },
    { id: 'music', name: 'نوازنده', icon: '🎼', desc: 'تار می‌زند در میدان شهر. آهنگ بازی کنارش عوض می‌شود و هرکس صدایش را بشنود سرحال می‌آید.' }
  ];
  /* The musician makes no goods, so their whole worth is the mood they lift
     and the way the score bends around them. */
  C.MUSIC_JOB = {
    radius: 22,               // how far the playing carries
    happyPerPlayer: 4,        // town happiness for each musician at work
    energyPerHour: 5,         // stamina a listening villager (or you) recovers
    restRadius: 9             // idlers drift this close to listen
  };
  /* In-game hours between one worker's deliveries, before their rate.
     A day is twelve real minutes, so 1.1h is about half a real minute. */
  C.JOB_TICK = 1.1;
  /* Some trades want their own pace on top of the shared one. */
  C.JOB_SPEED = { farm: 4 };

  /* ===================== FARMHANDS =====================
     A farmhand runs the whole field on their own: they sow, they water,
     they harvest, and when the seed bin runs dry they walk to the market
     and buy more out of your purse. All you have to do is break the
     ground — deciding where the field goes stays your call. */
  C.FARMER = {
    buySeeds: true,
    batch: 8,             // seeds bought at a time
    purseShare: 0.35,     // never spend more than this much of your coin at once
    reserve: 60,          // and always leave you at least this many coins
    restockGap: 6,        // seconds between shopping trips, so they don't spam it
    waterTo: 0.95         // how wet they leave a plot
  };
  /* Throughput is split between swinging faster and carrying more, so a
     busy worker looks busy instead of frantic.
       plain hand : TICK_MUL 2 x YIELD_MUL 1.75  = 3.5x the old rate
       specialist : x1.5 faster again x2 the load = 3x a plain hand      */
  C.WORKER = { tickMul: 2.0, yieldMul: 1.75 };
  C.EXPERT = { tickMul: 1.5, yieldMul: 2.0 };
  /* How much slower a village hunter shoots than they used to. Your own
     hunting is untouched — it was already well judged. */
  C.HUNTER_SLOW = 3;

  /* ===================== GUARDS =====================
     A guard used to wander a random circle round the town and shoot only
     what happened to walk past. Now they go to the trouble: anything
     hostile near the settlement, or any building being chewed on, pulls
     them across town. And they hit three times as hard as they did. */
  C.GUARD = {
    damage: 3,            // multiplier on a guard's arrow
    baseDamage: 12,       // before the multiplier
    perLevel: 0.8,        // your own level makes the militia better armed
    shootCd: 1.5,         // seconds between arrows
    shootRange: 30,       // how far a guard will loose an arrow
    /* how far from the town centre a guard will go looking for trouble —
       scaled by the settlement's border so a city is properly patrolled */
    watch: 1.6,
    watchMin: 55,
    standOff: 8,          // hold this far from the quarry and shoot
    patrolMin: 0.45,      // patrol ring, as a share of the border
    patrolMax: 0.95
  };
  /* Market multipliers on an item's base value. Buying costs more than it
     did and more than selling returns, so coins have to be earned. */
  C.PRICE = { sell: 1.6, buy: 3.4 };

  /* =========================================================
     MYTHOLOGY
     Three legends, each with its own way in.
       سیمرغ  — a rite you perform on purpose, on a night you wait for
       دیو سپید — an enemy your own success wakes up
       رؤیا و گنج — something the world gives you while you sleep
     ========================================================= */
  C.MYTH = {
    /* ---- The Simorgh ---- */
    simorgh: {
      /* The peak is picked from the seed at world build and pinned to the
         map from the first minute, so it is a destination you can see long
         before you know what it is for. */
      peakSearch: 620,          // world units scanned around origin for the highest ground
      peakSamples: 40,          // grid resolution of that scan
      ritualRange: 9,           // how close to the peak the fire has to be
      fireLevel: 1,             // the fire must be at least this level, and lit
      offering: { esfand: 3, feather: 5, gem: 1 },
      arriveTime: 15,           // seconds of circling before she lands
      circleRadius: 34,
      circleHeight: 26,
      /* where she comes to rest: far enough away to see her whole wingspan,
         and high enough that her feet meet the rock rather than sink into it */
      landRadius: 11,
      landHeight: 2.9,
      scale: 1.5,               // she is about four houses across, wingtip to wingtip
      landTime: 9,              // how long she stays on the peak
      /* the blessing, once you burn the feather in your own town */
      blessDays: 3,             // days the blessing keeps working
      blessGrowth: 2.2,         // crop growth multiplier while blessed
      blessHappy: 100,          // everyone sits at full contentment
      cooldownDays: 12          // days before she will answer the rite again
    },

    /* ---- The White Div ---- */
    div: {
      tier: 4,                  // wakes when your settlement becomes a شهر
      warnDays: 1,              // days of warning between the omen and the attack
      hp: 2600,
      speed: 4.4,
      dmg: 46,
      reach: 4.2,
      size: 3.4,
      xp: 4000,
      coin: 3000,
      /* phases fire as his health crosses these fractions */
      summonAt: 0.66, summonPack: 4,
      rageAt: 0.33, rageSpeed: 1.45, rageDmg: 1.4,
      throwRange: 30, throwEvery: 4.5, throwDmg: 30,
      drop: { div_heart: 1, gem: 6, gold: 4, leather: 8 },
      /* what the heart is worth once you carry it home */
      heartPower: 0.2,          // permanent +20% damage
      returnDays: 30            // he can rise again this many days later
    },

    /* ---- Dreams & buried treasure ---- */
    dream: {
      chancePerNight: 0.22,     // rolled at first light
      minDay: 3,
      minDist: 40, maxDist: 190,
      digRange: 3.2,
      /* what comes out of the hole */
      loot: [
        { coin: [120, 400], w: 40 },
        { coin: [60, 180], items: { relic: 1 }, w: 24 },
        { coin: [40, 120], items: { gem: [1, 2] }, w: 18 },
        { coin: [200, 700], items: { gold: [1, 3] }, w: 11 },
        { coin: [300, 900], items: { relic: 1, gem: [2, 4], saffron: 2 }, w: 7 }
      ]
    }
  };

  /* =========================================================
     COMPANIONS — the falcon and the cheetah
     The same rope-and-patience idea as the horse, but these two hunt
     with you instead of carrying you.
     ========================================================= */
  C.COMPANION = {
    falcon: {
      id: 'falcon', name: 'باز شکاری', icon: '🦅', model: 'falcon',
      desc: 'روی بازویت می‌نشیند. با کلید H رهایش کن تا شیرجه بزند و شکار بیاورد.',
      biomes: ['rocky', 'snow', 'desert', 'savanna'],
      tameTime: 3.4, tameRange: 5.0, spookRange: 3.0,
      bait: { meat: 1 },        // you hold a piece of meat out
      skill: 'combat', skillLevel: 2,
      max: 3,
      hunt: { range: 34, dmg: 26, travel: 22, cooldown: 9 },
      perch: [0.42, 1.42, -0.05],   // where it sits on your shoulder
      coats: [0x8a6a48, 0x6a5238, 0xa08a68, 0x4a4038]
    },
    cheetah: {
      id: 'cheetah', name: 'یوزپلنگ ایرانی', icon: '🐆', model: 'cheetah',
      desc: 'کمیاب‌ترین جانور این سرزمین. رام که شد کنارت می‌دود و به هر مهاجمی حمله می‌کند.',
      biomes: ['savanna', 'desert', 'plains'],
      tameTime: 6.5, tameRange: 4.2, spookRange: 5.5,
      bait: { meat: 3 },
      skill: 'combat', skillLevel: 5,
      max: 2,
      hunt: { range: 26, dmg: 42, travel: 13, cooldown: 3.4 },
      follow: 6.5, speed: 11.5,
      coats: [0xd8b878, 0xc8a868, 0xe0c890]
    },
    /* both are rare on purpose: this is the reward for wandering */
    spawnChance: 0.30,          // rolled when wildlife tries to place something
    maxWild: 2,
    releaseKey: 'H'
  };

  /* =========================================================
     EARTHQUAKE
     Rare, loud and expensive. Wood frames flex and survive; stone
     and brick crack — which is exactly how it goes in real life.
     ========================================================= */
  C.QUAKE = {
    minDay: 12,
    chancePerDay: 0.045,
    warn: 3.2,                  // seconds of low rumble before the ground moves
    duration: 9,
    shake: 0.42,                // metres of camera displacement at the peak
    /* damage is a share of each structure's max HP, scaled by material */
    damage: [0.12, 0.40],
    material: { wood: 0.55, stone: 1.35, brick: 1.5, other: 1.0 },
    /* what it does besides break things */
    putOutFires: 0.5,           // chance a lit fire is scattered
    exposeOre: 3,               // fresh veins shaken loose near the town
    quietDays: 8                // never twice inside this many days
  };

  /* ===================== STARTING STATE ===================== */
  C.START = {
    coins: 120,
    items: { wood: 12, stone: 6, seed_wheat: 6, seed_carrot: 3, bread: 2 },
    tools: { hoe: 1, can: 1, seeds: 1, axe: 1, pickaxe: 1, sword: 1, bow: 0, rod: 1, food: 1 },
    baseStorage: 220
  };

  C.PLAYER = {
    speed: 6.2, runMul: 1.75, jump: 8.4, gravity: 24,
    /* twice the constitution you used to have, and it keeps doubling as
       you level — a bear should be frightening, not instantly fatal */
    hp: 200, hpPerLevel: 28,
    energy: 100, stamina: 100, staminaPerLevel: 7,
    reach: 5.5, height: 1.8,
    keyLook: 2.1                  // radians/sec of camera turn from the arrow keys
  };

  /* Every cost key has to name a real item (or coin), otherwise the build
     is quietly unaffordable forever and nothing says why. Cheap to check
     once at load; impossible to spot by eye across 60-odd definitions. */
  (function auditCosts() {
    const bad = [];
    for (const id in B) {
      for (let l = 1; l <= (B[id].max || 1); l++) {
        const c = B[id].cost(l);
        for (const k in c) {
          if (k !== 'coin' && !IT[k]) bad.push(id + '.' + k);
        }
      }
    }
    for (const id in C.CREW) {
      const c = C.CREW[id].cost(0);
      for (const k in c) if (k !== 'coin' && !IT[k]) bad.push('crew:' + id + '.' + k);
    }
    if (bad.length && typeof console !== 'undefined') {
      console.error('config: costs name unknown items — ' + bad.join(', '));
    }
  })();

  G.Config = C;
})(window.GAME = window.GAME || {});
