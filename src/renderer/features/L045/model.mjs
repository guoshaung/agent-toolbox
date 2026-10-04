export const MODEL_VERSION = 'L045-user-block-parent-constraints-v1';
export const ROLES = { main: '主句框架', clause: '从句', noun: '名词块', verb: '动词块', modifier: '修饰块' };
const clone = value => JSON.parse(JSON.stringify(value));
export const utf8Bytes = value => new TextEncoder().encode(value).length;
function keys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== expected.length || Object.keys(value).some(k => !expected.includes(k))) throw Error(`${label}字段无效`);
}
function text(value, limit, label, nonempty = false) {
  if (typeof value !== 'string' || [...value].length > limit || (nonempty && !value.trim()) || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error(`${label}须${nonempty ? '非空且' : ''}≤${limit}Unicode码点，无非法控制/代理字符`);
  return value;
}
const validId = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,11}$/.test(value);
export function exampleDraft() {
  return { schemaVersion: 1, source: { label: '人工英文句块练习（不是解析结果）', originalText: 'The researcher explains the result that we measured.', location: '用户自编例句，无外部引文' }, rootId: 'M', blocks: [
    { id: 'M', role: 'main', text: '主句框架' }, { id: 'N', role: 'noun', text: 'the result' }, { id: 'V', role: 'verb', text: 'explains' }, { id: 'C', role: 'clause', text: 'that we measured' }
  ], parents: [{ id: 'M', parentId: null }, { id: 'N', parentId: 'M' }, { id: 'V', parentId: 'M' }, { id: 'C', parentId: 'V' }], order: ['M', 'N', 'V', 'C'], constraints: [{ id: 'K1', childId: 'C', expectedParentId: 'N', basis: '用户声明：从句C修饰名词块N' }] };
}
export function validateDraft(raw, { forStorage = false } = {}) {
  const size = utf8Bytes(JSON.stringify(raw));
  if (size > (forStorage ? 65536 : 131072)) throw Error(forStorage ? '完整输入草稿超过64KiB，不写配置；需导出完整报告，关闭只能恢复较早合法输入' : '完整输入超过128KiB，整份拒绝不截断');
  keys(raw, ['schemaVersion', 'source', 'rootId', 'blocks', 'parents', 'order', 'constraints'], '草稿');
  if (raw.schemaVersion !== 1) throw Error('只接受schemaVersion=1输入草稿，不回填派生报告');
  keys(raw.source, ['label', 'originalText', 'location'], '来源');
  text(raw.source.label, 160, '来源名'); text(raw.source.originalText, 16000, '原句上下文'); text(raw.source.location, 320, '出处说明');
  if (!Array.isArray(raw.blocks) || raw.blocks.length < 1 || raw.blocks.length > 12) throw Error('句块须1–12个，整份拒绝');
  const ids = new Set();
  for (const block of raw.blocks) {
    keys(block, ['id', 'role', 'text'], '句块');
    if (!validId(block.id) || ids.has(block.id)) throw Error('句块ID重复/无效，须1–12位大写字母/数字/下划线且以字母开头');
    ids.add(block.id); if (!Object.hasOwn(ROLES, block.role)) throw Error('只接受主句/从句/名词/动词/修饰人工角色');
    text(block.text, 240, '句块文本', true);
  }
  if (!ids.has(raw.rootId) || raw.blocks.find(b => b.id === raw.rootId).role !== 'main') throw Error('根必须是存在的人工主句框架');
  if (!Array.isArray(raw.parents) || raw.parents.length !== ids.size) throw Error('每个句块恰有一条父节点记录');
  const parentMap = new Map();
  for (const row of raw.parents) {
    keys(row, ['id', 'parentId'], '父节点');
    if (!ids.has(row.id) || parentMap.has(row.id)) throw Error('父记录ID未知/重复');
    if (row.id === raw.rootId ? row.parentId !== null : !ids.has(row.parentId) || row.parentId === row.id) throw Error('根父节点必须null；其余父节点须已知且不能自身');
    parentMap.set(row.id, row.parentId);
  }
  if (!Array.isArray(raw.order) || raw.order.length !== ids.size || new Set(raw.order).size !== ids.size || raw.order.some(id => !ids.has(id))) throw Error('排序必须包含每个句块恰一次');
  for (const id of ids) {
    const seen = new Set(); let current = id;
    while (current !== null) { if (seen.has(current)) throw Error('父子关系成环；整项移动/输入拒绝'); seen.add(current); current = parentMap.get(current); }
  }
  if (!Array.isArray(raw.constraints) || raw.constraints.length > 12) throw Error('用户约束最多12条');
  const constraintIds = new Set(), expectedParents = new Map();
  for (const row of raw.constraints) {
    keys(row, ['id', 'childId', 'expectedParentId', 'basis'], '约束');
    if (!/^K(?:[1-9]|1[0-2])$/.test(row.id) || constraintIds.has(row.id)) throw Error('约束ID未知/重复');
    constraintIds.add(row.id);
    if (!ids.has(row.childId) || row.childId === raw.rootId || !ids.has(row.expectedParentId) || row.childId === row.expectedParentId || expectedParents.has(row.childId)) throw Error('约束子块/父块未知、自指、根被指定父节点或同一子块约束重复');
    expectedParents.set(row.childId, row.expectedParentId); text(row.basis, 320, '用户约束依据');
  }
  for (const id of expectedParents.keys()) {
    const seen = new Set(); let current = id;
    while (expectedParents.has(current)) { if (seen.has(current)) throw Error('用户目标约束成环，不可能同时满足，先修改约束'); seen.add(current); current = expectedParents.get(current); }
  }
  return clone(raw);
}
export function moveBlock(raw, id, parentId, beforeId = null) {
  const draft = validateDraft(raw);
  if (id === draft.rootId || !draft.blocks.some(b => b.id === id) || !draft.blocks.some(b => b.id === parentId)) throw Error('只能移动已知非根句块到已知父节点');
  draft.parents.find(row => row.id === id).parentId = parentId;
  draft.order = draft.order.filter(value => value !== id);
  if (beforeId !== null) {
    if (beforeId === id || !draft.order.includes(beforeId) || draft.parents.find(row => row.id === beforeId)?.parentId !== parentId) throw Error('排序参照必须是目标父节点下的其他同级块');
    draft.order.splice(draft.order.indexOf(beforeId), 0, id);
  } else {
    const siblings = draft.order.filter(value => draft.parents.find(row => row.id === value).parentId === parentId);
    const index = siblings.length ? draft.order.indexOf(siblings.at(-1)) + 1 : draft.order.length;
    draft.order.splice(index, 0, id);
  }
  return validateDraft(draft);
}
export function moveSibling(raw, id, direction) {
  const draft = validateDraft(raw);
  if (id === draft.rootId || ![-1, 1].includes(direction)) throw Error('只允许非根同级前移/后移');
  const parent = draft.parents.find(row => row.id === id)?.parentId;
  if (!parent) throw Error('移动句块未知');
  const siblings = draft.order.filter(value => draft.parents.find(row => row.id === value).parentId === parent), index = siblings.indexOf(id), other = siblings[index + direction];
  if (!other) throw Error('已在同级边界，不能继续移动');
  const a = draft.order.indexOf(id), b = draft.order.indexOf(other); [draft.order[a], draft.order[b]] = [draft.order[b], draft.order[a]];
  return validateDraft(draft);
}
export function addBlock(raw) {
  const draft = validateDraft(raw); if (draft.blocks.length >= 12) throw Error('最多12句块，整项拒绝');
  const id = Array.from({ length: 12 }, (_, i) => `B${i + 1}`).find(id => !draft.blocks.some(b => b.id === id));
  draft.blocks.push({ id, role: 'modifier', text: '新人工句块' }); draft.parents.push({ id, parentId: draft.rootId }); draft.order.push(id);
  return validateDraft(draft);
}
export function removeBlock(raw, id) {
  const draft = validateDraft(raw);
  if (id === draft.rootId || !draft.blocks.some(b => b.id === id)) throw Error('不能删除根/未知句块');
  if (draft.parents.some(row => row.parentId === id)) throw Error('此块有子节点，请先人工移走子块');
  if (draft.constraints.some(row => row.childId === id || row.expectedParentId === id)) throw Error('此块被约束引用，请先人工删除对应约束');
  draft.blocks = draft.blocks.filter(b => b.id !== id); draft.parents = draft.parents.filter(row => row.id !== id); draft.order = draft.order.filter(value => value !== id);
  return validateDraft(draft);
}
export function makeReport(raw) {
  const draft = validateDraft(raw), flatNodes = [], edges = [], byId = new Map(draft.blocks.map(b => [b.id, b])), parentMap = new Map(draft.parents.map(row => [row.id, row.parentId]));
  function visit(id, depth = 0) {
    const children = draft.order.filter(value => parentMap.get(value) === id), block = byId.get(id);
    flatNodes.push({ ...block, roleLabel: ROLES[block.role], parentId: parentMap.get(id), depth, childrenIds: children });
    for (const child of children) edges.push({ from: id, to: child });
    return { ...block, children: children.map(child => visit(child, depth + 1)) };
  }
  const tree = visit(draft.rootId), constraintResults = draft.constraints.map(row => ({ ...row, actualParentId: parentMap.get(row.childId), satisfied: parentMap.get(row.childId) === row.expectedParentId }));
  const errors = constraintResults.filter(row => !row.satisfied).map(row => ({ kind: 'parent', constraintId: row.id, blockId: row.childId, actualParentId: row.actualParentId, expectedParentId: row.expectedParentId, basis: row.basis, message: `${row.childId}父节点为${row.actualParentId}，用户约束要求${row.expectedParentId}` }));
  const report = { feature: 'L045', schemaVersion: 1, modelVersion: MODEL_VERSION, input: draft, tree, flatNodes, edges, preorderIds: flatNodes.map(row => row.id), constraintResults, errors, totals: { blocks: draft.blocks.length, declaredConstraints: draft.constraints.length, satisfied: constraintResults.length - errors.length, unsatisfied: errors.length }, status: !constraintResults.length ? 'no-declared-constraints' : errors.length ? 'user-constraint-mismatch' : 'user-constraints-satisfied', definitions: [
    '原句、出处、角色和目标父节点均为用户输入，不自动解析文本，不核验作者引文/语法标准。',
    '主句框架是唯一根；子节点按用户全序在各自同级中排序，拖动父节点会携带其整棵子树。',
    '只检查人工声明的父节点相等约束；同级顺序可以练习但没有自动语言学排序评分。',
    '未声明约束的句块不自动评判；无约束不等于语法正确，全部满足不证明句法/语义/认知能力。',
    '树线只是人工层级关系，不是某种语言学分析体系的自动解析或认证。',
    '输入编辑/移动后旧检查失效，主动检查后输出完整原句、全部句块/顺序/树/约束结果。'
  ] };
  reportJson(report); reportMarkdown(report); return report;
}
export function reportJson(report) { const value = JSON.stringify(report, null, 2); if (utf8Bytes(value) > 1048576) throw Error('完整报告超过1MiB，整份拒绝'); return value; }
export function reportMarkdown(report) {
  const raw = reportJson(report).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'), fence = '`'.repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map(m => m[0].length + 1)));
  const value = ['# L045 句法重排沙盘', `用户父节点约束${report.totals.declaredConstraints}条，未满足${report.totals.unsatisfied}条；不构成语言能力或语法正确性评分。`, '## 人工层级（先序，缩进为用户父子关系）', report.flatNodes.map(n => '  '.repeat(n.depth) + `${n.id} [${n.roleLabel}] ${JSON.stringify(n.text)}`).join('\n'), '## 完整来源、输入、树、排序与全部约束', `${fence}json\n${raw}\n${fence}`].join('\n\n');
  if (utf8Bytes(value) > 1048576) throw Error('完整Markdown超过1MiB，整份拒绝'); return value;
}
