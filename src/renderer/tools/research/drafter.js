import { h, toast } from '../../core/ui.js';

/**
 * 论文示意图编辑器（Figure Drafter）。
 *
 * 是一个自包含的单文件 HTML，原样嵌进来，不去改它的内部逻辑 ——
 * 改了以后你拿到新版本还得再改一遍。
 *
 * 只做两件外围的事：
 *   1. 用 webview 装它，和工具箱其余部分隔离，它的 CSP / 内联样式不受主界面限制；
 *   2. 把它导出的文件接到容器里，而不是丢进系统下载目录。
 */
const PAGE = new URL('./figure-drafter.html', import.meta.url).href;

/**
 * 注进页面主世界的导出拦截。
 *
 * 那个编辑器用 `<a download href="blob:...">` 存文件，这套在 webview 里
 * 会被静默丢弃：页面提示「已导出」，磁盘上哪都没有，will-download 也不触发。
 *
 * 为什么不用 preload：contextIsolation 下 preload 和页面是两套 DOM 原型链，
 * 在 preload 里改 HTMLAnchorElement.prototype 影响不到页面自己的代码。
 * 所以直接注进主世界，把内容转成 base64 攒着，宿主定期取走写进容器。
 */
const EXPORT_HOOK = String.raw`
(() => {
  if (window.__drafterHook) return 'already';
  window.__drafterHook = true;
  window.__drafterOut = [];

  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...args) {
    const name = this.getAttribute('download');
    const href = this.getAttribute('href') || '';
    if (!name || !/^blob:|^data:/i.test(href)) return nativeClick.apply(this, args);
    fetch(href)
      .then((r) => r.blob())
      .then((blob) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.readAsDataURL(blob);
      }))
      .then((b64) => { window.__drafterOut.push({ name, b64 }); })
      .catch((err) => { window.__drafterOut.push({ name, error: err.message }); });
    return undefined;
  };
  return 'installed';
})()
`;

export function createDrafter(root, ctx) {
  const view = h('webview', {
    src: PAGE,
    // 它要从 cdnjs 拉 MathJax 渲染公式，给个独立分区把缓存留住，
    // 断网时公式渲染不了，画图本身照常用。
    partition: 'persist:drafter',
    allowpopups: false,
  });

  const status = h('span', { class: 'faint drafter__status' });

  const bar = h('div', { class: 'bar drafter__bar' },
    h('strong', {}, '示意图编辑器'),
    h('span', { class: 'faint' }, ' 导出的 SVG 可直接进论文'),
    h('span', { style: { flex: 1 } }),
    status,
    h('button', {
      class: 'btn btn--sm',
      title: '导出的文件都放在容器里，点这里打开那个文件夹',
      onclick: async () => {
        const r = await window.toolbox.container.open();
        if (!r.ok) toast(r.error, 'bad');
      },
    }, '打开容器'),
    h('button', { class: 'btn btn--sm btn--ghost', onclick: () => view.reload() }, '重载'),
  );

  let drainTimer = null;

  async function install() {
    try { await view.executeJavaScript(EXPORT_HOOK, true); } catch { /* 页面还没就绪 */ }
  }

  /** 页面把导出的内容攒在 __drafterOut 里，这里取走交给主进程写进容器。 */
  function startDraining() {
    if (drainTimer) return;
    drainTimer = setInterval(async () => {
      let batch = [];
      try {
        batch = await view.executeJavaScript(
          '(() => { const o = window.__drafterOut || []; window.__drafterOut = []; return o; })()', true);
      } catch { return; }
      for (const item of batch || []) {
        if (item.error) { toast(`导出失败：${item.error}`, 'bad'); continue; }
        const bytes = Uint8Array.from(atob(item.b64), (c) => c.charCodeAt(0));
        const r = await window.toolbox.container.saveBinary({
          folder: '图表', name: item.name, data: Array.from(bytes),
        });
        if (r.ok) toast(`已存到容器 · ${r.relPath}`, 'good');
        else toast(`存不进容器：${r.error}`, 'bad');
      }
    }, 700);
  }

  view.addEventListener('dom-ready', () => {
    status.textContent = '';
    install().then(startDraining);
  });
  view.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return;
    status.textContent = `加载失败：${e.errorDescription}`;
  });

  root.append(bar, h('div', { class: 'drafter__stage' }, view));
  return {
    deactivate: () => { if (drainTimer) clearInterval(drainTimer); drainTimer = null; },
    activate: () => startDraining(),
  };
}
