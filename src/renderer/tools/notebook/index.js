import { h, toast, debounce } from '../../core/ui.js';
import { LANGUAGES, guessLanguage } from './tokenize.js';
import { analyze, rankedSymbols, KIND_LABEL } from './analyze.js';
import { KnowledgeGraph, graphFacts, EDGE_LABEL } from './graph.js';
import { MODES, MODE_LIST, sliceLines, buildTaskPlan, buildTaskCheck } from './modes.js';
import { createFileTree } from './filetree.js';
import { renderCallGraph } from './callgraph.js';
import { htmlToMarkdown, markdownToHtml } from './markdown.js';

const MAX_CHARS = 400_000;
const escapeHtml = (text) => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default {
  id: 'notebook',
  title: '记事本',
  icon: 'search',
  hint: '代码分析 + Markdown 记事本，支持标题、加粗、表格和实时预览',

  create(root, ctx) {
    const { config, ai } = ctx;

    let snippets = config.get('notebook.snippets') || [];
    let currentId = config.get('notebook.currentId') || null;
    let analysis = null;
    let graph = null;
    let selected = null;      // 当前选中的符号名
    let hitIndex = 0;         // 在出现列表里的游标
    let editing = false;
    let editorMode = config.get('notebook.editorMode', 'code'); // code | markdown

    const current = () => snippets.find((s) => s.id === currentId) || snippets[0] || null;

    // ---------- 顶部栏 ----------
    const snippetSelect = h('select', { class: 'field field--sm nb__snippets', onchange: () => {
      currentId = snippetSelect.value;
      config.set('notebook.currentId', currentId);
      selected = null;
      loadCurrent();
    } });

    const langSelect = h('select', { class: 'field field--sm', onchange: () => {
      const snippet = current();
      if (!snippet) return;
      snippet.lang = langSelect.value;
      persist();
      reanalyze();
    } });
    for (const [id, meta] of Object.entries(LANGUAGES)) {
      langSelect.append(h('option', { value: id }, meta.label));
    }

    const symbolInput = h('input', {
      class: 'field nb__symbol-input',
      placeholder: '输入一个字段 / 函数名，高亮它的每一处',
      list: 'nb-symbols',
      oninput: debounce(() => selectSymbol(symbolInput.value.trim(), { fromInput: true }), 160),
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') { symbolInput.value = ''; selectSymbol(null); }
      },
    });
    const symbolList = h('datalist', { id: 'nb-symbols' });
    const hitCounter = h('span', { class: 'faint nb__counter' }, '');

    const graphButton = h('button', { class: 'btn btn--sm', onclick: () => openGraphPicker() }, '挂载图谱');

    // ---------- 主体 ----------
    const editor = h('textarea', {
      class: 'field nb__editor',
      placeholder: '把代码粘到这里。\n\n粘完自动分词高亮；然后点任意一个名字，或在上面输入框里打它，\n就能看到它在这段代码里的每一处出现，以及哪处是定义、哪处是调用。',
      oninput: debounce(() => {
        const snippet = current();
        if (!snippet) return;
        snippet.code = editor.value;
        if (!snippet.langLocked) {
          snippet.lang = guessLanguage(editor.value);
          langSelect.value = snippet.lang;
        }
        persist();
        reanalyze();
      }, 320),
      onkeydown: (e) => {
        // Tab 插入两个空格而不是把焦点丢出去 —— 写代码的基本功
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const { selectionStart: start, selectionEnd: end, value } = editor;
        editor.value = value.slice(0, start) + '  ' + value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
        editor.dispatchEvent(new Event('input'));
      },
    });

    const markdownEditor = h('textarea', { hidden: true });
    const markdownCanvas = h('article', {
      class: 'nb__markdown-canvas nb__markdown-preview',
      contenteditable: true,
      spellcheck: true,
      role: 'textbox',
      'aria-label': 'Markdown 记事本',
      oninput: debounce(() => {
        const snippet = current();
        if (!snippet) return;
        const source = htmlToMarkdown(markdownCanvas);
        markdownEditor.value = source;
        snippet.code = source;
        snippet.kind = 'markdown';
        snippet.at = Date.now();
        persist();
        renderSnippetOptions();
      }, 180),
      onkeydown: (event) => {
        if (event.key === ' ') {
          const selection = window.getSelection();
          const node = selection?.anchorNode?.nodeType === 3 ? selection.anchorNode.parentElement : selection?.anchorNode;
          const block = node?.closest?.('p,div');
          const shortcut = block?.textContent?.trim().match(/^(#{1,6}|[-*]|\d+[.)]|>)$/);
          if (block && shortcut && selection?.isCollapsed) {
            event.preventDefault();
            const marker = shortcut[1];
            block.textContent = '';
            if (/^#{1,6}$/.test(marker)) {
              const heading = document.createElement(`h${marker.length}`);
              block.replaceWith(heading);
              placeMarkdownCaret(heading);
            } else if (/^\d/.test(marker)) {
              document.execCommand('insertOrderedList');
            } else if (marker === '>') {
              document.execCommand('formatBlock', false, 'blockquote');
            } else {
              document.execCommand('insertUnorderedList');
            }
            markdownCanvas.dispatchEvent(new Event('input', { bubbles: true }));
            return;
          }
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          document.execCommand('insertText', false, '  ');
          return;
        }
        if (!(event.metaKey || event.ctrlKey)) return;
        if (/^[1-6]$/.test(event.key)) {
          event.preventDefault();
          document.execCommand('formatBlock', false, `h${event.key}`);
          markdownCanvas.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (event.key.toLowerCase() === 'b' || event.key.toLowerCase() === 'i') {
          event.preventDefault();
          document.execCommand(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
          markdownCanvas.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (event.key.toLowerCase() === 'k') {
          event.preventDefault();
          insertMarkdownLink();
        }
      },
    });

    function renderMarkdownPreview() {
      markdownCanvas.innerHTML = markdownToHtml(markdownEditor.value);
      for (const link of markdownCanvas.querySelectorAll('a[data-url]')) {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          window.toolbox.shell.openExternal(link.dataset.url);
        });
      }
    }

    function placeMarkdownCaret(element) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function markdownCommand(command, value) {
      markdownCanvas.focus();
      document.execCommand(command, false, value);
      markdownCanvas.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function insertInlineCode() {
      markdownCanvas.focus();
      const selection = window.getSelection();
      const text = selection?.toString() || '代码';
      document.execCommand('insertHTML', false, `<code>${escapeHtml(text)}</code>`);
      markdownCanvas.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function insertMarkdownLink() {
      markdownCanvas.focus();
      const url = window.prompt('链接地址', 'https://');
      if (!url || !/^https?:\/\//i.test(url.trim())) return;
      document.execCommand('createLink', false, url.trim());
      markdownCanvas.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function insertMarkdownTable() {
      markdownCanvas.focus();
      const html = '<table><thead><tr><th>列 1</th><th>列 2</th><th>列 3</th></tr></thead><tbody><tr><td>内容</td><td>内容</td><td>内容</td></tr></tbody></table><p><br></p>';
      document.execCommand('insertHTML', false, html);
      markdownCanvas.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function markdownToolbarButton(label, title, action) {
      return h('button', { class: 'btn btn--sm nb__md-tool', title, onclick: action }, label);
    }

    const markdownToolbar = h('div', { class: 'nb__markdown-toolbar' },
      markdownToolbarButton('H1', '一级标题（⌘1）', () => markdownCommand('formatBlock', 'h1')),
      markdownToolbarButton('H2', '二级标题（⌘2）', () => markdownCommand('formatBlock', 'h2')),
      markdownToolbarButton('H3', '三级标题（⌘3）', () => markdownCommand('formatBlock', 'h3')),
      markdownToolbarButton('H4', '四级标题（⌘4）', () => markdownCommand('formatBlock', 'h4')),
      markdownToolbarButton('H5', '五级标题（⌘5）', () => markdownCommand('formatBlock', 'h5')),
      markdownToolbarButton('H6', '六级标题（⌘6）', () => markdownCommand('formatBlock', 'h6')),
      h('span', { class: 'subbar__sep' }),
      markdownToolbarButton('B', '加粗（⌘B）', () => markdownCommand('bold')),
      markdownToolbarButton('I', '斜体（⌘I）', () => markdownCommand('italic')),
      markdownToolbarButton('` code `', '行内代码', insertInlineCode),
      markdownToolbarButton('链接', '插入链接（⌘K）', insertMarkdownLink),
      h('span', { class: 'subbar__sep' }),
      markdownToolbarButton('• 列表', '插入无序列表', () => markdownCommand('insertUnorderedList')),
      markdownToolbarButton('1. 列表', '插入有序列表', () => markdownCommand('insertOrderedList')),
      markdownToolbarButton('引用', '插入引用', () => markdownCommand('formatBlock', 'blockquote')),
      markdownToolbarButton('表格', '插入三列表格', insertMarkdownTable),
      h('span', { class: 'faint nb__md-hint' }, '⌘1–⌘6 标题 · ⌘B 加粗 · ⌘K 链接'),
    );
    const markdownShell = h('div', { class: 'nb__markdown-shell', hidden: true },
      markdownToolbar,
      markdownCanvas,
    );

    const codeView = h('div', { class: 'nb__code' });
    codeView.addEventListener('click', (event) => {
      const target = event.target.closest('.tok--ident');
      if (!target) return;
      symbolInput.value = target.dataset.name;
      selectSymbol(target.dataset.name);
    });

    const outline = h('div', { class: 'nb__outline' });
    const detail = h('div', { class: 'nb__detail' });

    // ---------- 栏宽：可拖拽，窗口变窄自动收缩 ----------
    const PANE_DEFAULTS = { side: 210, detail: 330 };
    const PANE_COLLAPSED = { side: 28, detail: 28 };  // 拖过头先收成窄条，双击分隔条还原
    const MAIN_MIN = 300;
    let paneWidths = {
      side: config.get('notebook.sideWidth', PANE_DEFAULTS.side),
      detail: config.get('notebook.detailWidth', PANE_DEFAULTS.detail),
    };

    // ---------- 文件树：打开项目，懒加载 ----------
    const tree = createFileTree({
      onOpenFile: ({ code, relPath, name, ext, root: fileRoot }) => {
        const snippet = newSnippet(code, name);
        snippet.origin = { root: fileRoot, relPath };
        snippet.langLocked = false;
        persist();
        loadCurrent();
        toast(`已读入 ${relPath}`, 'good');
      },
    });

    let sideTab = 'outline';
    const sideBody = h('div', { class: 'nb__side-body' });
    const sideTabs = h('div', { class: 'nb__side-tabs' });
    for (const [id, label] of [['files', '文件'], ['outline', '大纲']]) {
      sideTabs.append(h('button', {
        class: 'nb__side-tab', dataset: { tab: id },
        onclick: () => { sideTab = id; syncSideTab(); },
      }, label));
    }
    function syncSideTab() {
      for (const button of sideTabs.children) {
        button.classList.toggle('is-active', button.dataset.tab === sideTab);
      }
      sideBody.textContent = '';
      sideBody.append(sideTab === 'files' ? tree.el : outline);
      if (sideTab === 'files' && !tree.root) {
        sideBody.append(h('div', { class: 'nb__tree-empty' },
          h('div', { class: 'faint nb__hint' },
            '打开一个项目文件夹。只列一层目录、点开哪个文件才读哪个，几万文件的仓库也不会卡。'),
          h('button', { class: 'btn btn--sm btn--primary', onclick: () => openFolder() }, '打开文件夹'),
        ));
      }
    }

    async function openFolder() {
      const picked = await window.toolbox.notebook.pickFolder();
      if (!picked) return;
      await tree.open(picked.root);
      await config.set('notebook.folderRoot', picked.root);
      sideTab = 'files';
      syncSideTab();
      // 这个项目跑过 /understand 的话，顺手把图谱也挂上 —— 两件事本来就该一起用
      if (picked.hasGraph && (!graph || graph.root !== picked.root)) {
        await mountGraph(picked.root);
      } else if (!picked.hasGraph) {
        toast(`${picked.name} 没跑过 /understand，跨文件调用关系用不了`, 'info');
      }
    }

    // ---------- 片段管理 ----------
    function persist() {
      config.set('notebook.snippets', snippets);
    }

    function newSnippet(code = '', title = '') {
      const snippet = {
        id: `s_${Date.now().toString(36)}`,
        title: title || `片段 ${snippets.length + 1}`,
        lang: code ? guessLanguage(code) : 'python',
        code,
        kind: editorMode,
        at: Date.now(),
      };
      snippets = [snippet, ...snippets].slice(0, 60);
      currentId = snippet.id;
      config.set('notebook.currentId', currentId);
      persist();
      selected = null;
      loadCurrent();
      return snippet;
    }

    function renderSnippetOptions() {
      snippetSelect.textContent = '';
      for (const snippet of snippets) {
        const lines = snippet.code ? snippet.code.split('\n').length : 0;
        snippetSelect.append(h('option', { value: snippet.id },
          `${snippet.title}（${lines} 行）`));
      }
      if (current()) snippetSelect.value = current().id;
    }

    function loadCurrent() {
      const snippet = current();
      renderSnippetOptions();
      if (!snippet) {
        editing = true;
        editor.value = '';
        setMode();
        analysis = null;
        renderOutline();
        renderDetail();
        return;
      }
      langSelect.value = snippet.lang || 'python';
      editor.value = snippet.code || '';
      markdownEditor.value = snippet.code || '';
      editing = !snippet.code;
      renderMarkdownPreview();
      reanalyze();
    }

    function setMode() {
      const markdown = editorMode === 'markdown';
      editor.hidden = markdown || !editing;
      codeView.hidden = markdown || editing;
      editToggle.textContent = editing ? '✓ 完成，去阅读' : '✎ 编辑';
      editToggle.classList.toggle('btn--primary', editing);
    }

    const editToggle = h('button', {
      class: 'btn btn--sm',
      title: '切换编辑 / 阅读（⌘E）',
      onclick: () => {
        editing = !editing;
        if (!editing) {
          reanalyze();
          maybeAutoVerify();   // 任务模式：这次编辑里做完的步骤，AI 自动核验打钩
        }
        setMode();
        if (editing) editor.focus();
      },
    }, '编辑');

    const noteModeToggle = h('button', {
      class: 'btn btn--sm nb__mode-toggle',
      title: '切换到 Markdown 记事本模式',
      onclick: () => setEditorMode(editorMode === 'markdown' ? 'code' : 'markdown'),
    }, 'Markdown');

    function setEditorMode(next) {
      editorMode = next === 'markdown' ? 'markdown' : 'code';
      config.set('notebook.editorMode', editorMode);
      const snippet = current();
      if (snippet) {
        snippet.kind = editorMode;
        if (editorMode === 'markdown') markdownEditor.value = snippet.code || '';
        else editor.value = snippet.code || '';
        persist();
      }
      syncEditorMode();
      if (editorMode === 'markdown') renderMarkdownPreview();
      else reanalyze();
    }

    function syncEditorMode() {
      const markdown = editorMode === 'markdown';
      noteModeToggle.textContent = markdown ? '代码' : 'Markdown';
      noteModeToggle.title = markdown ? '切换到代码分析模式' : '切换到 Markdown 记事本模式';
      noteModeToggle.classList.toggle('btn--primary', markdown);
      markdownShell.hidden = !markdown;
      codeControls.hidden = markdown;
      sideEl.hidden = markdown;
      splitSide.hidden = markdown;
      splitDetail.hidden = markdown;
      detailEl.hidden = markdown;
      if (markdown) tasksPanel.hidden = true;
      mainEl.classList.toggle('nb__main--markdown', markdown);
    }

    // ---------- 任务模式：建目标 → 拆步骤 → 做完一步 AI 核验打钩 ----------
    //
    // 任务是全局的（跟着工具箱走，不跟着片段），因为要做的改动往往跨好几个片段。
    // 拆解和核验都只依赖"当前片段的代码"作为事实来源，遵循 modes.js 的预算铁律。

    const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const langLabel = () => {
      const snippet = current();
      return snippet ? (LANGUAGES[snippet.lang]?.label || snippet.lang) : '';
    };

    let tasks = config.get('notebook.tasks') || [];
    let openTaskId = config.get('notebook.openTaskId') || null;

    const tasksPanel = h('div', { class: 'nb__tasks', hidden: true });
    const taskToggle = h('button', {
      class: 'btn btn--sm',
      onclick: () => {
        tasksPanel.hidden = !tasksPanel.hidden;
        taskToggle.classList.toggle('btn--primary', !tasksPanel.hidden);
        if (!tasksPanel.hidden) renderTasks();
      },
    }, '☑ 任务');

    function persistTasks() {
      config.set('notebook.tasks', tasks);
    }

    function renderTasks() {
      tasksPanel.textContent = '';
      const addInput = h('input', {
        class: 'field field--sm nb__task-add',
        placeholder: '要做什么？回车建成任务，比如「给 user 表加一个 nickname 字段」',
        onkeydown: (e) => {
          if (e.key !== 'Enter' || e.isComposing || !addInput.value.trim()) return;
          const task = { id: uid('t'), title: addInput.value.trim(), steps: [], aiBusy: false };
          tasks = [task, ...tasks].slice(0, 30);
          openTaskId = task.id;
          addInput.value = '';
          persistTasks();
          renderTasks();
        },
      });
      tasksPanel.append(
        h('div', { class: 'nb__tasks-head' },
          h('span', { class: 'nb__tasks-title' }, '任务'),
          h('span', { class: 'faint nb__tasks-hint' }, '建目标 → AI 或手动拆步骤 → 完成一轮编辑（点「✓ 完成」）自动核验打钩'),
          addInput,
        ),
      );
      if (!tasks.length) {
        tasksPanel.append(h('div', { class: 'faint nb__hint' },
          '还没有任务。在上面输入框写下要做的改动，回车建成；展开后让 AI 拆成步骤，或自己手动加。'));
        return;
      }
      for (const task of tasks) tasksPanel.append(renderTask(task));
    }

    function renderTask(task) {
      const open = task.id === openTaskId;
      const allDone = task.steps.length > 0 && task.steps.every((s) => s.done);
      let stepsBox = null;

      if (open) {
        stepsBox = h('div', { class: 'nb__task-steps' });
        task.steps.forEach((step, i) => stepsBox.append(renderStep(task, step, i)));
        if (!task.steps.length) {
          stepsBox.append(h('div', { class: 'faint nb__hint' }, '还没有步骤。点「AI 拆解」，或在下面手动加一步。'));
        }
        const stepInput = h('input', {
          class: 'field field--sm nb__step-add',
          placeholder: '手动加一步，回车确认',
          onkeydown: (e) => {
            if (e.key !== 'Enter' || e.isComposing || !stepInput.value.trim()) return;
            task.steps.push({ id: uid('s'), text: stepInput.value.trim(), done: false });
            persistTasks();
            renderTasks();
          },
        });
        stepsBox.append(
          h('div', { class: 'nb__task-actions' },
            h('button', {
              class: 'btn btn--sm',
              disabled: task.aiBusy || null,
              onclick: () => aiPlan(task),
            }, task.aiBusy ? '拆解中…' : '✨ AI 拆解'),
            stepInput,
          ),
        );
      }

      return h('div', { class: 'nb__task' },
        h('div', { class: 'nb__task-head' },
          h('button', {
            class: 'nb__task-fold',
            title: open ? '收起' : '展开',
            onclick: () => {
              openTaskId = open ? null : task.id;
              config.set('notebook.openTaskId', openTaskId);
              renderTasks();
            },
          }, open ? '▾' : '▸'),
          h('span', { class: `nb__task-title${allDone ? ' is-done' : ''}` }, task.title),
          h('span', { class: 'faint mono nb__task-progress' },
            `${task.steps.filter((s) => s.done).length}/${task.steps.length}`),
          h('button', {
            class: 'btn btn--icon',
            title: '删除任务',
            onclick: () => {
              tasks = tasks.filter((t) => t.id !== task.id);
              if (openTaskId === task.id) openTaskId = null;
              persistTasks();
              renderTasks();
            },
          }, '×'),
        ),
        stepsBox,
      );
    }

    function renderStep(task, step, index) {
      return h('div', { class: `nb__step${step.done ? ' is-done' : ''}` },
        h('input', {
          type: 'checkbox',
          class: 'nb__step-box',
          checked: step.done || null,
          onchange: (e) => { step.done = e.target.checked; persistTasks(); renderTasks(); },
        }),
        h('span', { class: 'faint mono nb__step-no' }, `${index + 1}`),
        h('span', { class: 'nb__step-text' }, step.text),
        step.note ? h('span', { class: `faint nb__step-note${step.done ? '' : ' nb__step-note--warn'}` }, step.note) : null,
        h('button', {
          class: 'btn btn--sm nb__step-check',
          disabled: step.busy || null,
          title: '让 AI 对照当前代码核验这一步，通过就自动打钩',
          onclick: () => aiCheckStep(step),
        }, step.busy ? '核验中…' : '🔍 核验'),
      );
    }

    /** AI 拆解：目标 → 3–6 步 */
    async function aiPlan(task) {
      task.aiBusy = true;
      renderTasks();
      try {
        const result = await ai.json(buildTaskPlan({
          goal: task.title,
          lang: langLabel(),
          code: current()?.code || '',
        }), { timeout: 120000 });
        const steps = (Array.isArray(result.steps) ? result.steps : [])
          .map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
        if (!steps.length) {
          toast('AI 没拆出可用的步骤，把目标描述得更具体一点再试', 'bad');
          return;
        }
        task.steps = steps.map((text) => ({ id: uid('s'), text, done: false }));
        openTaskId = task.id;
        config.set('notebook.openTaskId', openTaskId);
        toast(`拆成了 ${steps.length} 步，做完一步点「核验」让 AI 打钩`, 'good');
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        task.aiBusy = false;
        persistTasks();
        renderTasks();
      }
    }

    /** AI 核验：对照当前片段的代码判断这一步做没做，做了就自动打钩 */
    async function aiCheckStep(step) {
      step.busy = true;
      step.note = '';
      renderTasks();
      try {
        const result = await ai.json(buildTaskCheck({
          step: step.text,
          lang: langLabel(),
          code: current()?.code || '',
        }), { timeout: 120000 });
        step.done = !!result.done;
        step.note = String(result.note || '').slice(0, 80) || (step.done ? '完成' : '还没完成');
        toast(step.done ? `✓ 已打钩：${step.note}` : `还没完成：${step.note}`, step.done ? 'good' : 'info');
      } catch (err) {
        step.note = err.message.slice(0, 80);
        toast(err.message, 'bad');
      } finally {
        step.busy = false;
        persistTasks();
        renderTasks();
      }
    }

    /**
     * 任务模式的自动核验：面板开着（= 任务模式），用户每次完成一轮编辑退出时，
     * 对当前展开任务的未完成步骤逐条核验。做完了的自动打钩，没做的给出缺什么。
     */
    let verifying = false;

    async function maybeAutoVerify() {
      if (tasksPanel.hidden || verifying) return;
      const snippet = current();
      if (!snippet?.code || snippet.code.length > MAX_CHARS) return;
      const task = tasks.find((t) => t.id === openTaskId);
      if (!task) return;
      const pending = task.steps.filter((s) => !s.done && !s.busy);
      if (!pending.length) return;

      verifying = true;
      toast(`任务模式：核验 ${pending.length} 个未完成步骤…`, 'info');
      try {
        for (const step of pending) {
          await aiCheckStep(step);   // 内部自带渲染/持久化/失败兜底，单步失败不中断整轮
        }
        if (task.steps.length && task.steps.every((s) => s.done)) {
          toast(`「${task.title}」全部完成 🎉`, 'good');
        }
      } finally {
        verifying = false;
      }
    }

    // ---------- 分析与渲染 ----------
    function reanalyze() {
      const snippet = current();
      if (!snippet || !snippet.code) {
        analysis = null;
        editing = true;
        setMode();
        renderOutline();
        renderDetail();
        return;
      }
      if (snippet.code.length > MAX_CHARS) {
        toast(`这段有 ${(snippet.code.length / 1024).toFixed(0)}KB，超过 ${MAX_CHARS / 1024}KB 就不分析了，先拆小一点。`, 'bad');
        return;
      }
      analysis = analyze(snippet.code, snippet.lang || 'python');

      // 还叫「片段 N」的话，用第一个定义名当标题，回头在下拉里好认
      if (/^片段 \d+$/.test(snippet.title) && analysis.outline.length) {
        snippet.title = analysis.outline[0].name;
        persist();
      }
      renderSnippetOptions();   // 行数会变，标题也可能刚改过

      // 保持用户当前的编辑/阅读状态，只刷新内容；切换由 editToggle 控制
      setMode();
      renderCode();
      renderOutline();
      renderSymbolList();
      if (selected) selectSymbol(selected, { keepInput: true });
      else renderDetail();
    }

    function renderCode() {
      if (!analysis) { codeView.innerHTML = ''; return; }
      const width = String(analysis.lineCount).length;
      const html = analysis.lines.map((tokens, index) => {
        const no = String(index + 1).padStart(width, ' ');
        const body = tokens.map((token) => {
          const text = escapeHtml(token.value);
          if (token.type === 'ident') {
            return `<span class="tok tok--ident" data-name="${escapeHtml(token.value)}" data-kind="${token.kind || 'ref'}">${text}</span>`;
          }
          if (token.type === 'space') return text;
          return `<span class="tok tok--${token.type}">${text}</span>`;
        }).join('');
        return `<div class="nb__line" data-line="${index + 1}"><span class="nb__ln">${no}</span><span class="nb__src">${body || ' '}</span></div>`;
      }).join('');
      codeView.innerHTML = html;
    }

    function renderSymbolList() {
      symbolList.textContent = '';
      if (!analysis) return;
      for (const entry of rankedSymbols(analysis).slice(0, 400)) {
        symbolList.append(h('option', { value: entry.name }));
      }
    }

    function renderOutline() {
      outline.textContent = '';
      if (!analysis || !analysis.outline.length) {
        outline.append(h('div', { class: 'faint nb__hint' },
          analysis ? '这段里没识别出定义（可能是一段调用代码）。' : '还没有内容。'));
        return;
      }
      outline.append(h('div', { class: 'nb__side-head faint' }, `本片段定义了 ${analysis.outline.length} 个`));
      for (const item of analysis.outline) {
        outline.append(h('button', {
          class: 'nb__outline-item',
          onclick: () => { symbolInput.value = item.name; selectSymbol(item.name); },
        },
          h('span', { class: 'nb__outline-kw' }, item.keyword),
          h('span', { class: 'nb__outline-name' }, item.name),
          h('span', { class: 'faint nb__outline-line' }, `L${item.line}`),
        ));
      }
    }

    // ---------- 选中一个符号 ----------
    function selectSymbol(name, { keepInput = false, fromInput = false } = {}) {
      selected = name || null;
      hitIndex = 0;
      if (!keepInput && !fromInput) symbolInput.value = name || '';

      for (const node of codeView.querySelectorAll('.is-hit, .is-current')) {
        node.classList.remove('is-hit', 'is-current');
      }
      if (!name || !analysis) {
        hitCounter.textContent = '';
        renderDetail();
        return;
      }

      const hits = codeView.querySelectorAll(`.tok--ident[data-name="${CSS.escape(name)}"]`);
      hits.forEach((node) => node.classList.add('is-hit'));
      updateCounter(hits.length);
      if (hits.length) markCurrent(hits, 0, { scroll: !fromInput });
      renderDetail();
    }

    function updateCounter(total) {
      hitCounter.textContent = total ? `${Math.min(hitIndex + 1, total)} / ${total}` : '没找到';
    }

    function markCurrent(hits, index, { scroll = true } = {}) {
      hits.forEach((node) => node.classList.remove('is-current'));
      const node = hits[index];
      if (!node) return;
      node.classList.add('is-current');
      if (scroll) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      updateCounter(hits.length);
    }

    function step(direction) {
      if (!selected) return;
      const hits = codeView.querySelectorAll(`.tok--ident[data-name="${CSS.escape(selected)}"]`);
      if (!hits.length) return;
      hitIndex = (hitIndex + direction + hits.length) % hits.length;
      markCurrent(hits, hitIndex);
    }

    function jumpToLine(line) {
      const node = codeView.querySelector(`.nb__line[data-line="${line}"]`);
      if (!node) return;
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node.classList.add('is-flash');
      setTimeout(() => node.classList.remove('is-flash'), 900);
    }

    // ---------- 右侧详情 ----------
    function renderDetail() {
      detail.textContent = '';

      if (!selected || !analysis) {
        detail.append(h('div', { class: 'empty' },
          h('span', { class: 'empty__icon' }, '🔍'),
          '点代码里任意一个名字，或在上面输入框打一个字段名。',
          h('br'),
          h('span', { class: 'faint' },
            '会告诉你它在这段里出现几次、哪次是定义、哪次是调用。挂上知识图谱后还能看到整个项目里谁调用了它。'),
        ));
        return;
      }

      const entry = analysis.symbols.get(selected);
      const occurrences = entry ? entry.occurrences : [];

      detail.append(
        h('div', { class: 'nb__detail-head' },
          h('code', { class: 'nb__detail-name' }, selected),
          h('span', { class: 'faint' }, `本片段出现 ${occurrences.length} 次`),
        ),
      );

      // 本片段：按角色分组
      const grouped = new Map();
      for (const occurrence of occurrences) {
        if (!grouped.has(occurrence.kind)) grouped.set(occurrence.kind, []);
        grouped.get(occurrence.kind).push(occurrence);
      }
      const order = ['def', 'param', 'call', 'member', 'bind', 'ref'];
      const groupNodes = order.filter((kind) => grouped.has(kind)).map((kind) => h('div', { class: 'nb__group' },
        h('div', { class: `nb__group-head nb__group-head--${kind}` },
          KIND_LABEL[kind], h('span', { class: 'faint' }, ` ${grouped.get(kind).length}`)),
        h('div', { class: 'nb__group-lines' },
          ...grouped.get(kind).map((occurrence) => h('button', {
            class: 'nb__jump',
            onclick: () => jumpToLine(occurrence.line),
          }, `L${occurrence.line}`)),
        ),
      ));

      detail.append(h('section', { class: 'nb__section' },
        h('h4', { class: 'nb__section-title' }, '在这段代码里'),
        ...(groupNodes.length ? groupNodes : [h('div', { class: 'faint nb__hint' }, '没有出现。')]),
        !grouped.has('def') && !grouped.has('param')
          ? h('div', { class: 'nb__warn' },
              '这段里只有调用、没有定义 —— 它的定义在别处。挂上知识图谱就能跨文件找到。')
          : null,
      ));

      renderGraphSection(selected);
      renderAiSection(selected);
    }

    function renderGraphSection(name) {
      const section = h('section', { class: 'nb__section' },
        h('h4', { class: 'nb__section-title' }, '在整个项目里'));

      if (!graph) {
        section.append(
          h('div', { class: 'faint nb__hint' },
            '还没挂知识图谱。挂上之后，这里会显示这个符号定义在哪个文件、被项目里哪些函数调用。'),
          h('button', { class: 'btn btn--sm', onclick: () => openGraphPicker() }, '挂载图谱'),
        );
        detail.append(section);
        return;
      }

      const hits = graph.lookup(name);
      if (!hits.length) {
        section.append(h('div', { class: 'faint nb__hint' },
          `图谱（${graph.project}）里没有叫 ${name} 的节点。可能是局部变量，也可能图谱该更新了。`));
        detail.append(section);
        return;
      }

      for (const node of hits.slice(0, 4)) {
        const callers = graph.callers(node.id);
        const callees = graph.callees(node.id);
        const container = graph.container(node.id);

        section.append(h('div', { class: 'nb__gnode' },
          h('div', { class: 'nb__gnode-head' },
            h('span', { class: 'tag' }, node.type),
            h('code', {}, node.name),
            node.complexity ? h('span', { class: 'faint' }, node.complexity) : null,
          ),
          node.filePath ? h('button', {
            class: 'nb__gpath',
            title: '读取这段真实源码',
            onclick: () => openSource(node),
          }, `${node.filePath}${node.lineRange ? `:${node.lineRange[0]}-${node.lineRange[1]}` : ''}`) : null,
          node.summary ? h('p', { class: 'nb__gsummary' }, node.summary) : null,

          h('div', { class: 'nb__grel' },
            h('div', { class: 'nb__grel-title' }, `被调用（${callers.length}）`),
            callers.length
              ? h('div', { class: 'nb__grel-list' }, ...callers.map(({ node: caller }) => h('button', {
                  class: 'nb__grel-item',
                  title: caller.filePath || '',
                  onclick: () => openSource(caller),
                }, caller.name, h('span', { class: 'faint' }, shortPath(caller.filePath)))))
              : h('div', { class: 'faint nb__hint' }, '图谱里没有记录调用它的地方。'),
          ),
          callees.length ? h('div', { class: 'nb__grel' },
            h('div', { class: 'nb__grel-title' }, `它调用了（${callees.length}）`),
            h('div', { class: 'nb__grel-list' }, ...callees.map(({ node: callee }) => h('button', {
              class: 'nb__grel-item',
              onclick: () => openSource(callee),
            }, callee.name, h('span', { class: 'faint' }, shortPath(callee.filePath))))),
          ) : null,
          container ? h('div', { class: 'faint nb__hint' }, `属于 ${container.name}`) : null,
          h('button', {
            class: 'btn btn--sm',
            onclick: () => openCallGraph(node),
          }, '看调用关系图'),
        ));
      }

      detail.append(section);
    }

    const shortPath = (filePath) => (filePath ? ` ${filePath.split('/').slice(-1)[0]}` : '');

    /** 从图谱节点回读真实源码，存成一个新片段 —— 这就是「跳到调用处」 */
    async function openSource(node) {
      if (!graph || !node.filePath) return toast('这个节点没有文件路径', 'info');
      const result = await window.toolbox.notebook.readSource({
        root: graph.root,
        filePath: node.filePath,
        lineRange: node.lineRange,
        context: 4,
      });
      if (!result.ok) return toast(result.error, 'bad');

      const snippet = newSnippet(result.code, `${node.name} · ${node.filePath.split('/').slice(-1)[0]}`);
      snippet.origin = { filePath: result.filePath, startLine: result.startLine };
      persist();
      toast(`已读入 ${result.filePath} 第 ${result.startLine}-${result.endLine} 行`, 'good');
    }

    // ---------- AI 解释：模式化输出 ----------
    //
    // 这一段的设计目标不是"讲得全"，是"讲的量刚好能当场吸收"。
    // 每个模式有硬预算，想要更深是**下一次请求**——没点开的内容根本不生成。

    let mode = config.get('notebook.mode', 'follow');
    const coveredBySnippet = new Map();   // 讲过的要点，避免第二次问时重复

    const aiBox = h('div', { class: 'nb__ai' });
    const questionInput = h('input', {
      class: 'field field--sm nb__question',
      placeholder: '你具体卡在哪？',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) runExplain({ symbol: selected }); },
    });
    const modeBar = h('div', { class: 'nb__modes' });
    const modeHint = h('div', { class: 'faint nb__mode-hint' }, '');

    function syncModes() {
      for (const button of modeBar.children) {
        button.classList.toggle('is-active', button.dataset.mode === mode);
      }
      const meta = MODES[mode];
      modeHint.textContent = `${meta.hint}　·　预算 ${meta.budget}`;
      questionInput.hidden = !meta.needsQuestion;
    }

    for (const meta of MODE_LIST) {
      modeBar.append(h('button', {
        class: 'nb__mode',
        dataset: { mode: meta.id },
        title: `${meta.hint}（${meta.budget}）`,
        onclick: () => { mode = meta.id; config.set('notebook.mode', mode); syncModes(); },
      }, meta.label));
    }

    function renderAiSection(name) {
      syncModes();
      detail.append(h('section', { class: 'nb__section' },
        h('h4', { class: 'nb__section-title' }, 'AI 解释'),
        modeBar,
        modeHint,
        questionInput,
        h('div', { class: 'nb__ai-actions' },
          h('button', {
            class: 'btn btn--sm btn--primary',
            onclick: () => runExplain({ symbol: name }),
          }, name ? `讲 ${name}` : '讲这段'),
          name ? h('button', {
            class: 'btn btn--sm',
            onclick: () => runExplain({ symbol: null }),
          }, '讲整段') : null,
        ),
        aiBox,
      ));
    }

    /** 攒起来的"已经讲过"，下次请求时告诉模型别重复 */
    function coveredList() {
      const id = current()?.id;
      return id ? (coveredBySnippet.get(id) || []) : [];
    }

    function remember(items) {
      const id = current()?.id;
      if (!id) return;
      const list = coveredBySnippet.get(id) || [];
      coveredBySnippet.set(id, [...items.filter(Boolean), ...list].slice(0, 8));
    }

    /**
     * @param code  只在"框架模式点开某一块"时传：那时只发那几行，不重发整段
     * @param scope 告诉模型这次只看哪个范围
     */
    async function runExplain({ symbol, code = null, scope = null, forceMode = null } = {}) {
      const snippet = current();
      if (!snippet?.code) return toast('先粘点代码', 'info');

      const useMode = forceMode || mode;
      const meta = MODES[useMode];
      if (meta.needsQuestion && !questionInput.value.trim()) {
        questionInput.focus();
        return toast('追问模式要先写下你的问题', 'info');
      }

      aiBox.textContent = '';
      aiBox.append(h('div', { class: 'faint' },
        h('span', { class: 'spinner' }), ` ${meta.label}模式 · ${meta.budget}…`));

      // 静态分析和图谱的结论作为既定事实喂进去，模型只负责解释、不负责推测调用关系
      let staticFacts = '';
      if (symbol && analysis?.symbols.has(symbol)) {
        const entry = analysis.symbols.get(symbol);
        const parts = Object.entries(entry.counts).map(([kind, count]) => {
          const lines = entry.occurrences.filter((o) => o.kind === kind).map((o) => o.line).join('、');
          return `${KIND_LABEL[kind]} ${count} 处（第 ${lines} 行）`;
        });
        staticFacts = `词法分析：符号 ${symbol} 在这段里出现 ${entry.occurrences.length} 次 —— ${parts.join('；')}。`;
      }
      const node = symbol && graph ? graph.lookup(symbol)[0] : null;

      try {
        const result = await ai.json(meta.build({
          code: code || snippet.code,
          lang: LANGUAGES[snippet.lang]?.label || snippet.lang,
          symbol,
          scope,
          question: questionInput.value.trim(),
          staticFacts,
          graphFacts: node ? graphFacts(graph, node) : '',
          covered: coveredList(),
        }), { timeout: 120000 });
        renderAiResult(useMode, result, snippet);
      } catch (err) {
        aiBox.textContent = '';
        aiBox.append(
          h('div', { class: 'faint' }, err.message),
          err.code === 'need-login'
            ? h('button', { class: 'btn btn--sm', style: { marginTop: '8px' }, onclick: () => ctx.goto('ask') }, '去登录 DeepSeek')
            : null,
        );
      }
    }

    function renderAiResult(usedMode, result, snippet) {
      aiBox.textContent = '';
      const row = (label, value) => (value
        ? h('div', { class: 'nb__ai-row' }, h('span', { class: 'nb__ai-label' }, label), h('span', {}, value))
        : null);

      if (usedMode === 'follow') {
        aiBox.append(
          row('做什么', result.what),
          row('写法', result.key),
          row('为什么', result.why),
          row('记住', result.remember),
        );
        remember([result.key]);
        return;
      }

      if (usedMode === 'frame') {
        const blocks = Array.isArray(result.blocks) ? result.blocks : [];
        aiBox.append(
          result.shape ? h('div', { class: 'nb__ai-shape' }, result.shape) : null,
          h('div', { class: 'nb__blocks' }, ...blocks.map((block) => h('div', { class: 'nb__block' },
            h('button', {
              class: 'nb__block-jump',
              title: '跳到这几行',
              onclick: () => {
                const range = sliceLines(snippet.code, block.lines);
                if (range) jumpToLine(range.startLine);
              },
            }, `L${block.lines}`),
            h('div', { class: 'nb__block-body' },
              h('div', { class: 'nb__block-title' }, block.title || ''),
              h('div', { class: 'faint' }, block.does || ''),
            ),
            // 概括 → 细则：点了才生成，而且只把这几行发过去
            h('button', {
              class: 'btn btn--sm btn--ghost nb__block-more',
              onclick: () => {
                const range = sliceLines(snippet.code, block.lines);
                if (!range) return toast('这一块的行号没给准，没法单独讲', 'bad');
                jumpToLine(range.startLine);
                runExplain({
                  symbol: null,
                  code: range.code,
                  scope: `原文第 ${range.startLine}-${range.endLine} 行：${block.title || ''}`,
                  forceMode: 'follow',
                });
              },
            }, '讲这块'),
          ))),
          result.flow ? h('div', { class: 'nb__ai-flow' },
            h('span', { class: 'nb__ai-label' }, '怎么流'), h('span', {}, result.flow)) : null,
        );
        remember(blocks.map((b) => b.title));
        return;
      }

      if (usedMode === 'expert') {
        const points = Array.isArray(result.points) ? result.points : [];
        aiBox.append(
          ...points.map((point) => h('div', { class: 'nb__point' },
            h('div', { class: 'nb__point-head' },
              h('button', {
                class: 'nb__jump',
                onclick: () => {
                  const line = Number(String(point.at || '').replace(/\D/g, ''));
                  if (line) jumpToLine(line);
                },
              }, point.at || '?'),
              point.kind ? h('span', { class: 'tag tag--warn' }, point.kind) : null,
            ),
            h('div', {}, point.point || ''),
          )),
          result.skipped ? h('div', { class: 'faint nb__skipped' }, `跳过了：${result.skipped}`) : null,
        );
        remember(points.map((p) => p.point));
        return;
      }

      // ask
      aiBox.append(
        h('div', { class: 'nb__answer' }, result.answer || ''),
        result.basis ? h('div', { class: 'faint nb__ai-row' },
          h('span', { class: 'nb__ai-label' }, '依据'), h('span', {}, result.basis)) : null,
        result.unsure ? h('div', { class: 'nb__warn' }, result.unsure) : null,
      );
      remember([questionInput.value.trim()]);
    }

    /** 调用关系图浮层：点节点可以重新居中，一跳一跳走调用链 */
    function openCallGraph(startNode) {
      let node = startNode;
      const body = h('div', { class: 'nb__cg-body' });
      const overlay = h('div', { class: 'nb__picker' },
        h('div', { class: 'nb__picker-card nb__picker-card--wide' },
          h('div', { class: 'nb__cg-head' },
            h('h3', { class: 'card__title' }, '调用关系图'),
            h('span', { style: { flex: 1 } }),
            h('button', { class: 'btn btn--sm btn--ghost', onclick: () => overlay.remove() }, '关闭'),
          ),
          body,
        ),
      );
      function draw() {
        body.textContent = '';
        body.append(renderCallGraph(graph, node, {
          onFocus: (next) => { node = next; draw(); },
          onOpenSource: (target) => { overlay.remove(); openSource(target); },
        }));
      }
      draw();
      root.append(overlay);
    }

    // ---------- 图谱挂载 ----------
    const graphLabel = h('span', { class: 'faint nb__graph-label' }, '未挂载图谱');

    async function mountGraph(rootPath) {
      const result = await window.toolbox.notebook.loadGraph(rootPath);
      if (!result.ok) return toast(result.error, 'bad');
      graph = new KnowledgeGraph(result.graph);
      config.set('notebook.graphRoot', rootPath);
      const stats = graph.stats;
      graphLabel.textContent = `${graph.project} · ${stats.nodes} 节点 / ${stats.calls} 条调用`;
      graphLabel.title = graph.description || graph.root;
      graphButton.textContent = '换图谱';
      toast(`已挂载 ${graph.project}：${stats.nodes} 个节点，${stats.calls} 条调用关系`, 'good');
      if (selected) renderDetail();
    }

    async function openGraphPicker() {
      const found = await window.toolbox.notebook.findGraphs();
      const list = h('div', { class: 'nb__graph-list' });

      if (found.length) {
        for (const item of found) {
          list.append(h('button', {
            class: 'nb__graph-item',
            onclick: () => { picker.remove(); mountGraph(item.root); },
          },
            h('div', { class: 'nb__graph-name' }, item.name),
            h('div', { class: 'faint mono nb__graph-path' }, item.root),
          ));
        }
      } else {
        list.append(h('div', { class: 'faint nb__hint' },
          '本机没扫到跑过 /understand 的项目。到项目目录里跑一次 Understand-Anything 的 /understand，就会生成 .ua/knowledge-graph.json。'));
      }

      const picker = h('div', { class: 'nb__picker' },
        h('div', { class: 'nb__picker-card' },
          h('h3', { class: 'card__title' }, '挂载知识图谱'),
          h('p', { class: 'faint nb__hint' },
            '挂上以后，你粘贴的代码里的符号可以跨文件查到定义和调用处 —— 数据来自 Understand-Anything 生成的 .ua/knowledge-graph.json。'),
          list,
          h('div', { class: 'nb__picker-actions' },
            h('button', {
              class: 'btn btn--sm',
              onclick: async () => {
                const picked = await window.toolbox.notebook.pickGraph();
                if (!picked) return;
                if (picked.error) return toast(picked.error, 'bad');
                picker.remove();
                mountGraph(picked.root);
              },
            }, '手动选目录…'),
            h('button', { class: 'btn btn--sm btn--ghost', onclick: () => picker.remove() }, '取消'),
          ),
        ),
      );
      root.append(picker);
    }

    // ---------- 组装 ----------
    const sideEl = h('aside', { class: 'nb__side' }, sideTabs, sideBody);
    const codeControls = h('span', { class: 'nb__code-controls' },
      langSelect,
      editToggle,
      taskToggle,
      h('span', { class: 'subbar__sep' }),
      symbolInput,
      h('button', { class: 'btn btn--icon', title: '上一处 (Shift+Enter)', onclick: () => step(-1) }, '‹'),
      h('button', { class: 'btn btn--icon', title: '下一处 (Enter)', onclick: () => step(1) }, '›'),
      hitCounter,
      h('span', { class: 'subbar__sep' }),
      graphLabel,
      graphButton,
    );
    const mainEl = h('div', { class: 'nb__main' }, editor, codeView, markdownShell, tasksPanel);
    const detailEl = h('aside', { class: 'nb__detail-pane' }, detail);
    const nbBody = h('div', { class: 'nb__body' });

    // 分隔条：拖动调栏宽；双击恢复默认。宽度持久化，窗口拉窄时自动收缩保住代码区。
    function clampPane(which) {
      const total = nbBody.clientWidth;
      const other = which === 'side' ? 'detail' : 'side';
      // 另一栏最少也留 28px，保证它的分隔条还能抓到
      const max = Math.max(PANE_COLLAPSED[which], total - MAIN_MIN - PANE_COLLAPSED[other] - 10);
      return Math.max(PANE_COLLAPSED[which], Math.min(paneWidths[which], max));
    }

    function applyPaneWidths() {
      paneWidths.side = clampPane('side');
      paneWidths.detail = clampPane('detail');
      sideEl.style.width = `${paneWidths.side}px`;
      detailEl.style.width = `${paneWidths.detail}px`;
      sideEl.classList.toggle('is-collapsed', paneWidths.side <= PANE_COLLAPSED.side);
      detailEl.classList.toggle('is-collapsed', paneWidths.detail <= PANE_COLLAPSED.detail);
    }

    function persistPaneWidths() {
      config.set('notebook.sideWidth', paneWidths.side);
      config.set('notebook.detailWidth', paneWidths.detail);
    }

    function makeSplitter(which, getDragWidth) {
      const handle = h('div', {
        class: `nb__split nb__split--${which}`,
        title: '拖动调整宽度，双击恢复默认',
        ondblclick: () => {
          paneWidths[which] = PANE_DEFAULTS[which];
          applyPaneWidths();
          persistPaneWidths();
        },
      });
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        handle.classList.add('is-dragging');
        const onMove = (e) => {
          paneWidths[which] = getDragWidth(e);
          applyPaneWidths();
        };
        const onUp = () => {
          handle.classList.remove('is-dragging');
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          persistPaneWidths();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
      return handle;
    }

    const splitSide = makeSplitter('side', (e) => {
      const rect = nbBody.getBoundingClientRect();
      const width = e.clientX - rect.left;
      // 拖到一半以下算折叠意图，收到窄条；再往外拉自动展开
      return width < PANE_COLLAPSED.side * 2 ? PANE_COLLAPSED.side : Math.round(width);
    });
    const splitDetail = makeSplitter('detail', (e) => {
      const rect = nbBody.getBoundingClientRect();
      const width = rect.right - e.clientX;
      return width < PANE_COLLAPSED.detail * 2 ? PANE_COLLAPSED.detail : Math.round(width);
    });

    nbBody.append(sideEl, splitSide, mainEl, splitDetail, detailEl);

    root.append(
      h('div', { class: 'bar bar--drag nb__bar' },
        h('strong', {}, '代码记事本'),
        noteModeToggle,
        snippetSelect,
        h('button', { class: 'btn btn--sm', title: '打开项目文件夹', onclick: () => openFolder() }, '📂 文件夹'),
        h('button', { class: 'btn btn--icon', title: '新片段', onclick: () => newSnippet() }, '＋'),
        h('button', {
          class: 'btn btn--icon', title: '删除当前片段',
          onclick: () => {
            if (!current()) return;
            snippets = snippets.filter((s) => s.id !== current().id);
            currentId = snippets[0]?.id || null;
            persist();
            config.set('notebook.currentId', currentId);
            selected = null;
            if (!snippets.length) newSnippet();
            else loadCurrent();
          },
        }, '−'),
        codeControls,
      ),
      symbolList,
      nbBody,
    );

    applyPaneWidths();
    syncEditorMode();

    // 窗口（或吸附分隔条）变宽变窄时，两栏跟着重新夹取，代码区保底 MAIN_MIN
    window.addEventListener('resize', debounce(applyPaneWidths, 80));

    if (!snippets.length) newSnippet();
    else loadCurrent();

    syncSideTab();

    const savedGraph = config.get('notebook.graphRoot');
    if (savedGraph) mountGraph(savedGraph).catch(() => {});

    const savedFolder = config.get('notebook.folderRoot');
    if (savedFolder) tree.open(savedFolder).then(() => syncSideTab()).catch(() => {});

    root.addEventListener('keydown', (event) => {
      if (editorMode === 'code' && (event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault();
        symbolInput.focus();
        symbolInput.select();
      }
      if (editorMode === 'code' && (event.metaKey || event.ctrlKey) && (event.key === 'e' || event.key === 'E')) {
        event.preventDefault();
        editToggle.click();
      }
    });

    return { activate: () => setTimeout(() => (editing ? editor : symbolInput).focus(), 30) };
  },
};
