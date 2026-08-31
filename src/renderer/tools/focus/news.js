import { h, toast } from '../../core/ui.js';
import { createSiteGrid } from '../../core/sitegrid.js';

/** 主进程能直接抓的 RSS/Atom 源：快报列表用。预置的都是国内网络实测可达的。 */
const FEEDS = [
  { id: 'solidot', name: 'Solidot', url: 'https://www.solidot.org/index.rss' },
  { id: 'geekpark', name: '极客公园', url: 'https://www.geekpark.net/rss' },
  { id: 'ithome', name: 'IT之家', url: 'https://www.ithome.com/rss/' },
  { id: 'ifanr', name: '爱范儿', url: 'https://www.ifanr.com/feed' },
  { id: 'infoq', name: 'InfoQ', url: 'https://www.infoq.cn/feed' },
  { id: 'sspai', name: '少数派', url: 'https://sspai.com/feed' },
];

/** 没有可用 RSS（或反爬拦 RSS 但真浏览器能过）的站点：整个热榜内嵌进来。 */
const HOT_SITES = [
  { name: '知乎热榜', url: 'https://www.zhihu.com/hot', desc: '知乎全站热榜', emoji: '📜' },
  { name: '抖音热榜', url: 'https://www.douyin.com/hot', desc: '抖音热点榜', emoji: '🎵' },
  { name: '贴吧', url: 'https://tieba.baidu.com', desc: '百度贴吧', emoji: '💬' },
  { name: 'linux.do', url: 'https://linux.do', desc: 'Linux / AI 中文社区', emoji: '🐧' },
  { name: 'Stack Overflow', url: 'https://stackoverflow.com/questions', desc: '全球开发者问答', emoji: '💻' },
  { name: '机器之心', url: 'https://www.jiqizhixin.com', desc: 'AI 行业新闻', emoji: '🤖' },
];

const PARTITION = 'persist:focus';

function timeAgo(at) {
  if (!at) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

/**
 * 快报：RSS 条目列表。点条目在下方内嵌浏览器里读原文，不跳出应用。
 * 条目缓存在本地，断网也能看上次的。
 */
function createDigest(host, ctx) {
  const { config } = ctx;
  const items = new Map(); // link -> item（含来源名）
  let activeFeed = 'all';
  let reader = null;

  const listEl = h('div', { class: 'news__list' });
  const chipsEl = h('div', { class: 'news__chips' });
  const statusEl = h('span', { class: 'faint' }, '');
  const readerHost = h('div', { class: 'research__views', hidden: true });
  const readerBar = h('div', { class: 'bar research__viewbar', hidden: true },
    h('button', { class: 'btn btn--icon', title: '返回列表', onclick: () => closeReader() }, '‹'),
    h('span', { class: 'faint news__reader-title' }),
    h('span', { style: { flex: 1 } }),
    h('button', {
      class: 'btn btn--sm btn--ghost', title: '用系统浏览器打开',
      onclick: () => readerUrl && window.toolbox.shell.openExternal(readerUrl),
    }, '↗'),
  );
  let readerUrl = null;

  function openReader(item) {
    readerUrl = item.link;
    readerBar.children[1].textContent = item.title;
    if (!reader) {
      reader = h('webview', { partition: PARTITION });
      readerHost.appendChild(reader);
    }
    reader.src = item.link;
    readerBar.removeAttribute('hidden');
    readerHost.removeAttribute('hidden');
    listEl.setAttribute('hidden', '');
    chipsEl.setAttribute('hidden', '');
  }

  function closeReader() {
    readerUrl = null;
    readerBar.setAttribute('hidden', '');
    readerHost.setAttribute('hidden', '');
    listEl.removeAttribute('hidden');
    chipsEl.removeAttribute('hidden');
  }

  function render() {
    listEl.textContent = '';
    const shown = [...items.values()]
      .filter((item) => activeFeed === 'all' || item.source === activeFeed)
      .sort((a, b) => b.at - a.at);
    if (!shown.length) {
      listEl.appendChild(h('div', { class: 'faint', style: { padding: '24px 18px' } },
        '还没有内容。点右上角「刷新」抓一遍各源的最新条目。'));
      return;
    }
    for (const item of shown.slice(0, 120)) {
      listEl.appendChild(h('div', { class: 'news__item', onclick: () => openReader(item) },
        h('span', { class: 'news__source' }, item.source),
        h('span', { class: 'news__title' }, item.title),
        h('span', { class: 'news__time faint' }, timeAgo(item.at)),
      ));
    }
  }

  function renderChips() {
    chipsEl.textContent = '';
    chipsEl.appendChild(h('button', {
      class: `btn btn--sm ${activeFeed === 'all' ? 'is-active' : ''}`,
      onclick: () => { activeFeed = 'all'; renderChips(); render(); },
    }, '全部'));
    for (const feed of FEEDS) {
      chipsEl.appendChild(h('button', {
        class: `btn btn--sm ${activeFeed === feed.id ? 'is-active' : ''}`,
        onclick: () => { activeFeed = feed.id; renderChips(); render(); },
      }, feed.name));
    }
  }

  async function refresh() {
    statusEl.textContent = '抓取中…';
    const results = await Promise.all(FEEDS.map(async (feed) => {
      const res = await window.toolbox.news.fetchFeed(feed.url);
      return { feed, res };
    }));
    const failures = [];
    for (const { feed, res } of results) {
      if (!res.ok) {
        failures.push(`${feed.name}: ${res.error}`);
        continue;
      }
      for (const item of res.items) {
        if (!items.has(item.link)) items.set(item.link, { ...item, source: feed.name });
      }
    }
    // 本地留一份快照，断网也能翻上次的内容
    config.set('focus.newsCache', [...items.values()].slice(0, 400));
    statusEl.textContent = failures.length ? `部分失败：${failures.join('；')}` : `更新于 ${new Date().toLocaleTimeString()}`;
    render();
    if (failures.length === FEEDS.length) toast('所有源都没抓到，检查网络', 'bad');
  }

  const cached = config.get('focus.newsCache') || [];
  for (const item of cached) {
    if (item && item.link && !items.has(item.link)) items.set(item.link, item);
  }

  host.append(
    h('div', { class: 'bar' },
      chipsEl,
      h('span', { style: { flex: 1 } }),
      statusEl,
      h('button', { class: 'btn btn--sm btn--primary', onclick: () => refresh() }, '刷新'),
    ),
    readerBar,
    listEl,
    readerHost,
  );

  renderChips();
  render();
  if (!cached.length) refresh();
}

/** 情报：RSS 快报 + 热榜内嵌，两个小页签切换。 */
export function createNews(root, ctx) {
  const { config } = ctx;
  const panels = new Map();
  let current = config.get('focus.newsTab', 'digest');

  const tabs = [
    { id: 'digest', label: '快报' },
    { id: 'hot', label: '热榜' },
  ];

  const tabBar = h('div', { class: 'research__subbar', style: { marginLeft: '0' } });
  const body = h('div', { class: 'research__subbody' });

  const factories = {
    digest: (panel) => createDigest(panel, ctx),
    hot: (panel) => createSiteGrid(panel, {
      presets: HOT_SITES,
      configKey: 'focus.newsSites',
      cachePrefix: 'focus.newsFavicons.',
      partition: PARTITION,
      config,
    }),
  };

  function select(id) {
    current = id;
    config.set('focus.newsTab', id);
    for (const btn of tabBar.children) btn.classList.toggle('is-active', btn.dataset.tab === id);
    if (!panels.has(id)) {
      const panel = h('div', { class: 'research__panel' });
      factories[id](panel);
      panels.set(id, panel);
      body.appendChild(panel);
    }
    for (const [pid, panel] of panels) panel.style.display = pid === id ? 'flex' : 'none';
  }

  for (const t of tabs) {
    tabBar.appendChild(h('button', {
      class: 'btn btn--sm research__subbtn',
      dataset: { tab: t.id },
      onclick: () => select(t.id),
    }, t.label));
  }

  root.append(h('div', { class: 'bar' }, tabBar), body);
  select(tabs.some((t) => t.id === current) ? current : 'digest');
}
