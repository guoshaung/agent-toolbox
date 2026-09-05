import { h, toast, debounce } from '../../core/ui.js';
import { DEFAULT_BOOKMARKS } from './bookmarks.js';

const PARTITION = 'persist:docs';
const HOME = 'https://developer.mozilla.org/zh-CN/docs/Web';

const normalizeUrl = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  // 看起来像域名就补协议，否则当成搜索词
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(text)) return `https://${text}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
};

export default {
  id: 'docs',
  title: '文档',
  icon: 'book',
  hint: '内置 Chromium 的官方文档浏览器（Cmd+2）',

  create(root, ctx) {
    const { config } = ctx;
    const tabs = [];
    let active = null;

    // ---- 侧栏书签 ----
    const bookmarkList = h('div', { class: 'docs__bookmarks' });
    const filter = h('input', {
      class: 'field field--sm',
      placeholder: '筛选书签',
      oninput: () => renderBookmarks(filter.value.trim().toLowerCase()),
    });

    function allBookmarks() {
      return [...DEFAULT_BOOKMARKS, ...(config.get('docs.bookmarks') || [])];
    }

    function renderBookmarks(query = '') {
      bookmarkList.textContent = '';
      const groups = new Map();
      for (const bm of allBookmarks()) {
        if (query && !`${bm.name} ${bm.group} ${bm.url}`.toLowerCase().includes(query)) continue;
        if (!groups.has(bm.group)) groups.set(bm.group, []);
        groups.get(bm.group).push(bm);
      }
      if (!groups.size) {
        bookmarkList.appendChild(h('div', { class: 'faint docs__hint' }, '没有匹配的书签'));
        return;
      }
      for (const [group, items] of groups) {
        bookmarkList.appendChild(h('div', { class: 'docs__group' }, group));
        for (const bm of items) {
          const custom = !DEFAULT_BOOKMARKS.includes(bm);
          bookmarkList.appendChild(
            h('div', { class: 'docs__bm', title: bm.url },
              h('button', {
                class: 'docs__bm-open',
                onclick: (e) => (e.metaKey || e.ctrlKey ? openTab(bm.url, bm.name) : navigate(bm.url)),
              }, bm.name),
              custom && h('button', {
                class: 'docs__bm-del', title: '删除这个书签',
                onclick: async () => {
                  const list = (config.get('docs.bookmarks') || []).filter((x) => x.url !== bm.url);
                  await config.set('docs.bookmarks', list);
                  renderBookmarks(filter.value.trim().toLowerCase());
                },
              }, '×'),
            ),
          );
        }
      }
    }

    // ---- 找文档站 ----
    //
    // 预置书签再多也会缺（LangChain 就没有）。这里按名字现搜官方文档，
    // 查 PyPI 的 project_urls、npm 的 homepage 和 DevDocs 索引，都在主进程做。
    const siteFindResults = h('div', { class: 'docs__find-results' });
    const siteFindInput = h('input', {
      class: 'field field--sm',
      placeholder: '搜文档站…（如 langchain）',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) runFind(); },
    });

    async function runFind() {
      const query = siteFindInput.value.trim();
      if (!query) { siteFindResults.textContent = ''; return; }
      siteFindResults.textContent = '';
      siteFindResults.appendChild(h('div', { class: 'faint docs__hint' }, '正在查 PyPI / npm / DevDocs…'));
      const result = await window.toolbox.docs.search(query);
      siteFindResults.textContent = '';
      if (!result.ok) {
        siteFindResults.appendChild(h('div', { class: 'faint docs__hint' }, result.error || '没查到'));
        return;
      }
      if (!result.results.length) {
        siteFindResults.append(
          h('div', { class: 'faint docs__hint' }, '三个源里都没有它的文档地址。'),
          h('button', { class: 'btn btn--sm', onclick: () => navigate(result.fallback) }, '去搜索引擎找'),
        );
        return;
      }
      for (const hit of result.results) {
        siteFindResults.appendChild(
          h('div', { class: 'docs__find-item', title: hit.url },
            h('button', {
              class: 'docs__find-open',
              onclick: () => { navigate(hit.url); },
            },
            h('span', { class: 'docs__find-name' }, hit.name),
            h('span', { class: 'docs__find-url faint' }, hit.url.replace(/^https?:\/\//, '')),
            hit.summary ? h('span', { class: 'docs__find-sum faint' }, hit.summary) : null),
            h('span', { class: 'tag docs__find-src' }, hit.source),
            h('button', {
              class: 'docs__find-add', title: '加到左边的书签里',
              onclick: async () => {
                const list = config.get('docs.bookmarks') || [];
                if (list.some((x) => x.url === hit.url)) return toast('这个已经在书签里了', 'info');
                list.push({ group: '我加的', name: hit.name.split(' · ')[0], url: hit.url });
                await config.set('docs.bookmarks', list);
                renderBookmarks(filter.value.trim().toLowerCase());
                toast(`已加到书签：${hit.name}`, 'good');
              },
            }, '＋'),
          ),
        );
      }
    }

    // ---- 标签页 ----
    const tabStrip = h('div', { class: 'docs__tabs' });
    const viewHost = h('div', { class: 'docs__views' });

    function renderTabs() {
      tabStrip.textContent = '';
      for (const tab of tabs) {
        tabStrip.appendChild(
          h('div', { class: `docs__tab${tab === active ? ' is-active' : ''}`, onclick: () => selectTab(tab) },
            h('span', { class: 'docs__tab-title' }, tab.title || '加载中…'),
            h('button', {
              class: 'docs__tab-close',
              onclick: (e) => { e.stopPropagation(); closeTab(tab); },
            }, '×'),
          ),
        );
      }
      tabStrip.appendChild(h('button', { class: 'docs__tab-add', title: '新标签页', onclick: () => openTab(HOME) }, '＋'));
    }

    function openTab(url, title) {
      const view = h('webview', { partition: PARTITION, src: url });
      const tab = { view, title: title || '', url };
      tabs.push(tab);
      viewHost.appendChild(view);

      view.addEventListener('page-title-updated', (e) => { tab.title = e.title; renderTabs(); persistTabs?.(); });
      view.addEventListener('did-navigate', (e) => { tab.url = e.url; if (tab === active) syncBar(); persistTabs?.(); });
      view.addEventListener('did-navigate-in-page', (e) => { tab.url = e.url; if (tab === active) syncBar(); });
      view.addEventListener('did-start-loading', () => { if (tab === active) syncBar(); });
      view.addEventListener('did-stop-loading', () => { if (tab === active) syncBar(); });
      view.addEventListener('dom-ready', () => { if (tab === active) syncBar(); });

      selectTab(tab);
      return tab;
    }

    function selectTab(tab) {
      active = tab;
      for (const t of tabs) t.view.style.display = t === tab ? 'flex' : 'none';
      renderTabs();
      syncBar();
    }

    function closeTab(tab) {
      const index = tabs.indexOf(tab);
      if (index === -1) return;
      tabs.splice(index, 1);
      tab.view.remove();
      if (!tabs.length) return openTab(HOME);
      if (active === tab) selectTab(tabs[Math.max(0, index - 1)]);
      else renderTabs();
    }

    // ---- 地址栏 ----
    const address = h('input', {
      class: 'field mono',
      placeholder: '网址，或直接输入要搜的东西',
      onkeydown: (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        const url = normalizeUrl(address.value);
        if (url) navigate(url);
      },
    });

    const siteSearch = h('input', {
      class: 'field',
      placeholder: '只在当前文档站内搜…',
      onkeydown: (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        const query = siteSearch.value.trim();
        if (!query || !active) return;
        let host;
        try { host = new URL(active.url).host; } catch { return toast('当前页面地址无效', 'bad'); }
        // 用 site: 限定，避免搜出一堆抄来抄去的二手博客
        navigate(`https://www.bing.com/search?q=${encodeURIComponent(`site:${host} ${query}`)}`);
        siteSearch.value = '';
      },
    });

    const backBtn = h('button', { class: 'btn btn--icon', title: '后退', onclick: () => active?.view.goBack() }, '‹');
    const fwdBtn = h('button', { class: 'btn btn--icon', title: '前进', onclick: () => active?.view.goForward() }, '›');
    const reloadBtn = h('button', { class: 'btn btn--icon', title: '刷新', onclick: () => active?.view.reload() }, '⟳');

    function navigate(url) {
      if (!active) openTab(url);
      else active.view.loadURL(url);
    }

    function syncBar() {
      if (!active) return;
      if (document.activeElement !== address) address.value = active.url;
      try {
        backBtn.disabled = !active.view.canGoBack();
        fwdBtn.disabled = !active.view.canGoForward();
      } catch {
        // webview 还没 attach 到 DOM，导航状态查不了，先都置灰
        backBtn.disabled = fwdBtn.disabled = true;
      }
    }

    // ---- 页内查找 ----
    const findInput = h('input', {
      class: 'field field--sm',
      placeholder: '页内查找',
      oninput: debounce(() => {
        if (!active) return;
        const text = findInput.value;
        if (text) active.view.findInPage(text);
        else active.view.stopFindInPage('clearSelection');
      }, 220),
      onkeydown: (e) => {
        if (e.key === 'Enter' && findInput.value) active?.view.findInPage(findInput.value, { findNext: true });
        if (e.key === 'Escape') closeFind();
      },
    });
    const findBar = h('div', { class: 'docs__find', hidden: true },
      findInput,
      h('button', { class: 'btn btn--sm btn--ghost', onclick: () => closeFind() }, '关闭'),
    );
    function openFind() { findBar.removeAttribute('hidden'); findInput.focus(); findInput.select(); }
    function closeFind() {
      findBar.setAttribute('hidden', '');
      active?.view.stopFindInPage('clearSelection');
    }

    const bar = h('div', { class: 'bar bar--drag' },
      backBtn, fwdBtn, reloadBtn, address, siteSearch,
      h('button', {
        class: 'btn btn--sm', title: '把当前页面加进书签',
        onclick: async () => {
          if (!active) return;
          const list = config.get('docs.bookmarks') || [];
          if (list.some((x) => x.url === active.url)) return toast('已经在书签里了', 'info');
          list.push({ group: '我的', name: active.title || new URL(active.url).host, url: active.url });
          await config.set('docs.bookmarks', list);
          renderBookmarks(filter.value.trim().toLowerCase());
          toast('已加入书签', 'good');
        },
      }, '☆'),
      h('button', {
        class: 'btn btn--sm btn--ghost', title: '用系统浏览器打开',
        onclick: () => active && window.toolbox.shell.openExternal(active.url),
      }, '↗'),
    );

    root.append(
      bar,
      findBar,
      h('div', { class: 'docs__body' },
        h('aside', { class: 'docs__side' },
          h('div', { class: 'docs__side-head' }, siteFindInput),
          siteFindResults,
          h('div', { class: 'docs__side-head' }, filter),
          bookmarkList,
        ),
        h('div', { class: 'docs__main' }, tabStrip, viewHost),
      ),
    );

    renderBookmarks();

    // 恢复上次开着的所有标签页，而不是只留一个 —— 关掉应用再打开，
    // 手边那几篇文档还在原处。
    const savedTabs = config.get('docs.openTabs') || [];
    const savedActive = config.get('docs.activeTab', 0);
    if (savedTabs.length) {
      for (const item of savedTabs) openTab(item.url, item.title);
      selectTab(tabs[Math.min(savedActive, tabs.length - 1)] || tabs[0]);
    } else {
      openTab(config.get('docs.lastUrl') || HOME);
    }

    /** 标签页有增减或跳转就记一次。存的是地址和标题，重开时按这个重建。 */
    function persistTabs() {
      config.set('docs.openTabs', tabs.map((t) => ({ url: t.url, title: t.title })).slice(0, 12));
      config.set('docs.activeTab', Math.max(0, tabs.indexOf(active)));
    }

    // 内嵌页面里 target="_blank" 的链接：主进程拦下来转成事件，在这里开新标签，
    // 而不是弹一个脱离工具箱的窗口。
    window.addEventListener('toolbox:open-url', (e) => {
      openTab(e.detail.url);
      ctx.goto('docs');
    });

    root.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); openFind(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') { e.preventDefault(); address.focus(); address.select(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'w' && tabs.length > 1) { e.preventDefault(); closeTab(active); }
    });

    return {
      deactivate: () => { if (active) config.set('docs.lastUrl', active.url); persistTabs(); },
    };
  },
};
