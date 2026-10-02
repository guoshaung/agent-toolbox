export const LIMITS = Object.freeze({ sourceBytes: 20 * 1024 * 1024, entries: 2000, jsonBytes: 256 * 1024, samples: 20, sampleTotalBytes: 2 * 1024 * 1024, depth: 20, jsonNodes: 20000, jsonFields: 200, fieldUnits: 80, reportBytes: 8 * 1024 * 1024, pathUnits: 500, rawNameBytes: 512 });
const encoder = new TextEncoder(), reports = new WeakSet(), CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
export function checkAbort(signal) { if (signal?.aborted) throw Object.assign(new Error('已取消盘点。'), { name: 'AbortError' }); }
async function checkpoint(hooks) { checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal); }
function scalar(text) { return ![...text].some(char => { const n = char.codePointAt(0); return n >= 0xd800 && n <= 0xdfff; }); }
function sourceName(name) { if (typeof name !== 'string' || !name || name.length > 240 || [...name].length > 120 || !scalar(name) || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('来源名称须为1–120码点，无控制/非法Unicode。'); return name; }
export function validatePaths(entries) {
  const known = new Map();
  for (const entry of entries) {
    if (entry.path === null) continue; const value = entry.kind === 'directory' ? entry.path.slice(0, -1) : entry.path;
    if (typeof value !== 'string' || !value || value.length > LIMITS.pathUnits || !scalar(value) || !value.split('/').every(part => part.length > 0 && part.length <= 120 && !['.', '..'].includes(part) && !/[\u0000-\u001f\u007f<>:"|?*\\/]/u.test(part) && !/[. ]$/u.test(part) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part))) throw new Error('不安全路径：绝对/遍历/保留名/非法字符或路径超限，已阻止报告导出。');
    const key = value.normalize('NFC').toLowerCase(); if (known.has(key)) throw new Error('路径重复、大小写/NFC或文件目录冲突。'); known.set(key, entry.kind);
  }
  for (const name of known.keys()) { const parts = name.split('/'); for (let index = 1; index < parts.length; index++) if (known.has(parts.slice(0, index).join('/')) && known.get(parts.slice(0, index).join('/')) !== 'directory') throw new Error('文件与目录前缀冲突。'); }
}
function category(path) {
  if (path === null) return { category: '未知类别', categoryBasis: '名称编码未识别，不推测内容' }; const pieces = path.toLowerCase().split('/'), basename = pieces.at(-1), stem = basename.replace(/\.[^.]+$/u, '');
  if ([...pieces.slice(0, -1), stem].some(part => ['account', 'profile', 'personal_info', 'user_info', 'userinfo', '账号', '账户', '个人资料'].includes(part))) return { category: '账号资料', categoryBasis: '仅路径/文件名推测，未确认个人内容语义' };
  if (pieces.some(part => ['photos', 'pictures', 'images', '照片', '相册'].includes(part)) || /\.(jpg|jpeg|png|gif|webp|heic|tiff|bmp)$/iu.test(basename)) return { category: '照片', categoryBasis: '仅路径/扩展名推测，没有解码图片' };
  return { category: /\.json$/iu.test(basename) ? '其他JSON数据' : '其他文件', categoryBasis: '仅扩展名/路径推测' };
}
export async function crc32(bytes, hooks = {}) { let value = 0xffffffff; for (let index = 0; index < bytes.length; index++) { if (index % 16384 === 0) await checkpoint(hooks); value = CRC_TABLE[(value ^ bytes[index]) & 255] ^ (value >>> 8); } checkAbort(hooks.signal); return (value ^ 0xffffffff) >>> 0; }
export async function jsonSchema(bytes, hooks = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > LIMITS.jsonBytes) throw new Error('JSON抽检超出256 KiB。'); let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('JSON不是有效UTF-8。'); } if (text.startsWith('\uFEFF')) text = text.slice(1);
  // Bounded duplicate-key scan, without logging source tokens or values.
  const stack = []; let at = 0, nextYield = 0;
  while (at < text.length) {
    if (at >= nextYield) { nextYield = at + 8192; await checkpoint(hooks); } const ch = text[at++];
    if (ch === '"') { const start = at - 1; let escaped = false, closed = false; while (at < text.length) { const c = text[at++]; if (c === '"' && !escaped) { closed = true; break; } if (c === '\\' && !escaped) escaped = true; else escaped = false; if (at >= nextYield) { nextYield = at + 8192; await checkpoint(hooks); } } if (!closed) throw new Error('JSON语法无效。'); const top = stack.at(-1); if (top?.object && top.key) { let key; try { key = JSON.parse(text.slice(start, at)); } catch { throw new Error('JSON属性语法无效。'); } if (top.keys.has(key)) throw new Error('JSON含重复字段，结构未抽检。'); top.keys.add(key); top.key = false; } }
    else if (ch === '{' || ch === '[') { if (stack.length >= LIMITS.depth) throw new Error('JSON深度超过20。'); stack.push({ object: ch === '{', key: true, keys: new Set() }); } else if (ch === '}' || ch === ']') stack.pop(); else if (ch === ',' && stack.at(-1)?.object) stack.at(-1).key = true;
  }
  let root; try { root = JSON.parse(text); } catch { throw new Error('JSON语法无效（不输出错误中的个人值）。'); }
  const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value, fields = new Map(), counts = { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 }; let nodes = 0, arrayElements = 0;
  const visit = async (value, depth) => { if (depth > LIMITS.depth || ++nodes > LIMITS.jsonNodes) throw new Error('JSON结构深度/节点数超限。'); if (nodes % 128 === 0) await checkpoint(hooks); const kind = type(value); if ((kind === 'string' && !scalar(value)) || (kind === 'number' && !Number.isFinite(value))) throw new Error('JSON包含无法准确表示的Unicode或非有限数字。'); counts[kind]++;
    if (kind === 'array') { arrayElements += value.length; for (const item of value) await visit(item, depth + 1); } else if (kind === 'object') for (const [name, child] of Object.entries(value)) { if (name.length > LIMITS.fieldUnits || !scalar(name) || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('字段名长度/字符超限，结构未抽检。'); if (!fields.has(name)) { if (fields.size >= LIMITS.jsonFields) throw new Error('JSON不同字段名超过200，结构未抽检。'); fields.set(name, { name, occurrences: 0, types: {} }); } const field = fields.get(name); field.occurrences++; field.types[type(child)] = (field.types[type(child)] || 0) + 1; await visit(child, depth + 1); }
  };
  await visit(root, 0); checkAbort(hooks.signal); return { rootType: type(root), totalNodes: nodes, typeCounts: counts, arrayElements, fields: [...fields.values()].sort((left, right) => left.name.localeCompare(right.name)), valuesIncluded: false };
}
function extraFields(bytes, start, length) { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ids = []; let at = start; while (at < start + length) { if (at + 4 > start + length) throw new Error('ZIP extra字段边界无效。'); const id = view.getUint16(at, true), size = view.getUint16(at + 2, true); at += 4; if (at + size > start + length) throw new Error('ZIP extra数据越界。'); if (id === 1) throw new Error('ZIP64不支持，不能当普通ZIP盘点。'); ids.push(id); at += size; } return ids; }
function nameInfo(raw, flags, extraIds) {
  let path = null, encoding;
  if (flags & 0x800) { try { path = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); encoding = 'UTF-8（bit11）'; } catch { encoding = 'UTF-8标记但名称无效，仅原始名称元数据'; } }
  else if (raw.every(byte => byte < 128) && !extraIds.includes(0x7075) && !extraIds.includes(8)) { path = String.fromCharCode(...raw); encoding = 'ASCII兼容名称'; }
  else encoding = '未知/扩展名称编码未解码（CP437等不猜测）';
  if (path === null) { const visible = String.fromCharCode(...raw).replace(/[\u0080-\u00ff]/gu, '¤'); if (visible.startsWith('/') || /[\u0000-\u001f\u007f\\:<>"|?*]/u.test(visible) || visible.split('/').some((part, index, parts) => ['.', '..'].includes(part) || (!part && index < parts.length - 1) || /[. ]$/u.test(part))) throw new Error('未知名称编码中仍检测到ASCII遍历/非法路径，已阻止盘点。'); }
  return { path, nameEncoding: encoding, rawNameHex: path === null ? [...raw].map(byte => byte.toString(16).padStart(2, '0')).join('') : null, pathVerified: path !== null };
}
export async function readZIP(bytes, hooks = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > LIMITS.sourceBytes) throw new Error('ZIP需为22字节–20 MiB。'); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), u16 = at => view.getUint16(at, true), u32 = at => view.getUint32(at, true), candidates = [];
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) { if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) candidates.push(at); }
  if (candidates.length !== 1) throw new Error('ZIP EOCD缺失/不唯一/尾部损坏。'); const end = candidates[0], count = u16(end + 10), size = u32(end + 12), central = u32(end + 16);
  if ([u16(end + 8), count].includes(65535) || size === 0xffffffff || central === 0xffffffff || (end >= 20 && u32(end - 20) === 0x07064b50)) throw new Error('ZIP64不支持。');
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) throw new Error('跨磁盘/拆分ZIP不支持。'); if (count > LIMITS.entries || central + size !== end || central > end) throw new Error('ZIP中央目录数量/offset/大小越界或未知记录。');
  const entries = [], ranges = [], rawNames = new Set(); let at = central;
  for (let index = 0; index < count; index++) {
    if (index % 32 === 0) await checkpoint(hooks); if (at + 46 > end || u32(at) !== 0x02014b50) throw new Error('ZIP中央目录记录不完整/签名无效（加密中央目录不支持）。');
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), compressed = u32(at + 20), declared = u32(at + 24), nameLength = u16(at + 28), extraLength = u16(at + 30), commentLength = u16(at + 32), disk = u16(at + 34), local = u32(at + 42), versionNeeded = u16(at + 6);
    if ([compressed, declared, local].includes(0xffffffff) || disk === 65535) throw new Error('ZIP64条目不支持。'); if (disk || !nameLength || nameLength > LIMITS.rawNameBytes || at + 46 + nameLength + extraLength + commentLength > end) throw new Error('ZIP条目跨盘/名称/边界无效。');
    const raw = bytes.subarray(at + 46, at + 46 + nameLength), rawHex = [...raw].map(byte => byte.toString(16).padStart(2, '0')).join(''); if (rawNames.has(rawHex)) throw new Error('ZIP有重复原始名称。'); rawNames.add(rawHex); const centralExtras = extraFields(bytes, at + 46 + nameLength, extraLength);
    if (local + 30 > central || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method || u16(local + 4) !== versionNeeded || u16(local + 26) !== nameLength) throw new Error('ZIP local头/中央头方法、flags、版本或名称不一致。');
    const localExtraLength = u16(local + 28), dataAt = local + 30 + nameLength + localExtraLength; if (dataAt > central || dataAt + compressed > central || !raw.every((byte, offset) => bytes[local + 30 + offset] === byte)) throw new Error('ZIP local名称或数据边界不一致。'); const localExtras = extraFields(bytes, local + 30 + nameLength, localExtraLength);
    if (flags & 8) { if (![0, crc].includes(u32(local + 14)) || ![0, compressed].includes(u32(local + 18)) || ![0, declared].includes(u32(local + 22))) throw new Error('ZIP local描述符声明不一致。'); } else if (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== declared) throw new Error('ZIP local和中央CRC/大小声明不一致。');
    let rangeEnd = dataAt + compressed;
    if (flags & 8) { const descriptors = [rangeEnd, ...(rangeEnd + 4 <= central && u32(rangeEnd) === 0x08074b50 ? [rangeEnd + 4] : [])].filter(descriptor => descriptor + 12 <= central && u32(descriptor) === crc && u32(descriptor + 4) === compressed && u32(descriptor + 8) === declared); if (descriptors.length !== 1) throw new Error('ZIP data descriptor缺失/不一致/歧义。'); rangeEnd = descriptors[0] + 12; }
    if ((u32(at + 38) & 0x10) && raw.at(-1) !== 47) throw new Error('ZIP目录属性与名称末尾斜杠不一致。');
    const info = nameInfo(raw, flags, [...centralExtras, ...localExtras]), unixMode = u16(at + 4) >>> 8 === 3 ? u32(at + 38) >>> 16 : 0, kind = raw.at(-1) === 47 ? 'directory' : (unixMode & 0xf000) === 0xa000 ? 'symlink' : 'file'; if (kind === 'directory' && (compressed || declared)) throw new Error('ZIP目录条目含数据声明，不支持。');
    const encrypted = Boolean(flags & (1 | 0x40 | 0x2000)); if (method === 0 && !encrypted && compressed !== declared) throw new Error('stored条目压缩/未压缩大小声明不一致。');
    entries.push({ id: 'Z' + (index + 1), ...info, kind, flags, method, encrypted, versionNeeded, declaredCompressedBytes: compressed, declaredUncompressedBytes: declared, declaredCRC32: crc.toString(16).padStart(8, '0'), declaredCRCValue: crc, dataAt, dataEnd: dataAt + compressed, localOffset: local, ignoredExtraIds: [...new Set([...centralExtras, ...localExtras])], commentBytes: commentLength }); ranges.push({ start: local, end: rangeEnd }); at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== end) throw new Error('ZIP中央目录大小或条目数量不符。'); ranges.sort((left, right) => left.start - right.start); let boundary = 0; for (const range of ranges) { if (range.start !== boundary || range.end <= range.start) throw new Error('ZIP local区域重叠/空洞/自解压前缀，不支持。'); boundary = range.end; } if (boundary !== central) throw new Error('ZIP含未索引local数据区域。'); validatePaths(entries); return { entries, eocdOffset: end, centralOffset: central, centralSize: size, commentBytes: u16(end + 20) };
}
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function finish(source, entries, sampling) {
  const files = entries.filter(entry => entry.kind !== 'directory'), categories = new Map(); for (const entry of files) { const current = categories.get(entry.category) || { name: entry.category, files: 0, declaredZIPBytes: source.kind === 'zip' ? 0 : null, fileAPIBytes: source.kind === 'directory' ? 0 : null }; current.files++; if (source.kind === 'zip') current.declaredZIPBytes += entry.declaredUncompressedBytes; else current.fileAPIBytes += entry.fileAPIBytes; categories.set(entry.category, current); }
  const report = freeze({ feature: 'T097', version: 1, source, summary: { entryCount: entries.length, fileCount: files.length, explicitDirectoryCount: entries.length - files.length, declaredZIPUncompressedBytes: source.kind === 'zip' ? files.reduce((sum, entry) => sum + entry.declaredUncompressedBytes, 0) : null, declaredZIPCompressedBytes: source.kind === 'zip' ? files.reduce((sum, entry) => sum + entry.declaredCompressedBytes, 0) : null, fileAPITotalBytes: source.kind === 'directory' ? files.reduce((sum, entry) => sum + entry.fileAPIBytes, 0) : null, contentSizeCRCVerifiedFiles: entries.filter(entry => entry.storedSizeCRCVerified).length, pathUnverifiedEntries: entries.filter(entry => !entry.pathVerified).length, categories: [...categories.values()], ...sampling }, entries, limits: { ...LIMITS }, scope: { categories: '所有类别仅按路径/文件名/扩展名推测，不确认内容语义', zip: 'ZIP32单磁盘有限结构；拒绝ZIP64/分盘/损坏/路径碰撞；声明大小不等于解压实际大小，不提供SHA或认证', sample: '仅未加密且支持的stored JSON或目录JSON，最多20文件、每个256KiB、实际读取总2MiB；ZIP抽检核对CRC/大小，CRC不是密码认证', decompression: '首版不解码DEFLATE或其他压缩方法，不解密，不写源文件，不解压到磁盘', values: 'JSON只输出字段名/类型/数量，不输出个人值；JSON字段名/文件名本身仍可能私密', metadata: 'ZIP extra/comment只报告字段ID/字节数，不解码其值；未知名称编码仅原始名称hex、路径未核验，不推测类别', offline: '零网络；图片仅类型/大小，不解码内容；仅输出盘点JSON/Markdown报告' } }); reports.add(report); return report;
}
async function sample(entries, read, kind, hooks) {
  let sampledJSONFiles = 0, attemptedJSONFiles = 0, actualSampleReadBytes = 0;
  for (let index = 0; index < entries.length; index++) {
    if (index % 32 === 0) await checkpoint(hooks); const entry = entries[index]; entry.schema = null; entry.storedSizeCRCVerified = false; entry.actualSampleReadBytes = 0; const size = kind === 'zip' ? entry.declaredUncompressedBytes : entry.fileAPIBytes;
    const reason = entry.path === null ? '名称编码未知，仅元数据' : entry.kind !== 'file' ? '目录/符号链接不读取内容' : !/\.json$/iu.test(entry.path) ? '非JSON，仅类型/大小元数据' : kind === 'zip' && entry.encrypted ? '加密条目不解密，仅元数据' : kind === 'zip' && entry.method !== 0 ? `压缩方法${entry.method}不解码，仅元数据` : kind === 'zip' && (entry.flags & ~0x808) ? '未知/不支持flags，仅元数据' : kind === 'zip' && entry.versionNeeded > 20 ? '提取版本>20，仅元数据' : size > LIMITS.jsonBytes ? 'JSON超过单文件256 KiB抽检限额' : attemptedJSONFiles >= LIMITS.samples || actualSampleReadBytes + size > LIMITS.sampleTotalBytes ? '包内20文件/2 MiB抽检预算已用完' : null;
    if (reason) { entry.sampleStatus = 'notSampled'; entry.sampleReason = reason; continue; }
    attemptedJSONFiles++; let data;
    try { data = await read(entry); checkAbort(hooks.signal); if (!(data instanceof Uint8Array) || data.length !== size || data.length > LIMITS.jsonBytes) throw new Error('实际JSON读取大小和声明/File API大小不符。'); actualSampleReadBytes += data.length; entry.actualSampleReadBytes = data.length;
      if (kind === 'zip') { if (await crc32(data, hooks) !== entry.declaredCRCValue) throw new Error('JSON CRC不匹配，仅声明元数据未内容核验。'); entry.storedSizeCRCVerified = true; }
      entry.schema = await jsonSchema(data, hooks); sampledJSONFiles++; entry.sampleStatus = 'schemaSampled'; entry.sampleReason = kind === 'zip' ? 'stored字节大小和CRC核对，JSON结构抽检成功（非认证）' : '实际文件字节读取，JSON结构抽检成功';
    } catch (error) { if (error.name === 'AbortError') throw error; entry.sampleStatus = 'sampleFailed'; entry.sampleReason = error.message; } finally { if (kind === 'directory') data?.fill(0); }
  }
  for (const entry of entries) { delete entry.declaredCRCValue; delete entry.dataAt; delete entry.dataEnd; }
  return { sampledJSONFiles, attemptedJSONFiles, actualSampleReadBytes };
}
export async function inventoryZIP(source, hooks = {}) {
  sourceName(source?.name); const bytes = source?.bytes, parsed = await readZIP(bytes, hooks), entries = parsed.entries.map(entry => ({ ...entry, ...category(entry.path), fileAPIBytes: null }));
  const sampling = await sample(entries, entry => bytes.subarray(entry.dataAt, entry.dataEnd), 'zip', hooks); checkAbort(hooks.signal); return finish({ kind: 'zip', name: source.name, actualContainerBytes: bytes.length, centralOffset: parsed.centralOffset, centralSize: parsed.centralSize, eocdOffset: parsed.eocdOffset, commentBytes: parsed.commentBytes, fullyContentVerified: false }, entries, sampling);
}
export async function inventoryDirectory(source, hooks = {}) {
  sourceName(source?.name); if (!Array.isArray(source.files) || !source.files.length || source.files.length > LIMITS.entries) throw new Error('目录需包含1–2000个File API文件。'); let total = 0;
  const entries = source.files.map((file, index) => { if (!Number.isSafeInteger(file?.size) || file.size < 0 || typeof file.path !== 'string' || file.path.endsWith('/') || typeof file.read !== 'function' || (total += file.size) > LIMITS.sourceBytes) throw new Error('目录文件大小/读取接口不合法或总量>20 MiB。'); return { id: 'D' + (index + 1), path: file.path, kind: 'file', pathVerified: true, nameEncoding: 'File API Unicode路径', ...category(file.path), fileAPIBytes: file.size, declaredCompressedBytes: null, declaredUncompressedBytes: null, declaredCRC32: null, browserMIME: typeof file.type === 'string' ? file.type.slice(0, 100) : '' }; }); validatePaths(entries);
  const sampling = await sample(entries, async entry => { const result = await source.files[Number(entry.id.slice(1)) - 1].read(); return result instanceof Uint8Array ? result : new Uint8Array(result); }, 'directory', hooks); checkAbort(hooks.signal); return finish({ kind: 'directory', name: source.name, actualContainerBytes: null, fileAPITotalBytes: total, fullyContentVerified: false, emptyDirectoriesEnumerated: false }, entries, sampling);
}
export async function serializeReport(report, format, hooks = {}) {
  if (!reports.has(report)) throw new Error('请先生成有效盘点报告。'); if (!['json', 'md'].includes(format)) throw new Error('只支持JSON/Markdown报告。'); await checkpoint(hooks); let content;
  if (format === 'json') content = JSON.stringify(report, null, 2) + '\n';
  else { const escape = value => String(value).replaceAll('\\', '\\\\').replace(/[|`*_\[\]#!()+.\-]/gu, value => '\\' + value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'); const lines = [`# 个人数据导出包盘点：${escape(report.source.name)}`, '', `来源：${report.source.kind}；文件${report.summary.fileCount}；目录条目${report.summary.explicitDirectoryCount}。`, `ZIP声明未压缩大小：${report.summary.declaredZIPUncompressedBytes ?? '不适用'}；File API文件大小总和：${report.summary.fileAPITotalBytes ?? '不适用'}；实际抽检读取字节：${report.summary.actualSampleReadBytes}。`, '', '## 类别（全部为推测）', ...report.summary.categories.map(category => `- ${escape(category.name)}：${category.files}文件`), '', '## 全部条目'];
    for (let index = 0; index < report.entries.length; index++) { if (index % 32 === 0) await checkpoint(hooks); const entry = report.entries[index]; lines.push('', `### ${entry.id} ${escape(entry.path ?? '(名称未解码，hex：' + entry.rawNameHex + ')')}`, `类型${entry.kind}；推测类别${escape(entry.category)}；ZIP声明压缩/未压缩${entry.declaredCompressedBytes ?? '—'}/${entry.declaredUncompressedBytes ?? '—'}；File API大小${entry.fileAPIBytes ?? '—'}；实际抽检${entry.actualSampleReadBytes}字节。`, `解析：${escape(entry.sampleReason)}；CRC/大小核验${entry.storedSizeCRCVerified ? '仅此stored条目通过（非认证）' : '未做/不适用'}。`); if (entry.schema) lines.push(`结构摘要（不含值）：${escape(JSON.stringify(entry.schema))}`); }
    lines.push('', '## 解析限制', ...Object.values(report.scope).map(value => '- ' + escape(value)), `- 数量/字节限制：${escape(JSON.stringify(report.limits))}`); content = lines.join('\n') + '\n'; }
  if (encoder.encode(content).length > LIMITS.reportBytes) throw new Error('完整报告超过8 MiB，未截断输出。'); checkAbort(hooks.signal); return content;
}
