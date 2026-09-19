/**
 * 动效 PPT 播放器。
 *
 * 舞台固定 1280×720，整体 transform: scale 去适配容器 —— 这样一页里的字号、
 * 间距在任何窗口大小下都是同一套，跟导出的 .pptx 能对上。
 *
 * 推进方式和 PowerPoint 一样：一次点击 / 空格推进一步，步走完才翻页。
 */
import { h } from '../core/ui.js';
import { renderSlide } from './components.js';
import { stepCount } from './model.js';

export const STAGE = { width: 1280, height: 720 };

export function createPlayer(deck, { onClose, onNarrate } = {}) {
  const slides = deck.slides;
  let index = 0;
  let step = 0;
  let notesOn = false;

  const stage = h('div', { class: 'deck-stage' });
  const stageWrap = h('div', { class: 'deck-stage-wrap', onclick: (e) => { if (!e.target.closest('button')) next(); } }, stage);
  const progress = h('div', { class: 'deck-progress' });
  const counter = h('span', { class: 'deck-bar__counter' });
  const narrationBar = h('div', { class: 'deck-narration' });
  const notesPane = h('div', { class: 'deck-notes', hidden: true });

  function paint() {
    const slide = slides[index];
    const node = renderSlide(slide, { index, total: slides.length });
    node.dataset.theme = deck.theme;
    stage.replaceChildren(node);
    applySteps();
    counter.textContent = `${index + 1} / ${slides.length}`;
    progress.style.setProperty('--p', `${((index + 1) / slides.length) * 100}%`);
    narrationBar.textContent = slide.narration || '';
    narrationBar.hidden = !slide.narration;
    notesPane.textContent = slide.notes || '（这一页没有备注）';
    onNarrate?.(slide, index);
  }

  /** 把 step 之前（含）的块点亮，之后的留着 */
  function applySteps() {
    for (const el of stage.querySelectorAll('.deck-anim')) {
      el.classList.toggle('is-in', Number(el.dataset.step) <= step);
    }
  }

  function next() {
    const total = stepCount(slides[index]);
    if (step < total) { step += 1; applySteps(); return; }
    if (index < slides.length - 1) { index += 1; step = 0; paint(); }
  }

  function prev() {
    if (step > 0) { step -= 1; applySteps(); return; }
    if (index > 0) { index -= 1; step = stepCount(slides[index]); paint(); }
  }

  function go(target) {
    index = Math.max(0, Math.min(slides.length - 1, target));
    step = 0;
    paint();
  }

  /** 一次把这一页全部点亮，跳过逐步 */
  function revealAll() { step = stepCount(slides[index]); applySteps(); }

  function fit() {
    const box = stageWrap.getBoundingClientRect();
    if (!box.width) return;
    const scale = Math.min(box.width / STAGE.width, box.height / STAGE.height);
    stage.style.transform = `scale(${scale})`;
    stage.style.width = `${STAGE.width}px`;
    stage.style.height = `${STAGE.height}px`;
  }

  const onKey = (event) => {
    const keys = { ArrowRight: next, ArrowDown: next, PageDown: next, ' ': next, Enter: next,
      ArrowLeft: prev, ArrowUp: prev, PageUp: prev };
    if (event.key === 'Escape') return close();
    if (event.key === 'n' || event.key === 'N') { notesOn = !notesOn; notesPane.hidden = !notesOn; return; }
    if (event.key === 'a' || event.key === 'A') return revealAll();
    if (event.key === 'Home') return go(0);
    if (event.key === 'End') return go(slides.length - 1);
    const fn = keys[event.key];
    if (!fn) return;
    event.preventDefault();
    fn();
  };

  const el = h('div', { class: 'deck-player' },
    h('div', { class: 'deck-bar' },
      h('strong', { class: 'deck-bar__title' }, deck.title),
      h('span', { style: { flex: 1 } }),
      counter,
      h('button', { class: 'btn btn--sm btn--ghost', title: '上一步（←）', onclick: prev }, '上一步'),
      h('button', { class: 'btn btn--sm btn--ghost', title: '下一步（空格）', onclick: next }, '下一步'),
      h('button', { class: 'btn btn--sm btn--ghost', title: '这一页全部显示（A）', onclick: revealAll }, '全显'),
      h('button', { class: 'btn btn--sm btn--ghost', title: '演讲者备注（N）', onclick: () => { notesOn = !notesOn; notesPane.hidden = !notesOn; } }, '备注'),
      h('button', { class: 'btn btn--sm', onclick: () => close() }, '退出'),
    ),
    stageWrap,
    narrationBar,
    notesPane,
    progress,
  );

  const resize = new ResizeObserver(fit);
  function mount(parent) {
    parent.append(el);
    resize.observe(stageWrap);
    document.addEventListener('keydown', onKey);
    paint();
    requestAnimationFrame(fit);
  }
  function close() {
    resize.disconnect();
    document.removeEventListener('keydown', onKey);
    el.remove();
    onClose?.();
  }

  return { el, mount, close, next, prev, go, revealAll, current: () => ({ index, step }) };
}

/** 缩略图：编辑器侧边栏用，点一下跳页 */
export function renderThumbnails(deck, { active = 0, onPick } = {}) {
  return h('div', { class: 'deck-thumbs' }, ...deck.slides.map((slide, i) => {
    const mini = renderSlide(slide, { index: i, total: deck.slides.length });
    for (const el of mini.querySelectorAll('.deck-anim')) el.classList.add('is-in');   // 缩略图里全部显示
    mini.dataset.theme = deck.theme;
    return h('button', {
      class: `deck-thumb${i === active ? ' is-active' : ''}`,
      onclick: () => onPick?.(i),
      title: slide.title,
    },
      h('span', { class: 'deck-thumb__n' }, String(i + 1)),
      h('span', { class: 'deck-thumb__frame' }, mini),
      h('span', { class: 'deck-thumb__name' }, slide.title),
    );
  }));
}
