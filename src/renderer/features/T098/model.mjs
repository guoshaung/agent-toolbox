export const LIMITS = Object.freeze({ files: 100, fileBytes: 2097152, totalBytes: 10485760, packageBytes: 20971520, versions: 10, chunkBytes: 65536 });
export class BackupError extends Error { constructor(code, message) { super(message); this.name = 'BackupError'; this.code = code; } }
const fail = (code, message) => { throw new BackupError(code, message); };
const encoder = new TextEncoder();
const hashPattern = /^[a-f0-9]{64}$/;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const check = options => { if (options?.isCanceled?.()) fail('canceled', '操作已取消，没有新增版本或部分恢复结果。'); };
async function yieldStep(options) { check(options); await (options?.yieldTask || (() => new Promise(resolve => setTimeout(resolve, 0))))(); check(options); }
function keys(value, expected) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...expected].sort().join('|')) fail('schema', '对象包含缺失、未知或不支持的字段。'); }
function unicode(text) { for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const n = text.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail('unicode', '文本含无效 Unicode。'); } else if (c >= 0xdc00 && c <= 0xdfff) fail('unicode', '文本含无效 Unicode。'); } }
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort(order).map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  fail('canonical', '清单包含不能规范序列化的值。');
}
export function parseStrictJSON(text) {
  if (typeof text !== 'string' || text.length > LIMITS.packageBytes || encoder.encode(text).length > LIMITS.packageBytes) fail('packageLimit', '版本包最多 20 MiB UTF-8。'); unicode(text); let at = 0; let nodes = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(text[at] || '\0')) at++; };
  function string() { const start = at++; while (at < text.length) { const c = text[at++]; if (c === '"') { try { const v = JSON.parse(text.slice(start, at)); unicode(v); return v; } catch (error) { if (error instanceof BackupError) throw error; fail('json', 'JSON 字符串或转义无效。'); } } if (c === '\\') at++; else if (c.charCodeAt(0) < 32) fail('json', 'JSON 字符串含控制字符。'); } fail('json', 'JSON 字符串未闭合。'); }
  function value(depth = 0) {
    if (depth > 12 || ++nodes > 10000) fail('jsonLimit', 'JSON 层级或值数量超限。'); ws(); const c = text[at];
    if (c === '"') return string();
    if (c === '{') { at++; const out = Object.create(null); ws(); if (text[at] === '}') { at++; return out; } while (true) { ws(); if (text[at] !== '"') fail('json', 'JSON 对象键必须是字符串。'); const key = string(); if (Object.hasOwn(out, key)) fail('duplicateKey', 'JSON 有重复字段，拒绝歧义版本包。'); ws(); if (text[at++] !== ':') fail('json', 'JSON 字段缺少冒号。'); out[key] = value(depth + 1); ws(); const next = text[at++]; if (next === '}') return out; if (next !== ',') fail('json', 'JSON 对象格式无效。'); } }
    if (c === '[') { at++; const out = []; ws(); if (text[at] === ']') { at++; return out; } while (true) { out.push(value(depth + 1)); ws(); const next = text[at++]; if (next === ']') return out; if (next !== ',') fail('json', 'JSON 数组格式无效。'); } }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) if (text.slice(at, at + token.length) === token) { at += token.length; return result; }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at)); if (!match) fail('json', 'JSON 值格式无效。'); at += match[0].length; const number = Number(match[0]); if (!Number.isSafeInteger(number)) fail('json', '版本清单仅接受安全整数。'); return number;
  }
  const out = value(); ws(); if (at !== text.length) fail('json', 'JSON 结尾有多余内容。'); return out;
}
export function validatePath(path) {
  if (typeof path !== 'string' || !path || path.length > 500) fail('path', '路径须是最多 500 字符的非空相对路径。'); unicode(path);
  for (const part of path.split('/')) if (!part || part.length > 120 || /[\x00-\x1f\x7f<>:"|?*\\/]/u.test(part) || /[. ]$/.test(part) || ['.', '..'].includes(part) || /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(part)) fail('path', '路径包含遍历、绝对路径、Windows 保留名称或不支持字符。');
  return path;
}
const pathKey = path => path.normalize('NFC').toLowerCase();
export function validatePaths(paths) { const seen = new Set(); for (const path of paths) { validatePath(path); const key = pathKey(path); if (seen.has(key)) fail('pathCollision', '路径存在重复、大小写或 NFC 表示冲突。'); seen.add(key); } for (const name of seen) { const parts = name.split('/'); for (let i = 1; i < parts.length; i++) if (seen.has(parts.slice(0, i).join('/'))) fail('pathPrefix', '文件路径与目录前缀冲突。'); } }
export async function sha256(data, options = {}) { check(options); if (!globalThis.crypto?.subtle) fail('crypto', '当前环境缺少本地 WebCrypto SHA-256。'); const hash = await crypto.subtle.digest('SHA-256', data); check(options); return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join(''); }
export async function encodeBase64(bytes, options = {}) { const out = []; for (let i = 0; i < bytes.length; i += 49152) { const slice = bytes.subarray(i, i + 49152); out.push(btoa(String.fromCharCode(...slice))); await yieldStep(options); } return out.join(''); }
export async function decodeBase64(base64, size, options = {}) {
  if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.fileBytes || typeof base64 !== 'string' || base64.length !== Math.ceil(size / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4) fail('base64', '文件大小或 Base64 编码不合法。'); check(options); let raw;
  try { raw = atob(base64); } catch { fail('base64', 'Base64 无法解码。'); } if (raw.length !== size || btoa(raw) !== base64) fail('base64', 'Base64 必须规范编码且与字节数一致。'); const bytes = new Uint8Array(size); for (let i = 0; i < size; i += LIMITS.chunkBytes) { for (let j = i; j < Math.min(size, i + LIMITS.chunkBytes); j++) bytes[j] = raw.charCodeAt(j); await yieldStep(options); } return bytes;
}
function snapshotShape(files) { if (!Array.isArray(files) || files.length < 1 || files.length > LIMITS.files) fail('fileCount', '每个快照需要 1–100 个文件；不记录空目录。'); validatePaths(files.map(f => f.path)); let total = 0; for (const f of files) { if (!Number.isSafeInteger(f.size) || f.size < 0 || f.size > LIMITS.fileBytes || !hashPattern.test(f.sha256)) fail('file', '文件大小或 SHA-256 不合法。'); total += f.size; } if (total > LIMITS.totalBytes) fail('totalLimit', '每个恢复状态的文件总大小最多 10 MiB。'); }
const manifest = files => [...files].sort((a, b) => order(a.path, b.path)).map(({ path, size, sha256 }) => ({ path, size, sha256 }));
export async function snapshotHash(files, options) { return sha256(encoder.encode(canonical({ format: 'T098-snapshot', schema: 1, files: manifest(files) })), options); }
export async function versionHash(version, options) { const { hash, ...body } = version; return sha256(encoder.encode(canonical({ format: 'T098-version', schema: 1, ...body })), options); }
export function serializePackage(pack) { const out = canonical(pack); if (encoder.encode(out).length > LIMITS.packageBytes) fail('packageLimit', '整个版本链的 JSON 包超过 20 MiB，未新增版本或截断。'); return out; }
export async function readDirectory(list, options = {}) {
  const files = Array.from(list || []); if (files.length < 1 || files.length > LIMITS.files) fail('fileCount', '目录选择需包含 1–100 个文件。'); const directory = files.every(f => typeof f.webkitRelativePath === 'string' && f.webkitRelativePath.length > 0); if (!directory && files.some(f => f.webkitRelativePath)) fail('directory', '不能混用目录与单文件路径。');
  let prefix = null; const names = files.map(f => { if (!directory) return validatePath(f.name); const parts = f.webkitRelativePath.split('/'); if (parts.length < 2 || !parts[0]) fail('directory', '目录 File API 的根路径无效。'); if (prefix === null) prefix = parts[0]; if (prefix !== parts[0]) fail('directory', '一次只读取同一个选中根目录。'); return validatePath(parts.slice(1).join('/')); }); validatePaths(names);
  let total = 0; for (const f of files) { if (!Number.isSafeInteger(f.size) || f.size < 0 || f.size > LIMITS.fileBytes || typeof f.slice !== 'function') fail('file', '文件超过 2 MiB，或缺少 File.slice 能力。'); total += f.size; } if (total > LIMITS.totalBytes) fail('totalLimit', '目录总字节数超过 10 MiB。');
  const out = []; for (let i = 0; i < files.length; i++) { const f = files[i]; const bytes = new Uint8Array(f.size); for (let pos = 0; pos < f.size; pos += LIMITS.chunkBytes) { check(options); const end = Math.min(f.size, pos + LIMITS.chunkBytes); const part = f.slice(pos, end); if (typeof part.arrayBuffer !== 'function') fail('fileAPI', '当前环境缺少 Blob.arrayBuffer。'); const buffer = await part.arrayBuffer(); check(options); if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== end - pos) fail('fileRead', '读取文件字节数不一致，未生成部分版本。'); bytes.set(new Uint8Array(buffer), pos); await yieldStep(options); } const sha = await sha256(bytes, options); out.push({ path: names[i], size: bytes.length, sha256: sha, base64: await encodeBase64(bytes, options) }); options.onProgress?.({ processed: i + 1, total: files.length }); await yieldStep(options); }
  return out.sort((a, b) => order(a.path, b.path));
}
export async function verifyChain(input, options = {}) {
  check(options); const pack = typeof input === 'string' ? parseStrictJSON(input) : parseStrictJSON(serializePackage(input)); keys(pack, ['format', 'schema', 'versions']); if (pack.format !== 'T098-backup' || pack.schema !== 1 || !Array.isArray(pack.versions) || pack.versions.length < 1 || pack.versions.length > LIMITS.versions) fail('schema', '仅支持 T098-backup schema 1 的 1–10 个完整连续版本。');
  const snapshots = []; let state = new Map(); let parent = null;
  for (let i = 0; i < pack.versions.length; i++) {
    check(options); const v = pack.versions[i]; keys(v, ['index', 'kind', 'parentHash', 'snapshotHash', 'hash', 'changes']); if (v.index !== i + 1 || v.kind !== (i === 0 ? 'base' : 'delta') || v.parentHash !== parent || !hashPattern.test(v.hash) || !hashPattern.test(v.snapshotHash)) fail('chain', '缺基础、顺序不连续、父版本哈希不匹配或版本字段无效。'); if (!Array.isArray(v.changes) || v.changes.length > LIMITS.files * 2 || (i === 0 && !v.changes.length)) fail('changes', '版本变更数量无效。');
    validatePaths(v.changes.map(c => c?.path)); if (v.changes.some((c, n) => n > 0 && order(v.changes[n - 1].path, c.path) >= 0)) fail('order', '变更路径须严格按原始字符升序排列。'); const next = new Map(state);
    for (const change of v.changes) {
      check(options); const op = change?.op; if (!['add', 'replace', 'delete'].includes(op) || (i === 0 && op !== 'add')) fail('operation', '基础只能新增，增量只允许新增、替换或删除。'); keys(change, op === 'delete' ? ['op', 'path', 'previousHash'] : op === 'replace' ? ['op', 'path', 'previousHash', 'size', 'sha256', 'base64'] : ['op', 'path', 'size', 'sha256', 'base64']);
      const old = next.get(change.path); if (op === 'add' && old) fail('operation', '新增路径已存在，拒绝隐式覆盖。'); if (op !== 'add' && (!old || change.previousHash !== old.sha256)) fail('operation', '替换或删除目标不存在，或旧内容哈希不匹配。');
      if (op === 'delete') next.delete(change.path); else { if (!hashPattern.test(change.sha256)) fail('hash', '内容 SHA-256 无效。'); const bytes = await decodeBase64(change.base64, change.size, options); if (await sha256(bytes, options) !== change.sha256) fail('hash', '文件内容 SHA-256 失败，整个版本链已拒绝。'); if (op === 'replace' && old.sha256 === change.sha256 && old.size === change.size) fail('operation', '替换内容没有变化，应使用空增量。'); next.set(change.path, { path: change.path, size: change.size, sha256: change.sha256, base64: change.base64 }); }
      await yieldStep(options);
    }
    const files = [...next.values()].sort((a, b) => order(a.path, b.path)); snapshotShape(files); if (await snapshotHash(files, options) !== v.snapshotHash || await versionHash(v, options) !== v.hash) fail('hash', '快照或 canonical 版本清单哈希失败，整个版本链已拒绝。'); state = next; parent = v.hash; snapshots.push(files); options.onProgress?.({ processed: i + 1, total: pack.versions.length }); await yieldStep(options);
  }
  check(options); return { pack, snapshots };
}
export async function appendVersion(input, files, options = {}) {
  snapshotShape(files); const normalized = [...files].sort((a, b) => order(a.path, b.path)); for (const f of normalized) { keys(f, ['path', 'size', 'sha256', 'base64']); const bytes = await decodeBase64(f.base64, f.size, options); if (await sha256(bytes, options) !== f.sha256) fail('hash', '新目录内容哈希错误，未新增版本。'); }
  const verified = input ? await verifyChain(input, options) : { pack: { format: 'T098-backup', schema: 1, versions: [] }, snapshots: [] }; const versions = verified.pack.versions; if (versions.length >= LIMITS.versions) fail('versions', '最多 10 个版本，请另建基础版本链。'); const old = new Map((verified.snapshots.at(-1) || []).map(f => [f.path, f])); const current = new Map(normalized.map(f => [f.path, f])); const changes = [];
  for (const f of normalized) { const before = old.get(f.path); if (!before) changes.push({ op: 'add', ...f }); else if (before.sha256 !== f.sha256 || before.size !== f.size) changes.push({ op: 'replace', previousHash: before.sha256, ...f }); }
  for (const [path, file] of old) if (!current.has(path)) changes.push({ op: 'delete', path, previousHash: file.sha256 }); changes.sort((a, b) => order(a.path, b.path)); validatePaths(changes.map(c => c.path));
  const v = { index: versions.length + 1, kind: versions.length ? 'delta' : 'base', parentHash: versions.at(-1)?.hash || null, snapshotHash: await snapshotHash(normalized, options), changes }; v.hash = await versionHash(v, options); const pack = { format: 'T098-backup', schema: 1, versions: [...versions, v] }; serializePackage(pack); return verifyChain(pack, options);
}
export async function prepareRestore(input, index, options = {}) { const verified = await verifyChain(input, options); if (!Number.isSafeInteger(index) || index < 1 || index > verified.snapshots.length) fail('version', '请选择有效历史版本。'); const files = verified.snapshots[index - 1]; const report = { feature: 'T098', schema: 1, selectedVersion: index, snapshotHash: verified.pack.versions[index - 1].snapshotHash, chainVersions: verified.pack.versions.map(v => ({ index: v.index, kind: v.kind, hash: v.hash, parentHash: v.parentHash, snapshotHash: v.snapshotHash, changes: v.changes.map(({ op, path, size, sha256, previousHash }) => ({ op, path, ...(size === undefined ? {} : { size, sha256 }), ...(previousHash ? { previousHash } : {}) })) })), fileCount: files.length, totalBytes: files.reduce((sum, f) => sum + f.size, 0), manifest: manifest(files), notice: '已重算完整链和全部内容哈希；哈希仅检测完整性，不证明来源可信。恢复创建全新目录，不改变原目录；仅文件内容/相对路径，无空目录、权限、时间戳或符号链接。崩溃/断电不保证目录事务原子性。' }; return { files, report }; }
