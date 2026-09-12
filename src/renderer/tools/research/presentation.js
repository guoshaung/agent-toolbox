import { h, toast } from '../../core/ui.js';

const STORAGE_KEY = 'research.presentationDeck';
const MAX_SLIDES = 30;

const DEFAULT_SLIDES = [
  {
    title: '研究问题',
    subtitle: '从现象到可验证的问题定义',
    bullets: ['研究背景与现实痛点', '现有方法的主要限制', '本文要验证的核心假设'],
    references: '',
    notes: '这里先说问题为什么值得研究，再给出一句可以被实验验证的问题。',
    imageDataUrl: '',
  },
  {
    title: '方法概览',
    subtitle: '输入、关键模块和输出',
    bullets: ['数据与预处理', '模型或系统的关键模块', '训练目标与推理流程'],
    references: '',
    notes: '沿着数据流讲，不要把所有实现细节塞在一页。',
    imageDataUrl: '',
  },
  {
    title: '实验结果',
    subtitle: '指标、对照和主要发现',
    bullets: ['主要指标与比较设置', '与 baseline 的差异', '最能支持假设的结果'],
    references: '',
    notes: '先说结论，再指出表格或图中支持它的证据。',
    imageDataUrl: '',
  },
  {
    title: '限制与下一步',
    subtitle: '哪些结论仍需要更多证据',
    bullets: ['数据集或实验范围的限制', '可能影响结论的变量', '下一轮实验计划'],
    references: '',
    notes: '把推断和已验证事实分开，最后留下明确的下一步。',
    imageDataUrl: '',
  },
];

function safeImage(value) {
  return /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(String(value || '')) ? String(value) : '';
}

export function normalizeSlide(slide = {}, index = 0) {
  const rawBullets = Array.isArray(slide.bullets)
    ? slide.bullets
    : String(slide.body || '').split(/\r?\n/);
  return {
    title: String(slide.title || '').trim() || '第 ' + (index + 1) + ' 页',
    subtitle: String(slide.subtitle || '').trim(),
    bullets: rawBullets.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12),
    references: String(slide.references || '').trim(),
    notes: String(slide.notes || '').trim(),
    imageDataUrl: safeImage(slide.imageDataUrl),
  };
}

export function normalizeDeck(deck = {}) {
  const rawSlides = Array.isArray(deck.slides) ? deck.slides.slice(0, MAX_SLIDES) : [];
  return {
    title: String(deck.title || '').trim() || '科研演示',
    slides: (rawSlides.length ? rawSlides : DEFAULT_SLIDES).map(normalizeSlide),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createPresentation(root, ctx) {
  const { config } = ctx;
  let deck = normalizeDeck(config.get(STORAGE_KEY, {}));
  let activeIndex = 0;
  let saveTimer = null;

  const slideList = h('div', { class: 'presentation__slide-list' });
  const preview = h('div', { class: 'presentation__preview' });
  const imagePreview = h('img', { class: 'presentation__image-preview', alt: '当前页插图', hidden: true });
  const imageName = h('span', { class: 'faint presentation__image-name' }, '没有插图');
  const titleInput = h('input', { class: 'field', placeholder: '页面标题' });
  const subtitleInput = h('input', { class: 'field', placeholder: '副标题（可选）' });
  const bulletsInput = h('textarea', { class: 'field presentation__bullets-input', rows: '9', placeholder: '每行一个要点，最多 12 行' });
  const referencesInput = h('textarea', { class: 'field', rows: '3', placeholder: '引用来源，例如：Author et al., 2025; DOI...' });
  const notesInput = h('textarea', { class: 'field', rows: '4', placeholder: '演讲者讲稿，只保存在 PPT 备注中' });
  const editorStatus = h('span', { class: 'faint' }, '自动保存到本机');

  function currentSlide() {
    return deck.slides[activeIndex] || deck.slides[0];
  }

  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void config.set(STORAGE_KEY, deck);
      editorStatus.textContent = '已保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }, 260);
  }

  function updateCurrent(field, value) {
    const slide = currentSlide();
    if (!slide) return;
    slide[field] = value;
    renderSlideList();
    renderPreview();
    persistSoon();
  }

  function selectSlide(index) {
    activeIndex = Math.max(0, Math.min(deck.slides.length - 1, index));
    renderSlideList();
    renderEditor();
    renderPreview();
  }

  function renderSlideList() {
    slideList.replaceChildren(...deck.slides.map((slide, index) => h('button', {
      class: 'presentation__slide-item' + (index === activeIndex ? ' is-active' : ''),
      onclick: () => selectSlide(index),
      title: '编辑第 ' + (index + 1) + ' 页',
    },
      h('span', { class: 'presentation__slide-number' }, String(index + 1).padStart(2, '0')),
      h('span', { class: 'presentation__slide-copy' },
        h('strong', {}, slide.title || '未命名页面'),
        h('span', { class: 'faint' }, slide.subtitle || (slide.bullets[0] || '空白页面')),
      ),
    )));
  }

  function renderEditor() {
    const slide = currentSlide();
    if (!slide) return;
    titleInput.value = slide.title;
    subtitleInput.value = slide.subtitle;
    bulletsInput.value = slide.bullets.join('\n');
    referencesInput.value = slide.references;
    notesInput.value = slide.notes;
    const image = safeImage(slide.imageDataUrl);
    imagePreview.hidden = !image;
    imagePreview.src = image || '';
    imageName.textContent = image ? '已添加插图' : '没有插图';
  }

  function renderPreview() {
    const slide = currentSlide();
    if (!slide) return;
    preview.replaceChildren(
      h('div', { class: 'presentation__slide-preview' },
        h('div', { class: 'presentation__slide-kicker' }, String(activeIndex + 1).padStart(2, '0') + ' / ' + String(deck.slides.length).padStart(2, '0')),
        h('h1', {}, slide.title || '未命名页面'),
        slide.subtitle && h('p', { class: 'presentation__slide-subtitle' }, slide.subtitle),
        h('div', { class: 'presentation__slide-content' },
          slide.bullets.length
            ? h('ul', {}, ...slide.bullets.map((bullet) => h('li', {}, bullet)))
            : h('p', { class: 'faint' }, '还没有要点'),
          safeImage(slide.imageDataUrl) && h('img', { class: 'presentation__slide-image', src: slide.imageDataUrl, alt: '页面插图' }),
        ),
        slide.references && h('div', { class: 'presentation__slide-references' }, 'References  ' + slide.references),
      ),
    );
  }

  function addSlide() {
    deck.slides.push(normalizeSlide({ title: '新页面', bullets: ['补充一个需要说明的观点'] }, deck.slides.length));
    activeIndex = deck.slides.length - 1;
    renderSlideList();
    renderEditor();
    renderPreview();
    persistSoon();
  }

  function duplicateSlide() {
    const copy = clone(currentSlide());
    copy.title = copy.title + ' · 副本';
    deck.slides.splice(activeIndex + 1, 0, copy);
    activeIndex += 1;
    renderSlideList();
    renderEditor();
    renderPreview();
    persistSoon();
  }

  function moveSlide(direction) {
    const target = activeIndex + direction;
    if (target < 0 || target >= deck.slides.length) return;
    const [slide] = deck.slides.splice(activeIndex, 1);
    deck.slides.splice(target, 0, slide);
    activeIndex = target;
    renderSlideList();
    renderPreview();
    persistSoon();
  }

  function deleteSlide() {
    if (deck.slides.length <= 1) return toast('至少保留一页演示', 'info');
    deck.slides.splice(activeIndex, 1);
    activeIndex = Math.min(activeIndex, deck.slides.length - 1);
    renderSlideList();
    renderEditor();
    renderPreview();
    persistSoon();
  }

  function loadSampleDeck() {
    deck = { title: '科研汇报', slides: clone(DEFAULT_SLIDES) };
    activeIndex = 0;
    renderSlideList();
    renderEditor();
    renderPreview();
    persistSoon();
    toast('已载入科研汇报示例', 'good');
  }

  async function addImage() {
    const picked = await window.toolbox.files.pickImage();
    if (!picked || picked.canceled) return;
    if (!picked.base64 || !/^image\/(?:png|jpe?g|webp)$/.test(picked.mime || '')) return toast('只支持 PNG、JPG、WebP 图片', 'bad');
    updateCurrent('imageDataUrl', 'data:' + picked.mime + ';base64,' + picked.base64);
    renderEditor();
  }

  function removeImage() {
    updateCurrent('imageDataUrl', '');
    renderEditor();
  }

  async function exportPptx() {
    if (!window.toolbox.presentation?.exportPptx) return toast('当前版本没有 PPTX 导出能力', 'bad');
    const result = await window.toolbox.presentation.exportPptx(deck);
    if (result?.ok) toast('PPTX 已导出：' + result.path, 'good', 5000);
    else if (!result?.canceled) toast(result?.error || 'PPTX 导出失败', 'bad', 6000);
  }

  async function exportJson() {
    const result = await window.toolbox.files.saveText({
      content: JSON.stringify(deck, null, 2),
      extension: 'json',
      defaultName: '科研演示.json',
    });
    if (result.ok) toast('演示源文件已保存：' + result.path, 'good', 5000);
  }

  async function exportMarkdown() {
    const content = '# ' + deck.title + '\n\n' + deck.slides.map((slide, index) => [
      '## ' + (index + 1) + '. ' + slide.title,
      slide.subtitle,
      slide.bullets.map((bullet) => '- ' + bullet).join('\n'),
      slide.references ? '**References:** ' + slide.references : '',
      slide.notes ? '**讲稿：**\n' + slide.notes : '',
    ].filter(Boolean).join('\n\n')).join('\n\n');
    const result = await window.toolbox.files.saveText({ content, extension: 'md', defaultName: '科研演示.md' });
    if (result.ok) toast('Markdown 大纲已保存：' + result.path, 'good', 5000);
  }

  titleInput.addEventListener('input', (event) => updateCurrent('title', event.currentTarget.value));
  subtitleInput.addEventListener('input', (event) => updateCurrent('subtitle', event.currentTarget.value));
  bulletsInput.addEventListener('input', (event) => {
    updateCurrent('bullets', event.currentTarget.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 12));
  });
  referencesInput.addEventListener('input', (event) => updateCurrent('references', event.currentTarget.value));
  notesInput.addEventListener('input', (event) => updateCurrent('notes', event.currentTarget.value));

  const deckTitle = h('input', {
    class: 'field presentation__deck-title',
    value: deck.title,
    oninput: (event) => { deck.title = event.currentTarget.value; persistSoon(); },
  });
  const imageActions = h('div', { class: 'presentation__image-actions' },
    h('button', { class: 'btn btn--sm', onclick: addImage }, '添加图片'),
    h('button', { class: 'btn btn--sm', onclick: removeImage }, '移除图片'),
    imageName,
  );
  const editor = h('div', { class: 'presentation__editor' },
    h('div', { class: 'presentation__editor-head' }, h('strong', {}, '页面内容'), editorStatus),
    h('label', {}, h('span', { class: 'presentation__label' }, '标题'), titleInput),
    h('label', {}, h('span', { class: 'presentation__label' }, '副标题'), subtitleInput),
    h('label', {}, h('span', { class: 'presentation__label' }, '要点'), bulletsInput),
    h('label', {}, h('span', { class: 'presentation__label' }, '引用'), referencesInput),
    h('label', {}, h('span', { class: 'presentation__label' }, '讲稿'), notesInput),
    imageActions,
    imagePreview,
  );
  const slideActions = h('div', { class: 'presentation__slide-actions' },
    h('button', { class: 'btn btn--sm btn--primary', onclick: addSlide }, '＋ 新页'),
    h('button', { class: 'btn btn--sm', onclick: duplicateSlide }, '复制页'),
    h('button', { class: 'btn btn--sm', onclick: () => moveSlide(-1) }, '上移'),
    h('button', { class: 'btn btn--sm', onclick: () => moveSlide(1) }, '下移'),
    h('button', { class: 'btn btn--sm', onclick: deleteSlide }, '删除'),
  );
  const slideRail = h('aside', { class: 'presentation__rail' },
    h('div', { class: 'presentation__rail-head' }, h('strong', {}, '页面'), slideActions),
    slideList,
  );
  const toolbar = h('div', { class: 'bar presentation__bar' },
    h('strong', {}, '科研演示'),
    deckTitle,
    h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn btn--sm', onclick: loadSampleDeck }, '科研示例'),
    h('button', { class: 'btn btn--sm', onclick: exportJson }, '保存源文件'),
    h('button', { class: 'btn btn--sm', onclick: exportMarkdown }, '导出大纲'),
    h('button', { class: 'btn btn--sm btn--primary', onclick: exportPptx }, '导出 PPTX'),
  );

  root.append(
    toolbar,
    h('div', { class: 'presentation__workspace' },
      slideRail,
      h('main', { class: 'presentation__preview-pane' },
        h('div', { class: 'presentation__pane-title' }, h('strong', {}, '实时预览'), h('span', { class: 'faint' }, '页面比例 16:9 · 导出后仍可编辑')),
        preview,
      ),
      editor,
    ),
  );
  renderSlideList();
  renderEditor();
  renderPreview();

  return { refresh: () => { renderSlideList(); renderEditor(); renderPreview(); } };
}
