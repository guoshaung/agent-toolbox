import { h, toast } from '../../core/ui.js';

const FORMAT_ICONS = {
  pdf: '📕', doc: '📘', docx: '📘', txt: '📄', md: '📄',
  epub: '📚', caj: '📗', djvu: '📗', ppt: '📙', pptx: '📙',
  xls: '📊', xlsx: '📊', rtf: '📄',
};

/**
 * 文献管理器：自己的文献（PDF / Word / CAJ / epub 等）统一收进应用数据目录，
 * 支持多选导入、备注、系统打开、访达定位、删除。元信息存 config。
 */
export function createLiterature(root, ctx) {
  const { config } = ctx;
  const lit = window.toolbox.lit;

  const listEl = h('div', { class: 'lit__list' });
  const importBtn = h('button', {
    class: 'btn btn--primary',
    onclick: () => doImport(),
  }, '导入文献');

  function meta() {
    return config.get('research.litMeta') || {};
  }

  function fmtSize(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  }

  async function doImport() {
    importBtn.disabled = true;
    try {
      const imported = await lit.import();
      if (!imported.length) return;
      const metaMap = meta();
      for (const item of imported) {
        if (!metaMap[item.file]) {
          metaMap[item.file] = { note: '', addedAt: new Date().toISOString() };
        }
      }
      await config.set('research.litMeta', metaMap);
      toast(`导入 ${imported.length} 篇`, 'good');
      renderList();
    } catch (err) {
      toast(`导入失败：${err.message}`, 'bad');
    } finally {
      importBtn.disabled = false;
    }
  }

  async function removeItem(file) {
    const ok = await lit.remove(file);
    if (!ok) return toast('删除失败', 'bad');
    const metaMap = meta();
    delete metaMap[file];
    await config.set('research.litMeta', metaMap);
    renderList();
    toast('已删除', 'good');
  }

  async function renderList() {
    const files = await lit.list();
    const metaMap = meta();
    listEl.textContent = '';
    if (!files.length) {
      listEl.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'empty__icon' }, '📚'),
        '还没有文献。',
        h('br'),
        h('span', { class: 'faint' }, '点上面「导入文献」，支持 PDF / Word / CAJ / epub / TXT 等格式，可多选。'),
      ));
      return;
    }
    listEl.appendChild(h('div', { class: 'faint lit__count' }, `共 ${files.length} 篇`));
    for (const item of files) {
      const m = metaMap[item.file] || {};
      const noteInput = h('input', {
        class: 'field field--sm lit__note',
        placeholder: '备注（如：要精读 / 已引用 / 待复现）',
        value: m.note || '',
        onchange: async () => {
          const next = meta();
          next[item.file] = { ...(next[item.file] || {}), note: noteInput.value.trim(), addedAt: m.addedAt };
          await config.set('research.litMeta', next);
        },
      });
      listEl.appendChild(
        h('div', { class: 'lit__item' },
          h('span', { class: 'lit__icon' }, FORMAT_ICONS[item.format] || '📄'),
          h('div', { class: 'lit__main' },
            h('div', { class: 'lit__name', title: item.file }, item.file),
            h('div', { class: 'lit__meta faint' },
              `${item.format.toUpperCase() || '?'} · ${fmtSize(item.size)} · ${new Date(item.mtime).toLocaleDateString('zh-CN')}`),
            noteInput,
          ),
          h('div', { class: 'lit__actions' },
            h('button', { class: 'btn btn--sm', onclick: () => lit.open(item.file) }, '打开'),
            h('button', { class: 'btn btn--sm btn--ghost', onclick: () => lit.reveal(item.file) }, '定位'),
            h('button', { class: 'btn btn--sm btn--ghost lit__del', title: '从库里删除', onclick: () => removeItem(item.file) }, '×'),
          ),
        ),
      );
    }
  }

  root.append(
    h('div', { class: 'bar research__viewbar' },
      importBtn,
      h('span', { class: 'faint lit__hint' }, '文件存在应用数据目录，原文件不动'),
    ),
    h('div', { class: 'lit__scroll' }, listEl),
  );
  renderList();
}
