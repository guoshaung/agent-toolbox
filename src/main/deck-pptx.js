'use strict';

/**
 * deck 模型 → 带动画的 .pptx。
 *
 * 坐标直接沿用播放器那套 1280×720 的像素：PPT 的 LAYOUT_WIDE 正好是
 * 13.333in × 7.5in，而 13.333in × 96dpi = 1280px —— 两边 1:1 对得上，
 * 所以 HTML 里怎么摆，导出来就怎么摆。
 *
 * 每加一个元素就往 plan 里记一条 {anim, step}，顺序和 pptxgenjs 写进
 * slideN.xml 的顺序一致；导出后 pptx-anim.js 按这个顺序把动画接上去。
 */

const fs = require('node:fs');
const path = require('node:path');
const PptxGenJS = require('pptxgenjs');
const { applyAnimations } = require('./pptx-anim');

const W = 1280;
const H = 720;
const PAD_X = 76;
const PAD_TOP = 62;
const PAD_BOTTOM = 56;
const CONTENT_W = W - PAD_X * 2;

const inch = (px) => px / 96;                    // 1280px = 13.333in
const pt = (px) => Math.round(px * 0.75 * 10) / 10;   // 96px = 72pt

/** 主题：跟 deck.css 里那三套对上 */
const THEMES = {
  violet: { bg: '191233', ink: 'F2EEFF', dim: 'B6AED8', faint: '7D76A8', brand: 'A98BFF', brand2: 'FF7BD0', panel: '241C46', edge: '3A2F66' },
  ink: { bg: '0E1320', ink: 'E8EEF8', dim: 'A8B6CE', faint: '6E7C93', brand: '7FD3FF', brand2: '6EE7B7', panel: '1A2234', edge: '2C3648' },
  dawn: { bg: 'F6F3FF', ink: '241D38', dim: '5B5280', faint: '918AAD', brand: '7C4DFF', brand2: 'E0568F', panel: 'FFFFFF', edge: 'DCD4F5' },
};

const FONT = 'PingFang SC';
const MONO = 'Menlo';

function theme(deck) { return THEMES[deck.theme] || THEMES.violet; }

/** 加元素 + 记动画。所有布局函数都走这里，顺序才不会错。 */
function pusher(slide, plan) {
  return {
    text(content, options, animation) {
      slide.addText(content, options);
      plan.push({ anim: animation?.anim || 'none', step: animation?.step ?? 0 });
    },
    image(options, animation) {
      slide.addImage(options);
      plan.push({ anim: animation?.anim || 'none', step: animation?.step ?? 0 });
    },
  };
}

/** 卡片底 + 文字一个元素搞定，这样底和字一起动 */
function card(add, { x, y, w, h, fill, line, radius = 0.12 }, runs, options, animation) {
  add.text(runs, {
    x: inch(x), y: inch(y), w: inch(w), h: inch(h),
    shape: 'roundRect', rectRadius: radius,
    fill: fill ? { color: fill } : undefined,
    line: line ? { color: line, width: 1 } : { color: 'FFFFFF', width: 0, transparency: 100 },
    fontFace: FONT, margin: 14, valign: 'top',
    ...options,
  }, animation);
}

/** 画标题区，返回正文可以从哪个 y 开始 */
function head(add, slide, t, centered) {
  const align = centered ? 'center' : 'left';
  let y = centered ? 250 : PAD_TOP;

  if (slide.kicker) {
    add.text(slide.kicker, {
      x: inch(PAD_X), y: inch(y), w: inch(CONTENT_W), h: inch(30),
      fontFace: FONT, fontSize: pt(15), bold: true, color: t.brand, align, margin: 0, valign: 'middle',
    }, { anim: 'fade', step: 0 });
    y += 40;
  }

  const titleSize = centered ? 68 : 46;
  add.text(slide.title, {
    x: inch(PAD_X), y: inch(y), w: inch(CONTENT_W), h: inch(titleSize * 1.35),
    fontFace: FONT, fontSize: pt(titleSize), bold: true, color: t.ink, align, margin: 0, valign: 'middle',
    fit: 'shrink',
  }, { anim: 'none', step: 0 });
  y += titleSize * 1.35 + 8;

  if (slide.subtitle) {
    const size = centered ? 25 : 21;
    add.text(slide.subtitle, {
      x: inch(PAD_X), y: inch(y), w: inch(CONTENT_W), h: inch(size * 2.2),
      fontFace: FONT, fontSize: pt(size), color: t.dim, align, margin: 0, valign: 'top',
    }, { anim: 'fade', step: 0 });
    y += size * 2.2;
  }
  return y + 34;
}

// ---------- 各类内容块 ----------

function drawBullets(add, block, t, box) {
  const items = block.items.length ? block.items : [''];
  const gap = 12;
  const lineH = Math.min(78, Math.max(44, (box.h - gap * (items.length - 1)) / items.length));
  items.forEach((text, i) => {
    const y = box.y + i * (lineH + gap);
    add.text([{ text: '●  ', options: { color: t.brand, fontSize: pt(16) } }, { text, options: {} }], {
      x: inch(PAD_X), y: inch(y), w: inch(CONTENT_W), h: inch(lineH),
      fontFace: FONT, fontSize: pt(25), color: t.ink, margin: 0, valign: 'middle', fit: 'shrink',
    }, { anim: block.anim, step: block.step + (block.stagger ? i : 0) });
  });
}

function drawFlow(add, block, t, box) {
  const steps = block.steps.length ? block.steps : [{ label: '', desc: '' }];
  const gap = 18;
  const w = (CONTENT_W - gap * (steps.length - 1)) / steps.length;
  const h = Math.min(210, box.h);
  steps.forEach((step, i) => {
    const runs = [
      { text: `${i + 1}`, options: { fontSize: pt(20), bold: true, color: t.brand, breakLine: true } },
      { text: step.label, options: { fontSize: pt(23), bold: true, color: t.ink, breakLine: true } },
    ];
    if (step.desc) runs.push({ text: step.desc, options: { fontSize: pt(17), color: t.dim } });
    card(add, { x: PAD_X + i * (w + gap), y: box.y, w, h, fill: t.panel, line: t.edge },
      runs, { valign: 'top', lineSpacingMultiple: 1.15 },
      { anim: block.anim, step: block.step + i });
  });
}

function drawCompare(add, block, t, box) {
  const columns = block.columns.length ? block.columns : [{ head: '', items: [] }];
  const gap = 22;
  const w = (CONTENT_W - gap * (columns.length - 1)) / columns.length;
  const tones = { good: '2F6B52', bad: '6B2F3E', neutral: t.panel };
  columns.forEach((column, i) => {
    const runs = [{ text: column.head, options: { fontSize: pt(26), bold: true, color: t.ink, breakLine: true } }];
    for (const item of column.items) {
      runs.push({ text: `• ${item}`, options: { fontSize: pt(20), color: t.dim, breakLine: true } });
    }
    const anim = columns.length === 2 ? (i === 0 ? 'slide-left' : 'slide-right') : block.anim;
    card(add, { x: PAD_X + i * (w + gap), y: box.y, w, h: Math.min(380, box.h), fill: tones[column.tone] || t.panel, line: t.edge },
      runs, { valign: 'top', lineSpacingMultiple: 1.3 }, { anim, step: block.step + i });
  });
}

function drawStats(add, block, t, box) {
  const items = block.items.length ? block.items : [{ value: '', label: '' }];
  const gap = 20;
  const w = (CONTENT_W - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const runs = [{ text: item.value, options: { fontSize: pt(58), bold: true, color: t.brand, breakLine: true } },
      { text: item.label, options: { fontSize: pt(20), color: t.ink, breakLine: true } }];
    if (item.hint) runs.push({ text: item.hint, options: { fontSize: pt(15), color: t.faint } });
    card(add, { x: PAD_X + i * (w + gap), y: box.y + 20, w, h: 230, fill: t.panel, line: t.edge },
      runs, { align: 'center', valign: 'middle', lineSpacingMultiple: 1.2 },
      { anim: block.anim, step: block.step + i });
  });
}

function drawQuote(add, block, t, box) {
  const runs = [{ text: block.text, options: { fontSize: pt(28), color: t.ink, breakLine: true } }];
  if (block.source) runs.push({ text: `— ${block.source}`, options: { fontSize: pt(17), color: t.faint } });
  card(add, { x: PAD_X, y: box.y, w: CONTENT_W, h: Math.min(260, box.h), fill: t.panel, line: t.brand },
    runs, { valign: 'middle', margin: 26, lineSpacingMultiple: 1.35 }, block);
}

function drawCode(add, block, t, box) {
  card(add, { x: PAD_X, y: box.y, w: CONTENT_W, h: Math.min(380, box.h), fill: '0B0913', line: t.edge, radius: 0.06 },
    block.code, { fontFace: MONO, fontSize: pt(18), color: t.ink, valign: 'top', margin: 20 }, block);
}

function drawImage(add, block, t, box) {
  if (!block.src) return;
  const h = Math.min(380, box.h - (block.caption ? 40 : 0));
  add.image({ data: block.src.startsWith('data:') ? block.src : undefined,
    path: block.src.startsWith('data:') ? undefined : block.src.replace('file://', ''),
    x: inch(PAD_X), y: inch(box.y), w: inch(CONTENT_W), h: inch(h), sizing: { type: 'contain', w: inch(CONTENT_W), h: inch(h) } },
  block);
  if (block.caption) {
    add.text(block.caption, {
      x: inch(PAD_X), y: inch(box.y + h + 8), w: inch(CONTENT_W), h: inch(30),
      fontFace: FONT, fontSize: pt(17), color: t.dim, align: 'center', margin: 0,
    }, { anim: 'fade', step: block.step });
  }
}

function drawText(add, block, t, box) {
  add.text(block.text, {
    x: inch(PAD_X), y: inch(box.y), w: inch(CONTENT_W), h: inch(Math.min(300, box.h)),
    fontFace: FONT, fontSize: pt(24), color: t.dim, margin: 0, valign: 'top',
    lineSpacingMultiple: 1.5, fit: 'shrink',
  }, block);
}

const DRAW = { bullets: drawBullets, flow: drawFlow, compare: drawCompare, stats: drawStats,
  quote: drawQuote, code: drawCode, image: drawImage, text: drawText };

/**
 * @param {string} filePath
 * @param {object} deck 已经 normalize 过的 deck（结构见 src/renderer/deck/model.js）
 */
async function exportDeck(filePath, deck) {
  const target = path.resolve(String(filePath || ''));
  if (!target || target === path.parse(target).root) throw new Error('PPTX 保存路径无效。');
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const t = theme(deck);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Agent Toolbox';
  pptx.company = 'Agent Toolbox';
  pptx.title = deck.title;
  pptx.lang = 'zh-CN';

  const plans = [];
  const slides = Array.isArray(deck.slides) ? deck.slides : [];

  slides.forEach((item, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: t.bg };
    const plan = [];
    const add = pusher(slide, plan);
    const centered = item.layout === 'cover' || item.layout === 'closing';
    const bodyY = head(add, item, t, centered);
    const box = { y: bodyY, h: Math.max(80, H - PAD_BOTTOM - bodyY) };

    if (!centered) {
      for (const block of item.blocks || []) (DRAW[block.type] || drawText)(add, block, t, box);
    }

    // 页码：静态，不占动画步骤
    add.text(`${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`, {
      x: inch(W - PAD_X - 160), y: inch(H - 46), w: inch(160), h: inch(24),
      fontFace: MONO, fontSize: pt(14), color: t.faint, align: 'right', margin: 0,
    });

    if (item.notes || item.narration) {
      slide.addNotes([item.narration && `口播：${item.narration}`, item.notes].filter(Boolean).join('\n\n'));
    }
    plans.push(plan);
  });

  await pptx.writeFile({ fileName: target });
  const animated = await applyAnimations(target, plans);
  return {
    ok: true, path: target, slides: slides.length,
    animatedSlides: animated.animatedSlides,
    size: fs.statSync(target).size,
  };
}

module.exports = { exportDeck, inch, pt, THEMES };
