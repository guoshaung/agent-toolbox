const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L023/model.mjs');

test('L023 核心验收x=1覆盖1/2，加入−1覆盖2/2且路径真假明确', async () => {
  const { exploreBranches } = await model(); const one = exploreBranches('simple', [{ x: 1 }]);
  assert.deepEqual(one.coverage, { numerator: 1, denominator: 2, value: 0.5 }); assert.deepEqual(one.executions[0].path, [{ id: 'D1', outcome: true, edge: 'D1:true' }]); assert.equal(one.executions[0].output, '正数'); assert.equal(one.uncovered[0].id, 'D1:false'); assert.equal(one.uncovered[0].knownUnreachable, false);
  const two = exploreBranches('simple', [{ x: 1 }, { x: -1 }]); assert.equal(two.coverage.value, 1); assert.equal(two.executions[1].path[0].edge, 'D1:false'); assert.equal(two.executions[1].output, '非正数'); assert.equal(two.uncovered.length, 0);
});

test('L023 零命中假边，重复输入增加计数不增加分母', async () => {
  const { exploreBranches } = await model(); const result = exploreBranches('simple', [{ x: 1 }, { x: 1 }, { x: 0 }]);
  assert.equal(result.coverage.denominator, 2); assert.equal(result.coverage.numerator, 2); assert.deepEqual(result.decisionCounts, [{ id: 'D1', trueCount: 2, falseCount: 1, skippedCount: 0 }]); assert.deepEqual(result.edges[0].tests, ['T1', 'T2']);
});

test('L023 嵌套单输入2/6，上层跳过的D3不命中false或true', async () => {
  const { exploreBranches } = await model(); const result = exploreBranches('nested', [{ x: 1, y: 1 }]);
  assert.equal(result.coverage.numerator, 2); assert.equal(result.coverage.denominator, 6); assert.deepEqual(result.executions[0].path.map((row) => row.edge), ['D1:true', 'D2:true']);
  const skipped = result.executions[0].decisions.find((row) => row.id === 'D3'); assert.equal(skipped.executed, false); assert.equal(skipped.outcome, null); assert.equal(skipped.atoms[0].status, 'skipped'); assert.equal(skipped.atoms[0].value, null);
  assert.deepEqual(result.decisionCounts[2], { id: 'D3', trueCount: 0, falseCount: 0, skippedCount: 1 });
});

test('L023 嵌套四输入覆盖六边，精确路径/输出/计数', async () => {
  const { exploreBranches, getProgram } = await model(); const result = exploreBranches('nested', getProgram('nested').examples.strong);
  assert.deepEqual(result.coverage, { numerator: 6, denominator: 6, value: 1 });
  assert.deepEqual(result.executions.map((run) => run.path.map((row) => row.edge)), [['D1:true', 'D2:true'], ['D1:true', 'D2:false'], ['D1:false', 'D3:true'], ['D1:false', 'D3:false']]);
  assert.deepEqual(result.executions.map((run) => run.output), ['双正数', 'x正、y非正', 'x非正、y为零', 'x非正、y非零']); assert.deepEqual(result.decisionCounts.map((row) => [row.trueCount, row.falseCount, row.skippedCount]), [[2, 2, 0], [1, 1, 2], [1, 1, 2]]);
});

test('L023 复合整条if仅两边；短路原子保留skipped而不标false', async () => {
  const { exploreBranches, getProgram } = await model(); const result = exploreBranches('compound', getProgram('compound').examples.strong);
  assert.deepEqual(result.coverage, { numerator: 2, denominator: 2, value: 1 });
  const atoms1 = result.executions[0].decisions[0].atoms; const atoms2 = result.executions[1].decisions[0].atoms;
  assert.deepEqual(atoms1.map((row) => [row.id, row.status, row.value]), [['A1', 'evaluated', true], ['A2', 'evaluated', true], ['A3', 'skipped', null]]);
  assert.deepEqual(atoms2.map((row) => [row.id, row.status, row.value]), [['A1', 'evaluated', false], ['A2', 'skipped', null], ['A3', 'evaluated', false]]);
  assert.equal([...atoms1, ...atoms2].some((row) => row.id === 'A2' && row.status === 'evaluated' && row.value === false), false);
  assert.match(result.policy, /不计入此分支分母/);
});

test('L023 ||右侧true与&&右侧false可复现，NOT仅反转布尔结果', async () => {
  const { exploreBranches, interpretCondition } = await model(); const result = exploreBranches('compound', [{ x: -1, enabled: false, override: true }, { x: 1, enabled: false, override: false }]);
  assert.deepEqual(result.executions.map((row) => row.output), ['允许', '拒绝']); assert.equal(result.executions[0].decisions[0].atoms[1].status, 'skipped'); assert.equal(result.executions[1].decisions[0].atoms[1].value, false);
  const expression = { kind: 'not', child: { kind: 'boolean', variable: 'enabled', id: 'A1', label: 'enabled' } }; assert.equal(interpretCondition(expression, { enabled: true }).value, false); assert.equal(interpretCondition(expression, { enabled: false }).value, true);
});

test('L023 已证明不可达边仍在分母4中，未命中不自动变不可达', async () => {
  const { exploreBranches, getProgram } = await model(); const result = exploreBranches('unreachable', getProgram('unreachable').examples.strong);
  assert.deepEqual(result.coverage, { numerator: 3, denominator: 4, value: 0.75 }); assert.equal(result.uncovered.length, 1); assert.equal(result.uncovered[0].id, 'D2:true'); assert.equal(result.uncovered[0].knownUnreachable, true); assert.match(result.uncovered[0].proof, /仍计入/);
  const weak = exploreBranches('unreachable', [{ x: 1 }]); assert.equal(weak.uncovered.find((edge) => edge.id === 'D1:false').knownUnreachable, false);
});

test('L023 有限整数比较解释器各运算符与真假边界', async () => {
  const { interpretCondition } = await model(); const expected = { '>': [true, false, false], '>=': [true, true, false], '<': [false, false, true], '<=': [false, true, true], '===': [false, true, false], '!==': [true, false, true] };
  for (const [operator, results] of Object.entries(expected)) assert.deepEqual([1, 0, -1].map((x) => interpretCondition({ kind: 'compare', variable: 'x', operator, value: 0, id: 'A1' }, { x }).value), results);
  assert.throws(() => interpretCondition({ kind: 'call', source: 'alert(1)' }, {}), /不执行代码/); assert.throws(() => interpretCondition({ kind: 'compare', variable: 'x', operator: 'eval', value: 0 }, { x: 1 }), /比较运算符/);
});

test('L023 AST深度和节点上限涵盖被短路的子树，不执行任意脚本', async () => {
  const { interpretCondition } = await model(); let deep = { kind: 'boolean', variable: 'enabled' }; for (let i = 0; i < 9; i += 1) deep = { kind: 'not', child: deep }; assert.throws(() => interpretCondition(deep, { enabled: true }), /上限/);
  const tree = (depth) => depth ? { kind: 'and', left: tree(depth - 1), right: tree(depth - 1) } : { kind: 'boolean', variable: 'enabled' }; assert.throws(() => interpretCondition(tree(5), { enabled: false }), /上限/);
  assert.throws(() => interpretCondition({ kind: 'and', left: { kind: 'boolean', variable: 'enabled' }, right: { kind: 'compare', variable: 'x', operator: 'call', value: 0 } }, { enabled: false, x: 0 }), /比较运算符/);
});

test('L023 空输入不生成百分比；输入类型/整数范围/64条限制', async () => {
  const { exploreBranches } = await model(); const empty = exploreBranches('simple', []); assert.equal(empty.status, 'empty'); assert.deepEqual(empty.coverage, { numerator: 0, denominator: 2, value: null });
  for (const x of ['', '1.5', false, null, Infinity, '(()=>1)()', 1000001]) assert.throws(() => exploreBranches('simple', [{ x }]));
  assert.throws(() => exploreBranches('nested', [{ x: 1 }]), /y/); assert.throws(() => exploreBranches('compound', [{ x: 1, enabled: 'true', override: false }]), /布尔/); assert.throws(() => exploreBranches('arbitrary-js', []), /内置/);
  assert.equal(exploreBranches('simple', [{ x: -1000000 }, { x: 1000000 }]).coverage.value, 1);
  assert.equal(exploreBranches('simple', Array.from({ length: 64 }, () => ({ x: 1 }))).edges[0].count, 64); assert.throws(() => exploreBranches('simple', Array.from({ length: 65 }, () => ({ x: 1 }))), /64/);
});

test('L023 运行确定性、输入/程序库不变；执行结果互不回改', async () => {
  const { exploreBranches, PROGRAMS } = await model(); const before = structuredClone(PROGRAMS); const inputs = [{ x: '1' }, { x: '-1' }]; const first = exploreBranches('simple', inputs); assert.deepEqual(first, exploreBranches('simple', inputs)); assert.deepEqual(PROGRAMS, before); assert.deepEqual(inputs, [{ x: '1' }, { x: '-1' }]); inputs[0].x = '0'; assert.equal(first.executions[0].input.x, 1);
});

test('L023 schema/64KiB UTF8与完整Markdown路径、短路、不可达规则', async () => {
  const { prepareStoredState, validateStoredState, exploreBranches, getProgram, reportMarkdown } = await model(); const overhead = new TextEncoder().encode(JSON.stringify({ source: '', schemaVersion: 1 })).byteLength; const exact = prepareStoredState({ source: 'a'.repeat(65536 - overhead) }); assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 65536); assert.equal(validateStoredState(exact), exact); assert.throws(() => prepareStoredState({ source: exact.source + 'a' }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 1, source: '汉'.repeat(22000) }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/);
  const report = reportMarkdown(exploreBranches('compound', getProgram('compound').examples.strong)); assert.match(report, /2\/2（100.00%）/); assert.match(report, /未执行/); assert.match(report, /D1:false/); assert.match(report, /&#124;/);
  assert.match(reportMarkdown(exploreBranches('unreachable', [{ x: 1 }, { x: -1 }])), /不可达仍计分母/);
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

test('L023 界面x=1→50%，实际添加−1→100%，路径和全格式导出/恢复', async (t) => {
  const exported = []; const stored = new Map(); dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L023/index.js'); const root = new NodeStub('div'); const config = { get: (key) => stored.get(key), set: (key, value) => stored.set(key, value) }; const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await button(root, '运行分支探索').fire('click'); assert.match(root.textContent, /分支覆盖 1\/2（50.00%）/); assert.match(root.textContent, /D1:false（x > 0）/);
  await button(root, '添加输入').fire('click'); await fill(root, '输入2的x', '-1'); assert.doesNotMatch(root.textContent, /分支覆盖 1\/2/); await button(root, '运行分支探索').fire('click'); assert.match(root.textContent, /分支覆盖 2\/2（100.00%）/);
  await button(root, '查看T2').fire('click'); assert.match(root.textContent, /T2：D1:false → 返回「非正数」/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
  await button(root, '导出完整 JSON').fire('click'); const payload = JSON.parse(exported[0].content); assert.equal(payload.schemaVersion, 1); assert.equal(payload.result.coverage.denominator, 2); assert.equal(payload.result.executions[1].path[0].edge, 'D1:false'); assert.equal(exported[0].copyOnly, true);
  await button(root, '导出路径 Markdown').fire('click'); assert.equal(exported[1].extension, 'md'); assert.match(exported[1].content, /D1:false/);
  handle.deactivate(); assert.equal(stored.get('features.L023.state').schemaVersion, 1); assert.equal(Object.hasOwn(stored.get('features.L023.state'), 'result'), false);
  const restoredRoot = new NodeStub('div'); const restored = feature.create(restoredRoot, { config }); assert.match(restoredRoot.textContent, /已恢复输入草稿/); assert.equal(control(restoredRoot, '输入2的x').value, '-1'); assert.doesNotMatch(restoredRoot.textContent, /分支覆盖 2\/2/); restored.destroy(); assert.equal(restoredRoot.children.length, 0);
});

test('L023 界面嵌套六边路径切换，复合布尔编辑/短路与不可达四边', async (t) => {
  dom(t, {}); const { default: feature } = await import('../src/renderer/features/L023/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await fill(root, '内置条件程序', 'nested'); await button(root, '载入单输入示例').fire('click'); await button(root, '运行分支探索').fire('click'); assert.match(root.textContent, /分支覆盖 2\/6/); assert.match(root.textContent, /D3 y === 0：未执行/);
  await button(root, '载入多输入示例').fire('click'); await button(root, '运行分支探索').fire('click'); assert.match(root.textContent, /分支覆盖 6\/6/); await button(root, '查看T3').fire('click'); assert.match(root.textContent, /T3：D1:false → D3:true/);
  await fill(root, '内置条件程序', 'compound'); await button(root, '载入单输入示例').fire('click'); await button(root, '运行分支探索').fire('click'); assert.match(root.textContent, /A3 override：未执行（\|\|左侧为true/);
  await button(root, '添加输入').fire('click'); await fill(root, '输入2的x', '-1'); await fill(root, '输入2的enabled', 'true'); await button(root, '运行分支探索').fire('click'); assert.match(root.textContent, /分支覆盖 2\/2/); await button(root, '查看T2').fire('click'); assert.match(root.textContent, /A2 enabled：未执行（&&左侧为false/);
  await fill(root, '输入2的override', 'true'); await button(root, '运行分支探索').fire('click'); assert.match(root.textContent, /分支覆盖 1\/2/);
  await fill(root, '内置条件程序', 'unreachable'); await button(root, '载入多输入示例').fire('click'); await button(root, '运行分支探索').fire('click'); assert.match(root.textContent, /分支覆盖 3\/4（75.00%）/); assert.match(root.textContent, /已证明不可达，仍计分母/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
});

test('L023 界面空输入/非法文本、容量、导出能力/取消与草稿版本体积', async (t) => {
  let saves = 0; let writes = 0; dom(t, { saveText: async () => { saves += 1; return { ok: false, canceled: true }; } }); const { default: feature } = await import('../src/renderer/features/L023/index.js'); const root = new NodeStub('div'); const handle = feature.create(root, { config: { get: () => null, set: () => { writes += 1; } } }); t.after(() => handle.destroy());
  await button(root, '运行分支探索').fire('click'); await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 0); assert.match(root.textContent, /缺少防覆盖/); window.toolbox.files.saveTextSupportsCopyOnly = true; await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 1); assert.match(root.textContent, /已取消导出/); assert.match(root.textContent, /分支覆盖 1\/2/);
  await button(root, '删除输入 1').fire('click'); await button(root, '运行分支探索').fire('click'); assert.match(root.textContent, /无输入 · 覆盖率未生成/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
  await button(root, '添加输入').fire('click'); await fill(root, '输入1的x', '<img src=x onerror=alert(1)>'); await button(root, '运行分支探索').fire('click'); assert.match(root.textContent, /需要十进制整数/);
  await fill(root, '输入1的x', '汉'.repeat(22000)); const count = writes; handle.deactivate(); assert.equal(writes, count); assert.match(root.textContent, /当前输入未写入全局配置/);
  const maximumRoot = new NodeStub('div'); const maximum = feature.create(maximumRoot, { config: { get: () => ({ schemaVersion: 1, programId: 'simple', cases: Array.from({ length: 64 }, () => ({ x: '1', y: '0', enabled: false, override: false })) }) } }); assert.equal(button(maximumRoot, '添加输入').disabled, true); maximum.destroy();
  for (const saved of [{ schemaVersion: 2 }, { schemaVersion: 1, payload: '汉'.repeat(22000) }, { schemaVersion: 1, programId: 'custom' }, { schemaVersion: 1, programId: 'simple', cases: [{ x: 1 }] }]) { const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => saved } }); assert.match(invalidRoot.textContent, /未能恢复/); invalid.destroy(); }
});
