const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L014/model.mjs');
const task = (id, arrival, burst) => ({ id, arrival, burst });
const timeline = (strategy) => strategy.segments.map((row) => [row.taskId, row.start, row.end]);

test('L014 核心FCFS验收B等待3、总完成5；全任务手算指标', async () => {
  const { compareSchedules, example } = await model(); const result = compareSchedules(example()); const [fcfs, sjf, rr] = result.strategies;
  assert.deepEqual(timeline(fcfs), [['A', 0, 3], ['B', 3, 5]]); assert.equal(fcfs.makespan, 5);
  assert.deepEqual(fcfs.tasks.map((row) => [row.id, row.firstStart, row.completion, row.waiting, row.turnaround, row.response]), [['A', 0, 3, 0, 3, 0], ['B', 3, 5, 3, 5, 3]]);
  assert.deepEqual(fcfs.averages, { waiting: 1.5, turnaround: 4, response: 1.5 });
  assert.deepEqual(timeline(sjf), [['B', 0, 2], ['A', 2, 5]]); assert.deepEqual(sjf.tasks.map((row) => [row.id, row.waiting, row.turnaround, row.response]), [['A', 2, 5, 2], ['B', 0, 2, 0]]);
  assert.deepEqual(timeline(rr), [['A', 0, 1], ['B', 1, 2], ['A', 2, 3], ['B', 3, 4], ['A', 4, 5]]);
  assert.deepEqual(rr.tasks.map((row) => [row.id, row.completion, row.waiting, row.turnaround, row.response]), [['A', 5, 2, 5, 0], ['B', 4, 2, 4, 1]]); assert.deepEqual(rr.averages, { waiting: 2, turnaround: 4.5, response: 0.5 });
});

test('L014 RR时间片边界新到达先于当前重新排队，同到达稳定输入顺序', async () => {
  const { compareSchedules, example } = await model(); const rr = compareSchedules(example('boundary')).strategies[2];
  assert.deepEqual(timeline(rr), [['A', 0, 2], ['B', 2, 3], ['C', 3, 4], ['A', 4, 6]]);
  assert.deepEqual(rr.segments[0].readyAfter, ['B', 'C', 'A']); assert.deepEqual(rr.segments[1].readyBefore, ['B', 'C', 'A']);
  assert.deepEqual(rr.tasks.map((row) => [row.id, row.waiting, row.response]), [['A', 2, 0], ['B', 0, 0], ['C', 1, 1]]);
  const during = compareSchedules({ quantum: 3, tasks: [task('A', 0, 5), task('B', 1, 1), task('C', 3, 1)] }).strategies[2]; assert.deepEqual(timeline(during), [['A', 0, 3], ['B', 3, 4], ['C', 4, 5], ['A', 5, 7]]);
});

test('L014 完成恰在量子边界不会重新排队；大时间片与FCFS一致', async () => {
  const { compareSchedules } = await model(); const result = compareSchedules({ quantum: 2, tasks: [task('A', 0, 2), task('B', 2, 2)] }); assert.deepEqual(timeline(result.strategies[2]), [['A', 0, 2], ['B', 2, 4]]); assert.deepEqual(result.strategies[2].segments[0].readyAfter, ['B']);
  const large = compareSchedules({ quantum: 100, tasks: [task('A', 0, 7), task('B', 1, 3), task('C', 3, 2)] }); assert.deepEqual(timeline(large.strategies[0]), timeline(large.strategies[2]));
});

test('L014 非抢占SJF不被后到短任务抢占，只选择已到达任务', async () => {
  const { compareSchedules } = await model(); const sjf = compareSchedules({ quantum: 2, tasks: [task('A', 0, 5), task('B', 1, 1), task('C', 2, 2)] }).strategies[1];
  assert.deepEqual(timeline(sjf), [['A', 0, 5], ['B', 5, 6], ['C', 6, 8]]); assert.deepEqual(sjf.tasks.map((row) => row.waiting), [0, 4, 4]);
  const delayed = compareSchedules({ quantum: 1, tasks: [task('late-short', 10, 1), task('early-long', 0, 3)] }).strategies[1]; assert.deepEqual(timeline(delayed), [['early-long', 0, 3], [null, 3, 10], ['late-short', 10, 11]]);
});

test('L014 FCFS同到达稳定输入；SJF同burst按到达再输入顺序', async () => {
  const { compareSchedules } = await model(); const stable = compareSchedules({ quantum: 1, tasks: [task('Z', 0, 2), task('A', 0, 2), task('M', 0, 2)] }); assert.deepEqual(stable.strategies[0].segments.map((row) => row.taskId), ['Z', 'A', 'M']); assert.deepEqual(stable.strategies[1].segments.map((row) => row.taskId), ['Z', 'A', 'M']);
  const arrivals = compareSchedules({ quantum: 1, tasks: [task('long', 0, 5), task('newer', 2, 2), task('older', 1, 2), task('same-time', 1, 2)] }).strategies[1]; assert.deepEqual(arrivals.segments.map((row) => row.taskId), ['long', 'older', 'same-time', 'newer']);
});

test('L014 idle显式且从0开始，到达前不算等待；等待区间总和准确', async () => {
  const { compareSchedules, example } = await model(); const result = compareSchedules(example('idle'));
  assert.deepEqual(timeline(result.strategies[0]), [[null, 0, 2], ['A', 2, 4], [null, 4, 7], ['B', 7, 8], ['C', 8, 11]]);
  for (const strategy of result.strategies) {
    assert.equal(strategy.makespan, 11); assert.equal(strategy.busy, 6); assert.equal(strategy.idle, 5); assert.equal(strategy.utilization, 6 / 11);
    assert.equal(strategy.tasks[0].waiting, 0); assert.equal(strategy.tasks[0].response, 0);
    for (const row of strategy.tasks) { assert.equal(row.runs.reduce((sum, run) => sum + run.end - run.start, 0), row.burst); assert.equal(row.waits.reduce((sum, run) => sum + run.end - run.start, 0), row.waiting); }
  }
  assert.deepEqual(result.strategies[0].segments[0].readyAfter, ['A']);
});

// Independent tick oracle: advances one unit at a time rather than jumping event times.
function oracle(tasks, quantum, policy) {
  const remaining = tasks.map((row) => row.burst); const first = Array(tasks.length).fill(null); const completion = Array(tasks.length).fill(null); const ready = []; const ticks = []; let current = null; let suspended = null; let used = 0; let done = 0;
  for (let time = 0; done < tasks.length; time++) {
    tasks.forEach((row, index) => { if (row.arrival === time) ready.push(index); });
    if (suspended !== null) { ready.push(suspended); suspended = null; }
    if (current === null && ready.length) {
      if (policy === 'FCFS') ready.sort((a, b) => tasks[a].arrival - tasks[b].arrival || a - b);
      if (policy === 'SJF') ready.sort((a, b) => tasks[a].burst - tasks[b].burst || tasks[a].arrival - tasks[b].arrival || a - b);
      current = ready.shift(); used = 0; if (first[current] === null) first[current] = time;
    }
    ticks.push(current === null ? null : tasks[current].id);
    if (current === null) continue;
    remaining[current]--; used++;
    if (remaining[current] === 0) { completion[current] = time + 1; current = null; done++; }
    else if (policy === 'RR' && used === quantum) { suspended = current; current = null; }
  }
  return { ticks, metrics: tasks.map((row, index) => ({ completion: completion[index], waiting: completion[index] - row.arrival - row.burst, turnaround: completion[index] - row.arrival, response: first[index] - row.arrival })) };
}
test('L014 独立逐tick oracle核对48组任务全部时间线和指标', async () => {
  const { compareSchedules } = await model(); let seed = 13;
  const random = (max) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % max; };
  for (let round = 0; round < 48; round++) {
    const tasks = Array.from({ length: 1 + random(7) }, (_, index) => task(`T${index}`, random(9), 1 + random(6))); const quantum = 1 + random(4); const result = compareSchedules({ tasks, quantum });
    for (const strategy of result.strategies) {
      const expected = oracle(tasks, quantum, strategy.id); const ticks = strategy.segments.flatMap((row) => Array(row.duration).fill(row.taskId)); assert.deepEqual(ticks, expected.ticks, `${round}/${strategy.id}`);
      assert.deepEqual(strategy.tasks.map(({ completion, waiting, turnaround, response }) => ({ completion, waiting, turnaround, response })), expected.metrics);
      assert.equal(strategy.averages.waiting, expected.metrics.reduce((sum, row) => sum + row.waiting, 0) / tasks.length);
    }
  }
});

test('L014 输入容量、整数范围、名称唯一和任意代码不执行', async () => {
  const { compareSchedules } = await model(); const draft = { quantum: '1', tasks: [task('A', '0', '1')] };
  for (const quantum of [0, -1, 1.5, '1e3', null, true, [1], 100001, 'alert(1)']) assert.throws(() => compareSchedules({ ...draft, quantum }));
  for (const tasks of [[], Array.from({ length: 51 }, (_, n) => task(String(n), 0, 1)), [task('A', -1, 1)], [task('A', 100000, 1)], [task('A', 0, 0)], [task('A', 0, 1.1)], [task('', 0, 1)], [task('a'.repeat(25), 0, 1)], [task('A', 0, 1), task(' A ', 1, 1)]]) assert.throws(() => compareSchedules({ ...draft, tasks }));
  assert.equal(compareSchedules({ quantum: 100000, tasks: Array.from({ length: 50 }, (_, n) => task(String(n), 0, 1)) }).strategies[0].makespan, 50);
});

test('L014 时间与片段上限整轮拒绝，不返回截断；精确上限通过', async () => {
  const { compareSchedules } = await model(); assert.equal(compareSchedules({ quantum: 100000, tasks: [task('A', 99999, 1)] }).strategies[2].makespan, 100000);
  assert.throws(() => compareSchedules({ quantum: 100000, tasks: [task('A', 99999, 2)] }), /完成时间超过100000/); assert.throws(() => compareSchedules({ quantum: 100000, tasks: [task('A', 0, 50001), task('B', 0, 50000)] }), /总运行时长/);
  assert.equal(compareSchedules({ quantum: 1, tasks: [task('A', 0, 1000)] }).strategies[2].segments.length, 1000); assert.throws(() => compareSchedules({ quantum: 1, tasks: [task('A', 0, 1001)] }), /RR甘特片段超过1000/);
});

test('L014 三策略同输入不可变；响应和总等待区别、平均覆盖所有任务', async () => {
  const { compareSchedules, example } = await model(); const draft = example(); const before = structuredClone(draft); const result = compareSchedules(draft); assert.deepEqual(result, compareSchedules(draft)); assert.deepEqual(draft, before);
  assert.equal(result.strategies[2].tasks[0].response, 0); assert.equal(result.strategies[2].tasks[0].waiting, 2); assert.deepEqual(result.strategies[2].tasks[0].waits, [{ start: 1, end: 2 }, { start: 3, end: 4 }]);
  draft.tasks[0].burst = '999'; assert.equal(result.input.tasks[0].burst, 3); result.strategies[0].tasks[0].runs[0].end = 999; assert.equal(result.strategies[0].segments[0].end, 3); assert.equal(result.strategies[1].tasks[0].runs[0].end, 5);
});

test('L014 schema/完整恢复64KiB UTF8边界与Markdown所有指标/空闲', async () => {
  const { prepareStoredState, validateStoredState, example, compareSchedules, reportMarkdown } = await model(); const draft = example(); const overhead = new TextEncoder().encode(JSON.stringify(prepareStoredState({ ...draft, quantum: '' }))).byteLength;
  const exact = prepareStoredState({ ...draft, quantum: 'a'.repeat(65536 - overhead) }); assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 65536); assert.deepEqual(validateStoredState(exact), exact);
  assert.throws(() => prepareStoredState({ ...draft, quantum: exact.quantum + 'a' }), /64KiB/); assert.throws(() => validateStoredState({ ...prepareStoredState(draft), ignored: '汉'.repeat(22000) }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/); assert.throws(() => validateStoredState({ schemaVersion: 1, quantum: 1, tasks: [] }), /结构/);
  const idle = example('idle'); const report = reportMarkdown({ draft: idle, result: compareSchedules(idle) }); assert.match(report, /CPU空闲/); assert.match(report, /## FCFS/); assert.match(report, /## SJF/); assert.match(report, /## RR/); assert.match(report, /等待=11−7−3=1/); assert.match(report, /响应=/); assert.match(reportMarkdown({ draft, result: null }), /未生成策略结果/);
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

test('L014 真实组件事件核心、按比例甘特、逐任务/片段与安全全报告导出', async (t) => {
  const exported = []; const stored = new Map(); dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L014/index.js'); const root = new NodeStub('div'); const config = { get: (key) => stored.get(key), set: (key, value) => stored.set(key, value) }; const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await button(root, '运行三策略对照').fire('click'); assert.match(root.textContent, /总完成时间 5/); await button(root, 'FCFS查看任务B').fire('click'); assert.match(root.textContent, /等待 = 完成−到达−时长 = 5−0−2 = 3/);
  const firstBar = walk(root).find((node) => node.attributes['aria-label'] === 'FCFS片段1：A，0至3，时长3'); assert.equal(firstBar.style.flex, '0 0 60%');
  await button(root, 'RR下个片段').fire('click'); assert.match(root.textContent, /RR片段2：B \[1, 2\)/); await fill(root, 'RR查看任务详情', '1'); assert.match(root.textContent, /响应 = 首次运行−到达 = 1−0 = 1/);
  await button(root, '导出完整 JSON').fire('click'); const payload = JSON.parse(exported[0].content); assert.equal(payload.schemaVersion, 1); assert.equal(payload.result.strategies[0].tasks[1].waiting, 3); assert.equal(exported[0].copyOnly, true);
  await button(root, '导出完整 Markdown').fire('click'); assert.equal(exported[1].copyOnly, true); assert.match(exported[1].content, /调度前候选顺序/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
  handle.deactivate(); assert.equal(stored.get('features.L014.state').schemaVersion, 1); assert.equal(Object.hasOwn(stored.get('features.L014.state'), 'result'), false);
  const restoredRoot = new NodeStub('div'); const restored = feature.create(restoredRoot, { config }); assert.match(restoredRoot.textContent, /已恢复输入草稿/); assert.doesNotMatch(restoredRoot.textContent, /FCFS逐任务指标/); assert.equal(control(restoredRoot, '任务1运行时长').value, '3'); restored.destroy(); assert.equal(restoredRoot.children.length, 0);
});

test('L014 编辑/增删实际事件清旧结果；RR边界队列和显式idle可查看', async (t) => {
  const exported = []; dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(JSON.parse(payload.content)); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L014/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await button(root, '载入边界入队示例').fire('click'); await button(root, '运行三策略对照').fire('click'); assert.match(root.textContent, /结束后候选顺序：B → C → A/); await fill(root, 'RR查看时间片段', '3'); assert.match(root.textContent, /RR片段4：A \[4, 6\)/);
  await fill(root, 'RR时间片', '1'); assert.doesNotMatch(root.textContent, /FCFS逐任务指标/); await button(root, '导出完整 JSON').fire('click'); assert.equal(exported[0].result, null);
  await button(root, '添加任务').fire('click'); await fill(root, '任务4名称', 'D'); await fill(root, '任务4到达时间', '10'); await fill(root, '任务4运行时长', '1'); await button(root, '运行三策略对照').fire('click'); await button(root, 'FCFS查看任务D').fire('click'); assert.match(root.textContent, /运行区间：\[10, 11\)/);
  await button(root, '删除任务 4').fire('click'); await fill(root, '任务1运行时长', '5'); await fill(root, '任务1名称', '改名'); await button(root, '运行三策略对照').fire('click'); assert.match(root.textContent, /FCFS任务改名/);
  await button(root, '载入空闲示例').fire('click'); await button(root, '运行三策略对照').fire('click'); assert.match(root.textContent, /FCFS片段1：CPU空闲 \[0, 2\)/); await fill(root, 'FCFS查看时间片段', '2'); assert.match(root.textContent, /FCFS片段3：CPU空闲 \[4, 7\)/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
});

test('L014 界面非法/空输入、片段超限整轮拒绝和容量限制', async (t) => {
  dom(t, {}); const { default: feature } = await import('../src/renderer/features/L014/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await button(root, '删除任务 2').fire('click'); await fill(root, '任务1运行时长', '1001'); await button(root, '运行三策略对照').fire('click'); assert.match(root.textContent, /RR甘特片段超过1000/); assert.doesNotMatch(root.textContent, /FCFS逐任务指标/);
  await fill(root, '任务1运行时长', '<img onerror=alert(1)>'); await button(root, '运行三策略对照').fire('click'); assert.match(root.textContent, /须为十进制整数/); await button(root, '删除任务 1').fire('click'); await button(root, '运行三策略对照').fire('click'); assert.match(root.textContent, /须输入1至50个任务/);
  const maximumRoot = new NodeStub('div'); const maximum = feature.create(maximumRoot, { config: { get: () => ({ schemaVersion: 1, quantum: '1', tasks: Array.from({ length: 50 }, (_, n) => task(String(n), '0', '1')) }) } }); assert.equal(button(maximumRoot, '添加任务').disabled, true); maximum.destroy();
});

test('L014 草稿64KiB/版本恢复/导出能力取消与销毁生命周期', async (t) => {
  let saves = 0; let writes = 0; dom(t, { saveText: async () => { saves++; return { canceled: true }; } }); const { default: feature } = await import('../src/renderer/features/L014/index.js'); const root = new NodeStub('div'); const handle = feature.create(root, { config: { get: () => null, set: () => { writes++; } } }); t.after(() => handle.destroy());
  await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 0); assert.match(root.textContent, /缺少防覆盖/); window.toolbox.files.saveTextSupportsCopyOnly = true; await button(root, '导出完整 Markdown').fire('click'); assert.equal(saves, 1); assert.match(root.textContent, /已取消导出/);
  await fill(root, '任务1名称', '汉'.repeat(22000)); const before = writes; handle.deactivate(); assert.equal(writes, before); assert.match(root.textContent, /当前输入未写入全局配置/);
  for (const saved of [{ schemaVersion: 2 }, { schemaVersion: 1, quantum: '1', tasks: [], ignored: '汉'.repeat(22000) }, { schemaVersion: 1, quantum: 1, tasks: [] }]) { const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => saved } }); assert.match(invalidRoot.textContent, /未能恢复/); invalid.destroy(); }
});
