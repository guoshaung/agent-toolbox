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
  const noticeEl = h('div', { class: 'lit__notice', hidden: true });
  const viewerEl = h('div', { class: 'lit__viewer' });

  const zoomOutBtn = h('button', { class: 'btn btn--icon', title: '缩小', onclick: () => zoom(-1) }, '−');
  const zoomLabel = h('span', { class: 'faint mono lit__zoom-label' }, '100%');
  const zoomInBtn = h('button', { class: 'btn btn--icon', title: '放大', onclick: () => zoom(1) }, '＋');
  const annoToggle = h('button', { class: 'btn btn--sm', onclick: () => toggleAnno() }, '批注');
  const bilingBtn = h('button', { class: 'btn btn--sm', hidden: true, title: '原文/译文对照（TXT/MD）', onclick: () => toggleBilingual() }, '对照');
  const selBtn = h('button', { class: 'btn btn--sm', title: '翻译当前选中的文字', onclick: () => translateSelection() }, '划词');
  const snipBtn = h('button', { class: 'btn btn--sm', title: '框选一块区域，OCR 圈内文字并翻译', onclick: () => startSnip() }, '圈译');
  const viewerBar = h('div', { class: 'bar lit__viewerbar', hidden: true },
    h('span', { class: 'lit__viewer-name', title: '' }, ''),
    h('span', { style: { flex: 1 } }),
    zoomOutBtn, zoomLabel, zoomInBtn,
    h('span', { class: 'subbar__sep' }),
    bilingBtn, selBtn, snipBtn,
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

  // ---- 翻译：对照 / 划词 / 圈译（有道免费接口 + 本地 Vision OCR） ----

  let rawText = null;        // TXT/MD 的原文（对照翻译用）
  let bilingual = false;
  let currentWebview = null; // PDF 的 webview 引用（圈译截图用）
  let snipping = false;
  let translating = false;

  /** 圈译/划词的浮动结果卡 */
  const transCard = h('div', { class: 'lit__trans-card', hidden: true });

  function showTransResult(srcText, translation) {
    transCard.textContent = '';
    transCard.removeAttribute('hidden');
    transCard.appendChild(
      h('div', { class: 'lit__trans-head' },
        h('strong', {}, '翻译'),
        h('span', { style: { flex: 1 } }),
        translation && h('button', {
          class: 'btn btn--sm',
          onclick: async () => { await window.toolbox.clipboard.write(translation); toast('译文已复制', 'good'); },
        }, '复制译文'),
        translation && h('button', {
          class: 'btn btn--sm',
          onclick: async () => {
            annoQuote.value = srcText || '';
            annoNote.value = `【译文】${translation}`;
            annoPanel.removeAttribute('hidden');
            renderAnnos();
            toast('已填进批注栏，补一句想法再点「记下」', 'info');
          },
        }, '存为批注'),
        h('button', { class: 'lit__anno-del', title: '关闭', onclick: () => transCard.setAttribute('hidden', '') }, '×'),
      ),
      srcText && h('div', { class: 'lit__trans-src faint' }, srcText),
      translation && h('div', { class: 'lit__trans-dst' }, translation),
    );
  }

  function showTransBusy(text) {
    transCard.textContent = '';
    transCard.removeAttribute('hidden');
    transCard.appendChild(h('div', { class: 'lit__trans-head' },
      h('span', { class: 'spinner' }), ` ${text}`,
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'lit__anno-del', title: '关闭', onclick: () => transCard.setAttribute('hidden', '') }, '×'),
    ));
  }

  /** 划词翻译：文本阅读器走 window.getSelection；PDF 试试 webview 里能不能拿到选区 */
  async function translateSelection() {
    if (translating || !current) return;
    let selected = '';
    if (currentWebview) {
      try {
        selected = await currentWebview.executeJavaScript('window.getSelection().toString()') || '';
      } catch { /* PDF 插件里拿不到 */ }
    } else {
      selected = String(window.getSelection()?.toString() || '');
    }
    selected = selected.trim();
    if (!selected) {
      toast(currentWebview ? 'PDF 里选不了字就用「圈译」框选区域' : '先在左边原文里选中一段文字', 'info');
      return;
    }
    translating = true;
    showTransBusy('正在翻译…');
    try {
      const result = await lit.translate(selected);
      if (!result.ok) return showTransResult(selected, `翻译失败：${result.error}`);
      showTransResult(selected, result.translation);
    } catch (err) {
      showTransResult(selected, `翻译失败：${err.message}`);
    } finally {
      translating = false;
    }
  }

  /** 圈译：在阅读区上盖一层蒙版拖框 → 截这块 → OCR → 翻译 */
  function startSnip() {
    if (snipping || !current || !currentWebview) {
      if (!currentWebview) toast('圈译用于 PDF；文本文档直接划词翻译', 'info');
      return;
    }
    snipping = true;
    const rectEl = h('div', { class: 'lit__snip-rect', hidden: true });
    const overlay = h('div', { class: 'lit__snip-overlay' },
      rectEl,
      h('div', { class: 'lit__snip-tip' }, '拖一个框圈住要翻译的内容，Esc 取消'),
    );
    let start = null;
    const escHandler = (e) => { if (e.key === 'Escape') cleanup(); };

    function cleanup() {
      snipping = false;
      document.removeEventListener('keydown', escHandler);
      overlay.remove();
    }

    overlay.addEventListener('mousedown', (e) => {
      const box = overlay.getBoundingClientRect();
      start = { x: e.clientX - box.left, y: e.clientY - box.top };
      rectEl.removeAttribute('hidden');
    });
    overlay.addEventListener('mousemove', (e) => {
      if (!start) return;
      const box = overlay.getBoundingClientRect();
      const cur = { x: e.clientX - box.left, y: e.clientY - box.top };
      const x = Math.min(start.x, cur.x);
      const y = Math.min(start.y, cur.y);
      const w = Math.abs(cur.x - start.x);
      const hh = Math.abs(cur.y - start.y);
      Object.assign(rectEl.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` });
    });
    overlay.addEventListener('mouseup', async (e) => {
      if (!start) return;
      const box = overlay.getBoundingClientRect();
      const cur = { x: e.clientX - box.left, y: e.clientY - box.top };
      const rect = {
        x: Math.round(Math.min(start.x, cur.x)),
        y: Math.round(Math.min(start.y, cur.y)),
        width: Math.round(Math.abs(cur.x - start.x)),
        height: Math.round(Math.abs(cur.y - start.y)),
      };
      cleanup();
      if (rect.width < 12 || rect.height < 12) return;
      showTransBusy('正在截图 + OCR…');
      try {
        const img = await currentWebview.capturePage(rect);
        const result = await lit.snipTranslate(img.toDataURL());
        if (!result.ok) return showTransResult(result.srcText, `失败：${result.error}`);
        showTransResult(result.srcText, result.translation);
      } catch (err) {
        showTransResult(null, `圈译失败：${err.message}`);
      }
    });

    document.addEventListener('keydown', escHandler);
    viewerEl.style.position = 'relative';
    viewerEl.appendChild(overlay);
  }

  /** 对照翻译：TXT/MD 按段落原文/译文上下排，缓存到 config */
  function paragraphs() {
    return String(rawText || '').split(/\n+/).map((p) => p.trim()).filter(Boolean).slice(0, 60);
  }

  function transCacheKey() {
    return `research.litTrans.${current.file}`;
  }

  async function toggleBilingual() {
    if (!current || !rawText || translating) return;
    bilingual = !bilingual;
    bilingBtn.classList.toggle('is-on', bilingual);
    if (!bilingual) return renderTextPlain();

    const paras = paragraphs();
    const cache = config.get(transCacheKey()) || {};
    viewerEl.textContent = '';
    const wrap = h('div', { class: 'lit__biling' });
    viewerEl.appendChild(wrap);
    const cells = paras.map((p, i) => {
      const cell = h('div', { class: 'lit__biling-item' },
        h('div', { class: 'lit__biling-src' }, p),
        h('div', { class: 'lit__biling-dst faint' }, cache[i] || '（待翻译）'),
      );
      wrap.appendChild(cell);
      return cell;
    });

    const pending = paras.map((p, i) => ({ p, i })).filter(({ i }) => !cache[i]);
    if (!pending.length) return;
    translating = true;
    let done = 0;
    try {
      for (const { p, i } of pending) {
        if (!bilingual || current == null) break; // 中途切走了
        cells[i].querySelector('.lit__biling-dst').textContent = '翻译中…';
        try {
          const result = await lit.translate(p);
          cache[i] = result.ok ? result.translation : `（失败：${result.error}）`;
        } catch (err) {
          cache[i] = `（失败：${err.message}）`;
        }
        cells[i].querySelector('.lit__biling-dst').textContent = cache[i];
        done += 1;
        bilingBtn.textContent = `对照 ${done}/${pending.length}`;
        await new Promise((r) => setTimeout(r, 200)); // 防有道限流
      }
      await config.set(transCacheKey(), cache);
    } finally {
      translating = false;
      bilingBtn.textContent = '对照';
    }
  }

  function renderTextPlain() {
    viewerEl.textContent = '';
    viewerEl.appendChild(h('div', { class: 'lit__text' }, rawText));
    zoom(0);
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
    rawText = null;
    bilingual = false;
    bilingBtn.textContent = '对照';
    bilingBtn.classList.remove('is-on');
    currentWebview = null;
    transCard.setAttribute('hidden', '');
    zoomIndex = 2;
    zoomLabel.textContent = '100%';
    viewerBar.removeAttribute('hidden');
    viewerBar.querySelector('.lit__viewer-name').textContent = item.file;
    viewerBar.querySelector('.lit__viewer-name').title = item.file;
    viewerEl.textContent = '';
    annoPanel.setAttribute('hidden', '');
    bilingBtn.setAttribute('hidden', '');

    if (item.format === 'pdf') {
      const fullPath = await lit.path(item.file);
      if (!fullPath) return viewerFail('文件不存在了，可能被移动过。');
      // 逐段编码：中文名、空格、# 之类都不能漏
      const fileUrl = `file://${fullPath.split('/').map(encodeURIComponent).join('/')}`;
      const view = h('webview', {
        class: 'lit__pdf',
        src: fileUrl,
      });
      currentWebview = view;
      viewerEl.appendChild(view);
      return;
    }

    if (TEXT_READABLE.has(item.format)) {
      const result = await lit.readText(item.file);
      if (!result.ok) return viewerFail(result.error);
      rawText = result.content;
      bilingBtn.removeAttribute('hidden');
      renderTextPlain();
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

  /** 下载失败时的持久提示卡：地址留下来，可打开/复制/关掉，切走自动消失 */
  function showFetchNotice(result) {
    noticeEl.textContent = '';
    if (!result) { noticeEl.setAttribute('hidden', ''); return; }
    noticeEl.removeAttribute('hidden');
    noticeEl.appendChild(
      h('div', { class: 'lit__notice-head' },
        h('strong', {}, result.code === 'download-failed' ? '找到了，但自动下载没成功' : '没找到免费下载源'),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'lit__anno-del', title: '关闭', onclick: () => showFetchNotice(null) }, '×'),
      ),
      result.title && h('div', { class: 'lit__notice-title' }, result.title),
      h('div', { class: 'faint' }, result.error),
      result.url && h('div', { class: 'lit__notice-url' },
        h('code', {}, result.url),
        h('button', {
          class: 'btn btn--sm btn--primary',
          onclick: () => window.toolbox.shell.openExternal(result.url),
        }, '打开下载地址'),
        h('button', {
          class: 'btn btn--sm',
          onclick: async () => { await window.toolbox.clipboard.write(result.url); toast('地址已复制', 'good'); },
        }, '复制地址'),
      ),
      result.url && h('div', { class: 'faint lit__notice-hint' }, '手动下载后用「导入文献」放进来即可。'),
    );
  }

  /** 按名字自动下载：优先 arXiv 免费源，找不到就提示用户自己去找 */
  async function doFetch() {
    const query = fetchInput.value.trim();
    if (!query) return toast('先粘贴文献名或 arXiv 号', 'info');
    fetchBtn.disabled = true;
    showFetchNotice(null);
    fetchStatus.textContent = '正在 arXiv / dblp / OpenAlex 上找免费 PDF…';
    try {
      const result = await lit.fetchByTitle(query);
      if (!result.ok) {
        fetchStatus.textContent = '';
        showFetchNotice(result);
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
      h('div', { class: 'lit__side' }, noticeEl, listEl),
      h('div', { class: 'lit__reader' },
        viewerBar,
        h('div', { class: 'lit__reader-body' },
          viewerEl,
          transCard,
          annoPanel,
        ),
      ),
    ),
  );
  viewerIdle();
  renderList();
}
