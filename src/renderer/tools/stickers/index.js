import { h, toast, debounce } from '../../core/ui.js';
import { createPlayground } from './playground.js';
import { openWebPanel } from '../../core/webpanel.js';

// B 站的「表情制作」网页，好用又免费，直接在工具箱里内嵌打开做表情
const MAKER_URL = 'https://www.bilibili.com/toy/stickers-maker-2/index.html';

/**
 * 表情包管理：本地库 + Tenor 在线搜索。
 * - 本地库：导入 / 分类 / 标签 / 复制（mac 复制文件，粘微信带动图）/ 删除。
 * - 在线搜索：Tenor（需在设置里填免费 Key），一键存进本地库。
 * - 同步：显式推到你自己的私有 GitHub 仓库，绝不碰工具箱这个公开仓库。
 */

const sx = () => window.toolbox.stickers;

export default {
  id: 'stickers',
  title: '表情',
  icon: 'image',
  hint: '表情包管理：本地库 + 在线搜索 + 私有仓库同步',

  create(root, ctx) {
    let view = 'lib';                // lib | online
    let category = '全部';
    let cats = {};                   // 本地分类计数
    let online = { q: '', results: [], next: '', loading: false };

    const grid = h('div', { class: 'stk__grid' });
    const chips = h('div', { class: 'stk__chips' });
    const status = h('span', { class: 'stk__status' });
    const searchInput = h('input', { class: 'field stk__search', type: 'search', placeholder: '搜表情包，如「狗头 / 笑哭 / 摸鱼」', style: { display: 'none' } });

    // ---- 顶部栏 ----
    const btnLib = h('button', { class: 'btn', onclick: () => switchView('lib') }, '📁 本地库');
    const btnOnline = h('button', { class: 'btn', onclick: () => switchView('online') }, '🔍 在线找');
    const btnPlay = h('button', { class: 'btn', onclick: () => switchView('play') }, '🎨 玩法');
    const btnMaker = h('button', { class: 'btn', title: 'B 站表情制作网页（工具箱内打开）', onclick: () => openWebPanel({ url: MAKER_URL, title: '在线做表情', partition: 'persist:stickers-maker' }) }, '🖌 在线做');
    const btnImport = h('button', { class: 'btn', onclick: doImport }, '＋ 导入');
    const btnSettings = h('button', { class: 'btn', title: '设置 Tenor Key / 同步', onclick: openSettings }, '⚙');

    const bar = h('div', { class: 'bar bar--drag' },
      h('strong', {}, '表情包'),
      h('div', { class: 'bar__spacer' }),
      btnLib, btnOnline, btnPlay, btnMaker, btnImport, btnSettings, status,
    );

    const settingsPane = h('div', { class: 'stk__settings', style: { display: 'none' } });
    const playPane = h('div', { class: 'stk__play', style: { display: 'none' } });
    root.append(bar, searchInput, chips, settingsPane, grid, playPane);

    function switchView(v) {
      view = v;
      btnLib.classList.toggle('btn--on', v === 'lib');
      btnOnline.classList.toggle('btn--on', v === 'online');
      btnPlay.classList.toggle('btn--on', v === 'play');
      btnImport.style.display = v === 'lib' ? '' : 'none';
      searchInput.style.display = v === 'online' ? '' : 'none';
      chips.style.display = v === 'play' ? 'none' : '';
      grid.style.display = v === 'play' ? 'none' : '';
      playPane.style.display = v === 'play' ? '' : 'none';
      if (v === 'play') { createPlayground(playPane, { reloadLib: loadLib }); return; }
      if (v === 'lib') loadLib();
      else { loadOnlineChips(); if (!online.results.length) doSearch(''); else renderOnline(); }
    }

    // ---------- 本地库 ----------
    async function loadLib() {
      const r = await sx().list({ category });
      cats = r.categories || {};
      renderChips();
      renderLib(r.items || []);
      status.textContent = `${r.total || 0} 个`;
    }

    function renderChips() {
      if (view !== 'lib') return;
      chips.style.display = '';
      chips.replaceChildren();
      const all = ['全部', ...Object.keys(cats).sort((a, b) => cats[b] - cats[a])];
      for (const c of all) {
        const n = c === '全部' ? Object.values(cats).reduce((a, b) => a + b, 0) : cats[c];
        chips.append(h('button', {
          class: `tag stk__chip ${category === c ? 'tag--on' : ''}`,
          onclick: () => { category = c; loadLib(); },
        }, `${c} ${n || 0}`));
      }
    }

    function renderLib(items) {
      grid.replaceChildren();
      if (!items.length) { grid.append(h('div', { class: 'empty' }, category === '全部' ? '还没有表情包。点「导入」或去「在线找」。也可以直接把图片拖进来。' : `「${category}」分类下还没有。`)); return; }
      for (const it of items) grid.append(libCard(it));
    }

    function libCard(it) {
      const img = h('img', { class: 'stk__img', src: it.url, loading: 'lazy', alt: it.title || '' });
      const actions = h('div', { class: 'stk__actions' },
        h('button', { class: 'stk__act', title: '复制（粘到聊天里）', onclick: () => copyItem(it) }, '📋'),
        h('button', { class: 'stk__act', title: '分类 / 标签', onclick: () => editItem(it, card) }, '🏷'),
        h('button', { class: 'stk__act', title: '在访达显示', onclick: () => sx().reveal(it.id) }, '📂'),
        h('button', { class: 'stk__act stk__act--danger', title: '删除', onclick: () => delItem(it, card) }, '🗑'),
      );
      const meta = h('div', { class: 'stk__meta' }, h('span', { class: 'stk__cat' }, it.category || '未分类'));
      const card = h('div', { class: 'stk__card', title: it.title || '' }, img, actions, meta);
      return card;
    }

    async function copyItem(it) {
      const r = await sx().copy(it.id);
      if (r?.ok) toast(r.as === 'file' ? '已复制文件，去聊天窗口粘贴（动图能动）' : '已复制图片', 'good');
      else toast(r?.error || '复制失败', 'bad');
    }

    function editItem(it, card) {
      const existing = Object.keys(cats).filter((c) => c && c !== '未分类');
      const listId = `stk-cats-${it.id.slice(0, 8)}`;
      const catInput = h('input', { class: 'field', list: listId, value: it.category || '未分类', placeholder: '分类' });
      const dl = h('datalist', { id: listId }, ...existing.map((c) => h('option', { value: c })));
      const tagInput = h('input', { class: 'field', value: (it.tags || []).join(' '), placeholder: '标签，空格分隔' });
      const pop = h('div', { class: 'stk__edit' },
        dl,
        h('label', {}, '分类', catInput),
        h('label', {}, '标签', tagInput),
        h('div', { class: 'stk__editbtns' },
          h('button', { class: 'btn btn--on', onclick: save }, '保存'),
          h('button', { class: 'btn', onclick: () => pop.remove() }, '取消'),
        ),
      );
      card.append(pop);
      catInput.focus();
      async function save() {
        const r = await sx().update(it.id, { category: catInput.value.trim() || '未分类', tags: tagInput.value.split(/\s+/).filter(Boolean) });
        if (r?.ok) { toast('已保存', 'good'); pop.remove(); loadLib(); }
        else toast(r?.error || '保存失败', 'bad');
      }
    }

    function delItem(it, card) {
      const del = card.querySelector('.stk__act--danger');
      if (del.dataset.armed) {
        sx().remove(it.id).then((r) => { if (r?.ok) { card.remove(); loadLib(); } else toast(r?.error || '删除失败', 'bad'); });
        return;
      }
      del.dataset.armed = '1'; del.textContent = '确认?'; del.classList.add('stk__act--armed');
      setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = '🗑'; del.classList.remove('stk__act--armed'); } }, 2500);
    }

    async function doImport() {
      const r = await sx().import();
      if (r?.canceled) return;
      if (r?.ok) { toast(`导入 ${r.added} 个`, 'good'); loadLib(); }
      else toast(r?.error || '导入失败', 'bad');
    }

    // 拖拽导入
    root.addEventListener('dragover', (e) => { if (view === 'lib') { e.preventDefault(); root.classList.add('stk__drop'); } });
    root.addEventListener('dragleave', () => root.classList.remove('stk__drop'));
    root.addEventListener('drop', async (e) => {
      root.classList.remove('stk__drop');
      if (view !== 'lib') return;
      e.preventDefault();
      const paths = [...(e.dataTransfer?.files || [])].map((f) => window.toolbox.files.getPathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      const r = await sx().importPaths(paths, { category: category === '全部' ? '未分类' : category });
      if (r?.ok) { toast(`导入 ${r.added} 个`, 'good'); loadLib(); }
    });

    // ---------- 在线搜索（Tenor） ----------
    async function loadOnlineChips() {
      chips.style.display = '';
      chips.replaceChildren(h('span', { class: 'stk__status' }, '加载分类…'));
      const r = await sx().categories();
      chips.replaceChildren();
      if (!r?.ok) { chips.append(h('span', { class: 'stk__status' }, r?.error === 'no-key' ? '先在 ⚙ 里填 Tenor Key' : '分类加载失败')); return; }
      for (const t of (r.tags || []).slice(0, 16)) {
        chips.append(h('button', { class: 'tag stk__chip', onclick: () => { searchInput.value = t.name; doSearch(t.name); } }, t.name));
      }
    }

    const onSearch = debounce((v) => doSearch(v), 450);
    searchInput.addEventListener('input', () => onSearch(searchInput.value.trim()));
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(searchInput.value.trim()); });

    async function doSearch(q) {
      online.q = q; online.loading = true;
      grid.replaceChildren(h('div', { class: 'empty' }, '搜索中…'));
      const r = await sx().search({ q, limit: 24 });
      online.loading = false;
      if (!r?.ok) {
        grid.replaceChildren(h('div', { class: 'empty' }, r?.error === 'no-key' ? '还没配 Tenor Key —— 点右上角 ⚙，按提示去 Google 申请一个免费 Key 填进来。' : `搜索失败：${r?.error || ''}`));
        return;
      }
      online.results = r.results; online.next = r.next;
      renderOnline();
    }

    async function loadMore() {
      if (online.loading || !online.next) return;
      online.loading = true;
      const r = await sx().search({ q: online.q, pos: online.next, limit: 24 });
      online.loading = false;
      if (r?.ok) { online.results = online.results.concat(r.results); online.next = r.next; renderOnline(); }
    }

    function renderOnline() {
      grid.replaceChildren();
      if (!online.results.length) { grid.append(h('div', { class: 'empty' }, '没找到，换个词试试。')); return; }
      for (const it of online.results) grid.append(onlineCard(it));
      if (online.next) grid.append(h('button', { class: 'btn stk__more', onclick: loadMore }, '加载更多'));
    }

    function onlineCard(it) {
      const img = h('img', { class: 'stk__img', src: it.preview, loading: 'lazy', alt: it.desc || '' });
      const actions = h('div', { class: 'stk__actions' },
        h('button', { class: 'stk__act', title: '存进本地库', onclick: () => saveOnline(it, card) }, '⬇'),
      );
      const card = h('div', { class: 'stk__card', title: it.desc || '' }, img, actions);
      return card;
    }

    async function saveOnline(it, card) {
      const btn = card.querySelector('.stk__act');
      btn.textContent = '…';
      const r = await sx().saveFromUrl({ url: it.full || it.preview, title: it.desc, category: online.q || '在线', tags: online.q ? online.q.split(/\s+/) : [] });
      if (r?.ok) { btn.textContent = '✓'; toast('已存进本地库', 'good'); }
      else { btn.textContent = '⬇'; toast(r?.error || '保存失败', 'bad'); }
    }

    // ---------- 设置 ----------
    let settingsOpen = false;
    async function openSettings() {
      settingsOpen = !settingsOpen;
      settingsPane.style.display = settingsOpen ? '' : 'none';
      if (!settingsOpen) return;
      settingsPane.replaceChildren(h('div', { class: 'stk__status' }, '读取…'));
      const [key, sync] = await Promise.all([sx().keyStatus(), sx().syncStatus()]);

      const keyInput = h('input', { class: 'field', type: 'password', placeholder: key.hasKey ? '已保存（重填可替换）' : '粘贴 Tenor API Key' });
      const keyRow = h('div', { class: 'stk__setrow' },
        h('label', {}, 'Tenor API Key', keyInput),
        h('button', { class: 'btn btn--on', onclick: async () => {
          const r = await sx().saveKey(keyInput.value);
          if (r?.ok) { toast('已加密保存', 'good'); keyInput.value = ''; loadOnlineChips(); }
          else toast(r?.error || '保存失败', 'bad');
        } }, '保存'),
        h('a', { class: 'stk__link', href: '#', onclick: (e) => { e.preventDefault(); window.toolbox.shell.openExternal('https://developers.google.com/tenor/guides/quickstart'); } }, '去申请（免费）'),
      );

      const remoteInput = h('input', { class: 'field', value: sync.remote || '', placeholder: 'git@github.com:你/表情包库.git（私有仓库）' });
      const syncRow = h('div', { class: 'stk__setrow' },
        h('label', {}, '同步到私有仓库', remoteInput),
        h('button', { class: 'btn', onclick: async () => { const r = await sx().setRemote(remoteInput.value); toast(r?.ok ? '已记住仓库地址' : (r?.error || '不对'), r?.ok ? 'good' : 'bad'); } }, '记住'),
        h('button', { class: 'btn btn--on', onclick: async (e) => {
          e.target.textContent = '推送中…';
          const r = await sx().sync();
          e.target.textContent = '同步';
          if (r?.ok) toast('已同步到私有仓库', 'good');
          else toast(r?.error === 'no-remote' ? '先填仓库地址并「记住」' : (r?.error || '同步失败'), 'bad');
        } }, '同步'),
      );

      settingsPane.replaceChildren(
        keyRow,
        h('p', { class: 'stk__hint' }, 'Tenor 是 Google 的 GIF 库，Key 免费。填好后「在线找」才能用。Key 用系统安全存储加密，不会明文外传。'),
        syncRow,
        h('p', { class: 'stk__hint' }, `表情包压缩后存本地，同步只往你填的这个**私有**仓库推（需要本机已配好 git 凭据）。${sync.lastAt ? '上次同步：' + new Date(sync.lastAt).toLocaleString() : '还没同步过'}${sync.dirty ? ' · 有新变化待同步' : ''}`),
        h('button', { class: 'btn stk__folder', onclick: () => sx().openFolder() }, '打开本地表情包文件夹'),
      );
    }

    void ctx;
    switchView('lib');
    return { activate() { if (view === 'lib') loadLib(); } };
  },
};
