import { h } from './ui.js';
import { iconFor } from './icons.js';

/**
 * 顶栏的「今日大模型」这类外链，以前一律甩去系统浏览器；现在直接在工具箱里开一层
 * 内嵌 webview 面板。做成盖满窗口的一层覆盖层，自带一条工具条（关 / 前后退 / 刷新 /
 * 地址 / 丢去系统浏览器）。同一个 URL 复用同一个 webview，登录态和滚动位置都留着，
 * 再点开是秒开而不是重新加载。
 */
let panel = null;
let frame = null;
let titleEl = null;
let addressEl = null;
let currentView = null;
let currentUrl = '';
const views = new Map(); // url -> webview

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
  titleEl = h('strong', { class: 'webpanel__title' }, '');
  addressEl = h('input', { class: 'field mono webpanel__addr', readonly: true, title: '当前地址' });
  frame = h('div', { class: 'webpanel__frame' });
  panel = h('div', { class: 'webpanel', hidden: true },
    h('div', { class: 'bar webpanel__bar' }, close, back, fwd, reload, titleEl, addressEl, ext),
    frame,
  );
  document.body.appendChild(panel);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) hideWebPanel(); });
}

/** 打开一个内嵌网页面板。partition 独立，站点登录态互不影响。 */
export function openWebPanel({ url, title = '', partition = 'persist:webpanel' }) {
  ensurePanel();
  titleEl.textContent = title;
  currentUrl = url;
  for (const [u, v] of views) v.style.display = u === url ? 'flex' : 'none';
  if (!views.has(url)) {
    const view = h('webview', { partition, src: url, allowpopups: true });
    view.addEventListener('did-navigate', (e) => { if (currentUrl === url) addressEl.value = e.url; });
    view.addEventListener('did-navigate-in-page', (e) => { if (currentUrl === url) addressEl.value = e.url; });
    views.set(url, view);
    frame.appendChild(view);
  }
  currentView = views.get(url);
  addressEl.value = url;
  panel.removeAttribute('hidden');
}

export function hideWebPanel() {
  if (!panel) return;
  panel.setAttribute('hidden', '');
  currentView = null;
}
