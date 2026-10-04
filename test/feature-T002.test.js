'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/renderer/features/T002/model.mjs');
const immediate = { yieldControl: async () => {} };

test('T002: five data rows, only two trimmed cells, original input retained', async () => {
  const { parseDelimited, cleanTable } = await model;
  const parsed = await parseDelimited('姓名,城市\r\n 张三,北京\r\n李四 ,上海\r\n王五,广州\r\n赵六,深圳\r\n钱七,杭州\r\n', {}, immediate);
  const cleaned = await cleanTable(parsed, {}, immediate);
  assert.equal(cleaned.stats.inputRows, 5);
  assert.equal(cleaned.stats.outputRows, 5);
  assert.equal(cleaned.stats.changedCells, 2);
  assert.deepEqual(cleaned.changes.map(x => [x.sourceLine, x.before, x.after]), [[2, ' 张三', '张三'], [3, '李四 ', '李四']]);
  assert.equal(parsed.records[0].cells[0], ' 张三');
  assert.deepEqual(cleaned.rows.map(x => x.sourceLine), [2, 3, 4, 5, 6]);
});

test('T002: quoted commas, escaped quotes, CRLF and source physical lines', async () => {
  const { parseDelimited } = await model;
  const parsed = await parseDelimited('\uFEFFid,note\r\n1,"a,b\r\nc"\r\n2,"said ""yes"""\r\n', {}, immediate);
  assert.equal(parsed.hadBOM, true);
  assert.deepEqual(parsed.header, ['id', 'note']);
  assert.deepEqual(parsed.records.map(x => x.cells), [['1', 'a,b\r\nc'], ['2', 'said "yes"']]);
  assert.deepEqual(parsed.records.map(x => x.sourceLine), [2, 4]);
});

test('T002: TSV and headerless input preserve trailing empty fields', async () => {
  const { parseDelimited, cleanTable } = await model;
  const parsed = await parseDelimited('a\tb\t\n1\t"two\tparts"\t\n', { delimiter: '\t', header: false }, immediate);
  assert.equal(parsed.header, null);
  assert.deepEqual(parsed.records[1].cells, ['1', 'two\tparts', '']);
  assert.equal((await cleanTable(parsed, {}, immediate)).rows.length, 2);
});

test('T002: default rules preserve blank physical lines and duplicate rows', async () => {
  const { parseDelimited, cleanTable } = await model;
  const parsed = await parseDelimited('a,b\n\nx,y\nx,y\n,\n', {}, immediate);
  const cleaned = await cleanTable(parsed, {}, immediate);
  assert.deepEqual(cleaned.rows.map(x => x.cells), [['', ''], ['x', 'y'], ['x', 'y'], ['', '']]);
  assert.equal(cleaned.stats.blankRows, 2);
  assert.equal(cleaned.stats.duplicateRows, 2);
  assert.deepEqual(cleaned.removed, []);
});

test('T002: targeted cleaning does not touch unselected columns or headers', async () => {
  const { parseDelimited, cleanTable } = await model;
  const parsed = await parseDelimited(' A , B \n Ｈｅｌｌｏ  WORLD , Keep \n', {}, immediate);
  const cleaned = await cleanTable(parsed, { columns: [0], trim: true, collapseWhitespace: true, nfkc: true, letterCase: 'lower' }, immediate);
  assert.deepEqual(cleaned.header, [' A ', ' B ']);
  assert.deepEqual(cleaned.rows[0].cells, ['hello world', ' Keep ']);
  assert.deepEqual(cleaned.changes[0].reasons, ['首尾空白', '连续空白', '兼容字符规范化', '转小写']);
});

test('T002: empty means empty string, not NULL, null or numeric zero', async () => {
  const { parseDelimited, cleanTable } = await model;
  const parsed = await parseDelimited('a,b,c,d\n ,NULL,null,0', {}, immediate);
  const cleaned = await cleanTable(parsed, { fillEmpty: true, fillValue: '未填写' }, immediate);
  assert.deepEqual(cleaned.rows[0].cells, ['未填写', 'NULL', 'null', '0']);
  const noTrim = await cleanTable(parsed, { trim: false, fillEmpty: true, fillValue: '未填写' }, immediate);
  assert.equal(noTrim.rows[0].cells[0], ' ');
});

test('T002: explicit removals keep first cleaned duplicate and source audit', async () => {
  const { parseDelimited, cleanTable } = await model;
  const parsed = await parseDelimited('a,b\n , \nx,y\n x ,y\n,x\n', {}, immediate);
  const cleaned = await cleanTable(parsed, { blankRows: 'drop', duplicateRows: 'drop' }, immediate);
  assert.deepEqual(cleaned.rows.map(x => x.sourceLine), [3, 5]);
  assert.deepEqual(cleaned.removed, [{ sourceLine: 2, reason: '清洗后整行为空' }, { sourceLine: 4, reason: '清洗后完全重复', duplicateOf: 3 }]);
  assert.equal(cleaned.stats.removedBlankRows, 1);
  assert.equal(cleaned.stats.removedDuplicateRows, 1);
});

test('T002: malformed quoting and ragged nonblank rows fail with source line', async () => {
  const { parseDelimited } = await model;
  await assert.rejects(parseDelimited('a,b\n1,"unfinished', {}, immediate), /第 2 行.*未闭合/u);
  await assert.rejects(parseDelimited('a,b\n1,b"ad', {}, immediate), /第 2 行.*未加引号/u);
  await assert.rejects(parseDelimited('a,b\n1,"ok" space', {}, immediate), /第 2 行.*闭引号/u);
  await assert.rejects(parseDelimited('a,b\n1', {}, immediate), /第 2 行有 1 列，预期 2 列/u);
});

test('T002: byte, record, column, cell and field caps are enforced', async () => {
  const { parseDelimited } = await model;
  await assert.rejects(parseDelimited('中文', { limits: { bytes: 5 } }, immediate), /超过/u);
  await assert.rejects(parseDelimited('h\na\nb', { limits: { rows: 1 } }, immediate), /数据超过 1 行/u);
  await assert.rejects(parseDelimited('a,b', { limits: { columns: 1 } }, immediate), /超过 1 列/u);
  await assert.rejects(parseDelimited('a,b\nx,y', { limits: { cells: 3 } }, immediate), /单元格数量超过 3/u);
  await assert.rejects(parseDelimited('h\nlong', { limits: { cellLength: 3 } }, immediate), /单个字段超过 3/u);
});

test('T002: parse cancellation works even at skipped escaped-quote boundaries', async () => {
  const { parseDelimited } = await model;
  const controller = new AbortController();
  let yields = 0;
  const input = 'h\n"' + '""'.repeat(20000) + '"';
  await assert.rejects(parseDelimited(input, {}, { signal: controller.signal, yieldControl: async () => { yields++; controller.abort(); } }), { name: 'AbortError' });
  assert.equal(yields, 1);
});

test('T002: cleaning and serialization respond to cancellation', async () => {
  const { parseDelimited, cleanTable, serializeTable, serializeReport } = await model;
  const parsed = await parseDelimited('h\n x', {}, immediate);
  const result = await cleanTable(parsed, {}, immediate);
  for (const action of [signal => cleanTable(parsed, {}, { signal }), signal => serializeTable(result, {}, { signal }), signal => serializeReport(result, {}, { signal })]) {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(action(controller.signal), { name: 'AbortError' });
  }
});

test('T002: CSV export round-trip retains embedded newline and escapes', async () => {
  const { parseDelimited, cleanTable, serializeTable } = await model;
  const parsed = await parseDelimited('id,note\n1,"a,b\nc"\n2,"a""b"\n', {}, immediate);
  const result = await cleanTable(parsed, { trim: false }, immediate);
  const output = await serializeTable(result, { bom: true }, immediate);
  assert.ok(output.startsWith('\uFEFF_source_line,id,note\r\n'));
  const again = await parseDelimited(output, {}, immediate);
  assert.deepEqual(again.records.map(x => x.cells), [['2', '1', 'a,b\nc'], ['4', '2', 'a"b']]);
  assert.equal(output.split('a,b\nc').length, 2);
});

test('T002: source column avoids colliding headers; original export is optional', async () => {
  const { parseDelimited, cleanTable, serializeTable } = await model;
  const result = await cleanTable(await parseDelimited('_source_line,_source_line_\nx,y', {}, immediate), {}, immediate);
  assert.ok((await serializeTable(result, { bom: false }, immediate)).startsWith('_source_line__,_source_line,_source_line_\r\n'));
  assert.equal(await serializeTable(result, { bom: false, includeSourceLine: false }, immediate), '_source_line,_source_line_\r\nx,y\r\n');
});

test('T002: report preserves exact old values, rules and removed source lines', async () => {
  const { parseDelimited, cleanTable, serializeReport } = await model;
  const rules = { trim: true, duplicateRows: 'drop' };
  const result = await cleanTable(await parseDelimited('h\n x \nx', {}, immediate), rules, immediate);
  const report = JSON.parse(await serializeReport(result, { sourceName: 'sample', rules }, immediate));
  assert.equal(report.feature, 'T002');
  assert.equal(report.sourceName, 'sample');
  assert.deepEqual(report.rules, rules);
  assert.equal(report.changes[0].before, ' x ');
  assert.equal(report.removed[0].sourceLine, 3);
});

test('T002: expanded export and reports stop at the output budget', async () => {
  const { parseDelimited, cleanTable, serializeTable, serializeReport } = await model;
  const result = await cleanTable(await parseDelimited('h\n' + '\n'.repeat(7000), {}, immediate), { fillEmpty: true, fillValue: '中'.repeat(1000) }, immediate);
  await assert.rejects(serializeTable(result, {}, immediate), /导出超过 12 MiB/u);
  await assert.rejects(serializeReport(result, {}, immediate), /变更清单超过 12 MiB/u);
});

test('T002: parser and transformations validate configuration', async () => {
  const { parseDelimited, cleanTable } = await model;
  await assert.rejects(parseDelimited('', {}, immediate), /请先输入/u);
  await assert.rejects(parseDelimited('\uFEFF', {}, immediate), /只有 BOM/u);
  await assert.rejects(parseDelimited('h', { delimiter: ';' }, immediate), /分隔符/u);
  const parsed = await parseDelimited('h\nx', {}, immediate);
  await assert.rejects(cleanTable(parsed, { columns: [1] }, immediate), /选择列/u);
  await assert.rejects(cleanTable(parsed, { letterCase: 'title' }, immediate), /大小写/u);
});

// Minimal DOM contract fixture, without installing a browser or pretending this is live Electron QA.
class Element {
  constructor(tag) { this.tagName = tag; this.nodeType = 1; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.checked = false; this.disabled = false; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'checked') this.checked = true; if (key === 'disabled') this.disabled = true; }
  addEventListener(name, action) { (this.listeners[name] ||= []).push(action); }
  append(...children) {
    for (const child of children) this.children.push(child.nodeType ? child : { nodeType: 3, textContent: String(child) });
    if (this.tagName === 'select' && !this.value) this.value = this.children[0]?.value || '';
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  get textContent() { return this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  querySelectorAll(selector) {
    const tags = selector.split(',');
    return descendants(this).filter(child => selector === '[data-page-disabled]' ? child.dataset.pageDisabled !== undefined : tags.includes(child.tagName));
  }
  async fire(name) { if (this.disabled) return; for (const action of this.listeners[name] || []) await action({ currentTarget: this }); }
}
function descendants(element) { return element.children.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []); }
function button(root, title) { return descendants(root).find(el => el.tagName === 'button' && el.textContent === title); }
async function withUI(files, callback) {
  const previous = { document: global.document, window: global.window, FileReader: global.FileReader };
  global.document = { createElement: tag => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) };
  global.window = { toolbox: { files } };
  global.FileReader = class {
    readAsArrayBuffer(selected) { this.result = selected.buffer; this.onload(); }
    abort() { this.onabort?.(); }
  };
  const root = new Element('main');
  const feature = (await import('../src/renderer/features/T002/index.js')).default;
  const lifecycle = feature.create(root, {});
  try { await callback(root, lifecycle); }
  finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}

test('T002 UI contract: sample, preview, pager bounds and copy-only CSV/report payloads', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: '/new-copy/' + payload.defaultName }; } }, async (root, lifecycle) => {
    assert.equal(button(root, '3. 保存结果副本').disabled, true);
    await button(root, '载入五行示例').fire('click');
    await button(root, '1. 解析并选择列').fire('click');
    await button(root, '2. 生成清洗预览').fire('click');
    assert.equal(button(root, '3. 保存结果副本').disabled, false);
    assert.ok(descendants(root).filter(el => el.tagName === 'button' && el.textContent === '上一页').every(el => el.disabled));
    await button(root, '3. 保存结果副本').fire('click');
    await button(root, '保存变更清单').fire('click');
    assert.equal(saved.length, 2);
    assert.equal(saved[0].copyOnly, true);
    assert.equal(saved[0].extension, 'csv');
    assert.equal(saved[0].defaultName, '示例.cleaned.csv');
    assert.ok(saved[0].content.startsWith('\uFEFF_source_line,姓名,城市,备注'));
    const report = JSON.parse(saved[1].content);
    assert.equal(saved[1].copyOnly, true);
    assert.equal(report.stats.outputRows, 5);
    assert.equal(report.stats.changedCells, 2);
    lifecycle.deactivate(); lifecycle.activate();
    assert.equal(button(root, '3. 保存结果副本').disabled, false);
  });
});

test('T002 UI contract: missing safe writer blocks export; changed input invalidates preview', async () => {
  let called = false;
  await withUI({ saveText: async () => { called = true; } }, async root => {
    await button(root, '载入五行示例').fire('click');
    await button(root, '1. 解析并选择列').fire('click');
    await button(root, '2. 生成清洗预览').fire('click');
    assert.equal(button(root, '3. 保存结果副本').disabled, true);
    assert.match(root.textContent, /缺少副本保护保存接口/u);
    const source = descendants(root).find(el => el.tagName === 'textarea');
    source.value = 'one,two\nx,y'; await source.fire('input');
    assert.equal(button(root, '2. 生成清洗预览').disabled, true);
    assert.equal(called, false);
  });
});

test('T002 UI contract: local TSV file selects delimiter and rejects invalid UTF-8', async () => {
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async () => ({ canceled: true }) }, async root => {
    const file = descendants(root).find(el => el.attributes.type === 'file');
    file.files = [{ name: 'sample.tsv', size: 8, buffer: new TextEncoder().encode('a\tb\nx\ty').buffer }];
    await file.fire('change');
    await button(root, '1. 解析并选择列').fire('click');
    await button(root, '2. 生成清洗预览').fire('click');
    assert.equal(button(root, '3. 保存结果副本').disabled, false);
    assert.equal(descendants(root).find(el => el.attributes['aria-label'] === '副本文件名').value, 'sample.cleaned.tsv');
    file.files = [{ name: 'bad.csv', size: 1, buffer: new Uint8Array([255]).buffer }];
    await file.fire('change');
    assert.match(root.textContent, /不是有效 UTF-8/u);
  });
});
