export const MODEL_VERSION = 'read-cache-lru-v1';
export const POLICY = {
  addresses: '地址为32位无符号字节地址；只模拟读取，未命中装入整个块，不涉及写回/直写或脏位。',
  mapping: '块号=floor(地址/块字节数)；组号=块号 mod 组数；标签=floor(块号/组数)；块内偏移=地址 mod 块字节数。',
  replacement: '每次计算均从冷缓存开始；优先填最低编号空路，组满时替换本组最近一次访问最早的路。命中也更新LRU。',
  capacity: '总行数=组数×路数；容量=总行数×块字节数。相同容量比较保持块大小和总行数一致，直接映射组数是两路组相联的两倍。',
  limits: '只统计命中与未命中，无访问耗时、预取、并行访问、多级缓存、相干性或真实硬件性能预测。',
};
function unsigned(value, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^(?:\d+|0x[\da-f]+)$/i.test(value.trim()))) throw new Error(`${label}需要十进制或0x十六进制非负整数。`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) throw new Error(`${label}需在0至4294967295之间。`);
  return number;
}
function power(value, max, label) {
  const number = unsigned(value, label);
  if (number < 1 || number > max || !Number.isInteger(Math.log2(number))) throw new Error(`${label}需为1至${max}之间的2的幂。`);
  return number;
}
export function parseAddresses(source) {
  if (typeof source !== 'string' || source.length > 10000) throw new Error('地址文本需要字符串且不超过10000字符。');
  const stripped = source.split(/\r?\n/).map((line) => line.replace(/(?:#|\/\/).*$/, '')).join('\n').trim();
  const tokens = stripped ? stripped.split(/[\s,，]+/) : [];
  if (!tokens.length || tokens.length > 256) throw new Error('请输入1至256个读取地址。');
  return tokens.map((value, index) => unsigned(value, `第${index + 1}个地址`));
}
export function validateParameters({ blockSize = 4, setCount = 2, ways = 1 } = {}) {
  const block = power(blockSize, 256, '块大小（字节）'); const sets = power(setCount, 64, '组数');
  if (ways !== 1 && ways !== 2) throw new Error('路数只支持直接映射1路或组相联2路。');
  if (sets * ways > 64) throw new Error('缓存总行数不能超过64；两路时组数最多32。');
  return { blockSize: block, setCount: sets, ways, lineCount: sets * ways, capacityBytes: block * sets * ways };
}
const cloneSets = (sets) => sets.map((ways) => ways.map((line) => ({ ...line })));
export function simulate(source, parameters = {}) {
  const addresses = parseAddresses(source); const config = validateParameters(parameters);
  const sets = Array.from({ length: config.setCount }, () => Array.from({ length: config.ways }, () => ({ valid: false, block: null, tag: null, lastAccess: null })));
  let hits = 0; const frames = [];
  for (const [index, address] of addresses.entries()) {
    const step = index + 1; const block = Math.floor(address / config.blockSize); const set = block % config.setCount; const tag = Math.floor(block / config.setCount); const offset = address % config.blockSize;
    const before = cloneSets(sets); const selected = sets[set];
    let way = selected.findIndex((line) => line.valid && line.tag === tag); const hit = way !== -1; let evicted = null; let reason;
    if (hit) { hits += 1; reason = `命中组${set}路${way}标签${tag}；本次访问将此路更新为MRU。`; }
    else {
      way = selected.findIndex((line) => !line.valid);
      if (way !== -1) reason = `未命中；填充组${set}最低编号空路${way}。`;
      else { way = selected.reduce((oldest, line, candidate) => line.lastAccess < selected[oldest].lastAccess ? candidate : oldest, 0); evicted = { ...selected[way], way }; reason = `未命中；组${set}已满，${config.ways === 1 ? '直接映射覆盖唯一的路0' : `LRU替换路${way}（上次访问第${evicted.lastAccess}次）`}，移除块${evicted.block}标签${evicted.tag}。`; }
      selected[way] = { valid: true, block, tag, lastAccess: step };
    }
    selected[way].lastAccess = step;
    frames.push({ step, address, block, set, tag, offset, way, hit, evicted, reason, blockRange: [block * config.blockSize, block * config.blockSize + config.blockSize - 1], before, after: cloneSets(sets), hits, misses: step - hits, hitRate: hits / step });
  }
  return { feature: 'L012', schemaVersion: 1, modelVersion: MODEL_VERSION, policy: POLICY, source, addresses, config, total: addresses.length, hits, misses: addresses.length - hits, hitRate: hits / addresses.length, frames, final: cloneSets(sets) };
}
export function compareSameCapacity(source, parameters) {
  const config = validateParameters(parameters);
  if (config.lineCount < 2) throw new Error('相同容量比较至少需要2行；单行缓存无法构成两路组相联。');
  return { capacityBytes: config.capacityBytes, direct: simulate(source, { blockSize: config.blockSize, setCount: config.lineCount, ways: 1 }), twoWay: simulate(source, { blockSize: config.blockSize, setCount: config.lineCount / 2, ways: 2 }) };
}
export function prepareStoredState(state) {
  const serialized = JSON.stringify({ ...state, schemaVersion: 1 });
  if (new TextEncoder().encode(serialized).byteLength > 65536) throw new Error('输入状态超过64KiB保存上限。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('保存状态版本不支持，需要schemaVersion:1。');
  prepareStoredState(state); return state;
}
export function reportMarkdown(result, comparison = null) {
  const lines = ['# 缓存命中实验', '', `schemaVersion:1；模型：${MODEL_VERSION}`, '', ...Object.values(POLICY), '', `参数：块${result.config.blockSize}字节，${result.config.setCount}组×${result.config.ways}路，容量${result.config.capacityBytes}字节。`, '', `读取次数${result.total}；命中${result.hits}；未命中${result.misses}；命中率${result.hits}/${result.total}（${(result.hitRate * 100).toFixed(2)}%）。`, '', '## 输入地址', '', result.addresses.join(', '), '', '## 逐次访问轨迹', '', '| 次序 | 地址 | 块 | 组 | 标签 | 偏移 | 路 | 命中 | 替换块 | 原因 |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const frame of result.frames) lines.push(`| ${frame.step} | ${frame.address} | ${frame.block} | ${frame.set} | ${frame.tag} | ${frame.offset} | ${frame.way} | ${frame.hit ? 'hit' : 'miss'} | ${frame.evicted?.block ?? '无'} | ${frame.reason} |`);
  lines.push('', '## 每次访问后的缓存状态', '');
  for (const frame of result.frames) { lines.push(`### 第${frame.step}次`, ''); for (const [set, ways] of frame.after.entries()) lines.push(...ways.map((line, way) => `- 组${set}路${way}：${line.valid ? `块${line.block}，标签${line.tag}，上次访问${line.lastAccess}` : '无效/空'}`)); lines.push(''); }
  if (comparison) lines.push('## 相同容量比较', '', `两者容量${comparison.capacityBytes}字节、块大小相同、均从冷缓存开始。`, '', `- 直接映射 ${comparison.direct.config.setCount}组×1路：命中${comparison.direct.hits}/${comparison.direct.total}`, `- 两路LRU ${comparison.twoWay.config.setCount}组×2路：命中${comparison.twoWay.hits}/${comparison.twoWay.total}`);
  return lines.join('\n') + '\n';
}
