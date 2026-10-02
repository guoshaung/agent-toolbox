import { load, JSON_SCHEMA } from './vendor/js-yaml.mjs';

export const LIMITS = Object.freeze({ configs: 5, inputBytes: 65536, depth: 8, nodes: 2000, rulePaths: 100, pathChars: 512, outputBytes: 4194304 });
export class ConfigError extends Error { constructor(code) { super('输入语法、规则或容量不支持；源内容和解析上下文未回显。'); this.name = 'ConfigError'; this.code = code; } }
const fail = code => { throw new ConfigError(code); }; const encoder = new TextEncoder();
function unicode(text) { for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const n = text.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail('invalid_unicode'); } else if (c >= 0xdc00 && c <= 0xdfff) fail('invalid_unicode'); } }
export function checkText(text) { if (typeof text !== 'string' || text.length > LIMITS.inputBytes || encoder.encode(text).length > LIMITS.inputBytes) fail('input_limit'); unicode(text); if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || /\r(?!\n)/.test(text)) fail('invalid_control'); return text; }
export function parseStrictJSON(text) {
  checkText(text); let at = 0; let nodes = 0; const ws = () => { while (/[\x20\t\r\n]/.test(text[at] || '\0')) at++; };
  function string() { const start = at++; while (at < text.length) { const c = text[at++]; if (c === '"') { try { const value = JSON.parse(text.slice(start, at)); unicode(value); return value; } catch (error) { if (error instanceof ConfigError) throw error; fail('json_syntax'); } } if (c === '\\') at++; else if (c.charCodeAt(0) < 32) fail('json_syntax'); } fail('json_syntax'); }
  function value(depth = 0) { if (depth > LIMITS.depth || ++nodes > LIMITS.nodes) fail('structure_limit'); ws(); const c = text[at]; if (c === '"') return string(); if (c === '{') { at++; const out = Object.create(null); ws(); if (text[at] === '}') { at++; return out; } while (true) { ws(); if (text[at] !== '"') fail('json_syntax'); const key = string(); if (Object.hasOwn(out, key)) fail('json_duplicate_key'); ws(); if (text[at++] !== ':') fail('json_syntax'); out[key] = value(depth + 1); ws(); const next = text[at++]; if (next === '}') return out; if (next !== ',') fail('json_syntax'); } } if (c === '[') { at++; const out = []; ws(); if (text[at] === ']') { at++; return out; } while (true) { out.push(value(depth + 1)); ws(); const next = text[at++]; if (next === ']') return out; if (next !== ',') fail('json_syntax'); } } for (const [token, result] of [['true', true], ['false', false], ['null', null]]) if (text.slice(at, at + token.length) === token) { at += token.length; return result; } const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at)); if (!match) fail('json_syntax'); at += match[0].length; const n = Number(match[0]); if (!Number.isFinite(n)) fail('nonfinite_number'); return n; }
  const out = value(); ws(); if (at !== text.length) fail('json_syntax'); return out;
}
export const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const escape = key => key.replace(/~/g, '~0').replace(/\//g, '~1');
function pathValid(path) { if (typeof path !== 'string' || !path.startsWith('/') || path.length > LIMITS.pathChars || /~(?![01])/.test(path) || /[\x00-\x1f\x7f]/.test(path)) fail('rule_path'); unicode(path); return path; }
function ignored(path, list) { return list.some(p => path === p || path.startsWith(p + '/')); }
export function flatten(root) {
  if (kind(root) !== 'object') fail('root_object_required'); let count = 0; const out = new Map(); const seen = new Set();
  function visit(value, path, depth) { if (depth > LIMITS.depth || ++count > LIMITS.nodes) fail('structure_limit'); const type = kind(value); if (!['object', 'array', 'string', 'number', 'boolean', 'null'].includes(type)) fail('unsupported_value'); if (type === 'number' && !Number.isFinite(value)) fail('nonfinite_number'); if (type === 'string') unicode(value); if (path) { if (path.length > LIMITS.pathChars) fail('path_limit'); out.set(path, type); }
    if (type === 'object' || type === 'array') { if (seen.has(value)) fail('repeated_object'); seen.add(value); for (const key of Object.keys(value)) { if (key.length > 128 || /[\x00-\x1f\x7f]/.test(key)) fail('key_limit'); unicode(key); visit(value[key], path + '/' + escape(key), depth + 1); } } }
  visit(root, '', 0); return out;
}
export function parseConfig(text, format = 'json') {
  checkText(text); let root;
  if (format === 'json') root = parseStrictJSON(text);
  else if (format === 'yaml') {
    // Conservatively reject candidates even in quotes/comments; never build an alias graph.
    if (/[&*!?{}\[\]]/.test(text) || text.includes('<<') || /^\s*(?:%|\?\s)/m.test(text)) fail('yaml_unsupported_token');
    try { root = load(text, { schema: JSON_SCHEMA, json: false, maxDepth: LIMITS.depth, maxTotalMergeKeys: 0, onWarning: () => fail('yaml_warning') }); } catch (error) { if (error instanceof ConfigError) throw error; fail('yaml_syntax'); }
  } else fail('format_unsupported');
  return flatten(root); // Only path/type metadata survives parsing.
}
export const EXAMPLE_RULES = '{\n  "format": "T051-rules",\n  "version": 1,\n  "ignore": []\n}';
export function parseRules(text, baseline) {
  const root = parseStrictJSON(text); if (kind(root) !== 'object' || root.format !== 'T051-rules' || root.version !== 1 || Object.keys(root).some(k => !['format', 'version', 'required', 'ignore'].includes(k))) fail('rules_version_or_keyword');
  function list(value) { if (!Array.isArray(value) || value.length > LIMITS.rulePaths) fail('rules_limit'); const paths = value.map(pathValid); if (new Set(paths).size !== paths.length) fail('rule_duplicate_path'); return paths; }
  const ignore = Object.hasOwn(root, 'ignore') ? list(root.ignore) : []; const required = Object.hasOwn(root, 'required') ? list(root.required) : [...baseline.keys()].filter(p => !ignored(p, ignore));
  for (const p of required) if (!baseline.has(p) || ignored(p, ignore)) fail('required_not_baseline_or_ignored'); return { required: new Set(required), ignore };
}
export async function audit({ configs, rulesText = EXAMPLE_RULES }, options = {}) {
  if (!Array.isArray(configs) || configs.length < 2 || configs.length > LIMITS.configs) fail('config_count'); const stopped = () => { if (options.isCanceled?.()) fail('canceled'); }; const yieldTask = options.yieldTask || (() => new Promise(r => setTimeout(r, 0))); stopped();
  const maps = []; for (let i = 0; i < configs.length; i++) { stopped(); maps.push(parseConfig(configs[i].text, configs[i].format)); await yieldTask(); stopped(); }
  const base = maps[0]; const rules = parseRules(rulesText, base); const records = []; let processed = 0; const counts = { missingRequired: 0, optionalMissing: 0, typeMismatch: 0, extra: 0, pass: 0, ignored: 0 };
  for (let i = 1; i < maps.length; i++) { const paths = [...new Set([...base.keys(), ...maps[i].keys()])].sort(); for (const path of paths) { stopped(); if (ignored(path, rules.ignore)) { counts.ignored++; continue; } const expected = base.get(path) || 'absent'; const actual = maps[i].get(path) || 'absent'; const required = rules.required.has(path); const status = expected === 'absent' ? 'extra' : actual === 'absent' ? required ? 'missingRequired' : 'optionalMissing' : expected !== actual ? 'typeMismatch' : 'pass'; counts[status]++; records.push({ source: `配置${i + 1}`, path, expected, actual, required, status }); if (++processed % 50 === 0) { options.onProgress?.({ processed }); await yieldTask(); stopped(); } } }
  const common = [...base].filter(([path, type]) => !ignored(path, rules.ignore) && maps.every(m => m.get(path) === type)).map(([path, type]) => ({ path, type })).sort((a, b) => a.path.localeCompare(b.path)); stopped();
  return { format: 'T051-report', version: 1, sources: configs.map((_, i) => `配置${i + 1}`), baseline: '配置1', accepted: counts.missingRequired === 0 && counts.typeMismatch === 0, definition: 'Paths and types only; common does not imply equal values. Arrays use zero-based positional indices; ignored paths exclude their entire subtree.', rules: { required: [...rules.required].sort(), ignore: [...rules.ignore] }, counts, records, common };
}
export function exportReport(report, extension = 'json') { if (!report || report.format !== 'T051-report' || report.version !== 1) fail('report_required'); let text; if (extension === 'json') text = JSON.stringify(report, null, 2); else if (extension === 'md') { const safe = value => String(value).replace(/[|\\`<>]/g, c => '&#' + c.charCodeAt(0) + ';'); text = '# T051 配置一致性报告\n\n仅路径和类型；公共项不表示值相等。源文件名称、内容、值均未导出。\n\n基准：配置1\n\n' + '结果：' + (report.accepted ? '类型与必需检查通过' : '未通过') + '\n\n|来源|路径|预期类型|实际类型|必需|状态|\n|---|---|---|---|---|---|\n' + report.records.map(r => [r.source, r.path, r.expected, r.actual, r.required, r.status].map(safe).join('|')).join('\n') + '\n\n公共路径/类型（非值相等）：\n\n' + report.common.map(r => '- ' + safe(r.path) + ' : ' + r.type).join('\n') + '\n\n规则：\n\n' + safe(JSON.stringify(report.rules)) + '\n'; } else fail('export_format'); if (encoder.encode(text).length > LIMITS.outputBytes) fail('output_limit'); return text; }
