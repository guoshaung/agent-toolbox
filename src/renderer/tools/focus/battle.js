import { h, toast } from '../../core/ui.js';

const WORLD = { width: 960, height: 500 };
const GROUND_Y = 382;
const INITIAL_WORLD_LENGTH = 1800;
const FRONTIER_STEP = 920;
const ENEMY_TYPES = [
  { id: 'raider', name: '突击兵', hp: 72, speed: 38, damage: 15, range: 30, color: '#ef6b73', weapon: 'sword', action: 'slash' },
  { id: 'ranger', name: '远程兵', hp: 48, speed: 28, damage: 11, range: 150, color: '#f2bd5d', weapon: 'bow', action: 'shoot' },
  { id: 'harvester', name: '采集兵', hp: 58, speed: 32, damage: 9, range: 32, color: '#c28be8', weapon: 'pickaxe', action: 'mine' },
];

const REGIONS = [
  { id: 'china', name: '🇨🇳 中国·山地长城', terrain: 'mountain', sky: '#c9e6f3', land: '#8fbd91', accent: '#6b8e68', hotspot: { x: 525, y: 205 }, obstacles: [{ x: 340, y: 145, width: 52, height: 24 }, { x: 545, y: 300, width: 44, height: 28 }, { x: 465, y: 110, width: 42, height: 26 }], resources: [{ x: 265, y: 315, amount: 10 }, { x: 650, y: 190, amount: 9 }, { x: 485, y: 390, amount: 8 }] },
  { id: 'japan', name: '🇯🇵 日本·岛屿樱海', terrain: 'island', sky: '#b9dff2', land: '#94c6a2', accent: '#e88ea8', hotspot: { x: 565, y: 230 }, obstacles: [{ x: 390, y: 170, width: 40, height: 24 }, { x: 520, y: 345, width: 46, height: 24 }, { x: 615, y: 140, width: 34, height: 25 }], resources: [{ x: 280, y: 240, amount: 8 }, { x: 600, y: 280, amount: 11 }, { x: 450, y: 400, amount: 7 }] },
  { id: 'egypt', name: '🇪🇬 埃及·沙漠金字塔', terrain: 'desert', sky: '#f3dfb2', land: '#d4b77d', accent: '#b9884d', hotspot: { x: 470, y: 220 }, obstacles: [{ x: 350, y: 170, width: 48, height: 32 }, { x: 555, y: 250, width: 58, height: 34 }, { x: 470, y: 360, width: 40, height: 30 }], resources: [{ x: 260, y: 350, amount: 12 }, { x: 650, y: 160, amount: 8 }, { x: 500, y: 405, amount: 9 }] },
  { id: 'brazil', name: '🇧🇷 巴西·雨林河谷', terrain: 'rainforest', sky: '#b6d8c1', land: '#5d9b72', accent: '#2f755b', hotspot: { x: 405, y: 285 }, obstacles: [{ x: 370, y: 125, width: 58, height: 30 }, { x: 565, y: 180, width: 42, height: 45 }, { x: 505, y: 350, width: 60, height: 28 }], resources: [{ x: 275, y: 210, amount: 8 }, { x: 640, y: 315, amount: 10 }, { x: 450, y: 410, amount: 8 }] },
  { id: 'norway', name: '🇳🇴 挪威·峡湾雪线', terrain: 'fjord', sky: '#b8c9e3', land: '#7897a5', accent: '#506b82', hotspot: { x: 520, y: 170 }, obstacles: [{ x: 335, y: 220, width: 60, height: 22 }, { x: 565, y: 125, width: 46, height: 30 }, { x: 500, y: 350, width: 52, height: 26 }], resources: [{ x: 270, y: 320, amount: 8 }, { x: 640, y: 225, amount: 10 }, { x: 440, y: 390, amount: 7 }] },
];

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

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
  if (!bounds) return { combatClass: 'melee', weapon: 'sword', action: 'slash', weaponReach: 30, range: 30, weaponLabel: '近战刀具' };
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
  const weapon = bowLike && !bladeLike ? 'bow' : 'sword';
  const combatClass = weapon === 'bow' ? 'ranged' : 'melee';
  const weaponReach = clamp(Math.round((extension > 0 ? extension : 42) * (weapon === 'bow' ? .5 : .62)), 28, 88);
  return { combatClass, weapon, action: weapon === 'bow' ? 'shoot' : 'slash', weaponReach, range: weapon === 'bow' ? Math.max(120, weaponReach * 4) : weaponReach, weaponLabel: weapon === 'bow' ? '远程弓箭' : `近战刀具 · ${weaponReach}px` };
}

export function handEffectType(weapon = 'sword') {
  if (weapon === 'bow') return 'charge';
  if (weapon === 'pickaxe') return 'sparks';
  return 'energy-trail';
}

export function stickmanPose(unit = {}) {
  const phase = Number.isFinite(unit.walkPhase) ? unit.walkPhase : 0;
  const walking = Boolean(unit.moving);
  const stride = walking ? Math.sin(phase) * 9 : 0;
  const bob = walking ? Math.abs(Math.cos(phase)) * 2 : 0;
  const attacking = Number(unit.attackClock) > 0;
  const direction = unit.team === 'enemy' ? -1 : 1;
  const attackDuration = Math.max(.18, Number(unit.attackDuration) || .3);
  const attackProgress = attacking ? 1 - clamp(Number(unit.attackClock) / attackDuration, 0, 1) : 0;
  const swing = Math.sin(attackProgress * Math.PI);
  const weapon = unit.weapon || 'sword';
  const mining = weapon === 'pickaxe' && attacking;
  const shooting = weapon === 'bow' && attacking;
  return {
    headY: -18 + bob,
    torsoTopY: -9 + bob,
    hipY: 14 + bob,
    leftLeg: { x: -10 + stride, y: 28 + bob },
    rightLeg: { x: 10 - stride, y: 28 + bob },
    leftArm: { x: -12 - (attacking ? direction * (mining ? 8 : shooting ? 3 : 3) * swing : 0), y: 7 + bob - (mining ? 8 * swing : 0) },
    rightArm: { x: 12 + (attacking ? direction * (mining ? 13 : shooting ? 2 : 9) * swing : 0), y: 7 + bob - (mining ? 13 * swing : shooting ? 2 * swing : 0) },
    attackProgress,
    swing,
    weapon,
  };
}

export function createBattle(root, ctx) {
  const { config } = ctx;
  const canvas = h('canvas', { class: 'battle__canvas', width: String(WORLD.width), height: String(WORLD.height), tabindex: '0' });
  const drawPad = h('canvas', { class: 'battle__draw-pad', width: '220', height: '140' });
  const canvasContext = canvas.getContext('2d');
  const padContext = drawPad.getContext('2d');
  const statusEl = h('span', { class: 'battle__status' }, '准备部署');
  const resourceEl = h('strong', { class: 'battle__resource' }, '资源 0');
  const unitCountEl = h('span', { class: 'faint' }, '我方 0 · 敌方 3');
  const paletteEl = h('div', { class: 'battle__palette' });
  const enemyPaletteEl = h('div', { class: 'battle__enemy-palette' });
  const obstacleBtn = h('button', { class: 'btn btn--sm', onclick: () => setMode(mode === 'obstacle' ? 'unit' : 'obstacle') }, '放置障碍');
  const teamSelect = h('select', { class: 'field field--sm', title: '选择部署方', onchange: () => { deployTeam = teamSelect.value; setMode('unit'); } },
    h('option', { value: 'player' }, '我方部署'), h('option', { value: 'enemy' }, '敌方部署'));
  const startBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => toggleBattle() }, '开始自动战斗');
  const resetBtn = h('button', { class: 'btn btn--sm', onclick: () => resetBattle() }, '重置关卡');
  const regionSelect = h('select', { class: 'field field--sm', title: '选择国家景色与对应障碍', onchange: () => selectRegion(regionSelect.value) }, REGIONS.map((region) => h('option', { value: region.id }, region.name)));
  const countryBtn = h('button', { class: 'btn btn--sm', title: '点击地球上的国家色块切换景色', onclick: () => setMode(mode === 'region' ? 'unit' : 'region') }, '选择国家景色');
  const customName = h('input', { class: 'field field--sm', placeholder: '手绘兵种名称', maxlength: '18' });
  const saveCustomBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: saveCustomUnit }, '保存为兵种');
  const customHint = h('div', { class: 'faint' }, '画一笔就是一个可重复部署的兵种，不是单独一个士兵。');

  let running = false;
  let animationFrame = 0;
  let lastTime = 0;
  let mode = 'unit';
  let deployTeam = 'player';
  let selectedTypeId = 'default';
  let resources = 0;
  let obstacles = [];
  let units = [];
  let effects = [];
  let projectiles = [];
  let worldLength = INITIAL_WORLD_LENGTH;
  let cameraX = 0;
  let wave = 1;
  let drawing = false;
  let currentStroke = null;
  let customTypes = config.get('focus.battle.customTypes', []) || [];
  let customStrokes = [];
  let customAnalysis = analyzeCustomDrawing(customStrokes);
  let currentRegionId = config.get('focus.battle.region', 'china');

  const unitTypes = () => [{ id: 'default', name: '默认火柴人', hp: 90, speed: 38, damage: 17, range: 30, weaponReach: 30, color: '#3d6fe8', weapon: 'sword', action: 'slash', kind: 'default' }, ...customTypes.map((item) => { const profile = analyzeCustomDrawing(item.strokes); const hasSavedProfile = item.combatClass === 'melee' || item.combatClass === 'ranged'; return { ...profile, ...item, kind: 'custom', weapon: hasSavedProfile ? item.weapon : profile.weapon, action: hasSavedProfile ? item.action : profile.action, range: hasSavedProfile && Number(item.range) ? Number(item.range) : profile.range, weaponReach: hasSavedProfile && Number(item.weaponReach) ? Number(item.weaponReach) : profile.weaponReach }; })];

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
    customHint.textContent = `自动识别：${customAnalysis.weaponLabel}；保存后会按这个武器执行${customAnalysis.weapon === 'bow' ? '射击' : '劈砍'}动作。`;
    drawPadBackground();
  });

  function saveCustomUnit() {
    if (!customStrokes.length) return toast('先在绘制区画出一个兵种轮廓', 'info');
    const name = customName.value.trim() || `手绘兵种 ${customTypes.length + 1}`;
    const profile = customAnalysis;
    const item = { id: `custom-${Date.now()}`, name, strokes: customStrokes, hp: 75, speed: profile.combatClass === 'ranged' ? 30 : 34, damage: profile.combatClass === 'ranged' ? 13 : 18, color: '#7c5ac8', ...profile };
    customTypes = [...customTypes, item];
    config.set('focus.battle.customTypes', customTypes);
    selectedTypeId = item.id;
    customName.value = '';
    renderPalette();
    toast(`已保存兵种“${name}”，可以重复部署`, 'good');
  }

  function setMode(next) {
    mode = next;
    obstacleBtn.classList.toggle('is-active', mode === 'obstacle');
    countryBtn.classList.toggle('is-active', mode === 'region');
    canvas.classList.toggle('is-obstacle-mode', mode === 'obstacle');
    canvas.classList.toggle('is-region-mode', mode === 'region');
    const modeText = mode === 'obstacle' ? '点击地图放置障碍' : mode === 'region' ? '点击地球上的国家色块切换景色' : `部署${deployTeam === 'player' ? '我方' : '敌方'}·${unitTypes().find((item) => item.id === selectedTypeId)?.name || '默认火柴人'}`;
    statusEl.textContent = running ? `自动战斗进行中 · ${modeText}` : modeText;
  }

  function renderPalette() {
    paletteEl.replaceChildren(...unitTypes().map((type) => h('button', { class: `battle__unit-btn${type.id === selectedTypeId ? ' is-active' : ''}`, onclick: () => { selectedTypeId = type.id; deployTeam = 'player'; teamSelect.value = 'player'; setMode('unit'); renderPalette(); } }, drawTinyUnit(type), h('span', {}, type.name))));
    enemyPaletteEl.replaceChildren(...ENEMY_TYPES.map((type) => h('button', { class: 'battle__unit-btn battle__unit-btn--enemy', onclick: () => { selectedTypeId = type.id; deployTeam = 'enemy'; teamSelect.value = 'enemy'; setMode('unit'); } }, drawTinyUnit(type), h('span', {}, type.name))));
  }

  function drawTinyUnit(type) {
    const icon = h('span', { class: 'battle__unit-icon' });
    icon.style.setProperty('--unit-color', type.color);
    return icon;
  }

  function makeUnit(team, type, x, y) {
    return { id: `unit-${Date.now()}-${Math.random().toString(16).slice(2)}`, team, typeId: type.id, weapon: type.weapon || 'sword', action: type.action || 'slash', x, y, hp: type.hp, maxHp: type.hp, cooldown: Math.random() * .5, carry: 0, targetResource: null, dead: false, moving: false, walkPhase: Math.random() * Math.PI * 2, attackClock: 0, attackDuration: .3, facing: team === 'enemy' ? -1 : 1 };
  }

  function activeRegion() { return REGIONS.find((region) => region.id === currentRegionId) || REGIONS[0]; }
  function starterObstacles() { return activeRegion().obstacles.map((obstacle) => ({ ...obstacle, x: obstacle.x + 120 })); }
  function starterResources() { return activeRegion().resources.map((resource) => ({ ...resource, x: resource.x + 120 })); }

  function frontierSeed(value) {
    const number = Math.sin(value * 12.9898) * 43758.5453;
    return number - Math.floor(number);
  }

  function appendFrontier(start, end) {
    const region = activeRegion();
    const first = Math.max(760, Math.floor(start / 460) * 460);
    for (let x = first; x < end - 80; x += 460) {
      const seed = frontierSeed(x + wave * 17);
      resourceNodes.push({ x: x + 130 + seed * 170, y: 265 + frontierSeed(x + 7) * 95, amount: 5 + Math.floor(seed * 7) });
      if (frontierSeed(x + 31) > .28) obstacles.push({ x: x + 260 + frontierSeed(x + 13) * 100, y: 315 + frontierSeed(x + 19) * 35, width: 42 + frontierSeed(x + 23) * 34, height: 24 + frontierSeed(x + 29) * 16, kind: region.terrain });
      if (frontierSeed(x + 41) > .55) resourceNodes.push({ x: x + 360, y: 210 + frontierSeed(x + 43) * 150, amount: 4 + Math.floor(seed * 5) });
    }
  }

  function spawnEnemyWave() {
    const count = Math.min(9, 3 + Math.floor(wave / 2));
    const types = ENEMY_TYPES.slice(0, wave % 4 === 0 ? 3 : 2);
    for (let index = 0; index < count; index += 1) {
      const type = types[index % types.length];
      units.push(makeUnit('enemy', type, worldLength - 180 - (index % 3) * 30, 145 + (index % 5) * 52));
    }
  }

  function advanceFrontier() {
    const previousEnd = worldLength;
    worldLength += FRONTIER_STEP;
    wave += 1;
    appendFrontier(previousEnd - 220, worldLength);
    spawnEnemyWave();
    statusEl.textContent = `第 ${wave} 波：前方出现新的敌方据点`;
    effects.push({ type: 'frontier', x: worldLength - 180, y: GROUND_Y - 60, life: .9, maxLife: .9, color: '#7db6ff' });
  }

  let resourceNodes = starterResources();

  function selectRegion(id) {
    if (!REGIONS.some((region) => region.id === id)) return;
    currentRegionId = id; config.set('focus.battle.region', id); regionSelect.value = id; resetBattle(); setMode('region');
  }

  function resetBattle() {
    running = false; cancelAnimationFrame(animationFrame); animationFrame = 0; lastTime = 0; resources = 0; effects = []; projectiles = []; worldLength = INITIAL_WORLD_LENGTH; cameraX = 0; wave = 1; obstacles = starterObstacles(); resourceNodes = starterResources(); appendFrontier(760, worldLength);
    units = [];
    spawnEnemyWave();
    statusEl.textContent = `已进入${activeRegion().name} · 点击地图部署我方兵种`; startBtn.textContent = '暂停战斗'; renderStats(); render(); startBattle();
  }

  function startBattle() {
    if (running) return;
    running = true; startBtn.textContent = '暂停战斗'; statusEl.textContent = '自动战斗进行中'; lastTime = performance.now(); animationFrame = requestAnimationFrame(loop);
  }

  function toggleBattle() {
    if (running) { running = false; cancelAnimationFrame(animationFrame); startBtn.textContent = '继续战斗'; statusEl.textContent = '战斗已暂停'; return; }
    startBattle();
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) * WORLD.width / rect.width + cameraX, 0, worldLength), y: clamp((event.clientY - rect.top) * WORLD.height / rect.height, 0, WORLD.height) };
  }

  canvas.addEventListener('pointerdown', (event) => {
    const point = canvasPoint(event);
    if (mode === 'region') {
      const selectedRegion = REGIONS.find((region) => distance({ x: point.x - cameraX, y: point.y }, region.hotspot) < 34);
      if (selectedRegion) selectRegion(selectedRegion.id);
      return;
    }
    if (mode === 'obstacle') { obstacles.push({ x: clamp(point.x - 24, 20, WORLD.width - 68), y: clamp(point.y - 15, 55, WORLD.height - 55), width: 48, height: 30 }); render(); return; }
    const type = deployTeam === 'player' ? unitTypes().find((item) => item.id === selectedTypeId) : ENEMY_TYPES.find((item) => item.id === selectedTypeId);
    if (!type) return;
    const allowed = deployTeam === 'player' ? point.x < cameraX + WORLD.width * .48 : point.x > cameraX + WORLD.width * .52;
    if (!allowed) return toast(`${deployTeam === 'player' ? '我方' : '敌方'}只能部署在自己的半场`, 'info');
    if (obstacles.some((obstacle) => point.x > obstacle.x - 18 && point.x < obstacle.x + obstacle.width + 18 && point.y > obstacle.y - 18 && point.y < obstacle.y + obstacle.height + 18)) return toast('这里有障碍，换个位置', 'info');
    units.push(makeUnit(deployTeam, type, point.x, point.y)); renderStats(); render();
  });

  function nearestEnemy(unit) { let best = null; let bestDistance = Infinity; for (const other of units) { if (other.dead || other.team === unit.team) continue; const nextDistance = distance(unit, other); if (nextDistance < bestDistance) { best = other; bestDistance = nextDistance; } } return best; }
  function nearestResource(unit) { let best = null; let bestDistance = Infinity; for (const resource of resourceNodes) { if (resource.amount <= 0) continue; const nextDistance = distance(unit, resource); if (nextDistance < bestDistance) { best = resource; bestDistance = nextDistance; } } return best; }
  function moveUnit(unit, target, dt) {
    const dx = target.x - unit.x; const dy = target.y - unit.y; const length = Math.hypot(dx, dy) || 1; const speed = unitType(unit).speed * dt;
    let nextX = unit.x + dx / length * speed; let nextY = unit.y + dy / length * speed;
    for (const obstacle of obstacles) { if (nextX > obstacle.x - 12 && nextX < obstacle.x + obstacle.width + 12 && nextY > obstacle.y - 12 && nextY < obstacle.y + obstacle.height + 12) nextY += unit.y < obstacle.y ? -speed : speed; }
    const moved = Math.hypot(nextX - unit.x, nextY - unit.y);
    unit.x = clamp(nextX, 22, worldLength - 22); unit.y = clamp(nextY, 70, GROUND_Y - 24);
    unit.facing = dx < 0 ? -1 : 1;
    unit.moving = moved > 0.05;
    if (unit.moving) unit.walkPhase = (unit.walkPhase + dt * (7 + unitType(unit).speed * 0.06)) % (Math.PI * 2);
  }
  function unitType(unit) { return unit.team === 'enemy' ? ENEMY_TYPES.find((type) => type.id === unit.typeId) || ENEMY_TYPES[0] : unitTypes().find((type) => type.id === unit.typeId) || unitTypes()[0]; }

  function update(dt) {
    for (const unit of units) {
      if (unit.dead) continue;
      const type = unitType(unit); unit.cooldown -= dt; unit.attackClock = Math.max(0, unit.attackClock - dt); unit.moving = false;
      if (unit.attackClock <= 0) unit.action = '';
      const enemy = nearestEnemy(unit); const enemyDistance = enemy ? distance(unit, enemy) : Infinity;
      if (enemy && enemyDistance <= type.range + 8) {
        if (unit.cooldown <= 0) {
          unit.cooldown = type.weapon === 'bow' ? .72 : .5;
          unit.attackClock = type.weapon === 'pickaxe' ? .4 : .3;
          unit.attackDuration = unit.attackClock;
          unit.action = type.action || 'slash';
          unit.facing = enemy.x < unit.x ? -1 : 1;
          if (type.weapon === 'bow') projectiles.push({ x: unit.x + unit.facing * 15, y: unit.y - 6, targetId: enemy.id, speed: 430, damage: type.damage, color: type.color, life: 2 });
          else { enemy.hp -= type.damage; effects.push({ type: 'slash', x: enemy.x, y: enemy.y - 6, life: .28, maxLife: .28, color: type.color, direction: unit.facing }); effects.push({ type: 'impact', x: enemy.x, y: enemy.y - 8, life: .34, maxLife: .34, color: type.color }); if (enemy.hp <= 0) enemy.dead = true; }
        }
      } else if (enemy && enemyDistance < 250) moveUnit(unit, enemy, dt);
      else if (unit.carry < 3) {
        const resource = nearestResource(unit); if (resource) { if (distance(unit, resource) < 22) { resource.amount -= 1; unit.carry += 1; resources += 1; unit.attackClock = .28; unit.attackDuration = .28; unit.action = 'mine'; effects.push({ type: 'spark', x: resource.x, y: resource.y, life: .3, maxLife: .3, color: '#f4cb6b' }); } else moveUnit(unit, resource, dt); }
      } else {
        const castle = unit.team === 'player' ? { x: worldLength - 55, y: GROUND_Y - 35 } : { x: 55, y: GROUND_Y - 35 };
        if (distance(unit, castle) < 34) { resources += unit.team === 'player' ? unit.carry : 0; unit.carry = 0; moveUnit(unit, { x: castle.x + (unit.team === 'player' ? 40 : -40), y: castle.y }, dt); } else moveUnit(unit, castle, dt);
      }
    }
    for (const projectile of projectiles) {
      const target = units.find((unit) => unit.id === projectile.targetId && !unit.dead);
      if (!target) { projectile.life = 0; continue; }
      const dx = target.x - projectile.x; const dy = target.y - projectile.y; const length = Math.hypot(dx, dy) || 1; const travel = projectile.speed * dt;
      if (length <= travel + 7) { target.hp -= projectile.damage; projectile.life = 0; effects.push({ type: 'impact', x: target.x, y: target.y - 8, life: .34, maxLife: .34, color: projectile.color }); if (target.hp <= 0) target.dead = true; }
      else { projectile.x += dx / length * travel; projectile.y += dy / length * travel; projectile.life -= dt; }
    }
    units = units.filter((unit) => !unit.dead);
    projectiles = projectiles.filter((projectile) => projectile.life > 0);
    effects = effects.map((effect) => ({ ...effect, life: effect.life - dt })).filter((effect) => effect.life > 0);
    if (!units.some((unit) => unit.team === 'enemy')) advanceFrontier();
    if (!units.some((unit) => unit.team === 'player')) statusEl.textContent = '自动战斗已启动 · 等待部署我方兵种';
    const playerUnits = units.filter((unit) => unit.team === 'player' && !unit.dead);
    const focus = playerUnits.length ? playerUnits.reduce((sum, unit) => sum + unit.x, 0) / playerUnits.length : 0;
    cameraX += (clamp(focus - WORLD.width * .38, 0, Math.max(0, worldLength - WORLD.width)) - cameraX) * Math.min(1, dt * 4);
    effects = effects.map((effect) => effect.type === 'frontier' ? { ...effect, x: worldLength - 180 } : effect);
    renderStats();
  }

  function loop(time) { if (!running) return; const dt = Math.min(.05, (time - lastTime) / 1000 || 0); lastTime = time; update(dt); render(); animationFrame = requestAnimationFrame(loop); }

  function drawEarth() {
    const region = activeRegion();
    const gradient = canvasContext.createLinearGradient(cameraX, 0, cameraX, WORLD.height); gradient.addColorStop(0, region.sky); gradient.addColorStop(.62, region.terrain === 'desert' ? '#ead19d' : '#b9d8e4'); gradient.addColorStop(1, region.terrain === 'desert' ? '#bf9259' : '#6c9274'); canvasContext.fillStyle = gradient; canvasContext.fillRect(cameraX, 0, WORLD.width, WORLD.height);
    const firstChunk = Math.floor(cameraX / 460) * 460 - 460;
    const lastChunk = cameraX + WORLD.width + 460;
    for (let x = firstChunk; x < lastChunk; x += 460) {
      const seed = frontierSeed(x + currentRegionId.length * 13);
      canvasContext.fillStyle = region.terrain === 'desert' ? 'rgba(154,116,75,.32)' : 'rgba(58,102,93,.28)';
      canvasContext.beginPath(); canvasContext.moveTo(x, 285); canvasContext.quadraticCurveTo(x + 115, 190 + seed * 55, x + 240, 285); canvasContext.quadraticCurveTo(x + 350, 170 + frontierSeed(x + 3) * 70, x + 460, 285); canvasContext.lineTo(x + 460, GROUND_Y); canvasContext.lineTo(x, GROUND_Y); canvasContext.closePath(); canvasContext.fill();
      canvasContext.fillStyle = region.terrain === 'desert' ? '#d4ad72' : region.land;
      canvasContext.fillRect(x, GROUND_Y, 460, WORLD.height - GROUND_Y);
      canvasContext.strokeStyle = region.terrain === 'desert' ? 'rgba(255,225,163,.32)' : 'rgba(211,242,199,.42)'; canvasContext.lineWidth = 2; canvasContext.beginPath(); canvasContext.moveTo(x, GROUND_Y); canvasContext.lineTo(x + 460, GROUND_Y); canvasContext.stroke();
      canvasContext.fillStyle = region.accent;
      if (region.terrain === 'desert') {
        canvasContext.beginPath(); canvasContext.moveTo(x + 75, GROUND_Y); canvasContext.lineTo(x + 145, 300 + seed * 35); canvasContext.lineTo(x + 220, GROUND_Y); canvasContext.fill();
        canvasContext.beginPath(); canvasContext.arc(x + 330, 335, 18 + seed * 11, 0, Math.PI * 2); canvasContext.fill();
      } else if (region.terrain === 'fjord') {
        canvasContext.beginPath(); canvasContext.moveTo(x + 35, GROUND_Y); canvasContext.lineTo(x + 120, 240 - seed * 50); canvasContext.lineTo(x + 185, GROUND_Y); canvasContext.lineTo(x + 285, 215 - frontierSeed(x + 8) * 45); canvasContext.lineTo(x + 390, GROUND_Y); canvasContext.fill();
        canvasContext.fillStyle = '#e4eef6'; canvasContext.beginPath(); canvasContext.moveTo(x + 120, 240 - seed * 50); canvasContext.lineTo(x + 139, 281); canvasContext.lineTo(x + 155, 255); canvasContext.lineTo(x + 185, GROUND_Y); canvasContext.fill();
      } else if (region.terrain === 'rainforest') {
        for (let tree = 0; tree < 4; tree += 1) { const tx = x + 42 + tree * 102 + frontierSeed(x + tree * 11) * 28; canvasContext.fillRect(tx, GROUND_Y - 58 - tree * 4, 7, 58 + tree * 4); canvasContext.beginPath(); canvasContext.arc(tx + 3, GROUND_Y - 70 - tree * 4, 24, 0, Math.PI * 2); canvasContext.fill(); }
      } else {
        for (let hill = 0; hill < 3; hill += 1) { const hx = x + 58 + hill * 145; canvasContext.beginPath(); canvasContext.arc(hx, GROUND_Y - 7, 30 + frontierSeed(x + hill * 19) * 16, Math.PI, 0); canvasContext.fill(); }
      }
      canvasContext.fillStyle = 'rgba(255,255,255,.16)'; canvasContext.fillRect(x, 0, 1, GROUND_Y);
    }
    canvasContext.strokeStyle = 'rgba(255,255,255,.2)'; canvasContext.lineWidth = 1;
    for (let x = firstChunk; x < lastChunk; x += 48) { canvasContext.beginPath(); canvasContext.moveTo(x, 0); canvasContext.lineTo(x, 42); canvasContext.stroke(); }
    if (cameraX < 240) {
      canvasContext.font = '600 12px Arial'; canvasContext.textAlign = 'center';
      for (const country of REGIONS) { canvasContext.fillStyle = country.id === currentRegionId ? '#172b59' : 'rgba(23,43,89,.6)'; canvasContext.beginPath(); canvasContext.arc(country.hotspot.x, country.hotspot.y, country.id === currentRegionId ? 10 : 7, 0, Math.PI * 2); canvasContext.fill(); if (country.id === currentRegionId) canvasContext.fillText(country.name.split('·')[0].replace(/[🇨🇳🇯🇵🇪🇬🇧🇷🇳🇴]/g, ''), country.hotspot.x, country.hotspot.y - 14); }
      canvasContext.textAlign = 'start';
    }
  }

  function drawCastle(x, y, color, flip = false) {
    canvasContext.save(); canvasContext.translate(x, y); if (flip) canvasContext.scale(-1, 1); canvasContext.fillStyle = 'rgba(20,34,49,.2)'; canvasContext.beginPath(); canvasContext.ellipse(36, 73, 58, 9, 0, 0, Math.PI * 2); canvasContext.fill(); canvasContext.fillStyle = color; canvasContext.fillRect(0, 18, 72, 52); canvasContext.fillRect(8, 0, 17, 38); canvasContext.fillRect(47, 0, 17, 38); canvasContext.fillStyle = '#f9f2dd'; canvasContext.fillRect(29, 42, 14, 28); canvasContext.fillStyle = color; canvasContext.fillRect(5, 0, 23, 8); canvasContext.fillRect(44, 0, 23, 8); canvasContext.fillStyle = 'rgba(255,255,255,.5)'; canvasContext.fillRect(7, 25, 58, 4); canvasContext.restore();
  }

  function drawWeapon(unit, pose) {
    const direction = unit.facing || (unit.team === 'enemy' ? -1 : 1);
    const hand = pose.rightArm;
    const type = unitType(unit);
    canvasContext.save(); canvasContext.strokeStyle = '#26354a'; canvasContext.fillStyle = '#26354a'; canvasContext.lineCap = 'round'; canvasContext.lineJoin = 'round';
    if (type.weapon === 'bow') {
      const bowX = hand.x + direction * 3; const bowY = hand.y - 1; canvasContext.strokeStyle = '#9b643c'; canvasContext.lineWidth = 2; canvasContext.beginPath(); canvasContext.arc(bowX, bowY, 10, -Math.PI * .72, Math.PI * .72, direction < 0); canvasContext.stroke(); canvasContext.strokeStyle = '#e9edf5'; canvasContext.beginPath(); canvasContext.moveTo(bowX - direction * 7, bowY - 7); canvasContext.lineTo(bowX + direction * 6, bowY); canvasContext.lineTo(bowX - direction * 7, bowY + 7); canvasContext.stroke(); canvasContext.strokeStyle = '#26354a'; canvasContext.lineWidth = 2.5; canvasContext.beginPath(); canvasContext.moveTo(bowX + direction * 4, bowY); canvasContext.lineTo(bowX + direction * 22, bowY); canvasContext.stroke();
    } else if (type.weapon === 'pickaxe') {
      const swing = pose.swing || 0; canvasContext.strokeStyle = '#8b5939'; canvasContext.lineWidth = 3; canvasContext.beginPath(); canvasContext.moveTo(hand.x, hand.y); canvasContext.lineTo(hand.x + direction * (12 + swing * 10), hand.y - 19 + swing * 22); canvasContext.stroke(); canvasContext.strokeStyle = '#536271'; canvasContext.lineWidth = 4; canvasContext.beginPath(); canvasContext.moveTo(hand.x + direction * (4 + swing * 8), hand.y - 18 + swing * 22); canvasContext.lineTo(hand.x + direction * (19 + swing * 8), hand.y - 10 + swing * 22); canvasContext.stroke();
    } else {
      const reach = clamp(Number(type.weaponReach) || 30, 22, 90) + (pose.swing || 0) * 10; const endX = hand.x + direction * reach; const endY = hand.y - 10 - (pose.swing || 0) * 12; canvasContext.strokeStyle = '#36485e'; canvasContext.lineWidth = 3; canvasContext.beginPath(); canvasContext.moveTo(hand.x, hand.y); canvasContext.lineTo(endX, endY); canvasContext.stroke(); canvasContext.strokeStyle = '#e6eefb'; canvasContext.lineWidth = 2; canvasContext.beginPath(); canvasContext.moveTo(endX, endY); canvasContext.lineTo(endX + direction * 8, endY - 4); canvasContext.stroke(); if (pose.swing > 0) { canvasContext.strokeStyle = unit.team === 'enemy' ? 'rgba(239,107,115,.75)' : 'rgba(100,165,255,.8)'; canvasContext.lineWidth = 3; canvasContext.beginPath(); canvasContext.arc(0, -4, Math.max(25, Number(type.weaponReach) || 30) + pose.swing * 10, direction < 0 ? Math.PI * .9 : -.1, direction < 0 ? Math.PI * 1.9 : Math.PI * 1.1); canvasContext.stroke(); }
    }
    canvasContext.restore();
  }

  function drawHandEffect(unit, pose) {
    if (!(pose.swing > 0)) return;
    const type = unitType(unit); const hand = pose.rightArm; const direction = unit.facing || (unit.team === 'enemy' ? -1 : 1); const alpha = clamp(pose.swing * 1.35, 0, 1);
    canvasContext.save(); canvasContext.globalCompositeOperation = 'lighter'; canvasContext.globalAlpha = alpha; canvasContext.translate(hand.x, hand.y);
    if (handEffectType(type.weapon) === 'charge') {
      canvasContext.strokeStyle = type.color; canvasContext.lineWidth = 2; canvasContext.beginPath(); canvasContext.arc(0, 0, 7 + pose.swing * 5, 0, Math.PI * 2); canvasContext.stroke(); canvasContext.fillStyle = '#fff4c4'; canvasContext.beginPath(); canvasContext.arc(0, 0, 2 + pose.swing * 2, 0, Math.PI * 2); canvasContext.fill();
    } else if (handEffectType(type.weapon) === 'sparks') {
      canvasContext.strokeStyle = '#ffe49a'; canvasContext.lineWidth = 2; for (let index = 0; index < 5; index += 1) { const angle = -Math.PI * .8 + index * Math.PI * .4; const length = 7 + pose.swing * 8; canvasContext.beginPath(); canvasContext.moveTo(Math.cos(angle) * 3, Math.sin(angle) * 3); canvasContext.lineTo(Math.cos(angle) * length, Math.sin(angle) * length); canvasContext.stroke(); }
    } else {
      canvasContext.fillStyle = type.color; canvasContext.beginPath(); canvasContext.arc(0, 0, 4 + pose.swing * 4, 0, Math.PI * 2); canvasContext.fill(); canvasContext.strokeStyle = '#dcecff'; canvasContext.lineWidth = 2; canvasContext.beginPath(); canvasContext.moveTo(-direction * 4, 0); canvasContext.lineTo(-direction * (12 + pose.swing * 9), -pose.swing * 5); canvasContext.stroke();
    }
    canvasContext.restore();
  }

  function drawStickman(unit) {
    const type = unitType(unit); const color = unit.team === 'player' ? type.color : type.color || '#ef6b73'; const pose = stickmanPose(unit); canvasContext.save(); canvasContext.translate(unit.x, unit.y); canvasContext.strokeStyle = color; canvasContext.fillStyle = color; canvasContext.lineWidth = 4; canvasContext.lineCap = 'round';
    canvasContext.fillStyle = 'rgba(19,34,48,.2)'; canvasContext.beginPath(); canvasContext.ellipse(0, 31, 13, 4, 0, 0, Math.PI * 2); canvasContext.fill(); canvasContext.strokeStyle = color; canvasContext.fillStyle = color;
    canvasContext.beginPath(); canvasContext.arc(0, pose.headY, 8, 0, Math.PI * 2); canvasContext.fill(); canvasContext.beginPath(); canvasContext.moveTo(0, pose.torsoTopY); canvasContext.lineTo(0, pose.hipY); canvasContext.moveTo(0, pose.torsoTopY + 7); canvasContext.lineTo(pose.leftArm.x, pose.leftArm.y); canvasContext.moveTo(0, pose.torsoTopY + 7); canvasContext.lineTo(pose.rightArm.x, pose.rightArm.y); canvasContext.moveTo(0, pose.hipY); canvasContext.lineTo(pose.leftLeg.x, pose.leftLeg.y); canvasContext.moveTo(0, pose.hipY); canvasContext.lineTo(pose.rightLeg.x, pose.rightLeg.y); canvasContext.stroke();
    drawWeapon(unit, pose);
    drawHandEffect(unit, pose);
    if (type.kind === 'custom' && type.strokes?.length) { canvasContext.save(); canvasContext.globalAlpha = .92; canvasContext.strokeStyle = color; canvasContext.lineWidth = 2.5; canvasContext.rotate(type.weapon === 'sword' && pose.swing ? (unit.facing || 1) * pose.swing * .12 : 0); canvasContext.scale(.24, .24); canvasContext.translate(-110, -70); for (const stroke of type.strokes) { canvasContext.beginPath(); stroke.forEach((point, index) => index ? canvasContext.lineTo(point.x, point.y) : canvasContext.moveTo(point.x, point.y)); canvasContext.stroke(); } canvasContext.restore(); }
    canvasContext.restore();
    canvasContext.fillStyle = 'rgba(20,32,50,.2)'; canvasContext.fillRect(unit.x - 18, unit.y - 38, 36, 4); canvasContext.fillStyle = unit.hp / unit.maxHp > .5 ? '#2f9a83' : '#d85f65'; canvasContext.fillRect(unit.x - 18, unit.y - 38, 36 * clamp(unit.hp / unit.maxHp, 0, 1), 4);
  }

  function render() {
    const shakeX = effects.some((effect) => effect.type === 'impact' && effect.life > .25) ? (Math.random() - .5) * 4 : 0;
    canvasContext.save(); canvasContext.translate(-cameraX + shakeX, 0); drawEarth(); drawCastle(20, GROUND_Y - 70, '#3b5f9f'); drawCastle(worldLength - 92, GROUND_Y - 70, '#a9525b', true);
    for (const node of resourceNodes) { if (node.amount <= 0) continue; canvasContext.fillStyle = '#e6a93b'; canvasContext.beginPath(); canvasContext.arc(node.x, node.y, 9, 0, Math.PI * 2); canvasContext.fill(); canvasContext.fillStyle = '#fff1b9'; canvasContext.beginPath(); canvasContext.arc(node.x - 3, node.y - 3, 3, 0, Math.PI * 2); canvasContext.fill(); }
    for (const obstacle of obstacles) { canvasContext.fillStyle = obstacle.kind === 'desert' ? '#9f7148' : '#6f625e'; canvasContext.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height); canvasContext.fillStyle = obstacle.kind === 'fjord' ? '#d8e5ed' : '#b39a78'; canvasContext.fillRect(obstacle.x + 8, obstacle.y - 5, obstacle.width - 16, 8); }
    for (const projectile of projectiles) { canvasContext.strokeStyle = projectile.color; canvasContext.lineWidth = 2; canvasContext.beginPath(); canvasContext.moveTo(projectile.x, projectile.y); canvasContext.lineTo(projectile.x - 12, projectile.y); canvasContext.stroke(); canvasContext.fillStyle = '#26354a'; canvasContext.beginPath(); canvasContext.moveTo(projectile.x + 5, projectile.y); canvasContext.lineTo(projectile.x - 2, projectile.y - 4); canvasContext.lineTo(projectile.x - 2, projectile.y + 4); canvasContext.closePath(); canvasContext.fill(); }
    for (const effect of effects) { const maxLife = Math.max(.01, effect.maxLife || .3); const progress = 1 - effect.life / maxLife; canvasContext.globalAlpha = clamp(effect.life / maxLife, 0, 1); if (effect.type === 'slash') { canvasContext.strokeStyle = effect.color; canvasContext.lineWidth = 5; canvasContext.beginPath(); canvasContext.arc(effect.x, effect.y, 18 + progress * 20, effect.direction < 0 ? Math.PI * .15 : Math.PI * .85, effect.direction < 0 ? Math.PI * .85 : Math.PI * 1.85); canvasContext.stroke(); } else if (effect.type === 'frontier') { canvasContext.strokeStyle = effect.color; canvasContext.lineWidth = 3; canvasContext.beginPath(); canvasContext.arc(effect.x, effect.y, 30 + progress * 40, 0, Math.PI * 2); canvasContext.stroke(); } else { canvasContext.fillStyle = effect.color; canvasContext.beginPath(); canvasContext.arc(effect.x, effect.y, effect.type === 'spark' ? 5 + progress * 8 : 7 + progress * 16, 0, Math.PI * 2); canvasContext.fill(); } canvasContext.globalAlpha = 1; }
    for (const unit of units) drawStickman(unit);
    canvasContext.restore();
    canvasContext.fillStyle = 'rgba(255,255,255,.82)'; canvasContext.fillRect(12, 12, 936, 30); canvasContext.fillStyle = '#1d304d'; canvasContext.font = '600 14px Arial'; canvasContext.fillText(`${activeRegion().name} · 第 ${wave} 波`, 24, 32); canvasContext.fillText(mode === 'region' ? '点击国家标记切换景色' : `无尽地图 · 已推进 ${Math.max(0, Math.round(cameraX))}m · 武器自动战斗`, 650, 32);
  }

  function renderStats() { resourceEl.textContent = `资源 ${resources}`; unitCountEl.textContent = `我方 ${units.filter((unit) => unit.team === 'player').length} · 敌方 ${units.filter((unit) => unit.team === 'enemy').length}`; }

  root.append(
    h('div', { class: 'bar battle__bar' }, h('strong', {}, '火柴人战斗'), h('span', { class: 'faint' }, '2D 无尽地球地图 · 自动战斗'), h('span', { class: 'battle__bar-spacer' }), regionSelect, countryBtn, resourceEl, unitCountEl, statusEl),
    h('div', { class: 'battle__layout' },
      h('section', { class: 'battle__main' }, canvas, h('div', { class: 'battle__controls' }, startBtn, resetBtn, teamSelect, obstacleBtn)),
      h('aside', { class: 'battle__sidebar' },
        h('section', { class: 'card battle__card' }, h('h3', {}, '我方兵种'), h('p', { class: 'faint' }, '默认兵种可直接部署；手绘兵种保存后可重复使用。'), paletteEl),
        h('section', { class: 'card battle__card' }, h('h3', {}, '敌方模板'), h('p', { class: 'faint' }, '敌方会自动放置，也可切换为敌方部署。'), enemyPaletteEl),
        h('section', { class: 'card battle__card battle__draw-card' }, h('h3', {}, '手绘一个兵种'), drawPad, h('div', { class: 'battle__draw-actions' }, customName, saveCustomBtn), customHint),
        h('div', { class: 'battle__rules' }, h('strong', {}, '玩法'), h('span', {}, '① 点击兵种后在我方半场放置'), h('span', {}, '② 切换“放置障碍”点击地图'), h('span', {}, '③ 自动采集资源，武器决定攻击动作'), h('span', {}, '④ 敌方据点清空后自动生成下一片地图，无尽推进')),
      ),
    ),
  );
  regionSelect.value = currentRegionId;
  drawPadBackground(); renderPalette(); resetBattle();
  return { deactivate: () => { running = false; cancelAnimationFrame(animationFrame); }, activate: startBattle };
}
