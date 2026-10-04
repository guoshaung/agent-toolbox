const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L021/model.mjs');
const fast = { yieldControl: async () => {} };
const core = 'contains-2-and-7';

test('L021 验收缩减[1,2,3,7,9]为[2,7]，完整逐元素1-minimal证据', async () => {
  const { reduceInput } = await model(); const result = await reduceInput('[1,2,3,7,9]', core, fast);
  assert.equal(result.status, 'completed'); assert.deepEqual(result.final, [2, 7]); assert.deepEqual(result.finalIndices, [1, 3]);
  assert.equal(result.initialFailing, true); assert.equal(result.finalFailing, true); assert.equal(result.attemptCount, 15);
  assert.equal(result.trace[result.failureEvidenceStep - 1].verdict, 'fail'); assert.equal(result.minimality.verified, true); assert.equal(result.minimality.globalMinimumClaimed, false);
  assert.deepEqual(result.minimality.checks.map((check) => [check.removedOriginalIndex, check.candidate, check.verdict]), [[1, [7], 'pass'], [3, [2], 'pass']]);
});

test('L021 已不可删除的输入不伪造缩减，重复验证记录均可检查', async () => {
  const { reduceInput } = await model(); const result = await reduceInput('[2,7]', core, fast);
  assert.deepEqual(result.final, [2, 7]); assert.equal(result.trace.filter((row) => row.accepted).length, 0); assert.equal(result.attemptCount, 5);
  assert.equal(result.minimality.verified, true); assert.equal(result.minimality.checks.length, 2);
});

test('L021 重复值按原始位置删除，保留两个2而不是按值一起删除', async () => {
  const { reduceInput } = await model(); const result = await reduceInput('[1,2,3,2,9]', 'duplicate', fast);
  assert.deepEqual(result.final, [2, 2]); assert.deepEqual(result.finalIndices, [1, 3]); assert.equal(result.minimality.verified, true);
  assert.deepEqual(result.minimality.checks.map((check) => check.removedOriginalIndex), [1, 3]); assert.ok(result.minimality.checks.every((check) => check.candidate.length === 1 && check.verdict === 'pass'));
  const zero = await reduceInput('[-0,0]', 'duplicate', fast); assert.equal(zero.status, 'completed'); assert.equal(zero.final.length, 2);
});

test('L021 空数组、初始通过明确拒绝，只记录初始判定', async () => {
  const { reduceInput } = await model();
  for (const source of ['[]', '[1,2,3]']) {
    const result = await reduceInput(source, core, fast); assert.equal(result.status, 'rejected'); assert.equal(result.initialFailing, false); assert.equal(result.trace.length, 1); assert.equal(result.trace[0].verdict, 'pass'); assert.equal(result.minimality.verified, false);
  }
});

test('L021 保持顺序的负数/正数谓词；单元素失败的空删除证据', async () => {
  const { reduceInput } = await model(); const ordered = await reduceInput('[0,-3,0,5,-1]', 'negative-before-positive', fast);
  assert.deepEqual(ordered.final, [-3, 5]); assert.deepEqual(ordered.finalIndices, [1, 3]); assert.ok(ordered.minimality.checks.every((row) => row.verdict === 'pass'));
  const singleton = await reduceInput('[9]', 'pair-or-single-9', fast); assert.deepEqual(singleton.final, [9]); assert.equal(singleton.trace.length, 2); assert.deepEqual(singleton.minimality.checks[0].candidate, []); assert.equal(singleton.minimality.verified, true);
});

test('L021 1-minimal不等于全局最小的客观反例', async () => {
  const { reduceInput, isFailing } = await model(); const result = await reduceInput('[2,7,1,9,3]', 'pair-or-single-9', fast);
  assert.deepEqual(result.final, [2, 7]); assert.equal(result.minimality.verified, true); assert.equal(isFailing([9], 'pair-or-single-9'), true); assert.equal(result.minimality.globalMinimumClaimed, false);
});

test('L021 多种重复位置组合，轨迹接受删除保持失败和原始子序列', async () => {
  const { reduceInput } = await model(); let seed = 21;
  const random = () => { seed = seed * 16807 % 2147483647; return seed % 10; };
  for (let sample = 0; sample < 30; sample += 1) {
    const input = [2, ...Array.from({ length: 15 }, random), 7]; const result = await reduceInput(JSON.stringify(input), core, fast); let kept = input.map((_, index) => index);
    for (const row of result.trace) {
      assert.deepEqual(row.candidate, row.keptIndices.map((index) => input[index]));
      assert.equal(row.verdict === 'fail', row.candidate.includes(2) && row.candidate.includes(7));
      if (row.phase === 'reduce') { assert.deepEqual(kept.filter((index) => !row.removedIndices.includes(index)), row.keptIndices); if (row.accepted) kept = [...row.keptIndices]; }
    }
    assert.equal(result.status, 'completed'); assert.equal(result.final.length, 2); assert.equal(result.minimality.checks.length, 2);
  }
});

test('L021 取消前0尝试、途中取消保留已知失败与未完成轨迹', async () => {
  const { reduceInput } = await model(); const before = new AbortController(); before.abort();
  const untouched = await reduceInput('[1,2,3,7,9]', core, { ...fast, signal: before.signal }); assert.equal(untouched.status, 'cancelled'); assert.equal(untouched.trace.length, 0); assert.equal(untouched.initialFailing, null);
  const during = new AbortController(); let yields = 0;
  const partial = await reduceInput('[1,2,3,7,9]', core, { signal: during.signal, onAttempt: (attempt) => { if (attempt.step === 3) during.abort(); }, yieldControl: async () => { yields += 1; } });
  assert.equal(partial.status, 'cancelled'); assert.equal(partial.trace.length, 3); assert.equal(yields, 3); assert.equal(partial.finalFailing, true); assert.equal(partial.minimality.verified, false);
});

test('L021 默认异步让出事件循环，回调副本不能改写算法状态', async () => {
  const { reduceInput } = await model(); let loopRan = false; const timer = setTimeout(() => { loopRan = true; }, 0);
  const result = await reduceInput('[1,2,3,7,9]', core, { onAttempt: (attempt, progress) => { if (attempt.step > 1) assert.equal(loopRan, true); attempt.candidate.length = 0; progress.final.length = 0; progress.minimality.checks.length = 0; } });
  clearTimeout(timer); assert.deepEqual(result.final, [2, 7]); assert.equal(result.trace[0].candidate.length, 5); assert.equal(result.minimality.verified, true);
});

test('L021 判定上限包含初始和证据，证据不完整不得标为1-minimal', async () => {
  const { reduceInput } = await model();
  for (const maxAttempts of [1, 3, 14]) { const result = await reduceInput('[1,2,3,7,9]', core, { ...fast, maxAttempts }); assert.equal(result.status, 'limit'); assert.equal(result.attemptCount, maxAttempts); assert.equal(result.minimality.verified, false); assert.equal(result.finalFailing, true); }
  const proofPartial = await reduceInput('[1,2,3,7,9]', core, { ...fast, maxAttempts: 14 }); assert.equal(proofPartial.minimality.checks.length, 1);
  assert.equal((await reduceInput('[1,2,3,7,9]', core, { ...fast, maxAttempts: 15 })).status, 'completed');
  for (const maxAttempts of [0, 1025, 1.1, '10']) await assert.rejects(() => reduceInput('[2,7]', core, { ...fast, maxAttempts }), /上限/);
});

test('L021 仅整数JSON数组和内置谓词，拒执行字符串、嵌套、超限与损坏输入', async () => {
  const { parseInput, reduceInput } = await model();
  for (const source of ['', '{}', '[true]', '[null]', '[1.5]', '[[2],7]', '["2",7]', '[9007199254740992]', '[(()=>{throw 1})()]']) assert.throws(() => parseInput(source));
  assert.equal(parseInput(JSON.stringify(Array(128).fill(2))).length, 128); assert.throws(() => parseInput(JSON.stringify(Array(129).fill(2))), /128/); assert.throws(() => parseInput(' '.repeat(8001)), /8000/);
  await assert.rejects(() => reduceInput('[2,7]', '() => true', fast), /内置/);
});

test('L021 版本与64KiB UTF8边界；报告含每次候选、删除位置、未完成声明', async () => {
  const { prepareStoredState, validateStoredState, reduceInput, reportMarkdown } = await model();
  const overhead = new TextEncoder().encode(JSON.stringify({ source: '', schemaVersion: 1 })).byteLength; const exact = prepareStoredState({ source: 'a'.repeat(65536 - overhead) });
  assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 65536); assert.equal(validateStoredState(exact), exact); assert.throws(() => prepareStoredState({ source: exact.source + 'a' }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 1, source: '汉'.repeat(22000) }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/);
  const completed = reportMarkdown(await reduceInput('[1,2,3,7,9]', core, fast)); assert.match(completed, /当前数组：\[2,7\]/); assert.match(completed, /1-minimal已验证：是/); assert.match(completed, /全局最小声明：否/); assert.match(completed, /删除原始位置1（值2）/);
  const partial = reportMarkdown(await reduceInput('[2,7]', core, { ...fast, maxAttempts: 1 })); assert.match(partial, /状态：limit/); assert.match(partial, /1-minimal已验证：否/);
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
const findButton = (root, label) => walk(root).find((item) => item.tagName === 'button' && item.textContent === label);
const button = (root, label) => { const node = findButton(root, label); assert.ok(node, label); return node; };
const control = (root, label) => { const node = walk(root).find((item) => item.attributes['aria-label'] === label); assert.ok(node, label); return node; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function fill(root, label, value) { const node = control(root, label); node.value = value; await node.fire(node.tagName === 'select' ? 'change' : 'input'); }
async function manualRun(root) { await fill(root, '执行方式', 'step'); const run = button(root, '开始缩减').fire('click'); await tick(); for (let i = 0; i < 1025 && findButton(root, '继续一步'); i += 1) { await button(root, '继续一步').fire('click'); await tick(); } await run; }
function dom(t, files) { const oldDocument = global.document; const oldWindow = global.window; global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) }; global.window = { toolbox: { files } }; t.after(() => { global.document = oldDocument; global.window = oldWindow; }); }

test('L021 界面手动步骤、候选/证据浏览、双格式导出和仅草稿恢复', async (t) => {
  const exported = []; const stored = new Map(); dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } });
  const { default: feature } = await import('../src/renderer/features/L021/index.js'); const root = new NodeStub('div'); const config = { get: (key) => stored.get(key), set: (key, value) => stored.set(key, value) }; const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await manualRun(root); assert.match(root.textContent, /已完成 · 尝试 15\/1024/); assert.match(root.textContent, /当前保留数组：\[2,7\]/); assert.match(root.textContent, /1-minimal已验证/); assert.match(root.textContent, /删除原位1的值2 → \[7\] → pass/);
  await control(root, '查看尝试1').fire('click'); assert.match(root.textContent, /候选：\[1,2,3,7,9\]/);
  await button(root, '导出完整 JSON').fire('click'); const payload = JSON.parse(exported[0].content); assert.equal(payload.result.trace.length, 15); assert.equal(payload.result.minimality.verified, true); assert.equal(exported[0].copyOnly, true);
  await button(root, '导出缩减 Markdown').fire('click'); assert.equal(exported[1].extension, 'md'); assert.match(exported[1].content, /删除原始位置1/);
  handle.deactivate(); assert.equal(stored.get('features.L021.state').schemaVersion, 1); assert.equal(Object.hasOwn(stored.get('features.L021.state'), 'trace'), false);
  const restoredRoot = new NodeStub('div'); const restored = feature.create(restoredRoot, { config }); assert.match(restoredRoot.textContent, /已恢复草稿/); assert.equal(findButton(restoredRoot, '导出缩减 Markdown'), undefined); assert.equal(control(restoredRoot, '输入JSON整数数组').value, '[1,2,3,7,9]'); restored.destroy();
});

test('L021 界面自动/手动取消、切走和销毁立即释放等待，部分导出不声称证明', async (t) => {
  const exported = []; dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L021/index.js');
  for (const action of ['cancel-auto', 'deactivate', 'destroy']) {
    const root = new NodeStub('div'); const handle = feature.create(root); if (action !== 'cancel-auto') await fill(root, '执行方式', 'step');
    const pending = button(root, '开始缩减').fire('click'); assert.equal(control(root, '输入JSON整数数组').disabled, true);
    if (action === 'cancel-auto') await button(root, '取消缩减').fire('click'); else if (action === 'deactivate') handle.deactivate(); else handle.destroy();
    await pending;
    if (action === 'destroy') assert.equal(root.children.length, 0);
    else { assert.match(root.textContent, /已取消 · 尝试 1\/1024/); await button(root, '导出完整 JSON').fire('click'); const partial = JSON.parse(exported.at(-1).content).result; assert.equal(partial.status, 'cancelled'); assert.equal(partial.minimality.verified, false); assert.equal(partial.trace.length, 1); handle.destroy(); }
  }
});

test('L021 界面上限/空输入/文本安全/导出能力与配置边界', async (t) => {
  let writes = 0; let saves = 0; dom(t, { saveText: async () => { saves += 1; return { ok: false, canceled: true }; } }); const { default: feature } = await import('../src/renderer/features/L021/index.js'); const root = new NodeStub('div'); const handle = feature.create(root, { config: { get: () => null, set: () => { writes += 1; } } }); t.after(() => handle.destroy());
  await fill(root, '尝试上限', '1'); await manualRun(root); assert.match(root.textContent, /达到上限 · 尝试 1\/1/); assert.match(root.textContent, /1-minimal尚未验证/);
  await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 0); assert.match(root.textContent, /缺少防覆盖/); window.toolbox.files.saveTextSupportsCopyOnly = true; await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 1); assert.match(root.textContent, /已取消导出/);
  await fill(root, '输入JSON整数数组', '[]'); await manualRun(root); assert.match(root.textContent, /起始输入通过/); assert.match(root.textContent, /1-minimal尚未验证/);
  await fill(root, '输入JSON整数数组', '["<img src=x onerror=alert(1)>"]'); await button(root, '开始缩减').fire('click'); assert.match(root.textContent, /不接受嵌套、字符串/);
  await fill(root, '输入JSON整数数组', '汉'.repeat(22000)); const count = writes; handle.deactivate(); assert.equal(writes, count); assert.match(root.textContent, /当前输入未写入全局配置/);
  for (const saved of [{ schemaVersion: 2 }, { schemaVersion: 1, source: '汉'.repeat(22000) }, { schemaVersion: 1, predicateId: 'custom-code' }]) { const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => saved } }); assert.match(invalidRoot.textContent, /未能恢复/); invalid.destroy(); }
});
