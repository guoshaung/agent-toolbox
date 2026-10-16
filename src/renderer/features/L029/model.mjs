export const MODEL_VERSION = 'L029-virtual-monotone-v1';
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const MODES = ['demo', 'random', 'custom'];
export function countValue(value) {
  if (typeof value === 'string' && !/^\d{1,3}$/.test(value)) throw new Error('提交数须2–256整数');
  const count = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(count) || count < 2 || count > 256) throw new Error('提交数须2–256整数'); return count;
}
export function firstBadValue(value, count) {
  count = countValue(count);
  if (typeof value === 'string' && !/^\d{1,3}$/.test(value)) throw new Error('首坏须2至提交数整数，保证首端good与末端bad');
  const first = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(first) || first < 2 || first > count) throw new Error('首坏须2至提交数整数，保证首端good与末端bad'); return first;
}
export function randomFirstBad(count, fill = array => globalThis.crypto.getRandomValues(array)) {
  count = countValue(count); if (typeof fill !== 'function') throw new Error('缺少crypto随机能力');
  const choices = count - 1, ceiling = Math.floor(4294967296 / choices) * choices;
  for (let attempt = 0; attempt < 64; attempt++) { const array = new Uint32Array(1); fill(array); if (array[0] < ceiling) return 2 + array[0] % choices; }
  throw new Error('crypto随机取样未在64次内成功，未开局；请重试');
}
export function createGame({ count, firstBad, mode = 'custom' }) {
  count = countValue(count); firstBad = firstBadValue(firstBad, count); if (!MODES.includes(mode)) throw new Error('未知教学模式');
  if (mode === 'demo' && (count !== 16 || firstBad !== 9)) throw new Error('固定演示必须16提交/首坏9');
  let good = 1, bad = count; const known = new Map([[1, 'good'], [count, 'bad']]), trace = [];
  const optimalWorstCase = Math.ceil(Math.log2(count - 1));
  function view() {
    const completed = bad - good === 1;
    return { modelVersion: MODEL_VERSION, mode, count, completed, endpoints: [{ commit: 1, status: 'good' }, { commit: count, status: 'bad' }], interval: { good, bad, candidatesFrom: good + 1, candidatesTo: bad, size: bad - good }, suggestion: completed ? null : Math.floor((good + bad) / 2), checks: trace.length, optimalWorstCase, remainingWorstCase: Math.ceil(Math.log2(bad - good)), followedSuggestions: trace.filter(step => step.wasSuggested).length, known: [...known].sort(([a], [b]) => a - b).map(([commit, status]) => ({ commit, status })), trace: clone(trace), ...(completed ? { firstBad: bad, excessOverOptimalWorstCase: Math.max(0, trace.length - optimalWorstCase) } : {}), scope: '单调虚拟序列，1已知good、末端已知bad。检查次数不含两个已知端点；理论界是最坏情况下识别首坏的额外检查下界，不是每个答案的必需次数。' };
  }
  function test(commit) {
    if (!Number.isInteger(commit)) throw new Error('选择须整数提交编号');
    if (known.has(commit)) throw new Error('此提交已测试或是已知端点，不计新检查');
    if (bad - good === 1) throw new Error('已锁定首坏，请开始新局；不增加检查');
    if (commit <= good || commit >= bad) throw new Error('只允许严格区间 good < 提交 < bad 内未测提交');
    const before = { good, bad }, suggestion = Math.floor((good + bad) / 2), status = commit < firstBad ? 'good' : 'bad';
    known.set(commit, status); if (status === 'good') good = commit; else bad = commit;
    trace.push({ step: trace.length + 1, commit, status, before, after: { good, bad }, suggested: suggestion, wasSuggested: commit === suggestion, remainingCandidates: bad - good });
    return view();
  }
  return Object.freeze({ view, test });
}
export function prepareStoredState(settings) {
  if (bytes(settings) > 65536) throw new Error('设置超过64KiB UTF-8，不写配置');
  if (typeof settings?.count !== 'string' || settings.count.length > 4 || !MODES.includes(settings.mode)) throw new Error('设置字段类型/模式无效');
  // Never persist a game, custom answer, RNG data or test choice.
  return { schemaVersion: 1, count: settings.count, mode: settings.mode };
}
export function validateStoredState(raw) { if (bytes(raw) > 65536) throw new Error('设置超过64KiB UTF-8'); if (raw?.schemaVersion !== 1) throw new Error('设置版本不支持'); return prepareStoredState(raw); }
export function reportMarkdown(payload) {
  const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const round = payload.round;
  const mode = round?.mode ?? payload.settings.mode;
  const description = mode === 'demo' ? '固定演示预先说明16提交首坏9，不是未知答案挑战。' : mode === 'custom' ? '自定义作者知道答案，未定位报告不含输入答案。' : '随机局仅本地教学，答案在JS内存，不提供隐藏安全。';
  return ['# L029 二分回归定位演练', `仅单调虚拟历史，不操作真实Git。${description}`, '## 设置', escape(JSON.stringify(payload.settings)), round ? `## ${round.completed ? '已完成' : '进行中，仅导出已知结果'}` : '尚未开局', round ? `提交数${round.count}；额外检查${round.checks}；初始最优最坏界${round.optimalWorstCase}；当前候选[${round.interval.candidatesFrom},${round.interval.candidatesTo}]` : '', round?.completed ? `首坏提交：${round.firstBad}` : '未揭晓首坏，不导出隐藏答案', '## 完整公开记录', `\`\`\`json\n${escape(JSON.stringify(round, null, 2))}\n\`\`\``, '局不保存到配置，重开需新局；保留已知/结束轨迹请导出副本。'].join('\n\n');
}
