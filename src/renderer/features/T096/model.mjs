export const LIMITS = Object.freeze({ inputBytes: 1048576, lines: 20000, events: 1000, nodes: 3000, depth: 8, properties: 200, lineChars: 65536, outputBytes: 4194304 });
export const TARGETS = Object.freeze(['preserve', 'UTC', 'Asia/Shanghai', 'Asia/Tokyo']);
const ZONES = { 'Asia/Shanghai': 480, 'Asia/Tokyo': 540 };
export class CalendarError extends Error { constructor(code, message) { super(message); this.name = 'CalendarError'; this.code = code; } }
const fail = (code, message) => { throw new CalendarError(code, message); };
const bytes = value => new TextEncoder().encode(value).byteLength;
const clone = value => JSON.parse(JSON.stringify(value));
const props = (node, name) => node.entries.filter(e => e.kind === 'property' && e.name === name);
const children = node => node.entries.filter(e => e.kind === 'component');
export function decodeText(value) { let out = ''; for (let i = 0; i < value.length; i++) { if (value[i] !== '\\') out += value[i]; else { const c = value[++i]; if (c === 'n' || c === 'N') out += '\n'; else if (['\\', ',', ';'].includes(c)) out += c; else fail('textEscape', 'TEXT 含不支持的转义；仅能保留原属性，不能改写。'); } } return out; }
function property(raw, startLine, endLine) {
  let quoted = false; let colon = -1; for (let i = 0; i < raw.length; i++) { if (raw[i] === '"') quoted = !quoted; if (raw[i] === ':' && !quoted) { colon = i; break; } }
  if (colon < 1 || quoted) fail('syntax', `物理行 ${startLine} 属性冒号/参数引号无效。`);
  const chunks = []; let current = ''; quoted = false; for (const c of raw.slice(0, colon)) { if (c === '"') quoted = !quoted; if (c === ';' && !quoted) { chunks.push(current); current = ''; } else current += c; } chunks.push(current);
  if (!/^[A-Za-z0-9-]+$/.test(chunks[0])) fail('syntax', `物理行 ${startLine} 属性名无效。`);
  const params = chunks.slice(1).map(rawParam => { const eq = rawParam.indexOf('='); if (eq < 1 || !/^[A-Za-z0-9-]+$/.test(rawParam.slice(0, eq)) || !rawParam.slice(eq + 1)) fail('syntax', `物理行 ${startLine} 参数无效。`); const encoded = rawParam.slice(eq + 1); if (encoded.includes('"') && !/^"[^"\r\n]*"$/.test(encoded)) fail('syntax', `物理行 ${startLine} 参数引号范围不支持。`); return { name: rawParam.slice(0, eq).toUpperCase(), value: encoded.startsWith('"') ? encoded.slice(1, -1) : encoded, raw: rawParam }; });
  return { kind: 'property', name: chunks[0].toUpperCase(), params, value: raw.slice(colon + 1), raw, startLine, endLine };
}
function parameter(p, name) { const matching = p.params.filter(v => v.name === name); if (matching.length > 1) fail('timeParams', `时间参数 ${name} 重复。`); return matching[0]?.value; }
const pad = (value, width = 2) => String(value).padStart(width, '0');
const stamp = epoch => { const d = new Date(epoch); return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`; };
function clock(value, dateOnly = false) {
  const regex = dateOnly ? /^(\d{4})(\d{2})(\d{2})$/ : /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/;
  const m = regex.exec(value); if (!m) fail('timeValue', '日期/时间写法不支持（不接受数值偏移、分数秒或多值）。');
  const [year, month, day, hour = 0, minute = 0, second = 0] = m.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) fail('timeValue', '日期不存在或超出范围；闰秒只可保留原值，不转换。');
  const d = new Date(0); d.setUTCFullYear(year, month - 1, day); d.setUTCHours(hour, minute, second, 0); const epoch = d.getTime(); const expected = dateOnly ? value : value.replace(/Z$/, ''); if ((dateOnly ? stamp(epoch).slice(0, 8) : stamp(epoch)) !== expected) fail('timeValue', '日期或时间不存在。'); return epoch;
}
export function classifyTime(p) {
  if (!p) return null;
  try { const rawType = parameter(p, 'VALUE'); const type = (rawType === undefined ? 'DATE-TIME' : rawType).toUpperCase(); const tzid = parameter(p, 'TZID'); if (tzid === '') fail('timeParams', 'TZID 不能为空。');
    if (type === 'DATE') { if (tzid || p.value.endsWith('Z')) fail('timeParams', 'DATE 不能带 TZID 或 Z。'); return { kind: 'DATE', value: p.value, wallEpoch: clock(p.value, true), valid: true }; }
    if (type !== 'DATE-TIME') fail('timeValue', '当前不解释该时间值类型。');
    if (p.value.endsWith('Z') && tzid) fail('timeParams', 'UTC 时间不能同时带 TZID。'); const epoch = clock(p.value);
    return { kind: p.value.endsWith('Z') ? 'UTC' : tzid ? 'TZID' : 'floating', value: p.value, ...(tzid ? { tzid } : {}), ...(p.value.endsWith('Z') ? { epoch } : { wallEpoch: epoch }), valid: true };
  } catch (error) { return { kind: 'invalid', value: p.value, valid: false, reason: error.message }; }
}
function linesOf(node) { return [`BEGIN:${node.name}`, ...node.entries.flatMap(e => e.kind === 'component' ? linesOf(e) : [e.raw]), `END:${node.name}`]; }
function fold(line) { let out = ''; let size = 0; for (const c of line) { const n = bytes(c); if (size + n > 75) { out += '\r\n '; size = 1; } out += c; size += n; } return out; }
export function serializeTree(root) { const out = linesOf(root).map(fold).join('\r\n') + '\r\n'; if (bytes(out) > LIMITS.outputBytes) fail('outputLimit', '副本超过 4 MiB，未截断。'); return out; }
export function parseICS(input) {
  if (typeof input !== 'string' || input.length > LIMITS.inputBytes || bytes(input) > LIMITS.inputBytes) fail('inputLimit', 'ICS 输入最多 1 MiB UTF-8。');
  for (let i = 0; i < input.length; i++) { const c = input.charCodeAt(i); if (c < 32 && ![9, 10, 13].includes(c)) fail('binary', '输入含非文本控制字符。'); if (c >= 0xd800 && c <= 0xdbff) { const n = input.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail('unicode', '输入含无效 Unicode。'); } else if (c >= 0xdc00 && c <= 0xdfff) fail('unicode', '输入含无效 Unicode。'); }
  const text = input.replace(/^\uFEFF/, ''); if (/\r(?!\n)/.test(text)) fail('syntax', '换行只接受 LF 或 CRLF。');
  let lineCount = 1; for (const c of text) if (c === '\n' && ++lineCount > LIMITS.lines) fail('lines', 'ICS 超过 20000 物理行。'); const logical = [];
  text.replace(/\r\n/g, '\n').split('\n').forEach((text, i) => { if (/^[ \t]/.test(text)) { if (!logical.length || !logical.at(-1).raw) fail('fold', '折叠行缺少前一行。'); logical.at(-1).raw += text.slice(1); logical.at(-1).endLine = i + 1; } else if (text) logical.push({ raw: text, startLine: i + 1, endLine: i + 1 }); else if (i + 1 < lineCount) fail('syntax', `物理行 ${i + 1} 为空内容行；不静默删除。`); if (logical.at(-1)?.raw.length > LIMITS.lineChars) fail('lineLimit', '展开内容行超过 65536 字符。'); });
  const stack = []; let root = null; let nodes = 0;
  for (const line of logical) {
    const p = property(line.raw, line.startLine, line.endLine);
    if (p.name === 'BEGIN') { if (p.params.length || !/^[A-Za-z0-9-]+$/.test(p.value)) fail('nesting', 'BEGIN 组件名或参数无效。'); const name = p.value.toUpperCase();
      if (!stack.length && (root || name !== 'VCALENDAR')) fail('nesting', '仅接受一个 VCALENDAR 根组件。'); if (stack.length && name === 'VCALENDAR') fail('nesting', '不能嵌套 VCALENDAR。'); if (['VEVENT', 'VTIMEZONE'].includes(name) && stack.at(-1)?.name !== 'VCALENDAR') fail('nesting', 'VEVENT/VTIMEZONE 必须是根日历的直接子组件。'); if (name === 'VALARM' && stack.at(-1)?.name !== 'VEVENT') fail('nesting', '当前只接受 VEVENT 下的 VALARM。'); if (['STANDARD', 'DAYLIGHT'].includes(name) && stack.at(-1)?.name !== 'VTIMEZONE') fail('nesting', '时区观测组件必须在 VTIMEZONE 中。');
      if (++nodes > LIMITS.nodes || stack.length >= LIMITS.depth) fail('nesting', '组件数量或嵌套深度超限。'); const node = { kind: 'component', name, entries: [], startLine: p.startLine, endLine: p.endLine }; if (stack.length) stack.at(-1).entries.push(node); else root = node; stack.push(node);
    } else if (p.name === 'END') { const node = stack.pop(); if (!node || p.params.length || p.value.toUpperCase() !== node.name) fail('nesting', 'END 与 BEGIN 不匹配。'); node.endLine = p.endLine; }
    else { if (!stack.length) fail('nesting', `物理行 ${p.startLine} 属性位于日历外。`); const node = stack.at(-1); if (props(node, p.name).length >= LIMITS.properties || node.entries.filter(e => e.kind === 'property').length >= LIMITS.properties) fail('properties', '单组件超过 200 属性。'); node.entries.push(p); }
  }
  if (!root || stack.length) fail('nesting', '日历未完整闭合。'); if (props(root, 'VERSION').length !== 1 || props(root, 'VERSION')[0].value !== '2.0' || props(root, 'PRODID').length !== 1 || !props(root, 'PRODID')[0].value) fail('calendar', '根组件必须有唯一 VERSION:2.0 和非空 PRODID。');
  const eventNodes = children(root).filter(n => n.name === 'VEVENT'); if (!eventNodes.length || eventNodes.length > LIMITS.events) fail('events', '需要 1–1000 个 VEVENT。');
  const timezones = children(root).filter(n => n.name === 'VTIMEZONE').map(node => ({ id: props(node, 'TZID').length === 1 ? props(node, 'TZID')[0].value : null, node, startLine: node.startLine, endLine: node.endLine }));
  const audit = []; if (/(^|[^\r])\n/.test(input)) audit.push({ scope: 'calendar', reason: 'LF 输入在副本中规范为 CRLF。' });
  for (const p of root.entries.filter(e => e.kind === 'property' && !['VERSION', 'PRODID', 'METHOD', 'CALSCALE'].includes(e.name))) audit.push({ scope: 'calendar', line: p.startLine, reason: `根属性 ${p.name} 原样保留，不解释语义。` });
  for (const node of children(root).filter(n => !['VEVENT', 'VTIMEZONE'].includes(n.name))) audit.push({ scope: 'calendar', line: node.startLine, reason: `组件 ${node.name} 完整保留，仅允许原样副本。` });
  for (const zone of timezones) audit.push({ scope: 'timezone', line: zone.startLine, reason: `VTIMEZONE ${zone.id || '（缺少唯一 TZID）'} 完整保留；不展开规则，仅改写时验证固定偏移范围。` });
  const events = eventNodes.map((node, i) => {
    const id = `E${String(i + 1).padStart(4, '0')}`; const issues = []; const one = name => { const list = props(node, name); if (list.length > 1) issues.push(`${name} 重复，不能改写。`); return list.length === 1 ? list[0] : null; };
    const uidProperty = one('UID'); let uid = null; let summary = '';
    try { uid = uidProperty?.value ? decodeText(uidProperty.value) : null; summary = props(node, 'SUMMARY')[0] ? decodeText(props(node, 'SUMMARY')[0].value) : ''; for (const p of props(node, 'DESCRIPTION').concat(props(node, 'LOCATION'))) decodeText(p.value); } catch (error) { issues.push(error.message); }
    if (!uid) issues.push('缺少唯一非空 UID，不能判重复或改写。'); const start = classifyTime(one('DTSTART')); const end = classifyTime(one('DTEND')); const dtstamp = classifyTime(one('DTSTAMP'));
    if (!start) issues.push('缺少唯一 DTSTART，不能改写。'); if (!dtstamp?.valid || dtstamp.kind !== 'UTC') issues.push('缺少唯一有效 UTC DTSTAMP，不能改写。');
    for (const t of [start, end]) { if (t && !t.valid) issues.push(t.reason); if (t?.kind === 'TZID' && timezones.filter(z => z.id === t.tzid).length !== 1) issues.push(`TZID ${t.tzid} 缺少唯一 VTIMEZONE；仅原样保留。`); }
    if (start?.valid && end?.valid) { if (start.kind !== end.kind || start.tzid !== end.tzid) issues.push('DTSTART/DTEND 类型或时区不同，不能改写。'); else if ((end.kind === 'UTC' ? end.epoch : end.wallEpoch) <= (start.kind === 'UTC' ? start.epoch : start.wallEpoch)) issues.push('DTEND 应晚于 DTSTART，不能改写。'); }
    const recurrence = node.entries.filter(e => e.kind === 'property' && ['RRULE', 'RDATE', 'EXDATE', 'RECURRENCE-ID'].includes(e.name)).map(p => ({ name: p.name, raw: p.raw, value: p.value }));
    if (recurrence.length) audit.push({ eventId: id, line: node.startLine, reason: '重复/例外规则保留原属性，不展开实例、不计算排期、不允许时区改写。' });
    for (const issue of issues) audit.push({ eventId: id, line: node.startLine, reason: issue });
    const interpreted = ['UID', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'DTSTART', 'DTEND', 'DTSTAMP', 'RRULE', 'RDATE', 'EXDATE', 'RECURRENCE-ID']; for (const p of node.entries.filter(e => e.kind === 'property' && !interpreted.includes(e.name))) audit.push({ eventId: id, line: p.startLine, reason: `${p.name} 不做语义解释，完整原属性保留。` });
    if (children(node).length) audit.push({ eventId: id, line: node.startLine, reason: '嵌套组件完整保留；本 MVP 不改写提醒/嵌套规则。' });
    return { id, uid, summary, start, end, recurrence, issues, node, fingerprint: linesOf(node).join('\n'), recurrenceId: props(node, 'RECURRENCE-ID')[0]?.raw || null, startLine: node.startLine, endLine: node.endLine };
  });
  return { root, events, timezones, audit, inputBytes: bytes(input) };
}
export async function analyzeICS(parsed, options = {}) {
  if (!parsed?.events || !parsed.root) fail('parsed', '请先解析当前 ICS。'); const groups = new Map(); const uidGroups = new Map(); const canceled = () => { if (options.isCanceled?.()) fail('canceled', '校验已取消，无部分结果。'); }; const yieldTask = options.yieldTask || (() => new Promise(r => setTimeout(r, 0)));
  for (let i = 0; i < parsed.events.length; i++) { canceled(); const event = parsed.events[i]; if (event.uid) { const exact = groups.get(event.fingerprint) || []; exact.push(event); groups.set(event.fingerprint, exact); const uid = uidGroups.get(event.uid) || []; uid.push(event); uidGroups.set(event.uid, uid); } if ((i + 1) % 50 === 0) { options.onProgress?.({ processed: i + 1, total: parsed.events.length }); await yieldTask(); canceled(); } }
  canceled(); const duplicates = [...groups.values()].filter(g => g.length > 1).map((members, i) => ({ id: `D${String(i + 1).padStart(3, '0')}`, uid: members[0].uid, members: members.map(e => e.id) }));
  const conflicts = [...uidGroups.entries()].filter(([, members]) => new Set(members.map(e => e.fingerprint)).size > 1).map(([uid, members], i) => ({ id: `C${String(i + 1).padStart(3, '0')}`, uid, members: members.map(e => e.id), kind: members.some(e => e.recurrenceId) ? 'seriesOrConflict' : 'conflict', notice: members.some(e => e.recurrenceId) ? '存在 RECURRENCE-ID，可能是合法系列实例/更新；全部保留，不判定身份。' : '同 UID 不同完整内容，全部保留，不自动覆盖。' }));
  return { parsed, duplicates, conflicts };
}
function checkFixedZone(timezones, tzid, minEpoch) {
  const match = timezones.filter(z => z.id === tzid); if (match.length !== 1 || !(tzid in ZONES)) fail('zone', '源/目标 TZID 缺少唯一受支持的固定偏移 VTIMEZONE。'); const node = match[0].node; const observations = children(node);
  if (props(node, 'TZID').length !== 1 || props(node, 'TZID')[0].params.length || node.entries.some(e => e.kind === 'property' && !['TZID', 'LAST-MODIFIED', 'TZURL'].includes(e.name))) fail('zone', 'VTIMEZONE 根属性不在固定时区范围，拒绝改写。');
  if (observations.length !== 1 || observations[0].name !== 'STANDARD') fail('zone', '含 DST、多个观测或复杂 VTIMEZONE，拒绝改写。'); const standard = observations[0]; const names = standard.entries.filter(e => e.kind === 'property').map(p => p.name);
  if (children(standard).length || names.some(n => !['DTSTART', 'TZOFFSETFROM', 'TZOFFSETTO', 'TZNAME'].includes(n))) fail('zone', 'VTIMEZONE 规则不在固定偏移范围，拒绝改写。'); const offset = '+' + pad(Math.floor(ZONES[tzid] / 60)) + pad(ZONES[tzid] % 60);
  for (const name of ['TZOFFSETFROM', 'TZOFFSETTO']) if (props(standard, name).length !== 1 || props(standard, name)[0].value !== offset || props(standard, name)[0].params.length) fail('zone', 'VTIMEZONE 偏移与受支持 IANA 时区不一致，拒绝改写。');
  if (props(standard, 'DTSTART').length !== 1 || props(standard, 'DTSTART')[0].params.length || /Z$/.test(props(standard, 'DTSTART')[0].value) || clock(props(standard, 'DTSTART')[0].value) > minEpoch) fail('zone', 'VTIMEZONE 固定观测开始晚于事件或写法不支持。');
}
function checkIntl(epoch, zone) {
  try { const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch)); const get = type => parts.find(p => p.type === type)?.value; const observed = `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`; if (observed !== stamp(epoch + ZONES[zone] * 60000)) fail('intl', '当前 Intl 时区数据与固定偏移不一致，拒绝改写。'); } catch (error) { if (error instanceof CalendarError) throw error; fail('intl', '当前环境缺少可靠 Intl 时区数据，拒绝改写。'); }
}
function generatedZone(zone) { const offset = '+' + pad(Math.floor(ZONES[zone] / 60)) + pad(ZONES[zone] % 60); const standard = { kind: 'component', name: 'STANDARD', entries: ['DTSTART:20000101T000000', `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`].map(raw => property(raw, 0, 0)), startLine: 0, endLine: 0 }; return { kind: 'component', name: 'VTIMEZONE', entries: [property('TZID:' + zone, 0, 0), standard], startLine: 0, endLine: 0 }; }
export function makeResult(analysis, decisions = [], target = 'preserve') {
  if (!analysis?.parsed || !Array.isArray(decisions) || !TARGETS.includes(target)) fail('result', '校验结果或目标时区无效。'); const selected = new Set(); const removed = new Set();
  for (const d of decisions) { const group = analysis.duplicates.find(g => g.id === d?.groupId); if (!group || selected.has(group.id) || !group.members.includes(d.keepId)) fail('decision', '只能对当前完全相同组确认一次，并选择该组保留 ID。'); selected.add(group.id); group.members.filter(id => id !== d.keepId).forEach(id => removed.add(id)); }
  const source = analysis.parsed; const kept = source.events.filter(e => !removed.has(e.id)); const root = clone(source.root); const eventOrder = new Map(source.events.map(e => [e.startLine, e])); root.entries = root.entries.filter(entry => entry.kind !== 'component' || entry.name !== 'VEVENT' || !removed.has(eventOrder.get(entry.startLine)?.id)); const changes = [];
  if (target !== 'preserve') {
    if (props(root, 'METHOD').length || children(root).some(c => !['VEVENT', 'VTIMEZONE'].includes(c.name))) fail('scope', '含 METHOD 或非事件组件，当前仅允许原样副本。');
    for (const event of kept) {
      if (event.issues.length || event.recurrence.length || children(event.node).length || props(event.node, 'DURATION').length) fail('scope', `${event.id} 含重复/例外/提醒/时长或校验问题，阻止整次时区改写；请选择保留原语义。`);
      for (const p of props(event.node, 'DTSTART').concat(props(event.node, 'DTEND'))) { if (p.params.some(v => !['TZID', 'VALUE'].includes(v.name))) fail('scope', '时间属性存在范围外参数，拒绝改写。'); const time = classifyTime(p); if (!time?.valid || !['UTC', 'TZID'].includes(time.kind)) fail('scope', 'DATE/floating/无效时间不分配时区；仅允许原样副本。'); if (time.kind === 'TZID' && !(time.tzid in ZONES)) fail('zone', '仅支持 UTC ↔ Asia/Shanghai、Asia/Tokyo；DST 含歧义/不存在时间及其他 TZID 不转换。'); if (time.kind === 'TZID' && target !== 'UTC' && target !== time.tzid) fail('zone', '不同 TZID 间不直接转换；请先确认 UTC 副本，再单独转换目标。'); const epoch = time.kind === 'UTC' ? time.epoch : time.wallEpoch - ZONES[time.tzid] * 60000; const year = new Date(epoch).getUTCFullYear(); if (year < 2000 || year > 2035 || (target !== 'UTC' && (new Date(epoch + ZONES[target] * 60000).getUTCFullYear() < 2000 || new Date(epoch + ZONES[target] * 60000).getUTCFullYear() > 2035))) fail('range', '转换范围为 2000–2035；超范围只保留原语义。');
        if (time.kind === 'TZID') { checkFixedZone(source.timezones, time.tzid, time.wallEpoch); checkIntl(epoch, time.tzid); }
        if (target !== 'UTC') { checkIntl(epoch, target); if (source.timezones.some(z => z.id === target)) checkFixedZone(source.timezones, target, epoch + ZONES[target] * 60000); }
        const copiedEvent = root.entries.find(n => n.kind === 'component' && n.name === 'VEVENT' && n.startLine === event.startLine); const index = copiedEvent.entries.findIndex(v => v.kind === 'property' && v.name === p.name); const value = target === 'UTC' ? stamp(epoch) + 'Z' : stamp(epoch + ZONES[target] * 60000); const params = p.params.filter(v => v.name !== 'TZID').map(v => v.raw); if (target !== 'UTC') params.push('TZID=' + target); const raw = p.name + (params.length ? ';' + params.join(';') : '') + ':' + value; copiedEvent.entries[index] = property(raw, p.startLine, p.endLine); if (raw !== p.raw) changes.push({ eventId: event.id, property: p.name, before: p.raw, after: raw });
      }
    }
    if (target !== 'UTC' && !source.timezones.some(z => z.id === target)) { const index = root.entries.findIndex(e => e.kind === 'component'); root.entries.splice(index < 0 ? root.entries.length : index, 0, generatedZone(target)); }
  }
  const describe = t => { if (!t) return null; const { epoch, wallEpoch, ...rest } = t; return rest; };
  const ics = serializeTree(root); const report = { feature: 'T096', version: 1, target, inputEvents: source.events.length, outputEvents: kept.length, duplicateGroups: clone(analysis.duplicates), conflicts: clone(analysis.conflicts), decisions: clone(decisions), removedIds: [...removed], timezones: source.timezones.map(z => ({ id: z.id, startLine: z.startLine, endLine: z.endLine })), events: kept.map(e => ({ id: e.id, uid: e.uid, summary: e.summary, start: describe(e.start), end: describe(e.end), recurrence: e.recurrence, issues: e.issues, startLine: e.startLine, endLine: e.endLine })), audit: clone(source.audit), changes, notice: 'events 时间字段描述原输入；实际 DTSTART/DTEND 改写见 changes，副本为最终输出。完整属性及 VTIMEZONE 保留；未知/复杂规则只原样复制，不展开排期或保证目标日历导入效果。DATE 的 DTEND 为不包含的结束日期；floating 不推断时区。未确认完全相同组及同 UID 不同内容均保留；报告含原事件信息，请核对分享范围。' };
  if (bytes(JSON.stringify(report)) > LIMITS.outputBytes) fail('outputLimit', '报告超过 4 MiB，未截断。'); return { ics, report };
}
