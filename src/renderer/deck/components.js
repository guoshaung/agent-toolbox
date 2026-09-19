/**
 * 幻灯片组件库。
 *
 * 这里没有「生图」——每个块都是 DOM + CSS 拼出来的：流程链是一串带箭头的方块，
 * 对比栏是两个圆角面板，数字卡是大字 + 说明。要图的时候才去素材库拿（image 块）。
 *
 * 每个元素身上带 data-step 和 data-anim，播放器按步给它加 .is-in，动画由 CSS 负责。
 */
import { h } from '../core/ui.js';

/** 包一层动画壳：记下这块是第几步、用什么动画 */
function animated(node, { step, anim }) {
  node.classList.add('deck-anim');
  node.dataset.step = String(step);
  node.dataset.anim = anim;
  return node;
}

function renderBullets(block) {
  const items = block.items.length ? block.items : [''];
  return h('ul', { class: 'deck-bullets' }, ...items.map((text, i) => animated(
    h('li', { class: 'deck-bullets__item' },
      h('span', { class: 'deck-bullets__dot' }),
      h('span', { class: 'deck-bullets__text' }, text),
    ),
    // stagger：第一条在本块的 step，之后每条往后顺延一步
    { step: block.step + (block.stagger ? i : 0), anim: block.anim },
  )));
}

function renderFlow(block) {
  const steps = block.steps.length ? block.steps : [{ label: '', desc: '' }];
  return h('div', { class: 'deck-flow' }, ...steps.flatMap((step, i) => {
    const node = animated(
      h('div', { class: 'deck-flow__node' },
        h('span', { class: 'deck-flow__n' }, String(i + 1)),
        h('strong', { class: 'deck-flow__label' }, step.label),
        step.desc ? h('span', { class: 'deck-flow__desc' }, step.desc) : null,
      ),
      { step: block.step + i, anim: block.anim },
    );
    // 箭头跟着后一个节点一起出现
    const arrow = i < steps.length - 1
      ? animated(h('span', { class: 'deck-flow__arrow' }, '→'), { step: block.step + i + 1, anim: 'fade' })
      : null;
    return arrow ? [node, arrow] : [node];
  }));
}

function renderCompare(block) {
  const columns = block.columns.length ? block.columns : [{ head: '', items: [] }];
  return h('div', { class: 'deck-compare' }, ...columns.map((column, i) => animated(
    h('div', { class: `deck-compare__col is-${column.tone}` },
      h('div', { class: 'deck-compare__head' }, column.head),
      h('ul', {}, ...column.items.map((item) => h('li', {}, item))),
    ),
    // 两栏对撞：左边从左来、右边从右来
    { step: block.step + i, anim: columns.length === 2 ? (i === 0 ? 'slide-left' : 'slide-right') : block.anim },
  )));
}

function renderStats(block) {
  const items = block.items.length ? block.items : [{ value: '', label: '' }];
  return h('div', { class: 'deck-stats' }, ...items.map((item, i) => animated(
    h('div', { class: 'deck-stats__card' },
      h('strong', { class: 'deck-stats__value' }, item.value),
      h('span', { class: 'deck-stats__label' }, item.label),
      item.hint ? h('span', { class: 'deck-stats__hint' }, item.hint) : null,
    ),
    { step: block.step + i, anim: block.anim },
  )));
}

const renderQuote = (block) => animated(
  h('blockquote', { class: 'deck-quote' },
    h('span', { class: 'deck-quote__mark' }, '❝'),
    h('p', {}, block.text),
    block.source ? h('cite', {}, block.source) : null,
  ), block);

const renderCode = (block) => animated(
  h('pre', { class: 'deck-code' }, h('code', { class: block.lang ? `lang-${block.lang}` : '' }, block.code)), block);

const renderImage = (block) => animated(
  h('figure', { class: 'deck-image' },
    block.src ? h('img', { src: block.src, alt: block.alt || block.caption || '' })
      : h('div', { class: 'deck-image__empty' }, '（这一页还没有配图）'),
    block.caption ? h('figcaption', {}, block.caption) : null,
  ), block);

const renderText = (block) => animated(h('p', { class: 'deck-text' }, block.text), block);

const RENDERERS = {
  bullets: renderBullets, flow: renderFlow, compare: renderCompare, stats: renderStats,
  quote: renderQuote, code: renderCode, image: renderImage, text: renderText,
};

export function renderBlock(block) {
  return (RENDERERS[block.type] || renderText)(block);
}

/**
 * 渲染一整页。返回的节点里所有 .deck-anim 都还没进场，交给播放器逐步点亮。
 */
export function renderSlide(slide, { index = 0, total = 1 } = {}) {
  const head = slide.layout === 'cover' || slide.layout === 'closing'
    ? h('div', { class: 'deck-slide__head deck-slide__head--center' },
        slide.kicker ? animated(h('span', { class: 'deck-slide__kicker' }, slide.kicker), { step: 0, anim: 'fade' }) : null,
        animated(h('h1', { class: 'deck-slide__title' }, slide.title), { step: 0, anim: slide.titleAnim }),
        slide.subtitle ? animated(h('p', { class: 'deck-slide__subtitle' }, slide.subtitle), { step: 0, anim: 'fade' }) : null,
      )
    : h('div', { class: 'deck-slide__head' },
        slide.kicker ? animated(h('span', { class: 'deck-slide__kicker' }, slide.kicker), { step: 0, anim: 'fade' }) : null,
        animated(h('h2', { class: 'deck-slide__title' }, slide.title), { step: 0, anim: slide.titleAnim }),
        slide.subtitle ? animated(h('p', { class: 'deck-slide__subtitle' }, slide.subtitle), { step: 0, anim: 'fade' }) : null,
      );

  return h('section', { class: `deck-slide deck-slide--${slide.layout}`, dataset: { index: String(index) } },
    h('div', { class: 'deck-slide__inner' },
      head,
      h('div', { class: 'deck-slide__body' }, ...slide.blocks.map(renderBlock)),
    ),
    h('span', { class: 'deck-slide__page' }, `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`),
  );
}
