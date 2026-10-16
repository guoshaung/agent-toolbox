export const LIMITS = Object.freeze({xmlBytes:1048576,nodes:30000,depth:60});
export class TemplateError extends Error { constructor(code) { super('XML结构或容量拒绝');this.code=code; } }
const fail=code=>{throw new TemplateError(code)},enc=new TextEncoder(),XML='http://www.w3.org/XML/1998/namespace',name=/^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
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
// Retain bounded text and namespace metadata; this feature never edits XLSX XML.
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
