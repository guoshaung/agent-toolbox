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

export function rankItems(query, items, { recentIds = [] } = {}) {
  return items
    .map((item) => ({ item, score: scoreItem(query, item) }))
    .filter((x) => x.score > 0)
    .map((x) => ({ ...x, score: x.score + (recentIds.includes(x.item.id) ? Math.max(0, 10 - recentIds.indexOf(x.item.id)) : 0) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

export function createPalette({ tools, activate, config, toast, extraActions = [] }) {
  let open = false;
  let index = 0;
  let items = [];
  let recentFiles = null;                 // 懒加载，打开面板时才去问

  const input = h('input', { class: 'palette__input', placeholder: '搜工具、换皮肤、找刚建的文件夹… 回车打开', spellcheck: 'false' });
  const list = h('div', { class: 'palette__list' });
  const root = h('div', { class: 'palette', hidden: true },
    h('div', { class: 'palette__panel' },
      h('div', { class: 'palette__head' }, iconFor('search', 'ui-icon palette__search-icon'), input, h('kbd', {}, 'esc')),
      list,
      h('div', { class: 'palette__foot faint' }, '↑↓ 选 · 回车打开 · ⌘K 随时呼出'),
    ),
  );
  document.body.appendChild(root);

  const catalog = () => {
    const toolItems = tools.map((t) => ({ id: t.id, kind: 'tool', title: t.title, hint: t.hint || '', icon: t.icon, run: () => activate(t.id) }));
    const themeItems = THEMES.map((t) => ({ id: `theme:${t.id}`, kind: 'theme', title: `皮肤：${t.name}`, hint: t.desc, keywords: ['皮肤', '主题', 'theme', t.id], swatches: t.swatches, run: async () => { applyTheme(t.id); await config.set('ui.theme', t.id); toast?.(`已切换到「${t.name}」`, 'good'); } }));
    const effectItems = EFFECTS.map((e) => ({ id: `effect:${e.id}`, kind: 'effect', title: `效果：${e.name}`, hint: e.desc, keywords: ['效果', 'effect', e.id], run: async () => { applyEffect(e.id); await config.set('ui.effect', e.id); toast?.(`已切换为「${e.name}」`, 'good'); } }));
    const fileItems = (recentFiles || []).map((f) => ({ id: `file:${f.path}`, kind: 'file', title: f.name, hint: `${f.isDir ? '文件夹' : '文件'} · ${f.where}`, keywords: [f.path], isDir: f.isDir, run: () => window.toolbox.tidy.reveal(f.path), alt: () => window.toolbox.tidy.open(f.path) }));
    return [...toolItems, ...extraActions, ...themeItems, ...effectItems, ...fileItems];
  };

  function render() {
    const q = input.value;
    const mru = config.get('ui.mru') || [];
    items = rankItems(q, catalog(), { recentIds: mru }).slice(0, q ? 40 : 14);
    index = Math.min(index, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((it, i) => {
      const row = h('div', { class: `palette__row${i === index ? ' is-active' : ''}`, dataset: { i: String(i) } },
        it.kind === 'tool' ? h('span', { class: 'palette__icon' }, iconFor(it.icon || 'more'))
          : it.kind === 'theme' ? h('span', { class: 'palette__swatches' }, ...(it.swatches || []).map((c) => h('i', { style: { background: c } })))
            : h('span', { class: 'palette__icon' }, it.kind === 'file' ? (it.isDir ? '📁' : '📄') : iconFor(it.icon || 'zap')),
        h('span', { class: 'palette__text' }, h('span', { class: 'palette__title' }, it.title), it.hint ? h('span', { class: 'palette__hint' }, it.hint) : null),
        h('span', { class: 'palette__kind faint' }, { tool: '工具', theme: '皮肤', effect: '效果', file: '刚建的', action: '动作' }[it.kind] || ''),
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
    window.toolbox.tidy?.recent?.({ days: 3, limit: 30 }).then((r) => { if (r?.ok) { recentFiles = r.items; if (open) render(); } }).catch(() => {});
  }
  function hide() { open = false; root.hidden = true; }
  function toggle() { open ? hide() : show(); }

  input.addEventListener('input', () => { index = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(items.length - 1, index + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(0, index - 1); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(index, e.metaKey || e.ctrlKey); }
    else if (e.key === 'Escape') { e.preventDefault(); hide(); }
  });
  root.addEventListener('pointerdown', (e) => { if (e.target === root) hide(); });

  return { show, hide, toggle, isOpen: () => open };
}
