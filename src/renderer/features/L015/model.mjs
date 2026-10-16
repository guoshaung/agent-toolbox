export const MODEL_VERSION = '1.0';
export const MAX_INSTRUCTIONS = 16;
export const MAX_STEPS = 128;
export const OPS = ['READ', 'WRITE', 'LOCK', 'UNLOCK'];
export const RULES = '两个固定线程T1/T2、一个共享计数器、每线程一个本地寄存器R、一个非重入互斥锁。READ把共享值读到R；WRITE把R+1写到共享值，不改变R；LOCK仅在锁空闲时取得所有权；UNLOCK只能由所有者执行。锁只阻塞LOCK，不自动阻止不持锁的READ/WRITE。';
export function parseDraft(draft) {
  if (!draft || typeof draft.initial !== 'string' || !/^-?\d+$/.test(draft.initial.trim())) throw new Error('初始计数器须为十进制整数。');
  const initial = Number(draft.initial);
  if (!Number.isSafeInteger(initial) || Math.abs(initial) > 1000000) throw new Error('初始计数器须在−1000000至1000000之间。');
  if (!Array.isArray(draft.scripts) || draft.scripts.length !== 2) throw new Error('必须提供T1/T2两个脚本。');
  const programs = draft.scripts.map((source, index) => {
    if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > 4096) throw new Error(`T${index + 1}脚本须为≤4096字节文本。`);
    const instructions = [];
    source.split(/\r?\n/).forEach((line, lineIndex) => {
      const op = line.trim().toUpperCase(); if (!op) return;
      if (!OPS.includes(op)) throw new Error(`T${index + 1}第${lineIndex + 1}行指令无效；只允许独立READ/WRITE/LOCK/UNLOCK，不执行代码。`);
      instructions.push({ op, line: lineIndex + 1 });
    });
    if (!instructions.length || instructions.length > MAX_INSTRUCTIONS) throw new Error(`T${index + 1}须有1至${MAX_INSTRUCTIONS}条指令。`);
    return instructions;
  });
  return { initial, programs };
}
export function threadStatus(state, index) {
  const thread = state.threads[index];
  if (thread.fault) return 'fault';
  if (thread.pc >= state.input.programs[index].length) return 'done';
  if (state.input.programs[index][thread.pc].op === 'LOCK' && state.lockOwner !== null && state.lockOwner !== index) return 'blocked';
  return 'ready';
}
export const STATUS_LABELS = { ready: '可执行', blocked: '锁阻塞（可重试）', fault: '指令失效，需重置', done: '已完成' };
function snapshot(state) {
  return { shared: state.shared, revision: state.revision, lockOwner: state.lockOwner, threads: state.threads.map((thread, index) => ({ ...thread, status: threadStatus(state, index) })) };
}
function engine(state, index) {
  if (![0, 1].includes(index)) throw new Error('只能选择T1或T2。');
  if (state.trace.length >= MAX_STEPS) throw new Error(`尝试步数已达${MAX_STEPS}上限，请导出或重置；不会截断旧轨迹。`);
  if (['done', 'fault'].includes(threadStatus(state, index))) throw new Error(`T${index + 1}已完成或指令失效，请选择其他线程或重置。`);
  const next = structuredClone(state); const thread = next.threads[index]; const instruction = next.input.programs[index][thread.pc];
  const frame = { step: next.trace.length + 1, thread: index, pc: thread.pc, op: instruction.op, sourceLine: instruction.line, outcome: 'executed', reason: '', protected: null, conflictPairs: [], staleWrite: null, before: snapshot(state), after: null };
  function fault(reason) { frame.outcome = 'fault'; frame.reason = reason; thread.fault = reason; }
  if (instruction.op === 'LOCK') {
    if (next.lockOwner === index) fault('非重入锁：当前线程已经持锁，重复LOCK无效。');
    else if (next.lockOwner !== null) { frame.outcome = 'blocked'; frame.reason = `锁由T${next.lockOwner + 1}持有；PC、寄存器和共享值不变，可在解锁后重试。`; }
    else { next.lockOwner = index; frame.reason = '锁空闲，取得锁所有权。'; }
  } else if (instruction.op === 'UNLOCK') {
    if (next.lockOwner !== index) fault(next.lockOwner === null ? '锁当前无人持有，UNLOCK无效。' : `锁由T${next.lockOwner + 1}持有，当前线程无权解锁。`);
    else { next.lockOwner = null; frame.reason = '所有者释放锁，其他线程的LOCK可以重试。'; }
  } else if (instruction.op === 'WRITE' && thread.register === null) fault('本地寄存器R尚未由READ初始化，WRITE无效。');
  else {
    frame.protected = next.lockOwner === index;
    for (const prior of next.trace) {
      if (prior.outcome === 'executed' && ['READ', 'WRITE'].includes(prior.op) && prior.thread !== index && (prior.op === 'WRITE' || instruction.op === 'WRITE') && !(prior.protected && frame.protected)) {
        const pair = { earlierStep: prior.step, laterStep: frame.step, earlierThread: prior.thread, laterThread: index, earlierOp: prior.op, laterOp: instruction.op };
        frame.conflictPairs.push(pair); next.conflicts.push(pair);
      }
    }
    if (instruction.op === 'READ') {
      thread.register = next.shared; thread.readRevision = next.revision; thread.readStep = frame.step; frame.reason = `读取共享${next.shared}到R，记录版本${next.revision}。`;
    } else {
      const value = thread.register + 1;
      if (thread.readRevision !== next.revision) {
        frame.staleWrite = { readStep: thread.readStep, readValue: thread.register, readRevision: thread.readRevision, currentRevision: next.revision, overwrittenValue: next.shared, writtenValue: value, incrementGap: next.shared + 1 - value };
        next.staleWrites.push({ step: frame.step, thread: index, ...frame.staleWrite });
      }
      frame.reason = `WRITE将R+1=${thread.register}+1=${value}写入共享；R保持${thread.register}${frame.staleWrite ? '，READ版本已陈旧。' : '。'}`;
      next.shared = value; next.revision++; next.successfulWrites++;
    }
  }
  if (frame.outcome === 'executed') thread.pc++;
  frame.after = snapshot(next); next.trace.push(frame); return next;
}
export function createReplay(draft) {
  const input = parseDraft(draft);
  const empty = { modelVersion: MODEL_VERSION, input, shared: input.initial, revision: 0, lockOwner: null, threads: [0, 1].map(() => ({ pc: 0, register: null, readRevision: null, readStep: null, fault: null })), trace: [], conflicts: [], staleWrites: [], successfulWrites: 0 };
  let serial = structuredClone(empty);
  for (const index of [0, 1]) {
    while (threadStatus(serial, index) === 'ready') { serial = engine(serial, index); if (serial.trace.at(-1).outcome === 'fault') break; }
  }
  const completed = serial.threads.every((_, index) => threadStatus(serial, index) === 'done') && serial.lockOwner === null;
  return { ...empty, serialReference: { completed, counter: completed ? serial.shared : null, description: completed ? '固定T1完整执行后T2完整执行的实际脚本串行基准。' : 'T1→T2串行基准因失效指令、锁阻塞或锁未释放不能正常结束，未生成理想值。' } };
}
export function stepReplay(state, index) { return engine(state, index); }
export function summarize(state) {
  const statuses = state.threads.map((_, index) => threadStatus(state, index)); const completed = statuses.every((status) => status === 'done');
  const lockLeak = state.lockOwner !== null && ['done', 'fault'].includes(statuses[state.lockOwner]);
  const stopped = !statuses.includes('ready') && !completed;
  const difference = completed && state.serialReference.completed ? state.serialReference.counter - state.shared : null;
  return { statuses, completed, lockLeak, stopped, difference, lostUpdate: difference !== null && difference > 0, conflicts: state.conflicts.length, staleWrites: state.staleWrites.length };
}
export function example(kind = 'unlocked') {
  return { initial: '0', scripts: kind === 'locked' ? ['LOCK\nREAD\nWRITE\nUNLOCK', 'LOCK\nREAD\nWRITE\nUNLOCK'] : ['READ\nWRITE', 'READ\nWRITE'] };
}
export function prepareStoredState(draft) {
  if (!draft || typeof draft.initial !== 'string' || !Array.isArray(draft.scripts) || draft.scripts.length !== 2 || draft.scripts.some((source) => typeof source !== 'string' || new TextEncoder().encode(source).byteLength > 4096)) throw new Error('草稿字段类型或脚本容量无效：每脚本最多4096字节。');
  const serialized = JSON.stringify({ schemaVersion: 1, initial: draft.initial, scripts: draft.scripts });
  if (new TextEncoder().encode(serialized).byteLength > 65536) throw new Error('草稿超过64KiB。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('草稿版本不支持。');
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 65536) throw new Error('草稿超过64KiB。');
  return prepareStoredState(state);
}
export function reportMarkdown(payload) {
  const safe = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, '&#96;').replace(/\|/g, '&#124;');
  const lines = ['# L015 锁与竞态重放', '', RULES, '', '未保护冲突是运行轨迹中跨线程、至少一个WRITE、至少一次未持锁的读写对，不等同于真实语言内存模型的数据竞态判定。', '', `初始计数器：${safe(payload.draft.initial)}`];
  payload.draft.scripts.forEach((source, index) => lines.push('', `## T${index + 1}脚本`, '', ...source.split(/\r?\n/).map((line) => `    ${safe(line)}`)));
  if (!payload.result) { lines.push('', '当前输入尚未开始重放，无状态轨迹。'); return lines.join('\n'); }
  const state = payload.result; const summary = summarize(state);
  lines.push('', '## 当前结果', '', `共享值${state.shared}；完成${summary.completed ? '是' : '否'}；串行理想${state.serialReference.counter ?? '未生成'}；${state.serialReference.description}`, `与串行值差${summary.difference ?? '重放尚未完成或无基准'}；未保护冲突${summary.conflicts}对，陈旧写入${summary.staleWrites}次；锁所有者${state.lockOwner === null ? '无' : `T${state.lockOwner + 1}`}。`, '', '|步骤|线程|指令|结果|共享变化|原因|', '|---|---|---|---|---|---|');
  state.trace.forEach((frame) => lines.push(`|${frame.step}|T${frame.thread + 1}|${frame.op}|${frame.outcome}|${frame.before.shared}→${frame.after.shared}|${safe(frame.reason)}|`));
  for (const frame of state.trace) lines.push('', `### 步骤${frame.step}`, '', `之前：${JSON.stringify(frame.before)}`, '', `之后：${JSON.stringify(frame.after)}`, '', `未保护冲突对：${JSON.stringify(frame.conflictPairs)}`, '', `陈旧写入明细：${frame.staleWrite ? JSON.stringify(frame.staleWrite) : '无'}`);
  if (summary.lockLeak) lines.push('', '锁所有者已完成或失效但未解锁；不会自动释放锁。');
  if (summary.stopped) lines.push('', '当前无可推进线程，需重置或修改脚本。');
  return lines.join('\n');
}
