import { resolveSkin } from './skins.js';
import { createSupplementState } from './supplement-state.mjs';
import { createFontLevelState } from './font-level.mjs';
import { createMemory, memoryToMarkdown, isToolNoise } from './memory.js';

const shell = document.getElementById('shell');
const avatar = document.getElementById('avatar');
const skin = document.getElementById('skin');
const card = document.getElementById('card');
const dragbar = document.getElementById('dragbar');
const code = document.getElementById('code');
const language = document.getElementById('language');
const stuck = document.getElementById('stuck');
const explain = document.getElementById('explain');
const status = document.getElementById('status');
const answer = document.getElementById('answer');
const trace = document.getElementById('trace');
const goSettings = document.getElementById('go-settings');
const supplementToggle = document.getElementById('supplement-toggle');
const supplementPanel = document.getElementById('supplement');
const supplementState = createSupplementState(false);
const fontMinus = document.getElementById('font-minus');
const fontPlus = document.getElementById('font-plus');
const fontState = createFontLevelState('comfortable', (level) => window.toolbox.config.set('pet.fontLevel', level));

let expanded = false;
let dragging = false;
let moved = false;
let start;

function applyFontLevel() {
  document.documentElement.dataset.fontLevel = fontState.level;
  fontMinus.disabled = !fontState.canDecrease;
  fontPlus.disabled = !fontState.canIncrease;
}

function applySettings(settings) {
  skin.src = resolveSkin(settings);
  fontState.set(settings.fontLevel || 'comfortable', { persist: false });
  applyFontLevel();
}

/** mode: false 收起 | 'card' 四行解释 | 'memory' 记忆栈 */
async function setExpanded(mode) {
  expanded = mode;
  await window.toolbox.pet.resize(mode);
  shell.classList.toggle('is-expanded', Boolean(mode));
  avatar.hidden = Boolean(mode);
  card.hidden = mode !== 'card';
  memoryEl.hidden = mode !== 'memory';
  if (mode === 'card') {
    const state = await window.toolbox.pet.getState();
    applySettings(state.settings);
    if (state.clipboard.trim()) code.value = state.clipboard;
    code.focus();
  }
  if (mode === 'memory') {
    await memory.load();
    renderList();
    searchInput.focus();
  }
}

function collapseView() {
  expanded = false;
  shell.classList.remove('is-expanded');
  avatar.hidden = false;
  card.hidden = true;
  memoryEl.hidden = true;
}

function beginDrag(event) {
  if (event.button !== 0 || event.target.closest('.header__actions')) return;
  dragging = true;
  moved = false;
  start = { pointerX: event.screenX, pointerY: event.screenY, windowX: window.screenX, windowY: window.screenY };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function drag(event) {
  if (!dragging) return;
  const dx = event.screenX - start.pointerX;
  const dy = event.screenY - start.pointerY;
  if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
  window.toolbox.pet.move({ x: start.windowX + dx, y: start.windowY + dy });
}

async function endDrag() {
  if (!dragging) return;
  dragging = false;
  if (moved) await window.toolbox.pet.endDrag();
}

for (const target of [avatar, dragbar]) {
  target.addEventListener('pointerdown', beginDrag);
  target.addEventListener('pointermove', drag);
  target.addEventListener('pointerup', endDrag);
  target.addEventListener('pointercancel', endDrag);
}
// 点桌宠默认开记忆栈——这才是现在的主功能，四行解释退到里面的一个按钮。
avatar.addEventListener('click', () => { if (!moved) setExpanded('memory'); });
document.getElementById('collapse').addEventListener('click', () => setExpanded(false));
document.getElementById('disable').addEventListener('click', async () => {
  await setExpanded(false);
  await window.toolbox.pet.setEnabled(false);
});
document.getElementById('paste').addEventListener('click', async () => { code.value = await window.toolbox.clipboard.read(); });

function setSupplementExpanded(value) {
  supplementState.set(value);
  supplementPanel.hidden = !supplementState.expanded;
  supplementToggle.textContent = supplementState.expanded ? '收起详细拆解 ↑' : '查看语法拆解与例子 ↓';
  supplementToggle.setAttribute('aria-expanded', String(supplementState.expanded));
}

function renderAnswer(text, supplement) {
  supplement ||= {
    syntax: '本段没有识别出需要额外拆解的特殊语法。',
    knowledge: '仅从当前代码无法确定更深的核心概念。',
    example: '当前信息不足，暂不提供可能误导的例子。',
    relation: '需点击向上一层追溯。',
  };
  answer.replaceChildren(...String(text).split('\n').slice(0, 4).map((line) => {
    const split = line.indexOf('：');
    const row = document.createElement('div');
    row.className = 'answer__line';
    const label = document.createElement('b');
    label.textContent = split >= 0 ? line.slice(0, split) : '';
    const value = document.createElement('span');
    value.textContent = split >= 0 ? line.slice(split + 1) : line;
    row.append(label, value);
    return row;
  }));
  document.getElementById('detail-syntax').textContent = supplement.syntax;
  document.getElementById('detail-knowledge').textContent = supplement.knowledge;
  document.getElementById('detail-example').textContent = supplement.example;
  document.getElementById('detail-relation').textContent = supplement.relation;
  setSupplementExpanded(false);
  answer.hidden = false;
  supplementToggle.hidden = false;
  trace.hidden = false;
  requestAnimationFrame(() => supplementToggle.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}

async function requestExplanation(isTrace = false) {
  if (!code.value.trim()) {
    status.textContent = '请先复制或粘贴一小段代码。';
    status.className = 'status is-error';
    return;
  }
  explain.disabled = true;
  trace.disabled = true;
  status.className = 'status';
  goSettings.hidden = true;
  answer.hidden = true;
  supplementToggle.hidden = true;
  supplementPanel.hidden = true;
  trace.hidden = true;
  status.textContent = isTrace ? '正在追溯一层…' : '正在快速解释…';
  const result = await window.toolbox.pet.explain({
    code: code.value, language: language.value, stuck: stuck.value, trace: isTrace,
  });
  explain.disabled = false;
  trace.disabled = false;
  if (!result.ok) {
    status.textContent = result.error;
    status.className = 'status is-error';
    goSettings.hidden = result.code !== 'missing-config';
    return;
  }
  renderAnswer(result.text, result.supplement);
  status.textContent = isTrace
    ? '已追溯一层；不会继续自动扩展。'
    : '快速结论已生成；下方按钮可查看语法拆解与例子。';
}

goSettings.addEventListener('click', () => window.toolbox.pet.openAiSettings());
supplementToggle.addEventListener('click', () => setSupplementExpanded(!supplementState.expanded));
fontMinus.addEventListener('click', () => {
  fontState.decrease();
  applyFontLevel();
});
fontPlus.addEventListener('click', () => {
  fontState.increase();
  applyFontLevel();
});

explain.addEventListener('click', () => requestExplanation(false));
trace.addEventListener('click', async () => {
  const clipboard = await window.toolbox.clipboard.read();
  if (clipboard.trim() && clipboard.trim() !== code.value.trim()) code.value = clipboard;
  requestExplanation(true);
});

window.toolbox.pet.onSettingsChanged(applySettings);
window.toolbox.pet.onCollapse(collapseView);
window.toolbox.pet.getState().then(({ settings }) => applySettings(settings));

// ================= 记忆栈 =================

const memoryEl = document.getElementById('memory');
const memList = document.getElementById('mem-list');
const memDetail = document.getElementById('mem-detail');
const memCount = document.getElementById('mem-count');
const searchInput = document.getElementById('mem-search');
const alphaInput = document.getElementById('mem-alpha');
const sessionPane = document.getElementById('mem-session');
const sourceSelect = document.getElementById('mem-source');
const sessionSelect = document.getElementById('mem-sessions');
const turnsEl = document.getElementById('mem-turns');
const onlyAssistant = document.getElementById('mem-only-assistant');

const memory = createMemory(window.toolbox.config);
let activeId = null;
let loadedTurns = [];

// 别去切本地化字符串：月份一位数还是两位数，切出来的位置就不一样。
const fmtTime = (ms) => new Date(ms).toLocaleString('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function renderList() {
  const list = memory.search(searchInput.value);
  memList.replaceChildren();
  memCount.textContent = searchInput.value.trim()
    ? `命中 ${list.length} / 共 ${memory.all().length} 条`
    : `共 ${memory.all().length} 条`;

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'memory__empty';
    empty.textContent = memory.all().length
      ? '没搜到。换个词试试。'
      : '还什么都没吃。在 Codex / Claude 里复制一段，点「吃剪贴板」；或者点「从会话里吃…」直接从本机会话记录里挑。';
    memList.appendChild(empty);
    memDetail.replaceChildren();
    return;
  }

  for (const item of list) {
    const row = document.createElement('div');
    row.className = `memory__item${item.id === activeId ? ' is-active' : ''}`;
    const title = document.createElement('div');
    title.className = 'memory__item-title';
    title.textContent = `${item.starred ? '★ ' : ''}${item.title}`;
    const meta = document.createElement('div');
    meta.className = 'memory__item-meta';
    meta.append(
      Object.assign(document.createElement('span'), { textContent: item.source }),
      Object.assign(document.createElement('span'), { textContent: fmtTime(item.at) }),
    );
    row.append(title, meta);
    row.addEventListener('click', () => { activeId = item.id; renderList(); renderDetail(); });
    memList.appendChild(row);
  }
  if (!list.some((it) => it.id === activeId)) activeId = list[0].id;
  renderDetail();
}

function renderDetail() {
  const item = memory.all().find((it) => it.id === activeId);
  memDetail.replaceChildren();
  if (!item) return;

  const head = document.createElement('div');
  head.className = 'memory__detail-head';
  const title = document.createElement('div');
  title.className = 'memory__detail-title';
  title.textContent = item.title;

  const star = document.createElement('button');
  star.textContent = item.starred ? '★' : '☆';
  star.title = '置顶';
  star.addEventListener('click', async () => { await memory.toggleStar(item.id); renderList(); });

  const copy = document.createElement('button');
  copy.textContent = '复制';
  copy.addEventListener('click', () => window.toolbox.clipboard.write(item.text));

  const del = document.createElement('button');
  del.textContent = '删';
  del.addEventListener('click', async () => { await memory.remove(item.id); activeId = null; renderList(); });

  for (const b of [star, copy, del]) b.className = 'memory__mini';
  head.append(title, star, copy, del);

  const meta = document.createElement('div');
  meta.className = 'memory__detail-meta';
  meta.textContent = [item.source, item.role, fmtTime(item.at), item.cwd].filter(Boolean).join(' · ');

  const body = document.createElement('div');
  body.className = 'memory__detail-text';
  body.textContent = item.text;

  const note = document.createElement('textarea');
  note.className = 'memory__detail-note';
  note.placeholder = '写点批注：当时为什么觉得这段有用';
  note.value = item.note || '';
  note.addEventListener('change', () => memory.setNote(item.id, note.value));

  memDetail.append(head, meta, body, note);
}

function applyAlpha(value) {
  memoryEl.style.setProperty('--mem-alpha', String(value));
}

async function initMemory() {
  const saved = await window.toolbox.config.get('memory.alpha', 0.82);
  alphaInput.value = String(saved);
  applyAlpha(saved);
  alphaInput.addEventListener('input', () => applyAlpha(Number(alphaInput.value)));
  alphaInput.addEventListener('change', () => window.toolbox.config.set('memory.alpha', Number(alphaInput.value)));

  memory.onChange(() => { /* 渲染由调用处控制，避免搜索时被打断 */ });
  searchInput.addEventListener('input', renderList);

  document.getElementById('mem-collapse').addEventListener('click', () => setExpanded(false));
  document.getElementById('mem-card').addEventListener('click', () => setExpanded('card'));

  document.getElementById('mem-eat-clip').addEventListener('click', async () => {
    const text = await window.toolbox.clipboard.read();
    if (!text || !text.trim()) return;
    const item = await memory.eat({ text, source: '剪贴板' });
    activeId = item ? item.id : activeId;
    renderList();
  });

  document.getElementById('mem-to-notebook').addEventListener('click', async () => {
    const list = memory.search(searchInput.value);
    if (!list.length) return;
    const snippets = (await window.toolbox.config.get('notebook.snippets')) || [];
    const snippet = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      title: searchInput.value.trim() ? `记忆栈 · ${searchInput.value.trim()}` : '记忆栈',
      code: memoryToMarkdown(list, searchInput.value.trim() || '记忆栈'),
      kind: 'markdown',
      createdAt: Date.now(),
    };
    await window.toolbox.config.set('notebook.snippets', [snippet, ...snippets].slice(0, 60));
    await window.toolbox.config.set('notebook.currentId', snippet.id);
  });

  document.getElementById('mem-open-session').addEventListener('click', openSessionPicker);
  document.getElementById('mem-session-close').addEventListener('click', () => { sessionPane.hidden = true; });
  sourceSelect.addEventListener('change', loadSessionList);
  sessionSelect.addEventListener('change', loadTurns);
  onlyAssistant.addEventListener('change', renderTurns);
  document.getElementById('mem-eat-checked').addEventListener('click', eatChecked);
}

async function openSessionPicker() {
  sessionPane.hidden = false;
  if (sourceSelect.options.length) return;
  const sources = await window.toolbox.chat.sources();
  sourceSelect.replaceChildren(...Object.entries(sources).map(([id, label]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    return opt;
  }));
  await loadSessionList();
}

async function loadSessionList() {
  sessionSelect.replaceChildren();
  turnsEl.replaceChildren();
  const list = await window.toolbox.chat.list(sourceSelect.value);
  if (!Array.isArray(list) || !list.length) return;
  // 只列最近 60 条，再多下拉框就没法用了
  for (const session of list.slice(0, 60)) {
    const opt = document.createElement('option');
    opt.value = session.id;
    // updatedAt 是 ISO 串，定长，切片安全
    opt.textContent = `${String(session.updatedAt || '').slice(5, 16).replace('T', ' ')} · ${session.title}`;
    sessionSelect.appendChild(opt);
  }
  await loadTurns();
}

async function loadTurns() {
  turnsEl.replaceChildren();
  if (!sessionSelect.value) return;
  const note = document.createElement('div');
  note.className = 'memory__empty';
  note.textContent = '正在读会话…';
  turnsEl.appendChild(note);

  const session = await window.toolbox.chat.load(sourceSelect.value, sessionSelect.value, true);
  const label = sourceSelect.options[sourceSelect.selectedIndex]?.textContent || sourceSelect.value;
  loadedTurns = (session?.messages || [])
    // developer / system 是喂给模型的指令，不是你和它的对话
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && !isToolNoise(m.content))
    .map((m, i) => ({
      idx: i,
      role: m.role,
      text: m.content,
      at: m.createdAt ? Date.parse(m.createdAt) || Date.now() : Date.now(),
      source: label,
      sessionId: session.id,
      cwd: session.cwd || '',
    }));
  renderTurns();
}

function renderTurns() {
  turnsEl.replaceChildren();
  const rows = loadedTurns.filter((t) => !onlyAssistant.checked || t.role === 'assistant');
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'memory__empty';
    empty.textContent = loadedTurns.length
      ? '这条会话里没有回答（Claude 的旧记录只存了你的提问）。取消「只看回答」可以看提问。'
      : '这条会话是空的，换一条。';
    turnsEl.appendChild(empty);
    return;
  }
  for (const turn of rows) {
    const row = document.createElement('label');
    row.className = 'memory__turn';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.idx = String(turn.idx);
    const body = document.createElement('div');
    body.className = 'memory__turn-body';
    const role = document.createElement('div');
    role.className = 'memory__turn-role';
    role.textContent = `${turn.role === 'assistant' ? '回答' : '提问'} · ${turn.text.length} 字`;
    const text = document.createElement('div');
    text.className = 'memory__turn-text';
    text.textContent = turn.text;
    text.addEventListener('click', (e) => { e.preventDefault(); text.classList.toggle('is-open'); });
    body.append(role, text);
    row.append(box, body);
    turnsEl.appendChild(row);
  }
}

async function eatChecked() {
  const picked = [...turnsEl.querySelectorAll('input:checked')]
    .map((box) => loadedTurns.find((t) => t.idx === Number(box.dataset.idx)))
    .filter(Boolean);
  if (!picked.length) return;
  const added = await memory.eatMany(picked);
  sessionPane.hidden = true;
  searchInput.value = '';
  activeId = null;
  renderList();
  memCount.textContent = `刚吃下 ${added} 条 · 共 ${memory.all().length} 条`;
}

// 记忆栈的常量都在上面，初始化必须放最后，否则撞上 const 的暂时性死区。
initMemory();
