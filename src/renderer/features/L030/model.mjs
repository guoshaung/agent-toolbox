export const MODEL_VERSION = 'L030-finite-typed-ast-v1';
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
export function example(kind = 'integer') {
  if (kind === 'demorgan') return { left: '!(x && (y || z))', right: '!x || (!y && !z)', variables: ['x', 'y', 'z'].map(name => ({ name, values: 'false true' })) };
  if (kind === 'precedence') return { left: 'x + 1 * 2', right: '(x + 1) * 2', variables: [{ name: 'x', values: '-1 0 1 2' }] };
  return { left: 'x*x', right: 'x', variables: [{ name: 'x', values: '-1 0 1 2' }] };
}
export function domains(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 3) throw new Error('变量须1–3个');
  const seen = new Set(); let total = 1;
  const variables = rows.map(row => {
    if (!row || !['x', 'y', 'z'].includes(row.name) || seen.has(row.name)) throw new Error('变量名仅x/y/z且不可重复'); seen.add(row.name);
    if (typeof row.values !== 'string' || bytes(row.values) > 2048) throw new Error('每变量域须≤2048 UTF-8字节文本');
    const tokens = row.values.trim() ? row.values.trim().split(/[\s,]+/) : []; if (tokens.length < 1 || tokens.length > 100) throw new Error('每变量域须1–100唯一整数或布尔值');
    let type = null; const used = new Set();
    const values = tokens.map(token => {
      let item;
      if (token === 'true' || token === 'false') item = { type: 'bool', value: token === 'true' };
      else if (/^-?(?:0|[1-9]\d*)$/.test(token) && token.length <= 8) { const number = BigInt(token); if (number < -1000000n || number > 1000000n) throw new Error('输入整数绝对值≤1000000'); item = { type: 'int', value: String(number) }; }
      else throw new Error('变量域只允许整数或true/false，无小数/对象/代码');
      if (type !== null && type !== item.type) throw new Error('同一变量域禁止混合整数与布尔'); type = item.type;
      const key = String(item.value); if (used.has(key)) throw new Error('变量域含重复值（-0与0也重复）'); used.add(key); return item;
    });
    total *= values.length; if (total > 10000) throw new Error('Cartesian域超过10000，拒绝而不截断'); return { name: row.name, type, values };
  });
  return { variables, total };
}
const precedence = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6 };
export function parseExpression(text, variableTypes) {
  if (typeof text !== 'string' || bytes(text) > 2048) throw new Error('表达式须≤2048 UTF-8字节');
  const tokens = []; let pos = 0;
  while (pos < text.length) {
    if (/[ \t\r\n]/.test(text[pos])) { pos++; continue; }
    const match = /^(?:\d+|[A-Za-z_][A-Za-z0-9_]*|==|!=|<=|>=|&&|\|\||[()+*\-!<>])/.exec(text.slice(pos));
    if (!match) throw new Error(`不支持的语法位置${pos + 1}（无小数/除法/JS）`);
    tokens.push(match[0]); pos += match[0].length; if (tokens.length > 128) throw new Error('表达式token超过128');
  }
  if (!tokens.length) throw new Error('表达式不能为空'); let cursor = 0, parentheses = 0;
  function node(kind, fields, type, children = []) { const depth = 1 + Math.max(0, ...children.map(child => child.depth)); if (depth > 32) throw new Error('AST深度超过32'); return { kind, ...fields, type, depth }; }
  function primary() {
    const token = tokens[cursor++]; if (token === undefined) throw new Error('表达式缺少操作数');
    if (['!', '+', '-'].includes(token)) { const child = primary(); if (child.type !== (token === '!' ? 'bool' : 'int')) throw new Error(`一元${token}类型不匹配，无隐式转换`); return node('unary', { op: token, child }, child.type, [child]); }
    if (token === '(') { if (++parentheses > 32) throw new Error('括号嵌套超过32'); const result = expression(1); if (tokens[cursor++] !== ')') throw new Error('缺少右括号'); parentheses--; return result; }
    if (token === 'true' || token === 'false') return node('literal', { value: token === 'true' }, 'bool');
    if (/^\d+$/.test(token)) { if (!/^(?:0|[1-9]\d*)$/.test(token) || token.length > 7 || BigInt(token) > 1000000n) throw new Error('字面整数须0–1000000，无前导零'); return node('literal', { value: token }, 'int'); }
    if (['x', 'y', 'z'].includes(token) && Object.hasOwn(variableTypes, token)) return node('variable', { name: token }, variableTypes[token]);
    throw new Error(`未知操作数/未声明变量：${token}`);
  }
  function expression(minimum) {
    let left = primary();
    while (precedence[tokens[cursor]] >= minimum) {
      const op = tokens[cursor++], right = expression(precedence[op] + 1);
      const boolean = ['&&', '||'].includes(op), equal = ['==', '!='].includes(op), arithmetic = ['+', '-', '*'].includes(op);
      if (boolean ? left.type !== 'bool' || right.type !== 'bool' : equal ? left.type !== right.type : left.type !== 'int' || right.type !== 'int') throw new Error(`运算${op}类型不匹配，无隐式转换`);
      left = node('binary', { op, left, right }, arithmetic ? 'int' : 'bool', [left, right]);
    }
    return left;
  }
  const ast = expression(1); if (cursor !== tokens.length) throw new Error(`多余token：${tokens[cursor]}`); return { ast, tokens: tokens.length, type: ast.type };
}
function bounded(value) { if ((value < 0n ? -value : value).toString().length > 128) throw new Error('中间整数超过128十进制位'); return value; }
export function evaluate(ast, input) {
  function visit(node) {
    if (node.kind === 'literal') return node.type === 'int' ? BigInt(node.value) : node.value;
    if (node.kind === 'variable') return node.type === 'int' ? BigInt(input[node.name].value) : input[node.name].value;
    if (node.kind === 'unary') { const value = visit(node.child); return node.op === '!' ? !value : node.op === '-' ? bounded(-value) : bounded(value); }
    const left = visit(node.left);
    if (node.op === '&&' && !left) return false; if (node.op === '||' && left) return true;
    const right = visit(node.right);
    switch (node.op) { case '+': return bounded(left + right); case '-': return bounded(left - right); case '*': return bounded(left * right); case '&&': return left && right; case '||': return left || right; case '==': return left === right; case '!=': return left !== right; case '<': return left < right; case '<=': return left <= right; case '>': return left > right; case '>=': return left >= right; default: throw new Error('未知AST运算'); }
  }
  try { const value = visit(ast); return { ok: true, type: ast.type, value: ast.type === 'int' ? value.toString() : value }; } catch (error) { return { ok: false, error: error.message }; }
}
export function compile(draft) { const domain = domains(draft?.variables), types = Object.fromEntries(domain.variables.map(row => [row.name, row.type])); return { domain, left: parseExpression(draft.left, types), right: parseExpression(draft.right, types) }; }
export async function analyze(draft, { signal, onProgress = () => {}, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const compiled = compile(draft), rows = []; let matches = 0, counterexamples = 0, errors = 0;
  function snapshot(status) { return { modelVersion: MODEL_VERSION, input: clone(draft), compiled: clone(compiled), status, complete: status === 'completed', total: compiled.domain.total, checked: rows.length, matches, counterexamples, errors, rows: [...rows], conclusion: status !== 'completed' ? '未完成，不作域内等价结论' : errors ? '存在运行域错误，不能判定域内等价' : counterexamples ? '指定域内存在反例' : '仅指定有限域内全部结果一致，不证明域外等价' }; }
  onProgress(snapshot('running'));
  for (let index = 0; index < compiled.domain.total; index++) {
    if (signal?.aborted) return snapshot('cancelled');
    let quotient = index; const input = {};
    for (let i = compiled.domain.variables.length - 1; i >= 0; i--) { const variable = compiled.domain.variables[i]; input[variable.name] = clone(variable.values[quotient % variable.values.length]); quotient = Math.floor(quotient / variable.values.length); }
    const ordered = Object.fromEntries(compiled.domain.variables.map(variable => [variable.name, input[variable.name]]));
    const left = evaluate(compiled.left.ast, input), right = evaluate(compiled.right.ast, input);
    const kind = !left.ok || !right.ok ? 'runtimeError' : left.type === right.type && left.value === right.value ? 'match' : 'counterexample';
    if (kind === 'runtimeError') errors++; else if (kind === 'match') matches++; else counterexamples++;
    rows.push({ index: index + 1, input: ordered, left, right, kind });
    if (rows.length % 50 === 0 && rows.length < compiled.domain.total) { onProgress(snapshot('running')); await yieldControl(); }
  }
  const result = snapshot('completed'); onProgress(result); return result;
}
export function prepareStoredState(draft) {
  if (bytes(JSON.stringify(draft)) > 65536) throw new Error('草稿超过64KiB UTF-8，不保存');
  if (typeof draft?.left !== 'string' || typeof draft.right !== 'string' || bytes(draft.left) > 2048 || bytes(draft.right) > 2048 || !Array.isArray(draft.variables) || draft.variables.length < 1 || draft.variables.length > 3) throw new Error('草稿表达式≤2048字节，变量1–3');
  const variables = draft.variables.map(row => { if (typeof row?.name !== 'string' || row.name.length > 16 || typeof row.values !== 'string' || bytes(row.values) > 2048) throw new Error('变量草稿字段类型/容量无效'); return { name: row.name, values: row.values }; });
  return { schemaVersion: 1, left: draft.left, right: draft.right, variables };
}
export function validateStoredState(raw) { if (bytes(JSON.stringify(raw)) > 65536) throw new Error('草稿超过64KiB UTF-8'); if (raw?.schemaVersion !== 1) throw new Error('草稿版本不支持'); return prepareStoredState(raw); }
export function reportMarkdown(payload) {
  const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const block = value => { const text = escape(JSON.stringify(value, null, 2)); const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1))); return `${fence}json\n${text}\n${fence}`; };
  return ['# L030 表达式等价挑战', '有限类型AST，无任意代码执行。仅给定Cartesian域，运行错误不当等价，取消/未完成不声称完整。', '## 完整草稿', block(payload.draft), '## 完整域、AST与全部已检查结果', payload.result ? `${payload.result.conclusion}\n${block(payload.result)}` : '尚无结果', '筛选与分页不影响本报告，不证明域外等价。'].join('\n\n');
}
