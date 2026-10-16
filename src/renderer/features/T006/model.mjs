export const LIMITS = Object.freeze({ sources: 8, sourceBytes: 2 * 1024 * 1024, totalBytes: 8 * 1024 * 1024, lines: 50000, lineLength: 50000, outputBytes: 12 * 1024 * 1024 });
export const FORMATS = Object.freeze([
  { id: 'iso-offset', label: 'ISO 日期时间 + 行内时区', hint: '2026-07-01T12:00:00.123Z 或 2026-07-01 20:00:00+08:00' },
  { id: 'local', label: '日期时间 + 指定固定 UTC 偏移', hint: '2026-07-01 20:00:00.123；必须另填固定偏移' },
  { id: 'unix-seconds', label: 'Unix 秒（可含1至3位小数）', hint: '1782907200.123；时区为 UTC' },
  { id: 'unix-ms', label: 'Unix 毫秒（整数）', hint: '1782907200123；时区为 UTC' },
]);
const MIN_EPOCH = Date.UTC(1970, 0, 1), MAX_EPOCH = Date.UTC(2101, 0, 1) - 1;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/u;

function checkAbort(signal) { if (signal?.aborted) { const error = new Error('已取消日志处理。'); error.name = 'AbortError'; throw error; } }
async function checkpoint(hooks = {}) { checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal); }
export function parseOffset(value) {
  if (value === 'Z') return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(String(value));
  if (!match) throw new Error('固定偏移必须是 Z 或 ±HH:mm，例如 +08:00；不支持 IANA 时区或时区缩写。');
  const hour = Number(match[2]), minute = Number(match[3]);
  if (hour > 14 || minute > 59 || (hour === 14 && minute !== 0)) throw new Error('固定偏移须在 -14:00 至 +14:00 之间。');
  return (match[1] === '-' ? -1 : 1) * (hour * 60 + minute);
}
export function offsetText(offset) { const value = Math.abs(offset); return `UTC${offset < 0 ? '-' : '+'}${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function epochRange(epoch) { if (!Number.isSafeInteger(epoch) || epoch < MIN_EPOCH || epoch > MAX_EPOCH) throw new Error('时间超出支持的 UTC 1970至2100年范围。'); return epoch; }
function dateEpoch(match) {
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const fraction = match[7] || '';
  if (fraction.length > 3) throw new Error('小数精度超过毫秒；本版本不截断微秒或纳秒。');
  const millisecond = Number(fraction.padEnd(3, '0') || 0);
  const epoch = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const actual = new Date(epoch);
  if (year < 1970 || year > 2100 || hour > 23 || minute > 59 || second > 59 || actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== day) throw new Error('日期或时刻无效；不支持24:00或闰秒。');
  return epoch;
}

/** Only explicit selected formats at the line prefix; never permissive Date.parse. */
export function parseTimestamp(raw, format, offset = 'Z') {
  if (!FORMATS.some(item => item.id === format)) throw new Error('不支持所选时间格式。');
  if (!raw.trim()) return { ok: false, reason: '空行', empty: true };
  const lead = /^\s*(\[)?/u.exec(raw);
  const rest = raw.slice(lead[0].length);
  let token = '', epochMs, sourceOffset = 0;
  try {
    if (format === 'iso-offset' || format === 'local') {
      const date = DATE_PATTERN.exec(rest);
      if (!date) return { ok: false, reason: '行首不匹配完整 YYYY-MM-DD HH:mm:ss 时间；不推断缺失日期或年份。' };
      token = date[0]; epochMs = dateEpoch(date);
      if (format === 'iso-offset') {
        const zone = /^(Z|[+-]\d{2}:\d{2})/u.exec(rest.slice(token.length));
        if (!zone) return { ok: false, reason: '所选 ISO 格式要求行内 Z 或 ±HH:mm；不会猜测时区。' };
        token += zone[0]; sourceOffset = parseOffset(zone[0]);
      } else sourceOffset = parseOffset(offset);
      epochMs -= sourceOffset * 60000;
    } else {
      const epoch = (format === 'unix-seconds' ? /^(-?\d+)(?:\.(\d+))?/u : /^(-?\d+)/u).exec(rest);
      if (!epoch) return { ok: false, reason: '行首不是所选 Unix 秒或毫秒数值。' };
      token = epoch[0];
      if (format === 'unix-seconds') {
        if ((epoch[2] || '').length > 3) throw new Error('Unix秒小数精度超过毫秒。');
        const magnitude = Number(epoch[1]) * 1000;
        const fraction = Number((epoch[2] || '').padEnd(3, '0') || 0);
        epochMs = magnitude + (epoch[1].startsWith('-') ? -fraction : fraction);
      } else epochMs = Number(epoch[1]);
    }
    let after = rest.slice(token.length);
    if (lead[1]) {
      if (!after.startsWith(']')) return { ok: false, reason: '行首时间的方括号未闭合，或时间后含不支持的字段。' };
      after = after.slice(1);
    } else if (after && !/^\s/u.test(after)) return { ok: false, reason: '时间戳后须有空白分隔消息；检查格式、行内时区或小数精度。' };
    epochRange(epochMs);
    return { ok: true, epochMs, utc: new Date(epochMs).toISOString(), timestamp: token, sourceOffsetMinutes: sourceOffset, message: after.trimStart() };
  } catch (error) { return { ok: false, reason: error.message }; }
}

async function* physicalLines(text, hooks) {
  let start = 0, line = 1, nextYield = 32768;
  for (let index = 0; index < text.length; index++) {
    if (index >= nextYield) { nextYield = index + 32768; await checkpoint(hooks); }
    if (index - start > LIMITS.lineLength) throw new Error(`第${line}行超过${LIMITS.lineLength}字符，请拆分后处理。`);
    if (text[index] === '\r' || text[index] === '\n') {
      yield { raw: text.slice(start, index), line };
      if (text[index] === '\r' && text[index + 1] === '\n') index++;
      start = index + 1; line++;
    }
  }
  if (start < text.length) {
    if (text.length - start > LIMITS.lineLength) throw new Error(`第${line}行超过${LIMITS.lineLength}字符，请拆分后处理。`);
    yield { raw: text.slice(start), line };
  }
}

async function stableSort(events, hooks) {
  let source = [...events], target = new Array(events.length), operations = 0;
  const compare = (a, b) => a.epochMs - b.epochMs || a.sequence - b.sequence;
  for (let width = 1; width < events.length; width *= 2) {
    hooks.onProgress?.({ phase: 'sort', width });
    for (let start = 0; start < events.length; start += width * 2) {
      let left = start, right = Math.min(start + width, events.length), at = start;
      const leftEnd = right, rightEnd = Math.min(start + width * 2, events.length);
      while (left < leftEnd || right < rightEnd) {
        if (++operations >= 4096) { operations = 0; await checkpoint(hooks); }
        target[at++] = right >= rightEnd || (left < leftEnd && compare(source[left], source[right]) <= 0) ? source[left++] : source[right++];
      }
    }
    [source, target] = [target, source];
  }
  checkAbort(hooks.signal); return source;
}

export async function buildTimeline(inputs, hooks = {}) {
  checkAbort(hooks.signal);
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > LIMITS.sources) throw new Error(`请添加1至${LIMITS.sources}份日志。`);
  const encoder = new TextEncoder(), sources = [], events = [], unparsed = [];
  let totalBytes = 0, sequence = 0, emptyLines = 0;
  for (const [sourceIndex, input] of inputs.entries()) {
    if (!input || typeof input.text !== 'string') throw new Error('日志内容必须是文本。');
    const name = String(input.name || '').trim();
    if (!name || name.length > 200 || /[\r\n\u0000-\u001f]/u.test(name)) throw new Error(`第${sourceIndex + 1}份日志名称须1至200字且不能换行。`);
    if (!FORMATS.some(format => format.id === input.format)) throw new Error(`${name}：未选择支持的时间格式。`);
    if (input.format === 'local') {
      try { parseOffset(input.offset ?? 'Z'); } catch (error) { error.message = `${name}：${error.message}`; throw error; }
    }
    if (input.text.length > LIMITS.sourceBytes) throw new Error(`${name}：单份日志超过2 MiB上限。`);
    const bytes = encoder.encode(input.text).length;
    totalBytes += bytes;
    if (bytes > LIMITS.sourceBytes || totalBytes > LIMITS.totalBytes) throw new Error('单份日志最多2 MiB，全部日志合计最多8 MiB。');
    const source = { sourceIndex: sourceIndex + 1, name, format: input.format, offset: input.format === 'local' ? (input.offset ?? 'Z') : null, bytes, hasBOM: input.text.startsWith('\uFEFF'), totalLines: 0, eventLines: 0, unparsedLines: 0 };
    sources.push(source);
  }
  for (const [sourceIndex, input] of inputs.entries()) {
    const source = sources[sourceIndex], name = source.name;
    try {
      for await (const record of physicalLines(input.text, hooks)) {
        if (++sequence > LIMITS.lines) throw new Error(`合计超过${LIMITS.lines}物理行，请拆分日志。`);
        source.totalLines++;
        const provenance = { sourceIndex: sourceIndex + 1, source: name, line: record.line, sequence: sequence - 1, raw: record.raw };
        const parsed = parseTimestamp(record.raw, input.format, input.offset ?? 'Z');
        if (parsed.ok) { source.eventLines++; events.push({ ...provenance, epochMs: parsed.epochMs, utc: parsed.utc, timestamp: parsed.timestamp, sourceOffsetMinutes: parsed.sourceOffsetMinutes, message: parsed.message }); }
        else { source.unparsedLines++; if (parsed.empty) emptyLines++; unparsed.push({ ...provenance, reason: parsed.reason }); }
        if (sequence % 128 === 0) { hooks.onProgress?.({ phase: 'parse', name, line: record.line }); await checkpoint(hooks); }
      }
    } catch (error) { if (error.name !== 'AbortError') error.message = `${name}：${error.message}`; throw error; }
  }
  const timeline = await stableSort(events, hooks);
  let sameInstantGroups = 0, sameInstantEvents = 0;
  for (let index = 0; index < timeline.length;) {
    let end = index + 1;
    while (end < timeline.length && timeline[end].epochMs === timeline[index].epochMs) end++;
    if (end - index > 1) { sameInstantGroups++; sameInstantEvents += end - index; }
    for (let at = index; at < end; at++) timeline[at].sameInstantCount = end - index;
    index = end;
  }
  checkAbort(hooks.signal);
  return { sources, timeline, unparsed, stats: { sourceCount: sources.length, totalBytes, totalLines: sequence, eventLines: timeline.length, unparsedLines: unparsed.length, emptyLines, sameInstantGroups, sameInstantEvents } };
}

export async function serializeTimeline(result, kind = 'json', hooks = {}) {
  checkAbort(hooks.signal);
  if (!['json', 'csv'].includes(kind)) throw new Error('导出格式只支持JSON或CSV。');
  const encoder = new TextEncoder(), chunks = [];
  let bytes = 0;
  function append(text) { bytes += encoder.encode(text).length; if (bytes > LIMITS.outputBytes) throw new Error('导出超过12 MiB，请拆分日志。'); chunks.push(text); }
  if (kind === 'csv') {
    const quote = value => /[,"\r\n]/u.test(String(value)) ? `"${String(value).replace(/"/gu, '""')}"` : String(value);
    append('\uFEFFsource_index,source_name,source_line,utc,epoch_ms,source_offset,timestamp,message,raw\r\n');
    for (let index = 0; index < result.timeline.length; index++) {
      if (index % 128 === 0) await checkpoint(hooks);
      const event = result.timeline[index];
      append([event.sourceIndex, event.source, event.line, event.utc, event.epochMs, offsetText(event.sourceOffsetMinutes), event.timestamp, event.message, event.raw].map(quote).join(',') + '\r\n');
    }
  } else {
    append(JSON.stringify({ feature: 'T006', stats: result.stats, sources: result.sources }).slice(0, -1));
    for (const key of ['timeline', 'unparsed']) {
      append(`,"${key}":[`);
      for (let index = 0; index < result[key].length; index++) { if (index % 128 === 0) await checkpoint(hooks); append((index ? ',' : '') + JSON.stringify(result[key][index])); }
      append(']');
    }
    append('}\n');
  }
  checkAbort(hooks.signal); return chunks.join('');
}
