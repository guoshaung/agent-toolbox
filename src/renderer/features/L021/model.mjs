export const MODEL_VERSION = 'array-ddmin-v1';
export const MAX_ITEMS = 128;
export const MAX_ATTEMPTS = 1024;
export const PREDICATES = [
  { id: 'contains-2-and-7', name: '同时包含2和7', rule: '数值2和7都存在则失败，否则通过。', example: '[1,2,3,7,9]' },
  { id: 'duplicate', name: '存在重复整数', rule: '任意整数出现至少两次则失败；按值比较，0与-0相同。', example: '[1,2,3,2,9]' },
  { id: 'negative-before-positive', name: '负数出现在正数之前', rule: '存在一对有序位置：前值<0且后值>0则失败；0不参与。', example: '[0,-3,0,5,-1]' },
  { id: 'pair-or-single-9', name: '含2和7，或唯一元素是9', rule: '同时含2和7，或数组恰好是[9]则失败。用于说明1-minimal不等于全局最小。', example: '[2,7,1,9,3]' },
];
export function getPredicate(id) { const predicate = PREDICATES.find((item) => item.id === id); if (!predicate) throw new Error('只能选择列表中的内置确定性谓词。'); return predicate; }
export function parseInput(source) {
  if (typeof source !== 'string' || source.length > 8000) throw new Error('请输入不超过8000字符的JSON数组。');
  let array; try { array = JSON.parse(source); } catch { throw new Error('输入不是有效JSON，请使用如[1,2,3,7,9]的数组。'); }
  if (!Array.isArray(array) || array.length > MAX_ITEMS || !array.every((value) => Number.isSafeInteger(value))) throw new Error(`首版只接受0至${MAX_ITEMS}个安全整数的JSON数组，不接受嵌套、字符串或小数。`);
  return array;
}
export function isFailing(array, predicateId) {
  getPredicate(predicateId);
  switch (predicateId) {
    case 'contains-2-and-7': return array.includes(2) && array.includes(7);
    case 'duplicate': return new Set(array).size !== array.length;
    case 'negative-before-positive': { let negative = false; for (const value of array) { if (value > 0 && negative) return true; if (value < 0) negative = true; } return false; }
    case 'pair-or-single-9': return (array.includes(2) && array.includes(7)) || (array.length === 1 && array[0] === 9);
    default: throw new Error('未知内置谓词。');
  }
}
const copy = (value) => JSON.parse(JSON.stringify(value));
function createRunner(source, predicateId, maxAttempts) {
  const initial = parseInput(source); const predicate = getPredicate(predicateId);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) throw new Error(`尝试上限需为1至${MAX_ATTEMPTS}的整数。`);
  let current = initial.map((value, originalIndex) => ({ value, originalIndex }));
  const trace = []; const proof = []; let initialFailing = null; let failureEvidenceStep = null;
  const snapshot = (status, message, includeTrace = true) => ({ feature: 'L021', schemaVersion: 1, modelVersion: MODEL_VERSION, predicate: { ...predicate }, source, initial: [...initial], final: current.map((entry) => entry.value), finalIndices: current.map((entry) => entry.originalIndex), initialFailing, finalFailing: failureEvidenceStep !== null, failureEvidenceStep, status, message, attemptCount: trace.length, maxAttempts, ...(includeTrace ? { trace: copy(trace) } : {}), minimality: { kind: '1-minimal', verified: status === 'completed' && initialFailing === true && proof.length === current.length && proof.every((check) => check.verdict === 'pass'), globalMinimumClaimed: false, checks: copy(proof) } });
  function attempt(candidate, phase, removedIndices, granularity = null) {
    if (trace.length >= maxAttempts) return null;
    const failing = isFailing(candidate.map((entry) => entry.value), predicateId);
    const record = { step: trace.length + 1, phase, candidate: candidate.map((entry) => entry.value), keptIndices: candidate.map((entry) => entry.originalIndex), removedIndices: [...removedIndices], granularity, verdict: failing ? 'fail' : 'pass', accepted: phase === 'reduce' && failing, reason: phase === 'initial' ? '检查起始数组是否确实失败' : phase === 'verify' ? '只删除一个剩余位置，验证其是否必要' : failing ? '删除后仍失败，接受该候选' : '删除后通过，拒绝该候选并保留当前数组' };
    trace.push(record);
    if (phase === 'initial') { initialFailing = failing; if (failing) failureEvidenceStep = record.step; }
    if (record.accepted) { current = candidate; failureEvidenceStep = record.step; }
    if (phase === 'verify') proof.push({ removedOriginalIndex: removedIndices[0], removedValue: current.find((entry) => entry.originalIndex === removedIndices[0]).value, candidate: [...record.candidate], verdict: record.verdict, traceStep: record.step });
    return record;
  }
  function* steps() {
    const first = attempt(current, 'initial', []); yield first;
    if (!initialFailing) return snapshot('rejected', '起始数组通过，不能作为失败输入缩减；请更换数组或谓词。');
    let granularity = 2;
    while (current.length >= 2) {
      const chunkSize = Math.ceil(current.length / granularity); let reduced = false;
      for (let start = 0; start < current.length; start += chunkSize) {
        const removed = current.slice(start, start + chunkSize); const candidate = current.slice(0, start).concat(current.slice(start + chunkSize));
        const record = attempt(candidate, 'reduce', removed.map((entry) => entry.originalIndex), granularity);
        if (!record) return snapshot('limit', '已达尝试上限；保留当前已知失败数组，但没有完成1-minimal验证。');
        yield record;
        if (record.accepted) { granularity = Math.max(2, granularity - 1); reduced = true; break; }
      }
      if (reduced) continue;
      if (granularity >= current.length) break;
      granularity = Math.min(current.length, granularity * 2);
    }
    for (let index = 0; index < current.length; index += 1) {
      const candidate = current.filter((_, position) => position !== index);
      const record = attempt(candidate, 'verify', [current[index].originalIndex]);
      if (!record) return snapshot('limit', '已达尝试上限；逐元素删除证据不完整，不能宣称1-minimal。');
      yield record;
      if (record.verdict === 'fail') return snapshot('unverified', '逐元素删除仍失败，1-minimal验证未通过。');
    }
    return snapshot('completed', '已验证最终数组仍失败，且删除任一剩余位置均通过：1-minimal；没有证明全局最小。');
  }
  return { steps: steps(), snapshot };
}
function yieldToLoop(signal) {
  return new Promise((resolve) => {
    let timer;
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    timer = setTimeout(done, 0); signal?.addEventListener('abort', done, { once: true });
    if (signal?.aborted) done();
  });
}
export async function reduceInput(source, predicateId, { signal, onAttempt, yieldControl = () => yieldToLoop(signal), maxAttempts = MAX_ATTEMPTS } = {}) {
  const runner = createRunner(source, predicateId, maxAttempts);
  while (true) {
    if (signal?.aborted) { runner.steps.return(); return runner.snapshot('cancelled', '已取消；保留已尝试轨迹，没有完成1-minimal验证。'); }
    const next = runner.steps.next();
    if (next.done) return next.value;
    if (onAttempt) onAttempt(copy(next.value), runner.snapshot('running', '缩减中；完成逐元素验证前不能宣称1-minimal。', false));
    await yieldControl();
  }
}
export function prepareStoredState(state) {
  const serialized = JSON.stringify({ ...state, schemaVersion: 1 });
  if (new TextEncoder().encode(serialized).byteLength > 65536) throw new Error('草稿超过64KiB保存上限。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('草稿版本不支持，需要schemaVersion:1。');
  prepareStoredState(state); return state;
}
export function reportMarkdown(result) {
  const lines = ['# 失败输入缩减器', '', `schemaVersion:1；模型：${MODEL_VERSION}；状态：${result.status}`, '', `谓词：${result.predicate.name}。${result.predicate.rule}`, '', `原数组：${JSON.stringify(result.initial)}`, `当前数组：${JSON.stringify(result.final)}`, `原始位置（0开始）：${JSON.stringify(result.finalIndices)}`, `尝试次数：${result.attemptCount}/${result.maxAttempts}`, '', result.message, '', '## 每次尝试', '', '| 序号 | 阶段 | 删除原始位置 | 候选数组 | 判定 | 接受 |', '|---|---|---|---|---|---|'];
  for (const row of result.trace) lines.push(`| ${row.step} | ${row.phase} | ${JSON.stringify(row.removedIndices)} | ${JSON.stringify(row.candidate)} | ${row.verdict} | ${row.accepted ? '是' : '否'} |`);
  lines.push('', '## 逐元素删除证据', '', `1-minimal已验证：${result.minimality.verified ? '是' : '否'}；全局最小声明：否。`, '', `当前数组失败证据来自尝试${result.failureEvidenceStep ?? '无'}；初始失败：${String(result.initialFailing)}。`);
  for (const check of result.minimality.checks) lines.push(`- 删除原始位置${check.removedOriginalIndex}（值${check.removedValue}）：${JSON.stringify(check.candidate)} → ${check.verdict}；尝试${check.traceStep}`);
  return lines.join('\n') + '\n';
}
