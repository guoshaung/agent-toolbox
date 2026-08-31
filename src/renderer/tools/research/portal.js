import { h, toast } from '../../core/ui.js';

const PARTITION = 'persist:research';

const PRESET_SITES = [
  { name: '玻尔 Bohrium', url: 'https://www.bohrium.com', desc: '科研空间站 · AI4S 平台', emoji: '🔬' },
  { name: '掌桥科研', url: 'https://www.zhangqiaokeyan.com', desc: 'AI 毕业论文写作 / 查重', emoji: '🎓' },
  { name: '纳米 AI', url: 'https://www.n.cn', desc: '360 纳米 AI 搜索', emoji: '🔍' },
  { name: '当贝 AI', url: 'https://ai.dangbei.com', desc: '当贝 AI 助手', emoji: '🤖' },
  { name: '讯飞星火', url: 'https://xinghuo.xfyun.cn', desc: '讯飞星火大模型', emoji: '✨' },
];

/**
 * 门户：科研/AI 网站格子铺。每个站点一个独立常驻 webview，
 * 登录态和页面状态都保住；favicon 主进程代取，拿不到用 emoji 兜底。
 */
export function createPortal(root, ctx) {
  const { config } = ctx;
  const views = new Map(); // url -> webview
  let activeUrl = null;

  const grid = h('div', { class: 'research__grid' });
  const viewHost = h('div', { class: 'research__views', hidden: true });
  const faviconCache = new Map(); // url -> dataURL | null（null 表示试过没拿到）

  const backBtn = h('button', { class: 'btn btn--icon', title: '返回站点列表', onclick: () => showGrid() }, '‹');
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
    return [...PRESET_SITES, ...(config.get('research.sites') || [])];
  }

  async function faviconFor(url) {
    if (faviconCache.has(url)) return faviconCache.get(url);
    const cacheKey = `research.favicons.${btoa(url).slice(0, 32)}`;
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
      const custom = !PRESET_SITES.includes(site);
      grid.appendChild(
        h('div', { class: 'research__card', onclick: () => openSite(site) },
          custom && h('button', {
            class: 'research__card-del', title: '移除这个站点',
            onclick: async (e) => {
              e.stopPropagation();
              const list = (config.get('research.sites') || []).filter((x) => x.url !== site.url);
              await config.set('research.sites', list);
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
            const list = config.get('research.sites') || [];
            list.push({ name, url, desc: '', emoji: '🌐' });
            await config.set('research.sites', list);
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
      const view = h('webview', { partition: PARTITION, src: site.url });
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
