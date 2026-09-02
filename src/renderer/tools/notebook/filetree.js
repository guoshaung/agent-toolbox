import { h, toast } from '../../core/ui.js';

/**
 * 轻量文件树。
 *
 * "轻"体现在三点：
 *  1. 只列一层 —— 展开哪个目录才去读哪个目录，根目录几十个 entry 就是全部开销
 *  2. 内容按需 —— 点到某个文件才读它，其余文件一个字节都不碰
 *  3. 不建索引、不缓存到磁盘、不监听变化 —— 关掉就没了，不留后台负担
 *
 * 代价说清楚：因为没有全量索引，筛选框只能筛**已经展开过**的层级，
 * 不是全项目搜索。要全项目搜索得先扫全盘，那就不"轻"了。
 */
const CODE_EXT = new Set(['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'go', 'rs', 'c', 'h', 'cpp',
  'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh', 'sql', 'vue', 'svelte',
  'json', 'yaml', 'yml', 'toml', 'md', 'html', 'css', 'scss']);

const humanSize = (bytes) => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
};

export function createFileTree({ onOpenFile }) {
  let root = null;
  let filter = '';
  const cache = new Map();      // relPath -> items（只缓存展开过的层）
  const expanded = new Set();
  let busy = false;

  const listEl = h('div', { class: 'nb__tree' });
  const headEl = h('div', { class: 'nb__tree-head' });
  const filterInput = h('input', {
    class: 'field field--sm',
    placeholder: '筛选已展开的文件',
    oninput: () => { filter = filterInput.value.trim().toLowerCase(); render(); },
  });

  const el = h('div', { class: 'nb__tree-wrap' }, headEl, listEl);

  async function loadLevel(relPath) {
    if (cache.has(relPath)) return cache.get(relPath);
    const result = await window.toolbox.notebook.listDir({ root, relPath });
    if (!result.ok) {
      toast(result.error, 'bad');
      cache.set(relPath, []);
      return [];
    }
    if (result.truncated) toast(`${relPath || '根目录'} 文件太多，只列了前 600 个`, 'info');
    cache.set(relPath, result.items);
    return result.items;
  }

  async function open(rootPath) {
    root = rootPath;
    cache.clear();
    expanded.clear();
    filter = '';
    filterInput.value = '';
    const info = await window.toolbox.notebook.folderInfo(rootPath);
    headEl.textContent = '';
    headEl.append(
      h('div', { class: 'nb__tree-title', title: rootPath },
        h('span', {}, info.name || rootPath),
        info.hasGraph ? h('span', { class: 'tag tag--good' }, '有图谱') : null,
      ),
      filterInput,
    );
    await loadLevel('');
    await render();
    return info;
  }

  async function toggle(item) {
    if (busy) return;
    busy = true;
    try {
      if (expanded.has(item.relPath)) expanded.delete(item.relPath);
      else {
        expanded.add(item.relPath);
        await loadLevel(item.relPath);   // 展开这一刻才去读这一层
      }
      await render();
    } finally {
      busy = false;
    }
  }

  async function render() {
    if (!root) return;
    const rows = [];

    const walk = (relPath, depth) => {
      for (const item of cache.get(relPath) || []) {
        const hit = !filter || item.name.toLowerCase().includes(filter);
        const childrenExpanded = item.isDir && expanded.has(item.relPath);
        // 筛选时，父目录只要有命中的后代就保留，否则会把路径截断
        const kept = hit || (childrenExpanded && hasDescendantHit(item.relPath));
        if (kept) rows.push({ item, depth });
        if (childrenExpanded) walk(item.relPath, depth + 1);
      }
    };

    const hasDescendantHit = (relPath) => (cache.get(relPath) || []).some((child) => (
      child.name.toLowerCase().includes(filter)
      || (child.isDir && expanded.has(child.relPath) && hasDescendantHit(child.relPath))
    ));

    walk('', 0);

    listEl.textContent = '';
    if (!rows.length) {
      listEl.append(h('div', { class: 'faint nb__hint' },
        filter ? '已展开的层里没有匹配的。筛选只在展开过的目录里生效。' : '这个目录是空的。'));
      return;
    }

    for (const { item, depth } of rows) {
      const isCode = CODE_EXT.has(item.ext);
      listEl.append(h('button', {
        class: `nb__tree-row${item.isDir ? ' is-dir' : ''}${isCode ? '' : ' is-dim'}`,
        style: { paddingLeft: `${8 + depth * 13}px` },
        title: item.relPath,
        onclick: () => (item.isDir ? toggle(item) : openFile(item)),
      },
        h('span', { class: 'nb__tree-icon' },
          item.isDir ? (expanded.has(item.relPath) ? '▾' : '▸') : ''),
        h('span', { class: 'nb__tree-name' }, item.name),
        item.isDir ? null : h('span', { class: 'faint nb__tree-size' }, humanSize(item.size)),
      ));
    }
  }

  async function openFile(item) {
    const result = await window.toolbox.notebook.readFile({ root, relPath: item.relPath });
    if (!result.ok) return toast(result.error, 'bad');
    onOpenFile({ ...result, name: item.name, root });
  }

  return {
    el,
    open,
    get root() { return root; },
    clear() {
      root = null;
      cache.clear();
      expanded.clear();
      headEl.textContent = '';
      listEl.textContent = '';
    },
  };
}
