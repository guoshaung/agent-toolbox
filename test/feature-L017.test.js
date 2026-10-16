const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L017/model.mjs');

test('L017 核心max-age60 age30无请求，age90匹配304复用旧body更新时间', async () => {
  const { decideCache, example } = await model(); const fresh = decideCache(example()); assert.equal(fresh.requestCount, 0); assert.equal(fresh.responseStatus, null); assert.equal(fresh.final.request, null); assert.equal(fresh.final.response, null); assert.equal(fresh.outcome, 'reuse-local'); assert.equal(fresh.final.cache.age, 30); assert.equal(fresh.final.cache.lastValidatedAt, 70); assert.deepEqual(fresh.initialCache, fresh.final.cache); assert.equal(fresh.steps.length, 3);
  const stale = decideCache({ ...example('stale'), serverBody: '不同内容不会作为304响应体发送' }); assert.equal(stale.requestCount, 1); assert.equal(stale.responseStatus, 304); assert.deepEqual(stale.final.request.headers, { 'If-None-Match': '"v1"' }); assert.equal(stale.final.response.body, null); assert.equal(stale.final.bodyForUse, stale.input.cachedBody); assert.equal(stale.final.cache.age, 0); assert.equal(stale.final.cache.lastValidatedAt, 102); assert.equal(stale.initialCache.lastValidatedAt, 10); assert.equal(stale.transferredBodyBytes, 0); assert.equal(stale.steps.length, 5);
});

test('L017 新鲜度严格临界年龄等于max-age已过期，max-age0总验证', async () => {
  const { decideCache, example } = await model();
  for (const [age, reusable] of [[0, true], [59, true], [60, false], [61, false], [90, false]]) { const result = decideCache({ ...example(), age: String(age) }); assert.equal(result.freshness.directlyReusable, reusable); assert.equal(result.requestCount, reusable ? 0 : 1); }
  const zero = decideCache({ ...example(), cacheControl: 'max-age=0', age: '0' }); assert.equal(zero.requestCount, 1); assert.equal(zero.responseStatus, 304); assert.equal(zero.freshness.fresh, false);
});

test('L017 no-cache存储但新鲜也验证，成功后年龄0下一次仍需验证', async () => {
  const { decideCache, example } = await model(); const first = decideCache(example('no-cache')); assert.equal(first.freshness.fresh, true); assert.equal(first.freshness.directlyReusable, false); assert.equal(first.responseStatus, 304); assert.equal(first.final.cache.exists, true); assert.equal(first.final.cache.noCache, true); assert.equal(first.final.cache.age, 0);
  const next = decideCache({ ...example('no-cache'), now: String(first.final.time), age: String(first.final.cache.age), cacheControl: first.final.cache.cacheControl }); assert.equal(next.requestCount, 1); assert.equal(next.responseStatus, 304);
  const only = decideCache({ ...example(), cacheControl: 'no-cache', serverCacheControl: 'no-cache', age: '0' }); assert.equal(only.freshness.maxAge, null); assert.equal(only.requestCount, 1); assert.equal(only.final.cache.exists, true);
});

test('L017 GET强/弱标签所有组合弱比较，opaque大小写不忽略，空标签有效', async () => {
  const { decideCache, example, parseETag, weakMatch } = await model();
  for (const left of ['"v1"', 'W/"v1"']) for (const right of ['"v1"', 'W/"v1"']) { const result = decideCache({ ...example('stale'), cachedETag: left, serverETag: right }); assert.equal(result.responseStatus, 304); assert.equal(result.final.request.headers['If-None-Match'], left); assert.equal(result.final.cache.etag, right); }
  assert.equal(decideCache({ ...example('stale'), serverETag: '"V1"' }).responseStatus, 200); assert.equal(weakMatch(parseETag('W/""'), parseETag('""')), true); assert.equal(decideCache({ ...example('stale'), cachedETag: '""', serverETag: 'W/""' }).responseStatus, 304); assert.equal(parseETag('  '), null); assert.deepEqual(parseETag(' W/"v1" '), { raw: 'W/"v1"', weak: true, opaque: 'v1' });
});

test('L017 ETag格式ASCII子集、W大小写、列表/*/代码与长度拒绝', async () => {
  const { parseETag } = await model();
  for (const tag of ['v1', "'v1'", 'w/"v1"', 'W/ "v1"', '"a b"', '"a\nb"', '"a", "b"', '*', '"汉"', '"a\\"b"', `"${'a'.repeat(65)}"`, null, 1]) assert.throws(() => parseETag(tag));
  assert.equal(parseETag(`"${'a'.repeat(64)}"`).opaque.length, 64); assert.equal(parseETag('"a\\b"').opaque, 'a\\b'); assert.equal(parseETag('"a,b"').opaque, 'a,b');
});

test('L017 不匹配200替换body/ETag/缓存策略，缺失验证器不造304', async () => {
  const { decideCache, example } = await model(); const changed = decideCache({ ...example('changed'), serverCacheControl: 'max-age=120, no-cache' }); assert.equal(changed.responseStatus, 200); assert.equal(changed.final.cache.body, changed.input.serverBody); assert.equal(changed.final.cache.etag, '"v2"'); assert.equal(changed.final.cache.cacheControl, 'max-age=120, no-cache'); assert.equal(changed.final.cache.noCache, true); assert.equal(changed.transferredBodyBytes, new TextEncoder().encode(changed.input.serverBody).byteLength); assert.equal(changed.final.cache.lastValidatedAt, 102);
  const unvalidated = decideCache({ ...example('stale'), cachedETag: '' }); assert.deepEqual(unvalidated.final.request.headers, {}); assert.equal(unvalidated.responseStatus, 200);
  const noServerTag = decideCache({ ...example('stale'), serverETag: '' }); assert.equal(noServerTag.responseStatus, 200); assert.equal(noServerTag.final.cache.etag, null); assert.equal(Object.hasOwn(noServerTag.final.response.headers, 'ETag'), false);
});

test('L017 304更新响应元数据但不传body；本地新鲜不检查版本变化', async () => {
  const { decideCache, example } = await model(); const fresh = decideCache({ ...example('changed'), age: '30' }); assert.equal(fresh.requestCount, 0); assert.equal(fresh.final.cache.etag, '"v1"'); assert.equal(fresh.final.bodyForUse, fresh.input.cachedBody);
  const validated = decideCache({ ...example('stale'), serverCacheControl: 'max-age=120' }); assert.equal(validated.final.cache.maxAge, 120); assert.equal(validated.final.cache.body, validated.initialCache.body); assert.equal(validated.steps[3].after.cache.age, 92); assert.equal(validated.steps[4].after.cache.age, 0); assert.equal(validated.final.response.body, null);
  assert.deepEqual(validated.steps.map((step) => step.title), ['读取已有本地缓存', '判断年龄与验证要求', '构造条件GET', '服务端模拟返回304', '保留body，更新验证元数据']);
});

test('L017 Cache-Control仅固定子集/重复拒绝，no-store不模拟成no-cache', async () => {
  const { parseCacheControl } = await model(); assert.deepEqual(parseCacheControl('NO-CACHE, MAX-AGE = 0060'), { maxAge: 60, noCache: true, canonical: 'max-age=60, no-cache' }); assert.equal(parseCacheControl('max-age=604800').maxAge, 604800);
  for (const value of ['', 'max-age="60"', 'max-age=-1', 'max-age=1.5', 'max-age=604801', 'max-age=0,max-age=60', 'no-cache,no-cache', 'no-cache="ETag"', 'no-store', 'max-age=60, no-store', 's-maxage=60', 'max-age=60,', null]) assert.throws(() => parseCacheControl(value));
});

test('L017 有界时间与响应耗时、4096 UTF8 body边界及空body', async () => {
  const { decideCache, example } = await model(); const draft = example('changed'); const exact = '汉'.repeat(1365) + 'a'; assert.equal(new TextEncoder().encode(exact).byteLength, 4096); assert.equal(decideCache({ ...draft, serverBody: exact }).transferredBodyBytes, 4096); assert.throws(() => decideCache({ ...draft, serverBody: exact + 'a' }), /4096/); assert.equal(decideCache({ ...draft, serverBody: '' }).transferredBodyBytes, 0);
  for (const patch of [{ now: '89', age: '90' }, { now: '1000000000', responseDelay: '1' }, { age: '1000001' }, { responseDelay: '61' }, { now: '-1' }, { age: '1e2' }, { age: true }, { now: [100] }, { cachedBody: null }]) assert.throws(() => decideCache({ ...draft, ...patch }));
  assert.equal(decideCache({ ...draft, now: '1000000000', age: '90', responseDelay: '0' }).final.time, 1000000000);
});

test('L017 结果确定、输入和步骤快照独立不被修改', async () => {
  const { decideCache, example } = await model(); const draft = example('stale'); const before = structuredClone(draft); const result = decideCache(draft); assert.deepEqual(result, decideCache(draft)); assert.deepEqual(draft, before); result.steps[0].after.cache.body = '回改'; assert.equal(result.steps[1].before.cache.body, before.cachedBody); assert.equal(result.initialCache.body, before.cachedBody); draft.cachedBody = '外部改'; assert.equal(result.input.cachedBody, before.cachedBody); assert.equal(result.final.cache.body, before.cachedBody);
});

test('L017 schema/64KiB UTF8和body草稿容量、完整Markdown保存前后与来源', async () => {
  const { prepareStoredState, validateStoredState, decideCache, example, reportMarkdown } = await model(); const draft = example('stale'); const overhead = new TextEncoder().encode(JSON.stringify(prepareStoredState({ ...draft, now: '' }))).byteLength; const exact = prepareStoredState({ ...draft, now: 'a'.repeat(65536 - overhead) }); assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 65536); assert.deepEqual(validateStoredState(exact), exact); assert.throws(() => prepareStoredState({ ...draft, now: exact.now + 'a' }), /64KiB/); assert.throws(() => validateStoredState({ ...prepareStoredState(draft), hidden: '汉'.repeat(22000) }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/); assert.throws(() => validateStoredState({ ...prepareStoredState(draft), age: 30 }), /字段类型/); assert.throws(() => prepareStoredState({ ...draft, cachedBody: '汉'.repeat(1400) }), /body超过4096/);
  const report = reportMarkdown({ draft, result: decideCache(draft) }); assert.match(report, /模拟响应304/); assert.match(report, /本地最初/); assert.match(report, /本地最后/); assert.match(report, /If-None-Match/); assert.match(report, /rfc9110.html#section-13.1.2/); assert.match(report, /rfc9111.html#section-4.2/); assert.match(reportMarkdown({ draft, result: null }), /未生成有效决策/);
  const htmlDraft = { ...draft, cachedBody: '<img src=x>', cachedETag: '"<script>"', serverETag: '"<script>"' }; const escaped = reportMarkdown({ draft: htmlDraft, result: decideCache(htmlDraft) }); assert.doesNotMatch(escaped, /<img|<script>/); assert.match(escaped, /&lt;img/); assert.match(escaped, /&lt;script&gt;/);
});

class NodeStub {
  constructor(tag = '', text = null) { this.tagName = tag; this.nodeType = text === null ? 1 : 3; this.text = text; this.children = []; this.attributes = {}; this.style = {}; this.dataset = {}; this.className = ''; this.events = {}; this.value = ''; this.checked = false; this.disabled = false; this.classList = { add: (name) => { this.className += ` ${name}`; }, remove: (name) => { this.className = this.className.split(' ').filter((item) => item !== name).join(' '); }, toggle: (name, yes) => { this.classList.remove(name); if (yes) this.classList.add(name); } }; }
  append(...items) { this.children.push(...items.map((item) => item?.nodeType ? item : new NodeStub('', String(item)))); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'disabled') this.disabled = true; }
  addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
  get textContent() { return this.text === null ? this.children.map((child) => child.textContent).join('') : this.text; }
  set textContent(value) { this.text = null; this.replaceChildren(String(value)); }
  set innerHTML(_value) { throw new Error('User input must be rendered as text'); }
  async fire(type) { if (type === 'click' && this.disabled) return; for (const callback of this.events[type] || []) await callback({ target: this }); }
}
const walk = (node) => [node, ...node.children.flatMap(walk)];
const button = (root, label) => { const node = walk(root).find((item) => item.tagName === 'button' && item.textContent === label); assert.ok(node, label); return node; };
const control = (root, label) => { const node = walk(root).find((item) => item.attributes['aria-label'] === label); assert.ok(node, label); return node; };
async function fill(root, label, value) { const node = control(root, label); node.value = value; await node.fire(node.tagName === 'select' ? 'change' : 'input'); }
function dom(t, files) { const oldDocument = global.document; const oldWindow = global.window; global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) }; global.window = { toolbox: { files } }; t.after(() => { global.document = oldDocument; global.window = oldWindow; }); }

test('L017 实际UI核心30无请求/90匹配304，步骤/全JSON-MD副本/恢复', async (t) => {
  const exported = []; const stored = new Map(); dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L017/index.js'); const root = new NodeStub('div'); const config = { get: (key) => stored.get(key), set: (key, value) => stored.set(key, value) }; const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await button(root, '判断缓存').fire('click'); assert.match(root.textContent, /直接复用本地缓存 · 请求 0次/); await button(root, '下个判断').fire('click'); assert.match(root.textContent, /年龄30 < max-age 60为真/);
  await fill(root, '本地缓存年龄秒', '90'); assert.doesNotMatch(root.textContent, /全程结论：/); await button(root, '判断缓存').fire('click'); assert.match(root.textContent, /304验证成功，复用原body · 请求 1次/); await fill(root, '查看决策步骤', '3'); assert.match(root.textContent, /304无响应body/); await button(root, '下个判断').fire('click'); assert.match(root.textContent, /验证时间设为102/); assert.equal(button(root, '下个判断').disabled, true);
  await button(root, '导出完整 JSON').fire('click'); const payload = JSON.parse(exported[0].content); assert.equal(payload.schemaVersion, 1); assert.equal(payload.result.responseStatus, 304); assert.equal(payload.result.final.cache.lastValidatedAt, 102); assert.equal(exported[0].copyOnly, true);
  await button(root, '导出完整 Markdown').fire('click'); assert.equal(exported[1].copyOnly, true); assert.match(exported[1].content, /本地最后/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
  handle.deactivate(); assert.equal(stored.get('features.L017.state').schemaVersion, 1); assert.equal(Object.hasOwn(stored.get('features.L017.state'), 'result'), false);
  const restoredRoot = new NodeStub('div'); const restored = feature.create(restoredRoot, { config }); assert.match(restoredRoot.textContent, /已恢复输入草稿/); assert.doesNotMatch(restoredRoot.textContent, /全程结论：/); assert.equal(control(restoredRoot, '本地缓存年龄秒').value, '90'); restored.destroy(); assert.equal(restoredRoot.children.length, 0);
});

test('L017 实际UI no-cache/弱标签/200替换、真实全部字段编辑清旧结果', async (t) => {
  const exported = []; dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(JSON.parse(payload.content)); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L017/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await button(root, '载入no-cache示例').fire('click'); await button(root, '判断缓存').fire('click'); assert.match(root.textContent, /原始年龄判断：新鲜；no-cache仍强制验证/); await button(root, '查看步骤5：保留body，更新验证元数据').fire('click'); assert.match(root.textContent, /每次需验证，仍已存储/);
  await button(root, '载入弱ETag示例').fire('click'); await button(root, '判断缓存').fire('click'); assert.match(root.textContent, /304验证成功/);
  await button(root, '载入200示例').fire('click'); await button(root, '判断缓存').fire('click'); await fill(root, '查看决策步骤', '4'); assert.match(root.textContent, /200替换本地缓存/); assert.match(root.textContent, /版本2：更新后的课程内容/);
  for (const [label, value] of [['当前时间秒', '200'], ['模拟响应耗时秒', '0'], ['本地Cache-Control', 'max-age=60, no-cache'], ['本地ETag', 'W/"v0"'], ['本地body', '原body'], ['服务端Cache-Control', 'max-age=120'], ['服务端ETag', '"v3"'], ['服务端body', '新body']]) { await fill(root, label, value); assert.doesNotMatch(root.textContent, /全程结论：/); await button(root, '判断缓存').fire('click'); assert.match(root.textContent, /全程结论：/); }
  await button(root, '导出完整 JSON').fire('click'); assert.equal(exported[0].result.final.cache.body, '新body'); assert.equal(exported[0].result.final.cache.etag, '"v3"'); assert.equal(exported[0].result.final.cache.lastValidatedAt, 200); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
});

test('L017 UI明确未支持no-store/非法ETag/时间与body上限，错误无旧报告', async (t) => {
  dom(t, {}); const { default: feature } = await import('../src/renderer/features/L017/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await fill(root, '本地Cache-Control', 'no-store'); await button(root, '判断缓存').fire('click'); assert.match(root.textContent, /不实现no-store/); assert.doesNotMatch(root.textContent, /全程结论：/);
  await button(root, '载入新鲜示例').fire('click'); await fill(root, '本地ETag', 'v1'); await button(root, '判断缓存').fire('click'); assert.match(root.textContent, /单个双引号ASCII标签/);
  await button(root, '载入新鲜示例').fire('click'); await fill(root, '当前时间秒', '20'); await button(root, '判断缓存').fire('click'); assert.match(root.textContent, /当前时间必须≥年龄/);
  await button(root, '载入200示例').fire('click'); await fill(root, '服务端body', '汉'.repeat(1400)); await button(root, '判断缓存').fire('click'); assert.match(root.textContent, /body须为≤4096/); assert.doesNotMatch(root.textContent, /全程结论：/);
  await fill(root, '服务端body', '<img src=x onerror=alert(1)>'); await button(root, '判断缓存').fire('click'); await fill(root, '查看决策步骤', '4'); assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
});

test('L017 配置64KiB/schema与body容量、导出能力/取消及生命周期', async (t) => {
  let saves = 0; let writes = 0; dom(t, { saveText: async () => { saves++; return { canceled: true }; } }); const { default: feature } = await import('../src/renderer/features/L017/index.js'); const root = new NodeStub('div'); const handle = feature.create(root, { config: { get: () => null, set: () => { writes++; } } }); t.after(() => handle.destroy());
  await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 0); assert.match(root.textContent, /缺少防覆盖/); window.toolbox.files.saveTextSupportsCopyOnly = true; await button(root, '导出完整 Markdown').fire('click'); assert.equal(saves, 1); assert.match(root.textContent, /已取消导出/);
  await fill(root, '当前时间秒', '汉'.repeat(22000)); let before = writes; handle.deactivate(); assert.equal(writes, before); assert.match(root.textContent, /当前输入未写入全局配置/);
  await fill(root, '当前时间秒', '100'); await fill(root, '本地body', '汉'.repeat(1400)); before = writes; handle.deactivate(); assert.equal(writes, before); assert.match(root.textContent, /body超过4096/);
  const { prepareStoredState, example } = await model(); for (const saved of [{ schemaVersion: 2 }, { ...prepareStoredState(example()), hidden: '汉'.repeat(22000) }, { ...prepareStoredState(example()), age: 30 }]) { const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => saved } }); assert.match(invalidRoot.textContent, /未能恢复/); invalid.destroy(); }
});
