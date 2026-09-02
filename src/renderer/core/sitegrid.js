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
      syncEdgeCookiesFor(site.url);
      views.set(site.url, view);
      viewHost.appendChild(view);
    }
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
  root.append(viewBar, h('div', { class: 'research__portalbody' }, categoryBar, grid, viewHost));
  renderGrid();
}
