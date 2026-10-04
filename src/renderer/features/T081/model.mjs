const MINUTE = 60000;
export const LIMITS = Object.freeze({ people: 8, windows: 4, windowMinutes: 7 * 24 * 60, suggestions: 200 });
export const COMMON_ZONES = ['UTC', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Kathmandu', 'Australia/Lord_Howe', 'Pacific/Auckland'];
const formatters = new Map();

export class TimeInputError extends Error {
  constructor(message, code = 'INVALID', candidates = []) { super(message); this.name = 'TimeInputError'; this.code = code; this.candidates = candidates; }
}
function checkAbort(signal) {
  if (signal?.aborted) { const error = new Error('已取消时间计算。'); error.name = 'AbortError'; throw error; }
}
async function yieldTurn(hooks) {
  checkAbort(hooks.signal);
  await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))();
  checkAbort(hooks.signal);
}
const pad = value => String(value).padStart(2, '0');

export function validateZone(value) {
  const zone = String(value ?? '').trim();
  // Named identifiers only: numeric offsets belong to the separate explicit mode.
  if (!/^(?:UTC|[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+)$/u.test(zone)) throw new TimeInputError('请输入 IANA 时区，例如 Asia/Hong_Kong、Europe/London 或 UTC；不猜测城市名与缩写。');
  let formatter = formatters.get(zone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { throw new TimeInputError(`当前运行环境不支持时区 ${zone}，请核对名称。`, 'INVALID_ZONE'); }
    const resolved = formatter.resolvedOptions();
    if (resolved.calendar !== 'gregory' || resolved.numberingSystem !== 'latn' || resolved.hourCycle !== 'h23') throw new TimeInputError('当前环境未提供需要的公历、数字或24小时格式，不能可靠计算。', 'UNSUPPORTED_RUNTIME');
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value);
    formatters.set(zone, formatter);
  }
  return { formatter, timeZone: formatter.resolvedOptions().timeZone };
}

function partsAt(formatter, epoch) {
  const result = {};
  for (const part of formatter.formatToParts(epoch)) if (['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type)) result[part.type] = Number(part.value);
  if (Object.values(result).some(value => !Number.isInteger(value)) || Object.keys(result).length !== 6 || result.hour > 23) throw new TimeInputError('当前环境返回不支持的时间字段，不能可靠计算。', 'UNSUPPORTED_RUNTIME');
  return result;
}

export function parseWall(date, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(date));
  const timeMatch = /^(\d{2}):(\d{2})$/u.exec(String(time));
  if (!dateMatch || !timeMatch) throw new TimeInputError('日期必须是 YYYY-MM-DD，时间必须是 HH:mm（00:00 至 23:59）。');
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hour, minute] = timeMatch.slice(1).map(Number);
  const epoch = Date.UTC(year, month - 1, day, hour, minute);
  const actual = new Date(epoch);
  if (year < 2000 || year > 2100 || actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== day || hour > 23 || minute > 59) throw new TimeInputError('日期或时间无效；支持 2000 至 2100 年的真实公历日期，24:00 请改填次日00:00。');
  return { year, month, day, hour, minute, second: 0, epoch };
}

export function parseOffset(value) {
  if (value === 'Z') return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(String(value));
  if (!match) throw new TimeInputError('明确偏移必须是 Z 或 ±HH:mm，例如 +08:00、-04:00。');
  const hours = Number(match[2]), minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) throw new TimeInputError('明确偏移须在 -14:00 至 +14:00 之间，分钟为00至59。');
  return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}
export function offsetText(minutes) {
  const absolute = Math.abs(minutes);
  return `UTC${minutes < 0 ? '-' : '+'}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
export function utcText(epoch) { return new Date(epoch).toISOString().replace('.000', ''); }

export function localView(epoch, timeZone) {
  const { formatter, timeZone: canonical } = validateZone(timeZone);
  const parts = partsAt(formatter, epoch);
  const offsetMinutes = (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - epoch) / MINUTE;
  if (!Number.isInteger(offsetMinutes)) throw new TimeInputError('当前时间偏移不是整分钟，本版本不能可靠展示。', 'UNSUPPORTED_PRECISION');
  const date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, time = `${pad(parts.hour)}:${pad(parts.minute)}`;
  return { date, time, timeZone: canonical, offsetMinutes, text: `${date} ${time} ${offsetText(offsetMinutes)} [${canonical}]` };
}

/** Exhaustive minute-offset candidates, not Date's implicit local-time coercion. */
export async function localCandidates(date, time, timeZone, hooks = {}) {
  checkAbort(hooks.signal);
  const wall = parseWall(date, time);
  const { formatter } = validateZone(timeZone);
  const candidates = [];
  // The declared supported range is 2000–2100 with minute precision. Search the
  // complete ±24-hour offset space, and verify the actual IANA wall fields.
  for (let offset = -1440; offset <= 1440; offset++) {
    if ((offset + 1440) % 512 === 0) await yieldTurn(hooks);
    const epoch = wall.epoch - offset * MINUTE;
    const actual = partsAt(formatter, epoch);
    if (actual.second !== 0) throw new TimeInputError('当前时区含非整分钟偏移，本版本不支持。', 'UNSUPPORTED_PRECISION');
    if (['year', 'month', 'day', 'hour', 'minute'].every(key => actual[key] === wall[key])) candidates.push({ epoch, offsetMinutes: offset, utc: utcText(epoch) });
  }
  checkAbort(hooks.signal);
  return candidates.sort((a, b) => a.epoch - b.epoch);
}

export async function resolveBoundary(date, time, timeZone, mode = 'local', offset = 'Z', hooks = {}) {
  checkAbort(hooks.signal);
  validateZone(timeZone);
  const wall = parseWall(date, time);
  if (mode === 'offset') return wall.epoch - parseOffset(offset) * MINUTE;
  if (mode !== 'local') throw new TimeInputError('时间输入模式无效。');
  const candidates = await localCandidates(date, time, timeZone, hooks);
  if (!candidates.length) throw new TimeInputError(`${date} ${time} 在 ${timeZone} 不存在（时钟可能向前跳过该时段），请修改时间。`, 'NONEXISTENT');
  if (candidates.length > 1) throw new TimeInputError(`${date} ${time} 在 ${timeZone} 重复出现。请改用“明确UTC偏移”并指定 ${candidates.map(candidate => offsetText(candidate.offsetMinutes)).join(' 或 ')}。`, 'AMBIGUOUS', candidates);
  return candidates[0].epoch;
}

export function mergeIntervals(intervals) {
  const sorted = intervals.map(interval => ({ start: interval.start, end: interval.end })).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push(interval);
  }
  return merged;
}
export function intersectIntervals(left, right) {
  const result = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start, right[j].start), end = Math.min(left[i].end, right[j].end);
    if (start < end) result.push({ start, end });
    if (left[i].end <= right[j].end) i++; else j++;
  }
  return result;
}

export async function buildPlan(input, durationMinutes = 30, stepMinutes = 15, hooks = {}) {
  checkAbort(hooks.signal);
  if (!Array.isArray(input) || !input.length || input.length > LIMITS.people) throw new TimeInputError(`请填写1至${LIMITS.people}位参与者。`);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) throw new TimeInputError('会议时长必须是1至1440的整数分钟。');
  if (!Number.isInteger(stepMinutes) || stepMinutes < 1 || stepMinutes > 120) throw new TimeInputError('候选间隔必须是1至120的整数分钟。');
  const people = [], cache = new Map();
  let completed = 0;
  const total = input.reduce((sum, person) => sum + (Array.isArray(person?.windows) ? person.windows.length * 2 : 0), 0);
  async function boundary(person, window, side, label) {
    const key = JSON.stringify([window[`${side}Date`], window[`${side}Time`], person.timeZone, person.mode ?? 'local', window[`${side}Offset`] ?? 'Z']);
    try {
      if (!cache.has(key)) cache.set(key, await resolveBoundary(window[`${side}Date`], window[`${side}Time`], person.timeZone, person.mode ?? 'local', window[`${side}Offset`] ?? 'Z', hooks));
      completed++; hooks.onProgress?.(completed / Math.max(1, total));
      return cache.get(key);
    } catch (error) { if (error.name !== 'AbortError') error.message = `${label}${side === 'start' ? '开始' : '结束'}：${error.message}`; throw error; }
  }
  for (const [index, person] of input.entries()) {
    if (!person || typeof person !== 'object') throw new TimeInputError(`第${index + 1}位参与者数据无效。`);
    const name = String(person.name ?? '').trim();
    if (!name || name.length > 80 || /[\r\n\u0000-\u001f]/u.test(name)) throw new TimeInputError(`第${index + 1}位参与者名称须为1至80字且不能换行。`);
    let timeZone;
    try { timeZone = validateZone(person.timeZone).timeZone; }
    catch (error) { error.message = `${name}：${error.message}`; throw error; }
    if (!Array.isArray(person.windows) || !person.windows.length || person.windows.length > LIMITS.windows) throw new TimeInputError(`${name}须填写1至${LIMITS.windows}个可用区间。`);
    const intervals = [];
    for (const [windowIndex, window] of person.windows.entries()) {
      if (!window || typeof window !== 'object') throw new TimeInputError(`${name}第${windowIndex + 1}个区间无效。`);
      const label = `${name} · 区间${windowIndex + 1} `;
      const start = await boundary(person, window, 'start', label), end = await boundary(person, window, 'end', label);
      if (end <= start) throw new TimeInputError(`${label}结束必须晚于开始；跨日请显式填写次日日期。`);
      if ((end - start) / MINUTE > LIMITS.windowMinutes) throw new TimeInputError(`${label}实际可用跨度最多7天，请拆分区间。`);
      intervals.push({ start, end, startLocal: localView(start, timeZone), endLocal: localView(end, timeZone) });
    }
    people.push({ name, timeZone, inputMode: person.mode ?? 'local', intervals, merged: mergeIntervals(intervals) });
  }
  let common = people[0].merged;
  for (const person of people.slice(1)) common = intersectIntervals(common, person.merged);
  const windows = common.map(window => ({ ...window, availableMinutes: (window.end - window.start) / MINUTE, latestStart: window.end - durationMinutes * MINUTE, fits: window.end - window.start >= durationMinutes * MINUTE }));
  const suggestions = [];
  let totalSuggestions = 0;
  for (const [windowIndex, window] of windows.entries()) {
    if (!window.fits) continue;
    const count = Math.floor((window.latestStart - window.start) / (stepMinutes * MINUTE)) + 1;
    totalSuggestions += count;
    const displayCount = Math.min(count, LIMITS.suggestions - suggestions.length);
    for (let index = 0; index < displayCount; index++) {
      const start = window.start + index * stepMinutes * MINUTE;
      suggestions.push({ start, end: start + durationMinutes * MINUTE, windowIndex });
    }
  }
  checkAbort(hooks.signal);
  return { people, windows, suggestions, totalSuggestions, truncated: totalSuggestions > suggestions.length, durationMinutes, stepMinutes };
}

export function invitationText(plan, suggestionIndex = 0, title = '跨时区会议') {
  const meeting = plan.suggestions[suggestionIndex];
  if (!meeting) throw new TimeInputError('请选择有效的会议候选。');
  const safeTitle = String(title).trim();
  if (!safeTitle || safeTitle.length > 120 || /[\r\n\u0000-\u001f]/u.test(safeTitle)) throw new TimeInputError('会议标题须为1至120字且不能换行。');
  return [safeTitle, `时长：${plan.durationMinutes}分钟`, `UTC：${utcText(meeting.start)} → ${utcText(meeting.end)}`, ...plan.people.map(person => `${person.name}：${localView(meeting.start, person.timeZone).text} → ${localView(meeting.end, person.timeZone).text}`), '请确认各地日期及UTC偏移；本工具没有发送邀请或创建日历事件。'].join('\n');
}
