import { h, toast } from '../../core/ui.js';
import { paperToMeta } from './citation.js';
import { buildPaperQaPrompt, buildReadingSummaryPrompt, ANNO_TAGS, tagOf } from './readprompt.js';

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
  let paperCandidates = [];
  let libraryCandidates = [];
  let autoDownloadBusy = false;

  const listEl = h('div', { class: 'lit__list' });
  const discoveryList = h('div', { class: 'lit__discovery-list' });
  const libraryList = h('div', { class: 'lit__library-list' });
  const noticeEl = h('div', { class: 'lit__notice', hidden: true });
  const viewerEl = h('div', { class: 'lit__viewer' });
  const pdfXValue = h('span', { class: 'mono lit__pdf-x-value' }, '0%');
  const pdfXSlider = h('input', { class: 'lit__pdf-x-slider', type: 'range', min: '0', max: '0', step: '1', value: '0', disabled: true });
  const pdfXBar = h('div', { class: 'lit__pdf-xbar', hidden: true }, h('span', {}, '横向'), pdfXSlider, pdfXValue);

  const zoomOutBtn = h('button', { class: 'btn btn--icon', title: '缩小', onclick: () => zoom(-1) }, '−');
  const zoomLabel = h('span', { class: 'faint mono lit__zoom-label' }, '100%');
  const zoomInBtn = h('button', { class: 'btn btn--icon', title: '放大 (Cmd +)', onclick: () => zoom(1) }, '＋');
  const fitWidthBtn = h('button', { class: 'btn btn--sm', title: '适应宽度 (Cmd 0)', onclick: () => fitTo('width') }, '适宽');
  const fitPageBtn = h('button', { class: 'btn btn--sm', title: '整页显示，一眼看到版面结构', onclick: () => fitTo('page') }, '整页');
  const annoToggle = h('button', { class: 'btn btn--sm', onclick: () => toggleAnno() }, '批注');
  const chatToggle = h('button', { class: 'btn btn--sm', title: '带着文献内容问 AI', onclick: () => toggleChat() }, '💬 问答');
  const bilingBtn = h('button', { class: 'btn btn--sm', hidden: true, title: '豆包一键翻译全文，原文/译文对照阅读', onclick: () => toggleBilingual() }, '一键对照');
  const handBtn = h('button', { class: 'btn btn--sm', title: '手掌：拖拽平移页面', onclick: () => setCursorMode('hand') }, '✋');
  const selectBtn = h('button', { class: 'btn btn--sm', title: '指针：选中文字（配合划词/批注）', onclick: () => setCursorMode('select') }, '➤');
  const selBtn = h('button', { class: 'btn btn--sm', title: '先选中文字，再翻译；PDF 请切到指针模式', onclick: () => translateSelection() }, '翻译选中');
  const snipBtn = h('button', { class: 'btn btn--sm', title: '默认方式：在 PDF 页面右键后圈选区域；也可点击此按钮', onclick: () => startSnip() }, '圈译');
  const transToggleBtn = h('button', { class: 'btn btn--sm', title: '打开固定译文栏', onclick: () => toggleTransPanel() }, '译文栏');
  const viewerBar = h('div', { class: 'bar lit__viewerbar', hidden: true },
    h('span', { class: 'lit__viewer-name', title: '' }, ''),
    h('span', { style: { flex: 1 } }),
    handBtn, selectBtn,
    h('span', { class: 'subbar__sep' }),
    zoomOutBtn, zoomLabel, zoomInBtn, fitWidthBtn, fitPageBtn,
    h('span', { class: 'subbar__sep' }),
    bilingBtn, selBtn, snipBtn, transToggleBtn,
    h('span', { class: 'subbar__sep' }),
    chatToggle, annoToggle,
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
  /** 标签选择：读文献时最常要区分的几类，一眼能扫回来 */
  const annoTagBar = h('div', { class: 'lit__anno-tags' });
  for (const tag of ANNO_TAGS) {
    annoTagBar.append(h('button', {
      class: 'lit__anno-tagbtn',
      dataset: { tag: tag.id },
      style: { '--tag-color': tag.color },
      onclick: () => { annoTag = tag.id; syncTagBar(); },
    }, tag.label));
  }
  function syncTagBar() {
    for (const btn of annoTagBar.children) btn.classList.toggle('is-active', btn.dataset.tag === annoTag);
  }

  const summaryBox = h('div', { class: 'lit__summary' });
  const summaryBtn = h('button', {
    class: 'btn btn--sm',
    title: '把你标的重点和论文主线接起来，生成一份读后总结',
    onclick: () => makeSummary(summaryBtn),
  }, '读后总结');

  const annoPanel = h('div', { class: 'lit__anno', hidden: true },
    h('div', { class: 'lit__anno-head' }, '批注', h('span', { style: { flex: 1 } }), summaryBtn),
    annoTagBar,
    annoQuote,
    annoNote,
    h('button', { class: 'btn btn--sm btn--primary', onclick: () => addAnno() }, '记下'),
    summaryBox,
    annoList,
  );

  /**
   * 读后总结。不是简单摘要 —— 关键是把读者标记的重点和论文主线接起来，
   * 回答"我划的这些东西在这篇论文里是什么位置"，否则读完还是不知道自己读到了什么。
   */
  async function makeSummary(button) {
    if (!current) return toast('先打开一篇文献', 'info');
    button.disabled = true;
    summaryBox.textContent = '';
    summaryBox.append(h('div', { class: 'faint' }, h('span', { class: 'spinner' }), ' 正在把批注和论文主线接起来…'));
    try {
      const context = await docContext();
      if (!context) throw new Error('这篇提取不到文本（扫描版 PDF 是纯图片）');
      const result = await ctx.ai.json(buildReadingSummaryPrompt({
        title: current.file.replace(/\.[^.]+$/, ''),
        context,
        annotations: annotations(),
      }), { timeout: 150000 });
      renderSummary(result);
      await config.set(`research.litSummary.${current.file}`, { ...result, at: Date.now() });
    } catch (err) {
      summaryBox.textContent = '';
      summaryBox.append(h('div', { class: 'faint' }, `总结失败：${err.message}`));
    } finally {
      button.disabled = false;
    }
  }

  function renderSummary(result) {
    const row = (label, value) => (value
      ? h('div', { class: 'lit__summary-row' },
        h('span', { class: 'lit__summary-label' }, label), h('span', {}, value))
      : null);
    const list = (label, arr) => (Array.isArray(arr) && arr.length
      ? h('div', { class: 'lit__summary-row' },
        h('span', { class: 'lit__summary-label' }, label),
        h('ul', {}, ...arr.map((x) => h('li', {}, typeof x === 'string' ? x : JSON.stringify(x)))))
      : null);

    summaryBox.textContent = '';
    summaryBox.append(
      h('div', { class: 'lit__summary-title' }, result.oneLine || ''),
      row('要解决什么', result.problem),
      row('核心方法', result.method),
      row('凭什么说有效', result.evidence),
      result.yourMarks ? h('div', { class: 'lit__summary-marks' },
        h('span', { class: 'lit__summary-label' }, '你标的那些点'), h('span', {}, result.yourMarks)) : null,
      list('局限', result.limits),
      list('还该查什么', result.followUp),
      Array.isArray(result.terms) && result.terms.length
        ? h('div', { class: 'lit__summary-terms' },
          h('span', { class: 'lit__summary-label' }, '生僻概念'),
          ...result.terms.map((t) => h('div', { class: 'lit__summary-term' },
            h('b', {}, t.term || ''), ' ', t.plain || '')))
        : null,
      h('button', {
        class: 'btn btn--sm',
        onclick: async () => {
          const text = [result.oneLine, result.problem, result.method, result.evidence, result.yourMarks]
            .filter(Boolean).join('\n\n');
          await window.toolbox.clipboard.write(text);
          toast('总结已复制', 'good');
        },
      }, '复制总结'),
    );
  }

  function annoKey() {
    return `research.litAnno.${current.file}`;
  }

  // ---- 文献问答：带着文献内容问 AI ----

  let chatBusy = false;
  let chatHistory = []; // { role: 'user' | 'ai', text }
  let docContextFile = null;
  let docContextText = '';

  const chatList = h('div', { class: 'lit__chat-list' });
  const chatInput = h('textarea', {
    class: 'field lit__chat-input',
    placeholder: '就这篇文献提问，比如：这篇的核心方法是什么？和 baseline 差在哪？\n（Enter 发送，Shift+Enter 换行）',
    rows: 3,
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        askDoc();
      }
    },
  });
  const chatPanel = h('div', { class: 'lit__chat', hidden: true },
    h('div', { class: 'lit__anno-head' },
      '文献问答',
      h('span', { style: { flex: 1 } }),
      h('button', {
        class: 'btn btn--sm btn--ghost', title: '清空这轮对话',
        onclick: () => { chatHistory = []; chatList.textContent = ''; },
      }, '清空'),
    ),
    chatList,
    chatInput,
    h('button', { class: 'btn btn--sm btn--primary', onclick: () => askDoc() }, '提问'),
  );

  function pushChat(role, text) {
    chatHistory.push({ role, text });
    if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);
    const bubble = h('div', { class: `lit__chat-msg lit__chat-msg--${role}` }, text);
    chatList.appendChild(bubble);
    chatList.scrollTop = chatList.scrollHeight;
    return bubble;
  }

  function setChatMsg(bubble, text) {
    bubble.textContent = text;
    chatHistory[chatHistory.length - 1].text = text;
    chatList.scrollTop = chatList.scrollHeight;
  }

  /** 提取文献文本（问答的上下文）：PDF 走文本层逐页抽，TXT/MD 直接用原文。 */
  async function docContext() {
    if (!current) return '';
    if (docContextFile === current.file && docContextText) return docContextText;
    let text = '';
    if (pdfDoc) {
      const maxPages = Math.min(pdfDoc.numPages, 20);
      for (let n = 1; n <= maxPages; n += 1) {
        try {
          const page = await pdfDoc.getPage(n);
          const tc = await page.getTextContent();
          text += `${tc.items.map((i) => i.str).join(' ')}\n`;
          if (text.length > 9000) break;
        } catch { /* 单页抽不出文本就跳过 */ }
      }
    } else {
      text = rawText || '';
    }
    docContextFile = current.file;
    docContextText = text.slice(0, 9000);
    return docContextText;
  }

  async function askDoc() {
    const q = chatInput.value.trim();
    if (!q || chatBusy) return;
    if (!current) return toast('先打开一篇文献', 'info');
    chatBusy = true;
    chatInput.value = '';
    pushChat('user', q);
    const thinking = pushChat('ai', '…');
    try {
      const context = await docContext();
      if (!context) throw new Error('这篇文献提取不到文本（扫描版 PDF 是纯图片，可以先圈译转文字再问）');
      const history = chatHistory.slice(-7, -1)
        .map((m) => `${m.role === 'user' ? '问' : '答'}：${m.text}`)
        .join('\n');
      const answer = await ctx.ai.chat(
        buildPaperQaPrompt({
          title: current.file.replace(/\.[^.]+$/, ''),
          context,
          history,
          question: q,
        }),
        { timeout: 90000 },
      );
      setChatMsg(thinking, String(answer || '').trim() || '（AI 返回了空内容）');
    } catch (err) {
      setChatMsg(thinking, `回答失败：${err.message}`);
    } finally {
      chatBusy = false;
    }
  }

  function toggleChat() {
    if (!current) return toast('先打开一篇文献', 'info');
    const hidden = chatPanel.hasAttribute('hidden');
    if (hidden) {
      annoPanel.setAttribute('hidden', ''); // 右栏一次只开一个
      closeTransPanel();
      chatPanel.removeAttribute('hidden');
    } else {
      chatPanel.setAttribute('hidden', '');
    }
  }

  function resetChat() {
    chatPanel.setAttribute('hidden', '');
    chatHistory = [];
    chatList.textContent = '';
    docContextFile = null;
    docContextText = '';
  }

  function annotations() {
    return (config.get(annoKey()) || []);
  }

  let annoTag = 'key';        // 当前选中的批注标签

  async function addAnno() {
    const note = annoNote.value.trim();
    if (!note) return toast('批注内容还没写', 'info');
    const list = annotations();
    list.unshift({
      id: `anno-${Date.now()}`,
      quote: annoQuote.value.trim(),
      note,
      tag: annoTag,
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
          a.tag && tagOf(a.tag)
            ? h('span', {
              class: 'lit__anno-tag',
              style: { background: `${tagOf(a.tag).color}22`, color: tagOf(a.tag).color, borderColor: `${tagOf(a.tag).color}55` },
            }, tagOf(a.tag).label)
            : null,
          h('span', { class: 'faint' }, new Date(a.at).toLocaleString('zh-CN', { hour12: false })),
          h('span', { style: { flex: 1 } }),
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
      chatPanel.setAttribute('hidden', ''); // 右栏一次只开一个
      closeTransPanel();
      annoPanel.removeAttribute('hidden');
      syncTagBar();
      const saved = current && config.get(`research.litSummary.${current.file}`);
      if (saved) renderSummary(saved);
      renderAnnos();
    } else {
      annoPanel.setAttribute('hidden', '');
    }
  }

  // ---- 翻译：豆包优先，对照 / 划词 / 圈译共用 ----

  let rawText = null;        // TXT/MD 的原文（对照翻译用）
  let bilingual = false;
  let snipping = false;
  let translating = false;
  let bilingualTranslating = false;
  let bilingualPanel = null;
  let bilingualRunId = 0;
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

  /** 圈译/划词固定显示在右侧专注栏，避免浮卡挡住正文或译文看不见。 */
  let lastTransResult = null;
  const transCard = h('aside', { class: 'lit__trans-panel', hidden: true });
  let transOpacity = Math.min(1, Math.max(0.15, Number(config.get('research.lit.transOpacity', 0.94)) || 0.94));
  transCard.style.setProperty('--lit-trans-opacity', String(transOpacity));
  const selectionAction = h('button', {
    class: 'lit__selection-action', hidden: true,
    onmousedown: (e) => e.preventDefault(),
    onclick: () => translateSelection(),
  }, '译');

  /** 翻译方向：和主进程 detectTarget 一致 —— 中文为主译英，否则译中 */
  function targetLang(text) {
    const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
    return cjk > String(text).length * 0.2 ? '英文' : '中文';
  }

  function isSingleWord(text) {
    const value = String(text || '').trim();
    return Boolean(value) && !/\s/.test(value) && value.length <= 80;
  }

  /** 豆包翻译独立于全局 AI；失败时再退到全局 AI 和有道，单个词不会静默空白。 */
  function cleanTranslation(text) {
    return String(text || '')
      .trim()
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/\s*```$/, '')
      .replace(/^(译文|翻译结果|翻译)\s*[:：]\s*/, '')
      .trim();
  }

  async function translateSmart(text) {
    const to = targetLang(text);
    const errs = [];
    const messages = [
      {
        role: 'system',
        content: '你是资深科研论文翻译。忠实、准确、自然地翻译，优先保证技术含义和术语一致。模型名、基准名、数据集名、缩写、变量、代码、文件名、坐标轴、图例标签和版本号保持原样，不要臆造释义；无法确定的短标签保留英文并在后面给出括号说明。只输出译文本身，不解释，不添加标题。',
      },
      {
        role: 'user',
        content: `将下面的科研内容翻译成${to}。这是论文正文、图注或图表文字，必须结合上下文翻译；不要把 high、xhigh、max、ultracode、RHI、HI 等可能是模型/实验标签的 token 翻译成普通中文。保留段落、公式、代码、引用编号、文件路径、专有名词、图例标签和数字：\n\n${text}`,
      },
    ];
    try {
      const result = await window.toolbox.ai.translate({ messages, temperature: 0.1, timeout: 90000 });
      const cleaned = cleanTranslation(result.ok ? result.text : '');
      if (result.ok && cleaned) return { ok: true, translation: cleaned, via: 'doubao' };
      errs.push(result.ok ? '豆包返回了空内容' : `豆包：${result.error}`);
    } catch (err) {
      errs.push(`豆包：${err.message}`);
    }
    try {
      const out = await ctx.ai.chat(
        `你是资深科研论文翻译。把下面的内容准确翻译成${to}。\n` +
        '只输出译文本身：不要解释、不要重复原文、不要任何前后缀或引号。\n' +
        '模型名、基准名、数据集名、缩写、变量、代码、文件名、坐标轴、图例标签、版本号和 high/xhigh/max/ultracode 等 token 保持原样；不确定的短标签不要臆译。保留原有换行分段、公式、引用编号和专有名词。\n\n' + text,
        { timeout: 60000 },
      );
      const cleaned = cleanTranslation(out);
      if (cleaned) return { ok: true, translation: cleaned, via: 'ai' };
      errs.push('全局 AI 返回了空内容');
    } catch (err) {
      errs.push(`全局 AI：${err.message}`);
    }
    try {
      const fallback = await lit.translate(text, { interactive: true });
      const cleaned = cleanTranslation(fallback.ok ? fallback.translation : '');
      if (fallback.ok && cleaned) return { ok: true, translation: cleaned, via: 'youdao' };
      errs.push(fallback.ok ? '有道返回了空译文' : `有道：${fallback.error}`);
    } catch (err) {
      errs.push(`有道：${err.message}`);
    }
    // 两条通道都失败时把原因都亮出来，不然浮卡空着根本不知道发生了什么
    return { ok: false, error: errs.join('；') };
  }

  /** 单词速查先走有道单发接口，避免每个词都等待学术翻译模型。 */
  async function translateWordFast(text) {
    try {
      const result = await lit.translate(text, { interactive: true });
      const cleaned = cleanTranslation(result.ok ? result.translation : '');
      if (result.ok && cleaned) return { ok: true, translation: cleaned, via: 'youdao-fast' };
    } catch { /* 快速通道失败就交给完整翻译链路 */ }
    return translateSmart(text);
  }

  function viaLabel(via) {
    return via === 'doubao' ? '豆包' : via === 'ai' ? '全局 AI' : via === 'youdao-fast' ? '快速词义' : '有道';
  }

  function openTransPanel() {
    chatPanel.setAttribute('hidden', '');
    annoPanel.setAttribute('hidden', '');
    transCard.removeAttribute('hidden');
    pdfXBar.hidden = !pdfScrollEl;
    syncPdfXSlider();
    transToggleBtn.classList.add('is-on');
    requestAnimationFrame(() => { transCard.scrollTop = 0; updatePdfTranslationLayout(); });
  }

  function closeTransPanel() {
    transCard.setAttribute('hidden', '');
    transCard.classList.remove('is-focus');
    transToggleBtn.classList.remove('is-on');
    transToggleBtn.textContent = '译文栏';
    transToggleBtn.title = '打开固定译文栏';
    pdfXBar.hidden = true;
    updatePdfTranslationLayout();
  }

  function toggleTransFocus(button) {
    const focused = transCard.classList.toggle('is-focus');
    button.textContent = focused ? '收窄' : '专注放大';
    button.title = focused ? '恢复普通宽度' : '放大译文栏，集中阅读译文';
    requestAnimationFrame(updatePdfTranslationLayout);
  }

  function transOpacityControl() {
    const input = h('input', {
      class: 'lit__trans-opacity-input',
      type: 'range', min: '15', max: '100', step: '1', value: String(Math.round(transOpacity * 100)),
      title: '调整译文背景透明度',
      oninput: (event) => {
        transOpacity = Number(event.currentTarget.value) / 100;
        transCard.style.setProperty('--lit-trans-opacity', String(transOpacity));
        config.set('research.lit.transOpacity', transOpacity);
      },
    });
    return h('label', { class: 'lit__trans-opacity' }, '背景', input);
  }

  function toggleTransPanel() {
    if (!current) return toast('先打开一篇文献', 'info');
    if (!transCard.hasAttribute('hidden')) return closeTransPanel();
    if (lastTransResult) return showTransResult(lastTransResult.srcText, lastTransResult.translation, lastTransResult.via);
    transCard.textContent = '';
    transCard.append(
      h('div', { class: 'lit__trans-panel-head' },
        h('strong', {}, '专注译文栏'),
        transOpacityControl(),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'lit__anno-del', title: '关闭', onclick: closeTransPanel }, '×'),
      ),
      h('div', { class: 'lit__trans-empty' }, '选中文字后点旁边的「译」，或使用「翻译选中 / 圈译」。译文会固定显示在这里。'),
    );
    openTransPanel();
    transToggleBtn.textContent = '译文已显示';
    transToggleBtn.title = '译文已显示在阅读器右侧浮层';
  }

  function showTransResult(srcText, translation, via = '') {
    const value = String(translation || '').trim();
    const isError = /^(翻译失败|圈译失败|豆包翻译失败)/.test(value);
    lastTransResult = { srcText: srcText || '', translation: value, via };
    transCard.textContent = '';
    transCard.classList.toggle('is-error', isError);
    const focusBtn = h('button', { class: 'btn btn--sm', onclick: (e) => toggleTransFocus(e.currentTarget) }, '专注放大');
    transCard.append(
      h('div', { class: 'lit__trans-panel-head' },
        h('strong', {}, isError ? '翻译出错' : '专注译文'),
        via && h('span', { class: 'tag tag--good' }, viaLabel(via)),
        transOpacityControl(),
        h('span', { style: { flex: 1 } }),
        focusBtn,
        h('button', { class: 'lit__anno-del', title: '关闭', onclick: closeTransPanel }, '×'),
      ),
      h('div', { class: 'lit__trans-content' },
        h('div', { class: 'lit__trans-label' }, isError ? '错误信息' : '译文'),
        h('div', { class: 'lit__trans-dst' }, value || '没有收到译文'),
        srcText && h('details', { class: 'lit__trans-source' },
          h('summary', {}, '查看原文'),
          h('div', { class: 'lit__trans-src' }, srcText),
        ),
      ),
      h('div', { class: 'lit__trans-actions' },
        !isError && value && h('button', {
          class: 'btn btn--sm',
          onclick: async () => { await window.toolbox.clipboard.write(value); toast('译文已复制', 'good'); },
        }, '复制译文'),
        !isError && value && h('button', {
          class: 'btn btn--sm',
          onclick: async () => {
            annoQuote.value = srcText || '';
            annoNote.value = `【译文】${value}`;
            closeTransPanel();
            chatPanel.setAttribute('hidden', '');
            annoPanel.removeAttribute('hidden');
            renderAnnos();
            toast('已填进批注栏，补一句想法再点「记下」', 'info');
          },
        }, '存为批注'),
      ),
    );
    openTransPanel();
  }

  function showTransBusy(text) {
    transCard.textContent = '';
    transCard.classList.remove('is-error');
    transCard.append(
      h('div', { class: 'lit__trans-panel-head' },
        h('strong', {}, '正在翻译'),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'lit__anno-del', title: '关闭', onclick: closeTransPanel }, '×'),
      ),
      h('div', { class: 'lit__trans-busy' }, h('span', { class: 'spinner' }), h('span', {}, text)),
    );
    openTransPanel();
  }

  function normalizeSelection(text) {
    return String(text || '')
      .replace(/([A-Za-z])-\s*\n\s*([a-z])/g, '$1$2')
      .replace(/[ \t]*\n[ \t]*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function selectionInsideViewer(selection) {
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    return Boolean(node && viewerEl.contains(node));
  }

  function hideSelectionAction() {
    selectionAction.setAttribute('hidden', '');
  }

  function updateSelectionAction() {
    const selection = window.getSelection();
    const selected = normalizeSelection(selection?.toString());
    if (!selected || !selectionInsideViewer(selection)) return hideSelectionAction();
    lastSelection = selected;
    try {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const box = viewerEl.getBoundingClientRect();
      selectionAction.style.left = `${Math.max(8, Math.min(box.width - 44, rect.right - box.left + 8))}px`;
      selectionAction.style.top = `${Math.max(8, Math.min(box.height - 38, rect.top - box.top - 4))}px`;
      selectionAction.removeAttribute('hidden');
    } catch {
      hideSelectionAction();
    }
  }

  /** 记住最近一次非空选区：点按钮会让选区塌掉，必须提前存。 */
  let lastSelection = '';
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    const selected = normalizeSelection(selection?.toString());
    if (selected && selectionInsideViewer(selection)) lastSelection = selected;
  });
  viewerEl.addEventListener('mouseup', () => setTimeout(updateSelectionAction, 0));
  viewerEl.addEventListener('scroll', hideSelectionAction, true);
  viewerEl.addEventListener('contextmenu', (event) => {
    if (!pdfDoc || snipping) return;
    event.preventDefault();
    startSnip();
  });

  function syncPdfXSlider() {
    if (!pdfScrollEl) return;
    const max = Math.max(0, pdfScrollEl.scrollWidth - pdfScrollEl.clientWidth);
    pdfXSlider.max = String(Math.round(max));
    pdfXSlider.value = String(Math.round(pdfScrollEl.scrollLeft));
    pdfXSlider.disabled = max <= 0;
    pdfXValue.textContent = max > 0 ? `${Math.round((pdfScrollEl.scrollLeft / max) * 100)}%` : '0%';
  }

  function updatePdfTranslationLayout() {
    if (!pdfScrollEl || !pdfPagesWrap) return;
    const open = !transCard.hasAttribute('hidden');
    if (!open) {
      pdfPagesWrap.style.minWidth = '';
      pdfPagesWrap.style.alignItems = '';
      pdfScrollEl.scrollLeft = 0;
    } else {
      const extra = Math.min(transCard.offsetWidth || 390, Math.round(viewerEl.clientWidth * 0.55));
      pdfPagesWrap.style.minWidth = `${Math.max(viewerEl.clientWidth, viewerEl.clientWidth + extra)}px`;
      pdfPagesWrap.style.alignItems = 'flex-start';
    }
    requestAnimationFrame(syncPdfXSlider);
  }

  pdfXSlider.addEventListener('input', () => {
    if (!pdfScrollEl) return;
    pdfScrollEl.scrollLeft = Number(pdfXSlider.value) || 0;
    syncPdfXSlider();
  });

  /** 双击翻译：文本阅读器里双击单词/短语直接翻。浏览器双击自动选中，直接取选区 */
  viewerEl.addEventListener('dblclick', async () => {
    if (!current) return;
    const word = normalizeSelection(window.getSelection()?.toString());
    if (!word || word.length > 120) return; // 不是点词，是整段拖选，走「划词」按钮
    if (translating) return;
    translating = true;
    const short = word.length > 24 ? `${word.slice(0, 24)}…` : word;
    showTransBusy(`翻译「${short}」…`);
    try {
      const result = isSingleWord(word) ? await translateWordFast(word) : await translateSmart(word);
      if (!result.ok) return showTransResult(word, `翻译失败：${result.error}`);
      showTransResult(word, result.translation, result.via);
      toast(`「${short}」的译文已显示在阅读器右侧`, 'good');
    } catch (err) {
      showTransResult(word, `翻译失败：${err.message}`);
    } finally {
      translating = false;
    }
  });

  /** 划词翻译：TXT/MD/PDF 共用；PDF 在指针模式下由文本层提供原生选区。 */
  async function translateSelection() {
    if (translating || !current) return;
    const selection = window.getSelection();
    const live = selectionInsideViewer(selection) ? normalizeSelection(selection?.toString()) : '';
    const selected = live || lastSelection;
    if (!selected) {
      toast(pdfDoc ? '先切到「➤」指针模式，再拖选文字；扫描版 PDF 请用圈译' : '先在原文里拖选或双击文字', 'info');
      return;
    }
    hideSelectionAction();
    translating = true;
    showTransBusy(`正在翻译（${selected.length} 字）…`);
    try {
      const result = isSingleWord(selected) ? await translateWordFast(selected) : await translateSmart(selected);
      if (!result.ok) return showTransResult(selected, `翻译失败：${result.error}`);
      showTransResult(selected, result.translation, result.via);
      toast(`翻译好了（${viaLabel(result.via)}），译文在阅读器右侧`, 'good');
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
        showTransResult(srcText, tr.translation + (ocrErrs.length ? `\n（${ocrErrs.join('；')}）` : ''), tr.via);
        toast(`翻译好了（${viaLabel(tr.via)}）`, 'good');
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

  async function paragraphs() {
    if (rawText != null) {
      const all = String(rawText).split(/\n+/).map((source) => source.trim()).filter(Boolean);
      return { items: all.slice(0, 180).map((source) => ({ source })), truncated: all.length > 180 };
    }
    if (!pdfDoc) return { items: [], truncated: false };
    const items = [];
    let chars = 0;
    let truncated = false;
    for (let pageNo = 1; pageNo <= pdfDoc.numPages; pageNo += 1) {
      const page = await pdfDoc.getPage(pageNo);
      const content = await page.getTextContent();
      let line = '';
      for (const item of content.items) {
        const value = String(item.str || '').trim();
        if (value) line += `${line ? ' ' : ''}${value}`;
        if ((item.hasEOL || line.length >= 700) && line) {
          items.push({ source: line, page: pageNo });
          chars += line.length;
          line = '';
        }
      }
      if (line) {
        items.push({ source: line, page: pageNo });
        chars += line.length;
      }
      if (items.length >= 220 || chars >= 60000) {
        truncated = pageNo < pdfDoc.numPages;
        break;
      }
    }
    return { items, truncated };
  }

  function transCacheKey() {
    return `research.litTransV2.${current.file}`;
  }

  function makeParaBatches(items, pendingIdx) {
    const batches = [];
    let cur = [];
    let chars = 0;
    for (const i of pendingIdx) {
      if (cur.length && (chars + items[i].source.length > 5000 || cur.length >= 8)) {
        batches.push(cur);
        cur = [];
        chars = 0;
      }
      cur.push(i);
      chars += items[i].source.length;
    }
    if (cur.length) batches.push(cur);
    return batches;
  }

  function parseBatchTranslations(text) {
    const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(parsed.items)) return null;
      return new Map(parsed.items.map((item) => [Number(item.id), cleanTranslation(item.translation)]));
    } catch {
      return null;
    }
  }

  async function translateBatch(items, batch) {
    const payload = batch.map((id) => ({ id, text: items[id].source }));
    const to = targetLang(payload.map((item) => item.text).join('\n'));
    const result = await window.toolbox.ai.translate({
      messages: [
        { role: 'system', content: '你是专业学术翻译引擎。保持术语、公式、引用编号准确。严格输出 JSON，不要 markdown。' },
        {
          role: 'user',
          content: `把 input 中每条 text 翻译成${to}。id 必须原样返回，不能合并、遗漏或新增。输出格式：{"items":[{"id":0,"translation":"译文"}]}\ninput=${JSON.stringify(payload)}`,
        },
      ],
      temperature: 0.1,
      timeout: 120000,
    });
    if (!result.ok) throw new Error(result.error);
    const parsed = parseBatchTranslations(result.text);
    if (!parsed || batch.some((id) => !parsed.get(id))) throw new Error('豆包没有按段落返回完整 JSON');
    return parsed;
  }

  function closeBilingual() {
    bilingualRunId += 1;
    bilingual = false;
    bilingualPanel?.remove();
    bilingualPanel = null;
    bilingBtn.classList.remove('is-on');
    bilingBtn.textContent = '一键对照';
  }

  async function toggleBilingual() {
    if (!current) return;
    if (bilingual) return closeBilingual();
    if (!config.get('research.translation.hasKey', false) || !config.get('research.translation.model', '')) {
      toast('先在「设置 → 豆包翻译」保存 API Key 和模型/接入点，已为你打开设置', 'info', 6000);
      ctx.goto('settings');
      return;
    }
    const runId = ++bilingualRunId;
    bilingual = true;
    bilingBtn.classList.add('is-on');
    bilingBtn.textContent = '准备对照…';
    const { items, truncated } = await paragraphs();
    if (runId !== bilingualRunId) return;
    if (!items.length) {
      closeBilingual();
      return toast('这篇 PDF 没有可选文本，可能是扫描版；请使用圈译', 'bad', 5000);
    }

    const cache = config.get(transCacheKey()) || {};
    const wrap = h('div', { class: 'lit__biling' });
    bilingualPanel = h('div', { class: 'lit__biling-panel' },
      h('div', { class: 'lit__biling-head' },
        h('strong', {}, '豆包全文对照'),
        h('span', { class: 'faint' }, truncated ? '文献较长，先展示前 6 万字' : `${items.length} 段`),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn btn--sm', onclick: closeBilingual }, '返回原文'),
      ),
      wrap,
    );
    viewerEl.appendChild(bilingualPanel);
    const cells = items.map((item, i) => {
      const cached = cache[i];
      const valid = cached && cached.source === item.source && cached.translation;
      const cell = h('div', { class: 'lit__biling-item' },
        h('div', { class: 'lit__biling-meta faint' }, item.page ? `第 ${item.page} 页` : `第 ${i + 1} 段`),
        h('div', { class: 'lit__biling-cols' },
          h('section', { class: 'lit__biling-col lit__biling-col--src' },
            h('div', { class: 'lit__biling-col-label' }, '原文'),
            h('div', { class: 'lit__biling-src' }, item.source),
          ),
          h('section', { class: 'lit__biling-col lit__biling-col--dst' },
            h('div', { class: 'lit__biling-col-label' }, '译文'),
            h('div', { class: 'lit__biling-dst' }, valid ? cached.translation : '等待翻译…'),
          ),
        ),
      );
      wrap.appendChild(cell);
      return cell;
    });

    const pendingIdx = items.map((_, i) => i)
      .filter((i) => !cache[i] || cache[i].source !== items[i].source || !cache[i].translation);
    if (!pendingIdx.length) {
      bilingBtn.textContent = '一键对照';
      return;
    }
    bilingualTranslating = true;
    const batches = makeParaBatches(items, pendingIdx);
    let done = 0;
    try {
      for (const batch of batches) {
        if (!bilingual || runId !== bilingualRunId || current == null) break;
        for (const i of batch) cells[i].querySelector('.lit__biling-dst').textContent = '豆包翻译中…';
        try {
          const translations = await translateBatch(items, batch);
          for (const i of batch) {
            cache[i] = { source: items[i].source, translation: translations.get(i), via: 'doubao' };
            cells[i].querySelector('.lit__biling-dst').textContent = cache[i].translation;
          }
        } catch (batchErr) {
          for (const i of batch) {
            try {
              const one = await translateSmart(items[i].source);
              cache[i] = {
                source: items[i].source,
                translation: one.ok ? one.translation : `翻译失败：${one.error}`,
                via: one.via || 'error',
              };
            } catch (err) {
              cache[i] = { source: items[i].source, translation: `翻译失败：${err.message}`, via: 'error' };
            }
            cells[i].querySelector('.lit__biling-dst').textContent = cache[i].translation;
          }
          toast(`豆包批量翻译失败，已逐段降级：${batchErr.message}`, 'info', 5000);
        }
        done += batch.length;
        bilingBtn.textContent = `对照 ${Math.min(done, pendingIdx.length)}/${pendingIdx.length}`;
        await config.set(transCacheKey(), cache);
      }
    } finally {
      bilingualTranslating = false;
      if (runId === bilingualRunId) bilingBtn.textContent = '一键对照';
    }
  }

  function renderTextPlain() {
    viewerEl.textContent = '';
    viewerEl.appendChild(h('div', { class: 'lit__text' }, rawText));
    viewerEl.appendChild(selectionAction);
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
    scrollEl.addEventListener('scroll', syncPdfXSlider, { passive: true });
    updatePdfTranslationLayout();
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
        h('div', { class: 'textLayer lit__text-layer' }),
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
    requestAnimationFrame(syncPdfXSlider);

    viewerEl.appendChild(selectionAction);
    applyCursorMode();
  }

  async function renderPdfPage(n) {
    if (!pdfDoc || pdfRendered.has(n) || pdfRendering.has(n)) return;
    pdfRendering.add(n);
    try {
      const page = await pdfDoc.getPage(n);
      const dpr = window.devicePixelRatio || 1;
      const cssViewport = page.getViewport({ scale: pdfRenderedScale });
      const renderViewport = page.getViewport({ scale: pdfRenderedScale * dpr });
      const pageEl = pdfPageEls[n];
      const canvas = pageEl?.querySelector('canvas');
      const textLayerEl = pageEl?.querySelector('.lit__text-layer');
      if (!canvas || !textLayerEl) return;
      canvas.width = Math.round(renderViewport.width);
      canvas.height = Math.round(renderViewport.height);
      canvas.style.width = `${Math.round(cssViewport.width)}px`;
      canvas.style.height = `${Math.round(cssViewport.height)}px`;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: renderViewport }).promise;
      textLayerEl.textContent = '';
      const pdfjsLib = await loadPdfJs();
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: await page.getTextContent(),
        container: textLayerEl,
        viewport: cssViewport,
      });
      await textLayer.render();
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
        el.querySelector('.lit__text-layer').textContent = '';
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
      requestAnimationFrame(syncPdfXSlider);
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

  /**
   * 适应宽度 / 整页。
   * 缩放百分比本来只有 +/- 两个按钮，想回到"刚好铺满"要按半天；
   * 长时间读论文这两个是最常用的动作，给独立入口。
   */
  function fitTo(mode) {
    if (!pdfDoc || !pdfPagesWrap) return toast('先打开一篇 PDF', 'info');
    const wrap = pdfPagesWrap.parentElement;
    if (!wrap) return;
    if (mode === 'width') {
      applyGestureZoom(pdfFitScale / pdfViewScale);        // 回到按宽度自适应
      return;
    }
    // 整页：让第一页的高度刚好放进可视区
    const page = pdfPagesWrap.querySelector('canvas');
    if (!page) return;
    const pageHeightAtFit = (page.clientHeight / pdfViewScale) * pdfFitScale;
    const avail = wrap.clientHeight - 32;
    const target = pdfFitScale * Math.min(1, avail / (pageHeightAtFit || avail));
    applyGestureZoom(target / pdfViewScale);
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

  // 读论文时最常按的三个快捷键，省得每次去点工具栏
  window.addEventListener('keydown', (event) => {
    if (!pdfDoc || !(event.metaKey || event.ctrlKey)) return;
    if (viewerEl.offsetParent === null) return;          // 阅读器不在前台就不抢快捷键
    if (event.key === '=' || event.key === '+') { event.preventDefault(); zoom(1); }
    else if (event.key === '-') { event.preventDefault(); zoom(-1); }
    else if (event.key === '0') { event.preventDefault(); fitTo('width'); }
  });

  function viewerIdle() {
    closeBilingual();
    closeTransPanel();
    lastTransResult = null;
    viewerBar.setAttribute('hidden', '');
    annoPanel.setAttribute('hidden', '');
    resetChat();
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
    closeBilingual();
    lastSelection = '';
    hideSelectionAction();
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
    closeTransPanel();
    lastTransResult = null;
    zoomIndex = 2;
    zoomLabel.textContent = '100%';
    viewerBar.removeAttribute('hidden');
    viewerBar.querySelector('.lit__viewer-name').textContent = item.file;
    viewerBar.querySelector('.lit__viewer-name').title = item.file;
    viewerEl.textContent = '';
    annoPanel.setAttribute('hidden', '');
    resetChat();
    bilingBtn.setAttribute('hidden', '');
    handBtn.setAttribute('hidden', '');
    selectBtn.setAttribute('hidden', '');
    selBtn.setAttribute('hidden', '');

    if (item.format === 'pdf') {
      handBtn.removeAttribute('hidden');
      selectBtn.removeAttribute('hidden');
      selBtn.removeAttribute('hidden');
      bilingBtn.removeAttribute('hidden');
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
      selBtn.removeAttribute('hidden');
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
      await finishImport(imported);
    } catch (err) {
      toast(`导入失败：${err.message}`, 'bad');
    } finally {
      btn.disabled = false;
    }
  }

  async function finishImport(imported) {
    if (!imported?.length) return toast('没有找到支持的文献文件', 'info');
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
      await renderList();
  }

  async function importDropped(event) {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
    const paths = [...(event.dataTransfer?.files || [])]
      .map((file) => file.path)
      .filter(Boolean);
    if (!paths.length) return toast('没有读到拖入的文件路径，请从 Finder 或文件管理器拖入', 'bad');
    dropZone.classList.add('is-busy');
    dropZone.querySelector('.lit__dropzone-status').textContent = '正在导入文件/文件夹…';
    try {
      await finishImport(await lit.importFiles(paths));
    } catch (err) {
      toast(`拖入导入失败：${err.message}`, 'bad');
    } finally {
      dropZone.classList.remove('is-busy');
      dropZone.querySelector('.lit__dropzone-status').textContent = '支持拖入文件，也支持拖入整个文件夹';
    }
  }

  /** 整理库里已有的编号命名 PDF，备注跟着新文件名走 */
  async function fixNames(btn) {
    btn.disabled = true;
    try {
      const result = await lit.fixNames();
      const renames = Array.isArray(result) ? result : (result?.renames || []);
      if (!renames.length) {
        const checked = Number(result?.checked || 0);
        const skipped = Number(result?.skipped?.length || 0);
        return toast(
          checked && skipped
            ? `检查了 ${checked} 个编号 PDF，但暂时读不出可用标题`
            : '没有需要整理的编号命名 PDF',
          'info',
          5000,
        );
      }
      const metaMap = meta();
      for (const r of renames) {
        if (metaMap[r.from]) {
          metaMap[r.to] = metaMap[r.from];
          delete metaMap[r.from];
        }
      }
      await config.set('research.litMeta', metaMap);
      renderList();
      const skipped = Number(result?.skipped?.length || 0);
      toast(`已重命名 ${renames.length} 篇：${renames[0].title || renames[0].to}${renames.length > 1 ? ' 等' : ''}${skipped ? `；${skipped} 篇暂时跳过` : ''}`, 'good', 5000);
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
    const all = await lit.list();
    // 文献库里勾了文献，这里就只显示那批（工作集）；没勾就显示全部
    const picked = new Set(config.get('research.libChecked') || []);
    const inLibrary = picked.size ? all.filter((f) => picked.has(f.file)) : all;
    files = inLibrary.length ? inLibrary : all;
    const filtered = picked.size && inLibrary.length;
    const metaMap = meta();
    listEl.textContent = '';
    if (filtered) {
      listEl.appendChild(h('div', { class: 'lit__workset faint' },
        `工作集：文献库里勾选的 ${files.length} 篇`,
        h('button', {
          class: 'btn btn--sm btn--ghost',
          onclick: async () => { await config.set('research.libChecked', []); renderList(); },
        }, '显示全部'),
      ));
    }
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

  function paperMeta(paper) {
    const authors = (paper.authors || []).slice(0, 2).join('、');
    const bits = [paper.year, paper.venue, authors, `被引 ${paper.citedBy || 0}`].filter(Boolean);
    return bits.join(' · ') || paper.source || '论文元数据';
  }

  function syncLibraryActions() {
    const selected = libraryCandidates.filter((item) => item.selected).length;
    batchDownloadBtn.disabled = !selected;
    batchDownloadBtn.textContent = selected ? `下载已选 ${selected} 篇` : '下载已选论文';
  }

  function renderLibraryCandidates() {
    libraryList.textContent = '';
    if (!libraryCandidates.length) {
      libraryList.appendChild(h('div', { class: 'faint lit__library-empty' }, '打开已登录的检索结果页后，点「扫描当前列表」。'));
      syncLibraryActions();
      return;
    }
    for (const paper of libraryCandidates) {
      const check = h('input', {
        type: 'checkbox',
        checked: Boolean(paper.selected),
        onchange: (event) => { paper.selected = event.currentTarget.checked; syncLibraryActions(); },
      });
      libraryList.appendChild(h('label', { class: 'lit__library-item' },
        check,
        h('span', { class: 'lit__library-item-main' },
          h('strong', { class: 'lit__library-title' }, paper.title),
          h('span', { class: 'lit__meta faint' }, paper.url),
        ),
      ));
    }
    syncLibraryActions();
  }

  async function openLibraryBrowser() {
    const url = libraryUrlInput.value.trim();
    if (!url) return toast('先填写知网或学校图书馆的检索结果页地址', 'info');
    const result = await lit.openAccessBrowser(url);
    if (!result?.ok) return toast(result?.error || '打开登录浏览器失败', 'bad');
    libraryStatus.textContent = '浏览器已打开：登录并完成检索后，回到这里点「扫描当前列表」';
  }

  async function scanLibraryBrowser() {
    scanLibraryBtn.disabled = true;
    libraryStatus.textContent = '正在读取当前检索结果页…';
    try {
      const result = await lit.scanBrowserPage();
      if (!result.ok) {
        libraryStatus.textContent = result.error;
        return;
      }
      libraryCandidates = (result.candidates || []).map((item) => ({ ...item, selected: false }));
      libraryStatus.textContent = libraryCandidates.length
        ? `当前页识别到 ${libraryCandidates.length} 篇，勾选后批量下载（最多 30 篇）`
        : '没有识别到论文链接：请打开检索结果列表，不要停留在登录页或首页。';
      renderLibraryCandidates();
    } catch (err) {
      libraryStatus.textContent = `扫描失败：${err.message}`;
    } finally {
      scanLibraryBtn.disabled = false;
    }
  }

  async function downloadSelectedFromLibrary() {
    const selected = libraryCandidates.filter((item) => item.selected);
    if (!selected.length) return toast('先勾选要下载的论文', 'info');
    batchDownloadBtn.disabled = true;
    libraryStatus.textContent = `准备下载 ${selected.length} 篇…`;
    try {
      const result = await lit.downloadBatch(selected);
      const completed = Number(result.completed || 0);
      libraryStatus.textContent = result.ok
        ? `批量下载完成：${completed}/${result.total} 篇已入库`
        : `批量下载暂停：已完成 ${completed}/${result.total} 篇。请按提示处理后重新扫描。`;
      if (completed) toast(`已自动入库 ${completed} 篇论文`, 'good', 5000);
      if (!result.ok && result.results?.at(-1)?.error) showFetchNotice({ code: 'download-failed', error: result.results.at(-1).error });
    } catch (err) {
      libraryStatus.textContent = `批量下载失败：${err.message}`;
    } finally {
      syncLibraryActions();
    }
  }

  async function importDownloaded(item) {
    if (!item?.file) return;
    const metaMap = meta();
    metaMap[item.file] = {
      note: '浏览器登录下载',
      addedAt: new Date().toISOString(),
    };
    await config.set('research.litMeta', metaMap);
    await renderList();
    toast(`已自动导入：${item.file}`, 'good', 5000);
  }

  async function downloadCandidate(paper, button) {
    button.disabled = true;
    button.textContent = '获取中…';
    try {
      const result = await lit.downloadCandidate(paper);
      if (result.ok) {
        paper.downloadState = 'done';
        paper.selected = false;
        const metaMap = meta();
        // 下载这一刻元数据就在手上，一并存进库，省得事后手填或再查一遍
        metaMap[result.file] = { ...paperToMeta(paper), note: `方向检索 · ${result.source}`, addedAt: new Date().toISOString() };
        await config.set('research.litMeta', metaMap);
        await renderList();
        toast(`已下载入库：${result.title}`, 'good', 5000);
      } else if (result.url) {
        paper.downloadState = 'failed';
        showFetchNotice(result);
        await lit.openAccessBrowser(result.url);
      } else {
        paper.downloadState = 'failed';
        showFetchNotice(result);
      }
    } catch (err) {
      toast(`获取失败：${err.message}`, 'bad');
    } finally {
      button.disabled = false;
      button.textContent = paper.downloadState === 'done' ? '已入库' : paper.downloadState === 'failed' ? '重试下载' : paper.pdfUrl ? '下载 PDF' : '登录下载';
      renderDiscovery();
    }
  }

  function syncDiscoveryActions() {
    const openCandidates = paperCandidates.filter((paper) => paper.pdfUrl && paper.downloadState !== 'done');
    const selected = openCandidates.filter((paper) => paper.selected).length;
    downloadOpenBtn.disabled = autoDownloadBusy || !openCandidates.length;
    downloadOpenBtn.textContent = openCandidates.length ? `下载开放全文 ${openCandidates.length} 篇` : '下载开放全文';
    downloadSelectedBtn.disabled = autoDownloadBusy || !selected;
    downloadSelectedBtn.textContent = selected ? `下载已选 ${selected} 篇` : '下载已选';
    selectOpenBtn.disabled = autoDownloadBusy || !openCandidates.length;
  }

  function renderDiscovery() {
    discoveryList.textContent = '';
    if (!paperCandidates.length) {
      syncDiscoveryActions();
      return;
    }
    syncDiscoveryActions();
    discoveryList.appendChild(h('div', { class: 'lit__discovery-summary' },
      h('strong', {}, `找到 ${paperCandidates.length} 篇候选`),
      h('span', { class: 'faint' }, `${paperCandidates.filter((paper) => paper.pdfUrl && paper.downloadState !== 'done').length} 篇待自动下载；已按标题相关性筛选`),
    ));
    for (const paper of paperCandidates) {
      const selectable = Boolean(paper.pdfUrl);
      const select = h('input', {
        type: 'checkbox',
        class: 'lit__discovery-select',
        checked: Boolean(paper.selected),
        disabled: !selectable || autoDownloadBusy,
        onchange: (event) => { paper.selected = event.currentTarget.checked; syncDiscoveryActions(); },
      });
      const downloadBtn = h('button', {
        class: 'btn btn--sm btn--primary',
        disabled: autoDownloadBusy,
        onclick: (event) => downloadCandidate(paper, event.currentTarget),
      }, paper.downloadState === 'done' ? '已入库' : paper.downloadState === 'failed' ? '重试下载' : paper.pdfUrl ? '下载 PDF' : '登录下载');
      discoveryList.appendChild(h('article', { class: 'lit__discovery-item' },
        h('div', { class: 'lit__discovery-head' },
          select,
          h('strong', { class: 'lit__discovery-title', title: paper.title }, paper.title),
          h('span', { class: `tag ${paper.downloadState === 'done' ? 'tag--good' : paper.isOpenAccess ? 'tag--good' : 'tag--warn'}` }, paper.downloadState === 'done' ? '已入库' : paper.isOpenAccess ? '开放全文' : '需登录/机构权限'),
        ),
        h('div', { class: 'lit__meta faint' }, [paper.relevanceReason, paperMeta(paper)].filter(Boolean).join(' · ')),
        paper.abstract && h('p', { class: 'lit__discovery-abstract' }, paper.abstract),
        h('div', { class: 'lit__discovery-actions' },
          downloadBtn,
          paper.landingUrl && h('button', {
            class: 'btn btn--sm btn--ghost',
            title: '打开论文页面',
            onclick: () => lit.openAccessBrowser(paper.landingUrl),
          }, '打开页面'),
          paper.doi && h('button', {
            class: 'btn btn--sm btn--ghost',
            title: '复制 DOI',
            onclick: async () => { await window.toolbox.clipboard.write(`https://doi.org/${paper.doi}`); toast('DOI 已复制', 'good'); },
          }, '复制 DOI'),
        ),
      ));
    }
  }

  async function discoverByDirection() {
    const direction = directionInput.value.trim();
    if (!direction) return toast('先写一个研究方向，例如：多模态大模型的幻觉评测', 'info');
    discoverBtn.disabled = true;
    discoveryStatus.textContent = '正在 OpenAlex / Europe PMC 收集论文…';
    paperCandidates = [];
    renderDiscovery();
    try {
      const result = await lit.discover({
        direction,
        yearFrom: Number(yearFromInput.value),
        yearTo: Number(yearToInput.value),
        openAccessOnly: openOnlyInput.checked,
        limit: 20,
      });
      if (!result.ok) {
        discoveryStatus.textContent = result.error;
        return;
      }
      paperCandidates = result.papers || [];
      discoveryStatus.textContent = paperCandidates.length
        ? `${result.sources.join(' + ')} · ${result.yearFrom}-${result.yearTo} · 已过滤标题低相关结果`
        : '没有找到标题高度相关的论文。请减少泛词，改用 2-5 个核心主题词，或扩大年份范围。';
      renderDiscovery();
    } catch (err) {
      discoveryStatus.textContent = `检索失败：${err.message}`;
    } finally {
      discoverBtn.disabled = false;
    }
  }

  function selectOpenCandidates() {
    const openCandidates = paperCandidates.filter((paper) => paper.pdfUrl && paper.downloadState !== 'done');
    const allSelected = openCandidates.length > 0 && openCandidates.every((paper) => paper.selected);
    for (const paper of openCandidates) paper.selected = !allSelected;
    renderDiscovery();
  }

  async function downloadOpenCandidates(selectedOnly = false) {
    if (autoDownloadBusy) return;
    const candidates = paperCandidates.filter((paper) => paper.pdfUrl && paper.downloadState !== 'done' && (!selectedOnly || paper.selected));
    if (!candidates.length) return toast(selectedOnly ? '先勾选开放全文论文' : '当前没有可自动下载的开放全文', 'info');
    autoDownloadBusy = true;
    syncDiscoveryActions();
    discoveryStatus.textContent = `正在自动下载 ${candidates.length} 篇…`;
    try {
      const result = await lit.downloadCandidates(candidates);
      const successes = new Map((result.results || []).filter((item) => item.ok).map((item) => [item.title, item]));
      const metaMap = meta();
      for (const paper of paperCandidates) {
        const got = successes.get(paper.title);
        if (!got) continue;
        paper.downloadState = 'done';
        paper.selected = false;
        metaMap[got.file] = { ...paperToMeta(paper), note: `方向检索 · ${got.source}`, addedAt: new Date().toISOString() };
      }
      await config.set('research.litMeta', metaMap);
      discoveryStatus.textContent = result.failed
        ? `自动下载完成 ${result.completed}/${result.total} 篇，${result.failed} 篇需要打开论文页面处理。`
        : `自动下载完成：${result.completed} 篇已入库。`;
      if (result.completed) {
        await renderList();
        toast(`已自动入库 ${result.completed} 篇论文`, 'good', 5000);
      }
      const failed = (result.results || []).find((item) => !item.ok && item.url);
      if (failed) showFetchNotice(failed);
      renderDiscovery();
    } catch (err) {
      discoveryStatus.textContent = `自动下载失败：${err.message}`;
    } finally {
      autoDownloadBusy = false;
      renderDiscovery();
    }
  }

  /** 下载失败时的持久提示卡：地址留下来，可打开/复制/关掉，切走自动消失 */
  function showFetchNotice(result) {
    noticeEl.textContent = '';
    if (!result) { noticeEl.setAttribute('hidden', ''); return; }
    noticeEl.removeAttribute('hidden');
    noticeEl.appendChild(
      h('div', { class: 'lit__notice-head' },
        h('strong', {}, result.code === 'direct-download-failed' ? 'PDF 直链无法读取' : result.code === 'download-failed' ? '找到了，但自动下载没成功' : '没找到免费下载源'),
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

  /** 支持 PDF 直链直接入库；普通文献名再走开放学术索引检索。 */
  async function doFetch() {
    const query = fetchInput.value.trim();
    if (!query) return toast('先粘贴文献名、PDF 直链或 arXiv 号', 'info');
    fetchBtn.disabled = true;
    showFetchNotice(null);
    fetchStatus.textContent = /^https?:\/\//i.test(query) ? '正在读取 PDF 直链并校验文件…' : '正在 arXiv / dblp / OpenAlex 上找免费 PDF…';
    try {
      const result = await lit.fetchByTitle(query);
      if (!result.ok) {
        fetchStatus.textContent = '';
        showFetchNotice(result);
        return;
      }
      const metaMap = meta();
      // 这条路只拿得到标题，别的字段留给文献库的「自动识别」从 PDF 里抠
      metaMap[result.file] = { title: result.title || '', note: `自动下载自 ${result.source}`, addedAt: new Date().toISOString() };
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
    placeholder: '粘贴文献名 / PDF直链 / arXiv号，回车自动下载',
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doFetch(); }
    },
  });
  const fetchBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => doFetch() }, '查找下载');
  const fetchStatus = h('span', { class: 'faint lit__fetch-status' }, '');

  const directionInput = h('textarea', {
    class: 'field lit__direction-input',
    rows: '2',
    placeholder: '输入具体主题关键词，例如：多模态大模型 幻觉评测；建议 2-5 个核心词',
    onkeydown: (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        discoverByDirection();
      }
    },
  });
  const currentYear = new Date().getFullYear();
  const yearFromInput = h('input', { class: 'field field--sm lit__year', type: 'number', min: '1900', max: '2100', value: String(currentYear - 3) });
  const yearToInput = h('input', { class: 'field field--sm lit__year', type: 'number', min: '1900', max: '2100', value: String(currentYear) });
  const openOnlyInput = h('input', { type: 'checkbox', checked: false });
  const discoveryStatus = h('span', { class: 'faint lit__discovery-status' }, '按方向找论文，结果会保留在左侧');
  const discoverBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: discoverByDirection }, '找这个方向');
  const selectOpenBtn = h('button', { class: 'btn btn--sm', onclick: selectOpenCandidates }, '全选开放全文');
  const downloadSelectedBtn = h('button', { class: 'btn btn--sm btn--primary', disabled: true, onclick: () => downloadOpenCandidates(true) }, '下载已选');
  const downloadOpenBtn = h('button', { class: 'btn btn--sm', disabled: true, onclick: () => downloadOpenCandidates(false) }, '下载开放全文');
  const discoveryPanel = h('details', {
    class: 'lit__discovery lit__collapsible',
    open: Boolean(config.get('research.lit.discoveryOpen', false)),
  },
    h('summary', { class: 'lit__collapse-summary' },
      h('strong', {}, '按研究方向发现'),
      h('span', { class: 'faint' }, '展开检索、筛选和批量下载'),
    ),
    h('div', { class: 'lit__collapsible-body' },
      h('div', { class: 'lit__discovery-titlebar' },
        h('span', { class: 'faint' }, '元数据来自开放学术索引'),
        h('div', { class: 'lit__discovery-title-actions' }, selectOpenBtn, downloadSelectedBtn, downloadOpenBtn),
      ),
      directionInput,
      h('div', { class: 'lit__discovery-filters' },
        h('span', { class: 'faint' }, '年份'), yearFromInput, h('span', { class: 'faint' }, '至'), yearToInput,
        h('label', { class: 'lit__oa-label' }, openOnlyInput, '只看开放全文'),
        discoverBtn,
      ),
      discoveryStatus,
      discoveryList,
    ),
  );
  discoveryPanel.addEventListener('toggle', () => config.set('research.lit.discoveryOpen', discoveryPanel.open));

  const libraryUrlInput = h('input', {
    class: 'field lit__library-url',
    placeholder: '已登录的知网/学校图书馆检索结果页 URL',
  });
  const libraryStatus = h('span', { class: 'faint lit__library-status' }, '登录后扫描当前结果页，下载完成自动入库');
  const openLibraryBtn = h('button', { class: 'btn btn--sm', onclick: openLibraryBrowser }, '打开登录页');
  const scanLibraryBtn = h('button', { class: 'btn btn--sm', onclick: scanLibraryBrowser }, '扫描当前列表');
  const batchDownloadBtn = h('button', { class: 'btn btn--sm btn--primary', disabled: true, onclick: downloadSelectedFromLibrary }, '下载已选论文');
  const libraryPanel = h('details', {
    class: 'lit__library lit__collapsible',
    open: Boolean(config.get('research.lit.libraryOpen', false)),
  },
    h('summary', { class: 'lit__collapse-summary' },
      h('strong', {}, '登录站点批量下载'),
      h('span', { class: 'faint' }, '知网 / 学校图书馆 / 机构权限'),
    ),
    h('div', { class: 'lit__collapsible-body' },
      h('div', { class: 'lit__library-titlebar' },
        h('span', { class: 'faint' }, '只执行你当前会话有权限的下载'),
      ),
      h('div', { class: 'lit__library-open' }, libraryUrlInput, openLibraryBtn),
      h('div', { class: 'lit__library-actions' }, scanLibraryBtn, batchDownloadBtn),
      libraryStatus,
      libraryList,
    ),
  );
  libraryPanel.addEventListener('toggle', () => config.set('research.lit.libraryOpen', libraryPanel.open));

  const importBtn = h('button', { class: 'btn btn--primary', onclick: (e) => doImport(e.currentTarget) }, '导入文献');
  const fixBtn = h('button', {
    class: 'btn btn--sm',
    title: 'arxiv 这类编号命名的 PDF，读正文标题自动重命名',
    onclick: (e) => fixNames(e.currentTarget),
  }, '整理编号名');
  const dropZone = h('div', { class: 'lit__dropzone' },
    h('span', { class: 'lit__dropzone-icon' }, '↓'),
    h('strong', {}, '拖入文献'),
    h('span', { class: 'lit__dropzone-status' }, '支持拖入文件，也支持拖入整个文件夹'),
    h('span', { class: 'faint' }, 'PDF / Word / TXT / MD / EPUB / CAJ 等'),
  );
  dropZone.addEventListener('dragenter', (event) => { event.preventDefault(); dropZone.classList.add('is-dragover'); });
  dropZone.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; dropZone.classList.add('is-dragover'); });
  dropZone.addEventListener('dragleave', (event) => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('is-dragover'); });
  dropZone.addEventListener('drop', importDropped);

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
      h('div', { class: 'lit__side' }, dropZone, discoveryPanel, libraryPanel, noticeEl, listEl),
      h('div', { class: 'lit__reader' },
        viewerBar,
      h('div', { class: 'lit__reader-body' },
          viewerEl,
          pdfXBar,
          transCard,
          chatPanel,
          annoPanel,
        ),
      ),
    ),
  );
  viewerIdle();
  renderList();
  lit.onDownloaded(importDownloaded);
  lit.onBatchProgress((state) => {
    if (state.state === 'opening') libraryStatus.textContent = `正在处理 ${state.index + 1}/${state.total}：${state.title}`;
    if (state.state === 'paused') libraryStatus.textContent = `已暂停：${state.error || state.title}`;
    if (state.state === 'failed') libraryStatus.textContent = `下载失败：${state.title}`;
  });
  lit.onAutoProgress((state) => {
    if (state.state === 'opening') {
      discoveryStatus.textContent = `正在下载 ${state.index + 1}/${state.total}：${state.title}`;
    }
    if (state.state === 'failed') {
      const paper = paperCandidates.find((item) => item.title === state.title);
      if (paper) paper.downloadState = 'failed';
    }
  });
}
