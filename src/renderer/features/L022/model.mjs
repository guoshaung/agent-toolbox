export const MODEL_VERSION = 'operator-mutation-v1';
export const MAX_TESTS = 64;
export const FUNCTIONS = [
  { id: 'max', name: 'max(a,b)', implementation: 'return a > b ? a : b;', description: '返回两个整数中的较大值。',
    examples: { weak: [{ a: '2', b: '1', expected: '2' }], strong: [{ a: '2', b: '1', expected: '2' }, { a: '1', b: '2', expected: '2' }, { a: '0', b: '0', expected: '0' }] },
    mutants: [
      { id: 'max.reverse', implementation: 'return a < b ? a : b;', change: '比较方向 > 替换成 <', equivalent: false },
      { id: 'max.inclusive', implementation: 'return a >= b ? a : b;', change: '> 替换成 >=', equivalent: true, equivalenceReason: '在本工具有限整数域且0与-0相等时：a≠b条件一致；a=b时选a或b输出相等，故与原函数等价，不计分。' },
      { id: 'max.equal', implementation: 'return a === b ? a : b;', change: '> 替换成 ===', equivalent: false },
      { id: 'max.unequal', implementation: 'return a !== b ? a : b;', change: '> 替换成 !==', equivalent: false },
    ] },
  { id: 'sum', name: 'sum(a,b)', implementation: 'return a + b;', description: '返回两数之和；相等参数可能隐藏乘法变异。',
    examples: { weak: [{ a: '2', b: '2', expected: '4' }], strong: [{ a: '2', b: '2', expected: '4' }, { a: '0', b: '3', expected: '3' }, { a: '-2', b: '1', expected: '-1' }] },
    mutants: [
      { id: 'sum.subtract', implementation: 'return a - b;', change: '+ 替换成 -', equivalent: false },
      { id: 'sum.multiply', implementation: 'return a * b;', change: '+ 替换成 *', equivalent: false },
      { id: 'sum.divide', implementation: 'return a / b;', change: '+ 替换成 /', equivalent: false },
    ] },
  { id: 'product', name: 'product(a,b)', implementation: 'return a * b;', description: '返回两数之积；用零和负数扩展测试边界。',
    examples: { weak: [{ a: '2', b: '2', expected: '4' }], strong: [{ a: '2', b: '2', expected: '4' }, { a: '0', b: '3', expected: '0' }, { a: '-1', b: '3', expected: '-3' }] },
    mutants: [
      { id: 'product.add', implementation: 'return a + b;', change: '* 替换成 +', equivalent: false },
      { id: 'product.subtract', implementation: 'return a - b;', change: '* 替换成 -', equivalent: false },
      { id: 'product.divide', implementation: 'return a / b;', change: '* 替换成 /', equivalent: false },
    ] },
];
const EVALUATORS = {
  max: (a, b) => a > b ? a : b,
  'max.reverse': (a, b) => a < b ? a : b,
  'max.inclusive': (a, b) => a >= b ? a : b,
  'max.equal': (a, b) => a === b ? a : b,
  'max.unequal': (a, b) => a !== b ? a : b,
  sum: (a, b) => a + b,
  'sum.subtract': (a, b) => a - b,
  'sum.multiply': (a, b) => a * b,
  'sum.divide': (a, b) => a / b,
  product: (a, b) => a * b,
  'product.add': (a, b) => a + b,
  'product.subtract': (a, b) => a - b,
  'product.divide': (a, b) => a / b,
};
export function getFunction(id) { const definition = FUNCTIONS.find((item) => item.id === id); if (!definition) throw new Error('只能选择内置max、sum或product函数。'); return definition; }
function integer(value, limit, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^[+-]?\d+$/.test(value.trim()))) throw new Error(`${label}需要十进制整数，不能为空或输入代码。`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || Math.abs(number) > limit) throw new Error(`${label}需要有限整数且绝对值不超过${limit}。`);
  return number === 0 ? 0 : number;
}
export function validateTests(tests) {
  if (!Array.isArray(tests) || tests.length > MAX_TESTS) throw new Error(`测试需要数组且不能超过${MAX_TESTS}条。`);
  return tests.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`测试${index + 1}需要参数a、b和期望值。`);
    return { id: `T${index + 1}`, a: integer(row.a, 1000000, `测试${index + 1}参数a`), b: integer(row.b, 1000000, `测试${index + 1}参数b`), expected: integer(row.expected, 1000000000000, `测试${index + 1}期望`) };
  });
}
function outcome(id, a, b) {
  const value = EVALUATORS[id](a, b);
  return Number.isFinite(value) ? { kind: 'value', value: value === 0 ? 0 : value } : { kind: 'non-finite', display: String(value), message: '变异结果不是有限数值，视为可观察的失败。' };
}
export function runMutationTests(functionId, inputTests) {
  const definition = getFunction(functionId); const tests = validateTests(inputTests);
  const result = { feature: 'L022', schemaVersion: 1, modelVersion: MODEL_VERSION, function: { id: definition.id, name: definition.name, implementation: definition.implementation }, policy: 'a、b为±1000000内整数；期望为±1000000000000内整数；比较精确数值，0和-0相等。只有全部原函数测试通过才计分；已证明与原函数等价的变异排除；存活不代表等价。', tests: tests.map((row) => { const original = outcome(functionId, row.a, row.b); return { ...row, original, baselinePass: original.kind === 'value' && original.value === row.expected }; }), mutants: [], score: null, status: 'empty', message: '没有测试；不生成变异得分，不能视为合格的0%。' };
  if (!tests.length) return result;
  if (result.tests.some((row) => !row.baselinePass)) { result.status = 'baseline-failed'; result.message = '原函数未通过全部期望，测试基准失败；请修正测试，本次不生成变异得分。'; return result; }
  result.mutants = definition.mutants.map((mutant) => {
    if (mutant.equivalent) return { ...mutant, originalImplementation: definition.implementation, status: 'equivalent', observations: [], killedBy: [], counted: false };
    const observations = tests.map((row) => { const actual = outcome(mutant.id, row.a, row.b); return { ...row, actual, kills: actual.kind !== 'value' || actual.value !== row.expected }; });
    const killedBy = observations.filter((row) => row.kills).map((row) => row.id);
    return { ...mutant, originalImplementation: definition.implementation, status: killedBy.length ? 'killed' : 'survived', observations, killedBy, counted: true, survivalMeaning: '本次测试未发现差异不代表等价；没有等价证明的存活变异仍计入分母。' };
  });
  const eligible = result.mutants.filter((mutant) => mutant.counted); const killed = eligible.filter((mutant) => mutant.status === 'killed').length;
  result.score = { numerator: killed, denominator: eligible.length, value: eligible.length ? killed / eligible.length : null, generated: result.mutants.length, excludedEquivalent: result.mutants.length - eligible.length, survived: eligible.length - killed };
  result.status = 'completed'; result.message = '原函数全部通过；得分=杀死的参与计分变异数/全部参与计分变异数，不是代码覆盖率或正确性证明。';
  return result;
}
export function prepareStoredState(state) {
  const serialized = JSON.stringify({ ...state, schemaVersion: 1 });
  if (new TextEncoder().encode(serialized).byteLength > 65536) throw new Error('测试草稿超过64KiB保存上限。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('测试草稿版本不支持，需要schemaVersion:1。');
  prepareStoredState(state); return state;
}
export const formatOutcome = (actual) => actual.kind === 'value' ? String(actual.value) : `非有限结果 ${actual.display}`;
export function reportMarkdown(result) {
  const lines = ['# 变异测试训练场', '', `schemaVersion:1；模型：${MODEL_VERSION}；状态：${result.status}`, '', `函数：${result.function.name}`, '', '```js', result.function.implementation, '```', '', result.policy, '', result.message, '', '## 原函数测试基准', '', '| 测试 | a | b | 期望 | 原函数结果 | 基准通过 |', '|---|---|---|---|---|---|', ...result.tests.map((row) => `| ${row.id} | ${row.a} | ${row.b} | ${row.expected} | ${formatOutcome(row.original)} | ${row.baselinePass ? '是' : '否'} |`)];
  if (result.score) lines.push('', `变异得分：${result.score.numerator}/${result.score.denominator}（${(result.score.value * 100).toFixed(2)}%）；生成${result.score.generated}，等价排除${result.score.excludedEquivalent}，存活${result.score.survived}。`);
  else lines.push('', '变异得分：未生成。');
  for (const mutant of result.mutants) {
    lines.push('', `## ${mutant.id}：${mutant.status}`, '', mutant.change, '', '```js', mutant.implementation, '```', '', mutant.counted ? '参与分母；存活不代表等价。' : `等价排除，不计分：${mutant.equivalenceReason}`);
    if (mutant.observations.length) lines.push('', '| 测试 | 输入(a,b) | 期望 | 变异结果 | 杀死 |', '|---|---|---|---|---|', ...mutant.observations.map((row) => `| ${row.id} | (${row.a},${row.b}) | ${row.expected} | ${formatOutcome(row.actual)} | ${row.kills ? '是' : '否'} |`));
  }
  return lines.join('\n') + '\n';
}
