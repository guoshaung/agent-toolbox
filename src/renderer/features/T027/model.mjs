import { parseZip, preflight, verifyContents, crc32, toBundle } from './zip.mjs';

export const LIMITS = Object.freeze({ templateBytes: 2097152, expandedBytes: 2097152, csvBytes: 262144, rows: 30, columns: 50, fieldChars: 4096, fields: 100, xmlBytes: 1048576, nodes: 30000, depth: 60, outputBytes: 10485760 });
export class TemplateError extends Error { constructor(code) { super('模板、表格或容量校验拒绝；未输出文档。'); this.code = code; } }
const fail = code => { throw new TemplateError(code); };
const enc = new TextEncoder();
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const XML = 'http://www.w3.org/XML/1998/namespace';
const name = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
const fieldName = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export function validText(s) {
 if (typeof s !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/u.test(s)) fail('text_characters');
 for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const d = s.charCodeAt(++i); if (!(d >= 0xdc00 && d <= 0xdfff)) fail('unicode'); } else if (c >= 0xdc00 && c <= 0xdfff) fail('unicode'); }
 return s;
}
export function decodeUTF8(bytes, max) { if (!(bytes instanceof Uint8Array) || bytes.length > max) fail('input_bytes'); try { return validText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch (e) { if (e instanceof TemplateError) throw e; fail('utf8'); } }
export function xmlEscape(s) { return validText(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\r', '&#13;').replaceAll('\n', '&#10;').replaceAll('\t', '&#9;'); }
function entities(s) {
 if (s.includes('<') || s.includes(']]>')) fail('xml_text');
 const out = s.replace(/&([^;\s&]*);/g, (_m, ref) => { const predefined = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }; if (Object.hasOwn(predefined, ref)) return predefined[ref]; let n; if (/^#[0-9]+$/.test(ref)) n = Number(ref.slice(1)); else if (/^#x[0-9a-f]+$/i.test(ref)) n = parseInt(ref.slice(2), 16); else fail('xml_entity'); if (!Number.isSafeInteger(n) || n > 0x10ffff || n < 1 || n >= 0xd800 && n <= 0xdfff) fail('xml_entity'); return validText(String.fromCodePoint(n)); });
 if (s.replace(/&([^;\s&]*);/g, '').includes('&')) fail('xml_entity'); return validText(out);
}
// Bounded XML token parser. No DOM execution, DTD, entities, CDATA or external fetch.
// Preserve original XML byte-equivalent text outside edited w:t opening/content spans.
export function parseXML(source) {
 validText(source); if (enc.encode(source).length > LIMITS.xmlBytes) fail('xml_bytes');
 const nodes = [], stack = []; let root = null, at = 0;
 if (source.startsWith('\ufeff')) at++;
 if (source.startsWith('<?xml', at)) { const end = source.indexOf('?>', at); if (end < 0 || !/^<\?xml\s+version=['"]1\.0['"](?:\s+encoding=['"](?:UTF-8|utf-8)['"])?(?:\s+standalone=['"](?:yes|no)['"])?\s*\?>$/.test(source.slice(at, end + 2))) fail('xml_declaration'); at = end + 2; }
 while (at < source.length) {
  if (source[at] !== '<') { const end = source.indexOf('<', at), to = end < 0 ? source.length : end, text = entities(source.slice(at, to).replace(/\r\n?/g, '\n')); if (!stack.length && text.trim()) fail('xml_outside_root'); if (stack.length) stack.at(-1).texts.push({ start: at, end: to, text }); at = to; continue; }
  if (source.startsWith('<!--', at)) { const end = source.indexOf('-->', at + 4); if (end < 0 || source.slice(at + 4, end).includes('--') || source[end - 1] === '-') fail('xml_comment'); at = end + 3; continue; }
  if (source.startsWith('<!', at) || source.startsWith('<?', at)) fail('xml_construct_unsupported');
  const from = at; let end = at + 1, quote = null;
  for (; end < source.length; end++) { const ch = source[end]; if (quote) { if (ch === quote) quote = null; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break; else if (ch === '<') fail('xml_tag'); }
  if (end >= source.length || quote) fail('xml_tag');
  let inside = source.slice(at + 1, end); at = end + 1;
  if (inside.startsWith('/')) { const q = inside.slice(1).trim(); if (!name.test(q) || !stack.length || stack.at(-1).q !== q) fail('xml_nesting'); const n = stack.pop(); n.closeStart = from; n.end = at; continue; }
  const self = inside.endsWith('/'); if (self) inside = inside.slice(0, -1);
  const hit = /^[^\s]+/.exec(inside); if (!hit || !name.test(hit[0])) fail('xml_name');
  const q = hit[0], attrs = Object.create(null); let p = q.length;
  while (p < inside.length) { if (!/\s/.test(inside[p])) fail('xml_attribute'); while (/\s/.test(inside[p] || '') && p < inside.length) p++; if (p === inside.length) break; const m = /^([^\s=]+)\s*=\s*(['"])/.exec(inside.slice(p)); if (!m || !name.test(m[1]) || Object.hasOwn(attrs, m[1])) fail('xml_attribute'); const a = p + m[0].length, b = inside.indexOf(m[2], a); if (b < 0) fail('xml_attribute'); attrs[m[1]] = entities(inside.slice(a, b).replace(/[\r\n\t]/g, ' ')); p = b + 1; }
  const parent = stack.at(-1) || null, ns = Object.assign(Object.create(null), parent?.ns || { xml: XML });
  for (const [k, v] of Object.entries(attrs)) { if (k === 'xmlns') { if ([XML, 'http://www.w3.org/2000/xmlns/'].includes(v)) fail('xml_namespace'); ns[''] = v; } else if (k.startsWith('xmlns:')) { const pref = k.slice(6); if (!v || pref === 'xmlns' || pref === 'xml' && v !== XML || pref !== 'xml' && v === XML || v === 'http://www.w3.org/2000/xmlns/') fail('xml_namespace'); ns[pref] = v; } }
  const parts = q.split(':'), prefix = parts.length === 2 ? parts[0] : '', local = parts.at(-1); if (prefix && !ns[prefix]) fail('xml_namespace');
  const seen = new Set(); for (const k of Object.keys(attrs)) { if (k === 'xmlns' || k.startsWith('xmlns:')) continue; const a = k.split(':'), ap = a.length === 2 ? a[0] : ''; if (ap && !ns[ap]) fail('xml_namespace'); const key = (ap ? ns[ap] : '') + '#' + a.at(-1); if (seen.has(key)) fail('xml_duplicate_expanded_attribute'); seen.add(key); }
  const n = { q, local, uri: ns[prefix] || '', attrs, ns, parent, children: [], texts: [], start: from, openEnd: at, closeStart: self ? at : null, end: self ? at : null, self };
  nodes.push(n); if (nodes.length > LIMITS.nodes || stack.length >= LIMITS.depth) fail('xml_capacity'); if (parent) parent.children.push(n); else { if (root) fail('xml_multiple_roots'); root = n; } if (!self) stack.push(n);
 }
 if (!root || stack.length) fail('xml_nesting'); return { root, nodes, source };
}
function attr(n, k) { return n.attrs[k]; }
function strictElement(n, uri, local, allowed) { if (n.uri !== uri || n.local !== local || n.children.length || n.texts.some(t => t.text.trim()) || Object.keys(n.attrs).some(k => !k.startsWith('xmlns') && !allowed.includes(k))) fail('opc_structure'); }
function relTarget(part, target) {
 if (typeof target !== 'string' || !target || /[\\%?#:\x00-\x20]/.test(target) || target.startsWith('/') || target.normalize('NFC') !== target) fail('relationship_target');
 const base = part === '_rels/.rels' ? '' : part.slice(0, part.indexOf('/_rels/') + 1), pieces = base.split('/').filter(Boolean);
 for (const p of target.split('/')) { if (!p || p === '.') fail('relationship_target'); if (p === '..') { if (!pieces.length) fail('relationship_target'); pieces.pop(); } else pieces.push(p); }
 return pieces.join('/');
}
function paragraphs(doc) {
 if (doc.root.uri !== W || doc.root.local !== 'document') fail('document_root_unsupported');
 const bodies = doc.nodes.filter(n => n.uri === W && n.local === 'body'); if (bodies.length !== 1 || bodies[0].parent !== doc.root) fail('document_body');
 const blocked = new Set(['fldChar', 'instrText', 'fldSimple', 'del', 'ins', 'moveFrom', 'moveTo', 'txbxContent', 'sdt', 'customXml', 'altChunk', 'subDoc', 'tab', 'br', 'cr', 'sym', 'delText']);
 for (const n of doc.nodes) if (n.uri === W && blocked.has(n.local) || n.local === 'AlternateContent') fail('document_construct_unsupported');
 const result = [], byNode = new Map();
 for (const n of doc.nodes.filter(n => n.uri === W && n.local === 'p')) { let a = n.parent; while (a && a !== bodies[0]) { if (a.uri === W && a.local === 'p') fail('nested_paragraph'); a = a.parent; } if (!a) fail('paragraph_outside_body'); const p = { node: n, texts: [], text: '' }; result.push(p); byNode.set(n, p); }
 for (const n of doc.nodes.filter(n => n.uri === W && n.local === 't')) { let p = n.parent; while (p && !(p.uri === W && p.local === 'p')) p = p.parent; const para = byNode.get(p); if (n.children.length || n.texts.length > 1 || n.parent?.uri !== W || n.parent.local !== 'r' || !para) fail('text_position_unsupported'); para.texts.push(n); para.text += n.texts.map(t => t.text).join(''); }
 return result;
}
function placeholders(text) { const matches = [...text.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]{0,63})\}\}/g)]; if (/\{\{|\}\}/.test(text.replace(/\{\{([A-Za-z_][A-Za-z0-9_]{0,63})\}\}/g, ''))) fail('placeholder_malformed_or_split_paragraph'); return matches; }
export async function loadTemplate(bytes, options = {}) {
 if (!(bytes instanceof Uint8Array) || bytes.length > LIMITS.templateBytes) fail('template_bytes');
 const parsed = parseZip(bytes), pre = preflight(parsed, { allowedBytes: LIMITS.expandedBytes, maxRatio: 1000 }); if (pre.status === 'rejected') fail(pre.risks[0]?.code || 'zip_rejected'); if (pre.files > 50) fail('part_count');
 const verified = await verifyContents(bytes, parsed, pre, options), parts = new Map(verified.files.map(p => [p.path, p]));
 for (const needed of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) if (!parts.has(needed)) fail('missing_opc_part');
 const xmls = new Map(); for (const [path, part] of parts) { if (/vba|embeddings|activex|_xmlsignatures|customxml/i.test(path)) fail('active_package_unsupported'); if (/\.(xml|rels)$/i.test(path)) xmls.set(path, parseXML(decodeUTF8(part.data, LIMITS.xmlBytes))); }
 const ct = xmls.get('[Content_Types].xml'); if (ct.root.uri !== CT || ct.root.local !== 'Types' || ct.root.texts.some(t => t.text.trim())) fail('content_types'); const overrides = new Map(), defaults = new Map();
 for (const n of ct.root.children) { if (n.local === 'Default') { strictElement(n, CT, 'Default', ['Extension', 'ContentType']); const ext = attr(n, 'Extension'), type = attr(n, 'ContentType'); if (!/^[A-Za-z0-9]+$/.test(ext || '') || !type || defaults.has(ext.toLowerCase())) fail('content_types'); defaults.set(ext.toLowerCase(), type); } else { strictElement(n, CT, 'Override', ['PartName', 'ContentType']); const p = attr(n, 'PartName'), type = attr(n, 'ContentType'); if (!p?.startsWith('/') || !type || !parts.has(p.slice(1)) || overrides.has(p.slice(1))) fail('content_types'); overrides.set(p.slice(1), type); } }
 for (const p of parts.keys()) { if (p === '[Content_Types].xml') continue; const mime = overrides.get(p) || defaults.get(p.split('.').at(-1).toLowerCase()); if (!mime || /macro|vba|oleobject|activex|signature/i.test(mime)) fail('content_type_unsupported'); }
 if (overrides.get('word/document.xml') !== MAIN) fail('main_content_type_unsupported');
 let officeCount = 0; const relationshipIDs = new Map();
 for (const [p, doc] of xmls) if (p.endsWith('.rels')) { if (doc.root.uri !== REL || doc.root.local !== 'Relationships' || doc.root.texts.some(t => t.text.trim())) fail('relationships'); let source = ''; if (p !== '_rels/.rels') { const match = /^(.*)\/_rels\/([^/]+)\.rels$/.exec(p); if (!match || !parts.has(match[1] + '/' + match[2])) fail('relationship_source'); source = match[1] + '/' + match[2]; } const ids = new Set(); relationshipIDs.set(source, ids); for (const n of doc.root.children) { strictElement(n, REL, 'Relationship', ['Id', 'Type', 'Target', 'TargetMode']); const id = attr(n, 'Id'), type = attr(n, 'Type'); if (!id || ids.has(id) || !type || attr(n, 'TargetMode') && attr(n, 'TargetMode') !== 'Internal') fail('external_or_invalid_relationship'); ids.add(id); if (/oleObject|attachedTemplate|aFChunk|subDocument|vbaProject/i.test(type)) fail('relationship_unsupported'); const target = relTarget(p, attr(n, 'Target')); if (!parts.has(target)) fail('relationship_missing_target'); if (p === '_rels/.rels' && type === OFFICE) { officeCount++; if (target !== 'word/document.xml') fail('main_target_unsupported'); } } }
 for (const [p, doc] of xmls) for (const n of doc.nodes) for (const [q, value] of Object.entries(n.attrs)) { const pair = q.split(':'); if (pair.length === 2 && n.ns[pair[0]] === OFFICE.slice(0, -15) && ['id', 'embed', 'link'].includes(pair[1]) && !relationshipIDs.get(p)?.has(value)) fail('relationship_reference_missing'); }
 if (officeCount !== 1) fail('office_relationship');
 const doc = xmls.get('word/document.xml'), ps = paragraphs(doc), found = new Set(); for (const p of ps) for (const m of placeholders(p.text)) found.add(m[1]); if (!found.size || found.size > LIMITS.fields) fail('placeholder_count');
 for (const [p, x] of xmls) { for (const n of x.nodes) if (Object.values(n.attrs).some(v => /\{\{|\}\}/.test(v))) fail('placeholder_in_attribute'); if (p !== 'word/document.xml') { const text = x.nodes.flatMap(n => n.texts.map(t => t.text)).join(''); if (/\{\{|\}\}/.test(text)) fail('placeholder_outside_main'); } else if (x.nodes.some(n => n.texts.some(t => /\{\{|\}\}/.test(t.text)) && !(n.uri === W && n.local === 't'))) fail('placeholder_outside_text'); }
 return { parts: verified.files, xml: doc, paragraphs: ps, fields: [...found].sort(), sha256: await sha(bytes), sourceBytes: bytes.length };
}
export function parseCSV(text) {
 validText(text); if (enc.encode(text).length > LIMITS.csvBytes) fail('csv_bytes'); if (text.startsWith('\ufeff')) text = text.slice(1); const rows = []; let row = [], value = '', state = 'start', line = 1, rowLine = 1;
 const cell = () => { if (value.length > LIMITS.fieldChars) fail('csv_cell_limit'); row.push(value); if (row.length > LIMITS.columns) fail('csv_columns'); value = ''; state = 'start'; };
 const finish = () => { cell(); rows.push({ values: row, line: rowLine }); if (rows.length > LIMITS.rows + 1) fail('csv_rows'); row = []; rowLine = line; };
 for (let i = 0; i < text.length; i++) { const c = text[i]; if (state === 'quoted') { if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else state = 'closed'; } else { value += c; if (c === '\n') line++; } } else if (c === ',' || c === '\r' || c === '\n') { if (c === ',') cell(); else { if (c === '\r' && text[i + 1] !== '\n') fail('csv_bare_cr'); if (c === '\r') i++; line++; finish(); rowLine = line; } } else if (state === 'closed') fail('csv_after_quote'); else if (c === '"') { if (state !== 'start' || value) fail('csv_quote'); state = 'quoted'; } else { state = 'plain'; value += c; } if (value.length > LIMITS.fieldChars) fail('csv_cell_limit'); }
 if (state === 'quoted') fail('csv_unclosed_quote'); if (row.length || value.length || state !== 'start') finish();
 if (rows.length < 2) fail('csv_records'); const headers = rows.shift().values; if (headers.some(h => !h.length || h.length > 64 || h.trim() !== h || /[\r\n\t]/.test(h)) || new Set(headers).size !== headers.length) fail('csv_headers'); for (const r of rows) if (r.values.length !== headers.length) fail('csv_ragged'); return { headers, rows };
}
export function policies(fields, headers, input) {
 if (!Array.isArray(input) || input.length !== fields.length) fail('mapping'); const seen = new Set(); for (const p of input) { if (!p || Object.keys(p).sort().join(',') !== 'column,field,required' || !fieldName.test(p.field) || !fields.includes(p.field) || seen.has(p.field) || !headers.includes(p.column) || typeof p.required !== 'boolean') fail('mapping'); seen.add(p.field); } return input.map(p => ({ ...p }));
}
export function fillXML(template, values) {
 const replacements = [], preview = [];
 for (const p of template.paragraphs) { const texts = p.texts.map(n => n.texts.map(t => t.text).join('')), starts = []; let offset = 0; for (const t of texts) { starts.push(offset); offset += t.length; }
  for (const m of [...placeholders(p.text)].reverse()) { const start = m.index, end = start + m[0].length; let inserted = false; for (let i = 0; i < texts.length; i++) { const lo = starts[i], hi = lo + p.texts[i].texts.map(t => t.text).join('').length; if (hi <= start || lo >= end) continue; const a = Math.max(0, start - lo), b = Math.min(hi - lo, end - lo); texts[i] = texts[i].slice(0, a) + (inserted ? '' : values[m[1]]) + texts[i].slice(b); inserted = true; } if (!inserted) fail('replacement_internal'); }
  preview.push(texts.join(''));
  for (let i = 0; i < texts.length; i++) { const n = p.texts[i]; if (texts[i] === n.texts.map(t => t.text).join('')) continue; let opening = template.xml.source.slice(n.start, n.openEnd); if (Object.hasOwn(n.attrs, 'xml:space')) opening = opening.replace(/xml:space\s*=\s*(['"])(.*?)\1/, 'xml:space="preserve"'); else opening = opening.slice(0, -1) + ' xml:space="preserve">'; replacements.push({ start: n.start, end: n.closeStart, text: opening + xmlEscape(texts[i]) }); }
 }
 let xml = template.xml.source; for (const r of replacements.sort((a, b) => b.start - a.start)) xml = xml.slice(0, r.start) + r.text + xml.slice(r.end); parseXML(xml); return { xml, preview };
}
// Complete ordinary Store ZIP, fixed metadata, canonical UTF8 names, CRC both headers.
export function writeZip(parts) {
 let total = 22; const records = parts.map(p => { const name = enc.encode(p.path), data = p.data; total += 76 + name.length * 2 + data.length; return { name, data, crc: crc32(data) }; }); if (total > 2097152) fail('output_docx_bytes'); const out = new Uint8Array(total), v = new DataView(out.buffer); let at = 0; const offsets = [];
 for (const r of records) { offsets.push(at); v.setUint32(at, 0x04034b50, true); v.setUint16(at + 4, 20, true); v.setUint16(at + 6, 2048, true); v.setUint16(at + 12, 33, true); v.setUint32(at + 14, r.crc, true); v.setUint32(at + 18, r.data.length, true); v.setUint32(at + 22, r.data.length, true); v.setUint16(at + 26, r.name.length, true); out.set(r.name, at + 30); out.set(r.data, at + 30 + r.name.length); at += 30 + r.name.length + r.data.length; }
 const central = at; for (let i = 0; i < records.length; i++) { const r = records[i]; v.setUint32(at, 0x02014b50, true); v.setUint16(at + 4, 20, true); v.setUint16(at + 6, 20, true); v.setUint16(at + 8, 2048, true); v.setUint16(at + 14, 33, true); v.setUint32(at + 16, r.crc, true); v.setUint32(at + 20, r.data.length, true); v.setUint32(at + 24, r.data.length, true); v.setUint16(at + 28, r.name.length, true); v.setUint32(at + 42, offsets[i], true); out.set(r.name, at + 46); at += 46 + r.name.length; }
 v.setUint32(at, 0x06054b50, true); v.setUint16(at + 8, records.length, true); v.setUint16(at + 10, records.length, true); v.setUint32(at + 12, at - central, true); v.setUint32(at + 16, central, true); return out;
}
export async function sha(data) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(v => v.toString(16).padStart(2, '0')).join(''); }
function canceled(options) { if (options.isCanceled?.() || options.signal?.aborted) fail('canceled'); if (options.clock && options.deadline !== undefined && options.clock() >= options.deadline) fail('deadline'); }
export async function generate(template, table, mapping, options = {}) {
 const rules = policies(template.fields, table.headers, mapping), files = [], records = []; let total = 0;
 for (let i = 0; i < table.rows.length; i++) { canceled(options); const row = table.rows[i], missing = [], values = Object.create(null); for (const p of rules) { const value = row.values[table.headers.indexOf(p.column)]; if (p.required && !value.trim()) missing.push({ field: p.field, column: p.column }); values[p.field] = value; }
  if (missing.length) { records.push({ record: i + 1, physicalLine: row.line, status: 'missing_required', missing, path: null }); continue; }
  const filled = fillXML(template, values), data = writeZip(template.parts.map(p => p.path === 'word/document.xml' ? { ...p, data: enc.encode(filled.xml) } : p)), path = 'documents/record-' + String(i + 1).padStart(3, '0') + '.docx', digest = await sha(data); canceled(options); total += data.length; if (total > LIMITS.outputBytes) fail('output_total_bytes'); files.push({ path, data, bytes: data.length, sha256: digest }); records.push({ record: i + 1, physicalLine: row.line, status: 'generated', path, bytes: data.length, sha256: digest, preview: filled.preview }); await new Promise(r => setTimeout(r, 0)); canceled(options);
 }
 const report = { format: 'T027-word-template-batch', version: 1, templateSHA256: template.sha256, templateBytes: template.sourceBytes, scope: '有限主文档段落/表格纯文本；文本结构预览不代表Word排版；替换使用首个文字run格式，保留未编辑部件内容。', mapping: rules, inputRecords: table.rows.length, generated: files.length, rejected: records.filter(r => r.status === 'missing_required').length, records };
 const reportData = enc.encode(JSON.stringify(report, null, 2) + '\n'); total += reportData.length; if (reportData.length > 2097152 || total > LIMITS.outputBytes) fail('output_total_bytes'); files.push({ path: 'report.json', data: reportData, bytes: reportData.length, sha256: await sha(reportData) }); canceled(options); return { report, files, totalBytes: total };
}
export function bundle(result) { if (!result?.report || !result.report.generated) fail('no_documents'); return toBundle(result, 'Word模板填表副本'); }
