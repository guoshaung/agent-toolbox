export const MODEL_VERSION = 'L018-single-key-v1';
export const FIELDS = ['initial', 't1', 't2'];
export const POLICY = '单键k、两个事务；每条指令原子执行。同一调度同步作用于RC和RR。RC每次READ取当前已提交值；RR在BEGIN建立快照。两者均优先读取自己的暂存写，忽略他人的未提交写。COMMIT原子发布，后提交覆盖前提交（教学简化，无锁/冲突中止）；ROLLBACK丢弃暂存写。无效状态指令消耗一步但不改变数据。每事务最多24条，总共最多48步。';
const clone = (value) => JSON.parse(JSON.stringify(value));
const bytes = (value) => new TextEncoder().encode(value).byteLength;
function integer(text, label) {
  if (typeof text !== 'string' || !/^-?\d+$/.test(text.trim())) throw new Error(`${label}须为十进制整数`);
  const n = Number(text); if (!Number.isSafeInteger(n) || Math.abs(n) > 1000000) throw new Error(`${label}范围为−1000000到1000000`); return n;
}
export function example(kind = 'nonrepeatable') {
  if (kind === 'own') return { initial: '10', t1: 'BEGIN\nREAD\nWRITE 15\nREAD\nROLLBACK', t2: 'BEGIN\nREAD\nCOMMIT' };
  if (kind === 'writes') return { initial: '0', t1: 'BEGIN\nWRITE 10\nCOMMIT', t2: 'BEGIN\nWRITE 20\nCOMMIT' };
  return { initial: '10', t1: 'BEGIN\nREAD\nREAD\nCOMMIT', t2: 'BEGIN\nWRITE 20\nCOMMIT' };
}
export function parseScript(text, label) {
  if (typeof text !== 'string' || bytes(text) > 4096) throw new Error(`${label}脚本须为≤4096字节文本`);
  const lines = text.trim().split(/\r?\n/); if (!text.trim() || lines.length > 24) throw new Error(`${label}须有1–24条指令，不允许空行`);
  return lines.map((line, index) => {
    const command = line.trim(); if (/^(BEGIN|READ|COMMIT|ROLLBACK)$/.test(command)) return { op: command, text: command };
    const match = /^WRITE\s+(-?\d+)$/.exec(command); if (match) return { op: 'WRITE', value: integer(match[1], `${label}第${index + 1}条WRITE`), text: command };
    throw new Error(`${label}第${index + 1}条不合法：仅BEGIN/READ/WRITE 整数/COMMIT/ROLLBACK，区分大小写`);
  });
}
function transaction() { return { status: 'idle', snapshot: null, beginVersion: null, pending: null, hasWrite: false, writes: 0, reads: [] }; }
function strategy(initial) { return { committed: initial, version: 0, transactions: { T1: transaction(), T2: transaction() }, commits: [], anomalies: [] }; }
export function createSimulation(draft) {
  if (!draft || typeof draft !== 'object') throw new Error('缺少输入');
  const initial = integer(draft.initial, '初始值'); const scripts = { T1: parseScript(draft.t1, 'T1'), T2: parseScript(draft.t2, 'T2') };
  return { modelVersion: MODEL_VERSION, input: clone(draft), initial, scripts, pc: { T1: 0, T2: 0 }, schedule: [], steps: [], RC: strategy(initial), RR: strategy(initial) };
}
export function visibleValue(state, policy, id) {
  const tx = state.transactions[id]; if (!tx) throw new Error('未知事务');
  if (tx.status !== 'active') return { value: null, source: '事务未激活，无可读值' };
  if (tx.hasWrite) return { value: tx.pending, source: '自己的未提交写' };
  return policy === 'RR' ? { value: tx.snapshot, source: 'BEGIN快照' } : { value: state.committed, source: '当前已提交值' };
}
function execute(state, policy, id, instruction, step) {
  const tx = state.transactions[id]; const op = instruction.op;
  if (op === 'BEGIN') {
    if (tx.status !== 'idle') return { ok: false, reason: `BEGIN无效：状态${tx.status}，每个事务只允许一次BEGIN` };
    tx.status = 'active'; tx.snapshot = state.committed; tx.beginVersion = state.version;
    return { ok: true, reason: policy === 'RR' ? `BEGIN建立快照${tx.snapshot}（版本${state.version}）` : `BEGIN；RC在每次READ读取已提交值` };
  }
  if (tx.status !== 'active') return { ok: false, reason: `${op}无效：事务状态${tx.status}，需要active` };
  if (op === 'READ') {
    const read = { step, ...visibleValue(state, policy, id), writes: tx.writes, committedVersion: state.version }; const previous = tx.reads.at(-1);
    const anomaly = previous && previous.writes === 0 && read.writes === 0 && previous.value !== read.value;
    tx.reads.push(read);
    if (anomaly) state.anomalies.push({ type: '非重复读', transaction: id, firstStep: previous.step, secondStep: step, firstValue: previous.value, secondValue: read.value });
    return { ok: true, value: read.value, source: read.source, reason: `READ得到${read.value}，来源：${read.source}${anomaly ? '；发现非重复读' : ''}` };
  }
  if (op === 'WRITE') { tx.pending = instruction.value; tx.hasWrite = true; tx.writes++; return { ok: true, reason: `暂存WRITE ${tx.pending}；他人仍不可见` }; }
  if (op === 'ROLLBACK') { tx.status = 'rolledback'; tx.pending = null; tx.hasWrite = false; return { ok: true, reason: 'ROLLBACK丢弃自己的暂存写；已提交值不变' }; }
  const before = state.committed; const overwritten = tx.hasWrite && state.version !== tx.beginVersion;
  if (tx.hasWrite) { state.committed = tx.pending; state.version++; }
  state.commits.push({ step, transaction: id, wrote: tx.hasWrite, before, after: state.committed, version: state.version, overwritten });
  tx.status = 'committed'; tx.pending = null; tx.hasWrite = false;
  return { ok: true, reason: `COMMIT${state.committed === before ? '；已提交值保持' : `：${before}→${state.committed}`}${overwritten ? '；覆盖提示：BEGIN后有他人提交，按教学规则后提交覆盖前值' : ''}`, overwritten };
}
export function stepSimulation(simulation, id) {
  if (!['T1', 'T2'].includes(id)) throw new Error('请选择T1或T2');
  if (simulation.steps.length >= 48) throw new Error('达到48步上限，拒绝继续，未截断为完成');
  if (simulation.pc[id] >= simulation.scripts[id].length) throw new Error(`${id}没有剩余指令`);
  const next = clone(simulation); const instruction = next.scripts[id][next.pc[id]]; const step = next.steps.length + 1;
  const before = { RC: clone(next.RC), RR: clone(next.RR) }; const outcomes = {};
  for (const policy of ['RC', 'RR']) outcomes[policy] = execute(next[policy], policy, id, instruction, step);
  next.pc[id]++; next.schedule.push(id); next.steps.push({ step, transaction: id, instruction: instruction.text, outcomes, before, after: { RC: clone(next.RC), RR: clone(next.RR) } }); return next;
}
export function prepareStoredState(draft) {
  const state = { schemaVersion: 1 }; for (const field of FIELDS) { if (typeof draft?.[field] !== 'string') throw new Error('草稿字段类型不合法'); state[field] = draft[field]; }
  if (bytes(JSON.stringify(state)) > 65536) throw new Error('草稿超过64KiB UTF-8限制');
  for (const field of ['t1', 't2']) if (bytes(state[field]) > 4096) throw new Error('草稿脚本超过4096字节'); return state;
}
export function validateStoredState(raw) {
  if (bytes(JSON.stringify(raw)) > 65536) throw new Error('草稿超过64KiB UTF-8限制');
  if (raw?.schemaVersion !== 1) throw new Error('草稿版本不支持'); return prepareStoredState(raw);
}
const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function reportMarkdown(payload) {
  const sections = ['# L018 事务隔离沙盘', POLICY, '## 完整输入', `\`\`\`json\n${escape(JSON.stringify(payload.draft, null, 2))}\n\`\`\``];
  if (!payload.result) sections.push('尚未开始有效重放；无结果。');
  else { const result = payload.result; sections.push('## 调度与结果', `原始已提交值：${result.initial}；当前RC：${result.RC.committed}；RR：${result.RR.committed}。`, `调度：${result.schedule.join(' → ') || '尚无步骤'}`);
    for (const row of result.steps) sections.push(`### 步骤${row.step} ${row.transaction} ${row.instruction}`, `RC：${escape(row.outcomes.RC.reason)}；RR：${escape(row.outcomes.RR.reason)}`, `\`\`\`json\n${escape(JSON.stringify({ before: row.before, after: row.after }, null, 2))}\n\`\`\``);
    sections.push('## 完整模型记录', `\`\`\`json\n${escape(JSON.stringify(result, null, 2))}\n\`\`\``);
  }
  sections.push('## 范围', '只比较单键可见性；不模拟SQL/MVCC/数据库锁或真实并发。RR采用BEGIN快照，写提交采用后提交覆盖，均为明确教学简化。草稿可恢复，调度/结果仅在本次页面或导出文件中保留。', '概念来源：https://www.postgresql.org/docs/current/transaction-iso.html'); return sections.join('\n\n');
}
