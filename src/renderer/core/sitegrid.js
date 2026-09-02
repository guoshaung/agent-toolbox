import { h, toast } from './ui.js';
import { iconFor, iconLabel } from './icons.js';

/**
 * 通用「站点格子铺 + 内嵌浏览」组件：科研门户 / 醒脑网页游戏 / 情报热榜共用。
 * 每个站点一个独立常驻 webview，登录态和页面状态都保住；
 * favicon 走主进程代取（渲染进程 CSP 不放行外域图片），拿不到用 emoji 兜底并缓存。
 */
export function createSiteGrid(root, {
  presets, configKey, cachePrefix, partition, config, categories = [], detachable = false,
}) {
  const views = new Map(); // url -> webview
  let activeUrl = null;
  let activeCategory = 'all';
  let bypassScriptPromise = null;
  const syncedHosts = new Set();

  function getBypassScript() {
    if (!bypassScriptPromise) bypassScriptPromise = window.toolbox.site.bypassScript();
    return bypassScriptPromise;
  }

  async function injectBypass(view) {
    const script = await getBypassScript();
    if (!script) return;
    try {
      await view.executeJavaScript(script, false);
    } catch (err) {
      console.error('[sitegrid] inject bypass failed:', err);
    }
  }

  async function syncEdgeCookiesFor(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (syncedHosts.has(host)) return;
      syncedHosts.add(host);
      const result = await window.toolbox.site.syncCookies(partition, host);
      if (result.ok && result.count > 0) {
        console.log('[sitegrid] auto-synced', result.count, 'cookies for', host);
      }
    } catch (err) {
      console.error('[sitegrid] auto-sync cookies failed:', err);
    }
  }

  const grid = h('div', { class: 'research__grid' });
  const viewHost = h('div', { class: 'research__views', hidden: true });
  const categoryBar = categories.length ? h('div', { class: 'sitegrid__filters' }) : null;
  const faviconCache = new Map(); // url -> dataURL | null（null 表示试过没拿到）

  const backBtn = h('button', { class: 'btn btn--icon', title: '返回列表', onclick: () => showGrid() }, iconFor('arrowLeft'));
  const navBack = h('button', { class: 'btn btn--icon', title: '后退', onclick: () => views.get(activeUrl)?.goBack() }, iconFor('arrowLeft'));
  const navFwd = h('button', { class: 'btn btn--icon', title: '前进', onclick: () => views.get(activeUrl)?.goForward() }, iconFor('arrowRight'));
  const navReload = h('button', { class: 'btn btn--icon', title: '刷新', onclick: () => views.get(activeUrl)?.reload() }, iconFor('refresh'));
  const syncEdgeBtn = h('button', {
    class: 'btn btn--sm',
    title: '把 Edge/Chrome 里这个站点的登录 cookie 同步进来',
    onclick: async () => {
      if (!activeUrl) return;
      try {
        const host = new URL(activeUrl).hostname.replace(/^www\./, '');
        const result = await window.toolbox.site.syncCookies(partition, host);
        if (result.ok) toast(`已同步 ${result.count} 个 Edge cookie，刷新试试`, 'good');
        else toast(result.error || '同步失败', 'bad');
        views.get(activeUrl)?.reload();
      } catch (err) {
        toast(err.message, 'bad');
      }
    },
  }, iconLabel('link', '同步 Edge 登录'));
  const address = h('input', {
    class: 'field mono research__address',
    readonly: true,
    title: '当前地址（只读，点右边按钮用系统浏览器打开）',
  });
  const viewBar = h('div', { class: 'bar research__viewbar', hidden: true },
    backBtn, navBack, navFwd, navReload, syncEdgeBtn, address,
    h('button', {
      class: 'btn btn--sm btn--ghost', title: '用系统浏览器打开',
      onclick: () => activeUrl && window.toolbox.shell.openExternal(address.value || activeUrl),
    }, '↗'),
  );

  function allSites() {
    return [...presets, ...(config.get(configKey) || [])];
  }

  function matchesCategory(site) {
    return activeCategory === 'all' || site.category === activeCategory;
  }

  function renderCategoryBar() {
    if (!categoryBar) return;
    categoryBar.textContent = '';
    for (const category of [{ id: 'all', label: '全部' }, ...categories]) {
      categoryBar.appendChild(h('button', {
        class: `btn btn--sm ${activeCategory === category.id ? 'is-active' : ''}`,
        onclick: () => {
          activeCategory = category.id;
          renderCategoryBar();
          renderGrid();
        },
      }, category.label));
    }
  }

  async function faviconFor(url) {
    if (faviconCache.has(url)) return faviconCache.get(url);
    const cacheKey = `${cachePrefix}${btoa(url).slice(0, 32)}`;
    const cached = config.get(cacheKey);
    if (cached) {
      faviconCache.set(url, cached);
      return cached;
    }
    const dataUrl = await window.toolbox.site.favicon(url);
    faviconCache.set(url, dataUrl || null);
    if (dataUrl) config.set(cacheKey, dataUrl);
    return dataUrl;
  }

  function siteIcon(site) {
    const icon = h('span', { class: 'research__icon' }, iconFor(site.emoji || 'globe'));
    faviconFor(site.url).then((dataUrl) => {
      if (dataUrl) {
        icon.textContent = '';
        icon.appendChild(h('img', { src: dataUrl, class: 'research__favicon', alt: '' }));
      }
    });
    return icon;
  }

  function renderGrid() {
    grid.textContent = '';
    for (const site of allSites().filter(matchesCategory)) {
      const custom = !presets.includes(site);
      grid.appendChild(
      h('div', {
        class: `research__card${detachable ? ' research__card--detachable' : ''}`,
        title: detachable ? '点击打开；拖出此卡片可生成悬浮球，双击悬浮球展开' : '',
        draggable: detachable,
        onclick: () => { if (!draggingSite) openSite(site); },
      },
          custom && h('button', {
            class: 'research__card-del', title: '移除这个站点',
            onclick: async (e) => {
              e.stopPropagation();
              const list = (config.get(configKey) || []).filter((x) => x.url !== site.url);
              await config.set(configKey, list);
              renderGrid();
            },
          }, '×'),
          siteIcon(site),
          h('div', { class: 'research__name' }, site.name),
          h('div', { class: 'research__desc faint' }, site.desc || new URL(site.url).host),
        ),
      );
      if (detachable) {
        const card = grid.lastElementChild;
        let dragTimer;
        card.addEventListener('dragstart', (event) => {
          draggingSite = true;
          card.classList.add('is-dragging');
          event.dataTransfer?.setData('text/plain', site.url);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
        });
        card.addEventListener('dragend', async () => {
          card.classList.remove('is-dragging');
          clearTimeout(dragTimer);
          dragTimer = setTimeout(() => { draggingSite = false; }, 80);
          try {
            const result = await window.toolbox.site.float(site);
            if (result?.ok) toast(`${site.name} 已变成悬浮球，双击它展开`, 'good', 4200);
          } catch (err) {
            toast(`悬浮球创建失败：${err.message}`, 'bad');
          }
        });
      }
    }
    // 加自定义站点的卡片
    const nameInput = h('input', { class: 'field field--sm', placeholder: '名称' });
    const urlInput = h('input', { class: 'field field--sm', placeholder: 'https://…' });
    grid.appendChild(
      h('div', { class: 'research__card research__card--add' },
        h('span', { class: 'research__icon' }, iconFor('plus')),
        nameInput,
        urlInput,
        h('button', {
          class: 'btn btn--sm btn--primary',
          onclick: async () => {
            const name = nameInput.value.trim();
            let url = urlInput.value.trim();
            if (!name || !url) return toast('名称和网址都要填', 'info');
            if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
            try { new URL(url); } catch { return toast('网址格式不对', 'bad'); }
            if (allSites().some((s) => s.url === url)) return toast('这个站点已经在了', 'info');
            const list = config.get(configKey) || [];
            list.push({ name, url, desc: '', emoji: 'globe' });
            await config.set(configKey, list);
            nameInput.value = urlInput.value = '';
            renderGrid();
            toast('已加入', 'good');
          },
        }, '添加'),
      ),
    );
  }

  let draggingSite = false;

  /**
   * 加载失败时的提示面板。
   *
   * 以前这里什么都没有：站点加载失败（证书错误、DNS 失败、超时）就是一片白，
   * 用户完全不知道发生了什么，只会觉得"这工具坏了"。
   */
  const errorPane = h('div', { class: 'sitegrid__error', hidden: true });

  const NET_REASON = {
    '-105': '域名解析失败（DNS 查不到这个站点）',
    '-106': '网络好像断了',
    '-118': '连接超时',
    '-7': '请求超时',
    '-102': '连接被拒绝',
    '-501': '不安全的响应',
    '-137': '域名解析超时',
  };

  function hideError() {
    errorPane.setAttribute('hidden', '');
    errorPane.textContent = '';
  }

  async function showError(view, { errorCode, errorDescription, validatedURL }) {
    const isCert = String(errorDescription || '').includes('CERT');
    const reason = isCert
      ? await window.toolbox.cert.describe(`net::${errorDescription}`)
      : NET_REASON[String(errorCode)] || `${errorDescription}（${errorCode}）`;

    errorPane.textContent = '';
    errorPane.append(
      h('div', { class: 'sitegrid__error-title' }, isCert ? '这个站点的安全证书有问题' : '页面没能打开'),
      h('div', { class: 'sitegrid__error-reason' }, reason),
      h('div', { class: 'sitegrid__error-url mono' }, validatedURL || ''),
      isCert
        ? h('div', { class: 'sitegrid__error-note' },
          '证书不对意味着这条连接可能被中间人看到或篡改。'
          + '浏览这类站点的公开内容风险有限，但不要在这种连接上输入账号密码。')
        : null,
      h('div', { class: 'sitegrid__error-actions' },
        h('button', {
          class: 'btn btn--sm btn--primary',
          onclick: () => { hideError(); view.reload(); },
        }, '重试'),
        h('button', {
          class: 'btn btn--sm',
          title: '交给系统浏览器打开：那里有完整的安全提示，也能用你已有的登录态',
          onclick: () => window.toolbox.shell.openExternal(validatedURL || activeUrl),
        }, '用系统浏览器打开'),
        isCert
          ? h('button', {
            class: 'btn btn--sm sitegrid__error-risky',
            title: '只对这一个域名放行，不影响 App 里其它站点',
            onclick: async () => {
              const result = await window.toolbox.cert.allow(validatedURL || activeUrl);
              if (!result?.ok) return toast(result?.error || '放行失败', 'bad');
              toast(`已放行 ${result.host}，正在重新加载`, 'good');
              hideError();
              view.reload();
            },
          }, '我知道风险，仍然访问此域名')
          : null,
      ),
    );
    errorPane.removeAttribute('hidden');
  }

  /** 加载完成但页面是空的 —— 多半是站点拒绝了内嵌访问 */
  async function checkBlank(view, siteUrl) {
    if (activeUrl !== siteUrl) return;
    if (!errorPane.hasAttribute('hidden')) return;      // 已经在报别的错了
    let empty = false;
    try {
      empty = await view.executeJavaScript(
        '(() => { const t = document.body ? document.body.innerText.trim().length : 0;'
        + ' const nodes = document.body ? document.body.querySelectorAll("img,canvas,svg,video,iframe").length : 0;'
        + ' return t < 8 && nodes === 0; })()',
      );
    } catch { return; }                                  // 页面还没准备好，不做判断
    if (!empty) return;

    errorPane.textContent = '';
    errorPane.append(
      h('div', { class: 'sitegrid__error-title' }, '这个站点拒绝了内嵌访问'),
      h('div', { class: 'sitegrid__error-reason' },
        '页面加载完成了，但服务器没有返回任何内容。常见于有反爬机制的站点'
        + '（知网就是典型：不管换什么请求头都返回 418 空响应）。这不是网络问题，也不是登录问题。'),
      h('div', { class: 'sitegrid__error-url mono' }, view.getURL()),
      h('div', { class: 'sitegrid__error-note' },
        '找论文的话，建议走学校图书馆的「校外访问 / CARSI 入口」——那类地址是学校的代理域名，'
        + '通常不会被拦，而且自带机构权限。直接开公网的 cnki.net 即使打开了也没有下载权限。'),
      h('div', { class: 'sitegrid__error-actions' },
        h('button', { class: 'btn btn--sm btn--primary', onclick: () => { hideError(); view.reload(); } }, '重试'),
        h('button', {
          class: 'btn btn--sm',
          onclick: () => window.toolbox.shell.openExternal(view.getURL()),
        }, '用系统浏览器打开'),
        h('button', { class: 'btn btn--sm', onclick: () => { hideError(); view.goBack(); } }, '返回上一页'),
      ),
    );
    errorPane.removeAttribute('hidden');
  }

  function openSite(site) {
    activeUrl = site.url;
    if (!views.has(site.url)) {
      // allowpopups 不能省：图书馆/数据库的链接大多是 target="_blank"。
      // 不开这个属性，window.open 在到达主进程的处理器之前就被拦死，
      // 结果是点了完全没反应 —— 连转发都不会发生。
      // 开了之后主进程仍然 deny 真弹窗，只把 URL 转回来，由下面的监听原地导航：
      // 同一个 webview、同一个 session，学校的登录态才带得过去。
      const view = h('webview', { partition, src: site.url, allowpopups: true });
      view.addEventListener('did-navigate', (e) => { if (activeUrl === site.url) address.value = e.url; });
      view.addEventListener('did-navigate-in-page', (e) => { if (activeUrl === site.url) address.value = e.url; });
      view.addEventListener('dom-ready', () => injectBypass(view));
      view.addEventListener('did-start-loading', () => { if (activeUrl === site.url) hideError(); });
      // 有些站点（知网就是典型）对内嵌浏览器直接返回 418 之类的空响应：
      // 不触发 did-fail-load，但页面是空的。不检查就又是一片白屏。
      view.addEventListener('did-finish-load', () => {
        if (activeUrl !== site.url) return;
        setTimeout(() => checkBlank(view, site.url), 1400);   // 留点时间给前端渲染
      });
      view.addEventListener('did-fail-load', (e) => {
        if (e.errorCode === -3) return;                 // -3 是主动取消的导航，不是故障
        if (!e.isMainFrame && e.isMainFrame !== undefined) return;   // 子框架失败不弹整页错误
        if (activeUrl !== site.url) return;
        showError(view, e);
      });
      syncEdgeCookiesFor(site.url);
      views.set(site.url, view);
      viewHost.appendChild(view);
    }
    hideError();
    for (const [url, view] of views) view.style.display = url === site.url ? 'flex' : 'none';
    address.value = site.url;
    grid.setAttribute('hidden', '');
    viewBar.removeAttribute('hidden');
    viewHost.removeAttribute('hidden');
  }

  window.addEventListener('toolbox:open-url', (event) => {
    const nextUrl = String(event.detail?.url || '');
    if (!activeUrl || viewHost.hidden || !/^https?:\/\//i.test(nextUrl)) return;
    // 门户 / 学术入口 / 学校访问 是三个各自常驻的格子铺，都在监听这个事件。
    // 不判可见性的话，在学校访问里点链接，另外两个也会跟着跳走。
    if (root.offsetParent === null) return;
    const view = views.get(activeUrl);
    if (view) view.loadURL(nextUrl);
  });

  function showGrid() {
    activeUrl = null;
    viewBar.setAttribute('hidden', '');
    viewHost.setAttribute('hidden', '');
    grid.removeAttribute('hidden');
  }

  renderCategoryBar();
  viewHost.appendChild(errorPane);
  root.append(viewBar, h('div', { class: 'research__portalbody' }, categoryBar, grid, viewHost));
  renderGrid();
}
