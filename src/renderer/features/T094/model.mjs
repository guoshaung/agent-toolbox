export const LIMITS = Object.freeze({ inputBytes: 1048576, sources: 10, contacts: 1000, columns: 100, properties: 100, cellChars: 65536, candidates: 5000, outputBytes: 8388608, physicalLines: 20000 });
export const FIELDS = Object.freeze(['name', 'email', 'phone', 'address', 'note']);
export class ContactError extends Error { constructor(code, message) { super(message); this.name = 'ContactError'; this.code = code; } }
const fail = (code, message) => { throw new ContactError(code, message); };
const bytes = value => new TextEncoder().encode(value).byteLength;
const clone = value => JSON.parse(JSON.stringify(value));
function textCheck(text) {
  if (typeof text !== 'string' || text.length > LIMITS.inputBytes || bytes(text) > LIMITS.inputBytes) fail('inputLimit', '来源文本须在 1 MiB UTF-8 内。');
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c === 0) fail('binary', '输入含零字节，拒绝按联系人文本处理。'); if (c >= 0xd800 && c <= 0xdbff) { const n = text.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail('unicode', '输入含无效 Unicode。'); } else if (c >= 0xdc00 && c <= 0xdfff) fail('unicode', '输入含无效 Unicode。'); }
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}
function infoCheck(info, text, format) {
  if (!info || !/^S\d{3,4}$/.test(info.id) || typeof info.label !== 'string' || !info.label.trim() || info.label.length > 80 || /[\x00-\x1f]/.test(info.label)) fail('source', '来源编号无效，或名称为空/超过 80 字符/含控制字符。');
  return { id: info.id, label: info.label, format, inputBytes: bytes(text) };
}
function blankContact(source, index, startLine, endLine) {
  return { id: `${source.id}-C${String(index).padStart(4, '0')}`, name: '', structuredName: null, emails: [], phones: [], addresses: [], notes: [], provenance: [{ sourceId: source.id, sourceLabel: source.label, record: index, startLine, endLine }], unmapped: [], sourceFields: [], sourceProperties: [] };
}
export function parseCSV(text, info) {
  const source = infoCheck(info, text, 'csv'); text = textCheck(text);
  let value = ''; let cells = []; const records = []; let quoted = false; let closed = false; let started = false; let line = 1; let startLine = 1;
  function cell() { cells.push(value); if (cells.length > LIMITS.columns) fail('columns', 'CSV 超过 100 列。'); value = ''; closed = false; started = false; }
  function record() { cell(); records.push({ values: cells, startLine, endLine: line }); cells = []; if (records.length > LIMITS.contacts + 1) fail('contacts', 'CSV 超过 1000 条联系人记录。'); }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; if (c === '\r' && text[i + 1] !== '\n') fail('csvSyntax', 'CSV 换行只接受 LF 或 CRLF。');
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } } else { value += c; if (c === '\n') line++; } }
    else if (c === ',') cell();
    else if (c === '\r' || c === '\n') { record(); if (c === '\r') i++; line++; startLine = line; }
    else if (c === '"') { if (started || closed) fail('csvSyntax', 'CSV 引号位置无效。'); quoted = true; started = true; }
    else { if (closed) fail('csvSyntax', 'CSV 闭合引号后只能是分隔符或换行。'); value += c; started = true; }
    if (value.length > LIMITS.cellChars) fail('cell', 'CSV 单元格超过 65536 字符。');
  }
  if (quoted) fail('csvSyntax', 'CSV 引号未闭合。'); if (value || cells.length || started || closed) record();
  if (records.length < 2) fail('contacts', 'CSV 须有表头及至少一条联系人记录。');
  const header = records.shift(); const headers = header.values; const seen = new Set();
  for (const name of headers) { if (!name || name.length > 100 || name.trim() !== name || /[\x00-\x1f\x7f]/.test(name)) fail('headers', 'CSV 字段名须为 1–100 字符，无首尾空白或控制字符。'); const n = name.normalize('NFKC'); if (seen.has(n)) fail('headers', 'CSV 字段名重复（含 Unicode 兼容形式）。'); seen.add(n); }
  for (let i = 0; i < records.length; i++) if (records[i].values.length !== headers.length) fail('rowWidth', `CSV 记录 ${i + 1}（物理行 ${records[i].startLine}）列数不一致；未导入或丢弃任何字段。`);
  return { source, headers, headerLines: { startLine: header.startLine, endLine: header.endLine }, records };
}
export function suggestMapping(headers) {
  const aliases = { name: ['name', '姓名', '名称', '全名'], email: ['email', 'e-mail', '邮箱', '邮件'], phone: ['phone', 'tel', '手机', '电话', '手机号'], address: ['address', '地址'], note: ['note', 'notes', '备注'] };
  let nameTaken = false; return headers.map(header => { const field = FIELDS.find(f => aliases[f].includes(header.toLowerCase())); if (field === 'name' && nameTaken) return 'unmapped'; if (field === 'name') nameTaken = true; return field || 'unmapped'; });
}
export function mapCSV(parsed, mapping) {
  if (!parsed?.records || !Array.isArray(mapping) || mapping.length !== parsed.headers.length || mapping.some(m => m !== 'unmapped' && !FIELDS.includes(m))) fail('mapping', 'CSV 每列须明确选择姓名、邮箱、电话、地址、备注或未映射。');
  if (mapping.filter(m => m === 'name').length > 1) fail('mapping', '姓名最多映射一列；其他姓名字段请保留为未映射审计。');
  if (!mapping.some(m => m !== 'unmapped')) fail('mapping', '至少映射一个联系人字段；其他列仍保留在审计。');
  const contacts = parsed.records.map((record, i) => {
    const contact = blankContact(parsed.source, i + 1, record.startLine, record.endLine);
    parsed.headers.forEach((header, col) => {
      const raw = record.values[col]; const field = mapping[col]; const location = { sourceId: parsed.source.id, contactId: contact.id, field: header, column: col + 1, startLine: record.startLine, endLine: record.endLine };
      contact.sourceFields.push({ ...location, mappedAs: field, value: raw });
      if (field === 'unmapped') contact.unmapped.push({ ...location, reason: 'unmappedColumn', value: raw });
      else if (field === 'name') contact.name = raw;
      else if (field === 'email' && raw) contact.emails.push(raw);
      else if (field === 'phone' && raw) contact.phones.push(raw);
      else if (field === 'address' && raw) contact.addresses.push({ components: ['', '', raw, '', '', '', ''] });
      else if (field === 'note' && raw) contact.notes.push(raw);
      if (field === 'email' && raw && !emailKey(raw)) contact.unmapped.push({ ...location, reason: 'emailNotComparable', value: raw });
    }); return contact;
  }); return { source: { ...parsed.source, records: contacts.length }, contacts };
}
function unescapeValue(value) {
  let result = ''; for (let i = 0; i < value.length; i++) { if (value[i] !== '\\') { result += value[i]; continue; } const c = value[++i]; if (c === 'n' || c === 'N') result += '\n'; else if (c === '\\' || c === ';' || c === ',') result += c; else fail('vcardEscape', 'vCard 文本含不支持的转义，未导入或改写。'); } return result;
}
function splitStructured(value) { const parts = []; let part = ''; for (let i = 0; i < value.length; i++) { const c = value[i]; if (c === '\\') { part += c + (value[++i] || ''); } else if (c === ';') { parts.push(unescapeValue(part)); part = ''; } else part += c; } parts.push(unescapeValue(part)); return parts; }
function compoundComma(value) { for (let i = 0; i < value.length; i++) { if (value[i] === '\\') i++; else if (value[i] === ',') return true; } return false; }
function parseProperty(line) {
  let quoted = false; let colon = -1; for (let i = 0; i < line.length; i++) { if (line[i] === '"') quoted = !quoted; if (line[i] === ':' && !quoted) { colon = i; break; } }
  if (colon < 1 || quoted) fail('vcardSyntax', 'vCard 属性缺少有效冒号或参数引号不闭合。');
  const left = line.slice(0, colon); const chunks = []; let part = ''; quoted = false;
  for (const c of left) { if (c === '"') quoted = !quoted; if (c === ';' && !quoted) { chunks.push(part); part = ''; } else part += c; } chunks.push(part);
  if (!/^(?:[a-z0-9-]+\.)?[a-z0-9-]+$/i.test(chunks[0])) fail('vcardSyntax', 'vCard 属性名无效。');
  const name = chunks[0].split('.').at(-1).toUpperCase();
  for (const param of chunks.slice(1)) { const eq = param.indexOf('='); if (eq < 1 || !/^[a-z0-9-]+$/i.test(param.slice(0, eq)) || !param.slice(eq + 1)) fail('vcardSyntax', 'vCard 3.0 参数须使用 NAME=VALUE。'); const key = param.slice(0, eq).toUpperCase(); const value = param.slice(eq + 1).replace(/^"|"$/g, ''); if (key === 'ENCODING' || (key === 'CHARSET' && value.toUpperCase() !== 'UTF-8')) fail('encoding', 'vCard 含 ENCODING 或非 UTF-8 CHARSET，当前范围不支持；阻止整来源导入及改写。'); }
  return { name, group: chunks[0].includes('.') ? chunks[0].split('.')[0] : '', params: chunks.slice(1), value: line.slice(colon + 1), raw: line };
}
export function parseVCard(text, info) {
  const source = infoCheck(info, text, 'vcard'); text = textCheck(text); if (/\r(?!\n)/.test(text)) fail('vcardSyntax', 'vCard 换行只接受 LF 或 CRLF。');
  let count = 1; for (const c of text) if (c === '\n' && ++count > LIMITS.physicalLines) fail('lines', 'vCard 物理行超过 20000 行。');
  const logical = []; text.replace(/\r\n/g, '\n').split('\n').forEach((value, i) => { if (/^[ \t]/.test(value)) { if (!logical.length || !logical.at(-1).text) fail('fold', 'vCard 折叠行没有可展开的前一行。'); logical.at(-1).text += value.slice(1); logical.at(-1).endLine = i + 1; } else logical.push({ text: value, startLine: i + 1, endLine: i + 1 }); if (logical.at(-1).text.length > LIMITS.cellChars) fail('cell', 'vCard 展开属性超过 65536 字符。'); });
  const contacts = []; let current = null; let version = 0; let properties = 0;
  for (const line of logical) {
    if (!line.text) continue;
    if (/^BEGIN:VCARD$/i.test(line.text)) { if (current) fail('vcardSyntax', 'vCard BEGIN 嵌套。'); current = blankContact(source, contacts.length + 1, line.startLine, line.endLine); version = 0; properties = 0; continue; }
    if (/^END:VCARD$/i.test(line.text)) { if (!current || version !== 1) fail('version', '每张 vCard 必须且只能有一个 VERSION:3.0。'); current.provenance[0].endLine = line.endLine; if (!current.name && current.structuredName) current.name = [current.structuredName[3], current.structuredName[1], current.structuredName[2], current.structuredName[0], current.structuredName[4]].filter(Boolean).join(' '); contacts.push(current); if (contacts.length > LIMITS.contacts) fail('contacts', 'vCard 超过 1000 个联系人。'); current = null; continue; }
    if (!current) fail('vcardSyntax', `vCard 物理行 ${line.startLine} 位于卡片外，未导入。`);
    if (++properties > LIMITS.properties) fail('properties', '单个 vCard 超过 100 个属性。');
    const property = { ...parseProperty(line.text), startLine: line.startLine, endLine: line.endLine }; current.sourceProperties.push(property);
    const location = { sourceId: source.id, contactId: current.id, field: property.name, startLine: line.startLine, endLine: line.endLine };
    const audit = reason => current.unmapped.push({ ...location, reason, raw: property.raw });
    if (property.name === 'VERSION') { if (property.value !== '3.0' || property.params.length || property.group) fail('version', '当前仅支持 vCard VERSION:3.0，其他版本阻止整来源导入和改写。'); version++; if (version > 1) fail('version', 'vCard VERSION 重复。'); continue; }
    if (!['FN', 'N', 'EMAIL', 'TEL', 'ADR', 'NOTE'].includes(property.name)) { audit('unsupportedProperty'); continue; }
    if (property.params.length || property.group) audit('parametersPreserved');
    if ((property.name === 'N' || property.name === 'ADR') && compoundComma(property.value)) { audit('unsupportedCompoundValues'); continue; }
    if (property.name === 'N') { const components = splitStructured(property.value); if (components.length !== 5 || current.structuredName) audit('unsupportedOrRepeatedStructure'); else current.structuredName = components; }
    else if (property.name === 'ADR') { const components = splitStructured(property.value); if (components.length !== 7) audit('unsupportedStructure'); else current.addresses.push({ components }); }
    else { const value = unescapeValue(property.value); if (property.name === 'FN') { if (current.name) audit('repeatedName'); else current.name = value; } else if (property.name === 'EMAIL') { current.emails.push(value); if (!emailKey(value)) audit('emailNotComparable'); } else if (property.name === 'TEL') current.phones.push(value); else current.notes.push(value); }
  }
  if (current) fail('vcardSyntax', 'vCard 缺少 END，未导入任何联系人。'); if (!contacts.length) fail('contacts', '来源未包含完整 vCard 3.0 联系人。'); return { source: { ...source, records: contacts.length }, contacts };
}
export function emailKey(value) { if (typeof value !== 'string') return null; const text = value.trim(); const at = text.indexOf('@'); if (at <= 0 || at !== text.lastIndexOf('@') || at === text.length - 1 || /[\s,;<>\x00-\x1f]/.test(text)) return null; return text.slice(0, at) + '@' + text.slice(at + 1).toLowerCase(); }
export function phoneKey(value) { if (typeof value !== 'string') return null; const text = value.trim(); return /^[+0-9][0-9 ()-]*$/.test(text) && /\d/.test(text) ? text : null; }
const unique = values => [...new Set(values)];
export async function buildDataset(sources, options = {}) {
  if (!Array.isArray(sources) || !sources.length || sources.length > LIMITS.sources) fail('sources', '需要 1–10 个本地来源。');
  if (sources.reduce((n, s) => n + (s.source?.inputBytes || 0), 0) > LIMITS.inputBytes) fail('inputLimit', '所有来源合计超过 1 MiB UTF-8。');
  const ids = new Set(); const contacts = [];
  for (const s of sources) { if (!s?.source || !Array.isArray(s.contacts) || !s.contacts.length || ids.has(s.source.id)) fail('sources', '来源结构无效或编号重复。'); ids.add(s.source.id); contacts.push(...s.contacts); }
  if (contacts.length > LIMITS.contacts) fail('contacts', '所有来源合计超过 1000 个联系人。'); const contactIds = new Set(contacts.map(c => c.id)); if (contactIds.size !== contacts.length) fail('ids', '联系人 ID 重复。');
  const canceled = () => { if (options.isCanceled?.()) fail('canceled', '核对已取消，未保留部分候选。'); }; const yieldTask = options.yieldTask || (() => new Promise(r => setTimeout(r, 0)));
  const indices = new Map(); const pairs = new Map(); let checks = 0; canceled();
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]; const keys = unique([...c.emails.map(emailKey).filter(Boolean).map(v => 'email:' + v), ...c.phones.map(phoneKey).filter(Boolean).map(v => 'phone:' + v), ...(c.name.trim() ? ['name:' + c.name.trim()] : [])]);
    for (const key of keys) {
      for (const previous of indices.get(key) || []) {
        const members = [previous.id, c.id].sort(); const pairId = members.join('|');
        if (!pairs.has(pairId)) { if (pairs.size >= LIMITS.candidates) fail('candidates', '冲突候选超过 5000 对，未截断；请减少来源或按批次核对。'); pairs.set(pairId, { id: pairId, members, reasons: [] }); }
        const candidate = pairs.get(pairId); const reason = key.split(':')[0]; if (!candidate.reasons.includes(reason)) candidate.reasons.push(reason);
        if (++checks % 200 === 0) { await yieldTask(); canceled(); }
      }
      const group = indices.get(key) || []; group.push(c); indices.set(key, group);
    }
    if ((i + 1) % 50 === 0) { options.onProgress?.({ processed: i + 1, total: contacts.length }); await yieldTask(); canceled(); }
  }
  canceled(); return { sources: sources.map(s => ({ ...s.source })), contacts, candidates: [...pairs.values()] };
}
function validateDecision(dataset, decision) {
  const candidate = dataset.candidates.find(c => c.id === decision?.candidateId); if (!candidate || !['keep', 'merge'].includes(decision.type)) fail('decision', '只能对当前候选作出保留或合并判定。');
  if (decision.type === 'merge' && (!decision.priority || Object.keys(decision.priority).length !== FIELDS.length || FIELDS.some(f => !candidate.members.includes(decision.priority[f])))) fail('priority', '合并的五个字段优先来源必须从本候选的两个 ID 中选择。'); return candidate;
}
export function mergeCandidate(dataset, candidateId, priority) {
  const candidate = validateDecision(dataset, { candidateId, type: 'merge', priority }); const [a, b] = candidate.members.map(id => dataset.contacts.find(c => c.id === id));
  if (!a || !b) fail('ids', '候选联系人缺失。'); const ordered = field => priority[field] === a.id ? [a, b] : [b, a];
  const names = ordered('name'); const named = names.find(c => c.name) || names[0];
  const merged = { id: `M-${candidate.members.join('+')}`, name: named.name, structuredName: named.structuredName, emails: unique(ordered('email').flatMap(c => c.emails)), phones: unique(ordered('phone').flatMap(c => c.phones)), addresses: unique(ordered('address').flatMap(c => c.addresses.map(v => JSON.stringify(v)))).map(v => JSON.parse(v)), notes: unique(ordered('note').flatMap(c => c.notes)), provenance: [a, b].flatMap(c => c.provenance), unmapped: [a, b].flatMap(c => c.unmapped), sourceFields: [a, b].flatMap(c => c.sourceFields), sourceProperties: [a, b].flatMap(c => c.sourceProperties), mergedFrom: candidate.members, originals: [clone(a), clone(b)] };
  return clone(merged);
}
export function resolveDataset(dataset, decisions = []) {
  if (!dataset?.contacts || !dataset.candidates || !Array.isArray(decisions) || decisions.length > LIMITS.candidates) fail('dataset', '请先生成当前来源的核对结果。');
  const handled = new Set(); const consumed = new Set(); const merged = [];
  for (const decision of decisions) { const candidate = validateDecision(dataset, decision); if (handled.has(candidate.id)) fail('decision', '同一候选不能重复判定。'); handled.add(candidate.id); if (decision.type === 'merge') { if (candidate.members.some(id => consumed.has(id))) fail('exclusive', '联系人已参与其他合并；必须撤销旧合并，不能重复吞并同一 ID。'); candidate.members.forEach(id => consumed.add(id)); merged.push(mergeCandidate(dataset, candidate.id, decision.priority)); } }
  const contacts = [...dataset.contacts.filter(c => !consumed.has(c.id)), ...merged].map(clone);
  const conflicts = dataset.candidates.map(candidate => { const decision = decisions.find(d => d.candidateId === candidate.id); return { ...clone(candidate), status: decision?.type || (candidate.members.some(id => consumed.has(id)) ? 'coveredByOtherMerge' : 'pending'), ...(decision?.priority ? { priority: { ...decision.priority } } : {}) }; });
  const report = { feature: 'T094', version: 1, sources: clone(dataset.sources), originalCount: dataset.contacts.length, outputCount: contacts.length, pendingCount: conflicts.filter(c => c.status === 'pending').length, decisions: clone(decisions), conflicts, unmapped: dataset.contacts.flatMap(c => clone(c.unmapped)), rules: { email: '仅修剪比较用首尾空白、域名小写；local-part 大小写保留，不去点、不移除 +tag、不做 IDNA 或别名猜测。输出保留原值。', phone: '只对符合简单数字格式的原字符串修剪首尾空白后比较；保留 + 和国家码、空格、括号、连字符，不推断国家码。输出原样保留。', name: '首尾空白修剪后精确同名仅为候选，绝不自动合并。', merge: '用户逐对确认；姓名取优先来源第一个非空值，其余字段精确去重并集、优先来源排序在前。原联系人及未映射信息完整保存在合并元数据中。' }, notice: '未确认候选保留原联系人。该报告包含联系人和未映射属性原值，请核对分享范围。CSV 的 metadata_json 和 vCard 的 X-T094-METADATA 保留来源、原始字段/属性及合并前记录，目标通讯录可能忽略扩展字段。' };
  return { feature: 'T094', version: 1, contacts, report };
}
function escapeCard(value) { return String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,'); }
function foldCard(line) { let result = ''; let size = 0; for (const c of line) { const n = bytes(c); if (size + n > 75) { result += '\r\n '; size = 1; } result += c; size += n; } return result; }
function metadata(contact) { const { name, emails, phones, addresses, notes, ...rest } = contact; return rest; }
export function serializeResult(result, format) {
  if (result?.feature !== 'T094' || !Array.isArray(result.contacts) || !result.report) fail('result', '没有可导出的当前结果。'); let content;
  if (format === 'json') content = JSON.stringify(result, null, 2);
  else if (format === 'report') content = JSON.stringify(result.report, null, 2);
  else if (format === 'csv') { const cell = value => { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }; const rows = [['id', 'name', 'emails_json', 'phones_json', 'addresses_json', 'notes_json', 'metadata_json'], ...result.contacts.map(c => [c.id, c.name, JSON.stringify(c.emails), JSON.stringify(c.phones), JSON.stringify(c.addresses), JSON.stringify(c.notes), JSON.stringify(metadata(c))])]; content = rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'; }
  else if (format === 'vcard') { if (result.contacts.some(c => !c.name.trim())) fail('vcardName', 'vCard 副本需要每条有非空姓名 FN；未命名记录请修正来源或先导出 JSON/CSV，不会编造姓名。'); content = result.contacts.map(c => { const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + escapeCard(c.name), 'N:' + (c.structuredName || ['', c.name, '', '', '']).map(escapeCard).join(';'), ...c.emails.map(v => 'EMAIL:' + escapeCard(v)), ...c.phones.map(v => 'TEL:' + escapeCard(v)), ...c.addresses.map(v => 'ADR:' + v.components.map(escapeCard).join(';')), ...c.notes.map(v => 'NOTE:' + escapeCard(v)), 'X-T094-METADATA:' + escapeCard(JSON.stringify(metadata(c))), 'END:VCARD']; return lines.map(foldCard).join('\r\n') + '\r\n'; }).join(''); }
  else fail('format', '只支持 JSON、CSV、vCard 或报告。');
  if (bytes(content) > LIMITS.outputBytes) fail('outputLimit', '当前格式副本超过 8 MiB，未截断；请按批次核对或选择其他格式。'); return content;
}
