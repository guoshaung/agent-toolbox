const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L012/model.mjs');

test('L012 冷缓存同一块三次 miss/hit/hit，字节偏移不同仍2/3', async () => {
  const { simulate } = await model();
  for (const ways of [1, 2]) {
    const result = simulate('0, 1, 3', { blockSize: 4, setCount: 2, ways });
    assert.deepEqual(result.frames.map((row) => row.hit), [false, true, true]);
    assert.deepEqual(result.frames.map((row) => row.offset), [0, 1, 3]);
    assert.equal(result.hits, 2); assert.equal(result.misses, 1); assert.equal(result.hitRate, 2 / 3);
    assert.deepEqual(result.frames[0].blockRange, [0, 3]);
    assert.ok(result.frames[0].before.flat().every((line) => !line.valid));
    assert.equal(result.frames[0].after[0][0].lastAccess, 1); assert.equal(result.frames[2].after[0][0].lastAccess, 3);
  }
});

test('L012 直接映射冲突，标签/组/块公式与替换前后状态精确', async () => {
  const { simulate } = await model(); const result = simulate('0,8,0', { blockSize: 4, setCount: 2, ways: 1 });
  assert.deepEqual(result.frames.map((row) => [row.block, row.set, row.tag, row.way, row.hit]), [[0, 0, 0, 0, false], [2, 0, 1, 0, false], [0, 0, 0, 0, false]]);
  assert.equal(result.frames[1].evicted.block, 0); assert.equal(result.frames[2].evicted.block, 2);
  assert.equal(result.frames[1].before[0][0].block, 0); assert.equal(result.frames[1].after[0][0].block, 2);
  assert.equal(result.frames[0].after[0][0].block, 0); assert.ok(result.frames.every((frame) => !frame.after[1][0].valid));
});

test('L012 两路填最低空路，命中更新LRU，替换顺序可复现', async () => {
  const { simulate } = await model(); const result = simulate('0 8 0 16 8', { blockSize: 4, setCount: 2, ways: 2 });
  assert.deepEqual(result.frames.map((row) => row.hit), [false, false, true, false, false]);
  assert.deepEqual(result.frames.map((row) => row.way), [0, 1, 0, 1, 0]);
  assert.equal(result.frames[3].evicted.block, 2); assert.equal(result.frames[3].evicted.lastAccess, 2);
  assert.equal(result.frames[4].evicted.block, 0); assert.equal(result.frames[4].evicted.lastAccess, 3);
  assert.deepEqual(result.final[0].map((line) => [line.block, line.lastAccess]), [[2, 5], [4, 4]]);
});

test('L012 各组独立LRU，相同参数重复计算始终冷启动', async () => {
  const { simulate } = await model(); const params = { blockSize: 4, setCount: 2, ways: 2 };
  const source = '0 4 8 12 0 16'; const first = simulate(source, params); const second = simulate(source, params);
  assert.deepEqual(first, second); assert.deepEqual(params, { blockSize: 4, setCount: 2, ways: 2 });
  assert.equal(first.frames[5].evicted.block, 2); assert.deepEqual(first.final[1].map((line) => line.block), [1, 3]);
  const changed = simulate(source, { ...params, ways: 1 }); assert.notDeepEqual(changed.final, first.final);
});

test('L012 同容量比較块大小/总行数一致，不把两路容量翻倍混入结果', async () => {
  const { compareSameCapacity } = await model(); const result = compareSameCapacity('0,16,0,32,16', { blockSize: 4, setCount: 2, ways: 2 });
  assert.equal(result.capacityBytes, 16); assert.equal(result.direct.config.setCount, 4); assert.equal(result.twoWay.config.setCount, 2);
  assert.equal(result.direct.config.capacityBytes, result.twoWay.config.capacityBytes); assert.equal(result.direct.hits, 0); assert.equal(result.twoWay.hits, 1);
  assert.throws(() => compareSameCapacity('0', { setCount: 1, ways: 1 }), /至少需要2行/);
  const maximum = compareSameCapacity('0 0', { blockSize: 256, setCount: 32, ways: 2 }); assert.equal(maximum.direct.config.setCount, 64); assert.equal(maximum.capacityBytes, 16384);
});

test('L012 十六进制/逗号/注释解析，32位最大字节地址无有符号截断', async () => {
  const { parseAddresses, simulate } = await model();
  assert.deepEqual(parseAddresses('0x0, 0X01，3 #忽略\n4 //尾注释'), [0, 1, 3, 4]);
  const result = simulate('0xffffffff', { blockSize: 256, setCount: 64, ways: 1 });
  assert.equal(result.frames[0].block, 16777215); assert.equal(result.frames[0].set, 63); assert.equal(result.frames[0].tag, 262143); assert.equal(result.frames[0].offset, 255);
  assert.deepEqual(result.frames[0].blockRange, [4294967040, 4294967295]);
});

test('L012 拒空输入/非法地址/超限访问/非法参数，不悄悄截断', async () => {
  const { parseAddresses, validateParameters } = await model();
  for (const input of ['', '#注释', '-1', '1.5', '1e3', '0xZZ', '4294967296', 'NaN']) assert.throws(() => parseAddresses(input));
  assert.deepEqual(parseAddresses('0,,1'), [0, 1]);
  assert.equal(parseAddresses(Array(256).fill('0').join(' ')).length, 256);
  assert.throws(() => parseAddresses(Array(257).fill('0').join(' ')), /1至256/); assert.throws(() => parseAddresses('0'.repeat(10001)), /10000/);
  for (const parameters of [{ blockSize: 0 }, { blockSize: 3 }, { blockSize: 512 }, { setCount: 3 }, { setCount: 128 }, { ways: 4 }, { ways: '2' }, { ways: 2, setCount: 64 }, { blockSize: null }]) assert.throws(() => validateParameters(parameters));
  assert.equal(validateParameters({ blockSize: 1, setCount: 1, ways: 1 }).capacityBytes, 1);
});

test('L012 固定组合序列与独立组内LRU队列比对200组运行', async () => {
  const { simulate } = await model(); let seed = 12;
  const random = (max) => { seed = seed * 16807 % 2147483647; return seed % max; };
  for (let sample = 0; sample < 100; sample += 1) {
    const blockSize = 2 ** random(4); const setCount = 2 ** random(4); const addresses = Array.from({ length: 40 }, () => random(256));
    for (const ways of [1, 2]) {
      const queue = Array.from({ length: setCount }, () => []); const expected = addresses.map((address) => {
        const block = Math.floor(address / blockSize); const order = queue[block % setCount]; const index = order.indexOf(block); const hit = index !== -1;
        if (hit) order.splice(index, 1); else if (order.length === ways) order.shift(); order.push(block); return hit;
      });
      assert.deepEqual(simulate(addresses.join(' '), { blockSize, setCount, ways }).frames.map((frame) => frame.hit), expected, `sample${sample}, ways${ways}`);
    }
  }
});

test('L012 schema与64KiB UTF8边界，Markdown含状态/映射规则/同容量比较', async () => {
  const { prepareStoredState, validateStoredState, simulate, reportMarkdown, compareSameCapacity } = await model();
  const overhead = new TextEncoder().encode(JSON.stringify({ source: '', schemaVersion: 1 })).byteLength;
  const exact = prepareStoredState({ source: 'a'.repeat(65536 - overhead) }); assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 65536); assert.equal(validateStoredState(exact), exact);
  assert.throws(() => prepareStoredState({ source: exact.source + 'a' }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 1, source: '汉'.repeat(22000) }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/);
  const result = simulate('0,1,3'); const report = reportMarkdown(result, compareSameCapacity('0,1,3', {}));
  assert.match(report, /2\/3（66.67%）/); assert.match(report, /块号=floor/); assert.match(report, /每次访问后的缓存状态/); assert.match(report, /相同容量比较/);
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
function dom(t, files) { const oldDocument = global.document; const oldWindow = global.window; global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) }; global.window = { toolbox: { files } }; t.after(() => { global.document = oldDocument; global.window = oldWindow; }); }

test('L012 界面同块/替换/容量比较示例，状态切换及完整双格式导出', async (t) => {
  const exported = []; const stored = new Map(); dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } });
  const { default: feature } = await import('../src/renderer/features/L012/index.js');
  const root = new NodeStub('div'); const config = { get: (key) => stored.get(key), set: (key, value) => stored.set(key, value) }; const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await button(root, '同块三次示例').fire('click'); assert.match(root.textContent, /命中 2\/3（66.67%）/); assert.match(root.textContent, /第1次：地址0 → miss/);
  await button(root, '下一次访问').fire('click'); assert.match(root.textContent, /第2次：地址1 → hit/);
  control(root, '显示访问前缓存').checked = true; await control(root, '显示访问前缓存').fire('change'); assert.match(root.textContent, /第2次访问前的全缓存/);
  await button(root, 'LRU 替换示例').fire('click'); await control(root, '跳转第4次').fire('click'); assert.match(root.textContent, /替换块2，其上次访问是第2次/);
  await button(root, '相同容量比较示例').fire('click'); assert.match(root.textContent, /4×1/); assert.match(root.textContent, /2×2/); assert.match(root.textContent, /1\/5（20.00%）/);
  await button(root, '导出完整 JSON').fire('click'); const payload = JSON.parse(exported[0].content); assert.equal(payload.schemaVersion, 1); assert.equal(payload.result.frames.length, 5); assert.equal(payload.comparison.direct.hits, 0); assert.equal(payload.comparison.twoWay.hits, 1); assert.equal(exported[0].copyOnly, true);
  await button(root, '导出轨迹 Markdown').fire('click'); assert.equal(exported[1].extension, 'md'); assert.match(exported[1].content, /相同容量比较/);
  handle.deactivate(); const state = stored.get('features.L012.state'); assert.equal(state.schemaVersion, 1); assert.equal(Object.hasOwn(state, 'frames'), false);
  const restoredRoot = new NodeStub('div'); const restored = feature.create(restoredRoot, { config }); assert.match(restoredRoot.textContent, /4×1/); restored.destroy(); assert.equal(restoredRoot.children.length, 0);
});

test('L012 界面参数编辑使旧结果失效，错误/取消不清输入，能力不足拒导出', async (t) => {
  let saves = 0; dom(t, { saveText: async () => { saves += 1; return { ok: false, canceled: true }; } });
  const { default: feature } = await import('../src/renderer/features/L012/index.js'); const root = new NodeStub('div'); const handle = feature.create(root); t.after(() => handle.destroy());
  await button(root, '同块三次示例').fire('click'); await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 0); assert.match(root.textContent, /缺少防覆盖/);
  window.toolbox.files.saveTextSupportsCopyOnly = true; await button(root, '导出完整 JSON').fire('click'); assert.equal(saves, 1); assert.match(root.textContent, /已取消/); assert.match(root.textContent, /命中 2\/3/);
  control(root, '组数').value = '64'; await control(root, '组数').fire('change'); assert.match(root.textContent, /请重新计算/);
  control(root, '映射方式').value = '2'; await control(root, '映射方式').fire('change'); await button(root, '从冷缓存计算').fire('click'); assert.match(root.textContent, /总行数不能超过64/);
  const source = control(root, '读取地址序列'); source.value = '<img src=x onerror=alert(1)>'; await source.fire('input'); await button(root, '从冷缓存计算').fire('click'); assert.match(root.textContent, /需要十进制/);
});

test('L012 界面播放暂停销毁与配置超限、版本结构校验', async (t) => {
  dom(t, {}); const { default: feature } = await import('../src/renderer/features/L012/index.js');
  const originalSet = global.setInterval; const originalClear = global.clearInterval; let callback; let clears = 0;
  global.setInterval = (fn) => { callback = fn; return 123; }; global.clearInterval = (id) => { assert.equal(id, 123); clears += 1; }; t.after(() => { global.setInterval = originalSet; global.clearInterval = originalClear; });
  let writes = 0; const root = new NodeStub('div'); const handle = feature.create(root, { config: { get: () => null, set: () => { writes += 1; } } });
  await button(root, '同块三次示例').fire('click'); await button(root, '自动播放').fire('click'); callback(); assert.match(root.textContent, /第2次：/); handle.deactivate(); assert.equal(clears, 1);
  const source = control(root, '读取地址序列'); source.value = '汉'.repeat(22000); await source.fire('input'); const count = writes; handle.deactivate(); assert.equal(writes, count); assert.match(root.textContent, /当前输入未写入全局配置/); handle.destroy(); assert.equal(root.children.length, 0);
  for (const saved of [{ schemaVersion: 2 }, { schemaVersion: 1, source: '汉'.repeat(22000) }, { schemaVersion: 1, source: 3 }]) { const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => saved } }); assert.match(invalidRoot.textContent, /未能恢复/); invalid.destroy(); }
});
