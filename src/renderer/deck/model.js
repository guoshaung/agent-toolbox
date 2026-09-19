/**
 * 动效 PPT 的数据模型。
 *
 * 一份 deck = 若干 slide；一页 slide = 布局骨架 + 若干内容块（block）。
 * 每个块自带进场动画和「第几步出现」——播放器按步推进，导出 pptx 时这两项
 * 翻译成 PowerPoint 的 p:timing（见 src/main/pptx-anim.js）。
 *
 * 模型故意做得窄：只有 7 种块、7 种动画。窄才好让 AI 稳定产出，也才好让
 * 同一份数据在 HTML 播放器和 .pptx 里长得一样。
 */

/** 进场动画。none = 跟着页面一起出现，不单独占一步。 */
export const ANIMS = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom'];

/** 页面骨架：决定块怎么摆 */
export const LAYOUTS = ['cover', 'bullets', 'flow', 'compare', 'stats', 'quote', 'image', 'closing'];

export const BLOCK_TYPES = ['text', 'bullets', 'flow', 'compare', 'stats', 'quote', 'code', 'image'];

const MAX_SLIDES = 40;
const str = (v, max = 400) => String(v ?? '').trim().slice(0, max);
const list = (v, max, fn) => (Array.isArray(v) ? v : []).slice(0, max).map(fn).filter(Boolean);

function anim(value, fallback = 'fade') {
  const v = str(value, 20);
  return ANIMS.includes(v) ? v : fallback;
}

/** data:image 或 file:// 之外一律丢掉 —— 页面里不加载远程图 */
function safeImage(value) {
  const v = String(value || '');
  return /^data:image\/(?:png|jpe?g|webp|svg\+xml);/.test(v) || v.startsWith('file://') ? v : '';
}

export function normalizeBlock(raw = {}, index = 0) {
  const type = BLOCK_TYPES.includes(str(raw.type, 20)) ? str(raw.type, 20) : 'text';
  const base = {
    type,
    anim: anim(raw.anim),
    // step 省略时按顺序一块一步；显式写 0 表示跟标题一起出来
    step: Number.isFinite(Number(raw.step)) ? Math.max(0, Math.min(20, Math.round(Number(raw.step)))) : index + 1,
  };
  switch (type) {
    case 'bullets':
      return {
        ...base,
        items: list(raw.items, 8, (i) => str(i, 220)),
        // 逐条出现：播放器里一条一步，pptx 里用段落级动画
        stagger: raw.stagger !== false,
      };
    case 'flow':
      return {
        ...base,
        steps: list(raw.steps, 6, (s) => {
          const label = str(s?.label ?? s, 40);
          return label ? { label, desc: str(s?.desc, 90) } : null;
        }),
      };
    case 'compare':
      return {
        ...base,
        columns: list(raw.columns, 3, (c) => {
          const head = str(c?.head, 60);
          return head ? { head, tone: str(c?.tone, 12) || 'neutral', items: list(c?.items, 6, (i) => str(i, 160)) } : null;
        }),
      };
    case 'stats':
      return {
        ...base,
        items: list(raw.items, 4, (s) => {
          const value = str(s?.value, 24);
          return value ? { value, label: str(s?.label, 60), hint: str(s?.hint, 60) } : null;
        }),
      };
    case 'quote':
      return { ...base, text: str(raw.text, 400), source: str(raw.source, 120) };
    case 'code':
      return { ...base, code: str(raw.code, 1600), lang: str(raw.lang, 20) };
    case 'image':
      return { ...base, src: safeImage(raw.src), caption: str(raw.caption, 160), alt: str(raw.alt, 120) };
    default:
      return { ...base, text: str(raw.text ?? raw.body, 600) };
  }
}

/** 这个块自己要占几步（多元素的块是一个一个出来的） */
export function blockSpan(block) {
  if (block.step === 0) return 0;                       // 跟标题一起出现，不占步
  switch (block.type) {
    case 'bullets': return block.stagger ? Math.max(1, block.items.length) : 1;
    case 'flow': return Math.max(1, block.steps.length);
    case 'compare': return Math.max(1, block.columns.length);
    case 'stats': return Math.max(1, block.items.length);
    default: return 1;
  }
}

export function normalizeSlide(raw = {}, index = 0) {
  const layout = LAYOUTS.includes(str(raw.layout, 20)) ? str(raw.layout, 20) : 'bullets';
  const blocks = list(raw.blocks, 6, (b, i) => normalizeBlock(b, i));
  // AI 给的 step 经常撞车（比如一个两栏对比标了 step 1，下一块也标 step 2，
  // 结果第二栏和下一块同时冒出来）。这里按块顺序重排，让每一步只发生一件事。
  let cursor = 1;
  for (const block of blocks) {
    if (block.step === 0) continue;
    block.step = cursor;
    cursor += blockSpan(block);
  }
  return {
    layout,
    title: str(raw.title, 90) || `第 ${index + 1} 页`,
    subtitle: str(raw.subtitle, 140),
    kicker: str(raw.kicker, 40),
    titleAnim: anim(raw.titleAnim, layout === 'cover' ? 'zoom' : 'slide-right'),
    blocks: blocks.length ? blocks : [normalizeBlock({ type: 'text', text: '' }, 0)],
    narration: str(raw.narration, 400),
    notes: str(raw.notes, 1200),
  };
}

export function normalizeDeck(raw = {}) {
  const slides = list(raw.slides, MAX_SLIDES, (s, i) => normalizeSlide(s, i));
  return {
    title: str(raw.title, 120) || '演示文稿',
    subtitle: str(raw.subtitle, 160),
    theme: ['ink', 'violet', 'dawn'].includes(str(raw.theme, 12)) ? str(raw.theme, 12) : 'violet',
    source: str(raw.source, 300),
    slides: slides.length ? slides : [normalizeSlide({ layout: 'cover', title: raw.title }, 0)],
  };
}

/** 这一页一共要点几下（step 0 的块跟页面一起出现，不算） */
export function stepCount(slide) {
  let max = 0;
  for (const block of slide.blocks || []) {
    if (block.step === 0) continue;
    max = Math.max(max, block.step + blockSpan(block) - 1);
  }
  return max;
}

/** 给 AI 的 schema 说明。放在这里，播放器和视频工具共用一份。 */
export const DECK_SYSTEM = `你是演示设计师。把用户给的文档改写成一份「会动」的演示文稿，只输出 JSON，不要解释、不要代码围栏。

JSON 结构：
{
  "title": "整份演示的标题",
  "subtitle": "一句话说明",
  "slides": [ { "layout": "...", "kicker": "小标签", "title": "页标题", "subtitle": "页副标题(可省)", "titleAnim": "...", "blocks": [...], "narration": "这一页的口播稿", "notes": "演讲者备注" } ]
}

layout 从这些里选，按内容挑最合适的：
- cover  封面，只放标题和副标题，全篇第一页用
- bullets 标题 + 要点列，最常用
- flow   讲「先…再…然后…」的顺序或流程
- compare 讲两三方的对比、优缺点、之前之后
- stats  有具体数字、指标、规模时用
- quote  一句关键结论或原文引用
- image  这一页主体是一张图
- closing 收尾页

blocks 里每个块：
- {"type":"bullets","items":["...","..."],"stagger":true}  要点，stagger=true 表示一条条出现
- {"type":"flow","steps":[{"label":"步骤名","desc":"一句话"}]}  3–5 步
- {"type":"compare","columns":[{"head":"栏标题","tone":"good|bad|neutral","items":["..."]}]}  2–3 栏
- {"type":"stats","items":[{"value":"1.3万","label":"播放量","hint":"可省"}]}  2–4 个
- {"type":"quote","text":"...","source":"出处(可省)"}
- {"type":"code","code":"...","lang":"python"}
- {"type":"text","text":"一段话"}

每个块必须带 "anim"，从这些里选：none / fade / slide-left / slide-right / slide-up / slide-down / zoom。
选动画的规则：**服务内容，不要为动而动。**
- 并列的要点用 slide-left 或 fade
- 有先后顺序的流程用 slide-left（跟着阅读方向走）
- 对比的两栏一个 slide-left 一个 slide-right，形成对撞
- 数字、结论、强调用 zoom
- 背景性的、补充说明的文字用 fade 或 none
- 一页里不要超过两种动画，否则很乱

"narration" 是这一页的口播稿，30–60 字，口语，像在讲给人听，不要念要点原文。
"notes" 是给讲者看的提醒，可以写重点和易错点。

页数控制在 8–15 页。第一页必须是 cover，最后一页用 closing。
目前还没有接图库，所以**不要用 image 这个 layout，也不要输出 image 块** —— 需要"一张图"的地方，
改用 flow / compare / stats 把它拆成能用文字和方块讲清楚的结构。`;

/** 把报告 Markdown 包成给 AI 的请求 */
export function buildDeckPrompt(markdown, { title = '', hint = '' } = {}) {
  return `把下面这份文档做成演示文稿。${title ? `标题参考：${title}。` : ''}${hint ? `\n额外要求：${hint}` : ''}

文档：
${String(markdown || '').slice(0, 60000)}`;
}
