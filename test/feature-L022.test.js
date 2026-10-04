const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L022/model.mjs');

test('L022 验收max(2,1)→2杀死反转比较，有具体输入/期望/结果证据', async () => {
  const { runMutationTests } = await model(); const result = runMutationTests('max', [{ a: 2, b: 1, expected: 2 }]);
  assert.equal(result.status, 'completed'); assert.equal(result.tests[0].baselinePass, true);
  const reverse = result.mutants.find((row) => row.id === 'max.reverse'); assert.equal(reverse.status, 'killed'); assert.deepEqual(reverse.killedBy, ['T1']);
  assert.deepEqual(reverse.observations[0], { id: 'T1', a: 2, b: 1, expected: 2, actual: { kind: 'value', value: 1 }, kills: true });
  assert.match(reverse.originalImplementation, />/); assert.match(reverse.implementation, /</); assert.equal(result.score.numerator, 2); assert.equal(result.score.denominator, 3);
});

test('L022 已证明等价排除；仅相等测试存活不擅自排除，得分0/3', async () => {
  const { runMutationTests } = await model(); const result = runMutationTests('max', [{ a: 0, b: 0, expected: 0 }]);
  const equivalent = result.mutants.find((row) => row.id === 'max.inclusive'); assert.equal(equivalent.status, 'equivalent'); assert.equal(equivalent.counted, false); assert.match(equivalent.equivalenceReason, /a=b/); assert.equal(equivalent.observations.length, 0);
  assert.equal(result.score.generated, 4); assert.equal(result.score.excludedEquivalent, 1); assert.equal(result.score.denominator, 3); assert.equal(result.score.value, 0);
  for (const row of result.mutants.filter((row) => row.counted)) { assert.equal(row.status, 'survived'); assert.match(row.survivalMeaning, /不代表等价/); }
});

test('L022 多条测试杀死同一变异只计一项，增强max测试得到3/3', async () => {
  const { runMutationTests, getFunction } = await model(); const result = runMutationTests('max', getFunction('max').examples.strong);
  assert.equal(result.score.numerator, 3); assert.equal(result.score.value, 1); assert.equal(result.score.survived, 0);
  assert.deepEqual(result.mutants.find((row) => row.id === 'max.reverse').killedBy, ['T1', 'T2']);
  assert.deepEqual(result.mutants.find((row) => row.id === 'max.unequal').killedBy, ['T2']);
});

test('L022 任一原函数期望失败即基准失败，不运行变异或生成得分', async () => {
  const { runMutationTests } = await model(); const result = runMutationTests('max', [{ a: 2, b: 1, expected: 1 }, { a: 1, b: 2, expected: 2 }]);
  assert.equal(result.status, 'baseline-failed'); assert.equal(result.score, null); assert.deepEqual(result.mutants, []); assert.deepEqual(result.tests.map((row) => row.baselinePass), [false, true]); assert.equal(result.tests[0].original.value, 2);
});

test('L022 空测试无得分，不能把无数据当0%已完成', async () => {
  const { runMutationTests } = await model(); const result = runMutationTests('sum', []);
  assert.equal(result.status, 'empty'); assert.equal(result.score, null); assert.deepEqual(result.mutants, []); assert.match(result.message, /不能视为合格/);
});

test('L022 两个算术实验最小示例隐藏错误，零/负数边界提高杀死率', async () => {
  const { runMutationTests, getFunction } = await model();
  for (const id of ['sum', 'product']) {
    const weak = runMutationTests(id, getFunction(id).examples.weak); assert.equal(weak.score.numerator, 2); assert.equal(weak.score.denominator, 3); assert.equal(weak.score.excludedEquivalent, 0);
    assert.equal(weak.mutants.find((row) => row.id === (id === 'sum' ? 'sum.multiply' : 'product.add')).status, 'survived');
    const strong = runMutationTests(id, getFunction(id).examples.strong); assert.equal(strong.score.value, 1); assert.equal(strong.score.numerator, 3);
  }
});

test('L022 零除NaN/±Infinity为可观察杀死证据，JSON保留文字而非null', async () => {
  const { runMutationTests } = await model(); const result = runMutationTests('sum', [{ a: 0, b: 0, expected: 0 }, { a: 1, b: 0, expected: 1 }, { a: -1, b: 0, expected: -1 }]);
  const divide = result.mutants.find((row) => row.id === 'sum.divide'); assert.equal(divide.status, 'killed'); assert.deepEqual(divide.killedBy, ['T1', 'T2', 'T3']);
  assert.deepEqual(divide.observations.map((row) => row.actual.display), ['NaN', 'Infinity', '-Infinity']); assert.ok(divide.observations.every((row) => row.actual.kind === 'non-finite' && !Object.hasOwn(row.actual, 'value')));
  const exported = JSON.parse(JSON.stringify(result)); assert.equal(exported.mutants.find((row) => row.id === divide.id).observations[0].actual.display, 'NaN');
});

test('L022 数值域端点/负零规范化，原函数结果精确有限', async () => {
  const { runMutationTests, validateTests } = await model();
  const product = runMutationTests('product', [{ a: 1000000, b: -1000000, expected: -1000000000000 }]); assert.equal(product.status, 'completed'); assert.equal(product.tests[0].original.value, -1000000000000);
  const sum = runMutationTests('sum', [{ a: -1000000, b: 1000000, expected: 0 }]); assert.equal(sum.status, 'completed');
  assert.equal(Object.is(validateTests([{ a: '-0', b: 0, expected: 0 }])[0].a, -0), false);
});

test('L022 参数/期望输入与64条容量边界，不接受用户代码或非有限数值', async () => {
  const { runMutationTests, validateTests } = await model(); const valid = { a: 2, b: 1, expected: 2 };
  for (const bad of ['', '1e3', 'Infinity', NaN, Infinity, null, false, '()=>2', 1.5, 1000001]) assert.throws(() => validateTests([{ ...valid, a: bad }]));
  for (const expected of [null, 'NaN', 1000000000001, -1000000000001, 2.2]) assert.throws(() => validateTests([{ ...valid, expected }]));
  assert.throws(() => validateTests([null])); assert.throws(() => validateTests([[]])); assert.throws(() => runMutationTests('custom-code', [valid]), /内置/);
  const maximum = runMutationTests('max', Array.from({ length: 64 }, () => ({ ...valid }))); assert.equal(maximum.tests.length, 64); assert.equal(maximum.score.numerator, 2);
  assert.throws(() => runMutationTests('max', Array.from({ length: 65 }, () => ({ ...valid }))), /64/);
});

test('L022 确定性运行不改测试和函数库，返回结果与输入相互独立', async () => {
  const { runMutationTests, FUNCTIONS } = await model(); const library = structuredClone(FUNCTIONS); const tests = [{ a: '2', b: '1', expected: '2' }]; const original = structuredClone(tests);
  const first = runMutationTests('max', tests); assert.deepEqual(first, runMutationTests('max', tests)); assert.deepEqual(tests, original); assert.deepEqual(FUNCTIONS, library);
  tests[0].a = '0'; assert.equal(first.tests[0].a, 2);
});

test('L022 schema及64KiB UTF8边界，Markdown有实现、结果、分母和未生成状态', async () => {
  const { prepareStoredState, validateStoredState, runMutationTests, reportMarkdown } = await model();
  const overhead = new TextEncoder().encode(JSON.stringify({ source: '', schemaVersion: 1 })).byteLength; const exact = prepareStoredState({ source: 'a'.repeat(65536 - overhead) }); assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 65536); assert.equal(validateStoredState(exact), exact);
  assert.throws(() => prepareStoredState({ source: exact.source + 'a' }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 1, source: '汉'.repeat(22000) }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/);
  const report = reportMarkdown(runMutationTests('max', [{ a: 2, b: 1, expected: 2 }])); assert.match(report, /2\/3（66.67%）/); assert.match(report, /max.reverse：killed/); assert.match(report, /\(2,1\)/); assert.match(report, /等价排除，不计分/); assert.match(report, /return a < b/);
  assert.match(reportMarkdown(runMutationTests('max', [{ a: 2, b: 1, expected: 1 }])), /变异得分：未生成/);
});

class NodeStub {
  constructor(tag = '', text = null) { this.tagName = tag; this.nodeType = text === null ? 1 : 3; this.text = text; this.children = []; this.attributes = {}; this.style = {}; this.dataset = {}; this.className = ''; this.events = {}; this.value = ''; this.checked = false; this.disabled = false; this.classList = { add: (name) => { this.className += ` ${name}`; }, remove: (name) => { this.className = this.className.split(' ').filter((item) => item !== name).join(' '); }, toggle: (name, yes) => { this.classList.remove(name); if (yes) this.classList.add(name); } }; }
  append(...items) { this.children.push(...items.map((item) => item?.nodeType ? item : new NodeStub('', String(item)))); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'disabled') this.disabled = true; }
  addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
  get textContent() { return this.text === null ? this.children.map((child) => child.textContent).join('') : this.text; }
  set textContent(value) { this.text = null; this.replaceChildren(String(value)); }
  set innerHTML(_value) { throw new Error('User input must be rendered as text'); }
  async fire(type) { if (type === 'click' && this.disabled) return; for (const callback of this.events[type] || []) await callback({ target: this }); }
}
const walk = (node) => [node, ...node.children.flatMap(walk)];
const button = (root, label) => { const node = walk(root).find((item) => item.tagName === 'button' && item.textContent === label); assert.ok(node, label); return node; };
const control = (root, label) => { const node = walk(root).find((item) => item.attributes['aria-label'] === label); assert.ok(node, label); return node; };
async function fill(root, label, value) { const node = control(root, label); node.value = value; await node.fire(node.tagName === 'select' ? 'change' : 'input'); }
function dom(t, files) { const oldDocument = global.document; const oldWindow = global.window; global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) }; global.window = { toolbox: { files } }; t.after(() => { global.document = oldDocument; global.window = oldWindow; }); }

test('L022 界面max最小例→添加反向输入杀死存活项→完整JSON/Markdown导出', async (t) => {
  const exported = []; const saved = new Map(); dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L022/index.js');
  const config = { get: (key) => saved.get(key), set: (key, value) => saved.set(key, value) }; const root = new NodeStub('div'); const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await button(root, '运行变异训练').fire('click'); assert.match(root.textContent, /变异得分 2\/3（66.67%）/); assert.match(root.textContent, /max.reverse · 已杀死/); assert.match(root.textContent, /T1 输入\(2,1\) → 原函数\/期望 2；变异结果 1/); assert.match(root.textContent, /max.unequal · 存活/); assert.match(root.textContent, /等价排除 1 项/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
  await button(root, '添加测试').fire('click'); await fill(root, '测试2参数a', '1'); await fill(root, '测试2参数b', '2'); await fill(root, '测试2期望', '2'); assert.doesNotMatch(root.textContent, /变异得分 2\/3/);
  await button(root, '运行变异训练').fire('click'); assert.match(root.textContent, /变异得分 3\/3（100.00%）/); assert.match(root.textContent, /max.unequal · 已杀死/);
  await button(root, '导出完整 JSON').fire('click'); const payload = JSON.parse(exported[0].content); assert.equal(payload.schemaVersion, 1); assert.equal(payload.result.score.numerator, 3); assert.equal(payload.result.score.excludedEquivalent, 1); assert.equal(exported[0].copyOnly, true);
  await button(root, '导出变异 Markdown').fire('click'); assert.equal(exported[1].extension, 'md'); assert.match(exported[1].content, /max.inclusive：equivalent/);
  handle.deactivate(); assert.equal(saved.get('features.L022.state').schemaVersion, 1); assert.equal(Object.hasOwn(saved.get('features.L022.state'), 'result'), false);
  const restoredRoot = new NodeStub('div'); const restored = feature.create(restoredRoot, { config }); assert.match(restoredRoot.textContent, /已恢复测试草稿/); assert.equal(control(restoredRoot, '测试2参数a').value, '1'); assert.doesNotMatch(restoredRoot.textContent, /变异得分 3\/3/); restored.destroy(); assert.equal(restoredRoot.children.length, 0);
});

test('L022 界面基准失败/空测试/非法代码输入都没有正常得分', async (t) => {
  dom(t, {}); const { default: feature } = await import('../src/renderer/features/L022/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await fill(root, '测试1期望', '1'); await button(root, '运行变异训练').fire('click'); assert.match(root.textContent, /测试基准失败 · 变异得分未生成/); assert.doesNotMatch(root.textContent, /max.reverse · 已杀死/);
  await fill(root, '测试1期望', '2'); await button(root, '运行变异训练').fire('click'); assert.match(root.textContent, /变异得分 2\/3/);
  await button(root, '删除测试 1').fire('click'); await button(root, '运行变异训练').fire('click'); assert.match(root.textContent, /无测试 · 变异得分未生成/);
  await button(root, '添加测试').fire('click'); await fill(root, '测试1参数a', '<img src=x onerror=alert(1)>'); await button(root, '运行变异训练').fire('click'); assert.match(root.textContent, /需要十进制整数/); assert.doesNotMatch(root.textContent, /变异得分 2\/3/);
});

test('L022 界面函数切换保留用例，算术边界测试从2/3提高到3/3', async (t) => {
  dom(t, {}); const { default: feature } = await import('../src/renderer/features/L022/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await fill(root, '内置纯函数', 'sum'); await button(root, '运行变异训练').fire('click'); assert.match(root.textContent, /测试基准失败/);
  await button(root, '载入最小示例').fire('click'); await button(root, '运行变异训练').fire('click'); assert.match(root.textContent, /sum.multiply · 存活/);
  await button(root, '添加测试').fire('click'); await fill(root, '测试2参数a', '0'); await fill(root, '测试2参数b', '3'); await fill(root, '测试2期望', '3'); await button(root, '运行变异训练').fire('click'); assert.match(root.textContent, /变异得分 3\/3/);
  await fill(root, '内置纯函数', 'product'); await button(root, '载入强化示例').fire('click'); await button(root, '运行变异训练').fire('click'); assert.match(root.textContent, /变异得分 3\/3/); assert.match(root.textContent, /product.add · 已杀死/);
});

test('L022 界面容量禁添、导出保护/取消、超限拒写和版本结构拒恢复', async (t) => {
  let saves = 0; let writes = 0; dom(t, { saveText: async () => { saves += 1; return { ok: false, canceled: true }; } }); const { default: feature } = await import('../src/renderer/features/L022/index.js');
  const root = new NodeStub('div'); const handle = feature.create(root, { config: { get: () => ({ schemaVersion: 1, functionId: 'max', tests: Array.from({ length: 64 }, () => ({ a: '2', b: '1', expected: '2' })) }), set: () => { writes += 1; } } }); t.after(() => handle.destroy());
  assert.equal(button(root, '添加测试').disabled, true); await button(root, '运行变异训练').fire('click'); await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 0); assert.match(root.textContent, /缺少防覆盖/);
  window.toolbox.files.saveTextSupportsCopyOnly = true; await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 1); assert.match(root.textContent, /已取消导出/); assert.match(root.textContent, /变异得分 2\/3/);
  await fill(root, '测试1参数a', '汉'.repeat(22000)); const count = writes; handle.deactivate(); assert.equal(writes, count); assert.match(root.textContent, /当前测试未写入全局配置/);
  for (const state of [{ schemaVersion: 2 }, { schemaVersion: 1, payload: '汉'.repeat(22000) }, { schemaVersion: 1, functionId: 'custom' }, { schemaVersion: 1, functionId: 'max', tests: [{ a: 2 }] }]) { const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => state } }); assert.match(invalidRoot.textContent, /未能恢复/); invalid.destroy(); }
});
