import { h } from '../../core/ui.js';
import { validateCatalog, filterFeatures, recentFeatures } from './catalog.mjs';

export default {
  id: 'feature-lab',
  title: '功能工作台',
  icon: 'zap',
  hint: '搜索学习、工具、娱乐的本地功能，收藏和继续最近使用',
  create(root, ctx) {
    let features = []; let category = '全部'; let group = '全部'; let onlyFavorites = false;
    let current = null; let instance = null; let active = false; let token = 0; let disposed = false;
    let favorites = ctx.config.get('featureLab.favorites', []);
    let recents = ctx.config.get('featureLab.recents', []);
    if (!Array.isArray(favorites)) favorites = [];
    if (!Array.isArray(recents)) recents = [];
    const status = h('p', { class: 'feature-lab__status', role: 'status', 'aria-live': 'polite' });
    const query = h('input', { class: 'field', type: 'search', placeholder: '搜索名称、用途或编号', 'aria-label': '搜索功能', oninput: renderList });
    const groups = h('select', { class: 'field', 'aria-label': '功能模块', onchange: () => { group = groups.value; renderList(); } });
    const list = h('div', { class: 'feature-lab__list' });
    const recentHost = h('div', { class: 'feature-lab__recents' });
    const panel = h('div', { class: 'feature-lab__panel' });
    const tabs = h('div', { class: 'feature-lab__tabs', role: 'group', 'aria-label': '功能分类' });
    for (const name of ['全部', '学习', '工具', '娱乐']) tabs.append(h('button', {
      class: 'btn', 'aria-pressed': String(name === category), onclick: () => {
        category = name; group = '全部';
        for (const button of tabs.children) button.setAttribute('aria-pressed', String(button.textContent === name));
        renderGroups(); renderList();
      },
    }, name));
    const favButton = h('button', { class: 'btn', 'aria-pressed': 'false', onclick: () => {
      onlyFavorites = !onlyFavorites; favButton.setAttribute('aria-pressed', String(onlyFavorites)); renderList();
    } }, '只看收藏');
    root.append(h('div', { class: 'bar bar--drag' }, h('strong', {}, '功能工作台')),
      h('div', { class: 'feature-lab' }, h('aside', { class: 'feature-lab__catalog', 'aria-label': '功能目录' },
        tabs, query, groups, favButton, status, recentHost, list), panel));

    function report(error) { status.textContent = error?.message || String(error); }
    function persist(key, value) { Promise.resolve(ctx.config.set(`featureLab.${key}`, value)).catch(report); }
    function renderGroups() {
      const names = [...new Set(features.filter((row) => category === '全部' || row.category === category).map((row) => row.group))];
      groups.replaceChildren(...['全部', ...names].map((name) => h('option', { value: name }, name)));
      groups.value = group;
    }
    function renderList() {
      const rows = filterFeatures(features, { category, group, query: query.value, favorites: onlyFavorites ? favorites : null });
      list.replaceChildren(...rows.map((row) => h('div', { class: 'feature-lab__entry' },
        h('button', { class: 'feature-lab__open', 'aria-current': row.id === current ? 'true' : 'false', onclick: () => { void open(row); } },
          h('strong', {}, row.title), h('span', { class: 'faint' }, `${row.id} · ${row.category} · ${row.group}`), h('span', {}, row.description)),
        h('button', { class: 'btn', 'aria-label': `${favorites.includes(row.id) ? '取消收藏' : '收藏'}${row.title}`, 'aria-pressed': String(favorites.includes(row.id)), onclick: () => {
          favorites = favorites.includes(row.id) ? favorites.filter((id) => id !== row.id) : [...favorites, row.id];
          persist('favorites', favorites); renderList();
        } }, favorites.includes(row.id) ? '★' : '☆'))));
      if (!rows.length) list.append(h('p', { class: 'empty' }, features.length ? '没有匹配的功能。' : '此版本尚未包含新增功能，已实现的功能会自动出现在这里。'));
      recentHost.replaceChildren(h('span', { class: 'faint' }, '最近使用'), ...recents.map((id) => features.find((row) => row.id === id)).filter(Boolean).slice(0, 6)
        .map((row) => h('button', { class: 'btn btn--sm', onclick: () => { void open(row); } }, row.title)));
    }
    function release() {
      try { instance?.deactivate?.(); } catch (error) { report(error); }
      try { instance?.destroy?.(); } catch (error) { report(error); }
      instance = null;
    }
    async function open(row) {
      if (row.id === current && instance) return;
      const request = ++token;
      status.textContent = `正在打开 ${row.title}…`;
      try {
        // IDs are validated before interpolation; arbitrary paths cannot enter this import.
        const module = await import(`../../features/${row.id}/index.js`);
        if (disposed || request !== token) return;
        const feature = module.default;
        if (feature?.id !== row.id || typeof feature.create !== 'function') throw new Error('功能模块接口无效');
        release(); panel.replaceChildren(); current = row.id;
        panel.append(h('h2', {}, row.title), h('p', { class: 'faint' }, row.description),
          h('p', { class: 'faint' }, '切换功能会关闭当前面板；需要保留的输入和结果请先导出。'));
        const body = h('div', { class: 'feature-lab__body' }); panel.append(body);
        instance = feature.create(body, ctx) || {};
        if (active) instance.activate?.();
        recents = recentFeatures(recents, row.id); persist('recents', recents);
        status.textContent = `${row.id} · 已打开`; renderList();
      } catch (error) {
        if (request !== token || disposed) return;
        if (current === row.id) { release(); current = null; panel.replaceChildren(h('p', { class: 'empty' }, '功能加载失败，请重试。')); }
        report(error);
      }
    }
    async function refresh() {
      try {
        const result = await window.toolbox.features.list();
        if (disposed) return;
        features = validateCatalog(result.features);
        const errors = Array.isArray(result.errors) ? result.errors : [];
        status.textContent = `此版本提供 ${features.length} 项功能${errors.length ? `；${errors.length} 项描述无效，已跳过` : ''}`;
        renderGroups(); renderList();
      } catch (error) { if (!disposed) report(error); }
    }
    panel.append(h('p', { class: 'empty' }, '在左侧选择功能开始。处理内容保留在本机；各功能会明确说明外部依赖。'));
    renderGroups(); renderList();
    return {
      activate() { active = true; instance?.activate?.(); void refresh(); },
      deactivate() { active = false; instance?.deactivate?.(); },
      destroy() { disposed = true; ++token; release(); root.replaceChildren(); },
    };
  },
};
