'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const feature = path.resolve(__dirname, '../src/renderer/features/E021');
const modelPromise = import(pathToFileURL(path.join(feature, 'model.mjs')).href);
const cardsPromise = import(pathToFileURL(path.join(feature, 'cards.mjs')).href);
const OPTIONS = { teams: ['红队', '蓝队'], roundsPerTeam: 1, durationSeconds: 60, pack: 'all', seed: 'demo' };

test('exactly 100 original cards have unique IDs/targets and three distinct non-target forbidden words', async () => {
  const { CARDS, PACKS } = await cardsPromise;
  assert.equal(CARDS.length, 100); assert.equal(new Set(CARDS.map((c) => c.id)).size, 100); assert.equal(new Set(CARDS.map((c) => c.target)).size, 100);
  for (const card of CARDS) {
    assert.equal(Object.isFrozen(card), true); assert.equal(Object.isFrozen(card.forbidden), true);
    assert.equal(card.forbidden.length, 3); assert.equal(new Set(card.forbidden).size, 3);
    assert.ok(card.target.length > 0); assert.ok(card.forbidden.every((word) => word.length > 0 && word !== card.target));
    assert.ok(Object.hasOwn(PACKS, card.pack));
  }
  for (const pack of ['daily', 'travel', 'hobby', 'food']) assert.equal(CARDS.filter((c) => c.pack === pack).length, 25);
});

test('settings validate distinct bounded team names, rounds, duration, pack and reproducible seed', async () => {
  const { validateOptions } = await modelPromise;
  for (const change of [{ teams: ['同队', '同队'] }, { teams: ['', '蓝队'] }, { teams: ['a'.repeat(21), 'B'] }, { teams: ['A\n', 'B\tC'] }, { teams: ['A'] }, { roundsPerTeam: 0 }, { roundsPerTeam: 6 }, { roundsPerTeam: 1.5 }, { durationSeconds: 29 }, { durationSeconds: 181 }, { pack: 'unknown' }, { seed: 'a'.repeat(33) }, { seed: 'bad seed' }]) assert.throws(() => validateOptions({ ...OPTIONS, ...change }), RangeError);
  assert.deepEqual(validateOptions({ ...OPTIONS, teams: [' 红队 ', ' 蓝队 '] }).teams, ['红队', '蓝队']);
});

test('seeded decks reproduce known first cards without duplicates for every pack', async () => {
  const { shuffledDeck } = await modelPromise;
  assert.deepEqual(shuffledDeck('all', 'demo').slice(0, 5).map((c) => c.id), ['C034', 'C026', 'C066', 'C042', 'C019']);
  for (const pack of ['all', 'daily', 'travel', 'hobby', 'food']) {
    const deck = shuffledDeck(pack, 'replay'); assert.equal(deck.length, pack === 'all' ? 100 : 25);
    assert.equal(new Set(deck.map((c) => c.id)).size, deck.length);
    assert.deepEqual(shuffledDeck(pack, 'replay').map((c) => c.id), deck.map((c) => c.id));
  }
});

test('cards only appear after explicit start, views are defensive and duplicate starts are rejected', async () => {
  const { Taboo } = await modelPromise; const game = new Taboo(OPTIONS);
  assert.equal(game.getView().card, null); assert.equal(game.getView().cardsUsed, 0); assert.equal(game.result(), null);
  assert.equal(game.startRound(), true); assert.equal(game.startRound(), false);
  const view = game.getView(); assert.equal(view.card.id, 'C034'); view.card.forbidden.pop(); view.scores[0] = 100; view.options.teams[0] = 'wrong';
  assert.equal(game.getView().card.forbidden.length, 3); assert.equal(game.getView().scores[0], 0); assert.equal(game.getView().options.teams[0], '红队');
});

test('host judgments use fixed scoring, reject stale card tickets and debounce fresh-card repeated clicks', async () => {
  const { Taboo } = await modelPromise; let now = 0; const game = new Taboo(OPTIONS, { now: () => now }); game.startRound();
  const ticket = game.getView().ticket; assert.equal(game.judge('hit', ticket).ok, true); assert.deepEqual(game.getView().scores, [1, 0]);
  assert.equal(game.judge('foul', ticket).reason, 'staleCard');
  assert.equal(game.judge('skip', game.getView().ticket).reason, 'cooldown');
  now = 250; assert.equal(game.judge('skip', game.getView().ticket).ok, true);
  now = 500; assert.equal(game.judge('foul', game.getView().ticket).ok, true);
  assert.equal(game.judge('invented', game.getView().ticket).reason, 'invalidOutcome');
  assert.deepEqual(game.getView().scores, [0, 0]); assert.deepEqual(game.getView().currentCounts, { hit: 1, skip: 1, foul: 1, unanswered: 0 });
});

test('60-second boundary locks judgments even if the ticker has not called getView yet', async () => {
  const { Taboo } = await modelPromise; let now = 0; const game = new Taboo(OPTIONS, { now: () => now }); game.startRound();
  const ticket = game.getView().ticket; now = 60000;
  assert.equal(game.judge('hit', ticket).reason, 'notRunning');
  const view = game.getView(); assert.equal(view.phase, 'between'); assert.equal(view.card, null); assert.equal(view.lastRound.reason, 'timeout');
  assert.equal(view.lastRound.elapsedMs, 60000); assert.equal(view.lastRound.events[0].outcome, 'unanswered'); assert.deepEqual(view.scores, [0, 0]);
  assert.equal(game.endRound(1), false); assert.equal(game.pause(), false);
});

test('pause freezes remaining time, hides card and rejects actions; resume excludes paused duration', async () => {
  const { Taboo } = await modelPromise; let now = 0; const game = new Taboo(OPTIONS, { now: () => now }); game.startRound();
  const ticket = game.getView().ticket; now = 2500; assert.equal(game.pause(), true); now += 90000;
  assert.equal(game.getView().remainingMs, 57500); assert.equal(game.getView().card, null); assert.equal(game.getView().ticket, null);
  assert.equal(game.judge('hit', ticket).ok, false); assert.equal(game.endRound(1), false);
  assert.equal(game.resume(), true); now += 1200; assert.equal(game.getView().remainingMs, 56300);
  assert.equal(game.judge('hit', ticket).ok, true); game.endRound(1); assert.equal(game.getView().lastRound.elapsedMs, 3700);
});

test('manual settlements alternate teams and produce a complete report with pending-card zero score', async () => {
  const { Taboo, cleanReport } = await modelPromise; let now = 0; const game = new Taboo(OPTIONS, { now: () => now }); game.startRound();
  for (const outcome of ['hit', 'skip', 'foul']) { game.judge(outcome, game.getView().ticket); now += 300; }
  assert.equal(game.endRound(1), true); assert.equal(game.endRound(1), false);
  assert.equal(game.getView().teamIndex, 1); assert.equal(game.result(), null); game.startRound();
  for (let i = 0; i < 2; i++) { game.judge('hit', game.getView().ticket); now += 300; }
  game.endRound(2); const report = game.result();
  assert.equal(report.reason, 'plannedRounds'); assert.deepEqual(report.scores, [0, 2]); assert.equal(report.winner, 1);
  assert.equal(report.rounds.length, 2); assert.equal(report.cardsUsed, 7);
  assert.deepEqual(report.rounds[0].counts, { hit: 1, skip: 1, foul: 1, unanswered: 1 });
  assert.equal(cleanReport(report).rounds[1].scoreDelta, 2); assert.equal(game.startRound(), false);
});

test('five rounds per team yields ten alternating settlements and ties are explicit', async () => {
  const { Taboo, cleanReport } = await modelPromise; const game = new Taboo({ ...OPTIONS, roundsPerTeam: 5 });
  for (let n = 1; n <= 10; n++) { assert.equal(game.getView().teamIndex, (n - 1) % 2); game.startRound(); game.endRound(n); }
  const report = game.result(); assert.equal(report.rounds.length, 10); assert.equal(report.winner, null); assert.equal(report.cardsUsed, 10);
  assert.ok(cleanReport(report));
});

test('topic deck exhaustion completes early with 25 unique cards and never automatically recycles', async () => {
  const { Taboo, cleanReport } = await modelPromise; let now = 0; const game = new Taboo({ ...OPTIONS, pack: 'daily', roundsPerTeam: 5 }, { now: () => now }); game.startRound();
  const seen = [];
  for (let i = 0; i < 25; i++) { const view = game.getView(); seen.push(view.card.id); assert.equal(game.judge('hit', view.ticket).ok, true); now += 300; }
  const report = game.result(); assert.equal(report.reason, 'deckExhausted'); assert.equal(report.rounds.length, 1); assert.equal(report.cardsUsed, 25);
  assert.equal(new Set(seen).size, 25); assert.deepEqual(report.scores, [25, 0]); assert.equal(game.getView().card, null); assert.equal(game.getView().deckLeft, 0);
  assert.ok(cleanReport(report)); assert.equal(game.startRound(), false);
});

test('unjudged expired card is consumed and cannot reappear in the next round', async () => {
  const { Taboo } = await modelPromise; let now = 0; const game = new Taboo(OPTIONS, { now: () => now }); game.startRound();
  const first = game.getView().card.id; now = 100000; assert.equal(game.getView().phase, 'between'); game.startRound();
  assert.notEqual(game.getView().card.id, first); assert.equal(game.getView().cardsUsed, 2); assert.equal(game.getView().remainingMs, 60000);
});

test('report loader rejects unbounded or mismatched data and retains at most three canonical reports', async () => {
  const { Taboo, cleanReport, cleanReports } = await modelPromise;
  const game = new Taboo(OPTIONS); for (let n = 1; n <= 2; n++) { game.startRound(); game.endRound(n); }
  const report = game.result(); const copy = (v) => JSON.parse(JSON.stringify(v));
  for (const change of [{ cardsUsed: 999 }, { rounds: [] }, { rounds: Array(11).fill(report.rounds[0]) }, { reason: 'unknown' }, { deckVersion: 2 }]) assert.equal(cleanReport({ ...report, ...change }), null);
  const invalid = copy(report); invalid.rounds[0].events[0].cardId = 'C999'; assert.equal(cleanReport(invalid), null);
  const changed = copy(report); changed.rounds[0].events[0].target = '<script>'; changed.scores = [100, 100];
  const clean = cleanReport(changed); assert.equal(clean.rounds[0].events[0].target, '地铁'); assert.deepEqual(clean.scores, [0, 0]);
  assert.equal(cleanReports(Array(10).fill(report)).length, 3);
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
    const event = { type, target: this, key: '', detail: 1, preventDefault() { this.defaultPrevented = true; }, ...props };
    const chain = []; for (let node = this; node; node = node.parent) chain.push(node);
    for (const node of chain) for (const listener of node.events?.get(type) || []) listener(event);
    return event;
  }
  click() { this.emit('click'); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map((x) => x.textContent).join(''); }
}

async function mount(saved = null, { failSave = false, toolbox = {} } = {}) {
  const model = await modelPromise; const cards = await cardsPromise;
  const doc = { activeElement: null, hidden: false, events: new Map(), createElement(tag) { return new Element(tag, this); }, createTextNode(text) { return { nodeType: 3, textContent: String(text) }; }, addEventListener(type, listener) { this.events.set(type, listener); }, removeEventListener(type) { this.events.delete(type); } };
  doc.body = doc.createElement('body'); const root = doc.createElement('main'); doc.body.append(root);
  let now = 0; let id = 1; const intervals = new Map(); const timeouts = new Map(); const writes = []; const revoked = [];
  const config = { get() { return saved; }, async set(_key, value) { if (failSave) throw new Error('storage unavailable'); writes.push(value); } };
  class FakeURL extends URL { static createObjectURL() { return `blob:E021-${id++}`; } static revokeObjectURL(url) { revoked.push(url); } }
  const context = vm.createContext({ document: doc, window: { toolbox }, console, URL: FakeURL, Blob, Date, Math, Promise, performance: { now: () => now }, setInterval(fn) { const next = id++; intervals.set(next, fn); return next; }, clearInterval(next) { intervals.delete(next); }, setTimeout(fn) { const next = id++; timeouts.set(next, fn); return next; }, clearTimeout(next) { timeouts.delete(next); }, ...model, ...cards, module: { exports: {} } });
  vm.runInContext(fs.readFileSync(path.resolve(feature, '../../core/ui.js'), 'utf8').replace(/export /g, '') + '\nmodule.exports = { h };', context); context.h = context.module.exports.h;
  const source = fs.readFileSync(path.join(feature, 'index.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace('export default', 'module.exports =').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(path.join(feature, 'index.js')).href));
  vm.runInContext(source, context); const lifecycle = context.module.exports.create(root, { config });
  const all = (node = root) => [node, ...node.children.flatMap((x) => x.nodeType === 1 ? all(x) : [])];
  const button = (text) => all().find((e) => e.tagName === 'button' && e.textContent === text);
  const field = (label) => all().find((e) => e.getAttribute('aria-label') === label);
  const card = () => all().find((e) => e.className === 'e021-card');
  const host = () => all().find((e) => e.className === 'e021-host');
  function setup(options = OPTIONS) { field('队伍 1 名称').value = options.teams[0]; field('队伍 2 名称').value = options.teams[1]; field('每队轮数').value = String(options.roundsPerTeam); field('每轮秒数').value = String(options.durationSeconds); field('题包').value = options.pack; field('局号').value = options.seed; button('建立新局').click(); }
  setup();
  return { doc, root, lifecycle, writes, all, button, field, card, host, setup, intervals, timeouts, revoked, advance(ms, tick = true) { now += ms; if (tick) for (const fn of intervals.values()) fn(); } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
function completePair(ui) {
  ui.button('开始第 1 轮').click();
  for (const outcome of ['猜中 +1', '跳过 0', '犯规 −1']) { ui.button(outcome).click(); ui.advance(300); }
  ui.button('提前结束本轮').click(); ui.button('开始第 2 轮').click();
  for (let i = 0; i < 2; i++) { ui.button('猜中 +1').click(); ui.advance(300); }
  ui.button('提前结束本轮').click();
}

test('UI shows rules/settings, one target and exactly three forbidden words without pre-start cards', async () => {
  const ui = await mount(); assert.equal(ui.card(), undefined); assert.ok(ui.root.textContent.includes('猜中 +1，跳过 0，犯规 −1，未判定 0'));
  ui.button('开始第 1 轮').click(); assert.ok(ui.card().textContent.includes('地铁')); assert.equal(ui.card().dataset.cardId, 'C034');
  const words = ui.all(ui.card()).filter((e) => e.tagName === 'li').map((e) => e.textContent);
  assert.deepEqual(words, ['地下', '车站', '轨道']); assert.equal(ui.intervals.size, 1); ui.lifecycle.destroy();
});

test('actual UI pair yields correct alternating scores and one complete report with foul details', async () => {
  const ui = await mount(); completePair(ui); await flush();
  assert.ok(ui.root.textContent.includes('蓝队 获胜')); assert.ok(ui.root.textContent.includes('最终比分 0 : 2'));
  assert.equal(ui.writes.length, 1); const report = ui.writes[0].recent[0]; assert.deepEqual(report.scores, [0, 2]);
  assert.equal(report.rounds[0].events[2].outcome, 'foul'); assert.equal(report.rounds[0].events[2].target, '围棋');
  assert.equal(report.rounds.length, 2); assert.equal(ui.intervals.size, 0);
  ui.lifecycle.activate(); await flush(); assert.equal(ui.writes.length, 1); ui.lifecycle.destroy();
});

test('UI 60-second timer removes judgment controls and late clicks cannot score without a ticker callback', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); const old = ui.button('猜中 +1');
  ui.advance(60000, false); old.click();
  assert.ok(ui.root.textContent.includes('本轮已锁定并结算')); assert.equal(ui.card(), undefined); assert.equal(ui.button('猜中 +1'), undefined);
  assert.ok(ui.root.textContent.includes('开始第 2 轮')); assert.equal(ui.intervals.size, 0);
  ui.button('开始第 2 轮').click(); ui.advance(60000); await flush();
  assert.deepEqual(ui.writes[0].recent[0].scores, [0, 0]); assert.equal(ui.writes[0].recent[0].rounds[0].elapsedMs, 60000); ui.lifecycle.destroy();
});

test('double-click detail, stale handlers, fresh-card cooldown and repeated hotkeys cannot consume extra cards', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); const old = ui.button('猜中 +1'); old.click();
  assert.equal(ui.card().dataset.cardId, 'C026'); ui.advance(300); old.click(); assert.equal(ui.card().dataset.cardId, 'C026');
  ui.button('猜中 +1').emit('click', { detail: 2 }); assert.equal(ui.card().dataset.cardId, 'C026');
  ui.host().emit('keydown', { key: '1', repeat: true }); assert.equal(ui.card().dataset.cardId, 'C026');
  ui.host().emit('keydown', { key: '2' }); assert.equal(ui.card().dataset.cardId, 'C066');
  ui.button('犯规 −1').click(); assert.equal(ui.card().dataset.cardId, 'C066'); assert.ok(ui.root.textContent.includes('防止连按误判'));
  ui.advance(300); ui.host().emit('keydown', { key: '3' }); assert.equal(ui.card().dataset.cardId, 'C042');
  assert.equal(ui.doc.activeElement, ui.host()); ui.lifecycle.destroy();
});

test('UI pause hides card, preserves same ticket, and elapsed report excludes ninety paused seconds', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); const first = ui.card().dataset.cardId;
  ui.advance(2500); ui.host().emit('keydown', { key: 'Escape' }); assert.equal(ui.card(), undefined); assert.equal(ui.intervals.size, 0);
  ui.advance(90000); ui.button('继续').click(); assert.equal(ui.card().dataset.cardId, first); ui.advance(1200);
  ui.button('提前结束本轮').click(); ui.button('开始第 2 轮').click(); ui.button('提前结束本轮').click(); await flush();
  assert.equal(ui.writes[0].recent[0].rounds[0].elapsedMs, 3700); ui.lifecycle.destroy();
});

test('invalid settings preserve live game, while a valid new game discards unfinished report and resets score', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); ui.button('猜中 +1').click(); const card = ui.card().dataset.cardId;
  ui.setup({ ...OPTIONS, teams: ['同队', '同队'] }); assert.ok(ui.root.textContent.includes('两队名称须不同')); assert.equal(ui.card().dataset.cardId, card);
  ui.setup(); assert.equal(ui.card(), undefined); assert.equal(ui.intervals.size, 0); assert.equal(ui.writes.length, 0);
  ui.button('开始第 1 轮').click(); assert.equal(ui.card().dataset.cardId, 'C034'); ui.lifecycle.destroy();
});

test('UI topic exhaustion explicitly finishes early, records bounded cards and removes all host actions', async () => {
  const ui = await mount(); ui.setup({ ...OPTIONS, pack: 'daily', roundsPerTeam: 5 }); ui.button('开始第 1 轮').click();
  for (let i = 0; i < 25; i++) { ui.button('猜中 +1').click(); ui.advance(300); }
  await flush(); assert.ok(ui.root.textContent.includes('题包耗尽，未完成计划轮次')); assert.equal(ui.card(), undefined); assert.equal(ui.intervals.size, 0);
  assert.equal(ui.writes[0].recent[0].cardsUsed, 25); assert.equal(ui.writes[0].recent[0].reason, 'deckExhausted'); ui.lifecycle.destroy();
});

test('complete reports persist at most three and native export is copyOnly with complete events and canceled state', async () => {
  const { Taboo } = await modelPromise; const game = new Taboo(OPTIONS); for (let n = 1; n <= 2; n++) { game.startRound(); game.endRound(n); }
  const calls = []; const ui = await mount({ recent: Array(10).fill(game.result()) }, { toolbox: { files: { saveTextSupportsCopyOnly: true, async saveText(args) { calls.push(args); return { canceled: true }; } } } });
  assert.equal(ui.all().filter((e) => e.tagName === 'button' && e.textContent === '导出此局').length, 3);
  completePair(ui); await flush(); assert.equal(ui.writes[0].recent.length, 3); ui.button('导出本局报告').click(); await flush();
  assert.equal(calls[0].copyOnly, true); const report = JSON.parse(calls[0].content); assert.equal(report.rounds[0].events[2].outcome, 'foul');
  assert.deepEqual(report.scoring, { hit: 1, skip: 0, foul: -1, unanswered: 0 }); assert.ok(ui.root.textContent.includes('已取消导出')); ui.lifecycle.destroy();
});

test('storage failure keeps full report exportable and browser downloads clean up URLs without unsafe native save', async () => {
  let called = 0; const ui = await mount(null, { failSave: true, toolbox: { files: { async saveText() { called++; } } } });
  completePair(ui); await flush(); assert.ok(ui.root.textContent.includes('保存失败')); ui.button('导出本局报告').click(); await flush();
  assert.equal(called, 0); assert.equal(ui.timeouts.size, 1); assert.ok(ui.root.textContent.includes('已提交完整局报告下载'));
  ui.lifecycle.destroy(); assert.equal(ui.timeouts.size, 0); assert.equal(ui.revoked.length, 1);
});

test('deactivate, visibility and destroy stop time/actions; reactivation requires manual continue', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); const old = ui.button('猜中 +1'); ui.advance(2000); ui.lifecycle.deactivate();
  old.click(); assert.equal(ui.intervals.size, 0); ui.advance(90000); ui.lifecycle.activate(); assert.ok(ui.root.textContent.includes('已暂停'));
  ui.button('继续').click(); ui.doc.hidden = true; ui.doc.events.get('visibilitychange')(); assert.equal(ui.card(), undefined); assert.equal(ui.intervals.size, 0);
  ui.doc.hidden = false; ui.doc.events.get('visibilitychange')(); assert.ok(ui.root.textContent.includes('已暂停')); ui.button('继续').click(); ui.advance(1000);
  ui.button('提前结束本轮').click(); ui.button('开始第 2 轮').click(); ui.button('提前结束本轮').click(); await flush();
  assert.equal(ui.writes[0].recent[0].rounds[0].elapsedMs, 3000); assert.deepEqual(ui.writes[0].recent[0].scores, [0, 0]);
  ui.lifecycle.destroy(); ui.lifecycle.destroy(); ui.lifecycle.activate(); assert.equal(ui.doc.events.size, 0); assert.equal(ui.root.children.length, 0); assert.equal(ui.intervals.size, 0);
});

test('destroy immediately after the final deadline still saves one completed report before the next timer callback', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); ui.button('提前结束本轮').click();
  ui.button('开始第 2 轮').emit('click', { detail: 2 }); assert.equal(ui.card(), undefined);
  ui.button('开始第 2 轮').click(); ui.button('暂停').click();
  ui.button('继续').emit('click', { detail: 2 }); assert.equal(ui.card(), undefined);
  ui.button('继续').click(); ui.advance(60000, false); ui.lifecycle.destroy(); await flush();
  assert.equal(ui.writes.length, 1); assert.equal(ui.writes[0].recent[0].rounds[1].reason, 'timeout'); assert.equal(ui.intervals.size, 0);
});
