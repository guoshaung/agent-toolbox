export const MODEL_VERSION = 'L028-key-value-v1';
export const POLICY = '有限DSL模拟：每项测试独跑从{}开始；共享顺序和每对A→B共享状态。断言失败记录后继续，包括后续delete/reset，失败不改变状态。来源仅记录状态修改者，差异不是自动因果结论；不运行真实框架或用户代码。';
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = text => new TextEncoder().encode(text).length;
const ID = /^[A-Za-z][A-Za-z0-9_]{0,11}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const owns = (object, key) => Object.hasOwn(object, key);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function identifier(value, label) { if (typeof value !== 'string' || !ID.test(value) || forbidden.has(value)) throw new Error(`${label}须1–12位ASCII字母开头的字母/数字/_，禁止原型字段`); return value; }
export function example(kind = 'default') {
  if (kind === 'cleanup') return { order: 'A B', tests: [{ id: 'A', operations: 'set x 1\nassertEqual x 2\ndelete x' }, { id: 'B', operations: 'assertMissing x' }] };
  if (kind === 'ownbug') return { order: 'A B', tests: [{ id: 'A', operations: 'set x 1' }, { id: 'B', operations: 'assertEqual x 2' }] };
  if (kind === 'overwrite') return { order: 'A C B', tests: [{ id: 'A', operations: 'set x 1' }, { id: 'C', operations: 'set x 2' }, { id: 'B', operations: 'assertMissing x' }] };
  return { order: 'A B', tests: [{ id: 'A', operations: 'set x 1' }, { id: 'B', operations: 'assertMissing x' }] };
}
function scalar(text) {
  if (typeof text !== 'string' || bytes(text) > 512) throw new Error('标量文本越界');
  if (text === 'true') return true; if (text === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)$/.test(text)) { const value = Number(text); if (!Number.isSafeInteger(value) || Math.abs(value) > 1e9) throw new Error('整数绝对值须≤10亿'); return value; }
  if (text.startsWith('"')) {
    let value; try { value = JSON.parse(text); } catch { throw new Error('字符串须为有效JSON双引号字面量'); }
    if (typeof value !== 'string' || [...value].length > 64 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('字符串须≤64 Unicode码点，禁止孤立代理项');
    return value;
  }
  throw new Error('值仅允许整数、true/false、JSON双引号字符串；拒绝null/数组/对象/代码');
}
export function parse(draft) {
  if (!Array.isArray(draft?.tests) || draft.tests.length < 2 || draft.tests.length > 6) throw new Error('测试数量须2–6');
  const ids = new Set();
  const tests = draft.tests.map((test, index) => {
    const id = identifier(test?.id, `测试${index + 1}ID`); if (ids.has(id)) throw new Error(`重复测试ID：${id}`); ids.add(id);
    if (typeof test.operations !== 'string' || bytes(test.operations) > 2048) throw new Error(`测试${id}操作文本须≤2048 UTF-8字节`);
    const lines = test.operations.trim().split(/\r?\n/); if (!test.operations.trim() || lines.length > 8 || lines.some(line => !line.trim())) throw new Error(`测试${id}须1–8条操作，不能有空行`);
    const operations = lines.map((line, i) => {
      const text = line.trim(); if (text === 'reset') return { op: 'reset', text };
      const match = /^(set|delete|assertMissing|assertEqual)\s+(\S+)(?:[ \t]+(.*))?$/.exec(text);
      if (!match) throw new Error(`测试${id}第${i + 1}行未知操作，仅set/delete/assertMissing/assertEqual/reset`);
      const [, op, key, argument] = match; identifier(key, '状态key');
      if (op === 'delete' || op === 'assertMissing') { if (argument !== undefined) throw new Error(`${op}只允许一个key`); return { op, key, text }; }
      if (argument === undefined || !argument.length) throw new Error(`${op}需要标量值`);
      return { op, key, value: scalar(argument), text };
    });
    return { id, operations };
  });
  if (typeof draft.order !== 'string' || bytes(draft.order) > 128) throw new Error('顺序须≤128字节文本');
  const order = draft.order.trim().split(/[\s,]+/); order.forEach(id => identifier(id, '顺序ID'));
  if (new Set(order).size !== order.length) throw new Error('顺序含重复ID，每测试必须恰好一次');
  if (order.some(id => !ids.has(id))) throw new Error('顺序引用未知测试ID');
  if (order.length !== tests.length) throw new Error('顺序必须包含全部测试，每测试恰好一次');
  return { tests, order };
}
export function observed(state, key) { return owns(state, key) ? { exists: true, value: state[key] } : { exists: false }; }
export function difference(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key => { const from = observed(before, key), to = observed(after, key); return same(from, to) ? [] : [{ key, before: from, after: to }]; });
}
function context() { return { state: {}, origins: {}, runStep: 0 }; }
function execute(test, shared) {
  const initial = clone(shared.state), trace = [];
  test.operations.forEach((instruction, index) => {
    const before = clone(shared.state), key = instruction.key;
    const at = { test: test.id, step: index + 1, runStep: ++shared.runStep, operation: instruction.text };
    const source = key && owns(shared.origins, key) ? clone(shared.origins[key]) : null;
    let assertion = null;
    if (instruction.op === 'set') {
      const first = owns(shared.state, key) ? shared.origins[key]?.first ?? at : at;
      shared.state[key] = instruction.value; shared.origins[key] = { first: clone(first), last: at };
    } else if (instruction.op === 'delete') {
      delete shared.state[key]; shared.origins[key] = { first: at, last: at };
    } else if (instruction.op === 'reset') {
      for (const existing of Object.keys(shared.state)) { delete shared.state[existing]; shared.origins[existing] = { first: at, last: at }; }
    } else {
      const actual = observed(shared.state, key);
      const passed = instruction.op === 'assertMissing' ? !actual.exists : actual.exists && typeof actual.value === typeof instruction.value && actual.value === instruction.value;
      assertion = { key, expected: instruction.op === 'assertMissing' ? { exists: false } : { exists: true, value: instruction.value }, actual, passed };
    }
    trace.push({ step: index + 1, runStep: at.runStep, instruction: instruction.text, op: instruction.op, key: key ?? null, before, after: clone(shared.state), changes: difference(before, shared.state), assertion, source });
  });
  return { id: test.id, initial, final: clone(shared.state), finalOrigins: clone(shared.origins), passed: trace.every(row => row.assertion?.passed !== false), failedAssertions: trace.filter(row => row.assertion?.passed === false).length, trace };
}
function compare(run, baseline) {
  const differences = [], introduced = [];
  run.trace.forEach((row, index) => {
    const isolated = baseline.trace[index]; row.baselineBefore = clone(isolated.before); row.baselineAssertion = clone(isolated.assertion); row.inheritedDiff = difference(isolated.before, row.before);
    if (row.assertion && !same(row.assertion.actual, isolated.assertion.actual)) {
      const delta = { step: row.step, runStep: row.runStep, key: row.key, isolated: clone(isolated.assertion), shared: clone(row.assertion), source: clone(row.source), introducedFailure: isolated.assertion.passed && !row.assertion.passed };
      differences.push(delta); if (delta.introducedFailure) introduced.push(delta);
    }
  });
  return { ...run, isolatedPassed: baseline.passed, classification: baseline.passed ? run.passed ? '独跑与共享均通过' : '独跑通过→共享失败' : run.passed ? '独跑失败→共享通过（失败被掩盖）' : '独跑已有失败（不能直接归因污染）', initialDiff: difference({}, run.initial), assertionDifferences: differences, introducedFailures: introduced, earliestIntroducedFailure: introduced[0] ?? null };
}
export function analyze(draft) {
  const program = parse(draft), byId = Object.fromEntries(program.tests.map(test => [test.id, test]));
  const isolated = program.tests.map(test => execute(test, context())), baseline = Object.fromEntries(isolated.map(run => [run.id, run]));
  const sharedContext = context(), shared = program.order.map(id => compare(execute(byId[id], sharedContext), baseline[id]));
  const pairs = program.tests.flatMap(first => program.tests.filter(second => second.id !== first.id).map(second => { const pairContext = context(), source = execute(first, pairContext), target = compare(execute(second, pairContext), baseline[second.id]); return { from: first.id, to: second.id, source, target }; }));
  const earliest = shared.find(run => run.earliestIntroducedFailure);
  return { modelVersion: MODEL_VERSION, input: clone(draft), program, isolated, shared, pairs, final: clone(sharedContext.state), summary: { tests: program.tests.length, pairs: pairs.length, isolatedFailed: isolated.filter(run => !run.passed).length, sharedFailed: shared.filter(run => !run.passed).length, newlyFailingTests: shared.filter(run => run.isolatedPassed && !run.passed).length, introducedAssertions: shared.reduce((n, run) => n + run.introducedFailures.length, 0) }, earliestDifferenceFailure: earliest ? { test: earliest.id, ...clone(earliest.earliestIntroducedFailure) } : null, sourceScope: '首次来源是键最近缺失后首次set，最近修改是最后一次set/delete/reset的test/step；覆盖值不重置首次来源。最早差异失败按共享顺序/步骤选择，不是穷举因果最小污染源。' };
}
export function prepareStoredState(draft) {
  const raw = { schemaVersion: 1, ...draft }; if (bytes(JSON.stringify(raw)) > 65536) throw new Error('草稿超过64KiB UTF-8，不写配置；请导出完整JSON');
  if (typeof draft?.order !== 'string' || bytes(draft.order) > 128 || !Array.isArray(draft.tests) || draft.tests.length < 2 || draft.tests.length > 6) throw new Error('草稿顺序/测试数量无效');
  const tests = draft.tests.map(test => { if (typeof test?.id !== 'string' || test.id.length > 32 || typeof test.operations !== 'string' || bytes(test.operations) > 2048) throw new Error('草稿ID≤32字符/操作文本≤2048字节'); return { id: test.id, operations: test.operations }; });
  return { schemaVersion: 1, order: draft.order, tests };
}
export function validateStoredState(raw) { if (bytes(JSON.stringify(raw)) > 65536) throw new Error('草稿超过64KiB UTF-8'); if (raw?.schemaVersion !== 1) throw new Error('草稿版本不支持'); return prepareStoredState(raw); }
export function reportMarkdown(payload) {
  const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const block = value => { const text = escape(typeof value === 'string' ? value : JSON.stringify(value, null, 2)); const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1))); return `${fence}json\n${text}\n${fence}`; };
  return ['# L028 测试污染定位', POLICY, '## 完整草稿', block(payload.draft), payload.result ? '## 完整隔离/共享/有向矩阵与逐步轨迹' : '尚无有效结果，需重新分析', payload.result ? block(payload.result) : '', '## 边界', '有限DSL不执行真实框架；独跑失败不等于污染，差异及来源是模型内关联证据，不自动判断因果。结果不写入配置，导出保留全部模拟。'].join('\n\n');
}
