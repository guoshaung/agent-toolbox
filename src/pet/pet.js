import { resolveSkin } from './skins.js';
import { createSupplementState } from './supplement-state.mjs';
import { createFontLevelState } from './font-level.mjs';

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

async function setExpanded(next) {
  expanded = next;
  await window.toolbox.pet.resize(next);
  shell.classList.toggle('is-expanded', next);
  avatar.hidden = next;
  card.hidden = !next;
  if (next) {
    const state = await window.toolbox.pet.getState();
    applySettings(state.settings);
    if (state.clipboard.trim()) code.value = state.clipboard;
    code.focus();
  }
}

function collapseView() {
  expanded = false;
  shell.classList.remove('is-expanded');
  avatar.hidden = false;
  card.hidden = true;
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
avatar.addEventListener('click', () => { if (!moved) setExpanded(true); });
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
