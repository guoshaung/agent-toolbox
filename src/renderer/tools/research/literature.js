import { h, toast } from '../../core/ui.js';

const FORMAT_ICONS = {
  pdf: '📕', doc: '📘', docx: '📘', txt: '📄', md: '📄',
  epub: '📚', caj: '📗', djvu: '📗', ppt: '📙', pptx: '📙',
  xls: '📊', xlsx: '📊', rtf: '📄',
};
const TEXT_READABLE = new Set(['txt', 'md', 'rtf']);
const ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5, 2];

/** PDF.js 懒加载：只有打开 PDF 时才 import（自带 worker 配置，加载失败会退回主线程渲染） */
let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../../../../node_modules/pdfjs-dist/build/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(
        '../../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

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
  const handBtn = h('button', { class: 'btn btn--sm', title: '手掌：拖拽平移页面', onclick: () => setCursorMode('hand') }, '✋');
  const selectBtn = h('button', { class: 'btn btn--sm', title: '指针：选中文字（配合划词/批注）', onclick: () => setCursorMode('select') }, '➤');
  const selBtn = h('button', { class: 'btn btn--sm', title: '翻译当前选中的文字', onclick: () => translateSelection() }, '划词');
  const snipBtn = h('button', { class: 'btn btn--sm', title: '框选一块区域，OCR 圈内文字并翻译', onclick: () => startSnip() }, '圈译');
  const viewerBar = h('div', { class: 'bar lit__viewerbar', hidden: true },
    h('span', { class: 'lit__viewer-name', title: '' }, ''),
    h('span', { style: { flex: 1 } }),
    handBtn, selectBtn,
    h('span', { class: 'subbar__sep' }),
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
  let snipping = false;
  let translating = false;
  let cursorMode = config.get('research.lit.cursor', 'hand'); // hand | select
  let panOverlay = null;     // 手掌模式的拖拽层

  // PDF.js 自渲染状态
  let pdfDoc = null;         // PDFDocumentProxy
  let pdfLoadingTask = null; // 销毁用
  let pdfScrollEl = null;    // 滚动容器（手掌平移就滚它）
  let pdfPagesWrap = null;   // 页面包装层（流动缩放时对它做 CSS 变换）
  let pdfPageEls = {};       // n -> 页面占位 div
  let pdfRendered = new Set();
  let pdfRendering = new Set();
  let pdfFitScale = 1;       // 按宽度自适应的基础缩放
  let pdfBaseWidth = 612;    // 原始页宽（scale=1），窗口变化时重算适配用
  let pdfViewScale = 1;      // 目标缩放（浮点，流动变化）
  let pdfRenderedScale = 1;  // 画布当前实际渲染的缩放

  /** 圈译/划词的浮动结果卡 */
  const transCard = h('div', { class: 'lit__trans-card', hidden: true });

  /** 翻译方向：和主进程 detectTarget 一致 —— 中文为主译英，否则译中 */
  function targetLang(text) {
    const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
    return cjk > String(text).length * 0.2 ? '英文' : '中文';
  }

  /**
   * 圈译/划词专用：优先走 AI 接口（质量好，且没有有道「每分钟约 5 条新翻译」的免费配额
   * —— 之前对照翻译一批批跑，配额常常被烧光，圈译一等 12 秒然后报配额用完，看起来就是
   * 「圈了但没翻译」）。AI 没配好或失败时退回有道免费接口。
   */
  async function translateSmart(text) {
    const to = targetLang(text);
    try {
      const out = await ctx.ai.chat(
        `你是翻译引擎。把下面的内容准确翻译成${to}。\n` +
        '只输出译文本身：不要解释、不要重复原文、不要任何前后缀或引号。\n' +
        '保留原有的换行分段；代码、公式、文件路径、专有名词保留原样。\n\n' + text,
        { timeout: 60000 },
      );
      const cleaned = String(out || '').trim();
      if (cleaned) return { ok: true, translation: cleaned, via: 'ai' };
    } catch { /* AI 没配好 / 桥没登录 / 超时，都落到有道 */ }
    const fallback = await lit.translate(text, { interactive: true });
    return fallback.ok ? { ...fallback, via: 'youdao' } : fallback;
  }

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

  /** 记住最近一次非空选区：点「划词」按钮那一下会把选区塌掉，必须提前存 */
  let lastSelection = '';
  document.addEventListener('selectionchange', () => {
    const s = String(window.getSelection()?.toString() || '').trim();
    if (s) lastSelection = s;
  });

  /** 划词翻译：文本阅读器里选中的一段（PDF 没文本层，用圈译） */
  async function translateSelection() {
    if (translating || !current) return;
    const selected = String(window.getSelection()?.toString() || '').trim() || lastSelection;
    if (!selected) {
      toast(pdfDoc ? 'PDF 选不了字，用「圈译」圈住要翻的内容' : '先在左边原文里选中一段文字', 'info');
      return;
    }
    translating = true;
    showTransBusy(`正在翻译（${selected.length} 字）…`);
    try {
      const result = await translateSmart(selected);
      if (!result.ok) return showTransResult(selected, `翻译失败：${result.error}`);
      showTransResult(selected, result.translation);
      toast(`翻译好了（走${result.via === 'ai' ? 'AI 接口' : '有道'}），译文在右下角浮卡`, 'good');
    } catch (err) {
      showTransResult(selected, `翻译失败：${err.message}`);
    } finally {
      translating = false;
    }
  }

  /** 圈译：像画画一样绕着内容画一圈 → 取圈的外接框从页面画布裁图 → OCR → 翻译。
   *  裁图来自 PDF.js 渲染的高清画布（非屏幕截图），圈的内容多 8px 余量不会丢。 */
  function startSnip() {
    if (snipping || !current || !pdfDoc) {
      if (!pdfDoc) toast('圈译用于 PDF；文本文档直接划词翻译', 'info');
      return;
    }
    snipping = true;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'lit__snip-svg');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(pathEl);
    const overlay = h('div', { class: 'lit__snip-overlay' },
      svg,
      h('div', { class: 'lit__snip-tip' }, '像画画一样把要翻译的内容圈一圈，Esc 取消'),
    );
    let pts = [];
    const escHandler = (e) => { if (e.key === 'Escape') cleanup(); };

    function cleanup() {
      snipping = false;
      document.removeEventListener('keydown', escHandler);
      overlay.remove();
    }

    function toLocal(e) {
      const box = overlay.getBoundingClientRect();
      return [e.clientX - box.left, e.clientY - box.top];
    }

    function pathD() {
      return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + (pts.length > 2 ? ' Z' : '');
    }

    function bbox(pad) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const box = overlay.getBoundingClientRect();
      const x0 = Math.max(0, Math.round(Math.min(...xs) - pad));
      const y0 = Math.max(0, Math.round(Math.min(...ys) - pad));
      const x1 = Math.min(box.width, Math.ceil(Math.max(...xs) + pad));
      const y1 = Math.min(box.height, Math.ceil(Math.max(...ys) + pad));
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }

    overlay.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pts = [toLocal(e)];
      pathEl.setAttribute('d', pathD());
      // 松手才收尾，且只在真正落笔之后监听——防止无关点击把圈选会话关掉
      window.addEventListener('mouseup', done, { once: true });
    });
    overlay.addEventListener('mousemove', (e) => {
      if (!pts.length) return;
      const [x, y] = toLocal(e);
      const [lx, ly] = pts[pts.length - 1];
      if (Math.abs(x - lx) + Math.abs(y - ly) < 3) return; // 太密的点不要
      pts.push([x, y]);
      pathEl.setAttribute('d', pathD());
    });
    async function done() {
      window.removeEventListener('mouseup', done);
      if (!pts.length) return;
      const rect = bbox(8); // 外接框 + 8px 余量：多一点可以，少一点不行
      cleanup();
      if (rect.width < 16 || rect.height < 16) return; // 点了一下没画圈
      showTransBusy(`正在从高清页面裁图（${Math.round(rect.width)}×${Math.round(rect.height)}）+ OCR…`);
      try {
        const crops = await cropLassoRegion(rect);
        if (!crops.length) return showTransResult(null, '圈住的地方还没有渲染出来，滚动一下再圈。');
        // 先把每页的裁片都 OCR 出来；翻译只发一次请求（合并全文），
        // 既省有道配额，AI 翻译也能带着上下文，术语前后一致
        const srcParts = [];
        const ocrErrs = [];
        for (const c of crops) {
          const r = await lit.snipOcr(c.dataUrl);
          if (r.ok && r.text) srcParts.push(r.text);
          else if (r.error) ocrErrs.push(`第 ${c.num} 页：${r.error}`);
        }
        const srcText = srcParts.join('\n');
        if (!srcText) {
          return showTransResult(null, ocrErrs.join('；') || '圈里没识别出文字，圈大一点、对准文字试试。');
        }
        showTransBusy(`识别出 ${srcText.length} 字，翻译中…`);
        const tr = await translateSmart(srcText);
        if (!tr.ok) {
          // OCR 原文还在的话也亮出来，方便看是识别问题还是翻译问题
          return showTransResult(srcText, `翻译失败：${tr.error}`);
        }
        showTransResult(srcText, tr.translation + (ocrErrs.length ? `\n（${ocrErrs.join('；')}）` : ''));
        toast(`翻译好了（走${tr.via === 'ai' ? 'AI 接口' : '有道'}），原文+译文都在右下角浮卡`, 'good');
      } catch (err) {
        showTransResult(null, `圈译失败：${err.message}`);
      }
    }

    // mouseup 挂 window：拖到阅读区外松手也能正常收尾
    window.addEventListener('mouseup', done, { once: true });

    document.addEventListener('keydown', escHandler);
    viewerEl.style.position = 'relative';
    viewerEl.appendChild(overlay);
  }

  /** 对照翻译：TXT/MD 按段落原文/译文上下排，缓存到 config。
   *  有道免费配额约每分钟 5 条新翻译，所以把多段打包成 ≤850 字的批
   *  （有道保留换行结构），按批请求再按行拆回去；拆不齐的批退回逐段翻。 */
  function paragraphs() {
    return String(rawText || '').split(/\n+/).map((p) => p.trim()).filter(Boolean).slice(0, 60);
  }

  function transCacheKey() {
    return `research.litTrans.${current.file}`;
  }

  function makeParaBatches(paras, pendingIdx) {
    const batches = [];
    let cur = [];
    let chars = 0;
    for (const i of pendingIdx) {
      if (cur.length && (chars + paras[i].length > 850 || cur.length >= 6)) {
        batches.push(cur);
        cur = [];
        chars = 0;
      }
      cur.push(i);
      chars += paras[i].length;
    }
    if (cur.length) batches.push(cur);
    return batches;
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

    // 以前失败的条目不算已翻译，重开时自动重试
    const pendingIdx = paras.map((_, i) => i).filter((i) => !cache[i] || String(cache[i]).startsWith('（失败'));
    if (!pendingIdx.length) return;
    translating = true;
    const batches = makeParaBatches(paras, pendingIdx);
    let done = 0;
    try {
      for (const batch of batches) {
        if (!bilingual || current == null) break; // 中途切走了
        for (const i of batch) cells[i].querySelector('.lit__biling-dst').textContent = '翻译中…';
        let ok = false;
        try {
          const result = await lit.translate(batch.map((i) => paras[i]).join('\n'));
          if (result.ok) {
            const lines = result.translation.split('\n');
            if (lines.length === batch.length) {
              batch.forEach((i, k) => { cache[i] = lines[k].trim(); cells[i].querySelector('.lit__biling-dst').textContent = lines[k].trim(); });
              ok = true;
            }
          } else if (result.error) {
            toast(result.error, 'bad');
          }
        } catch { /* 落到逐段兜底 */ }
        if (!ok) {
          // 行拆不齐（模型偶发合并/拆分）：逐段兜底
          for (const i of batch) {
            try {
              const one = await lit.translate(paras[i]);
              cache[i] = one.ok ? one.translation : `（失败：${one.error}）`;
            } catch (err) {
              cache[i] = `（失败：${err.message}）`;
            }
            cells[i].querySelector('.lit__biling-dst').textContent = cache[i];
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
        done += batch.length;
        bilingBtn.textContent = `对照 ${done}/${pendingIdx.length}`;
        await config.set(transCacheKey(), cache); // 边翻边存，中断不丢
        if (batches.indexOf(batch) < batches.length - 1) {
          await new Promise((r) => setTimeout(r, 13000)); // 免费配额 ~5 条新内容/分钟
        }
      }
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

  /** PDF 手掌/指针切换：手掌 = 透明拖拽层平移滚动容器；指针 = 原生光标 */
  function setCursorMode(mode) {
    cursorMode = mode;
    config.set('research.lit.cursor', mode);
    applyCursorMode();
  }

  function applyCursorMode() {
    handBtn.classList.toggle('is-on', cursorMode === 'hand');
    selectBtn.classList.toggle('is-on', cursorMode === 'select');
    if (!pdfScrollEl) return;
    viewerEl.style.position = 'relative';
    if (cursorMode === 'hand') {
      if (panOverlay) return;
      panOverlay = h('div', { class: 'lit__pan-overlay' });
      let last = null;
      panOverlay.addEventListener('mousedown', (e) => {
        last = { x: e.clientX, y: e.clientY };
        panOverlay.classList.add('is-dragging');
        e.preventDefault();
      });
      window.addEventListener('mousemove', (e) => {
        if (!last || !pdfScrollEl) return;
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        pdfScrollEl.scrollBy(-dx, -dy); // 拖文章 = 内容跟手走
      });
      window.addEventListener('mouseup', () => {
        last = null;
        panOverlay?.classList.remove('is-dragging');
      });
      // 拖拽层盖住了滚动容器，滚轮在这里分发的：普通滚轮 = 滚动，⌘/捏合 = 缩放
      panOverlay.addEventListener('wheel', (e) => {
        if (!pdfScrollEl) return;
        if (e.metaKey || e.ctrlKey) return wheelZoom(e);
        e.preventDefault();
        pdfScrollEl.scrollBy(e.deltaX, e.deltaY);
      }, { passive: false });
      viewerEl.appendChild(panOverlay);
    } else if (panOverlay) {
      panOverlay.remove();
      panOverlay = null;
    }
  }

  // ---- PDF.js 自渲染：滚动、缩放、圈译截图全部自己掌控 ----

  let pdfObserver = null;
  let pdfRerenderTimer = null;
  let pdfResizeHandler = null;

  async function openPdfJs(item) {
    const buf = await lit.readPdf(item.file);
    if (!buf.ok) throw new Error(buf.error);
    const pdfjsLib = await loadPdfJs();
    // pdf.js 会把 data 的缓冲区 detach 掉，给副本
    pdfLoadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buf.data),
      standardFontDataUrl: new URL('../../../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
      cMapUrl: new URL('../../../../node_modules/pdfjs-dist/cmaps/', import.meta.url).href,
      cMapPacked: true,
    });
    pdfDoc = await pdfLoadingTask.promise;

    // 等一帧布局稳定，clientWidth 才是真值（否则量出 0，页面尺寸全错）
    await new Promise((r) => requestAnimationFrame(r));
    const dpr = window.devicePixelRatio || 1;
    const first = await pdfDoc.getPage(1);
    const baseVp = first.getViewport({ scale: 1 });
    pdfBaseWidth = baseVp.width;
    // 按阅读区宽度自适应，再乘缩放档位；量不到宽度就退回原始页宽
    const avail = viewerEl.clientWidth > 100 ? viewerEl.clientWidth - 36 : baseVp.width;
    pdfFitScale = Math.min(2, Math.max(0.3, avail / baseVp.width));
    pdfViewScale = pdfFitScale;
    pdfRenderedScale = pdfFitScale;

    const scrollEl = h('div', { class: 'lit__pdfjs' });
    pdfPagesWrap = h('div', { class: 'lit__pdfjs-pages' });
    scrollEl.appendChild(pdfPagesWrap);
    // 指针模式下没有拖拽层，⌘/捏合缩放直接挂在滚动容器上
    scrollEl.addEventListener('wheel', (e) => {
      if (e.metaKey || e.ctrlKey) wheelZoom(e);
    }, { passive: false });
    viewerEl.style.position = 'relative';
    viewerEl.appendChild(scrollEl);
    pdfScrollEl = scrollEl;
    // 窗口/面板尺寸变化后按新宽度重新适配，页面永远保持居中
    if (!pdfResizeHandler) {
      pdfResizeHandler = () => { if (pdfDoc) schedulePdfRerender(true); };
      window.addEventListener('resize', pdfResizeHandler);
    }

    pdfPageEls = {};
    pdfRendered = new Set();
    pdfRendering = new Set();
    for (let n = 1; n <= pdfDoc.numPages; n += 1) {
      const vp = (await pdfDoc.getPage(n)).getViewport({ scale: pdfRenderedScale });
      const pageEl = h('div', { class: 'lit__page', dataset: { page: String(n) } },
        h('canvas', {}),
        h('div', { class: 'lit__page-no faint' }, String(n)),
      );
      pageEl.style.width = `${Math.round(vp.width)}px`;
      pageEl.style.height = `${Math.round(vp.height)}px`;
      pdfPagesWrap.appendChild(pageEl);
      pdfPageEls[n] = pageEl;
    }

    // 首页立刻渲，其余进入视口附近再渲
    await renderPdfPage(1);
    pdfObserver = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) renderPdfPage(Number(en.target.dataset.page));
      }
    }, { root: scrollEl, rootMargin: '600px 0px' });
    for (const el of Object.values(pdfPageEls)) pdfObserver.observe(el);

    applyCursorMode();
  }

  async function renderPdfPage(n) {
    if (!pdfDoc || pdfRendered.has(n) || pdfRendering.has(n)) return;
    pdfRendering.add(n);
    try {
      const page = await pdfDoc.getPage(n);
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: pdfRenderedScale * dpr });
      const canvas = pdfPageEls[n]?.querySelector('canvas');
      if (!canvas) return;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pdfRendered.add(n);
    } finally {
      pdfRendering.delete(n);
    }
  }

  /** 手势停止 ~260ms 后：按目标缩放重排尺寸、清缓存重渲可见页，然后撤掉 CSS 变换换回高清位图 */
  function schedulePdfRerender(refit = false) {
    if (!pdfDoc) return;
    clearTimeout(pdfRerenderTimer);
    pdfRerenderTimer = setTimeout(async () => {
      if (refit) {
        // 窗口变化：重算自适应基准，保持用户当前缩放比例不变
        const prevFit = pdfFitScale;
        const avail = viewerEl.clientWidth > 100 ? viewerEl.clientWidth - 36 : pdfBaseWidth;
        pdfFitScale = Math.min(2, Math.max(0.3, avail / pdfBaseWidth));
        pdfViewScale = pdfViewScale * (pdfFitScale / prevFit);
      }
      if (!pdfPagesWrap) return;
      pdfPagesWrap.style.transform = '';
      for (let n = 1; n <= pdfDoc.numPages; n += 1) {
        const page = await pdfDoc.getPage(n);
        const vp = page.getViewport({ scale: pdfViewScale });
        const el = pdfPageEls[n];
        if (!el) continue;
        el.style.width = `${Math.round(vp.width)}px`;
        el.style.height = `${Math.round(vp.height)}px`;
        const canvas = el.querySelector('canvas');
        canvas.width = 0; // 清掉旧内容，防拉伸模糊
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      }
      pdfRendered.clear();
      pdfRenderedScale = pdfViewScale;
      zoomLabel.textContent = `${Math.round((pdfViewScale / pdfFitScale) * 100)}%`;
      // 当前视口内的页马上渲
      const box = pdfScrollEl.getBoundingClientRect();
      for (const el of Object.values(pdfPageEls)) {
        const r = el.getBoundingClientRect();
        if (r.bottom > box.top - 600 && r.top < box.bottom + 600) renderPdfPage(Number(el.dataset.page));
      }
    }, 260);
  }

  /** 把圈住的区域从已渲染的页面画布上裁下来（画布是 dpr 缩放的高清位图） */
  async function cropLassoRegion(rect) {
    const overlayBox = viewerEl.getBoundingClientRect();
    const crops = [];
    for (const [n, pageEl] of Object.entries(pdfPageEls)) {
      const pr = pageEl.getBoundingClientRect();
      const ix0 = Math.max(rect.x, pr.left - overlayBox.left);
      const iy0 = Math.max(rect.y, pr.top - overlayBox.top);
      const ix1 = Math.min(rect.x + rect.width, pr.right - overlayBox.left);
      const iy1 = Math.min(rect.y + rect.height, pr.bottom - overlayBox.top);
      if (ix1 - ix0 < 4 || iy1 - iy0 < 4) continue;
      const num = Number(n);
      if (!pdfRendered.has(num)) await renderPdfPage(num);
      const canvas = pageEl.querySelector('canvas');
      if (!canvas || !canvas.width) continue;
      const ratio = canvas.width / pr.width; // 画布像素 / CSS 像素
      const sx = Math.round((ix0 - (pr.left - overlayBox.left)) * ratio);
      const sy = Math.round((iy0 - (pr.top - overlayBox.top)) * ratio);
      const sw = Math.max(1, Math.round((ix1 - ix0) * ratio));
      const sh = Math.max(1, Math.round((iy1 - iy0) * ratio));
      const off = document.createElement('canvas');
      off.width = sw;
      off.height = sh;
      off.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      crops.push({ num, dataUrl: off.toDataURL('image/png') });
    }
    return crops;
  }

  function zoom(delta) {
    if (pdfDoc) {
      // PDF：连续缩放，按钮一步 ×1.25 / ÷1.25，同样走流动变换
      applyGestureZoom(delta > 0 ? 1.25 : 0.8);
      return;
    }
    zoomIndex = Math.min(ZOOM_STEPS.length - 1, Math.max(0, zoomIndex + delta));
    const factor = ZOOM_STEPS[zoomIndex];
    zoomLabel.textContent = `${Math.round(factor * 100)}%`;
    const textEl = viewerEl.querySelector('.lit__text');
    if (textEl) textEl.style.fontSize = `${14.5 * factor}px`;
  }

  /** ⌘+滚轮 / 触控板捏合 / 缩放按钮 —— 统一走流动缩放：
   *  手势中先用 CSS 变换即时跟手，停手 ~260ms 后按最终比例高清重渲。 */
  function applyGestureZoom(mult) {
    if (!pdfDoc || !pdfPagesWrap) return;
    const min = Math.max(0.25, pdfFitScale * 0.3);
    const max = Math.max(min + 0.1, pdfFitScale * 4);
    const prev = pdfViewScale;
    pdfViewScale = Math.min(max, Math.max(min, prev * mult));
    if (pdfViewScale === prev) return;
    zoomLabel.textContent = `${Math.round((pdfViewScale / pdfFitScale) * 100)}%`;
    const ratio = pdfViewScale / pdfRenderedScale;
    pdfPagesWrap.style.transformOrigin = '50% 0'; // 水平绕中线缩放，保持居中
    pdfPagesWrap.style.transform = `scale(${ratio})`;
    schedulePdfRerender();
  }

  /** ⌘+滚轮 / 触控板捏合事件入口：指数缩放，多少都吃，不再一档一档跳 */
  function wheelZoom(e) {
    if (!pdfDoc) return;
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    applyGestureZoom(Math.exp(-delta * 0.0022));
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
    // 释放上一个 PDF
    if (pdfObserver) { pdfObserver.disconnect(); pdfObserver = null; }
    if (pdfLoadingTask) { try { pdfLoadingTask.destroy(); } catch { /* 已销毁 */ } pdfLoadingTask = null; }
    pdfDoc = null;
    pdfScrollEl = null;
    pdfPagesWrap = null;
    pdfPageEls = {};
    pdfRendered = new Set();
    pdfRendering = new Set();
    panOverlay = null; // viewerEl 马上要清空，旧拖拽层引用作废
    transCard.setAttribute('hidden', '');
    zoomIndex = 2;
    zoomLabel.textContent = '100%';
    viewerBar.removeAttribute('hidden');
    viewerBar.querySelector('.lit__viewer-name').textContent = item.file;
    viewerBar.querySelector('.lit__viewer-name').title = item.file;
    viewerEl.textContent = '';
    annoPanel.setAttribute('hidden', '');
    bilingBtn.setAttribute('hidden', '');
    handBtn.setAttribute('hidden', '');
    selectBtn.setAttribute('hidden', '');

    if (item.format === 'pdf') {
      handBtn.removeAttribute('hidden');
      selectBtn.removeAttribute('hidden');
      selBtn.setAttribute('hidden', ''); // PDF 没有文本层，划词用圈译替代
      viewerEl.style.position = 'relative';
      try {
        await openPdfJs(item);
      } catch (err) {
        viewerFail(`PDF 打开失败：${err.message}`);
      }
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
