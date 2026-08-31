import { h, toast } from './ui.js';

/**
 * 通用「站点格子铺 + 内嵌浏览」组件：科研门户 / 醒脑网页游戏 / 情报热榜共用。
 * 每个站点一个独立常驻 webview，登录态和页面状态都保住；
 * favicon 走主进程代取（渲染进程 CSP 不放行外域图片），拿不到用 emoji 兜底并缓存。
 */
export function createSiteGrid(root, { presets, configKey, cachePrefix, partition, config }) {
  const views = new Map(); // url -> webview
  let activeUrl = null;

  const grid = h('div', { class: 'research__grid' });
  const viewHost = h('div', { class: 'research__views', hidden: true });
  const faviconCache = new Map(); // url -> dataURL | null（null 表示试过没拿到）

  const backBtn = h('button', { class: 'btn btn--icon', title: '返回列表', onclick: () => showGrid() }, '‹');
  const navBack = h('button', { class: 'btn btn--icon', title: '后退', onclick: () => views.get(activeUrl)?.goBack() }, '←');
  const navFwd = h('button', { class: 'btn btn--icon', title: '前进', onclick: () => views.get(activeUrl)?.goForward() }, '→');
  const navReload = h('button', { class: 'btn btn--icon', title: '刷新', onclick: () => views.get(activeUrl)?.reload() }, '⟳');
  const address = h('input', {
    class: 'field mono research__address',
    readonly: true,
    title: '当前地址（只读，点右边按钮用系统浏览器打开）',
  });
  const viewBar = h('div', { class: 'bar research__viewbar', hidden: true },
    backBtn, navBack, navFwd, navReload, address,
    h('button', {
      class: 'btn btn--sm btn--ghost', title: '用系统浏览器打开',
      onclick: () => activeUrl && window.toolbox.shell.openExternal(address.value || activeUrl),
    }, '↗'),
  );

  function allSites() {
    return [...presets, ...(config.get(configKey) || [])];
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
    const icon = h('span', { class: 'research__icon' }, site.emoji || '🌐');
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
    for (const site of allSites()) {
      const custom = !presets.includes(site);
      grid.appendChild(
        h('div', { class: 'research__card', onclick: () => openSite(site) },
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
    }
    // 加自定义站点的卡片
    const nameInput = h('input', { class: 'field field--sm', placeholder: '名称' });
    const urlInput = h('input', { class: 'field field--sm', placeholder: 'https://…' });
    grid.appendChild(
      h('div', { class: 'research__card research__card--add' },
        h('span', { class: 'research__icon' }, '＋'),
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
            list.push({ name, url, desc: '', emoji: '🌐' });
            await config.set(configKey, list);
            nameInput.value = urlInput.value = '';
            renderGrid();
            toast('已加入', 'good');
          },
        }, '添加'),
      ),
    );
  }

  function openSite(site) {
    activeUrl = site.url;
    if (!views.has(site.url)) {
      const view = h('webview', { partition, src: site.url });
      view.addEventListener('did-navigate', (e) => { if (activeUrl === site.url) address.value = e.url; });
      view.addEventListener('did-navigate-in-page', (e) => { if (activeUrl === site.url) address.value = e.url; });
      views.set(site.url, view);
      viewHost.appendChild(view);
    }
    for (const [url, view] of views) view.style.display = url === site.url ? 'flex' : 'none';
    address.value = site.url;
    grid.setAttribute('hidden', '');
    viewBar.removeAttribute('hidden');
    viewHost.removeAttribute('hidden');
  }

  function showGrid() {
    activeUrl = null;
    viewBar.setAttribute('hidden', '');
    viewHost.setAttribute('hidden', '');
    grid.removeAttribute('hidden');
  }

  root.append(viewBar, h('div', { class: 'research__portalbody' }, grid, viewHost));
  renderGrid();
}
