import { h, toast } from '../../core/ui.js';

/**
 * 收纳：给「新建文件夹随手放」的人。
 *
 * 三个页签：
 *  - 归位：主目录 / 桌面 / 下载 三处顶层散落的东西，按去处分组，勾选后一键搬，可撤销
 *  - 刚建的：最近三天在主目录下新建的东西 —— 「我刚建的那个文件夹在哪」
 *  - 看懂项目：拖一个项目进来，告诉你这是什么、怎么跑、从哪个文件读起
 */

const api = () => window.toolbox.tidy;
const fmtAge = (days) => days < 1 ? '今天' : days < 2 ? '昨天' : days < 7 ? `${Math.round(days)} 天前` : days < 30 ? `${Math.round(days / 7)} 周前` : `${Math.round(days / 30)} 个月前`;
const fmtSize = (n) => n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
const short = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');

/** 够用的 Markdown → DOM：标题、列表、代码块、行内代码、粗体。不引库。 */
function md(text) {
  const root = h('div', { class: 'tidy__md' });
  const lines = String(text || '').split('\n');
  let list = null; let pre = null;
  const inline = (s) => {
    const frag = document.createDocumentFragment();
    const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('`')) frag.append(h('code', {}, part.slice(1, -1)));
      else if (part.startsWith('**')) frag.append(h('strong', {}, part.slice(2, -2)));
      else frag.append(part);
    }
    return frag;
  };
  for (const raw of lines) {
    if (raw.startsWith('```')) { if (pre) { root.append(pre); pre = null; } else pre = h('pre', {}, h('code')); continue; }
    if (pre) { pre.firstChild.append(raw + '\n'); continue; }
    const line = raw.trimEnd();
    const hm = line.match(/^(#{1,4})\s+(.*)/);
    if (hm) { list = null; root.append(h('h2', {}, hm[2])); continue; }
    const lm = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (lm) { if (!list) { list = h(/^\s*\d/.test(line) ? 'ol' : 'ul'); root.append(list); } list.append(h('li', {}, inline(lm[1]))); continue; }
    list = null;
    if (line.trim()) root.append(h('p', {}, inline(line)));
  }
  if (pre) root.append(pre);
  return root;
}

export default {
  id: 'tidy',
  title: '收纳',
  icon: 'archive',
  hint: '桌面 / 下载 / 主目录里随手放的东西一键归位；刚建的文件夹在哪；拖个项目进来看懂它',

  create(root, ctx) {
    const config = ctx?.config;
    let tab = 'sort';
    const body = h('div', { class: 'settings__body settings__body--wide' });
    const tabs = h('div', { class: 'tidy__tabs' });
    const tabDefs = [['sort', '归位'], ['recent', '刚建的'], ['learn', '看懂项目']];
    const renderTabs = () => tabs.replaceChildren(...tabDefs.map(([id, label]) => h('button', { class: `btn btn--sm${tab === id ? ' btn--primary' : ''}`, onclick: () => { tab = id; renderTabs(); render(); } }, label)));

    // ---------- 归位 ----------
    let scanData = null;
    const nudgeBox = h('input', { type: 'checkbox', onchange: (e) => api().nudge(e.target.checked) });
    api().nudge().then((r) => { nudgeBox.checked = r.on; });
    const nudgeToggle = h('label', { class: 'home__toggle faint', title: '散落超过 30 项时，每天最多提醒一次' }, nudgeBox, '散落太多时提醒我');
    async function loadScan(ai = false, fresh = false) {
      body.replaceChildren(h('div', { class: 'tidy__empty' }, ai ? '让 AI 认一下那些看不出来的…' : '正在看桌面、下载和主目录…'));
      scanData = await api().scan({ ai, fresh });
      renderSort();
    }
    function renderSort() {
      if (!scanData) return loadScan(false);
      const items = scanData.items;
      const groups = new Map();
      const dupPaths = new Set((scanData.duplicates || []).flatMap((g) => g.extra.map((x) => x.path)));
      for (const it of items) {
        if (it.action === 'keep' || dupPaths.has(it.path)) continue;   // 项目集原地不动；重复的在上面那组
        const key = it.action === 'delete' ? '__delete' : it.action === 'unsure' ? '__unsure' : it.to;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      }
      const checks = new Map();
      // 下载了两遍的：多出来的那份建议扔废纸篓
      const dupEl = (scanData.duplicates || []).length ? h('div', { class: 'tidy__group' },
        h('div', { class: 'tidy__group-head' }, h('strong', {}, '下载了两遍的 —— 多出来的那份扔废纸篓'), h('code', {}, `${scanData.duplicates.reduce((n, g) => n + g.extra.length, 0)} 项 · 省 ${fmtSize(scanData.duplicates.reduce((n, g) => n + g.size * g.extra.length, 0))}`)),
        ...scanData.duplicates.flatMap((g) => g.extra.map((it) => {
          const cb = h('input', { type: 'checkbox', checked: true });
          checks.set(it.path, { cb, it: { ...it, action: 'delete', to: null } });
          return h('div', { class: 'tidy__row' }, cb, h('span', { class: 'tidy__name', title: it.path }, `📄 ${it.name}`), h('span', { class: 'tidy__reason' }, `和 ${g.keep.name} 一样`), h('span', { class: 'tidy__meta' }, fmtSize(it.size)), h('button', { class: 'btn btn--sm', onclick: () => api().reveal(it.path) }, '看看'));
        })),
      ) : null;
      const groupEls = [...groups.entries()].sort(([a], [b]) => (a.startsWith('__') ? 1 : 0) - (b.startsWith('__') ? 1 : 0)).map(([key, list]) => {
        const title = key === '__delete' ? '建议删掉（空文件夹 / 垃圾）' : key === '__unsure' ? '认不出来的 —— 先放「杂项」，或者点右边改' : `搬到 ${short(key)}`;
        const rows = list.map((it) => {
          const cb = h('input', { type: 'checkbox', checked: it.action !== 'unsure' });
          checks.set(it.path, { cb, it });
          return h('div', { class: 'tidy__row' }, cb,
            h('span', { class: `tidy__name${it.careless ? ' is-careless' : ''}`, title: it.path }, `${it.isDir ? '📁 ' : '📄 '}${it.name}`),
            h('span', { class: 'tidy__reason', title: it.reason }, it.reason),
            h('span', { class: 'tidy__meta' }, `${it.where === 'www.macpe.cn' || it.where === '~' ? '主目录' : it.where === 'Desktop' ? '桌面' : it.where === 'Downloads' ? '下载' : it.where} · ${fmtAge(it.ageDays)}${it.size != null ? ' · ' + fmtSize(it.size) : it.count != null ? ` · ${it.count} 项` : ''}`),
            h('button', { class: 'btn btn--sm', onclick: () => api().reveal(it.path) }, '看看'),
          );
        });
        return h('div', { class: 'tidy__group' }, h('div', { class: 'tidy__group-head' }, h('strong', {}, title), h('code', {}, `${list.length} 项`)), ...rows);
      });
      const apply = async () => {
        const moves = [...checks.values()].filter(({ cb }) => cb.checked).map(({ it }) => ({ path: it.path, to: it.to, action: it.action === 'delete' ? 'delete' : 'move' }));
        if (!moves.length) return toast('先勾几个', 'info');
        const r = await api().apply(moves);
        toast(r.errors.length ? `搬了 ${r.done.length} 项，${r.errors.length} 项失败：${r.errors[0]}` : `搬好了 ${r.done.length} 项（可撤销）`, r.errors.length ? 'bad' : 'good', 5000);
        loadScan(false);
      };
      body.replaceChildren(
        h('section', { class: 'card' },
          h('div', { class: 'tidy__stat' },
            h('span', {}, '散落的东西：', h('b', {}, String(items.filter((x) => x.action !== 'keep').length))),
            items.some((x) => x.action === 'keep') ? h('span', { class: 'faint', title: items.filter((x) => x.action === 'keep').map((x) => x.name).join('\n') }, `（另有 ${items.filter((x) => x.action === 'keep').length} 个装着代码仓库的文件夹，原地不动，鼠标放这里看是哪些）`) : null,
            h('span', {}, '代码项目会去 ', h('code', {}, short(scanData.destinations.project))),
            h('button', { class: 'btn btn--sm', onclick: async () => { const r = await api().setCodeDir(); if (r.ok) loadScan(false); } }, '改'),
            h('span', { class: 'faint' }, '其余去 ~/收纳/ 下按类型分的文件夹'),
            nudgeToggle,
          ),
          h('div', { class: 'settings__actions', style: { marginTop: '10px' } },
            h('button', { class: 'btn btn--sm btn--primary', onclick: apply }, '勾选的一键归位'),
            h('button', { class: 'btn btn--sm', onclick: () => loadScan(true) }, '让 AI 认一下看不出来的'),
            h('button', { class: 'btn btn--sm', onclick: () => loadScan(false, true) }, '重新扫描'),
            scanData.undo ? h('button', { class: 'btn btn--sm', onclick: async () => { const r = await api().undo(); toast(r.ok ? `搬回去了 ${r.restored.length} 项` : (r.error || `部分失败：${r.errors[0]}`), r.ok ? 'good' : 'bad'); loadScan(false); } }, `撤销上次（${scanData.undo.count} 项）`) : null,
          ),
        ),
        items.length ? h('div', { class: 'tidy__grid' }, dupEl, ...groupEls) : h('div', { class: 'tidy__empty' }, '桌面、下载、主目录都很干净 🎉'),
      );
    }

    // ---------- 刚建的 ----------
    async function renderRecent() {
      body.replaceChildren(h('div', { class: 'tidy__empty' }, '在找最近三天新建的…'));
      const r = await api().recent({ days: 3 });
      const rows = r.items.map((it) => h('div', { class: 'tidy__row' },
        h('span', { class: 'tidy__name', title: it.path }, `${it.isDir ? '📁 ' : '📄 '}${it.name}`),
        h('span', { class: 'tidy__meta' }, `${it.where} · ${new Date(it.born).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`),
        h('button', { class: 'btn btn--sm', onclick: () => api().reveal(it.path) }, '在访达显示'),
        h('button', { class: 'btn btn--sm', onclick: () => api().open(it.path) }, '打开'),
        it.isDir ? h('button', { class: 'btn btn--sm', onclick: () => { tab = 'learn'; renderTabs(); renderLearn(it.path); } }, '看懂它') : null,
      ));
      body.replaceChildren(
        h('section', { class: 'card' }, h('p', { class: 'faint settings__hint' }, '最近 3 天在你主目录下新建的东西（跳过 Library、node_modules 这类）。同一棵新建的树只列最上面一层。')),
        rows.length ? h('div', { class: 'tidy__group' }, ...rows) : h('div', { class: 'tidy__empty' }, '最近三天没新建什么'),
      );
    }

    // ---------- 看懂项目 ----------
    let lastRoot = '';
    async function renderLearn(rootPath = '', { fresh = false } = {}) {
      const drop = h('div', { class: 'tidy__drop' }, '把项目文件夹拖到这里，或者', ' ', h('button', { class: 'btn btn--sm', onclick: async () => { const p = await api().pickFolder(); if (p) renderLearn(p); } }, '选一个'));
      // 讲过的项目列在这，点一下秒出
      const history = h('div', { class: 'tidy__chips' });
      api().overviewList().then((list) => { history.replaceChildren(...list.slice(0, 8).map((x) => h('button', { class: `btn btn--sm${x.root === rootPath ? ' btn--primary' : ''}`, title: short(x.root), onclick: () => renderLearn(x.root) }, x.name))); });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); const f = e.dataTransfer?.files?.[0]; const p = f && window.toolbox.files.getPathForFile(f); if (p) renderLearn(p); });
      const out = h('section', { class: 'card' });
      body.replaceChildren(h('section', { class: 'card' }, drop, history), out);
      if (!rootPath) { if (lastRoot) rootPath = lastRoot; else return; }
      lastRoot = rootPath;
      out.replaceChildren(h('div', { class: 'tidy__empty' }, fresh ? '重新讲一遍…（十几秒到一分钟）' : `正在读 ${short(rootPath)} …（第一次要十几秒到一分钟）`));
      const r = await api().overview(rootPath, { fresh });
      if (!r.ok) { out.replaceChildren(h('div', { class: 'tidy__empty' }, r.error)); return; }
      // 追问：带着项目事实和这份讲解，问什么都行
      const thread = h('div', { class: 'tidy__thread' });
      const qInput = h('input', { class: 'field', placeholder: '接着问：比如「登录逻辑在哪个文件」「怎么加一个新工具」…', style: { flex: 1 } });
      const askIt = async () => {
        const q = qInput.value.trim(); if (!q) return;
        qInput.value = '';
        thread.append(h('div', { class: 'tidy__q' }, q));
        const a = h('div', { class: 'tidy__a faint' }, '想想…');
        thread.append(a);
        const res = await api().ask({ root: rootPath, question: q, prior: r.markdown });
        a.replaceChildren(res.ok ? md(res.markdown) : h('span', { class: 'bad' }, res.error));
        a.classList.remove('faint');
      };
      qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') askIt(); });
      // 带我读：按讲解给的顺序，一个文件一个文件讲
      const reading = h('div', { class: 'tidy__reading' });
      api().readingList({ root: rootPath, markdown: r.markdown }).then((files) => {
        if (!files?.length) return;
        const detail = h('div', { class: 'tidy__reading-detail' });
        let current = -1;
        const stops = files.map((f, i) => h('button', { class: 'btn btn--sm', title: f.why, onclick: () => openStop(i) }, `${i + 1}. ${f.rel.split('/').pop()}`));
        const progressKey = 'tidy.readProgress';
        const openStop = async (i, fresh = false) => {
          current = i; stops.forEach((b, k) => b.classList.toggle('btn--primary', k === i));
          // 记住读到第几站，首页能接着读
          const prog = { ...(config?.get(progressKey, {}) || {}) };
          prog[rootPath] = { index: i, total: files.length, rel: files[i].rel, at: Date.now() };
          config?.set(progressKey, prog);
          const f = files[i];
          detail.replaceChildren(h('div', { class: 'tidy__stat' }, h('b', {}, f.rel), h('span', { class: 'faint' }, f.why)), h('div', { class: 'tidy__empty' }, '在读这个文件…'));
          const res = await api().explainFile({ root: rootPath, rel: f.rel, prior: r.markdown, fresh });
          detail.replaceChildren(
            h('div', { class: 'tidy__stat' }, h('b', {}, f.rel), h('span', { class: 'faint' }, f.why),
              h('button', { class: 'btn btn--sm', onclick: () => api().open(f.abs) }, '打开文件'),
              h('button', { class: 'btn btn--sm', onclick: () => openStop(i, true) }, '重新讲'),
              i + 1 < files.length ? h('button', { class: 'btn btn--sm btn--primary', onclick: () => openStop(i + 1) }, `下一站：${files[i + 1].rel.split('/').pop()} →`) : h('span', { class: 'tag' }, '读完了 🎉')),
            res.ok ? md(res.markdown) : h('div', { class: 'bad' }, res.error),
          );
        };
        reading.replaceChildren(h('div', { class: 'tidy__stat' }, h('b', {}, '带我读'), h('span', { class: 'faint' }, `按上面的顺序，${files.length} 站，一站一个文件`)), h('div', { class: 'tidy__chips' }, ...stops), detail);
        // 首页点「接着读」进来的：直接跳到上次那一站
        const want = config?.get('tidy.pendingStop', null);
        if (want != null) { config.set('tidy.pendingStop', null); openStop(Math.min(files.length - 1, Number(want) || 0)); }
        else { const last = (config?.get(progressKey, {}) || {})[rootPath]; if (last && last.index < files.length && current < 0) stops[last.index]?.classList.add('btn--primary'); }
      });
      out.replaceChildren(
        h('div', { class: 'tidy__stat' }, h('b', {}, r.facts.name), h('code', {}, short(r.facts.root)), r.facts.markers?.length ? h('span', { class: 'faint' }, r.facts.markers.join(' · ')) : null,
          r.cached ? h('span', { class: 'faint' }, `上次讲的（${new Date(r.at).toLocaleDateString('zh-CN')}）`) : null,
          h('button', { class: 'btn btn--sm', onclick: () => api().reveal(r.facts.root) }, '在访达显示'),
          h('button', { class: 'btn btn--sm', onclick: () => renderLearn(rootPath, { fresh: true }) }, '重新讲'),
          h('button', { class: 'btn btn--sm', onclick: () => navigator.clipboard.writeText(r.markdown).then(() => toast('已复制', 'good')) }, '复制讲解'),
          h('button', { class: 'btn btn--sm btn--primary', title: '把「学习顺序」那节变成任务，首页和任务工具里都能看到', onclick: async () => { const t = await api().planToTasks({ markdown: r.markdown, name: r.facts.name }); toast(t.ok ? `加了 ${t.added} 条任务${t.skipped ? `（${t.skipped} 条已存在）` : ''}` : t.error, t.ok ? 'good' : 'bad'); } }, '学习顺序 → 任务'),
          h('button', { class: 'btn btn--sm', title: '自己的项目懒得写文档？让它起个草稿，看一眼再存', onclick: async (e) => {
            const btn = e.currentTarget; btn.disabled = true; btn.textContent = '在写…';
            const d = await api().draftReadme(rootPath);
            btn.disabled = false; btn.textContent = '帮我写 README';
            if (!d.ok) return toast(d.error, 'bad');
            const box = h('section', { class: 'card' },
              h('div', { class: 'tidy__stat' }, h('b', {}, d.existed ? 'README 草稿（已有 README，会存成 README.draft.md）' : 'README 草稿'), h('code', {}, short(d.target)),
                h('button', { class: 'btn btn--sm btn--primary', onclick: async () => { const s = await api().saveReadme({ root: rootPath, target: d.target, markdown: d.markdown }); toast(s.ok ? `存好了：${short(s.path)}` : s.error, s.ok ? 'good' : 'bad'); if (s.ok) api().reveal(s.path); } }, '存进项目'),
                h('button', { class: 'btn btn--sm', onclick: () => navigator.clipboard.writeText(d.markdown).then(() => toast('已复制', 'good')) }, '复制'),
                h('button', { class: 'btn btn--sm', onclick: () => box.remove() }, '不要')),
              md(d.markdown));
            out.after(box);
          } }, '帮我写 README'),
          h('button', { class: 'btn btn--sm', title: '讲完考五道选择题，看看真懂了没', onclick: async (e) => {
            const btn = e.currentTarget; btn.disabled = true; btn.textContent = '出题中…';
            const qz = await api().quiz({ root: rootPath, prior: r.markdown });
            btn.disabled = false; btn.textContent = '考考我';
            if (!qz.ok) return toast(qz.error, 'bad');
            let score = 0; let answered = 0;
            const summary = h('div', { class: 'tidy__stat' });
            const box = h('section', { class: 'card tidy__quiz' }, h('div', { class: 'tidy__stat' }, h('b', {}, `考考我 · ${qz.questions.length} 题`), h('button', { class: 'btn btn--sm', onclick: () => box.remove() }, '收起')));
            qz.questions.forEach((q, qi) => {
              const why = h('div', { class: 'faint tidy__quiz-why', hidden: true }, q.why);
              const opts = q.options.map((o, oi) => h('button', { class: 'btn btn--sm tidy__quiz-opt', onclick: () => {
                if (opts.some((b) => b.disabled)) return;
                opts.forEach((b, k) => { b.disabled = true; b.classList.toggle('is-right', k === q.answer); b.classList.toggle('is-wrong', k === oi && oi !== q.answer); });
                why.hidden = false; answered += 1; if (oi === q.answer) score += 1;
                if (answered === qz.questions.length) window.toolbox.learn?.note?.({ kind: 'quiz', title: r.facts.name, meta: rootPath, score, total: qz.questions.length });
                if (answered === qz.questions.length) summary.replaceChildren(h('b', {}, `${score} / ${qz.questions.length}`), h('span', { class: 'faint' }, score === qz.questions.length ? '全对，真懂了' : score >= qz.questions.length / 2 ? '大体明白了，错的那几道回去看看' : '再读一遍讲解吧'));
              } }, `${'ABCD'[oi]}. ${o}`));
              box.append(h('div', { class: 'tidy__quiz-q' }, h('div', {}, `${qi + 1}. ${q.q}`), h('div', { class: 'tidy__chips' }, ...opts), why));
            });
            box.append(summary);
            out.after(box);
          } }, '考考我')),
        md(r.markdown),
        reading,
        h('div', { class: 'tidy__askbar' }, qInput, h('button', { class: 'btn btn--sm btn--primary', onclick: askIt }, '问')),
        thread,
      );
    }

    function render() { if (tab === 'sort') renderSort(); else if (tab === 'recent') renderRecent(); else renderLearn(); }

    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '收纳'), h('span', { class: 'faint' }, '随手放的东西一键归位 · 刚建的在哪 · 看懂一个项目'), h('span', { style: { flex: 1 } }), tabs),
      body,
    );
    /** ⌘K 面板里选了「看懂：某文件夹」→ 切过来直接讲 */
    async function takePending() {
      const pending = config?.get('tidy.pending', '');
      if (!pending) return false;
      await config.set('tidy.pending', '');
      tab = 'learn'; renderTabs(); renderLearn(pending);
      return true;
    }
    renderTabs();
    takePending().then((took) => { if (!took) render(); });
    return { activate: async () => { if (await takePending()) return; if (tab === 'sort') loadScan(false); else if (tab === 'recent') renderRecent(); } };
  },
};
