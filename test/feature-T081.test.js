'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/renderer/features/T081/model.mjs');
const immediate = { yieldControl: async () => {} };
const interval = (startDate, startTime, endTime, endDate = startDate) => ({ startDate, startTime, endDate, endTime, startOffset: 'Z', endOffset: 'Z' });
const person = (name, timeZone, windows, mode = 'local') => ({ name, timeZone, windows, mode });

test('T081 acceptance: London 2026-07-01 09:00 equals Hong Kong same-day 16:00', async () => {
  const { buildPlan, localView, invitationText, utcText } = await model;
  const plan = await buildPlan([person('London', 'Europe/London', [interval('2026-07-01', '09:00', '12:00')]), person('Hong Kong', 'Asia/Hong_Kong', [interval('2026-07-01', '16:00', '18:00')])], 30, 15, immediate);
  assert.equal(utcText(plan.windows[0].start), '2026-07-01T08:00:00Z');
  assert.equal(localView(plan.suggestions[0].start, 'Asia/Hong_Kong').text, '2026-07-01 16:00 UTC+08:00 [Asia/Hong_Kong]');
  assert.equal(plan.windows[0].availableMinutes, 120);
  assert.equal(plan.suggestions.length, 7);
  assert.match(invitationText(plan), /2026-07-01 09:00 UTC\+01:00 \[Europe\/London\]/u);
});

test('T081: winter London uses UTC+00, not the summer seven-hour difference', async () => {
  const { resolveBoundary, localView, utcText } = await model;
  const instant = await resolveBoundary('2026-01-01', '09:00', 'Europe/London', 'local', 'Z', immediate);
  assert.equal(utcText(instant), '2026-01-01T09:00:00Z');
  assert.equal(localView(instant, 'Asia/Hong_Kong').time, '17:00');
});

test('T081: New York spring-forward nonexistent time is rejected', async () => {
  const { resolveBoundary } = await model;
  await assert.rejects(resolveBoundary('2026-03-08', '02:30', 'America/New_York', 'local', 'Z', immediate), error => error.code === 'NONEXISTENT' && /不存在/u.test(error.message));
});

test('T081: repeated New York time has two candidates and requires explicit offset', async () => {
  const { resolveBoundary, localCandidates, utcText } = await model;
  const candidates = await localCandidates('2026-11-01', '01:30', 'America/New_York', immediate);
  assert.deepEqual(candidates.map(x => [x.utc, x.offsetMinutes]), [['2026-11-01T05:30:00Z', -240], ['2026-11-01T06:30:00Z', -300]]);
  await assert.rejects(resolveBoundary('2026-11-01', '01:30', 'America/New_York', 'local', 'Z', immediate), error => error.code === 'AMBIGUOUS' && error.candidates.length === 2);
  assert.equal(utcText(await resolveBoundary('2026-11-01', '01:30', 'America/New_York', 'offset', '-04:00', immediate)), candidates[0].utc);
  assert.equal(utcText(await resolveBoundary('2026-11-01', '01:30', 'America/New_York', 'offset', '-05:00', immediate)), candidates[1].utc);
});

test('T081: half-hour DST rollback in Lord Howe detects ambiguity', async () => {
  const { localCandidates } = await model;
  const candidates = await localCandidates('2026-04-05', '01:45', 'Australia/Lord_Howe', immediate);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map(x => x.offsetMinutes), [660, 630]);
  assert.equal(candidates[1].epoch - candidates[0].epoch, 30 * 60000);
});

test('T081: skipped calendar day in Apia is not silently moved forward', async () => {
  const { resolveBoundary } = await model;
  await assert.rejects(resolveBoundary('2011-12-30', '12:00', 'Pacific/Apia', 'local', 'Z', immediate), error => error.code === 'NONEXISTENT');
});

test('T081: quarter-hour zone and explicit positive offset agree', async () => {
  const { resolveBoundary, utcText, localView } = await model;
  const instant = await resolveBoundary('2026-07-01', '09:00', 'Asia/Kathmandu', 'local', 'Z', immediate);
  assert.equal(utcText(instant), '2026-07-01T03:15:00Z');
  assert.equal(localView(instant, 'Asia/Kathmandu').offsetMinutes, 345);
  assert.equal(await resolveBoundary('2026-07-01', '09:00', 'Asia/Kathmandu', 'offset', '+05:45', immediate), instant);
});

test('T081: explicit offset mode never uses host timezone or guessed IANA conversion', async () => {
  const { resolveBoundary, localView, utcText } = await model;
  const instant = await resolveBoundary('2026-03-08', '02:30', 'America/New_York', 'offset', '-05:00', immediate);
  assert.equal(utcText(instant), '2026-03-08T07:30:00Z');
  assert.equal(localView(instant, 'America/New_York').time, '03:30');
  assert.equal(utcText(await resolveBoundary('2026-07-01', '09:00', 'Asia/Hong_Kong', 'offset', 'Z', immediate)), '2026-07-01T09:00:00Z');
});

test('T081: cross-day intervals show actual local dates and both UTC dates', async () => {
  const { buildPlan, invitationText, utcText } = await model;
  const plan = await buildPlan([person('LA', 'America/Los_Angeles', [interval('2026-07-01', '16:00', '18:00')]), person('HK', 'Asia/Hong_Kong', [interval('2026-07-02', '07:00', '09:00')])], 120, 15, immediate);
  assert.equal(utcText(plan.windows[0].start), '2026-07-01T23:00:00Z');
  assert.equal(utcText(plan.windows[0].end), '2026-07-02T01:00:00Z');
  const text = invitationText(plan);
  assert.match(text, /LA：2026-07-01 16:00/u);
  assert.match(text, /HK：2026-07-02 07:00/u);
  assert.match(text, /UTC：2026-07-01T23:00:00Z → 2026-07-02T01:00:00Z/u);
});

test('T081: midnight is hour 00 and year rollover is explicit', async () => {
  const { localView, resolveBoundary, utcText } = await model;
  assert.equal(localView(Date.UTC(2026, 6, 1, 0), 'UTC').time, '00:00');
  const instant = await resolveBoundary('2027-01-01', '00:30', 'Asia/Hong_Kong', 'local', 'Z', immediate);
  assert.equal(utcText(instant), '2026-12-31T16:30:00Z');
});

test('T081: actual DST-spanning duration counts 60 rather than 120 minutes', async () => {
  const { buildPlan } = await model;
  const plan = await buildPlan([person('NY', 'America/New_York', [interval('2026-03-08', '01:30', '03:30')])], 60, 15, immediate);
  assert.equal(plan.windows[0].availableMinutes, 60);
  assert.equal(plan.suggestions.length, 1);
});

test('T081: multiple intervals merge overlaps, preserve gaps and intersect every person', async () => {
  const { buildPlan, utcText } = await model;
  const plan = await buildPlan([
    person('A', 'UTC', [interval('2026-07-01', '09:00', '11:00'), interval('2026-07-01', '10:00', '12:00'), interval('2026-07-01', '14:00', '16:00')]),
    person('B', 'UTC', [interval('2026-07-01', '10:00', '15:00')]),
    person('C', 'UTC', [interval('2026-07-01', '10:30', '15:30')]),
  ], 30, 30, immediate);
  assert.deepEqual(plan.windows.map(x => [utcText(x.start), utcText(x.end)]), [['2026-07-01T10:30:00Z', '2026-07-01T12:00:00Z'], ['2026-07-01T14:00:00Z', '2026-07-01T15:00:00Z']]);
  assert.equal(plan.totalSuggestions, 5);
});

test('T081: touching boundaries do not produce a positive intersection', async () => {
  const { buildPlan } = await model;
  const plan = await buildPlan([person('A', 'UTC', [interval('2026-07-01', '09:00', '10:00')]), person('B', 'UTC', [interval('2026-07-01', '10:00', '11:00')])], 30, 15, immediate);
  assert.equal(plan.windows.length, 0);
  assert.equal(plan.suggestions.length, 0);
});

test('T081: too-short common window remains visible without fabricated meeting', async () => {
  const { buildPlan } = await model;
  const plan = await buildPlan([person('A', 'UTC', [interval('2026-07-01', '09:00', '09:20')])], 30, 15, immediate);
  assert.equal(plan.windows[0].fits, false);
  assert.equal(plan.suggestions.length, 0);
});

test('T081: candidate starts stay inside windows and use declared interval origin', async () => {
  const { buildPlan, utcText } = await model;
  const plan = await buildPlan([person('A', 'UTC', [interval('2026-07-01', '09:07', '10:00')])], 30, 15, immediate);
  assert.deepEqual(plan.suggestions.map(x => utcText(x.start)), ['2026-07-01T09:07:00Z', '2026-07-01T09:22:00Z']);
  assert.ok(plan.suggestions.every(x => x.end <= plan.windows[0].end));
});

test('T081: bounded suggestions still report total count', async () => {
  const { buildPlan } = await model;
  const plan = await buildPlan([person('A', 'UTC', [interval('2026-07-01', '00:00', '23:59')])], 1, 1, immediate);
  assert.equal(plan.totalSuggestions, 1439);
  assert.equal(plan.suggestions.length, 200);
  assert.equal(plan.truncated, true);
});

test('T081: invalid calendar dates, times, zones and offsets are rejected', async () => {
  const { parseWall, validateZone, parseOffset } = await model;
  for (const date of ['2026-02-29', '2026-13-01', '2026-01-00', '1999-12-31', '2101-01-01']) assert.throws(() => parseWall(date, '09:00'));
  assert.doesNotThrow(() => parseWall('2024-02-29', '23:59'));
  for (const time of ['24:00', '9:00', '12:60', '12:30:20', '']) assert.throws(() => parseWall('2026-07-01', time));
  for (const zone of ['PST', 'London', '+08:00', '', 'Mars/Invalid']) assert.throws(() => validateZone(zone));
  for (const offset of ['+8:00', '+14:01', '-15:00', 'UTC', '+08:60']) assert.throws(() => parseOffset(offset));
  assert.equal(parseOffset('+14:00'), 840);
});

test('T081: reversed and oversized windows, missing people and invalid duration fail', async () => {
  const { buildPlan } = await model;
  await assert.rejects(buildPlan([], 30, 15, immediate));
  await assert.rejects(buildPlan([person('A', 'UTC', [interval('2026-07-01', '12:00', '09:00')])], 30, 15, immediate), /跨日请显式/u);
  await assert.rejects(buildPlan([person('A', 'UTC', [interval('2026-07-01', '09:00', '10:00', '2026-07-09')])], 30, 15, immediate), /最多7天/u);
  await assert.rejects(buildPlan([person('A', 'UTC', [])], 30, 15, immediate), /须填写/u);
  await assert.rejects(buildPlan([person('A', 'UTC', [interval('2026-07-01', '09:00', '10:00')])], 0, 15, immediate), /会议时长/u);
  await assert.rejects(buildPlan([person('A', 'UTC', [interval('2026-07-01', '09:00', '10:00')])], 30, 0, immediate), /候选间隔/u);
});

test('T081: cancellation interrupts exhaustive local-time verification', async () => {
  const { localCandidates, buildPlan } = await model;
  const controller = new AbortController(); let yields = 0;
  await assert.rejects(localCandidates('2026-11-01', '01:30', 'America/New_York', { signal: controller.signal, yieldControl: async () => { yields++; controller.abort(); } }), { name: 'AbortError' });
  assert.equal(yields, 1);
  await assert.rejects(buildPlan([person('A', 'UTC', [interval('2026-07-01', '09:00', '10:00')])], 30, 15, { signal: controller.signal }), { name: 'AbortError' });
});

test('T081: boundary error identifies participant and interval; invitation title is bounded', async () => {
  const { buildPlan, invitationText } = await model;
  await assert.rejects(buildPlan([person('NY team', 'America/New_York', [interval('2026-03-08', '02:30', '04:00')])], 30, 15, immediate), error => error.code === 'NONEXISTENT' && /NY team · 区间1 开始/u.test(error.message));
  const plan = await buildPlan([person('A', 'UTC', [interval('2026-07-01', '09:00', '10:00')])], 30, 15, immediate);
  assert.throws(() => invitationText(plan, 0, 'bad\ntitle'));
  assert.throws(() => invitationText(plan, 100));
});

test('T081: explicitly different endpoint offsets resolve a rollback interval', async () => {
  const { buildPlan } = await model;
  const window = { ...interval('2026-11-01', '01:45', '01:15'), startOffset: '-04:00', endOffset: '-05:00' };
  const plan = await buildPlan([person('NY', 'America/New_York', [window], 'offset')], 30, 15, immediate);
  assert.equal(plan.windows[0].availableMinutes, 30);
  assert.equal(plan.suggestions.length, 1);
  assert.equal(plan.people[0].intervals[0].startLocal.offsetMinutes, -240);
  assert.equal(plan.people[0].intervals[0].endLocal.offsetMinutes, -300);
});

// Small DOM contract fixture. These tests do not claim live Electron rendering.
class Element {
  constructor(tag) { this.tagName = tag; this.nodeType = 1; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.disabled = false; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; }
  addEventListener(name, action) { (this.listeners[name] ||= []).push(action); }
  append(...children) {
    for (const child of children) this.children.push(child.nodeType ? child : { nodeType: 3, textContent: String(child) });
    if (this.tagName === 'select' && !this.value) this.value = this.children[0]?.value || '';
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  get textContent() { return this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  querySelectorAll(selector) {
    return descendants(this).filter(child => selector === '[data-limit-disabled]' ? child.dataset.limitDisabled !== undefined : selector.split(',').includes(child.tagName));
  }
  focus() {}
  select() {}
  async fire(name) { if (this.disabled) return; for (const action of this.listeners[name] || []) await action({ currentTarget: this }); }
}
function descendants(element) { return element.children.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []); }
function button(root, title) { return descendants(root).find(el => el.tagName === 'button' && el.textContent === title); }
function control(root, label) { return descendants(root).find(el => el.attributes['aria-label'] === label); }
async function withUI(files, callback, clipboard = {}) {
  const previous = { document: global.document, window: global.window };
  global.document = { createElement: tag => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) };
  global.window = { toolbox: { files, clipboard } };
  const root = new Element('main');
  const lifecycle = (await import('../src/renderer/features/T081/index.js')).default.create(root, {});
  try { await callback(root, lifecycle); }
  finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}

test('T081 UI contract: example, invitation copy and safe TXT/JSON exports', async () => {
  const saved = []; let copied = '';
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: '/copy/' + payload.defaultName }; } }, async root => {
    assert.equal(button(root, '保存邀请副本').disabled, true);
    await button(root, '计算公共窗口').fire('click');
    assert.equal(button(root, '保存邀请副本').disabled, false);
    assert.match(control(root, '邀请文本预览').value, /2026-07-01 16:00 UTC\+08:00/u);
    await button(root, '复制邀请文本').fire('click');
    await button(root, '保存邀请副本').fire('click');
    await button(root, '保存窗口报告').fire('click');
    assert.equal(copied, saved[0].content);
    assert.deepEqual(saved.map(payload => [payload.extension, payload.copyOnly]), [['txt', true], ['json', true]]);
    assert.equal(JSON.parse(saved[1].content).plan.totalSuggestions, 7);
    const duration = control(root, '会议时长分钟'); duration.value = '60'; await duration.fire('input');
    assert.equal(button(root, '保存邀请副本').disabled, true);
    assert.equal(control(root, '邀请文本预览').value, '');
  }, { write: async text => { copied = text; } });
});

test('T081 UI contract: cross-day example and missing protected writer', async () => {
  let wrote = false;
  await withUI({ saveText: async () => { wrote = true; } }, async root => {
    await button(root, '跨日示例').fire('click');
    await button(root, '计算公共窗口').fire('click');
    const text = control(root, '邀请文本预览').value;
    assert.match(text, /洛杉矶团队：2026-07-01 16:00/u);
    assert.match(text, /香港团队：2026-07-02 07:00/u);
    assert.equal(button(root, '保存邀请副本').disabled, true);
    assert.equal(button(root, '复制邀请文本').disabled, false);
    assert.equal(wrote, false);
  });
});

test('T081 UI contract: ambiguous local input errors, explicit offset enables calculation', async () => {
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async () => ({ canceled: true }) }, async root => {
    await descendants(root).filter(el => el.tagName === 'button' && el.textContent === '移除参与者')[1].fire('click');
    const values = { '参与者1时区': 'America/New_York', '参与者1区间1开始日期': '2026-11-01', '参与者1区间1结束日期': '2026-11-01', '参与者1区间1开始时间': '01:30', '参与者1区间1结束时间': '02:30' };
    for (const [label, value] of Object.entries(values)) { const element = control(root, label); element.value = value; await element.fire('input'); }
    await button(root, '计算公共窗口').fire('click');
    assert.match(root.textContent, /重复出现/u);
    assert.equal(button(root, '保存邀请副本').disabled, true);
    const mode = control(root, '参与者1输入模式'); mode.value = 'offset'; await mode.fire('change');
    for (const [label, value] of [['参与者1区间1开始 UTC 偏移', '-04:00'], ['参与者1区间1结束 UTC 偏移', '-05:00']]) { const element = control(root, label); element.value = value; await element.fire('input'); }
    await button(root, '计算公共窗口').fire('click');
    assert.equal(button(root, '保存邀请副本').disabled, false);
    assert.match(control(root, '邀请文本预览').value, /2026-11-01T05:30:00Z/u);
    assert.ok(descendants(root).find(el => el.tagName === 'button' && el.textContent === '移除参与者').disabled);
  });
});
