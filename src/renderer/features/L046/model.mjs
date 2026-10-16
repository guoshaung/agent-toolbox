export const MODEL_VERSION = 'L046-manual-coreference-anchors-v1';
const clone = value => JSON.parse(JSON.stringify(value));
export const bytes = value => new TextEncoder().encode(value).length;
function keys(value, expected, label) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== expected.length || Object.keys(value).some(k => !expected.includes(k))) throw Error(`${label}字段无效`); }
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || [...value].length > max || (required && !value.trim()) || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error(`${label}须${required ? '非空且' : ''}≤${max}Unicode码点，无非法控制/代理字符`);
  return value;
}
export function spanQuote(value, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > value.length) throw Error('区间须0起算UTF-16半开[start,end)，整数且非空，不越过当前原文');
  return text(value.slice(start, end), 240, '原文标注片段', true);
}
export function sourceSelectionRange(sourceText, controlValue, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > controlValue.length) throw Error('原文选区须非空且在文本框内');
  if (controlValue === sourceText) return [start, end];
  if (controlValue !== sourceText.replace(/\r\n|\r/g, '\n')) throw Error('文本框内容与当前原文不符，先恢复合法文本');
  const map = [0];
  for (let i = 0; i < sourceText.length;) { i += sourceText[i] === '\r' && sourceText[i + 1] === '\n' ? 2 : 1; map.push(i); }
  return [map[start], map[end]];
}
export function exampleDraft() {
  const value = '机器人见到研究员。它递给他报告，这让人意外。';
  return { schemaVersion: 1, source: { label: '用户自编指代练习', location: '第1段，无外部引文', text: value, revision: 1 }, entities: [
    { id: 'E1', name: '机器人', start: 0, end: 3, quote: '机器人', textRevision: 1, note: '' },
    { id: 'E2', name: '研究员', start: 5, end: 8, quote: '研究员', textRevision: 1, note: '' }
  ], references: [
    { id: 'R1', start: 9, end: 10, quote: '它', textRevision: 1, candidates: ['E1', 'E2'], resolution: 'bound', boundEntityId: 'E1', note: '用户人工绑定，不代表自动分析' },
    { id: 'R2', start: 12, end: 13, quote: '他', textRevision: 1, candidates: ['E2'], resolution: 'bound', boundEntityId: 'E2', note: '' },
    { id: 'R3', start: 16, end: 17, quote: '这', textRevision: 1, candidates: ['E1', 'E2'], resolution: 'unknown', boundEntityId: null, note: '可能涉及事件，暂未知；本模型只允许绑定人工实体' }
  ] };
}
export function validateDraft(raw, { forStorage = false } = {}) {
  if (bytes(JSON.stringify(raw)) > (forStorage ? 65536 : 131072)) throw Error(forStorage ? '完整输入草稿超过64KiB，不写配置；需导出完整报告，关闭只能恢复较早合法输入' : '完整输入超过128KiB，整份拒绝不截断');
  keys(raw, ['schemaVersion', 'source', 'entities', 'references'], '草稿'); if (raw.schemaVersion !== 1) throw Error('只接受schemaVersion=1输入草稿，不回填派生报告');
  keys(raw.source, ['label', 'location', 'text', 'revision'], '原文来源'); text(raw.source.label, 160, '来源名'); text(raw.source.location, 320, '出处说明'); text(raw.source.text, 16000, '完整原文');
  if (!Number.isSafeInteger(raw.source.revision) || raw.source.revision < 1 || raw.source.revision > 1000000) throw Error('文本修订须1–1000000的整数');
  if (!Array.isArray(raw.entities) || raw.entities.length > 20 || !Array.isArray(raw.references) || raw.references.length > 40) throw Error('实体≤20、指代≤40，整份拒绝');
  const entities = new Set(), references = new Set();
  function anchor(row) {
    if (!Number.isInteger(row.start) || !Number.isInteger(row.end) || row.start < 0 || row.start >= row.end || row.end > 32000 || !Number.isInteger(row.textRevision) || row.textRevision < 1 || row.textRevision > raw.source.revision) throw Error('标注位置/文本修订无效');
    text(row.quote, 240, '保留的原片段', true); text(row.note, 320, '人工标注依据');
  }
  for (const row of raw.entities) { keys(row, ['id', 'name', 'start', 'end', 'quote', 'textRevision', 'note'], '实体'); if (!/^E(?:[1-9]|1\d|20)$/.test(row.id) || entities.has(row.id)) throw Error('实体ID未知/重复'); entities.add(row.id); text(row.name, 80, '人工实体名', true); anchor(row); }
  for (const row of raw.references) {
    keys(row, ['id', 'start', 'end', 'quote', 'textRevision', 'candidates', 'resolution', 'boundEntityId', 'note'], '指代'); if (!/^R(?:[1-9]|[1-3]\d|40)$/.test(row.id) || references.has(row.id)) throw Error('指代ID未知/重复'); references.add(row.id); anchor(row);
    if (!Array.isArray(row.candidates) || row.candidates.length > 20 || new Set(row.candidates).size !== row.candidates.length || row.candidates.some(id => !entities.has(id))) throw Error('候选实体未知/重复/超限');
    if (!['bound', 'unknown', 'ambiguous'].includes(row.resolution) || (row.resolution === 'bound' ? !entities.has(row.boundEntityId) : row.boundEntityId !== null)) throw Error('明确绑定须已知实体；未知/多候选未定须null，不自动猜测');
  }
  return clone(raw);
}
export function changeText(raw, value) {
  const draft = validateDraft(raw); text(value, 16000, '完整原文'); if (value === draft.source.text) return draft;
  if (draft.source.revision === 1000000) throw Error('文本修订已达上限，导出后重开新练习');
  draft.source.text = value; draft.source.revision++; return validateDraft(draft);
}
export function reanchor(raw, kind, id, start, end) {
  const draft = validateDraft(raw), collection = kind === 'entity' ? draft.entities : kind === 'reference' ? draft.references : null, row = collection?.find(row => row.id === id);
  if (!row) throw Error('待重新标定的类别/ID未知'); const quote = spanQuote(draft.source.text, start, end);
  Object.assign(row, { start, end, quote, textRevision: draft.source.revision }); return validateDraft(draft);
}
export function addAnnotation(raw, kind, start, end) {
  const draft = validateDraft(raw), quote = spanQuote(draft.source.text, start, end), entity = kind === 'entity'; if (!entity && kind !== 'reference') throw Error('标注类别未知');
  const collection = entity ? draft.entities : draft.references, max = entity ? 20 : 40, prefix = entity ? 'E' : 'R'; if (collection.length >= max) throw Error(`最多${max}个${entity ? '实体' : '指代'}，整项拒绝`);
  const id = Array.from({ length: max }, (_, i) => `${prefix}${i + 1}`).find(id => !collection.some(row => row.id === id)), common = { id, start, end, quote, textRevision: draft.source.revision, note: '' };
  collection.push(entity ? { ...common, name: `人工实体${id}` } : { ...common, candidates: [], resolution: 'unknown', boundEntityId: null }); return validateDraft(draft);
}
export function removeAnnotation(raw, kind, id) {
  const draft = validateDraft(raw), collection = kind === 'entity' ? draft.entities : kind === 'reference' ? draft.references : null; if (!collection?.some(row => row.id === id)) throw Error('删除标注类别/ID未知');
  if (kind === 'entity' && draft.references.some(row => row.boundEntityId === id || row.candidates.includes(id))) throw Error('实体被绑定/候选引用，先人工解除引用，不隐式删除链');
  draft[kind === 'entity' ? 'entities' : 'references'] = collection.filter(row => row.id !== id); return validateDraft(draft);
}
export function anchorState(source, row) {
  const reasons = []; if (row.textRevision !== source.revision) reasons.push('text-revision-changed');
  if (row.end > source.text.length) reasons.push('outside-current-text'); else { try { const current = spanQuote(source.text, row.start, row.end); if (current !== row.quote) reasons.push('quote-mismatch'); } catch { reasons.push('invalid-current-span'); } }
  const current = reasons.length === 0; let lineNumber = null, columnUtf16 = null;
  if (current) { lineNumber = 1; let lineStart = 0; for (const match of source.text.matchAll(/\r\n|\n|\r/g)) { const end = match.index + match[0].length; if (end > row.start) break; lineNumber++; lineStart = end; } columnUtf16 = row.start - lineStart + 1; }
  return { current, reasons, lineNumber, columnUtf16 };
}
export function makeReport(raw) {
  const input = validateDraft(raw), entities = input.entities.map(row => ({ ...row, anchor: anchorState(input.source, row) })), references = input.references.map(row => ({ ...row, anchor: anchorState(input.source, row) })), byId = new Map(entities.map(row => [row.id, row]));
  const staleAnnotations = [...entities, ...references].filter(row => !row.anchor.current).map(row => ({ id: row.id, quote: row.quote, start: row.start, end: row.end, textRevision: row.textRevision, currentRevision: input.source.revision, reasons: row.anchor.reasons }));
  const conflicts = [], current = [...entities, ...references].filter(row => row.anchor.current);
  for (let i = 0; i < current.length; i++) for (let j = i + 1; j < current.length; j++) if (current[i].start < current[j].end && current[j].start < current[i].end) conflicts.push({ kind: 'span-overlap', ids: [current[i].id, current[j].id], overlapStart: Math.max(current[i].start, current[j].start), overlapEnd: Math.min(current[i].end, current[j].end), message: '两个当前标注的原区间重叠，需人工核对；不等于语言学矛盾' });
  for (const row of references) {
    if (row.resolution === 'bound' && !row.candidates.includes(row.boundEntityId)) conflicts.push({ kind: 'binding-outside-candidates', ids: [row.id, row.boundEntityId], message: '明确绑定不在用户候选表中；保留人工绑定并标记待核，不自动追加候选' });
    if (row.resolution === 'ambiguous' && row.candidates.length < 2) conflicts.push({ kind: 'ambiguous-with-fewer-than-two-candidates', ids: [row.id], message: '用户标为多候选未定但候选少于2；只核对字段声明' });
  }
  const unbound = references.flatMap(row => { const reasons = [];
    if (row.resolution !== 'bound') reasons.push(row.resolution);
    if (!row.anchor.current) reasons.push('reference-anchor-stale');
    if (row.resolution === 'bound' && !byId.get(row.boundEntityId).anchor.current) reasons.push('bound-entity-anchor-stale');
    return reasons.length ? [{ id: row.id, quote: row.quote, resolution: row.resolution, candidates: row.candidates, boundEntityId: row.boundEntityId, reasons }] : [];
  });
  const unboundIds = new Set(unbound.map(row => row.id)), chains = entities.map(row => ({ entityId: row.id, entityName: row.name, current: row.anchor.current, boundReferenceIds: references.filter(ref => ref.boundEntityId === row.id && !unboundIds.has(ref.id)).map(ref => ref.id), candidateReferenceIds: references.filter(ref => ref.anchor.current && row.anchor.current && ref.candidates.includes(row.id)).map(ref => ref.id) }));
  const report = { feature: 'L046', schemaVersion: 1, modelVersion: MODEL_VERSION, input, entities, references, chains, unbound, conflicts, staleAnnotations, totals: { entities: entities.length, references: references.length, declaredBound: references.filter(row => row.resolution === 'bound').length, effectiveBound: references.length - unbound.length, unbound: unbound.length, explicitUnknown: references.filter(row => row.resolution === 'unknown').length, ambiguous: references.filter(row => row.resolution === 'ambiguous').length, conflicts: conflicts.length, staleAnnotations: staleAnnotations.length }, definitions: [
    '全部实体名、指代区间、候选、绑定和出处由用户提供；无AI/自动候选/自动消歧，不核验认知能力或语言正确性。',
    '区间是0起算UTF-16半开[start,end)，保留当时原片段和文本修订；行/列只对当前已确认区间给出。',
    '修改原文递增文本修订，全部旧标注即使字符串未改变也失效；不重搜或悄悄移动。重新确认区间才参与当前链。',
    '未绑定按每个指代恰一次计：用户未知/多候选未定，或指代/所绑定实体区间已失效。失效不会抹掉原人工绑定记录。',
    '冲突仅为当前区间重叠、绑定不在候选表、多候选未定但不足两个候选；它们是标注一致性待核，不是自动语言学矛盾。',
    '候选线与明确绑定分开；多候选不自动选一个。绑定候选外实体保留但标冲突；所有候选/绑定原记录仍全量导出。',
    '实体代表用户选择的一个介绍片段，不自动合并同名实体，不支持绑定到另一个指代或事件解析。',
    '来源为人工文本/位置记录，非外部真实性验证；报告保留当前全文及失效旧片段，未保存历次完整文本历史。'
  ] };
  reportJson(report); reportMarkdown(report); return report;
}
export function reportJson(report) { const value = JSON.stringify(report, null, 2); if (bytes(value) > 1048576) throw Error('完整JSON超过1MiB，整份拒绝'); return value; }
export function reportMarkdown(report) { const raw = reportJson(report).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'), fence = '`'.repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map(m => m[0].length + 1))); const value = ['# L046 指代链消歧标注', `指代${report.totals.references}处，当前有效绑定${report.totals.effectiveBound}处，未绑定${report.totals.unbound}处；仅人工标注。`, '## 完整原文、来源、旧片段、候选、人工链和待核列表', `${fence}json\n${raw}\n${fence}`].join('\n\n'); if (bytes(value) > 1048576) throw Error('完整Markdown超过1MiB，整份拒绝'); return value; }
