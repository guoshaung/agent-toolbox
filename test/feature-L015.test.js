const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L015/model.mjs');
const replay = (create, step, draft, order) => order.reduce((state, thread) => step(state, thread), create(draft));

test('L015 核心两线程先读0再写加一，最终1串行2与确切陈旧写入', async () => {
  const { createReplay, stepReplay, example, summarize } = await model(); const state = replay(createReplay, stepReplay, example(), [0, 1, 0, 1]);
  assert.deepEqual(state.trace.map((frame) => [frame.thread, frame.op, frame.before.shared, frame.after.shared]), [[0, 'READ', 0, 0], [1, 'READ', 0, 0], [0, 'WRITE', 0, 1], [1, 'WRITE', 1, 1]]);
  assert.equal(state.shared, 1); assert.equal(state.serialReference.counter, 2); assert.equal(summarize(state).lostUpdate, true); assert.equal(summarize(state).difference, 1); assert.equal(state.successfulWrites, 2);
  assert.deepEqual(state.trace[3].staleWrite, { readStep: 2, readValue: 0, readRevision: 0, currentRevision: 1, overwrittenValue: 1, writtenValue: 1, incrementGap: 1 }); assert.equal(state.staleWrites.length, 1);
  assert.deepEqual(state.conflicts.map((pair) => [pair.earlierStep, pair.laterStep]), [[2, 3], [1, 4], [3, 4]]); assert.equal(state.threads[0].register, 0); assert.equal(state.threads[1].register, 0);
});

test('L015 六种保序交错逐个核对，串行无锁有提示却无丢失更新', async () => {
  const { createReplay, stepReplay, example, summarize } = await model(); const cases = [[[0, 0, 1, 1], 2], [[0, 1, 0, 1], 1], [[0, 1, 1, 0], 1], [[1, 0, 0, 1], 1], [[1, 0, 1, 0], 1], [[1, 1, 0, 0], 2]];
  for (const [order, expected] of cases) { const state = replay(createReplay, stepReplay, example(), order); assert.equal(state.shared, expected); assert.equal(summarize(state).completed, true); assert.equal(summarize(state).lostUpdate, expected === 1); assert.equal(state.conflicts.length, 3); }
});

test('L015 互斥保护阻塞不推进，释放后重试最终2且无未保护冲突', async () => {
  const { createReplay, stepReplay, example, summarize, threadStatus } = await model(); const initial = createReplay(example('locked')); const state = replay(() => initial, stepReplay, null, [0, 1, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(state.trace[1].outcome, 'blocked'); assert.deepEqual(state.trace[1].before, state.trace[1].after); assert.equal(state.trace[1].after.threads[1].pc, 0); assert.equal(state.trace[1].after.lockOwner, 0);
  assert.equal(threadStatus(state, 0), 'done'); assert.equal(threadStatus(state, 1), 'done'); assert.equal(state.lockOwner, null); assert.equal(state.shared, 2); assert.equal(state.serialReference.counter, 2); assert.equal(state.conflicts.length, 0); assert.equal(state.staleWrites.length, 0); assert.equal(summarize(state).lostUpdate, false);
  assert.deepEqual(state.trace.filter((frame) => frame.op === 'WRITE').map((frame) => [frame.after.shared, frame.protected]), [[1, true], [2, true]]);
});

test('L015 锁不是读写自动门禁，混合无锁访问标记未保护冲突', async () => {
  const { createReplay, stepReplay } = await model(); const draft = { initial: '0', scripts: ['LOCK\nREAD\nWRITE\nUNLOCK', 'READ\nWRITE'] };
  const state = replay(createReplay, stepReplay, draft, [0, 0, 1, 0, 1, 0]); assert.equal(state.trace[2].op, 'READ'); assert.equal(state.trace[2].outcome, 'executed'); assert.equal(state.trace[2].before.lockOwner, 0); assert.equal(state.trace[2].protected, false); assert.equal(state.trace[3].protected, true); assert.equal(state.conflicts.length, 3); assert.equal(state.shared, 1);
});

test('L015 WRITE未READ/非所有者UNLOCK/空锁UNLOCK/重入LOCK可见失效，PC不推进', async () => {
  const { createReplay, stepReplay, summarize } = await model();
  let state = stepReplay(createReplay({ initial: '0', scripts: ['WRITE', 'READ\nWRITE'] }), 0); assert.equal(state.trace[0].outcome, 'fault'); assert.equal(state.threads[0].pc, 0); assert.equal(state.shared, 0); assert.match(state.threads[0].fault, /未由READ初始化/); assert.equal(state.serialReference.completed, false); assert.equal(state.serialReference.counter, null); assert.throws(() => stepReplay(state, 0), /已完成或指令失效/);
  state = replay(createReplay, stepReplay, { initial: '0', scripts: ['LOCK\nREAD\nWRITE\nUNLOCK', 'UNLOCK'] }, [0, 1]); assert.equal(state.lockOwner, 0); assert.equal(state.threads[1].pc, 0); assert.match(state.threads[1].fault, /无权解锁/);
  state = stepReplay(createReplay({ initial: '0', scripts: ['UNLOCK', 'READ'] }), 0); assert.match(state.threads[0].fault, /无人持有/);
  state = replay(createReplay, stepReplay, { initial: '0', scripts: ['LOCK\nLOCK', 'LOCK\nUNLOCK'] }, [0, 0]); assert.equal(state.lockOwner, 0); assert.equal(state.threads[0].pc, 1); assert.match(state.threads[0].fault, /非重入/); assert.equal(summarize(state).lockLeak, true); assert.equal(summarize(state).stopped, true);
});

test('L015 线程结束不会自动解锁；阻塞状态动态恢复而非隐藏重排', async () => {
  const { createReplay, stepReplay, threadStatus, summarize } = await model(); const leaking = stepReplay(createReplay({ initial: '0', scripts: ['LOCK', 'LOCK\nUNLOCK'] }), 0);
  assert.equal(leaking.lockOwner, 0); assert.equal(threadStatus(leaking, 0), 'done'); assert.equal(threadStatus(leaking, 1), 'blocked'); assert.equal(summarize(leaking).lockLeak, true); assert.equal(leaking.serialReference.counter, null);
  let normal = replay(createReplay, stepReplay, { initial: '0', scripts: ['LOCK\nUNLOCK', 'LOCK\nUNLOCK'] }, [0, 1]); assert.equal(threadStatus(normal, 1), 'blocked'); normal = stepReplay(normal, 0); assert.equal(threadStatus(normal, 1), 'ready'); assert.equal(normal.threads[1].pc, 0); normal = stepReplay(normal, 1); assert.equal(normal.lockOwner, 1);
});

test('L015 未完成结果不声称丢失更新；真实串行脚本基准支持重复WRITE', async () => {
  const { createReplay, stepReplay, example, summarize } = await model(); const partial = stepReplay(createReplay(example()), 0); assert.equal(summarize(partial).difference, null); assert.equal(summarize(partial).lostUpdate, false);
  const repeated = replay(createReplay, stepReplay, { initial: '0', scripts: ['READ\nWRITE\nWRITE', 'READ\nWRITE'] }, [0, 0, 0, 1, 1]); assert.equal(repeated.shared, 2); assert.equal(repeated.serialReference.counter, 2); assert.equal(repeated.successfulWrites, 3); assert.equal(summarize(repeated).lostUpdate, false); assert.equal(repeated.staleWrites.length, 1);
  const negative = replay(createReplay, stepReplay, { initial: '-5', scripts: example().scripts }, [0, 1, 0, 1]); assert.equal(negative.shared, -4); assert.equal(negative.serialReference.counter, -3);
});

test('L015 仅有限四指令；空脚本、容量、初始值和任意JS拒绝', async () => {
  const { createReplay, parseDraft, example } = await model(); const draft = example(); assert.deepEqual(parseDraft({ ...draft, scripts: [' read \n\n write ', 'LOCK\nUNLOCK'] }).programs[0], [{ op: 'READ', line: 1 }, { op: 'WRITE', line: 3 }]);
  for (const source of ['', 'READ 1', 'WRITE R+1', 'eval(1)', 'READ; WRITE', 'ADD', '<script>READ</script>', Array(17).fill('READ').join('\n'), ' '.repeat(4097)]) assert.throws(() => createReplay({ ...draft, scripts: [source, 'READ'] }));
  for (const initial of ['1.2', '1e3', '', '1000001', '-1000001', 'Infinity', 0]) assert.throws(() => createReplay({ ...draft, initial }));
  assert.throws(() => createReplay({ ...draft, scripts: ['READ'] }), /两个脚本/); assert.equal(createReplay({ ...draft, initial: '1000000' }).shared, 1000000); assert.equal(createReplay({ ...draft, scripts: [Array(16).fill('READ').join('\n'), 'READ'] }).input.programs[0].length, 16);
});

test('L015 128尝试包括阻塞，精确上限且超限不变；线程参数校验', async () => {
  const { createReplay, stepReplay } = await model(); let state = stepReplay(createReplay({ initial: '0', scripts: ['LOCK', 'LOCK\nUNLOCK'] }), 0);
  for (let count = 1; count < 128; count++) state = stepReplay(state, 1);
  assert.equal(state.trace.length, 128); assert.equal(state.trace[127].outcome, 'blocked'); const before = structuredClone(state); assert.throws(() => stepReplay(state, 1), /128上限/); assert.deepEqual(state, before);
  for (const thread of [-1, 2, '0', null]) assert.throws(() => stepReplay(createReplay({ initial: '0', scripts: ['READ', 'READ'] }), thread), /只能选择/);
});

test('L015 不可变重放前后快照/输入与确定性复现', async () => {
  const { createReplay, stepReplay, example } = await model(); const draft = example(); const initial = createReplay(draft); const before = structuredClone(initial); const first = stepReplay(initial, 0); assert.deepEqual(initial, before); assert.deepEqual(first, stepReplay(initial, 0)); const second = stepReplay(first, 1); second.trace[0].after.threads[0].register = 999; assert.equal(second.trace[1].before.threads[0].register, 0); assert.equal(first.trace[0].after.threads[0].register, 0); draft.scripts[0] = 'WRITE'; assert.equal(initial.input.programs[0][0].op, 'READ');
});

test('L015 UTF8 64KiB/版本/脚本恢复界限以及完整Markdown状态/冲突', async () => {
  const { prepareStoredState, validateStoredState, example, createReplay, stepReplay, reportMarkdown } = await model(); const draft = example(); const overhead = new TextEncoder().encode(JSON.stringify(prepareStoredState({ ...draft, initial: '' }))).byteLength;
  const exact = prepareStoredState({ ...draft, initial: 'a'.repeat(65536 - overhead) }); assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 65536); assert.deepEqual(validateStoredState(exact), exact); assert.throws(() => prepareStoredState({ ...draft, initial: exact.initial + 'a' }), /64KiB/); assert.throws(() => validateStoredState({ ...prepareStoredState(draft), ignored: '汉'.repeat(22000) }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/); assert.throws(() => validateStoredState({ ...prepareStoredState(draft), scripts: ['READ', '汉'.repeat(1400)] }), /脚本容量/);
  assert.throws(() => prepareStoredState({ ...draft, scripts: ['READ', '汉'.repeat(1400)] }), /4096字节/);
  const state = replay(createReplay, stepReplay, draft, [0, 1, 0, 1]); const report = reportMarkdown({ draft, result: state }); assert.match(report, /共享值1/); assert.match(report, /串行理想2/); assert.match(report, /未保护冲突3对/); assert.match(report, /陈旧写入1次/); assert.match(report, /之前：/); assert.match(report, /之后：/); assert.match(reportMarkdown({ draft, result: null }), /无状态轨迹/);
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
async function choose(root, order) { for (const index of order) await button(root, `T${index + 1} 执行下一条`).fire('click'); }
function dom(t, files) { const oldDocument = global.document; const oldWindow = global.window; global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) }; global.window = { toolbox: { files } }; t.after(() => { global.document = oldDocument; global.window = oldWindow; }); }

test('L015 实际组件事件丢失更新、历史只查看及JSON/MD完整副本/草稿恢复', async (t) => {
  const exported = []; const stored = new Map(); dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L015/index.js'); const root = new NodeStub('div'); const config = { get: (key) => stored.get(key), set: (key, value) => stored.set(key, value) }; const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await button(root, '开始 / 重置重放').fire('click'); await choose(root, [0, 1, 0, 1]); assert.match(root.textContent, /两线程已完成，最终值 1；串行理想 2，丢失更新差 1/); assert.match(root.textContent, /陈旧写入：步骤2读取0/); assert.equal(button(root, 'T1 执行下一条').disabled, true);
  await button(root, '查看步骤1').fire('click'); assert.match(root.textContent, /当前共享计数器 1/); assert.match(root.textContent, /之前：共享0/); await fill(root, '查看历史步骤', '3'); assert.match(root.textContent, /步骤4 · T2 WRITE/);
  await button(root, '导出完整 JSON').fire('click'); const payload = JSON.parse(exported[0].content); assert.equal(payload.schemaVersion, 1); assert.equal(payload.result.shared, 1); assert.equal(payload.result.trace.length, 4); assert.equal(exported[0].copyOnly, true);
  await button(root, '导出完整 Markdown').fire('click'); assert.equal(exported[1].copyOnly, true); assert.match(exported[1].content, /陈旧写入1次/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
  handle.deactivate(); assert.equal(stored.get('features.L015.state').schemaVersion, 1); assert.equal(Object.hasOwn(stored.get('features.L015.state'), 'trace'), false);
  const restoredRoot = new NodeStub('div'); const restored = feature.create(restoredRoot, { config }); assert.match(restoredRoot.textContent, /已恢复脚本草稿/); assert.doesNotMatch(restoredRoot.textContent, /当前共享计数器/); assert.equal(control(restoredRoot, 'T1指令脚本').value, 'READ\nWRITE'); restored.destroy(); assert.equal(restoredRoot.children.length, 0);
});

test('L015 实际组件互斥阻塞/解锁/继续/重置与脚本编辑清空旧轨迹', async (t) => {
  dom(t, {}); const { default: feature } = await import('../src/renderer/features/L015/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await button(root, '载入互斥模板').fire('click'); await button(root, '开始 / 重置重放').fire('click'); await choose(root, [0, 1]); assert.match(root.textContent, /锁由T1持有；PC、寄存器和共享值不变/); assert.match(root.textContent, /T2 · 锁阻塞/);
  await choose(root, [0, 0, 0]); assert.match(root.textContent, /T2 · 可执行/); await choose(root, [1, 1, 1, 1]); assert.match(root.textContent, /两线程已完成，最终值 2/); assert.match(root.textContent, /未保护冲突 0对/);
  await button(root, '开始 / 重置重放').fire('click'); assert.match(root.textContent, /当前共享计数器 0/); assert.match(root.textContent, /尚无步骤记录/); await fill(root, '初始共享计数器', '5'); assert.doesNotMatch(root.textContent, /当前共享计数器/); await button(root, '开始 / 重置重放').fire('click'); assert.match(root.textContent, /当前共享计数器 5/);
  await fill(root, 'T2指令脚本', 'UNLOCK'); assert.doesNotMatch(root.textContent, /当前共享计数器/); await button(root, '开始 / 重置重放').fire('click'); await choose(root, [0, 1]); assert.match(root.textContent, /当前线程无权解锁/); assert.equal(button(root, 'T2 执行下一条').disabled, true); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
});

test('L015 界面失效/锁未释放警告与128尝试上限保留完整轨迹', async (t) => {
  const exported = []; dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(JSON.parse(payload.content)); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L015/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await fill(root, 'T1指令脚本', 'WRITE'); await button(root, '开始 / 重置重放').fire('click'); await choose(root, [0]); assert.match(root.textContent, /R尚未由READ初始化/); assert.match(root.textContent, /串行理想 未生成/);
  await fill(root, 'T1指令脚本', 'LOCK'); await fill(root, 'T2指令脚本', 'LOCK\nUNLOCK'); await button(root, '开始 / 重置重放').fire('click'); await choose(root, [0]); assert.match(root.textContent, /锁所有者已完成或失效但未解锁/); for (let count = 1; count < 128; count++) await choose(root, [1]);
  assert.equal(button(root, 'T2 执行下一条').disabled, true); assert.match(root.textContent, /已达到尝试步数上限/); await button(root, '导出完整 JSON').fire('click'); assert.equal(exported[0].result.trace.length, 128); assert.equal(exported[0].result.trace[127].outcome, 'blocked');
});

test('L015 非脚本语法/草稿版本体积/导出能力取消及释放生命周期', async (t) => {
  let saves = 0; let writes = 0; dom(t, { saveText: async () => { saves++; return { canceled: true }; } }); const { default: feature } = await import('../src/renderer/features/L015/index.js'); const root = new NodeStub('div'); const handle = feature.create(root, { config: { get: () => null, set: () => { writes++; } } }); t.after(() => handle.destroy());
  await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 0); assert.match(root.textContent, /缺少防覆盖/); window.toolbox.files.saveTextSupportsCopyOnly = true; await button(root, '导出完整 Markdown').fire('click'); assert.equal(saves, 1); assert.match(root.textContent, /已取消导出/);
  await fill(root, 'T1指令脚本', '<script>alert(1)</script>'); await button(root, '开始 / 重置重放').fire('click'); assert.match(root.textContent, /只允许独立READ/); assert.doesNotMatch(root.textContent, /当前共享计数器/);
  await fill(root, '初始共享计数器', '汉'.repeat(22000)); const before = writes; handle.deactivate(); assert.equal(writes, before); assert.match(root.textContent, /当前输入未写入全局配置/);
  for (const saved of [{ schemaVersion: 2 }, { schemaVersion: 1, initial: '0', scripts: ['READ', 'READ'], hidden: '汉'.repeat(22000) }, { schemaVersion: 1, initial: '0', scripts: ['READ'] }]) { const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => saved } }); assert.match(invalidRoot.textContent, /未能恢复/); invalid.destroy(); }
});
