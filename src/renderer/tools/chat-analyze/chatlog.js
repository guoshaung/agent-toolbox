/**
 * 聊天记录解析 + 提示词，纯函数，方便测。
 * 支持两种来源：微信「导出聊天记录」的文本、以及截图 OCR 出来的文本。
 * 分析类别对齐 WechatVibe：逐条情绪 + 意图、人物画像（六维互动 / MBTI / 好感度）、群聊整体。
 * 这里不碰微信数据库，只处理你给的文本。
 */

export const DIMENSIONS = [
  { key: 'expressive', label: '表达活力' },
  { key: 'humor', label: '幽默表达' },
  { key: 'calm', label: '情绪平和' },
  { key: 'initiative', label: '话题主动' },
  { key: 'support', label: '关怀支持' },
  { key: 'closeness', label: '亲近表达' },
];
export const MBTI_AXES = [['E', 'I'], ['S', 'N'], ['T', 'F'], ['J', 'P']];

// 微信导出常见前缀：昵称 + 时间戳一行，正文另起；或「昵称  时间」同一行
const TS = /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?\s*\d{1,2}:\d{2}(?::\d{2})?/;
const SYS = /^(以下是|—+|-{2,}|你已添加了|你撤回了|.*撤回了一条消息$|\[.*\]$)/;

/**
 * 把一段文本拆成消息 [{speaker, text, at}]。尽量兼容几种导出格式；拆不干净的整段当一条。
 */
export function parseChatLog(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const msgs = [];
  let cur = null;
  const push = () => { if (cur && cur.text.trim()) msgs.push({ speaker: cur.speaker, text: cur.text.trim(), at: cur.at || '' }); cur = null; };
  for (const line of lines) {
    const t = line.trimEnd();
    if (!t.trim()) { if (cur) cur.text += '\n'; continue; }
    // 系统行（[图片] / 撤回 / 分隔线）自成一行时直接丢，并结束当前这条，别粘到正文里
    if (SYS.test(t.trim())) { push(); continue; }
    // 「昵称 2026-01-02 12:00:00」这种一行头
    const head = t.match(new RegExp(`^(.{1,32}?)\\s+(${TS.source})\\s*$`));
    if (head) { push(); cur = { speaker: head[1].trim(), at: head[2], text: '' }; continue; }
    // 「昵称:内容」或「昵称：内容」（OCR 常见）
    const colon = t.match(/^([^:：\n]{1,24})[:：]\s*(.+)$/);
    if (colon && !TS.test(colon[1])) { push(); cur = { speaker: colon[1].trim(), at: '', text: colon[2] }; continue; }
    if (cur) cur.text += (cur.text ? '\n' : '') + t;
    else cur = { speaker: '', at: '', text: t };
  }
  push();
  return msgs.filter((m) => !SYS.test(m.text) && m.text.length <= 4000);
}

/** 说话人集合；两人以内算单聊，更多算群聊 */
export function speakersOf(msgs) {
  return [...new Set(msgs.map((m) => m.speaker).filter(Boolean))];
}
export function isGroup(msgs) { return speakersOf(msgs).length > 2; }

/** 「我」是谁：出现次数里带「我」字样的，或用户指定；拿不准返回空 */
export function guessMe(msgs, hint = '') {
  const names = speakersOf(msgs);
  if (hint && names.includes(hint)) return hint;
  return names.find((n) => /^(我|自己|me)$/i.test(n)) || '';
}

/** 逐条分析的提示词：只给情绪 + 意图两个短标签，和 WechatVibe 的 API 模式一致 */
export function messagePrompt(msgs, { me = '' } = {}) {
  const lines = msgs.map((m, i) => `${i + 1}. ${m.speaker || '?'}${m.speaker === me ? '(我)' : ''}: ${m.text.replace(/\n/g, ' ').slice(0, 200)}`).join('\n');
  return `你是聊天情感分析助手。下面是一段聊天记录，逐条判断每条消息的情绪和交流意图，只给简短中文标签。
情绪从这些里选最贴切的一个：开心、期待、平静、委屈、生气、疲惫、焦虑、无奈、暧昧、敷衍。
意图从这些里选最贴切的一个：分享、邀约、试探、求安慰、关心、承诺、协商、抱怨、敷衍、婉拒、闲聊。
"我"发的消息也要分析。证据不足就填 "不确定"。
只输出 JSON 数组，每条一个对象，顺序和编号一致，不要多余的话：
[{"i":1,"emotion":"开心","intent":"分享"}]

聊天记录：
${lines}`;
}

/** 人物画像的提示词：六维（0-100）+ MBTI 四轴 + 好感度 + 摘要 + 常聊话题 */
export function personaPrompt(msgs, name, { me = '' } = {}) {
  const theirs = msgs.filter((m) => m.speaker === name).map((m) => m.text.replace(/\n/g, ' ').slice(0, 200));
  const context = msgs.slice(-80).map((m) => `${m.speaker || '?'}: ${m.text.replace(/\n/g, ' ').slice(0, 120)}`).join('\n');
  return `你是聊天人物画像助手。基于下面的聊天记录，给「${name}」做一份画像。${me ? `聊天里的「我」是「${me}」，好感度指 ${name} 对「我」的。` : ''}
六维互动风格每项打 0-100 的整数：表达活力、幽默表达、情绪平和、话题主动、关怀支持、亲近表达。
MBTI 给四个轴各自的倾向字母和 0-100 的把握度：E/I、S/N、T/F、J/P；证据不足的轴 letter 填 "?"。
好感度给 0-100 的整数和一句依据。
再给一段两三句的画像摘要，和 3-6 个常聊话题。证据不足的地方保守，别编。
只输出 JSON，不要多余的话：
{"dims":{"expressive":60,"humor":40,"calm":55,"initiative":50,"support":45,"closeness":50},"mbti":[{"axis":"EI","letter":"I","score":70},{"axis":"SN","letter":"N","score":55},{"axis":"TF","letter":"F","score":65},{"axis":"JP","letter":"P","score":60}],"affinity":62,"affinityReason":"…","summary":"…","topics":["…"]}

${name} 说过的话（共 ${theirs.length} 条）：
${theirs.slice(0, 120).join('\n')}

最近的上下文：
${context}`;
}

/** 群聊整体：氛围 + 六维 + 常见话题 + 摘要 */
export function groupPrompt(msgs) {
  const context = msgs.slice(-120).map((m) => `${m.speaker || '?'}: ${m.text.replace(/\n/g, ' ').slice(0, 100)}`).join('\n');
  return `你是群聊氛围分析助手。基于下面的群聊记录，给整个群做一份画像。
六维互动风格每项 0-100 整数：表达活力、幽默表达、情绪平和、话题主动、关怀支持、亲近表达（针对全群平均）。
再给整体氛围一句话、3-6 个常见话题、一段两三句的群摘要。
只输出 JSON：{"mood":"…","dims":{"expressive":50,"humor":50,"calm":50,"initiative":50,"support":50,"closeness":50},"topics":["…"],"summary":"…"}

群聊记录（${speakersOf(msgs).length} 人）：
${context}`;
}

/** 从模型回复里抠 JSON（可能裹着 ``` 或多余的话） */
export function extractJson(text, fallback) {
  const raw = String(text || '');
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
  const body = m[1];
  const start = body.search(/[[{]/);
  if (start < 0) return fallback;
  const open = body[start]; const close = open === '[' ? ']' : '}';
  let depth = 0; let end = -1; let inStr = false; let esc = false;
  for (let i = start; i < body.length; i += 1) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return fallback;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return fallback; }
}

/** 逐条结果对齐到消息（按 i 编号；缺的留空） */
export function alignMessages(msgs, parsed) {
  const byIndex = new Map((Array.isArray(parsed) ? parsed : []).map((x) => [Number(x.i), x]));
  return msgs.map((m, k) => { const r = byIndex.get(k + 1) || {}; return { ...m, emotion: r.emotion || '', intent: r.intent || '' }; });
}

/** 增量：只挑出还没分析过的消息（按 speaker+text 去重） */
export function newMessages(all, analyzedKeys) {
  const seen = new Set(analyzedKeys || []);
  return all.filter((m) => !seen.has(msgKey(m)));
}
export function msgKey(m) { return `${m.speaker}\u0001${m.text}`; }
