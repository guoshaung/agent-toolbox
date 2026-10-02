'use strict';

const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const feature = path.resolve(__dirname, '../src/renderer/features/E024');
const modelPromise = import(pathToFileURL(path.join(feature, 'model.mjs')).href);
const wordsPromise = import(pathToFileURL(path.join(feature, 'words.mjs')).href);
const drawingPromise = import(pathToFileURL(path.join(feature, 'drawing.mjs')).href);
const OPTIONS = { players: ['小明', '小红'], roundsPerPlayer: 1, durationSeconds: 60, seed: 'demo' };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('forty original words and normalized aliases are unique and match only their owning word', async () => {
  const { WORDS, normalizeAnswer, matchesWord } = await wordsPromise; assert.equal(WORDS.length, 40);
  const labels = []; for (const word of WORDS) { assert.equal(Object.isFrozen(word), true); for (const label of [word.target, ...word.aliases]) { labels.push(normalizeAnswer(label)); assert.equal(matchesWord(word, label), true); } }
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(matchesWord(WORDS.find((w) => w.target === '自行车'), ' 单 车 '), true);
  assert.equal(matchesWord(WORDS.find((w) => w.target === '汤圆'), '元宵'), false);
  assert.equal(matchesWord(WORDS.find((w) => w.target === '手机'), '手机壳'), false);
  for (const text of ['', ' '.repeat(4), 'a'.repeat(33), 'x\ny', null]) assert.throws(() => normalizeAnswer(text), RangeError);
});

test('players, names, total rounds, time and seed have explicit bounds', async () => {
  const { validateOptions } = await modelPromise;
  for (const change of [{ players: ['A'] }, { players: ['A', 'B', 'C', 'D', 'E'] }, { players: ['A', 'A'] }, { players: ['', 'B'] }, { players: ['a'.repeat(21), 'B'] }, { roundsPerPlayer: 0 }, { roundsPerPlayer: 3 }, { roundsPerPlayer: 1.5 }, { durationSeconds: 29 }, { durationSeconds: 181 }, { seed: 'bad seed' }]) assert.throws(() => validateOptions({ ...OPTIONS, ...change }), RangeError);
  assert.deepEqual(validateOptions({ ...OPTIONS, players: [' A ', ' B '] }).players, ['A', 'B']);
});

test('private three-word selection is reproducible and disappears completely when drawing starts', async () => {
  const { DrawGuess, wordDeck } = await modelPromise;
  assert.deepEqual(wordDeck('demo').slice(0, 6).map((w) => w.target), ['冰淇淋', '手机', '面包', '菠萝', '西瓜', '星星']);
  const game = new DrawGuess(OPTIONS); assert.deepEqual(game.getView().choices, []); assert.equal(game.startDrawing(), false); game.revealChoices();
  assert.equal(game.getView().choices.length, 3); assert.equal(game.startDrawing(), false); assert.equal(game.selectWord('W999'), false);
  game.selectWord('W037'); assert.equal(game.getView().selectedId, 'W037'); game.startDrawing();
  assert.deepEqual(game.getView().choices, []); assert.equal(game.getView().selectedId, null); assert.equal(JSON.stringify(game.getView()).includes('手机'), false);
});

test('two players complete two rounds with an alias and canonical answer, each drawing once and both scoring two', async () => {
  const { DrawGuess } = await modelPromise; const game = new DrawGuess(OPTIONS);
  game.revealChoices(); game.selectWord('W037'); game.startDrawing(); assert.deepEqual(game.guess(1, '移动电话', 1), { ok: true, correct: true });
  assert.equal(game.getView().drawerIndex, 1); assert.equal(game.getView().phase, 'handoff'); game.revealChoices(); game.selectWord('W026'); game.startDrawing();
  assert.equal(game.guess(0, '菠萝', 2).correct, true); const result = game.result(); assert.deepEqual(result.scores, [2, 2]);
  assert.deepEqual(result.rounds.map((r) => r.drawerIndex), [0, 1]); assert.deepEqual(result.ranking.map((r) => r.rank), [1, 1]); assert.equal(result.rounds.length, 2);
  assert.equal(game.guess(0, '菠萝', 2).ok, false);
});

test('four players and two cycles produce eight rounds and never repeat private candidate words', async () => {
  const { DrawGuess } = await modelPromise; const game = new DrawGuess({ ...OPTIONS, players: ['A', 'B', 'C', 'D'], roundsPerPlayer: 2 }); const seen = [];
  for (let i = 0; i < 8; i++) {
    assert.equal(game.getView().drawerIndex, i % 4); game.revealChoices(); const choices = game.getView().choices; seen.push(...choices.map((w) => w.id));
    game.selectWord(choices[0].id); game.startDrawing(); game.endRound(i + 1);
  }
  assert.equal(new Set(seen).size, 24); assert.equal(game.result().rounds.length, 8); assert.equal(game.revealChoices(), false);
});

test('wrong and invalid guesses never reveal the answer; player identity, cooldown and record limit are enforced', async () => {
  const { DrawGuess } = await modelPromise; let now = 0; const game = new DrawGuess(OPTIONS, { now: () => now }); game.revealChoices(); game.selectWord('W037'); game.startDrawing();
  assert.equal(game.guess(0, '手机', 1).reason, 'invalidPlayer'); assert.equal(game.guess(1, '', 1).reason, 'invalidText');
  assert.deepEqual(game.guess(1, '不是答案', 1), { ok: true, correct: false }); assert.equal(game.guess(1, '移动电话', 1).reason, 'cooldown');
  assert.equal(JSON.stringify(game.getView()).includes('手机'), false);
  for (let i = 1; i < 100; i++) { now += 300; assert.equal(game.guess(1, '不是答案', 1).ok, true); }
  now += 300; assert.equal(game.guess(1, '移动电话', 1).reason, 'guessLimit'); assert.equal(game.getView().guesses.length, 100); assert.deepEqual(game.getView().scores, [0, 0]);
});

test('sixty-second deadline ends the round before any late guess can score and starts the next role safely', async () => {
  const { DrawGuess } = await modelPromise; let now = 0; const game = new DrawGuess(OPTIONS, { now: () => now }); game.revealChoices(); game.selectWord('W037'); game.startDrawing();
  now = 60000; assert.equal(game.guess(1, '移动电话', 1).reason, 'notDrawing'); assert.deepEqual(game.getView().scores, [0, 0]);
  assert.equal(game.getView().lastRound.reason, 'timeout'); assert.equal(game.getView().lastRound.elapsedMs, 60000); assert.equal(game.getView().drawerIndex, 1);
  assert.deepEqual(game.getView().choices, []); assert.equal(game.getView().phase, 'handoff');
});

test('pause hides private choices and drawing, blocks completion, and excludes paused time', async () => {
  const { DrawGuess } = await modelPromise; let now = 0; const game = new DrawGuess(OPTIONS, { now: () => now }); game.revealChoices(); game.selectWord('W037'); game.pause();
  assert.equal(game.getView().phase, 'handoff'); assert.deepEqual(game.getView().choices, []); game.revealChoices(); game.startDrawing(); now = 2500; game.pause(); now += 90000;
  assert.equal(game.getView().remainingMs, 57500); assert.equal(game.endRound(1), false); assert.equal(game.guess(1, '手机', 1).ok, false);
  game.resume(); now += 1200; game.guess(1, '手机', 1); assert.equal(game.getView().lastRound.elapsedMs, 3700);
});

test('score persistence retains at most ten small summaries and strips drawings, secret words and guesses', async () => {
  const { cleanSummaries } = await modelPromise; const summary = { options: OPTIONS, scores: [2, 2], finishedAt: '2026-10-03T00:00:00.000Z', png: 'large', guesses: ['手机'] };
  const values = cleanSummaries(Array(20).fill(summary)); assert.equal(values.length, 10); assert.equal(values[0].png, undefined); assert.equal(values[0].guesses, undefined);
  assert.equal(cleanSummaries([{ ...summary, scores: [999, 0] }]).length, 0);
  assert.equal(cleanSummaries([{ ...summary, scores: [8, 8] }]).length, 0); assert.equal(cleanSummaries([{ ...summary, scores: [1, 0] }]).length, 0);
});

test('drawing coordinates clamp to canvas bounds and unsupported paints fail clearly', async () => {
  const { Sketch, COLORS } = await drawingPromise; const sketch = new Sketch();
  sketch.begin(-10, -20, COLORS[0], 5); sketch.add(1000, 1000); sketch.commit();
  assert.deepEqual(sketch.view()[0].points, [{ x: 0, y: 0 }, { x: 640, y: 400 }]);
  assert.throws(() => sketch.begin(NaN, 5, COLORS[0], 5), RangeError); assert.throws(() => sketch.begin(1, 2, 'pink', 5), RangeError); assert.throws(() => sketch.begin(1, 2, COLORS[0], 999), RangeError);
});

test('undo reverses strokes and clear, with a twenty-action history and immutable completed stroke data', async () => {
  const { Sketch, COLORS } = await drawingPromise; const sketch = new Sketch();
  sketch.begin(1, 2, COLORS[0], 5); sketch.commit(); assert.equal(Object.isFrozen(sketch.view()[0].points), true);
  sketch.clear(); assert.equal(sketch.view().length, 0); sketch.undo(); assert.equal(sketch.view().length, 1); sketch.undo(); assert.equal(sketch.view().length, 0);
  for (let i = 0; i < 30; i++) { sketch.begin(i, i, COLORS[0], 2); sketch.commit(); }
  assert.equal(sketch.stats().undo, 20); for (let i = 0; i < 20; i++) sketch.undo(); assert.equal(sketch.stats().strokes, 10); assert.equal(sketch.undo(), false);
});

test('stroke, points-per-stroke and total-point ceilings prevent unbounded drawing growth', async () => {
  const { Sketch, COLORS } = await drawingPromise; const dots = new Sketch(); for (let i = 0; i < 200; i++) { assert.equal(dots.begin(i, i, COLORS[0], 2), true); dots.commit(); }
  assert.equal(dots.begin(1, 2, COLORS[0], 2), false);
  const points = new Sketch(); for (let i = 0; i < 25; i++) { points.begin(i, i, COLORS[0], 2); for (let j = 1; j < 400; j++) assert.equal(points.add(j, i), true); assert.equal(points.add(1, 1), false); points.commit(); }
  assert.equal(points.stats().points, 10000); assert.equal(points.begin(1, 2, COLORS[0], 2), false); points.clear(); assert.equal(points.begin(1, 2, COLORS[0], 2), true);
});

test('album pixel dimensions remain below three million pixels for the complete eight-round limit', async () => {
  const { albumSize } = await drawingPromise;
  assert.deepEqual(albumSize(2), { columns: 2, width: 1340, height: 570 }); assert.deepEqual(albumSize(8), { columns: 2, width: 1340, height: 2010 });
  assert.ok(albumSize(8).width * albumSize(8).height < 3000000); for (const n of [1, 9, 2.5]) assert.throws(() => albumSize(n), RangeError);
});

class Context {
  constructor() { this.ink = []; this.path = []; this.operations = []; }
  fillRect(x, y, w, h) { if (x === 0 && y === 0) this.ink = []; this.operations.push(['fillRect', x, y, w, h]); }
  beginPath() { this.path = []; }
  moveTo(x, y) { this.path.push([x, y]); }
  lineTo(x, y) { this.path.push([x, y]); }
  arc(x, y, radius) { this.path.push([x, y, radius]); }
  fill() { this.ink.push({ color: this.fillStyle, points: [...this.path] }); }
  stroke() { this.ink.push({ color: this.strokeStyle, width: this.lineWidth, points: [...this.path] }); }
  fillText(...args) { this.operations.push(['fillText', ...args]); }
  drawImage(image, ...args) { this.operations.push(['drawImage', image.src, ...args]); }
}
class Element {
  constructor(tag, doc) { this.nodeType = 1; this.tagName = tag; this.doc = doc; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.events = new Map(); this.value = ''; this.disabled = false; this._text = ''; this.className = ''; this.context = tag === 'canvas' ? new Context() : null; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; }
  getAttribute(key) { return this.attributes[key]; }
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  replaceChildren(...items) { this.children.forEach((x) => { x.parent = null; }); this.children = []; this._text = ''; this.append(...items); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  addEventListener(type, listener) { const list = this.events.get(type) || []; list.push(listener); this.events.set(type, list); }
  focus() { this.doc.activeElement = this; this.emit('focus'); }
  emit(type, props = {}) {
    if (this.disabled && type === 'click') return;
    const event = { type, target: this, key: '', detail: 1, button: 0, pointerId: 1, clientX: 20, clientY: 30, preventDefault() { this.defaultPrevented = true; }, ...props };
    const chain = []; for (let node = this; node; node = node.parent) chain.push(node);
    for (const node of chain) for (const listener of node.events?.get(type) || []) listener(event);
    return event;
  }
  click() { if (this.tagName === 'a') this.doc.downloads.push({ name: this.getAttribute('download'), url: this.getAttribute('href') }); this.emit('click'); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map((x) => x.textContent).join(''); }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 320, height: 200 }; }
  setPointerCapture(id) { this.captured = id; }
  releasePointerCapture() { this.captured = null; }
  toDataURL(type) { this.doc.pngCaptures++; return `data:${type};base64,${Buffer.from(JSON.stringify(this.context.ink)).toString('base64')}`; }
  toBlob(callback, type) { this.doc.albums.push(this); callback(new Blob([JSON.stringify(this.context.operations)], { type })); }
}

async function mount(saved = null, { activate = true, failSave = false, toolbox = {} } = {}) {
  const modules = { ...await modelPromise, ...await drawingPromise };
  const doc = { activeElement: null, hidden: false, events: new Map(), downloads: [], albums: [], pngCaptures: 0, createElement(tag) { return new Element(tag, this); }, createTextNode(text) { return { nodeType: 3, textContent: String(text) }; }, addEventListener(type, listener) { this.events.set(type, listener); }, removeEventListener(type) { this.events.delete(type); } };
  doc.body = doc.createElement('body'); const root = doc.createElement('main'); doc.body.append(root);
  let now = 0; let id = 1; const intervals = new Map(); const timeouts = new Map(); const writes = []; const revoked = []; const blobs = [];
  const config = { get() { return saved; }, async set(_key, value) { if (failSave) throw new Error('storage unavailable'); writes.push(value); } };
  class FakeURL extends URL { static createObjectURL(blob) { blobs.push(blob); return `blob:E024-${id++}`; } static revokeObjectURL(url) { revoked.push(url); } }
  class FakeImage { set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); } get src() { return this._src; } }
  const context = vm.createContext({ document: doc, window: { toolbox }, Image: FakeImage, console, URL: FakeURL, Blob, Date, Math, Promise, performance: { now: () => now }, setInterval(fn) { const next = id++; intervals.set(next, fn); return next; }, clearInterval(next) { intervals.delete(next); }, setTimeout(fn) { const next = id++; timeouts.set(next, fn); return next; }, clearTimeout(next) { timeouts.delete(next); }, ...modules, module: { exports: {} } });
  vm.runInContext(fs.readFileSync(path.resolve(feature, '../../core/ui.js'), 'utf8').replace(/export /g, '') + '\nmodule.exports = { h };', context); context.h = context.module.exports.h;
  const source = fs.readFileSync(path.join(feature, 'index.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace('export default', 'module.exports =').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(path.join(feature, 'index.js')).href));
  vm.runInContext(source, context); const lifecycle = context.module.exports.create(root, { config });
  const all = (node = root) => [node, ...node.children.flatMap((x) => x.nodeType === 1 ? all(x) : [])];
  const button = (text) => all().find((e) => e.tagName === 'button' && e.textContent === text);
  const field = (label) => all().find((e) => e.getAttribute('aria-label') === label);
  const canvas = () => all().find((e) => e.tagName === 'canvas');
  function setup(options = OPTIONS) { field('玩家人数').value = String(options.players.length); options.players.forEach((p, i) => { field(`玩家 ${i + 1} 名称`).value = p; }); field('每人作画轮数').value = String(options.roundsPerPlayer); field('每轮秒数').value = String(options.durationSeconds); field('局号').value = options.seed; button('建立新局').click(); }
  if (activate) { lifecycle.activate(); setup(); }
  function start(word) { button('画者已独处，查看选词').click(); button(word).click(); button('隐藏词题，开始作画').click(); }
  function guess(text, playerIndex) { field('本轮猜测').value = text; field('本轮猜测').emit('input'); field('猜词玩家').value = String(playerIndex); button('提交猜测').click(); }
  return { doc, root, lifecycle, writes, all, button, field, canvas, setup, start, guess, intervals, timeouts, revoked, blobs, advance(ms, tick = true) { now += ms; if (tick) for (const fn of intervals.values()) fn(); } };
}
function line(ui, x = 170, y = 120) { const canvas = ui.canvas(); canvas.emit('pointerdown'); canvas.emit('pointermove', { clientX: x, clientY: y }); canvas.emit('pointerup'); }
function completePair(ui) { ui.start('手机'); line(ui); ui.guess('移动电话', 1); ui.start('菠萝'); line(ui, 260, 180); ui.guess('菠萝', 0); }

test('create remains inactive, private selection needs confirmation and drawing DOM has no current answer or aliases', async () => {
  const ui = await mount(null, { activate: false }); ui.button('画者已独处，查看选词').click(); assert.equal(ui.button('手机'), undefined); assert.equal(ui.intervals.size, 0);
  ui.lifecycle.activate(); ui.setup(); ui.button('画者已独处，查看选词').click(); assert.equal(ui.button('隐藏词题，开始作画').disabled, true);
  ui.button('手机').click(); assert.equal(ui.intervals.size, 0); ui.button('隐藏词题，开始作画').click();
  const dom = ui.all().map((e) => `${e.textContent} ${JSON.stringify(e.attributes)} ${JSON.stringify(e.dataset)}`).join('\n');
  assert.equal(dom.includes('手机'), false); assert.equal(dom.includes('移动电话'), false); assert.equal(dom.includes('W037'), false); assert.ok(ui.canvas()); assert.equal(ui.intervals.size, 1); ui.lifecycle.destroy();
});

test('actual pointer events scale canvas coordinates, use selected colors and widths, and preserve guess drafts on brush changes', async () => {
  const ui = await mount(); ui.start('手机'); ui.field('本轮猜测').value = '不是答案'; ui.field('本轮猜测').emit('input'); ui.button('蓝色').click();
  assert.equal(ui.field('本轮猜测').value, '不是答案'); ui.field('笔画粗细').value = '18'; ui.field('笔画粗细').emit('change'); line(ui);
  const ink = ui.canvas().context.ink; assert.equal(ink[0].color, '#306fd1'); assert.equal(ink[0].width, 18); assert.deepEqual(ink[0].points, [[20, 20], [320, 200]]);
  ui.lifecycle.destroy();
});

test('canvas clear and bounded undo restore the actual stroke drawing instead of only changing a counter', async () => {
  const ui = await mount(); ui.start('手机'); line(ui); assert.equal(ui.canvas().context.ink.length, 1);
  ui.button('清空').click(); assert.equal(ui.canvas().context.ink.length, 0); ui.button('撤销').click(); assert.equal(ui.canvas().context.ink.length, 1);
  ui.button('撤销').click(); assert.equal(ui.canvas().context.ink.length, 0); ui.lifecycle.destroy();
});

test('two-round UI alias/canonical game automatically rotates roles, captures distinct PNG drawings and saves one small summary', async () => {
  const ui = await mount(); completePair(ui); await flush(); assert.ok(ui.root.textContent.includes('全部轮次已完成'));
  assert.ok(ui.root.textContent.includes('第 1 名 · 小明 · 2 分')); assert.ok(ui.root.textContent.includes('第 1 名 · 小红 · 2 分'));
  const images = ui.all().filter((e) => e.tagName === 'img'); assert.equal(images.length, 2); assert.notEqual(images[0].getAttribute('src'), images[1].getAttribute('src'));
  assert.equal(ui.doc.pngCaptures, 2); assert.equal(ui.writes.length, 1); assert.deepEqual(ui.writes[0].recent[0].scores, [2, 2]); assert.equal(ui.writes[0].recent[0].rounds, undefined);
  assert.equal(ui.intervals.size, 0); ui.lifecycle.activate(); await flush(); assert.equal(ui.writes.length, 1); ui.lifecycle.destroy();
});

test('invalid player/text and wrong guesses cannot leak a correct answer, and invalid new settings preserve the drawing', async () => {
  const ui = await mount(); ui.start('手机'); line(ui); ui.guess('', 1); assert.ok(ui.root.textContent.includes('请输入 1–32'));
  ui.guess('移动电话', 0); assert.ok(ui.root.textContent.includes('画者不能猜自己的题')); ui.guess('不是答案', 1);
  assert.ok(ui.root.textContent.includes('尚未猜中')); assert.equal(ui.root.textContent.includes('手机'), false); assert.equal(ui.canvas().context.ink.length, 1);
  ui.setup({ ...OPTIONS, players: ['同名', '同名'] }); assert.ok(ui.root.textContent.includes('玩家名称须不同')); assert.equal(ui.canvas().context.ink.length, 1); ui.lifecycle.destroy();
});

test('pause freezes input and old pointer handlers; at deadline a late correct guess receives no score', async () => {
  const ui = await mount(); ui.start('手机'); const oldCanvas = ui.canvas(); line(ui); ui.advance(2500); ui.button('暂停').click(); assert.equal(ui.canvas(), undefined);
  oldCanvas.emit('pointerdown'); assert.equal(ui.intervals.size, 0); ui.advance(90000); ui.button('继续').click(); assert.equal(ui.canvas().context.ink.length, 1);
  ui.advance(57500, false); ui.guess('移动电话', 1); assert.ok(ui.root.textContent.includes('到时未猜中')); assert.equal(ui.canvas(), undefined);
  ui.start('菠萝'); ui.guess('菠萝', 0); await flush(); assert.deepEqual(ui.writes[0].recent[0].scores, [1, 1]); ui.lifecycle.destroy();
});

test('album composition calls canvas drawImage/toBlob for both captured drawings and downloads only a PNG Blob copy', async () => {
  const textCalls = []; const ui = await mount(null, { toolbox: { files: { saveTextSupportsCopyOnly: true, async saveText(args) { textCalls.push(args); return { ok: true }; } } } });
  completePair(ui); await flush(); ui.button('下载 PNG 画册副本').click(); await flush();
  assert.equal(textCalls.length, 0); assert.equal(ui.doc.albums.length, 1); const album = ui.doc.albums[0]; assert.equal(album.getAttribute('width'), '1340'); assert.equal(album.getAttribute('height'), '570');
  const paints = album.context.operations.filter((op) => op[0] === 'drawImage'); assert.equal(paints.length, 2); assert.notEqual(paints[0][1], paints[1][1]);
  assert.equal(ui.blobs[0].type, 'image/png'); assert.equal(ui.doc.downloads.length, 1); assert.match(ui.doc.downloads[0].name, /\.png$/); assert.ok(ui.root.textContent.includes('下载请求'));
  ui.lifecycle.destroy(); assert.equal(ui.timeouts.size, 0); assert.equal(ui.revoked.length, 1);
});

test('JSON metadata uses strict copyOnly, includes drawing dimensions without embedded PNGs, and reports canceled save', async () => {
  const calls = []; const ui = await mount(null, { toolbox: { files: { saveTextSupportsCopyOnly: true, async saveText(args) { calls.push(args); return { canceled: true }; } } } });
  completePair(ui); await flush(); ui.button('导出 JSON 报告副本').click(); await flush(); assert.equal(calls[0].copyOnly, true);
  const report = JSON.parse(calls[0].content); assert.deepEqual(report.rounds.map((r) => r.drawerIndex), [0, 1]); assert.equal(report.rounds[0].guesses[0].text, '移动电话');
  assert.equal(report.artwork.canvasWidth, 640); assert.equal(report.artwork.rounds.every((r) => r.pngCaptured), true); assert.equal(calls[0].content.includes('data:image'), false);
  assert.ok(ui.root.textContent.includes('已取消 JSON 导出')); ui.lifecycle.destroy();
});

test('missing safe text bridge blocks JSON only and PNG browser download still works', async () => {
  let textCalls = 0; const ui = await mount(null, { toolbox: { files: { async saveText() { textCalls++; } } } }); completePair(ui); await flush();
  ui.button('导出 JSON 报告副本').click(); await flush(); assert.equal(textCalls, 0); assert.ok(ui.root.textContent.includes('不支持 JSON 副本安全导出'));
  ui.button('下载 PNG 画册副本').click(); await flush(); assert.equal(ui.doc.downloads.length, 1); assert.equal(textCalls, 0); ui.lifecycle.destroy();
});

test('storage failure leaves completed report exportable and history stays bounded without retaining image data', async () => {
  const old = { options: OPTIONS, scores: [0, 0], finishedAt: '2026-10-03T00:00:00.000Z', png: 'large' };
  const ui = await mount({ recent: Array(20).fill(old) }, { failSave: true }); completePair(ui); await flush(); assert.ok(ui.root.textContent.includes('摘要保存失败'));
  const history = ui.all().find((e) => e.className === 'e024-recent'); assert.equal(history.children.length, 10);
  ui.button('下载 PNG 画册副本').click(); await flush(); assert.equal(ui.doc.downloads.length, 1); ui.lifecycle.destroy();
});

test('deactivation and document hiding conceal private words, pause drawing, and destroy clears listeners and timers', async () => {
  const ui = await mount(); ui.button('画者已独处，查看选词').click(); ui.button('手机').click(); ui.doc.hidden = true; ui.doc.events.get('visibilitychange')();
  assert.equal(ui.button('手机'), undefined); ui.doc.hidden = false; ui.doc.events.get('visibilitychange')(); ui.button('画者已独处，查看选词').click(); ui.button('隐藏词题，开始作画').click();
  line(ui); ui.advance(2000); ui.lifecycle.deactivate(); ui.advance(90000); ui.lifecycle.activate(); assert.equal(ui.canvas(), undefined); assert.ok(ui.root.textContent.includes('已暂停'));
  ui.button('继续').click(); assert.equal(ui.canvas().context.ink.length, 1); ui.advance(1000); ui.guess('移动电话', 1); ui.start('菠萝'); ui.advance(60000, false);
  ui.lifecycle.destroy(); await flush(); assert.equal(ui.writes.length, 1); assert.deepEqual(ui.writes[0].recent[0].scores, [1, 1]); assert.equal(ui.doc.events.size, 0); assert.equal(ui.root.children.length, 0); assert.equal(ui.intervals.size, 0);
});

test('deactivation cancels in-flight image composition before download and no URL leaks remain', async () => {
  const ui = await mount(); completePair(ui); await flush(); ui.button('下载 PNG 画册副本').click(); ui.lifecycle.deactivate(); await flush();
  assert.equal(ui.doc.downloads.length, 0); assert.equal(ui.blobs.length, 0); ui.lifecycle.activate(); assert.equal(ui.button('下载 PNG 画册副本').disabled, false); ui.lifecycle.destroy();
});
