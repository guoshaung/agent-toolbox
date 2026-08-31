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
const READ_LIMIT = 500;

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
 * 快报：看过即消化——点开的条目从未读流里消失，但进「已读回溯」可随时翻旧账。
 * 条目带配图缩略图（主进程代取 + 缩放缓存）；断网也能看本地快照。
 */
function createDigest(host, ctx) {
  const { config } = ctx;
  const items = new Map(); // link -> item（含来源名）
  let activeFeed = 'all';
  let view = 'unread'; // unread | read
  let reader = null;
  let thumbObserver = null;

  const readMap = config.get('focus.newsRead') || {};

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

  // 缩略图懒加载：进视口才向主进程要图（代取 + 缩放 + 磁盘缓存都在那边）
  function observeThumbs() {
    if (thumbObserver) thumbObserver.disconnect();
    thumbObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        thumbObserver.unobserve(el);
        window.toolbox.news.image(el.dataset.src).then((dataUrl) => {
          if (dataUrl) el.src = dataUrl;
          else el.classList.add('is-empty');
        });
      }
    }, { root: listEl, rootMargin: '120px' });
    for (const el of listEl.querySelectorAll('img[data-src]')) thumbObserver.observe(el);
  }

  function persistRead() {
    const entries = Object.entries(readMap)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, READ_LIMIT);
    config.set('focus.newsRead', Object.fromEntries(entries));
  }

  function markRead(item) {
    if (!readMap[item.link]) {
      readMap[item.link] = { t: item.title, s: item.source, at: Date.now(), img: item.image || '' };
      persistRead();
    }
  }

  function openReader(item) {
    markRead(item);
    readerUrl = item.link;
    readerBar.children[1].textContent = item.title;
    if (!reader) {
      reader = h('webview', { partition: PARTITION });
      readerHost.appendChild(reader);
    }
    if (reader.getAttribute('src') !== item.link) reader.src = item.link;
    readerBar.removeAttribute('hidden');
    readerHost.removeAttribute('hidden');
    listEl.setAttribute('hidden', '');
    chipsEl.setAttribute('hidden', '');
    render(); // 未读流里去掉它
  }

  function closeReader() {
    readerUrl = null;
    readerBar.setAttribute('hidden', '');
    readerHost.setAttribute('hidden', '');
    listEl.removeAttribute('hidden');
    chipsEl.removeAttribute('hidden');
  }

  function renderItem(item, readAt) {
    const row = h('div', { class: 'news__item', onclick: () => openReader(item) });
    if (item.image) {
      row.appendChild(h('img', { class: 'news__thumb', 'data-src': item.image, alt: '' }));
    } else {
      row.appendChild(h('span', { class: 'news__thumb news__thumb--ph' }, (item.source || '·').slice(0, 1)));
    }
    row.appendChild(h('div', { class: 'news__main' },
      h('div', { class: 'news__meta' },
        h('span', { class: 'news__source' }, item.source),
        h('span', { class: 'news__time faint' }, readAt ? `读过 · ${timeAgo(readAt)}` : timeAgo(item.at)),
      ),
      h('span', { class: 'news__title' }, item.title),
    ));
    return row;
  }

  function render() {
    listEl.textContent = '';
    const sourceFiltered = (item) => activeFeed === 'all' || item.source === activeFeed;
    let shown;
    if (view === 'unread') {
      shown = [...items.values()].filter((item) => !readMap[item.link] && sourceFiltered(item))
        .sort((a, b) => b.at - a.at)
        .slice(0, 120);
    } else {
      shown = Object.entries(readMap)
        .filter(([, r]) => activeFeed === 'all' || r.s === activeFeed)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, 200)
        .map(([link, r]) => ({ link, title: r.t, source: r.s, at: r.at, image: r.img }));
    }
    if (!shown.length) {
      listEl.appendChild(h('div', { class: 'faint', style: { padding: '24px 18px' } },
        view === 'unread' ? '没有未读。点「刷新」抓最新的，或去「已读回溯」翻旧账。' : '还没有读过的条目。'));
      return;
    }
    for (const item of shown) {
      listEl.appendChild(renderItem(item, view === 'read' ? readMap[item.link]?.at : 0));
    }
    observeThumbs();
  }

  function renderChips() {
    chipsEl.textContent = '';
    const views = [
      { id: 'unread', label: '未读' },
      { id: 'read', label: '已读回溯' },
    ];
    for (const v of views) {
      chipsEl.appendChild(h('button', {
        class: `btn btn--sm ${view === v.id ? 'is-active' : ''}`,
        onclick: () => { view = v.id; renderChips(); render(); },
      }, v.label));
    }
    chipsEl.appendChild(h('span', { class: 'news__chips-sep' }));
    chipsEl.appendChild(h('button', {
      class: `btn btn--sm ${activeFeed === 'all' ? 'is-active' : ''}`,
      onclick: () => { activeFeed = 'all'; renderChips(); render(); },
    }, '全部源'));
    for (const feed of FEEDS) {
      chipsEl.appendChild(h('button', {
        class: `btn btn--sm ${activeFeed === feed.id ? 'is-active' : ''}`,
        onclick: () => { activeFeed = feed.id; renderChips(); render(); },
      }, feed.name));
    }
    viewActionBtn.textContent = view === 'unread' ? '全部已读' : '清空回溯';
    viewActionBtn.title = view === 'unread' ? '把当前未读全部标为已读' : '清空全部已读记录';
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

  const viewActionBtn = h('button', {
    class: 'btn btn--sm',
    onclick: () => {
      if (view === 'unread') {
        for (const item of [...items.values()]) {
          if (activeFeed === 'all' || item.source === activeFeed) markRead(item);
        }
        render();
        toast('都标成已读了', 'good');
      } else if (window.confirm('清空全部已读回溯记录？')) {
        for (const key of Object.keys(readMap)) delete readMap[key];
        persistRead();
        render();
      }
    },
  });

  host.append(
    h('div', { class: 'bar' },
      chipsEl,
      h('span', { style: { flex: 1 } }),
      statusEl,
      viewActionBtn,
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
