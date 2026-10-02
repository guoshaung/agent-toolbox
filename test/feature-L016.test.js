const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L016/model.mjs');

test('L016 窗口1首次丢2仅重传2，三包全部收到确认；独立手算全事件序列', async () => {
  const { simulate, example } = await model(); const result = simulate(example());
  assert.deepEqual(result.events.map((entry) => [entry.tick, entry.type, entry.packet ?? entry.ack]), [[0, 'send', 1], [1, 'receive', 1], [1, 'ack-send', 2], [2, 'ack-receive', 2], [2, 'send', 2], [2, 'drop', 2], [6, 'timeout', 2], [6, 'send', 2], [7, 'receive', 2], [7, 'ack-send', 3], [8, 'ack-receive', 3], [8, 'send', 3], [9, 'receive', 3], [9, 'ack-send', 4], [10, 'ack-receive', 4]]);
  assert.deepEqual(result.retransmissions.map((entry) => [entry.tick, entry.packet, entry.attempt]), [[6, 2, 2]]); assert.deepEqual(result.final.received, [1, 2, 3]); assert.deepEqual(result.final.delivered, [1, 2, 3]); assert.equal(result.final.ackNext, 4); assert.equal(result.final.deadline, null); assert.equal(result.completedAt, 10); assert.equal(result.endedAt, 10); assert.equal(result.status, 'completed'); assert.equal(result.trace.length, 11);
  assert.deepEqual(result.trace[5].events, []); assert.equal(result.trace[5].after.deadline, 6);
});

test('L016 越序缓冲不累计确认缺口，补2释放2/3且ACK4跳跃', async () => {
  const { simulate, example } = await model(); const result = simulate(example('gap'));
  assert.deepEqual(result.trace[1].after.buffer, [3]); assert.deepEqual(result.trace[1].after.received, [1, 3]); assert.deepEqual(result.trace[1].after.delivered, [1]); assert.equal(result.trace[1].after.receiverNext, 2);
  assert.deepEqual(result.events.filter((entry) => entry.type === 'ack-send').map((entry) => [entry.tick, entry.ack]), [[1, 2], [1, 2], [7, 4]]);
  assert.deepEqual(result.trace[7].events.find((entry) => entry.type === 'receive').released, [2, 3]); assert.deepEqual(result.trace[8].events[0].confirmed, [2, 3]); assert.deepEqual(result.final.buffer, []); assert.equal(result.completedAt, 8); assert.deepEqual(result.retransmissions.map((entry) => entry.packet), [2]);
});

test('L016 固定窗口滑动只按累计ACK，重复ACK不重启超时或快速重传', async () => {
  const { simulate, example } = await model(); const result = simulate({ ...example('gap'), packetCount: '4' });
  assert.deepEqual(result.sends.map((entry) => [entry.tick, entry.packet]), [[0, 1], [0, 2], [0, 3], [2, 4], [6, 2]]); assert.equal(result.trace[4].events[0].fresh, false); assert.equal(result.trace[4].after.deadline, 6); assert.deepEqual(result.trace[3].after.buffer, [3, 4]); assert.deepEqual(result.trace[8].events[0].confirmed, [2, 3, 4]); assert.deepEqual(result.retransmissions.map((entry) => entry.packet), [2]);
  for (const frame of result.trace) assert.ok(frame.after.outstanding.length <= result.input.window);
});

test('L016 ACK恰在超时tick先处理，不误重传；同tick数据入网顺序稳定', async () => {
  const { simulate } = await model(); const result = simulate({ packetCount: '3', window: '3', delay: '1', timeout: '2', drops: '' });
  assert.equal(result.retransmissions.length, 0); assert.equal(result.completedAt, 2); assert.deepEqual(result.trace[1].events.filter((entry) => entry.type === 'receive').map((entry) => entry.packet), [1, 2, 3]); assert.deepEqual(result.trace[2].events.map((entry) => entry.ack), [2, 3, 4]); assert.deepEqual(result.final.delivered, [1, 2, 3]);
});

test('L016 过早超时重复包不重复交付；同tick先数据后ACK并排空尾部', async () => {
  const { simulate, example } = await model(); const result = simulate(example('early'));
  assert.deepEqual(result.retransmissions.map((entry) => [entry.tick, entry.packet]), [[1, 1], [3, 1]]); assert.deepEqual(result.events.filter((entry) => entry.type === 'receive').map((entry) => [entry.tick, entry.disposition, entry.released]), [[2, 'in-order', [1]], [3, 'duplicate', []], [5, 'duplicate', []]]);
  assert.deepEqual(result.trace[5].events.map((entry) => entry.type), ['receive', 'ack-send', 'ack-receive']); assert.equal(result.completedAt, 4); assert.equal(result.endedAt, 7); assert.deepEqual(result.final.received, [1]); assert.deepEqual(result.final.delivered, [1]); assert.deepEqual(result.final.attempts, [3]); assert.equal(result.final.inFlight.length, 0); assert.equal(result.final.rto, 4);
});

test('L016 两个缺口单计时器先重传1再2，RTO退避及新ACK重启精确', async () => {
  const { simulate, example } = await model(); const result = simulate({ ...example('gap'), drops: '1, 2' });
  assert.deepEqual(result.events.filter((entry) => entry.type === 'timeout').map((entry) => [entry.tick, entry.packet, entry.oldRto, entry.newRto]), [[4, 1, 4, 8], [14, 2, 8, 16]]); assert.equal(result.trace[6].after.deadline, 14); assert.deepEqual(result.trace[5].after.buffer, [3]); assert.equal(result.completedAt, 16); assert.deepEqual(result.final.delivered, [1, 2, 3]);
});

test('L016 无丢包终止公式、窗口容量与30包全部接收的独立预期', async () => {
  const { simulate } = await model();
  for (const packetCount of [1, 2, 7, 30]) for (const window of [1, 3, 8]) {
    const delay = 2; const result = simulate({ packetCount, window, delay, timeout: 8, drops: '' }); assert.equal(result.completedAt, Math.ceil(packetCount / window) * 2 * delay); assert.equal(result.endedAt, result.completedAt); assert.equal(result.retransmissions.length, 0); assert.equal(result.sends.length, packetCount); assert.deepEqual(result.final.delivered, Array.from({ length: packetCount }, (_, index) => index + 1)); assert.equal(result.final.ackNext, packetCount + 1);
    for (const frame of result.trace) { assert.ok(frame.after.outstanding.length <= window); assert.equal(new Set(frame.after.delivered).size, frame.after.delivered.length); }
  }
});

test('L016 参数/丢包列表整数类型、重复、边界与代码文本拒绝', async () => {
  const { simulate, example, validateInput } = await model(); const draft = example();
  for (const patch of [{ packetCount: '0' }, { packetCount: '31' }, { window: '0' }, { window: '9' }, { delay: '0' }, { delay: '21' }, { timeout: '0' }, { timeout: '65' }, { timeout: '1.2' }, { window: [1] }, { packetCount: true }, { delay: '1e1' }, { drops: '0' }, { drops: '4' }, { drops: '2,2' }, { drops: '2,' }, { drops: 'alert(1)' }, { drops: null }, { drops: '汉'.repeat(90) }]) assert.throws(() => simulate({ ...draft, ...patch }));
  assert.deepEqual(validateInput({ ...draft, drops: '1，2 3' }).drops, [1, 2, 3]); assert.equal(simulate({ ...draft, packetCount: '1', window: '8', drops: '' }).sends.length, 1);
});

test('L016 严格tick/事件拒绝无截断，精确限制通过及实际2048界限', async () => {
  const { simulate, example } = await model(); const draft = example(); const result = simulate(draft); assert.equal(simulate(draft, { maxTick: 10, maxEvents: 15 }).status, 'completed'); assert.equal(result.events.length, 15);
  assert.throws(() => simulate(draft, { maxTick: 9 }), /tick超过9/); assert.throws(() => simulate(draft, { maxEvents: 14 }), /事件数超过14/); assert.throws(() => simulate(draft, { maxTick: 2049 }), /上限/); assert.throws(() => simulate(draft, { maxEvents: 513 }), /事件上限/);
  assert.throws(() => simulate({ packetCount: '30', window: '1', delay: '1', timeout: '64', drops: Array.from({ length: 30 }, (_, index) => index + 1).join(',') }), /tick超过2048/);
});

test('L016 输入/快照/列表独立、确定性与仅首次丢包', async () => {
  const { simulate, example } = await model(); const draft = example(); const before = structuredClone(draft); const first = simulate(draft); assert.deepEqual(first, simulate(draft)); assert.deepEqual(draft, before); assert.equal(first.events.filter((entry) => entry.type === 'drop').length, 1);
  first.trace[0].after.outstanding[0] = 999; assert.equal(first.trace[1].before.outstanding[0], 1); first.sends[0].packet = 999; assert.equal(first.events[0].packet, 1); draft.drops = '1'; assert.deepEqual(first.input.drops, [2]);
});

test('L016 schema/64KiB UTF8恢复与Markdown完整空tick/来源/累计ACK', async () => {
  const { prepareStoredState, validateStoredState, example, simulate, reportMarkdown } = await model(); const draft = example(); const overhead = new TextEncoder().encode(JSON.stringify(prepareStoredState({ ...draft, drops: '' }))).byteLength; const exact = prepareStoredState({ ...draft, drops: 'a'.repeat(65536 - overhead) }); assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 65536); assert.deepEqual(validateStoredState(exact), exact);
  assert.throws(() => prepareStoredState({ ...draft, drops: exact.drops + 'a' }), /64KiB/); assert.throws(() => validateStoredState({ ...prepareStoredState(draft), ignored: '汉'.repeat(22000) }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/); assert.throws(() => validateStoredState({ ...prepareStoredState(draft), window: 1 }), /字段类型/);
  const report = reportMarkdown({ draft, result: simulate(draft) }); assert.match(report, /重传包：2/); assert.match(report, /### tick 5/); assert.match(report, /无?没有事件/); assert.match(report, /rfc9293.html#section-3.4/); assert.match(report, /rfc6298.html#section-5/); assert.match(reportMarkdown({ draft, result: null }), /未生成完成报告/);
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

test('L016 实际UI默认例单步/超时6/最终10与JSON-MD副本及草稿恢复', async (t) => {
  const exported = []; const stored = new Map(); dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L016/index.js'); const root = new NodeStub('div'); const config = { get: (key) => stored.get(key), set: (key, value) => stored.set(key, value) }; const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await button(root, '模拟时序').fire('click'); assert.match(root.textContent, /当前查看tick0/); assert.match(root.textContent, /全部确认tick10/); await button(root, '下一tick').fire('click'); assert.match(root.textContent, /当前查看tick1/); await fill(root, '查看tick', '5'); assert.match(root.textContent, /本tick无事件/); await button(root, '查看tick6').fire('click'); assert.match(root.textContent, /只重传最早未确认包2/); assert.match(root.textContent, /RTO 4→8/); await fill(root, '查看tick', '10'); assert.equal(button(root, '下一tick').disabled, true); assert.match(root.textContent, /连续交付=1、2、3/);
  await button(root, '导出完整 JSON').fire('click'); const payload = JSON.parse(exported[0].content); assert.equal(payload.schemaVersion, 1); assert.deepEqual(payload.result.retransmissions.map((entry) => entry.packet), [2]); assert.equal(payload.result.trace.length, 11); assert.equal(exported[0].copyOnly, true);
  await button(root, '导出完整 Markdown').fire('click'); assert.equal(exported[1].copyOnly, true); assert.match(exported[1].content, /tick 5/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
  handle.deactivate(); assert.equal(stored.get('features.L016.state').schemaVersion, 1); assert.equal(Object.hasOwn(stored.get('features.L016.state'), 'result'), false);
  const restoredRoot = new NodeStub('div'); const restored = feature.create(restoredRoot, { config }); assert.match(restoredRoot.textContent, /已恢复参数草稿/); assert.doesNotMatch(restoredRoot.textContent, /全程报告：/); assert.equal(control(restoredRoot, '首次丢包列表').value, '2'); restored.destroy(); assert.equal(restoredRoot.children.length, 0);
});

test('L016 实际UI参数编辑清旧轨迹、越序缓冲/累计ACK和过早超时重复', async (t) => {
  const exported = []; dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(JSON.parse(payload.content)); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L016/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await button(root, '载入越序缓冲示例').fire('click'); await button(root, '模拟时序').fire('click'); await fill(root, '查看tick', '1'); assert.match(root.textContent, /越序缓冲=3/); await button(root, '查看tick7').fire('click'); assert.match(root.textContent, /按序交付包2、3/);
  for (const [label, value] of [['固定窗口包数', '2'], ['数据包数量', '4'], ['单向延迟tick', '2'], ['初始超时tick', '5'], ['首次丢包列表', '1']]) { await fill(root, label, value); assert.doesNotMatch(root.textContent, /全程报告：/); await button(root, '模拟时序').fire('click'); assert.match(root.textContent, /全程报告：/); }
  await fill(root, '首次丢包列表', ''); await button(root, '导出完整 JSON').fire('click'); assert.equal(exported[0].result, null);
  await button(root, '载入过早超时示例').fire('click'); await button(root, '模拟时序').fire('click'); assert.match(root.textContent, /全部确认tick4 · 在途排空tick7 · 重传2次/); await fill(root, '查看tick', '3'); assert.match(root.textContent, /重复包1，不重复交付/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
});

test('L016 界面上限/非法输入整轮拒绝，无假完成/局部结果', async (t) => {
  dom(t, {}); const { default: feature } = await import('../src/renderer/features/L016/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await fill(root, '首次丢包列表', '<img onerror=alert(1)>'); await button(root, '模拟时序').fire('click'); assert.match(root.textContent, /须为十进制整数/); assert.doesNotMatch(root.textContent, /全程报告：/);
  await fill(root, '数据包数量', '30'); await fill(root, '初始超时tick', '64'); await fill(root, '首次丢包列表', Array.from({ length: 30 }, (_, index) => index + 1).join(',')); await button(root, '模拟时序').fire('click'); assert.match(root.textContent, /tick超过2048上限/); assert.match(root.textContent, /当前没有完成报告/); assert.doesNotMatch(root.textContent, /全程报告：/);
});

test('L016 配置64KiB/schema、导出能力/取消和生命周期范围', async (t) => {
  let saves = 0; let writes = 0; dom(t, { saveText: async () => { saves++; return { canceled: true }; } }); const { default: feature } = await import('../src/renderer/features/L016/index.js'); const root = new NodeStub('div'); const handle = feature.create(root, { config: { get: () => null, set: () => { writes++; } } }); t.after(() => handle.destroy());
  await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 0); assert.match(root.textContent, /缺少防覆盖/); window.toolbox.files.saveTextSupportsCopyOnly = true; await button(root, '导出完整 Markdown').fire('click'); assert.equal(saves, 1); assert.match(root.textContent, /已取消导出/);
  await fill(root, '首次丢包列表', '汉'.repeat(22000)); const before = writes; handle.deactivate(); assert.equal(writes, before); assert.match(root.textContent, /当前输入未写入全局配置/);
  const { prepareStoredState, example } = await model(); for (const saved of [{ schemaVersion: 2 }, { ...prepareStoredState(example()), hidden: '汉'.repeat(22000) }, { ...prepareStoredState(example()), delay: 1 }]) { const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => saved } }); assert.match(invalidRoot.textContent, /未能恢复/); invalid.destroy(); }
});
