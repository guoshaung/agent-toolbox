import { h, toast } from '../../core/ui.js';
import {
  buildPracticeExplainPrompt,
  explainPracticeLine,
  normalizePracticeAiResult,
} from './practice-assist.js';

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
  let runId = 0;
  let annotationRunId = 0;

  const trackSelect = h('select', { class: 'field practice__track-select' }, ...PRACTICE_TRACKS.map((item) => h('option', { value: item.id }, `${item.icon} ${item.name}`)));
  const levelSelect = h('select', { class: 'field practice__sample-select' });
  const editor = h('textarea', { class: 'practice__editor', spellcheck: false, wrap: 'off' });
  const editorWrap = h('div', { class: 'practice__editor-wrap' });
  const annotation = h('aside', { class: 'practice__annotation', hidden: true });
  const annotationTitle = h('strong', { class: 'practice__annotation-title' });
  const annotationLine = h('code', { class: 'practice__annotation-line' });
  const annotationBody = h('p', { class: 'practice__annotation-body' });
  const annotationWhy = h('p', { class: 'practice__annotation-why' });
  const annotationActions = h('div', { class: 'practice__annotation-actions' });
  annotation.append(
    h('div', { class: 'practice__annotation-head' }, annotationTitle, h('span', { class: 'practice__annotation-close', onclick: () => annotation.setAttribute('hidden', '') }, '×')),
    annotationLine,
    annotationBody,
    annotationWhy,
    annotationActions,
  );
  const output = h('pre', { class: 'practice__output' }, '运行结果会出现在这里。');
  const resultStatus = h('span', { class: 'practice__result-status' }, '尚未运行');
  const runtimeStatus = h('span', { class: 'practice__runtime-status' }, '检测中…');
  const lineCount = h('span', { class: 'practice__line-count' }, '0 行');
  const runBtn = h('button', { class: 'btn btn--primary practice__run', onclick: run }, '▶ 运行');
  const commentBtn = h('button', { class: 'btn practice__comment', onclick: addComments }, '✦ 自动注释');

  function currentSample() { return track.samples[sampleIndex] || track.samples[0]; }

  function renderSamples() {
    levelSelect.replaceChildren(...track.samples.map((item, index) => h('option', { value: String(index) }, `${item.level} · ${item.title}`)));
    levelSelect.value = String(sampleIndex);
    editor.value = currentSample().code;
    updateMeta();
    showCurrentLineHint();
  }

  function updateMeta() {
    lineCount.textContent = `${editor.value.split(/\r?\n/).length} 行`;
    runtimeStatus.textContent = track.id === 'sql'
      ? environment.sqlite3 ? '本地 SQLite · MySQL 常用子集' : 'SQLite 未安装'
      : track.id === 'matlab'
        ? environment.matlab || environment.octave ? `可运行 · ${environment.matlab ? 'MATLAB' : 'Octave'}` : '需要安装 MATLAB / Octave'
        : track.id === 'linux'
          ? environment.bash ? 'bash 已就绪' : 'bash 未找到'
          : environment.python ? track.id === 'requests' ? 'python3 + requests 已就绪' : 'python3 已就绪' : 'python3 未找到';
  }

  function currentLineIndex() {
    return editor.value.slice(0, editor.selectionStart || 0).split(/\r?\n/).length - 1;
  }

  function currentContext(lineIndex) {
    const lines = editor.value.split(/\r?\n/);
    return lines.slice(Math.max(0, lineIndex - 2), Math.min(lines.length, lineIndex + 3)).join('\n');
  }

  function placeAnnotation(lineIndex) {
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 21.875;
    const wrapHeight = editorWrap.clientHeight || 360;
    const noteHeight = annotation.offsetHeight || 174;
    const rawTop = 12 + lineIndex * lineHeight - editor.scrollTop;
    annotation.style.top = `${Math.max(8, Math.min(rawTop, Math.max(8, wrapHeight - noteHeight - 8)))}px`;
  }

  function showAnnotation(note, lineIndex) {
    annotationTitle.textContent = note.title;
    annotationLine.textContent = `${lineIndex + 1}  ${editor.value.split(/\r?\n/)[lineIndex] || ''}`;
    annotationBody.textContent = `${note.syntax ? `语法：${note.syntax}。` : ''}${note.explanation}`;
    annotationWhy.textContent = note.why ? `为什么：${note.why}` : '';
    annotationActions.replaceChildren();
    if (note.url) annotationActions.append(h('button', { class: 'btn btn--sm', onclick: () => openDocs(note.url) }, '打开文档区'));
    if (note.docQuery && !note.url) annotationActions.append(h('button', { class: 'btn btn--sm', onclick: () => openDocs(`https://www.google.com/search?q=${encodeURIComponent(note.docQuery)}`) }, '去文档区搜索'));
    annotationActions.append(h('button', { class: 'btn btn--sm btn--primary', onclick: () => explainCurrentLine(true) }, 'AI 解释当前行'));
    annotation.removeAttribute('hidden');
    requestAnimationFrame(() => placeAnnotation(lineIndex));
  }

  function openDocs(url) {
    ctx.goto('docs');
    setTimeout(() => window.dispatchEvent(new CustomEvent('toolbox:open-url', { detail: { url } })), 80);
    toast('已在文档区打开相关资料', 'good');
  }

  function showCurrentLineHint() {
    annotationRunId += 1;
    const lineIndex = currentLineIndex();
    const line = editor.value.split(/\r?\n/)[lineIndex] || '';
    if (!line.trim()) {
      annotation.setAttribute('hidden', '');
      return;
    }
    const local = explainPracticeLine(track.id, line);
    showAnnotation(local || {
      title: '这一行还没有本地规则说明',
      syntax: track.id === 'python' || track.id === 'requests' ? 'Python 语法' : `${track.name} 语法`,
      explanation: '它会保留在当前行，点击 AI 解释可以结合上下文讲清楚输入、输出和运行时行为。',
      why: '先定位这一行的职责，再运行程序验证猜测。',
    }, lineIndex);
  }

  async function explainCurrentLine(force = false) {
    const lineIndex = currentLineIndex();
    const line = editor.value.split(/\r?\n/)[lineIndex] || '';
    if (!line.trim()) return toast('先把光标放到要解释的代码行', 'info');
    if (!force && explainPracticeLine(track.id, line)) return showCurrentLineHint();
    const currentRequest = ++annotationRunId;
    const note = { title: 'AI 正在解释当前行', syntax: '', explanation: '正在结合附近代码分析…', why: '' };
    showAnnotation(note, lineIndex);
    annotation.classList.add('is-loading');
    try {
      const raw = await ai.chat(buildPracticeExplainPrompt({ trackName: track.name, line, context: currentContext(lineIndex) }), { timeout: 70000 });
      if (currentRequest !== annotationRunId) return;
      showAnnotation(normalizePracticeAiResult(raw, line), lineIndex);
    } catch (error) {
      if (currentRequest !== annotationRunId) return;
      showAnnotation({ title: 'AI 解释失败', syntax: '', explanation: error.message, why: '本地语法提示仍然保留；可以检查 AI 接口或先运行代码。' }, lineIndex);
    } finally { annotation.classList.remove('is-loading'); }
  }

  async function run() {
    const currentRun = ++runId;
    runBtn.disabled = true;
    output.textContent = '正在启动本机运行环境…';
    resultStatus.textContent = '运行中…';
    resultStatus.className = 'practice__result-status is-running';
    try {
      const result = await window.toolbox.practice.run({ track: track.id, code: editor.value, timeout: 12000 });
      if (currentRun !== runId) return;
      resultStatus.textContent = statusLabel(result);
      resultStatus.className = `practice__result-status ${result.ok ? 'is-good' : 'is-bad'}`;
      const parts = [];
      if (result.stdout) parts.push(result.stdout.trimEnd());
      if (result.stderr) parts.push(`[stderr]\n${result.stderr.trimEnd()}`);
      if (!parts.length) parts.push(result.ok ? '(程序没有输出)' : '(没有输出，检查错误信息)');
      output.textContent = `${parts.join('\n\n')}\n\n[${result.engine || track.runtime}] ${result.duration || 0} ms`;
    } catch (error) {
      resultStatus.textContent = '运行器错误';
      resultStatus.className = 'practice__result-status is-bad';
      output.textContent = error.message;
    } finally { runBtn.disabled = false; }
  }

  async function addComments() {
    if (!editor.value.trim()) return toast('先写一点代码，再让 AI 加注释', 'info');
    commentBtn.disabled = true;
    const before = editor.value;
    output.textContent = 'AI 正在根据当前代码补充注释…';
    try {
      const prompt = `请给下面的${track.name}练习代码补充少量高价值中文注释。只返回完整代码，不要 markdown 代码块；保留原逻辑、不要修改代码、不要添加长篇说明。代码：\n<<<\n${before}\n>>>`;
      const result = await ai.chat(prompt, { timeout: 70000 });
      editor.value = String(result || '').replace(/^```[\w-]*\s*/i, '').replace(/\s*```$/i, '').trim();
      updateMeta();
      output.textContent = '注释已加入。请检查后再运行，运行结果仍以本机解释器为准。';
    } catch (error) { output.textContent = `自动注释失败：${error.message}`; }
    finally { commentBtn.disabled = false; }
  }

  trackSelect.addEventListener('change', () => {
    track = PRACTICE_TRACKS.find((item) => item.id === trackSelect.value) || PRACTICE_TRACKS[0];
    sampleIndex = 0;
    renderSamples();
    annotation.setAttribute('hidden', '');
  });
  levelSelect.addEventListener('change', () => { sampleIndex = Number(levelSelect.value); editor.value = currentSample().code; updateMeta(); showCurrentLineHint(); });
  editor.addEventListener('input', () => { updateMeta(); showCurrentLineHint(); });
  editor.addEventListener('click', showCurrentLineHint);
  editor.addEventListener('keyup', showCurrentLineHint);
  editor.addEventListener('scroll', () => placeAnnotation(currentLineIndex()));

  const explainLineBtn = h('button', { class: 'btn practice__explain-line', onclick: () => explainCurrentLine(true) }, '⌁ 解释当前行');

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
      h('span', { class: 'practice__description' }, track.description),
      runtimeStatus,
    ),
    h('div', { class: 'practice__workbench' },
      h('section', { class: 'practice__code-pane' },
        h('div', { class: 'practice__pane-head' },
          h('div', {}, h('strong', {}, '编辑区'), h('span', { class: 'faint' }, ' 可自由修改')),
          h('span', { class: 'practice__editor-meta' }, lineCount),
        ),
        editorWrap,
        h('div', { class: 'practice__actions' },
          runBtn,
          commentBtn,
          explainLineBtn,
          h('button', { class: 'btn btn--ghost', onclick: () => { editor.value = currentSample().code; updateMeta(); } }, '恢复示例'),
        ),
      ),
      h('section', { class: 'practice__result-pane' },
        h('div', { class: 'practice__pane-head' }, h('strong', {}, '运行结果'), resultStatus),
        output,
        h('div', { class: 'practice__result-note' }, '结果来自本机运行环境。网络练习受网络状态影响；MATLAB/Octave 需自行安装。'),
      ),
    ),
  );

  window.toolbox.practice.environment().then((value) => { environment = value || {}; updateMeta(); });
  editorWrap.append(editor, annotation);
  renderSamples();
  return { el };
}
