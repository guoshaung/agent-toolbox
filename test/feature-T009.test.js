'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/renderer/features/T009/model.mjs');
const immediate = { yieldControl: async () => {} };
const question = (field, type = 'single', id = 'Q1', extra = {}) => ({ id, field, title: field, type, trim: true, ...(type === 'multiple' ? { separator: ';' } : {}), ...extra });
async function dataset(value, format = 'json') { return (await model).parseDataset({ name: 'survey', format, text: typeof value === 'string' ? value : JSON.stringify(value) }, immediate); }
async function summary(value, configs, cross = null, format = 'json') { return (await model).summarizeSurvey(await dataset(value, format), configs, cross, immediate); }

test('T009 acceptance: four questionnaires with one missing give effective denominator3 and missing1', async () => {
  const { EXAMPLE, EXAMPLE_QUESTIONS } = await model, result = await summary(EXAMPLE, EXAMPLE_QUESTIONS, { left: 'Q1', right: 'Q2' }, 'csv');
  assert.equal(result.sampleCount, 4); const single = result.questions[0];
  assert.deepEqual([single.total, single.valid, single.missing, single.invalid, single.denominator], [4, 3, 1, 0, 3]);
  assert.deepEqual(single.frequencies.map(row => [row.value, row.count, row.denominator, row.rate]), [['A', 2, 3, 2 / 3], ['B', 1, 3, 1 / 3]]);
  assert.deepEqual(single.issues[0].source, { name: 'survey', row: 4, line: 5 });
});

test('T009: multi-choice counts each option once per answer, denominator effective answers and sum exceeds100%', async () => {
  const result = await summary([{ x: 'A;B;A' }, { x: 'B' }, { x: 'A;B' }, { x: '' }], [question('x', 'multiple')]); const multi = result.questions[0];
  assert.deepEqual([multi.valid, multi.missing, multi.denominator, multi.selections, multi.duplicateSelectionsRemoved], [3, 1, 3, 5, 1]);
  assert.deepEqual(multi.frequencies.map(row => [row.value, row.count, row.rate]), [['A', 2, 2 / 3], ['B', 3, 1]]);
  assert.ok(multi.frequencies.reduce((sum, row) => sum + row.rate, 0) > 1);
});

test('T009: separators are literal including regex-looking/custom tokens and newline with trim', async () => {
  for (const separator of ['|', '::', '[x]', '\n']) {
    const result = await summary([{ x: `A${separator}B${separator}A` }], [question('x', 'multiple', 'Q1', { separator })]);
    assert.deepEqual(result.questions[0].frequencies.map(row => row.value), ['A', 'B']); assert.equal(result.questions[0].duplicateSelectionsRemoved, 1);
  }
  const csv = await summary('x\n"A,B,A"\n', [question('x', 'multiple', 'Q1', { separator: ',' })], null, 'csv'); assert.equal(csv.questions[0].frequencies.length, 2);
  const boundaries = (await summary([{ x: '\nA\nA\n' }], [question('x', 'multiple', 'Q1', { separator: '\n' })])).questions[0];
  assert.equal(boundaries.ignoredEmptyTokens, 2); assert.equal(boundaries.duplicateSelectionsRemoved, 1); assert.equal(boundaries.frequencies[0].count, 1);
});

test('T009: empty multi tokens excluded explicitly, all-empty becomes missing; JSON array is invalid', async () => {
  const result = (await summary([{ x: ';;' }, { x: 'A;;;A' }, { x: ['A', 'B'] }], [question('x', 'multiple')])).questions[0];
  assert.deepEqual([result.valid, result.missing, result.invalid, result.ignoredEmptyTokens, result.duplicateSelectionsRemoved], [1, 1, 1, 5, 1]);
  assert.equal(result.frequencies[0].count, 1); assert.equal(result.issues[1].status, 'invalid');
});

test('T009: missing fields, null and trimmed whitespace are separate from illegal structures', async () => {
  const result = (await summary([{}, { x: null }, { x: '' }, { x: ' ' }, { x: {} }, { x: [] }, { x: 0 }, { x: false }], [question('x')])).questions[0];
  assert.deepEqual([result.valid, result.missing, result.invalid], [2, 4, 2]);
  assert.equal(result.issues[0].input.present, false); assert.deepEqual(result.issues[1].input, { present: true, value: null });
  const preserve = (await summary([{ x: ' ' }, { x: ' A ' }], [question('x', 'single', 'Q1', { trim: false })])).questions[0]; assert.equal(preserve.valid, 2); assert.deepEqual(preserve.frequencies.map(row => row.value), [' ', ' A ']);
});

test('T009: categorical1 string/number and false keep their actual types; CSV does not infer null labels', async () => {
  const result = (await summary([{ x: 1 }, { x: '1' }, { x: false }], [question('x')])).questions[0];
  assert.deepEqual(new Set(result.frequencies.map(row => row.type)), new Set(['number', 'string', 'boolean']));
  const csv = (await summary('x\nnull\n01\nfalse\n', [question('x')], null, 'csv')).questions[0]; assert.equal(csv.valid, 3); assert.ok(csv.frequencies.every(row => row.type === 'string'));
});

test('T009: numeric missing and illegal values separate, retain source and raw failure', async () => {
  const values = [{ x: '10' }, { x: 20 }, { x: '' }, { x: null }, {}, { x: 'not-number' }, { x: false }, { x: '1,000' }];
  const result = (await summary(values, [question('x', 'numeric')])).questions[0];
  assert.deepEqual([result.valid, result.missing, result.invalid, result.denominator], [2, 3, 3, 2]);
  assert.deepEqual(result.numeric, { min: 10, max: 20, mean: 15, meanIsApproximate: true });
  assert.equal(result.issues.find(issue => issue.input.value === 'not-number').status, 'invalid');
  assert.ok(result.frequencies.every(row => row.denominator === 2 && row.rate === 0.5));
});

test('T009: configured numeric strings allow decimal/scientific syntax but reject precision loss and implicit formats', async () => {
  const { parseNumeric } = await model;
  for (const value of ['.5', '-.5', '+01.20', '1e2', '0.1', '1.2300']) assert.ok(!parseNumeric(value).error);
  for (const value of ['NaN', 'Infinity', '0x10', '20%', '1,000', '1.', '1e999', '1e-999', '9007199254740993', '1.00000000000000001', false, [], {}]) assert.ok(parseNumeric(value).error);
  const result = (await summary([{ x: ' ' }], [question('x', 'numeric', 'Q1', { trim: false })])).questions[0]; assert.equal(result.invalid, 1); assert.equal(result.missing, 0);
});

test('T009: cross denominator requires both valid and exposes complete exclusion status combinations', async () => {
  const rows = [{ a: 'A', b: 'X' }, { a: null, b: 'X' }, { a: 'A', b: null }, { a: {}, b: 'X' }, { a: null, b: {} }, { a: {}, b: null }];
  const result = await summary(rows, [question('a'), question('b', 'single', 'Q2')], { left: 'Q1', right: 'Q2' });
  assert.deepEqual([result.cross.total, result.cross.validPairs, result.cross.excludedPairs, result.cross.denominator], [6, 1, 5, 1]);
  assert.equal(result.cross.statusCounts.reduce((sum, row) => sum + row.count, 0), 6);
  assert.ok(result.cross.statusCounts.some(row => row.left === 'missing' && row.right === 'invalid'));
  assert.equal(result.cross.cells[0].rate, 1); assert.equal(result.cross.cells[0].denominator, 1); assert.equal(result.cross.sparse, true);
});

test('T009: reordered records preserve statistics; cross typed categories and zero paired samples stay explicit', async () => {
  const rows = [{ a: 1, b: 'X' }, { a: '1', b: 'X' }, { a: 1, b: 'X' }], configs = [question('a'), question('b', 'single', 'Q2')];
  const first = await summary(rows, configs, { left: 'Q1', right: 'Q2' }), second = await summary([...rows].reverse(), configs, { left: 'Q1', right: 'Q2' });
  assert.deepEqual(first.cross.cells, second.cross.cells); assert.equal(first.cross.cells.length, 2); assert.equal(first.cross.cells.reduce((sum, row) => sum + row.count, 0), 3);
  const empty = await summary([{ a: null, b: 'X' }], configs, { left: 'Q1', right: 'Q2' }); assert.equal(empty.cross.denominator, 0); assert.deepEqual(empty.cross.cells, []);
});

test('T009: total equals valid+missing+invalid across all types and no arbitrary sample truncation', async () => {
  const { EXAMPLE, EXAMPLE_QUESTIONS } = await model, result = await summary(EXAMPLE, EXAMPLE_QUESTIONS, null, 'csv');
  for (const question of result.questions) assert.equal(question.total, question.valid + question.missing + question.invalid);
  assert.deepEqual([result.questions[3].valid, result.questions[3].missing, result.questions[3].invalid], [2, 1, 1]);
});

test('T009: config requires present unique fields/ids, exact separator, valid cross and bounded question count', async () => {
  const { validateConfig } = await model, parsed = await dataset([{ x: 'a', y: 'b' }]);
  for (const configs of [[], [question('unknown')], [question('x'), question('x', 'single', 'Q2')], [question('x'), question('y')], [question('x', 'multiple', 'Q1', { separator: '' })], [question('x', 'multiple', 'Q1', { separator: 'x'.repeat(11) })], [question('x', 'single', 'Q1', { trim: 'yes' })], [question('x', 'single', 'Q1', { title: '' })], Array(21).fill(question('x'))]) assert.throws(() => validateConfig(parsed, configs));
  const configs = [question('x'), question('y', 'numeric', 'Q2')];
  for (const cross of [{ left: 'Q1', right: 'Q1' }, { left: 'Q1', right: 'Q2' }, { left: 'Q1', right: 'Q9' }]) assert.throws(() => validateConfig(parsed, configs, cross), /交叉/u);
});

test('T009: category overflow aborts whole report; excessive multi split marks that answer invalid', async () => {
  await assert.rejects(summary(Array.from({ length: 201 }, (_, index) => ({ x: 'v' + index })), [question('x')]), /超过200/u);
  assert.equal((await summary(Array.from({ length: 200 }, (_, index) => ({ x: 'v' + index })), [question('x')])).questions[0].frequencies.length, 200);
  const result = (await summary([{ x: Array(101).fill('A').join(';') }, { x: Array(100).fill('A').join(';') }], [question('x', 'multiple')])).questions[0];
  assert.deepEqual([result.valid, result.invalid], [1, 1]); assert.equal(result.duplicateSelectionsRemoved, 99);
});

test('T009: strict independent parser preserves quoted CSV physical lines, BOM and rejects bad structure/precision', async () => {
  const parsed = await dataset('\uFEFFx,y\r\n"A\r\nB",X\r\nC,Y\r\n', 'csv'); assert.deepEqual(parsed.records.map(record => record.source.line), [2, 4]); assert.equal(parsed.records[0].value.x, 'A\r\nB');
  for (const value of ['{}', '[null]', '[{"x":1,"x":2}]', '[{"x":1.00000000000000001}]', '[{"x":9007199254740993}]']) await assert.rejects(dataset(value));
  for (const value of ['x,x\nA,B', 'x,y\nA', 'x,y\n"unterminated,B']) await assert.rejects(dataset(value, 'csv'));
  await assert.rejects(dataset('中'.repeat(700000)), /2 MiB/u); await assert.rejects(dataset(Array.from({ length: 5001 }, () => ({ x: 'A' }))), /5000/u);
});

test('T009: empty header-only data yields0 effective denominator and null numerical aggregates', async () => {
  const { formatRate } = await model, result = await summary('x\n', [question('x', 'numeric')], null, 'csv');
  assert.equal(result.questions[0].denominator, 0); assert.equal(result.questions[0].numeric.mean, null); assert.equal(formatRate(null), '不适用（有效分母0）');
});

test('T009: exports include full configs/basis/missing/invalid/cross rows and typed frequency values', async () => {
  const { EXAMPLE, EXAMPLE_QUESTIONS, serializeSurvey } = await model, result = await summary(EXAMPLE, EXAMPLE_QUESTIONS, { left: 'Q1', right: 'Q2' }, 'csv');
  const json = JSON.parse(await serializeSurvey(result, 'json', immediate)); assert.equal(json.feature, 'T009'); assert.equal(json.cross.denominator, 3); assert.equal(json.questions[2].config.separator, ';');
  assert.equal(json.questions[3].issues.length, 2); assert.match(json.basis.multiple, /超过100%/u);
  const csv = await serializeSurvey(result, 'csv', immediate); assert.ok(csv.startsWith('\uFEFFkind,id_json,detail_json'));
  for (const kind of ['metadata', 'question', 'frequency', 'answer-missing', 'answer-invalid', 'cross-summary', 'cross-cell']) assert.ok(csv.includes(kind));
  assert.ok(csv.includes('not-number'));
});

test('T009: processing/export cancellation, exact export kind and expansion caps prevent partial files', async () => {
  const { summarizeSurvey, serializeSurvey, LIMITS } = await model, parsed = await dataset([{ x: 'A' }]);
  const controller = new AbortController(); await assert.rejects(summarizeSurvey(parsed, [question('x')], null, { signal: controller.signal, yieldControl: async () => controller.abort() }), { name: 'AbortError' });
  const report = await summary([{ x: 'A' }], [question('x')]); await assert.rejects(serializeSurvey(report, 'json', { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(serializeSurvey(report, 'md', immediate), /只支持/u); report.basis.extra = 'x'.repeat(LIMITS.outputBytes); await assert.rejects(serializeSurvey(report, 'json', immediate), /12 MiB/u);
});

// DOM contract fixture: not a claim of Electron dialog/browser integration QA.
class Element {
  constructor(tag) { this.tagName = tag; this.nodeType = 1; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.disabled = false; this.checked = false; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; if (key === 'checked') this.checked = true; }
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
function control(root, title) { return descendants(root).find(element => element.attributes['aria-label'] === title); }
async function withUI(files, callback) {
  const previous = { document: global.document, window: global.window, FileReader: global.FileReader };
  global.document = { createElement: tag => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) }; global.window = { toolbox: { files } };
  global.FileReader = class { readAsArrayBuffer(file) { this.result = file.buffer; this.onload(); } abort() { this.onabort?.(); } };
  const root = new Element('main'), lifecycle = (await import('../src/renderer/features/T009/index.js')).default.create(root, {});
  try { await callback(root, lifecycle); } finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}

test('T009 UI: exact four-answer sample gives denominator3, multi dedup, numeric invalid and cross3; protected export', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: '/copy/' + payload.defaultName }; } }, async root => {
    assert.equal(button(root, '按配置汇总问卷').disabled, true); await button(root, '载入四份答卷示例及配置').fire('click'); await button(root, '按配置汇总问卷').fire('click');
    assert.match(root.textContent, /总样本4 · 有效3 · 缺答1 · 非法0 · 比例分母3/u); assert.match(root.textContent, /已去重1个重复选择/u);
    assert.match(root.textContent, /总样本4 · 有效2 · 缺答1 · 非法1/u); assert.match(root.textContent, /有效成对3/u);
    await button(root, '保存完整 JSON 副本').fire('click'); await button(root, '保存完整 CSV 副本').fire('click'); assert.deepEqual(saved.map(payload => [payload.extension, payload.copyOnly]), [['json', true], ['csv', true]]);
    const report = JSON.parse(saved[0].content); assert.equal(report.questions[2].frequencies.find(row => row.value === 'B').count, 3);
    control(root, 'Q3自定义多选分隔符').value = '|'; await control(root, 'Q3自定义多选分隔符').fire('input'); assert.equal(button(root, '保存完整 JSON 副本').disabled, true);
  });
});

test('T009 UI: paste parse, actual field/type/separator/trim controls and disabled unsafe old writer', async () => {
  await withUI({ saveText: async () => assert.fail('must not call unprotected writer') }, async root => {
    control(root, '问卷数据内容').value = 'x\nA| B |A\n'; await control(root, '问卷数据内容').fire('input'); await button(root, '解析问卷数据').fire('click');
    control(root, '新增题目类型').value = 'multiple'; await button(root, '添加此字段为题目').fire('click');
    control(root, 'Q1多选分隔符预设').value = '|'; await control(root, 'Q1多选分隔符预设').fire('change'); assert.equal(control(root, 'Q1自定义多选分隔符').value, '|');
    await button(root, '按配置汇总问卷').fire('click'); assert.match(root.textContent, /选择总数2/u); assert.match(root.textContent, /已去重1个重复选择/u);
    assert.equal(button(root, '保存完整 CSV 副本').disabled, true); assert.match(root.textContent, /缺少副本保护/u);
    control(root, 'Q1修剪首尾空白').checked = false; await control(root, 'Q1修剪首尾空白').fire('change'); assert.equal(button(root, '保存完整 JSON 副本').disabled, true);
  });
});

test('T009 UI: file input fatal UTF8 is atomic, raw CRLF preserved and input change discards questions', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: 'copy' }; } }, async root => {
    const file = control(root, '选择问卷数据文件'), bytes = new TextEncoder().encode('x\r\n"A\r\nB"\r\n'); file.files = [{ name: 'survey.csv', size: bytes.length, buffer: bytes.buffer }]; await file.fire('change');
    control(root, '问卷数据内容').value = 'x\n"A\nB"\n'; file.files = [{ name: 'bad.csv', size: 1, buffer: new Uint8Array([255]).buffer }]; await file.fire('change'); assert.match(root.textContent, /不是有效UTF-8/u);
    await button(root, '解析问卷数据').fire('click'); await button(root, '添加此字段为题目').fire('click'); await button(root, '按配置汇总问卷').fire('click'); await button(root, '保存完整 JSON 副本').fire('click');
    assert.equal(JSON.parse(saved[0].content).questions[0].frequencies[0].value, 'A\r\nB');
    await control(root, '问卷数据内容').fire('input'); assert.equal(button(root, '按配置汇总问卷').disabled, true); assert.equal(control(root, 'Q1字段'), undefined);
  });
});

test('T009 UI: cancellation and lifecycle recovery do not permit partial exports', async () => {
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async () => ({ canceled: true }) }, async (root, lifecycle) => {
    await button(root, '载入四份答卷示例及配置').fire('click'); const running = button(root, '按配置汇总问卷').fire('click'); lifecycle.deactivate(); await running;
    assert.match(root.textContent, /已取消/u); assert.equal(button(root, '保存完整 JSON 副本').disabled, true); lifecycle.activate(); await button(root, '按配置汇总问卷').fire('click');
    assert.match(root.textContent, /有效成对3/u); assert.equal(button(root, '取消当前操作').disabled, true);
  });
});

test('T009 UI: frequency pagination displays later categories without discarding the full export', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: 'copy' }; } }, async root => {
    control(root, '问卷数据内容').value = 'x\n' + Array.from({ length: 30 }, (_, index) => 'v' + String(index).padStart(2, '0')).join('\n'); await control(root, '问卷数据内容').fire('input');
    await button(root, '解析问卷数据').fire('click'); await button(root, '添加此字段为题目').fire('click'); await button(root, '按配置汇总问卷').fire('click');
    const next = descendants(root).find(element => element.tagName === 'button' && element.textContent === '下一页' && !element.disabled);
    assert.ok(next); await next.fire('click'); assert.match(root.textContent, /v29/u);
    await button(root, '保存完整 JSON 副本').fire('click'); assert.equal(JSON.parse(saved[0].content).questions[0].frequencies.length, 30);
  });
});

test('T009 UI: valid empty JSON field name can be explicitly selected without losing its identity', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: 'copy' }; } }, async root => {
    control(root, '问卷输入格式').value = 'json'; control(root, '问卷数据内容').value = '[{"":"A"}]'; await control(root, '问卷数据内容').fire('input');
    await button(root, '解析问卷数据').fire('click'); await button(root, '添加此字段为题目').fire('click'); await button(root, '按配置汇总问卷').fire('click');
    assert.match(root.textContent, /有效1/u); await button(root, '保存完整 JSON 副本').fire('click'); assert.equal(JSON.parse(saved[0].content).questions[0].config.field, '');
  });
});
