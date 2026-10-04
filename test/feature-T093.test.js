const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const model = import('../src/renderer/features/T093/model.mjs');
const secret = '明确口令123456', immediate = { crypto: webcrypto, yieldControl: async () => {} }, bytes = text => new TextEncoder().encode(text);
const sources = () => [{ path: '文档/说明😀.txt', bytes: bytes('hello\r\n中文\u0000') }, { path: 'empty.bin', bytes: new Uint8Array() }, { path: '原始.bin', bytes: new Uint8Array([0, 255, 128, 1, 13, 10]) }];
let base;
async function example() { return base ||= (await model).encryptFiles(sources(), secret, immediate); }
// Test-only authenticated invalid body generator; never a production override.
async function seal(raw, password = secret) {
  const { PARAMETERS, encodeBase64, containerAAD } = await model, salt = webcrypto.getRandomValues(new Uint8Array(16)), iv = webcrypto.getRandomValues(new Uint8Array(12));
  const header = { ...PARAMETERS, salt: encodeBase64(salt), iv: encodeBase64(iv) }, baseKey = await webcrypto.subtle.importKey('raw', bytes(password), 'PBKDF2', false, ['deriveKey']), key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, hash: 'SHA-256', iterations: 600000 }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: containerAAD(header), tagLength: 128 }, key, raw instanceof Uint8Array ? raw : bytes(JSON.stringify(raw))); return JSON.stringify({ ...header, ciphertext: encodeBase64(new Uint8Array(ciphertext)) });
}
async function validBody() { const { inspectFiles } = await model, result = await inspectFiles(sources(), immediate); return { feature: 'T093', version: 1, files: result.files.map(f => ({ ...f })) }; }

test('T093: fixed crypto parameters, exact metadata and random salt/IV fresh on every encryption', async () => {
  const { PARAMETERS, encryptFiles, decodeBase64 } = await model; assert.deepEqual(PARAMETERS, { feature: 'T093', version: 1, kdf: 'PBKDF2', hash: 'SHA-256', iterations: 600000, cipher: 'AES-GCM', keyBits: 256, tagBits: 128 });
  const first = await example(), second = await encryptFiles(sources(), secret, immediate); assert.notEqual(first.container.salt, second.container.salt); assert.notEqual(first.container.iv, second.container.iv); assert.notEqual(first.container.ciphertext, second.container.ciphertext); assert.equal(decodeBase64(first.container.salt, 16).length, 16); assert.equal(decodeBase64(first.container.iv, 12).length, 12);
  const meta = JSON.parse(fs.readFileSync(require.resolve('../src/renderer/features/T093/meta.json'), 'utf8')); assert.deepEqual(Object.keys(meta).sort(), ['category', 'description', 'group', 'id', 'title']); assert.equal(meta.id, 'T093');
});
test('T093: correct password restores UTF8 names, empty/binary bytes and independently matching hashes', async () => {
  const { decryptPackage, decodeBase64, sha256, exportPayload, manifestText } = await model, encrypted = await example(), result = await decryptPackage(encrypted.text, secret, immediate);
  assert.equal(result.manifest.files.length, 3); assert.equal(result.manifest.totalBytes, sources().reduce((n, f) => n + f.bytes.length, 0)); assert.deepEqual(JSON.parse(manifestText(result.manifest)), encrypted.manifest);
  for (let i = 0; i < sources().length; i++) { const original = sources()[i]; assert.equal(result.files[i].path, original.path); assert.deepEqual(decodeBase64(result.files[i].base64, 2 * 1024 * 1024), original.bytes); assert.equal(result.files[i].sha256, await sha256(original.bytes, immediate)); }
  assert.deepEqual(Object.keys(exportPayload(result)).sort(), ['copyOnly', 'defaultName', 'files']); assert.equal(exportPayload(result).copyOnly, true); assert.ok(Object.isFrozen(result.files[0])); assert.throws(() => exportPayload(structuredClone(result)), /核验/u);
});
test('T093: outer container has no filenames/manifest/plaintext/password or file count fields', async () => {
  const encrypted = await example(); for (const text of ['说明😀', 'empty.bin', '原始.bin', 'hello', '中文', secret, 'manifest', 'files', 'totalBytes']) assert.ok(!encrypted.text.includes(text)); assert.deepEqual(Object.keys(encrypted.container), ['feature', 'version', 'kdf', 'hash', 'iterations', 'cipher', 'keyBits', 'tagBits', 'salt', 'iv', 'ciphertext']);
});
test('T093: wrong password and single ciphertext byte/tag/salt/IV tamper never authenticate', async () => {
  const { decryptPackage, encodeBase64, decodeBase64 } = await model, encrypted = await example(); await assert.rejects(decryptPackage(encrypted.text, 'wrongpass123', immediate), /口令错误|篡改/u);
  for (const key of ['ciphertext', 'salt', 'iv']) { const container = { ...encrypted.container }, raw = decodeBase64(container[key], 12 * 1024 * 1024 + 16); raw[0] ^= 1; container[key] = encodeBase64(raw); await assert.rejects(decryptPackage(JSON.stringify(container), secret, immediate), /口令错误|篡改/u); }
  const container = { ...encrypted.container }, raw = decodeBase64(container.ciphertext, 12 * 1024 * 1024 + 16); raw[raw.length - 1] ^= 1; container.ciphertext = encodeBase64(raw); await assert.rejects(decryptPackage(JSON.stringify(container), secret, immediate), /口令错误|篡改/u);
});
test('T093: changed metadata/version/parameters/unknown fields rejected instead of downgrade', async () => {
  const { decryptPackage } = await model, encrypted = await example(); for (const change of [{ feature: 'T094' }, { version: 2 }, { version: '1' }, { iterations: 1 }, { hash: 'SHA-1' }, { kdf: 'scrypt' }, { cipher: 'AES-CBC' }, { keyBits: 128 }, { tagBits: 32 }, { filename: 'evil.txt' }, { salt: 'AA==' }, { iv: 'AA==' }]) await assert.rejects(decryptPackage(JSON.stringify({ ...encrypted.container, ...change }), secret, immediate));
});
test('T093: password8–256 Unicode points includes meaningful edge whitespace, no trim', async () => {
  const { validatePassword, encryptFiles, decryptPackage } = await model; for (const bad of ['', '1234567', 'x'.repeat(257), '\ud80012345678', 12345678]) assert.throws(() => validatePassword(bad)); assert.equal(validatePassword('😀'.repeat(256)), '😀'.repeat(256));
  const padded = ' 12345678 ', encrypted = await encryptFiles([{ path: 'a', bytes: new Uint8Array() }], padded, immediate); await assert.rejects(decryptPackage(encrypted.text, padded.trim(), immediate), /口令错误/u); assert.equal((await decryptPackage(encrypted.text, padded, immediate)).files.length, 1);
});
test('T093: canonical Base64 including empty file, rejects pad bits/whitespace/url alphabet/malformed padding', async () => {
  const { decodeBase64, encodeBase64 } = await model; assert.equal(decodeBase64('', 10).length, 0); assert.equal(encodeBase64(new Uint8Array([255])), '/w=='); for (const bad of ['AB==', 'AAB=', 'YQ', 'YQ===', ' YQ==', 'YQ==\n', '_w==', '====', 'A===', 'Y=Q=']) assert.throws(() => decodeBase64(bad, 10)); assert.throws(() => decodeBase64('YWI=', 1));
});
test('T093: safe relative paths match common bridge; traversal, reserved names and cross-platform conflicts reject', async () => {
  const { validatePaths } = await model; validatePaths(['文档/a.txt', 'emoji😀.bin']); for (const paths of [['../a'], ['/a'], ['a//b'], ['a/./b'], ['C:/a'], ['a\\b'], ['CON.txt'], ['a/LPT9'], ['a.'], ['a '], ['a\u0000b'], ['a?b'], ['\ud800'], ['x'.repeat(121)], ['a', 'A'], ['é.txt', 'e\u0301.txt'], ['dir', 'DIR/child'], ['a/b', 'A']]) assert.throws(() => validatePaths(paths));
});
test('T093: authenticated body with corrupt hash/size/noncanonical Base64 rejects before result', async () => {
  const { decryptPackage } = await model; for (const edit of [body => { body.files[0].sha256 = '0'.repeat(64); }, body => { body.files[0].size++; }, body => { body.files[1].base64 = 'AB=='; }]) { const body = await validBody(); edit(body); await assert.rejects(decryptPackage(await seal(body), secret, immediate), /SHA-256|大小|Base64/u); }
});
test('T093: authenticated malicious paths/duplicates/schema/version and invalid UTF8 plaintext reject', async () => {
  const { decryptPackage } = await model; for (const edit of [body => { body.files[0].path = '../outside'; }, body => { body.files[1].path = body.files[0].path; }, body => { body.files[0].extra = true; }, body => { body.version = 2; }]) { const body = await validBody(); edit(body); await assert.rejects(decryptPackage(await seal(body), secret, immediate)); }
  await assert.rejects(decryptPackage(await seal(new Uint8Array([255, 254])), secret, immediate), /UTF-8/u);
});
test('T093: file count/single2MiB/total8MiB limits strict with empty files and exact boundary', async () => {
  const { inspectFiles, LIMITS } = await model; assert.equal((await inspectFiles(Array.from({ length: 50 }, (_, i) => ({ path: `f${i}`, bytes: new Uint8Array() })), immediate)).files.length, 50);
  for (const files of [[], Array.from({ length: 51 }, (_, i) => ({ path: `f${i}`, bytes: new Uint8Array() })), [{ path: 'a', bytes: new Uint8Array(LIMITS.fileBytes + 1) }], Array.from({ length: 5 }, (_, i) => ({ path: `f${i}`, bytes: new Uint8Array(LIMITS.fileBytes) }))]) await assert.rejects(inspectFiles(files, immediate));
  const exact = await inspectFiles(Array.from({ length: 4 }, (_, i) => ({ path: `f${i}`, bytes: new Uint8Array(LIMITS.fileBytes) })), immediate); assert.equal(exact.manifest.totalBytes, LIMITS.totalBytes);
});
test('T093: full8MiB encrypt/decrypt fits16MiB container, exact all bytes and common bridge validation', async () => {
  const { encryptFiles, decryptPackage, exportPayload, LIMITS } = await model, inputs = Array.from({ length: 4 }, (_, i) => ({ path: `目录/边界${i}.bin`, bytes: new Uint8Array(LIMITS.fileBytes).fill(i + 1) }));
  const encrypted = await encryptFiles(inputs, secret, immediate); assert.ok(bytes(encrypted.text).length <= LIMITS.containerBytes); const result = await decryptPackage(encrypted.text, secret, immediate); assert.equal(result.manifest.totalBytes, LIMITS.totalBytes);
  const { validateBundle } = require('../src/main/feature-bundle.js'), validated = validateBundle(exportPayload(result)); assert.equal(validated.total, LIMITS.totalBytes); for (let i = 0; i < inputs.length; i++) assert.deepEqual(new Uint8Array(validated.files[i].data), inputs[i].bytes);
});
test('T093: strict JSON caps/depth/duplicate escaped keys and malformed grammar reject', async () => {
  const { parseJSON, decryptPackage, LIMITS } = await model; for (const text of ['{"version":1,"version":1}', '{"version":1,"\\u0076ersion":1}', '{"x":', '[', '{"x":NaN}', '['.repeat(9) + '0' + ']'.repeat(9)]) await assert.rejects(parseJSON(text, 1000, immediate)); assert.deepEqual(await parseJSON('\uFEFF{"a":"[{}]"}', 1000, immediate), { a: '[{}]' }); await assert.rejects(decryptPackage('x'.repeat(LIMITS.containerBytes + 1), secret, immediate), /上限/u);
});
test('T093: async cancel during hashing/PBKDF2/encrypt/decrypt suppresses all returned results', async () => {
  const { encryptFiles, decryptPackage } = await model; const canceled = new AbortController(); canceled.abort(); await assert.rejects(encryptFiles(sources(), secret, { ...immediate, signal: canceled.signal }), { name: 'AbortError' });
  for (const stage of ['PBKDF2', 'AES-GCM']) { const controller = new AbortController(), api = { getRandomValues: value => webcrypto.getRandomValues(value), subtle: new Proxy(webcrypto.subtle, { get(target, name) { const value = target[name]; if (typeof value !== 'function') return value; return async (...args) => { const result = await value.apply(target, args); if ((stage === 'PBKDF2' && name === 'deriveKey') || (stage === 'AES-GCM' && name === 'encrypt')) controller.abort(); return result; }; } }) }; await assert.rejects(encryptFiles(sources(), secret, { ...immediate, crypto: api, signal: controller.signal }), { name: 'AbortError' }); }
  const encrypted = await example(), controller = new AbortController(); await assert.rejects(decryptPackage(encrypted.text, secret, { ...immediate, signal: controller.signal, onProgress: message => { if (message.includes('完整认证解密')) controller.abort(); } }), { name: 'AbortError' });
});

// Minimal DOM event fixture; native dialogs and actual renderer memory/crypto require integration QA.
class Element {
  constructor(tag) { this.nodeType = 1; this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.disabled = false; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; }
  append(...nodes) { this.children.push(...nodes.map(node => node.nodeType ? node : { nodeType: 3, textContent: String(node) })); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get textContent() { return this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  removeEventListener(type, callback) { this.listeners[type] = (this.listeners[type] || []).filter(other => other !== callback); }
  async fire(type) { if (!this.disabled) for (const callback of [...(this.listeners[type] || [])]) await callback({ currentTarget: this, target: this }); }
}
const descendants = root => root.children.flatMap(node => node.nodeType === 1 ? [node, ...descendants(node)] : []);
const button = (root, text) => descendants(root).find(node => node.tagName === 'button' && node.textContent === text);
const control = (root, label) => descendants(root).find(node => node.attributes['aria-label'] === label);
const file = (name, content, path = '') => ({ name, size: content.length, webkitRelativePath: path, arrayBuffer: async () => content.slice().buffer });
const safeBridge = calls => ({ saveTextSupportsCopyOnly: true, exportBundleSupportsCopyOnly: true, saveText: async payload => { calls.text.push(payload); return { ok: true, path: 'new.json' }; }, exportBundle: async payload => { calls.bundle.push(payload); return { ok: true, path: 'new-directory' }; } });
async function withUI(bridge, action) {
  const previous = { document: global.document, window: global.window }; global.document = { createElement: tag => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) }; global.window = { toolbox: { files: bridge } };
  const root = new Element('main'), lifecycle = (await import('../src/renderer/features/T093/index.js')).default.create(root, {}); try { await action(root, lifecycle); } finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}
async function set(root, label, value) { const node = control(root, label); node.value = value; await node.fire('input'); }
async function decryptUI(root, text, password = secret) { await set(root, '待解密交付包JSON文本', text); await set(root, '解密口令', password); await button(root, '完整认证解密并核验清单').fire('click'); }

test('T093 UI: file/dir input previews collection then encrypts, clears passwords and saves copyOnly JSON + manifest', async () => {
  const calls = { text: [], bundle: [] }; await withUI(safeBridge(calls), async root => { const node = control(root, '加密源目录文件集合'); node.files = [file('说明.txt', bytes('hello'), '目录/说明.txt'), file('空.bin', new Uint8Array(), '目录/空.bin')]; await node.fire('change'); assert.match(root.textContent, /待加密2文件/u); assert.ok(root.textContent.includes('目录/说明.txt')); await set(root, '加密口令', secret); await set(root, '确认加密口令', secret); await button(root, '认证加密已预览文件').fire('click'); assert.match(root.textContent, /加密成功/u); assert.equal(control(root, '加密口令').value, ''); assert.equal(control(root, '确认加密口令').value, ''); assert.equal(calls.text.length, 0);
    await button(root, '保存加密包 JSON 副本').fire('click'); await button(root, '另存源文件明文核验清单').fire('click'); assert.equal(calls.text.length, 2); assert.ok(calls.text.every(p => p.copyOnly === true && p.extension === 'json')); assert.ok(!calls.text[0].content.includes('说明.txt')); const manifest = JSON.parse(calls.text[1].content); assert.deepEqual(manifest.files.map(f => [f.path, f.size]), [['目录/说明.txt', 5], ['目录/空.bin', 0]]); const restored = await (await model).decryptPackage(calls.text[0].content, secret, immediate); assert.deepEqual(restored.manifest, manifest); assert.equal(calls.bundle.length, 0);
  });
});
test('T093 UI: full verify preview then explicit new-directory restore, no automatic disk write', async () => {
  const encrypted = await example(), calls = { text: [], bundle: [] }; await withUI(safeBridge(calls), async root => { await decryptUI(root, encrypted.text); assert.equal(calls.bundle.length, 0); assert.match(root.textContent, /全部认证、路径与哈希核验通过/u); assert.ok(root.textContent.includes('文档/说明😀.txt')); assert.equal(control(root, '解密口令').value, ''); await button(root, '另存已验证明文核验清单').fire('click'); assert.deepEqual(JSON.parse(calls.text[0].content), encrypted.manifest); await button(root, '已核对预览，恢复到新目录').fire('click'); assert.equal(calls.bundle.length, 1); assert.equal(calls.bundle[0].copyOnly, true); assert.deepEqual(calls.bundle[0].files.map(f => f.path), encrypted.manifest.files.map(f => f.path)); assert.match(root.textContent, /已保存恢复副本目录/u); });
});
test('T093 UI: wrong password/ciphertext singlebyte/metadata/hash/path/UTF8 failure never calls bundle export', async () => {
  const encrypted = await example(), { decodeBase64, encodeBase64 } = await model, modified = { ...encrypted.container }, ciphertext = decodeBase64(modified.ciphertext, 12 * 1024 * 1024); ciphertext[0] ^= 1; modified.ciphertext = encodeBase64(ciphertext); const body = await validBody(); body.files[0].sha256 = '0'.repeat(64); const corruptHash = await seal(body), badPathBody = await validBody(); badPathBody.files[0].path = '../escape'; const badPath = await seal(badPathBody), badUTF8 = await seal(new Uint8Array([255]));
  const calls = { text: [], bundle: [] }; await withUI(safeBridge(calls), async root => { for (const [text, password] of [[encrypted.text, 'wrongpass123'], [JSON.stringify(modified), secret], [JSON.stringify({ ...encrypted.container, iterations: 100 }), secret], [corruptHash, secret], [badPath, secret], [badUTF8, secret]]) { await decryptUI(root, text, password); assert.equal(button(root, '已核对预览，恢复到新目录').disabled, true); assert.ok(!root.textContent.includes('文档/说明😀.txt')); assert.equal(calls.bundle.length, 0); } });
});
test('T093 UI: changed package/password or source selection invalidates prior verification/report', async () => {
  const encrypted = await example(), calls = { text: [], bundle: [] }; await withUI(safeBridge(calls), async root => { await decryptUI(root, encrypted.text); assert.equal(button(root, '已核对预览，恢复到新目录').disabled, false); await set(root, '解密口令', 'newpassword'); assert.equal(button(root, '已核对预览，恢复到新目录').disabled, true); assert.ok(!root.textContent.includes('文档/说明😀.txt')); await decryptUI(root, encrypted.text); await set(root, '待解密交付包JSON文本', '{}'); assert.equal(button(root, '另存已验证明文核验清单').disabled, true);
    const source = control(root, '加密源文件集合'); source.files = [file('a.txt', bytes('a'))]; await source.fire('change'); await set(root, '加密口令', secret); await set(root, '确认加密口令', secret); await button(root, '认证加密已预览文件').fire('click'); assert.equal(button(root, '保存加密包 JSON 副本').disabled, false); source.files = [file('b.txt', bytes('b'))]; await source.fire('change'); assert.equal(button(root, '保存加密包 JSON 副本').disabled, true); assert.ok(!root.textContent.includes('加密成功'));
  });
});
test('T093 UI: oversized/count/path source selections reject before arrayBuffer read', async () => {
  let reads = 0; await withUI(safeBridge({ text: [], bundle: [] }), async root => { const source = control(root, '加密源文件集合'); for (const collection of [[{ name: 'big', size: 2097153, arrayBuffer: async () => { reads++; } }], Array.from({ length: 51 }, (_, i) => file(`f${i}`, new Uint8Array())), [file('../escape', new Uint8Array())], Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, size: 2097152, arrayBuffer: async () => { reads++; } }))]) { source.files = collection; await source.fire('change'); assert.equal(button(root, '认证加密已预览文件').disabled, true); } assert.equal(reads, 0); });
});
test('T093 UI: package File API UTF8/BOM valid load; bad UTF8/cap rejected without decrypt/export', async () => {
  const encrypted = await example(), calls = { text: [], bundle: [] }; await withUI(safeBridge(calls), async root => { const node = control(root, '待解密交付包JSON文件'); node.files = [file('package.json', bytes('\uFEFF' + encrypted.text))]; await node.fire('change'); assert.ok(control(root, '待解密交付包JSON文本').value.includes('ciphertext')); assert.equal(calls.bundle.length, 0); await set(root, '解密口令', secret); await button(root, '完整认证解密并核验清单').fire('click'); assert.equal(button(root, '已核对预览，恢复到新目录').disabled, false);
    node.files = [file('bad.json', new Uint8Array([255]))]; await node.fire('change'); assert.match(root.textContent, /不是有效UTF-8/u); assert.equal(control(root, '待解密交付包JSON文本').value, ''); assert.equal(button(root, '已核对预览，恢复到新目录').disabled, true); node.files = [{ name: 'large', size: 16777217 }]; await node.fire('change'); assert.match(root.textContent, /16 MiB/u); assert.equal(calls.bundle.length, 0);
  });
});
test('T093 UI: missing protected bridges disable disk exports; successful crypto preview still usable', async () => {
  const encrypted = await example(); await withUI({ saveText: async () => assert.fail(), exportBundle: async () => assert.fail() }, async root => { await decryptUI(root, encrypted.text); assert.equal(button(root, '已核对预览，恢复到新目录').disabled, true); assert.equal(button(root, '另存已验证明文核验清单').disabled, true); assert.match(root.textContent, /缺失，恢复写入禁用/u); });
});
test('T093 UI: native cancel/failure/stringok/partial cleanup never falsely report success', async () => {
  const encrypted = await example(); let answer; await withUI({ saveTextSupportsCopyOnly: true, exportBundleSupportsCopyOnly: true, saveText: async () => answer, exportBundle: async () => { if (answer instanceof Error) throw answer; return answer; } }, async root => { await decryptUI(root, encrypted.text); for (const response of [{ ok: false, error: '已有目录' }, { ok: 'true' }, undefined, new Error('写入失败'), { ok: false, error: '清理失败', partialPath: 'partial-folder' }]) { answer = response; await button(root, '已核对预览，恢复到新目录').fire('click'); assert.ok(!root.textContent.includes('已保存恢复')); assert.match(root.textContent, /失败|成功结果/u); } assert.match(root.textContent, /人工核对目录：partial-folder/u); answer = { canceled: true }; await button(root, '已核对预览，恢复到新目录').fire('click'); assert.match(root.textContent, /已取消另存/u); answer = { ok: false, error: '已存在清单文件' }; await button(root, '另存已验证明文核验清单').fire('click'); assert.match(root.textContent, /保存失败/u); });
});
test('T093 UI: cancel/pause async crypto produces no preview/write, passwords cleaned and lifecycle listener cleanup', async () => {
  const encrypted = await example(), calls = { text: [], bundle: [] }; await withUI(safeBridge(calls), async (root, lifecycle) => { await set(root, '待解密交付包JSON文本', encrypted.text); await set(root, '解密口令', secret); const task = button(root, '完整认证解密并核验清单').fire('click'); await button(root, '取消当前读取/密码运算').fire('click'); await task; assert.equal(button(root, '已核对预览，恢复到新目录').disabled, true); assert.equal(calls.bundle.length, 0); assert.equal(control(root, '解密口令').value, ''); await decryptUI(root, encrypted.text); lifecycle.deactivate(); assert.ok(!root.textContent.includes('文档/说明😀.txt')); assert.equal(control(root, '解密口令').value, ''); lifecycle.activate(); assert.equal(button(root, '已核对预览，恢复到新目录').disabled, true);
    await set(root, '解密口令', secret); const pending = button(root, '完整认证解密并核验清单').fire('click'); lifecycle.deactivate(); await pending; lifecycle.activate(); assert.equal(button(root, '已核对预览，恢复到新目录').disabled, true); const oldPassword = control(root, '解密口令'), oldButton = button(root, '完整认证解密并核验清单'); lifecycle.destroy(); assert.equal(oldPassword.value, ''); assert.equal(oldPassword.listeners.input.length, 0); assert.equal(oldButton.listeners.click.length, 0); await oldButton.fire('click'); assert.equal(root.children.length, 0); assert.equal(calls.bundle.length, 0);
  });
});
test('T093 UI: mismatched password fails before source read; native export cancellation control disabled', async () => {
  const encrypted = await example(); let reads = 0, finish; await withUI({ saveTextSupportsCopyOnly: true, exportBundleSupportsCopyOnly: true, exportBundle: () => new Promise(resolve => { finish = resolve; }), saveText: async () => ({ ok: true }) }, async root => { const source = control(root, '加密源文件集合'); source.files = [{ name: 'a', size: 0, arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } }]; await source.fire('change'); await set(root, '加密口令', secret); await set(root, '确认加密口令', secret + 'x'); await button(root, '认证加密已预览文件').fire('click'); assert.match(root.textContent, /不一致/u); assert.equal(reads, 0); await decryptUI(root, encrypted.text); const task = button(root, '已核对预览，恢复到新目录').fire('click'); assert.equal(button(root, '取消当前读取/密码运算').disabled, true); assert.equal(button(root, '清空文件、包、口令和报告').disabled, true); finish({ canceled: true }); await task; assert.match(root.textContent, /已取消另存/u); });
});
