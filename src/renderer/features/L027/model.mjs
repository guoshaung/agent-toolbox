export const MODEL_VERSION = 'finite-contract-1';
export const LIMITS = Object.freeze({ bytes: 65536, sampleBytes: 4096, rules: 8, rounds: 24, revisions: 24 });
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const copy = value => JSON.parse(JSON.stringify(value));
const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function fail(message) { throw new Error(message); }
export function capacity(state) { if (bytes(state) > LIMITS.bytes) fail('完整会话超过64KiB，未保存/未新增记录；请先导出完整会话，再开始新会话。'); return state; }
export function rule(field = 'age', type = 'number', required = true, min = '0', max = '120') {
  return { field, type, required, min, max, minLength: '', maxLength: '' };
}
export function initialState() {
  const rules = [rule()];
  return { schemaVersion: 1, draft: { rules, sample: '{"age":130}', prediction: 'pass' }, revisions: [{ id: 1, rules: parseRules(rules) }], rounds: [] };
}
function numeric(text, name, length = false) {
  if (text === '') return null;
  if (typeof text !== 'string' || text.length > 32 || !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) fail(`${name}必须是≤32字符有限十进制数或留空`);
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > 1e9 || length && (!Number.isInteger(value) || value < 0 || value > 512)) fail(`${name}越界：数值绝对值≤10亿，长度为0–512整数`);
  return value;
}
export function parseRules(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > LIMITS.rules) fail('规则数量必须1–8');
  const seen = new Set();
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || typeof row.field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(row.field) || forbidden.has(row.field)) fail(`规则${index + 1}字段须为1–20位英文字母开头，禁止原型字段`);
    if (seen.has(row.field)) fail(`重复规则字段：${row.field}`); seen.add(row.field);
    if (!['number', 'string', 'array', 'boolean'].includes(row.type) || typeof row.required !== 'boolean') fail('规则类型/必填值无效');
    const result = { field: row.field, type: row.type, required: row.required, min: null, max: null, minLength: null, maxLength: null };
    if (row.type === 'number') { result.min = numeric(row.min, '最小值'); result.max = numeric(row.max, '最大值'); }
    if (row.type === 'string' || row.type === 'array') { result.minLength = numeric(row.minLength, '最短长度', true); result.maxLength = numeric(row.maxLength, '最长长度', true); }
    if (result.min !== null && result.max !== null && result.min > result.max || result.minLength !== null && result.maxLength !== null && result.minLength > result.maxLength) fail('下界不得大于上界');
    return result;
  });
}
export function draftRules(rules) {
  return rules.map(row => ({ ...row, min: row.min === null ? '' : String(row.min), max: row.max === null ? '' : String(row.max), minLength: row.minLength === null ? '' : String(row.minLength), maxLength: row.maxLength === null ? '' : String(row.maxLength) }));
}
// Bounded JSON parser: duplicate decoded keys are rejected before any value is stored.
export function parseSample(text) {
  if (typeof text !== 'string' || bytes(text) > LIMITS.sampleBytes) fail('JSON样例须为文本且≤4096 UTF-8字节');
  let pos = 0, count = 0;
  const ws = () => { while (/[ \t\r\n]/.test(text[pos] || '') && pos < text.length) pos++; };
  function string() {
    const start = pos++;
    while (pos < text.length) {
      const char = text[pos++];
      if (char === '\\') { pos++; continue; }
      if (char === '"') {
        let value; try { value = JSON.parse(text.slice(start, pos)); } catch { fail('JSON字符串语法无效'); }
        if ([...value].length > 512 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('字符串最多512 Unicode码点，拒绝孤立代理项');
        return value;
      }
    }
    fail('JSON字符串未结束');
  }
  function value(depth) {
    ws(); if (depth > 4 || ++count > 128) fail('JSON深度≤4、值数量≤128');
    const char = text[pos];
    if (char === '"') return string();
    if (char === '{') {
      pos++; ws(); const object = Object.create(null), keys = new Set();
      if (text[pos] === '}') { pos++; return object; }
      while (true) {
        ws(); if (text[pos] !== '"') fail('JSON对象键须双引号'); const key = string();
        if (forbidden.has(key)) fail(`禁止原型字段：${key}`);
        if (keys.has(key)) fail(`重复JSON键：${key}`); if (keys.size >= 16) fail('每个对象最多16字段'); keys.add(key);
        ws(); if (text[pos++] !== ':') fail('JSON缺少冒号'); object[key] = value(depth + 1); ws();
        if (text[pos] === '}') { pos++; return object; } if (text[pos++] !== ',') fail('JSON缺少逗号或对象结束符');
      }
    }
    if (char === '[') {
      pos++; ws(); const array = []; if (text[pos] === ']') { pos++; return array; }
      while (true) { if (array.length >= 32) fail('每个数组最多32元素'); array.push(value(depth + 1)); ws(); if (text[pos] === ']') { pos++; return array; } if (text[pos++] !== ',') fail('JSON数组语法无效'); }
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(token, pos)) { pos += token.length; return result; }
    const match = text.slice(pos).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (match) { pos += match[0].length; const number = Number(match[0]); if (!Number.isFinite(number) || Math.abs(number) > 1e9) fail('样例数值须有限且绝对值≤10亿'); return number; }
    fail(`JSON语法无效，位置${pos + 1}`);
  }
  const result = value(0); ws(); if (pos !== text.length) fail('JSON尾部存在额外内容');
  if (result === null || typeof result !== 'object' || Array.isArray(result)) fail('样例顶层必须JSON对象');
  return result;
}
export function check(rules, sample) {
  const object = parseSample(sample), violations = [];
  for (const row of rules) {
    const path = `$.${row.field}`;
    if (!Object.hasOwn(object, row.field)) { if (row.required) violations.push({ path, kind: 'required', message: '缺少必填字段' }); continue; }
    const value = object[row.field], actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (actual !== row.type) { violations.push({ path, kind: 'type', message: `应为${row.type}，实际${actual}` }); continue; }
    if (row.type === 'number' && (row.min !== null && value < row.min || row.max !== null && value > row.max)) violations.push({ path, kind: 'range', message: `值${value}超界，闭区间[${row.min ?? '无下界'}, ${row.max ?? '无上界'}]` });
    if (row.type === 'string' || row.type === 'array') {
      const length = row.type === 'string' ? [...value].length : value.length;
      if (row.minLength !== null && length < row.minLength || row.maxLength !== null && length > row.maxLength) violations.push({ path, kind: row.type === 'string' ? 'stringLength' : 'arrayLength', message: `${row.type === 'string' ? 'Unicode码点' : '元素'}长度${length}超界，闭区间[${row.minLength ?? '无下界'}, ${row.maxLength ?? '无上界'}]` });
    }
  }
  return { passed: violations.length === 0, violations };
}
function answer(record) { const result = check(record.rules, record.sample); return { ...result, misjudged: (record.prediction === 'pass') !== result.passed }; }
export function revise(state) {
  const rules = parseRules(state.draft.rules);
  if (same(rules, state.revisions.at(-1).rules)) return copy(state);
  if (state.revisions.length >= LIMITS.revisions) fail('修订已达24条，请导出后开始新会话；未截断历史');
  const next = copy(state); next.revisions.push({ id: next.revisions.length + 1, rules }); return capacity(next);
}
export function submit(state) {
  if (state.rounds.some(row => row.result === null)) fail('先揭示已提交轮次；不能覆盖已锁定预测');
  if (state.rounds.length >= LIMITS.rounds) fail('轮次已达24条，请导出后开始新会话；未截断历史');
  const rules = parseRules(state.draft.rules); if (!same(rules, state.revisions.at(-1).rules)) fail('规则已改变，请先应用规则修订');
  parseSample(state.draft.sample); if (!['pass', 'fail'].includes(state.draft.prediction)) fail('请预测通过或失败');
  const next = copy(state), row = { id: next.rounds.length + 1, revision: next.revisions.at(-1).id, rules: copy(rules), sample: state.draft.sample, prediction: state.draft.prediction, result: null };
  next.rounds.push(row);
  // Reserve the exact future result size without exposing it in a pending record/export.
  const reserved = copy(next); reserved.rounds.at(-1).result = answer(row); capacity(reserved); return capacity(next);
}
export function reveal(state, id) {
  const next = copy(state), row = next.rounds.find(item => item.id === id); if (!row) fail('未知轮次');
  if (row.result !== null) fail('已揭示轮次不可重新判定或覆盖'); row.result = answer(row); return capacity(next);
}
export function prepareStoredState(state) {
  capacity(state);
  if (state?.schemaVersion !== 1) fail('不支持会话版本');
  if (!state.draft || !Array.isArray(state.draft.rules) || state.draft.rules.length < 1 || state.draft.rules.length > 8 || typeof state.draft.sample !== 'string' || bytes(state.draft.sample) > 4096 || !['pass', 'fail'].includes(state.draft.prediction)) fail('草稿字段或容量无效');
  for (const row of state.draft.rules) if (!row || ['field', 'type', 'min', 'max', 'minLength', 'maxLength'].some(key => typeof row[key] !== 'string' || row[key].length > 32) || typeof row.required !== 'boolean') fail('草稿规则字段类型/长度无效');
  if (!Array.isArray(state.revisions) || !state.revisions.length || state.revisions.length > 24 || !Array.isArray(state.rounds) || state.rounds.length > 24) fail('修订/轮次数量无效');
  const next = copy(state);
  next.revisions.forEach((row, i) => { if (row.id !== i + 1 || !same(parseRules(draftRules(row.rules)), row.rules)) fail('修订快照无效'); });
  let pending = 0;
  next.rounds.forEach((row, i) => {
    if (row.id !== i + 1 || !Number.isInteger(row.revision) || !next.revisions[row.revision - 1] || !same(row.rules, next.revisions[row.revision - 1].rules) || !['pass', 'fail'].includes(row.prediction)) fail('轮次快照无效');
    parseSample(row.sample);
    if (row.result === null) { pending++; const reserved = copy(next); reserved.rounds[i].result = answer(row); capacity(reserved); }
    else if (!same(row.result, answer(row))) fail('已揭示结果与锁定快照不一致');
  });
  if (pending > 1 || pending && next.rounds.at(-1).result !== null) fail('未揭示轮次顺序无效');
  return { schemaVersion: 1, draft: copy(next.draft), revisions: next.revisions, rounds: next.rounds };
}
export const validateStoredState = prepareStoredState;
export function reportMarkdown(payload) {
  const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const state = payload.session;
  return ['# L027 数据契约反例训练', '', '有限顶层字段契约；规则修正的合理性由人判断，判定通过不证明接口正确。', '', `已揭示误判：${state.rounds.filter(row => row.result?.misjudged).length}`, '', '## 当前草稿', escape(JSON.stringify(state.draft, null, 2)), '', '## 规则修订', ...state.revisions.map(row => `修订${row.id}\n${escape(JSON.stringify(row.rules))}`), '', '## 完整轮次', ...state.rounds.flatMap(row => [`### 轮次${row.id} / 修订${row.revision}`, `预测：${row.prediction === 'pass' ? '通过' : '失败'}`, `锁定规则：${escape(JSON.stringify(row.rules))}`, `锁定样例：${escape(row.sample)}`, row.result ? `真实：${row.result.passed ? '通过' : '失败'}；误判：${row.result.misjudged ? '是' : '否'}\n${row.result.violations.map(v => `${v.path} ${v.kind} ${escape(v.message)}`).join('\n') || '无违反项'}` : '尚未揭示，不含计算结论', ''])].join('\n');
}
