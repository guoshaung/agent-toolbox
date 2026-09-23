import { h } from './ui.js';
import { iconFor } from './icons.js';
import { THEMES, EFFECTS, applyTheme, applyEffect } from './themes.js';

/**
 * ⌘K 命令面板：打字就能到任何地方。
 *
 * 能搜到的东西：
 *  - 工具（按名字 / 说明 / id）
 *  - 换皮肤 / 换效果（「金」→ 镀金黑金）
 *  - 最近三天新建的文件夹 / 文件（收纳那边的 recent），直接在访达显示或打开
 *  - 几个常用动作（显示桌宠、打开设置、手机控制、退出）
 *
 * 排序：前缀命中 > 名字包含 > 说明包含；最近用过的工具再往前提一点。
 */

/** 打分：0 = 不匹配。纯函数，方便测。 */
export function scoreItem(query, item) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 1;
  const title = String(item.title || '').toLowerCase();
  const keys = [item.id, ...(item.keywords || [])].map((k) => String(k || '').toLowerCase());
  const hint = String(item.hint || '').toLowerCase();
  if (title === q || keys.includes(q)) return 100;
  if (title.startsWith(q) || keys.some((k) => k.startsWith(q))) return 80;
  if (title.includes(q) || keys.some((k) => k.includes(q))) return 60;
  // 拆字：「皮金」也能命中「镀金黑金」（每个字都在名字里）
  if (q.length >= 2 && [...q].every((ch) => title.includes(ch))) return 40;
  if (hint.includes(q)) return 25;
  return 0;
}

/** 「+ 买牛奶」这种输入 → 一条「添加任务」动作。纯函数。 */
export function quickTaskFrom(query) {
  const m = String(query || '').match(/^\s*[+＋]\s*(.+)$/);
  if (!m || !m[1].trim()) return null;
  const title = m[1].trim().slice(0, 120);
  return { id: `task:${title}`, kind: 'action', title: `添加任务：${title}`, hint: '回车加进任务清单，首页也会显示', icon: 'checkList', keywords: [title], pinned: true };
}

export function rankItems(query, items, { recentIds = [] } = {}) {
  return items
    .map((item) => ({ item, score: scoreItem(query, item) }))
    .filter((x) => x.score > 0)
    .map((x) => ({ ...x, score: x.score + (recentIds.includes(x.item.id) ? Math.max(0, 10 - recentIds.indexOf(x.item.id)) : 0) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

const homeDir = () => (recentHome || '~');
let recentHome = '';

export function createPalette({ tools, activate, config, toast, extraActions = [], learn }) {
  let open = false;
  let index = 0;
  let items = [];
  let recentFiles = null;                 // 懒加载，打开面板时才去问
  let journal = null;                     // 学习记录，同样懒加载
  let clips = [];                         // 剪贴板历史，打开面板时拉一次
  let found = [];                         // 在 ~/收纳 / 代码目录里按名字搜到的
  let foundFor = '';
  let searchTimer = 0;

  const input = h('input', { class: 'palette__input', placeholder: '搜工具、换皮肤、找刚建的文件夹… 「+ 事情」直接记任务', spellcheck: 'false' });
  const list = h('div', { class: 'palette__list' });
  const root = h('div', { class: 'palette', hidden: true },
    h('div', { class: 'palette__panel' },
      h('div', { class: 'palette__head' }, iconFor('search', 'ui-icon palette__search-icon'), input, h('kbd', {}, 'esc')),
      list,
      h('div', { class: 'palette__foot faint' }, '↑↓ 选 · 回车打开（文件：⌘回车直接打开） · 打两个字也会在 ~/收纳 里找 · 「+ 事情」记任务'),
    ),
  );
  document.body.appendChild(root);

  const catalog = () => {
    const toolItems = tools.map((t) => ({ id: t.id, kind: 'tool', title: t.title, hint: t.hint || '', icon: t.icon, run: () => activate(t.id) }));
    const themeItems = THEMES.map((t) => ({ id: `theme:${t.id}`, kind: 'theme', title: `皮肤：${t.name}`, hint: t.desc, keywords: ['皮肤', '主题', 'theme', t.id], swatches: t.swatches, run: async () => { applyTheme(t.id); await config.set('ui.theme', t.id); toast?.(`已切换到「${t.name}」`, 'good'); } }));
    const effectItems = EFFECTS.map((e) => ({ id: `effect:${e.id}`, kind: 'effect', title: `效果：${e.name}`, hint: e.desc, keywords: ['效果', 'effect', e.id], run: async () => { applyEffect(e.id); await config.set('ui.effect', e.id); toast?.(`已切换为「${e.name}」`, 'good'); } }));
    const fileItems = (recentFiles || []).map((f) => ({ id: `file:${f.path}`, kind: 'file', title: f.name, hint: `${f.isDir ? '文件夹' : '文件'} · ${f.where}`, keywords: [f.path], isDir: f.isDir, run: () => window.toolbox.tidy.reveal(f.path), alt: () => window.toolbox.tidy.open(f.path) }));
    // 最近新建的文件夹再给一条「看懂它」：搜「看懂」或者文件夹名都能出来
    const learnItems = learn ? (recentFiles || []).filter((f) => f.isDir).slice(0, 8).map((f) => ({ id: `learn:${f.path}`, kind: 'action', title: `看懂：${f.name}`, hint: `让 AI 讲这个项目是什么、怎么跑、从哪读起 · ${f.where}`, icon: 'graduation', keywords: ['看懂', '讲解', 'learn', f.name], run: () => learn(f.path) })) : [];
    // 学习记录：解释过的那段、看懂过的项目、考过的分，都能搜回来
    const journalItems = (journal || []).map((j, i) => ({
      id: `journal:${j.at}:${i}`, kind: 'journal', icon: 'graduation',
      title: `${{ explain: '解释过', overview: '看懂过', file: '读过', quiz: '考过' }[j.kind] || '记'}：${j.title}${j.kind === 'quiz' ? `（${j.score}/${j.total}）` : ''}`,
      hint: new Date(j.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      keywords: ['学习', '记录', j.title],
      run: async () => { if (j.meta && learn) return learn(j.meta); activate('home'); },
    }));
    // 收纳目录直达：「打开 收纳 文档」
    const folderItems = ['图片', '文档', '数据', '压缩包', '安装包', '视频', '音频', '零散代码', '杂项'].map((name) => ({ id: `folder:${name}`, kind: 'action', title: `打开 ~/收纳/${name}`, hint: '归位后的东西都在这', icon: 'folder', keywords: ['收纳', '打开', name], run: () => window.toolbox.tidy.open(`${homeDir()}/收纳/${name}`) }));
    // 刚建的那栏已经有的，就别在「归位后」再出现一次
    const seen = new Set((recentFiles || []).map((f) => f.path));
    const foundItems = found.filter((f) => !seen.has(f.path)).map((f) => ({ id: `found:${f.path}`, kind: 'file', title: f.name, hint: `归位后在 ${f.where}`, keywords: [f.path], isDir: f.isDir, run: () => window.toolbox.tidy.reveal(f.path), alt: () => window.toolbox.tidy.open(f.path) }));
    // 剪贴板历史：搜「剪贴板」或直接搜内容里的字；回车复制回去
    const clipItems = clips.map((c, i) => ({ id: `clip:${c.at}:${i}`, kind: 'clip', icon: 'paste', title: c.text.replace(/\s+/g, ' ').trim().slice(0, 90), hint: `复制于 ${new Date(c.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · 回车复制回剪贴板`, keywords: ['剪贴板', 'clipboard', c.text.slice(0, 200)], run: async () => { await window.toolbox.clipboard.write(c.text); toast?.('已复制回剪贴板', 'good'); } }));
    return [...toolItems, ...extraActions, ...themeItems, ...effectItems, ...fileItems, ...learnItems, ...journalItems, ...folderItems, ...foundItems, ...clipItems];
  };

  function render() {
    const q = input.value;
    const mru = config.get('ui.mru') || [];
    const repo = /^(https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+|git@github\.com:[\w.-]+\/[\w.-]+)/.test(q.trim()) ? q.trim() : null;
    const quick = quickTaskFrom(q) || (repo && learn ? { id: `clone:${repo}`, kind: 'action', title: `拉下来看懂：${repo.replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '')}`, hint: '浅克隆到代码目录，然后让 AI 讲它', icon: 'graduation', keywords: [repo], run: async () => { toast?.('在拉代码…', 'info', 4000); const c = await window.toolbox.tidy.clone(repo); if (!c.ok) return toast?.(c.error, 'bad', 6000); learn(c.path); } } : null);
    items = quick
      ? [{ ...quick, run: async () => { const list = config.get('tasks.items', []) || []; await config.set('tasks.items', [{ id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, title: quick.keywords[0], done: false, priority: 'normal', due: '', createdAt: Date.now(), completedAt: null }, ...list]); toast?.(`加了任务：${quick.keywords[0]}`, 'good'); } }]
      : rankItems(q, catalog().filter((it) => q || (it.kind !== 'journal' && it.kind !== 'clip')), { recentIds: mru }).slice(0, q ? 40 : 14);
    index = Math.min(index, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((it, i) => {
      const row = h('div', { class: `palette__row${i === index ? ' is-active' : ''}`, dataset: { i: String(i) }, title: it.kind === 'file' ? (it.keywords?.[0] || '') : '' },
        i < 9 ? h('kbd', { class: 'palette__num' }, `⌘${i + 1}`) : h('span', { class: 'palette__num' }),
        it.kind === 'tool' ? h('span', { class: 'palette__icon' }, iconFor(it.icon || 'more'))
          : it.kind === 'theme' ? h('span', { class: 'palette__swatches' }, ...(it.swatches || []).map((c) => h('i', { style: { background: c } })))
            : h('span', { class: 'palette__icon' }, it.kind === 'file' ? (it.isDir ? '📁' : '📄') : iconFor(it.icon || 'zap')),
        h('span', { class: 'palette__text' }, h('span', { class: 'palette__title' }, it.title), it.hint ? h('span', { class: 'palette__hint' }, it.hint) : null),
        h('span', { class: 'palette__kind faint' }, { tool: '工具', theme: '皮肤', effect: '效果', file: '刚建的', action: '动作', journal: '学习记录', clip: '剪贴板' }[it.kind] || ''),
      );
      row.addEventListener('pointermove', () => { if (index !== i) { index = i; highlight(); } });
      row.addEventListener('click', () => pick(i));
      return row;
    }));
    if (!items.length) list.append(h('div', { class: 'palette__empty faint' }, q ? '没找到。试试工具名、皮肤名，或者文件夹名' : '还没有可搜的东西'));
  }
  function highlight() { [...list.children].forEach((el, i) => el.classList?.toggle('is-active', i === index)); list.children[index]?.scrollIntoView?.({ block: 'nearest' }); }
  async function pick(i, alt = false) {
    const it = items[i]; if (!it) return;
    hide();
    try { await (alt && it.alt ? it.alt() : it.run()); } catch (error) { toast?.(error.message || '执行失败', 'bad'); }
  }

  function show() {
    if (open) { input.select(); return; }
    open = true; index = 0;
    root.hidden = false;
    input.value = '';
    render();
    input.focus();
    // 最近新建的东西：面板开着的时候悄悄拉一次，拉到了就补进列表
    window.toolbox.tidy?.recent?.({ days: 3, limit: 30 }).then((r) => { if (r?.ok) { recentFiles = r.items; const p = r.items[0]?.path || ''; const m = p.match(/^(\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/); if (m) recentHome = m[1]; if (open) render(); } }).catch(() => {});
    window.toolbox.learn?.journal?.({ limit: 60 }).then((r) => { if (r?.items) { journal = r.items; if (open) render(); } }).catch(() => {});
    window.toolbox.clipboard?.history?.().then((r) => { if (Array.isArray(r)) { clips = r; if (open) render(); } }).catch(() => {});
  }
  function hide() { open = false; root.hidden = true; }
  function toggle() { open ? hide() : show(); }

  input.addEventListener('input', () => {
    index = 0; render();
    // 打了两个字以上，顺便去 ~/收纳 里按名字找一下（防抖，别每个键都读盘）
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { found = []; foundFor = ''; return; }
    searchTimer = setTimeout(async () => {
      const r = await window.toolbox.tidy?.search?.(q).catch(() => []);
      if (input.value.trim() !== q) return;
      found = r || []; foundFor = q; if (open) render();
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(items.length - 1, index + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(0, index - 1); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(index, e.metaKey || e.ctrlKey); }
    else if (e.key === 'Escape') { e.preventDefault(); hide(); }
    else if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) { e.preventDefault(); pick(Number(e.key) - 1); }
  });
  root.addEventListener('pointerdown', (e) => { if (e.target === root) hide(); });

  return { show, hide, toggle, isOpen: () => open };
}
