'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const feature = path.resolve(__dirname, '../src/renderer/features/E023');
const modelPromise = import(pathToFileURL(path.join(feature, 'model.mjs')).href);
const cardsPromise = import(pathToFileURL(path.join(feature, 'cards.mjs')).href);
const OPTIONS = { teams: ['红队', '蓝队'], roundsPerTeam: 1, durationSeconds: 60, pack: 'all', seed: 'demo' };

test('150 immutable original topics have unique IDs/targets with 50 actions, 50 objects and 50 jobs', async () => {
  const { CARDS } = await cardsPromise;
  assert.equal(CARDS.length, 150); assert.equal(new Set(CARDS.map((c) => c.id)).size, 150); assert.equal(new Set(CARDS.map((c) => c.target)).size, 150);
  for (const card of CARDS) { assert.equal(Object.isFrozen(card), true); assert.ok(card.target.length > 0); assert.match(card.id, /^P\d{3}$/); assert.equal(card.forbidden, undefined); }
  for (const pack of ['action', 'object', 'job']) assert.equal(CARDS.filter((c) => c.pack === pack).length, 50);
});

test('settings validate bounded distinct names, round count, duration, topic pack and replay seed', async () => {
  const { validateOptions } = await modelPromise;
  for (const change of [{ teams: ['同队', '同队'] }, { teams: ['', 'B'] }, { teams: ['a'.repeat(21), 'B'] }, { teams: ['A', 'B\nC'] }, { teams: ['A'] }, { roundsPerTeam: 0 }, { roundsPerTeam: 6 }, { roundsPerTeam: 1.5 }, { durationSeconds: 29 }, { durationSeconds: 181 }, { pack: 'daily' }, { seed: 'a'.repeat(33) }, { seed: 'bad seed' }]) assert.throws(() => validateOptions({ ...OPTIONS, ...change }), RangeError);
  assert.deepEqual(validateOptions({ ...OPTIONS, teams: [' 红队 ', ' 蓝队 '] }).teams, ['红队', '蓝队']);
});

test('seeded decks reproduce known topics without repetition for every topic pack', async () => {
  const { shuffledDeck } = await modelPromise;
  assert.deepEqual(shuffledDeck('all', 'demo').slice(0, 6).map((c) => c.id), ['P148', 'P081', 'P099', 'P027', 'P066', 'P012']);
  for (const pack of ['all', 'action', 'object', 'job']) {
    const deck = shuffledDeck(pack, 'replay'); assert.equal(deck.length, pack === 'all' ? 150 : 50);
    assert.equal(new Set(deck.map((c) => c.id)).size, deck.length); assert.deepEqual(shuffledDeck(pack, 'replay').map((c) => c.id), deck.map((c) => c.id));
  }
});

test('cards are hidden until explicit start, view mutation cannot change state and duplicate starts fail', async () => {
  const { Charades } = await modelPromise; const game = new Charades(OPTIONS);
  assert.equal(game.getView().card, null); assert.equal(game.getView().cardsUsed, 0); assert.equal(game.result(), null);
  assert.equal(game.startRound(), true); assert.equal(game.startRound(), false);
  const view = game.getView(); assert.equal(view.card.target, '教师'); view.card.target = 'wrong'; view.scores[0] = 100; view.options.teams[0] = 'wrong';
  assert.equal(game.getView().card.target, '教师'); assert.equal(game.getView().scores[0], 0); assert.equal(game.getView().options.teams[0], '红队');
});

test('only hit and skip are accepted, with stale-ticket and fresh-card cooldown protection', async () => {
  const { Charades } = await modelPromise; let now = 0; const game = new Charades(OPTIONS, { now: () => now }); game.startRound();
  const ticket = game.getView().ticket; assert.equal(game.judge('hit', ticket).ok, true); assert.deepEqual(game.getView().scores, [1, 0]);
  assert.equal(game.judge('skip', ticket).reason, 'staleCard'); assert.equal(game.judge('skip', game.getView().ticket).reason, 'cooldown');
  now = 250; assert.equal(game.judge('skip', game.getView().ticket).ok, true); assert.equal(game.judge('foul', game.getView().ticket).reason, 'invalidOutcome');
  assert.deepEqual(game.getView().currentCounts, { hit: 1, skip: 1, unanswered: 0 }); assert.deepEqual(game.getView().scores, [1, 0]);
});

test('60-second boundary freezes scoring without waiting for a ticker, while 59.999 seconds still allows a hit', async () => {
  const { Charades } = await modelPromise; let now = 0; const game = new Charades(OPTIONS, { now: () => now }); game.startRound();
  now = 59999; assert.equal(game.judge('hit', game.getView().ticket).ok, true); const ticket = game.getView().ticket;
  now = 60000; assert.equal(game.judge('hit', ticket).reason, 'notRunning');
  const view = game.getView(); assert.equal(view.phase, 'between'); assert.equal(view.card, null); assert.equal(view.lastRound.elapsedMs, 60000);
  assert.equal(view.lastRound.reason, 'timeout'); assert.equal(view.lastRound.events.at(-1).outcome, 'unanswered'); assert.deepEqual(view.scores, [1, 0]);
  assert.equal(game.endRound(1), false); assert.equal(game.pause(), false);
});

test('pause freezes remaining time, hides topic and blocks actions, then excludes paused duration', async () => {
  const { Charades } = await modelPromise; let now = 0; const game = new Charades(OPTIONS, { now: () => now }); game.startRound();
  const ticket = game.getView().ticket; now = 2500; assert.equal(game.pause(), true); now += 90000;
  assert.equal(game.getView().remainingMs, 57500); assert.equal(game.getView().card, null); assert.equal(game.getView().ticket, null);
  assert.equal(game.judge('hit', ticket).ok, false); assert.equal(game.endRound(1), false); assert.equal(game.resume(), true);
  now += 1200; assert.equal(game.judge('hit', ticket).ok, true); game.endRound(1); assert.equal(game.getView().lastRound.elapsedMs, 3700);
});

test('complete pair alternates teams and returns 1:2 with canonical round/team rankings and six consumed topics', async () => {
  const { Charades, cleanReport } = await modelPromise; let now = 0; const game = new Charades(OPTIONS, { now: () => now }); game.startRound();
  for (const outcome of ['hit', 'skip']) { game.judge(outcome, game.getView().ticket); now += 300; }
  assert.equal(game.endRound(1), true); assert.equal(game.endRound(1), false); assert.equal(game.getView().teamIndex, 1); game.startRound();
  for (let i = 0; i < 2; i++) { game.judge('hit', game.getView().ticket); now += 300; }
  game.endRound(2); const report = game.result(); assert.deepEqual(report.scores, [1, 2]); assert.equal(report.winner, 1); assert.equal(report.cardsUsed, 6);
  assert.equal(report.teamRanking[0].teamName, '蓝队'); assert.equal(report.roundRanking[0].number, 2); assert.equal(report.roundRanking[0].hits, 2);
  assert.deepEqual(report.rounds[0].counts, { hit: 1, skip: 1, unanswered: 1 }); assert.ok(cleanReport(report)); assert.equal(game.startRound(), false);
});

test('round rankings use shared ranks for equal hit counts and never break ties by time', async () => {
  const { Charades } = await modelPromise; let now = 0; const game = new Charades({ ...OPTIONS, roundsPerTeam: 2 }, { now: () => now });
  for (const [i, hits] of [1, 3, 3, 0].entries()) { game.startRound(); for (let n = 0; n < hits; n++) { game.judge('hit', game.getView().ticket); now += 300; } game.endRound(i + 1); }
  const report = game.result(); assert.deepEqual(report.roundRanking.map((r) => [r.number, r.rank]), [[2, 1], [3, 1], [1, 3], [4, 4]]); assert.deepEqual(report.scores, [4, 3]);
  const tie = new Charades(OPTIONS); for (let n = 1; n <= 2; n++) { tie.startRound(); tie.endRound(n); }
  assert.equal(tie.result().winner, null); assert.deepEqual(tie.result().teamRanking.map((r) => r.rank), [1, 1]);
});

test('all 150 topics can be consumed exactly once, then exhaustion ends early with a bounded report', async () => {
  const { Charades, cleanReport } = await modelPromise; let now = 0; const game = new Charades({ ...OPTIONS, roundsPerTeam: 5 }, { now: () => now }); game.startRound();
  const seen = []; for (let i = 0; i < 150; i++) { const view = game.getView(); seen.push(view.card.id); assert.equal(game.judge('hit', view.ticket).ok, true); now += 300; }
  const report = game.result(); assert.equal(report.reason, 'deckExhausted'); assert.equal(report.rounds.length, 1); assert.equal(report.cardsUsed, 150);
  assert.equal(new Set(seen).size, 150); assert.deepEqual(report.scores, [150, 0]); assert.equal(game.getView().card, null); assert.ok(cleanReport(report)); assert.equal(game.startRound(), false);
});

test('an unjudged expired topic is consumed and cannot repeat when the other team starts', async () => {
  const { Charades } = await modelPromise; let now = 0; const game = new Charades(OPTIONS, { now: () => now }); game.startRound();
  const first = game.getView().card.id; now = 100000; assert.equal(game.getView().phase, 'between'); game.startRound();
  assert.notEqual(game.getView().card.id, first); assert.equal(game.getView().cardsUsed, 2); assert.equal(game.getView().remainingMs, 60000);
});

test('report validation bounds cards/rounds and reconstructs topic text, scores and rankings from known data', async () => {
  const { Charades, cleanReport, cleanReports } = await modelPromise;
  const game = new Charades(OPTIONS); for (let n = 1; n <= 2; n++) { game.startRound(); game.endRound(n); }
  const report = game.result();
  for (const change of [{ cardsUsed: 999 }, { rounds: [] }, { rounds: Array(11).fill(report.rounds[0]) }, { reason: 'unknown' }, { deckVersion: 2 }]) assert.equal(cleanReport({ ...report, ...change }), null);
  const bad = JSON.parse(JSON.stringify(report)); bad.rounds[0].events[0].cardId = 'P999'; assert.equal(cleanReport(bad), null);
  const changed = JSON.parse(JSON.stringify(report)); changed.rounds[0].events[0].target = '<script>'; changed.scores = [999, 999]; changed.teamRanking = [];
  const clean = cleanReport(changed); assert.equal(clean.rounds[0].events[0].target, '教师'); assert.deepEqual(clean.scores, [0, 0]); assert.equal(clean.teamRanking.length, 2);
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

async function mount(saved = null, { failSave = false, toolbox = {}, activate = true } = {}) {
  const model = await modelPromise; const cards = await cardsPromise;
  const doc = { activeElement: null, hidden: false, events: new Map(), createElement(tag) { return new Element(tag, this); }, createTextNode(text) { return { nodeType: 3, textContent: String(text) }; }, addEventListener(type, listener) { this.events.set(type, listener); }, removeEventListener(type) { this.events.delete(type); } };
  doc.body = doc.createElement('body'); const root = doc.createElement('main'); doc.body.append(root);
  let now = 0; let id = 1; const intervals = new Map(); const timeouts = new Map(); const writes = []; const revoked = [];
  const config = { get() { return saved; }, async set(_key, value) { if (failSave) throw new Error('storage unavailable'); writes.push(value); } };
  class FakeURL extends URL { static createObjectURL() { return `blob:E023-${id++}`; } static revokeObjectURL(url) { revoked.push(url); } }
  const context = vm.createContext({ document: doc, window: { toolbox }, console, URL: FakeURL, Blob, Date, Math, Promise, performance: { now: () => now }, setInterval(fn) { const next = id++; intervals.set(next, fn); return next; }, clearInterval(next) { intervals.delete(next); }, setTimeout(fn) { const next = id++; timeouts.set(next, fn); return next; }, clearTimeout(next) { timeouts.delete(next); }, ...model, ...cards, module: { exports: {} } });
  vm.runInContext(fs.readFileSync(path.resolve(feature, '../../core/ui.js'), 'utf8').replace(/export /g, '') + '\nmodule.exports = { h };', context); context.h = context.module.exports.h;
  const source = fs.readFileSync(path.join(feature, 'index.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace('export default', 'module.exports =').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(path.join(feature, 'index.js')).href));
  vm.runInContext(source, context); const lifecycle = context.module.exports.create(root, { config });
  const all = (node = root) => [node, ...node.children.flatMap((x) => x.nodeType === 1 ? all(x) : [])];
  const button = (text) => all().find((e) => e.tagName === 'button' && e.textContent === text);
  const field = (label) => all().find((e) => e.getAttribute('aria-label') === label);
  const card = () => all().find((e) => e.className === 'e023-card');
  const host = () => all().find((e) => e.className === 'e023-host');
  function setup(options = OPTIONS) { field('队伍 1 名称').value = options.teams[0]; field('队伍 2 名称').value = options.teams[1]; field('每队轮数').value = String(options.roundsPerTeam); field('每轮秒数').value = String(options.durationSeconds); field('题包').value = options.pack; field('局号').value = options.seed; button('建立新局').click(); }
  if (activate) { lifecycle.activate(); setup(); }
  return { doc, root, lifecycle, writes, all, button, field, card, host, setup, intervals, timeouts, revoked, advance(ms, tick = true) { now += ms; if (tick) for (const fn of intervals.values()) fn(); } };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
function completePair(ui) {
  ui.button('开始第 1 轮').click();
  for (const outcome of ['猜中 +1', '跳过 0']) { ui.button(outcome).click(); ui.advance(300); }
  ui.button('提前结束本轮').click(); ui.button('开始第 2 轮').click();
  for (let i = 0; i < 2; i++) { ui.button('猜中 +1').click(); ui.advance(300); }
  ui.button('提前结束本轮').click();
}

test('create only prepares UI, activation enables play, and no camera/microphone APIs are used', async () => {
  const ui = await mount(null, { activate: false });
  assert.equal(ui.intervals.size, 0); ui.button('开始第 1 轮').click(); assert.equal(ui.card(), undefined);
  ui.lifecycle.activate(); ui.setup(); ui.button('开始第 1 轮').click(); assert.equal(ui.intervals.size, 1);
  const source = fs.readFileSync(path.join(feature, 'index.js'), 'utf8');
  assert.doesNotMatch(source, /getUserMedia|MediaRecorder|SpeechRecognition|AudioContext|navigator\.mediaDevices/);
  ui.lifecycle.destroy();
});

test('UI shows no-speech rules, topic pack sizes and one visible performance topic after start', async () => {
  const ui = await mount(); assert.equal(ui.card(), undefined); assert.ok(ui.root.textContent.includes('不能发声、写字或用口型'));
  assert.ok(ui.root.textContent.includes('全部题目 · 150 题')); assert.ok(ui.root.textContent.includes('职业 · 50 题'));
  ui.button('开始第 1 轮').click(); assert.equal(ui.card().dataset.cardId, 'P148'); assert.ok(ui.card().textContent.includes('教师'));
  assert.equal(ui.button('犯规 −1'), undefined); assert.equal(ui.intervals.size, 1); ui.lifecycle.destroy();
});

test('actual UI pair produces 1:2, one complete report and displayed team and round rankings', async () => {
  const ui = await mount(); completePair(ui); await flush(); assert.ok(ui.root.textContent.includes('蓝队 获胜')); assert.ok(ui.root.textContent.includes('最终比分 1 : 2'));
  assert.ok(ui.root.textContent.includes('第 1 名 · 蓝队 · 2 分')); assert.ok(ui.root.textContent.includes('轮次排名'));
  const report = ui.writes[0].recent[0]; assert.deepEqual(report.scores, [1, 2]); assert.equal(report.rounds[0].events[1].outcome, 'skip'); assert.equal(report.cardsUsed, 6);
  assert.equal(report.roundRanking[0].number, 2); assert.equal(ui.writes.length, 1); assert.equal(ui.intervals.size, 0);
  ui.lifecycle.activate(); await flush(); assert.equal(ui.writes.length, 1); ui.lifecycle.destroy();
});

test('UI locks after sixty seconds and late clicks cannot add points even before a ticker callback', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); const old = ui.button('猜中 +1'); ui.advance(60000, false); old.click();
  assert.ok(ui.root.textContent.includes('本轮已锁定并结算')); assert.equal(ui.card(), undefined); assert.equal(ui.button('猜中 +1'), undefined); assert.equal(ui.intervals.size, 0);
  ui.button('开始第 2 轮').click(); assert.equal(ui.card().dataset.cardId, 'P081'); ui.advance(60000); await flush();
  assert.deepEqual(ui.writes[0].recent[0].scores, [0, 0]); assert.equal(ui.writes[0].recent[0].rounds[0].elapsedMs, 60000); ui.lifecycle.destroy();
});

test('double-click detail, stale handlers, fresh-topic cooldown and held shortcuts cannot consume extra topics', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); const old = ui.button('猜中 +1'); old.click();
  assert.equal(ui.card().dataset.cardId, 'P081'); ui.advance(300); old.click(); assert.equal(ui.card().dataset.cardId, 'P081');
  ui.button('猜中 +1').emit('click', { detail: 2 }); ui.host().emit('keydown', { key: '1', repeat: true }); assert.equal(ui.card().dataset.cardId, 'P081');
  ui.host().emit('keydown', { key: '2' }); assert.equal(ui.card().dataset.cardId, 'P099'); ui.button('猜中 +1').click();
  assert.equal(ui.card().dataset.cardId, 'P099'); assert.ok(ui.root.textContent.includes('防止连按误判')); ui.advance(300);
  ui.host().emit('keydown', { key: '1' }); assert.equal(ui.card().dataset.cardId, 'P027'); assert.equal(ui.doc.activeElement, ui.host()); ui.lifecycle.destroy();
});

test('UI pause hides the same topic and completion report excludes ninety seconds of pause', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); const id = ui.card().dataset.cardId; ui.advance(2500);
  ui.host().emit('keydown', { key: 'Escape' }); assert.equal(ui.card(), undefined); assert.equal(ui.intervals.size, 0); ui.advance(90000);
  ui.button('继续').click(); assert.equal(ui.card().dataset.cardId, id); ui.advance(1200); ui.button('提前结束本轮').click();
  ui.button('开始第 2 轮').click(); ui.button('提前结束本轮').click(); await flush(); assert.equal(ui.writes[0].recent[0].rounds[0].elapsedMs, 3700); ui.lifecycle.destroy();
});

test('invalid settings preserve the current game, while establishing a valid new game resets score and discards unfinished reports', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); ui.button('猜中 +1').click(); const id = ui.card().dataset.cardId;
  ui.setup({ ...OPTIONS, teams: ['同队', '同队'] }); assert.ok(ui.root.textContent.includes('两队名称须不同')); assert.equal(ui.card().dataset.cardId, id);
  ui.setup(); assert.equal(ui.card(), undefined); assert.equal(ui.intervals.size, 0); assert.equal(ui.writes.length, 0);
  ui.button('开始第 1 轮').click(); assert.equal(ui.card().dataset.cardId, 'P148'); ui.lifecycle.destroy();
});

test('UI fifty-topic pack exhaustion explicitly ends early and records no repeated topics', async () => {
  const ui = await mount(); ui.setup({ ...OPTIONS, pack: 'job', roundsPerTeam: 5 }); ui.button('开始第 1 轮').click();
  for (let n = 0; n < 50; n++) { ui.button('猜中 +1').click(); ui.advance(300); }
  await flush(); assert.ok(ui.root.textContent.includes('题包耗尽，未完成计划轮次')); assert.equal(ui.card(), undefined); assert.equal(ui.intervals.size, 0);
  const report = ui.writes[0].recent[0]; assert.equal(report.cardsUsed, 50); assert.equal(new Set(report.rounds[0].events.map((e) => e.cardId)).size, 50); ui.lifecycle.destroy();
});

test('reports cap at three and native copyOnly export includes all events and rankings with honest canceled state', async () => {
  const { Charades } = await modelPromise; const game = new Charades(OPTIONS); for (let n = 1; n <= 2; n++) { game.startRound(); game.endRound(n); }
  const calls = []; const ui = await mount({ recent: Array(10).fill(game.result()) }, { toolbox: { files: { saveTextSupportsCopyOnly: true, async saveText(args) { calls.push(args); return { canceled: true }; } } } });
  assert.equal(ui.all().filter((e) => e.tagName === 'button' && e.textContent === '导出此局').length, 3); completePair(ui); await flush();
  assert.equal(ui.writes[0].recent.length, 3); ui.button('导出本局报告').click(); await flush(); assert.equal(calls[0].copyOnly, true);
  const report = JSON.parse(calls[0].content); assert.equal(report.rounds[0].events[0].target, '教师'); assert.deepEqual(report.scoring, { hit: 1, skip: 0, unanswered: 0 });
  assert.equal(report.teamRanking[0].teamName, '蓝队'); assert.ok(ui.root.textContent.includes('已取消导出')); ui.lifecycle.destroy();
});

test('missing or non-boolean copyOnly capability blocks export and explains required toolbox update', async () => {
  for (const support of [undefined, false, 'true']) {
    let called = 0; const ui = await mount(null, { toolbox: { files: { saveTextSupportsCopyOnly: support, async saveText() { called++; } } } });
    completePair(ui); await flush(); ui.button('导出本局报告').click(); await flush(); assert.equal(called, 0); assert.equal(ui.timeouts.size, 0);
    assert.ok(ui.root.textContent.includes('当前版本不支持副本安全导出')); assert.ok(ui.root.textContent.includes('本次报告仍保留')); ui.lifecycle.destroy();
  }
});

test('storage failure preserves a full in-memory report that still exports through a supported safe bridge', async () => {
  const calls = []; const ui = await mount(null, { failSave: true, toolbox: { files: { saveTextSupportsCopyOnly: true, async saveText(args) { calls.push(args); return { ok: true }; } } } });
  completePair(ui); await flush(); assert.ok(ui.root.textContent.includes('保存失败')); ui.button('导出本局报告').click(); await flush();
  assert.equal(calls.length, 1); assert.equal(JSON.parse(calls[0].content).rounds.length, 2); assert.ok(ui.root.textContent.includes('完整局报告已导出')); ui.lifecycle.destroy();
});

test('deactivation and hidden document pause time, reactivation stays paused, and final-deadline destruction persists results', async () => {
  const ui = await mount(); ui.button('开始第 1 轮').click(); const old = ui.button('猜中 +1'); ui.advance(2000); ui.lifecycle.deactivate(); old.click();
  assert.equal(ui.intervals.size, 0); ui.advance(90000); ui.lifecycle.activate(); assert.ok(ui.root.textContent.includes('已暂停')); ui.button('继续').click();
  ui.doc.hidden = true; ui.doc.events.get('visibilitychange')(); assert.equal(ui.card(), undefined); ui.doc.hidden = false; ui.doc.events.get('visibilitychange')(); assert.ok(ui.root.textContent.includes('已暂停'));
  ui.button('继续').click(); ui.advance(1000); ui.button('提前结束本轮').click(); ui.button('开始第 2 轮').click(); ui.advance(60000, false);
  ui.lifecycle.destroy(); ui.lifecycle.destroy(); await flush(); assert.equal(ui.writes.length, 1); assert.equal(ui.writes[0].recent[0].rounds[0].elapsedMs, 3000);
  assert.equal(ui.writes[0].recent[0].rounds[1].reason, 'timeout'); assert.deepEqual(ui.writes[0].recent[0].scores, [0, 0]);
  ui.lifecycle.activate(); assert.equal(ui.doc.events.size, 0); assert.equal(ui.root.children.length, 0); assert.equal(ui.intervals.size, 0);
});
