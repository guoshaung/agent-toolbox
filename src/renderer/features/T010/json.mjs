// Strict JSON tokenizer adapted from T008/parser.mjs (66785178), extended to
// arbitrary roots and WeakMap provenance. No imports from other features.
export const LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, stringChars: 50000, depth: 32, nodes: 100000, objectFields: 100 });
export function checkAbort(signal) { if (signal?.aborted) throw Object.assign(new Error('已取消处理。'), { name: 'AbortError' }); }
async function checkpoint(hooks) { checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal); }
function decimalMeaning(text) { const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(text); let digits = (match[2] + (match[3] || '')).replace(/^0+/u, ''); if (!digits) return '0'; const tail = digits.length - digits.replace(/0+$/u, '').length; return `${match[1]}${digits.slice(0, digits.length - tail)}e${Number(match[4] || 0) - (match[3]?.length || 0) + tail}`; }
export async function parseJSON(source, hooks = {}) {
  checkAbort(hooks.signal);
  if (!source || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 120 || typeof source.text !== 'string') throw new Error('来源须有名称（最多120字符）与JSON文本。');
  if (source.text.length > LIMITS.bytes || new TextEncoder().encode(source.text).length > LIMITS.bytes) throw new Error('输入超过2 MiB。');
  const text = source.text.startsWith('\uFEFF') ? source.text.slice(1) : source.text;
  let at = 0, line = 1, nextYield = 0, nodes = 0; const objects = new WeakMap(), arrays = new WeakMap();
  const fail = message => { throw new Error(`JSON第${line}行：${message}`); };
  const consume = () => { const ch = text[at++]; if (ch === '\n' || (ch === '\r' && text[at] !== '\n')) line++; return ch; };
  const tick = async () => { if (at >= nextYield) { nextYield = at + 8192; await checkpoint(hooks); } };
  const whitespace = async () => { while (at < text.length && ' \t\r\n'.includes(text[at])) { consume(); await tick(); } };
  async function string() {
    const start = at; consume(); let escaped = false;
    while (at < text.length) {
      const ch = consume(); await tick();
      if (ch === '"' && !escaped) { let result; try { result = JSON.parse(text.slice(start, at)); } catch { fail('字符串转义不合法。'); } if (result.length > LIMITS.stringChars) fail('字符串超过50000单位。'); return result; }
      if (ch === '\\' && !escaped) escaped = true; else escaped = false;
      if (at - start > LIMITS.stringChars * 6 + 2) fail('字符串编码过长。');
    }
    fail('字符串未闭合。');
  }
  async function value(depth) {
    await whitespace(); await tick(); const startLine = line;
    if (depth > LIMITS.depth || ++nodes > LIMITS.nodes) fail('嵌套深度超过32或节点超过100000。');
    if (text[at] === '"') return string();
    if (text[at] === '{') {
      consume(); await whitespace(); const entries = [], keys = new Set();
      if (text[at] === '}') { consume(); const object = {}; objects.set(object, startLine); return object; }
      while (true) {
        if (text[at] !== '"') fail('属性名须为双引号字符串。'); const key = await string(); if (keys.has(key)) fail(`重复属性：${key}`); keys.add(key); if (keys.size > LIMITS.objectFields) fail('每个对象超过100字段。');
        await whitespace(); if (consume() !== ':') fail('属性缺少冒号。'); entries.push([key, await value(depth + 1)]); await whitespace();
        const next = consume(); if (next === '}') { const object = Object.fromEntries(entries); objects.set(object, startLine); return object; }
        if (next !== ',') fail('对象缺少逗号/闭括号。'); await whitespace();
      }
    }
    if (text[at] === '[') {
      consume(); await whitespace(); const list = [], lines = []; objects.set(list, startLine); arrays.set(list, lines);
      if (text[at] === ']') { consume(); return list; }
      while (true) {
        await whitespace(); lines.push(line); list.push(await value(depth + 1)); await whitespace(); const next = consume(); if (next === ']') return list; if (next !== ',') fail('数组缺少逗号/闭括号。');
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(literal, at)) { at += literal.length; return result; }
    const start = at; while (at < text.length && '-+0123456789.eE'.includes(text[at])) { consume(); await tick(); }
    const token = text.slice(start, at); if (token.length > 128 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(token)) fail('不合法JSON值或数字文本超过128字符。');
    const result = Number(token); if (!Number.isFinite(result) || (Number.isInteger(result) && !Number.isSafeInteger(result)) || decimalMeaning(token) !== decimalMeaning(String(result))) fail('数字非有限、不安全整数或发生十进制精度丢失，请用字符串保存。'); return result;
  }
  const root = await value(0); await whitespace(); if (at !== text.length) fail('根值之后有额外内容。'); checkAbort(hooks.signal);
  return { name: source.name, root, objects, arrays };
}
