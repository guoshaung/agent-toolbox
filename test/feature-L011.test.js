const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L011/model.mjs');
const base = { registers: [0, 0, 9, 2, 3, 0, 0, 0], memory: { 0: 10 } };

test('L011 LOAD→ADD 开转发一次load-use，关闭两次，精确矩阵与结果', async () => {
  const { simulate } = await model();
  const program = 'LOAD R1,[R0]\nADD R2,R1,R3';
  const on = simulate(program, base); const off = simulate(program, { ...base, forwarding: false });
  assert.equal(on.totalCycles, 7); assert.equal(on.stallCount, 1); assert.equal(on.stalls[0].cycle, 3);
  assert.deepEqual(on.matrix.map((row) => row.cells), [['IF', 'ID', 'EX', 'MEM', 'WB', '', ''], ['', 'IF', 'ID*', 'ID', 'EX', 'MEM', 'WB']]);
  assert.equal(on.final.registers[2], 12);
  assert.equal(off.totalCycles, 8); assert.equal(off.stallCount, 2);
  assert.deepEqual(off.matrix[1].cells, ['', 'IF', 'ID*', 'ID*', 'ID', 'EX', 'MEM', 'WB']);
  assert.equal(off.frames[4].registers[1], 10); assert.ok(off.frames[4].events.some((event) => event.includes('ID I2：读取')));
  assert.deepEqual(off.final, on.final);
});

test('L011 独立ADD无停顿；ADD紧邻消费者由MEM→EX转发', async () => {
  const { simulate } = await model();
  for (const forwarding of [true, false]) {
    const independent = simulate('LOAD R1,[R0]\nADD R2,R3,R4', { ...base, forwarding });
    assert.equal(independent.totalCycles, 6); assert.equal(independent.stallCount, 0);
    assert.deepEqual(independent.matrix[1].cells, ['', 'IF', 'ID', 'EX', 'MEM', 'WB']);
    assert.equal(independent.final.registers[2], 5);
  }
  const on = simulate('ADD R1,R2,R3\nADD R4,R1,R1', base);
  assert.equal(on.totalCycles, 6); assert.equal(on.stallCount, 0); assert.equal(on.final.registers[4], 22);
  assert.ok(on.frames[3].events.some((event) => event.startsWith('MEM→EX')));
  const off = simulate('ADD R1,R2,R3\nADD R4,R1,R1', { ...base, forwarding: false });
  assert.equal(off.totalCycles, 8); assert.equal(off.stallCount, 2); assert.deepEqual(off.final, on.final);
});

test('L011 STORE数据MEM使用，紧邻LOAD零停顿，隔一条仍从WB→EX锁存', async () => {
  const { simulate } = await model();
  const immediate = simulate('LOAD R1,[R0]\nSTORE R1,[R0+1]', base);
  assert.equal(immediate.totalCycles, 6); assert.equal(immediate.stallCount, 0); assert.equal(immediate.final.memory[1], 10);
  assert.ok(immediate.frames[4].events.some((event) => event.startsWith('WB→MEM')));
  const gap = simulate('LOAD R1,[R0]\nADD R3,R0,R0\nSTORE R1,[R0+1]', base);
  assert.equal(gap.totalCycles, 7); assert.equal(gap.stallCount, 0); assert.equal(gap.final.memory[1], 10);
  assert.ok(gap.frames[4].events.some((event) => event.startsWith('WB→EX')));
  const off = simulate('LOAD R1,[R0]\nSTORE R1,[R0+1]', { ...base, forwarding: false });
  assert.equal(off.totalCycles, 8); assert.equal(off.stallCount, 2); assert.deepEqual(off.final, immediate.final);
});

test('L011 STORE基址EX使用；数据/基址同源；STORE后LOAD读取更新内存', async () => {
  const { simulate } = await model();
  const address = simulate('LOAD R1,[R0]\nSTORE R2,[R1]', base);
  assert.equal(address.totalCycles, 7); assert.equal(address.stallCount, 1); assert.equal(address.final.memory[10], 9);
  const both = simulate('LOAD R1,[R0]\nSTORE R1,[R1]\nLOAD R5,[R1]', base);
  assert.equal(both.totalCycles, 8); assert.equal(both.stallCount, 1); assert.equal(both.final.memory[10], 10); assert.equal(both.final.registers[5], 10);
  const roundtrip = simulate('LOAD R1,[R0]\nSTORE R1,[R0+1]\nLOAD R2,[R0+1]', base);
  assert.equal(roundtrip.totalCycles, 7); assert.equal(roundtrip.stallCount, 0); assert.equal(roundtrip.final.registers[2], 10);
});

test('L011 同寄存器最新生产者优先，旧WB不能越过新LOAD，STORE同规则', async () => {
  const { simulate } = await model();
  for (const forwarding of [true, false]) {
    const latestLoad = simulate('ADD R1,R2,R3\nLOAD R1,[R0]\nADD R4,R1,R1', { ...base, forwarding });
    assert.equal(latestLoad.final.registers[4], 20); assert.equal(latestLoad.stallCount, forwarding ? 1 : 2); assert.equal(latestLoad.totalCycles, forwarding ? 8 : 9);
    const store = simulate('ADD R1,R2,R3\nLOAD R1,[R0]\nSTORE R1,[R0+1]', { ...base, forwarding });
    assert.equal(store.final.memory[1], 10); assert.equal(store.stallCount, forwarding ? 0 : 2);
  }
  const latestAdd = simulate('ADD R1,R2,R3\nADD R1,R2,R4\nADD R5,R1,R1', base);
  assert.equal(latestAdd.totalCycles, 7); assert.equal(latestAdd.stallCount, 0); assert.equal(latestAdd.final.registers[5], 24);
});

test('L011 R0恒零，无写依赖；寄存器/内存输入不变，单条耗时5周期', async () => {
  const { simulate } = await model(); const input = structuredClone(base); input.registers[0] = 99;
  for (const forwarding of [true, false]) {
    const result = simulate('LOAD R0,[R0]\nADD R1,R0,R0\nSTORE R0,[R0+1]', { ...input, forwarding });
    assert.equal(result.totalCycles, 7); assert.equal(result.stallCount, 0); assert.equal(result.final.registers[0], 0); assert.equal(result.final.registers[1], 0); assert.equal(result.final.memory[1], 0);
  }
  assert.equal(input.registers[0], 99); assert.deepEqual(input.memory, { 0: 10 });
  assert.equal(simulate('LOAD R1,[R0+4]').totalCycles, 5); assert.equal(simulate('LOAD R1,[R0+4]').final.registers[1], 0);
});

test('L011 解析注释/大小写/负偏移，拒非法操作、寄存器、输入界限与溢出', async () => {
  const { simulate, parseProgram, parseMemory } = await model();
  assert.deepEqual(parseMemory('0=10 #值\n255=-3'), { 0: 10, 255: -3 });
  const parsed = parseProgram('#头\nload r1,[r2 - 3] //注释\nadd r3,r0,r1'); assert.equal(parsed[0].line, 2); assert.equal(parsed[0].offset, -3);
  for (const source of ['', '#只有注释', 'SUB R1,R2,R3', 'ADD R8,R1,R2', 'LOAD R1,[R0+1.5]', 'STORE [R0],R1']) assert.throws(() => parseProgram(source));
  assert.throws(() => parseProgram('ADD R1,R0,R0\n'.repeat(41)), /1至40/); assert.throws(() => parseProgram('x'.repeat(10001)), /10000/);
  for (const source of ['256=1', '0=1\n0=2', '1=NaN', '0=9007199254740992']) assert.throws(() => parseMemory(source));
  assert.throws(() => simulate('LOAD R1,[R0-1]'), /地址-1/);
  assert.throws(() => simulate('ADD R1,R2,R3', { registers: [0, 0, Number.MAX_SAFE_INTEGER, 1, 0, 0, 0, 0] }), /安全整数/);
  assert.throws(() => simulate('ADD R1,R2,R3', { registers: [0, 0, null, 1, 0, 0, 0, 0] }), /整数/);
  assert.throws(() => simulate('ADD R1,R0,R0', { memory: null }), /内存初值/);
  assert.throws(() => simulate('ADD R1,R0,R0', { forwarding: 'false' }), /布尔/);
});

test('L011 确定性组合程序与顺序解释器一致，覆盖转发和无转发结果', async () => {
  const { simulate, parseProgram } = await model();
  let seed = 11; const random = (limit) => { seed = (seed * 16807) % 2147483647; return seed % limit; };
  for (let sample = 0; sample < 100; sample += 1) {
    const source = Array.from({ length: 16 }, () => {
      const op = random(3); const a = random(8); const b = random(8); const c = random(8);
      return op === 0 ? `ADD R${a},R${b},R${c}` : op === 1 ? `LOAD R${a},[R0+${c}]` : `STORE R${a},[R0+${c}]`;
    }).join('\n');
    const registers = [...base.registers]; const memory = { ...base.memory };
    for (const row of parseProgram(source)) {
      if (row.op === 'ADD' && row.dest !== 0) registers[row.dest] = registers[row.left] + registers[row.right];
      if (row.op === 'LOAD' && row.dest !== 0) registers[row.dest] = memory[row.offset] ?? 0;
      if (row.op === 'STORE') memory[row.offset] = registers[row.data];
    }
    for (const forwarding of [true, false]) assert.deepEqual(simulate(source, { ...base, forwarding }).final, { registers, memory }, `sample ${sample}, forwarding ${forwarding}`);
  }
});

test('L011 状态schema及64KiB UTF8边界，Markdown含初值/规则/轨迹', async () => {
  const { prepareStoredState, validateStoredState, reportMarkdown, simulate } = await model();
  const overhead = new TextEncoder().encode(JSON.stringify({ payload: '', schemaVersion: 1 })).byteLength;
  const exact = prepareStoredState({ payload: 'a'.repeat(65536 - overhead) }); assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 65536);
  assert.equal(validateStoredState(exact), exact); assert.throws(() => prepareStoredState({ payload: exact.payload + 'a' }), /64KiB/);
  assert.throws(() => validateStoredState({ schemaVersion: 1, payload: '汉'.repeat(22000) }), /64KiB/); assert.throws(() => validateStoredState({ schemaVersion: 2 }), /版本/);
  const report = reportMarkdown(simulate('LOAD R1,[R0]\nADD R2,R1,R3', base));
  assert.match(report, /five-stage-v1/); assert.match(report, /初值/); assert.match(report, /M\[0\]=10/); assert.match(report, /总周期：7/); assert.match(report, /ID\*/); assert.match(report, /load-use/);
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

test('L011 界面示例、开关、周期切换、JSON/Markdown导出和恢复', async (t) => {
  const exported = []; const stored = new Map(); dom(t, { saveTextSupportsCopyOnly: true, saveText: async (payload) => { exported.push(payload); return { ok: true }; } });
  const { default: feature } = await import('../src/renderer/features/L011/index.js');
  const root = new NodeStub('div'); const config = { get: (key) => stored.get(key), set: (key, value) => stored.set(key, value) }; const handle = feature.create(root, { config }); t.after(() => handle.destroy());
  await button(root, 'LOAD→ADD 示例').fire('click'); assert.match(root.textContent, /总周期 7 · 停顿 1 次 · 当前 C1/);
  await button(root, '下一周期').fire('click'); await button(root, '下一周期').fire('click'); assert.match(root.textContent, /当前 C3/); assert.match(root.textContent, /停顿：I2 的 R1 等待 I1/);
  await button(root, '导出完整 JSON').fire('click'); const report = JSON.parse(exported[0].content); assert.equal(report.schemaVersion, 1); assert.equal(report.result.stallCount, 1); assert.equal(exported[0].copyOnly, true);
  await button(root, '导出时序报告 Markdown').fire('click'); assert.equal(exported[1].extension, 'md'); assert.match(exported[1].content, /初值/);
  control(root, '开启转发').checked = false; await control(root, '开启转发').fire('change'); assert.match(root.textContent, /编辑后请重新计算/);
  await button(root, '计算流水线').fire('click'); assert.match(root.textContent, /总周期 8 · 停顿 2 次/);
  await button(root, '独立 ADD 示例').fire('click'); assert.match(root.textContent, /总周期 6 · 停顿 0 次/);
  handle.deactivate(); assert.equal(stored.get('features.L011.state').schemaVersion, 1); assert.equal(Object.hasOwn(stored.get('features.L011.state'), 'frames'), false);
  const nextRoot = new NodeStub('div'); const next = feature.create(nextRoot, { config }); assert.match(nextRoot.textContent, /总周期 6 · 停顿 0 次/); next.destroy(); assert.equal(nextRoot.children.length, 0);
});

test('L011 界面清理播放计时器、安全文本、导出保护、超限状态拒存拒恢复', async (t) => {
  dom(t, { saveText: async () => { throw new Error('must not save'); } });
  const { default: feature } = await import('../src/renderer/features/L011/index.js');
  const originalSet = global.setInterval; const originalClear = global.clearInterval; let callback; let cleared = 0;
  global.setInterval = (fn) => { callback = fn; return 123; }; global.clearInterval = (id) => { assert.equal(id, 123); cleared += 1; }; t.after(() => { global.setInterval = originalSet; global.clearInterval = originalClear; });
  let writes = 0; const root = new NodeStub('div'); const handle = feature.create(root, { config: { get: () => null, set: () => { writes += 1; } } });
  await button(root, 'LOAD→ADD 示例').fire('click'); await button(root, '自动播放').fire('click'); callback(); assert.match(root.textContent, /当前 C2/); handle.deactivate(); assert.equal(cleared, 1); assert.ok(button(root, '自动播放'));
  await button(root, '导出完整 JSON').fire('click'); assert.match(root.textContent, /缺少防覆盖/);
  const input = control(root, '指令序列（最多40条）'); input.value = '<img src=x onerror=alert(1)>'; await input.fire('input'); await button(root, '计算流水线').fire('click'); assert.match(root.textContent, /第1行语法不支持/);
  input.value = '#'.repeat(70000); await input.fire('input'); const count = writes; handle.deactivate(); assert.equal(writes, count); assert.match(root.textContent, /当前输入未写入全局配置/); handle.destroy(); assert.equal(root.children.length, 0);
  for (const saved of [{ schemaVersion: 2 }, { schemaVersion: 1, program: '汉'.repeat(22000) }, { schemaVersion: 1, program: 3 }]) {
    const invalidRoot = new NodeStub('div'); const invalid = feature.create(invalidRoot, { config: { get: () => saved } }); assert.match(invalidRoot.textContent, /未能恢复/); invalid.destroy();
  }
});
