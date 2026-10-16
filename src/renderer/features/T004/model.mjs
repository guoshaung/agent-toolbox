export const LIMITS = Object.freeze({ samples: 12, sampleChars: 100000, totalChars: 400000, patternChars: 2048, matches: 1000, captures: 64, fileBytes: 1024 * 1024, totalFileBytes: 4 * 1024 * 1024, reportChars: 6 * 1024 * 1024 });
export const EXAMPLE = Object.freeze({
  pattern: String.raw`(?<level>INFO|ERROR) id=(?<id>\d+)`, flags: 'gu',
  samples: [
    { name: '日志1', text: '[12:00] INFO id=42 started' },
    { name: '日志2', text: '[12:01] ERROR id=7 failed' },
    { name: '日志3', text: '[12:02] DEBUG heartbeat' }
  ]
});

export function validateJob(job) {
  if (!job || typeof job.pattern !== 'string' || job.pattern.length > LIMITS.patternChars) throw new Error('规则须为最多2048个UTF-16单位的字符串。');
  if (typeof job.flags !== 'string' || job.flags.length > 8 || [...job.flags].some(flag => !'dgimsuvy'.includes(flag)) || new Set(job.flags).size !== job.flags.length || (job.flags.includes('u') && job.flags.includes('v'))) throw new Error('flags仅支持不重复的d g i m s u v y，u与v不可同时使用。');
  if (!Array.isArray(job.samples) || job.samples.length < 1 || job.samples.length > LIMITS.samples) throw new Error('请提供1至12份样本。');
  let total = 0;
  const samples = job.samples.map((sample, index) => {
    if (!sample || typeof sample.name !== 'string' || !sample.name.trim() || sample.name.length > 120 || typeof sample.text !== 'string') throw new Error(`样本${index + 1}须有名称（最多120字符）及文本。`);
    if (sample.text.length > LIMITS.sampleChars) throw new Error(`样本${index + 1}超过100000个UTF-16单位。`);
    total += sample.text.length;
    return { name: sample.name, text: sample.text };
  });
  if (total > LIMITS.totalChars) throw new Error('样本总量超过400000个UTF-16单位。');
  return { pattern: job.pattern, flags: job.flags, samples };
}

function fail(code, message, samples, progress) {
  const error = new Error(message); error.code = code;
  if (code === 'aborted') error.name = 'AbortError';
  error.failures = samples.map((sample, index) => ({ sample: index + 1, name: sample.name, status: progress[index] || '未完成', reason: message }));
  return error;
}

// The renderer never constructs or executes the supplied RegExp. A fresh Worker
// belongs to exactly one run, and every exit path terminates it.
export function runExtraction(job, { signal, timeoutMs = 3000, workerFactory, onProgress } = {}) {
  const input = validateJob(job);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) throw new Error('执行超时须为50至10000毫秒。');
  if (signal?.aborted) return Promise.reject(fail('aborted', '已取消，未导出任何结果。', input.samples, []));
  return new Promise((resolve, reject) => {
    let worker, timer, settled = false; const progress = [];
    const cleanups = [];
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      for (const clean of cleanups) clean();
      try { const terminating = worker?.terminate(); terminating?.catch?.(() => {}); } catch { /* Already gone. */ }
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(fail('aborted', '已取消，整批结果未完成；可以修改规则后重试。', input.samples, progress));
    const message = data => {
      if (settled) return;
      if (data?.type === 'progress') {
        progress[data.index] = data.status === 'matched' ? '已匹配（整批未完成）' : '未匹配（整批未完成）';
        try { onProgress?.({ completed: data.index + 1, total: input.samples.length }); } catch (error) { finish(fail('callback', error.message, input.samples, progress)); }
      } else if (data?.type === 'result') finish(null, data.result);
      else if (data?.type === 'error') finish(fail(data.code || 'worker', data.message || 'Worker执行失败。', input.samples, progress));
    };
    const error = event => finish(fail('worker', `隔离执行失败：${event?.message || 'Worker不可用'}`, input.samples, progress));
    try {
      worker = workerFactory ? workerFactory(new URL('./worker.mjs', import.meta.url)) : new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
      if (typeof worker.addEventListener === 'function') {
        const browserMessage = event => message(event.data);
        worker.addEventListener('message', browserMessage); worker.addEventListener('error', error); worker.addEventListener('messageerror', error);
        cleanups.push(() => { worker.removeEventListener('message', browserMessage); worker.removeEventListener('error', error); worker.removeEventListener('messageerror', error); });
      } else {
        const exit = () => error({ message: 'Worker提前退出。' });
        worker.on('message', message); worker.on('error', error); worker.on('exit', exit);
        cleanups.push(() => { worker.off('message', message); worker.off('error', error); worker.off('exit', exit); });
      }
      signal?.addEventListener('abort', abort, { once: true }); cleanups.push(() => signal?.removeEventListener('abort', abort));
      timer = setTimeout(() => finish(fail('timeout', `超过${timeoutMs}毫秒，Worker已终止，整批结果不可导出；请简化规则或缩小样本后重试。`, input.samples, progress)), timeoutMs);
      worker.postMessage(input);
      if (signal?.aborted) abort();
    } catch (cause) { error(cause); }
  });
}

export function captureColumns(result) {
  const columns = new Set();
  for (const match of result.matches) {
    match.captures.forEach((_, index) => columns.add(`capture:${index + 1}`));
    Object.keys(match.named).forEach(name => columns.add(`named:${name}`));
  }
  return [...columns];
}
export function captureValue(match, column) {
  return column.startsWith('named:') ? match.named[column.slice(6)] ?? null : match.captures[Number(column.slice(8)) - 1] ?? null;
}

export async function serializeReport(result, format, { signal, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  if (!['json', 'csv'].includes(format)) throw new Error('只支持JSON与CSV。');
  const chunks = []; let length = 0;
  const append = text => { length += text.length; if (length > LIMITS.reportChars) throw new Error('导出超过6 Mi个UTF-16单位，请缩小样本。'); chunks.push(text); };
  const check = () => { if (signal?.aborted) { const error = new Error('已取消导出。'); error.name = 'AbortError'; throw error; } };
  check();
  if (format === 'json') {
    append('{"feature":"T004","version":1,"offsetUnit":"UTF-16","rule":'); append(JSON.stringify(result.rule));
    append(',"samples":'); append(JSON.stringify(result.samples)); append(',"matches":[');
    for (let index = 0; index < result.matches.length; index++) {
      if (index % 25 === 0) { await yieldTask(); check(); }
      append((index ? ',' : '') + JSON.stringify(result.matches[index]));
    }
    append('],"stats":'); append(JSON.stringify(result.stats)); append('}');
  } else {
    const columns = captureColumns(result);
    // String cells use JSON literals to preserve null/empty/newlines and avoid
    // accidental spreadsheet formula execution. Numeric offsets remain numbers.
    const cell = value => { const text = typeof value === 'number' ? String(value) : JSON.stringify(value); return '"' + text.replaceAll('"', '""') + '"'; };
    append('\uFEFFsample_index,sample_name_json,start_utf16,end_utf16,match_json' + columns.map(column => ',' + cell(column)).join('') + '\r\n');
    for (let index = 0; index < result.matches.length; index++) {
      if (index % 25 === 0) { await yieldTask(); check(); }
      const row = result.matches[index];
      append([row.sample, row.name, row.start, row.end, row.text, ...columns.map(column => captureValue(row, column))].map(cell).join(',') + '\r\n');
    }
  }
  check(); return chunks.join('');
}
