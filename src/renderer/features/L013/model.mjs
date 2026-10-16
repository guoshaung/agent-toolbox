export const MODEL_VERSION = '1.0';
export const UINT32_MAX = 4294967295;
export const MAX_PAGES = 64;
export const MAX_ACCESSES = 128;
export const TLB_SIZE = 4;
export const PAGE_SIZES = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
export const POLICY = '4项全相联TLB，LRU替换；数组从最旧到最新。有效地址的TLB命中（含权限拒绝）更新LRU；仅成功的页表翻译填入TLB。未映射、缺页、权限拒绝均不填入。每轮从冷TLB开始；输入编辑清空旧轨迹。';

export function integer(value, label) {
  if (!['string', 'number'].includes(typeof value)) throw new Error(`${label}须为整数文本或数值。`);
  const text = String(value).trim();
  if (!/^(?:-?\d+|0[xX][0-9a-fA-F]+)$/.test(text)) throw new Error(`${label}须为十进制整数或0x十六进制整数。`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new Error(`${label}超出安全整数范围。`);
  return number;
}
function pageSizeOf(value) {
  const number = integer(value, '页大小');
  if (!PAGE_SIZES.includes(number)) throw new Error('页大小须在256至65536的给定2的幂中选择。');
  return number;
}
export function validateInput(draft) {
  if (!draft || typeof draft !== 'object') throw new Error('输入对象无效。');
  const pageSize = pageSizeOf(draft.pageSize); const maxPage = Math.floor(UINT32_MAX / pageSize);
  if (!Array.isArray(draft.pages) || draft.pages.length > MAX_PAGES) throw new Error(`页表最多${MAX_PAGES}行。`);
  if (!Array.isArray(draft.accesses) || draft.accesses.length > MAX_ACCESSES) throw new Error(`访问最多${MAX_ACCESSES}行。`);
  const seen = new Set();
  const pages = draft.pages.map((row, index) => {
    if (!row || ['present', 'read', 'write'].some((key) => typeof row[key] !== 'boolean')) throw new Error(`页表${index + 1}的驻留及权限须为布尔值。`);
    const virtualPage = integer(row.virtualPage, `页表${index + 1}虚页`); const physicalPage = integer(row.physicalPage, `页表${index + 1}物理页`);
    if ([virtualPage, physicalPage].some((page) => page < 0 || page > maxPage)) throw new Error(`页号须在0至${maxPage}，保证物理地址属于32位无符号域。`);
    if (seen.has(virtualPage)) throw new Error(`虚页${virtualPage}重复映射。`); seen.add(virtualPage);
    return { virtualPage, physicalPage, present: row.present, read: row.read, write: row.write };
  });
  const accesses = draft.accesses.map((row, index) => {
    if (!row || !['read', 'write'].includes(row.mode)) throw new Error(`访问${index + 1}须选择read或write。`);
    return { address: integer(row.address, `访问${index + 1}地址`), mode: row.mode };
  });
  return { pageSize, pages, accesses };
}
const cloneTLB = (tlb) => tlb.map((entry) => ({ ...entry }));
export function translate(draft) {
  const input = validateInput(draft); const mappings = new Map(input.pages.map((row) => [row.virtualPage, row]));
  const tlb = []; const stats = { lookups: 0, hits: 0, misses: 0, translated: 0, faults: 0 }; const trace = [];
  for (const [index, access] of input.accesses.entries()) {
    const before = cloneTLB(tlb); const frame = { step: index + 1, ...access, virtualPage: null, offset: null, physicalAddress: null, status: '', lookup: '未查询', action: '不改变TLB', evicted: null, path: [], before, after: [] };
    if (access.address < 0 || access.address > UINT32_MAX) {
      frame.status = 'address-out-of-range'; frame.path.push('地址越界：32位无符号地址须在0至4294967295；未查询TLB或页表。');
    } else {
      frame.virtualPage = Math.floor(access.address / input.pageSize); frame.offset = access.address % input.pageSize;
      frame.path.push(`拆分：${access.address} = ${frame.virtualPage} × ${input.pageSize} + ${frame.offset}`);
      stats.lookups++;
      const hitIndex = tlb.findIndex((entry) => entry.virtualPage === frame.virtualPage); let mapping;
      if (hitIndex >= 0) {
        stats.hits++; frame.lookup = '命中'; mapping = tlb.splice(hitIndex, 1)[0]; tlb.push(mapping); frame.action = '命中并更新LRU';
        frame.path.push('TLB命中；继续检查缓存的读写权限。');
      } else { stats.misses++; frame.lookup = '未命中'; mapping = mappings.get(frame.virtualPage); frame.path.push('TLB未命中，查询单级页表。'); }
      if (!mapping) { frame.status = 'unmapped'; frame.path.push('未映射：页表中没有该虚页，无法得到物理页。'); }
      else if (!mapping.present) { frame.status = 'page-fault'; frame.path.push('缺页：页表存在，但present=false，不在内存；本模型不执行调页。'); }
      else if (!mapping[access.mode]) { frame.status = 'permission-fault'; frame.path.push(`${access.mode === 'read' ? '读' : '写'}权限错误：禁止本次访问，不生成物理地址。`); }
      else {
        frame.status = 'translated'; frame.physicalAddress = mapping.physicalPage * input.pageSize + frame.offset;
        frame.path.push(`翻译：物理地址 = ${mapping.physicalPage} × ${input.pageSize} + ${frame.offset} = ${frame.physicalAddress}`);
        if (hitIndex < 0) {
          if (tlb.length === TLB_SIZE) { frame.evicted = { ...tlb.shift() }; frame.action = `替换最旧虚页${frame.evicted.virtualPage}并填入`; }
          else frame.action = '填入TLB';
          tlb.push({ ...mapping });
        }
      }
    }
    stats[frame.status === 'translated' ? 'translated' : 'faults']++;
    frame.after = cloneTLB(tlb); trace.push(frame);
  }
  return { modelVersion: MODEL_VERSION, input, policy: POLICY, stats: { ...stats, hitRate: stats.lookups ? stats.hits / stats.lookups : null }, trace, finalTLB: cloneTLB(tlb) };
}
export const STATUS_LABELS = { translated: '成功翻译', unmapped: '未映射', 'page-fault': '不驻留缺页', 'permission-fault': '权限错误', 'address-out-of-range': '地址越界' };
export function example(kind = 'core') {
  const page = (virtualPage, physicalPage, extra = {}) => ({ virtualPage: String(virtualPage), physicalPage: String(physicalPage), present: true, read: true, write: true, ...extra });
  const access = (address, mode = 'read') => ({ address: String(address), mode });
  if (kind === 'faults') return { pageSize: '4096', pages: [page(2, 5, { write: false }), page(3, 6, { present: false })], accesses: [access(8199), access(8199, 'write'), access(12288), access(16384), access(-1), access(4294967296)] };
  if (kind === 'lru') return { pageSize: '4096', pages: [0, 1, 2, 3, 4].map((n) => page(n, n + 5)), accesses: [0, 1, 2, 3, 0, 4].map((n) => access(n * 4096)) };
  return { pageSize: '4096', pages: [page(2, 5)], accesses: [access(8199), access(8200)] };
}
export function prepareStoredState(draft) {
  const state = { schemaVersion: 1, pageSize: draft.pageSize, pages: draft.pages, accesses: draft.accesses };
  const serialized = JSON.stringify(state);
  if (new TextEncoder().encode(serialized).byteLength > 65536) throw new Error('草稿超过64KiB。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('草稿版本不支持。');
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 65536) throw new Error('草稿超过64KiB。');
  prepareStoredState(state);
  if (typeof state.pageSize !== 'string' || !PAGE_SIZES.includes(Number(state.pageSize)) || !Array.isArray(state.pages) || state.pages.length > MAX_PAGES || !Array.isArray(state.accesses) || state.accesses.length > MAX_ACCESSES) throw new Error('草稿参数或容量无效。');
  if (!state.pages.every((row) => row && typeof row.virtualPage === 'string' && typeof row.physicalPage === 'string' && ['present', 'read', 'write'].every((key) => typeof row[key] === 'boolean')) || !state.accesses.every((row) => row && typeof row.address === 'string' && ['read', 'write'].includes(row.mode))) throw new Error('草稿字段类型无效。');
  return prepareStoredState(state);
}
export function reportMarkdown(payload) {
  const lines = ['# L013 页表地址翻译', '', '教学模型：单级页表、32位无符号字节地址；不模拟操作系统或执行程序。', '', POLICY, '', '## 当前输入草稿', '', `页大小：${payload.draft.pageSize}字节`, '', '|虚页|物理页|驻留|读|写|', '|---|---|---|---|---|'];
  const safe = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[|\r\n]/g, ' ');
  payload.draft.pages.forEach((row) => lines.push(`|${safe(row.virtualPage)}|${safe(row.physicalPage)}|${row.present}|${row.read}|${row.write}|`));
  lines.push('', '|访问|地址|操作|', '|---|---|---|'); payload.draft.accesses.forEach((row, i) => lines.push(`|${i + 1}|${safe(row.address)}|${safe(row.mode)}|`));
  if (!payload.result) { lines.push('', '尚未运行当前输入；无翻译结果。'); return lines.join('\n'); }
  const result = payload.result;
  lines.push('', '## 结果', '', `成功${result.stats.translated}，异常${result.stats.faults}；有效地址查询${result.stats.lookups}，命中${result.stats.hits}，未命中${result.stats.misses}。命中率${result.stats.hitRate === null ? '无查询，未生成' : `${(result.stats.hitRate * 100).toFixed(2)}%`}。越界地址不计TLB查询分母。`);
  for (const frame of result.trace) lines.push('', `### 第${frame.step}次：${frame.address} ${frame.mode}`, '', `状态：${STATUS_LABELS[frame.status]}；物理地址：${frame.physicalAddress ?? '无'}；${frame.lookup}；${frame.action}。`, '', ...frame.path, '', `TLB之前（最旧→最新）：${JSON.stringify(frame.before)}`, '', `TLB之后（最旧→最新）：${JSON.stringify(frame.after)}`);
  return lines.join('\n');
}
