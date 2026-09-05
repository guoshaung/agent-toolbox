import { h, toast, debounce } from '../../core/ui.js';
import { STYLES, formatAll, missingFields, parseAuthor } from './citation.js';
import { identify, VIA_LABEL } from './identify.js';

const META_KEY = 'research.litMeta';
const COLLECTIONS_KEY = 'research.libCollections';
const CHECKED_KEY = 'research.libChecked';

// 批量补全的自动写入门槛。定得高是故意的：宁可留着让人手动核，
// 也不要把错的书目信息悄悄写进库里 —— 那种错误要等论文投出去才发现。
const AUTO_FILL_MIN = 0.82;

const BIB_FIELDS = [
  ['title', '标题', 'text'],
  ['authorsText', '作者', 'text'],
  ['year', '年份', 'text'],
  ['journal', '期刊 / 会议', 'text'],
  ['volume', '卷', 'text'],
  ['issue', '期', 'text'],
  ['pages', '页码', 'text'],
  ['doi', 'DOI', 'text'],
];

const authorsToText = (authors) => (authors || [])
  .map((a) => (a.given ? `${a.family}, ${a.given}` : a.family)).join('; ');

const textToAuthors = (text) => String(text || '')
  .split(/[;；]/).map((part) => parseAuthor(part)).filter(Boolean);

/** 文件名去掉扩展名，当作没有元数据时的兜底标题 */
const fallbackTitle = (file) => String(file || '').replace(/\.[^.]+$/, '');

const READ_STATUS = {
  unread: { label: '未读', tone: 'neutral' },
  reading: { label: '阅读中', tone: 'warn' },
  read: { label: '已读', tone: 'good' },
  archived: { label: '暂存', tone: 'neutral' },
};

const USEFULNESS = {
  unknown: { label: '价值未判断', tone: 'neutral' },
  useful: { label: '值得精读', tone: 'good' },
  maybe: { label: '待评估', tone: 'warn' },
  irrelevant: { label: '暂不相关', tone: 'neutral' },
};

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(value / 1024))}KB`;
}

function formatDate(value) {
  if (!value) return '加入时间未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '加入时间未知' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/**
 * 文献库：管理层。
 *
 * 和「文献」页的分工：这里负责分类、勾选、补全元数据、导出引用；
 * 勾选的结果会变成「文献」页的工作集 —— 那边只显示你勾中的，不再是一长条全量列表。
 */
export function createLibrary(root, ctx) {
  const { config } = ctx;
  const lit = window.toolbox.lit;
  const biblio = window.toolbox.biblio;

  let files = [];
  let currentCollection = 'all';
  let search = '';
  let statusFilter = 'all';
  let usefulnessFilter = 'all';
  let sortMode = 'recent';

  const meta = () => config.get(META_KEY) || {};
  const collections = () => config.get(COLLECTIONS_KEY) || [];
  const checked = () => new Set(config.get(CHECKED_KEY) || []);

  async function patchMeta(file, patch) {
    const map = meta();
    map[file] = { ...(map[file] || {}), ...patch };   // 合并，别把「文献」页写的 note/addedAt 冲掉
    await config.set(META_KEY, map);
  }

  /** 组装成引用格式化器要的形状 */
  function bibItem(file) {
    const m = meta()[file] || {};
    return {
      file,
      title: m.title || fallbackTitle(file),
      authors: m.authors || [],
      year: m.year || '',
      journal: m.journal || '',
      volume: m.volume || '',
      issue: m.issue || '',
      pages: m.pages || '',
      doi: m.doi || '',
      url: m.url || '',
      publisher: m.publisher || '',
      type: m.type || 'article',
    };
  }

  // ---------- 分类侧栏 ----------
  const sideEl = h('div', { class: 'lib__side' });

  function countIn(id) {
    const map = meta();
    if (id === 'all') return files.length;
    if (id === 'none') return files.filter((f) => !(map[f.file]?.collections || []).length).length;
    return files.filter((f) => (map[f.file]?.collections || []).includes(id)).length;
  }

  function renderSide() {
    sideEl.textContent = '';
    const rows = [
      { id: 'all', name: '全部' },
      { id: 'none', name: '未分类' },
      ...collections(),
    ];
    for (const row of rows) {
      const custom = !['all', 'none'].includes(row.id);
      sideEl.append(h('div', { class: `lib__coll${row.id === currentCollection ? ' is-active' : ''}` },
        h('button', {
          class: 'lib__coll-btn',
          onclick: () => { currentCollection = row.id; renderSide(); renderList(); },
        },
          h('span', { class: 'lib__coll-name' }, row.name),
          h('span', { class: 'faint lib__coll-count' }, String(countIn(row.id))),
        ),
        custom ? h('button', {
          class: 'lib__coll-del', title: '删除这个分类（不删文献）',
          onclick: async () => {
            const list = collections().filter((c) => c.id !== row.id);
            await config.set(COLLECTIONS_KEY, list);
            const map = meta();
            for (const key of Object.keys(map)) {
              if (map[key].collections?.includes(row.id)) {
                map[key].collections = map[key].collections.filter((c) => c !== row.id);
              }
            }
            await config.set(META_KEY, map);
            if (currentCollection === row.id) currentCollection = 'all';
            renderSide(); renderList();
          },
        }, '×') : null,
      ));
    }

    sideEl.append(addRow);
  }

  /**
   * 新建分类用行内输入框，不用 window.prompt —— **Electron 根本不实现 prompt()**，
   * 调用它既不弹窗也不报错，按钮看起来就是"点了没反应"。
   */
  const addRow = h('div', { class: 'lib__coll-new' });

  function showAddButton() {
    addRow.textContent = '';
    addRow.append(h('button', {
      class: 'lib__coll-add',
      onclick: () => showAddInput(),
    }, '＋ 新建分类'));
  }

  function showAddInput() {
    const input = h('input', {
      class: 'field field--sm lib__coll-input',
      placeholder: '分类名，回车确认',
      onkeydown: async (e) => {
        if (e.key === 'Escape') { showAddButton(); return; }
        // isComposing：中文输入法选词时的回车不能当成确认
        if (e.key !== 'Enter' || e.isComposing) return;
        const name = input.value.trim();
        if (!name) { showAddButton(); return; }
        if (collections().some((c) => c.name === name)) {
          toast('已经有同名分类了', 'info');
          return;
        }
        await config.set(COLLECTIONS_KEY,
          [...collections(), { id: `c_${Date.now().toString(36)}`, name }]);
        showAddButton();
        renderSide();
        toast(`已新建分类「${name}」`, 'good');
      },
      onblur: () => {
        // 没输入就失焦，收回按钮；有内容就留着，免得手滑点别处白打了
        setTimeout(() => { if (!input.value.trim()) showAddButton(); }, 120);
      },
    });
    addRow.textContent = '';
    addRow.append(input);
    input.focus();
  }

  showAddButton();

  // ---------- 列表 ----------
  const listEl = h('div', { class: 'lib__list' });
  const selectionLabel = h('span', { class: 'faint' }, '');
  const overview = h('div', { class: 'lib__overview' });

  function renderOverview() {
    const map = meta();
    const totalSize = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    const read = files.filter((file) => (map[file.file]?.readStatus || 'unread') === 'read').length;
    const useful = files.filter((file) => (map[file.file]?.usefulness || 'unknown') === 'useful').length;
    const pending = files.filter((file) => {
      const item = bibItem(file.file);
      return (map[file.file]?.usefulness || 'unknown') === 'unknown' || missingFields(item, 'gbt7714').length;
    }).length;
    overview.textContent = '';
    overview.append(
      h('div', { class: 'lib__overview-primary' },
        h('strong', {}, `${files.length} 篇文献`),
        h('span', { class: 'faint' }, `占用 ${formatBytes(totalSize)}`),
      ),
      h('div', { class: 'lib__overview-metrics' },
        h('span', { class: 'lib__metric lib__metric--good' }, `已读 ${read}`),
        h('span', { class: 'lib__metric lib__metric--good' }, `值得精读 ${useful}`),
        h('span', { class: 'lib__metric lib__metric--warn' }, `待处理 ${pending}`),
      ),
      h('span', { class: 'faint lib__overview-hint' }, '先判断价值，再决定是否精读；元数据不全会在导出前提醒'),
    );
  }

  function visibleFiles() {
    const map = meta();
    const needle = search.trim().toLowerCase();
    return files.filter((f) => {
      const m = map[f.file] || {};
      if (currentCollection === 'none' && (m.collections || []).length) return false;
      if (!['all', 'none'].includes(currentCollection)
        && !(m.collections || []).includes(currentCollection)) return false;
      if (statusFilter !== 'all' && (m.readStatus || 'unread') !== statusFilter) return false;
      if (usefulnessFilter !== 'all' && (m.usefulness || 'unknown') !== usefulnessFilter) return false;
      if (!needle) return true;
      const haystack = `${f.file} ${m.title || ''} ${authorsToText(m.authors)} ${m.journal || ''}`.toLowerCase();
      return haystack.includes(needle);
    }).sort((left, right) => {
      const leftMeta = map[left.file] || {};
      const rightMeta = map[right.file] || {};
      if (sortMode === 'title') return (leftMeta.title || fallbackTitle(left.file)).localeCompare(rightMeta.title || fallbackTitle(right.file), 'zh-CN');
      if (sortMode === 'year') return String(rightMeta.year || '').localeCompare(String(leftMeta.year || ''));
      if (sortMode === 'size') return (right.size || 0) - (left.size || 0);
      if (sortMode === 'useful') return Number(rightMeta.usefulness === 'useful') - Number(leftMeta.usefulness === 'useful')
        || Number(rightMeta.priority || 0) - Number(leftMeta.priority || 0);
      return String(rightMeta.addedAt || right.mtime || '').localeCompare(String(leftMeta.addedAt || left.mtime || ''));
    });
  }

  async function toggleCheck(file, on) {
    const set = checked();
    if (on) set.add(file); else set.delete(file);
    await config.set(CHECKED_KEY, [...set]);
    syncSelectionLabel();
  }

  function syncSelectionLabel() {
    const count = checked().size;
    selectionLabel.textContent = count ? `已勾选 ${count} 篇` : '还没勾选';
    exportBtn.disabled = count === 0;
    clearBtn.disabled = count === 0;
  }

  function renderList() {
    const map = meta();
    const set = checked();
    const rows = visibleFiles();
    listEl.textContent = '';
    renderOverview();

    if (!rows.length) {
      listEl.append(h('div', { class: 'empty' },
        h('span', { class: 'empty__icon' }, '📚'),
        files.length ? '这个分类下还没有文献。' : '库里还没有文献，先去「文献」页导入或下载。'));
      return;
    }

    for (const f of rows) {
      const m = map[f.file] || {};
      const item = bibItem(f.file);
      const missing = missingFields(item, 'gbt7714');
      const readStatus = READ_STATUS[m.readStatus] || READ_STATUS.unread;
      const usefulness = USEFULNESS[m.usefulness] || USEFULNESS.unknown;
      const abstract = String(m.abstract || '').trim();
      const note = String(m.note || '').trim();
      const box = h('input', {
        type: 'checkbox',
        class: 'lib__check',
        checked: set.has(f.file),
        onchange: (e) => toggleCheck(f.file, e.target.checked),
      });

      listEl.append(h('div', { class: 'lib__item' },
        box,
        h('div', { class: 'lib__item-body' },
          h('div', { class: 'lib__item-title', title: f.file }, item.title),
          h('div', { class: 'lib__item-sub faint' },
            [authorsToText(item.authors) || '作者未知', item.year || '年份未知', item.journal]
              .filter(Boolean).join(' · ')),
          h('div', { class: 'lib__item-insights' },
            h('span', { class: `tag tag--${readStatus.tone}` }, readStatus.label),
            h('span', { class: `tag tag--${usefulness.tone}` }, usefulness.label),
            m.priority ? h('span', { class: 'tag tag--priority' }, `优先级 ${m.priority}`) : null,
            h('span', { class: 'faint lib__item-filemeta' }, `${String(item.type || f.format || 'file').toUpperCase()} · ${formatBytes(f.size)} · ${formatDate(m.addedAt || f.mtime)}`),
          ),
          h('div', { class: 'lib__item-tags' },
            ...(m.collections || []).map((id) => {
              const coll = collections().find((c) => c.id === id);
              return coll ? h('span', { class: 'tag' }, coll.name) : null;
            }),
            missing.length
              ? h('span', { class: 'tag tag--warn', title: '按 GB/T 7714 还差这些字段，导出前建议补全' },
                  `缺 ${missing.join('/')}`)
              : h('span', { class: 'tag tag--good' }, '可引用'),
          ),
          h('p', { class: `lib__item-abstract${abstract ? '' : ' is-empty'}` }, abstract || '还没有摘要。点击“编辑详情”补充摘要，之后可以直接按内容判断是否值得精读。'),
          note ? h('div', { class: 'lib__item-note' }, `笔记：${note}`) : null,
        ),
        h('div', { class: 'lib__item-actions' },
          h('button', { class: 'btn btn--sm btn--ghost', title: '编辑书目信息、摘要、价值判断和笔记', onclick: () => openEditor(f.file) }, '详情'),
          h('button', { class: 'btn btn--sm btn--ghost', title: '归到分类', onclick: (e) => openCollectionMenu(e, f.file) }, '🏷'),
          h('button', { class: 'btn btn--sm btn--ghost', title: '用系统程序打开', onclick: () => lit.open(f.file) }, '↗'),
        ),
      ));
    }
    syncSelectionLabel();
  }

  /** 归类小菜单：多选，一个文献可以属于多个分类 */
  function openCollectionMenu(event, file) {
    document.querySelector('.lib__menu')?.remove();
    const list = collections();
    if (!list.length) return toast('先在左边新建一个分类', 'info');

    const current = new Set(meta()[file]?.collections || []);
    const menu = h('div', { class: 'lib__menu' },
      ...list.map((coll) => h('label', { class: 'lib__menu-row' },
        h('input', {
          type: 'checkbox',
          checked: current.has(coll.id),
          onchange: async (e) => {
            if (e.target.checked) current.add(coll.id); else current.delete(coll.id);
            await patchMeta(file, { collections: [...current] });
            renderSide(); renderList();
          },
        }),
        coll.name,
      )),
    );
    const rect = event.target.getBoundingClientRect();
    Object.assign(menu.style, { top: `${rect.bottom + 4}px`, left: `${Math.max(8, rect.left - 120)}px` });
    document.body.append(menu);
    setTimeout(() => {
      const close = (e) => {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
      };
      document.addEventListener('click', close);
    }, 0);
  }

  // ---------- 书目编辑 ----------
  function openEditor(file) {
    const m = meta()[file] || {};
    const item = bibItem(file);
    const values = { ...item, authorsText: authorsToText(item.authors) };
    const inputs = {};
    const researchInputs = {};

    const form = h('div', { class: 'lib__editor-form' },
      ...BIB_FIELDS.map(([key, label]) => {
        const input = h('input', { class: 'field field--sm', value: values[key] || '' });
        inputs[key] = input;
        return h('label', { class: 'lib__field' }, h('span', {}, label), input);
      }),
    );

    const status = h('div', { class: 'faint lib__editor-status' }, `文件：${file}`);
    const candidateBox = h('div', { class: 'lib__cands' });
    const readStatusInput = h('select', { class: 'field field--sm' },
      h('option', { value: 'unread' }, '未读'),
      h('option', { value: 'reading' }, '阅读中'),
      h('option', { value: 'read' }, '已读'),
      h('option', { value: 'archived' }, '暂存'),
    );
    readStatusInput.value = m.readStatus || 'unread';
    researchInputs.readStatus = readStatusInput;
    const usefulnessInput = h('select', { class: 'field field--sm' },
      h('option', { value: 'unknown' }, '价值未判断'),
      h('option', { value: 'useful' }, '值得精读'),
      h('option', { value: 'maybe' }, '待评估'),
      h('option', { value: 'irrelevant' }, '暂不相关'),
    );
    usefulnessInput.value = m.usefulness || 'unknown';
    researchInputs.usefulness = usefulnessInput;
    const priorityInput = h('select', { class: 'field field--sm' },
      h('option', { value: '0' }, '不设优先级'),
      h('option', { value: '1' }, '优先级 1 · 了解'),
      h('option', { value: '2' }, '优先级 2 · 重点'),
      h('option', { value: '3' }, '优先级 3 · 核心'),
    );
    priorityInput.value = String(m.priority || 0);
    researchInputs.priority = priorityInput;
    const abstractInput = h('textarea', { class: 'field lib__long-text', rows: '5', placeholder: '粘贴或整理摘要，之后在列表直接判断是否值得读' }, m.abstract || '');
    const noteInput = h('textarea', { class: 'field lib__long-text', rows: '4', placeholder: '记录为什么有用、可复用的方法、需要核对的问题' }, m.note || '');
    const keywordsInput = h('input', { class: 'field field--sm', value: (m.keywords || []).join(', '), placeholder: '关键词，用逗号分隔' });
    researchInputs.abstract = abstractInput;
    researchInputs.note = noteInput;
    researchInputs.keywords = keywordsInput;
    const researchForm = h('div', { class: 'lib__research-form' },
      h('div', { class: 'lib__research-form-title' }, '阅读判断'),
      h('label', { class: 'lib__field' }, h('span', {}, '阅读状态'), readStatusInput),
      h('label', { class: 'lib__field' }, h('span', {}, '价值判断'), usefulnessInput),
      h('label', { class: 'lib__field' }, h('span', {}, '优先级'), priorityInput),
      h('label', { class: 'lib__field lib__field--stacked' }, h('span', {}, '关键词'), keywordsInput),
      h('label', { class: 'lib__field lib__field--stacked' }, h('span', {}, '摘要'), abstractInput),
      h('label', { class: 'lib__field lib__field--stacked' }, h('span', {}, '我的笔记'), noteInput),
    );

    function applyMeta(best) {
      inputs.title.value = best.title || inputs.title.value;
      inputs.authorsText.value = authorsToText(best.authors);
      inputs.year.value = best.year || '';
      inputs.journal.value = best.journal || '';
      inputs.volume.value = best.volume || '';
      inputs.issue.value = best.issue || '';
      inputs.pages.value = best.pages || '';
      inputs.doi.value = best.doi || '';
    }

    const overlay = h('div', { class: 'lib__overlay' },
      h('div', { class: 'lib__overlay-card' },
        h('h3', { class: 'card__title' }, '书目信息'),
        status,
        candidateBox,
        form,
        researchForm,
        h('div', { class: 'lib__overlay-actions' },
          h('button', {
            class: 'btn btn--sm',
            onclick: async (e) => {
              e.target.disabled = true;
              status.textContent = '正在查 OpenAlex / arXiv / Crossref…';
              candidateBox.textContent = '';
              // 手填了 DOI 就直接用；否则先让它自己去 PDF 里找 DOI / arXiv 号
              const typedDoi = inputs.doi.value.trim();
              const result = typedDoi
                ? await biblio.lookup({ doi: typedDoi })
                : await identify(file, { fallbackTitle: inputs.title.value.trim() || fallbackTitle(file) });
              e.target.disabled = false;
              if (!result.ok) { status.textContent = result.error; return; }

              if (result.exact) {           // DOI / arXiv 精确命中，直接填
                applyMeta(result.meta || result.best);
                status.textContent = `已从${VIA_LABEL[result.via] || 'DOI'}精确匹配并填入。`;
                status.classList.remove('lib__status--warn');
                return;
              }

              // 只是 arXiv、又没有同名竞争者 —— 没什么可挑的，直接填。
              if (result.autoImport) {
                applyMeta(result.best);
                status.textContent = `只在 arXiv 上，没有同名论文，已直接填入（${result.best.doi || result.best._arxivId || ''}）。`;
                status.classList.remove('lib__status--warn');
                candidateBox.textContent = '';
                return;
              }

              // 同名不同篇 —— 这种自动填必错，必须让人选。
              if (result.ambiguous) {
                status.textContent = `⚠️ 找到 ${result.sameNameCount} 篇标题几乎一样但不是同一篇的文献，得你挑一下是哪篇：`;
                status.classList.add('lib__status--warn');
              } else {
                status.textContent = `没在 PDF 里找到 DOI，改用${VIA_LABEL[result.via] || '标题'}搜到 ${result.candidates.length} 条，挑一条对得上的：`;
                status.classList.toggle('lib__status--warn', result.score < AUTO_FILL_MIN);
              }
              candidateBox.append(...result.candidates.map((cand) => h('button', {
                class: 'lib__cand',
                onclick: () => {
                  applyMeta(cand);
                  status.textContent = '已填入所选条目，保存前再核一眼。';
                  candidateBox.textContent = '';
                },
              },
                h('div', { class: 'lib__cand-title' }, cand.title || '(无标题)'),
                h('div', { class: 'faint lib__cand-sub' },
                  // 同名的时候，能区分开的就是年份、期刊和 DOI，所以 DOI 也摆出来
                  [authorsToText(cand.authors) || '作者未知', cand.year, cand.journal, cand.doi].filter(Boolean).join(' · ')),
                cand._source ? h('span', { class: 'tag' }, cand._source) : null,
                h('span', { class: `tag ${cand._score >= AUTO_FILL_MIN ? 'tag--good' : 'tag--warn'}` },
                  `相似 ${Number(cand._score ?? 0).toFixed(2)}`),
              )));
            },
          }, '自动识别'),
          h('span', { style: { flex: 1 } }),
          h('button', { class: 'btn btn--sm btn--ghost', onclick: () => overlay.remove() }, '取消'),
          h('button', {
            class: 'btn btn--sm btn--primary',
            onclick: async () => {
              await patchMeta(file, {
                title: inputs.title.value.trim(),
                authors: textToAuthors(inputs.authorsText.value),
                year: inputs.year.value.trim(),
                journal: inputs.journal.value.trim(),
                volume: inputs.volume.value.trim(),
                issue: inputs.issue.value.trim(),
                pages: inputs.pages.value.trim(),
                doi: inputs.doi.value.trim(),
                readStatus: researchInputs.readStatus.value,
                usefulness: researchInputs.usefulness.value,
                priority: Number(researchInputs.priority.value) || 0,
                keywords: researchInputs.keywords.value.split(/[,，]/).map((value) => value.trim()).filter(Boolean),
                abstract: researchInputs.abstract.value.trim(),
                note: researchInputs.note.value.trim(),
              });
              overlay.remove();
              renderList();
              toast('已保存', 'good');
            },
          }, '保存'),
        ),
      ),
    );
    root.append(overlay);
  }

  // ---------- 批量补全 ----------
  async function fillMissing(button) {
    const set = checked();
    const targets = (set.size ? files.filter((f) => set.has(f.file)) : visibleFiles())
      .filter((f) => {
        const item = bibItem(f.file);
        return missingFields(item, 'gbt7714').length > 0;
      });
    if (!targets.length) return toast('没有需要补全的（或者都补过了）', 'info');

    button.disabled = true;
    const original = button.textContent;
    let done = 0;
    let weak = 0;
    let exact = 0;
    try {
      for (const f of targets) {
        button.textContent = `识别中 ${++done}/${targets.length}`;
        const item = bibItem(f.file);
        // 优先从 PDF 正文抠 DOI / arXiv 号做精确查询，抠不到才退回标题搜索
        const result = item.doi
          ? { ...(await biblio.lookup({ doi: item.doi })), exact: true, via: 'doi' }
          : await identify(f.file, { fallbackTitle: item.title });
        if (!result.ok) continue;

        const best = result.meta || result.best;
        if (!best) continue;
        // 非精确命中且相似度不够的一律不写 —— 填错元数据比不填更坑
        if (!result.exact && (result.score ?? 0) < AUTO_FILL_MIN) { weak += 1; continue; }

        await patchMeta(f.file, {
          title: best.title || item.title,
          authors: best.authors,
          year: best.year,
          journal: best.journal,
          volume: best.volume,
          issue: best.issue,
          pages: best.pages,
          doi: best.doi,
          url: best.url,
          type: best.type,
          metaFrom: result.via || 'lookup',
        });
        if (result.exact) exact += 1;
      }
      renderList();
      toast([
        `识别完成：${exact} 篇从 DOI / arXiv 精确匹配`,
        weak ? `${weak} 篇拿不准没敢填，点 ✎ 手动挑候选` : '',
      ].filter(Boolean).join('，'), 'good', 6000);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  // ---------- 导出引用 ----------
  function openExport() {
    const set = checked();
    const items = files.filter((f) => set.has(f.file)).map((f) => bibItem(f.file));
    if (!items.length) return toast('先勾选文献', 'info');

    let style = config.get('research.citeStyle', 'gbt7714');
    const preview = h('pre', { class: 'lib__preview' });
    const warnBox = h('div', { class: 'lib__warn' });
    const styleBar = h('div', { class: 'lib__styles' });
    let result = null;

    function draw() {
      result = formatAll(items, style);
      preview.textContent = result.text;
      for (const button of styleBar.children) {
        button.classList.toggle('is-active', button.dataset.style === style);
      }
      const meta = STYLES.find((s) => s.id === style);
      warnBox.textContent = '';
      warnBox.append(h('div', { class: 'faint' }, meta.hint));
      if (result.warnings.length) {
        warnBox.append(h('div', { class: 'lib__warn-list' },
          h('div', { class: 'lib__warn-head' }, `${result.warnings.length} 篇字段不全，粘进论文前先补：`),
          ...result.warnings.slice(0, 6).map((w) => h('div', { class: 'lib__warn-row' },
            h('span', { class: 'lib__warn-title' }, w.title),
            h('span', { class: 'tag tag--warn' }, `缺 ${w.missing.join('/')}`),
          )),
          result.warnings.length > 6
            ? h('div', { class: 'faint' }, `另有 ${result.warnings.length - 6} 篇…`) : null,
        ));
      } else {
        warnBox.append(h('div', { class: 'tag tag--good' }, '这批文献字段齐全'));
      }
    }

    for (const meta of STYLES) {
      styleBar.append(h('button', {
        class: 'btn btn--sm lib__style',
        dataset: { style: meta.id },
        title: meta.hint,
        onclick: () => { style = meta.id; config.set('research.citeStyle', style); draw(); },
      }, meta.label));
    }

    const overlay = h('div', { class: 'lib__overlay' },
      h('div', { class: 'lib__overlay-card lib__overlay-card--wide' },
        h('div', { class: 'lib__export-head' },
          h('h3', { class: 'card__title' }, `导出引用 · ${items.length} 篇`),
          h('span', { style: { flex: 1 } }),
          h('button', { class: 'btn btn--sm btn--ghost', onclick: () => overlay.remove() }, '关闭'),
        ),
        styleBar,
        warnBox,
        preview,
        h('div', { class: 'lib__overlay-actions' },
          h('button', {
            class: 'btn btn--sm btn--primary',
            title: '带排版复制，粘进 Word 保留悬挂缩进',
            onclick: async () => {
              await biblio.copyRich({ text: result.text, html: result.html });
              toast('已复制，直接粘进 Word', 'good');
            },
          }, '复制到 Word'),
          h('button', {
            class: 'btn btn--sm',
            onclick: async () => {
              await window.toolbox.clipboard.write(result.text);
              toast('已复制纯文本', 'good');
            },
          }, '复制纯文本'),
          h('button', {
            class: 'btn btn--sm',
            onclick: async () => {
              const meta = STYLES.find((s) => s.id === style);
              const saved = await biblio.export({
                content: result.text,
                defaultName: `references.${meta.ext}`,
                ext: meta.ext,
              });
              if (!saved) return;
              if (!saved.ok) return toast(saved.error, 'bad');
              toast(`已导出 ${saved.name}`, 'good');
            },
          }, '存成文件'),
        ),
      ),
    );
    draw();
    root.append(overlay);
  }

  // ---------- 顶栏 ----------
  const searchInput = h('input', {
    class: 'field field--sm lib__search',
    placeholder: '搜标题 / 作者 / 期刊 / 文件名',
    oninput: debounce(() => { search = searchInput.value; renderList(); }, 180),
  });

  const exportBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => openExport() }, '导出引用');
  const clearBtn = h('button', {
    class: 'btn btn--sm',
    onclick: async () => { await config.set(CHECKED_KEY, []); renderList(); },
  }, '清空勾选');
  const statusFilterSelect = h('select', { class: 'field field--sm lib__filter', title: '按阅读状态筛选', onchange: () => { statusFilter = statusFilterSelect.value; renderList(); } },
    h('option', { value: 'all' }, '全部状态'),
    h('option', { value: 'unread' }, '未读'),
    h('option', { value: 'reading' }, '阅读中'),
    h('option', { value: 'read' }, '已读'),
    h('option', { value: 'archived' }, '暂存'),
  );
  const usefulnessFilterSelect = h('select', { class: 'field field--sm lib__filter', title: '按价值判断筛选', onchange: () => { usefulnessFilter = usefulnessFilterSelect.value; renderList(); } },
    h('option', { value: 'all' }, '全部价值'),
    h('option', { value: 'unknown' }, '价值未判断'),
    h('option', { value: 'useful' }, '值得精读'),
    h('option', { value: 'maybe' }, '待评估'),
    h('option', { value: 'irrelevant' }, '暂不相关'),
  );
  const sortSelect = h('select', { class: 'field field--sm lib__filter', title: '排序方式', onchange: () => { sortMode = sortSelect.value; renderList(); } },
    h('option', { value: 'recent' }, '最近加入'),
    h('option', { value: 'useful' }, '优先级 / 价值'),
    h('option', { value: 'year' }, '发表年份'),
    h('option', { value: 'title' }, '标题'),
    h('option', { value: 'size' }, '文件大小'),
  );

  const bar = h('div', { class: 'lib__bar' },
    h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        const set = checked();
        const rows = visibleFiles();
        const allOn = rows.every((f) => set.has(f.file));
        for (const f of rows) { if (allOn) set.delete(f.file); else set.add(f.file); }
        await config.set(CHECKED_KEY, [...set]);
        renderList();
      },
    }, '全选/取消'),
    h('button', { class: 'btn btn--sm', title: '先从 PDF 正文抠 DOI / arXiv 号做精确匹配，抠不到再按标题搜', onclick: (e) => fillMissing(e.target) }, '自动识别元数据'),
    searchInput,
    statusFilterSelect,
    usefulnessFilterSelect,
    sortSelect,
    selectionLabel,
    clearBtn,
    exportBtn,
  );

  root.append(bar, overview, h('div', { class: 'lib__body' }, sideEl, listEl));

  async function refresh() {
    files = await lit.list();
    renderSide();
    renderList();
  }
  refresh();

  return { refresh };
}
