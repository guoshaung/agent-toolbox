import { h } from './ui.js';
import { iconFor } from './icons.js';
import { explainWebview } from './page-explain.js';

/**
 * 顶栏的「今日大模型」这类外链，以前一律甩去系统浏览器；现在直接在工具箱里开一层
 * 内嵌 webview 面板。做成盖满窗口的一层覆盖层，自带一条工具条（关 / 前后退 / 刷新 /
 * 地址 / 丢去系统浏览器）。同一个 URL 复用同一个 webview，登录态和滚动位置都留着，
 * 再点开是秒开而不是重新加载。
 *
 * 加载慢是内嵌网页的通病，所以套一层和「视频·学习区」一样的「少女祈祷中」加载动画，
 * 别让人对着白屏干等。macOS 上这层盖住了原生红绿灯按钮，工具条左侧留出一条可拖动的
 * 安全区，按钮不再和关闭/全屏重叠。
 */

// 和 video 学习区同一只「祈祷少女」，换掉渐变 id 避免同页 id 撞车
const PRAYER_SVG = `<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="webpanel-loading-hair" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#89b9ff"/><stop offset="1" stop-color="#b88cff"/></linearGradient>
    <linearGradient id="webpanel-loading-dress" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6c8bea"/><stop offset="1" stop-color="#9867d8"/></linearGradient>
  </defs>
  <circle cx="80" cy="80" r="66" fill="#758bdc" fill-opacity=".12"/>
  <path d="M31 53C42 18 119 12 131 55c-8-7-16-10-25-11 8 13 9 29 4 43-7-20-19-30-35-34-8 17-21 28-38 34-4-11-5-22-6-34Z" fill="url(#webpanel-loading-hair)"/>
  <path d="M48 57c0-17 14-30 32-30s32 13 32 30v24c0 20-14 32-32 32S48 101 48 81V57Z" fill="#ffe7dc" stroke="#6b568f" stroke-width="3"/>
  <path d="M52 59c8-20 18-28 29-29 18 0 28 12 30 31-10-9-19-13-30-14-7 9-16 15-29 19Z" fill="url(#webpanel-loading-hair)"/>
  <path d="M64 76c3-4 8-4 11 0M85 76c3-4 8-4 11 0" fill="none" stroke="#463d65" stroke-width="3" stroke-linecap="round"/>
  <path d="M75 91c4 3 8 3 12 0" fill="none" stroke="#c46f91" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M47 122c9-13 20-19 33-19s24 6 33 19l12 25H35l12-25Z" fill="url(#webpanel-loading-dress)" stroke="#5d568f" stroke-width="3"/>
  <path d="M68 109 80 124 92 109" fill="none" stroke="#efe9ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M67 124c-7-5-15-12-20-19-3-4-8-3-10 1-2 5 3 11 9 16 6 6 13 10 20 12M93 124c7-5 15-12 20-19 3-4 8-3 10 1 2 5-3 11-9 16-6 6-13 10-20 12" fill="none" stroke="#ffe7dc" stroke-width="8" stroke-linecap="round"/>
  <path d="M80 119v25" stroke="#f9d8a9" stroke-width="4" stroke-linecap="round"/>
  <path d="m22 45 4 8 8 4-8 4-4 8-4-8-8-4 8-4 4-8ZM133 72l3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z" fill="#f7d58c"/>
</svg>`;

let panel = null;
let frame = null;
let titleEl = null;
let addressEl = null;
let loader = null;
let loaderNote = null;
let loaderTimer = null;
let currentView = null;
let currentUrl = '';
const views = new Map(); // url -> webview

function showLoader(note = '正在加载网页…') {
  if (!loader) return;
  loaderNote.textContent = note;
  loader.removeAttribute('hidden');
  clearTimeout(loaderTimer);
  // 兜底：再慢也别一直转，15 秒后收起，页面加载到哪算哪
  loaderTimer = setTimeout(() => hideLoader(), 15000);
}
function hideLoader() {
  clearTimeout(loaderTimer);
  loaderTimer = null;
  loader?.setAttribute('hidden', '');
}

function ensurePanel() {
  if (panel) return;
  const close = h('button', { class: 'btn btn--icon', title: '关闭（Esc）', 'aria-label': '关闭', onclick: hideWebPanel }, iconFor('close'));
  const back = h('button', { class: 'btn btn--icon', title: '后退', onclick: () => currentView?.canGoBack?.() && currentView.goBack() }, iconFor('arrowLeft'));
  const fwd = h('button', { class: 'btn btn--icon', title: '前进', onclick: () => currentView?.canGoForward?.() && currentView.goForward() }, iconFor('arrowRight'));
  const reload = h('button', { class: 'btn btn--icon', title: '刷新', onclick: () => currentView?.reload?.() }, iconFor('refresh'));
  const ext = h('button', {
    class: 'btn btn--sm btn--ghost', title: '用系统浏览器打开',
    onclick: () => { const u = currentView?.getURL?.() || currentUrl; if (u) window.toolbox.shell.openExternal(u); },
  }, iconFor('external'), ' 浏览器');
  const explain = h('button', { class: 'btn btn--sm btn--primary', title: '一键讲这页：干了什么 / 创新点 / 差别（先选中一段就只讲那段）', onclick: () => { if (currentView) explainWebview(currentView); } }, '⚡ 讲这篇');
  titleEl = h('strong', { class: 'webpanel__title' }, '');
  addressEl = h('input', { class: 'field mono webpanel__addr', readonly: true, title: '当前地址' });
  // macOS 上工具条左侧留一条可拖动安全区，避开原生红绿灯按钮
  const macGap = h('span', { class: 'webpanel__macgap', 'aria-hidden': 'true' });
  frame = h('div', { class: 'webpanel__frame' });
  loaderNote = h('span', { class: 'webpanel__loading-note' }, '正在加载网页…');
  loader = h('div', { class: 'webpanel__loading', role: 'status', 'aria-live': 'polite', hidden: true },
    h('div', { class: 'webpanel__loading-character', 'aria-hidden': 'true', html: PRAYER_SVG }),
    h('strong', {}, '少女祈祷中'),
    loaderNote,
  );
  frame.append(loader);
  panel = h('div', { class: 'webpanel', hidden: true },
    h('div', { class: 'bar webpanel__bar' }, macGap, close, back, fwd, reload, explain, titleEl, addressEl, ext),
    frame,
  );
  if (window.toolbox?.platform === 'darwin') panel.classList.add('is-mac');
  document.body.appendChild(panel);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) hideWebPanel(); });
}

/** 打开一个内嵌网页面板。partition 独立，站点登录态互不影响。 */
export function openWebPanel({ url, title = '', partition = 'persist:webpanel' }) {
  ensurePanel();
  titleEl.textContent = title;
  currentUrl = url;
  for (const [u, v] of views) v.style.display = u === url ? 'flex' : 'none';
  const fresh = !views.has(url);
  if (fresh) {
    const view = h('webview', { partition, src: url, allowpopups: true });
    view.addEventListener('did-navigate', (e) => { if (currentUrl === url) addressEl.value = e.url; });
    view.addEventListener('did-navigate-in-page', (e) => { if (currentUrl === url) addressEl.value = e.url; });
    view.addEventListener('did-start-loading', () => { if (currentUrl === url) showLoader(); });
    view.addEventListener('dom-ready', () => { if (currentUrl === url) hideLoader(); });
    view.addEventListener('did-stop-loading', () => { if (currentUrl === url) hideLoader(); });
    view.addEventListener('did-fail-load', (e) => { if (e.errorCode !== -3 && currentUrl === url) hideLoader(); });
    views.set(url, view);
    frame.append(view);
  }
  currentView = views.get(url);
  addressEl.value = url;
  // 已经加载过的复用视图直接显示，别再盖一层祈祷动画
  if (fresh) showLoader(); else hideLoader();
  panel.removeAttribute('hidden');
}

export function hideWebPanel() {
  if (!panel) return;
  panel.setAttribute('hidden', '');
  hideLoader();
  currentView = null;
}
