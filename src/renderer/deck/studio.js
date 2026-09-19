/**
 * 动效 PPT 工作台。
 *
 * 一个全屏浮层：左边缩略图，右边一页大预览（点一下就走一步，跟放映一样），
 * 顶栏能换主题、进全屏放映、导出带动画的 .pptx。
 *
 * 它不是一个侧栏工具 —— 从哪来回哪去（视频报告卡、科研 PPT演示 都能开），
 * 所以做成挂在 body 上的浮层。
 */
import { h, toast } from '../core/ui.js';
import { normalizeDeck, stepCount, DECK_SYSTEM, buildDeckPrompt } from './model.js';
import { renderSlide } from './components.js';
import { createPlayer, renderThumbnails, STAGE } from './player.js';

const THEME_NAMES = { violet: '紫夜', ink: '墨蓝', dawn: '晨白' };

/**
 * 让 AI 把一份 Markdown 变成 deck。
 *
 * 一份 5000 字的报告排 14 页，实测要两三分钟 —— 这是一次性吐出整份 JSON 的代价，
 * 所以超时给到 6 分钟，并把等待秒数回调出去，不然界面上看着像卡死。
 */
export async function generateDeck(ai, markdown, { title = '', hint = '', onTick } = {}) {
  const started = Date.now();
  const timer = onTick ? setInterval(() => onTick(Math.round((Date.now() - started) / 1000)), 1000) : 0;
  try {
    const raw = await ai.json(buildDeckPrompt(markdown, { title, hint }), { system: DECK_SYSTEM, timeout: 360000 });
    const deck = normalizeDeck(raw);
    if (!deck.slides.length) throw new Error('AI 没有产出任何页面。');
    return deck;
  } finally {
    clearInterval(timer);
  }
}

/** 报告内容的指纹，用来缓存已经排过版的 deck */
export function deckKey(markdown) {
  const text = String(markdown || '');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `deck.cache.${text.length}-${hash.toString(36)}`;
}

export function openDeckStudio(deck, { onRegenerate } = {}) {
  let current = normalizeDeck(deck);
  let index = 0;
  let step = 0;

  const stage = h('div', { class: 'deck-studio__stage' });
  const stageWrap = h('div', {
    class: 'deck-studio__stage-wrap',
    onclick: () => { step < stepCount(current.slides[index]) ? (step += 1) : nextSlide(); paintSteps(); },
  }, stage);
  const thumbs = h('div', { class: 'deck-studio__thumbs' });
  const meta = h('div', { class: 'deck-studio__meta' });
  const themeSelect = h('select', { class: 'field field--sm', onchange: () => { current.theme = themeSelect.value; paint(); } },
    ...Object.entries(THEME_NAMES).map(([id, name]) => h('option', { value: id }, name)));

  function nextSlide() {
    if (index < current.slides.length - 1) { index += 1; step = 0; paint(); }
  }

  function paintSteps() {
    for (const el of stage.querySelectorAll('.deck-anim')) {
      el.classList.toggle('is-in', Number(el.dataset.step) <= step);
    }
    const total = stepCount(current.slides[index]);
    meta.replaceChildren(
      h('span', {}, `第 ${index + 1} / ${current.slides.length} 页`),
      h('span', { class: 'faint' }, total ? `步骤 ${step} / ${total} · 点画面继续` : '这一页没有分步'),
      current.slides[index].narration ? h('span', { class: 'deck-studio__narration' }, `口播：${current.slides[index].narration}`) : null,
    );
  }

  function fit() {
    const box = stageWrap.getBoundingClientRect();
    if (!box.width) return;
    const scale = Math.min((box.width - 24) / STAGE.width, (box.height - 24) / STAGE.height);
    stage.style.transform = `scale(${scale})`;
    stage.style.width = `${STAGE.width}px`;
    stage.style.height = `${STAGE.height}px`;
  }

  function paint() {
    const node = renderSlide(current.slides[index], { index, total: current.slides.length });
    node.dataset.theme = current.theme;
    stage.replaceChildren(node);
    thumbs.replaceChildren(renderThumbnails(current, { active: index, onPick: (i) => { index = i; step = 0; paint(); } }));
    paintSteps();
    fit();
  }

  async function exportPptx() {
    const result = await window.toolbox.deck.exportPptx(current);
    if (result?.canceled) return;
    if (!result?.ok) return toast(result?.error || '导出失败', 'bad', 6000);
    toast(`已导出 ${result.slides} 页，其中 ${result.animatedSlides} 页带动画`, 'good', 5000);
  }

  function play() {
    const player = createPlayer(current, { onClose: () => paint() });
    player.mount(document.body);
  }

  const el = h('div', { class: 'deck-studio' },
    h('div', { class: 'deck-studio__bar' },
      h('strong', {}, current.title),
      h('span', { class: 'faint' }, `${current.slides.length} 页`),
      h('span', { style: { flex: 1 } }),
      h('span', { class: 'faint' }, '主题'),
      themeSelect,
      onRegenerate ? h('button', { class: 'btn btn--sm btn--ghost', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = '重新生成中…';
        try {
          const next = await onRegenerate();
          if (next) { current = normalizeDeck(next); index = 0; step = 0; paint(); }
        } catch (err) { toast(`重新生成失败：${err.message}`, 'bad', 6000); }
        finally { btn.disabled = false; btn.textContent = '重新生成'; }
      } }, '重新生成') : null,
      h('button', { class: 'btn btn--sm btn--primary', onclick: play }, '▶ 放映'),
      h('button', { class: 'btn btn--sm', onclick: exportPptx }, '导出 PPTX'),
      h('button', { class: 'btn btn--sm btn--ghost', onclick: () => close() }, '关闭'),
    ),
    h('div', { class: 'deck-studio__body' },
      h('aside', { class: 'deck-studio__side' }, thumbs),
      h('div', { class: 'deck-studio__main' }, stageWrap, meta),
    ),
  );

  const onKey = (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); stageWrap.click(); }
    if (event.key === 'ArrowLeft') { step > 0 ? (step -= 1) : (index > 0 && (index -= 1, step = stepCount(current.slides[index]), paint())); paintSteps(); }
  };
  const resize = new ResizeObserver(fit);

  function close() {
    resize.disconnect();
    document.removeEventListener('keydown', onKey);
    el.remove();
  }

  themeSelect.value = current.theme;
  // 挂到 window 上：Voicebox 配音、自动导出这些后续联动要拿到当前 deck
  const handle = { close, deck: () => current, goto: (i) => { index = i; step = 0; paint(); }, play };
  window.__deckStudio = handle;
  document.body.append(el);
  resize.observe(stageWrap);
  document.addEventListener('keydown', onKey);
  paint();
  return handle;
}
