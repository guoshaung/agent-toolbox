'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/renderer/features/T003/model.mjs');
const immediate = { yieldControl: async () => {} };
async function dataset(value, format = 'json', name = 'source') { return (await model).parseDataset({ name, format, text: typeof value === 'string' ? value : JSON.stringify(value) }, immediate); }
async function compare(old, newer, key = 'id') { return (await model).reconcile(await dataset(old, 'json', 'old.json'), await dataset(newer, 'json', 'new.json'), key, immediate); }

test('T003 acceptance: old 1/2 versus new 2/3 gives removed1, modified2 and added3 with source lines', async () => {
  const { EXAMPLE, reconcile } = await model;
  const result = await reconcile(await dataset(EXAMPLE.old, 'json', 'old.json'), await dataset(EXAMPLE.new, 'json', 'new.json'), 'id', immediate);
  assert.deepEqual(result.changes.map(row => [row.kind, row.key.value]), [['removed', 1], ['modified', 2], ['added', 3]]);
  const changed = result.changes[1];
  assert.deepEqual(changed.old.source, { name: 'old.json', row: 2, line: 3 });
  assert.deepEqual(changed.new.source, { name: 'new.json', row: 1, line: 2 });
  assert.deepEqual(changed.fields, [{ path: '/name', before: { present: true, value: '原名称' }, after: { present: true, value: '新名称' } }]);
  assert.deepEqual([result.stats.removed, result.stats.added, result.stats.modified, result.stats.unchanged, result.stats.conflictGroups], [1, 1, 1, 0, 0]);
});

test('T003: record order and nested object key order never produce changes', async () => {
  const result = await compare([{ id: 1, a: { x: 1, y: 2 } }, { id: 2, x: null }], [{ x: null, id: 2 }, { a: { y: 2, x: 1 }, id: 1 }]);
  assert.equal(result.stats.unchanged, 2); assert.deepEqual(result.changes, []);
});

test('T003: arrays are ordered; escaped JSON Pointer paths and root type changes are retained', async () => {
  const result = await compare([{ id: 1, list: [1, 2], 'a/b~c': { x: 1 }, value: {} }], [{ id: 1, list: [2, 1, 3], 'a/b~c': { x: 2 }, value: [] }]);
  assert.deepEqual(result.changes[0].fields.map(row => row.path), ['/a~1b~0c/x', '/list/0', '/list/1', '/list/2', '/value']);
  assert.deepEqual(result.changes[0].fields[3].before, { present: false });
});

test('T003: missing, null, empty string and different scalar types remain distinct', async () => {
  const result = await compare([{ id: 1, x: null, y: '', z: 1 }], [{ id: 1, x: '', q: null, z: '1' }]);
  assert.deepEqual(result.changes[0].fields.map(row => [row.path, row.before, row.after]), [
    ['/q', { present: false }, { present: true, value: null }], ['/x', { present: true, value: null }, { present: true, value: '' }],
    ['/y', { present: true, value: '' }, { present: false }], ['/z', { present: true, value: 1 }, { present: true, value: '1' }]
  ]);
});

test('T003: number1, string1, true and whitespace-bearing keys are not coerced; -0 and 0 are equal', async () => {
  const result = await compare([{ id: 1 }, { id: '1' }, { id: true }, { id: ' 1 ' }, { id: -0 }], [{ id: '1' }, { id: true }, { id: ' 1 ' }, { id: 0 }]);
  assert.equal(result.stats.unchanged, 4); assert.equal(result.stats.removed, 1);
  assert.deepEqual(result.changes[0].key, { type: 'number', value: 1 });
  const mixed = await (await model).reconcile(await dataset('id,name\n1,A\n', 'csv'), await dataset([{ id: 1, name: 'A' }]), 'id', immediate);
  assert.deepEqual(mixed.changes.map(row => row.kind), ['removed', 'added']);
});

test('T003: duplicate keys block all rows on both sides, including a unique opposite counterpart', async () => {
  const result = await compare([{ id: 1, value: 'a' }, { id: 1, value: 'b' }, { id: 2 }], [{ id: 1, value: 'c' }, { id: 2 }]);
  assert.equal(result.changes.length, 0); assert.equal(result.stats.unchanged, 1);
  assert.equal(result.conflicts[0].kind, 'duplicate-key'); assert.equal(result.conflicts[0].old.length, 2); assert.equal(result.conflicts[0].new.length, 1);
  assert.deepEqual([result.stats.conflictOldRows, result.stats.conflictNewRows], [2, 1]);
  const both = await compare([{ id: 1 }], [{ id: 1 }, { id: 1 }]); assert.equal(both.changes.length, 0); assert.equal(both.conflicts[0].new.length, 2);
});

test('T003: missing/null/blank/compound keys become separate conflicts without selecting or merging', async () => {
  const invalid = [{ x: 1 }, { id: null }, { id: '' }, { id: ' \t' }, { id: {} }, { id: [] }];
  const result = await compare(invalid, invalid);
  assert.equal(result.changes.length, 0); assert.equal(result.conflicts.length, 12);
  assert.ok(result.conflicts.every(conflict => conflict.kind === 'invalid-key' && conflict.old.length + conflict.new.length === 1));
  assert.equal(result.stats.conflictOldRows, 6); assert.equal(result.stats.conflictNewRows, 6);
});

test('T003: partition statistics account for every source row even with duplicate and invalid keys', async () => {
  const result = await compare([{ id: 1 }, { id: 1 }, {}, { id: 2, a: 1 }, { id: 3 }, { id: 4 }], [{ id: 1 }, { id: 2, a: 2 }, { id: 3 }, { id: 5 }, { id: null }]);
  const s = result.stats;
  assert.equal(s.oldRows, s.removed + s.modified + s.unchanged + s.conflictOldRows);
  assert.equal(s.newRows, s.added + s.modified + s.unchanged + s.conflictNewRows);
});

test('T003: strict CSV handles BOM, escaped quotes, comma/newline and physical source start lines', async () => {
  const parsed = await dataset('\uFEFFid,note\r\n1,"say ""hi, there""\r\nnext"\r\n2,done\r\n', 'csv', 'quoted.csv');
  assert.deepEqual(parsed.records.map(row => [row.source.row, row.source.line]), [[1, 2], [2, 4]]);
  assert.equal(parsed.records[0].value.note, 'say "hi, there"\r\nnext'); assert.equal(parsed.records[0].value.id, '1');
  assert.equal(parsed.records.length, 2);
});

test('T003: TSV, terminal separators and actual blank physical rows preserve strings/conflicts', async () => {
  const parsed = await dataset('id\tnote\n1\t"a\tb"\n\n2\t\n', 'tsv');
  assert.equal(parsed.records[0].value.note, 'a\tb'); assert.deepEqual(parsed.records[1].value, { id: '', note: '' });
  assert.equal(parsed.records.length, 3);
  const result = await (await model).reconcile(parsed, await dataset('id\tnote\n', 'tsv'), 'id', immediate);
  assert.equal(result.stats.removed, 2); assert.equal(result.stats.conflictOldRows, 1);
});

test('T003: bad CSV quoting, column mismatch and duplicate/blank headers are rejected', async () => {
  for (const text of ['id,name\n1,"bad', 'id,name\n1,"a" x', 'id,name\n1,a"b', 'id,name\n1', 'id,id\n1,2', 'id,\n1,a']) await assert.rejects(dataset(text, 'csv'));
  assert.equal((await dataset('id,name\n1,""\n', 'csv')).records[0].value.name, '');
});

test('T003: JSON strict syntax, duplicate properties and unsafe integers do not silently lose data', async () => {
  for (const text of ['{}', '[null]', '[[]]', '[1]', '[{"id":1},]', '[{"id":01}]', '[{"id":NaN}]', '[{"id":1}] trailing', '[{"id":1,"id":2}]', '[{"id":1,"nested":{"x":1,"x":2}}]', '[{"id":9007199254740993}]', '[{"id":1e999}]', '[{"id":"bad\nline"}]', '[{"id":"\\x61"}]']) await assert.rejects(dataset(text));
  assert.equal((await dataset('[{"id":"9007199254740993"}]')).records[0].value.id, '9007199254740993');
  assert.equal((await dataset('[{"id":1e2,"value":-1.25}]')).records[0].value.value, -1.25);
});

test('T003: JSON source lines include CR/LF/CRLF and escaped/newline strings retain values', async () => {
  const parsed = await dataset('\uFEFF[\r\n {"id":1,"text":"a\\n\\u4e2d\\\\\\\""},\r {"id":2}\n]', 'json', 'lines.json');
  assert.deepEqual(parsed.records.map(row => row.source.line), [2, 3]);
  assert.equal(parsed.records[0].value.text, 'a\n中\\"');
});

test('T003: prototype-looking fields are own data, including business key and pointer paths', async () => {
  const result = await compare('[{"__proto__":"key","constructor":{"x":1}}]', '[{"constructor":{"x":2},"__proto__":"key"}]', '__proto__');
  assert.equal(result.stats.modified, 1); assert.equal(result.changes[0].fields[0].path, '/constructor/x');
  assert.equal(result.changes[0].key.value, 'key');
});

test('T003: empty JSON arrays and header-only tables produce valid empty reports', async () => {
  assert.deepEqual((await compare([], [])).changes, []);
  const result = await (await model).reconcile(await dataset('id,name\n', 'csv'), await dataset('id\tname\n', 'tsv'), 'id', immediate);
  assert.equal(result.stats.oldRows, 0); assert.equal(result.stats.newRows, 0);
  await assert.rejects(compare([], [], ' '), /主键/u);
});

test('T003: UTF-8 bytes, string, depth, fields and row bounds fail explicitly', async () => {
  const { LIMITS } = await model;
  await assert.rejects(dataset('中'.repeat(Math.floor(LIMITS.bytes / 3) + 1)), /2 MiB/u);
  await assert.rejects(dataset([{ id: 'x'.repeat(50001) }]), /50000/u);
  await assert.rejects(dataset('[{"id":1,"v":' + '['.repeat(33) + '0' + ']'.repeat(33) + '}]'), /深度/u);
  await assert.rejects(dataset([Object.fromEntries(Array.from({ length: 101 }, (_, index) => ['a' + index, index]))]), /100个/u);
  await assert.rejects(dataset(Array.from({ length: 5001 }, (_, id) => ({ id }))), /5000/u);
  await assert.rejects(dataset('id\n' + 'a\n'.repeat(5001), 'csv'), /5000/u);
  const csv = Array(101).fill('a').map((value, index) => value + index).join(','); await assert.rejects(dataset(csv, 'csv'), /列数/u);
});

test('T003: node/cell/difference growth is bounded independently of byte limits', async () => {
  const rows = Array.from({ length: 1100 }, (_, id) => ({ id, v: Array(100).fill(0) }));
  await assert.rejects(dataset(rows), /节点数/u);
  const header = Array.from({ length: 100 }, (_, index) => 'c' + index).join(',');
  await assert.rejects(dataset(header + '\n' + (Array(100).fill('x').join(',') + '\n').repeat(1000), 'csv'), /单元格/u);
  const old = Array.from({ length: 1200 }, (_, id) => ({ id, v: Array(10).fill(0) })), newer = old.map(row => ({ ...row, v: Array(10).fill(1) }));
  await assert.rejects(compare(old, newer), /差异超过10000/u);
});

test('T003: parse and reconciliation cancellation stop work at asynchronous checkpoints', async () => {
  const { parseDataset, reconcile } = await model; const controller = new AbortController(); let yielded = 0;
  await assert.rejects(parseDataset({ name: 'a', format: 'json', text: JSON.stringify([{ id: 1, value: 'x'.repeat(50000) }]) }, { signal: controller.signal, yieldControl: async () => { if (++yielded === 2) controller.abort(); } }), { name: 'AbortError' });
  const other = new AbortController(), parsed = await dataset([{ id: 1 }]);
  await assert.rejects(reconcile(parsed, parsed, 'id', { signal: other.signal, yieldControl: async () => other.abort() }), { name: 'AbortError' });
});

test('T003: JSON/CSV export preserves source rows, field existence, conflict rows and safe strings', async () => {
  const { serializeReport } = await model;
  const result = await compare([{ id: 1, x: null }, { id: 2, x: '=1+1' }, { id: 2, x: 'duplicate' }], [{ id: 1, y: '' }, { id: 2, x: 'new' }]);
  const json = JSON.parse(await serializeReport(result, 'json', immediate));
  assert.equal(json.feature, 'T003'); assert.equal(json.changes[0].fields[0].before.present, true); assert.equal(json.changes[0].fields[0].after.present, false);
  assert.equal(json.conflicts[0].old.length, 2); assert.equal(json.conflicts[0].new.length, 1);
  const csv = await serializeReport(result, 'csv', immediate);
  assert.ok(csv.startsWith('\uFEFFkind,key_json,old_name_json')); assert.equal(csv.split('\r\n').filter(row => row.includes('duplicate-key')).length, 3);
  assert.ok(csv.includes('false')); assert.ok(csv.includes('=1+1'));
});

test('T003: export cancellation, format validation and byte cap protect generated reports', async () => {
  const { serializeReport, LIMITS } = await model, result = await compare([{ id: 1 }], []);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(serializeReport(result, 'json', { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(serializeReport(result, 'html', immediate), /只支持/u);
  const oversized = { ...result, conflicts: [{ text: 'x'.repeat(LIMITS.outputBytes) }] };
  await assert.rejects(serializeReport(oversized, 'json', immediate), /12 MiB/u);
});

// Minimal DOM contract fixture: does not claim real Electron UI validation.
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
  global.document = { createElement: tag => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) }; global.window = { toolbox: { files } };
  global.FileReader = class { readAsArrayBuffer(file) { this.result = file.buffer; this.onload(); } abort() { this.onabort?.(); } };
  const root = new Element('main'), lifecycle = (await import('../src/renderer/features/T003/index.js')).default.create(root, {});
  try { await callback(root, lifecycle); }
  finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}

test('T003 UI: example, field selection, protected JSON/CSV payload, pagination and invalidation', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: '/copy/' + payload.defaultName }; } }, async root => {
    assert.equal(button(root, '按主键对账').disabled, true); await button(root, '载入增删改示例').fire('click'); await button(root, '解析两侧数据').fire('click');
    assert.equal(button(root, '按主键对账').disabled, false); control(root, '已解析字段候选').value = 'id'; await control(root, '已解析字段候选').fire('change');
    await button(root, '按主键对账').fire('click'); assert.match(root.textContent, /新增1 · 移除1 · 修改1 · 未变0 · 冲突0/u);
    assert.match(root.textContent, /old.json · 记录2 · 物理行3/u); assert.match(root.textContent, /\/name/u);
    assert.ok(descendants(root).filter(element => element.tagName === 'button' && element.textContent === '上一页').every(element => element.disabled));
    await button(root, '保存完整 JSON 副本').fire('click'); await button(root, '保存差异与冲突 CSV 副本').fire('click');
    assert.deepEqual(saved.map(payload => [payload.extension, payload.copyOnly]), [['json', true], ['csv', true]]); assert.equal(JSON.parse(saved[0].content).stats.modified, 1);
    control(root, '旧数据内容').value = '[]'; await control(root, '旧数据内容').fire('input'); assert.equal(button(root, '按主键对账').disabled, true); assert.equal(button(root, '保存完整 JSON 副本').disabled, true);
  });
});

test('T003 UI: file/paste, invalid UTF-8 leaves input, preserve raw CRLF despite textarea normalization', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: 'copy.json' }; } }, async root => {
    const file = control(root, '旧数据文件'), bytes = new TextEncoder().encode('id,note\r\n1,"a\r\nb"\r\n');
    file.files = [{ name: 'old.csv', size: bytes.length, buffer: bytes.buffer }]; await file.fire('change');
    control(root, '旧数据内容').value = 'id,note\n1,"a\nb"\n'; // simulate browser-normalized display without an edit event
    file.files = [{ name: 'bad.csv', size: 1, buffer: new Uint8Array([255]).buffer }]; await file.fire('change'); assert.match(root.textContent, /不是有效UTF-8/u);
    control(root, '新数据内容').value = 'id,note\n1,"a\nb"\n'; control(root, '新数据格式').value = 'csv'; await control(root, '新数据内容').fire('input');
    await button(root, '解析两侧数据').fire('click'); await button(root, '按主键对账').fire('click'); assert.match(root.textContent, /修改1/u);
    await button(root, '保存完整 JSON 副本').fire('click'); const report = JSON.parse(saved[0].content);
    assert.equal(report.changes[0].fields[0].before.value, 'a\r\nb'); assert.equal(report.changes[0].fields[0].after.value, 'a\nb');
    assert.equal(report.changes[0].old.source.line, 2);
  });
});

test('T003 UI: conflict preview and old writer export block; lifecycle cancels async parsing', async () => {
  let wrote = false;
  await withUI({ saveText: async () => { wrote = true; } }, async (root, lifecycle) => {
    control(root, '旧数据内容').value = '[{"id":1},{"id":1},{}]'; control(root, '新数据内容').value = '[{"id":1}]';
    await button(root, '解析两侧数据').fire('click'); await button(root, '按主键对账').fire('click');
    assert.match(root.textContent, /冲突2组（旧3行\/新1行）/u); assert.match(root.textContent, /duplicate-key/u); assert.match(root.textContent, /缺失主键字段/u);
    assert.equal(button(root, '保存完整 JSON 副本').disabled, true); assert.equal(wrote, false);
    const parsing = button(root, '解析两侧数据').fire('click'); lifecycle.deactivate(); await parsing; assert.match(root.textContent, /已取消/u);
    assert.equal(button(root, '按主键对账').disabled, true); lifecycle.activate(); await button(root, '解析两侧数据').fire('click'); assert.equal(button(root, '按主键对账').disabled, false);
  });
});
