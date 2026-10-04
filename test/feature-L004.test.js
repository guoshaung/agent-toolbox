'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L004/model.mjs');
const t0 = '2026-10-02T00:00:00.000Z';
const t1 = '2026-10-02T00:01:00.000Z';
const t2 = '2026-10-02T00:02:00.000Z';
const prediction = (rawValue = '10') => ({ title: '承重', type: 'number', rawValue, unit: 'g', rationale: '事前估计' });

test('L004 验收：预测10观察13差值3，修改只追加版本且旧版完整导出', async () => {
  const { createLedger, commitPrediction, appendObservation, buildReport, reportMarkdown, restoreLedger } = await model();
  let ledger = commitPrediction(createLedger(), prediction(), null, t0);
  ledger = appendObservation(ledger, { predictionId: 'p1', rawValue: '13', unit: 'g', observedAt: t1 }, t1);
  const oldLedger = ledger;
  ledger = commitPrediction(ledger, { rawValue: '12', rationale: '观察后修订估计' }, 'p1', t2);
  assert.equal(oldLedger.predictions.length, 1);
  assert.equal(ledger.predictions[0].value, 10);
  assert.equal(ledger.predictions[1].value, 12);
  assert.equal(ledger.predictions[1].version, 2);
  assert.equal(ledger.predictions[1].seriesId, 'p1');
  assert.equal(ledger.predictions[1].revisesId, 'p1');
  assert.throws(() => commitPrediction(ledger, prediction(), 'p1', t2), /最新版本/);
  const report = buildReport(restoreLedger(JSON.parse(JSON.stringify(ledger))));
  assert.equal(report.observations[0].comparison.difference, 3);
  assert.equal(report.observations[0].comparison.absoluteError, 3);
  assert.equal(report.observations[0].comparison.relativePercent, 30);
  assert.equal(report.predictions[1].alreadyHadObservationAtCommit, true);
  assert.deepEqual(report.pendingPredictionIds, ['p2']);
  assert.ok(reportMarkdown(ledger).includes('预测：10 g'));
  assert.ok(reportMarkdown(ledger).includes('预测：12 g'));
  assert.ok(reportMarkdown(ledger).includes('差值：3'));
});

test('L004 空数值不当零，有限数解析、单位不一致和溢出均有明确边界', async () => {
  const { parseNumeric, createLedger, commitPrediction, appendObservation, compareObservation } = await model();
  for (const raw of ['', ' ', 'NaN', 'Infinity', '1e999', '1,000', '0x10', '10g']) assert.throws(() => parseNumeric(raw));
  assert.equal(parseNumeric(' 1e2 '), 100);
  assert.equal(parseNumeric('-.5'), -0.5);
  let ledger = commitPrediction(createLedger(), prediction('0'), null, t0);
  ledger = appendObservation(ledger, { predictionId: 'p1', rawValue: '3', unit: 'g', observedAt: t1 }, t1);
  const zero = compareObservation(ledger.predictions[0], ledger.observations[0]);
  assert.equal(zero.difference, 3); assert.equal(zero.relativePercent, null); assert.equal(zero.relativeUnavailable, '预测为零');
  const mismatch = compareObservation(ledger.predictions[0], { ...ledger.observations[0], unit: 'kg' });
  assert.equal(mismatch.difference, null); assert.match(mismatch.status, /单位不一致/);
  const huge = compareObservation({ ...ledger.predictions[0], value: -1e308 }, { ...ledger.observations[0], value: 1e308 });
  assert.equal(huge.difference, null); assert.match(huge.status, /超出数值范围/);
  const negative = compareObservation({ ...ledger.predictions[0], value: -10 }, { ...ledger.observations[0], value: -13 });
  assert.equal(negative.difference, -3); assert.equal(negative.absoluteError, 3); assert.equal(negative.relativePercent, -30);
});

test('L004 缺测原因必填，不生成数值偏差，追加观察不覆盖先前记录', async () => {
  const { createLedger, commitPrediction, appendObservation, buildReport } = await model();
  let ledger = commitPrediction(createLedger(), prediction(), null, t0);
  assert.throws(() => appendObservation(ledger, { predictionId: 'p1', missing: true, note: ' ', observedAt: t1 }, t1), /缺测原因/);
  assert.throws(() => appendObservation(ledger, { predictionId: 'p1', rawValue: '', observedAt: t1 }, t1), /不能为空/);
  ledger = appendObservation(ledger, { predictionId: 'p1', rawValue: '13', unit: 'g', observedAt: t1 }, t1);
  ledger = appendObservation(ledger, { predictionId: 'p1', missing: true, rawValue: '0', note: '仪器未给出结果', observedAt: t2 }, t2);
  assert.equal(ledger.observations[0].value, 13);
  const missing = buildReport(ledger).observations[1];
  assert.equal(missing.rawValue, null); assert.equal(missing.value, null);
  assert.equal(missing.comparison.difference, null); assert.match(missing.comparison.status, /缺测/);
});

test('L004 枚举按明确标签对账，修订沿用原始枚举池', async () => {
  const { createLedger, commitPrediction, appendObservation, buildReport } = await model();
  let ledger = commitPrediction(createLedger(), { title: '趋势', type: 'enum', rawValue: '上升', options: ['上升', '持平', '下降'], unit: '忽略单位' }, null, t0);
  assert.equal(ledger.predictions[0].unit, '');
  assert.throws(() => appendObservation(ledger, { predictionId: 'p1', rawValue: '大幅升高', observedAt: t1 }, t1), /枚举选项/);
  ledger = appendObservation(ledger, { predictionId: 'p1', rawValue: '下降', observedAt: t1 }, t1);
  ledger = commitPrediction(ledger, { rawValue: '持平' }, 'p1', t2);
  const comparison = buildReport(ledger).observations[0].comparison;
  assert.equal(comparison.matched, false); assert.equal(comparison.difference, null);
  assert.deepEqual(ledger.predictions[1].options, ['上升', '持平', '下降']);
});

test('L004 回补观察标事后，未来/无时区/非法日期拒绝，修订不可倒置时间', async () => {
  const { createLedger, commitPrediction, appendObservation, buildReport } = await model();
  let ledger = commitPrediction(createLedger(), prediction(), null, t1);
  ledger = appendObservation(ledger, { predictionId: 'p1', rawValue: '13', unit: 'g', observedAt: t0 }, t2);
  assert.match(buildReport(ledger).observations[0].comparison.timing, /不能作为事前预测证据/);
  assert.throws(() => appendObservation(ledger, { predictionId: 'p1', rawValue: '13', observedAt: t2 }, t1), /不能晚于/);
  assert.throws(() => appendObservation(ledger, { predictionId: 'p1', rawValue: '13', observedAt: '2026-10-02T00:00:00' }, t2), /包含时区/);
  assert.throws(() => commitPrediction(createLedger(), prediction(), null, '2026-02-30T00:00:00Z'), /日历时间/);
  assert.throws(() => commitPrediction(ledger, { rawValue: '11' }, 'p1', t0), /早于旧版本/);
});

test('L004 状态严格版本与64KiB UTF8字节边界，损坏版本关系拒绝恢复', async () => {
  const { STATE_MAX_BYTES, prepareStoredState, validateStoredState, createLedger, commitPrediction, restoreLedger } = await model();
  const encoder = new TextEncoder();
  const overhead = encoder.encode(JSON.stringify({ payload: '', schemaVersion: 1 })).byteLength;
  const exact = prepareStoredState({ payload: 'a'.repeat(STATE_MAX_BYTES - overhead) });
  assert.equal(encoder.encode(JSON.stringify(exact)).byteLength, STATE_MAX_BYTES);
  assert.equal(validateStoredState(exact), exact);
  assert.throws(() => prepareStoredState({ payload: exact.payload + 'a' }), /64KiB/);
  assert.throws(() => validateStoredState({ payload: '汉'.repeat(22000), schemaVersion: 1 }), /64KiB/);
  assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/);
  assert.throws(() => validateStoredState({}), /版本/);
  const ledger = commitPrediction(createLedger(), prediction(), null, t0);
  ledger.predictions[0].version = 4;
  assert.throws(() => restoreLedger(ledger), /版本关系不一致/);
});

class NodeStub {
  constructor(tag = '', text = null) {
    this.tagName = tag; this.nodeType = text === null ? 1 : 3; this.text = text; this.children = []; this.attributes = {}; this.style = {}; this.dataset = {}; this.className = ''; this.events = {}; this.value = ''; this.checked = false; this.disabled = false;
    this.classList = { add: (name) => { this.className += ` ${name}`; }, remove: (name) => { this.className = this.className.split(' ').filter((item) => item !== name).join(' '); }, toggle: (name, yes) => { this.classList.remove(name); if (yes) this.classList.add(name); } };
  }
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
function button(root, label) { const node = walk(root).find((item) => item.tagName === 'button' && item.textContent === label); assert.ok(node, label); return node; }
async function fill(root, label, value) { const control = walk(root).find((node) => node.attributes['aria-label'] === label); assert.ok(control, label); control.value = value; await control.fire(control.tagName === 'select' ? 'change' : 'input'); }
function dom(t, files) {
  const oldDocument = global.document; const oldWindow = global.window;
  global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) };
  global.window = { toolbox: { files } };
  t.after(() => { global.document = oldDocument; global.window = oldWindow; });
}

test('L004 UI：预测→观察差值3→新版本→全量导出，旧记录与恢复均保留', async (t) => {
  const exported = []; const stored = new Map();
  dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true, path: 'ledger.json' }; } });
  const { default: feature } = await import('../src/renderer/features/L004/index.js');
  const config = { get: (key) => stored.get(key), set: async (key, value) => { stored.set(key, value); } };
  const root = new NodeStub('div'); const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await button(root, '载入数值示例').fire('click'); await button(root, '提交并锁定预测').fire('click');
  await button(root, '填入观察13示例').fire('click'); await button(root, '追加观察并对账').fire('click');
  assert.ok(root.textContent.includes('差值（观察−预测）：3'));
  await button(root, '追加修订 p1').fire('click'); await fill(root, '数值预测', '12'); await button(root, '提交新版本，保留旧版').fire('click');
  assert.equal(button(root, '追加修订 p1').disabled, true);
  await button(root, '填入观察13示例').fire('click'); await button(root, '追加观察并对账').fire('click');
  assert.ok(root.textContent.includes('差值（观察−预测）：1'));
  await button(root, '导出整个账本 JSON').fire('click');
  assert.equal(exported[0].copyOnly, true); assert.equal(exported[0].extension, 'json');
  assert.deepEqual(JSON.parse(exported[0].content).predictions.map((row) => row.value), [10, 12]);
  assert.deepEqual(JSON.parse(exported[0].content).observations.map((row) => row.comparison.difference), [3, 1]);
  handle.deactivate();
  assert.equal(stored.get('features.L004.state').schemaVersion, 1);
  const secondRoot = new NodeStub('div'); const restored = feature.create(secondRoot, { config });
  assert.ok(secondRoot.textContent.includes('已锁定预测 2 版 · 观察 2 条')); restored.destroy(); assert.equal(secondRoot.children.length, 0);
});

test('L004 UI：导出取消不清账本，缺少防覆盖能力不保存，成功导出后才新建', async (t) => {
  let saves = 0;
  dom(t, { saveText: async () => { saves += 1; return { ok: true }; } });
  const { default: feature } = await import('../src/renderer/features/L004/index.js');
  const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await button(root, '载入数值示例').fire('click'); await button(root, '提交并锁定预测').fire('click');
  await button(root, '导出成功后新建账本').fire('click'); assert.equal(saves, 0); assert.ok(root.textContent.includes('缺少防覆盖'));
  window.toolbox.files.saveTextSupportsCopyOnly = true;
  window.toolbox.files.saveText = async () => ({ ok: false, canceled: true });
  await button(root, '导出成功后新建账本').fire('click'); assert.ok(root.textContent.includes('已锁定预测 1 版'));
  window.toolbox.files.saveText = async () => ({ ok: true, path: 'new.json' });
  await button(root, '导出成功后新建账本').fire('click'); assert.ok(root.textContent.includes('已锁定预测 0 版'));
});

test('L004 UI：连续记录超64KiB拒写但可全量导出，拒恢复无版本状态', async (t) => {
  const stored = new Map(); const writes = []; const exported = [];
  dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true, path: 'large.json' }; } });
  const { default: feature } = await import('../src/renderer/features/L004/index.js');
  const config = { get: (key) => stored.get(key), set: async (key, value) => { writes.push(value); stored.set(key, value); } };
  const root = new NodeStub('div'); const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  for (let i = 0; i < 12; i += 1) {
    await fill(root, '预测主题', `<script>主题${i}</script>`); await fill(root, '数值预测', '10'); await fill(root, '预测依据（可选）', '汉'.repeat(2000));
    await button(root, '提交并锁定预测').fire('click');
  }
  assert.ok(root.textContent.includes('当前内容未写入配置')); assert.ok(root.textContent.includes('预测 p12 已锁定'));
  assert.ok(writes.every((state) => new TextEncoder().encode(JSON.stringify(state)).byteLength <= 65536));
  assert.ok(stored.get('features.L004.state').ledger.predictions.length < 12);
  const count = writes.length; handle.deactivate(); assert.equal(writes.length, count);
  await button(root, '导出整个账本 JSON').fire('click'); assert.equal(JSON.parse(exported[0].content).predictions.length, 12);
  assert.ok(new TextEncoder().encode(exported[0].content).byteLength > 65536);
  const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => ({ ledger: { predictions: [], observations: [] } }) } });
  assert.ok(invalidRoot.textContent.includes('版本不支持')); invalid.destroy();
});
