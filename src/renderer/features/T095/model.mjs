export const LIMITS = Object.freeze({ sources: 10, bytes: 1024 * 1024, links: 5000, folders: 5000, depth: 20, title: 1000, folderTitle: 120, htmlBytes: 4 * 1024 * 1024, reportBytes: 8 * 1024 * 1024 });
const encoder = new TextEncoder(), plans = new WeakSet();
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
export function checkAbort(signal) { if (signal?.aborted) throw Object.assign(new Error('已取消书签处理。'), { name: 'AbortError' }); }
async function checkpoint(hooks) { checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal); }
function scalar(text) { return ![...text].some(char => { const code = char.codePointAt(0); return code >= 0xd800 && code <= 0xdfff; }); }
export function decodeEntities(text) {
  const names = { amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"', apos: "'", nbsp: '\u00a0' };
  if (/&#(?![xX][0-9a-fA-F]+;|[0-9]+;)[^\s&<>]*;/u.test(text)) throw new Error('HTML数字实体格式不合法。');
  return text.replace(/&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|[A-Za-z][A-Za-z0-9]*);/gu, (_, entity) => { if (entity[0] !== '#') { if (!Object.hasOwn(names, entity)) throw new Error(`不支持HTML实体&${entity};，未迁移。`); return names[entity]; } const value = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10); if (!Number.isInteger(value) || value < 1 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) throw new Error('HTML数字实体不是有效Unicode。'); return String.fromCodePoint(value); });
}
const escapeHTML = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function title(text, maximum) { if (!scalar(text) || /[\u0000-\u001f\u007f]/u.test(text) || [...text].length > maximum) throw new Error(`标题包含非法字符或超过${maximum}码点；未截断迁移。`); return text; }
export function urlReason(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u0020\u007f]/u.test(value) || !scalar(value)) return 'URL为空、含空白/控制字符或Unicode无效';
  if (!/^https?:\/\//iu.test(value)) return '仅迁移HTTP/HTTPS绝对URL，其他scheme明确不迁移';
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.hostname ? null : 'URL结构无效'; } catch { return 'URL结构无效'; }
}
// Finite Netscape tokenizer: never creates an HTML document, loads resources or executes markup.
async function tokens(text, hooks) {
  const output = []; let at = 0, checkpointAt = 0;
  while (at < text.length) {
    if (at >= checkpointAt) { checkpointAt = at + 8192; await checkpoint(hooks); }
    const start = at;
    if (text.startsWith('<!--', at)) { const end = text.indexOf('-->', at + 4); if (end < 0) throw new Error('HTML注释未闭合。'); at = end + 3; continue; }
    if (text[at] !== '<') { const end = text.indexOf('<', at); at = end < 0 ? text.length : end; output.push({ type: 'text', text: text.slice(start, at), offset: start }); continue; }
    if (/^<!doctype\s/iu.test(text.slice(at, at + 12))) { const end = text.indexOf('>', at); if (end < 0 || !/^<!DOCTYPE\s+NETSCAPE-Bookmark-file-1\s*>$/iu.test(text.slice(at, end + 1))) throw new Error('仅支持Netscape书签DOCTYPE，不支持外部DTD/声明。'); output.push({ type: 'doctype', offset: start }); at = end + 1; continue; }
    const head = /^<\s*(\/?)([A-Za-z][A-Za-z0-9]*)/u.exec(text.slice(at)); if (!head) throw new Error(`无法识别HTML标记，偏移${at}。`); at += head[0].length;
    const name = head[2].toUpperCase(), closing = head[1] === '/', attrs = {};
    if (!['META', 'TITLE', 'H1', 'DL', 'P', 'DT', 'H3', 'A'].includes(name)) throw new Error(`不支持<${name}>结构，来源整体未迁移（描述/脚本/资源标签不能静默丢失）。`);
    while (true) {
      while (/\s/u.test(text[at] || '') && at < text.length) at++; if (text[at] === '>') { at++; break; } if (text.startsWith('/>', at) && name === 'META' && !closing) { at += 2; break; }
      if (closing || at >= text.length) throw new Error('HTML标签结尾不合法。'); const key = /^[A-Za-z][A-Za-z0-9_-]*/u.exec(text.slice(at)); if (!key) throw new Error('HTML属性名不合法。'); at += key[0].length; const attribute = key[0].toUpperCase(); if (Object.hasOwn(attrs, attribute)) throw new Error('HTML含重复属性。'); if (Object.keys(attrs).length >= 20) throw new Error('HTML单标签属性超限。');
      while (/\s/u.test(text[at] || '') && at < text.length) at++; let value = '';
      if (text[at] === '=') { at++; while (/\s/u.test(text[at] || '') && at < text.length) at++; const quote = text[at]; if (quote === '"' || quote === "'") { at++; const end = text.indexOf(quote, at); if (end < 0) throw new Error('HTML属性引号未闭合。'); value = text.slice(at, end); at = end + 1; } else { const raw = /^[^\s<>"'=]+/u.exec(text.slice(at)); if (!raw) throw new Error('HTML属性值不合法。'); value = raw[0]; at += value.length; } }
      attrs[attribute] = decodeEntities(value);
    }
    output.push({ type: 'tag', name, closing, attrs, offset: start }); if (output.length > 60000) throw new Error('HTML标记数量超限。');
  }
  return output;
}
export async function parseBookmark(source, hooks = {}) {
  if (!source || typeof source.name !== 'string' || !source.name || [...source.name].length > 120 || !scalar(source.name) || /[\u0000-\u001f\u007f]/u.test(source.name) || typeof source.text !== 'string' || source.text.length > LIMITS.bytes || encoder.encode(source.text).length > LIMITS.bytes) throw new Error('来源需有1–120码点名称，书签HTML≤1 MiB。');
  const stream = await tokens(source.text.startsWith('\uFEFF') ? source.text.slice(1) : source.text, hooks), tree = { kind: 'root', children: [] }, stack = [], links = [], folders = [], ignored = new Map(); let rootSeen = false, rootClosed = false, entryReady = false, pending = null;
  const ignoredAttrs = token => { for (const key of Object.keys(token.attrs)) if (!(token.name === 'A' && key === 'HREF')) { const name = `${token.name}.${key}`; ignored.set(name, (ignored.get(name) || 0) + 1); } };
  const content = index => { let value = '', at = index + 1; while (at < stream.length && stream[at].type === 'text') value += stream[at++].text; const end = stream[at]; if (!end || end.type !== 'tag' || !end.closing || end.name !== stream[index].name) throw new Error(`${stream[index].name}标题含嵌套标签或缺少闭合，未迁移。`); return { value: decodeEntities(value), end: at }; };
  for (let index = 0; index < stream.length; index++) {
    if (index % 128 === 0) await checkpoint(hooks); const token = stream[index]; if (token.type === 'doctype') { if (rootSeen) throw new Error('DOCTYPE位置无效。'); continue; }
    if (token.type === 'text') { if (token.text.trim()) throw new Error('条目外含未识别文字，不能静默丢失。'); continue; }
    if (token.name === 'META') { if (token.closing || rootSeen) throw new Error('META只能位于书签头部。'); ignoredAttrs(token); continue; }
    if (['TITLE', 'H1'].includes(token.name)) { if (token.closing || rootSeen) throw new Error('头部标题位置无效。'); const result = content(index); title(result.value, LIMITS.title); index = result.end; ignored.set(token.name + '.HEADER', (ignored.get(token.name + '.HEADER') || 0) + 1); ignoredAttrs(token); continue; }
    if (token.name === 'P') { ignoredAttrs(token); continue; }
    if (token.name === 'DT') { if (!token.closing) { if (!stack.length || pending || entryReady) throw new Error('DT条目缺内容或文件夹缺DL，未迁移。'); entryReady = true; } ignoredAttrs(token); continue; }
    if (token.name === 'DL') {
      ignoredAttrs(token);
      if (token.closing) { if (!stack.length || pending || entryReady) throw new Error('DL闭合/未完成条目结构不合法。'); stack.pop(); if (!stack.length) rootClosed = true; }
      else if (!rootSeen) { rootSeen = true; stack.push(tree); }
      else { if (rootClosed || !pending || !stack.length) throw new Error('嵌套DL没有对应H3目录。'); if (stack.length > LIMITS.depth) throw new Error('书签目录超过20层。'); stack.at(-1).children.push(pending); stack.push(pending); pending = null; }
      continue;
    }
    if (['H3', 'A'].includes(token.name)) {
      if (token.closing || !entryReady || !stack.length || pending) throw new Error('链接/目录缺DT或层级位置不合法。'); const result = content(index), label = title(result.value, token.name === 'H3' ? LIMITS.folderTitle : LIMITS.title); index = result.end; entryReady = false; ignoredAttrs(token);
      if (token.name === 'H3') { if (folders.length >= LIMITS.folders) throw new Error('目录超过5000项。'); pending = { kind: 'folder', localId: 'F' + (folders.length + 1), title: label, children: [], offset: token.offset }; folders.push(pending); }
      else { if (links.length >= LIMITS.links) throw new Error('链接超过5000项。'); if (!Object.hasOwn(token.attrs, 'HREF')) throw new Error('链接缺少HREF，来源整体未迁移。'); const link = { kind: 'link', localId: 'L' + (links.length + 1), title: label, url: token.attrs.HREF, reason: urlReason(token.attrs.HREF), offset: token.offset }; links.push(link); stack.at(-1).children.push(link); }
    }
  }
  if (!rootSeen || !rootClosed || stack.length || pending || entryReady) throw new Error('书签必须有完整根DL及完整条目。');
  return { name: source.name, bytes: encoder.encode(source.text).length, tree, links, folders, ignoredMetadata: [...ignored].map(([field, count]) => ({ field, count })) };
}
export async function parseSources(sources, hooks = {}) {
  if (!Array.isArray(sources) || !sources.length || sources.length > LIMITS.sources) throw new Error('来源须为1–10份书签HTML。'); let total = 0; for (const source of sources) { if (typeof source?.text !== 'string') throw new Error('来源缺少HTML文本。'); total += encoder.encode(source.text).length; if (total > LIMITS.bytes) throw new Error('所有来源HTML合计超过1 MiB。'); }
  const parsed = []; let links = 0, folders = 0;
  for (let index = 0; index < sources.length; index++) { let source; try { source = await parseBookmark(sources[index], hooks); } catch (error) { if (error.name === 'AbortError') throw error; throw new Error(`来源S${index + 1}（${sources[index]?.name || '未命名'}）：${error.message}`); } links += source.links.length; folders += source.folders.length; if (links > LIMITS.links || folders > LIMITS.folders) throw new Error('全部来源合计链接/目录超过5000项。'); parsed.push({ ...source, id: 'S' + (index + 1) }); hooks.onProgress?.(`已解析来源${index + 1}/${sources.length}`); }
  return parsed;
}
export function pathText(report, ids, current = true) { const byId = new Map(report.folders.map(folder => [folder.id, folder])); return ids.map(id => current ? byId.get(id).title : byId.get(id).originalTitle).join(' / '); }
export async function createPlan(parsed, options = {}, hooks = {}) {
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > LIMITS.sources || typeof options.dedupe !== 'boolean' || (options.acknowledgeLoss !== undefined && typeof options.acknowledgeLoss !== 'boolean') || !options.renames || typeof options.renames !== 'object' || Array.isArray(options.renames)) throw new Error('请明确去重选择、重命名映射与未迁移确认。');
  const folders = [], links = [], trees = [], sourceReports = [], usedRenames = new Set(), seenURLs = new Map(), duplicateGroups = new Map(), sourceRootTitles = new Set(); let folderCount = 0, inputLinks = 0;
  const rename = (id, original) => { if (!Object.hasOwn(options.renames, id)) return original; usedRenames.add(id); const next = options.renames[id]; if (typeof next !== 'string' || !next.trim() || next !== next.trim()) throw new Error('重命名须为非空标题，且没有首尾空白。'); return title(next, LIMITS.folderTitle); };
  async function copy(node, source, parents) {
    if (parents.length > LIMITS.depth) throw new Error('迁移层级超过20（含来源根），不能截断目录。');
    const id = source.id + '-' + node.localId;
    if (node.kind === 'folder') {
      if (parents.length >= LIMITS.depth) throw new Error('迁移层级超过20（含来源根），不能截断目录。');
      if (++folderCount > LIMITS.folders + LIMITS.sources) throw new Error('迁移目录超限。'); const current = rename(id, node.title); folders.push({ id, sourceId: source.id, parentId: parents.at(-1), originalTitle: node.title, title: current, originalPathIds: [...parents, id], outputPathIds: [...parents, id] });
      const children = []; for (const child of node.children) { const next = await copy(child, source, [...parents, id]); if (next) children.push(next); } return { kind: 'folder', id, title: current, children };
    }
    if (++inputLinks > LIMITS.links) throw new Error('链接超过5000项。'); if (inputLinks % 128 === 0) await checkpoint(hooks);
    const prior = seenURLs.get(node.url); let status = 'retained', reason = node.reason, keptId = null;
    if (reason) status = 'unsupported'; else { if (!duplicateGroups.has(node.url)) duplicateGroups.set(node.url, []); duplicateGroups.get(node.url).push(id); if (prior && options.dedupe) { status = 'duplicateRemoved'; reason = '用户选择精确URL去重，保留首次出现条目'; keptId = prior; } else if (!prior) seenURLs.set(node.url, id); }
    links.push({ id, sourceId: source.id, title: node.title, url: node.url, sourceOffset: node.offset, originalPathIds: [...parents], outputPathIds: [...parents], status, reason, keptId }); return status === 'retained' ? { kind: 'link', id, title: node.title, url: node.url } : null;
  }
  for (const source of parsed) {
    await checkpoint(hooks); const original = `${source.id} · ${source.name}`, current = rename(source.id, original); if (sourceRootTitles.has(current)) throw new Error('来源根目录名字须唯一，不能合并来源同名层级。'); sourceRootTitles.add(current);
    folders.push({ id: source.id, sourceId: source.id, parentId: null, originalTitle: original, title: current, originalPathIds: [source.id], outputPathIds: [source.id] }); const children = []; for (const child of source.tree.children) { const next = await copy(child, source, [source.id]); if (next) children.push(next); } trees.push({ kind: 'folder', id: source.id, title: current, children });
    const own = links.filter(link => link.sourceId === source.id), ownFolders = folders.filter(folder => folder.sourceId === source.id); sourceReports.push({ id: source.id, name: source.name, bytes: source.bytes, rootTitle: current, folderCount: ownFolders.length, maxDepth: ownFolders.reduce((maximum, folder) => Math.max(maximum, folder.outputPathIds.length), 0), inputLinks: own.length, retained: own.filter(link => link.status === 'retained').length, unsupported: own.filter(link => link.status === 'unsupported').length, duplicateRemoved: own.filter(link => link.status === 'duplicateRemoved').length, ignoredMetadata: source.ignoredMetadata });
  }
  if (Object.keys(options.renames).some(id => !usedRenames.has(id))) throw new Error('重命名映射含不存在的目录ID。');
  const retained = links.filter(link => link.status === 'retained').length, unsupported = links.filter(link => link.status === 'unsupported').length, duplicateRemoved = links.filter(link => link.status === 'duplicateRemoved').length, hasMetadataLoss = sourceReports.some(source => source.ignoredMetadata.length);
  const report = { feature: 'T095', version: 1, inputLinks, retained, unsupported, duplicateRemoved, folderCount: folders.length, maxDepth: sourceReports.reduce((maximum, source) => Math.max(maximum, source.maxDepth), 0), folders: folders.map(folder => ({ ...folder })), sources: sourceReports, links, duplicateGroups: [...duplicateGroups].filter(([, ids]) => ids.length > 1).map(([url, ids]) => ({ url, ids })), renames: folders.filter(folder => folder.title !== folder.originalTitle).map(folder => ({ id: folder.id, from: folder.originalTitle, to: folder.title })), rules: { dedupe: options.dedupe, acknowledgeLoss: options.acknowledgeLoss === true, schemes: ['http:', 'https:'], urlComparison: 'HTML实体解码后的精确字符串，不规范化host/query/fragment', paths: '路径ID链对应folders字典，originalTitle/当前title可完整重建原/新目录路径', depth: '最多20层目录，包含来源根', metadata: '仅保留目录标题、链接标题与精确URL；日期、图标、标签、快捷字等属性及HTML头部标题在报告中说明不迁移', resources: '有限字符串语法解析，不创建HTML文档，不执行/加载任何输入资源' } };
  if (retained + unsupported + duplicateRemoved !== inputLinks) throw new Error('迁移数量不一致。');
  const result = deepFreeze({ report, trees, canExport: (!unsupported && !hasMetadataLoss) || options.acknowledgeLoss === true }); plans.add(result); return result;
}
export async function serializePlan(plan, format, hooks = {}) {
  if (!plans.has(plan) || !plan.canExport) throw new Error('必须生成有效预览并确认未迁移链接/元数据，才可导出。'); if (!['html', 'json'].includes(format)) throw new Error('仅支持HTML/JSON。'); await checkpoint(hooks); let content;
  if (format === 'json') content = JSON.stringify(plan.report, null, 2) + '\n';
  else {
    const output = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>迁移书签副本</TITLE>', '<H1>迁移书签副本</H1>', '<DL><p>']; let count = 0;
    const write = async (node, depth) => { if (++count % 128 === 0) await checkpoint(hooks); const pad = '  '.repeat(depth); if (node.kind === 'folder') { output.push(`${pad}<DT><H3>${escapeHTML(node.title)}</H3>`, `${pad}<DL><p>`); for (const child of node.children) await write(child, depth + 1); output.push(`${pad}</DL><p>`); } else output.push(`${pad}<DT><A HREF="${escapeHTML(node.url)}">${escapeHTML(node.title)}</A>`); };
    for (const node of plan.trees) await write(node, 1); output.push('</DL><p>'); content = output.join('\n') + '\n';
  }
  if (encoder.encode(content).length > (format === 'html' ? LIMITS.htmlBytes : LIMITS.reportBytes)) throw new Error('副本大小超限，未截断导出。'); checkAbort(hooks.signal); return content;
}
