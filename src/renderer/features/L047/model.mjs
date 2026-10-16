export const MODEL_VERSION = 'L047-manual-fact-evidence-codepoints-v1';
const clone = value => JSON.parse(JSON.stringify(value));
export const bytes = value => new TextEncoder().encode(value).length;
function keys(value, expected, label) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== expected.length || Object.keys(value).some(k => !expected.includes(k))) throw Error(`${label}字段无效`); }
function text(value, max, label, required = false) { if (typeof value !== 'string' || [...value].length > max || (required && !value.trim()) || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error(`${label}须${required ? '非空且' : ''}≤${max}Unicode码点，无非法控制/代理字符`); return value; }
function revision(value) { if (!Number.isInteger(value) || value < 1 || value > 1000000) throw Error('修订号须1–1000000整数'); }
export const countCodePoints = value => [...value].length;
export function spanQuote(value, start, end) { if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > value.length) throw Error('证据区间须0起算UTF-16半开[start,end)，整数、非空且不越当前稿'); return text(value.slice(start, end), 240, '证据片段', true); }
export function sourceSelectionRange(sourceText, controlValue, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > controlValue.length) throw Error('稿件选区须非空且在文本框内');
  if (controlValue === sourceText) return [start, end];
  if (controlValue !== sourceText.replace(/\r\n|\r/g, '\n')) throw Error('文本框与当前稿件不符');
  const map = [0]; for (let i = 0; i < sourceText.length;) { i += sourceText[i] === '\r' && sourceText[i + 1] === '\n' ? 2 : 1; map.push(i); } return [map[start], map[end]];
}
export function exampleDraft() {
  const original = '2025年，团队在广州招募了30名参与者，试验持续7天。', compressed = '广州招募30人；试验持续7天。';
  const anchor = (text, quote) => ({ start: text.indexOf(quote), end: text.indexOf(quote) + quote.length, quote, textRevision: 1, factRevision: 1 });
  return { schemaVersion: 1, original: { label: '用户自编原稿', location: '第1句，无外部引用', text: original, revision: 1 }, compressed: { label: '用户压缩练习稿', location: '人工填写', text: compressed, revision: 1 }, limit: 5, facts: [
    { id: 'F1', statement: '地点为广州', required: true, revision: 1, originalAnchor: anchor(original, '广州'), compressedAnchor: anchor(compressed, '广州'), note: '人工绑定不等于自动证明语义一致' },
    { id: 'F2', statement: '招募30名参与者', required: true, revision: 1, originalAnchor: anchor(original, '30名'), compressedAnchor: anchor(compressed, '30人'), note: '' },
    { id: 'F3', statement: '试验持续7天', required: true, revision: 1, originalAnchor: anchor(original, '7天'), compressedAnchor: null, note: '即使稿中有7天，也须人工绑定；当前待核' }
  ] };
}
export function validateDraft(raw, { forStorage = false } = {}) {
  if (bytes(JSON.stringify(raw)) > (forStorage ? 65536 : 262144)) throw Error(forStorage ? '完整确认草稿超过64KiB，不写配置；需导出完整报告，关闭只能恢复较早合法输入' : '完整输入超过256KiB，整份拒绝不截断');
  keys(raw, ['schemaVersion', 'original', 'compressed', 'limit', 'facts'], '草稿'); if (raw.schemaVersion !== 1) throw Error('只接受schemaVersion=1确认输入，不回填派生报告');
  for (const [kind, source] of [['原稿', raw.original], ['压缩稿', raw.compressed]]) { keys(source, ['label', 'location', 'text', 'revision'], kind); text(source.label, 160, `${kind}来源名`); text(source.location, 320, `${kind}出处`); text(source.text, 16000, kind); revision(source.revision); }
  if (!Number.isInteger(raw.limit) || raw.limit < 0 || raw.limit > 16000) throw Error('字数预算须0–16000整数Unicode码点，空值不是0');
  if (!Array.isArray(raw.facts) || raw.facts.length > 20) throw Error('人工事实最多20条，整份拒绝'); const ids = new Set();
  for (const row of raw.facts) {
    keys(row, ['id', 'statement', 'required', 'revision', 'originalAnchor', 'compressedAnchor', 'note'], '事实'); if (!/^F(?:[1-9]|1\d|20)$/.test(row.id) || ids.has(row.id)) throw Error('事实ID未知/重复'); ids.add(row.id); text(row.statement, 320, '人工事实', true); text(row.note, 320, '人工依据/待核问题'); if (typeof row.required !== 'boolean') throw Error('必保标记须明确布尔值'); revision(row.revision);
    for (const [kind, value] of [['original', row.originalAnchor], ['compressed', row.compressedAnchor]]) { if (value === null) continue; keys(value, ['start', 'end', 'quote', 'textRevision', 'factRevision'], '证据锚'); if (!Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start < 0 || value.start >= value.end || value.end > 32000) throw Error('证据旧区间须整数[0,32000]且非空'); text(value.quote, 240, '原证据片段', true); revision(value.textRevision); revision(value.factRevision); if (value.textRevision > raw[kind].revision || value.factRevision > row.revision) throw Error('证据不能来自未来稿件/事实修订'); }
  }
  return clone(raw);
}
export function anchorState(source, fact, anchor) {
  if (!anchor) return { current: false, missing: true, reasons: ['unbound'], lineNumber: null, columnUtf16: null };
  const reasons = []; if (anchor.textRevision !== source.revision) reasons.push('text-revision-changed'); if (anchor.factRevision !== fact.revision) reasons.push('fact-revision-changed');
  if (anchor.end > source.text.length) reasons.push('outside-current-text'); else { try { if (spanQuote(source.text, anchor.start, anchor.end) !== anchor.quote) reasons.push('quote-mismatch'); } catch { reasons.push('invalid-current-span'); } }
  const current = reasons.length === 0; let lineNumber = null, columnUtf16 = null;
  if (current) { lineNumber = 1; let lineStart = 0; for (const match of source.text.matchAll(/\r\n|\n|\r/g)) { const end = match.index + match[0].length; if (end > anchor.start) break; lineNumber++; lineStart = end; } columnUtf16 = anchor.start - lineStart + 1; }
  return { current, missing: false, reasons, lineNumber, columnUtf16 };
}
export function changeText(raw, kind, value) { const draft = validateDraft(raw); if (!['original', 'compressed'].includes(kind)) throw Error('稿件类别未知'); text(value, 16000, '稿件'); if (draft[kind].text !== value) { if (draft[kind].revision === 1000000) throw Error('稿件修订达上限，导出后新开练习'); draft[kind].text = value; draft[kind].revision++; } return validateDraft(draft); }
export function changeFact(raw, id, statement) { const draft = validateDraft(raw), row = draft.facts.find(row => row.id === id); if (!row) throw Error('事实ID未知'); text(statement, 320, '人工事实', true); if (row.statement !== statement) { if (row.revision === 1000000) throw Error('事实修订达上限'); row.statement = statement; row.revision++; } return validateDraft(draft); }
export function bindSpan(raw, id, kind, start, end) { const draft = validateDraft(raw), row = draft.facts.find(row => row.id === id); if (!row || !['original', 'compressed'].includes(kind)) throw Error('事实ID/稿件类别未知'); const source = draft[kind], quote = spanQuote(source.text, start, end); row[kind === 'original' ? 'originalAnchor' : 'compressedAnchor'] = { start, end, quote, textRevision: source.revision, factRevision: row.revision }; return validateDraft(draft); }
export function clearSpan(raw, id, kind) { const draft = validateDraft(raw), row = draft.facts.find(row => row.id === id); if (!row || !['original', 'compressed'].includes(kind)) throw Error('事实ID/稿件类别未知'); row[kind === 'original' ? 'originalAnchor' : 'compressedAnchor'] = null; return validateDraft(draft); }
export function addFact(raw) { const draft = validateDraft(raw); if (draft.facts.length >= 20) throw Error('人工事实最多20条，不截断'); const id = Array.from({ length: 20 }, (_, i) => `F${i + 1}`).find(id => !draft.facts.some(row => row.id === id)); draft.facts.push({ id, statement: '新的人工事实（请编辑）', required: true, revision: 1, originalAnchor: null, compressedAnchor: null, note: '' }); return draft; }
export function removeFact(raw, id) { const draft = validateDraft(raw); if (!draft.facts.some(row => row.id === id)) throw Error('事实ID未知'); draft.facts = draft.facts.filter(row => row.id !== id); return draft; }
function finish(input, rows) {
  const originalCount = countCodePoints(input.original.text), compressedCount = countCodePoints(input.compressed.text), required = rows.filter(row => row.required), boundRequired = required.filter(row => row.compressedStatus.current), sourceReview = rows.filter(row => !row.originalStatus.current), pending = rows.filter(row => !row.compressedStatus.current);
  const report = { feature: 'L047', schemaVersion: 1, modelVersion: MODEL_VERSION, input, budget: { unit: 'Unicode code points including whitespace/punctuation/newlines; CRLF=2', originalCount, compressedCount, limit: input.limit, exceeded: Math.max(0, compressedCount - input.limit), remaining: Math.max(0, input.limit - compressedCount), withinLimit: compressedCount <= input.limit }, coverage: { requiredCount: required.length, boundRequiredCount: boundRequired.length, fraction: required.length ? `${boundRequired.length}/${required.length}` : null, ratio: required.length ? boundRequired.length / required.length : null }, facts: rows, pendingFactIds: pending.map(row => row.id), sourceReviewFactIds: sourceReview.map(row => row.id), totals: { facts: rows.length, required: required.length, boundRequired: boundRequired.length, pendingRequired: required.length - boundRequired.length, pendingAll: pending.length, sourceReview: sourceReview.length }, definitions: [
    '事实、必保标记、出处与压缩对应片段均由用户提供；没有AI或自动语义匹配，不评估语言/认知能力。',
    '字数预算采用Unicode码点数，包含空白、标点和换行；CRLF计2，不是UTF-16长度、词数或显示字形数。',
    '人工绑定覆盖率=当前有效压缩证据的必保事实数/全部必保事实数；不是语义保真分数，0条必保时未定义。',
    '原文来源缺失/失效独立列待补，不改变压缩人工绑定比例；该比例不证明事实有可靠来源或语义一致。',
    '改某份稿件仅使对应证据锚失效；改事实描述使该事实两份证据锚失效。不搜索或悄悄漂移旧区间。',
    '重新绑定必须用户明确确认区间与片段；多个事实可以绑定同一压缩片段，不自动断言重复、矛盾或被保留。',
    '报告保留当前两份全文、原旧证据片段和修订；不是历次全文历史或外部来源真实性证明。'
  ] };
  reportJson(report); reportMarkdown(report); return report;
}
export function makeReport(raw) { const input = validateDraft(raw); return finish(input, input.facts.map(row => ({ ...row, originalStatus: anchorState(input.original, row, row.originalAnchor), compressedStatus: anchorState(input.compressed, row, row.compressedAnchor) }))); }
export async function analyze(raw, { canceled = () => false, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const input = validateDraft(raw), rows = []; async function checkpoint() { if (canceled()) throw Error('分析已取消，没有截断报告'); await yieldControl(); if (canceled()) throw Error('分析已取消，没有截断报告'); } await checkpoint();
  for (const row of input.facts) { rows.push({ ...row, originalStatus: anchorState(input.original, row, row.originalAnchor), compressedStatus: anchorState(input.compressed, row, row.compressedAnchor) }); if (rows.length % 4 === 0) await checkpoint(); }
  await checkpoint(); return finish(input, rows);
}
export function reportJson(report) { const value = JSON.stringify(report, null, 2); if (bytes(value) > 2097152) throw Error('完整JSON超过2MiB，整份拒绝'); return value; }
export function reportMarkdown(report) { const raw = reportJson(report).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'), fence = '`'.repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map(match => match[0].length + 1))); const value = ['# L047 压缩信息保真', `压缩稿${report.budget.compressedCount}Unicode码点，预算${report.budget.limit}，超出${report.budget.exceeded}。`, `人工绑定覆盖率${report.coverage.fraction ?? '未定义（无必保事实）'}；不等于语义保真评分。原文出处待补/失效${report.totals.sourceReview}条。`, '## 完整原文/压缩稿、事实、旧证据片段、字数与人工绑定结果', `${fence}json\n${raw}\n${fence}`].join('\n\n'); if (bytes(value) > 2097152) throw Error('完整Markdown超过2MiB，整份拒绝'); return value; }
