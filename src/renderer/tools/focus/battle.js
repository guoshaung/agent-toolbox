import { h, toast } from '../../core/ui.js';

const VIEW = { width: 960, height: 540 };
const WORLD_BOUNDS = { minX: -2300, maxX: 2300, minY: -1700, maxY: 1700 };
// 兵种谱系：所有可部署/敌方单位共用一套数值，kind 决定专属行为。
const UNIT_CLASSES = {
  default: { id: 'default', name: '默认剑兵', hp: 90, speed: 38, damage: 17, range: 36, weaponReach: 34, weapon: 'sword', action: 'slash', color: '#3d6fe8', size: 1, kind: 'default' },
  swordsman: { id: 'swordsman', name: '剑客', hp: 128, speed: 47, damage: 26, range: 42, weaponReach: 42, weapon: 'sword', action: 'slash', color: '#e2574b', size: 1.05, kind: 'swordsman' },
  samurai: { id: 'samurai', name: '武士', hp: 116, speed: 55, damage: 22, range: 54, weaponReach: 54, weapon: 'katana', action: 'thrust', color: '#e07a2f', size: 1.05, kind: 'samurai' },
  paladin: { id: 'paladin', name: '圣骑士', hp: 250, speed: 26, damage: 18, range: 42, weaponReach: 40, weapon: 'sword', action: 'slash', color: '#d8b64a', size: 1.18, kind: 'paladin' },
  mage: { id: 'mage', name: '法师', hp: 74, speed: 30, damage: 30, range: 178, weapon: 'staff', action: 'cast', color: '#8b5cf6', size: 1.05, kind: 'mage' },
  necromancer: { id: 'necromancer', name: '死灵巫师', hp: 90, speed: 28, damage: 18, range: 152, weapon: 'staff', action: 'cast', color: '#6d4aa0', size: 1.05, kind: 'necromancer' },
  zombie: { id: 'zombie', name: '僵尸', hp: 175, speed: 26, damage: 18, range: 34, weapon: 'claw', action: 'slash', color: '#4f9d63', size: 1.12, kind: 'zombie' },
  skeleton: { id: 'skeleton', name: '骷髅兵', hp: 44, speed: 44, damage: 11, range: 30, weapon: 'claw', action: 'slash', color: '#cfd3da', size: 0.9, kind: 'skeleton' },
  giant: { id: 'giant', name: '巨人', hp: 580, speed: 20, damage: 52, range: 52, weapon: 'club', action: 'slam', color: '#5f6f7a', size: 2.1, kind: 'giant' },
  beast: { id: 'beast', name: '巨兽', hp: 500, speed: 36, damage: 46, range: 48, weapon: 'claw', action: 'slash', color: '#4f8f5e', size: 1.85, kind: 'beast' },
  fortress: { id: 'fortress', name: '移动堡垒', hp: 800, speed: 15, damage: 30, range: 210, weapon: 'cannon', action: 'shoot', color: '#7a8aa0', size: 2.4, kind: 'fortress' },
  raider: { id: 'raider', name: '突击兵', hp: 72, speed: 40, damage: 15, range: 34, weapon: 'sword', action: 'slash', color: '#ef6b73', size: 1, kind: 'default' },
  ranger: { id: 'ranger', name: '远程兵', hp: 48, speed: 30, damage: 11, range: 150, weapon: 'bow', action: 'shoot', color: '#f2bd5d', size: 1, kind: 'ranged' },
  harvester: { id: 'harvester', name: '采集兵', hp: 58, speed: 34, damage: 9, range: 34, weapon: 'pickaxe', action: 'mine', color: '#c28be8', size: 1, kind: 'default' },
};

const PLAYER_PALETTE = ['default', 'swordsman', 'samurai', 'paladin', 'mage', 'necromancer', 'giant', 'beast', 'fortress'];
const ENEMY_TYPES = ['raider', 'ranger', 'harvester', 'zombie', 'necromancer', 'samurai', 'mage', 'beast', 'fortress'].map((id) => UNIT_CLASSES[id]);
// 造兵金币消耗
const UNIT_COST = { default: 8, swordsman: 14, samurai: 16, paladin: 22, mage: 20, necromancer: 16, zombie: 12, skeleton: 6, giant: 42, beast: 36, fortress: 58, raider: 8, ranger: 12, harvester: 10 };
// 升级三选一（吸血鬼幸存者式构筑）
const UPGRADES = [
  { id: 'dmg', name: '伤害强化', icon: '⚔️', desc: '主城攻击伤害 +25%', apply: (s) => { s.dmg *= 1.25; } },
  { id: 'rate', name: '急速炮', icon: '⏱️', desc: '主城射速 +25%', apply: (s) => { s.rate *= 1.25; } },
  { id: 'speed', name: '疾驰', icon: '👟', desc: '移动速度 +15%', apply: (s) => { s.speed *= 1.15; } },
  { id: 'hp', name: '堡垒加固', icon: '🛡️', desc: '主城最大生命 +60 并回复', apply: (s) => { s.hp += 60; } },
  { id: 'cost', name: '军费折扣', icon: '💰', desc: '造兵费用 -20%', apply: (s) => { s.cost *= 0.8; } },
  { id: 'proj', name: '双联炮', icon: '💥', desc: '主城每次多射 1 发', apply: (s) => { s.proj += 1; } },
  { id: 'regen', name: '维修队', icon: '🔧', desc: '主城每秒回复 +2', apply: (s) => { s.regen += 2; } },
  { id: 'income', name: '税收', icon: '🏦', desc: '金币产出 +30%', apply: (s) => { s.income *= 1.3; } },
];
const ENEMY_TIERS = [
  { min: 0, units: ['raider', 'ranger', 'harvester'] },
  { min: 15, units: ['swordsman', 'zombie'] },
  { min: 40, units: ['samurai', 'mage', 'necromancer'] },
  { min: 80, units: ['beast', 'giant'] },
];

const ITEM_TYPES = {
  health: { id: 'health', name: '治疗药剂', color: '#e2574b', glyph: '+', tip: '回血' },
  chest: { id: 'chest', name: '黄金宝箱', color: '#e6b45b', glyph: '$', tip: '+资源' },
  gem: { id: 'gem', name: '能量宝石', color: '#8b5cf6', glyph: '◆', tip: '+资源·小回血' },
  speed: { id: 'speed', name: '疾风靴', color: '#4ec2d8', glyph: '»', tip: '加速' },
  rage: { id: 'rage', name: '狂暴符', color: '#ff6b35', glyph: '⚡', tip: '增伤' },
};

const REGIONS = [
  { id: 'china', name: '🇨🇳 中国·山地', terrain: 'mountain', land: '#6f9a6b', accent: '#5b8658' },
  { id: 'japan', name: '🇯🇵 日本·樱岛', terrain: 'island', land: '#7fb58a', accent: '#e88ea8' },
  { id: 'egypt', name: '🇪🇬 埃及·沙漠', terrain: 'desert', land: '#e3c98f', accent: '#b9884d' },
  { id: 'brazil', name: '🇧🇷 巴西·雨林', terrain: 'rainforest', land: '#3f7a52', accent: '#2f755b' },
  { id: 'norway', name: '🇳🇴 挪威·雪原', terrain: 'fjord', land: '#9fb6c0', accent: '#7d96a3' },
];

// 英雄单位：金币手动召唤，强度高、价格贵
const HERO_TYPES = [
  { id: 'hero_war', name: '战神', kind: 'default', hp: 520, speed: 62, damage: 62, range: 58, weaponReach: 58, weapon: 'club', action: 'slam', color: '#e2574b', size: 1.45, cost: 120 },
  { id: 'hero_mage', name: '大贤者', kind: 'mage', hp: 240, speed: 42, damage: 72, range: 220, weaponReach: 30, weapon: 'staff', action: 'cast', color: '#8b5cf6', size: 1.2, cost: 160 },
  { id: 'hero_knight', name: '龙骑士', kind: 'default', hp: 460, speed: 56, damage: 48, range: 72, weaponReach: 60, weapon: 'katana', action: 'thrust', color: '#d8b64a', size: 1.35, cost: 140 },
  { id: 'hero_art', name: '攻城炮', kind: 'fortress', hp: 950, speed: 22, damage: 62, range: 240, weaponReach: 30, weapon: 'cannon', action: 'shoot', color: '#5f6f7a', size: 2.1, cost: 190 },
];

// 主城架构：决定主城自动产兵、炮塔元素与外观
const ARCHS = [
  { id: 'barracks', name: '兵营', color: '#3d6fe8', element: 'normal', prod: 'default', prodInterval: 2.2, prodCap: 10, desc: '自动产剑兵 · 普通弹' },
  { id: 'flame', name: '烈焰塔', color: '#ff7a3d', element: 'fire', prod: 'swordsman', prodInterval: 2.6, prodCap: 9, desc: '自动产剑客 · 火焰弹' },
  { id: 'mage', name: '法师塔', color: '#8b5cf6', element: 'magic', prod: 'mage', prodInterval: 3.2, prodCap: 8, desc: '自动产法师 · 魔法弹' },
  { id: 'knight', name: '骑士塔', color: '#d8b64a', element: 'normal', prod: 'paladin', prodInterval: 3.6, prodCap: 7, desc: '自动产圣骑 · 治疗光环' },
  { id: 'beast', name: '兽巢', color: '#4f8f5e', element: 'fire', prod: 'beast', prodInterval: 4.2, prodCap: 6, desc: '自动产巨兽 · 烈焰弹' },
];

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function ph(n) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }
function hexToRgb(h) { const c = h.replace('#', ''); const x = c.length === 3 ? c.split('').map((v) => v + v).join('') : c; const n = parseInt(x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixColor(a, b, t) { const pa = hexToRgb(a); const pb = hexToRgb(b); const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t)); return `rgb(${c[0]},${c[1]},${c[2]})`; }

function strokeLength(stroke = []) {
  let length = 0;
  for (let index = 1; index < stroke.length; index += 1) length += distance(stroke[index - 1], stroke[index]);
  return length;
}

function drawingBounds(strokes = []) {
  const points = strokes.flat().filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function analyzeCustomDrawing(strokes = []) {
  const bounds = drawingBounds(strokes);
  if (!bounds) return { combatClass: 'melee', weapon: 'sword', action: 'slash', weaponReach: 30, range: 34, weaponLabel: '近战刀具' };
  const centerX = 110;
  const weaponPoints = strokes.flat().filter((point) => point && (point.x < 72 || point.x > 148));
  const extension = weaponPoints.reduce((max, point) => Math.max(max, Math.abs(point.x - centerX)), 0);
  const candidates = strokes.map((stroke) => {
    const length = strokeLength(stroke);
    const first = stroke[0]; const last = stroke[stroke.length - 1];
    const chord = first && last ? distance(first, last) : 0;
    const strokeBounds = drawingBounds([stroke]);
    return { length, straightness: length ? chord / length : 0, width: strokeBounds ? strokeBounds.maxX - strokeBounds.minX : 0, height: strokeBounds ? strokeBounds.maxY - strokeBounds.minY : 0 };
  });
  const bowLike = candidates.some((candidate) => candidate.length > 24 && candidate.straightness < .9 && candidate.height > 18 && candidate.width > 10);
  const bladeLike = candidates.some((candidate) => candidate.length > 30 && candidate.straightness > .92 && (candidate.width > candidate.height * 1.45 || candidate.height > candidate.width * 1.45));
  const staffLike = candidates.some((candidate) => candidate.length > 34 && candidate.width > 14 && Math.abs(candidate.height - candidate.width) < 12);
  const weapon = staffLike && !bowLike && !bladeLike ? 'staff' : bowLike && !bladeLike ? 'bow' : 'sword';
  const combatClass = weapon === 'bow' || weapon === 'staff' ? 'ranged' : 'melee';
  const weaponReach = clamp(Math.round((extension > 0 ? extension : 42) * (weapon === 'bow' ? .5 : .62)), 28, 88);
  const label = weapon === 'staff' ? '法师法杖' : weapon === 'bow' ? '远程弓箭' : `近战刀具 · ${weaponReach}px`;
  return { combatClass, weapon, action: weapon === 'bow' ? 'shoot' : weapon === 'staff' ? 'cast' : 'slash', weaponReach, range: weapon === 'bow' ? Math.max(120, weaponReach * 4) : weapon === 'staff' ? Math.max(130, weaponReach * 5) : weaponReach, weaponLabel: label };
}

export function handEffectType(weapon = 'sword') {
  if (weapon === 'bow' || weapon === 'cannon') return 'charge';
  if (weapon === 'pickaxe') return 'sparks';
  if (weapon === 'staff') return 'magic';
  if (weapon === 'club') return 'crush';
  if (weapon === 'claw') return 'slash';
  return 'energy-trail';
}

export function stickmanPose(unit = {}) {
  const phase = Number.isFinite(unit.walkPhase) ? unit.walkPhase : 0;
  const walking = Boolean(unit.moving);
  const stride = walking ? Math.sin(phase) * 9 : 0;
  const bob = walking ? Math.abs(Math.cos(phase)) * 2 : 0;
  const attacking = Number(unit.attackClock) > 0;
  const direction = Number.isFinite(unit.facing) ? unit.facing : (unit.team === 'enemy' ? -1 : 1);
  const attackDuration = Math.max(.18, Number(unit.attackDuration) || .3);
  const attackProgress = attacking ? 1 - clamp(Number(unit.attackClock) / attackDuration, 0, 1) : 0;
  const swing = Math.sin(attackProgress * Math.PI);
  const weapon = unit.weapon || 'sword';
  const mining = weapon === 'pickaxe' && attacking;
  const shooting = (weapon === 'bow' || weapon === 'cannon') && attacking;
  const armExt = { sword: 9, katana: 14, staff: 8, club: 12, claw: 10, cannon: 6 }[weapon] ?? 9;
  return {
    headY: -18 + bob,
    torsoTopY: -9 + bob,
    hipY: 14 + bob,
    leftLeg: { x: -10 + stride, y: 28 + bob },
    rightLeg: { x: 10 - stride, y: 28 + bob },
    leftArm: { x: -12 - (attacking ? direction * (mining ? 8 : shooting ? 3 : 3) * swing : 0), y: 7 + bob - (mining ? 8 * swing : 0) },
    rightArm: { x: 12 + (attacking ? direction * (mining ? 13 : shooting ? 2 : armExt) * swing : 0), y: 7 + bob - (mining ? 13 * swing : shooting ? 2 * swing : 0) },
    attackProgress,
    swing,
    weapon,
  };
}

export function createBattle(root, ctx) {
  const { config } = ctx;
  const canvas = h('canvas', { class: 'battle__canvas', width: String(VIEW.width), height: String(VIEW.height), tabindex: '0' });
  const drawPad = h('canvas', { class: 'battle__draw-pad', width: '220', height: '140' });
  const canvasContext = canvas.getContext('2d');
  const padContext = drawPad.getContext('2d');
  const statusEl = h('span', { class: 'battle__status' }, '准备');
  const resourceEl = h('strong', { class: 'battle__resource' }, '金币 0');
  const unitCountEl = h('span', { class: 'faint' }, '击杀 0');
  const paletteEl = h('div', { class: 'battle__palette' });
  const enemyPaletteEl = h('div', { class: 'battle__enemy-palette' });
  const itemsLegendEl = h('div', { class: 'battle__items-legend' });
  const teamSelect = h('select', { class: 'field field--sm', title: '点击部署方', onchange: () => { deployTeam = teamSelect.value; setMode('unit'); } },
    h('option', { value: 'player' }, '我方护卫'), h('option', { value: 'enemy' }, '敌方样本'));
  const startBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => toggleBattle() }, '开战');
  const resetBtn = h('button', { class: 'btn btn--sm', onclick: () => resetBattle() }, '重新开局');
  const regionSelect = h('select', { class: 'field field--sm', title: '选择地图主题', onchange: () => selectRegion(regionSelect.value) }, REGIONS.map((region) => h('option', { value: region.id }, region.name)));
  const customName = h('input', { class: 'field field--sm', placeholder: '手绘兵种名称', maxlength: '18' });
  const saveCustomBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: saveCustomUnit }, '保存为兵种');
  const customHint = h('div', { class: 'faint' }, '画一笔就是一个可重复部署的兵种，不是单独一个士兵。');
  const customColor = h('input', { type: 'color', class: 'battle__color', title: '兵种颜色', value: '#7c5ac8' });
  const customRandom = h('button', { class: 'btn btn--sm', title: '随机生成一个兵种', onclick: randomCustom }, '🎲 随机');
  const upgradePanel = h('div', { class: 'battle__upgrade', style: { display: 'none' } });
  const archEl = h('div', { class: 'battle__arch' });

  let running = false;
  let animationFrame = 0;
  let lastTime = 0;
  let mode = 'unit';
  let deployTeam = 'player';
  let selectedTypeId = 'hero_war';
  let towerClassId = 'default';
  let resources = 80;
  let kills = 0;
  let units = [];
  let effects = [];
  let projectiles = [];
  let items = [];
  let obstacles = [];
  let particles = [];
  let damageNumbers = [];
  let shake = 0;
  let timeOfDay = 0.42;
  let elapsed = 0;
  let spawnTimer = 1.6;
  let incomeTimer = 4;
  let pickupTimer = 3;
  let xp = 0;
  let xpNeed = 12;
  let level = 1;
  let xps = [];
  let stats = { dmg: 1, rate: 1, speed: 1, hp: 1, cost: 1, proj: 1, regen: 0, income: 1 };
  let cameraX = 0;
  let cameraY = 0;
  let victory = false;
  let levelUpOpen = false;
  let drawing = false;
  let currentStroke = null;
  let customTypes = config.get('focus.battle.customTypes', []) || [];
  let customStrokes = [];
  let customAnalysis = analyzeCustomDrawing(customStrokes);
  let currentRegionId = config.get('focus.battle.region', 'china');
  const keys = {};

  let tower = null;
  let archId = ARCHS[0].id;
  let autoTimer = 0;
  let motes = [];
  let clouds = [];
  let enemyCastles = [];
  let victoryWin = false;
  let neutrals = [];

  function activeRegion() { return REGIONS.find((region) => region.id === currentRegionId) || REGIONS[0]; }
  function activeArch() { return ARCHS.find((a) => a.id === archId) || ARCHS[0]; }

  // 俯视角地图障碍：树木 / 岩石 / 水域，固定生成、可阻挡碰撞。
  function buildObstacles() {
    const list = [];
    const cell = 300;
    const gx0 = Math.floor(WORLD_BOUNDS.minX / cell); const gx1 = Math.ceil(WORLD_BOUNDS.maxX / cell);
    const gy0 = Math.floor(WORLD_BOUNDS.minY / cell); const gy1 = Math.ceil(WORLD_BOUNDS.maxY / cell);
    for (let gx = gx0; gx <= gx1; gx += 1) for (let gy = gy0; gy <= gy1; gy += 1) {
      const s = ph(gx * 7.7 + gy * 13.1);
      if (s < 0.10) list.push({ x: gx * cell + ph(gx * 1.3) * cell, y: gy * cell + ph(gy * 2.9) * cell, r: 18 + ph(gx * 3.1) * 16, type: 'tree' });
      else if (s < 0.19) list.push({ x: gx * cell + ph(gx * 1.7) * cell, y: gy * cell + ph(gy * 3.3) * cell, r: 12 + ph(gx * 5.1) * 14, type: 'rock' });
      else if (s < 0.24 && gy % 3 === 0) list.push({ x: gx * cell + 90, y: gy * cell + 56, r: 58 + ph(gx * 6.1) * 30, type: 'water' });
    }
    return list;
  }
  // 圆形障碍碰撞：把实体推到圆外。
  function collide(ent, radius) {
    for (const o of obstacles) {
      const dx = ent.x - o.x; const dy = ent.y - o.y; const d = Math.hypot(dx, dy); const min = radius + o.r;
      if (d < min && d > 0.01) { ent.x = o.x + dx / d * min; ent.y = o.y + dy / d * min; }
    }
    ent.x = clamp(ent.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    ent.y = clamp(ent.y, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);
  }
  // 手绘兵种的解析结果必须缓存：analyzeCustomDrawing 会多次遍历全部笔画，
  // 而 unitType() 在每帧、每个单位上要调用约 6 次。不缓存时 90 个单位光解析类型
  // 就要 37ms/帧（60fps 预算的 222%），直接卡死；缓存后每个手绘兵种只解析一次。
  // 返回的对象是共享引用，调用方只读，不要原地修改。
  let customCache = null;
  function customClasses() {
    if (customCache) return customCache;
    const list = customTypes.map((item) => {
      const profile = analyzeCustomDrawing(item.strokes);
      const hasSavedProfile = item.combatClass === 'melee' || item.combatClass === 'ranged';
      return {
        ...UNIT_CLASSES.default, ...profile, ...item, kind: 'custom', weapon: hasSavedProfile ? item.weapon : profile.weapon,
        action: hasSavedProfile ? item.action : profile.action, range: hasSavedProfile && Number(item.range) ? Number(item.range) : profile.range,
        weaponReach: hasSavedProfile && Number(item.weaponReach) ? Number(item.weaponReach) : profile.weaponReach,
      };
    });
    customCache = { list, byId: new Map(list.map((type) => [type.id, type])) };
    return customCache;
  }
  function unitTypes() {
    return [...PLAYER_PALETTE.map((id) => UNIT_CLASSES[id]), ...customClasses().list];
  }
  function classById(id) { return UNIT_CLASSES[id] || HERO_TYPES.find((h) => h.id === id) || customClasses().byId.get(id) || UNIT_CLASSES.default; }
  function heroById(id) { return HERO_TYPES.find((h) => h.id === id); }
  function kingsAlive() { return units.filter((u) => u.team === 'player' && !u.dead && u.isHeroUnit).length; }
  function activeClass() { return classById(selectedTypeId); }
  function unitType(unit) {
    if (unit.team === 'enemy') return UNIT_CLASSES[unit.typeId] || UNIT_CLASSES.raider;
    const t = classById(unit.typeId);
    return t;
  }

  function initCinematics() {
    tower = {
      id: 'tower', typeId: 'default', x: 0, y: 0, hp: 720, maxHp: 720, weapon: 'sword', damage: 22, range: 44, color: '#3d6fe8', kindCls: 'default', element: 'normal',
      cooldown: 0, attackClock: 0, attackDuration: .3, facing: 1, walkPhase: 0, moving: false, hitFlash: 0, isHero: true, mvx: 0, mvy: 0, mvl: 0, size: 1,
    };
    setTowerClass(towerClassId);
    const a = activeArch(); tower.color = a.color; tower.element = a.element;
    initAmbient();
    cameraX = clamp(tower.x - VIEW.width / 2, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX - VIEW.width);
    cameraY = clamp(tower.y - VIEW.height / 2, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY - VIEW.height);
  }

  function setTowerClass(id) {
    towerClassId = id;
    const t = classById(id);
    if (t && tower) {
      tower.typeId = id;
      tower.weapon = t.weapon || 'sword';
      tower.damage = t.damage;
      tower.range = Math.max(44, t.range);
      tower.color = t.color;
      tower.kindCls = t.kind;
    }
  }

  function drawPadBackground() {
    padContext.clearRect(0, 0, drawPad.width, drawPad.height);
    padContext.fillStyle = '#f8fafc'; padContext.fillRect(0, 0, drawPad.width, drawPad.height);
    padContext.strokeStyle = '#d7dee9'; padContext.lineWidth = 1;
    for (let x = 10; x < drawPad.width; x += 20) { padContext.beginPath(); padContext.moveTo(x, 0); padContext.lineTo(x, drawPad.height); padContext.stroke(); }
    for (let y = 10; y < drawPad.height; y += 20) { padContext.beginPath(); padContext.moveTo(0, y); padContext.lineTo(drawPad.width, y); padContext.stroke(); }
    padContext.strokeStyle = '#26384b'; padContext.lineWidth = 4; padContext.lineCap = 'round'; padContext.lineJoin = 'round';
    for (const stroke of customStrokes) { padContext.beginPath(); stroke.forEach((point, index) => index ? padContext.lineTo(point.x, point.y) : padContext.moveTo(point.x, point.y)); padContext.stroke(); }
    if (currentStroke?.length) { padContext.beginPath(); currentStroke.forEach((point, index) => index ? padContext.lineTo(point.x, point.y) : padContext.moveTo(point.x, point.y)); padContext.stroke(); }
  }

  function padPoint(event) {
    const rect = drawPad.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) * drawPad.width / rect.width, 0, drawPad.width), y: clamp((event.clientY - rect.top) * drawPad.height / rect.height, 0, drawPad.height) };
  }

  drawPad.addEventListener('pointerdown', (event) => { drawing = true; currentStroke = [padPoint(event)]; drawPad.setPointerCapture(event.pointerId); drawPadBackground(); });
  drawPad.addEventListener('pointermove', (event) => { if (!drawing) return; currentStroke.push(padPoint(event)); drawPadBackground(); });
  drawPad.addEventListener('pointerup', () => {
    if (!drawing) return;
    drawing = false;
    if (currentStroke.length > 1) customStrokes.push(currentStroke);
    currentStroke = null;
    customAnalysis = analyzeCustomDrawing(customStrokes);
    customHint.textContent = `自动识别：${customAnalysis.weaponLabel}；保存后按该武器执行${customAnalysis.weapon === 'bow' ? '射击' : customAnalysis.weapon === 'staff' ? '施法' : '劈砍'}动作。`;
    drawPadBackground();
  });

  function saveCustomUnit() {
    if (!customStrokes.length) return toast('先在绘制区画出一个兵种轮廓', 'info');
    const name = customName.value.trim() || `手绘兵种 ${customTypes.length + 1}`;
    const profile = customAnalysis;
    const item = { id: `custom-${Date.now()}`, name, strokes: customStrokes, hp: 75, speed: profile.combatClass === 'ranged' ? 30 : 34, damage: profile.combatClass === 'ranged' ? 13 : 18, color: customColor.value || '#7c5ac8', ...profile };
    customTypes = [...customTypes, item];
    customCache = null;
    config.set('focus.battle.customTypes', customTypes);
    selectedTypeId = item.id;
    customName.value = '';
    renderPalette();
    toast(`已保存兵种“${name}”，可以重复部署`, 'good');
  }

  function randomCustom() {
    const r = (a, b) => a + Math.random() * (b - a);
    const pick = Math.floor(Math.random() * 5);
    const body = [[{ x: r(98, 108), y: r(78, 92) }, { x: r(104, 114), y: r(34, 58) }]];
    let weapon;
    if (pick === 0) weapon = [{ x: 110, y: 52 }, { x: r(150, 175), y: r(38, 60) }];
    else if (pick === 1) weapon = [{ x: 108, y: 42 }, { x: r(150, 162), y: r(52, 66) }, { x: 106, y: r(76, 84) }];
    else if (pick === 2) weapon = [{ x: 126, y: 34 }, { x: 126, y: r(86, 94) }, { x: 110, y: 52 }, { x: 148, y: 46 }];
    else if (pick === 3) weapon = [{ x: 108, y: 52 }, { x: r(150, 168), y: r(44, 60) }];
    else weapon = [{ x: 110, y: 32 }, { x: 110, y: 78 }, { x: 104, y: 92 }];
    customStrokes = [...body, ...(weapon ? [weapon] : [])];
    customAnalysis = analyzeCustomDrawing(customStrokes);
    customColor.value = ['#c0392b', '#2f7fd4', '#c28be8', '#e67e22', '#27ae60', '#34495e', '#8b5cf6'][Math.floor(Math.random() * 7)];
    customHint.textContent = `随机生成：${customAnalysis.weaponLabel}；点“保存为兵种”即可部署，或再点“随机”重抽。`;
    drawPadBackground();
  }

  function setMode(next) {
    mode = next;
    const modeText = mode === 'unit' ? '点击地图召唤英雄' : '点击地图部署敌方样本';
    statusEl.textContent = running ? `进行中 · ${modeText}` : modeText;
  }

  function renderPalette() {
    const heroFull = kingsAlive() >= 8;
    const manual = [...HERO_TYPES, ...customClasses().list];
    paletteEl.replaceChildren(...manual.map((type) => {
      const isHero = !!heroById(type.id);
      const cost = Math.round((isHero ? (type.cost || 120) : 14) * (stats.cost || 1));
      const afford = resources >= cost && (isHero ? !heroFull : true);
      return h('button', { class: `battle__unit-btn${isHero ? ' battle__hero-btn' : ''}${type.id === selectedTypeId ? ' is-active' : ''}${!afford ? ' is-disabled' : ''}`, disabled: !afford ? true : false, onclick: () => { selectedTypeId = type.id; deployTeam = 'player'; teamSelect.value = 'player'; setMode('unit'); renderPalette(); } }, drawTinyUnit(type), h('span', {}, `${isHero ? '⭐' : '✏'}${type.name} · ${cost}金`));
    }));
    enemyPaletteEl.replaceChildren(...ENEMY_TYPES.map((type) => h('button', { class: 'battle__unit-btn battle__unit-btn--enemy', onclick: () => { selectedTypeId = type.id; deployTeam = 'enemy'; teamSelect.value = 'enemy'; setMode('unit'); } }, drawTinyUnit(type), h('span', {}, type.name))));
    itemsLegendEl.replaceChildren(...Object.values(ITEM_TYPES).map((item) => h('span', { class: 'battle__item-tag', style: `color:${item.color}` }, h('b', { style: `color:${item.color}` }, item.glyph), ` ${item.name}·${item.tip}`)));
  }

  function drawTinyUnit(type) {
    const icon = h('span', { class: 'battle__unit-icon', style: `font-size:${Math.min(16, 11 * (type.size || 1))}px` });
    icon.style.setProperty('--unit-color', type.color);
    return icon;
  }

  function makeUnit(team, type, x, y, bonus = {}) {
    const scale = bonus.pow || 1;
    const hp = (bonus.hp || type.hp) * scale;
    const kind = type.kind || 'default';
    const roll = Math.random();
    const trait = kind === 'fortress' || kind === 'skeleton' ? 'normal' : roll < .5 ? 'normal' : roll < .62 ? 'aggressive' : roll < .72 ? 'strategic' : roll < .82 ? 'coward' : roll < .9 ? 'surrender' : 'kamikaze';
    const atk = trait === 'aggressive' ? 1.2 : 1;
    const spd = trait === 'aggressive' ? 1.08 : trait === 'strategic' ? 1.05 : 1;
    return {
      id: `unit-${Date.now()}-${Math.random().toString(16).slice(2)}`, team, typeId: type.id, weapon: type.weapon || 'sword', action: type.action || 'slash',
      x, y, hp, maxHp: hp, pow: scale, size: type.size || 1, kind, trait, atk, spd, cooldown: Math.random() * .5, dead: false,
      moving: false, walkPhase: Math.random() * Math.PI * 2, attackClock: 0, attackDuration: .3, facing: team === 'enemy' ? -1 : 1, buff: {}, buffTimer: 0, healTimer: 0, minions: 0, ownerId: null, hitFlash: 0, fleeing: false,
    };
  }

  function burstParticles(x, y, color, count, opts = {}) {
    for (let index = 0; index < count; index += 1) {
      const life = opts.life ?? (.4 + Math.random() * .45);
      const angle = (opts.angle ?? Math.random() * Math.PI * 2) + (Math.random() - .5) * (opts.spread ?? .5);
      const speed = (opts.speed ?? (60 + Math.random() * 150)) * (.6 + Math.random() * .8);
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - (opts.up ?? 20), life, maxLife: life, size: opts.size ?? (1.5 + Math.random() * 2.5), color, gravity: opts.gravity ?? 260 });
    }
  }
  function addDamage(x, y, amount, color = '#ffffff', scale = 1) {
    damageNumbers.push({ x: x + (Math.random() - .5) * 12, y: y - 18, amount: Math.round(amount), life: .85, maxLife: .85, color, scale });
  }
  function kill(target) {
    if (!target || target.dead) return;
    target.dead = true; target.hitFlash = .45;
    burstParticles(target.x, target.y, target.team === 'enemy' ? '#e24652' : '#5b8cff', 30, { speed: 120, up: 50, life: .75, size: 2.5 });
    burstParticles(target.x, target.y, '#ffd54f', 8, { up: 20, size: 2 });
    effects.push({ type: 'death', x: target.x, y: target.y, life: .55, maxLife: .55, color: target.team === 'enemy' ? '#e24652' : '#5b8cff' });
    if (target.team === 'enemy') xps.push({ x: target.x, y: target.y, amount: Math.max(1, Math.round(target.pow || 1)) });
  }
  // 通用伤害（单位/指挥官/基地都可用）
  function hurt(target, dmg, color) {
    target.hp -= dmg; target.hitFlash = .22;
    const y = target.isBase ? target.y - 46 : target.y - (target.isHero ? 34 : 12);
    effects.push({ type: 'impact', x: target.x, y: y - 10, life: .3, maxLife: .3, color });
    burstParticles(target.x, y, color, 6, { up: 24 });
    addDamage(target.x, y - 14, dmg, '#ffffff');
    if (target.hp <= 0) {
      if (target.isCastle && target.alive) {
        target.alive = false; target.hp = 0;
        burstParticles(target.x, target.y, '#ffb066', 44, { up: 70, speed: 190, life: .85, size: 3.2 });
        burstParticles(target.x, target.y, '#ffffff', 16, { up: 60, speed: 140 });
        effects.push({ type: 'death', x: target.x, y: target.y, life: .7, maxLife: .7, color: '#ff8a5b' });
        shake = Math.max(shake, .5);
        checkWin();
      } else if (!target.isHero && !target.isBase && !target.dead) kill(target);
    }
  }
  function meleeHit(unit, type, target, mult = 1) {
    const dmg = type.damage * (unit.buff?.dmg || 1) * (unit.pow || 1) * (unit.atk || 1) * mult;
    unit.facing = target.x < unit.x ? -1 : 1;
    effects.push({ type: 'slash', x: target.x, y: target.y - (target.isHero ? 34 : target.isBase ? 50 : 8), life: .28, maxLife: .28, color: type.color, direction: unit.facing });
    if (type.weapon === 'staff' || type.kind === 'mage' || type.kind === 'necromancer') burstParticles(target.x, target.y, '#c9a6ff', 8, { up: 30, speed: 90 });
    else if (type.weapon === 'club' || type.weapon === 'cannon') burstParticles(target.x, target.y, '#ff9a4d', 10, { up: 40, speed: 110 });
    hurt(target, dmg, type.color);
  }

  // ---- 怪物刷新：从屏幕四条边缘四面八方涌来 ----
  function spawnEnemy() {
    const tier = ENEMY_TIERS.filter((t) => elapsed >= t.min).pop();
    const pool = tier ? tier.units : ENEMY_TIERS[0].units;
    const id = pool[Math.floor(Math.random() * pool.length)];
    const side = Math.floor(Math.random() * 4);
    let sx, sy;
    const pad = 60;
    if (side === 0) { sx = cameraX + Math.random() * VIEW.width; sy = cameraY - pad; }
    else if (side === 1) { sx = cameraX + VIEW.width + pad; sy = cameraY + Math.random() * VIEW.height; }
    else if (side === 2) { sx = cameraX + Math.random() * VIEW.width; sy = cameraY + VIEW.height + pad; }
    else { sx = cameraX - pad; sy = cameraY + Math.random() * VIEW.height; }
    sx = clamp(sx, WORLD_BOUNDS.minX + 20, WORLD_BOUNDS.maxX - 20);
    sy = clamp(sy, WORLD_BOUNDS.minY + 20, WORLD_BOUNDS.maxY - 20);
    const pow = 1 + elapsed * .008 + Math.pow(elapsed / 60, 1.6) * .15;
    units.push(makeUnit('enemy', UNIT_CLASSES[id], sx, sy, { pow }));
  }
  function updateSpawning(dt) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      const alive = units.filter((u) => u.team === 'enemy' && !u.dead).length;
      // 开场少（1~2 只），随存活时间增多到每波 5 只，刷怪间隔也越来越短
      const count = Math.min(5, Math.max(1, Math.round(1.5 + elapsed * .34)));
      const aliveCap = Math.min(60, 18 + Math.floor(elapsed / 4));
      for (let i = 0; i < count && alive + i < aliveCap; i += 1) spawnEnemy();
      spawnTimer = Math.max(.5, 2.6 - elapsed * .016);
    }
  }

  // ---- 敌方 AI ----
  function nearestEnemyUnit(ex, ey, team) {
    let best = null; let bd = Infinity;
    for (const u of units) if (!u.dead && u.team !== team) { const d = distance({ x: ex, y: ey }, u); if (d < bd) { bd = d; best = u; } }
    return { unit: best, dist: bd };
  }
  function findEnemyTarget(enemy) {
    let best = null; let bd = Infinity;
    if (tower.hp > 0) { const d = distance(enemy, tower); if (d < bd) { bd = d; best = { kind: 'tower', ref: tower }; } }
    const nu = nearestEnemyUnit(enemy.x, enemy.y, 'enemy');
    if (nu.unit && nu.dist < bd) { best = { kind: 'unit', ref: nu.unit }; bd = nu.dist; }
    for (const n of neutrals) if (!n.dead && n.side === 'player') { const d = distance(enemy, n); if (d < bd) { bd = d; best = { kind: 'unit', ref: n }; } }
    return best;
  }
  function enemyBehavior(unit, type, dt) {
    const target = findEnemyTarget(unit);
    // 性格：自爆 / 投降 / 懦弱
    const lowHp = unit.hp / unit.maxHp < .3;
    if (unit.trait === 'kamikaze' && lowHp) {
      if (target && distance(unit, target.ref) < 30) explodeUnit(unit);
      else if (target) moveUnit(unit, target.ref, dt);
      else explodeUnit(unit);
      return;
    }
    if (unit.trait === 'surrender' && lowHp) {
      unit.fleeing = true; retreatUnit(unit, dt); return;
    }
    const alone = !units.some((o) => o.team === 'enemy' && o !== unit && !o.dead);
    if (unit.trait === 'coward' && alone) { unit.fleeing = true; retreatUnit(unit, dt); return; }
    unit.fleeing = false;
    if (target) {
      const d = distance(unit, target.ref);
      if (d <= type.range + 6) { attackUnit(unit, type, target, dt); }
      else { if (unit.trait === 'strategic' && target.kind !== 'tower') moveUnit(unit, strategicTarget(unit, target.ref, type), dt); else moveUnit(unit, target.ref, dt); }
    }
  }
  function retreatUnit(unit, dt) {
    const away = findEnemyTarget(unit);
    if (away) {
      const dx = unit.x - away.ref.x, dy = unit.y - away.ref.y; const len = Math.hypot(dx, dy) || 1;
      moveUnit(unit, { x: clamp(unit.x + dx / len * 220, WORLD_BOUNDS.minX + 20, WORLD_BOUNDS.maxX - 20), y: clamp(unit.y + dy / len * 220, WORLD_BOUNDS.minY + 20, WORLD_BOUNDS.maxY - 20) }, dt);
    }
    if (Math.random() < .05) burstParticles(unit.x, unit.y - 18, '#ffffff', 2, { up: 20, speed: 12, gravity: 40, size: 1.4 });
  }
  function attackUnit(unit, type, target, dt) {
    if (unit.cooldown > 0) return;
    const ref = target.ref; const dmgBuff = unit.buff?.dmg || 1; const dmg = type.damage * dmgBuff * (unit.pow || 1) * (unit.atk || 1);
    unit.facing = ref.x < unit.x ? -1 : 1;
    if (type.kind === 'fortress') { unit.cooldown = 1.3; unit.attackClock = .5; unit.attackDuration = .5; unit.action = 'shoot'; projectiles.push({ kind: 'cannon', x: unit.x + unit.facing * 14, y: unit.y - 12, target: ref, speed: 340, damage: dmg, color: type.color, life: 2.4, splash: 26, team: 'enemy' }); }
    else if (type.kind === 'mage' || type.kind === 'necromancer') { unit.cooldown = 1.0; unit.attackClock = .35; unit.attackDuration = .35; unit.action = 'cast'; projectiles.push({ kind: type.kind === 'mage' ? 'magic' : 'curse', x: unit.x + unit.facing * 15, y: unit.y - 8, target: ref, speed: 300, damage: dmg, color: type.color, life: 2.2, splash: 16, team: 'enemy' }); }
    else if (type.kind === 'samurai') { unit.cooldown = .55; unit.attackClock = .34; unit.attackDuration = .34; unit.action = 'thrust'; meleeHit(unit, type, ref, 1.3); }
    else if (type.kind === 'giant') { unit.cooldown = 1.15; unit.attackClock = .55; unit.attackDuration = .55; unit.action = 'slam'; aoeMelee(unit, type, 62); burstParticles(unit.x, unit.y, '#aeb7c4', 14, { up: 40, speed: 130 }); shake = Math.max(shake, .35); effects.push({ type: 'slam', x: unit.x, y: unit.y, life: .4, maxLife: .4, color: type.color }); }
    else if (type.kind === 'beast') { unit.cooldown = .8; unit.attackClock = .4; unit.attackDuration = .4; unit.action = 'slash'; aoeMelee(unit, type, 48); burstParticles(unit.x, unit.y, '#6fbf86', 8, { up: 30 }); }
    else {
      const mult = type.kind === 'swordsman' ? 1.35 : 1;
      unit.cooldown = .48; unit.attackClock = .3; unit.attackDuration = .3; unit.action = type.action || 'slash';
      if (type.weapon === 'bow') { unit.cooldown = .7; unit.action = 'shoot'; projectiles.push({ kind: 'arrow', x: unit.x + unit.facing * 14, y: unit.y - 8, target: ref, speed: 430, damage: dmg, color: type.color, life: 2, team: 'enemy' }); }
      else { meleeHit(unit, type, ref, mult); if (type.kind === 'zombie') tryInfect(unit, ref); }
    }
  }
  function aoeMelee(unit, type, radius) {
    for (const o of units) if (!o.dead && o.team !== unit.team && distance(unit, o) <= radius) meleeHit(unit, type, o, 1);
    if (tower.hp > 0 && distance(unit, tower) <= radius) meleeHit(unit, type, tower, 1);
    if (tower.hp > 0 && distance(unit, tower) <= radius) meleeHit(unit, type, tower, 1);
  }
  function tryInfect(zombie, target) {
    if (target.isHero || target.isBase) return;
    if (!target.dead || target.infected) return;
    const zc = UNIT_CLASSES.zombie;
    target.infected = true; target.dead = false;
    target.team = zombie.team; target.typeId = 'zombie'; target.weapon = 'claw'; target.action = 'slash'; target.kind = 'zombie';
    target.hp = zc.hp; target.maxHp = zc.hp; target.size = zc.size; target.cooldown = .4; target.moving = false;
    effects.push({ type: 'spawn', x: target.x, y: target.y, life: .5, maxLife: .5, color: '#4f9d63' });
  }
  function strategicTarget(unit, enemy, type) {
    const dx = enemy.x - unit.x; const dy = enemy.y - unit.y; const len = Math.hypot(dx, dy) || 1;
    const ranged = type.kind === 'ranged' || ['bow', 'staff', 'cannon'].includes(type.weapon);
    if (ranged) { const ideal = type.range * .7; return { x: clamp(enemy.x - dx / len * ideal + Math.sin(elapsed * 4 + unit.x) * 24, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX), y: clamp(enemy.y - dy / len * ideal + Math.cos(elapsed * 3 + unit.x) * 14, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY) }; }
    const side = ph(unit.id.length) > .5 ? 1 : -1;
    const px = -dy / len; const py = dx / len;
    return { x: clamp(enemy.x + px * side * 30 - dx / len * 20, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX), y: clamp(enemy.y + py * side * 30 - dy / len * 20, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY) };
  }
  function explodeUnit(unit) {
    if (unit.dead) return;
    unit.dead = true;
    const dmg = unit.maxHp * .7 + 30;
    for (const o of units) if (!o.dead && o.team !== unit.team && distance(unit, o) < 66) { o.hp -= dmg; o.hitFlash = .3; if (o.hp <= 0) kill(o); }
    if (distance(unit, tower) < 66) hurt(tower, dmg, '#ff9a3d');
    if (distance(unit, tower) < 66) hurt(tower, dmg, '#ff9a3d');
    burstParticles(unit.x, unit.y, '#ff9a3d', 60, { speed: 200, up: 70, life: .8, size: 3.2, gravity: 130 });
    effects.push({ type: 'burst', x: unit.x, y: unit.y, life: .5, maxLife: .5, color: '#ff9a3d', radius: 66 });
    effects.push({ type: 'slam', x: unit.x, y: unit.y, life: .42, maxLife: .42, color: '#ff9a3d' });
    shake = Math.max(shake, .5);
  }

  // ---- 我方兵 AI：残血回堡垒治疗、满血出战；玩家操控堡垒时跟着堡垒走 ----
  function allyBehavior(unit, type, dt) {
    unit.cooldown -= dt; unit.attackClock = Math.max(0, unit.attackClock - dt); unit.moving = false;
    if (type.kind === 'paladin') pulseHeal(unit, dt);
    unit.hitFlash = Math.max(0, unit.hitFlash - dt);
    const hpPct = unit.hp / unit.maxHp;
    const dFort = distance(unit, tower);
    // 离堡垒太远 → 直接传回堡垒
    if (dFort > 900) {
      unit.x = tower.x + (ph(unit.id.length) - .5) * 26;
      unit.y = tower.y + 26;
      unit.cooldown = .4; unit.moving = false;
      effects.push({ type: 'spawn', x: unit.x, y: unit.y, life: .55, maxLife: .55, color: unit.color || type.color });
      burstParticles(tower.x, tower.y + 20, '#9be0ff', 8, { up: 30 });
      return;
    }
    // 残血回堡垒范围治疗，血满再出去杀敌（英雄顶着不撤）
    if (hpPct < 0.4 && !unit.isHeroUnit) {
      unit.retreating = true;
      if (dFort > 64) moveUnit(unit, { x: tower.x + (ph(unit.id.length) - .5) * 26, y: tower.y + 24 }, dt);
      else unit.moving = false;
      return;
    }
    unit.retreating = false;
    // 玩家操控堡垒时，周围的兵反过来跟着堡垒走
    if (tower.mvl > 0) {
      const nearbyThreat = nearestThreat(unit.x, unit.y, 'player');
      if (!nearbyThreat || nearbyThreat.dist > 150) {
        if (dFort > 44) {
          const tx = tower.x - tower.mvx * 70 + (ph(unit.id.length) - .5) * 72;
          const ty = tower.y - tower.mvy * 70 + (ph(unit.id.length * 3) - .5) * 46;
          moveUnit(unit, { x: clamp(tx, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX), y: clamp(ty, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY) }, dt);
        }
        return;
      }
    }
    // 正常战斗逻辑（敌方单位 + 敌方城堡都可作为目标）
    const th = nearestThreat(unit.x, unit.y, 'player');
    const target = th ? th.ref : null;
    if (target && th.dist <= type.range + 6) {
      if (unit.cooldown <= 0) {
        unit.facing = target.x < unit.x ? -1 : 1;
        if (type.kind === 'mage' || type.kind === 'necromancer' || type.weapon === 'bow' || type.kind === 'fortress') fireProjectile(unit, type, target);
        else if (type.kind === 'giant') { unit.cooldown = 1.15; unit.attackClock = .55; unit.attackDuration = .55; unit.action = 'slam'; aoeMelee(unit, type, 60); burstParticles(unit.x, unit.y, '#aeb7c4', 12, { up: 40, speed: 120 }); shake = Math.max(shake, .3); }
        else if (type.kind === 'beast') { unit.cooldown = .8; unit.attackClock = .4; unit.attackDuration = .4; aoeMelee(unit, type, 46); }
        else { unit.cooldown = .48; unit.attackClock = .3; unit.attackDuration = .3; unit.action = type.action || 'slash'; meleeHit(unit, type, target, type.kind === 'swordsman' ? 1.35 : type.kind === 'samurai' ? 1.3 : 1); }
      }
    } else if (target && th.dist < 300) {
      moveUnit(unit, unit.trait === 'strategic' ? strategicTarget(unit, target, type) : target, dt);
    } else if (dFort > 150) {
      moveUnit(unit, { x: tower.x + ph(unit.id.length) * 40, y: tower.y + ph(unit.id.length * 3) * 30 }, dt);
    }
  }
  function fireProjectile(unit, type, target) {
    unit.cooldown = type.kind === 'fortress' ? 1.3 : type.kind === 'necromancer' ? .95 : 1.0;
    unit.attackClock = .35; unit.attackDuration = .35; unit.action = 'cast';
    const dmg = type.damage * (unit.atk || 1);
    const kind = type.kind === 'fortress' ? 'cannon' : type.kind === 'necromancer' ? 'curse' : type.kind === 'mage' ? 'magic' : 'arrow';
    projectiles.push({ kind, x: unit.x + unit.facing * 14, y: unit.y - 8, target, speed: kind === 'cannon' ? 340 : 310, damage: dmg, color: type.color, life: 2.2, splash: kind === 'arrow' ? 0 : 16, team: 'player' });
  }
  function pulseHeal(unit, dt) {
    unit.healTimer = (unit.healTimer || 0) - dt;
    if (unit.healTimer > 0) return;
    unit.healTimer = 1.5;
    for (const o of units) if (o.team === 'player' && !o.dead && distance(unit, o) <= 96) o.hp = Math.min(o.maxHp, o.hp + 9);
    if (distance(unit, tower) <= 96 && tower.hp > 0) tower.hp = Math.min(tower.maxHp, tower.hp + 9);
    effects.push({ type: 'heal', x: unit.x, y: unit.y - 12, life: .45, maxLife: .45, color: '#bff0a0' });
  }

  function moveUnit(unit, target, dt) {
    const dx = target.x - unit.x; const dy = target.y - unit.y; const length = Math.hypot(dx, dy) || 1;
    const speed = unitType(unit).speed * (unit.buff?.speed || 1) * (unit.spd || 1) * dt * 2.4;
    const nx = unit.x + dx / length * speed; const ny = unit.y + dy / length * speed;
    const moved = Math.hypot(nx - unit.x, ny - unit.y);
    unit.x = clamp(nx, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX); unit.y = clamp(ny, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);
    collide(unit, 10 * (unit.size || 1));
    unit.facing = dx < 0 ? -1 : 1;
    unit.moving = moved > .5;
    if (unit.moving) unit.walkPhase = (unit.walkPhase + dt * (7 + unitType(unit).speed * .08)) % (Math.PI * 2);
  }

  // ---- 主城（玩家操控的塔）：WASD 移动，空闲时跟随最近的一个我方角色 ----
  function controlTower(dt) {
    let mx = 0; let my = 0;
    const k = keys;
    if (k.a || k.arrowleft) mx -= 1; if (k.d || k.arrowright) mx += 1;
    if (k.w || k.arrowup) my -= 1; if (k.s || k.arrowdown) my += 1;
    if (mx || my) {
      const len = Math.hypot(mx, my); const sp = 165 * (stats.speed || 1) * dt * 2.4;
      tower.x = clamp(tower.x + mx / len * sp, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
      tower.y = clamp(tower.y + my / len * sp, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);
      collide(tower, 16); tower.mvx = mx / len; tower.mvy = my / len; tower.mvl = 1; tower.moving = true; tower.facing = mx < 0 ? -1 : 1;
    } else {
      tower.mvl = 0; tower.moving = false;
      // 塔跟着最近的一个我方角色（你的兵走到哪，塔就跟到哪）
      let near = null; let nd = Infinity;
      for (const o of units) if (o.team === 'player' && !o.dead) { const d = distance(tower, o); if (d < nd) { nd = d; near = o; } }
      if (near && nd > 56) {
        const dx = near.x - tower.x; const dy = near.y - tower.y; const len = Math.hypot(dx, dy) || 1; const sp = 85 * (stats.speed || 1) * dt * 2.4;
        tower.x = clamp(tower.x + dx / len * sp, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
        tower.y = clamp(tower.y + dy / len * sp, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);
        collide(tower, 16); tower.moving = true; tower.facing = dx < 0 ? -1 : 1;
      }
    }
    tower.walkPhase = (tower.walkPhase + dt * 8 * (tower.moving ? 1 : 0)) % (Math.PI * 2);
    // 塔自动开火（炮塔，含攻击敌方城堡）
    tower.cooldown -= dt; tower.attackClock = Math.max(0, tower.attackClock - dt);
    const threat = nearestThreat(tower.x, tower.y, 'player');
    if (threat && threat.dist <= tower.range + 8 && tower.cooldown <= 0) {
      tower.facing = threat.ref.x < tower.x ? -1 : 1;
      tower.cooldown = .5 / (stats.rate || 1); tower.attackClock = .3; tower.attackDuration = .3;
      fireFrom(tower, threat.ref, tower.color, tower.element);
    }
    tower.hitFlash = Math.max(0, tower.hitFlash - dt);
    // 主城回复光环：让身边的我方兵回血
    for (const o of units) if (o.team === 'player' && !o.dead && distance(o, tower) < 112 && o.hp < o.maxHp) o.hp = Math.min(o.maxHp, o.hp + 5 * dt * 3);
    if (tower.hp > 0 && tower.hp < tower.maxHp) tower.hp += (3 + (stats.regen || 0)) * dt * 3;
    if (Math.random() < .12) effects.push({ type: 'heal', x: tower.x + (Math.random() - .5) * 44, y: tower.y - 34 + (Math.random() - .5) * 30, life: .4, maxLife: .4, color: '#8fe0b0' });
  }
  function fireFrom(shooter, enemy, color, element = 'normal') {
    const dx = enemy.x - shooter.x; const dy = enemy.y - shooter.y; const len = Math.hypot(dx, dy) || 1;
    const baseA = Math.atan2(dy, dx);
    const n = Math.max(1, Math.round(stats.proj || 1));
    const dmg = (shooter.damage || 0) * (stats.dmg || 1);
    for (let i = 0; i < n; i += 1) {
      const spread = n > 1 ? (i - (n - 1) / 2) * .16 : 0;
      const a = baseA + spread;
      projectiles.push({ kind: 'arrow', element, x: shooter.x + Math.cos(a) * 18, y: shooter.y + Math.sin(a) * 18, target: enemy, speed: 440, damage: dmg, color, life: 1.6, team: 'player' });
    }
  }

  // ---- 经验宝石：飞向主城 → 满经验升级 → 三选一强化 ----
  function updateXp(dt) {
    for (let i = xps.length - 1; i >= 0; i -= 1) {
      const g = xps[i]; const dx = tower.x - g.x; const dy = tower.y - g.y; const len = Math.hypot(dx, dy) || 1;
      if (len < 26) { xp += g.amount; xps.splice(i, 1); }
      else { const pull = 280 * dt * 2.4; g.x += dx / len * pull; g.y += dy / len * pull; }
    }
    if (xp >= xpNeed) {
      xp -= xpNeed; level += 1; xpNeed = Math.round(12 + level * 6);
      offerLevelUp();
    }
  }
  function pickUpgrades() {
    const pool = UPGRADES.slice(); const picks = [];
    for (let i = 0; i < 3 && pool.length; i += 1) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return picks;
  }
  function applyUpgrade(up) {
    up.apply(stats);
    if (up.id === 'hp') { tower.maxHp += 60; tower.hp = Math.min(tower.maxHp, tower.hp + 60); }
    renderPalette(); renderStats();
  }
  function offerLevelUp() {
    if (victory || levelUpOpen) return;
    levelUpOpen = true;
    running = false;
    startBtn.textContent = '继续';
    const picks = pickUpgrades();
    const title = h('div', { class: 'battle__upgrade-title' }, `⚡ 升级！等级 ${level} — 选一个强化`);
    const btns = picks.map((up) => h('button', { class: 'btn battle__upgrade-btn', onclick: () => { applyUpgrade(up); levelUpOpen = false; upgradePanel.style.display = 'none'; upgradePanel.replaceChildren(); startBattle(); } }, h('b', {}, `${up.icon} ${up.name}`), h('span', {}, up.desc)));
    upgradePanel.replaceChildren(title, h('div', { class: 'battle__upgrade-choices' }, btns));
    upgradePanel.style.display = 'flex';
  }

  function applyItem(unit, item) {
    if (item.type === 'health') { unit.hp = Math.min(unit.maxHp, unit.hp + 34); effects.push({ type: 'heal', x: unit.x, y: unit.y - 12, life: .4, maxLife: .4, color: ITEM_TYPES.health.color }); }
    else if (item.type === 'chest') { resources += 10; effects.push({ type: 'burst', x: unit.x, y: unit.y - 8, life: .4, maxLife: .4, color: ITEM_TYPES.chest.color, radius: 16 }); }
    else if (item.type === 'gem') { resources += 5; unit.hp = Math.min(unit.maxHp, unit.hp + 14); effects.push({ type: 'spawn', x: unit.x, y: unit.y - 8, life: .4, maxLife: .4, color: ITEM_TYPES.gem.color }); }
    else if (item.type === 'speed') { unit.buff = { ...unit.buff, speed: 1.55 }; unit.buffTimer = 5; effects.push({ type: 'heal', x: unit.x, y: unit.y - 10, life: .4, maxLife: .4, color: ITEM_TYPES.speed.color }); }
    else if (item.type === 'rage') { unit.buff = { ...unit.buff, dmg: 1.45 }; unit.buffTimer = 5; effects.push({ type: 'burst', x: unit.x, y: unit.y - 10, life: .4, maxLife: .4, color: ITEM_TYPES.rage.color, radius: 12 }); }
  }
  function updateItems(dt) {
    pickupTimer -= dt;
    if (pickupTimer <= 0) { pickupTimer = 3; if (items.length < 24) items.push({ type: ['health', 'chest', 'gem', 'speed', 'rage'][Math.floor(Math.random() * 5)], x: tower.x + (Math.random() - .5) * 600, y: tower.y + (Math.random() - .5) * 420 }); }
    for (const unit of [...units, tower].filter((u) => u && !u.dead)) {
      for (let i = items.length - 1; i >= 0; i -= 1) { if (distance(unit, items[i]) <= 30) { applyItem(unit, items[i]); items.splice(i, 1); } }
    }
  }

  // ---- 主城定时自动产兵（免费造普通兵） ----
  function updateProduction(dt) {
    const arch = activeArch();
    autoTimer -= dt;
    if (autoTimer > 0) return;
    autoTimer = arch.prodInterval;
    const grunts = units.filter((u) => u.team === 'player' && !u.dead && !u.isHeroUnit).length;
    if (grunts < arch.prodCap && units.filter((u) => u.team === 'player' && !u.dead).length < 40) {
      const u = makeUnit('player', classById(arch.prod), tower.x + (Math.random() - .5) * 96, tower.y + 34 + (Math.random() - .5) * 44);
      u.cooldown = .3;
      units.push(u);
      effects.push({ type: 'spawn', x: u.x, y: u.y, life: .45, maxLife: .45, color: arch.color });
    }
  }

  // ---- 切换主城架构：改变炮塔元素 / 颜色 / 自动产兵 ----
  function setArch(id) {
    if (!ARCHS.some((a) => a.id === id)) return;
    const prev = activeArch();
    archId = id;
    if (tower) { const a = activeArch(); tower.color = a.color; tower.element = a.element; }
    if (prev.id !== id) { effects.push({ type: 'burst', x: tower.x, y: tower.y, life: .6, maxLife: .6, color: activeArch().color, radius: 52 }); shake = Math.max(shake, .18); }
    renderArchSelector();
  }
  function renderArchSelector() {
    archEl.replaceChildren(...ARCHS.map((a) => h('button', { class: `battle__arch-btn${a.id === archId ? ' is-active' : ''}`, style: { ['--arch-color']: a.color }, onclick: () => setArch(a.id) }, h('b', {}, a.name), h('span', {}, a.desc))));
  }

  // ---- 动态背景：光点/萤火 + 飘动画云影 ----
  function initAmbient() {
    motes = [];
    for (let i = 0; i < 26; i += 1) motes.push({ x: tower.x + (Math.random() - .5) * 1100, y: tower.y + (Math.random() - .5) * 800, r: 1 + Math.random() * 2, ph: Math.random() * 6.28, vy: .4 + Math.random() * .7 });
    clouds = [];
    for (let i = 0; i < 3; i += 1) clouds.push({ x: -400 + i * 320, y: -260 + i * 260, w: 220 + Math.random() * 180, spd: 8 + Math.random() * 10 });
  }
  function updateAmbient(dt) {
    for (const m of motes) { m.y -= m.vy * dt * 18; m.ph += dt * 2; if (m.y < tower.y - 420) { m.y = tower.y + 420; m.x = tower.x + (Math.random() - .5) * 1100; } }
    for (const c of clouds) { c.x += c.spd * dt; if (c.x > cameraX + VIEW.width + 600) { c.x = cameraX - 500; c.y = tower.y + (Math.random() - .5) * 560; } }
  }

  // ---- 敌方城堡：各有自动造兵线，推平它们可提前获胜 ----
  function buildEnemyCastles() {
    return [
      { x: WORLD_BOUNDS.minX + 520, y: WORLD_BOUNDS.minY + 460, hp: 1100, maxHp: 1100, color: '#c0392b', prodTimer: 1.2, prodInterval: 3.4, prodCap: 9, alive: true, hitFlash: 0, radius: 42, isCastle: true, dead: false, team: 'enemy' },
      { x: WORLD_BOUNDS.maxX - 520, y: WORLD_BOUNDS.minY + 460, hp: 1100, maxHp: 1100, color: '#c0392b', prodTimer: 2.0, prodInterval: 3.4, prodCap: 9, alive: true, hitFlash: 0, radius: 42, isCastle: true, dead: false, team: 'enemy' },
      { x: WORLD_BOUNDS.minX + 520, y: WORLD_BOUNDS.maxY - 460, hp: 1100, maxHp: 1100, color: '#c0392b', prodTimer: 2.8, prodInterval: 3.4, prodCap: 9, alive: true, hitFlash: 0, radius: 42, isCastle: true, dead: false, team: 'enemy' },
      { x: WORLD_BOUNDS.maxX - 520, y: WORLD_BOUNDS.maxY - 460, hp: 1100, maxHp: 1100, color: '#c0392b', prodTimer: 3.6, prodInterval: 3.4, prodCap: 9, alive: true, hitFlash: 0, radius: 42, isCastle: true, dead: false, team: 'enemy' },
    ];
  }
  function updateEnemyCastles(dt) {
    for (const c of enemyCastles) {
      if (!c.alive) continue;
      c.prodTimer -= dt;
      c.hitFlash = Math.max(0, c.hitFlash - dt);
      if (c.prodTimer <= 0) {
        c.prodTimer = c.prodInterval;
        const nearCount = units.filter((u) => u.team === 'enemy' && !u.dead && distance(u, c) < 320).length;
        if (nearCount < c.prodCap) {
          const id = ['raider', 'ranger', 'harvester', 'zombie'][Math.floor(Math.random() * 4)];
          const pow = 1 + elapsed * .012;
          const u = makeUnit('enemy', UNIT_CLASSES[id], c.x + (Math.random() - .5) * 90, c.y + (Math.random() - .5) * 90, { pow });
          u.cooldown = .3;
          units.push(u);
          effects.push({ type: 'spawn', x: u.x, y: u.y, life: .4, maxLife: .4, color: c.color });
        }
      }
    }
  }
  // 玩家侧威胁目标：最近的敌方单位 或 敌方城堡
  function nearestThreat(ex, ey, myTeam) {
    let best = null; let bd = Infinity;
    for (const u of units) if (!u.dead && u.team !== myTeam) { const d = distance({ x: ex, y: ey }, u); if (d < bd) { bd = d; best = { ref: u, kind: 'unit', dist: d }; } }
    for (const n of neutrals) if (!n.dead && n.side !== myTeam) { const d = distance({ x: ex, y: ey }, n); if (d < bd) { bd = d; best = { ref: n, kind: 'unit', dist: d }; } }
    if (myTeam === 'player') for (const c of enemyCastles) if (c.alive && c.hp > 0) { const d = distance({ x: ex, y: ey }, c); if (d < bd) { bd = d; best = { ref: c, kind: 'castle', dist: d }; } }
    return best;
  }
  // 推平所有敌方城堡 → 提前获胜结束本局
  function checkWin() {
    if (victoryWin || !enemyCastles.length) return;
    if (enemyCastles.every((c) => !c.alive)) {
      victoryWin = true; running = false;
      statusEl.textContent = '🎉 胜利！已摧毁所有敌方城堡';
      toast('🎉 胜利！提前结束本局', 'good');
      setTimeout(resetBattle, 2600);
    }
  }

  // ---- 中立单位：散落地图，随机帮敌方或帮我方，还会随机倒戈 ----
  function buildNeutrals() {
    const list = [];
    const classes = ['default', 'swordsman', 'mage', 'beast'];
    for (let i = 0; i < 12; i += 1) {
      const t = UNIT_CLASSES[classes[i % classes.length]];
      const x = WORLD_BOUNDS.minX + 240 + ph(i * 3.7) * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX - 480);
      const y = WORLD_BOUNDS.minY + 240 + ph(i * 5.3) * (WORLD_BOUNDS.maxY - WORLD_BOUNDS.minY - 480);
      list.push({
        id: `neutral-${i}`, x, y, hp: t.hp, maxHp: t.hp, damage: t.damage, range: Math.max(40, t.range), speed: t.speed,
        color: i % 2 ? '#e6b45b' : '#8fd0d8', weapon: t.weapon || 'sword', size: 1, kind: 'default',
        side: Math.random() < .5 ? 'player' : 'enemy', timer: 8 + Math.random() * 6, cooldown: 0, attackClock: 0, attackDuration: .3,
        facing: Math.random() < .5 ? -1 : 1, walkPhase: Math.random() * 6.28, moving: false, hitFlash: 0, dead: false,
        isHero: false, isBase: false, isCastle: false, pow: 1, atk: 1, spd: 1, buff: {}, trait: 'neutral', isNeutral: true,
      });
    }
    return list;
  }
  function updateNeutrals(dt) {
    for (const n of neutrals) {
      if (n.dead) continue;
      n.cooldown -= dt; n.attackClock = Math.max(0, n.attackClock - dt); n.hitFlash = Math.max(0, n.hitFlash - dt);
      n.timer -= dt;
      if (n.timer <= 0) { n.timer = 8 + Math.random() * 6; n.side = Math.random() < .5 ? 'player' : 'enemy'; effects.push({ type: 'spawn', x: n.x, y: n.y, life: .4, maxLife: .4, color: n.side === 'player' ? '#3d6fe8' : '#e2574b' }); }
      // 索敌：帮玩家就打敌方单位；帮敌方就打我方单位 + 堡垒
      let target = null; let bd = Infinity;
      for (const u of units) if (!u.dead && ((n.side === 'player' && u.team === 'enemy') || (n.side === 'enemy' && u.team === 'player'))) { const d = distance(n, u); if (d < bd) { bd = d; target = u; } }
      if (n.side === 'enemy' && tower.hp > 0) { const d = distance(n, tower); if (d < bd) { bd = d; target = tower; } }
      if (!target) continue;
      n.moving = false;
      if (bd <= n.range + 6) {
        if (n.cooldown <= 0) {
          n.cooldown = .7; n.attackClock = .3; n.attackDuration = .3;
          n.facing = target.x < n.x ? -1 : 1;
          meleeHit(n, { damage: n.damage, color: n.color }, target, 1);
        }
      } else {
        const dx = target.x - n.x; const dy = target.y - n.y; const len = Math.hypot(dx, dy) || 1; const sp = n.speed * dt * 2.4;
        n.x = clamp(n.x + dx / len * sp, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
        n.y = clamp(n.y + dy / len * sp, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);
        collide(n, 10); n.moving = true; n.facing = dx < 0 ? -1 : 1; n.walkPhase = (n.walkPhase + dt * 8) % (Math.PI * 2);
      }
    }
    neutrals = neutrals.filter((n) => !n.dead);
  }
  function drawNeutral(n) {
    const pose = stickmanPose(n); const c = canvasContext;
    c.save(); c.translate(n.x, n.y); c.strokeStyle = n.color; c.fillStyle = n.color; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.arc(0, pose.headY, 8, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(0, pose.torsoTopY); c.lineTo(0, pose.hipY); c.moveTo(0, pose.torsoTopY + 7); c.lineTo(pose.leftArm.x, pose.leftArm.y); c.moveTo(0, pose.torsoTopY + 7); c.lineTo(pose.rightArm.x, pose.rightArm.y); c.moveTo(0, pose.hipY); c.lineTo(pose.leftLeg.x, pose.leftLeg.y); c.moveTo(0, pose.hipY); c.lineTo(pose.rightLeg.x, pose.rightLeg.y); c.stroke();
    c.restore();
    drawHpBar(n, 30, 4);
    c.fillStyle = n.side === 'player' ? '#3d6fe8' : '#e2574b'; c.font = '800 10px Arial'; c.textAlign = 'center';
    c.fillText(n.side === 'player' ? '友' : '敌', n.x, n.y - 44); c.textAlign = 'start';
  }

  function update(dt) {
    shake = Math.max(0, shake - dt * 1.8);
    timeOfDay = (timeOfDay + dt * 0.004) % 1;
    elapsed += dt;
    for (const p of particles) { p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const d of damageNumbers) { d.y -= 46 * dt; d.life -= dt; }
    damageNumbers = damageNumbers.filter((d) => d.life > 0);

    controlTower(dt);
    incomeTimer -= dt;
    if (incomeTimer <= 0) { incomeTimer = 4; resources += Math.round(3 * (stats.income || 1)); }
    updateXp(dt);
    updateSpawning(dt);
    updateProduction(dt);
    updateEnemyCastles(dt);
    updateNeutrals(dt);
    updateItems(dt);
    updateAmbient(dt);

    for (const unit of units) {
      if (unit.dead) continue;
      unit.cooldown -= dt; unit.attackClock = Math.max(0, unit.attackClock - dt); unit.hitFlash = Math.max(0, unit.hitFlash - dt);
      unit.buffTimer = Math.max(0, unit.buffTimer - dt); if (unit.buffTimer === 0) unit.buff = {};
      const type = unitType(unit);
      if (unit.team === 'enemy') enemyBehavior(unit, type, dt);
      else allyBehavior(unit, type, dt);
    }

    // 弹道
    for (const projectile of projectiles) {
      const t = projectile.target;
      const alive = t && typeof t.hp === 'number' && t.hp > 0;
      if (alive) {
        const dx = t.x - projectile.x; const dy = t.y - projectile.y; const len = Math.hypot(dx, dy) || 1; const travel = projectile.speed * dt;
        if (len <= travel + 7) { projectile.life = 0; impactProjectile(projectile, t); }
        else { projectile.x += dx / len * travel; projectile.y += dy / len * travel; projectile.life -= dt; }
      } else { projectile.life = 0; }
      if (projectile.life > 0 && Math.random() < .7) particles.push({ x: projectile.x, y: projectile.y, vx: (Math.random() - .5) * 8, vy: (Math.random() - .5) * 8 - 6, life: .18, maxLife: .18, size: 2.2, color: projectile.color, gravity: 0 });
    }
    projectiles = projectiles.filter((p) => p.life > 0);

    // 清理 & 死亡结算
    kills += units.filter((u) => u.team === 'enemy' && u.dead).length;
    const killed = units.filter((u) => u.team === 'enemy' && u.dead).length;
    resources += killed;
    const owners = new Set(units.filter((u) => !u.dead).map((u) => u.id));
    units = units.filter((u) => !u.dead && !(u.ownerId && !owners.has(u.ownerId)));
    effects = effects.map((e) => ({ ...e, life: e.life - dt })).filter((e) => e.life > 0);
    if (tower.hp <= 0 && !victory) { victory = true; statusEl.textContent = '主城被摧毁 · 防守失败'; toast('主城被摧毁，重新开局', 'bad'); setTimeout(resetBattle, 1600); }
    checkWin();

    // 镜头跟随主城
    cameraX = clamp(tower.x - VIEW.width / 2, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX - VIEW.width);
    cameraY = clamp(tower.y - VIEW.height / 2, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY - VIEW.height);
  }
  function impactProjectile(projectile, target) {
    const splash = projectile.splash || 0;
    // 元素命中特效
    const el = projectile.element;
    if (el === 'fire') { burstParticles(projectile.x, projectile.y, '#ffb066', 12, { up: 60, speed: 160, life: .5 }); burstParticles(projectile.x, projectile.y, '#6b3417', 5, { up: 40, speed: 50, life: .8 }); }
    else if (el === 'magic') { burstParticles(projectile.x, projectile.y, '#c9a6ff', 14, { up: 40, speed: 130, life: .5 }); }
    if (splash > 0) {
      for (const o of units) if (!o.dead && o.team !== projectile.team && distance(projectile, o) <= splash + 4) hurt(o, projectile.damage, projectile.color);
      if (projectile.team === 'enemy' && tower.hp > 0 && distance(projectile, tower) <= splash + 4) hurt(tower, projectile.damage, projectile.color);
      burstParticles(projectile.x, projectile.y, projectile.color, projectile.kind === 'cannon' ? 20 : 12, { up: 30, speed: 100 });
      addDamage(projectile.x, projectile.y, projectile.damage, projectile.color, projectile.kind === 'cannon' ? 1.3 : 1.1);
      effects.push({ type: 'burst', x: projectile.x, y: projectile.y, life: .4, maxLife: .4, color: projectile.color, radius: splash });
    } else if (target && typeof target.hp === 'number') {
      hurt(target, projectile.damage, projectile.color);
    }
  }

  function loop(time) { if (!running) return; const dt = Math.min(.05, (time - lastTime) / 1000 || 0); lastTime = time; update(dt); render(); renderStats(); animationFrame = requestAnimationFrame(loop); }

  // ---- 俯视角地表 ----
  function drawGround(region) {
    const night = clamp(1 - Math.abs(timeOfDay - .5) * 2.2, 0, 1);
    canvasContext.fillStyle = mixColor(region.land, '#0b1017', night * .66);
    canvasContext.fillRect(cameraX - 60, cameraY - 60, VIEW.width + 120, VIEW.height + 120);
    // 俯视角地块棋盘纹理（上、下、左、右都连续铺开）
    const tile = 72;
    const t0 = Math.floor(cameraX / tile) - 1, t1 = (cameraX + VIEW.width) / tile + 1;
    const u0 = Math.floor(cameraY / tile) - 1, u1 = (cameraY + VIEW.height) / tile + 1;
    for (let gx = t0; gx <= t1; gx += 1) for (let gy = u0; gy <= u1; gy += 1) {
      const v = ph(gx * 3.1 + gy * 5.9);
      canvasContext.fillStyle = v < .5 ? mixColor(region.land, '#0b1017', night * .62) : mixColor(region.land, '#0b1017', night * .68);
      canvasContext.fillRect(gx * tile, gy * tile, tile, tile);
    }
    // 泥土路网（横竖小道，强调这是上下左右都通行的平面世界）
    const roadShade = mixColor(region.terrain === 'desert' ? '#d6bd8a' : '#8a7a58', '#0b1017', night * .5);
    for (const ry of [WORLD_BOUNDS.minY + 420, WORLD_BOUNDS.minY + 1180, WORLD_BOUNDS.minY + 1940]) {
      canvasContext.fillStyle = roadShade; canvasContext.fillRect(cameraX - 60, ry, VIEW.width + 120, 26);
      canvasContext.strokeStyle = 'rgba(255,255,255,.08)'; canvasContext.lineWidth = 1; canvasContext.beginPath(); canvasContext.moveTo(cameraX - 60, ry + 4); canvasContext.lineTo(cameraX + VIEW.width + 60, ry + 4); canvasContext.moveTo(cameraX - 60, ry + 22); canvasContext.lineTo(cameraX + VIEW.width + 60, ry + 22); canvasContext.stroke();
    }
    for (const rx of [WORLD_BOUNDS.minX + 460, WORLD_BOUNDS.minX + 1380, WORLD_BOUNDS.minX + 2300]) {
      canvasContext.fillStyle = roadShade; canvasContext.fillRect(rx, cameraY - 60, 26, VIEW.height + 120);
      canvasContext.strokeStyle = 'rgba(255,255,255,.08)'; canvasContext.lineWidth = 1; canvasContext.beginPath(); canvasContext.moveTo(rx + 4, cameraY - 60); canvasContext.lineTo(rx + 4, cameraY + VIEW.height + 60); canvasContext.moveTo(rx + 22, cameraY - 60); canvasContext.lineTo(rx + 22, cameraY + VIEW.height + 60); canvasContext.stroke();
    }
    // 大型湖泊 & 森林（俯视角大块地貌，上下左右都会出现）
    const cellBig = 760;
    const b0 = Math.floor(cameraX / cellBig) - 1, b1 = (cameraX + VIEW.width) / cellBig + 1;
    const q0 = Math.floor(cameraY / cellBig) - 1, q1 = (cameraY + VIEW.height) / cellBig + 1;
    for (let gx = b0; gx <= b1; gx += 1) for (let gy = q0; gy <= q1; gy += 1) {
      const s = ph(gx * 11.3 + gy * 7.7);
      const cx0 = gx * cellBig + ph(gx * 1.3 + gy) * cellBig;
      const cy0 = gy * cellBig + ph(gy * 2.1 + gx) * cellBig;
      if (s < .16) {
        canvasContext.fillStyle = mixColor('#2f6f9e', '#0b1017', night * .35);
        canvasContext.beginPath(); canvasContext.ellipse(cx0, cy0, 90 + s * 80, 60 + s * 50, 0, 0, Math.PI * 2); canvasContext.fill();
        canvasContext.strokeStyle = 'rgba(200,225,245,.3)'; canvasContext.lineWidth = 3; canvasContext.stroke();
      } else if (s < .30) {
        for (let t = 0; t < 9; t += 1) {
          const tx = cx0 - 70 + ph(t * 3.7 + gx) * 140, ty = cy0 - 50 + ph(t * 5.3 + gy) * 100;
          canvasContext.fillStyle = 'rgba(0,0,0,.18)'; canvasContext.beginPath(); canvasContext.ellipse(tx, ty + 5, 20, 7, 0, 0, Math.PI * 2); canvasContext.fill();
          canvasContext.fillStyle = mixColor('#3a7a45', '#0b1017', night * .35); canvasContext.beginPath(); canvasContext.arc(tx, ty - 4, 14 + ph(t * 3.1) * 8, 0, Math.PI * 2); canvasContext.fill();
        }
      }
    }
    // 花草岩石点缀
    const chunk = 190;
    const c0 = Math.floor(cameraX / chunk) - 1, c1 = (cameraX + VIEW.width) / chunk + 1;
    const r0 = Math.floor(cameraY / chunk) - 1, r1 = (cameraY + VIEW.height) / chunk + 1;
    for (let gx = c0; gx <= c1; gx += 1) for (let gy = r0; gy <= r1; gy += 1) {
      const wx = gx * chunk + ph(gx * 1.7 + gy * 3.3) * chunk;
      const wy = gy * chunk + ph(gx * 4.1 + gy * 2.3) * chunk;
      const s = ph(gx * 9 + gy * 7);
      if (s < .18) { // 树
        canvasContext.fillStyle = 'rgba(0,0,0,.18)'; canvasContext.beginPath(); canvasContext.ellipse(wx, wy + 3, 14, 5, 0, 0, Math.PI * 2); canvasContext.fill();
        canvasContext.fillStyle = mixColor('#5d8a5a', '#0b1017', night * .4); canvasContext.beginPath(); canvasContext.arc(wx, wy - 6, 9 + s * 6, 0, Math.PI * 2); canvasContext.fill();
      } else if (s < .32) { // 岩石
        canvasContext.fillStyle = mixColor('#8a929c', '#0b1017', night * .4); canvasContext.beginPath(); canvasContext.arc(wx, wy - 2, 5 + s * 4, 0, Math.PI * 2); canvasContext.fill();
      } else if (s < .44) { // 草丛
        canvasContext.strokeStyle = mixColor(region.accent, '#0b1017', night * .4); canvasContext.lineWidth = 2;
        for (let g = 0; g < 3; g += 1) { canvasContext.beginPath(); canvasContext.moveTo(wx - 4 + g * 4, wy); canvasContext.lineTo(wx - 4 + g * 4 + (g === 1 ? 2 : -1), wy - 6 - g); canvasContext.stroke(); }
      } else if (region.terrain === 'island' && s < .5) { // 樱花
        canvasContext.fillStyle = 'rgba(240,180,200,.5)'; canvasContext.beginPath(); canvasContext.arc(wx, wy, 3, 0, Math.PI * 2); canvasContext.fill();
      }
    }
    // 地图障碍（树 / 岩石 / 水域）
    for (const o of obstacles) {
      if (o.x < cameraX - 90 || o.x > cameraX + VIEW.width + 90 || o.y < cameraY - 90 || o.y > cameraY + VIEW.height + 90) continue;
      if (o.type === 'water') { canvasContext.fillStyle = mixColor('#3f7fae', '#0b1017', night * .35); canvasContext.beginPath(); canvasContext.ellipse(o.x, o.y, o.r, o.r * .62, 0, 0, Math.PI * 2); canvasContext.fill(); canvasContext.strokeStyle = 'rgba(255,255,255,.2)'; canvasContext.lineWidth = 2; canvasContext.stroke(); }
      else if (o.type === 'tree') { canvasContext.fillStyle = 'rgba(0,0,0,.22)'; canvasContext.beginPath(); canvasContext.ellipse(o.x, o.y + 6, o.r * .9, o.r * .35, 0, 0, Math.PI * 2); canvasContext.fill(); canvasContext.fillStyle = mixColor('#38703f', '#0b1017', night * .35); canvasContext.beginPath(); canvasContext.arc(o.x, o.y - 4, o.r, 0, Math.PI * 2); canvasContext.fill(); canvasContext.strokeStyle = 'rgba(0,0,0,.18)'; canvasContext.lineWidth = 1; canvasContext.stroke(); }
      else { canvasContext.fillStyle = 'rgba(96,104,116,.92)'; canvasContext.beginPath(); canvasContext.arc(o.x, o.y, o.r * .7, 0, Math.PI * 2); canvasContext.fill(); canvasContext.fillStyle = 'rgba(64,70,80,.7)'; canvasContext.beginPath(); canvasContext.arc(o.x - o.r * .2, o.y - o.r * .2, o.r * .28, 0, Math.PI * 2); canvasContext.fill(); }
    }
    // 世界边界
    const nearEdge = tower.x < WORLD_BOUNDS.minX + 60 || tower.x > WORLD_BOUNDS.maxX - 60 || tower.y < WORLD_BOUNDS.minY + 60 || tower.y > WORLD_BOUNDS.maxY - 60;
    if (nearEdge) {
      canvasContext.fillStyle = 'rgba(180,40,40,.35)';
      if (tower.x < WORLD_BOUNDS.minX + 60) canvasContext.fillRect(cameraX - 40, cameraY - 40, 12, VIEW.height + 80);
      if (tower.x > WORLD_BOUNDS.maxX - 60) canvasContext.fillRect(WORLD_BOUNDS.maxX, cameraY - 40, 40, VIEW.height + 80);
      if (tower.y < WORLD_BOUNDS.minY + 60) canvasContext.fillRect(cameraX - 40, cameraY - 40, VIEW.width + 80, 12);
      if (tower.y > WORLD_BOUNDS.maxY - 60) canvasContext.fillRect(cameraX - 40, WORLD_BOUNDS.maxY, VIEW.width + 80, 40);
    }
  }
  function drawWeather(region) {
    const t = performance.now() / 1000; const night = clamp(1 - Math.abs(timeOfDay - .5) * 2.2, 0, 1);
    canvasContext.save();
    const cx = cameraX, cy = cameraY;
    if (region.terrain === 'fjord') { canvasContext.fillStyle = 'rgba(255,255,255,.85)'; for (let k = 0; k < 46; k += 1) { const px = cx + ((ph(k * 3.7) * VIEW.width) + t * 22 * (ph(k * 1.3) + .4)) % VIEW.width; const py = cy + ((ph(k * 5.1) * VIEW.height) + t * 96) % VIEW.height; canvasContext.fillRect(px, py, 2, 2); } }
    else if (region.terrain === 'rainforest') { canvasContext.strokeStyle = 'rgba(120,175,215,.38)'; canvasContext.lineWidth = 1; for (let k = 0; k < 34; k += 1) { const px = cx + ((ph(k * 2.9) * VIEW.width) + t * 320) % VIEW.width; const py = cy + ((ph(k * 4.7) * VIEW.height) + t * 270) % VIEW.height; canvasContext.beginPath(); canvasContext.moveTo(px, py); canvasContext.lineTo(px - 3, py + 12); canvasContext.stroke(); } }
    else if (region.terrain === 'desert') { canvasContext.fillStyle = 'rgba(255,222,150,.42)'; for (let k = 0; k < 26; k += 1) { const px = cx + ((ph(k * 2.1) * VIEW.width) + t * 14) % VIEW.width; const py = cy + ((ph(k * 3.3) * VIEW.height) + t * 8) % VIEW.height + Math.sin(t + ph(k) * 6) * 4; canvasContext.fillRect(px, py, 3, 1.5); } }
    else if (region.terrain === 'island') { canvasContext.fillStyle = 'rgba(245,180,205,.75)'; for (let k = 0; k < 20; k += 1) { const px = cx + ((ph(k * 1.7) * VIEW.width) + t * 42) % VIEW.width; const py = cy + ((ph(k * 3.9) * VIEW.height) + t * 52) % VIEW.height; canvasContext.beginPath(); canvasContext.arc(px, py, 2, 0, Math.PI * 2); canvasContext.fill(); } }
    else { canvasContext.strokeStyle = 'rgba(120,160,180,.7)'; canvasContext.lineWidth = 1.4; for (let k = 0; k < 8; k += 1) { const bx = cx + ph(k * 3.1) * VIEW.width + Math.sin(t * 2 + k) * 8; const by = cy + ph(k * 7.3) * 90; canvasContext.beginPath(); canvasContext.moveTo(bx - 5, by); canvasContext.quadraticCurveTo(bx, by - 4, bx + 5, by); canvasContext.stroke(); } }
    canvasContext.restore();
    // 夜晚覆盖
    if (night > .05) { canvasContext.fillStyle = `rgba(10,14,34,${night * .32})`; canvasContext.fillRect(cameraX, cameraY, VIEW.width, VIEW.height); }
    // 暗角
    const vg = canvasContext.createRadialGradient(cameraX + VIEW.width / 2, cameraY + VIEW.height / 2, VIEW.height * .45, cameraX + VIEW.width / 2, cameraY + VIEW.height / 2, VIEW.height * .85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.32)');
    canvasContext.fillStyle = vg; canvasContext.fillRect(cameraX, cameraY, VIEW.width, VIEW.height);
  }

  // 动态背景：飘动画云影 + 漂浮光点/萤火
  function drawAmbient() {
    const night = clamp(1 - Math.abs(timeOfDay - .5) * 2.2, 0, 1);
    const c = canvasContext;
    for (const cl of clouds) {
      c.save(); c.translate(cl.x, cl.y); c.scale(1, .45);
      c.fillStyle = night > .5 ? 'rgba(10,14,28,.22)' : 'rgba(40,60,52,.10)';
      c.beginPath(); c.arc(0, 0, cl.w * .4, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    for (const m of motes) {
      const tw = .35 + .65 * Math.abs(Math.sin(m.ph));
      c.globalAlpha = tw * (night > .5 ? .85 : .5);
      c.fillStyle = night > .5 ? '#9fe8ff' : '#ffcf7a';
      c.beginPath(); c.arc(m.x, m.y, m.r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
  }

  function drawTower() {
    const c = canvasContext; const f = tower.facing || 1;
    c.save(); c.translate(tower.x, tower.y);
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(0, 14, 40, 12, 0, 0, Math.PI * 2); c.fill();
    // 底盘与城齿
    c.fillStyle = '#31405a'; c.beginPath(); c.arc(0, -4, 34, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3d4a5e'; c.beginPath(); c.arc(0, -6, 28, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#28364a'; for (let i = 0; i < 8; i += 1) { const a = i / 8 * Math.PI * 2; c.fillRect(Math.cos(a) * 26 - 5, Math.sin(a) * 20 - 6, 10, 8); }
    // 炮塔
    c.fillStyle = '#4a5a70'; c.fillRect(-10, -44, 20, 20);
    c.fillStyle = '#2c3748'; c.fillRect(-10, -50, 20, 7);
    // 炮口（朝向移动/攻击方向）
    c.strokeStyle = '#26354a'; c.lineWidth = 7; c.lineCap = 'round'; c.beginPath(); c.moveTo(0, -42); c.lineTo(f * 30, -44); c.stroke();
    // 旗帜
    c.strokeStyle = '#26354a'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, -50); c.lineTo(0, -72); c.stroke();
    const wave = Math.sin(elapsed * 6) * 3;
    c.fillStyle = tower.hp > tower.maxHp * .5 ? tower.color : '#e2574b'; c.beginPath(); c.moveTo(0, -72); c.lineTo(24 + wave, -67); c.lineTo(0, -62); c.closePath(); c.fill();
    c.restore();
    if (tower.hitFlash > 0) { c.globalAlpha = clamp(tower.hitFlash * 2, 0, .7); c.strokeStyle = '#fff'; c.lineWidth = 4; c.beginPath(); c.arc(tower.x, tower.y - 8, 45, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; }
    // 回复光环
    c.save(); c.globalAlpha = .3 + .08 * Math.sin(elapsed * 4); c.strokeStyle = '#8fe0b0'; c.lineWidth = 2; c.setLineDash([5, 6]); c.beginPath(); c.arc(tower.x, tower.y - 4, 112, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); c.restore();
    // 炮口能量点
    c.save(); c.globalAlpha = .6; c.fillStyle = tower.color; c.beginPath(); c.arc(tower.x + f * 32, tower.y - 44, 4, 0, Math.PI * 2); c.fill(); c.restore();
    drawHpBar(tower, 68, 8);
  }

  // 通用绘制：兵种（含性格特效、武器、血条）
  function drawStickmanEntity(unit, sizeMul = 1) {
    const type = unitType(unit); const color = unit.team === 'player' ? type.color : type.color || '#ef6b73';
    const pose = stickmanPose(unit);
    const unitSize = (unit.size || type.size || 1) * sizeMul;
    if (unit.kind === 'fortress' || type.kind === 'fortress') { drawFortress(unit); }
    else {
      const c = canvasContext; c.save(); c.translate(unit.x, unit.y); c.scale(unitSize, unitSize); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 4; c.lineCap = 'round';
      c.fillStyle = 'rgba(19,34,48,.2)'; c.beginPath(); c.ellipse(0, 30, 13, 4, 0, 0, Math.PI * 2); c.fill(); c.strokeStyle = color; c.fillStyle = color;
      c.beginPath(); c.arc(0, pose.headY, 8, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(0, pose.torsoTopY); c.lineTo(0, pose.hipY); c.moveTo(0, pose.torsoTopY + 7); c.lineTo(pose.leftArm.x, pose.leftArm.y); c.moveTo(0, pose.torsoTopY + 7); c.lineTo(pose.rightArm.x, pose.rightArm.y); c.moveTo(0, pose.hipY); c.lineTo(pose.leftLeg.x, pose.leftLeg.y); c.moveTo(0, pose.hipY); c.lineTo(pose.rightLeg.x, pose.rightLeg.y); c.stroke();
      drawClassDetail(unit, type, pose);
      drawTraitFlag(unit, pose);
      drawWeapon(unit, pose);
      drawHandEffect(unit, pose);
      if (type.kind === 'custom' && type.strokes?.length) { c.save(); c.globalAlpha = .92; c.strokeStyle = color; c.lineWidth = 2.5; c.rotate(type.weapon === 'sword' && pose.swing ? (unit.facing || 1) * pose.swing * .12 : 0); c.scale(.24, .24); c.translate(-110, -70); for (const stroke of type.strokes) { c.beginPath(); stroke.forEach((point, index) => index ? c.lineTo(point.x, point.y) : c.moveTo(point.x, point.y)); c.stroke(); } c.restore(); }
      if (unit.hitFlash > 0) { c.save(); c.globalAlpha = clamp(unit.hitFlash * 2.2, 0, .8); c.fillStyle = '#fff'; c.beginPath(); c.arc(0, 0, 27, 0, Math.PI * 2); c.fill(); c.restore(); }
      if (unit.buff?.speed || unit.buff?.dmg) { const col = unit.buff.speed && unit.buff.dmg ? '#e6b45b' : unit.buff.speed ? '#4ec2d8' : '#ff6b35'; c.save(); c.globalAlpha = .8; c.strokeStyle = col; c.lineWidth = 2; c.setLineDash([4, 5]); c.beginPath(); c.arc(0, 0, 24, elapsed * 3, elapsed * 3 + Math.PI * 1.2); c.stroke(); c.setLineDash([]); c.restore(); }
      c.restore();
    }
    drawHpBar(unit, 40, Math.max(4, (unit.size || 1) * 3.6));
  }

  function drawHpBar(entity, width, height) {
    const c = canvasContext; const w = width * (entity.size || 1); const barY = entity.y - 40 * (entity.size || 1) - 2;
    const pct = clamp(entity.hp / entity.maxHp, 0, 1);
    c.fillStyle = 'rgba(10,16,28,.75)'; c.fillRect(entity.x - w / 2 - 1, barY - 1, w + 2, height + 2);
    c.fillStyle = pct > .5 ? '#3ddc97' : pct > .25 ? '#ffc24b' : '#ff4b5c'; c.fillRect(entity.x - w / 2, barY, w * pct, height);
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1; c.strokeRect(entity.x - w / 2 - 1, barY - 1, w + 2, height + 2);
  }

  function drawWeapon(unit, pose) {
    const direction = unit.facing || 1; const hand = pose.rightArm; const type = unitType(unit); const c = canvasContext;
    c.save(); c.strokeStyle = '#26354a'; c.fillStyle = '#26354a'; c.lineCap = 'round'; c.lineJoin = 'round';
    if (type.weapon === 'bow') { const bowX = hand.x + direction * 3; const bowY = hand.y - 1; c.strokeStyle = '#9b643c'; c.lineWidth = 2; c.beginPath(); c.arc(bowX, bowY, 10, -Math.PI * .72, Math.PI * .72, direction < 0); c.stroke(); c.strokeStyle = '#e9edf5'; c.beginPath(); c.moveTo(bowX - direction * 7, bowY - 7); c.lineTo(bowX + direction * 6, bowY); c.lineTo(bowX - direction * 7, bowY + 7); c.stroke(); c.strokeStyle = '#26354a'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(bowX + direction * 4, bowY); c.lineTo(bowX + direction * 22, bowY); c.stroke(); }
    else if (type.weapon === 'pickaxe') { const swing = pose.swing || 0; c.strokeStyle = '#8b5939'; c.lineWidth = 3; c.beginPath(); c.moveTo(hand.x, hand.y); c.lineTo(hand.x + direction * (12 + swing * 10), hand.y - 19 + swing * 22); c.stroke(); c.strokeStyle = '#536271'; c.lineWidth = 4; c.beginPath(); c.moveTo(hand.x + direction * (4 + swing * 8), hand.y - 18 + swing * 22); c.lineTo(hand.x + direction * (19 + swing * 8), hand.y - 10 + swing * 22); c.stroke(); }
    else if (type.weapon === 'katana') { const swing = pose.swing || 0; const reach = clamp(Number(type.weaponReach) || 48, 22, 90) + swing * 6; c.strokeStyle = '#a6a6b2'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(hand.x, hand.y); c.lineTo(hand.x + direction * reach, hand.y - 16 - swing * 8); c.stroke(); c.strokeStyle = '#eef2fa'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(hand.x + direction * reach, hand.y - 16 - swing * 8); c.quadraticCurveTo(hand.x + direction * (reach - 10), hand.y - 8 - swing * 8, hand.x + direction * (reach - 16), hand.y - 3 - swing * 8); c.stroke(); }
    else if (type.weapon === 'staff') { c.strokeStyle = '#8b5a35'; c.lineWidth = 3; c.beginPath(); c.moveTo(hand.x, hand.y - 18 - (pose.swing || 0) * 4); c.lineTo(hand.x, hand.y + 12); c.stroke(); c.fillStyle = type.color; c.beginPath(); c.arc(hand.x, hand.y - 18 - (pose.swing || 0) * 4, 5 + (pose.swing || 0) * 3, 0, Math.PI * 2); c.fill(); }
    else if (type.weapon === 'club') { const swing = pose.swing || 0; const reach = clamp(Number(type.weaponReach) || 44, 22, 90) + swing * 8; c.strokeStyle = '#7a5a3a'; c.lineWidth = 5; c.beginPath(); c.moveTo(hand.x, hand.y); c.lineTo(hand.x + direction * reach, hand.y - 14 - swing * 10); c.stroke(); c.fillStyle = '#5b4430'; c.beginPath(); c.arc(hand.x + direction * reach, hand.y - 14 - swing * 10, 6, 0, Math.PI * 2); c.fill(); }
    else if (type.weapon === 'claw') { const swing = pose.swing || 0; const reach = clamp(Number(type.weaponReach) || 30, 22, 90) + swing * 8; c.strokeStyle = '#cfd6e0'; c.lineWidth = 2; for (let i = -1; i <= 1; i += 1) { c.beginPath(); c.moveTo(hand.x, hand.y); c.lineTo(hand.x + direction * reach, hand.y - 8 + i * 6 - swing * 8); c.stroke(); } }
    else if (type.weapon === 'cannon') { c.strokeStyle = '#2c3748'; c.lineWidth = 4; c.beginPath(); c.moveTo(hand.x, hand.y); c.lineTo(hand.x + direction * 20, hand.y - 2); c.stroke(); c.fillStyle = '#0f141c'; c.beginPath(); c.arc(hand.x + direction * 20, hand.y - 2, 3, 0, Math.PI * 2); c.fill(); }
    else { const reach = clamp(Number(type.weaponReach) || 30, 22, 90) + (pose.swing || 0) * 10; const endX = hand.x + direction * reach; const endY = hand.y - 10 - (pose.swing || 0) * 12; c.strokeStyle = '#36485e'; c.lineWidth = 3; c.beginPath(); c.moveTo(hand.x, hand.y); c.lineTo(endX, endY); c.stroke(); c.strokeStyle = '#e6eefb'; c.lineWidth = 2; c.beginPath(); c.moveTo(endX, endY); c.lineTo(endX + direction * 8, endY - 4); c.stroke(); if (pose.swing > 0) { c.strokeStyle = unit.team === 'enemy' ? 'rgba(239,107,115,.75)' : 'rgba(100,165,255,.8)'; c.lineWidth = 3; c.beginPath(); c.arc(0, -4, Math.max(25, Number(type.weaponReach) || 30) + pose.swing * 10, direction < 0 ? Math.PI * .9 : -.1, direction < 0 ? Math.PI * 1.9 : Math.PI * 1.1); c.stroke(); } }
    c.restore();
  }

  function drawHandEffect(unit, pose) {
    if (!(pose.swing > 0)) return;
    const type = unitType(unit); const hand = pose.rightArm; const direction = unit.facing || 1; const alpha = clamp(pose.swing * 1.35, 0, 1); const c = canvasContext;
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = alpha; c.translate(hand.x, hand.y);
    switch (handEffectType(type.weapon)) {
      case 'charge': c.strokeStyle = type.color; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 7 + pose.swing * 5, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#fff4c4'; c.beginPath(); c.arc(0, 0, 2 + pose.swing * 2, 0, Math.PI * 2); c.fill(); break;
      case 'sparks': c.strokeStyle = '#ffe49a'; c.lineWidth = 2; for (let index = 0; index < 5; index += 1) { const angle = -Math.PI * .8 + index * Math.PI * .4; const length = 7 + pose.swing * 8; c.beginPath(); c.moveTo(Math.cos(angle) * 3, Math.sin(angle) * 3); c.lineTo(Math.cos(angle) * length, Math.sin(angle) * length); c.stroke(); } break;
      case 'magic': c.strokeStyle = type.color; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 5 + pose.swing * 7, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#e8dcff'; c.beginPath(); c.arc(0, 0, 3 + pose.swing * 2, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.5; for (let index = 0; index < 4; index += 1) { const angle = index * Math.PI / 2 + pose.swing; c.beginPath(); c.moveTo(Math.cos(angle) * 7, Math.sin(angle) * 7); c.lineTo(Math.cos(angle) * (13 + pose.swing * 5), Math.sin(angle) * (13 + pose.swing * 5)); c.stroke(); } break;
      case 'crush': c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 8 + pose.swing * 8, 0, Math.PI * 2); c.stroke(); c.fillStyle = 'rgba(255,220,150,.7)'; for (let index = 0; index < 3; index += 1) { const a = index * Math.PI / 1.5 + .4; const r = 4 + pose.swing * 10; c.beginPath(); c.arc(Math.cos(a) * r * .4, Math.sin(a) * r * .4, 2 + pose.swing * 2, 0, Math.PI * 2); c.fill(); } break;
      case 'slash': c.strokeStyle = 'rgba(240,245,255,.85)'; c.lineWidth = 2; for (let index = 0; index < 3; index += 1) { c.beginPath(); c.moveTo(-direction * (6 + index * 2), -4 + index * 4); c.lineTo(-direction * (14 + index * 2 + pose.swing * 9), 6 + index * 3); c.stroke(); } break;
      default: c.fillStyle = type.color; c.beginPath(); c.arc(0, 0, 4 + pose.swing * 4, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#dcecff'; c.lineWidth = 2; c.beginPath(); c.moveTo(-direction * 4, 0); c.lineTo(-direction * (12 + pose.swing * 9), -pose.swing * 5); c.stroke();
    }
    c.restore();
  }
  function drawClassDetail(unit, type, pose) {
    const kind = unit.kind || type.kind; const c = canvasContext; const hy = pose.headY; c.lineWidth = 3; c.strokeStyle = unit.team === 'enemy' ? '#3a1216' : '#1d2c45'; c.fillStyle = c.strokeStyle;
    if (kind === 'samurai') { c.beginPath(); c.moveTo(0, hy - 8); c.lineTo(0, hy - 17); c.lineTo(4, hy - 13); c.closePath(); c.fill(); }
    else if (kind === 'paladin') { c.beginPath(); c.arc(0, hy, 8, Math.PI, 0); c.fill(); c.fillRect(-7, hy - 6, 14, 2); c.strokeStyle = '#e2574b'; c.beginPath(); c.moveTo(2, hy - 9); c.quadraticCurveTo(7, hy - 16, 12, hy - 8); c.stroke(); }
    else if (kind === 'mage') { c.beginPath(); c.moveTo(-8, hy - 5); c.lineTo(0, hy - 20); c.lineTo(8, hy - 5); c.closePath(); c.fill(); }
    else if (kind === 'necromancer') { c.beginPath(); c.arc(0, hy, 9, Math.PI, 0); c.fill(); c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.arc(0, hy + 2, 4, 0, Math.PI * 2); c.fill(); }
    else if (kind === 'skeleton') { c.fillStyle = '#dfe3ea'; c.beginPath(); c.arc(0, hy, 7, 0, Math.PI * 2); c.fill(); c.fillStyle = '#2a2f36'; c.beginPath(); c.arc(-2, hy, 1.8, 0, Math.PI * 2); c.arc(2, hy, 1.8, 0, Math.PI * 2); c.fill(); }
    else if (kind === 'zombie') { c.fillStyle = 'rgba(60,120,80,.55)'; c.beginPath(); c.arc(0, hy, 9, 0, Math.PI * 2); c.fill(); c.fillStyle = '#2f7a49'; c.beginPath(); c.arc(-3, hy - 2, 1.5, 0, Math.PI * 2); c.arc(3, hy - 2, 1.5, 0, Math.PI * 2); c.fill(); }
    else if (kind === 'giant') { c.strokeStyle = unit.team === 'enemy' ? '#2c343b' : '#3c4550'; c.beginPath(); c.moveTo(-4, hy + 4); c.lineTo(0, hy + 10); c.lineTo(4, hy + 4); c.stroke(); }
    else if (kind === 'swordsman') { c.strokeStyle = unit.team === 'enemy' ? '#7a2020' : '#c0392b'; c.beginPath(); c.moveTo(0, hy - 8); c.lineTo(6, hy - 14); c.stroke(); }
  }
  function drawTraitFlag(unit, pose) {
    const c = canvasContext; const lowHp = unit.hp / unit.maxHp < .3;
    if (unit.trait === 'surrender' && lowHp) { const wave = Math.sin(elapsed * 9) * 2.5; c.strokeStyle = '#e8e6e1'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, pose.headY - 8); c.lineTo(0, pose.headY - 27); c.stroke(); c.fillStyle = 'rgba(250,250,248,.96)'; c.beginPath(); c.moveTo(0, pose.headY - 27); c.lineTo(12 + wave, pose.headY - 24); c.lineTo(0, pose.headY - 21); c.closePath(); c.fill(); }
    else if (unit.trait === 'coward' && unit.fleeing) { c.fillStyle = '#fff'; c.font = '800 11px Arial'; c.textAlign = 'center'; c.fillText('!!', 0, pose.headY - 12); c.textAlign = 'start'; }
    else if (unit.trait === 'kamikaze' && lowHp) { const blink = (Math.sin(elapsed * 16) + 1) / 2; c.globalAlpha = .45 + blink * .45; c.strokeStyle = '#ff5b2e'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 21, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; c.fillStyle = '#ff5b2e'; c.font = '900 12px Arial'; c.textAlign = 'center'; c.fillText('💥', 0, pose.headY - 13); c.textAlign = 'start'; }
  }
  function drawEnemyCastle(c) {
    if (!c.alive) return;
    const ctx = canvasContext;
    ctx.save(); ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, 6, 40, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a3b32'; ctx.fillRect(-34, -22, 68, 44);
    ctx.fillStyle = '#8a4a3e'; ctx.fillRect(-30, -26, 24, 30); ctx.fillRect(6, -26, 24, 30);
    ctx.fillStyle = '#a04536'; ctx.fillRect(-30, -40, 24, 16); ctx.fillRect(6, -40, 24, 16);
    ctx.fillStyle = '#5a2320'; ctx.beginPath(); ctx.moveTo(-30, -40); ctx.lineTo(-18, -56); ctx.lineTo(-6, -40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a2320'; ctx.beginPath(); ctx.moveTo(6, -40); ctx.lineTo(18, -56); ctx.lineTo(30, -40); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3a1a18'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(18, -56); ctx.lineTo(18, -66); ctx.stroke();
    ctx.fillStyle = '#2c2f36'; ctx.beginPath(); ctx.moveTo(18, -66); ctx.lineTo(34, -63); ctx.lineTo(18, -60); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (c.hitFlash > 0) { ctx.globalAlpha = clamp(c.hitFlash * 2, 0, .6); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(c.x, c.y - 6, 46, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    drawHpBar(c, 64, 8);
  }
  function drawFortress(unit) {
    const s = unit.size || 2; const f = unit.facing || -1; const c = canvasContext;
    c.save(); c.translate(unit.x, unit.y); c.scale(s, s);
    c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(0, 4, 30, 8, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#38424f'; c.fillRect(-26, -6, 52, 12); c.strokeStyle = '#1f2833'; c.lineWidth = 2; for (let i = -22; i < 24; i += 8) { c.beginPath(); c.moveTo(i, -6); c.lineTo(i, 6); c.stroke(); }
    c.fillStyle = '#5a6b80'; c.beginPath(); c.moveTo(-19, -8); c.lineTo(-13, -22); c.lineTo(13, -22); c.lineTo(19, -8); c.closePath(); c.fill();
    c.fillStyle = '#4a5a70'; c.fillRect(-8, -32, 16, 12); c.fillStyle = '#2c3748'; c.fillRect(-8, -38, 16, 7);
    c.strokeStyle = '#2c3748'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, -36); c.lineTo(f * 20, -36); c.stroke();
    c.fillStyle = unit.team === 'player' ? '#3d6fe8' : '#ef6b73'; c.fillRect(-8, -38, 16, 4);
    c.restore();
  }

  function drawItem(item) {
    const def = ITEM_TYPES[item.type]; const pulse = 1 + Math.sin(performance.now() / 300 + item.x) * .12; const c = canvasContext;
    c.save(); c.translate(item.x, item.y); c.scale(pulse, pulse);
    c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(0, 5, 8, 2.5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#0f1420'; c.fillRect(-7, -8, 14, 12); c.fillStyle = def.color; c.fillRect(-7, -11, 14, 5);
    c.fillStyle = '#fff'; c.font = '600 9px Arial'; c.textAlign = 'center'; c.fillText(def.glyph, 0, 2); c.textAlign = 'start';
    c.restore();
  }

  // ---- 点击部署 ----
  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * VIEW.width / rect.width + cameraX;
    const y = (event.clientY - rect.top) * VIEW.height / rect.height + cameraY;
    return { x: clamp(x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX), y: clamp(y, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY) };
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!running) return;
    const p = canvasPoint(event);
    let type = deployTeam === 'player' ? (heroById(selectedTypeId) || customClasses().byId.get(selectedTypeId)) : ENEMY_TYPES.find((t) => t.id === selectedTypeId);
    if (!type) return;
    const isHero = deployTeam === 'player' && !!heroById(selectedTypeId);
    if (units.length >= 90) return toast('单位太多，清一清再铺', 'info');
    if (deployTeam === 'player') {
      if (isHero && kingsAlive() >= 8) return toast('英雄位已满（最多 8 位）', 'info');
      const cost = Math.round((isHero ? (type.cost || 120) : 14) * (stats.cost || 1));
      if (resources < cost) return toast(`金币不足，召唤需要 ${cost} 金`, 'bad');
      resources -= cost;
    }
    const unit = makeUnit(deployTeam, type, p.x, p.y);
    if (deployTeam === 'player') unit.isHeroUnit = isHero;
    units.push(unit);
    effects.push({ type: 'burst', x: p.x, y: p.y, life: .5, maxLife: .5, color: type.color, radius: 18 });
    burstParticles(p.x, p.y, type.color, 16, { up: 40 });
    renderPalette(); renderStats();
  });

  function render() {
    canvasContext.clearRect(0, 0, VIEW.width, VIEW.height);
    const shakeX = shake > 0 ? (Math.random() - .5) * shake * 22 : 0;
    const shakeY = shake > 0 ? (Math.random() - .5) * shake * 22 : 0;
    canvasContext.save(); canvasContext.translate(-cameraX + shakeX, -cameraY + shakeY);
    const region = activeRegion();
    canvasContext.fillStyle = '#0b1017'; canvasContext.fillRect(cameraX - 60, cameraY - 60, VIEW.width + 120, VIEW.height + 120);
    drawGround(region);
    drawAmbient();
    for (const c of enemyCastles) drawEnemyCastle(c);
    for (const item of items) drawItem(item);
    for (const gem of xps) { const pulse = 1 + Math.sin(elapsed * 8 + gem.x) * .15; canvasContext.save(); canvasContext.translate(gem.x, gem.y); canvasContext.rotate(elapsed * 2 + gem.x); canvasContext.scale(pulse, pulse); canvasContext.fillStyle = '#4fd4ff'; canvasContext.beginPath(); canvasContext.moveTo(0, -6); canvasContext.lineTo(4, 0); canvasContext.lineTo(0, 6); canvasContext.lineTo(-4, 0); canvasContext.closePath(); canvasContext.fill(); canvasContext.fillStyle = 'rgba(255,255,255,.72)'; canvasContext.beginPath(); canvasContext.arc(0, 0, 1.6, 0, Math.PI * 2); canvasContext.fill(); canvasContext.restore(); }
    for (const projectile of projectiles) {
      const el = projectile.element;
      if (el === 'fire') {
        canvasContext.save(); canvasContext.globalCompositeOperation = 'lighter';
        canvasContext.fillStyle = 'rgba(255,150,70,.8)'; canvasContext.beginPath(); canvasContext.arc(projectile.x, projectile.y, 5, 0, Math.PI * 2); canvasContext.fill();
        canvasContext.fillStyle = 'rgba(255,220,120,.9)'; canvasContext.beginPath(); canvasContext.arc(projectile.x, projectile.y, 2.6, 0, Math.PI * 2); canvasContext.fill();
        canvasContext.restore();
      } else if (el === 'magic') {
        canvasContext.save(); canvasContext.globalCompositeOperation = 'lighter';
        canvasContext.strokeStyle = '#d0b0ff'; canvasContext.lineWidth = 2; canvasContext.beginPath(); canvasContext.arc(projectile.x, projectile.y, 4 + Math.sin(elapsed * 20 + projectile.x) * 1.5, 0, Math.PI * 2); canvasContext.stroke();
        canvasContext.fillStyle = '#e8dcff'; canvasContext.beginPath(); canvasContext.arc(projectile.x, projectile.y, 2.5, 0, Math.PI * 2); canvasContext.fill();
        canvasContext.restore();
      } else {
        canvasContext.strokeStyle = projectile.color; canvasContext.lineWidth = 2; canvasContext.beginPath(); canvasContext.moveTo(projectile.x, projectile.y); canvasContext.lineTo(projectile.x - 12, projectile.y); canvasContext.stroke();
      }
    }
    for (const effect of effects) {
      const maxLife = Math.max(.01, effect.maxLife || .3); const progress = 1 - effect.life / maxLife; canvasContext.globalAlpha = clamp(effect.life / maxLife, 0, 1);
      if (effect.type === 'slash') { canvasContext.strokeStyle = effect.color; canvasContext.lineWidth = 5; canvasContext.beginPath(); canvasContext.arc(effect.x, effect.y, 16 + progress * 18, effect.direction < 0 ? Math.PI * .15 : Math.PI * .85, effect.direction < 0 ? Math.PI * .85 : Math.PI * 1.85); canvasContext.stroke(); }
      else if (effect.type === 'heal') { canvasContext.strokeStyle = effect.color; canvasContext.lineWidth = 3; canvasContext.beginPath(); canvasContext.moveTo(effect.x - 6, effect.y); canvasContext.lineTo(effect.x + 6, effect.y); canvasContext.moveTo(effect.x, effect.y - 6); canvasContext.lineTo(effect.x, effect.y + 6); canvasContext.stroke(); }
      else if (effect.type === 'spawn') { canvasContext.strokeStyle = effect.color; canvasContext.lineWidth = 2; canvasContext.beginPath(); canvasContext.arc(effect.x, effect.y, 6 + progress * 14, 0, Math.PI * 2); canvasContext.stroke(); }
      else if (effect.type === 'burst') { canvasContext.strokeStyle = effect.color; canvasContext.lineWidth = 3; canvasContext.beginPath(); canvasContext.arc(effect.x, effect.y, (effect.radius || 16) * progress, 0, Math.PI * 2); canvasContext.stroke(); }
      else if (effect.type === 'slam') { canvasContext.strokeStyle = effect.color; canvasContext.lineWidth = 4; canvasContext.beginPath(); canvasContext.arc(effect.x, effect.y, 10 + progress * 28, 0, Math.PI * 2); canvasContext.stroke(); }
      else if (effect.type === 'death') { canvasContext.strokeStyle = effect.color; canvasContext.lineWidth = 4; canvasContext.beginPath(); canvasContext.arc(effect.x, effect.y, 6 + progress * 24, 0, Math.PI * 2); canvasContext.stroke(); canvasContext.beginPath(); canvasContext.moveTo(effect.x - 10, effect.y - 10); canvasContext.lineTo(effect.x + 10, effect.y + 10); canvasContext.moveTo(effect.x + 10, effect.y - 10); canvasContext.lineTo(effect.x - 10, effect.y + 10); canvasContext.stroke(); }
      else { canvasContext.fillStyle = effect.color; canvasContext.beginPath(); canvasContext.arc(effect.x, effect.y, 5 + progress * 12, 0, Math.PI * 2); canvasContext.fill(); }
      canvasContext.globalAlpha = 1;
    }
    for (const unit of units) if (!unit.dead) { if (unit.team === 'player') drawStickmanEntity(unit, 1); }
    drawTower();
    for (const unit of units) if (!unit.dead && unit.team === 'enemy') drawStickmanEntity(unit, 1);
    for (const n of neutrals) if (!n.dead) drawNeutral(n);
    for (const p of particles) { canvasContext.globalAlpha = clamp(p.life / p.maxLife, 0, 1); canvasContext.fillStyle = p.color; canvasContext.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    canvasContext.globalAlpha = 1;
    for (const d of damageNumbers) { const pc = clamp(d.life / d.maxLife, 0, 1); canvasContext.globalAlpha = pc; canvasContext.fillStyle = d.color; canvasContext.font = `800 ${Math.round(13 * d.scale)}px Arial`; canvasContext.textAlign = 'center'; canvasContext.strokeStyle = 'rgba(0,0,0,.5)'; canvasContext.lineWidth = 3; canvasContext.strokeText(d.amount, d.x, d.y); canvasContext.fillText(d.amount, d.x, d.y); canvasContext.textAlign = 'start'; }
    canvasContext.globalAlpha = 1;
    canvasContext.restore();
    drawWeather(region);
    drawHUD();
  }

  function drawHUD() {
    const c = canvasContext;
    const mm = Math.floor(elapsed / 60); const ss = Math.floor(elapsed % 60).toString().padStart(2, '0');
    const allies = units.filter((u) => u.team === 'player' && !u.dead).length;
    const castlesLeft = enemyCastles.filter((c) => c.alive).length;
    c.fillStyle = 'rgba(255,255,255,.82)'; c.fillRect(12, 12, VIEW.width - 24, 30);
    c.fillStyle = '#1d304d'; c.font = '600 14px Arial';
    c.fillText(`${activeRegion().name} · 存活 ${mm}:${ss} · 击杀 ${kills}`, 24, 33);
    c.textAlign = 'right';
    c.fillText(victory ? '主城被摧毁' : (tower.mvl > 0 ? '控制堡垒中 · 兵跟随堡垒' : '空闲 · 堡垒跟随最近的我方兵'), VIEW.width - 24, 33);
    c.textAlign = 'start';
    // 主城血条
    const cw = VIEW.width / 2 - 40;
    barHUD(12, 50, cw, tower.hp, tower.maxHp, '#3d6fe8', `主城 ${Math.ceil(tower.hp)}`);
    // 经验条 + 等级（吸血鬼幸存者式成长线）
    const xpw = VIEW.width / 3;
    const xpm = clamp(xp / xpNeed, 0, 1);
    c.fillStyle = 'rgba(20,30,46,.75)'; c.fillRect(12, 66, xpw, 7);
    c.fillStyle = '#4fd4ff'; c.fillRect(12, 66, xpw * xpm, 7);
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1; c.strokeRect(12, 66, xpw, 7);
    c.font = '700 11px Arial'; c.fillStyle = '#86e4ff'; c.fillText(`Lv ${level} · 经验 ${Math.floor(xp)}/${xpNeed}`, 14, 78);
    c.fillStyle = '#e6b45b'; c.font = '700 13px Arial'; c.fillText(`金币 ${resources} · 我方兵 ${allies} · 敌方城堡 ${castlesLeft}/${enemyCastles.length}`, 12, 96);
    // 指北针（强调地图可上下左右漫游）
    c.save(); c.translate(VIEW.width - 52, 50); c.beginPath(); c.arc(0, 0, 15, 0, Math.PI * 2); c.fillStyle = 'rgba(20,30,46,.72)'; c.fill(); c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#ffd54f'; c.font = '800 11px Arial'; c.textAlign = 'center'; c.fillText('N', 0, -8); c.fillStyle = '#fff'; c.fillText('S', 0, 13); c.fillStyle = '#bcd0e8'; c.fillText('W', -11, 3); c.fillText('E', 11, 3); c.textAlign = 'start'; c.restore();
    if (victory) { c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, 0, VIEW.width, VIEW.height); c.fillStyle = '#ff4b5c'; c.font = '900 32px Arial'; c.textAlign = 'center'; c.fillText('主城被摧毁 · 防守失败', VIEW.width / 2, VIEW.height / 2 - 10); c.textAlign = 'start'; }
    if (victoryWin) { c.fillStyle = 'rgba(6,20,12,.62)'; c.fillRect(0, 0, VIEW.width, VIEW.height); c.fillStyle = '#7dffa8'; c.font = '900 34px Arial'; c.textAlign = 'center'; c.fillText('🎉 胜利！已摧毁所有敌方城堡', VIEW.width / 2, VIEW.height / 2 - 10); c.font = '600 16px Arial'; c.fillStyle = '#c6ffd9'; c.fillText('提前结束本局', VIEW.width / 2, VIEW.height / 2 + 22); c.textAlign = 'start'; }
  }
  function barHUD(x, y, w, hp, max, color, label) {
    const c = canvasContext; const pct = clamp(hp / max, 0, 1);
    c.fillStyle = 'rgba(10,16,28,.7)'; c.fillRect(x, y, w, 10);
    c.fillStyle = pct > .5 ? '#3ddc97' : pct > .25 ? '#ffc24b' : '#ff4b5c'; c.fillRect(x, y, w * pct, 10);
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1; c.strokeRect(x, y, w, 10);
    c.fillStyle = '#fff'; c.font = '700 9px Arial'; c.fillText(label, x + 4, y + 8);
  }

  function renderStats() { resourceEl.textContent = `金币 ${resources}`; unitCountEl.textContent = `击杀 ${kills}`; statusEl.textContent = `存活 ${Math.floor(elapsed)}s · 单位 ${units.filter((u) => !u.dead).length}`; }

  function toggleBattle() {
    if (running) { running = false; cancelAnimationFrame(animationFrame); startBtn.textContent = '继续'; statusEl.textContent = '已暂停'; return; }
    startBattle();
  }
  function startBattle() { if (running) return; running = true; startBtn.textContent = '暂停'; lastTime = performance.now(); animationFrame = requestAnimationFrame(loop); }
  function selectRegion(id) { if (!REGIONS.some((r) => r.id === id)) return; currentRegionId = id; config.set('focus.battle.region', id); regionSelect.value = id; resetBattle(); }
  function resetBattle() {
    running = false; cancelAnimationFrame(animationFrame); animationFrame = 0; lastTime = 0; resources = 80; kills = 0; effects = []; projectiles = []; items = []; obstacles = buildObstacles(); particles = []; damageNumbers = []; shake = 0; timeOfDay = 0.42; elapsed = 0; spawnTimer = 1.6; incomeTimer = 4; autoTimer = 0; victory = false; victoryWin = false; units = []; enemyCastles = buildEnemyCastles(); neutrals = buildNeutrals(); xp = 0; xpNeed = 12; level = 1; xps = []; levelUpOpen = false; stats = { dmg: 1, rate: 1, speed: 1, hp: 1, cost: 1, proj: 1, regen: 0, income: 1 }; upgradePanel.style.display = 'none'; upgradePanel.replaceChildren();
    initCinematics();
    // 开局送两个护卫，保证一上来就能打
    units.push(makeUnit('player', UNIT_CLASSES.default, tower.x + 40, tower.y + 10));
    units.push(makeUnit('player', UNIT_CLASSES.swordsman, tower.x + 76, tower.y + 18));
    renderArchSelector();
    startBattle();
    renderStats();
  }

  // ---- 键盘控制 ----
  const onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    keys[e.key.toLowerCase()] = true;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) e.preventDefault();
  };
  const onKeyUp = (e) => { keys[e.key.toLowerCase()] = false; };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  root.style.position = 'relative';
  root.append(
    h('div', { class: 'bar battle__bar' }, h('strong', {}, '火柴人·无尽突围'), h('span', { class: 'faint' }, '俯视角塔防 · 造兵守城'), h('span', { class: 'battle__bar-spacer' }), regionSelect, resourceEl, unitCountEl, statusEl),
    h('div', { class: 'battle__layout' },
      h('section', { class: 'battle__main' }, canvas, h('div', { class: 'battle__controls' }, startBtn, resetBtn, teamSelect, h('span', { class: 'faint' }, '主城定时自动造兵 · 点击召唤英雄（贵）'))),
      h('aside', { class: 'battle__sidebar' },
        h('section', { class: 'card battle__card' }, h('h3', {}, '主城架构（换流派）'), h('p', { class: 'faint' }, '决定主城自动产的兵、炮塔元素与外观。'), archEl),
        h('section', { class: 'card battle__card' }, h('h3', {}, '英雄单位（点击召唤）'), h('p', { class: 'faint' }, '主城定时自动造普通兵；这里用大量金币手动召唤英雄，最多 8 位。'), paletteEl),
        h('section', { class: 'card battle__card' }, h('h3', {}, '敌方样本'), h('p', { class: 'faint' }, '怪物会从四面八方自动刷新；也可手动放置敌方样本练手。'), enemyPaletteEl),
        h('section', { class: 'card battle__card' }, h('h3', {}, '掉落物'), h('p', { class: 'faint' }, '击杀与时间会掉落药剂/宝箱/宝石/疾风/狂暴，路过自动拾取。'), itemsLegendEl),
        h('section', { class: 'card battle__card battle__draw-card' }, h('h3', {}, '手绘 / 随机一个兵种'), drawPad, h('div', { class: 'battle__draw-actions' }, customName), h('div', { class: 'battle__draw-row' }, customColor, customRandom, saveCustomBtn), customHint),
        h('div', { class: 'battle__rules' }, h('strong', {}, '玩法'), h('span', {}, '① WASD 移动堡垒；空闲时堡垒跟随最近的我方兵，操控时兵反过来跟堡垒走'), h('span', {}, '② 主城定时自动造普通兵（由架构决定）；点击地图召唤英雄（贵·最多8位）'), h('span', {}, '③ 我方兵血量低自动退回堡垒范围回血；离堡垒太远会直接传送回堡垒'), h('span', {}, '④ 地图角落有会造兵守家的敌方城堡，推平它们可提前获胜'), h('span', {}, '⑤ 地图散落中立单位，它们会随机帮敌方或帮我们、还会随机倒戈'), h('span', {}, '⑥ 切主城架构：兵营/烈焰塔/法师塔/骑士塔/兽巢 → 改自动产兵与炮塔元素'), h('span', {}, '⑦ 怪物四面八方涌来；升级【三选一】强化；兵有随机性格')),
      ),
    ),
    upgradePanel,
  );
  regionSelect.value = currentRegionId;
  drawPadBackground(); renderPalette(); resetBattle();
  return {
    deactivate: () => { running = false; cancelAnimationFrame(animationFrame); window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); },
    activate: startBattle,
  };
}