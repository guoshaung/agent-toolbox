'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const feature = path.resolve(__dirname, '../src/renderer/features/E002');
const modelPromise = import(pathToFileURL(path.join(feature, 'model.mjs')).href);
const options = { width: 9, height: 9, mines: 10, seed: 'E002-demo' };

test('rejects non-integer and out-of-range sizes, density and seeds', async () => {
  const { validateOptions } = await modelPromise;
  for (const change of [{ width: 4 }, { width: 31 }, { height: 25 }, { height: 4 }, { width: 5.5 }, { mines: 0 }, { mines: 29 }, { mines: NaN }, { seed: '' }, { seed: ' ' }, { seed: 'x'.repeat(65) }]) assert.throws(() => validateOptions({ ...options, ...change }), RangeError);
  assert.deepEqual(validateOptions({ width: 30, height: 24, mines: 252, seed: 'max' }), { width: 30, height: 24, mines: 252, seed: 'max' });
});

test('same seed, specification and first point reproduce the documented board', async () => {
  const { generateBoard } = await modelPromise;
  const a = generateBoard(options, 40);
  assert.deepEqual(a, generateBoard(options, 40));
  assert.deepEqual(a.flatMap((c, i) => c.mine ? [i] : []), [0, 6, 14, 18, 26, 34, 37, 44, 51, 74]);
  assert.notDeepEqual(a, generateBoard({ ...options, seed: 'another' }, 40));
  assert.notDeepEqual(a, generateBoard(options, 0));
  assert.throws(() => generateBoard(options, 81), RangeError);
});

test('first cell and all its neighbors remain safe across corners, presets and dense boards', async () => {
  const { generateBoard, neighbors, PRESETS } = await modelPromise;
  for (const spec of [PRESETS.beginner, PRESETS.intermediate, { width: 5, height: 5, mines: 8 }, { width: 30, height: 24, mines: 252 }]) {
    for (const first of [0, spec.width - 1, spec.width * (spec.height - 1), spec.width * spec.height - 1, Math.floor(spec.width * spec.height / 2)]) {
      for (const seed of ['corner', '0', '中文局号']) {
        const board = generateBoard({ ...spec, seed }, first);
        assert.equal(board.filter((c) => c.mine).length, spec.mines);
        assert.equal(board[first].adjacent, 0);
        for (const i of [first, ...neighbors(first, spec.width, spec.height)]) assert.equal(board[i].mine, false);
        board.forEach((c, i) => { if (!c.mine) assert.equal(c.adjacent, neighbors(i, spec.width, spec.height).filter((n) => board[n].mine).length); });
      }
    }
  }
});

test('unopened cells never expose mine locations or adjacent numbers before settlement', async () => {
  const { Minesweeper } = await modelPromise;
  const game = new Minesweeper(options);
  assert.equal(game.getView().phase, 'ready');
  assert.ok(game.getView().cells.every((c) => c.value === null && !c.mine));
  assert.equal(game.reveal(40), true);
  const view = game.getView();
  assert.equal(view.phase, 'running');
  assert.ok(view.cells.filter((c) => !c.revealed).every((c) => c.value === null && !c.mine));
  assert.equal(game.result(), null);
});

test('flood fill opens exactly the connected zero area and its numbered border', async () => {
  const { Minesweeper, generateBoard, neighbors } = await modelPromise;
  const layout = generateBoard(options, 40);
  const expected = new Set();
  const pending = [40];
  while (pending.length) {
    const i = pending.pop();
    if (expected.has(i)) continue;
    expected.add(i);
    if (!layout[i].adjacent) pending.push(...neighbors(i, 9, 9).filter((n) => !layout[n].mine));
  }
  const game = new Minesweeper(options);
  game.reveal(40);
  assert.deepEqual(new Set(game.getView().cells.flatMap((c, i) => c.revealed ? [i] : [])), expected);
  assert.ok(game.getView().cells.every((c) => !c.mine));
});

test('flags work before first reveal, block opening, honor quota and can be removed', async () => {
  const { Minesweeper } = await modelPromise;
  const game = new Minesweeper(options);
  for (let i = 0; i < 10; i++) assert.equal(game.flag(i), true);
  assert.equal(game.flag(11), false);
  assert.equal(game.reveal(0), false);
  assert.equal(game.getView().phase, 'ready');
  assert.equal(game.getView().elapsedMs, 0);
  assert.equal(game.flag(0), true);
  assert.equal(game.flag(11), true);
  assert.equal(game.getView().flags, 10);
  assert.equal(game.reveal(40), true);
  assert.equal(game.flag(40), false);
  assert.equal(game.reveal(-1), false);
  assert.equal(game.flag(100), false);
});

test('opening all safe cells wins without requiring correct flags and locks the result', async () => {
  const { Minesweeper, generateBoard } = await modelPromise;
  let now = 1000;
  const game = new Minesweeper(options, { now: () => now });
  const layout = generateBoard(options, 40);
  game.reveal(40);
  now += 5500;
  layout.forEach((c, i) => { if (!c.mine) game.reveal(i); });
  const result = game.result();
  assert.equal(result.outcome, 'won');
  assert.equal(result.elapsedMs, 5500);
  assert.equal(game.getView().revealed, 71);
  assert.equal(game.getView().cells.filter((c) => c.mine).length, 10);
  assert.equal(game.reveal(0), false);
  assert.equal(game.flag(0), false);
  assert.equal(game.pause(), false);
  now += 10000;
  assert.deepEqual(game.result(), result);
});

test('mine hit loses once and reveals all mines while keeping hidden safe numbers concealed', async () => {
  const { Minesweeper, generateBoard } = await modelPromise;
  const game = new Minesweeper(options);
  game.reveal(40);
  const layout = generateBoard(options, 40);
  const wrongFlag = game.getView().cells.findIndex((c, i) => !c.revealed && !layout[i].mine);
  assert.equal(game.flag(wrongFlag), true);
  game.reveal(0);
  assert.equal(game.result().outcome, 'lost');
  const view = game.getView();
  assert.equal(view.cells.filter((c) => c.mine).length, 10);
  assert.equal(view.cells[0].exploded, true);
  assert.equal(view.cells[wrongFlag].wrongFlag, true);
  assert.ok(view.cells.filter((c) => !c.revealed && !c.mine).every((c) => c.value === null));
  const result = game.result();
  assert.equal(game.reveal(0), false);
  assert.equal(game.chord(40), false);
  assert.deepEqual(game.result(), result);
});

test('pause hides numbers, blocks play and excludes paused time from a settled result', async () => {
  const { Minesweeper } = await modelPromise;
  let now = 1000;
  const game = new Minesweeper(options, { now: () => now });
  assert.equal(game.pause(), false);
  now = 10000;
  assert.equal(game.getView().elapsedMs, 0);
  game.reveal(40);
  now += 2500;
  assert.equal(game.pause(), true);
  now += 90000;
  assert.equal(game.getView().elapsedMs, 2500);
  assert.ok(game.getView().cells.every((c) => !c.revealed && c.value === null && !c.mine));
  assert.equal(game.reveal(0), false);
  assert.equal(game.flag(0), false);
  assert.equal(game.chord(40), false);
  assert.equal(game.resume(), true);
  now += 1200;
  game.reveal(0);
  assert.equal(game.result().elapsedMs, 3700);
  assert.equal(game.resume(), false);
});

test('correct neighboring flags permit chord expansion', async () => {
  const { Minesweeper, generateBoard, neighbors } = await modelPromise;
  const game = new Minesweeper(options);
  game.reveal(40);
  const layout = generateBoard(options, 40);
  const view = game.getView();
  const i = view.cells.findIndex((c, index) => c.revealed && c.value > 0 && neighbors(index, 9, 9).some((n) => !layout[n].mine && !view.cells[n].revealed));
  assert.ok(i >= 0);
  assert.equal(game.chord(i), false);
  for (const n of neighbors(i, 9, 9)) if (layout[n].mine) game.flag(n);
  const before = game.getView().revealed;
  assert.equal(game.chord(i), true);
  assert.ok(game.getView().revealed > before);
  assert.notEqual(game.getView().phase, 'lost');
});

test('matching flag count with an incorrect position can lose on chord', async () => {
  const { Minesweeper, generateBoard, neighbors } = await modelPromise;
  const game = new Minesweeper(options);
  game.reveal(40);
  const layout = generateBoard(options, 40);
  const view = game.getView();
  const i = view.cells.findIndex((c, index) => c.revealed && c.value > 0 && neighbors(index, 9, 9).some((n) => !layout[n].mine && !view.cells[n].revealed));
  const around = neighbors(i, 9, 9);
  const mines = around.filter((n) => layout[n].mine);
  const wrong = around.find((n) => !layout[n].mine && !view.cells[n].revealed);
  game.flag(wrong);
  mines.slice(1).forEach((n) => game.flag(n));
  assert.equal(game.chord(i), true);
  assert.equal(game.getView().phase, 'lost');
  assert.equal(game.getView().cells[wrong].wrongFlag, true);
});

test('best scores only compare wins of exactly the same dimensions and mine count', async () => {
  const { bestScore, validScore } = await modelPromise;
  const make = (change) => ({ ...options, firstIndex: 40, elapsedMs: 5000, moves: 2, outcome: 'won', ...change });
  const scores = [make({ outcome: 'lost', elapsedMs: 100 }), make({ width: 16, height: 16, mines: 40, elapsedMs: 200 }), make({ elapsedMs: 4000 }), make({ elapsedMs: 6000 })];
  assert.equal(bestScore(scores, options).elapsedMs, 4000);
  assert.equal(bestScore([], options), null);
  assert.equal(validScore(make({})), true);
  assert.equal(validScore(make({ elapsedMs: -1 })), false);
  assert.equal(validScore(make({ firstIndex: 81 })), false);
  assert.equal(validScore(make({ outcome: 'running' })), false);
});

// No browser/DOM package dependency: execute the actual renderer and h() against
// a small event-capable DOM adapter to check inputs, concealment and lifecycle.
class Element {
  constructor(tag, doc) { this.nodeType = 1; this.tagName = tag; this.doc = doc; this.children = []; this.attributes = {}; this.dataset = {}; this.style = { setProperty(name, value) { this[name] = value; } }; this.events = new Map(); this.value = ''; this.disabled = false; this._text = ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; }
  getAttribute(key) { return this.attributes[key]; }
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  replaceChildren(...items) { this.children.forEach((x) => { x.parent = null; }); this.children = []; this._text = ''; this.append(...items); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  contains(node) { return node === this || this.children.some((x) => x.nodeType === 1 && x.contains(node)); }
  addEventListener(type, listener) { const list = this.events.get(type) || []; list.push(listener); this.events.set(type, list); }
  focus() { this.doc.activeElement = this; this.emit('focus'); }
  emit(type, props = {}) {
    if (this.disabled && type === 'click') return;
    const event = { type, target: this, key: '', preventDefault() { this.defaultPrevented = true; }, ...props };
    const chain = []; for (let node = this; node; node = node.parent) chain.push(node);
    for (const node of chain) for (const listener of node.events?.get(type) || []) listener(event);
    return event;
  }
  click() { this.emit('click'); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map((x) => x.textContent).join(''); }
}

async function mount(saved = null, { failSave = false, toolbox = {} } = {}) {
  const model = await modelPromise;
  const doc = { activeElement: null, hidden: false, events: new Map(), createElement(tag) { return new Element(tag, this); }, createTextNode(text) { return { nodeType: 3, textContent: String(text) }; }, addEventListener(type, listener) { this.events.set(type, listener); }, removeEventListener(type) { this.events.delete(type); } };
  doc.body = doc.createElement('body');
  const root = doc.createElement('main'); doc.body.append(root);
  const intervals = new Map(); let nextInterval = 1; let now = 0;
  const writes = []; let data = saved;
  const config = { get() { return data; }, async set(_key, value) { if (failSave) throw new Error('disk unavailable'); data = value; writes.push(value); } };
  const context = vm.createContext({ document: doc, window: { toolbox }, console, URL, Uint32Array, Date, Math, Promise, performance: { now: () => now }, setInterval(fn) { const id = nextInterval++; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); }, ...model, module: { exports: {} } });
  vm.runInContext(fs.readFileSync(path.resolve(feature, '../../core/ui.js'), 'utf8').replace(/export /g, '') + '\nmodule.exports = { h };', context);
  context.h = context.module.exports.h;
  const source = fs.readFileSync(path.join(feature, 'index.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace('export default', 'module.exports =').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(path.join(feature, 'index.js')).href));
  vm.runInContext(source, context);
  const lifecycle = context.module.exports.create(root, { config });
  const all = (node = root) => [node, ...node.children.flatMap((x) => x.nodeType === 1 ? all(x) : [])];
  const cells = () => all().filter((e) => e.getAttribute('role') === 'gridcell');
  const button = (text) => all().find((e) => e.tagName === 'button' && e.textContent === text);
  return { doc, root, lifecycle, intervals, writes, all, cells, button, advance(ms) { now += ms; for (const fn of intervals.values()) fn(); } };
}

test('renderer supports keyboard flags, touch flag mode, focus navigation and concealed cells', async () => {
  const ui = await mount();
  assert.equal(ui.cells().length, 81);
  assert.ok(ui.cells().every((c) => c.textContent === '' && c.getAttribute('aria-label').includes('未打开') && !c.dataset.count));
  ui.cells()[0].focus();
  ui.cells()[0].emit('keydown', { key: 'ArrowRight' });
  assert.equal(ui.doc.activeElement, ui.cells()[1]);
  assert.equal(ui.cells().filter((c) => c.getAttribute('tabindex') === '0').length, 1);
  ui.cells()[1].emit('keydown', { key: 'f' });
  assert.equal(ui.cells()[1].textContent, '⚑');
  ui.cells()[1].emit('keydown', { key: 'f' });
  assert.equal(ui.cells()[1].textContent, '');
  ui.button('旗模式 · 关闭').click();
  ui.cells()[0].click();
  assert.equal(ui.cells()[0].textContent, '⚑');
  ui.cells()[0].emit('contextmenu');
  assert.equal(ui.cells()[0].textContent, '');
  ui.button('旗模式 · 已开启').click();
  ui.cells()[40].focus();
  ui.cells()[40].emit('keydown', { key: 'Enter' });
  assert.equal(ui.intervals.size, 1);
  assert.ok(ui.cells().filter((c) => c.getAttribute('aria-label').includes('未打开')).every((c) => !c.dataset.count && !c.getAttribute('aria-label').includes('雷')));
  ui.lifecycle.destroy();
});

test('renderer pauses on exit/visibility, stays paused on return and removes timers and listeners', async () => {
  const ui = await mount();
  ui.cells()[40].click(); ui.advance(2500);
  assert.equal(ui.intervals.size, 1);
  ui.lifecycle.deactivate();
  assert.equal(ui.intervals.size, 0);
  assert.equal(ui.cells().length, 0);
  ui.advance(60000); ui.lifecycle.activate();
  assert.equal(ui.cells().length, 0);
  assert.ok(ui.root.textContent.includes('0:02.5'));
  ui.button('继续').click();
  assert.equal(ui.cells().length, 81);
  assert.equal(ui.intervals.size, 1);
  ui.doc.hidden = true; ui.doc.events.get('visibilitychange')();
  assert.equal(ui.intervals.size, 0);
  assert.equal(ui.cells().length, 0);
  ui.doc.hidden = false; ui.button('继续').click();
  ui.lifecycle.destroy(); ui.lifecycle.destroy(); ui.lifecycle.activate();
  assert.equal(ui.intervals.size, 0);
  assert.equal(ui.doc.events.size, 0);
  assert.equal(ui.root.children.length, 0);
  assert.equal(ui.writes.length, 0);
});

test('renderer records a loss once, replays its exact first point and retains the score', async () => {
  const ui = await mount();
  const seed = ui.all().find((e) => e.getAttribute('aria-label') === '指定局号');
  seed.value = 'E002-demo'; ui.button('新局').click();
  ui.cells()[40].click(); ui.advance(4200); ui.cells()[0].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.writes.length, 1);
  const result = ui.writes[0].recent[0];
  assert.equal(result.outcome, 'lost'); assert.equal(result.elapsedMs, 4200); assert.equal(result.firstIndex, 40);
  assert.equal(ui.cells().filter((c) => c.textContent === '✹').length, 10);
  ui.cells()[0].click(); ui.lifecycle.activate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.writes.length, 1);
  ui.button('重放').click();
  assert.equal(ui.cells()[40].getAttribute('aria-label'), '第 5 行，第 5 列，已展开空格');
  assert.equal(ui.cells()[0].textContent, '');
  ui.cells()[0].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.writes.length, 2);
  assert.equal(ui.writes[1].recent[0].seed, result.seed);
  assert.equal(ui.writes[1].recent.length, 2);
  ui.lifecycle.destroy();
});

test('renderer keeps best wins separately from the latest 20 results and reports storage failures', async () => {
  const { generateBoard } = await modelPromise;
  const old = { ...options, firstIndex: 40, outcome: 'won', moves: 30, elapsedMs: 5000 };
  const recent = Array.from({ length: 20 }, (_, i) => ({ ...old, outcome: 'lost', elapsedMs: 1000 + i }));
  const ui = await mount({ recent, best: [old] }, { failSave: true });
  assert.ok(ui.root.textContent.includes('0:05.0'));
  const seed = ui.all().find((e) => e.getAttribute('aria-label') === '指定局号');
  seed.value = 'E002-demo'; ui.button('新局').click(); ui.cells()[40].click(); ui.advance(7000);
  const layout = generateBoard(options, 40);
  layout.forEach((c, i) => { if (!c.mine) ui.cells()[i].click(); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(ui.root.textContent.includes('你赢了'));
  assert.ok(ui.root.textContent.includes('成绩保存失败'));
  assert.ok(ui.root.textContent.includes('0:05.0'));
  const records = ui.all().find((e) => e.tagName === 'ol');
  assert.equal(records.children.length, 20);
  ui.lifecycle.destroy();
});

test('renderer validates custom sizes before replacing an active game', async () => {
  const ui = await mount();
  ui.cells()[40].click();
  const select = ui.all().find((e) => e.tagName === 'select');
  select.value = 'custom'; select.emit('change');
  const dimensions = ui.all().filter((e) => e.tagName === 'input' && e.getAttribute('type') === 'number');
  dimensions[0].value = '31'; ui.button('新局').click();
  assert.ok(ui.root.textContent.includes('宽度须为 5–30'));
  assert.equal(ui.cells().length, 81);
  assert.equal(ui.intervals.size, 1);
  dimensions[0].value = '5'; dimensions[1].value = '5'; dimensions[2].value = '8'; ui.button('新局').click();
  assert.equal(ui.cells().length, 25);
  assert.equal(ui.intervals.size, 0);
  ui.lifecycle.destroy();
});

test('repeated reset stops the previous timer and never records an abandoned game', async () => {
  const ui = await mount();
  ui.cells()[40].click();
  ui.button('重玩本局').click(); ui.button('重玩本局').click();
  assert.equal(ui.intervals.size, 1);
  assert.equal(ui.writes.length, 0);
  ui.button('新局').click();
  assert.equal(ui.intervals.size, 0);
  assert.equal(ui.writes.length, 0);
  assert.ok(ui.cells().every((c) => c.textContent === ''));
  ui.lifecycle.destroy();
});

test('native score export contains replay data and requests a new file without overwriting', async () => {
  const old = { ...options, firstIndex: 40, outcome: 'won', moves: 30, elapsedMs: 5000 };
  const exports = [];
  const toolbox = { files: { saveTextSupportsCopyOnly: true, async saveText(args) { exports.push(args); return { ok: true }; } } };
  const ui = await mount({ recent: [old], best: [old] }, { toolbox });
  ui.button('导出成绩').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exports.length, 1);
  assert.equal(exports[0].copyOnly, true);
  const output = JSON.parse(exports[0].content);
  assert.equal(output.feature, 'E002');
  assert.equal(output.recent[0].seed, 'E002-demo');
  assert.equal(output.recent[0].firstIndex, 40);
  assert.equal(output.best[0].elapsedMs, 5000);
  assert.ok(ui.root.textContent.includes('成绩已导出'));
  ui.lifecycle.destroy();
});

test('malformed persisted records are ignored rather than becoming replay actions', async () => {
  const ui = await mount({ recent: [{ ...options, outcome: 'won', elapsedMs: -1 }, { bad: true }], best: [{}] });
  assert.equal(ui.button('重放'), undefined);
  assert.equal(ui.button('导出成绩').disabled, true);
  assert.ok(ui.root.textContent.includes('还没有完整对局'));
  ui.lifecycle.destroy();
});
