const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L013/model.mjs');
const page = (virtualPage, physicalPage, extra = {}) => ({ virtualPage, physicalPage, present: true, read: true, write: true, ...extra });
const access = (address, mode = 'read') => ({ address, mode });

test('L013 核心公式8199=2×4096+7，物理20487；重复虚页命中', async () => {
  const { translate, example } = await model(); const result = translate(example());
  assert.equal(result.trace[0].virtualPage, 2); assert.equal(result.trace[0].offset, 7); assert.equal(result.trace[0].physicalAddress, 20487); assert.equal(result.trace[0].status, 'translated');
  assert.equal(result.trace[1].physicalAddress, 20488); assert.deepEqual(result.trace.map((row) => row.lookup), ['未命中', '命中']); assert.equal(result.stats.hitRate, 0.5);
  assert.equal(result.trace[0].before.length, 0); assert.equal(result.trace[0].after.length, 1);
});

test('L013 映射不存在、不驻留、写权限、地址越界各异且无物理地址', async () => {
  const { translate, example } = await model(); const result = translate(example('faults'));
  assert.deepEqual(result.trace.map((row) => row.status), ['translated', 'permission-fault', 'page-fault', 'unmapped', 'address-out-of-range', 'address-out-of-range']);
  assert.deepEqual(result.trace.slice(1).map((row) => row.physicalAddress), [null, null, null, null, null]);
  assert.equal(result.trace[1].lookup, '命中'); assert.equal(result.trace[1].after[0].write, false);
  assert.equal(result.stats.lookups, 4); assert.equal(result.stats.hits, 1); assert.equal(result.stats.misses, 3); assert.equal(result.stats.hitRate, 0.25); assert.equal(result.stats.faults, 5);
  assert.equal(result.finalTLB.length, 1); assert.equal(result.trace[4].virtualPage, null); assert.equal(result.trace[5].lookup, '未查询');
});

test('L013 TLB命中每次校验读写；拒绝的miss不填入', async () => {
  const { translate } = await model(); const result = translate({ pageSize: 4096, pages: [page(0, 8, { read: false })], accesses: [access(0), access(0, 'write'), access(1), access(2, 'write')] });
  assert.deepEqual(result.trace.map((row) => row.status), ['permission-fault', 'translated', 'permission-fault', 'translated']); assert.equal(result.trace[0].after.length, 0); assert.equal(result.trace[2].lookup, '命中'); assert.equal(result.trace[2].physicalAddress, null); assert.equal(result.trace[3].physicalAddress, 32770);
  const absent = translate({ pageSize: 4096, pages: [page(0, 0, { present: false, read: false, write: false })], accesses: [access(0)] }); assert.equal(absent.trace[0].status, 'page-fault');
});

test('L013 四项全相联LRU精确前后序列与替换受害者', async () => {
  const { translate, example } = await model(); const result = translate(example('lru'));
  assert.deepEqual(result.trace.map((row) => row.after.map((entry) => entry.virtualPage)), [[0], [0, 1], [0, 1, 2], [0, 1, 2, 3], [1, 2, 3, 0], [2, 3, 0, 4]]);
  assert.equal(result.trace[4].lookup, '命中'); assert.equal(result.trace[5].evicted.virtualPage, 1); assert.equal(result.trace[5].evicted.physicalPage, 6); assert.equal(result.stats.hits, 1); assert.equal(result.stats.lookups, 6);
});

test('L013 权限错误的命中仍更新LRU，但不生成地址', async () => {
  const { translate } = await model(); const result = translate({ pageSize: 4096, pages: Array.from({ length: 5 }, (_, n) => page(n, n, { write: false })), accesses: [0, 1, 2, 3].map((n) => access(n * 4096)).concat([access(0, 'write'), access(4 * 4096)]) });
  assert.equal(result.trace[4].status, 'permission-fault'); assert.equal(result.trace[4].physicalAddress, null); assert.deepEqual(result.trace[4].after.map((row) => row.virtualPage), [1, 2, 3, 0]); assert.equal(result.trace[5].evicted.virtualPage, 1);
});

test('L013 UINT32顶端与符号边界、独立商余数公式、所有页大小', async () => {
  const { translate, PAGE_SIZES, UINT32_MAX } = await model();
  for (const pageSize of PAGE_SIZES) {
    const maxPage = Math.floor(UINT32_MAX / pageSize); const result = translate({ pageSize, pages: [page(maxPage, maxPage), page(0, maxPage)], accesses: [access('0xffffffff'), access(0), access(pageSize - 1)] });
    assert.equal(result.trace[0].physicalAddress, 4294967295); assert.equal(result.trace[0].offset, pageSize - 1); assert.equal(result.trace[1].physicalAddress, maxPage * pageSize); assert.equal(result.trace[2].physicalAddress, 4294967295);
  }
  const signed = translate({ pageSize: 4096, pages: [page(524288, 524288)], accesses: [access('0x80000000')] }); assert.equal(signed.trace[0].virtualPage, 524288); assert.equal(signed.trace[0].physicalAddress, 2147483648);
});

test('L013 页表重复、非法参数、越界页号与任意脚本文本拒绝', async () => {
  const { translate, integer } = await model(); const draft = { pageSize: 4096, pages: [page(0, 0)], accesses: [access(0)] };
  assert.throws(() => translate({ ...draft, pageSize: 3000 }), /页大小/); assert.throws(() => translate({ ...draft, pages: [page(0, 0), page(0, 2)] }), /重复/);
  for (const pages of [[page(-1, 0)], [page(0, 1048576)], [page(1048576, 0)], [page(0, 0, { read: 'true' })]]) assert.throws(() => translate({ ...draft, pages }));
  for (const value of ['', '1.2', '1e3', 'Infinity', 'alert(1)', '<img src=x>', null, true, [1], 9007199254740992]) assert.throws(() => integer(value, '地址'));
  assert.throws(() => translate({ ...draft, accesses: [access(0, 'execute')] }), /read或write/); assert.equal(integer('0Xfff', '地址'), 4095);
});

test('L013 空集合不产生率、容量边界64页128访问', async () => {
  const { translate } = await model(); const empty = translate({ pageSize: 4096, pages: [], accesses: [] }); assert.equal(empty.stats.hitRate, null); assert.equal(empty.trace.length, 0); assert.equal(empty.finalTLB.length, 0);
  const rangeOnly = translate({ pageSize: 4096, pages: [], accesses: [access(-1)] }); assert.equal(rangeOnly.stats.hitRate, null);
  const pages = Array.from({ length: 64 }, (_, n) => page(n, n)); const accesses = Array.from({ length: 128 }, () => access(0)); assert.equal(translate({ pageSize: 4096, pages, accesses }).stats.hits, 127);
  assert.throws(() => translate({ pageSize: 4096, pages: [...pages, page(64, 64)], accesses }), /64/); assert.throws(() => translate({ pageSize: 4096, pages, accesses: [...accesses, access(0)] }), /128/);
});

test('L013 每轮冷缓存、输入不变且快照和结果独立', async () => {
  const { translate, example } = await model(); const input = example('lru'); const before = structuredClone(input); const first = translate(input); assert.deepEqual(first, translate(input)); assert.deepEqual(input, before);
  first.trace[0].after[0].physicalPage = 999; assert.equal(first.trace[1].before[0].physicalPage, 5); assert.equal(first.finalTLB[2].physicalPage, 5);
  input.pages[0].physicalPage = '88'; assert.equal(first.input.pages[0].physicalPage, 5); assert.equal(translate(input).trace[0].lookup, '未命中'); assert.equal(translate(input).trace[0].physicalAddress, 88 * 4096);
});

test('L013 版本化64KiB UTF8边界恢复与完整JSON/Markdown报告', async () => {
  const { prepareStoredState, validateStoredState, example, translate, reportMarkdown } = await model(); const draft = example(); const overhead = new TextEncoder().encode(JSON.stringify(prepareStoredState({ ...draft, accesses: [access('')] }))).byteLength;
  const exactDraft = { ...draft, accesses: [access('a'.repeat(65536 - overhead))] }; const exact = prepareStoredState(exactDraft); assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 65536); assert.deepEqual(validateStoredState(exact), exact);
  assert.throws(() => prepareStoredState({ ...exactDraft, accesses: [access(exactDraft.accesses[0].address + 'a')] }), /64KiB/); assert.throws(() => validateStoredState({ ...prepareStoredState(draft), hidden: '汉'.repeat(22000) }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/);
  assert.throws(() => validateStoredState({ ...prepareStoredState(draft), pages: [page(0, 0)] }), /类型/);
  const faults = example('faults'); const report = reportMarkdown({ draft: faults, result: translate(faults) }); assert.match(report, /20487/); assert.match(report, /权限错误/); assert.match(report, /不驻留缺页/); assert.match(report, /越界地址不计TLB查询分母/); assert.match(report, /TLB之前/); assert.match(reportMarkdown({ draft, result: null }), /尚未运行/);
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
async function check(root, label, value) { const node = control(root, label); node.checked = value; await node.fire('change'); }
function dom(t, files) { const oldDocument = global.document; const oldWindow = global.window; global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) }; global.window = { toolbox: { files } }; t.after(() => { global.document = oldDocument; global.window = oldWindow; }); }

test('L013 真实组件事件公式、逐步和全格式副本导出/恢复', async (t) => {
  const exported = []; const stored = new Map(); dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L013/index.js'); const root = new NodeStub('div'); const config = { get: (key) => stored.get(key), set: (key, value) => stored.set(key, value) }; const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await button(root, '运行地址翻译').fire('click'); assert.match(root.textContent, /物理地址 = 5 × 4096 \+ 7 = 20487/); assert.match(root.textContent, /TLB操作：填入TLB/);
  await button(root, '下一步').fire('click'); assert.match(root.textContent, /TLB操作：命中并更新LRU/); assert.equal(button(root, '下一步').disabled, true); await button(root, '上一步').fire('click');
  await button(root, '导出完整 JSON').fire('click'); const payload = JSON.parse(exported[0].content); assert.equal(payload.schemaVersion, 1); assert.equal(payload.result.trace[0].physicalAddress, 20487); assert.equal(exported[0].copyOnly, true);
  await button(root, '导出完整 Markdown').fire('click'); assert.equal(exported[1].extension, 'md'); assert.equal(exported[1].copyOnly, true); assert.match(exported[1].content, /TLB之后/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
  handle.deactivate(); assert.equal(stored.get('features.L013.state').schemaVersion, 1); assert.equal(Object.hasOwn(stored.get('features.L013.state'), 'result'), false);
  const restoredRoot = new NodeStub('div'); const restored = feature.create(restoredRoot, { config }); assert.match(restoredRoot.textContent, /已恢复输入草稿/); assert.match(restoredRoot.textContent, /当前没有有效轨迹/); assert.equal(control(restoredRoot, '访问1地址').value, '8199'); restored.destroy(); assert.equal(restoredRoot.children.length, 0);
});

test('L013 真实编辑页表权限/参数/访问立即清除TLB旧轨迹，命中不绕过权限', async (t) => {
  const reports = []; dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { reports.push(JSON.parse(payload.content)); return { ok: true }; } }); const { default: feature } = await import('../src/renderer/features/L013/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await button(root, '载入异常示例').fire('click'); await button(root, '运行地址翻译').fire('click'); await button(root, '查看第2次').fire('click'); assert.match(root.textContent, /TLB命中；继续检查缓存的读写权限/); assert.match(root.textContent, /写权限错误/);
  await check(root, '页表1可写', true); assert.match(root.textContent, /TLB及旧轨迹已清空/); await button(root, '导出完整 JSON').fire('click'); assert.equal(reports[0].result, null);
  await button(root, '运行地址翻译').fire('click'); await button(root, '导出完整 JSON').fire('click'); assert.equal(reports[1].result.trace[1].status, 'translated');
  await fill(root, '页表1物理页号', '8'); assert.match(root.textContent, /当前没有有效轨迹/); await button(root, '运行地址翻译').fire('click'); await button(root, '导出完整 JSON').fire('click'); assert.equal(reports[2].result.trace[0].physicalAddress, 32775); assert.equal(reports[2].result.trace[0].lookup, '未命中');
  await fill(root, '页大小', '8192'); assert.match(root.textContent, /当前没有有效轨迹/); await fill(root, '访问1地址', '16391'); await fill(root, '访问1操作', 'write'); await button(root, '运行地址翻译').fire('click'); await button(root, '导出完整 JSON').fire('click'); assert.equal(reports[3].result.trace[0].physicalAddress, 65543);
  await check(root, '页表1驻留', false); await button(root, '运行地址翻译').fire('click'); await button(root, '导出完整 JSON').fire('click'); assert.equal(reports[4].result.trace[0].status, 'page-fault'); assert.equal(reports[4].result.trace[0].after.length, 0);
  await check(root, '页表1可读', false); assert.match(root.textContent, /当前没有有效轨迹/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
});

test('L013 LRU界面选择步骤、真实添加删除与输入错误', async (t) => {
  dom(t, {}); const { default: feature } = await import('../src/renderer/features/L013/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await button(root, '载入 LRU 示例').fire('click'); await button(root, '运行地址翻译').fire('click'); await fill(root, '查看访问步骤', '5'); assert.match(root.textContent, /替换最旧虚页1并填入/); assert.match(root.textContent, /被替换虚页1→物理页6/);
  await button(root, '添加映射').fire('click'); await fill(root, '页表6虚页号', '5'); await fill(root, '页表6物理页号', '10'); await button(root, '添加访问').fire('click'); await fill(root, '访问7地址', '20480'); await button(root, '运行地址翻译').fire('click'); await button(root, '查看第7次').fire('click'); assert.match(root.textContent, /= 40960/);
  await button(root, '删除页表 6').fire('click'); await button(root, '运行地址翻译').fire('click'); await button(root, '查看第7次').fire('click'); assert.match(root.textContent, /页表中没有该虚页/); await button(root, '删除访问 7').fire('click');
  await fill(root, '访问1地址', '<img src=x onerror=alert(1)>'); await button(root, '运行地址翻译').fire('click'); assert.match(root.textContent, /须为十进制整数/); assert.match(root.textContent, /当前没有有效轨迹/); assert.doesNotMatch(root.textContent, /\[object Object\]|null/);
});

test('L013 空访问/导出能力与取消/容量/64KiB草稿恢复生命周期', async (t) => {
  let saves = 0; let writes = 0; dom(t, { saveText: async () => { saves++; return { canceled: true }; } }); const { default: feature } = await import('../src/renderer/features/L013/index.js'); const root = new NodeStub('div'); const handle = feature.create(root, { config: { get: () => null, set: () => { writes++; } } }); t.after(() => handle.destroy());
  await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 0); assert.match(root.textContent, /缺少防覆盖/); window.toolbox.files.saveTextSupportsCopyOnly = true; await button(root, '导出完整 Markdown').fire('click'); assert.equal(saves, 1); assert.match(root.textContent, /已取消导出/);
  await button(root, '删除访问 2').fire('click'); await button(root, '删除访问 1').fire('click'); await button(root, '运行地址翻译').fire('click'); assert.match(root.textContent, /没有访问，未生成命中率/);
  await button(root, '添加访问').fire('click'); await fill(root, '访问1地址', '汉'.repeat(22000)); const before = writes; handle.deactivate(); assert.equal(writes, before); assert.match(root.textContent, /当前输入未写入全局配置/);
  const { prepareStoredState, example } = await model(); const maximumDraft = example(); maximumDraft.pages = Array.from({ length: 64 }, (_, n) => ({ ...page(String(n), String(n)) })); maximumDraft.accesses = Array.from({ length: 128 }, () => access('0'));
  const maximumRoot = new NodeStub('div'); const maximum = feature.create(maximumRoot, { config: { get: () => prepareStoredState(maximumDraft) } }); assert.equal(button(maximumRoot, '添加映射').disabled, true); assert.equal(button(maximumRoot, '添加访问').disabled, true); maximum.destroy();
  for (const saved of [{ schemaVersion: 2 }, { ...prepareStoredState(example()), hidden: '汉'.repeat(22000) }, { schemaVersion: 1, pageSize: '3000', pages: [], accesses: [] }]) { const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => saved } }); assert.match(invalidRoot.textContent, /未能恢复/); invalid.destroy(); }
});
