import { h, toast } from '../../core/ui.js';

/**
 * 学术入口里的内置浏览器。
 *
 * 为什么需要它：自动检索再准也有够不着的地方（校内库、出版社页面、要登录的数据库）。
 * 找不到时得能自己翻，翻到了还得能一键入库，不然又回到「复制粘贴」。
 *
 * 说明一句：这里跑的是 Electron 自带的 Chromium，不是真的把 Chrome / Edge 装进来
 * ——那俩是独立应用，塞不进来。两个标签的真实区别是：
 *   · 各自独立的 session 分区，登录态互不干扰（可以一个登学校、一个登出版社）；
 *   · UA 标识不同，有些库按 UA 判断；
 *   · Edge 那个能把你本机 Edge 里已登录的 cookie 同步过来。
 */

const EDGE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const PROFILES = {
  chrome: { label: 'Chrome', partition: 'persist:research-chrome', ua: CHROME_UA, home: 'https://scholar.google.com/' },
  edge: { label: 'Edge', partition: 'persist:research-edge', ua: EDGE_UA, home: 'https://www.bing.com/academic' },
};

/** 输入框里既能填网址也能填搜索词，靠这个区分。 */
function toUrl(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  // 带点又不带空格的，当域名处理
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw)) return `https://${raw}`;
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(raw)}`;
}

/** 在页面里挖论文标识：DOI、arXiv 号、标题。都是站点常用的 meta 标签。 */
const GRAB_SCRIPT = String.raw`
(() => {
  const meta = (names) => {
    for (const n of names) {
      const el = document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]');
      if (el && el.content && el.content.trim()) return el.content.trim();
    }
    return '';
  };
  const bodyText = (document.body ? document.body.innerText : '').slice(0, 20000);
  const doiMeta = meta(['citation_doi', 'dc.identifier', 'DC.Identifier', 'prism.doi']);
  const doiText = (bodyText.match(/10\.\d{4,9}\/[-._;()\/:A-Za-z0-9]+/) || [])[0] || '';
  const arxivUrl = (location.href.match(/arxiv\.org\/(?:abs|pdf)\/([\w.\/-]+?)(?:v\d+)?(?:\.pdf)?$/i) || [])[1] || '';
  const arxivText = (bodyText.match(/arXiv:\s*(\d{4}\.\d{4,5})/i) || [])[1] || '';
  return {
    title: meta(['citation_title', 'og:title', 'dc.title', 'DC.Title']) || document.title || '',
    doi: (doiMeta || doiText).replace(/[.,;:)\]}>]+$/, ''),
    arxiv: arxivUrl || arxivText,
    url: location.href,
  };
})()
`;

export function createResearchBrowser(ctx) {
  let profile = 'chrome';
  let view = null;

  const address = h('input', {
    class: 'field field--sm rbrowser__address',
    placeholder: '输入网址，或直接输关键词按回车（走 Google 学术）',
    onkeydown: (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const url = toUrl(address.value);
      if (url) view.loadURL(url);
    },
  });

  const stage = h('div', { class: 'rbrowser__stage' });
  const statusEl = h('span', { class: 'faint rbrowser__status' });

  function mount(next) {
    profile = next;
    const spec = PROFILES[profile];
    stage.textContent = '';
    view = h('webview', {
      partition: spec.partition,
      src: spec.home,
      useragent: spec.ua,
      allowpopups: true,
    });
    view.addEventListener('did-start-loading', () => { statusEl.textContent = '加载中…'; });
    view.addEventListener('did-stop-loading', () => {
      statusEl.textContent = '';
      try { address.value = view.getURL(); } catch { /* 还没就绪 */ }
    });
    view.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3) return;   // 用户自己中断的，不算错
      statusEl.textContent = `打不开：${e.errorDescription}`;
    });
    stage.appendChild(view);
    for (const btn of tabBtns) btn.classList.toggle('is-active', btn.dataset.profile === profile);
    syncEdgeBtn.hidden = profile !== 'edge';
  }

  const tabBtns = Object.entries(PROFILES).map(([id, spec]) => h('button', {
    class: 'btn btn--sm rbrowser__tab',
    dataset: { profile: id },
    onclick: () => mount(id),
  }, spec.label));

  const syncEdgeBtn = h('button', {
    class: 'btn btn--sm', hidden: true,
    title: '把本机 Edge 里这个站点的登录 cookie 同步过来',
    onclick: async () => {
      let host = '';
      try { host = new URL(view.getURL()).hostname; } catch { /* 页面还没加载 */ }
      if (!host) return toast('先打开一个站点再同步', 'info');
      const r = await window.toolbox.edge.syncCookies(PROFILES.edge.partition, host);
      if (r && r.ok) { toast(`已同步 ${r.count ?? 0} 条 ${host} 的登录信息，刷新试试`, 'good'); view.reload(); }
      else toast((r && r.error) || '同步失败', 'bad');
    },
  }, '同步 Edge 登录');

  /** 把当前页面认成一篇文献，走和自动识别同一套判定（同名要提示、纯 arXiv 直通）。 */
  const grabBtn = h('button', {
    class: 'btn btn--sm btn--primary',
    title: '把当前页面这篇论文的书目信息抓下来',
    onclick: async () => {
      let info;
      try {
        info = await view.executeJavaScript(GRAB_SCRIPT, true);
      } catch (err) {
        return toast(`读不到页面内容：${err.message}`, 'bad');
      }
      if (!info || (!info.doi && !info.arxiv && !info.title)) {
        return toast('这个页面上没找到 DOI / arXiv 号，也没有可用标题', 'info');
      }
      statusEl.textContent = '正在查书目…';
      const result = await window.toolbox.biblio.lookup({
        doi: info.doi || undefined,
        arxiv: info.arxiv || undefined,
        title: info.doi || info.arxiv ? undefined : info.title,
      });
      statusEl.textContent = '';
      if (!result.ok) return toast(result.error, 'bad');
      ctx.onGrab?.(result, info);
    },
  }, '⬇ 抓这篇');

  const bar = h('div', { class: 'bar rbrowser__bar' },
    ...tabBtns,
    h('span', { class: 'subbar__sep' }),
    h('button', { class: 'btn btn--icon', title: '后退', onclick: () => view.canGoBack() && view.goBack() }, '‹'),
    h('button', { class: 'btn btn--icon', title: '前进', onclick: () => view.canGoForward() && view.goForward() }, '›'),
    h('button', { class: 'btn btn--icon', title: '刷新', onclick: () => view.reload() }, '⟳'),
    address,
    syncEdgeBtn,
    grabBtn,
    statusEl,
  );

  const root = h('div', { class: 'rbrowser', hidden: true }, bar, stage);

  return {
    root,
    open(which = 'chrome') {
      root.hidden = false;
      if (!view || which !== profile) mount(which);
    },
    close() { root.hidden = true; },
    get visible() { return !root.hidden; },
  };
}
