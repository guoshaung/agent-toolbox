export const MODEL_VERSION = 'L009-exact-tag-multilabel-v1';
export const bytes = s => new TextEncoder().encode(s).length;
const clone = x => JSON.parse(JSON.stringify(x));
function keys(x, names, label) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length !== names.length || Object.keys(x).some(k => !names.includes(k))) throw Error(label + '字段无效');
}
function text(s, max, name) {
  if (typeof s !== 'string' || [...s].length > max || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(s) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s)) throw Error(name + '须≤' + max + '码点，无非法字符/孤立代理项');
}
function origin(s) { keys(s, ['label', 'location'], '人工来源'); text(s.label, 120, '来源名'); text(s.location, 240, '出处位置'); }
function tags(list, name) {
  if (!Array.isArray(list) || list.length > 16) throw Error(name + '最多16项');
  const seen = new Set();
  for (const tag of list) { text(tag, 40, name); if (!tag || tag !== tag.trim().normalize('NFC') || seen.has(tag)) throw Error(name + '须非空、trim+NFC、不可重复'); seen.add(tag); }
}
export function parseTags(raw) {
  text(raw, 1600, '逐行标签');
  const list = raw.split(/\r\n|\r|\n/).map(s => s.trim().normalize('NFC')).filter(Boolean); tags(list, '标签'); return list;
}
function rules(list, nextRule) {
  if (!Array.isArray(list) || list.length > 8) throw Error('最多8分类规则');
  const ids = new Set(), names = new Set();
  for (const r of list) {
    keys(r, ['id', 'name', 'mode', 'include', 'exclude', 'note', 'source'], '分类规则');
    if (typeof r.id !== 'string' || !/^R[1-9]\d{0,3}$/.test(r.id) || ids.has(r.id) || +r.id.slice(1) >= nextRule) throw Error('规则ID无效/重复'); ids.add(r.id);
    text(r.name, 60, '分类名称'); if (!r.name.trim() || names.has(r.name.trim().normalize('NFC'))) throw Error('分类名称不可空/重复'); names.add(r.name.trim().normalize('NFC'));
    if (!['all', 'any'].includes(r.mode)) throw Error('规则模式须全部/任一'); tags(r.include, '包含标签'); tags(r.exclude, '排除标签');
    if (r.include.some(t => r.exclude.includes(t))) throw Error('包含与排除标签相交，整项拒绝'); text(r.note, 300, '规则人工说明'); origin(r.source);
  }
}
function completeRules(list) { if (!list.length || list.some(r => !r.include.length)) throw Error('冻结/分析须至少1分类，且每类至少1包含标签；空条件不是匹配全部'); }
export function validateState(raw) {
  if (bytes(JSON.stringify(raw)) > 65536) throw Error('完整输入及规则版本超过64KiB，整项拒绝不截断；先归档再另建');
  keys(raw, ['schemaVersion', 'revision', 'title', 'context', 'source', 'cards', 'draftRules', 'versions', 'oldVersion', 'newVersion', 'nextCard', 'nextRule', 'nextVersion'], '输入');
  if (raw.schemaVersion !== 1 || !Number.isInteger(raw.revision) || raw.revision < 1 || raw.revision > 1e9) throw Error('仅schema1/有效修订号');
  text(raw.title, 80, '标题'); text(raw.context, 900, '人工背景'); origin(raw.source);
  for (const k of ['nextCard', 'nextRule', 'nextVersion']) if (!Number.isInteger(raw[k]) || raw[k] < 1 || raw[k] > 10000) throw Error('ID计数无效');
  if (!Array.isArray(raw.cards) || raw.cards.length > 30) throw Error('最多30知识卡'); const ids = new Set();
  for (const c of raw.cards) { keys(c, ['id', 'title', 'body', 'tags', 'oldCategories', 'source'], '知识卡'); if (typeof c.id !== 'string' || !/^C[1-9]\d{0,3}$/.test(c.id) || ids.has(c.id) || +c.id.slice(1) >= raw.nextCard) throw Error('知识卡ID无效/重复'); ids.add(c.id); text(c.title, 80, '卡标题'); text(c.body, 1200, '卡原文'); tags(c.tags, '卡标签'); tags(c.oldCategories, '旧分类'); origin(c.source); }
  if (new Set(raw.cards.flatMap(c => c.oldCategories)).size > 8) throw Error('当前手工旧分类最多8个不同名称');
  rules(raw.draftRules, raw.nextRule);
  if (!Array.isArray(raw.versions) || raw.versions.length > 12) throw Error('最多12冻结规则版本；先归档再另建');
  const vids = new Set(); let prev = 0;
  for (const v of raw.versions) { keys(v, ['id', 'ordinal', 'label', 'note', 'source', 'rules'], '冻结规则版本'); if (typeof v.id !== 'string' || !/^V[1-9]\d{0,3}$/.test(v.id) || +v.id.slice(1) !== v.ordinal || vids.has(v.id) || v.ordinal <= prev || v.ordinal >= raw.nextVersion) throw Error('版本ID/顺序无效'); prev = v.ordinal; vids.add(v.id); text(v.label, 80, '版本名'); text(v.note, 300, '版本说明'); origin(v.source); rules(v.rules, raw.nextRule); completeRules(v.rules); }
  if (typeof raw.oldVersion !== 'string' || raw.oldVersion !== '' && !vids.has(raw.oldVersion) || typeof raw.newVersion !== 'string' || raw.newVersion !== '' && !vids.has(raw.newVersion)) throw Error('对照版本未知');
  return clone(raw);
}
const manualSource = () => ({ label: '用户自编知识卡', location: '本地分类练习' });
export function exampleState() {
  const rs = [['R1', '机制', '机制'], ['R2', '实作', '实作']].map(([id, name, tag]) => ({ id, name, mode: 'all', include: [tag], exclude: [], note: '仅精确标签条件', source: manualSource() }));
  return validateState({ schemaVersion: 1, revision: 1, title: '三卡的多标签分类', context: '分类是人工规则输出，不生成或判断知识内容。', source: manualSource(), cards: [
    { id: 'C1', title: '理解后动手', body: '这张卡同时记录机制与实作。', tags: ['机制', '实作'], oldCategories: ['教材第一章'], source: manualSource() },
    { id: 'C2', title: '机制说明', body: '保留用户原文，不自动摘要。', tags: ['机制'], oldCategories: ['教材第二章'], source: manualSource() },
    { id: 'C3', title: '操作记录', body: '保留用户原文，不自动扩写。', tags: ['实作'], oldCategories: ['教材第二章'], source: manualSource() }
  ], draftRules: rs, versions: [{ id: 'V1', ordinal: 1, label: '初版机制/实作', note: '内置教学规则快照', source: manualSource(), rules: clone(rs) }], oldVersion: '', newVersion: 'V1', nextCard: 4, nextRule: 3, nextVersion: 2 });
}
function edit(raw, change) { const s = validateState(raw); if (s.revision === 1e9) throw Error('修订号到限'); change(s); s.revision++; return validateState(s); }
export function editMeta(raw, key, value) { return edit(raw, s => { if (['title', 'context', 'oldVersion', 'newVersion'].includes(key)) s[key] = value; else if (['sourceLabel', 'sourceLocation'].includes(key)) s.source[key === 'sourceLabel' ? 'label' : 'location'] = value; else throw Error('输入字段未知'); }); }
export function editCard(raw, id, key, value) { return edit(raw, s => { const c = s.cards.find(c => c.id === id); if (!c) throw Error('卡片未知'); if (['title', 'body'].includes(key)) c[key] = value; else if (['tags', 'oldCategories'].includes(key)) c[key] = parseTags(value); else if (['sourceLabel', 'sourceLocation'].includes(key)) c.source[key === 'sourceLabel' ? 'label' : 'location'] = value; else throw Error('卡字段未知'); }); }
export function editRule(raw, id, key, value) { return edit(raw, s => { const r = s.draftRules.find(r => r.id === id); if (!r) throw Error('规则未知'); if (['name', 'note', 'mode'].includes(key)) r[key] = value; else if (['include', 'exclude'].includes(key)) r[key] = parseTags(value); else if (['sourceLabel', 'sourceLocation'].includes(key)) r.source[key === 'sourceLabel' ? 'label' : 'location'] = value; else throw Error('规则字段未知'); }); }
export function addCard(raw) { return edit(raw, s => { s.cards.push({ id: 'C' + s.nextCard++, title: '', body: '', tags: [], oldCategories: [], source: { label: '', location: '' } }); }); }
export function addRule(raw) { return edit(raw, s => { s.draftRules.push({ id: 'R' + s.nextRule++, name: '新分类' + s.nextRule, mode: 'all', include: [], exclude: [], note: '', source: { label: '', location: '' } }); }); }
export function remove(raw, kind, id) { return edit(raw, s => { const key = kind === 'card' ? 'cards' : kind === 'rule' ? 'draftRules' : ''; if (!key || !s[key].some(x => x.id === id)) throw Error('删除目标未知'); s[key] = s[key].filter(x => x.id !== id); }); }
export function freezeRules(raw, label = '', note = '') { return edit(raw, s => { completeRules(s.draftRules); const ordinal = s.nextVersion++; s.versions.push({ id: 'V' + ordinal, ordinal, label, note, source: clone(s.source), rules: clone(s.draftRules) }); s.newVersion = 'V' + ordinal; }); }
export function copyVersionToDraft(raw, id) { return edit(raw, s => { const v = s.versions.find(v => v.id === id); if (!v) throw Error('规则版本未知'); s.draftRules = clone(v.rules); }); }
export function matches(card, rule) {
  const present = new Set(card.tags), positives = rule.include.map(t => present.has(t));
  return rule.include.length > 0 && (rule.mode === 'all' ? positives.every(Boolean) : positives.some(Boolean)) && !rule.exclude.some(t => present.has(t));
}
function side(input, versionId) {
  const version = input.versions.find(v => v.id === versionId), definitions = version ? version.rules.map(r => ({ id: r.id, name: r.name, rule: r })) : [...new Set(input.cards.flatMap(c => c.oldCategories))].map((name, i) => ({ id: 'M' + (i + 1), name, rule: null }));
  const memberships = input.cards.map(c => ({ cardId: c.id, categoryIds: definitions.filter(d => d.rule ? matches(c, d.rule) : c.oldCategories.includes(d.name)).map(d => d.id) }));
  const groups = definitions.map(d => ({ id: d.id, name: d.name, cardIds: memberships.filter(m => m.categoryIds.includes(d.id)).map(m => m.cardId) })), intersections = [];
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) intersections.push({ categoryIds: [groups[i].id, groups[j].id], cardIds: groups[i].cardIds.filter(id => groups[j].cardIds.includes(id)) });
  return { kind: version ? 'frozen-rule-version' : 'manual-old-categories', versionId, versionLabel: version?.label || '当前手工旧分类', groups, memberships, intersections, unclassifiedIds: memberships.filter(m => !m.categoryIds.length).map(m => m.cardId), uniqueClassified: memberships.filter(m => m.categoryIds.length).length, membershipCount: memberships.reduce((sum, m) => sum + m.categoryIds.length, 0) };
}
export function compute(raw) {
  const input = validateState(raw); if (!input.cards.length || !input.newVersion) throw Error('分析须至少1卡片和明确新冻结规则版本，空草稿不是合格分类');
  const old = side(input, input.oldVersion), next = side(input, input.newVersion), p = { feature: 'L009', schemaVersion: 1, modelVersion: MODEL_VERSION, input, old, next,
    comparison: input.cards.map(c => ({ cardId: c.id, oldCategoryIds: old.memberships.find(m => m.cardId === c.id).categoryIds, newCategoryIds: next.memberships.find(m => m.cardId === c.id).categoryIds })),
    counts: { totalUniqueCards: input.cards.length, oldMemberships: old.membershipCount, newMemberships: next.membershipCount, newUniqueClassified: next.uniqueClassified, newUnclassified: next.unclassifiedIds.length, newMultiLabel: next.memberships.filter(m => m.categoryIds.length > 1).length },
    metadataUnknown: [...input.cards.map(c => ({ ...c, kind: 'card' })), ...input.versions.find(v => v.id === input.newVersion).rules.map(r => ({ ...r, kind: 'rule' }))].flatMap(x => { const fields = [!(x.title || x.name || '').trim() ? 'name' : null, !x.source.label.trim() ? 'source.label' : null, !x.source.location.trim() ? 'source.location' : null].filter(Boolean); return fields.length ? [{ id: x.id, kind: x.kind, fields }] : []; }),
    definitions: ['标签逐行trim+NFC，忽略空行，区分大小写；不分词/推断同义词，重复标签拒绝。正文不参与匹配，也不生成内容。', '全部/任一包含标签匹配且不含任何排除标签才入类；每分类至少1包含标签。不同分类可同时匹配，卡ID唯一总数不会重复增加。', '两两交集保留每对类别及全部共享卡；三类共属也分别列三个二元交集，不把交集数量当唯一卡数。', '旧侧可选当前手工旧分类或冻结规则版本，新侧必须冻结版本；两规则版本均针对同一份当前卡内容复算，不冒充历史卡片快照。', '冻结版本在本界面只能追加/复制到草稿，修订不改旧规则；本地配置可被外部修改，不是不可篡改凭证。当前卡片/手工旧分类/草稿只保存当前修订。', '未归类只表示当前人工规则未命中，不评价知识正确、分类合理或学习效果；来源未知不自动补全。', '输入+所有冻结版本≤64KiB，30卡/8规则/12版本；完整JSON/Markdown各≤1MiB，超限整份拒绝不截断。'] };
  reportJson(p); reportMarkdown(p); return p;
}
export async function analyze(raw, { canceled = () => false, yieldControl = () => new Promise(r => setTimeout(r, 0)) } = {}) { const input = validateState(raw); for (let i = 0; i < Math.max(1, input.cards.length); i += 5) { if (canceled()) throw Error('分类已取消'); await yieldControl(); if (canceled()) throw Error('分类已取消'); } return compute(input); }
export function reportJson(p) { const s = JSON.stringify(p, null, 2); if (bytes(s) > 1048576) throw Error('完整JSON超过1MiB，整份拒绝'); return s; }
export function reportMarkdown(p) { const raw = reportJson(p).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'), fence = '`'.repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map(m => m[0].length + 1))), s = '# L009 概念分类重构\n\n精确人工标签规则；唯一卡数与分类成员数分别计数，不评价学习效果。\n\n' + fence + 'json\n' + raw + '\n' + fence; if (bytes(s) > 1048576) throw Error('完整Markdown超过1MiB，整份拒绝'); return s; }
export const archiveJson = s => reportJson({ feature: 'L009', kind: '完整人工输入及冻结规则版本，不是分析结果', modelVersion: MODEL_VERSION, input: validateState(s) });
export const archiveMarkdown = s => reportMarkdown(JSON.parse(archiveJson(s)));
