'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const loadModel = () => import('../src/renderer/features/L002/model.mjs');

test('L002 每步拒绝空白依据，顺序解封且未完成时不能导出', async () => {
  const { createSession, sampleExercise, submitReason, buildReport } = await loadModel();
  const session = createSession(sampleExercise(), '2026-10-02T00:00:00Z');
  for (const value of ['', '   ', '\n\t\r']) assert.throws(() => submitReason(session, 0, value), /不能为空/);
  assert.throws(() => submitReason(session, 1, '跳过第一步'), /按顺序/);
  assert.throws(() => submitReason(session, -1, '无效步骤'), /不存在/);
  assert.throws(() => buildReport(session), /完成所有步骤/);
  const first = submitReason(session, 0, '两边都减三');
  assert.equal(session.records.length, 0);
  assert.equal(first.records.length, 1);
  assert.throws(() => submitReason(first, 0, '想覆盖原始答案'), /不能改写/);
  assert.throws(() => buildReport(first), /完成所有步骤/);
});

test('L002 三步原始记录、前提差异与反思在导出及恢复后保持独立', async () => {
  const { createSession, sampleExercise, submitReason, updateReflection, restoreSession, buildReport, reportMarkdown } = await loadModel();
  const exercise = sampleExercise();
  let session = createSession(exercise);
  const original = ['  两边减3\n保持相等。  ', '两边除2', '代回原式'];
  session = submitReason(session, 0, original[0], [exercise.premises[0], exercise.premises[0], exercise.premises[3]], '2026-10-02T00:01:00Z');
  session = submitReason(session, 1, original[1], [exercise.premises[2]], '2026-10-02T00:02:00Z');
  session = submitReason(session, 2, original[2], [], '2026-10-02T00:03:00Z');
  const beforeReflection = session;
  session = updateReflection(session, 1, '刚才漏掉了除数不能为零。', '2026-10-02T00:04:00Z');
  assert.equal(beforeReflection.records[1].reflection, '');
  const report = buildReport(restoreSession(JSON.parse(JSON.stringify(session))));
  assert.equal(report.completedSteps, 3);
  assert.deepEqual(report.records.map((record) => record.originalReason), original);
  assert.deepEqual(report.records[0].selectedPremises, [exercise.premises[0], exercise.premises[3]]);
  assert.deepEqual(report.records[0].otherSelectedPremises, [exercise.premises[3]]);
  assert.deepEqual(report.records[1].unselectedReferencePremises, [exercise.premises[1]]);
  assert.equal(report.records[1].reflection, '刚才漏掉了除数不能为零。');
  assert.equal(report.records[1].submittedAt, '2026-10-02T00:02:00Z');
  assert.equal(report.records[1].reflectionUpdatedAt, '2026-10-02T00:04:00Z');
  assert.ok(reportMarkdown(session).includes(original[0]));
  report.records[0].selectedPremises.push('导出对象修改');
  assert.equal(session.records[0].selectedPremises.length, 2);
});

test('L002 输入边界：步数、过长文本、前提范围和空参考内容', async () => {
  const { createSession, sampleExercise, submitReason, updateReflection, restoreSession } = await loadModel();
  assert.throws(() => createSession({ ...sampleExercise(), steps: [] }), /1 至 20/);
  const tooMany = sampleExercise();
  tooMany.steps = Array.from({ length: 21 }, () => tooMany.steps[0]);
  assert.throws(() => createSession(tooMany), /1 至 20/);
  const noReason = sampleExercise(); noReason.steps[1].reason = '  ';
  assert.throws(() => createSession(noReason), /第 2 步参考理由不能为空/);
  const unknown = sampleExercise(); unknown.steps[0].premises = ['未定义前提'];
  assert.throws(() => createSession(unknown), /不在可选前提/);
  const session = createSession(sampleExercise());
  assert.throws(() => submitReason(session, 0, 'x'.repeat(10001)), /超过/);
  assert.throws(() => submitReason(session, 0, '合法依据', ['未知']), /不存在/);
  assert.throws(() => updateReflection(session, 0, '尚未作答'), /先提交/);
  assert.throws(() => restoreSession({ exercise: session.exercise, records: [{ originalReason: ' ' }] }), /不能为空/);
});

test('L002 自定义单步无前提例题可完成，编辑源对象不改变练习快照', async () => {
  const { createSession, submitReason, buildReport } = await loadModel();
  const draft = { title: '检查条件', problem: 'A 为真，说明 A 或 B 的结果。', premises: [], steps: [{ title: '逻辑或', prompt: '为什么结果为真？', answer: '真', reason: '或运算只需至少一项为真。', premises: [] }] };
  const session = createSession(draft);
  draft.steps[0].reason = '修改草稿';
  const complete = submitReason(session, 0, 'A 已经为真，所以整个析取为真。');
  assert.equal(buildReport(complete).records[0].referenceReason, '或运算只需至少一项为真。');
});

test('L002 配置状态带版本，UTF-8 64KiB 精确边界与中文超限均按字节校验', async () => {
  const { STATE_MAX_BYTES, prepareStoredState, validateStoredState } = await loadModel();
  const encoder = new TextEncoder();
  const overhead = encoder.encode(JSON.stringify({ payload: '', schemaVersion: 1 })).byteLength;
  const exact = prepareStoredState({ payload: 'a'.repeat(STATE_MAX_BYTES - overhead) });
  assert.equal(exact.schemaVersion, 1);
  assert.equal(encoder.encode(JSON.stringify(exact)).byteLength, STATE_MAX_BYTES);
  assert.equal(validateStoredState(exact), exact);
  assert.throws(() => prepareStoredState({ payload: `${exact.payload}a` }), /64KiB/);
  const chinese = { payload: '汉'.repeat(22000), schemaVersion: 1 };
  assert.ok(JSON.stringify(chinese).length < STATE_MAX_BYTES);
  assert.ok(encoder.encode(JSON.stringify(chinese)).byteLength > STATE_MAX_BYTES);
  assert.throws(() => prepareStoredState(chinese), /64KiB/);
  assert.throws(() => validateStoredState(chinese), /64KiB/);
  assert.throws(() => validateStoredState({ payload: '旧状态' }), /版本不支持/);
  assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本不支持/);
});

// Minimal DOM contract: execute real component events without Electron or a browser.
// This verifies gating and file payloads; it is not layout or live-client validation.
class NodeStub {
  constructor(tag = '', value = null) {
    this.tagName = tag; this.nodeType = value === null ? 1 : 3; this.value = ''; this.checked = false; this.disabled = false;
    this.children = []; this.attributes = {}; this.style = {}; this.dataset = {}; this.events = {}; this.className = ''; this.text = value;
    this.classList = { add: (name) => { this.className += ` ${name}`; }, remove: (name) => { this.className = this.className.split(' ').filter((entry) => entry !== name).join(' '); }, toggle: (name, enabled) => { this.classList.remove(name); if (enabled) this.classList.add(name); } };
  }
  append(...items) { this.children.push(...items.map((item) => item?.nodeType ? item : new NodeStub('', String(item)))); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'disabled') this.disabled = true; }
  addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
  get textContent() { return this.text === null ? this.children.map((child) => child.textContent).join('') : this.text; }
  set textContent(value) { this.text = null; this.replaceChildren(String(value)); }
  set innerHTML(_value) { throw new Error('L002 must not render user input with innerHTML'); }
  async fire(type) { if (type === 'click' && this.disabled) return; for (const callback of this.events[type] || []) await callback({ target: this }); }
}
function walk(node) { return [node, ...node.children.flatMap(walk)]; }
function button(root, label) { const found = walk(root).find((node) => node.tagName === 'button' && node.textContent === label); assert.ok(found, `button ${label}`); return found; }

test('L002 UI：未提交无答案，三步解封后防覆盖导出，切走保存且销毁清理', async (t) => {
  const oldDocument = global.document; const oldWindow = global.window;
  global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) };
  const exported = []; const stored = new Map();
  global.window = { toolbox: { files: { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true, path: 'example.json' }; } } } };
  const config = { get: (key) => stored.get(key), set: async (key, value) => { stored.set(key, value); } };
  t.after(() => { global.document = oldDocument; global.window = oldWindow; });
  const { default: feature } = await import('../src/renderer/features/L002/index.js');
  const root = new NodeStub('div'); const handle = feature.create(root, { config });
  t.after(() => handle.destroy());
  await button(root, '开始三步示例').fire('click');
  assert.ok(!root.textContent.includes('两边都减去 3，得到 2x = 8。'));
  assert.equal(button(root, '导出 JSON 原始记录').disabled, true);
  const originals = [' <script>不执行</script> 两边减3 ', '两边除2；2不为零', '代回原式核验'];
  for (let index = 0; index < 3; index += 1) {
    const textarea = walk(root).find((node) => node.tagName === 'textarea' && node.attributes['aria-label'] === '自己的依据');
    textarea.value = ' \n '; await textarea.fire('input');
    assert.equal(button(root, '提交依据，解封本步').disabled, true);
    textarea.value = originals[index]; await textarea.fire('input');
    assert.equal(button(root, '提交依据，解封本步').disabled, false);
    await button(root, '提交依据，解封本步').fire('click');
    assert.ok(root.textContent.includes(originals[index]));
    if (index < 2) await button(root, '进入下一步').fire('click');
  }
  await button(root, '导出 JSON 原始记录').fire('click');
  assert.equal(exported.length, 1);
  assert.equal(exported[0].copyOnly, true);
  assert.equal(exported[0].extension, 'json');
  assert.deepEqual(JSON.parse(exported[0].content).records.map((record) => record.originalReason), originals);
  const reflection = walk(root).filter((node) => node.tagName === 'textarea')[0];
  reflection.value = '后来补充的反思'; await reflection.fire('input');
  handle.deactivate();
  assert.equal(stored.get('features.L002.state').session.records[2].reflection, '后来补充的反思');
  const restoredRoot = new NodeStub('div'); const restored = feature.create(restoredRoot, { config });
  assert.ok(restoredRoot.textContent.includes('完整练习记录'));
  assert.ok(restoredRoot.textContent.includes(originals[2]));
  restored.destroy();
  assert.equal(restoredRoot.children.length, 0);
});

test('L002 UI：结构化编辑器创建自定义例题，未合导出基础层不调用保存', async (t) => {
  const oldDocument = global.document; const oldWindow = global.window;
  global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) };
  let saves = 0;
  global.window = { toolbox: { files: { saveText: async () => { saves += 1; return { ok: true }; } } } };
  t.after(() => { global.document = oldDocument; global.window = oldWindow; });
  const { default: feature } = await import('../src/renderer/features/L002/index.js');
  const root = new NodeStub('div'); const handle = feature.create(root);
  t.after(() => handle.destroy());
  await button(root, '编写自己的例题').fire('click');
  await button(root, '清空编辑器').fire('click');
  await button(root, '开始练习').fire('click');
  assert.ok(root.textContent.includes('第 1 步提示不能为空'));
  const fields = walk(root).filter((node) => ['input', 'textarea'].includes(node.tagName));
  const values = ['我的例题', '已知 A 为真，判断 A 或 B。', '', '单步判断', '说明判断依据。', '结果为真。', '逻辑或有一项为真即为真。', ''];
  assert.equal(fields.length, values.length);
  for (let index = 0; index < fields.length; index += 1) { fields[index].value = values[index]; await fields[index].fire('input'); }
  await button(root, '开始练习').fire('click');
  assert.ok(!root.textContent.includes('结果为真。'));
  const explanation = walk(root).find((node) => node.attributes['aria-label'] === '自己的依据');
  explanation.value = 'A 为真已经满足或的条件。'; await explanation.fire('input');
  await button(root, '提交依据，解封本步').fire('click');
  assert.ok(root.textContent.includes('结果为真。'));
  await button(root, '导出 JSON 原始记录').fire('click');
  assert.ok(root.textContent.includes('防覆盖导出接口'));
  assert.equal(saves, 0);
  window.toolbox.files.saveTextSupportsCopyOnly = true;
  window.toolbox.files.saveText = async () => ({ ok: false, canceled: true });
  await button(root, '导出 Markdown 复盘').fire('click');
  assert.ok(root.textContent.includes('已取消导出，练习记录保留'));
  assert.ok(root.textContent.includes('完整练习记录'));
  window.toolbox.files.saveText = async () => ({ ok: false, error: '目标已存在' });
  await button(root, '导出 JSON 原始记录').fire('click');
  assert.ok(root.textContent.includes('目标已存在'));
  assert.equal(button(root, '导出 JSON 原始记录').disabled, false);
});

test('L002 UI：大练习不写全局配置，警告不被进度覆盖但仍可完整导出', async (t) => {
  const oldDocument = global.document; const oldWindow = global.window;
  global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) };
  const stored = new Map(); const writes = []; const exported = [];
  global.window = { toolbox: { files: { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true, path: 'large.json' }; } } } };
  t.after(() => { global.document = oldDocument; global.window = oldWindow; });
  const config = { get: (key) => stored.get(key), set: async (key, value) => { writes.push(value); stored.set(key, value); } };
  const { default: feature } = await import('../src/renderer/features/L002/index.js');
  const root = new NodeStub('div'); const handle = feature.create(root, { config });
  t.after(() => handle.destroy());
  await button(root, '开始三步示例').fire('click');
  for (let index = 0; index < 3; index += 1) {
    const textarea = walk(root).find((node) => node.attributes['aria-label'] === '自己的依据');
    textarea.value = '汉'.repeat(10000); await textarea.fire('input');
    await button(root, '提交依据，解封本步').fire('click');
    if (index < 2) await button(root, '进入下一步').fire('click');
  }
  assert.ok(root.textContent.includes('当前内容未更新到本机配置'));
  assert.ok(root.textContent.includes('请完成全部步骤后导出完整记录'));
  assert.ok(root.textContent.includes('原始依据已锁定在当前练习中'));
  assert.ok(stored.get('features.L002.state').session.records.length < 3);
  assert.ok(writes.every((state) => state.schemaVersion === 1 && new TextEncoder().encode(JSON.stringify(state)).byteLength <= 65536));
  const writeCount = writes.length;
  handle.deactivate();
  assert.equal(writes.length, writeCount);
  await button(root, '导出 JSON 原始记录').fire('click');
  assert.equal(JSON.parse(exported[0].content).records.length, 3);
  assert.ok(new TextEncoder().encode(exported[0].content).byteLength > 65536);
  assert.ok(root.textContent.includes('当前内容未更新到本机配置'));
});

test('L002 UI：版本缺失与超限的保存状态拒绝恢复', async (t) => {
  const oldDocument = global.document; const oldWindow = global.window;
  global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) };
  global.window = {};
  t.after(() => { global.document = oldDocument; global.window = oldWindow; });
  const { default: feature } = await import('../src/renderer/features/L002/index.js');
  const { createSession, sampleExercise } = await loadModel();
  const legacy = { draft: sampleExercise(), session: createSession(sampleExercise()) };
  for (const [saved, expected] of [[legacy, '版本不支持'], [{ ...legacy, schemaVersion: 1, reasonDraft: '汉'.repeat(30000) }, '64KiB 本机保存上限']]) {
    const root = new NodeStub('div');
    const handle = feature.create(root, { config: { get: () => saved } });
    assert.ok(root.textContent.includes(expected));
    assert.ok(button(root, '开始三步示例'));
    assert.ok(!walk(root).some((node) => node.attributes['aria-label'] === '自己的依据'));
    handle.destroy();
  }
});
