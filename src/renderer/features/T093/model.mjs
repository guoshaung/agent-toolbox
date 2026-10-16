export const LIMITS = Object.freeze({ files: 50, fileBytes: 2 * 1024 * 1024, totalBytes: 8 * 1024 * 1024, plaintextBytes: 12 * 1024 * 1024, containerBytes: 16 * 1024 * 1024, pathUnits: 500, segmentUnits: 120 });
export const PARAMETERS = Object.freeze({ feature: 'T093', version: 1, kdf: 'PBKDF2', hash: 'SHA-256', iterations: 600000, cipher: 'AES-GCM', keyBits: 256, tagBits: 128 });
const encoder = new TextEncoder(), verifiedResults = new WeakSet();
export function checkAbort(signal) { if (signal?.aborted) throw Object.assign(new Error('已取消；忽略未完成异步运算的结果。'), { name: 'AbortError' }); }
async function checkpoint(hooks) { checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal); }
function scalar(text) { return ![...text].some(c => { const n = c.codePointAt(0); return n >= 0xd800 && n <= 0xdfff; }); }
export function validatePassword(password) { if (typeof password !== 'string' || password.length > 512 || [...password].length < 8 || [...password].length > 256 || !scalar(password)) throw new Error('口令须为8–256 Unicode码点，不去首尾空白，不接受孤立代理项。'); return password; }
function exact(object, keys, name) { if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) throw new Error(`${name}字段结构不合法。`); }
function cryptoAPI(hooks) { const api = hooks.crypto || globalThis.crypto; if (!api?.subtle || typeof api.getRandomValues !== 'function') throw new Error('当前环境没有可用的WebCrypto，无法加密/解密。'); return api; }
export function validatePaths(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > LIMITS.files) throw new Error('请选择1–50个文件。'); const seen = new Set();
  for (const path of paths) {
    if (typeof path !== 'string' || !path || path.length > LIMITS.pathUnits || !scalar(path) || !path.split('/').every(part => part.length > 0 && part.length <= LIMITS.segmentUnits && !/[\u0000-\u001f\u007f<>:"|?*\\/]/u.test(part) && !/[. ]$/u.test(part) && !['.', '..'].includes(part) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part))) throw new Error('路径须为可移植相对路径，禁止遍历、绝对路径、保留名称/字符、末尾点或空格。');
    const key = path.normalize('NFC').toLowerCase(); if (seen.has(key)) throw new Error('文件路径大小写/NFC冲突。'); seen.add(key);
  }
  for (const path of seen) { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) if (seen.has(parts.slice(0, i).join('/'))) throw new Error('文件和目录前缀冲突。'); }
}
export function encodeBase64(bytes) { if (!(bytes instanceof Uint8Array)) throw new Error('编码输入须为字节。'); const parts = []; for (let at = 0; at < bytes.length; at += 32768) parts.push(String.fromCharCode(...bytes.subarray(at, at + 32768))); return btoa(parts.join('')); }
export function decodeBase64(text, maximum, minimum = 0) {
  if (typeof text !== 'string' || text.length > Math.ceil(maximum / 3) * 4 || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(text)) throw new Error('Base64格式或大小无效。');
  let binary; try { binary = atob(text); } catch { throw new Error('Base64无效。'); } const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length < minimum || bytes.length > maximum || encodeBase64(bytes) !== text) throw new Error('Base64不是规范编码或字节大小不合法。'); return bytes;
}
export async function sha256(bytes, hooks = {}) { checkAbort(hooks.signal); const hash = new Uint8Array(await cryptoAPI(hooks).subtle.digest('SHA-256', bytes)); checkAbort(hooks.signal); return [...hash].map(b => b.toString(16).padStart(2, '0')).join(''); }
// Bounded token scan rejects duplicate keys even when escaped, before JSON.parse.
// JSON.parse handles grammar; fixed schemas reject all unknown/numeric parameters.
export async function parseJSON(text, maximum, hooks = {}) {
  if (typeof text !== 'string' || text.length > maximum || encoder.encode(text).length > maximum) throw new Error('JSON超出输入大小上限。');
  if (text.startsWith('\uFEFF')) text = text.slice(1); const stack = []; let at = 0, nextYield = 0, nodes = 0;
  while (at < text.length) {
    if (at >= nextYield) { nextYield = at + 65536; await checkpoint(hooks); }
    const ch = text[at++];
    if (ch === '"') { const start = at - 1; let escaped = false, closed = false; while (at < text.length) { const c = text[at++]; if (c === '"' && !escaped) { closed = true; break; } if (c === '\\' && !escaped) escaped = true; else escaped = false; if (at >= nextYield) { nextYield = at + 65536; await checkpoint(hooks); } } if (!closed) throw new Error('JSON字符串未闭合。');
      const top = stack.at(-1); if (top?.type === 'object' && top.key) { let key; try { key = JSON.parse(text.slice(start, at)); } catch { throw new Error('JSON属性转义不合法。'); } if (top.keys.has(key)) throw new Error('JSON含重复属性。'); top.keys.add(key); if (top.keys.size > 16) throw new Error('JSON对象字段超限。'); top.key = false; }
    } else if (ch === '{' || ch === '[') { if (++nodes > 200 || stack.length >= 8) throw new Error('JSON节点/深度超限。'); stack.push({ type: ch === '{' ? 'object' : 'array', key: true, keys: new Set() }); }
    else if (ch === '}' || ch === ']') stack.pop(); else if (ch === ',' && stack.at(-1)?.type === 'object') stack.at(-1).key = true;
  }
  checkAbort(hooks.signal); try { return JSON.parse(text); } catch { throw new Error('不是有效JSON。'); }
}
export function containerAAD(header) { return encoder.encode(JSON.stringify({ ...PARAMETERS, salt: header.salt, iv: header.iv, payload: 'T093-files-v1', encoding: 'canonical-base64' })); }
function validateContainer(container) {
  exact(container, [...Object.keys(PARAMETERS), 'salt', 'iv', 'ciphertext'], '加密容器'); for (const [key, value] of Object.entries(PARAMETERS)) if (container[key] !== value) throw new Error('加密容器版本或固定密码参数不支持。');
  const salt = decodeBase64(container.salt, 16, 16), iv = decodeBase64(container.iv, 12, 12), ciphertext = decodeBase64(container.ciphertext, LIMITS.plaintextBytes + 16, 17); return { salt, iv, ciphertext };
}
async function derive(password, salt, api, hooks, usage) {
  const raw = encoder.encode(validatePassword(password)); let base;
  try { base = await api.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']); checkAbort(hooks.signal); } finally { raw.fill(0); }
  const key = await api.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: PARAMETERS.iterations, salt }, base, { name: 'AES-GCM', length: 256 }, false, [usage]); checkAbort(hooks.signal); return key;
}
async function verifiedBody(body, hooks) {
  exact(body, ['feature', 'version', 'files'], '加密正文'); if (body.feature !== 'T093' || body.version !== 1 || !Array.isArray(body.files)) throw new Error('加密正文版本或文件列表不合法。'); validatePaths(body.files.map(file => file?.path));
  const files = []; let totalBytes = 0;
  for (let index = 0; index < body.files.length; index++) {
    await checkpoint(hooks); const file = body.files[index]; exact(file, ['path', 'size', 'sha256', 'base64'], '正文文件'); if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > LIMITS.fileBytes || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(file.sha256)) throw new Error('文件大小或SHA-256格式不合法。');
    const bytes = decodeBase64(file.base64, LIMITS.fileBytes); totalBytes += bytes.length;
    try { if (bytes.length !== file.size || totalBytes > LIMITS.totalBytes) throw new Error('文件声明大小不符或总量超过8 MiB。'); if (await sha256(bytes, hooks) !== file.sha256) throw new Error('正文文件SHA-256不匹配，禁止恢复。'); files.push(Object.freeze({ ...file })); hooks.onProgress?.(`核验文件 ${index + 1}/${body.files.length}`); } finally { bytes.fill(0); }
  }
  const manifest = Object.freeze({ feature: 'T093', version: 1, algorithm: 'SHA-256', totalBytes, files: Object.freeze(files.map(file => Object.freeze({ path: file.path, size: file.size, sha256: file.sha256 }))) });
  const result = Object.freeze({ files: Object.freeze(files), manifest }); verifiedResults.add(result); return result;
}
export async function inspectFiles(input, hooks = {}) {
  if (!Array.isArray(input)) throw new Error('文件输入须为数组。'); validatePaths(input.map(file => file?.path)); let total = 0;
  for (const file of input) { exact(file, ['path', 'bytes'], '源文件'); if (!(file.bytes instanceof Uint8Array) || file.bytes.length > LIMITS.fileBytes) throw new Error('源文件须为字节且每文件≤2 MiB。'); total += file.bytes.length; if (total > LIMITS.totalBytes) throw new Error('文件总量超过8 MiB。'); }
  const files = [];
  for (let i = 0; i < input.length; i++) { await checkpoint(hooks); const file = input[i]; files.push({ path: file.path, size: file.bytes.length, sha256: await sha256(file.bytes, hooks), base64: encodeBase64(file.bytes) }); hooks.onProgress?.(`读取核验 ${i + 1}/${input.length}`); }
  return verifiedBody({ feature: 'T093', version: 1, files }, hooks);
}
export async function encryptFiles(input, password, hooks = {}) {
  validatePassword(password); const api = cryptoAPI(hooks); const result = await inspectFiles(input, hooks), salt = api.getRandomValues(new Uint8Array(16)), iv = api.getRandomValues(new Uint8Array(12));
  const header = { ...PARAMETERS, salt: encodeBase64(salt), iv: encodeBase64(iv) }; await checkpoint(hooks); hooks.onProgress?.('PBKDF2派生密钥（600000次）'); const key = await derive(password, salt, api, hooks, 'encrypt');
  const raw = encoder.encode(JSON.stringify({ feature: 'T093', version: 1, files: result.files })); if (raw.length > LIMITS.plaintextBytes) throw new Error('加密正文超过12 MiB。');
  try { hooks.onProgress?.('AES-GCM认证加密'); const ciphertext = new Uint8Array(await api.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: containerAAD(header), tagLength: 128 }, key, raw)); checkAbort(hooks.signal); const container = Object.freeze({ ...header, ciphertext: encodeBase64(ciphertext) }); const text = JSON.stringify(container, null, 2) + '\n'; if (encoder.encode(text).length > LIMITS.containerBytes) throw new Error('加密包超过16 MiB。'); return Object.freeze({ container, text, manifest: result.manifest }); } finally { raw.fill(0); }
}
export async function decryptPackage(text, password, hooks = {}) {
  validatePassword(password); const api = cryptoAPI(hooks), container = await parseJSON(text, LIMITS.containerBytes, hooks), { salt, iv, ciphertext } = validateContainer(container); hooks.onProgress?.('PBKDF2派生密钥（600000次）'); const key = await derive(password, salt, api, hooks, 'decrypt'); let raw;
  try {
    hooks.onProgress?.('完整认证解密'); try { raw = new Uint8Array(await api.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: containerAAD(container), tagLength: 128 }, key, ciphertext)); } catch { checkAbort(hooks.signal); throw new Error('口令错误或加密包被篡改，未产出文件。'); }
    checkAbort(hooks.signal); if (raw.length > LIMITS.plaintextBytes) throw new Error('解密正文超限。'); let plaintext; try { plaintext = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw new Error('解密正文不是有效UTF-8。'); }
    const body = await parseJSON(plaintext, LIMITS.plaintextBytes, hooks); return await verifiedBody(body, hooks);
  } finally { raw?.fill(0); ciphertext.fill(0); }
}
export function exportPayload(result) { if (!verifiedResults.has(result)) throw new Error('只能恢复已完整认证/哈希核验的结果。'); return { copyOnly: true, defaultName: 'T093-恢复副本', files: result.files.map(({ path, base64, sha256 }) => ({ path, base64, sha256 })) }; }
export function manifestText(manifest) { return JSON.stringify(manifest, null, 2) + '\n'; }
