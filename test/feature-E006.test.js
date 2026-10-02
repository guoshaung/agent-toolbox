'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const feature = path.resolve(__dirname, '../src/renderer/features/E006');
const modelPromise = import(pathToFileURL(path.join(feature, 'model.mjs')).href);
const THREE = [[0, 2], [0, 1], [2, 1], [0, 2], [1, 0], [1, 2], [0, 2]];
const FOUR = [[0, 1], [0, 2], [1, 2], [0, 1], [2, 0], [2, 1], [0, 1], [0, 2], [1, 2], [1, 0], [2, 0], [1, 2], [0, 1], [0, 2], [1, 2]];

test('disk limits and theoretical minimum are exact for all supported sizes', async () => {
  const { validateDisks, minimumMoves } = await modelPromise;
  for (const n of [2, 7, 3.5, NaN, '4', null]) assert.throws(() => validateDisks(n), RangeError);
  assert.deepEqual([3, 4, 5, 6].map(minimumMoves), [7, 15, 31, 63]);
});

test('only the top disk moves and invalid attempts never alter state or start the clock', async () => {
  const { Hanoi } = await modelPromise;
  const game = new Hanoi(4, { now: () => 100 });
  const initial = game.getView();
  assert.equal(game.move(1, 2).reason, 'emptySource');
  assert.equal(game.move(0, 0).reason, 'sameTower');
  assert.equal(game.move(-1, 2).reason, 'invalidTower');
  assert.equal(game.move(0, 3).reason, 'invalidTower');
  assert.deepEqual(game.getView(), initial);
  assert.deepEqual(game.move(0, 2), { ok: true, disk: 1 });
  const before = game.getView();
  assert.equal(game.move(0, 2).reason, 'largerOnSmaller');
  assert.deepEqual(game.getView(), before);
  assert.deepEqual(before.towers, [[4, 3, 2], [], [1]]);
  before.towers[0].pop();
  assert.equal(game.getView().towers[0].length, 3);
});

test('four-disk fifteen-step example finishes only when every disk is at C and locks completion', async () => {
  const { Hanoi } = await modelPromise;
  let now = 0;
  const game = new Hanoi(4, { now: () => now });
  FOUR.forEach(([from, to], index) => { now = index * 1000; assert.equal(game.move(from, to).ok, true); if (index < 14) assert.equal(game.result(), null); });
  assert.deepEqual(game.getView().towers, [[], [], [4, 3, 2, 1]]);
  assert.equal(game.result().minimum, 15);
  assert.equal(game.result().moves, 15);
  assert.equal(game.result().elapsedMs, 14000);
  const result = game.result();
  now += 10000;
  assert.equal(game.move(2, 0).ok, false);
  assert.equal(game.undo(), false);
  assert.equal(game.pause(), false);
  assert.equal(game.hint(), null);
  assert.deepEqual(game.result(), result);
});

test('single-step hints complete 3–6 disks in the theoretical minimum', async () => {
  const { Hanoi } = await modelPromise;
  for (const disks of [3, 4, 5, 6]) {
    const game = new Hanoi(disks);
    for (let i = 0; i < 2 ** disks - 1; i++) {
      const hint = game.hint();
      assert.equal(hint.remaining, 2 ** disks - 1 - i);
      const top = game.getView().towers[hint.move.from].at(-1);
      assert.equal(top, hint.move.disk);
      assert.equal(game.move(hint.move.from, hint.move.to).ok, true);
    }
    assert.equal(game.getView().phase, 'won');
    assert.equal(game.result().moves, 2 ** disks - 1);
  }
});

test('hints work after a wrong first move and do not subtract used moves from initial minimum', async () => {
  const { Hanoi } = await modelPromise;
  const game = new Hanoi(3);
  game.move(0, 1);
  const hint = game.hint();
  assert.equal(game.getView().moves, 1);
  assert.equal(game.getView().minimum, 7);
  assert.equal(hint.remaining, 7);
  assert.notEqual(hint.remaining, 7 - game.getView().moves);
  for (let i = 0; i < 7; i++) { const move = game.hint().move; assert.equal(game.move(move.from, move.to).ok, true); }
  assert.equal(game.result().moves, 8);
});

test('hints are legal and decrease remaining distance for every one of the 729 six-disk arrangements', async () => {
  const { shortestHint } = await modelPromise;
  for (let code = 0; code < 729; code++) {
    let state = code;
    const positions = [];
    for (let i = 0; i < 6; i++) { positions.push(state % 3); state = Math.floor(state / 3); }
    const towers = [[], [], []];
    for (let disk = 6; disk >= 1; disk--) towers[positions[disk - 1]].push(disk);
    const hint = shortestHint(towers, 6);
    if (code === 728) { assert.equal(hint.remaining, 0); assert.equal(hint.move, null); continue; }
    const { from, to, disk } = hint.move;
    assert.equal(towers[from].at(-1), disk);
    assert.ok(!towers[to].length || towers[to].at(-1) > disk);
    towers[from].pop(); towers[to].push(disk);
    assert.equal(shortestHint(towers, 6).remaining, hint.remaining - 1);
  }
});

test('invalid tower layouts are rejected by the hint calculator', async () => {
  const { shortestHint } = await modelPromise;
  for (const towers of [[[3, 2, 1], []], [[3, 1, 2], [], []], [[3, 2], [2], []], [[3, 2, 1, 0], [], []]]) assert.throws(() => shortestHint(towers, 3), RangeError);
});

test('undo restores top disks, counts attempts honestly, and has a bounded stack', async () => {
  const { Hanoi, UNDO_LIMIT } = await modelPromise;
  const game = new Hanoi(3);
  assert.equal(game.undo(), false);
  game.move(0, 2);
  assert.equal(game.undo(), true);
  assert.deepEqual(game.getView().towers, [[3, 2, 1], [], []]);
  assert.equal(game.getView().moves, 1);
  assert.equal(game.getView().undos, 1);
  assert.equal(game.undo(), false);
  for (let i = 0; i < 300; i++) game.move(i % 2 ? 1 : 0, i % 2 ? 0 : 1);
  for (let i = 0; i < UNDO_LIMIT; i++) assert.equal(game.undo(), true);
  assert.equal(game.undo(), false);
  assert.equal(game.getView().moves, 301);
  assert.equal(game.getView().undos, 257);
});

test('pause blocks play and hides towers while excluding paused time from completion', async () => {
  const { Hanoi } = await modelPromise;
  let now = 0;
  const game = new Hanoi(3, { now: () => now });
  assert.equal(game.pause(), false);
  now = 10000; assert.equal(game.getView().elapsedMs, 0);
  game.move(...THREE[0]); now += 2500; game.pause(); now += 90000;
  assert.equal(game.getView().elapsedMs, 2500);
  assert.deepEqual(game.getView().towers, []);
  assert.equal(game.getView().remaining, null);
  assert.equal(game.move(0, 1).ok, false);
  assert.equal(game.undo(), false);
  assert.equal(game.hint(), null);
  assert.equal(game.resume(), true); now += 1200;
  THREE.slice(1).forEach((step) => game.move(...step));
  assert.equal(game.result().elapsedMs, 3700);
});

test('score validation and ranking compare supported sizes, moves first and same-score time second', async () => {
  const { validScore, betterScore } = await modelPromise;
  const old = { disks: 3, moves: 7, minimum: 7, undos: 0, hints: 0, elapsedMs: 5000 };
  assert.equal(validScore(old), true);
  for (const change of [{ disks: 7 }, { moves: 6 }, { minimum: 8 }, { undos: -1 }, { undos: 8 }, { hints: -1 }, { elapsedMs: -1 }]) assert.equal(validScore({ ...old, ...change }), false);
  assert.equal(betterScore({ ...old, moves: 8, elapsedMs: 0 }, old), false);
  assert.equal(betterScore({ ...old, elapsedMs: 4000 }, old), true);
  assert.equal(betterScore(old, null), true);
});

class Element {
  constructor(tag, doc) { this.nodeType = 1; this.tagName = tag; this.doc = doc; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.events = new Map(); this.value = ''; this.disabled = false; this._text = ''; this.className = ''; }
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
  doc.body = doc.createElement('body'); const root = doc.createElement('main'); doc.body.append(root);
  let now = 0; let nextInterval = 1; const intervals = new Map(); const writes = [];
  const config = { get() { return saved; }, async set(_key, value) { if (failSave) throw new Error('storage unavailable'); writes.push(value); } };
  const context = vm.createContext({ document: doc, window: { toolbox }, console, URL, Date, Math, Promise, performance: { now: () => now }, setInterval(fn) { const id = nextInterval++; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); }, ...model, module: { exports: {} } });
  vm.runInContext(fs.readFileSync(path.resolve(feature, '../../core/ui.js'), 'utf8').replace(/export /g, '') + '\nmodule.exports = { h };', context);
  context.h = context.module.exports.h;
  const source = fs.readFileSync(path.join(feature, 'index.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace('export default', 'module.exports =').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(path.join(feature, 'index.js')).href));
  vm.runInContext(source, context);
  const lifecycle = context.module.exports.create(root, { config });
  const all = (node = root) => [node, ...node.children.flatMap((x) => x.nodeType === 1 ? all(x) : [])];
  const towers = () => all().filter((e) => e.tagName === 'button' && e.className.split(' ').includes('e006-tower'));
  const button = (text) => all().find((e) => e.tagName === 'button' && e.textContent === text);
  return { doc, root, lifecycle, writes, all, towers, button, intervals, advance(ms) { now += ms; for (const fn of intervals.values()) fn(); } };
}

function play(ui, steps) { for (const [from, to] of steps) { if (ui.towers()[from].getAttribute('aria-pressed') !== 'true') ui.towers()[from].click(); ui.towers()[to].click(); } }

test('UI exposes all plates but only top plates are draggable and keyboard focus selects sources and targets', async () => {
  const ui = await mount();
  assert.equal(ui.towers().length, 3);
  const plates = ui.all().filter((e) => e.dataset.disk);
  assert.equal(plates.length, 3);
  assert.equal(plates.filter((p) => p.getAttribute('draggable') === 'true').length, 1);
  ui.towers()[0].focus(); ui.towers()[0].emit('keydown', { key: 'ArrowRight' });
  assert.equal(ui.doc.activeElement, ui.towers()[1]);
  assert.equal(ui.towers().filter((p) => p.getAttribute('tabindex') === '0').length, 1);
  ui.towers()[1].emit('keydown', { key: '1' });
  assert.equal(ui.towers()[0].getAttribute('aria-pressed'), 'true');
  assert.equal(ui.intervals.size, 0);
  ui.towers()[0].emit('keydown', { key: '3' });
  assert.equal(ui.intervals.size, 1);
  assert.ok(ui.towers()[2].getAttribute('aria-label').includes('顶盘 1'));
  ui.lifecycle.destroy();
});

test('UI rejects a large disk on a smaller disk without incrementing steps, and undo does not erase attempt cost', async () => {
  const ui = await mount();
  play(ui, [[0, 2]]);
  const before = ui.towers().map((t) => t.getAttribute('aria-label'));
  play(ui, [[0, 2]]);
  assert.ok(ui.root.textContent.includes('大盘不能压小盘'));
  assert.ok(ui.root.textContent.includes('1 步'));
  assert.ok(ui.towers()[0].getAttribute('aria-label').includes('顶盘 2'));
  assert.ok(ui.towers()[2].getAttribute('aria-label').includes('顶盘 1'));
  ui.button('撤销').click();
  assert.ok(ui.towers()[0].getAttribute('aria-label').includes('顶盘 1'));
  assert.ok(ui.root.textContent.includes('已撤销 1 次'));
  assert.ok(ui.root.textContent.includes('1 步'));
  assert.equal(ui.intervals.size, 1);
  assert.equal(ui.button('撤销').disabled, true);
  assert.equal(before.length, 3);
  ui.lifecycle.destroy();
});

test('drag and drop moves only a current top disk, rejects external drops and cannot use stale drag after reset', async () => {
  const ui = await mount();
  const transfer = { setData() {}, effectAllowed: '', dropEffect: '' };
  const lower = ui.all().find((e) => e.dataset.disk === 2);
  assert.equal(lower.emit('dragstart', { dataTransfer: transfer }).defaultPrevented, true);
  ui.towers()[2].emit('drop', { dataTransfer: transfer });
  assert.equal(ui.intervals.size, 0);
  const top = ui.all().find((e) => e.dataset.disk === 1);
  top.emit('dragstart', { dataTransfer: transfer }); ui.towers()[2].emit('drop', { dataTransfer: transfer });
  assert.ok(ui.towers()[2].getAttribute('aria-label').includes('顶盘 1'));
  assert.ok(ui.root.textContent.includes('1 步'));
  const next = ui.all().find((e) => e.dataset.disk === 2);
  next.emit('dragstart', { dataTransfer: transfer }); ui.button('重置本局').click();
  ui.towers()[2].emit('drop', { dataTransfer: transfer });
  assert.ok(ui.towers()[2].getAttribute('aria-label').includes('空柱'));
  assert.equal(ui.intervals.size, 0);
  ui.lifecycle.destroy();
});

test('UI shows an exact continuation hint after a nonoptimal move without starting another timer', async () => {
  const ui = await mount();
  ui.button('单步提示').click();
  assert.ok(ui.root.textContent.includes('盘 1 从 A 移到 C'));
  assert.equal(ui.intervals.size, 0);
  ui.button('取消选柱').click(); play(ui, [[0, 1]]);
  ui.button('单步提示').click();
  assert.ok(ui.root.textContent.includes('最短还需 7 步'));
  assert.equal(ui.intervals.size, 1);
  assert.ok(ui.towers()[1].getAttribute('aria-label').includes('已选择源柱'));
  ui.lifecycle.destroy();
});

test('four-layer UI click sequence completes exactly 15 steps and records one bounded result', async () => {
  const ui = await mount();
  const select = ui.all().find((e) => e.tagName === 'select'); select.value = '4'; ui.button('新局').click();
  assert.ok(ui.root.textContent.includes('15 步'));
  play(ui, FOUR); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(ui.root.textContent.includes('全部 4 个盘已移到 C！15 步完成'));
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].recent[0].moves, 15);
  assert.equal(ui.writes[0].recent[0].minimum, 15);
  assert.equal(ui.intervals.size, 0);
  assert.equal(ui.button('撤销').disabled, true);
  ui.towers()[2].click(); ui.lifecycle.activate(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.writes.length, 1);
  ui.lifecycle.destroy();
});

test('exit and hidden window pause time, return stays paused and destroy removes listeners/timers', async () => {
  const ui = await mount();
  play(ui, [THREE[0]]); ui.advance(2500); ui.lifecycle.deactivate();
  assert.equal(ui.towers().length, 0); assert.equal(ui.intervals.size, 0);
  ui.advance(90000); ui.lifecycle.activate(); assert.equal(ui.towers().length, 0);
  assert.ok(ui.root.textContent.includes('0:02.5'));
  ui.button('继续').click(); ui.advance(1200);
  play(ui, THREE.slice(1)); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.writes[0].recent[0].elapsedMs, 3700);
  ui.button('重置本局').click(); play(ui, [THREE[0]]);
  ui.doc.hidden = true; ui.doc.events.get('visibilitychange')();
  assert.equal(ui.intervals.size, 0); assert.equal(ui.towers().length, 0);
  ui.lifecycle.destroy(); ui.lifecycle.destroy(); ui.lifecycle.activate();
  assert.equal(ui.root.children.length, 0); assert.equal(ui.doc.events.size, 0); assert.equal(ui.intervals.size, 0);
});

test('scores retain the better old result, cap recent history and deduplicate at most four disk categories', async () => {
  const old = { disks: 3, moves: 7, minimum: 7, undos: 0, hints: 0, elapsedMs: 0 };
  const ui = await mount({ recent: Array.from({ length: 20 }, () => old), best: [old, { ...old, moves: 8 }, { bad: true }] });
  play(ui, [[0, 1]]); ui.button('撤销').click(); play(ui, THREE); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.writes[0].recent.length, 20);
  assert.equal(ui.writes[0].recent[0].moves, 8);
  assert.equal(ui.writes[0].best.length, 1);
  assert.equal(ui.writes[0].best[0].moves, 7);
  ui.button('重置本局').click(); assert.ok(ui.root.textContent.includes('0 步'));
  assert.equal(ui.writes.length, 1); ui.lifecycle.destroy();
});

test('native score export requests a new file and correctly distinguishes canceled save from success', async () => {
  const requests = [];
  const toolbox = { files: { saveTextSupportsCopyOnly: true, async saveText(args) { requests.push(args); return { canceled: true }; } } };
  const ui = await mount(null, { toolbox });
  play(ui, THREE); await new Promise((resolve) => setImmediate(resolve));
  ui.button('导出成绩').click(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests[0].copyOnly, true);
  const output = JSON.parse(requests[0].content);
  assert.equal(output.feature, 'E006'); assert.equal(output.recent[0].moves, 7); assert.equal(output.recent[0].minimum, 7);
  assert.ok(ui.root.textContent.includes('已取消导出')); ui.lifecycle.destroy();
});

test('invalid size leaves the current game intact and storage failure keeps a completed round exportable', async () => {
  const ui = await mount({ recent: [{}], best: [{}] }, { failSave: true });
  assert.equal(ui.button('导出成绩').disabled, true);
  const select = ui.all().find((e) => e.tagName === 'select'); select.value = '9'; ui.button('新局').click();
  assert.ok(ui.root.textContent.includes('盘数须为 3–6'));
  assert.equal(ui.towers().length, 3);
  play(ui, THREE); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(ui.root.textContent.includes('保存失败')); assert.equal(ui.button('导出成绩').disabled, false);
  ui.lifecycle.destroy();
});
