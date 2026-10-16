export const MODEL_VERSION = '1.0';
export const MAX_TASKS = 50;
export const MAX_TIME = 100000;
export const MAX_SEGMENTS = 1000;
export const POLICIES = {
  FCFS: '先到先服务，非抢占；到达时间相同按输入行顺序。',
  SJF: '非抢占最短作业优先，只在已到达任务中选择；时长相同先到达者优先，再按输入行顺序。',
  RR: '轮转，时间片到期才重新排队；运行期间及时间片结束边界的新到达任务先按到达时间/输入顺序入队，然后重新排队当前未完成任务。',
};
export function integer(value, label, minimum, maximum = MAX_TIME) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value).trim())) throw new Error(`${label}须为十进制整数。`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${label}须在${minimum}至${maximum}之间。`);
  return number;
}
export function validateInput(draft) {
  if (!draft || !Array.isArray(draft.tasks) || draft.tasks.length < 1 || draft.tasks.length > MAX_TASKS) throw new Error(`须输入1至${MAX_TASKS}个任务。`);
  const quantum = integer(draft.quantum, '时间片', 1); const names = new Set();
  const tasks = draft.tasks.map((row, index) => {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || row.id.trim().length > 24) throw new Error(`任务${index + 1}名称须为1至24字符。`);
    const id = row.id.trim(); if (names.has(id)) throw new Error(`任务名称${id}重复。`); names.add(id);
    return { id, arrival: integer(row.arrival, `任务${id}到达时间`, 0, MAX_TIME - 1), burst: integer(row.burst, `任务${id}运行时长`, 1), index };
  });
  if (tasks.reduce((sum, row) => sum + row.burst, 0) > MAX_TIME) throw new Error(`总运行时长超过${MAX_TIME}，无法在模拟时间上限内完成。`);
  return { tasks, quantum };
}
function schedule(input, id) {
  const pending = input.tasks.map((row) => ({ ...row, remaining: row.burst })).sort((a, b) => a.arrival - b.arrival || a.index - b.index);
  const ready = []; const first = new Map(); const completion = new Map(); const segments = []; let next = 0; let time = 0;
  function enqueue() { while (next < pending.length && pending[next].arrival <= time) ready.push(pending[next++]); }
  function append(taskId, start, end, extra = {}) {
    if (end > MAX_TIME) throw new Error(`${id}完成时间超过${MAX_TIME}；请缩短输入，不会截断报告。`);
    if (segments.length >= MAX_SEGMENTS) throw new Error(`${id}甘特片段超过${MAX_SEGMENTS}；请增大时间片或缩短输入，不会截断报告。`);
    segments.push({ taskId, start, end, duration: end - start, ...extra });
  }
  while (completion.size < input.tasks.length) {
    enqueue();
    if (!ready.length) {
      const start = time; time = pending[next].arrival; enqueue();
      append(null, start, time, { reason: '没有已到达的就绪任务，CPU空闲', readyBefore: [], readyAfter: ready.map((row) => row.id) });
    }
    if (id === 'FCFS') ready.sort((a, b) => a.arrival - b.arrival || a.index - b.index);
    if (id === 'SJF') ready.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival || a.index - b.index);
    const readyBefore = ready.map((row) => row.id); const current = ready.shift(); const start = time;
    if (!first.has(current.id)) first.set(current.id, start);
    const duration = id === 'RR' ? Math.min(input.quantum, current.remaining) : current.remaining;
    time += duration; current.remaining -= duration;
    enqueue(); // Boundary arrivals enter before the current task is requeued.
    if (current.remaining === 0) completion.set(current.id, time);
    else ready.push(current);
    if (id === 'FCFS') ready.sort((a, b) => a.arrival - b.arrival || a.index - b.index);
    if (id === 'SJF') ready.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival || a.index - b.index);
    append(current.id, start, time, { reason: current.remaining === 0 ? '任务完成' : '时间片用尽，未完成任务重新排队', remaining: current.remaining, readyBefore, readyAfter: ready.map((row) => row.id) });
  }
  const tasks = input.tasks.map((task) => {
    const runs = segments.filter((segment) => segment.taskId === task.id).map(({ start, end }) => ({ start, end })); const waits = []; let cursor = task.arrival;
    for (const run of runs) { if (run.start > cursor) waits.push({ start: cursor, end: run.start }); cursor = run.end; }
    const finish = completion.get(task.id); const turnaround = finish - task.arrival;
    return { ...task, firstStart: first.get(task.id), completion: finish, turnaround, waiting: turnaround - task.burst, response: first.get(task.id) - task.arrival, runs, waits };
  });
  const average = (key) => tasks.reduce((sum, task) => sum + task[key], 0) / tasks.length;
  const busy = tasks.reduce((sum, task) => sum + task.burst, 0);
  return { id, name: id === 'SJF' ? 'SJF（非抢占）' : id, policy: POLICIES[id], segments, tasks, averages: { waiting: average('waiting'), turnaround: average('turnaround'), response: average('response') }, makespan: time, busy, idle: time - busy, utilization: busy / time };
}
export function compareSchedules(draft) {
  const input = validateInput(draft);
  return { modelVersion: MODEL_VERSION, input, strategies: ['FCFS', 'SJF', 'RR'].map((id) => schedule(input, id)) };
}
export function example(kind = 'core') {
  if (kind === 'boundary') return { quantum: '2', tasks: [{ id: 'A', arrival: '0', burst: '4' }, { id: 'B', arrival: '2', burst: '1' }, { id: 'C', arrival: '2', burst: '1' }] };
  if (kind === 'idle') return { quantum: '1', tasks: [{ id: 'A', arrival: '2', burst: '2' }, { id: 'B', arrival: '7', burst: '1' }, { id: 'C', arrival: '7', burst: '3' }] };
  return { quantum: '1', tasks: [{ id: 'A', arrival: '0', burst: '3' }, { id: 'B', arrival: '0', burst: '2' }] };
}
export function prepareStoredState(draft) {
  const serialized = JSON.stringify({ schemaVersion: 1, quantum: draft.quantum, tasks: draft.tasks });
  if (new TextEncoder().encode(serialized).byteLength > 65536) throw new Error('草稿超过64KiB。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('草稿版本不支持。');
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 65536) throw new Error('草稿超过64KiB。');
  if (typeof state.quantum !== 'string' || !Array.isArray(state.tasks) || state.tasks.length > MAX_TASKS || !state.tasks.every((row) => row && ['id', 'arrival', 'burst'].every((key) => typeof row[key] === 'string'))) throw new Error('草稿结构或容量无效。');
  return prepareStoredState(state);
}
const safe = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[|\r\n]/g, ' ');
export function reportMarkdown(payload) {
  const lines = ['# L014 调度策略对照', '', '单CPU、无I/O、零切换开销；时间轴从0开始，idle显式计算。', '', '## 输入草稿', '', `时间片：${safe(payload.draft.quantum)}`, '', '|任务|到达时间|运行时长|', '|---|---|---|'];
  payload.draft.tasks.forEach((row) => lines.push(`|${safe(row.id)}|${safe(row.arrival)}|${safe(row.burst)}|`));
  if (!payload.result) { lines.push('', '尚未运行当前输入，未生成策略结果。'); return lines.join('\n'); }
  for (const strategy of payload.result.strategies) {
    lines.push('', `## ${strategy.name}`, '', strategy.policy, '', `总完成时间（从0到最后完成）${strategy.makespan}；运行${strategy.busy}；空闲${strategy.idle}。平均等待${strategy.averages.waiting.toFixed(2)}，平均周转${strategy.averages.turnaround.toFixed(2)}，平均响应${strategy.averages.response.toFixed(2)}。`, '', '|任务|到达|时长|首次运行|完成|等待|周转|响应|', '|---|---|---|---|---|---|---|---|');
    strategy.tasks.forEach((row) => lines.push(`|${safe(row.id)}|${row.arrival}|${row.burst}|${row.firstStart}|${row.completion}|${row.waiting}|${row.turnaround}|${row.response}|`));
    lines.push('', '|片段|任务|开始|结束|原因|调度前候选顺序|结束后候选顺序|', '|---|---|---|---|---|---|---|');
    strategy.segments.forEach((segment, index) => lines.push(`|${index + 1}|${segment.taskId === null ? 'CPU空闲' : safe(segment.taskId)}|${segment.start}|${segment.end}|${segment.reason}|${segment.readyBefore.map(safe).join(' → ') || '无'}|${segment.readyAfter.map(safe).join(' → ') || '无'}|`));
    for (const task of strategy.tasks) lines.push('', `任务${safe(task.id)}运行区间：${task.runs.map((run) => `[${run.start},${run.end})`).join('、')}；等待区间：${task.waits.map((wait) => `[${wait.start},${wait.end})`).join('、') || '无'}。`, `等待=${task.completion}−${task.arrival}−${task.burst}=${task.waiting}；周转=${task.completion}−${task.arrival}=${task.turnaround}；响应=${task.firstStart}−${task.arrival}=${task.response}。`);
  }
  return lines.join('\n');
}
