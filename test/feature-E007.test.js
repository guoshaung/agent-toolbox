'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const feature = path.resolve(__dirname, '../src/renderer/features/E007');
const modelPromise = import(pathToFileURL(path.join(feature, 'model.mjs')).href);

test('seed and code limits reject unsupported lengths and characters', async () => {
  const { validateSeed, validateCode } = await modelPromise;
  for (const seed of ['', 'a'.repeat(33), '空', 'with space', 'x\n', 2293, null]) assert.throws(() => validateSeed(seed), RangeError);
  for (const code of ['', 'AAA', 'AAAAA', 'abcd', 'ABCG', null]) assert.throws(() => validateCode(code), RangeError);
  assert.equal(validateSeed('Round_7-demo'), 'Round_7-demo');
  assert.equal(validateCode('AABC'), 'AABC');
});

test('version-one generator is stable, four positions use all six colors, and duplicates are supported', async () => {
  const { generateSecret } = await modelPromise;
  assert.equal(generateSecret('2293'), 'AABC');
  assert.equal(generateSecret('demo'), 'FAAC');
  const used = new Set();
  for (let i = 0; i < 200; i++) {
    const seed = String(i); const secret = generateSecret(seed);
    assert.match(secret, /^[A-F]{4}$/); assert.equal(generateSecret(seed), secret);
    [...secret].forEach((c) => used.add(c));
  }
  assert.equal(used.size, 6);
});

test('multiset feedback never double-counts exact positions or duplicate colors', async () => {
  const { feedback } = await modelPromise;
  for (const [secret, guess, exact, colorOnly] of [
    ['AABC', 'ADAA', 1, 1], ['AAAA', 'AAAA', 4, 0], ['AABC', 'AAAA', 2, 0],
    ['AABB', 'BBAA', 0, 4], ['ABCD', 'EEEE', 0, 0], ['AABC', 'ABAA', 1, 2],
  ]) assert.deepEqual(feedback(secret, guess), { exact, colorOnly });
});

test('feedback agrees with independent total-frequency oracle for every 1296 code and multiple guesses', async () => {
  const { feedback } = await modelPromise;
  const alphabet = 'ABCDEF';
  for (let n = 0; n < 1296; n++) {
    let value = n; let secret = '';
    for (let i = 0; i < 4; i++) { secret += alphabet[value % 6]; value = Math.floor(value / 6); }
    for (const guess of ['AAAA', 'AABC', 'FFCC', [...secret].reverse().join('')]) {
      const exact = [...secret].filter((c, i) => guess[i] === c).length;
      const total = [...alphabet].reduce((sum, c) => sum + Math.min([...secret].filter((x) => x === c).length, [...guess].filter((x) => x === c).length), 0);
      const result = feedback(secret, guess);
      assert.deepEqual(result, { exact, colorOnly: total - exact });
      assert.ok(result.exact + result.colorOnly <= 4);
    }
  }
});

test('unfinished model views hide the answer and invalid guesses neither consume a round nor start time', async () => {
  const { ColorCode } = await modelPromise;
  let now = 0; const game = new ColorCode('2293', { now: () => now });
  assert.equal(game.getView().answer, null); assert.equal(game.result(), null);
  now += 2000; assert.equal(game.submit('ABC').reason, 'invalidGuess');
  assert.equal(game.getView().elapsedMs, 0); assert.equal(game.getView().rounds, 0);
  assert.deepEqual(game.submit('ADAA'), { ok: true, exact: 1, colorOnly: 1 });
  const view = game.getView(); assert.equal(view.answer, null); view.rows[0].guess = 'FFFF';
  assert.equal(game.getView().rows[0].guess, 'ADAA');
  now += 5000; assert.equal(game.getView().elapsedMs, 5000);
});

test('ten failed submissions reveal answer, freeze score and reject an eleventh guess', async () => {
  const { ColorCode } = await modelPromise;
  let now = 0; const game = new ColorCode('2293', { now: () => now });
  for (let i = 0; i < 10; i++) { now = i * 1000; assert.equal(game.submit('DDDD').ok, true); if (i < 9) assert.equal(game.getView().answer, null); }
  assert.equal(game.getView().phase, 'lost'); assert.equal(game.getView().answer, 'AABC');
  assert.equal(game.getView().rows.length, 10); assert.equal(game.getView().left, 0);
  assert.deepEqual(game.result(), { seed: '2293', outcome: 'lost', rounds: 10, elapsedMs: 9000 });
  now += 2000; assert.equal(game.submit('AABC').ok, false); assert.equal(game.pause(), false);
  assert.equal(game.result().elapsedMs, 9000);
});

test('correct guess on tenth round wins instead of being treated as failure', async () => {
  const { ColorCode } = await modelPromise;
  const game = new ColorCode('2293');
  for (let i = 0; i < 9; i++) game.submit('DDDD');
  game.submit('AABC'); assert.equal(game.getView().phase, 'won'); assert.equal(game.result().rounds, 10);
  assert.equal(game.submit('AABC').ok, false);
});

test('pause hides prior rows, blocks guesses and excludes paused duration', async () => {
  const { ColorCode } = await modelPromise;
  let now = 100; const game = new ColorCode('2293', { now: () => now });
  assert.equal(game.pause(), false); game.submit('ADAA'); now += 2500;
  assert.equal(game.pause(), true); now += 90000;
  assert.equal(game.getView().elapsedMs, 2500); assert.deepEqual(game.getView().rows, []);
  assert.equal(game.getView().answer, null); assert.equal(game.submit('AABC').ok, false);
  assert.equal(game.resume(), true); now += 1200; game.submit('AABC');
  assert.equal(game.result().elapsedMs, 3700); assert.equal(game.result().rounds, 2);
});

test('records stay bounded and strip unexpected answer and history fields', async () => {
  const { cleanRecords, validRecord } = await modelPromise;
  const record = { seed: '2293', outcome: 'won', rounds: 2, elapsedMs: 5000, finishedAt: '2026-10-02T00:00:00.000Z' };
  for (const change of [{ seed: '' }, { outcome: 'running' }, { rounds: 11 }, { rounds: 0 }, { outcome: 'lost', rounds: 9 }, { elapsedMs: -1 }]) assert.equal(validRecord({ ...record, ...change }), false);
  const clean = cleanRecords(Array.from({ length: 50 }, () => ({ ...record, secret: 'AABC', guesses: ['ADAA', 'AABC'] })));
  assert.equal(clean.length, 20); assert.deepEqual(clean[0], record); assert.equal(clean[0].secret, undefined);
});

class Element {
  constructor(tag, doc) { this.nodeType = 1; this.tagName = tag; this.doc = doc; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.events = new Map(); this.value = ''; this.disabled = false; this._text = ''; this.className = ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; }
  getAttribute(key) { return this.attributes[key]; }
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  replaceChildren(...items) { this.children.forEach((x) => { x.parent = null; }); this.children = []; this._text = ''; this.append(...items); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
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
  let now = 0; let id = 1; const intervals = new Map(); const timeouts = new Map(); const writes = []; const revoked = [];
  const config = { get() { return saved; }, async set(_key, value) { if (failSave) throw new Error('storage unavailable'); writes.push(value); } };
  class FakeURL extends URL { static createObjectURL() { return `blob:E007-${id++}`; } static revokeObjectURL(url) { revoked.push(url); } }
  const context = vm.createContext({ document: doc, window: { toolbox }, console, URL: FakeURL, Blob, Date, Math, Promise, performance: { now: () => now }, setInterval(fn) { const next = id++; intervals.set(next, fn); return next; }, clearInterval(next) { intervals.delete(next); }, setTimeout(fn) { const next = id++; timeouts.set(next, fn); return next; }, clearTimeout(next) { timeouts.delete(next); }, ...model, module: { exports: {} } });
  vm.runInContext(fs.readFileSync(path.resolve(feature, '../../core/ui.js'), 'utf8').replace(/export /g, '') + '\nmodule.exports = { h };', context);
  context.h = context.module.exports.h;
  const source = fs.readFileSync(path.join(feature, 'index.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace('export default', 'module.exports =').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(path.join(feature, 'index.js')).href));
  vm.runInContext(source, context);
  const lifecycle = context.module.exports.create(root, { config });
  const all = (node = root) => [node, ...node.children.flatMap((x) => x.nodeType === 1 ? all(x) : [])];
  const button = (text) => all().find((e) => e.tagName === 'button' && e.textContent === text);
  const slots = () => all().filter((e) => e.tagName === 'button' && e.dataset.position !== undefined);
  const palette = (color) => all().find((e) => e.tagName === 'button' && e.dataset.color === color);
  const seedInput = all().find((e) => e.getAttribute('aria-label') === '局号');
  function seed(value) { seedInput.value = value; button('按局号开局').click(); }
  seed('2293');
  return { doc, root, lifecycle, writes, all, slots, palette, button, seed, seedInput, intervals, timeouts, revoked, advance(ms) { now += ms; for (const fn of intervals.values()) fn(); } };
}

function guess(ui, code) { for (const color of code) ui.palette(color).click(); ui.button('提交猜测').click(); }
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('UI offers six letter-marked colors and never embeds the unfinished answer in accessible DOM', async () => {
  const ui = await mount();
  assert.equal(ui.slots().length, 4);
  for (const color of 'ABCDEF') { assert.ok(ui.palette(color).textContent.startsWith(color)); assert.ok(ui.palette(color).getAttribute('aria-label').startsWith(color)); }
  const domText = () => ui.all().map((e) => `${e.textContent} ${JSON.stringify(e.attributes)} ${JSON.stringify(e.dataset)}`).join('\n');
  assert.equal(domText().includes('AABC'), false);
  ui.button('提交猜测').click(); assert.ok(ui.root.textContent.includes('未填满不消耗轮数'));
  assert.equal(ui.intervals.size, 0); assert.equal(ui.writes.length, 0);
  guess(ui, 'ADAA'); assert.equal(domText().includes('AABC'), false);
  ui.lifecycle.destroy();
});

test('palette UI sample ADAA yields 1 exact and 1 color-only; AABC wins and records just once', async () => {
  const ui = await mount(); guess(ui, 'ADAA');
  assert.ok(ui.root.textContent.includes('位置命中 1 · 仅颜色命中 1')); assert.equal(ui.intervals.size, 1);
  ui.advance(2500); guess(ui, 'AABC'); await flush();
  assert.ok(ui.root.textContent.includes('第 2 轮通关')); assert.ok(ui.root.textContent.includes('答案：AABC'));
  assert.equal(ui.intervals.size, 0); assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].recent[0].rounds, 2); assert.equal(ui.writes[0].recent[0].elapsedMs, 2500);
  ui.lifecycle.activate(); await flush(); assert.equal(ui.writes.length, 1); ui.lifecycle.destroy();
});

test('keyboard selects letters, edits a position and submits a complete four-letter guess', async () => {
  const ui = await mount();
  ui.slots()[0].focus();
  for (const key of ['A', 'A', 'B', 'D']) ui.doc.activeElement.emit('keydown', { key });
  assert.deepEqual(ui.slots().map((s) => s.textContent), ['A', 'A', 'B', 'D']);
  ui.doc.activeElement.emit('keydown', { key: 'End' }); assert.equal(ui.doc.activeElement, ui.slots()[3]);
  ui.doc.activeElement.emit('keydown', { key: 'Delete' }); assert.equal(ui.slots()[3].textContent, '?');
  ui.doc.activeElement.emit('keydown', { key: 'c' });
  ui.doc.activeElement.emit('keydown', { key: 'Enter' });
  assert.ok(ui.root.textContent.includes('第 1 轮通关')); ui.lifecycle.destroy();
});

test('ten-round UI failure shows answer only at the end and offers replay with a hidden fresh answer', async () => {
  const ui = await mount();
  for (let i = 0; i < 10; i++) { guess(ui, 'DDDD'); if (i < 9) assert.equal(ui.root.textContent.includes('答案：'), false); }
  await flush(); assert.ok(ui.root.textContent.includes('十轮已用完')); assert.ok(ui.root.textContent.includes('答案：AABC'));
  assert.equal(ui.writes[0].recent[0].outcome, 'lost'); assert.equal(ui.writes[0].recent[0].rounds, 10);
  assert.equal(ui.slots().length, 0); ui.button('重玩此局').click();
  assert.equal(ui.root.textContent.includes('AABC'), false); assert.equal(ui.slots().length, 4); assert.equal(ui.intervals.size, 0);
  ui.lifecycle.destroy();
});

test('UI pauses by button and Escape, hides rows and draft, and preserves both on manual resume', async () => {
  const ui = await mount(); guess(ui, 'ADAA'); ui.palette('F').click(); ui.advance(2500);
  ui.doc.activeElement.emit('keydown', { key: 'Escape' }); assert.ok(ui.root.textContent.includes('已暂停'));
  assert.equal(ui.slots().length, 0); assert.equal(ui.root.textContent.includes('位置命中 1 · 仅颜色命中 1'), false);
  assert.equal(ui.intervals.size, 0); ui.advance(90000); ui.button('继续').click();
  assert.equal(ui.slots()[0].textContent, 'F'); assert.ok(ui.root.textContent.includes('位置命中 1 · 仅颜色命中 1'));
  ui.button('清空输入').click(); ui.advance(1200); guess(ui, 'AABC'); await flush();
  assert.equal(ui.writes[0].recent[0].elapsedMs, 3700); ui.lifecycle.destroy();
});

test('invalid seed preserves the round; reset clears draft and prior guesses without a result', async () => {
  const ui = await mount(); guess(ui, 'ADAA');
  ui.seed('bad seed'); assert.ok(ui.root.textContent.includes('局号须为')); assert.ok(ui.root.textContent.includes('位置命中 1 · 仅颜色命中 1'));
  ui.button('重玩本局').click(); assert.equal(ui.root.textContent.includes('位置命中 1 · 仅颜色命中 1'), false);
  assert.deepEqual(ui.slots().map((s) => s.textContent), ['?', '?', '?', '?']); assert.equal(ui.intervals.size, 0); assert.equal(ui.writes.length, 0);
  guess(ui, 'AABC'); assert.ok(ui.root.textContent.includes('第 1 轮通关')); ui.lifecycle.destroy();
});

test('loaded scores and newly saved scores cap at twenty and strip answer fields before replay or export', async () => {
  const old = { seed: '2293', outcome: 'won', rounds: 2, elapsedMs: 3000, answer: 'AABC', guesses: ['AABC'] };
  const ui = await mount({ recent: Array.from({ length: 50 }, () => old) });
  assert.equal(ui.root.textContent.includes('AABC'), false);
  assert.equal(ui.all().filter((e) => e.tagName === 'button' && e.textContent === '重玩此局').length, 20);
  guess(ui, 'AABC'); await flush(); assert.equal(ui.writes[0].recent.length, 20);
  assert.equal(ui.writes[0].recent[0].rounds, 1); assert.equal(ui.writes[0].recent[1].answer, undefined);
  ui.lifecycle.destroy();
});

test('native export always requests copyOnly and reports cancellation without claiming success', async () => {
  const calls = [];
  const ui = await mount(null, { toolbox: { files: { saveTextSupportsCopyOnly: true, async saveText(args) { calls.push(args); return { canceled: true }; } } } });
  guess(ui, 'AABC'); await flush(); ui.button('导出成绩').click(); await flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].copyOnly, true);
  const payload = JSON.parse(calls[0].content); assert.equal(payload.generatorVersion, 1); assert.equal(payload.recent[0].seed, '2293'); assert.equal(payload.recent[0].answer, undefined);
  assert.ok(ui.root.textContent.includes('已取消导出')); ui.lifecycle.destroy();
});

test('storage failure keeps completed in-memory score exportable', async () => {
  const ui = await mount(null, { failSave: true }); guess(ui, 'AABC'); await flush();
  assert.ok(ui.root.textContent.includes('保存失败')); assert.equal(ui.button('导出成绩').disabled, false);
  assert.ok(ui.root.textContent.includes('1 轮通关')); ui.lifecycle.destroy();
});

test('fallback download avoids unsupported native overwrite and revokes URLs on destroy', async () => {
  let calls = 0;
  const ui = await mount(null, { toolbox: { files: { async saveText() { calls++; } } } });
  guess(ui, 'AABC'); await flush(); ui.button('导出成绩').click(); await flush();
  assert.equal(calls, 0); assert.equal(ui.timeouts.size, 1); assert.ok(ui.root.textContent.includes('已提交成绩文件下载'));
  ui.lifecycle.destroy(); assert.equal(ui.timeouts.size, 0); assert.equal(ui.revoked.length, 1);
});

test('deactivate and visibility stop timing; activation stays paused and destruction cleans everything', async () => {
  const ui = await mount(); guess(ui, 'ADAA'); ui.advance(2000); ui.lifecycle.deactivate();
  assert.equal(ui.intervals.size, 0); ui.seed('demo'); ui.advance(90000); ui.lifecycle.activate();
  assert.ok(ui.root.textContent.includes('已暂停')); assert.ok(ui.root.textContent.includes('2293')); ui.button('继续').click();
  ui.doc.hidden = true; ui.doc.events.get('visibilitychange')(); assert.equal(ui.intervals.size, 0);
  ui.doc.hidden = false; ui.doc.events.get('visibilitychange')(); assert.ok(ui.root.textContent.includes('已暂停'));
  ui.button('继续').click(); ui.advance(1000); guess(ui, 'AABC'); await flush();
  assert.equal(ui.writes[0].recent[0].elapsedMs, 3000);
  ui.lifecycle.destroy(); ui.lifecycle.destroy(); ui.lifecycle.activate();
  assert.equal(ui.doc.events.size, 0); assert.equal(ui.root.children.length, 0); assert.equal(ui.intervals.size, 0);
});
