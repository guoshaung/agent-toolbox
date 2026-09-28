import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';
import { BUCKETS, splitDump, pickFocus, streakOf, findDuplicates, staleTasks, parseAiTasks } from './parse.js';

/**
 * 任务：给懒人整理思绪用的。
 *
 * 敲字尽量少：脑子里的东西整段倒进「倒出来」框，AI（或本地规则）拆成一条条并分好「今天 / 这周 / 以后」；
 * 页面最上面永远只亮一件事「现在就做这个」，做完打勾、想躲就换一个、太大就让 AI 拆三步；
 * 三栏之间拖一下就是改排期；「理一理」帮你合并重复的、把放太久的挪走。
 */

const PRIORITIES = [
  { id: 'normal', label: '普通', color: '#8190a8' },
  { id: 'high', label: '重要', color: '#dfa145' },
  { id: 'urgent', label: '紧急', color: '#e46a70' },
];
const TAG_COLORS = ['#5b8cff', '#3fbf87', '#dfa145', '#c9a7ff', '#ef6b8a', '#4fd1e8', '#ff9a6b', '#a8d84f'];
const makeId = () => `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

export default {
  id: 'tasks',
  title: '任务',
  icon: 'checkList',
  hint: '把脑子里的事整段倒进来，AI 拆成今天 / 这周 / 以后；最上面只亮一件事',

  create(root, ctx) {
    const { config, ai } = ctx;
    let tasks = (config.get('tasks.items', []) || []).map((task) => ({
      id: task.id || makeId(), title: String(task.title || '').trim(), done: Boolean(task.done), priority: task.priority || 'normal', due: task.due || '',
      bucket: BUCKETS.some((b) => b.id === task.bucket) ? task.bucket : (task.done ? 'today' : 'today'), tag: task.tag || '',
      createdAt: task.createdAt || Date.now(), completedAt: task.completedAt || 0,
    })).filter((task) => task.title);
    let notes = { ...(config.get('tasks.notes', {}) || {}) };
    let draggingId = null;
    let skipped = new Set();   // 「换一个」跳过的，本次会话内不再当焦点
    let busy = false;

    function persist() { config.set('tasks.items', tasks); }
    function persistNotes() { config.set('tasks.notes', notes); }
    const tagColor = (tag) => TAG_COLORS[[...String(tag)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % TAG_COLORS.length];

    // ---------- 头：现在就做这个 ----------
    const hero = h('section', { class: 'tk__hero' });
    function renderHero() {
      const pool = tasks.filter((t) => !t.done && t.bucket === 'today' && !skipped.has(t.id));
      const pick = pickFocus(pool) || pickFocus(tasks.filter((t) => !t.done && t.bucket === 'today'));
      const doneToday = tasks.filter((t) => t.done && t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString()).length;
      const openToday = tasks.filter((t) => !t.done && t.bucket === 'today').length;
      if (!pick) {
        const next = tasks.find((t) => !t.done && t.bucket === 'week') || tasks.find((t) => !t.done);
        hero.replaceChildren(
          h('div', { class: 'tk__hero-eyebrow' }, doneToday ? `今天做完了 ${doneToday} 件` : '今天'),
          h('h2', { class: 'tk__hero-title tk__hero-title--empty' }, doneToday ? '今天的都清了，漂亮。' : '今天还没安排事。'),
          h('div', { class: 'tk__hero-actions' },
            next ? h('button', { class: 'btn btn--primary', onclick: () => { next.bucket = 'today'; persist(); render(); } }, `把「${next.title.slice(0, 18)}」拉到今天`) : null,
            h('button', { class: 'btn', onclick: () => dumpInput.focus() }, '倒点东西进来'),
          ),
        );
        return;
      }
      const priority = PRIORITIES.find((p) => p.id === pick.priority) || PRIORITIES[0];
      hero.replaceChildren(
        h('div', { class: 'tk__hero-eyebrow' }, '现在就做这个', h('span', { class: 'tk__hero-count' }, `今天 ${doneToday} / ${doneToday + openToday}`)),
        h('h2', { class: 'tk__hero-title' }, pick.title),
        h('div', { class: 'tk__hero-meta' },
          h('span', { class: 'tk__prio', style: { color: priority.color } }, `● ${priority.label}`),
          pick.tag ? h('span', { class: 'tk__tag', style: { '--tag-color': tagColor(pick.tag) } }, pick.tag) : null,
          pick.due ? h('span', { class: 'faint' }, pick.due === todayIso() ? '今天到期' : `截止 ${pick.due}`) : null,
          notes[pick.id] ? h('span', { class: 'faint tk__hero-note' }, String(notes[pick.id]).slice(0, 80)) : null,
        ),
        h('div', { class: 'tk__hero-actions' },
          h('button', { class: 'btn btn--primary tk__hero-done', onclick: () => finish(pick, hero) }, '✓ 做完了'),
          h('button', { class: 'btn', title: '带着这件事去专注页开 25 分钟番茄钟', onclick: async () => { await config.set('focus.sessionTask', pick.title); ctx.goto('focus'); window.dispatchEvent(new CustomEvent('toolbox:tool-sub', { detail: { tool: 'focus', sub: 'timer' } })); } }, '⏱ 专注 25 分钟'),
          h('button', { class: 'btn btn--ghost', title: '太大了下不了手？让 AI 拆成三四个小步骤', disabled: busy, onclick: () => breakDown(pick) }, '拆一下'),
          h('button', { class: 'btn btn--ghost', title: '先不看这件，换下一件', onclick: () => { skipped.add(pick.id); renderHero(); } }, '换一个'),
        ),
      );
    }

    /** 打勾 + 撒一把纸屑 */
    function finish(task, anchor) {
      task.done = true; task.completedAt = Date.now();
      persist();
      if (anchor) {
        const burst = h('div', { class: 'tk__confetti' }, ...Array.from({ length: 18 }, (_, i) => { const p = h('i', {}); p.style.setProperty('--i', String(i)); p.style.setProperty('--c', TAG_COLORS[i % TAG_COLORS.length]); return p; }));
        anchor.appendChild(burst);
        setTimeout(() => burst.remove(), 1200);
      }
      const left = tasks.filter((t) => !t.done && t.bucket === 'today').length;
      toast(left ? `做完一件，今天还剩 ${left} 件` : '今天的全清了 🎉', 'good');
      setTimeout(render, anchor ? 500 : 0);
    }

    async function breakDown(task) {
      if (busy) return;
      busy = true; renderHero();
      try {
        const text = await ai.chat(`把下面这件事拆成 3 到 5 个能在 30 分钟内做完的小步骤，每步一句话，动词开头，不要解释。只输出 JSON 数组：[{"title":"..."}]\n\n事情：${task.title}${notes[task.id] ? `\n补充：${notes[task.id]}` : ''}`);
        const steps = parseAiTasks(text);
        if (!steps.length) return toast('没拆出来，换个说法再试', 'info');
        const at = tasks.indexOf(task);
        const inserted = steps.map((s, i) => ({ id: makeId(), title: s.title, done: false, priority: task.priority, due: task.due, bucket: 'today', tag: task.tag || task.title.slice(0, 12), createdAt: Date.now() + i, completedAt: 0 }));
        tasks.splice(at + 1, 0, ...inserted);
        task.bucket = 'later'; notes[task.id] = `${notes[task.id] ? `${notes[task.id]}\n` : ''}已拆成 ${inserted.length} 步（${new Date().toLocaleDateString('zh-CN')}）`;
        persist(); persistNotes();
        toast(`拆成 ${inserted.length} 步放到今天了，原来那条挪到「以后」当总纲`, 'good', 5000);
      } catch (err) { toast(err.message || '模型没回应', 'bad'); } finally { busy = false; render(); }
    }

    // ---------- 倒出来 ----------
    const dumpInput = h('textarea', { class: 'field tk__dump', rows: 3, placeholder: '写一件事，回车就进下面；一次写好几行也行，每行一件。\n例如：明天回导师邮件 / 紧急 交报销 / 有空学一下 micrograd #学习\n想让 AI 把一段乱话整理成条再分轻重，点「AI 帮我理一理」' });
    const dumpPlain = h('button', { class: 'btn btn--primary', title: '和按回车一样：按行 / 分号拆，「今天 / 明天 / 紧急 / #标签」这些词会自动识别，不走模型', onclick: () => dump(false) }, '加进去（回车）');
    const dumpAi = h('button', { class: 'btn', title: '让模型把一段乱七八糟的话整理成条、分轻重和主题（⌘回车）', onclick: () => dump(true) }, '✦ AI 帮我理一理');
    const dumpPaste = h('button', { class: 'btn btn--ghost', onclick: async () => { const t = await window.toolbox.clipboard.read?.(); if (!t) return toast('剪贴板是空的', 'info'); dumpInput.value = (dumpInput.value ? `${dumpInput.value}\n` : '') + t; dumpInput.focus(); } }, '从剪贴板粘');

    async function dump(useAi) {
      const text = dumpInput.value.trim();
      if (!text) return toast('先倒点东西进来', 'info');
      let list = [];
      dumpAi.disabled = dumpPlain.disabled = true;
      try {
        if (useAi) {
          dumpAi.textContent = '理着…';
          try {
            const existing = tasks.filter((t) => !t.done).map((t) => t.title).slice(0, 30);
            const reply = await ai.chat(`你是我的私人助理。把我随手写的这段话拆成一条条要做的事，帮我分好轻重缓急和主题。规则：
- 每条 title 一句话、动词开头、不超过 30 字；口语和碎片也要整理成能执行的一条
- bucket：today（今天必须碰）/ week（几天内）/ later（先放着）；没说时间的按轻重猜
- priority：urgent / high / normal
- tag：一个两三字的主题词（比如 论文、生活、学习、工作），同类的用同一个词
- due：只有明确说了日期才填，格式 YYYY-MM-DD，今天是 ${todayIso()}
- 和已有任务重复的不要再出：${existing.join('；') || '（无）'}
只输出 JSON 数组，不要别的：[{"title":"","bucket":"","priority":"","tag":"","due":""}]

我写的：
${text}`);
            list = parseAiTasks(reply);
          } catch (err) { toast(`模型没理成（${err.message || '没回应'}），改用本地规则拆`, 'info', 5000); }
        }
        if (!list.length) list = splitDump(text);
        if (!list.length) return toast('没拆出能做的事，换个写法', 'info');
        const existingKeys = new Set(tasks.filter((t) => !t.done).map((t) => t.title.trim().toLowerCase()));
        const fresh = list.filter((t) => !existingKeys.has(t.title.trim().toLowerCase()));
        const now = Date.now();
        tasks = [...fresh.map((t, i) => ({ id: makeId(), title: t.title, done: false, priority: t.priority, due: t.due || '', bucket: t.bucket, tag: t.tag || '', createdAt: now + i, completedAt: 0 })), ...tasks];
        persist();
        dumpInput.value = '';
        const byBucket = BUCKETS.map((b) => `${b.label} ${fresh.filter((t) => t.bucket === b.id).length}`).join(' · ');
        toast(`理出 ${fresh.length} 件：${byBucket}${list.length - fresh.length ? `（${list.length - fresh.length} 件已经有了）` : ''}`, 'good', 5000);
        render();
      } finally { dumpAi.disabled = dumpPlain.disabled = false; dumpAi.textContent = '✦ AI 帮我理一理'; }
    }

    // ---------- 三栏 ----------
    const board = h('div', { class: 'tk__board' });
    const doneWrap = h('details', { class: 'tk__done' });

    function card(task) {
      const priority = PRIORITIES.find((p) => p.id === task.priority) || PRIORITIES[0];
      const note = String(notes[task.id] || '');
      const noteBox = h('textarea', { class: 'field tk__note', rows: 2, placeholder: '备注…', hidden: true, onmousedown: (e) => e.stopPropagation(), onchange: (e) => { const v = e.target.value.trim(); if (v) notes[task.id] = v; else delete notes[task.id]; persistNotes(); } }, note);
      const el = h('article', { class: `tk__card${task.done ? ' is-done' : ''}`, dataset: { id: task.id }, draggable: 'true' },
        h('button', { class: 'tk__check', title: task.done ? '标记未完成' : '做完了', onclick: (e) => { e.stopPropagation(); if (task.done) { task.done = false; task.completedAt = 0; persist(); render(); } else finish(task, el); } }, task.done ? '✓' : ''),
        h('div', { class: 'tk__card-body' },
          h('div', { class: 'tk__card-title', title: '双击改字', ondblclick: () => edit(task, el) }, task.title),
          h('div', { class: 'tk__card-meta' },
            h('button', { class: 'tk__prio', style: { color: priority.color }, title: '点一下换轻重', onclick: (e) => { e.stopPropagation(); const i = PRIORITIES.findIndex((p) => p.id === task.priority); task.priority = PRIORITIES[(i + 1) % PRIORITIES.length].id; persist(); render(); } }, `● ${priority.label}`),
            task.tag ? h('span', { class: 'tk__tag', style: { '--tag-color': tagColor(task.tag) } }, task.tag) : null,
            task.due ? h('span', { class: `faint ${!task.done && task.due < todayIso() ? 'tk__overdue' : ''}` }, task.due === todayIso() ? '今天到期' : task.due) : null,
            note ? h('span', { class: 'faint tk__note-preview', title: note }, note.slice(0, 40)) : null,
          ),
          noteBox,
        ),
        h('div', { class: 'tk__card-tools' },
          h('button', { class: 'tk__mini', title: note ? '改备注' : '加备注', onclick: (e) => { e.stopPropagation(); noteBox.hidden = !noteBox.hidden; if (!noteBox.hidden) noteBox.focus(); } }, '✎'),
          !task.done ? h('button', { class: 'tk__mini', title: '挪到下一栏', onclick: (e) => { e.stopPropagation(); const i = BUCKETS.findIndex((b) => b.id === task.bucket); task.bucket = BUCKETS[(i + 1) % BUCKETS.length].id; persist(); render(); } }, '→') : null,
          h('button', { class: 'tk__mini tk__mini--del', title: '删掉', onclick: (e) => { e.stopPropagation(); tasks = tasks.filter((t) => t.id !== task.id); delete notes[task.id]; persist(); persistNotes(); render(); } }, '×'),
        ),
      );
      el.addEventListener('dragstart', (e) => { draggingId = task.id; el.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id); });
      el.addEventListener('dragend', () => { draggingId = null; el.classList.remove('is-dragging'); });
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('is-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('is-over'));
      el.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('is-over'); moveTask(draggingId || e.dataTransfer.getData('text/plain'), task.bucket, task.id); });
      return el;
    }

    function edit(task, el) {
      const input = h('input', { class: 'field field--sm', value: task.title, maxlength: '160' });
      const title = el.querySelector('.tk__card-title');
      title.replaceWith(input); input.focus(); input.select();
      const commit = () => { const v = input.value.trim(); if (v) task.title = v; persist(); render(); };
      input.addEventListener('blur', commit, { once: true });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = task.title; input.blur(); } });
    }

    /** 拖到某栏（可选：某张卡前面） */
    function moveTask(id, bucket, beforeId = null) {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      tasks = tasks.filter((t) => t.id !== id);
      task.bucket = bucket; task.done = false; task.completedAt = 0;
      const at = beforeId ? tasks.findIndex((t) => t.id === beforeId) : -1;
      if (at >= 0) tasks.splice(at, 0, task); else tasks.push(task);
      persist(); render();
    }

    function renderBoard() {
      board.replaceChildren(...BUCKETS.map((b) => {
        const list = tasks.filter((t) => !t.done && t.bucket === b.id);
        const col = h('section', { class: `tk__col tk__col--${b.id}` },
          h('div', { class: 'tk__col-head' }, h('strong', {}, b.label), h('span', { class: 'faint' }, b.hint), h('span', { class: 'tk__col-count' }, String(list.length))),
          h('div', { class: 'tk__col-list' }, ...list.map(card), list.length ? null : h('div', { class: 'tk__col-empty faint' }, b.id === 'today' ? '把卡片拖过来，或者上面倒点东西' : '空的')),
        );
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('is-over'); });
        col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('is-over'); });
        col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('is-over'); moveTask(draggingId || e.dataTransfer.getData('text/plain'), b.id); });
        return col;
      }));
      const done = tasks.filter((t) => t.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      doneWrap.replaceChildren(
        h('summary', {}, h('strong', {}, '做完了'), h('span', { class: 'faint' }, ` ${done.length} 件`), done.length ? h('button', { class: 'btn btn--xs btn--ghost tk__clear-done', onclick: (e) => { e.preventDefault(); e.stopPropagation(); if (!window.confirm(`清掉 ${done.length} 件做完的？连续天数统计会一起没。`)) return; tasks = tasks.filter((t) => !t.done); persist(); render(); } }, '清掉') : null),
        h('div', { class: 'tk__done-list' }, ...done.slice(0, 60).map(card)),
      );
    }

    // ---------- 侧栏：进度环 / 连续天数 / 理一理 ----------
    const side = h('aside', { class: 'tk__side' });
    function renderSide() {
      const doneToday = tasks.filter((t) => t.done && t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString()).length;
      const openToday = tasks.filter((t) => !t.done && t.bucket === 'today').length;
      const total = doneToday + openToday;
      const ratio = total ? doneToday / total : 0;
      const streak = streakOf(tasks);
      const ring = h('div', { class: 'tk__ring' }, h('div', { class: 'tk__ring-in' }, h('strong', {}, total ? `${Math.round(ratio * 100)}%` : '—'), h('span', { class: 'faint' }, total ? `${doneToday} / ${total}` : '今天没安排')));
      ring.style.setProperty('--ratio', String(ratio));
      const dups = findDuplicates(tasks);
      const stale = staleTasks(tasks);
      const untagged = tasks.filter((t) => !t.done && !t.tag);
      const tidy = h('div', { class: 'tk__tidy' });
      const suggestions = [];
      for (const g of dups) suggestions.push(h('div', { class: 'tk__sug' }, h('span', {}, `「${g[0].title.slice(0, 16)}」有 ${g.length} 条一样的`), h('button', { class: 'btn btn--xs', onclick: () => { const keep = g[0]; tasks = tasks.filter((t) => t === keep || !g.includes(t)); persist(); render(); } }, '合并')));
      if (stale.length) suggestions.push(h('div', { class: 'tk__sug' }, h('span', {}, `${stale.length} 件放了两周还没动`), h('button', { class: 'btn btn--xs', onclick: () => { for (const t of stale) t.bucket = 'later'; persist(); render(); } }, '都挪到以后')));
      if (untagged.length >= 3) suggestions.push(h('div', { class: 'tk__sug' }, h('span', {}, `${untagged.length} 件还没分主题`), h('button', { class: 'btn btn--xs', disabled: busy, onclick: () => autoTag(untagged) }, '✦ AI 分一下')));
      tidy.replaceChildren(h('div', { class: 'tk__side-title' }, '理一理'), ...(suggestions.length ? suggestions : [h('div', { class: 'faint' }, '没有重复的、没有放太久的，挺干净。')]));
      const tags = [...new Set(tasks.filter((t) => !t.done && t.tag).map((t) => t.tag))];
      side.replaceChildren(
        h('section', { class: 'card tk__side-card' }, h('div', { class: 'tk__side-title' }, '今天'), ring, h('div', { class: 'tk__streak' }, streak ? `🔥 连续 ${streak} 天有完成` : '今天完成一件就开始计连续天数')),
        h('section', { class: 'card tk__side-card' }, tidy),
        tags.length ? h('section', { class: 'card tk__side-card' }, h('div', { class: 'tk__side-title' }, '主题'), h('div', { class: 'tk__tags' }, ...tags.map((tag) => h('span', { class: 'tk__tag', style: { '--tag-color': tagColor(tag) } }, `${tag} ${tasks.filter((t) => !t.done && t.tag === tag).length}`)))) : null,
      );
    }

    async function autoTag(list) {
      if (busy) return;
      busy = true; renderSide();
      try {
        const reply = await ai.chat(`给下面这些事各分一个两三字的主题词（比如 论文、学习、生活、工作、健康），同类用同一个词。只输出 JSON 数组：[{"title":"原文","tag":"主题"}]\n\n${list.map((t) => t.title).join('\n')}`);
        const parsed = parseAiTasks(reply);
        let n = 0;
        for (const p of parsed) { const t = list.find((x) => x.title.trim() === p.title.trim()) || list.find((x) => x.title.includes(p.title) || p.title.includes(x.title)); if (t && p.tag && !t.tag) { t.tag = p.tag; n += 1; } }
        persist();
        toast(n ? `分好了 ${n} 件` : '模型没给出主题', n ? 'good' : 'info');
      } catch (err) { toast(err.message || '模型没回应', 'bad'); } finally { busy = false; render(); }
    }

    function render() { renderHero(); renderBoard(); renderSide(); }

    root.append(
      h('div', { class: 'bar tk__bar' }, h('strong', {}, '任务'), h('span', { class: 'faint' }, '倒进来、亮一件、拖一拖'), h('span', { class: 'tk__spacer' }), h('span', { class: 'faint tk__hint' }, '⌘K 里输「+ 事情」也能直接加')),
      h('div', { class: 'tk__body' },
        h('div', { class: 'tk__main' },
          hero,
          h('section', { class: 'tk__dump-card' }, h('div', { class: 'tk__dump-head' }, h('strong', {}, '倒出来'), h('span', { class: 'faint' }, '回车直接加 · ⇧回车换行 · AI 只在你点的时候才上')), dumpInput, h('div', { class: 'tk__dump-actions' }, dumpPlain, dumpAi, dumpPaste)),
          board,
          doneWrap,
        ),
        side,
      ),
    );
    // 回车 = 直接写进下面（本地规则拆，不走模型）；⇧回车换行；⌘回车才叫 AI
    dumpInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
      e.preventDefault();
      dump(Boolean(e.metaKey || e.ctrlKey));
    });
    render();
    return { activate: () => { tasks = (config.get('tasks.items', []) || []).map((t) => ({ ...t, bucket: BUCKETS.some((b) => b.id === t.bucket) ? t.bucket : 'today' })); render(); } };
  },
};
