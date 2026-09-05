import { h, toast } from '../../core/ui.js';
import {
  buildPracticeExplainPrompt,
  explainPracticeLine,
  normalizePracticeAiResult,
} from './practice-assist.js';
import { FRAMEWORK_TRACKS } from './data/frameworks.js';

const PRACTICE_TRACKS = [
  {
    id: 'python', name: 'Python 语法', icon: '🐍', level: '基础 → 复杂', runtime: 'python3',
    description: '变量、循环、函数、异常、文件和数据结构，边写边看结果。',
    samples: [
      { title: '列表推导式', level: '入门', code: `numbers = [1, 2, 3, 4, 5, 6]\nsquares = [number ** 2 for number in numbers if number % 2 == 0]\nprint(squares)` },
      { title: '函数与异常', level: '基础', code: `def average(values):\n    if not values:\n        raise ValueError("values 不能为空")\n    return sum(values) / len(values)\n\ntry:\n    print(average([72, 85, 91]))\nexcept ValueError as error:\n    print(f"输入错误：{error}")` },
      { title: '统计词频', level: '进阶', code: `from collections import Counter\n\ntext = "learn by doing, learn by testing"\nwords = text.lower().replace(",", "").split()\nfor word, count in Counter(words).most_common():\n    print(f"{word}: {count}")` },
    ],
  },
  {
    id: 'linux', name: 'Linux 命令', icon: '▣', level: '基础 → 进阶', runtime: 'bash',
    description: 'pwd、find、grep、管道、重定向和脚本；在临时目录里执行，保护本机文件。',
    samples: [
      { title: '管道统计', level: '入门', code: `printf '%s\\n' apple banana apple orange banana apple | sort | uniq -c | sort -nr` },
      { title: '查找文本', level: '基础', code: `printf '%s\\n' "error: disk full" "info: ready" "error: retry" > app.log\ngrep -n "error" app.log` },
      { title: '循环处理', level: '进阶', code: `for name in Ada Linus Grace; do\n  printf 'hello, %s\\n' "$name"\ndone` },
    ],
  },
  {
    id: 'sql', name: 'MySQL / SQL', icon: '▤', level: '常用语法', runtime: 'sqlite3',
    description: 'CREATE、INSERT、SELECT、JOIN、GROUP BY；使用本地内存数据库模拟 MySQL 常用语法。',
    samples: [
      { title: '建表查询', level: '入门', code: `CREATE TABLE students (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  score INTEGER\n);\nINSERT INTO students VALUES (1, '小明', 88), (2, '小红', 96);\nSELECT name, score FROM students WHERE score >= 90 ORDER BY score DESC;` },
      { title: '分组统计', level: '基础', code: `CREATE TABLE orders (user_name TEXT, amount INTEGER);\nINSERT INTO orders VALUES ('Ada', 30), ('Ada', 50), ('Linus', 80);\nSELECT user_name, SUM(amount) AS total\nFROM orders GROUP BY user_name HAVING total >= 60;` },
      { title: '连接两张表', level: '进阶', code: `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nCREATE TABLE posts (user_id INTEGER, title TEXT);\nINSERT INTO users VALUES (1, 'Ada'), (2, 'Linus');\nINSERT INTO posts VALUES (1, 'SQL 入门'), (1, '索引为什么快');\nSELECT users.name, posts.title FROM users\nJOIN posts ON posts.user_id = users.id;` },
    ],
  },
  {
    id: 'requests', name: 'Requests 爬虫', icon: '⇄', level: '网络实践', runtime: 'python3 + requests',
    description: '请求、状态码、响应头、JSON 和超时；网络失败会显示真实错误，不会假装成功。',
    samples: [
      { title: '读取网页标题', level: '入门', code: `import requests\nimport re\n\nresponse = requests.get("https://example.com", timeout=10)\nresponse.raise_for_status()\ntitle = re.search(r"<title>(.*?)</title>", response.text, re.I | re.S)\nprint("状态码：", response.status_code)\nprint("标题：", title.group(1).strip() if title else "未找到")` },
      { title: '读取 JSON', level: '基础', code: `import requests\n\nresponse = requests.get("https://httpbin.org/json", timeout=10)\nresponse.raise_for_status()\ndata = response.json()\nprint(data.keys())\nprint(data.get("slideshow", {}).get("title"))` },
      { title: '带参数和请求头', level: '进阶', code: `import requests\n\nparams = {"page": 1, "keyword": "python"}\nheaders = {"User-Agent": "learning-practice/1.0"}\nresponse = requests.get("https://httpbin.org/get", params=params, headers=headers, timeout=10)\nprint(response.url)\nprint(response.json()["args"])` },
    ],
  },
  {
    id: 'matlab', name: 'MATLAB / Octave', icon: '∑', level: '基础语法', runtime: 'MATLAB / Octave',
    description: '向量、矩阵、索引、绘图前的基础计算；需要本机安装 MATLAB 或 GNU Octave。',
    samples: [
      { title: '向量运算', level: '入门', code: `x = 1:5;\ny = x.^2;\ndisp(y);\nfprintf('平均值：%.2f\\n', mean(y));` },
      { title: '矩阵索引', level: '基础', code: `A = [1 2 3; 4 5 6; 7 8 9];\nmainDiagonal = diag(A);\nrowSums = sum(A, 2);\ndisp(mainDiagonal);\ndisp(rowSums);` },
      { title: '循环与条件', level: '进阶', code: `for n = 1:10\n    if mod(n, 2) == 0\n        fprintf('%d 是偶数\\n', n);\n    end\nend` },
    ],
  },
  ...FRAMEWORK_TRACKS,
];

function statusLabel(result) {
  if (result.timedOut) return '超时（已停止）';
  if (result.ok) return '运行成功';
  if (result.exitCode == null) return '启动失败';
  return `运行失败 · exit ${result.exitCode}`;
}

export function createPracticePanel(ctx) {
  const { ai } = ctx;
  let track = PRACTICE_TRACKS[0];
  let sampleIndex = 0;
  let environment = {};
  let annotationRunId = 0;
  let setupBusy = false;
  let nextCellId = 1;
  let activeCell = null;
  let cells = [];

  const trackSelect = h('select', { class: 'field practice__track-select' }, ...PRACTICE_TRACKS.map((item) => h('option', { value: item.id }, `${item.icon} ${item.name}`)));
  const levelSelect = h('select', { class: 'field practice__sample-select' });
  const description = h('span', { class: 'practice__description' });
  const runtimeStatus = h('span', { class: 'practice__runtime-status' }, '检测中…');
  const cellCount = h('span', { class: 'faint' }, '0 个单元格');
  const notebookList = h('div', { class: 'practice__notebook-list' });
  const setupBtn = h('button', { class: 'btn practice__setup', onclick: setupEnvironment }, '准备 uv 环境');

  function currentSample() { return track.samples[sampleIndex] || track.samples[0]; }

  function renderSamples() {
    levelSelect.replaceChildren(...track.samples.map((item, index) => h('option', { value: String(index) }, `${item.level} · ${item.title}`)));
    levelSelect.value = String(sampleIndex);
    cells = [createCell(currentSample().code)];
    renderNotebook(cells[0], false);
    updateMeta();
  }

  function updateMeta(cell = activeCell) {
    if (!cell) return;
    cell.lineCount.textContent = `${cell.editor.value.split(/\r?\n/).length} 行`;
    description.textContent = track.description;
    setupBtn.hidden = !['python', 'requests', 'langchain', 'pytorch', 'transformers', 'fastapi', 'matplotlib', 'pandas'].includes(track.id);
    if (track.packageKey) {
      runtimeStatus.textContent = environment[track.packageKey]
        ? `${track.packageLabel} 已就绪`
        : `${track.packageLabel} 未安装 · 运行时会显示依赖提示`;
      return;
    }
    runtimeStatus.textContent = track.id === 'sql'
      ? environment.sqlite3 ? '本地 SQLite · MySQL 常用子集' : 'SQLite 未安装'
      : track.id === 'matlab'
        ? environment.matlab || environment.octave ? `可运行 · ${environment.matlab ? 'MATLAB' : 'Octave'}` : '需要安装 MATLAB / Octave'
        : track.id === 'linux'
          ? environment.bash ? 'bash 已就绪' : 'bash 未找到'
          : environment.python ? track.id === 'requests' ? 'python3 + requests 已就绪' : 'python3 已就绪' : 'python3 未找到';
    if (environment.uv && !track.packageKey) runtimeStatus.textContent += ' · uv 环境可用';
  }

  function selectCell(cell, focus = false) {
    if (!cell) return;
    activeCell = cell;
    for (const item of cells) item.el?.classList.toggle('practice__cell--active', item === cell);
    updateMeta(cell);
    if (focus) cell.editor.focus();
  }

  function renderNotebook(focusCell = activeCell, focus = false) {
    notebookList.replaceChildren(...cells.map((cell) => cell.el));
    cellCount.textContent = `${cells.length} 个单元格`;
    selectCell(focusCell || cells[0], focus);
  }

  function addCell() {
    const cell = createCell('');
    cells.push(cell);
    renderNotebook(cell, true);
  }

  function removeCell() {
    if (cells.length === 1) return toast('至少保留一个代码单元格', 'info');
    const index = Math.max(0, cells.indexOf(activeCell));
    cells.splice(index, 1);
    renderNotebook(cells[Math.max(0, index - 1)], true);
  }

  function currentLineIndex(cell = activeCell) {
    return cell.editor.value.slice(0, cell.editor.selectionStart || 0).split(/\r?\n/).length - 1;
  }

  function currentContext(cell, lineIndex) {
    const lines = cell.editor.value.split(/\r?\n/);
    return lines.slice(Math.max(0, lineIndex - 2), Math.min(lines.length, lineIndex + 3)).join('\n');
  }

  function placeAnnotation(cell, lineIndex) {
    const lineHeight = parseFloat(getComputedStyle(cell.editor).lineHeight) || 21.875;
    const wrapHeight = cell.editorWrap.clientHeight || 360;
    const noteHeight = cell.annotation.offsetHeight || 174;
    const rawTop = 12 + lineIndex * lineHeight - cell.editor.scrollTop;
    cell.annotation.style.top = `${Math.max(8, Math.min(rawTop, Math.max(8, wrapHeight - noteHeight - 8)))}px`;
  }

  function showAnnotation(cell, note, lineIndex) {
    cell.annotationTitle.textContent = note.title;
    cell.annotationLine.textContent = `${lineIndex + 1}  ${cell.editor.value.split(/\r?\n/)[lineIndex] || ''}`;
    cell.annotationBody.textContent = `${note.syntax ? `语法：${note.syntax}。` : ''}${note.explanation}`;
    cell.annotationWhy.textContent = note.why ? `为什么：${note.why}` : '';
    cell.annotationActions.replaceChildren();
    if (note.url) cell.annotationActions.append(h('button', { class: 'btn btn--sm', onclick: () => openDocs(note.url) }, '打开文档区'));
    if (note.docQuery && !note.url) cell.annotationActions.append(h('button', { class: 'btn btn--sm', onclick: () => openDocs(`https://www.google.com/search?q=${encodeURIComponent(note.docQuery)}`) }, '去文档区搜索'));
    cell.annotationActions.append(h('button', { class: 'btn btn--sm btn--primary', onclick: () => explainCurrentLine(cell, true) }, 'AI 解释当前行'));
    cell.annotation.removeAttribute('hidden');
    requestAnimationFrame(() => placeAnnotation(cell, lineIndex));
  }

  function openDocs(url) {
    ctx.goto('docs');
    setTimeout(() => window.dispatchEvent(new CustomEvent('toolbox:open-url', { detail: { url } })), 80);
    toast('已在文档区打开相关资料', 'good');
  }

  function showCurrentLineHint(cell = activeCell) {
    if (!cell) return;
    annotationRunId += 1;
    const lineIndex = currentLineIndex(cell);
    const line = cell.editor.value.split(/\r?\n/)[lineIndex] || '';
    if (!line.trim()) {
      cell.annotation.setAttribute('hidden', '');
      return;
    }
    const local = explainPracticeLine(track.id, line);
    showAnnotation(cell, local || {
      title: '这一行还没有本地规则说明',
      syntax: track.id === 'python' || track.id === 'requests' ? 'Python 语法' : `${track.name} 语法`,
      explanation: '它会保留在当前行，点击 AI 解释可以结合上下文讲清楚输入、输出和运行时行为。',
      why: '先定位这一行的职责，再运行程序验证猜测。',
    }, lineIndex);
  }

  async function explainCurrentLine(cell = activeCell, force = false) {
    if (!cell) return;
    const lineIndex = currentLineIndex(cell);
    const line = cell.editor.value.split(/\r?\n/)[lineIndex] || '';
    if (!line.trim()) return toast('先把光标放到要解释的代码行', 'info');
    if (!force && explainPracticeLine(track.id, line)) return showCurrentLineHint(cell);
    const currentRequest = ++annotationRunId;
    const note = { title: 'AI 正在解释当前行', syntax: '', explanation: '正在结合附近代码分析…', why: '' };
    showAnnotation(cell, note, lineIndex);
    cell.annotation.classList.add('is-loading');
    try {
      const raw = await ai.chat(buildPracticeExplainPrompt({ trackName: track.name, line, context: currentContext(cell, lineIndex) }), { timeout: 70000 });
      if (currentRequest !== annotationRunId) return;
      showAnnotation(cell, normalizePracticeAiResult(raw, line), lineIndex);
    } catch (error) {
      if (currentRequest !== annotationRunId) return;
      showAnnotation(cell, { title: 'AI 解释失败', syntax: '', explanation: error.message, why: '本地语法提示仍然保留；可以检查 AI 接口或先运行代码。' }, lineIndex);
    } finally { cell.annotation.classList.remove('is-loading'); }
  }

  async function runCell(cell) {
    const currentRun = ++cell.runId;
    cell.runBtn.disabled = true;
    cell.output.textContent = '正在启动本机运行环境…';
    cell.resultStatus.textContent = '运行中…';
    cell.resultStatus.className = 'practice__result-status is-running';
    try {
      const result = await window.toolbox.practice.run({ track: track.id, code: cell.editor.value, timeout: 12000 });
      if (currentRun !== cell.runId) return;
      cell.resultStatus.textContent = statusLabel(result);
      cell.resultStatus.className = `practice__result-status ${result.ok ? 'is-good' : 'is-bad'}`;
      const parts = [];
      if (result.stdout) parts.push(result.stdout.trimEnd());
      if (result.stderr) parts.push(`[stderr]\n${result.stderr.trimEnd()}`);
      if (!parts.length) parts.push(result.ok ? '(程序没有输出)' : (result.error || '(没有输出，检查错误信息)'));
      cell.output.textContent = `${parts.join('\n\n')}\n\n[${result.engine || track.runtime}] ${result.duration || 0} ms`;
      cell.result = result;
      cell.executionCount = (cell.executionCount || 0) + 1;
      cell.gutter.textContent = `In [${cell.executionCount}]`;
    } catch (error) {
      cell.resultStatus.textContent = '运行器错误';
      cell.resultStatus.className = 'practice__result-status is-bad';
      cell.output.textContent = error.message;
    } finally { cell.runBtn.disabled = false; }
  }

  async function setupEnvironment() {
    if (setupBusy) return;
    setupBusy = true;
    setupBtn.disabled = true;
    setupBtn.textContent = '准备环境…';
    try {
      const result = await window.toolbox.practice.setup({ track: track.id });
      if (!result.ok) return toast(result.error || 'uv 环境准备失败', 'bad', 6000);
      environment = { ...environment, ...(result.environment || {}) };
      updateMeta();
      toast(result.message || `${track.name} 环境已准备好`, 'good', 5000);
    } catch (error) {
      toast(`环境准备失败：${error.message}`, 'bad', 6000);
    } finally {
      setupBusy = false;
      setupBtn.disabled = false;
      setupBtn.textContent = '准备 uv 环境';
    }
  }

  async function addComments() {
    const cell = activeCell;
    if (!cell || !cell.editor.value.trim()) return toast('先写一点代码，再让 AI 加注释', 'info');
    cell.commentBtn.disabled = true;
    const before = cell.editor.value;
    cell.output.textContent = 'AI 正在根据当前代码补充注释…';
    try {
      const prompt = `请给下面的${track.name}练习代码补充少量高价值中文注释。只返回完整代码，不要 markdown 代码块；保留原逻辑、不要修改代码、不要添加长篇说明。代码：\n<<<\n${before}\n>>>`;
      const result = await ai.chat(prompt, { timeout: 70000 });
      cell.editor.value = String(result || '').replace(/^```[\w-]*\s*/i, '').replace(/\s*```$/i, '').trim();
      cell.code = cell.editor.value;
      cell.output.textContent = '注释已加入。请检查后再运行，运行结果仍以本机解释器为准。';
      updateMeta(cell);
    } catch (error) { cell.output.textContent = `自动注释失败：${error.message}`; }
    finally { cell.commentBtn.disabled = false; }
  }

  function createCell(code = '') {
    const cell = { id: nextCellId++, code, runId: 0, executionCount: 0 };
    cell.gutter = h('div', { class: 'practice__cell-gutter' }, 'In [ ]');
    cell.editor = h('textarea', { class: 'practice__editor', spellcheck: false, wrap: 'off' }, code);
    cell.editorWrap = h('div', { class: 'practice__editor-wrap' });
    cell.annotation = h('aside', { class: 'practice__annotation', hidden: true });
    cell.annotationTitle = h('strong', { class: 'practice__annotation-title' });
    cell.annotationLine = h('code', { class: 'practice__annotation-line' });
    cell.annotationBody = h('p', { class: 'practice__annotation-body' });
    cell.annotationWhy = h('p', { class: 'practice__annotation-why' });
    cell.annotationActions = h('div', { class: 'practice__annotation-actions' });
    cell.annotation.append(
      h('div', { class: 'practice__annotation-head' }, cell.annotationTitle, h('span', { class: 'practice__annotation-close', onclick: () => cell.annotation.setAttribute('hidden', '') }, '×')),
      cell.annotationLine,
      cell.annotationBody,
      cell.annotationWhy,
      cell.annotationActions,
    );
    cell.editorWrap.append(cell.editor, cell.annotation);
    cell.lineCount = h('span', { class: 'practice__editor-meta' }, `${code.split(/\r?\n/).length} 行`);
    cell.output = h('pre', { class: 'practice__output' }, '运行结果会出现在这里。');
    cell.resultStatus = h('span', { class: 'practice__result-status' }, '尚未运行');
    cell.runBtn = h('button', { class: 'btn btn--primary practice__run', onclick: () => runCell(cell) }, '▶ 运行');
    cell.commentBtn = h('button', { class: 'btn practice__comment', onclick: () => addCommentsFor(cell) }, '✦ 自动注释');
    const explainLocalBtn = h('button', { class: 'btn practice__explain-local', onclick: () => showCurrentLineHint(cell) }, '⌁ 代码说明');
    const explainLineBtn = h('button', { class: 'btn practice__explain-line', onclick: () => explainCurrentLine(cell, true) }, '⌁ 解释当前行');
    const restoreBtn = h('button', { class: 'btn btn--ghost', onclick: () => restoreCell(cell) }, '恢复示例');
    cell.el = h('section', { class: 'practice__cell' },
      cell.gutter,
      h('div', { class: 'practice__cell-main' },
        h('div', { class: 'practice__pane-head' },
          h('div', {}, h('strong', {}, '代码单元格'), h('span', { class: 'faint' }, ' 可自由修改')),
          cell.lineCount,
        ),
        cell.editorWrap,
        h('div', { class: 'practice__actions' }, cell.runBtn, cell.commentBtn, explainLocalBtn, explainLineBtn, restoreBtn),
        h('div', { class: 'practice__latest-output' },
          h('div', { class: 'practice__pane-head' }, h('strong', {}, '输出'), cell.resultStatus),
          cell.output,
        ),
      ),
    );
    cell.editor.addEventListener('focus', () => selectCell(cell));
    cell.editor.addEventListener('input', () => { cell.code = cell.editor.value; updateMeta(cell); });
    cell.editor.addEventListener('scroll', () => placeAnnotation(cell, currentLineIndex(cell)));
    return cell;
  }

  function addCommentsFor(cell) {
    const previous = activeCell;
    selectCell(cell);
    addComments().finally(() => selectCell(previous || cell));
  }

  function restoreCell(cell) {
    cell.editor.value = currentSample().code;
    cell.code = cell.editor.value;
    cell.output.textContent = '运行结果会出现在这里。';
    cell.resultStatus.textContent = '尚未运行';
    cell.resultStatus.className = 'practice__result-status';
    cell.annotation.setAttribute('hidden', '');
    updateMeta(cell);
  }

  trackSelect.addEventListener('change', () => {
    track = PRACTICE_TRACKS.find((item) => item.id === trackSelect.value) || PRACTICE_TRACKS[0];
    sampleIndex = 0;
    renderSamples();
  });
  levelSelect.addEventListener('change', () => { sampleIndex = Number(levelSelect.value); renderSamples(); });

  const el = h('div', { class: 'practice' },
    h('div', { class: 'practice__head' },
      h('div', { class: 'practice__intro' },
        h('div', { class: 'practice__eyebrow' }, 'LEARN BY EXECUTING'),
        h('h2', {}, '实践敲码'),
        h('p', {}, '先读一个小例子，再改它、运行它、看结果。每个领域都从能马上得到反馈的动作开始。'),
      ),
      h('div', { class: 'practice__track-picker' },
        h('label', {}, h('span', { class: 'practice__label' }, '领域'), trackSelect),
        h('label', {}, h('span', { class: 'practice__label' }, '练习'), levelSelect),
      ),
    ),
    h('div', { class: 'practice__info-row' },
      description,
      setupBtn,
      runtimeStatus,
    ),
    h('div', { class: 'practice__notebook' },
      h('div', { class: 'practice__notebook-toolbar' },
        h('div', {}, h('strong', {}, 'Notebook 单元格'), h('span', { class: 'faint' }, ' 运行后输出会留在对应单元格，可继续向下添加')),
        h('div', { class: 'practice__cell-controls' },
          h('button', { class: 'btn btn--sm', title: '删除当前单元格', onclick: removeCell }, '−'),
          h('button', { class: 'btn btn--sm btn--primary', title: '在末尾添加新单元格', onclick: addCell }, '＋ 新增'),
          cellCount,
        ),
      ),
      notebookList,
    ),
  );

  window.toolbox.practice.environment().then((value) => { environment = value || {}; updateMeta(); });
  renderSamples();
  return { el };
}
