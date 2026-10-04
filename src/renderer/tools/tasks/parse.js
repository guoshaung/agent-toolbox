/**
 * 任务页的纯函数：脑子倒出来的一段文字怎么拆、现在该做哪个、连续几天有完成、哪些重复 / 放太久。
 * 不碰 DOM，方便测。
 */

export const BUCKETS = [
  { id: 'today', label: '今天', hint: '现在手上的事' },
  { id: 'week', label: '这周', hint: '几天内要碰的' },
  { id: 'later', label: '以后', hint: '先放着，别忘了' },
];
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2 };

/** 一句话里的时间 / 轻重 / 主题词，都抠出来 */
export function parseLine(raw) {
  let text = String(raw || '').replace(/^\s*(?:[-*•·]|\d+[.、)]|\[[ x]?\])\s*/, '').trim();
  if (!text) return null;
  let bucket = 'week'; let priority = 'normal'; let tag = ''; let due = '';
  const today = new Date();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const tagMatch = text.match(/#([^\s#]{1,20})/);
  if (tagMatch) { tag = tagMatch[1]; text = text.replace(tagMatch[0], '').trim(); }
  if (/紧急|马上|立刻|ASAP|今天必须|deadline/i.test(text)) priority = 'urgent';
  else if (/重要|尽快|优先|关键/.test(text)) priority = 'high';
  if (/今天|今晚|现在|马上|立刻/.test(text)) { bucket = 'today'; due = iso(today); }
  else if (/明天/.test(text)) { bucket = 'week'; due = iso(new Date(today.getTime() + 86400000)); }
  else if (/后天/.test(text)) { bucket = 'week'; due = iso(new Date(today.getTime() + 2 * 86400000)); }
  else if (/这周|本周|周[一二三四五六日天]|礼拜/.test(text)) bucket = 'week';
  else if (/以后|有空|哪天|将来|下个月|下周|改天|想想/.test(text)) bucket = 'later';
  else if (priority === 'urgent') bucket = 'today';
  text = text.replace(/[（(]?\s*(紧急|重要|尽快|优先)\s*[)）]?[:：]?/g, (m) => (text.trim().length - m.length > 3 ? '' : m)).replace(/\s{2,}/g, ' ').trim();
  return { title: text.slice(0, 160), bucket, priority, tag, due };
}

/** 整段文字 → 任务列表。按行、按分号 / 句号 / 顿号拆；太短的碎片丢掉 */
export function splitDump(text) {
  const pieces = String(text || '').replace(/\r/g, '').split(/\n|[;；]|(?<=[。！!])\s*/).map((s) => s.trim()).filter((s) => s.length >= 2);
  const seen = new Set();
  const out = [];
  for (const p of pieces) {
    const parsed = parseLine(p);
    if (!parsed || parsed.title.length < 2) continue;
    const key = normalizeTitle(parsed.title);
    if (seen.has(key)) continue;
    seen.add(key); out.push(parsed);
  }
  return out;
}

export function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/[\s，,。.！!？?、:：;；\-—_()（）\[\]【】]/g, '');
}

/** 现在该做哪个：今天里没做完的，紧急 > 重要 > 普通，同级按顺序 */
export function pickFocus(tasks) {
  const pool = (tasks || []).filter((t) => !t.done && (t.bucket || 'today') === 'today');
  if (!pool.length) return null;
  return [...pool].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2))[0];
}

/** 连续多少天有完成任务（今天没完成就从昨天起算） */
export function streakOf(tasks, now = Date.now()) {
  const days = new Set((tasks || []).filter((t) => t.done && t.completedAt).map((t) => dayKey(t.completedAt)));
  let streak = 0;
  let cursor = now;
  if (!days.has(dayKey(cursor))) cursor -= 86400000;
  while (days.has(dayKey(cursor))) { streak += 1; cursor -= 86400000; }
  return streak;
}
function dayKey(ms) { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

/** 标题一样（去掉标点空格后）的没做完任务，成组返回 */
export function findDuplicates(tasks) {
  const groups = new Map();
  for (const t of (tasks || []).filter((x) => !x.done)) {
    const key = normalizeTitle(t.title);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** 放了太久还没做的（默认 14 天），不在「以后」里的 */
export function staleTasks(tasks, { days = 14, now = Date.now() } = {}) {
  return (tasks || []).filter((t) => !t.done && (t.bucket || 'today') !== 'later' && now - (t.createdAt || now) > days * 86400000);
}

/** 模型返回的 JSON 里可能裹着 ``` 或多余的话，尽量抠出数组 */
export function parseAiTasks(text) {
  const raw = String(text || '');
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return (Array.isArray(arr) ? arr : []).map((x) => ({
      title: String(x.title || x.task || '').trim().slice(0, 160),
      bucket: BUCKETS.some((b) => b.id === x.bucket) ? x.bucket : 'week',
      priority: ['urgent', 'high', 'normal'].includes(x.priority) ? x.priority : 'normal',
      tag: String(x.tag || x.topic || '').trim().slice(0, 20),
      due: /^\d{4}-\d{2}-\d{2}$/.test(String(x.due || '')) ? x.due : '',
    })).filter((x) => x.title.length >= 2);
  } catch { return []; }
}
