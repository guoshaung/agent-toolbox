import { h, toast, debounce } from '../../core/ui.js';
import {
  buildPracticeExplainPrompt,
  explainPracticeLine,
  normalizePracticeAiResult,
} from './practice-assist.js';
import { FRAMEWORK_TRACKS } from './data/frameworks.js';
import { attachEditorKeys } from './editor-keys.js';
import { highlight, LANG_BY_TRACK } from './highlight.js';
import { EXTRA_TRACKS } from './data/practice-extra.js';
import {
  buildErrorDiagnosisPrompt,
  diagnoseRunError,
  normalizeErrorDiagnosis,
  runStatusLabel,
} from './practice-errors.js';

const PRACTICE_TRACKS = [
  {
    id: 'python', name: 'Python 语法', icon: '🐍', level: '基础 → 复杂', runtime: 'python3',
    description: '变量、循环、函数、异常、文件和数据结构，边写边看结果。',
    samples: [
      { title: '列表推导式', level: '入门', code: `numbers = [1, 2, 3, 4, 5, 6]\nsquares = [number ** 2 for number in numbers if number % 2 == 0]\nprint(squares)` },
      { title: '函数与异常', level: '基础', code: `def average(values):\n    if not values:\n        raise ValueError("values 不能为空")\n    return sum(values) / len(values)\n\ntry:\n    print(average([72, 85, 91]))\nexcept ValueError as error:\n    print(f"输入错误：{error}")` },
      { title: '统计词频', level: '进阶', code: `from collections import Counter\n\ntext = "learn by doing, learn by testing"\nwords = text.lower().replace(",", "").split()\nfor word, count in Counter(words).most_common():\n    print(f"{word}: {count}")` },
      { title: '字典与 defaultdict', level: '基础', code: `from collections import defaultdict\n\npapers = [("agent", "AgentSquare"), ("rsi", "DGM"), ("agent", "AFlow")]\ngroups = defaultdict(list)\nfor tag, name in papers:\n    groups[tag].append(name)\nfor tag, names in groups.items():\n    print(f"{tag}: {', '.join(names)}")` },
      { title: '切片与解包', level: '基础', code: `row = [1, 2, 3, 4, 5, 6]\nhead, *middle, tail = row\nprint("头:", head, "中间:", middle, "尾:", tail)\nprint("每隔一个:", row[::2])\nprint("倒序:", row[::-1])` },
      { title: '装饰器计时', level: '进阶', code: `import time\nfrom functools import wraps\n\ndef timed(func):\n    @wraps(func)\n    def wrapper(*args, **kwargs):\n        start = time.perf_counter()\n        result = func(*args, **kwargs)\n        print(f"{func.__name__} 用了 {time.perf_counter() - start:.4f}s")\n        return result\n    return wrapper\n\n@timed\ndef slow_sum(n):\n    return sum(range(n))\n\nprint(slow_sum(2_000_00))` },
      { title: '生成器省内存', level: '进阶', code: `import sys\n\nlist_version = [x * x for x in range(100000)]\ngen_version = (x * x for x in range(100000))\nprint("列表占:", sys.getsizeof(list_version), "字节")\nprint("生成器占:", sys.getsizeof(gen_version), "字节")\nprint("前5个:", [next(gen_version) for _ in range(5)])` },
    ],
  },
  {
    id: 'linux', name: 'Linux 命令', icon: '▣', level: '基础 → 进阶', runtime: 'bash',
    description: 'pwd、find、grep、管道、重定向和脚本；在临时目录里执行，保护本机文件。',
    samples: [
      { title: '管道统计', level: '入门', code: `printf '%s\\n' apple banana apple orange banana apple | sort | uniq -c | sort -nr` },
      { title: '查找文本', level: '基础', code: `printf '%s\\n' "error: disk full" "info: ready" "error: retry" > app.log\ngrep -n "error" app.log` },
      { title: '循环处理', level: '进阶', code: `for name in Ada Linus Grace; do\n  printf 'hello, %s\\n' "$name"\ndone` },
      { title: '按大小找文件', level: '基础', code: `mkdir -p demo && cd demo\nhead -c 2000 /dev/zero > big.bin\nhead -c 10 /dev/zero > small.bin\nfind . -type f -size +1k -exec ls -lh {} \\;` },
      { title: '重定向与错误流', level: '基础', code: `ls /nonexistent 2> err.log\necho "标准错误被单独收走了："\ncat err.log\nls /nonexistent > all.log 2>&1 && echo ok || echo "两条流都进了 all.log"` },
      { title: '变量与条件判断', level: '进阶', code: `threshold=80\nfor score in 92 71 85; do\n  if [ "$score" -ge "$threshold" ]; then\n    echo "$score 通过"\n  else\n    echo "$score 未达标"\n  fi\ndone` },
    ],
  },
  {
    id: 'sql', name: 'MySQL / SQL', icon: '▤', level: '常用语法', runtime: 'sqlite3',
    description: 'CREATE、INSERT、SELECT、JOIN、GROUP BY；使用本地内存数据库模拟 MySQL 常用语法。',
    samples: [
      { title: '建表查询', level: '入门', code: `CREATE TABLE students (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  score INTEGER\n);\nINSERT INTO students VALUES (1, '小明', 88), (2, '小红', 96);\nSELECT name, score FROM students WHERE score >= 90 ORDER BY score DESC;` },
      { title: '分组统计', level: '基础', code: `CREATE TABLE orders (user_name TEXT, amount INTEGER);\nINSERT INTO orders VALUES ('Ada', 30), ('Ada', 50), ('Linus', 80);\nSELECT user_name, SUM(amount) AS total\nFROM orders GROUP BY user_name HAVING total >= 60;` },
      { title: '连接两张表', level: '进阶', code: `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nCREATE TABLE posts (user_id INTEGER, title TEXT);\nINSERT INTO users VALUES (1, 'Ada'), (2, 'Linus');\nINSERT INTO posts VALUES (1, 'SQL 入门'), (1, '索引为什么快');\nSELECT users.name, posts.title FROM users\nJOIN posts ON posts.user_id = users.id;` },
      { title: 'LEFT JOIN 与空值', level: '进阶', code: `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nCREATE TABLE posts (user_id INTEGER, title TEXT);\nINSERT INTO users VALUES (1, 'Ada'), (2, 'Linus');\nINSERT INTO posts VALUES (1, 'SQL 入门');\n-- LEFT JOIN 会把没发过帖的人也留下，右边补 NULL\nSELECT users.name, IFNULL(posts.title, '(还没发过)') AS title\nFROM users LEFT JOIN posts ON posts.user_id = users.id;` },
      { title: '子查询与 IN', level: '进阶', code: `CREATE TABLE orders (user_name TEXT, amount INTEGER);\nINSERT INTO orders VALUES ('Ada', 120), ('Linus', 30), ('Grace', 200);\nSELECT user_name, amount FROM orders\nWHERE amount > (SELECT AVG(amount) FROM orders)\nORDER BY amount DESC;` },
      { title: '窗口函数排名', level: '进阶', code: `CREATE TABLE scores (name TEXT, subject TEXT, score INTEGER);\nINSERT INTO scores VALUES ('Ada','math',95),('Linus','math',88),('Ada','cs',92),('Linus','cs',97);\nSELECT subject, name, score,\n       RANK() OVER (PARTITION BY subject ORDER BY score DESC) AS rank_in_subject\nFROM scores;` },
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
  ...EXTRA_TRACKS,
  ...FRAMEWORK_TRACKS,
];

export function createPracticePanel(ctx) {
  const { ai } = ctx;
  let track = PRACTICE_TRACKS[0];
  let sampleIndex = 0;
  let environment = {};
  let annotationRunId = 0;
  let setupBusy = false;
  let runAllBusy = false;
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
  const runAllBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: runAllCells }, '▶ 全部运行');

  function currentSample() { return track.samples[sampleIndex] || track.samples[0]; }

  function notebookStateKey() { return `${track.id}:${sampleIndex}`; }

  function persistNotebook() {
    if (!cells.length) return;
    const notebooks = { ...(config.get('practice.notebooks', {}) || {}) };
    notebooks[notebookStateKey()] = cells.slice(0, 40).map((cell) => ({
      code: cell.editor.value,
      executionCount: cell.executionCount || 0,
      result: cell.result ? {
        ok: Boolean(cell.result.ok),
        stdout: String(cell.result.stdout || '').slice(0, 12000),
        stderr: String(cell.result.stderr || '').slice(0, 12000),
        error: String(cell.result.error || '').slice(0, 2000),
        engine: cell.result.engine || '',
        duration: Number(cell.result.duration) || 0,
      } : null,
    }));
    config.set('practice.notebooks', notebooks);
  }

  const persistNotebookSoon = debounce(persistNotebook, 320);

  function renderSamples() {
    levelSelect.replaceChildren(...track.samples.map((item, index) => h('option', { value: String(index) }, `${item.level} · ${item.title}`)));
    levelSelect.value = String(sampleIndex);
    const saved = (config.get('practice.notebooks', {}) || {})[notebookStateKey()];
    cells = Array.isArray(saved) && saved.length ? saved.map((snapshot) => restoreNotebookCell(snapshot)) : [createCell(currentSample().code)];
    renderNotebook(cells[0], false);
    updateMeta();
  }

  function updateMeta(cell = activeCell) {
    if (!cell) return;
    paintHighlight(cell);
    cell.lineCount.textContent = `${cell.editor.value.split(/\r?\n/).length} 行`;
    description.textContent = track.description;
    setupBtn.hidden = !track.runtime.includes('python3');
    if (track.packageKey) {
      runtimeStatus.textContent = environment[track.packageKey]
        ? `${track.packageLabel} 已就绪`
        : `${track.packageLabel} 未安装 · 点击准备共享环境`;
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
    persistNotebook();
  }

  function removeCell() {
    if (cells.length === 1) return toast('至少保留一个代码单元格', 'info');
    const index = Math.max(0, cells.indexOf(activeCell));
    cells.splice(index, 1);
    renderNotebook(cells[Math.max(0, index - 1)], true);
    persistNotebook();
  }

  function moveCell(cell, direction) {
    const index = cells.indexOf(cell);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= cells.length) return;
    [cells[index], cells[target]] = [cells[target], cells[index]];
    renderNotebook(cell, false);
    persistNotebook();
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
    hideDiagnosis(cell);
    cell.output.textContent = '正在启动本机运行环境…';
    cell.resultStatus.textContent = '运行中…';
    cell.resultStatus.className = 'practice__result-status is-running';
    try {
      const cellIndex = cells.indexOf(cell);
      const prelude = track.runtime.includes('python3')
        ? cells.slice(0, Math.max(0, cellIndex)).map((item) => item.editor.value.trim()).filter(Boolean).join('\n\n')
        : '';
      const result = await window.toolbox.practice.run({ track: track.id, code: cell.editor.value, prelude, timeout: 12000 });
      if (currentRun !== cell.runId) return;
      const diagnosis = diagnoseRunError(track.id, result, cell.editor.value);
      cell.resultStatus.textContent = runStatusLabel(result, diagnosis);
      cell.resultStatus.className = `practice__result-status ${result.ok ? 'is-good' : 'is-bad'}`;
      const parts = [];
      if (result.stdout) parts.push(result.stdout.trimEnd());
      if (result.stderr) parts.push(`[stderr]\n${result.stderr.trimEnd()}`);
      if (!parts.length) parts.push(result.ok ? '(程序没有输出)' : (result.error || '(没有输出，检查错误信息)'));
      cell.output.textContent = `${parts.join('\n\n')}\n\n[${result.engine || track.runtime}] ${result.duration || 0} ms`;
      cell.result = result;
      if (result.ok) hideDiagnosis(cell);
      else showDiagnosis(cell, diagnosis || unknownDiagnosis(result));
      cell.executionCount = (cell.executionCount || 0) + 1;
      cell.gutter.textContent = `In [${cell.executionCount}]`;
      persistNotebook();
    } catch (error) {
      cell.resultStatus.textContent = '运行器错误';
      cell.resultStatus.className = 'practice__result-status is-bad';
      cell.output.textContent = error.message;
      cell.result = null;
      showDiagnosis(cell, {
        kind: '运行器错误', title: '没能把代码交给解释器', line: null, lineText: '',
        summary: error.message,
        fixes: ['先点上方「准备 uv 环境」确认运行环境可用。', '如果反复出现，重启一次应用再试。'],
      });
    } finally { cell.runBtn.disabled = false; }
  }

  async function runAllCells() {
    if (runAllBusy) return;
    runAllBusy = true;
    runAllBtn.disabled = true;
    runAllBtn.textContent = '运行全部中…';
    try {
      for (const cell of cells) {
        if (cell.editor.value.trim()) await runCell(cell);
      }
      toast('全部代码单元格已运行', 'good');
    } finally {
      runAllBusy = false;
      runAllBtn.disabled = false;
      runAllBtn.textContent = '▶ 全部运行';
    }
  }

  function runAndAdvance(cell) {
    runCell(cell).finally(() => {
      const index = cells.indexOf(cell);
      if (index < cells.length - 1) selectCell(cells[index + 1], true);
      else addCell();
    });
  }

  function clearOutputs() {
    for (const cell of cells) {
      cell.result = null;
      cell.executionCount = 0;
      cell.gutter.textContent = 'In [ ]';
      cell.resultStatus.textContent = '尚未运行';
      cell.resultStatus.className = 'practice__result-status';
      cell.output.textContent = '运行结果会出现在这里。';
      hideDiagnosis(cell);
    }
    persistNotebook();
    toast('已清空所有单元格输出', 'info');
  }

  async function copyCellOutput(cell) {
    const text = cell.output.textContent.trim();
    if (!text || text === '运行结果会出现在这里。') return toast('这个单元格还没有输出', 'info');
    await window.toolbox.clipboard.write(text);
    toast('输出已复制', 'good', 1800);
  }

  // ---------- 报错诊断：本地规则先给结论，看不懂再让 AI 接手 ----------

  function unknownDiagnosis(result) {
    return {
      kind: result.exitCode == null ? '启动失败' : `exit ${result.exitCode}`,
      title: '这次运行失败了',
      line: null, lineText: '',
      summary: '本地规则没认出这个报错。上面 [stderr] 里的最后一行通常就是根因，点「AI 诊断」可以让模型结合你的代码解释它。',
      fixes: [],
    };
  }

  function hideDiagnosis(cell) {
    cell.lastDiagnosis = null;
    cell.diagPanel.setAttribute('hidden', '');
  }

  /** 渲染一条诊断。ai=true 时用不同配色，表示这段是模型给的、需要自己判断。 */
  function showDiagnosis(cell, diagnosis, { ai: fromAi = false, loading = false } = {}) {
    cell.lastDiagnosis = diagnosis;
    cell.diagPanel.className = `practice__diagnosis${fromAi ? ' is-ai' : ''}${loading ? ' is-loading' : ''}`;
    cell.diagTitle.textContent = `${fromAi ? '✦ ' : '⚠ '}${diagnosis.title || diagnosis.kind}`;

    const line = diagnosis.line;
    const lineText = diagnosis.lineText || (line ? cell.editor.value.split(/\r?\n/)[line - 1] || '' : '');
    if (line) {
      cell.diagJump.textContent = `跳到第 ${line} 行`;
      cell.diagJump.removeAttribute('hidden');
      cell.diagJumpLine = line;
    } else {
      cell.diagJump.setAttribute('hidden', '');
      cell.diagJumpLine = null;
    }

    cell.diagSummary.textContent = diagnosis.summary || diagnosis.cause || '';

    if (lineText.trim()) {
      cell.diagCode.textContent = `${line}  ${lineText}`;
      cell.diagCode.removeAttribute('hidden');
    } else cell.diagCode.setAttribute('hidden', '');

    cell.diagFixes.replaceChildren(...(diagnosis.fixes || []).map((item) => h('li', {}, item)));

    cell.diagExtra.replaceChildren();
    if (diagnosis.patch) {
      cell.diagExtra.append(
        h('div', { class: 'practice__diag-extra-label' }, '建议改成'),
        h('pre', { class: 'practice__diag-patch' }, diagnosis.patch),
      );
    }
    if (diagnosis.prevent) {
      cell.diagExtra.append(h('p', { class: 'practice__diag-prevent' }, `下次避免：${diagnosis.prevent}`));
    }

    cell.diagAiBtn.disabled = loading;
    cell.diagAiBtn.textContent = loading ? '诊断中…' : (fromAi ? '✦ 重新诊断' : '✦ AI 诊断');
    cell.diagPanel.removeAttribute('hidden');
  }

  /** 把光标放到出错那一行并滚过去 —— 报错说第 N 行，就得能一键看到第 N 行。 */
  function jumpToLine(cell, line = cell.diagJumpLine) {
    if (!line) return;
    const lines = cell.editor.value.split(/\r?\n/);
    const index = Math.min(Math.max(line - 1, 0), lines.length - 1);
    const start = lines.slice(0, index).reduce((sum, item) => sum + item.length + 1, 0);
    cell.editor.focus();
    cell.editor.setSelectionRange(start, start + lines[index].length);
    const lineHeight = parseFloat(getComputedStyle(cell.editor).lineHeight) || 21.875;
    cell.editor.scrollTop = Math.max(0, index * lineHeight - cell.editor.clientHeight / 2);
    syncHighlightScroll(cell);
    cell.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function diagnoseWithAi(cell) {
    const result = cell.result;
    if (!result || result.ok) return toast('先运行一次，出错后再让 AI 诊断', 'info');
    const currentRun = cell.runId;
    const local = diagnoseRunError(track.id, result, cell.editor.value);
    showDiagnosis(cell, {
      ...(cell.lastDiagnosis || {}),
      title: 'AI 正在读你的代码和报错',
      summary: '结合完整代码定位根因中…',
      fixes: [],
    }, { ai: true, loading: true });
    try {
      const raw = await ai.chat(buildErrorDiagnosisPrompt({
        trackName: track.name, code: cell.editor.value, result, diagnosis: local,
      }), { timeout: 70000 });
      if (currentRun !== cell.runId) return;
      const parsed = normalizeErrorDiagnosis(raw);
      showDiagnosis(cell, {
        kind: local ? local.kind : 'AI 诊断',
        title: parsed.title,
        line: parsed.line || (local ? local.line : null),
        lineText: '',
        summary: parsed.cause,
        fixes: parsed.fixes.length ? parsed.fixes : (local ? local.fixes : []),
        patch: parsed.patch,
        prevent: parsed.prevent,
      }, { ai: true });
    } catch (error) {
      if (currentRun !== cell.runId) return;
      showDiagnosis(cell, local || unknownDiagnosis(result));
      toast(`AI 诊断失败：${error.message}`, 'bad', 6000);
    }
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

  async function installPackagesFor(cell) {
    const packages = cell.dependencyInput.value.trim();
    if (!packages) return toast('先输入要安装的包名，例如 numpy pandas', 'info');
    cell.installBtn.disabled = true;
    cell.installBtn.textContent = '安装中…';
    cell.dependencyStatus.textContent = '正在用 uv 安装到当前轨道环境…';
    try {
      const result = await window.toolbox.practice.install({ track: track.id, packages });
      if (!result.ok) {
        cell.dependencyStatus.textContent = result.error || '安装失败';
        return toast(result.error || '第三方包安装失败', 'bad', 6000);
      }
      environment = { ...environment, ...(result.environment || {}) };
      cell.dependencyStatus.textContent = result.message || '依赖已安装，可以运行代码';
      updateMeta(cell);
      toast(result.message || '第三方包已安装', 'good', 5000);
    } catch (error) {
      cell.dependencyStatus.textContent = `安装失败：${error.message}`;
      toast(`第三方包安装失败：${error.message}`, 'bad', 6000);
    } finally {
      cell.installBtn.disabled = false;
      cell.installBtn.textContent = '安装到当前环境';
    }
  }

  /** 把当前代码渲染到高亮层。末尾补一个换行，否则最后一行空行会塌掉、和文本框错位。 */
  function paintHighlight(cell) {
    if (!cell || !cell.highlightLayer) return;
    const lang = LANG_BY_TRACK[track.id] || 'python';
    cell.highlightLayer.innerHTML = `${highlight(cell.editor.value, lang)}\n`;
    syncHighlightScroll(cell);
  }

  function syncHighlightScroll(cell) {
    if (!cell || !cell.highlightLayer) return;
    cell.highlightLayer.scrollTop = cell.editor.scrollTop;
    cell.highlightLayer.scrollLeft = cell.editor.scrollLeft;
  }

  function repaintAll() {
    for (const cell of cells) paintHighlight(cell);
  }

  function createCell(code = '') {
    const cell = { id: nextCellId++, code, runId: 0, executionCount: 0 };
    cell.gutter = h('div', { class: 'practice__cell-gutter' }, 'In [ ]');
    cell.editor = h('textarea', { class: 'practice__editor', spellcheck: false, wrap: 'off' }, code);
    // 高亮层：垫在文本框底下，文本框自己的字设成透明，只留光标。
    // textarea 没法给部分文字上色，这是唯一能既保留原生输入又有配色的做法。
    cell.highlightLayer = h('pre', { class: 'practice__highlight', 'aria-hidden': 'true' });
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
    cell.editorWrap.append(cell.highlightLayer, cell.editor, cell.annotation);
    cell.lineCount = h('span', { class: 'practice__editor-meta' }, `${code.split(/\r?\n/).length} 行`);
    cell.output = h('pre', { class: 'practice__output' }, '运行结果会出现在这里。');
    cell.diagTitle = h('strong', { class: 'practice__diag-title' });
    cell.diagJump = h('button', { class: 'btn btn--sm practice__diag-jump', hidden: true, onclick: () => jumpToLine(cell) }, '定位');
    cell.diagAiBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => diagnoseWithAi(cell) }, '✦ AI 诊断');
    cell.diagSummary = h('p', { class: 'practice__diag-summary' });
    cell.diagCode = h('code', { class: 'practice__diag-code', hidden: true });
    cell.diagFixes = h('ol', { class: 'practice__diag-fixes' });
    cell.diagExtra = h('div', { class: 'practice__diag-extra' });
    cell.diagPanel = h('div', { class: 'practice__diagnosis', hidden: true },
      h('div', { class: 'practice__diag-head' },
        cell.diagTitle,
        h('span', { style: { flex: 1 } }),
        cell.diagJump,
        cell.diagAiBtn,
      ),
      cell.diagSummary,
      cell.diagCode,
      cell.diagFixes,
      cell.diagExtra,
    );
    cell.resultStatus = h('span', { class: 'practice__result-status' }, '尚未运行');
    cell.copyOutputBtn = h('button', { class: 'btn btn--icon practice__copy-output', title: '复制这个单元格的输出', onclick: () => copyCellOutput(cell) }, '⧉');
    cell.runBtn = h('button', { class: 'btn btn--primary practice__run', onclick: () => runCell(cell) }, '▶ 运行');
    cell.commentBtn = h('button', { class: 'btn practice__comment', onclick: () => addCommentsFor(cell) }, '✦ 自动注释');
    cell.dependencyInput = h('input', { class: 'field practice__dependency-input', placeholder: '例如：numpy pandas 或 beautifulsoup4==4.12.3', spellcheck: false });
    cell.installBtn = h('button', { class: 'btn btn--sm practice__install', onclick: () => installPackagesFor(cell) }, '安装到当前环境');
    cell.dependencyStatus = h('span', { class: 'faint practice__dependency-status' }, '用空格或逗号分隔；所有 Python/框架轨道共用这个 uv 学习环境');
    cell.dependencyInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') installPackagesFor(cell); });
    const explainLocalBtn = h('button', { class: 'btn practice__explain-local', onclick: () => showCurrentLineHint(cell) }, '⌁ 代码说明');
    const explainLineBtn = h('button', { class: 'btn practice__explain-line', onclick: () => explainCurrentLine(cell, true) }, '⌁ 解释当前行');
    const restoreBtn = h('button', { class: 'btn btn--ghost', onclick: () => restoreCell(cell) }, '恢复示例');
    const moveUpBtn = h('button', { class: 'btn btn--icon practice__cell-move', title: '上移单元格', onclick: () => moveCell(cell, -1) }, '↑');
    const moveDownBtn = h('button', { class: 'btn btn--icon practice__cell-move', title: '下移单元格', onclick: () => moveCell(cell, 1) }, '↓');
    cell.el = h('section', { class: 'practice__cell' },
      cell.gutter,
      h('div', { class: 'practice__cell-main' },
        h('div', { class: 'practice__pane-head' },
          h('div', {}, h('strong', {}, '代码单元格'), h('span', { class: 'faint' }, track.runtime.includes('python3') ? ' 可自由修改 · 可复用上方变量' : ' 可自由修改')),
          cell.lineCount,
        ),
        cell.editorWrap,
        h('div', { class: 'practice__actions' }, cell.runBtn, cell.commentBtn, explainLocalBtn, explainLineBtn, restoreBtn, moveUpBtn, moveDownBtn),
        h('div', { class: 'practice__latest-output' },
          h('div', { class: 'practice__pane-head' }, h('strong', {}, '输出'), h('span', { class: 'practice__output-head-actions' }, cell.resultStatus, cell.copyOutputBtn)),
          cell.output,
          cell.diagPanel,
        ),
        h('div', { class: 'practice__dependency-row' },
          h('label', { class: 'practice__dependency-label' }, '第三方依赖'),
          cell.dependencyInput,
          cell.installBtn,
          cell.dependencyStatus,
        ),
      ),
    );
    // Tab 补全 / 自动缩进 / ⌘Enter 开新行 / 括号配对。
    // 轨道用函数取，因为轨道会切，补全词表得跟着换。
    attachEditorKeys(cell.editor, () => track.id);
    cell.editor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.isComposing) {
        event.preventDefault();
        runAndAdvance(cell);
      }
    });
    cell.editor.addEventListener('focus', () => selectCell(cell));
    cell.editor.addEventListener('input', () => {
      cell.code = cell.editor.value;
      updateMeta(cell);
      persistNotebookSoon();
    });
    cell.editor.addEventListener('scroll', () => {
      placeAnnotation(cell, currentLineIndex(cell));
      syncHighlightScroll(cell);
    });
    paintHighlight(cell);
    return cell;
  }

  function restoreNotebookCell(snapshot = {}) {
    const cell = createCell(String(snapshot.code || ''));
    cell.executionCount = Number(snapshot.executionCount) || 0;
    cell.gutter.textContent = cell.executionCount ? `In [${cell.executionCount}]` : 'In [ ]';
    if (snapshot.result) {
      cell.result = snapshot.result;
      const parts = [snapshot.result.stdout, snapshot.result.stderr ? `[stderr]\n${snapshot.result.stderr}` : ''].filter(Boolean);
      cell.output.textContent = parts.join('\n\n') || snapshot.result.error || '(程序没有输出)';
      cell.resultStatus.textContent = snapshot.result.ok ? '运行成功' : '运行失败';
      cell.resultStatus.className = `practice__result-status ${snapshot.result.ok ? 'is-good' : 'is-bad'}`;
    }
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
    hideDiagnosis(cell);
    cell.annotation.setAttribute('hidden', '');
    updateMeta(cell);
    persistNotebook();
  }

  trackSelect.addEventListener('change', () => {
    persistNotebook();
    track = PRACTICE_TRACKS.find((item) => item.id === trackSelect.value) || PRACTICE_TRACKS[0];
    sampleIndex = 0;
    renderSamples();
  });
  levelSelect.addEventListener('change', () => { persistNotebook(); sampleIndex = Number(levelSelect.value); renderSamples(); });

  // ---------- 代码文件夹：把练的东西存到本机，下次接着改 ----------
  //
  // 写完就没了是最劝退的。这里挂一个真实目录，保存/打开都走主进程的
  // notebook:* 通道，那边有 realpath 收敛，写不出目录之外。
  const EXT_BY_TRACK = { sql: '.sql', linux: '.sh', textproc: '.sh', git: '.sh', matlab: '.m' };
  const extFor = (trackId) => EXT_BY_TRACK[trackId] || '.py';

  let workspaceRoot = ctx.config.get('practice.workspaceRoot', '') || '';
  const wsPath = h('span', { class: 'faint practice__ws-path' }, '未选择文件夹');
  const wsFiles = h('select', { class: 'field field--sm practice__ws-files' });
  const wsName = h('input', { class: 'field field--sm practice__ws-name', placeholder: '文件名' });

  async function refreshFiles(selectRel = '') {
    wsFiles.textContent = '';
    if (!workspaceRoot) return;
    const listed = await window.toolbox.notebook.listDir({ root: workspaceRoot, relPath: '' });
    if (!listed.ok) { wsFiles.append(h('option', { value: '' }, listed.error || '读不了这个目录')); return; }
    // 字段名是 isDir / items，别写成 isDirectory —— 写错等于没过滤，目录会混进列表
    const files = (listed.items || []).filter((e) => !e.isDir && /\.(py|sh|sql|m|txt|md)$/i.test(e.name));
    wsFiles.append(h('option', { value: '' }, files.length ? `— 选一个文件（${files.length}）—` : '（这个文件夹里还没有代码文件）'));
    for (const f of files) wsFiles.append(h('option', { value: f.relPath || f.name }, f.name));
    if (selectRel) wsFiles.value = selectRel;
  }

  async function openWorkspace() {
    const picked = await window.toolbox.notebook.pickFolder();
    if (!picked || picked.canceled) return;
    const root = picked.root || picked.path || picked;
    if (typeof root !== 'string') return toast('没拿到文件夹路径', 'bad');
    workspaceRoot = root;
    await ctx.config.set('practice.workspaceRoot', root);
    wsPath.textContent = root.replace(/^.*\//, '📁 ');
    wsPath.title = root;
    await refreshFiles();
    toast('文件夹已挂上，保存的代码会放这儿', 'good');
  }

  async function loadPicked() {
    const rel = wsFiles.value;
    if (!rel || !workspaceRoot) return;
    const r = await window.toolbox.notebook.readFile({ root: workspaceRoot, relPath: rel });
    if (!r.ok) return toast(r.error || '读不出来', 'bad');
    const cell = activeCell || cells[0];
    if (!cell) return;
    cell.editor.value = r.code || '';
    cell.code = cell.editor.value;
    updateMeta(cell);
    persistNotebook();
    wsName.value = rel;
    toast(`已载入 ${rel}`, 'good');
  }

  async function saveCurrent() {
    if (!workspaceRoot) return toast('先点「打开文件夹」挑一个存放位置', 'info');
    const cell = activeCell || cells[0];
    if (!cell || !cell.editor.value.trim()) return toast('这个单元格是空的', 'info');
    let name = wsName.value.trim();
    if (!name) {
      const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '').replace(' ', '_');
      name = `${track.id}_${stamp}${extFor(track.id)}`;
    }
    if (!/\.\w+$/.test(name)) name += extFor(track.id);
    const r = await window.toolbox.notebook.writeFile({ root: workspaceRoot, relPath: name, content: cell.editor.value });
    if (!r.ok) return toast(r.error || '保存失败', 'bad');
    wsName.value = r.relPath || name;
    await refreshFiles(r.relPath || name);
    toast(`已保存到 ${r.relPath || name}`, 'good');
  }

  let terminalHistory = [];
  let terminalCommandHistory = [];
  let terminalHistoryIndex = 0;
  const terminalCommand = h('textarea', { class: 'practice__terminal-input', rows: '2', spellcheck: false, placeholder: '例如：uv pip install numpy\n也可以输入 python -c "import numpy; print(numpy.__version__)"' }, 'uv --version');
  const terminalOutput = h('pre', { class: 'practice__terminal-output' }, '共享学习终端已就绪。');
  const terminalStatus = h('span', { class: 'faint practice__terminal-status' }, '工作目录：共享学习环境');
  const terminalRunBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: runTerminal }, '▶ 执行');

  function renderTerminalHistory() {
    if (!terminalHistory.length) {
      terminalOutput.textContent = '共享学习终端已就绪。';
      return;
    }
    terminalOutput.textContent = terminalHistory.map((entry) => {
      const output = [entry.result.stdout?.trimEnd(), entry.result.stderr ? `[stderr]\n${entry.result.stderr.trimEnd()}` : ''].filter(Boolean).join('\n\n');
      return `$ ${entry.command}\n${output || (entry.result.ok ? '(没有输出)' : entry.result.error || '(命令失败)')}`;
    }).join('\n\n');
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  async function runTerminal() {
    const command = terminalCommand.value.trim();
    if (!command) return toast('先输入一条终端命令', 'info');
    if (terminalCommandHistory[terminalCommandHistory.length - 1] !== command) terminalCommandHistory.push(command);
    terminalHistoryIndex = terminalCommandHistory.length;
    terminalRunBtn.disabled = true;
    terminalStatus.textContent = '执行中…';
    try {
      const result = await window.toolbox.practice.terminal({ command });
      terminalHistory.push({ command, result });
      terminalHistory = terminalHistory.slice(-40);
      renderTerminalHistory();
      environment = { ...environment, ...(result.environment || {}) };
      terminalStatus.textContent = result.ok ? `完成 · ${result.duration || 0} ms · ${result.cwd || '共享学习环境'}` : `失败 · ${result.error || result.stderr || '请查看输出'}`;
      updateMeta();
    } catch (error) {
      terminalHistory.push({ command, result: { ok: false, error: error.message } });
      renderTerminalHistory();
      terminalStatus.textContent = `终端错误：${error.message}`;
    } finally { terminalRunBtn.disabled = false; }
  }

  function clearTerminal() {
    terminalHistory = [];
    terminalCommandHistory = [];
    terminalHistoryIndex = 0;
    renderTerminalHistory();
    terminalStatus.textContent = '工作目录：共享学习环境';
  }

  function notebookSource(value) {
    const lines = String(value || '').split('\n');
    return lines.map((line, index) => index < lines.length - 1 ? `${line}\n` : line);
  }

  function notebookOutput(cell) {
    const result = cell.result;
    if (!result) return [];
    const outputs = [];
    if (result.stdout) outputs.push({ name: 'stdout', output_type: 'stream', text: notebookSource(result.stdout) });
    if (result.stderr) outputs.push({ name: 'stderr', output_type: 'stream', text: notebookSource(result.stderr) });
    return outputs;
  }

  async function exportNotebook() {
    const document = {
      cells: cells.map((cell) => ({
        cell_type: 'code',
        execution_count: cell.executionCount || null,
        metadata: {},
        outputs: notebookOutput(cell),
        source: notebookSource(cell.editor.value),
      })),
      metadata: {
        kernelspec: { display_name: 'Agent Toolbox · uv learning', language: 'python', name: 'python3' },
        language_info: { name: 'python', version: '3.12' },
        agent_toolbox: { track: track.id, title: track.name },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
    const result = await window.toolbox.files.saveText({ content: JSON.stringify(document, null, 2), extension: 'ipynb', defaultName: `${track.id}-学习.ipynb` });
    if (result.ok) toast(`Notebook 已导出：${result.path}`, 'good', 5000);
  }

  function importedOutput(cell, outputs) {
    const parts = [];
    for (const output of Array.isArray(outputs) ? outputs : []) {
      if (output.output_type === 'stream') parts.push(Array.isArray(output.text) ? output.text.join('') : String(output.text || ''));
      else if (output.data?.['text/plain']) parts.push(Array.isArray(output.data['text/plain']) ? output.data['text/plain'].join('') : String(output.data['text/plain']));
      else if (output.ename || output.evalue) parts.push(`${output.ename || 'Error'}: ${output.evalue || ''}`);
    }
    if (!parts.length) return;
    cell.output.textContent = parts.join('\n');
    cell.resultStatus.textContent = '已导入输出';
    cell.resultStatus.className = 'practice__result-status is-good';
    cell.result = { ok: true, stdout: parts.join('\n'), stderr: '', engine: 'ipynb', duration: 0 };
    cell.executionCount = Number(cell.executionCount) || 0;
    cell.gutter.textContent = cell.executionCount ? `In [${cell.executionCount}]` : 'In [ ]';
  }

  async function importNotebook() {
    const picked = await window.toolbox.files.pickText({ title: '导入 Jupyter Notebook' });
    if (!picked || picked.canceled) return;
    if (!picked.ok) return toast(picked.error || 'Notebook 读取失败', 'bad');
    let document;
    try { document = JSON.parse(picked.content); } catch { return toast('这不是有效的 JSON / ipynb 文件', 'bad'); }
    const imported = Array.isArray(document.cells)
      ? document.cells.filter((item) => item.cell_type === 'code').slice(0, 100)
      : [];
    if (!imported.length) return toast('Notebook 里没有可运行的代码单元格', 'info');
    cells = imported.map((item) => {
      const source = Array.isArray(item.source) ? item.source.join('') : String(item.source || '');
      const cell = createCell(source);
      cell.executionCount = Number(item.execution_count) || 0;
      cell.gutter.textContent = cell.executionCount ? `In [${cell.executionCount}]` : 'In [ ]';
      importedOutput(cell, item.outputs);
      return cell;
    });
    renderNotebook(cells[0], false);
    persistNotebook();
    toast(`已导入 ${cells.length} 个代码单元格：${picked.name}`, 'good', 5000);
  }

  terminalCommand.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' && !event.shiftKey && terminalCommandHistory.length && terminalCommand.selectionStart === 0 && terminalCommand.selectionEnd === 0) {
      event.preventDefault();
      terminalHistoryIndex = Math.max(0, terminalHistoryIndex - 1);
      terminalCommand.value = terminalCommandHistory[terminalHistoryIndex] || '';
      return;
    }
    if (event.key === 'ArrowDown' && !event.shiftKey && terminalCommandHistory.length && terminalCommand.selectionStart === terminalCommand.value.length && terminalCommand.selectionEnd === terminalCommand.value.length) {
      event.preventDefault();
      terminalHistoryIndex = Math.min(terminalCommandHistory.length, terminalHistoryIndex + 1);
      terminalCommand.value = terminalCommandHistory[terminalHistoryIndex] || '';
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      runTerminal();
    }
  });

  const terminalPanel = h('details', { class: 'practice__terminal-panel', open: true },
    h('summary', {}, h('strong', {}, '学习终端'), h('span', { class: 'faint' }, 'uv / python / pip · python 指向共享 .venv')),
    h('div', { class: 'practice__terminal-body' },
      h('div', { class: 'practice__terminal-toolbar' }, terminalCommand, h('div', { class: 'practice__terminal-actions' }, terminalRunBtn, h('button', { class: 'btn btn--sm', onclick: clearTerminal }, '清空'))),
      h('div', { class: 'practice__terminal-meta' }, terminalStatus, h('span', { class: 'faint' }, '⌘/Ctrl + Enter 执行')),
      terminalOutput,
      h('div', { class: 'practice__terminal-hint' }, '推荐：先执行 `uv --version`，再执行 `uv pip install 包名`。输入包名时不要带 `--index-url` 等参数。'),
    ),
  );

  const workspaceBar = h('div', { class: 'practice__workspace-bar' },
    h('button', { class: 'btn btn--sm', onclick: openWorkspace }, '📁 打开文件夹'),
    wsPath,
    wsFiles,
    h('button', { class: 'btn btn--sm', onclick: loadPicked }, '载入'),
    h('span', { style: { flex: 1 } }),
    wsName,
    h('button', { class: 'btn btn--sm btn--primary', onclick: saveCurrent }, '保存到本地'),
  );
  const workspacePanel = h('details', { class: 'practice__workspace-panel' },
    h('summary', {}, h('strong', {}, '高级：项目文件夹'), h('span', { class: 'faint' }, '需要多文件联动时再展开')),
    workspaceBar,
  );
  wsFiles.addEventListener('change', () => { if (wsFiles.value) wsName.value = wsFiles.value; });
  if (workspaceRoot) {
    wsPath.textContent = workspaceRoot.replace(/^.*\//, '📁 ');
    wsPath.title = workspaceRoot;
    refreshFiles();
  }

  const el = h('div', { class: 'practice' },
    h('div', { class: 'practice__head' },
      h('label', {}, h('span', { class: 'practice__label' }, '领域'), trackSelect),
      h('label', {}, h('span', { class: 'practice__label' }, '练习'), levelSelect),
    ),
    h('div', { class: 'practice__info-row' },
      description,
      setupBtn,
      runtimeStatus,
    ),
    terminalPanel,
    workspacePanel,
    h('div', { class: 'practice__notebook' },
      h('div', { class: 'practice__notebook-toolbar' },
        h('div', {}, h('strong', {}, 'Notebook 单元格'), h('span', { class: 'faint' }, ' 运行后输出会留在对应单元格，可继续向下添加')),
        h('div', { class: 'practice__cell-controls' },
          runAllBtn,
          h('button', { class: 'btn btn--sm', title: '清空所有单元格输出和执行编号', onclick: clearOutputs }, '清空输出'),
          h('button', { class: 'btn btn--sm', title: '导入 Jupyter Notebook 文件', onclick: importNotebook }, '导入 .ipynb'),
          h('button', { class: 'btn btn--sm', title: '导出当前单元格和输出为 Jupyter Notebook', onclick: exportNotebook }, '导出 .ipynb'),
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
