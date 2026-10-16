export const MODEL_VERSION = 'finite-branches-v1';
export const MAX_CASES = 64;
const compare = (id, variable, operator, value) => ({ kind: 'compare', id, variable, operator, value, label: `${variable} ${operator} ${value}` });
const boolean = (id, variable) => ({ kind: 'boolean', id, variable, label: variable });
const returns = (value) => ({ kind: 'return', value });
const branch = (id, label, condition, yes, no, hints) => ({ kind: 'if', id, label, condition, yes, no, hints });
const input = (x, y = 0, enabled = false, override = false) => ({ x: String(x), y: String(y), enabled, override });
const integerVariable = (name) => ({ name, type: 'integer' });
const booleanVariable = (name) => ({ name, type: 'boolean' });
export const PROGRAMS = [
  { id: 'simple', name: '简单：x>0', variables: [integerVariable('x')], source: 'if (x > 0) { // D1\n  return "正数";\n} else {\n  return "非正数";\n}', examples: { weak: [input(1)], strong: [input(1), input(-1)] }, tree: branch('D1', 'x > 0', compare('A1', 'x', '>', 0), returns('正数'), returns('非正数'), { true: '补充x>0的输入，例如1。', false: '补充x≤0的输入，例如0或−1。' }) },
  { id: 'nested', name: '嵌套：x与y的三条决策', variables: [integerVariable('x'), integerVariable('y')], source: 'if (x > 0) { // D1\n  if (y > 0) { // D2\n    return "双正数";\n  } else {\n    return "x正、y非正";\n  }\n} else {\n  if (y === 0) { // D3\n    return "x非正、y为零";\n  } else {\n    return "x非正、y非零";\n  }\n}', examples: { weak: [input(1, 1)], strong: [input(1, 1), input(1, -1), input(-1, 0), input(-1, 1)] }, tree: branch('D1', 'x > 0', compare('A1', 'x', '>', 0), branch('D2', 'y > 0', compare('A2', 'y', '>', 0), returns('双正数'), returns('x正、y非正'), { true: '需要先令x>0，再令y>0。', false: '需要先令x>0，再令y≤0。' }), branch('D3', 'y === 0', compare('A3', 'y', '===', 0), returns('x非正、y为零'), returns('x非正、y非零'), { true: '需要先令x≤0，再令y=0。', false: '需要先令x≤0，再令y≠0。' }), { true: '补充x>0的输入。', false: '补充x≤0的输入。' }) },
  { id: 'compound', name: '复合：(x>0 && enabled) || override', variables: [integerVariable('x'), booleanVariable('enabled'), booleanVariable('override')], source: 'if ((x > 0 && enabled) || override) { // D1\n  return "允许";\n} else {\n  return "拒绝";\n}', examples: { weak: [input(1, 0, true, false)], strong: [input(1, 0, true, false), input(-1, 0, true, false)] }, tree: branch('D1', '(x > 0 && enabled) || override', { kind: 'or', left: { kind: 'and', left: compare('A1', 'x', '>', 0), right: boolean('A2', 'enabled') }, right: boolean('A3', 'override') }, returns('允许'), returns('拒绝'), { true: '令x>0且enabled=true，或者令override=true。', false: '令override=false，并令x≤0或enabled=false。' }) },
  { id: 'unreachable', name: '不可达：正数中的x<0', variables: [integerVariable('x')], source: 'if (x > 0) { // D1\n  if (x < 0) { // D2\n    return "不可达";\n  } else {\n    return "正数";\n  }\n} else {\n  return "非正数";\n}', examples: { weak: [input(1)], strong: [input(1), input(-1)] }, knownUnreachable: [{ decisionId: 'D2', outcome: true, proof: '进入D2需要x>0，而D2真边需要x<0；在声明整数域两者矛盾。该边仍计入本训练固定分母。' }], tree: branch('D1', 'x > 0', compare('A1', 'x', '>', 0), branch('D2', 'x < 0', compare('A2', 'x', '<', 0), returns('不可达'), returns('正数'), { true: '已有条件矛盾证明；不会因为未命中而自动排除分母。', false: '令x>0，可命中D2假边。' }), returns('非正数'), { true: '补充x>0的输入。', false: '补充x≤0的输入。' }) },
];
export function getProgram(id) { const program = PROGRAMS.find((row) => row.id === id); if (!program) throw new Error('只能选择列表中的内置程序，不能输入任意JS。'); return program; }
function integer(value, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^[+-]?\d+$/.test(value.trim()))) throw new Error(`${label}需要十进制整数。`);
  const number = Number(value); if (!Number.isSafeInteger(number) || Math.abs(number) > 1000000) throw new Error(`${label}需要−1000000至1000000内的有限整数。`);
  return number === 0 ? 0 : number;
}
export function validateInputs(programId, cases) {
  const program = getProgram(programId);
  if (!Array.isArray(cases) || cases.length > MAX_CASES) throw new Error(`输入集合需要数组且至多${MAX_CASES}条。`);
  return cases.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`输入${index + 1}需要变量字段。`);
    return Object.fromEntries(program.variables.map((variable) => {
      const value = row[variable.name];
      if (variable.type === 'integer') return [variable.name, integer(value, `输入${index + 1}的${variable.name}`)];
      if (typeof value !== 'boolean') throw new Error(`输入${index + 1}的${variable.name}需要true/false布尔值。`);
      return [variable.name, value];
    }));
  });
}
function leaves(expression) { if (['compare', 'boolean'].includes(expression.kind)) return [expression]; if (expression.kind === 'not') return leaves(expression.child); return [...leaves(expression.left), ...leaves(expression.right)]; }
export function interpretCondition(expression, values) {
  const atoms = []; let visited = 0;
  function guard(node, depth) {
    if (!node || depth > 8 || ++visited > 32) throw new Error('条件AST无效或超过深度8/32节点上限。');
    if (node.kind === 'compare') { if (!['>', '>=', '<', '<=', '===', '!=='].includes(node.operator)) throw new Error('不支持的比较运算符。'); integer(node.value, '比较常量'); }
  }
  function skip(node, reason, depth) {
    guard(node, depth);
    if (['compare', 'boolean'].includes(node.kind)) atoms.push({ id: node.id, label: node.label, status: 'skipped', value: null, reason });
    else if (node.kind === 'not') skip(node.child, reason, depth + 1);
    else if (['and', 'or'].includes(node.kind)) { skip(node.left, reason, depth + 1); skip(node.right, reason, depth + 1); }
    else throw new Error('不支持的条件AST节点，不执行代码。');
  }
  function visit(node, depth = 0) {
    guard(node, depth);
    if (node.kind === 'and' || node.kind === 'or') {
      const left = visit(node.left, depth + 1);
      if ((node.kind === 'and' && !left) || (node.kind === 'or' && left)) { skip(node.right, node.kind === 'and' ? '&&左侧为false，右侧未执行' : '||左侧为true，右侧未执行', depth + 1); return left; }
      return visit(node.right, depth + 1);
    }
    if (node.kind === 'not') return !visit(node.child, depth + 1);
    let value;
    if (node.kind === 'boolean') { if (typeof values[node.variable] !== 'boolean') throw new Error('布尔变量必须为true或false。'); value = values[node.variable]; }
    else if (node.kind === 'compare') {
      const left = integer(values[node.variable], node.variable); const right = integer(node.value, '比较常量');
      switch (node.operator) { case '>': value = left > right; break; case '>=': value = left >= right; break; case '<': value = left < right; break; case '<=': value = left <= right; break; case '===': value = left === right; break; case '!==': value = left !== right; break; default: throw new Error('不支持的比较运算符。'); }
    } else throw new Error('不支持的条件AST节点，不执行代码。');
    atoms.push({ id: node.id, label: node.label, status: 'evaluated', value, reason: '' }); return value;
  }
  const value = visit(expression); return { value, atoms };
}
function decisions(node) { return node.kind === 'if' ? [node, ...decisions(node.yes), ...decisions(node.no)] : []; }
export function exploreBranches(programId, rawCases) {
  const program = getProgram(programId); const inputs = validateInputs(programId, rawCases); const declared = decisions(program.tree);
  const executions = inputs.map((values, index) => {
    const path = []; const seen = new Map(); let steps = 0;
    function execute(node) {
      if (++steps > 16) throw new Error('内置程序超过16条语句界限。');
      if (node.kind === 'return') return node.value;
      if (node.kind !== 'if') throw new Error('不支持的程序AST，不执行JS。');
      const condition = interpretCondition(node.condition, values); const edge = `${node.id}:${condition.value ? 'true' : 'false'}`;
      path.push({ id: node.id, outcome: condition.value, edge }); seen.set(node.id, { id: node.id, label: node.label, executed: true, outcome: condition.value, atoms: condition.atoms });
      return execute(condition.value ? node.yes : node.no);
    }
    const output = execute(program.tree);
    return { id: `T${index + 1}`, input: { ...values }, output, path, decisions: declared.map((node) => seen.get(node.id) || { id: node.id, label: node.label, executed: false, outcome: null, atoms: leaves(node.condition).map((atom) => ({ id: atom.id, label: atom.label, status: 'skipped', value: null, reason: '上层分支未选择此条件节点' })) }) };
  });
  const edges = declared.flatMap((node) => [true, false].map((outcome) => {
    const matches = executions.filter((run) => run.path.some((entry) => entry.id === node.id && entry.outcome === outcome)).map((run) => run.id);
    const unreachable = program.knownUnreachable?.find((entry) => entry.decisionId === node.id && entry.outcome === outcome);
    return { id: `${node.id}:${outcome ? 'true' : 'false'}`, decisionId: node.id, condition: node.label, outcome, count: matches.length, tests: matches, covered: matches.length > 0, knownUnreachable: !!unreachable, proof: unreachable?.proof || '', hint: node.hints[outcome ? 'true' : 'false'] };
  }));
  const covered = edges.filter((edge) => edge.covered).length;
  return { feature: 'L023', schemaVersion: 1, modelVersion: MODEL_VERSION, program: { id: program.id, name: program.name, source: program.source }, policy: '分母=静态if决策数×2，每个决策的true/false边各一项；&&/||内部原子求值只作路径说明，不计入此分支分母。短路或上层跳过均不是false命中；不可达证明只标注，不排除分母。', status: inputs.length ? 'completed' : 'empty', executions, edges, uncovered: edges.filter((edge) => !edge.covered), coverage: { numerator: covered, denominator: edges.length, value: inputs.length ? covered / edges.length : null }, decisionCounts: declared.map((node) => ({ id: node.id, trueCount: edges.find((edge) => edge.id === `${node.id}:true`).count, falseCount: edges.find((edge) => edge.id === `${node.id}:false`).count, skippedCount: executions.filter((run) => !run.decisions.find((entry) => entry.id === node.id).executed).length })) };
}
export function prepareStoredState(state) {
  const serialized = JSON.stringify({ ...state, schemaVersion: 1 });
  if (new TextEncoder().encode(serialized).byteLength > 65536) throw new Error('输入草稿超过64KiB保存上限。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) { if (!state || state.schemaVersion !== 1) throw new Error('草稿版本不支持，需要schemaVersion:1。'); prepareStoredState(state); return state; }
export function reportMarkdown(result) {
  const lines = ['# 分支覆盖探索', '', `schemaVersion:1；模型：${MODEL_VERSION}；状态：${result.status}`, '', result.program.name, '', '```text', result.program.source, '```', '', result.policy, '', result.coverage.value === null ? '无输入，覆盖率未生成。' : `分支覆盖率：${result.coverage.numerator}/${result.coverage.denominator}（${(result.coverage.value * 100).toFixed(2)}%）`, '', '## 分支边', '', '| 边 | 条件 | 次数 | 输入编号 | 状态 |', '|---|---|---|---|---|'];
  for (const edge of result.edges) lines.push(`| ${edge.id} | ${edge.condition.replace(/\|/g, '&#124;')} | ${edge.count} | ${edge.tests.join(', ') || '无'} | ${edge.covered ? '已覆盖' : edge.knownUnreachable ? '未覆盖（已证明不可达仍计分母）' : '未覆盖'} |`);
  lines.push('', '## 每次执行路径', '');
  for (const run of result.executions) { lines.push(`### ${run.id} 输入${JSON.stringify(run.input)}`, '', `路径：${run.path.map((entry) => entry.edge).join(' → ')}；输出：${run.output}`, ''); for (const node of run.decisions) { lines.push(`- ${node.id}：${node.executed ? String(node.outcome) : '未执行'}`); for (const atom of node.atoms) lines.push(`  - ${atom.id} ${atom.label}：${atom.status === 'evaluated' ? String(atom.value) : `未执行：${atom.reason}`}`); } lines.push(''); }
  lines.push('## 未覆盖边提示', ''); for (const edge of result.uncovered) lines.push(`- ${edge.id}：${edge.proof || edge.hint}`);
  return lines.join('\n') + '\n';
}
