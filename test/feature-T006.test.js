'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/renderer/features/T006/model.mjs');
const immediate = { yieldControl: async () => {} };
const source = (name, text, format = 'iso-offset', offset = 'Z') => ({ name, text, format, offset });

test('T006 acceptance: UTC12 and UTC+8 20 tie, retaining file and physical line', async () => {
  const { buildTimeline } = await model;
  const result = await buildTimeline([source('utc.log', '2026-07-01T12:00:00.123Z first\n'), source('east8.log', '2026-07-01 20:00:00.123 second\n', 'local', '+08:00')], immediate);
  assert.equal(result.timeline[0].epochMs, result.timeline[1].epochMs);
  assert.deepEqual(result.timeline.map(x => [x.source, x.line, x.utc]), [['utc.log', 1, '2026-07-01T12:00:00.123Z'], ['east8.log', 1, '2026-07-01T12:00:00.123Z']]);
  assert.equal(result.stats.sameInstantGroups, 1);
  assert.equal(result.stats.sameInstantEvents, 2);
});

test('T006: disordered source lines sort chronologically and ties keep input order', async () => {
  const { buildTimeline } = await model;
  const result = await buildTimeline([source('a', '2026-07-01T12:00:00Z a1\n2026-07-01T11:00:00Z a2\n2026-07-01T12:00:00Z a3'), source('b', '2026-07-01T12:00:00Z b1')], immediate);
  assert.deepEqual(result.timeline.map(x => [x.source, x.line]), [['a', 2], ['a', 1], ['a', 3], ['b', 1]]);
  assert.deepEqual(result.timeline.map(x => x.sameInstantCount), [1, 3, 3, 3]);
});

test('T006: duplicate source names remain distinguished by source index', async () => {
  const { buildTimeline } = await model;
  const result = await buildTimeline([source('same.log', '2026-07-01T12:00:00Z a'), source('same.log', '2026-07-01T12:00:00Z b')], immediate);
  assert.deepEqual(result.timeline.map(x => x.sourceIndex), [1, 2]);
});

test('T006: fractional seconds preserve 100, 120 and 123 milliseconds', async () => {
  const { parseTimestamp } = await model;
  assert.deepEqual(['1', '12', '123'].map(fraction => parseTimestamp(`2026-07-01T12:00:00.${fraction}Z x`, 'iso-offset').utc), ['2026-07-01T12:00:00.100Z', '2026-07-01T12:00:00.120Z', '2026-07-01T12:00:00.123Z']);
});

test('T006: supported Unix second and millisecond formats agree with ISO instant', async () => {
  const { parseTimestamp } = await model;
  const iso = parseTimestamp('2026-07-01T12:00:00.123Z event', 'iso-offset');
  assert.equal(parseTimestamp('1782907200.123 event', 'unix-seconds').epochMs, iso.epochMs);
  assert.equal(parseTimestamp('1782907200123 event', 'unix-ms').epochMs, iso.epochMs);
  assert.equal(parseTimestamp('0 epoch', 'unix-seconds').utc, '1970-01-01T00:00:00.000Z');
  assert.equal(parseTimestamp('1782907200.123 event', 'unix-ms').ok, false);
  assert.equal(parseTimestamp('1782907200123 event', 'unix-seconds').ok, false);
});

test('T006: bracket prefix, leading whitespace and original raw text are preserved', async () => {
  const { buildTimeline } = await model;
  const raw = '\uFEFF  [2026-07-01T12:00:00Z]INFO hello';
  const result = await buildTimeline([source('bom.log', raw)], immediate);
  assert.equal(result.sources[0].hasBOM, true);
  assert.equal(result.timeline[0].raw, raw);
  assert.equal(result.timeline[0].message, 'INFO hello');
  assert.equal(result.timeline[0].timestamp, '2026-07-01T12:00:00Z');
});

test('T006: malformed brackets, joined suffixes, missing zone and wrong format are unparsed', async () => {
  const { parseTimestamp } = await model;
  for (const raw of ['[2026-07-01T12:00:00Z event', '2026-07-01T12:00:00Zjoined', '2026-07-01T12:00:00 event', 'Jul 1 12:00:00 event', '12:00:00 event']) assert.equal(parseTimestamp(raw, 'iso-offset').ok, false);
  assert.equal(parseTimestamp('2026-07-01T12:00:00Z x', 'local', '+08:00').ok, false);
});

test('T006: impossible date, leap second, 24:00 and submillisecond values are rejected', async () => {
  const { parseTimestamp } = await model;
  for (const stamp of ['2026-02-29T12:00:00Z', '2026-13-01T12:00:00Z', '2026-01-00T12:00:00Z', '2026-07-01T24:00:00Z', '2026-07-01T12:60:00Z', '2026-07-01T12:00:60Z', '2026-07-01T12:00:00.1234Z']) assert.equal(parseTimestamp(stamp + ' x', 'iso-offset').ok, false);
  assert.equal(parseTimestamp('2024-02-29T12:00:00Z x', 'iso-offset').ok, true);
  assert.match(parseTimestamp('1782907200.1234 x', 'unix-seconds').reason, /超过毫秒/u);
});

test('T006: fixed offsets cross UTC day and fractional-hour offsets are exact', async () => {
  const { parseTimestamp, parseOffset } = await model;
  assert.equal(parseTimestamp('2027-01-01 00:30:00 x', 'local', '+08:00').utc, '2026-12-31T16:30:00.000Z');
  assert.equal(parseTimestamp('2026-07-01 09:00:00 x', 'local', '+05:45').utc, '2026-07-01T03:15:00.000Z');
  assert.equal(parseTimestamp('2026-07-01 23:30:00 x', 'local', '-04:00').utc, '2026-07-02T03:30:00.000Z');
  for (const value of ['PST', 'Europe/London', '+8:00', '+14:01', '-15:00']) assert.throws(() => parseOffset(value));
});

test('T006: unparsed continuations and empty physical lines are retained without a phantom trailing row', async () => {
  const { buildTimeline } = await model;
  const result = await buildTimeline([source('a', '2026-07-01T12:00:00Z x\r\nstack\r\n\r\n2026-07-01T12:00:01Z y\r')], immediate);
  assert.equal(result.stats.totalLines, 4);
  assert.deepEqual(result.timeline.map(x => x.line), [1, 4]);
  assert.deepEqual(result.unparsed.map(x => [x.line, x.raw]), [[2, 'stack'], [3, '']]);
  assert.equal(result.stats.emptyLines, 1);
  assert.equal(result.unparsed[1].reason, '空行');
});

test('T006: empty file is counted as source with no fabricated event', async () => {
  const { buildTimeline } = await model;
  const result = await buildTimeline([source('empty.log', '')], immediate);
  assert.equal(result.stats.sourceCount, 1);
  assert.equal(result.stats.totalLines, 0);
  assert.equal(result.timeline.length, 0);
});

test('T006: input config rejects absent sources and invalid fixed offset before parsing', async () => {
  const { buildTimeline } = await model;
  await assert.rejects(buildTimeline([], immediate), /请添加/u);
  await assert.rejects(buildTimeline(Array.from({ length: 9 }, () => source('x', '')), immediate), /1至8/u);
  await assert.rejects(buildTimeline([source('bad.log', 'x', 'local', 'Asia/Hong_Kong')], immediate), /bad.log.*固定偏移/u);
  await assert.rejects(buildTimeline([source('bad', 'x', 'guess')], immediate), /时间格式/u);
});

test('T006: byte and aggregate budgets are checked before parsing large contents', async () => {
  const { buildTimeline, LIMITS } = await model;
  await assert.rejects(buildTimeline([source('large', 'x'.repeat(LIMITS.sourceBytes + 1))], immediate), /超过2 MiB/u);
  await assert.rejects(buildTimeline([source('unicode', '中'.repeat(750000))], immediate), /最多2 MiB/u);
  await assert.rejects(buildTimeline(Array.from({ length: 5 }, (_, index) => source(String(index), 'x'.repeat(LIMITS.sourceBytes))), immediate), /合计最多8 MiB/u);
});

test('T006: physical-line count and line-length caps fail explicitly', async () => {
  const { buildTimeline, LIMITS } = await model;
  await assert.rejects(buildTimeline([source('lines', '\n'.repeat(LIMITS.lines + 1))], immediate), /超过50000物理行/u);
  await assert.rejects(buildTimeline([source('long', 'x'.repeat(LIMITS.lineLength + 1))], immediate), /第1行超过50000字符/u);
});

test('T006: parse and sort cancellation stops without returning partial timeline', async () => {
  const { buildTimeline } = await model;
  const parseAbort = new AbortController();
  await assert.rejects(buildTimeline([source('x', 'invalid\n'.repeat(300))], { signal: parseAbort.signal, yieldControl: async () => parseAbort.abort() }), { name: 'AbortError' });
  const sortAbort = new AbortController();
  await assert.rejects(buildTimeline([source('x', '2026-07-01T12:00:00Z x\n'.repeat(10))], { ...immediate, signal: sortAbort.signal, onProgress: progress => { if (progress.phase === 'sort') sortAbort.abort(); } }), { name: 'AbortError' });
});

test('T006: full JSON includes every raw event and failed line; CSV escapes original text', async () => {
  const { buildTimeline, serializeTimeline } = await model;
  const raw = '2026-07-01T12:00:00Z said "hello, world"';
  const result = await buildTimeline([source('a,report.log', raw + '\nnot a timestamp\n')], immediate);
  const report = JSON.parse(await serializeTimeline(result, 'json', immediate));
  assert.equal(report.feature, 'T006');
  assert.equal(report.timeline[0].raw, raw);
  assert.equal(report.unparsed[0].line, 2);
  assert.equal(report.unparsed[0].raw, 'not a timestamp');
  const csv = await serializeTimeline(result, 'csv', immediate);
  assert.ok(csv.startsWith('\uFEFFsource_index,source_name,source_line,utc'));
  assert.ok(csv.includes('"a,report.log"'));
  assert.ok(csv.includes('said ""hello, world""'));
});

test('T006: bounded report generation and CSV expansion stop at 12 MiB', async () => {
  const { buildTimeline, serializeTimeline, LIMITS } = await model;
  const prefix = '2026-07-01T12:00:00Z ';
  const line = prefix + 'x'.repeat(LIMITS.lineLength - prefix.length) + '\n';
  const inputs = [40, 40, 40, 10].map((count, index) => source(String(index), line.repeat(count)));
  const result = await buildTimeline(inputs, immediate);
  await assert.rejects(serializeTimeline(result, 'json', immediate), /超过12 MiB/u);
  await assert.rejects(serializeTimeline(result, 'csv', immediate), /超过12 MiB/u);
});

test('T006: export cancellation and unsupported kinds fail explicitly', async () => {
  const { buildTimeline, serializeTimeline } = await model;
  const result = await buildTimeline([source('a', '2026-07-01T12:00:00Z x')], immediate);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(serializeTimeline(result, 'json', { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(serializeTimeline(result, 'xml', immediate), /只支持/u);
});

// DOM contract smoke tests; do not equate the fixture with live Electron UI QA.
class Element {
  constructor(tag) { this.tagName = tag; this.nodeType = 1; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.disabled = false; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; }
  addEventListener(name, action) { (this.listeners[name] ||= []).push(action); }
  append(...children) { for (const child of children) this.children.push(child.nodeType ? child : { nodeType: 3, textContent: String(child) }); if (this.tagName === 'select' && !this.value) this.value = this.children[0]?.value || ''; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  get textContent() { return this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  querySelectorAll(selector) { return descendants(this).filter(child => selector === '[data-page-disabled]' ? child.dataset.pageDisabled !== undefined : selector.split(',').includes(child.tagName)); }
  async fire(name) { if (this.disabled) return; for (const action of this.listeners[name] || []) await action({ currentTarget: this }); }
}
function descendants(element) { return element.children.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []); }
function button(root, title) { return descendants(root).find(element => element.tagName === 'button' && element.textContent === title); }
function control(root, label) { return descendants(root).find(element => element.attributes['aria-label'] === label); }
async function withUI(files, callback) {
  const previous = { document: global.document, window: global.window, FileReader: global.FileReader };
  global.document = { createElement: tag => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) };
  global.window = { toolbox: { files } };
  global.FileReader = class { readAsArrayBuffer(file) { this.result = file.buffer; this.onload(); } abort() { this.onabort?.(); } };
  const root = new Element('main');
  const lifecycle = (await import('../src/renderer/features/T006/index.js')).default.create(root, {});
  try { await callback(root, lifecycle); }
  finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}

test('T006 UI contract: example, same-instant preview, safe CSV/JSON and pager bounds', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: '/copy/' + payload.defaultName }; } }, async root => {
    assert.equal(button(root, '生成统一时间线').disabled, true);
    await button(root, '载入跨时区示例').fire('click');
    await button(root, '生成统一时间线').fire('click');
    assert.match(root.textContent, /同刻2条/u);
    assert.match(root.textContent, /stack continuation/u);
    assert.ok(descendants(root).filter(element => element.tagName === 'button' && element.textContent === '上一页').every(element => element.disabled));
    await button(root, '保存时间线 CSV 副本').fire('click');
    await button(root, '保存完整 JSON（含未解析行）').fire('click');
    assert.deepEqual(saved.map(payload => [payload.extension, payload.copyOnly]), [['csv', true], ['json', true]]);
    const report = JSON.parse(saved[1].content);
    assert.equal(report.stats.eventLines, 4);
    assert.equal(report.stats.unparsedLines, 1);
    assert.deepEqual(report.timeline.filter(event => event.sameInstantCount === 2).map(event => [event.source, event.line]), [['utc.log', 1], ['east8.log', 1]]);
    const offset = control(root, '来源2固定 UTC 偏移'); offset.value = '+09:00'; await offset.fire('input');
    assert.equal(button(root, '保存时间线 CSV 副本').disabled, true);
  });
});

test('T006 UI contract: multiple UTF-8 files, per-file format and failed UTF-8 batch is atomic', async () => {
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async () => ({ canceled: true }) }, async root => {
    const file = control(root, '选择多份日志文件');
    const valid = new TextEncoder().encode('2026-07-01T12:00:00Z x');
    file.files = [{ name: 'ok.log', size: valid.length, buffer: valid.buffer }, { name: 'bad.log', size: 1, buffer: new Uint8Array([255]).buffer }];
    await file.fire('change');
    assert.equal(button(root, '生成统一时间线').disabled, true);
    assert.match(root.textContent, /不是有效UTF-8/u);
    const local = new TextEncoder().encode('2026-07-01 20:00:00 y');
    file.files = [{ name: 'utc.log', size: valid.length, buffer: valid.buffer }, { name: 'local.log', size: local.length, buffer: local.buffer }];
    await file.fire('change');
    const format = control(root, '来源2时间格式'); format.value = 'local'; await format.fire('change');
    const offset = control(root, '来源2固定 UTC 偏移'); offset.value = '+08:00'; await offset.fire('input');
    await button(root, '生成统一时间线').fire('click');
    assert.match(root.textContent, /同刻2条/u);
    assert.equal(button(root, '保存时间线 CSV 副本').disabled, false);
  });
});

test('T006 UI contract: paste collection and old writer block unsafe exports', async () => {
  let called = false;
  await withUI({ saveText: async () => { called = true; } }, async root => {
    control(root, '粘贴日志名称').value = 'pasted.log';
    control(root, '粘贴日志内容').value = '2026-07-01T12:00:00.123Z pasted';
    await button(root, '添加粘贴日志').fire('click');
    assert.equal(control(root, '粘贴日志内容').value, '');
    await button(root, '生成统一时间线').fire('click');
    assert.match(root.textContent, /pasted.log/u);
    assert.match(root.textContent, /缺少副本保护/u);
    assert.equal(button(root, '保存时间线 CSV 副本').disabled, true);
    assert.equal(button(root, '保存完整 JSON（含未解析行）').disabled, true);
    assert.equal(called, false);
  });
});
