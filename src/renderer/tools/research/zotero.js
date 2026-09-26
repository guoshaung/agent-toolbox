import { h, toast } from '../../core/ui.js';

const META_KEY = 'research.litMeta';
const COLLECTIONS_KEY = 'research.libCollections';

/**
 * Zotero 页：把 Zotero 当文献数据库，工具箱只做阅读和 AI。
 *
 * 左边 Zotero 的分类树，中间那个分类里的条目（勾选 → 同步进文献库，PDF 和批注一起过来），
 * 下面是文献库里还没进 Zotero 的论文（勾选 → 送进 Zotero，PDF 一起送）。
 * 两边都按 Zotero 的 key 挂钩，来回同步不会重复。
 */
export function createZoteroPanel(root, ctx) {
  const { config } = ctx;
  const zot = window.toolbox.zotero;
  const lit = window.toolbox.lit;

  let status = null;
  let snap = null;
  let activeCollection = 'all';
  let picked = new Set();
  let pickedLocal = new Set();
  let query = '';
  let busy = false;

  const meta = () => config.get(META_KEY) || {};
  const metaByKey = () => { const m = {}; for (const [file, v] of Object.entries(meta())) if (v?.zotero?.key) m[v.zotero.key] = file; return m; };

  const statusBar = h('div', { class: 'zot__status' });
  const tree = h('div', { class: 'zot__tree' });
  const itemList = h('div', { class: 'zot__items' });
  const itemHead = h('div', { class: 'zot__items-head' });
  const localList = h('div', { class: 'zot__local' });
  const localHead = h('div', { class: 'zot__local-head' });
  const searchInput = h('input', { class: 'field field--sm zot__search', placeholder: '搜标题 / 作者 / DOI', oninput: (e) => { query = e.target.value.trim().toLowerCase(); renderItems(); } });

  root.append(
    statusBar,
    h('div', { class: 'zot__body' },
      h('aside', { class: 'zot__side' }, h('div', { class: 'zot__side-head' }, 'Zotero 分类'), tree),
      h('div', { class: 'zot__main' },
        h('section', { class: 'zot__section' }, itemHead, itemList),
        h('section', { class: 'zot__section zot__section--local' }, localHead, localList),
      ),
    ),
  );

  // ---------- 状态 ----------
  async function refresh(force = false) {
    status = await zot.detect();
    renderStatus();
    if (status.hasDb && status.sqlite) {
      snap = await zot.snapshot(force);
      if (!snap.ok) { toast(snap.error, 'bad'); snap = null; }
    } else snap = null;
    renderTree(); renderItems(); await renderLocal();
  }

  function renderStatus() {
    const s = status || {};
    const chip = (ok, label) => h('span', { class: `tag ${ok ? 'tag--good' : 'tag--warn'}` }, `${ok ? '✓' : '✗'} ${label}`);
    statusBar.replaceChildren(...[
      h('strong', {}, 'Zotero'),
      chip(s.installed, s.installed ? '已安装' : '未安装'),
      chip(s.hasDb, s.hasDb ? '有数据库' : '还没数据目录'),
      chip(s.running, s.running ? '运行中' : '没在运行'),
      h('span', { class: 'faint zot__hint' }, s.hint || ''),
      h('span', { class: 'zot__status-spacer' }),
      !s.running && s.installed ? h('button', { class: 'btn btn--sm', onclick: async () => { const r = await zot.launch(); if (!r.ok) toast(r.error, 'bad'); else { toast('正在打开 Zotero，几秒后自动刷新', 'info'); setTimeout(() => refresh(true), 6000); } } }, '打开 Zotero') : null,
      h('button', { class: 'btn btn--sm btn--ghost', onclick: () => refresh(true) }, '刷新'),
      s.dataDir ? h('span', { class: 'faint mono zot__datadir', title: s.dataDir }, s.dataDir) : null,
    ].filter(Boolean));
  }

  // ---------- 左：分类树 ----------
  function renderTree() {
    if (!snap) { tree.replaceChildren(h('div', { class: 'faint zot__empty' }, status?.hasDb ? '读不到库' : '打开一次 Zotero 就会有数据目录')); return; }
    const withPdf = snap.items.filter((it) => it.pdf).length;
    const node = (id, label, count, depth = 0) => h('button', {
      class: `zot__coll ${activeCollection === id ? 'is-active' : ''}`, style: { paddingLeft: `${8 + depth * 14}px` },
      onclick: () => { activeCollection = id; picked = new Set(); renderTree(); renderItems(); },
    }, h('span', { class: 'zot__coll-name' }, label), h('span', { class: 'faint zot__coll-count' }, String(count)));
    const children = (parent) => snap.collections.filter((c) => (c.parent || null) === parent).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    const walk = (parent, depth) => children(parent).flatMap((c) => [node(c.id, c.name, c.count, depth), ...walk(c.id, depth + 1)]);
    tree.replaceChildren(
      node('all', '全部条目', snap.items.length),
      node('pdf', '有 PDF 的', withPdf),
      node('unsynced', '还没进文献库的', snap.items.filter((it) => it.pdf && !metaByKey()[it.key]).length),
      ...walk(null, 0),
    );
  }

  // ---------- 中：Zotero 条目 ----------
  function visibleItems() {
    if (!snap) return [];
    const byKey = metaByKey();
    return snap.items.filter((it) => {
      if (activeCollection === 'pdf') return it.pdf;
      if (activeCollection === 'unsynced') return it.pdf && !byKey[it.key];
      if (activeCollection !== 'all' && !it.collections.includes(activeCollection)) return false;
      if (query && !`${it.title} ${it.authors.map((a) => `${a.given} ${a.family}`).join(' ')} ${it.doi} ${it.journal}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }

  function renderItems() {
    const items = visibleItems();
    const byKey = metaByKey();
    const pickable = items.filter((it) => it.pdf);
    itemHead.replaceChildren(
      h('div', { class: 'zot__head-row' },
        h('strong', {}, 'Zotero 里的论文'),
        h('span', { class: 'faint' }, snap ? `${items.length} 条` : ''),
        searchInput,
        h('span', { class: 'zot__status-spacer' }),
        h('label', { class: 'zot__check' }, h('input', { type: 'checkbox', checked: pickable.length > 0 && pickable.every((it) => picked.has(it.key)), onchange: (e) => { picked = e.target.checked ? new Set(pickable.map((it) => it.key)) : new Set(); renderItems(); } }), '全选有 PDF 的'),
        h('button', { class: 'btn btn--sm btn--primary', disabled: !picked.size || busy, onclick: () => importPicked() }, picked.size ? `同步到文献库（${picked.size}）` : '同步到文献库'),
      ),
      h('div', { class: 'faint zot__sub' }, 'PDF 拷一份进文献库，书目、标签、Zotero 里画的高亮和批注一起过来；已经同步过的只更新书目。'),
    );
    if (!snap) { itemList.replaceChildren(h('div', { class: 'faint zot__empty' }, '连上 Zotero 后这里列出它的条目')); return; }
    if (!items.length) { itemList.replaceChildren(h('div', { class: 'faint zot__empty' }, snap.items.length ? '这个分类下没有条目' : 'Zotero 文库还是空的。下面可以把文献库的论文送进去，或者在 Zotero 里用浏览器插件收论文。')); return; }
    itemList.replaceChildren(...items.slice(0, 400).map((it) => {
      const file = byKey[it.key];
      return h('div', { class: `zot__item ${picked.has(it.key) ? 'is-picked' : ''}` },
        h('input', { type: 'checkbox', class: 'zot__item-check', disabled: !it.pdf, checked: picked.has(it.key), onchange: (e) => { if (e.target.checked) picked.add(it.key); else picked.delete(it.key); renderItems(); } }),
        h('div', { class: 'zot__item-body' },
          h('div', { class: 'zot__item-title' }, it.title || '（无标题）'),
          h('div', { class: 'zot__item-sub faint' }, [it.authors.slice(0, 3).map((a) => a.family).join(', ') + (it.authors.length > 3 ? ' 等' : ''), it.year, it.journal, it.doi].filter(Boolean).join(' · ')),
          h('div', { class: 'zot__item-tags' },
            it.pdf ? h('span', { class: 'tag' }, `PDF${it.pdf.annotationCount ? ` · ${it.pdf.annotationCount} 条批注` : ''}`) : h('span', { class: 'tag tag--warn' }, '没有 PDF'),
            file ? h('span', { class: 'tag tag--good', title: file }, '已在文献库') : null,
            ...it.collectionNames.map((c) => h('span', { class: 'tag zot__tag-coll' }, c)),
            ...it.tags.slice(0, 4).map((t) => h('span', { class: 'tag' }, t)),
          ),
        ),
        h('div', { class: 'zot__item-actions' },
          h('button', { class: 'btn btn--sm btn--ghost', title: '在 Zotero 里选中它', onclick: () => zot.openItem(it.key) }, '在 Zotero 打开'),
          it.pdf ? h('button', { class: 'btn btn--sm btn--ghost', title: '用 Zotero 的阅读器打开 PDF', onclick: () => zot.openItem(it.key, it.pdf.key) }, '读 PDF') : null,
        ),
      );
    }));
  }

  async function importPicked() {
    if (busy) return;
    busy = true; renderItems();
    try {
      const existingByKey = metaByKey();
      const r = await zot.import([...picked], { existingByKey, withAnnotations: true });
      if (!r.ok) return toast(r.error, 'bad');
      const map = meta();
      let colls = config.get(COLLECTIONS_KEY) || [];
      const collIdByName = () => Object.fromEntries(colls.map((c) => [c.name, c.id]));
      let highlightsAdded = 0;
      for (const entry of r.imported) {
        // Zotero 的分类名照搬成文献库的分类，没有就建
        const ids = [];
        for (const name of entry.collectionNames) {
          const leaf = name.split(' / ').pop();
          if (!collIdByName()[leaf]) colls = [...colls, { id: `c_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 6)}`, name: leaf }];
          ids.push(collIdByName()[leaf]);
        }
        const prev = map[entry.file] || {};
        map[entry.file] = { ...prev, ...entry.meta, addedAt: prev.addedAt || new Date().toISOString(), collections: [...new Set([...(prev.collections || []), ...ids])] };
        if (entry.highlights.length) {
          const key = `research.litHighlights.${entry.file}`;
          const list = config.get(key) || [];
          const have = new Set(list.map((x) => x.id));
          const fresh = entry.highlights.filter((x) => !have.has(x.id));
          if (fresh.length) { await config.set(key, [...fresh, ...list]); highlightsAdded += fresh.length; }
        }
      }
      await config.set(COLLECTIONS_KEY, colls);
      await config.set(META_KEY, map);
      const fresh = r.imported.filter((e) => !e.existed).length;
      toast(`同步了 ${r.imported.length} 篇（新拷 ${fresh} 篇 PDF，${highlightsAdded} 条批注）${r.skipped.length ? `，跳过 ${r.skipped.length} 篇没 PDF 的` : ''}`, 'good', 5000);
      picked = new Set();
      ctx.notifyLibraryChanged?.();
    } finally { busy = false; await refresh(); }
  }

  // ---------- 下：文献库 → Zotero ----------
  async function renderLocal() {
    const files = await lit.list();
    const map = meta();
    const pending = files.filter((f) => /\.pdf$/i.test(f.file) && !map[f.file]?.zotero?.key);
    const targetSelect = h('select', { class: 'field field--sm zot__target' },
      h('option', { value: 'L1' }, '我的文库（根）'),
      ...(snap?.collections || []).map((c) => h('option', { value: `C${c.id}` }, c.path)),
    );
    const savedTarget = config.get('research.zotero.target', 'L1');
    if ([...targetSelect.options].some((o) => o.value === savedTarget)) targetSelect.value = savedTarget;
    targetSelect.addEventListener('change', () => config.set('research.zotero.target', targetSelect.value));
    localHead.replaceChildren(
      h('div', { class: 'zot__head-row' },
        h('strong', {}, '文献库里还没进 Zotero 的'),
        h('span', { class: 'faint' }, `${pending.length} 篇`),
        h('span', { class: 'zot__status-spacer' }),
        h('label', { class: 'zot__check' }, h('input', { type: 'checkbox', checked: pending.length > 0 && pending.every((f) => pickedLocal.has(f.file)), onchange: (e) => { pickedLocal = e.target.checked ? new Set(pending.map((f) => f.file)) : new Set(); renderLocal(); } }), '全选'),
        h('span', { class: 'faint' }, '放到'), targetSelect,
        h('button', { class: 'btn btn--sm btn--primary', disabled: !pickedLocal.size || busy || !status?.running, title: status?.running ? '' : '先打开 Zotero', onclick: () => sendPicked(targetSelect.value) }, pickedLocal.size ? `送进 Zotero（${pickedLocal.size}）` : '送进 Zotero'),
      ),
      h('div', { class: 'faint zot__sub' }, '书目 + PDF 一起送，走 Zotero 桌面端的连接器，不用 API key。本地副本留着，之后两边按 Zotero 的 key 挂钩。'),
    );
    if (!pending.length) { localList.replaceChildren(h('div', { class: 'faint zot__empty' }, files.length ? '文献库里的论文都已经在 Zotero 里了' : '文献库是空的')); return; }
    localList.replaceChildren(...pending.map((f) => {
      const m = map[f.file] || {};
      const thin = !m.title || !m.year;
      return h('div', { class: `zot__item ${pickedLocal.has(f.file) ? 'is-picked' : ''}` },
        h('input', { type: 'checkbox', class: 'zot__item-check', checked: pickedLocal.has(f.file), onchange: (e) => { if (e.target.checked) pickedLocal.add(f.file); else pickedLocal.delete(f.file); renderLocal(); } }),
        h('div', { class: 'zot__item-body' },
          h('div', { class: 'zot__item-title' }, m.title || f.file.replace(/\.pdf$/i, '')),
          h('div', { class: 'zot__item-sub faint' }, [(m.authors || []).slice(0, 3).map((a) => a.family).join(', '), m.year, m.journal, m.doi].filter(Boolean).join(' · ') || '还没有书目信息'),
          thin ? h('div', { class: 'zot__item-tags' }, h('span', { class: 'tag tag--warn' }, '书目不全，送过去 Zotero 里也是残的；先在「文献库 → 详情」里补一下')) : null,
        ),
      );
    }));
  }

  async function sendPicked(target) {
    if (busy) return;
    busy = true; await renderLocal();
    try {
      const map = meta();
      const entries = [...pickedLocal].map((file) => ({ file, meta: map[file] || {} }));
      const r = await zot.send(entries, { target });
      if (!r.ok) return toast(r.error, 'bad', 6000);
      toast(`送进去了 ${r.count} 篇，Zotero 正在取 PDF…`, 'good');
      // 附件由 Zotero 异步取，过几秒按标题 / DOI 找回 key 挂钩
      await new Promise((res) => setTimeout(res, 4000));
      const back = await zot.matchBack(entries);
      if (back.ok) {
        const map2 = meta();
        let linked = 0;
        for (const [file, z] of Object.entries(back.matched)) { map2[file] = { ...(map2[file] || {}), zotero: z }; linked += 1; }
        await config.set(META_KEY, map2);
        if (linked < entries.length) toast(`${entries.length - linked} 篇还没在 Zotero 里对上号，过一会儿点「刷新」再试`, 'info', 5000);
      }
      pickedLocal = new Set();
      ctx.notifyLibraryChanged?.();
    } finally { busy = false; await refresh(true); }
  }

  refresh();
  return { activate: () => refresh(), refresh: () => refresh() };
}
