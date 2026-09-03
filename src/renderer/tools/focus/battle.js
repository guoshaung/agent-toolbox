import { h, toast } from '../../core/ui.js';

const WORLD = { width: 960, height: 500 };
const ENEMY_TYPES = [
  { id: 'raider', name: '突击兵', hp: 72, speed: 34, damage: 12, range: 24, color: '#ef6b73' },
  { id: 'ranger', name: '远程兵', hp: 48, speed: 25, damage: 8, range: 100, color: '#f2bd5d' },
  { id: 'harvester', name: '采集兵', hp: 58, speed: 28, damage: 5, range: 22, color: '#c28be8' },
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
  let drawing = false;
  let currentStroke = null;
  let customTypes = config.get('focus.battle.customTypes', []) || [];
  let customStrokes = [];
  let currentRegionId = config.get('focus.battle.region', 'china');

  const unitTypes = () => [{ id: 'default', name: '默认火柴人', hp: 90, speed: 34, damage: 14, range: 25, color: '#3d6fe8', kind: 'default' }, ...customTypes.map((item) => ({ ...item, kind: 'custom' }))];

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
  drawPad.addEventListener('pointerup', () => { if (!drawing) return; drawing = false; if (currentStroke.length > 1) customStrokes.push(currentStroke); currentStroke = null; drawPadBackground(); });

  function saveCustomUnit() {
    if (!customStrokes.length) return toast('先在绘制区画出一个兵种轮廓', 'info');
    const name = customName.value.trim() || `手绘兵种 ${customTypes.length + 1}`;
    const item = { id: `custom-${Date.now()}`, name, strokes: customStrokes, hp: 75, speed: 30, damage: 16, range: 27, color: '#7c5ac8' };
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
    return { id: `unit-${Date.now()}-${Math.random().toString(16).slice(2)}`, team, typeId: type.id, x, y, hp: type.hp, maxHp: type.hp, cooldown: Math.random() * .5, carry: 0, targetResource: null, dead: false };
  }

  function activeRegion() { return REGIONS.find((region) => region.id === currentRegionId) || REGIONS[0]; }
  function starterObstacles() { return activeRegion().obstacles.map((obstacle) => ({ ...obstacle })); }
  function starterResources() { return activeRegion().resources.map((resource) => ({ ...resource })); }

  let resourceNodes = starterResources();

  function selectRegion(id) {
    if (!REGIONS.some((region) => region.id === id)) return;
    currentRegionId = id; config.set('focus.battle.region', id); regionSelect.value = id; resetBattle(); setMode('region');
  }

  function resetBattle() {
    running = false; cancelAnimationFrame(animationFrame); animationFrame = 0; lastTime = 0; resources = 0; effects = []; obstacles = starterObstacles(); resourceNodes = starterResources();
    units = ENEMY_TYPES.map((type, index) => makeUnit('enemy', type, 820, 150 + index * 105));
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
    return { x: clamp((event.clientX - rect.left) * WORLD.width / rect.width, 0, WORLD.width), y: clamp((event.clientY - rect.top) * WORLD.height / rect.height, 0, WORLD.height) };
  }

  canvas.addEventListener('pointerdown', (event) => {
    const point = canvasPoint(event);
    if (mode === 'region') {
      const selectedRegion = REGIONS.find((region) => distance(point, region.hotspot) < 34);
      if (selectedRegion) selectRegion(selectedRegion.id);
      return;
    }
    if (mode === 'obstacle') { obstacles.push({ x: clamp(point.x - 24, 20, WORLD.width - 68), y: clamp(point.y - 15, 55, WORLD.height - 55), width: 48, height: 30 }); render(); return; }
    const type = deployTeam === 'player' ? unitTypes().find((item) => item.id === selectedTypeId) : ENEMY_TYPES.find((item) => item.id === selectedTypeId);
    if (!type) return;
    const allowed = deployTeam === 'player' ? point.x < WORLD.width / 2 - 30 : point.x > WORLD.width / 2 + 30;
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
    unit.x = clamp(nextX, 22, WORLD.width - 22); unit.y = clamp(nextY, 70, WORLD.height - 32);
  }
  function unitType(unit) { return unit.team === 'enemy' ? ENEMY_TYPES.find((type) => type.id === unit.typeId) || ENEMY_TYPES[0] : unitTypes().find((type) => type.id === unit.typeId) || unitTypes()[0]; }

  function update(dt) {
    for (const unit of units) {
      if (unit.dead) continue;
      const type = unitType(unit); unit.cooldown -= dt;
      const enemy = nearestEnemy(unit); const enemyDistance = enemy ? distance(unit, enemy) : Infinity;
      if (enemy && enemyDistance <= type.range + 8) {
        if (unit.cooldown <= 0) { enemy.hp -= type.damage; unit.cooldown = unit.team === 'enemy' ? .85 : .7; effects.push({ x: enemy.x, y: enemy.y, life: .3, color: type.color }); if (enemy.hp <= 0) enemy.dead = true; }
      } else if (enemy && enemyDistance < 250) moveUnit(unit, enemy, dt);
      else if (unit.carry < 3) {
        const resource = nearestResource(unit); if (resource) { if (distance(unit, resource) < 22) { resource.amount -= 1; unit.carry += 1; resources += 1; } else moveUnit(unit, resource, dt); }
      } else {
        const castle = unit.team === 'player' ? { x: WORLD.width - 55, y: WORLD.height / 2 } : { x: 55, y: WORLD.height / 2 };
        if (distance(unit, castle) < 34) { resources += unit.team === 'player' ? unit.carry : 0; unit.carry = 0; moveUnit(unit, { x: castle.x + (unit.team === 'player' ? 40 : -40), y: castle.y }, dt); } else moveUnit(unit, castle, dt);
      }
    }
    units = units.filter((unit) => !unit.dead);
    effects = effects.map((effect) => ({ ...effect, life: effect.life - dt })).filter((effect) => effect.life > 0);
    if (!units.some((unit) => unit.team === 'enemy')) { running = false; statusEl.textContent = '胜利：敌方兵种已清空'; startBtn.textContent = '开始自动战斗'; toast('地球关卡胜利！', 'good'); }
    if (!units.some((unit) => unit.team === 'player')) statusEl.textContent = '自动战斗已启动 · 等待部署我方兵种';
    renderStats();
  }

  function loop(time) { if (!running) return; const dt = Math.min(.05, (time - lastTime) / 1000 || 0); lastTime = time; update(dt); render(); animationFrame = requestAnimationFrame(loop); }

  function drawEarth() {
    const region = activeRegion();
    const gradient = canvasContext.createLinearGradient(0, 0, 0, WORLD.height); gradient.addColorStop(0, region.sky); gradient.addColorStop(1, region.terrain === 'desert' ? '#d9bd84' : '#a8cde0'); canvasContext.fillStyle = gradient; canvasContext.fillRect(0, 0, WORLD.width, WORLD.height);
    canvasContext.strokeStyle = 'rgba(255,255,255,.22)'; canvasContext.lineWidth = 1;
    for (let x = 0; x < WORLD.width; x += 48) { canvasContext.beginPath(); canvasContext.moveTo(x, 0); canvasContext.lineTo(x, WORLD.height); canvasContext.stroke(); }
    for (let y = 0; y < WORLD.height; y += 48) { canvasContext.beginPath(); canvasContext.moveTo(0, y); canvasContext.lineTo(WORLD.width, y); canvasContext.stroke(); }
    canvasContext.fillStyle = region.land; canvasContext.beginPath(); canvasContext.arc(480, 250, 178, 0, Math.PI * 2); canvasContext.fill();
    canvasContext.fillStyle = region.accent;
    if (region.terrain === 'desert') { canvasContext.beginPath(); canvasContext.ellipse(425, 230, 105, 45, -.2, 0, Math.PI * 2); canvasContext.fill(); canvasContext.beginPath(); canvasContext.ellipse(565, 305, 85, 36, .2, 0, Math.PI * 2); canvasContext.fill(); }
    else if (region.terrain === 'island') { canvasContext.beginPath(); canvasContext.ellipse(420, 210, 52, 25, -.4, 0, Math.PI * 2); canvasContext.fill(); canvasContext.beginPath(); canvasContext.ellipse(540, 285, 38, 72, .25, 0, Math.PI * 2); canvasContext.fill(); canvasContext.beginPath(); canvasContext.ellipse(600, 185, 20, 42, .1, 0, Math.PI * 2); canvasContext.fill(); }
    else if (region.terrain === 'rainforest') { canvasContext.beginPath(); canvasContext.ellipse(420, 220, 105, 52, -.3, 0, Math.PI * 2); canvasContext.fill(); canvasContext.beginPath(); canvasContext.ellipse(550, 300, 95, 58, .25, 0, Math.PI * 2); canvasContext.fill(); canvasContext.strokeStyle = '#78b8cb'; canvasContext.lineWidth = 10; canvasContext.beginPath(); canvasContext.moveTo(525, 105); canvasContext.bezierCurveTo(470, 210, 560, 285, 430, 400); canvasContext.stroke(); }
    else if (region.terrain === 'fjord') { canvasContext.beginPath(); canvasContext.moveTo(330, 345); canvasContext.lineTo(405, 180); canvasContext.lineTo(465, 300); canvasContext.lineTo(535, 130); canvasContext.lineTo(640, 350); canvasContext.closePath(); canvasContext.fill(); canvasContext.fillStyle = '#dce8f4'; canvasContext.beginPath(); canvasContext.moveTo(405, 180); canvasContext.lineTo(430, 235); canvasContext.lineTo(465, 300); canvasContext.lineTo(535, 130); canvasContext.lineTo(555, 200); canvasContext.lineTo(535, 130); canvasContext.closePath(); canvasContext.fill(); }
    else { canvasContext.beginPath(); canvasContext.ellipse(420, 220, 90, 45, -.3, 0, Math.PI * 2); canvasContext.fill(); canvasContext.beginPath(); canvasContext.ellipse(550, 290, 78, 50, .25, 0, Math.PI * 2); canvasContext.fill(); }
    canvasContext.strokeStyle = 'rgba(255,255,255,.5)'; canvasContext.lineWidth = 3; canvasContext.beginPath(); canvasContext.arc(480, 250, 178, 0, Math.PI * 2); canvasContext.stroke();
    canvasContext.font = '600 12px Arial'; canvasContext.textAlign = 'center';
    for (const country of REGIONS) { canvasContext.fillStyle = country.id === currentRegionId ? '#172b59' : 'rgba(23,43,89,.6)'; canvasContext.beginPath(); canvasContext.arc(country.hotspot.x, country.hotspot.y, country.id === currentRegionId ? 10 : 7, 0, Math.PI * 2); canvasContext.fill(); canvasContext.fillText(country.id === currentRegionId ? country.name.split('·')[0].replace(/[🇨🇳🇯🇵🇪🇬🇧🇷🇳🇴]/g, '') : '', country.hotspot.x, country.hotspot.y - 14); }
    canvasContext.textAlign = 'start';
  }

  function drawCastle(x, y, color, flip = false) {
    canvasContext.save(); canvasContext.translate(x, y); if (flip) canvasContext.scale(-1, 1); canvasContext.fillStyle = color; canvasContext.fillRect(0, 18, 72, 52); canvasContext.fillRect(8, 0, 17, 38); canvasContext.fillRect(47, 0, 17, 38); canvasContext.fillStyle = '#fff'; canvasContext.fillRect(29, 42, 14, 28); canvasContext.fillStyle = color; canvasContext.fillRect(5, 0, 23, 8); canvasContext.fillRect(44, 0, 23, 8); canvasContext.restore();
  }

  function drawStickman(unit) {
    const type = unitType(unit); const color = unit.team === 'player' ? type.color : type.color || '#ef6b73'; canvasContext.save(); canvasContext.translate(unit.x, unit.y); canvasContext.strokeStyle = color; canvasContext.fillStyle = color; canvasContext.lineWidth = 4; canvasContext.lineCap = 'round';
    canvasContext.beginPath(); canvasContext.arc(0, -18, 8, 0, Math.PI * 2); canvasContext.fill(); canvasContext.beginPath(); canvasContext.moveTo(0, -9); canvasContext.lineTo(0, 14); canvasContext.moveTo(0, -2); canvasContext.lineTo(-12, 7); canvasContext.moveTo(0, -2); canvasContext.lineTo(12, 7); canvasContext.moveTo(0, 14); canvasContext.lineTo(-10, 28); canvasContext.moveTo(0, 14); canvasContext.lineTo(10, 28); canvasContext.stroke();
    if (type.kind === 'custom' && type.strokes?.length) { canvasContext.strokeStyle = '#fff'; canvasContext.lineWidth = 2; canvasContext.scale(.22, .22); canvasContext.translate(-110, -70); for (const stroke of type.strokes) { canvasContext.beginPath(); stroke.forEach((point, index) => index ? canvasContext.lineTo(point.x, point.y) : canvasContext.moveTo(point.x, point.y)); canvasContext.stroke(); } }
    canvasContext.restore();
    canvasContext.fillStyle = 'rgba(20,32,50,.2)'; canvasContext.fillRect(unit.x - 18, unit.y - 38, 36, 4); canvasContext.fillStyle = unit.hp / unit.maxHp > .5 ? '#2f9a83' : '#d85f65'; canvasContext.fillRect(unit.x - 18, unit.y - 38, 36 * clamp(unit.hp / unit.maxHp, 0, 1), 4);
  }

  function render() {
    drawEarth(); drawCastle(20, 210, '#3b5f9f'); drawCastle(WORLD.width - 92, 210, '#a9525b', true);
    canvasContext.fillStyle = 'rgba(255,255,255,.78)'; canvasContext.fillRect(12, 12, 936, 30); canvasContext.fillStyle = '#1d304d'; canvasContext.font = '600 14px Arial'; canvasContext.fillText(activeRegion().name, 24, 32); canvasContext.fillText(mode === 'region' ? '点击地球上的国家色块切换景色' : '自动战斗 · 不限购买 · 资源从地图采集', 650, 32);
    for (const node of resourceNodes) { if (node.amount <= 0) continue; canvasContext.fillStyle = '#e6a93b'; canvasContext.beginPath(); canvasContext.arc(node.x, node.y, 9, 0, Math.PI * 2); canvasContext.fill(); canvasContext.fillStyle = '#fff1b9'; canvasContext.beginPath(); canvasContext.arc(node.x - 3, node.y - 3, 3, 0, Math.PI * 2); canvasContext.fill(); }
    for (const obstacle of obstacles) { canvasContext.fillStyle = '#7e6b61'; canvasContext.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height); canvasContext.fillStyle = '#a99379'; canvasContext.fillRect(obstacle.x + 8, obstacle.y - 5, obstacle.width - 16, 8); }
    for (const effect of effects) { canvasContext.globalAlpha = effect.life / .3; canvasContext.fillStyle = effect.color; canvasContext.beginPath(); canvasContext.arc(effect.x, effect.y, 14 * (1 - effect.life / .3), 0, Math.PI * 2); canvasContext.fill(); canvasContext.globalAlpha = 1; }
    for (const unit of units) drawStickman(unit);
  }

  function renderStats() { resourceEl.textContent = `资源 ${resources}`; unitCountEl.textContent = `我方 ${units.filter((unit) => unit.team === 'player').length} · 敌方 ${units.filter((unit) => unit.team === 'enemy').length}`; }

  root.append(
    h('div', { class: 'bar battle__bar' }, h('strong', {}, '火柴人战斗'), h('span', { class: 'faint' }, '2D 地球地图 · 自动战斗'), h('span', { class: 'battle__bar-spacer' }), regionSelect, countryBtn, resourceEl, unitCountEl, statusEl),
    h('div', { class: 'battle__layout' },
      h('section', { class: 'battle__main' }, canvas, h('div', { class: 'battle__controls' }, startBtn, resetBtn, teamSelect, obstacleBtn)),
      h('aside', { class: 'battle__sidebar' },
        h('section', { class: 'card battle__card' }, h('h3', {}, '我方兵种'), h('p', { class: 'faint' }, '默认兵种可直接部署；手绘兵种保存后可重复使用。'), paletteEl),
        h('section', { class: 'card battle__card' }, h('h3', {}, '敌方模板'), h('p', { class: 'faint' }, '敌方会自动放置，也可切换为敌方部署。'), enemyPaletteEl),
        h('section', { class: 'card battle__card battle__draw-card' }, h('h3', {}, '手绘一个兵种'), drawPad, h('div', { class: 'battle__draw-actions' }, customName, saveCustomBtn), customHint),
        h('div', { class: 'battle__rules' }, h('strong', {}, '玩法'), h('span', {}, '① 点击兵种后在我方半场放置'), h('span', {}, '② 切换“放置障碍”点击地图'), h('span', {}, '③ 开始后兵种自动采集资源并战斗'), h('span', {}, '④ 不限制购买数量，资源只用于地图采集记录')),
      ),
    ),
  );
  regionSelect.value = currentRegionId;
  drawPadBackground(); renderPalette(); resetBattle();
  return { deactivate: () => { running = false; cancelAnimationFrame(animationFrame); }, activate: startBattle };
}
