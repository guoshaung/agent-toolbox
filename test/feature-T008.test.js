'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/renderer/features/T008/model.mjs');
const immediate = { yieldControl: async () => {} };
async function dataset(value, format = 'json', name = 'sample') { return (await model).parseDataset({ name, format, text: typeof value === 'string' ? value : JSON.stringify(value) }, immediate); }
async function profile(value, format = 'json', descriptions = new Map()) { return (await model).buildDictionary(await dataset(value, format), descriptions, immediate); }
const field = (report, name) => report.fields.find(item => item.name === name);

test('T008 acceptance: ten rows with two nulls report exactly20% and show all ten as denominator', async () => {
  const { EXAMPLE, formatRate } = await model, report = await profile(EXAMPLE), score = field(report, 'score');
  assert.equal(report.sampleCount, 10); assert.equal(score.sampleCount, 10);
  assert.deepEqual(score.empty, { missing: 0, null: 2, emptyString: 0, count: 2, rate: 0.2 });
  assert.equal(formatRate(score.empty.rate), '20%'); assert.equal(score.typeCounts.number, 8);
  assert.equal(score.mixedTypes, false); assert.deepEqual(score.numericDomain, { count: 8, min: 10, max: 80, distinctCount: 8 });
  assert.match(report.basis.denominator, /全部数据记录/u);
});

test('T008: missing/null/empty separated; whitespace, zero,false and empty structures are valid nonempty values', async () => {
  const report = await profile([{}, { x: null }, { x: '' }, { x: ' ' }, { x: 0 }, { x: false }, { x: {} }, { x: [] }]);
  const x = field(report, 'x');
  assert.deepEqual(x.typeCounts, { missing: 1, null: 1, string: 2, number: 1, boolean: 1, object: 1, array: 1 });
  assert.equal(Object.values(x.typeCounts).reduce((a, b) => a + b), 8);
  assert.deepEqual(x.empty, { missing: 1, null: 1, emptyString: 1, count: 3, rate: 3 / 8 });
  assert.equal(x.mixedTypes, true); assert.deepEqual(x.nonNullTypes, ['string', 'number', 'boolean', 'object', 'array']);
  assert.deepEqual(x.examples.map(row => row.value), [' ', 0, false]);
});

test('T008: CSV remains string even for numeric/date/boolean/null-looking values and treats two empties as20%', async () => {
  const csv = 'value\n1\n2\n3\n4\n5\n6\n7\n8\n""\n\n';
  const report = await profile(csv, 'csv'), value = field(report, 'value');
  assert.equal(report.sampleCount, 10); assert.equal(value.empty.emptyString, 2); assert.equal(value.empty.rate, 0.2);
  assert.equal(value.typeCounts.string, 10); assert.equal(value.typeCounts.number, 0); assert.equal(value.numericDomain.count, 0);
  const typed = field(await profile('value\ntrue\nnull\n2026-10-03\n01\n', 'csv'), 'value');
  assert.equal(typed.typeCounts.string, 4); assert.equal(typed.empty.count, 0);
});

test('T008: null never creates mixed flag but numeric plus an empty string does', async () => {
  assert.equal(field(await profile([{ x: 1 }, { x: null }, {}]), 'x').mixedTypes, false);
  assert.equal(field(await profile([{ x: 1 }, { x: '' }]), 'x').mixedTypes, true);
  assert.equal(field(await profile([{ x: null }, {}]), 'x').mixedTypes, false);
});

test('T008: numeric min/max/distinct and boolean domain retain zero and negative values', async () => {
  const report = await profile([{ x: -5, b: true }, { x: 0, b: false }, { x: 12.5, b: true }, { x: -5, b: null }]);
  assert.deepEqual(field(report, 'x').numericDomain, { count: 4, min: -5, max: 12.5, distinctCount: 3 });
  assert.deepEqual(field(report, 'b').booleanDomain, { true: 2, false: 1 });
});

test('T008: string UTF16 lengths and lexical domain include empty and use deterministic code-unit ordering', async () => {
  const x = field(await profile([{ x: '' }, { x: '😀' }, { x: 'Z' }, { x: 'a' }, { x: 'a' }]), 'x');
  assert.equal(x.stringDomain.minLengthUTF16, 0); assert.equal(x.stringDomain.maxLengthUTF16, 2);
  assert.equal(x.stringDomain.lexicalMin, ''); assert.equal(x.stringDomain.lexicalMax, '😀'); assert.equal(x.stringDomain.distinctCount, 4);
  assert.deepEqual(x.stringDomain.topValues, [{ value: 'a', count: 2 }, { value: '', count: 1 }, { value: 'Z', count: 1 }, { value: '😀', count: 1 }]);
});

test('T008: frequency output is capped at10 with accurate distinct count and truncation status', async () => {
  const x = field(await profile(Array.from({ length: 12 }, (_, index) => ({ x: 'value' + String(index).padStart(2, '0') }))), 'x');
  assert.equal(x.stringDomain.distinctCount, 12); assert.equal(x.stringDomain.topValues.length, 10); assert.equal(x.stringDomain.topValuesTruncated, true);
  assert.equal(x.stringDomain.topValues[0].value, 'value00');
});

test('T008: examples are first3 different nonempty values with file record/physical source provenance', async () => {
  const x = field(await profile('id,value\r\n1,"first\r\nline"\r\n2,first\r\n3,first\r\n4,next\r\n5,last\r\n', 'csv'), 'value');
  assert.deepEqual(x.examples.map(example => [example.value, example.source.row, example.source.line]), [['first\r\nline', 1, 2], ['first', 2, 4], ['next', 4, 6]]);
  assert.equal(x.examples.length, 3);
});

test('T008: nested values are top-level structured types, explicit no flattening and escaped field pointers', async () => {
  const report = await profile([{ 'a/b~c': { inner: 2 }, values: [1, 2] }]);
  assert.equal(report.fieldCount, 2); assert.equal(field(report, 'a/b~c').path, '/a~1b~0c');
  assert.equal(field(report, 'a/b~c').typeCounts.object, 1); assert.equal(field(report, 'values').typeCounts.array, 1);
  assert.match(report.basis.scope, /不展开/u); assert.deepEqual(field(report, 'values').examples[0].value, [1, 2]);
});

test('T008: empty/header-only inputs have undefined rate, not a fabricated0%', async () => {
  const { formatRate } = await model, csv = await profile('id,value\n', 'csv');
  assert.equal(csv.sampleCount, 0); assert.equal(field(csv, 'value').empty.rate, null);
  assert.equal(formatRate(null), '不适用（0条样本）'); assert.equal((await profile([])).fieldCount, 0);
});

test('T008: strict table shapes reject objects/primitives, duplicate JSON attributes and bad CSV quoting/headers', async () => {
  for (const invalid of ['{}', '[null]', '[1]', '[[]]', '[{"x":1,"x":2}]', '[{"x":{"a":1,"a":2}}]', '[{"x":1},]']) await assert.rejects(dataset(invalid));
  for (const invalid of ['id,id\n1,2', 'id,\n1,a', 'id,value\n1', 'id,value\n1,"bad', 'id,value\n1,"x" tail', 'id,value\n1,a"b']) await assert.rejects(dataset(invalid, 'csv'));
});

test('T008: reject Number rounding, underflow, unsafe integers, overflow and excessive number tokens', async () => {
  for (const value of ['9007199254740993', '9007199254740992', '1.00000000000000001', '0.100000000000000005', '1e-999', '1e999', '1234567890.123456789', '1'.repeat(129)]) await assert.rejects(dataset(`[{"x":${value}}]`));
  for (const value of ['0.1', '1.2300', '1e2', '0.0000011', '-0.0', '5e-324', '9007199254740991', '1.2345678901234567']) assert.equal(typeof (await dataset(`[{"x":${value}}]`)).records[0].value.x, 'number');
  assert.equal((await dataset('[{"x":"9007199254740993"}]')).records[0].value.x, '9007199254740993');
});

test('T008: BOM/CR/LF/CRLF source positions and prototype-like names remain own data', async () => {
  const report = await profile('\uFEFF[\r\n {"__proto__":"safe"},\r {"__proto__":"next"}\n]');
  assert.deepEqual(field(report, '__proto__').examples.map(example => example.source.line), [2, 3]);
  const custom = await profile('[{"__proto__":"safe"}]', 'json', new Map([['__proto__', '自定义说明']])); assert.equal(custom.fields[0].description, '自定义说明');
});

test('T008: bytes/rows/string/depth/field/node/cell bounds prevent excessive retained data', async () => {
  const { LIMITS } = await model;
  await assert.rejects(dataset('中'.repeat(Math.floor(LIMITS.bytes / 3) + 1)), /2 MiB/u);
  await assert.rejects(dataset([{ x: 'x'.repeat(50001) }]), /50000/u);
  await assert.rejects(dataset(Array.from({ length: 5001 }, () => ({ x: 1 }))), /5000/u);
  await assert.rejects(dataset('[{"x":' + '['.repeat(33) + '0' + ']'.repeat(33) + '}]'), /深度/u);
  await assert.rejects(dataset([Object.fromEntries(Array.from({ length: 101 }, (_, index) => ['x' + index, index]))]), /100个/u);
  await assert.rejects(dataset(Array.from({ length: 1100 }, () => ({ x: Array(100).fill(0) }))), /节点数/u);
  const header = Array.from({ length: 100 }, (_, index) => 'x' + index).join(',');
  await assert.rejects(dataset(header + '\n' + (Array(100).fill('x').join(',') + '\n').repeat(1000), 'csv'), /单元格/u);
});

test('T008: descriptions are editable strings with bounded length and stable field identity', async () => {
  const { setDescription, buildDictionary } = await model, report = await profile([{ a: 1 }], 'json', new Map([['a', '单位：个']]));
  assert.equal(report.fields[0].description, '单位：个'); setDescription(report, 0, '新说明'); assert.equal(report.fields[0].description, '新说明');
  assert.throws(() => setDescription(report, -1, ''), /索引/u); assert.throws(() => setDescription(report, 0, 'x'.repeat(2001)), /2000/u);
  await assert.rejects(buildDictionary(await dataset([{ a: 1 }]), new Map([['a', 5]]), immediate), /说明/u);
});

test('T008: JSON/Markdown carry basis, ranges, source examples and escaped manual markup', async () => {
  const { serializeDictionary, setDescription, EXAMPLE } = await model, report = await profile(EXAMPLE);
  const index = report.fields.findIndex(item => item.name === 'score'); setDescription(report, index, '<script>alert(1)</script>\n[x](https://example.com) | `code`');
  const json = JSON.parse(await serializeDictionary(report, 'json', immediate));
  assert.equal(json.feature, 'T008'); assert.equal(field(json, 'score').empty.rate, 0.2); assert.match(json.basis.empty, /缺失字段/u);
  const markdown = await serializeDictionary(report, 'md', immediate);
  assert.match(markdown, /样本数：10/u); assert.match(markdown, /空值率：20%/u); assert.ok(markdown.includes('&lt;script&gt;'));
  assert.ok(!markdown.includes('<script>')); assert.ok(markdown.includes('\n')); assert.ok(markdown.includes('物理行')); assert.ok(markdown.includes('string=0'));
});

test('T008: parsing, profiling and export cancel at actual asynchronous checkpoints', async () => {
  const { parseDataset, buildDictionary, serializeDictionary } = await model;
  const controller = new AbortController(); let yields = 0;
  await assert.rejects(parseDataset({ name: 'a', format: 'json', text: JSON.stringify([{ a: 'x'.repeat(50000) }]) }, { signal: controller.signal, yieldControl: async () => { if (++yields === 2) controller.abort(); } }), { name: 'AbortError' });
  const next = new AbortController(); await assert.rejects(buildDictionary(await dataset([{ x: 1 }]), new Map(), { signal: next.signal, yieldControl: async () => next.abort() }), { name: 'AbortError' });
  const report = await profile([{ x: 1 }]), last = new AbortController(); last.abort(); await assert.rejects(serializeDictionary(report, 'json', { signal: last.signal }), { name: 'AbortError' });
});

test('T008: unsupported exports and generated output expansion hit explicit cap', async () => {
  const { serializeDictionary, LIMITS } = await model, report = await profile([{ x: 1 }]);
  await assert.rejects(serializeDictionary(report, 'csv', immediate), /只支持/u);
  report.fields[0].description = 'x'.repeat(LIMITS.outputBytes);
  await assert.rejects(serializeDictionary(report, 'json', immediate), /12 MiB/u);
});

// DOM contract fixture checks renderer behavior only, not native Electron IPC.
class Element {
  constructor(tag) { this.tagName = tag; this.nodeType = 1; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.disabled = false; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; }
  addEventListener(name, action) { (this.listeners[name] ||= []).push(action); }
  append(...children) { for (const child of children) this.children.push(child.nodeType ? child : { nodeType: 3, textContent: String(child) }); if (this.tagName === 'select' && !this.value) this.value = this.children[0]?.value || ''; if (this.tagName === 'textarea') this.value = this.textContent; }
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
  const root = new Element('main'), lifecycle = (await import('../src/renderer/features/T008/index.js')).default.create(root, {});
  try { await callback(root, lifecycle); }
  finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}

test('T008 UI: exact20% example, actual description edits and safe JSON/Markdown exports', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: '/copy/' + payload.defaultName }; } }, async root => {
    assert.equal(button(root, '保存 JSON 字典副本').disabled, true);
    await button(root, '载入10行20%空值示例').fire('click'); await button(root, '生成字段字典').fire('click');
    assert.match(root.textContent, /10条样本 · 3个顶层字段/u); assert.match(root.textContent, /空值率20%/u);
    const description = control(root, '字段3说明'); description.value = '测试成绩，单位：分'; await description.fire('input');
    await button(root, '保存 JSON 字典副本').fire('click'); await button(root, '保存 Markdown 字典副本').fire('click');
    assert.deepEqual(saved.map(payload => [payload.extension, payload.copyOnly]), [['json', true], ['md', true]]);
    assert.equal(field(JSON.parse(saved[0].content), 'score').description, '测试成绩，单位：分'); assert.match(saved[1].content, /测试成绩/u);
    control(root, '数据内容').value = '[]'; await control(root, '数据内容').fire('input'); assert.equal(button(root, '保存 JSON 字典副本').disabled, true);
    assert.match(root.textContent, /旧统计与说明已废弃/u);
  });
});

test('T008 UI: real pagination keeps edited field identity and description across pages', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: 'copy' }; } }, async root => {
    control(root, '数据内容').value = JSON.stringify([Object.fromEntries(Array.from({ length: 12 }, (_, index) => ['f' + String(index).padStart(2, '0'), index]))]); await control(root, '数据内容').fire('input');
    await button(root, '生成字段字典').fire('click'); assert.equal(button(root, '上一页').disabled, true); assert.equal(button(root, '下一页').disabled, false);
    control(root, '字段1说明').value = '第一页'; await control(root, '字段1说明').fire('input'); await button(root, '下一页').fire('click');
    control(root, '字段11说明').value = '第二页'; await control(root, '字段11说明').fire('input'); await button(root, '上一页').fire('click');
    assert.equal(control(root, '字段1说明').value, '第一页'); await button(root, '保存 JSON 字典副本').fire('click'); const report = JSON.parse(saved[0].content);
    assert.equal(report.fields[0].description, '第一页'); assert.equal(report.fields[10].description, '第二页');
  });
});

test('T008 UI: UTF-8 import preserves raw CRLF, failed encoding keeps input, old writer blocked', async () => {
  await withUI({ saveText: async () => assert.fail('old writer must not execute') }, async root => {
    const file = control(root, '选择数据文件'), bytes = new TextEncoder().encode('id,note\r\n1,"a\r\nb"\r\n'); file.files = [{ name: 'data.csv', size: bytes.length, buffer: bytes.buffer }]; await file.fire('change');
    control(root, '数据内容').value = 'id,note\n1,"a\nb"\n'; // browser display normalization without input event
    file.files = [{ name: 'bad.csv', size: 1, buffer: new Uint8Array([255]).buffer }]; await file.fire('change'); assert.match(root.textContent, /不是有效UTF-8/u);
    await button(root, '生成字段字典').fire('click'); assert.match(root.textContent, /字符串长度4～4/u); assert.match(root.textContent, /缺少副本保护/u);
    assert.equal(button(root, '保存 Markdown 字典副本').disabled, true);
  });
});

test('T008 UI: lifecycle cancellation destroys incomplete report and allows generation after activation', async () => {
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async () => ({ canceled: true }) }, async (root, lifecycle) => {
    await button(root, '载入10行20%空值示例').fire('click'); const running = button(root, '生成字段字典').fire('click'); lifecycle.deactivate(); await running;
    assert.match(root.textContent, /已取消/u); assert.equal(button(root, '保存 JSON 字典副本').disabled, true);
    lifecycle.activate(); await button(root, '生成字段字典').fire('click'); assert.match(root.textContent, /空值率20%/u); assert.equal(button(root, '取消当前操作').disabled, true);
  });
});
