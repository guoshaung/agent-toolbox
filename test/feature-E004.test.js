'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const feature = path.resolve(__dirname, '../src/renderer/features/E004');
const modelPromise = import(pathToFileURL(path.join(feature, 'model.mjs')).href);

function turns(level, i) {
  let delta = (level.solution[i] - level.cells[i].orientation + 4) % 4;
  if (level.cells[i].type === 'straight') delta %= 2;
  return delta;
}

test('ports encode both pipe kinds and reversible quarter turns', async () => {
  const { ports } = await modelPromise;
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => ports('straight', i)), [5, 10, 5, 10, 5]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => ports('bend', i)), [3, 6, 12, 9, 3]);
  assert.equal(ports('bend', -1), 9);
  assert.throws(() => ports('tee', 0), RangeError);
  assert.throws(() => ports('bend', 0.5), RangeError);
});

test('all twenty fixed levels are deterministic, unfinished initially, solvable, and contain straight/bend pipes only', async () => {
  const { generateLevel, traceFlow } = await modelPromise;
  const unique = new Set();
  for (let id = 1; id <= 20; id++) {
    const level = generateLevel(id);
    assert.deepEqual(level, generateLevel(id));
    unique.add(JSON.stringify(level.cells));
    assert.ok(level.cells.every((c) => ['straight', 'bend'].includes(c.type)));
    assert.equal(level.entrance % level.width, 0);
    assert.equal(level.exit % level.width, level.width - 1);
    assert.equal(traceFlow(level).won, false);
    assert.equal(traceFlow(level).leak.reason, 'entry');
    const solved = traceFlow(level, level.solution);
    assert.equal(solved.won, true);
    assert.equal(solved.leak, null);
    assert.deepEqual(solved.path, level.solutionPath);
    assert.deepEqual(solved.visitedRequired, level.required);
    assert.equal(new Set(solved.path).size, solved.path.length);
  }
  assert.equal(unique.size, 20);
  assert.throws(() => generateLevel(0), RangeError);
  assert.throws(() => generateLevel(21), RangeError);
  assert.throws(() => generateLevel(1.5), RangeError);
});

const line = () => ({ id: 1, seed: 'fixture', width: 3, height: 2, entrance: 0, exit: 2, required: [1], cells: Array.from({ length: 6 }, () => ({ type: 'straight', orientation: 1 })) });

test('flow stops before an unmatched neighbor rather than highlighting a disconnected tile', async () => {
  const { traceFlow } = await modelPromise;
  const level = line(); level.cells[1].orientation = 0;
  const result = traceFlow(level);
  assert.deepEqual(result.path, [0]);
  assert.deepEqual(result.leak, { index: 0, direction: 2, neighbor: 1, reason: 'mismatch' });
  assert.equal(result.reachedExit, false);
  assert.deepEqual(result.missingRequired, [1]);
});

test('reaching the fixed exit without all required nodes is not a win', async () => {
  const { traceFlow } = await modelPromise;
  const level = line(); level.required = [4];
  const result = traceFlow(level);
  assert.deepEqual(result.path, [0, 1, 2]);
  assert.equal(result.reachedExit, true);
  assert.equal(result.won, false);
  assert.deepEqual(result.missingRequired, [4]);
  level.required = [1];
  assert.equal(traceFlow(level).won, true);
});

test('wrong boundary outlet does not count as reaching the designated exit', async () => {
  const { traceFlow } = await modelPromise;
  const level = line(); level.exit = 5;
  const result = traceFlow(level);
  assert.equal(result.won, false);
  assert.equal(result.reachedExit, false);
  assert.deepEqual(result.leak, { index: 2, direction: 2, neighbor: null, reason: 'edge' });
});

test('invalid levels, required nodes and direction arrays are rejected', async () => {
  const { validateLevel, traceFlow } = await modelPromise;
  for (const change of [{ width: 1 }, { height: 11 }, { entrance: 1 }, { exit: 0 }, { required: [1, 1] }, { required: [6] }, { cells: [] }]) assert.throws(() => validateLevel({ ...line(), ...change }), RangeError);
  assert.throws(() => traceFlow(line(), [0]), RangeError);
  assert.throws(() => traceFlow(line(), [0, 1, 2, 3, NaN, 0]), RangeError);
});

test('pause blocks rotations, resume preserves state, and reset restores the original board and zero steps', async () => {
  const { PipeGame } = await modelPromise;
  const game = new PipeGame(1);
  const initial = game.getView();
  assert.equal(game.rotate(0), true);
  assert.equal(game.getView().moves, 1);
  const rotated = game.getView();
  assert.equal(game.pause(), true);
  assert.equal(game.pause(), false);
  assert.deepEqual(game.getView().cells, []);
  assert.equal(game.getView().flow, null);
  assert.equal(game.rotate(0), false);
  assert.equal(game.resume(), true);
  assert.deepEqual(game.getView().cells, rotated.cells);
  game.reset();
  assert.deepEqual(game.getView(), initial);
  assert.equal(game.rotate(-1), false);
  assert.equal(game.rotate(100), false);
  assert.equal(game.rotate(0, 0), false);
});

test('documented first-level fourteen-click sequence wins, records actual flow, and locks further rotation', async () => {
  const { PipeGame } = await modelPromise;
  const game = new PipeGame(1);
  for (const [index, count] of [[0, 2], [1, 2], [2, 3], [4, 1], [5, 1], [6, 1], [10, 2], [11, 2]]) for (let n = 0; n < count; n++) assert.equal(game.rotate(index), true);
  assert.equal(game.getView().phase, 'won');
  const result = game.result();
  assert.equal(result.moves, 14);
  assert.equal(result.seed, 'E004-L01');
  assert.deepEqual(result.path, [0, 4, 5, 1, 2, 6, 10, 11, 7]);
  assert.deepEqual(result.checkpoints, [2]);
  assert.equal(game.rotate(0), false);
  assert.equal(game.pause(), false);
  assert.deepEqual(game.result(), result);
  game.reset(); assert.equal(game.result(), null);
});

test('every game can be completed by its reproducible solution using legal rotations', async () => {
  const { PipeGame, generateLevel } = await modelPromise;
  for (let id = 1; id <= 20; id++) {
    const level = generateLevel(id);
    const game = new PipeGame(id);
    for (let i = 0; i < level.cells.length; i++) for (let n = 0; n < turns(level, i); n++) game.rotate(i);
    assert.equal(game.result().level, id);
    assert.equal(game.getView().phase, 'won');
  }
});

test('model owns puzzle copies and does not expose its solution through renderer view', async () => {
  const { PipeGame, generateLevel } = await modelPromise;
  const source = generateLevel(1);
  const game = new PipeGame(source);
  const initial = game.getView();
  source.cells[0].orientation = 99; source.required.length = 0;
  assert.deepEqual(game.getView(), initial);
  assert.equal('solution' in initial, false);
  assert.equal('solutionPath' in initial, false);
  initial.cells[0].orientation = 99;
  assert.notEqual(game.getView().cells[0].orientation, 99);
});

test('record validation checks level bounds, seed, endpoint, adjacency, pipe types and all checkpoints', async () => {
  const { generateLevel, validScore } = await modelPromise;
  const level = generateLevel(1);
  const good = { level: 1, seed: level.seed, moves: 14, path: level.solutionPath, checkpoints: level.required };
  assert.equal(validScore(good), true);
  for (const change of [{ level: 21 }, { seed: 'bad' }, { moves: 0 }, { path: [0, 7] }, { checkpoints: [] }, { path: [0, 4, 5, 1, 2, 6, 10, 11, 7, 7] }, { checkpoints: [2, 2] }]) assert.equal(validScore({ ...good, ...change }), false);
});

class Element {
  constructor(tag, doc) { this.nodeType = 1; this.tagName = tag; this.doc = doc; this.children = []; this.attributes = {}; this.dataset = {}; this.style = { setProperty(name, value) { this[name] = value; } }; this.events = new Map(); this.value = ''; this.disabled = false; this._text = ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; }
  getAttribute(key) { return this.attributes[key]; }
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  replaceChildren(...items) { this.children.forEach((x) => { x.parent = null; }); this.children = []; this._text = ''; this.append(...items); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  contains(node) { return node === this || this.children.some((x) => x.nodeType === 1 && x.contains(node)); }
  querySelectorAll(tag) { return this.children.flatMap((x) => x.nodeType === 1 ? [...(x.tagName === tag ? [x] : []), ...x.querySelectorAll(tag)] : []); }
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
  const writes = [];
  const config = { get() { return saved; }, async set(_key, value) { if (failSave) throw new Error('storage unavailable'); writes.push(value); } };
  const context = vm.createContext({ document: doc, window: { toolbox }, console, URL, Date, Math, Promise, ...model, module: { exports: {} } });
  vm.runInContext(fs.readFileSync(path.resolve(feature, '../../core/ui.js'), 'utf8').replace(/export /g, '') + '\nmodule.exports = { h };', context);
  context.h = context.module.exports.h;
  const source = fs.readFileSync(path.join(feature, 'index.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace('export default', 'module.exports =').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(path.join(feature, 'index.js')).href));
  vm.runInContext(source, context);
  const lifecycle = context.module.exports.create(root, { config });
  const all = (node = root) => [node, ...node.children.flatMap((x) => x.nodeType === 1 ? all(x) : [])];
  const cells = () => all().filter((e) => e.getAttribute('role') === 'gridcell');
  const button = (text) => all().find((e) => e.tagName === 'button' && e.textContent === text);
  return { doc, root, lifecycle, writes, all, cells, button };
}

async function winUI(ui, id = 1) {
  const { generateLevel } = await modelPromise;
  const level = generateLevel(id);
  for (let i = 0; i < level.cells.length; i++) for (let n = 0; n < turns(level, i); n++) ui.cells()[i].click();
  await new Promise((resolve) => setImmediate(resolve));
}

test('renderer has a playable board, visible pipe ports, node labels and roving keyboard focus', async () => {
  const ui = await mount();
  assert.equal(ui.cells().length, 12);
  assert.equal(ui.all().find((e) => e.tagName === 'select').children.length, 20);
  assert.ok(ui.cells()[0].getAttribute('aria-label').includes('入口'));
  assert.ok(ui.cells()[2].getAttribute('aria-label').includes('必经节点 1'));
  ui.cells()[0].focus(); ui.cells()[0].emit('keydown', { key: 'ArrowRight' });
  assert.equal(ui.doc.activeElement, ui.cells()[1]);
  assert.equal(ui.cells().filter((c) => c.getAttribute('tabindex') === '0').length, 1);
  const old = ui.cells()[1].dataset.ports;
  ui.cells()[1].emit('keydown', { key: 'Enter' });
  assert.notEqual(ui.cells()[1].dataset.ports, old);
  ui.cells()[1].emit('keydown', { key: 'r' });
  assert.equal(ui.cells()[1].dataset.ports, old);
  ui.cells()[1].emit('contextmenu');
  ui.cells()[1].emit('keydown', { key: 'Enter' });
  assert.equal(ui.cells()[1].dataset.ports, old);
  ui.button('点击：顺时针').click();
  ui.cells()[1].click(); ui.cells()[1].emit('keydown', { key: 'Enter', shiftKey: false });
  assert.ok(ui.root.textContent.includes('6 步'));
  ui.lifecycle.destroy();
});

test('preview exposes only connected water and can be switched off without changing steps', async () => {
  const ui = await mount();
  assert.ok(ui.root.textContent.includes('入口尚未接通'));
  ui.cells()[0].click(); ui.cells()[0].click();
  assert.ok(ui.cells().some((c) => c.className.includes('is-wet')));
  const before = ui.cells().map((c) => c.dataset.ports);
  ui.button('路径预览 · 开').click();
  assert.ok(ui.cells().every((c) => !c.className.includes('is-wet')));
  assert.deepEqual(ui.cells().map((c) => c.dataset.ports), before);
  assert.ok(ui.root.textContent.includes('2 步'));
  ui.button('路径预览 · 关').click();
  assert.ok(ui.cells().some((c) => c.className.includes('is-wet')));
  ui.lifecycle.destroy();
});

test('complete UI round saves once, shows the path, limits records and keeps the better per-level score', async () => {
  const { generateLevel } = await modelPromise;
  const level = generateLevel(1);
  const old = { level: 1, seed: level.seed, moves: 10, path: level.solutionPath, checkpoints: level.required };
  const ui = await mount({ recent: Array.from({ length: 20 }, () => old), best: [old, { ...old, moves: 30 }] });
  await winUI(ui);
  assert.ok(ui.root.textContent.includes('14 步通关'));
  assert.ok(ui.root.textContent.includes('水流路径（9 格）'));
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].recent.length, 20);
  assert.equal(ui.writes[0].best.length, 1);
  assert.equal(ui.writes[0].best[0].moves, 10);
  ui.cells()[0].click(); ui.lifecycle.activate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.writes.length, 1);
  ui.button('重置本关').click();
  assert.ok(ui.root.textContent.includes('0 步'));
  await winUI(ui);
  assert.equal(ui.writes.length, 2);
  ui.lifecycle.destroy();
});

test('level navigation and reset restore fixed layouts without recording abandoned rounds', async () => {
  const ui = await mount();
  const initial = ui.cells().map((c) => c.dataset.ports);
  ui.cells()[0].click(); ui.button('下一关').click();
  const select = ui.all().find((e) => e.tagName === 'select');
  assert.equal(Number(select.value), 2);
  ui.button('上一关').click();
  assert.deepEqual(ui.cells().map((c) => c.dataset.ports), initial);
  select.value = '20'; select.emit('change');
  assert.equal(ui.cells().length, 35);
  assert.equal(ui.button('下一关').disabled, true);
  ui.cells()[0].click(); ui.button('重置本关').click();
  assert.ok(ui.root.textContent.includes('0 步'));
  assert.equal(ui.writes.length, 0);
  ui.lifecycle.destroy();
});

test('pause and exit hide the board, return stays paused, destroy removes listener and nodes', async () => {
  const ui = await mount();
  ui.cells()[0].click();
  ui.lifecycle.deactivate();
  assert.equal(ui.cells().length, 0);
  ui.lifecycle.activate(); assert.equal(ui.cells().length, 0);
  ui.button('继续').click(); assert.equal(ui.cells().length, 12);
  ui.doc.hidden = true; ui.doc.events.get('visibilitychange')(); assert.equal(ui.cells().length, 0);
  ui.doc.hidden = false; ui.button('继续').click();
  ui.cells()[0].focus(); ui.cells()[0].emit('keydown', { key: 'Escape' });
  assert.equal(ui.cells().length, 0);
  assert.equal(ui.doc.activeElement, ui.button('继续'));
  ui.lifecycle.destroy(); ui.lifecycle.destroy(); ui.lifecycle.activate();
  assert.equal(ui.root.children.length, 0);
  assert.equal(ui.doc.events.size, 0);
  assert.equal(ui.writes.length, 0);
});

test('native output carries completed route, protects existing files and recognizes canceled saves', async () => {
  const requests = [];
  const toolbox = { files: { saveTextSupportsCopyOnly: true, async saveText(args) { requests.push(args); return { canceled: true }; } } };
  const ui = await mount(null, { toolbox });
  await winUI(ui);
  ui.button('导出通关记录').click(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].copyOnly, true);
  const data = JSON.parse(requests[0].content);
  assert.equal(data.feature, 'E004');
  assert.equal(data.recent[0].moves, 14);
  assert.equal(data.recent[0].path.length, 9);
  assert.ok(ui.root.textContent.includes('已取消导出'));
  ui.lifecycle.destroy();
});

test('bad stored records are ignored and save failures keep a finished round playable and exportable', async () => {
  const ui = await mount({ recent: [{ level: 100, moves: 1 }], best: [{}] }, { failSave: true });
  assert.equal(ui.button('导出通关记录').disabled, true);
  await winUI(ui);
  assert.ok(ui.root.textContent.includes('保存失败'));
  assert.equal(ui.button('导出通关记录').disabled, false);
  ui.button('重置本关').click();
  assert.equal(ui.cells().length, 12);
  ui.lifecycle.destroy();
});
