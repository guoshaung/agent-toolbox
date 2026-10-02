import { LIMITS as PARSE_LIMITS, parseDataset, checkAbort } from './parser.mjs';
export { parseDataset, checkAbort };
export const LIMITS = Object.freeze({ ...PARSE_LIMITS, questions: 20, categories: 200, splitOptions: 100, labelChars: 200 });
export const EXAMPLE = 'choice,group,interests,score\nA,X,A;B;A,10\nB,X,B,20\nA,Y,A;B,not-number\n,Y,,\n';
export const EXAMPLE_QUESTIONS = Object.freeze([
  { id: 'Q1', field: 'choice', title: '单选意见', type: 'single', trim: true },
  { id: 'Q2', field: 'group', title: '分组', type: 'single', trim: true },
  { id: 'Q3', field: 'interests', title: '多选兴趣', type: 'multiple', trim: true, separator: ';' },
  { id: 'Q4', field: 'score', title: '评分', type: 'numeric', trim: true }
]);
export const BASIS = Object.freeze({ sample: '每条JSON对象记录或CSV数据行为一份答卷；不含CSV标题/末尾换行，实际空物理行计入', missing: '字段缺失、null或按本题修剪规则处理后空字符串；多选去空项后无选项也为缺答', invalid: '不支持的值类型或非法数值单独计数，不混入缺答；每题总样本=有效+缺答+非法', single: '单选接受字符串、JSON数字/布尔，保持类型；百分比分母为本题有效答卷，数字1与字符串1不同', multiple: '只接受字符串，按配置的字面分隔符拆分（不是正则）；去空项、按本题修剪，同答卷重复选项只计一次；分母是有效答卷，百分比合计可超过100%', numeric: '仅JSON数字或严格十进制/科学记数字符串；拒绝非有限/不安全整数/改变十进制含义的舍入；频数分母为有效数值答卷，均值是Number近似', cross: '仅显式选择的一对不同单选题；分母为两题同时有效的成对答卷，排除状态按组合完整列出；仅展示观测组合，未出现组合频数为0', interpretation: '不自动推断题型、选项含义、缺答编码或调查总体，不进行显著性检验或统计推断' });
async function checkpoint(hooks) { checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal); }
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function formatRate(rate) { return rate === null ? '不适用（有效分母0）' : `${Number((rate * 100).toFixed(4))}%`; }
const tokenOf = (type, value) => type + ':' + JSON.stringify(value);

export function validateConfig(dataset, questions, cross = null) {
  if (!Array.isArray(questions) || !questions.length || questions.length > LIMITS.questions) throw new Error('请配置1至20题。');
  const ids = new Set(), fields = new Set();
  const configs = questions.map(question => {
    if (!question || typeof question.id !== 'string' || !/^Q\d{1,3}$/u.test(question.id) || ids.has(question.id)) throw new Error('题目ID须为不重复的Q加1至3位数字。');
    if (!dataset.fields.includes(question.field) || fields.has(question.field)) throw new Error('题目须选择存在且未重复配置的字段。');
    if (!['single', 'multiple', 'numeric'].includes(question.type) || typeof question.trim !== 'boolean') throw new Error('题型或修剪配置无效。');
    if (typeof question.title !== 'string' || !question.title.trim() || question.title.length > LIMITS.labelChars) throw new Error('题名须非空且最多200字符。');
    if (question.type === 'multiple' && (typeof question.separator !== 'string' || !question.separator.length || question.separator.length > 10)) throw new Error('多选字面分隔符须为1至10个UTF-16单位。');
    ids.add(question.id); fields.add(question.field);
    return { id: question.id, field: question.field, title: question.title, type: question.type, trim: question.trim, ...(question.type === 'multiple' ? { separator: question.separator } : {}) };
  });
  if (cross) {
    const left = configs.find(question => question.id === cross.left), right = configs.find(question => question.id === cross.right);
    if (!left || !right || left === right || left.type !== 'single' || right.type !== 'single') throw new Error('交叉统计须选择两道不同的已配置单选题。');
  }
  return configs;
}

function decimalMeaning(text) {
  let normalized = text.replace(/^\+/u, ''); if (normalized.startsWith('.')) normalized = '0' + normalized; if (normalized.startsWith('-.')) normalized = '-0' + normalized.slice(1);
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(normalized);
  let digits = (match[2] + (match[3] || '')).replace(/^0+/u, ''); if (!digits) return '0';
  const tail = digits.length - digits.replace(/0+$/u, '').length;
  return `${match[1]}${digits.slice(0, digits.length - tail)}e${Number(match[4] || 0) - (match[3]?.length || 0) + tail}`;
}
export function parseNumeric(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return { error: '数值题只接受数字或十进制字符串，不接受布尔/对象/数组。' };
  if (typeof value === 'string' && (value.length > 128 || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value))) return { error: '不是明确的十进制/科学记数值（不支持千位分隔、百分号、十六进制）。' };
  const number = Number(value);
  if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) return { error: '数值非有限或超出安全整数范围。' };
  if (typeof value === 'string' && decimalMeaning(value) !== decimalMeaning(String(number))) return { error: '转换为Number会丢失十进制值精度。' };
  return { number };
}

function answer(record, question) {
  const present = own(record.value, question.field), raw = record.value[question.field];
  // Split multi-choice on the original string, then trim each item; trimming
  // the whole string first would erase boundary newline/space separators.
  const value = typeof raw === 'string' && question.trim && question.type !== 'multiple' ? raw.trim() : raw;
  if (!present || value === null || value === '') return { status: 'missing', reason: !present ? '字段缺失' : value === null ? 'null缺答' : '空字符串缺答', present, raw };
  if (question.type === 'single') {
    if (!['string', 'number', 'boolean'].includes(typeof value)) return { status: 'invalid', reason: '单选仅接受字符串、数字或布尔值，不能自动解释对象/数组。', present, raw };
    const type = typeof value; return { status: 'valid', choices: [{ type, value, token: tokenOf(type, value) }], present, raw };
  }
  if (question.type === 'numeric') {
    const result = parseNumeric(value);
    return result.error ? { status: 'invalid', reason: result.error, present, raw } : { status: 'valid', number: result.number, choices: [{ type: 'number', value: result.number, token: tokenOf('number', result.number) }], present, raw };
  }
  if (typeof value !== 'string') return { status: 'invalid', reason: '多选须是使用明确分隔符的字符串；不自动展开JSON数组。', present, raw };
  const parts = value.split(question.separator, LIMITS.splitOptions + 1);
  if (parts.length > LIMITS.splitOptions) return { status: 'invalid', reason: '单份答卷多选切分超过100项。', present, raw };
  const unique = new Set(); let emptyTokens = 0, duplicateTokens = 0;
  for (const part of parts) { const item = question.trim ? part.trim() : part; if (!item) emptyTokens++; else if (unique.has(item)) duplicateTokens++; else unique.add(item); }
  return unique.size ? { status: 'valid', choices: [...unique].map(value => ({ type: 'string', value, token: tokenOf('string', value) })), emptyTokens, duplicateTokens, present, raw }
    : { status: 'missing', reason: '多选去除空项后没有有效选项', emptyTokens, duplicateTokens, present, raw };
}

export async function summarizeSurvey(dataset, questions, cross = null, hooks = {}) {
  const configs = validateConfig(dataset, questions, cross); const results = [], answerSets = new Map();
  for (const config of configs) {
    const frequencies = new Map(), answers = [], issues = []; let valid = 0, missing = 0, invalid = 0, emptyTokens = 0, duplicateTokens = 0, min = null, max = null, mean = 0, selections = 0;
    for (let index = 0; index < dataset.records.length; index++) {
      if (index % 128 === 0) await checkpoint(hooks);
      const record = dataset.records[index], resolved = answer(record, config); answers.push(resolved);
      emptyTokens += resolved.emptyTokens || 0; duplicateTokens += resolved.duplicateTokens || 0;
      if (resolved.status !== 'valid') {
        if (resolved.status === 'missing') missing++; else invalid++;
        issues.push({ status: resolved.status, reason: resolved.reason, source: record.source, input: resolved.present ? { present: true, value: resolved.raw } : { present: false } }); continue;
      }
      valid++;
      if (config.type === 'numeric') { min = min === null ? resolved.number : Math.min(min, resolved.number); max = max === null ? resolved.number : Math.max(max, resolved.number); mean += (resolved.number - mean) / valid; }
      for (const choice of resolved.choices) {
        selections++; const found = frequencies.get(choice.token);
        if (found) found.count++; else { if (frequencies.size >= LIMITS.categories) throw new Error(`题目${config.title}有效类别超过200，整批中止，不合并成其他项。`); frequencies.set(choice.token, { type: choice.type, value: choice.value, count: 1 }); }
      }
    }
    answerSets.set(config.id, answers);
    results.push({ config, total: dataset.records.length, valid, missing, invalid, denominator: valid, selections, ignoredEmptyTokens: emptyTokens, duplicateSelectionsRemoved: duplicateTokens,
      numeric: config.type === 'numeric' ? { min, max, mean: valid ? mean : null, meanIsApproximate: true } : null,
      frequencies: [...frequencies.entries()].sort((a, b) => lexical(a[0], b[0])).map(([, frequency]) => ({ ...frequency, denominator: valid, rate: valid ? frequency.count / valid : null })), issues });
  }
  let crossResult = null;
  if (cross) {
    const left = answerSets.get(cross.left), right = answerSets.get(cross.right), counts = new Map(), statuses = new Map(); let validPairs = 0;
    for (let index = 0; index < dataset.records.length; index++) {
      if (index % 128 === 0) await checkpoint(hooks);
      const a = left[index], b = right[index], statusToken = a.status + '/' + b.status; statuses.set(statusToken, (statuses.get(statusToken) || 0) + 1);
      if (a.status !== 'valid' || b.status !== 'valid') continue;
      validPairs++; const key = JSON.stringify([a.choices[0].token, b.choices[0].token]), found = counts.get(key);
      if (found) found.count++; else counts.set(key, { left: { type: a.choices[0].type, value: a.choices[0].value }, right: { type: b.choices[0].type, value: b.choices[0].value }, count: 1 });
    }
    crossResult = { config: { left: cross.left, right: cross.right }, total: dataset.records.length, validPairs, excludedPairs: dataset.records.length - validPairs, denominator: validPairs,
      statusCounts: [...statuses.entries()].sort((a, b) => lexical(a[0], b[0])).map(([status, count]) => ({ left: status.split('/')[0], right: status.split('/')[1], count })),
      cells: [...counts.entries()].sort((a, b) => lexical(a[0], b[0])).map(([, cell]) => ({ ...cell, denominator: validPairs, rate: validPairs ? cell.count / validPairs : null })), sparse: true };
  }
  checkAbort(hooks.signal);
  return { feature: 'T009', version: 1, source: { name: dataset.name, format: dataset.format }, sampleCount: dataset.records.length, basis: { ...BASIS }, questions: results, cross: crossResult };
}

export async function serializeSurvey(report, format, hooks = {}) {
  if (!['json', 'csv'].includes(format)) throw new Error('只支持JSON/CSV报告。');
  let bytes = 0; const chunks = [], encoder = new TextEncoder();
  const append = text => { bytes += encoder.encode(text).length; if (bytes > LIMITS.outputBytes) throw new Error('报告超过12 MiB，请减少样本或题目。'); chunks.push(text); };
  await checkpoint(hooks);
  if (format === 'json') {
    append(JSON.stringify({ ...report, questions: undefined, cross: undefined }).slice(0, -1)); append(',"questions":[');
    for (let index = 0; index < report.questions.length; index++) { await checkpoint(hooks); append((index ? ',' : '') + JSON.stringify(report.questions[index])); }
    append('],"cross":'); append(JSON.stringify(report.cross)); append('}\n');
  } else {
    const cell = value => { const text = typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value); return '"' + text.replaceAll('"', '""') + '"'; };
    append('\uFEFFkind,id_json,detail_json,count,denominator,rate_json\r\n'); let rows = 0;
    const row = async (kind, id, detail, count = null, denominator = null, rate = null) => { if (rows++ % 64 === 0) await checkpoint(hooks); append([kind, id, detail, count, denominator, rate].map(cell).join(',') + '\r\n'); };
    await row('metadata', null, { feature: report.feature, version: report.version, source: report.source, sampleCount: report.sampleCount, basis: report.basis });
    for (const question of report.questions) {
      await row('question', question.config.id, { ...question, frequencies: undefined, issues: undefined }, question.total, question.denominator);
      for (const frequency of question.frequencies) await row('frequency', question.config.id, { type: frequency.type, value: frequency.value }, frequency.count, frequency.denominator, frequency.rate);
      for (const issue of question.issues) await row('answer-' + issue.status, question.config.id, issue, 1);
    }
    if (report.cross) {
      await row('cross-summary', null, { ...report.cross, cells: undefined }, report.cross.total, report.cross.denominator);
      for (const item of report.cross.cells) await row('cross-cell', null, { left: item.left, right: item.right }, item.count, item.denominator, item.rate);
    }
  }
  checkAbort(hooks.signal); return chunks.join('');
}
