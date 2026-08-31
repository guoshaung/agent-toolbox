import { h, toast } from '../../core/ui.js';

const FORMAT_ICONS = {
  pdf: '📕', doc: '📘', docx: '📘', txt: '📄', md: '📄',
  epub: '📚', caj: '📗', djvu: '📗', ppt: '📙', pptx: '📙',
  xls: '📊', xlsx: '📊', rtf: '📄',
};
const TEXT_READABLE = new Set(['txt', 'md', 'rtf']);
const ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5, 2];

/**
 * 文献管理器：左边是库（导入/备注/删除），右边是内置阅读器。
 * - PDF：Chromium 内置 PDF 查看器（自带缩放/翻页/搜索/选中复制）
 * - TXT/MD：应用内文本阅读，支持字号缩放
 * - 批注：选中原文复制后，在右侧批注栏记「引用 + 我的想法」，按文献存本地
 * - DOCX/CAJ 等 Chromium 渲染不了的格式：给提示卡，外部打开兜底
 */
export function createLiterature(root, ctx) {
  const { config } = ctx;
  const lit = window.toolbox.lit;

  let files = [];
  let current = null; // 当前阅读的 { file, format, size, mtime }
  let zoomIndex = 2;  // ZOOM_STEPS 里的 1.0

  const listEl = h('div', { class: 'lit__list' });
  const viewerEl = h('div', { class: 'lit__viewer' });

  const zoomOutBtn = h('button', { class: 'btn btn--icon', title: '缩小', onclick: () => zoom(-1) }, '−');
  const zoomLabel = h('span', { class: 'faint mono lit__zoom-label' }, '100%');
  const zoomInBtn = h('button', { class: 'btn btn--icon', title: '放大', onclick: () => zoom(1) }, '＋');
  const annoToggle = h('button', { class: 'btn btn--sm', onclick: () => toggleAnno() }, '批注');
  const viewerBar = h('div', { class: 'bar lit__viewerbar', hidden: true },
    h('span', { class: 'lit__viewer-name', title: '' }, ''),
    h('span', { style: { flex: 1 } }),
    zoomOutBtn, zoomLabel, zoomInBtn,
    h('span', { class: 'subbar__sep' }),
    annoToggle,
  );

  // ---- 批注栏 ----
  const annoList = h('div', { class: 'lit__anno-list' });
  const annoQuote = h('textarea', {
    class: 'field lit__anno-quote',
    placeholder: '引用的原文（在 PDF 里选中 → Cmd+C → 粘贴到这里；可空）',
  });
  const annoNote = h('textarea', {
    class: 'field lit__anno-note',
    placeholder: '我的批注…',
  });
  const annoPanel = h('div', { class: 'lit__anno', hidden: true },
    h('div', { class: 'lit__anno-head' }, '批注'),
    annoQuote,
    annoNote,
    h('button', { class: 'btn btn--sm btn--primary', onclick: () => addAnno() }, '记下'),
    annoList,
  );

  function annoKey() {
    return `research.litAnno.${current.file}`;
  }

  function annotations() {
    return (config.get(annoKey()) || []);
  }

  async function addAnno() {
    const note = annoNote.value.trim();
    if (!note) return toast('批注内容还没写', 'info');
    const list = annotations();
    list.unshift({
      id: `anno-${Date.now()}`,
      quote: annoQuote.value.trim(),
      note,
      at: new Date().toISOString(),
    });
    await config.set(annoKey(), list);
    annoQuote.value = '';
    annoNote.value = '';
    renderAnnos();
    toast('批注已记下', 'good');
  }

  async function removeAnno(id) {
    await config.set(annoKey(), annotations().filter((a) => a.id !== id));
    renderAnnos();
  }

  function renderAnnos() {
    annoList.textContent = '';
    const list = annotations();
    if (!list.length) {
      annoList.appendChild(h('div', { class: 'faint lit__anno-empty' }, '还没有批注'));
      return;
    }
    for (const a of list) {
      annoList.appendChild(h('div', { class: 'lit__anno-item' },
        h('div', { class: 'lit__anno-item-head' },
          h('span', { class: 'faint' }, new Date(a.at).toLocaleString('zh-CN', { hour12: false })),
          h('button', { class: 'lit__anno-del', title: '删除', onclick: () => removeAnno(a.id) }, '×'),
        ),
        a.quote && h('div', { class: 'lit__anno-item-quote' }, a.quote),
        h('div', { class: 'lit__anno-item-note' }, a.note),
      ));
    }
  }

  function toggleAnno() {
    if (!current) return;
    const hidden = annoPanel.hasAttribute('hidden');
    if (hidden) {
      annoPanel.removeAttribute('hidden');
      renderAnnos();
    } else {
      annoPanel.setAttribute('hidden', '');
    }
  }

  // ---- 阅读器 ----

  function zoom(delta) {
    zoomIndex = Math.min(ZOOM_STEPS.length - 1, Math.max(0, zoomIndex + delta));
    const factor = ZOOM_STEPS[zoomIndex];
    zoomLabel.textContent = `${Math.round(factor * 100)}%`;
    const webview = viewerEl.querySelector('webview');
    if (webview) {
      try { webview.setZoomFactor(factor); } catch { /* 还没 attach */ }
    }
    const textEl = viewerEl.querySelector('.lit__text');
    if (textEl) textEl.style.fontSize = `${14.5 * factor}px`;
  }

  function viewerIdle() {
    viewerBar.setAttribute('hidden', '');
    annoPanel.setAttribute('hidden', '');
    viewerEl.textContent = '';
    viewerEl.appendChild(h('div', { class: 'empty' },
      h('span', { class: 'empty__icon' }, '📖'),
      '左边选一篇文献，直接在这里读。',
      h('br'),
      h('span', { class: 'faint' }, 'PDF 用内置查看器打开，不用再启动 WPS。'),
    ));
  }

  async function openReader(item) {
    current = item;
    zoomIndex = 2;
    zoomLabel.textContent = '100%';
    viewerBar.removeAttribute('hidden');
    viewerBar.querySelector('.lit__viewer-name').textContent = item.file;
    viewerBar.querySelector('.lit__viewer-name').title = item.file;
    viewerEl.textContent = '';
    annoPanel.setAttribute('hidden', '');

    if (item.format === 'pdf') {
      const fullPath = await lit.path(item.file);
      if (!fullPath) return viewerFail('文件不存在了，可能被移动过。');
      // 逐段编码：中文名、空格、# 之类都不能漏
      const fileUrl = `file://${fullPath.split('/').map(encodeURIComponent).join('/')}`;
      const view = h('webview', {
        class: 'lit__pdf',
        src: fileUrl,
      });
      viewerEl.appendChild(view);
      return;
    }

    if (TEXT_READABLE.has(item.format)) {
      const result = await lit.readText(item.file);
      if (!result.ok) return viewerFail(result.error);
      viewerEl.appendChild(h('div', { class: 'lit__text' }, result.content));
      return;
    }

    // Chromium 渲染不了的格式
    viewerEl.appendChild(h('div', { class: 'empty' },
      h('span', { class: 'empty__icon' }, FORMAT_ICONS[item.format] || '📄'),
      `${item.format.toUpperCase()} 格式暂时不能内置预览。`,
      h('br'),
      h('span', { class: 'faint' }, 'PDF / TXT / MD 可以直接在这里读。'),
      h('div', { style: { marginTop: '12px' } },
        h('button', { class: 'btn btn--primary', onclick: () => lit.open(item.file) }, '用系统程序打开'),
      ),
    ));
  }

  function viewerFail(message) {
    viewerEl.textContent = '';
    viewerEl.appendChild(h('div', { class: 'empty' }, `⚠️ ${message}`));
  }

  // ---- 文献库 ----

  function meta() {
    return config.get('research.litMeta') || {};
  }

  function fmtSize(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  }

  async function doImport(btn) {
    btn.disabled = true;
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
      const renamed = imported.filter((x) => x.renamed);
      toast(
        renamed.length
          ? `导入 ${imported.length} 篇，其中 ${renamed.length} 篇编号命名已按标题重命名`
          : `导入 ${imported.length} 篇`,
        'good',
      );
      renderList();
    } catch (err) {
      toast(`导入失败：${err.message}`, 'bad');
    } finally {
      btn.disabled = false;
    }
  }

  /** 整理库里已有的编号命名 PDF，备注跟着新文件名走 */
  async function fixNames(btn) {
    btn.disabled = true;
    try {
      const renames = await lit.fixNames();
      if (!renames.length) return toast('没有需要整理的编号命名 PDF', 'info');
      const metaMap = meta();
      for (const r of renames) {
        if (metaMap[r.from]) {
          metaMap[r.to] = metaMap[r.from];
          delete metaMap[r.from];
        }
      }
      await config.set('research.litMeta', metaMap);
      renderList();
      toast(`已重命名 ${renames.length} 篇：${renames[0].title || renames[0].to}${renames.length > 1 ? ' 等' : ''}`, 'good', 5000);
    } catch (err) {
      toast(`整理失败：${err.message}`, 'bad');
    } finally {
      btn.disabled = false;
    }
  }

  async function removeItem(item) {
    const ok = await lit.remove(item.file);
    if (!ok) return toast('删除失败', 'bad');
    const metaMap = meta();
    delete metaMap[item.file];
    await config.set('research.litMeta', metaMap);
    if (current?.file === item.file) {
      current = null;
      viewerIdle();
    }
    renderList();
    toast('已删除', 'good');
  }

  async function renderList() {
    files = await lit.list();
    const metaMap = meta();
    listEl.textContent = '';
    if (!files.length) {
      listEl.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'empty__icon' }, '📚'),
        '还没有文献。',
        h('br'),
        h('span', { class: 'faint' }, '点上面「导入文献」，PDF / Word / CAJ / epub 都行，可多选。'),
      ));
      return;
    }
    for (const item of files) {
      const m = metaMap[item.file] || {};
      const noteInput = h('input', {
        class: 'field field--sm lit__note',
        placeholder: '备注…',
        value: m.note || '',
        onchange: async () => {
          const next = meta();
          next[item.file] = { ...(next[item.file] || {}), note: noteInput.value.trim(), addedAt: m.addedAt };
          await config.set('research.litMeta', next);
        },
      });
      listEl.appendChild(
        h('div', { class: `lit__item${current?.file === item.file ? ' is-reading' : ''}` },
          h('span', { class: 'lit__icon' }, FORMAT_ICONS[item.format] || '📄'),
          h('div', { class: 'lit__main' },
            h('div', { class: 'lit__name', title: item.file }, item.file),
            h('div', { class: 'lit__meta faint' },
              `${item.format.toUpperCase() || '?'} · ${fmtSize(item.size)}`),
            noteInput,
          ),
          h('div', { class: 'lit__actions' },
            h('button', { class: 'btn btn--sm btn--primary', onclick: () => openReader(item) }, '阅读'),
            h('button', { class: 'btn btn--sm btn--ghost', title: '用系统程序打开', onclick: () => lit.open(item.file) }, '↗'),
            h('button', { class: 'btn btn--sm btn--ghost lit__del', title: '从库里删除', onclick: () => removeItem(item) }, '×'),
          ),
        ),
      );
    }
  }

  /** 按名字自动下载：优先 arXiv 免费源，找不到就提示用户自己去找 */
  async function doFetch() {
    const query = fetchInput.value.trim();
    if (!query) return toast('先粘贴文献名或 arXiv 号', 'info');
    fetchBtn.disabled = true;
    fetchStatus.textContent = '正在 arXiv / Semantic Scholar 上找免费 PDF…';
    try {
      const result = await lit.fetchByTitle(query);
      if (!result.ok) {
        fetchStatus.textContent = '';
        toast(result.error, 'bad', 6000);
        return;
      }
      const metaMap = meta();
      metaMap[result.file] = { note: `自动下载自 ${result.source}`, addedAt: new Date().toISOString() };
      await config.set('research.litMeta', metaMap);
      fetchInput.value = '';
      fetchStatus.textContent = '';
      toast(`已下载入库：${result.title}`, 'good', 5000);
      renderList();
    } catch (err) {
      fetchStatus.textContent = '';
      toast(`下载失败：${err.message}`, 'bad');
    } finally {
      fetchBtn.disabled = false;
    }
  }

  const fetchInput = h('input', {
    class: 'field lit__fetch-input',
    placeholder: '粘贴文献名 / arXiv 号，回车自动下载（arXiv 免费）',
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doFetch(); }
    },
  });
  const fetchBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => doFetch() }, '查找下载');
  const fetchStatus = h('span', { class: 'faint lit__fetch-status' }, '');

  const importBtn = h('button', { class: 'btn btn--primary', onclick: (e) => doImport(e.currentTarget) }, '导入文献');
  const fixBtn = h('button', {
    class: 'btn btn--sm',
    title: 'arxiv 这类编号命名的 PDF，读正文标题自动重命名',
    onclick: (e) => fixNames(e.currentTarget),
  }, '整理编号名');

  root.append(
    h('div', { class: 'bar research__viewbar' },
      importBtn,
      fixBtn,
      fetchInput,
      fetchBtn,
      fetchStatus,
      h('span', { class: 'faint lit__hint' }, '点「阅读」右侧直接看，不用开 WPS'),
    ),
    h('div', { class: 'lit__body' },
      h('div', { class: 'lit__side' }, listEl),
      h('div', { class: 'lit__reader' },
        viewerBar,
        h('div', { class: 'lit__reader-body' },
          viewerEl,
          annoPanel,
        ),
      ),
    ),
  );
  viewerIdle();
  renderList();
}
