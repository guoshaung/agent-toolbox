const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/renderer/features/T010/model.mjs');
const immediate = { yieldControl: async () => {} };
const config = (extra = {}) => ({ parentPath: '', arrayPath: '/items', strategy: 'expand', arrayColumn: 'items_json', mappings: [{ column: 'id', scope: 'parent', path: '/id' }, { column: 'item', scope: 'element', path: '' }], ...extra });
async function parsed(value) { return (await model).parseJSON({ name: 'data.json', text: typeof value === 'string' ? value : JSON.stringify(value) }, immediate); }
async function prediction(value, configuration = config()) { return (await model).predictFlatten(await parsed(value), configuration, immediate); }
async function flattened(value, configuration = config()) { return (await model).executeFlatten(await prediction(value, configuration), immediate); }

test('T010: specification2/1 elements gives3 stable rows, repeated parent IDs and source provenance', async () => {
  const { EXAMPLE, EXAMPLE_CONFIG } = await model, result = await flattened(EXAMPLE, EXAMPLE_CONFIG);
  assert.equal(result.rowCount, 3); assert.deepEqual(result.rows.map(row => [row.values.parent_id, row.values.sku]), [['P1', 'A'], ['P1', 'B'], ['P2', 'C']]);
  assert.deepEqual(result.rows.map(row => [row.source.parentIndex, row.source.parentLine, row.source.arrayIndex, row.source.elementLine]), [[1, 3, 1, 3], [1, 3, 2, 3], [2, 4, 1, 4]]);
  assert.equal(result.rows[0].values.tags_json, '["x","y"]'); assert.deepEqual(result.rows[0].jsonLiteralColumns, ['tags_json']);
  assert.equal(result.audit.discardedLeafPaths, 3); assert.deepEqual(result.audit.discardedOutsideParentPaths, ['/metadata/version']);
});

test('T010: scalar array elements keep number boolean null string and nested JSON literal types', async () => {
  const result = await flattened([{ id: 1, items: [10, false, null, 'x', { x: 1 }, [2, 3]] }]);
  assert.deepEqual(result.rows.map(row => row.values.item), [10, false, null, 'x', '{"x":1}', '[2,3]']);
  assert.ok(result.rows.every(row => row.source.elementPresent)); assert.deepEqual(result.rows[4].jsonLiteralColumns, ['item']);
});

test('T010: missing/null/empty arrays preserve parent once, real null element remains present', async () => {
  const result = await flattened([{ id: 1 }, { id: 2, items: null }, { id: 3, items: [] }, { id: 4, items: [null] }]);
  assert.equal(result.rowCount, 4); assert.deepEqual(result.rows.map(row => row.source.arrayState), ['missing-array', 'null-array', 'empty-array', 'expanded']);
  assert.deepEqual(result.rows.map(row => row.source.elementPresent), [false, false, false, true]);
  assert.deepEqual(result.rows.map(row => row.source.arrayIndex), [null, null, null, 1]);
  assert.equal(Object.hasOwn(result.rows[0].values, 'item'), false); assert.equal(result.rows[3].values.item, null); assert.deepEqual(result.rows[0].missingColumns, ['item']);
});

test('T010: preserve strategy emits one parent row and explicit JSON array/null/missing column', async () => {
  const result = await flattened([{ id: 1, items: [1, 2] }, { id: 2, items: null }, { id: 3 }, { id: 4, items: [] }], config({ strategy: 'preserve', mappings: [{ column: 'id', scope: 'parent', path: '/id' }] }));
  assert.equal(result.rowCount, 4); assert.deepEqual(result.rows.map(row => row.values.items_json), ['[1,2]', 'null', undefined, '[]']);
  assert.deepEqual(result.rows.map(row => row.source.arrayState), ['preserved-array', 'null-array', 'missing-array', 'empty-array']);
  assert.equal(result.rows[1].jsonLiteralColumns.includes('items_json'), true); assert.deepEqual(result.rows[2].missingColumns, ['items_json']);
  assert.ok(result.rows.every(row => !row.source.elementPresent && row.source.arrayIndex === null));
});

test('T010: parallel arrays neither zip nor form cartesian products; fixed index stays fixed', async () => {
  const result = await flattened([{ id: 1, items: ['A', 'B'], tags: ['X', 'Y', 'Z'] }], config({ mappings: [...config().mappings, { column: 'tags', scope: 'parent', path: '/tags' }, { column: 'firstTag', scope: 'parent', path: '/tags/0' }] }));
  assert.equal(result.rowCount, 2); assert.ok(result.rows.every(row => row.values.firstTag === 'X' && row.values.tags === '["X","Y","Z"]'));
});

test('T010: pointer escaping, empty property names and own __proto__ fields are safe', async () => {
  const result = await flattened('[{"id":"P","a/b~c":[{"":"v"}],"__proto__":"safe"}]', config({ arrayPath: '/a~1b~0c', mappings: [{ column: '__proto__', scope: 'parent', path: '/__proto__' }, { column: 'value', scope: 'element', path: '/' }] }));
  assert.equal(result.rows[0].values.__proto__, 'safe'); assert.equal(result.rows[0].values.value, 'v'); assert.equal(Object.getPrototypeOf(result.rows[0].values), Object.prototype);
});

test('T010: pointer syntax rejects invalid escapes/fragment/dot syntax and invalid array indices', async () => {
  const { parsePointer, resolvePointer } = await model;
  for (const path of ['a.b', '#/x', '/~2', '/~', '/' + 'x'.repeat(513), '/' + Array(33).fill('x').join('/')]) assert.throws(() => parsePointer(path));
  for (const token of ['01', '-', '*', '-1', '9007199254740993']) assert.throws(() => resolvePointer([1], [token]), /数组路径/u);
  assert.deepEqual(resolvePointer([1], ['1']), { present: false }); assert.deepEqual(resolvePointer({ '*': 2 }, ['*']), { present: true, value: 2 });
});

test('T010: parent root/path is explicit and non-table or non-array selection is rejected', async () => {
  for (const value of [{}, 3, [null], [[]], [1]]) await assert.rejects(prediction(value), /父/u);
  await assert.rejects(prediction([{ id: 1, items: {} }]), /不是数组/u); await assert.rejects(prediction([{ id: 1, items: 'A' }]), /不是数组/u);
  await assert.rejects(prediction({ rows: [] }, config({ parentPath: '/missing' })), /父路径/u);
  assert.equal((await flattened({ rows: [] }, config({ parentPath: '/rows' }))).rowCount, 0);
});

test('T010: mappings require unique nonreserved columns, valid scopes and at least a parent field', async () => {
  const { validateConfig, RESERVED } = await model;
  for (const extra of [{ arrayPath: '' }, { mappings: [] }, { mappings: Array(31).fill(config().mappings[0]) }, { mappings: [config().mappings[0], { column: 'id', scope: 'element', path: '' }] }, { mappings: [{ column: ' id ', scope: 'parent', path: '' }] }, { mappings: [{ column: RESERVED[0], scope: 'parent', path: '' }] }, { mappings: [{ column: 'x', scope: 'unknown', path: '' }] }, { mappings: [{ column: 'x', scope: 'element', path: '' }] }, { strategy: 'preserve' }, { strategy: 'preserve', arrayColumn: 'id', mappings: [config().mappings[0]] }]) assert.throws(() => validateConfig(config(extra)));
});

test('T010: missing mapped property remains distinct from null, empty string and missing ancestors', async () => {
  const result = await flattened([{ id: 1, items: [{ x: null }, { x: '' }, {}, { x: 0 }] }], config({ mappings: [config().mappings[0], { column: 'x', scope: 'element', path: '/x' }] }));
  assert.deepEqual(result.rows.map(row => row.values.x), [null, '', undefined, 0]); assert.deepEqual(result.rows[2].missingColumns, ['x']);
  const absent = await flattened([{ id: 1, items: [null] }], config({ mappings: [config().mappings[0], { column: 'x', scope: 'element', path: '/x' }] })); assert.deepEqual(absent.rows[0].missingColumns, ['x']);
});

test('T010: audit gives exact nested leaf risks and source rows including data outside parent path', async () => {
  const result = await flattened({ rows: [{ id: 1, meta: { x: 1, y: 2 }, ignored: [], items: [{ a: 1, b: { c: 2 }, empty: {} }] }], header: 'outside' }, config({ parentPath: '/rows', mappings: [config().mappings[0], { column: 'x', scope: 'parent', path: '/meta/x' }, { column: 'a', scope: 'element', path: '/a' }] }));
  assert.deepEqual(result.audit.discardedOutsideParentPaths, ['/header']); assert.deepEqual(result.audit.parents[0].discardedParentPaths, ['/meta/y', '/ignored']);
  assert.deepEqual(result.audit.parents[0].elements[0].discardedPaths, ['/b/c', '/empty']); assert.equal(result.audit.discardedLeafPaths, 5);
});

test('T010: whole object/array mappings cover their entire subtree without false loss', async () => {
  const result = await flattened([{ id: 1, meta: { x: 1, y: 2 }, items: [{ a: 1, b: 2 }] }], config({ mappings: [{ column: 'parent', scope: 'parent', path: '' }] }));
  assert.equal(result.audit.discardedLeafPaths, 0); assert.equal(result.audit.parents[0].elementsKeptByParentJSON, true); assert.deepEqual(result.audit.parents[0].elements, []);
  assert.deepEqual(result.rows[0].jsonLiteralColumns, ['parent']);
});

test('T010: unselected scalar element reports root leaf and escaped risk paths', async () => {
  const result = await flattened([{ id: 1, 'a/b~c': 2, items: [5] }], config({ mappings: [config().mappings[0]] }));
  assert.deepEqual(result.audit.parents[0].discardedParentPaths, ['/a~1b~0c']); assert.deepEqual(result.audit.parents[0].elements[0].discardedPaths, ['']);
});

test('T010: fixed parent paths into selected array cover only that exact retained element in audit', async () => {
  const result = await flattened([{ id: 1, items: [{ a: 1, b: 2 }, { a: 3, b: 4 }] }], config({ mappings: [config().mappings[0], { column: 'first_a', scope: 'parent', path: '/items/0/a' }] }));
  assert.deepEqual(result.audit.parents[0].elements.map(item => item.discardedPaths), [['/b'], ['/a', '/b']]);
  assert.deepEqual(result.rows.map(row => row.values.first_a), [1, 1]);
  await assert.rejects(prediction([{ id: 1, items: [1] }], config({ mappings: [config().mappings[0], { column: 'bad', scope: 'parent', path: '/items/01' }] })), /数组路径/u);
  await assert.rejects(prediction([{ id: 1, items: [[1]] }], config({ mappings: [config().mappings[0], { column: 'bad', scope: 'element', path: '/-' }] })), /数组路径/u);
});

test('T010: strict JSON rejects duplicate keys and decimal/integer precision loss before any output', async () => {
  for (const value of ['[{"id":1,"id":2}]', '[{"id":9007199254740993}]', '[{"id":1.00000000000000001}]', '[{"id":1e-999}]', '[{"id":1e999}]', '[{"id":01}]', '[{"id":1,}]', '[true]extra']) await assert.rejects(parsed(value));
  const result = await parsed('[{"n":0.1,"a":1.2300,"b":1e2}]'); assert.deepEqual(result.root[0], { n: 0.1, a: 1.23, b: 100 });
});

test('T010: BOM and CRLF/CR/LF preserve physical parent/primitive element lines', async () => {
  const result = await flattened('\uFEFF[\r\n {"id":1,"items":[\r  "A",\n  "B"\r\n ]}\r\n]');
  assert.deepEqual(result.rows.map(row => [row.source.parentLine, row.source.elementLine]), [[2, 3], [2, 4]]);
});

test('T010: input/depth/field limits and output prediction caps reject whole batches', async () => {
  await assert.rejects(parsed('中'.repeat(700000)), /2 MiB/u); await assert.rejects(parsed('['.repeat(34) + '0' + ']'.repeat(34)), /32/u);
  await assert.rejects(parsed([{ ...Object.fromEntries(Array.from({ length: 101 }, (_, index) => ['x' + index, 1])) }]), /100字段/u);
  await assert.rejects(prediction(Array.from({ length: 5001 }, () => ({ id: 1, items: [] }))), /5000/u);
  await assert.rejects(prediction([{ id: 1, items: Array(10001).fill(0) }]), /10000输出行/u);
  await assert.rejects(prediction([{ id: 1, items: Array(4000).fill(0) }], config({ mappings: Array.from({ length: 30 }, (_, index) => ({ column: 'c' + index, scope: 'parent', path: '/id' })) })), /100000/u);
});

test('T010: excessive unmapped audit and unsafe long paths abort rather than truncate risks', async () => {
  const records = Array.from({ length: 1001 }, () => ({ id: 1, items: [], ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => ['unused' + index, 0])) }));
  await assert.rejects(prediction(records), /未映射叶路径超过10000/u);
  await assert.rejects(prediction([{ id: 1, items: [], ['x'.repeat(513)]: 1 }]), /审计字段路径超过512/u);
});

test('T010: repeated large parent text causes execution byte cap, not partial report', async () => {
  const estimate = await prediction([{ id: 1, blob: 'x'.repeat(50000), items: Array(300).fill(0) }], config({ mappings: [...config().mappings, { column: 'blob', scope: 'parent', path: '/blob' }] }));
  assert.equal(estimate.rowCount, 300); await assert.rejects((await model).executeFlatten(estimate, immediate), /12 MiB/u);
});

test('T010: full audit bytes are bounded independently of input and leaf count', async () => {
  const records = Array.from({ length: 4000 }, () => ({ id: 1, items: [], ['u'.repeat(200)]: 0, ['v'.repeat(200)]: 0 }));
  await assert.rejects(prediction(records), /完整丢弃审计超过2 MiB/u);
  const { serializeFlatten, LIMITS } = await model, report = await flattened([{ id: 1, items: [] }]); report.audit.policy.extra = 'x'.repeat(LIMITS.outputBytes);
  await assert.rejects(serializeFlatten(report, 'audit', immediate), /导出超过12 MiB/u);
});

test('T010: parse, prediction, execution and export can cancel with no result and recover', async () => {
  const { parseJSON, predictFlatten, executeFlatten, serializeFlatten } = await model;
  const aborting = () => { const controller = new AbortController(); return { signal: controller.signal, yieldControl: async () => controller.abort() }; };
  await assert.rejects(parseJSON({ name: 'data', text: '[]' }, aborting()), { name: 'AbortError' });
  await assert.rejects(predictFlatten(await parsed([{ id: 1, items: [1] }]), config(), aborting()), { name: 'AbortError' });
  const estimate = await prediction([{ id: 1, items: [1] }]); await assert.rejects(executeFlatten(estimate, aborting()), { name: 'AbortError' });
  const report = await executeFlatten(estimate, immediate); await assert.rejects(serializeFlatten(report, 'json', aborting()), { name: 'AbortError' }); assert.equal(report.rowCount, 1);
});

test('T010: full JSON/audit/CSV exports include mappings, physical sources and typed missing markers', async () => {
  const { serializeFlatten, RESERVED } = await model, result = await flattened([{ id: '=CMD', items: [null, 'missing'], ignored: 2 }]);
  const json = JSON.parse(await serializeFlatten(result, 'json', immediate)); assert.equal(json.rows.length, 2); assert.deepEqual(json.audit.parents[0].discardedParentPaths, ['/ignored']);
  const audit = JSON.parse(await serializeFlatten(result, 'audit', immediate)); assert.equal(audit.predictedRows, 2); assert.equal(audit.mappings[1].scope, 'element'); assert.ok(audit.policy.precision);
  const csv = await serializeFlatten(result, 'csv', immediate); assert.ok(csv.startsWith('\uFEFF"' + RESERVED[0] + '"')); assert.equal(csv.split('\r\n').length, 4); assert.ok(csv.includes('""=CMD""'));
  const missing = await flattened([{ id: 1 }]); assert.ok((await serializeFlatten(missing, 'csv', immediate)).includes('{""present"":false}'));
  await assert.rejects(serializeFlatten(result, 'md', immediate), /只支持/u);
});

// Minimal DOM contract fixture; does not verify native Electron dialogs/IPC.
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
function control(root, title) { return descendants(root).find(element => element.attributes['aria-label'] === title); }
async function withUI(files, callback) {
  const previous = { document: global.document, window: global.window, FileReader: global.FileReader };
  global.document = { createElement: tag => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) }; global.window = { toolbox: { files } };
  global.FileReader = class { readAsArrayBuffer(file) { this.result = file.buffer; this.onload(); } abort() { this.onabort?.(); } };
  const root = new Element('main'), lifecycle = (await import('../src/renderer/features/T010/index.js')).default.create(root, {});
  try { await callback(root, lifecycle); } finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}

test('T010 UI: prediction precedes execution, example3 rows, all3 copyOnly exports and invalidate on edit', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: 'copy' }; } }, async root => {
    assert.equal(button(root, '按预测执行扁平化').disabled, true); await button(root, '载入两父记录三元素示例').fire('click');
    await button(root, '预测输出与风险').fire('click'); assert.match(root.textContent, /预测：2父记录 → 3输出行/u); assert.equal(button(root, '保存完整 JSON 副本').disabled, true);
    await button(root, '按预测执行扁平化').fire('click'); assert.match(root.textContent, /已执行：3行/u); assert.match(root.textContent, /JSON字面量/u);
    for (const title of ['保存完整 JSON 副本', '保存扁平 CSV 副本', '保存完整审计 JSON 副本']) await button(root, title).fire('click');
    assert.deepEqual(saved.map(payload => [payload.extension, payload.copyOnly]), [['json', true], ['csv', true], ['json', true]]);
    assert.deepEqual(JSON.parse(saved[0].content).rows.map(row => [row.values.parent_id, row.values.sku]), [['P1', 'A'], ['P1', 'B'], ['P2', 'C']]);
    assert.equal(JSON.parse(saved[2].content).discardedLeafPaths, 3); assert.equal(saved[2].defaultName, 'flatten-audit-copy.json');
    control(root, '映射1输出列名').value = 'parent_key'; await control(root, '映射1输出列名').fire('input'); assert.equal(button(root, '按预测执行扁平化').disabled, true); assert.equal(button(root, '保存完整 JSON 副本').disabled, true);
  });
});

test('T010 UI: preserve strategy explicitly requires removing element mapping and produces2 rows', async () => {
  await withUI({ saveText: async () => assert.fail('unsafe writer') }, async root => {
    await button(root, '载入两父记录三元素示例').fire('click'); control(root, '数组处理策略').value = 'preserve'; await control(root, '数组处理策略').fire('change');
    await button(root, '预测输出与风险').fire('click'); assert.match(root.textContent, /保留策略不可使用元素/u);
    await button(root, '移除映射2').fire('click'); await button(root, '预测输出与风险').fire('click'); await button(root, '按预测执行扁平化').fire('click');
    assert.match(root.textContent, /已执行：2行/u); assert.match(root.textContent, /items_json/u); assert.equal(button(root, '保存完整 JSON 副本').disabled, true); assert.match(root.textContent, /缺少副本保护/u);
  });
});

test('T010 UI: real map add/scope/path edits and parent path discard stale results', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true }; } }, async root => {
    control(root, '层级JSON内容').value = '[{"id":1,"items":[{"x":2},{"x":3}]}]'; await control(root, '层级JSON内容').fire('input');
    control(root, '映射2JSON Pointer').value = '/x'; await control(root, '映射2JSON Pointer').fire('input'); await button(root, '添加映射列').fire('click');
    control(root, '映射3范围').value = 'element'; await control(root, '映射3范围').fire('change'); control(root, '映射3JSON Pointer').value = '/missing'; await control(root, '映射3JSON Pointer').fire('input');
    await button(root, '预测输出与风险').fire('click'); await button(root, '按预测执行扁平化').fire('click'); await button(root, '保存完整 JSON 副本').fire('click');
    const result = JSON.parse(saved[0].content); assert.deepEqual(result.rows.map(row => row.values.item_value), [2, 3]); assert.deepEqual(result.rows[0].missingColumns, ['column_1']);
    control(root, '父记录JSON Pointer').value = '/rows'; await control(root, '父记录JSON Pointer').fire('input'); assert.equal(button(root, '按预测执行扁平化').disabled, true);
  });
});

test('T010 UI: fatal UTF8 file failure is atomic, CRLF physical lines retained and overlimit import rejected', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true }; } }, async root => {
    const file = control(root, '选择层级JSON文件'), bytes = new TextEncoder().encode('[\r\n{"id":1,"items":[\r\n"A"]}]');
    file.files = [{ name: 'source.json', size: bytes.length, buffer: bytes.buffer }]; await file.fire('change');
    file.files = [{ name: 'bad.json', size: 1, buffer: new Uint8Array([255]).buffer }]; await file.fire('change'); assert.match(root.textContent, /不是有效UTF-8/u);
    await button(root, '预测输出与风险').fire('click'); await button(root, '按预测执行扁平化').fire('click'); await button(root, '保存完整 JSON 副本').fire('click');
    const row = JSON.parse(saved[0].content).rows[0]; assert.equal(row.source.name, 'source.json'); assert.equal(row.source.parentLine, 2); assert.equal(row.source.elementLine, 3);
    file.files = [{ name: 'large.json', size: 2097153 }]; await file.fire('change'); assert.match(root.textContent, /文件超过2 MiB/u); assert.equal(button(root, '保存完整 JSON 副本').disabled, false);
  });
});

test('T010 UI: lifecycle cancellation permits retry and never permits partial export', async () => {
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async () => ({ canceled: true }) }, async (root, lifecycle) => {
    await button(root, '载入两父记录三元素示例').fire('click'); const predicting = button(root, '预测输出与风险').fire('click'); lifecycle.deactivate(); await predicting;
    assert.match(root.textContent, /已取消/u); assert.equal(button(root, '按预测执行扁平化').disabled, true); lifecycle.activate(); await button(root, '预测输出与风险').fire('click');
    const running = button(root, '按预测执行扁平化').fire('click'); await button(root, '取消当前操作').fire('click'); await running; assert.equal(button(root, '保存完整 JSON 副本').disabled, true);
    await button(root, '按预测执行扁平化').fire('click'); await button(root, '保存完整 JSON 副本').fire('click'); assert.match(root.textContent, /已取消另存/u); assert.equal(button(root, '取消当前操作').disabled, true);
  });
});

test('T010 UI: pagination shows last elements without truncating full output', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true }; } }, async root => {
    control(root, '层级JSON内容').value = JSON.stringify([{ id: 1, items: Array.from({ length: 30 }, (_, index) => 'v' + index) }]); await control(root, '层级JSON内容').fire('input');
    await button(root, '预测输出与风险').fire('click'); await button(root, '按预测执行扁平化').fire('click'); assert.equal(button(root, '上一页').disabled, true);
    await button(root, '下一页').fire('click'); assert.match(root.textContent, /v29/u); assert.equal(button(root, '下一页').disabled, true);
    await button(root, '查看输出行30').fire('click'); assert.match(root.textContent, /"arrayIndex": 30/u); await button(root, '保存完整 JSON 副本').fire('click'); assert.equal(JSON.parse(saved[0].content).rows.length, 30);
  });
});
