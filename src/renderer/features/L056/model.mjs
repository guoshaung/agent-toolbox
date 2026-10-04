export const MODEL_VERSION = 'L056-correct-rate-top-bottom27-stable-total-v1';
export const LIMITS = { people: 200, items: 100, label: 40, csvBytes: 196608, inputBytes: 262144, storageBytes: 65536, outputBytes: 2097152 };
const clone = value => JSON.parse(JSON.stringify(value));
export const bytes = text => new TextEncoder().encode(text).length;
function keys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) throw Error(`${label}字段无效`);
}
function text(value, limit, label) {
  if (typeof value !== 'string' || [...value].length > limit || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error(`${label}须≤${limit}Unicode码点且无非法字符`);
}
export function validateDraft(raw, { forStorage = false } = {}) {
  if (bytes(JSON.stringify(raw)) > (forStorage ? LIMITS.storageBytes : LIMITS.inputBytes)) throw Error(forStorage ? '完整矩阵草稿超过64KiB，不写配置；请导出完整报告，关闭只能恢复较早合法输入' : '完整输入超过256KiB，整份拒绝不截断');
  keys(raw, ['schemaVersion', 'source', 'matrixText'], '草稿');
  if (raw.schemaVersion !== 1) throw Error('仅支持schemaVersion1');
  keys(raw.source, ['label', 'location'], '人工来源');
  text(raw.source.label, 160, '来源名'); text(raw.source.location, 320, '来源位置'); text(raw.matrixText, LIMITS.csvBytes, '矩阵文本');
  if (bytes(raw.matrixText) > LIMITS.csvBytes) throw Error('原CSV超过192KiB，整份拒绝');
  return clone(raw);
}
function label(value, where) {
  const name = value.trim(); text(name, LIMITS.label, where);
  if (!name || /[,"\r\n\t]/.test(name)) throw Error(`${where}不能为空或含逗号/引号/换行/制表符；仅无引号CSV`);
  return name;
}
export function parseMatrix(matrixText) {
  text(matrixText, LIMITS.csvBytes, 'CSV');
  if (bytes(matrixText) > LIMITS.csvBytes) throw Error('CSV超过192KiB');
  if (matrixText.includes('"') || matrixText.startsWith('\uFEFF')) throw Error('仅支持无引号、无BOM的逗号CSV，请移除引号/BOM；不支持字段内换行');
  const lines = matrixText.replace(/\r\n|\r/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length < 2 || lines.length > LIMITS.people + 1) throw Error('需1–200人及表头，空行不忽略');
  if (lines.some(line => !line.trim())) throw Error('CSV有空行，不忽略记录');
  const header = lines[0].split(',');
  if (header[0].trim() !== 'participant') throw Error('首列表头必须为participant');
  const items = header.slice(1).map((name, index) => label(name, `题${index + 1}名称`));
  if (!items.length || items.length > LIMITS.items) throw Error('题数须1–100');
  if (new Set(items).size !== items.length) throw Error('题目名称重复（修剪首尾空白后）');
  const people = lines.slice(1).map((line, index) => {
    const cells = line.split(',');
    if (cells.length !== header.length) throw Error(`第${index + 2}行列数不齐；缺答不猜0`);
    const id = label(cells[0], `人${index + 1}名称`);
    const responses = cells.slice(1).map((cell, column) => {
      const value = cell.trim(); if (value !== '0' && value !== '1') throw Error(`第${index + 2}行题${column + 1}必须字面0/1，不支持空白/小数/缺答`);
      return Number(value);
    });
    return { id, responses };
  });
  if (new Set(people.map(person => person.id)).size !== people.length) throw Error('作答者名称重复（修剪首尾空白后）');
  return { items, people };
}
export function serializeMatrix(parsed) {
  const csv = [['participant', ...parsed.items].join(','), ...parsed.people.map(person => [person.id, ...person.responses].join(','))].join('\n');
  parseMatrix(csv); return csv;
}
export function exampleDraft() {
  return { schemaVersion: 1, source: { label: '用户自编十人十题教学矩阵', location: '本地示例，非实际考试' }, matrixText: serializeMatrix({ items: Array.from({ length: 10 }, (_, index) => `Q${String(index + 1).padStart(2, '0')}`), people: Array.from({ length: 10 }, (_, index) => ({ id: `P${String(index + 1).padStart(2, '0')}`, responses: Array.from({ length: 10 }, (_, item) => item === 0 || item <= index ? 1 : 0) })) }) };
}
export function editCell(raw, row, column) {
  const d = validateDraft(raw), matrix = parseMatrix(d.matrixText);
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= matrix.people.length || column >= matrix.items.length) throw Error('单元格不存在');
  matrix.people[row].responses[column] = 1 - matrix.people[row].responses[column]; d.matrixText = serializeMatrix(matrix); return validateDraft(d);
}
function nextLabel(prefix, existing) { let index = 1; while (existing.includes(prefix + String(index).padStart(3, '0'))) index++; return prefix + String(index).padStart(3, '0'); }
export function addAxis(raw, axis) {
  const d = validateDraft(raw), matrix = parseMatrix(d.matrixText);
  if (axis === 'person') { if (matrix.people.length >= LIMITS.people) throw Error('最多200人'); matrix.people.push({ id: nextLabel('P', matrix.people.map(person => person.id)), responses: matrix.items.map(() => 0) }); }
  else if (axis === 'item') { if (matrix.items.length >= LIMITS.items) throw Error('最多100题'); matrix.items.push(nextLabel('Q', matrix.items)); matrix.people.forEach(person => person.responses.push(0)); }
  else throw Error('未知轴');
  d.matrixText = serializeMatrix(matrix); return validateDraft(d);
}
export function removeAxis(raw, axis) {
  const d = validateDraft(raw), matrix = parseMatrix(d.matrixText);
  if (axis === 'person') { if (matrix.people.length <= 1) throw Error('至少保留1人'); matrix.people.pop(); }
  else if (axis === 'item') { if (matrix.items.length <= 1) throw Error('至少保留1题'); matrix.items.pop(); matrix.people.forEach(person => person.responses.pop()); }
  else throw Error('未知轴');
  d.matrixText = serializeMatrix(matrix); return validateDraft(d);
}
export function compute(raw) {
  const d = validateDraft(raw), matrix = parseMatrix(d.matrixText), n = matrix.people.length, m = matrix.items.length;
  const estimated = n >= 10 && m >= 10;
  const ranked = matrix.people.map((person, index) => ({ id: person.id, rowIndex: index, total: person.responses.reduce((sum, value) => sum + value, 0) })).sort((a, b) => b.total - a.total || a.rowIndex - b.rowIndex);
  const k = estimated ? Math.floor(n * 27 / 100) : null;
  const upper = estimated ? ranked.slice(0, k) : [], lower = estimated ? ranked.slice(n - k) : [];
  const boundaryTies = estimated ? { upper: ranked[k - 1].total === ranked[k].total, lower: ranked[n - k - 1].total === ranked[n - k].total } : null;
  const items = matrix.items.map((id, column) => {
    const correct = matrix.people.reduce((sum, person) => sum + person.responses[column], 0);
    const upperCorrect = estimated ? upper.reduce((sum, person) => sum + matrix.people[person.rowIndex].responses[column], 0) : null;
    const lowerCorrect = estimated ? lower.reduce((sum, person) => sum + matrix.people[person.rowIndex].responses[column], 0) : null;
    const difference = estimated ? upperCorrect - lowerCorrect : null;
    const flags = [];
    if (estimated) { if (correct === n) flags.push('all-correct'); if (correct === 0) flags.push('all-incorrect'); if (difference === 0) flags.push('zero-discrimination'); if (difference < 0) flags.push('negative-discrimination'); }
    return { id, columnIndex: column, correct, incorrect: n - correct, estimable: estimated, difficulty: estimated ? correct / n : null, difficultyFraction: estimated ? { numerator: correct, denominator: n } : null, upperCorrect, lowerCorrect, discrimination: estimated ? difference / k : null, discriminationFraction: estimated ? { numerator: difference, denominator: k } : null, flags };
  });
  const p = { feature: 'L056', schemaVersion: 1, modelVersion: MODEL_VERSION, input: d, sourceSha256: null, matrix, sample: { people: n, items: m, estimable: estimated, minimumPeople: 10, minimumItems: 10, reason: estimated ? null : '至少10人且10题才估；保留原始计数，不给题目指标或异常结论' }, grouping: { fraction: '27%', groupSize: k, rankIncludesTargetItem: true, tieBreak: '总分降序；同分按原输入行顺序，边界同分不自动排除', ranked, upper, lower, middle: estimated ? ranked.slice(k, n - k) : ranked, boundaryTies }, items, anomalies: items.filter(item => item.flags.length).map(item => ({ id: item.id, flags: item.flags })), sourceUnknown: ['label', 'location'].filter(key => !d.source[key].trim()), definitions: [ '难度指标p=该题答对人数/全部作答人数，数值越高越容易；不是难度等级。', '上下组各floor(N×27%)人；D=(上组答对数−下组答对数)/同组人数，中间组不参与D。', '分组按含该题的整卷总分降序，同分按原输入行顺序。边界同分可能使D依赖输入顺序，须人工复核。', '样本至少10人且10题；不足时p/D为null不可估，仅显示原始计数，不用0表示未知。', '异常仅全对/全错/区分度恰0/区分度负值的字面规则，不推荐删题，不产生考试结论。', '单次离线矩阵统计不证明试卷信度、效度、学习效果、个人能力或医学结论；来源真实性仍人工核对。' ] };
  reportJson(p); reportMarkdown(p); return p;
}
export async function analyze(raw, { canceled = () => false, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const d = validateDraft(raw), parsed = parseMatrix(d.matrixText);
  for (let i = 0; i < parsed.items.length; i += 10) { if (canceled()) throw Error('统计已取消'); await yieldControl(); if (canceled()) throw Error('统计已取消'); }
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d.matrixText));
  if (canceled()) throw Error('统计已取消');
  const p = compute(d); p.sourceSha256 = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join(''); reportJson(p); reportMarkdown(p); return p;
}
export function reportJson(report) { const content = JSON.stringify(report, null, 2); if (bytes(content) > LIMITS.outputBytes) throw Error('完整JSON超过2MiB，整份拒绝'); return content; }
export function reportMarkdown(report) {
  const raw = reportJson(report).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const fence = '`'.repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map(match => match[0].length + 1)));
  const content = `# L056 试卷测量质量检查\n\n${report.sample.people}人×${report.sample.items}题；${report.sample.estimable ? '只估题目指标，无考试结论' : '样本不足，指标不可估'}。完整人工来源、原始矩阵、排序、分组及全部题目如下。\n\n${fence}json\n${raw}\n${fence}`;
  if (bytes(content) > LIMITS.outputBytes) throw Error('完整Markdown超过2MiB，整份拒绝'); return content;
}
