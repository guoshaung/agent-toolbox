import { TOOLS } from './core/registry.js';
import { DeepSeekBridge } from './core/deepseek-bridge.js';
import { Config } from './core/config.js';
import { AI } from './core/ai.js';
import { h, toast } from './core/ui.js';
import { logoById, applyAppIcon, applyLogo } from './core/logos.js';
import { applyStoredTheme, applyStoredEffect } from './core/themes.js';
import { iconFor } from './core/icons.js';
import { buildTermPrompt, buildTermSystemPrompt, normalizeTermResult } from './tools/terms/prompt.js';
import { createSwitcher } from './core/switcher.js';
import { togglePinned as togglePinnedState, addToRight, removePinned, LEFT_MAX, RIGHT_MAX } from './core/right-rail.js';

const rail = document.getElementById('rail');
const stage = document.getElementById('stage');

const dshBannerState = h('span', { class: 'atelier-banner__dsh-state' }, 'DSH Web');
const dshButton = h('button', { class: 'atelier-banner__dsh', onclick: openDsh, title: '打开内置 DeepSeek Harness' }, '◈ ', dshBannerState);
const atelierBanner = h('header', { class: 'atelier-banner', 'aria-label': 'Agent 工具箱装饰标题栏', onclick: (event) => { if (!event.target.closest('button')) openDsh(); } },
  h('div', { class: 'atelier-banner__brand' },
    h('span', {}, 'AGENT'),
    h('strong', {}, 'TOOLBOX'),
  ),
  h('div', { class: 'atelier-banner__bow', 'aria-hidden': 'true' }),
  h('span', { class: 'atelier-banner__caption' }, 'PERSONAL WORKSPACE'),
  dshButton,
);
stage.appendChild(atelierBanner);

const config = await Config.load();
applyStoredTheme(config);
applyStoredEffect(config);
const bridge = new DeepSeekBridge();
bridge.attach(document.getElementById('bridge-host'));

/** 传给每个工具的上下文。工具之间不互相 import，只通过这里拿共享能力。 */
const ctx = {
  config,
  bridge,
  /** 统一的 AI 入口：底下是网页版还是自定义 API，上层不用管 */
  ai: new AI({ config, bridge }),
  toast,
  /** 让「专注」里的 AI 建议按钮能一键跳到「快问」去登录 */
  goto: (id) => activate(id),
};

function openDsh() {
  window.toolbox.dsh.start().then((result) => {
    if (result.ok) activate('dsh');
    else toast(result.error || 'DSH 尚未启动', 'bad', 6000);
  });
}

function renderDshBanner(state) {
  const running = state?.status === 'running';
  dshBannerState.textContent = running ? 'DSH · 已就绪' : state?.status === 'installing' ? 'DSH · 下载中' : state?.status === 'starting' ? 'DSH · 启动中' : 'DSH · 点击启动';
  dshButton.classList.toggle('is-ready', running);
  dshButton.classList.toggle('is-busy', state?.status === 'installing' || state?.status === 'starting');
}

window.toolbox.dsh.onStatus(renderDshBanner);
window.toolbox.dsh.status().then(renderDshBanner);

const mounted = new Map(); // id -> { el, instance }
// 在顶上先声明：activate() 里要用它，而它自己在文件末尾才创建。
// 写成 const 放下面的话，activate 早于它执行就会撞上暂时性死区（?. 也挡不住）。
let switcher = null;
let currentId = null;
const SETTINGS_ID = 'settings';
const MAX_PINNED = LEFT_MAX;
const DEFAULT_PINNED = ['ask', 'terms', 'docs', 'controls', 'voice', 'focus', 'skills', 'research'];
const pinEligibleTools = TOOLS.filter((tool) => tool.id !== SETTINGS_ID && tool.id !== 'tasks');
let pinnedIds = config.get('ui.pinnedTools', null);
let rightPinnedIds = config.get('ui.rightPinnedTools', []);
if (!Array.isArray(rightPinnedIds)) rightPinnedIds = [];
if (!pinnedIds || !pinnedIds.length) {
  pinnedIds = [...DEFAULT_PINNED].slice(0, MAX_PINNED); // 首次运行或已清空：用含快捷控制/语音的默认列表
} else {
  pinnedIds = pinnedIds
    .filter((id, index, list) => pinEligibleTools.some((tool) => tool.id === id) && list.indexOf(id) === index)
    .slice(0, MAX_PINNED);
  // 老配置里没有快捷控制：自动补到左侧，否则新栏目在存量用户这边永远藏在「更多」里
  if (!pinnedIds.includes('controls')) {
    if (pinnedIds.length >= MAX_PINNED) pinnedIds = [...pinnedIds.slice(0, MAX_PINNED - 1), 'controls'];
    else pinnedIds = [...pinnedIds, 'controls'];
  }
  if (!pinnedIds.includes('voice')) {
    if (pinnedIds.length >= MAX_PINNED) pinnedIds = [...pinnedIds.slice(0, MAX_PINNED - 1), 'voice'];
    else pinnedIds = [...pinnedIds, 'voice'];
  }
}

rightPinnedIds = rightPinnedIds
  .filter((id, index, list) => pinEligibleTools.some((tool) => tool.id === id) && !pinnedIds.includes(id) && list.indexOf(id) === index)
  .slice(0, RIGHT_MAX);

const pinnedHost = h('div', { class: 'rail__pinned' });
const rightPinnedHost = h('div', { class: 'rail__pinned' });
const rightRail = h('nav', { class: 'rail rail--right', id: 'rail-right', hidden: true, 'aria-label': '右侧收藏栏' }, rightPinnedHost);
const libraryBody = h('div', { class: 'rail-library__body' });
const libraryCount = h('span', { class: 'rail-library__count' });
const libraryPanel = h('section', { class: 'rail-library', hidden: true },
  h('header', { class: 'rail-library__head' },
    h('div', {},
      h('div', { class: 'rail-library__eyebrow' }, 'TOOL LIBRARY'),
      h('strong', {}, '更多工具'),
    ),
    libraryCount,
  ),
  h('p', { class: 'rail-library__hint' }, '点星标放到左侧常用区。最多固定 7 个，其他工具仍保留在这里。'),
  libraryBody,
);
const moreButton = h('button', {
  class: 'rail__item rail__more',
  title: '更多工具',
  onclick: (event) => {
    event.stopPropagation();
    setLibraryOpen(libraryPanel.hidden);
  },
},
  h('span', { class: 'rail__icon rail__more-icon' }, iconFor('more')),
  h('span', { class: 'rail__label' }, '更多'),
  h('span', { class: 'rail__more-dot' }),
);
let libraryHideTimer;

function activate(id) {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) return;
  switcher?.noteUse(id);

  if (currentId && currentId !== id) {
    const prev = mounted.get(currentId);
    prev?.el.setAttribute('hidden', '');
    prev?.instance.deactivate?.();
  }

  // 首次打开才创建；之后只是显示/隐藏 —— webview 不重载，切换是瞬时的，
  // 这正是这个工具箱要解决的「每次都要重新打开重新加载」的问题。
  if (!mounted.has(id)) {
    const el = h('section', { class: 'tool', id: `tool-${id}` });
    stage.appendChild(el);
    let instance;
    try {
      instance = tool.create(el, ctx) || {};
    } catch (err) {
      console.error(`[${id}] 创建失败`, err);
      el.appendChild(h('div', { class: 'empty' }, `「${tool.title}」加载失败：${err.message}`));
      instance = {};
    }
    mounted.set(id, { el, instance });
  }

  const entry = mounted.get(id);
  entry.el.removeAttribute('hidden');
  entry.el.classList.remove('tool--enter');
  void entry.el.offsetWidth;
  entry.el.classList.add('tool--enter');
  entry.instance.activate?.();
  currentId = id;

  for (const btn of rail.querySelectorAll('[data-id]')) {
    btn.classList.toggle('is-active', btn.dataset.id === id);
  }
  // 重启动画：先摘类、强制回流、再加回去，否则连点同一个工具不会再播
  railLogo.classList.remove('is-pulse');
  void railLogo.offsetWidth;
  railLogo.classList.add('is-pulse');

  const isLibraryTool = id !== SETTINGS_ID && id !== 'tasks' && !pinnedIds.includes(id);
  moreButton.classList.toggle('is-active', isLibraryTool);
  moreButton.classList.toggle('has-current', isLibraryTool);
  for (const card of libraryPanel.querySelectorAll('.rail-library__card')) {
    card.classList.toggle('is-current', card.dataset.id === id);
  }
  setLibraryOpen(false);
  config.set('ui.lastTool', id);
}

function railButton(tool, extraClass = '') {
  return h('button', {
    class: `rail__item ${extraClass}`.trim(),
    dataset: { id: tool.id },
    title: tool.hint || tool.title,
    onclick: () => activate(tool.id),
  },
    h('span', { class: 'rail__active-mark' }),
    h('span', { class: 'rail__icon' }, iconFor(tool.icon)),
    h('span', { class: 'rail__label' }, tool.title),
  );
}

async function togglePinned(id) {
  const next = togglePinnedState({ left: pinnedIds, right: rightPinnedIds }, id, pinEligibleTools.map((tool) => tool.id), MAX_PINNED, RIGHT_MAX);
  if (!next.overflow) {
    pinnedIds = next.left;
    rightPinnedIds = next.right;
  } else {
    const moveRight = window.confirm('左侧常用栏已满，是否把这个工具固定到右侧栏？');
    if (!moveRight) return;
    const added = addToRight({ left: pinnedIds, right: rightPinnedIds }, id, pinEligibleTools.map((tool) => tool.id), MAX_PINNED, RIGHT_MAX);
    if (added.full) return toast(`右侧常用栏也已达到 ${RIGHT_MAX} 个，请先取消一个收藏。`, 'info');
    rightPinnedIds = added.right;
  }
  await config.set('ui.pinnedTools', pinnedIds);
  await config.set('ui.rightPinnedTools', rightPinnedIds);
  renderRail();
}

function librarySection(title, tools, pinned) {
  if (!tools.length) return null;
  return h('section', { class: 'rail-library__section' },
    h('div', { class: 'rail-library__section-title' }, title),
    h('div', { class: 'rail-library__grid' }, tools.map((tool) => h('div', {
      class: `rail-library__card${tool.id === currentId ? ' is-current' : ''}`,
      dataset: { id: tool.id },
    },
      h('button', {
        class: 'rail-library__open',
        title: tool.hint || tool.title,
        onclick: () => activate(tool.id),
      },
        h('span', { class: 'rail-library__card-icon' }, iconFor(tool.icon)),
        h('span', { class: 'rail-library__card-copy' },
          h('strong', {}, tool.title),
          h('small', {}, tool.hint || '打开工具'),
        ),
      ),
      h('button', {
        class: `rail-library__pin${pinned ? ' is-pinned' : ''}`,
        title: pinned ? '从左侧移除' : '固定到左侧',
        onclick: (event) => {
          event.stopPropagation();
          togglePinned(tool.id);
        },
      }, pinned ? '★' : '☆'),
    ))),
  );
}

function rightRailButton(tool) {
  const button = railButton(tool, 'rail__right-item');
  button.title = `${tool.hint || tool.title} · 右键取消收藏`;
  button.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    rightPinnedIds = removePinned({ left: [], right: rightPinnedIds }, tool.id).right;
    await config.set('ui.rightPinnedTools', rightPinnedIds);
    renderRail();
  });
  return button;
}

function renderRail() {
  pinnedHost.replaceChildren(...pinnedIds
    .map((id) => TOOLS.find((tool) => tool.id === id))
    .filter(Boolean)
    .map((tool) => railButton(tool)));
  rightPinnedHost.replaceChildren(...rightPinnedIds
    .map((id) => TOOLS.find((tool) => tool.id === id))
    .filter(Boolean)
    .map(rightRailButton));
  rightRail.hidden = rightPinnedIds.length === 0;

  const pinnedTools = pinnedIds.map((id) => pinEligibleTools.find((tool) => tool.id === id)).filter(Boolean);
  const otherTools = pinEligibleTools.filter((tool) => !pinnedIds.includes(tool.id) && !rightPinnedIds.includes(tool.id));
  libraryCount.textContent = `${pinEligibleTools.length} 个`;
  libraryBody.replaceChildren(
    librarySection('左侧常用', pinnedTools, true),
    librarySection('全部其他', otherTools, false),
  );
  for (const btn of rail.querySelectorAll('[data-id]')) btn.classList.toggle('is-active', btn.dataset.id === currentId);
  for (const btn of rightRail.querySelectorAll('[data-id]')) btn.classList.toggle('is-active', btn.dataset.id === currentId);
  moreButton.classList.toggle('has-current', Boolean(currentId && currentId !== 'tasks' && !pinnedIds.includes(currentId) && !rightPinnedIds.includes(currentId) && currentId !== SETTINGS_ID));
}

function setLibraryOpen(open) {
  const next = Boolean(open);
  clearTimeout(libraryHideTimer);
  moreButton.classList.toggle('is-open', next);
  if (next) {
    libraryPanel.removeAttribute('hidden');
    requestAnimationFrame(() => libraryPanel.classList.add('is-visible'));
  } else {
    libraryPanel.classList.remove('is-visible');
    libraryHideTimer = setTimeout(() => libraryPanel.setAttribute('hidden', ''), 180);
  }
}

const dockEdgeHint = h('div', { class: 'dock-edge-hint', title: '把 Edge 标签页或窗口拖到这里' });
document.body.appendChild(dockEdgeHint);
const dockPin = h('button', {
  class: 'rail__pin',
  title: '启动窗口吸附：点亮后，把 Edge 标签页或窗口拖到工具箱边缘',
  'aria-label': '启动窗口吸附',
  onclick: async () => {
    const result = await window.toolbox.dock.togglePin();
    if (!result.ok) toast(result.error || '无法启动窗口吸附', 'bad', 6000);
  },
}, iconFor('paperclip'));

const taskTool = TOOLS.find((tool) => tool.id === 'tasks');
const taskButton = railButton(taskTool, 'rail__task');

function renderDockPin(state) {
  dockPin.classList.toggle('is-armed', Boolean(state.armed));
  dockPin.classList.toggle('is-active', Boolean(state.active));
  dockPin.replaceChildren(iconFor(state.active ? 'link' : 'paperclip'));
  dockPin.title = state.active
    ? `已吸附 ${state.target?.name || '窗口'}，点击解除并恢复`
    : state.armed
      ? `吸附已启动：把窗口拖到工具箱${state.side === 'right' ? '右' : '左'}边缘；再次点击取消`
      : '启动窗口吸附：点亮后，把 Edge 标签页或窗口拖到工具箱边缘';
  dockEdgeHint.className = `dock-edge-hint dock-edge-hint--${state.side === 'right' ? 'right' : 'left'}${state.armed ? ' is-visible' : ''}`;
}

/** 侧栏 logo。切工具时让它响应一下 —— 静止的标记会让整个侧栏显得是死的 */
const railLogo = h('div', { class: 'rail__logo', title: 'Agent 工具箱 · 双击重启应用', html: logoById(config.get('ui.logo', 'neon')).svg });
// 侧栏标记 + 右下角品牌纹章统一应用当前 logo
applyLogo(config.get('ui.logo', 'neon'));
// 同步应用图标（窗口/任务栏/Dock）：渲染进程把 SVG 转成 PNG 后交给主进程
applyAppIcon(config.get('ui.logo', 'neon')).catch((error) => console.warn('[app] 应用图标更新失败:', error.message));
let restarting = false;
railLogo.addEventListener('dblclick', async () => {
  if (restarting) return;
  restarting = true;
  railLogo.classList.add('is-restarting');
  try {
    await window.toolbox.app.relaunch();
  } catch (error) {
    restarting = false;
    railLogo.classList.remove('is-restarting');
    toast(`重启失败：${error.message}`, 'bad');
  }
});

rail.append(
  railLogo,
  dockPin,
  taskButton,
  pinnedHost,
  h('div', { class: 'rail__spacer' }),
  moreButton,
  railButton(TOOLS.find((tool) => tool.id === SETTINGS_ID), 'rail__settings'),
  libraryPanel,
);
document.getElementById('app').appendChild(rightRail);
renderRail();
window.toolbox.dock.onStatus(renderDockPin);
window.toolbox.dock.onError((message) => toast(message, 'bad', 5200));
window.toolbox.dock.status().then(renderDockPin);

document.addEventListener('pointerdown', (event) => {
  if (!libraryPanel.hidden && !libraryPanel.contains(event.target) && !moreButton.contains(event.target)) setLibraryOpen(false);
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setLibraryOpen(false);
});

// Ctrl+Tab 呼出模块切换器（按住能看见即将切到哪，松开才生效）
switcher = createSwitcher({
  tools: TOOLS,
  getCurrentId: () => currentId,
  onPick: (id) => activate(id),
  config,
});

// Cmd+1..9 快速切工具
window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const index = Number(e.key) - 1;
  const shortcutTools = pinnedIds.map((id) => TOOLS.find((tool) => tool.id === id)).filter(Boolean);
  if (Number.isInteger(index) && index >= 0 && index < shortcutTools.length) {
    e.preventDefault();
    activate(shortcutTools[index].id);
  }
});

// 把工具表推给手机端。写死的话每加一个工具手机上就少一个。
window.toolbox.remote?.setTools?.(TOOLS.map((t) => ({ id: t.id, title: t.title, emoji: t.emoji || '' })));

const last = config.get('ui.lastTool');
activate(TOOLS.some((t) => t.id === last) ? last : TOOLS[0].id);

// 桥接出问题时说清楚，不要让工具静默转圈
bridge.onStatus((state, detail) => {
  if (state === 'error' && detail?.code === 'need-login') {
    toast('DeepSeek 还没登录，去「快问」里登录一次。', 'bad');
  }
});

window.toolbox.onOpenUrl((url) => {
  window.dispatchEvent(new CustomEvent('toolbox:open-url', { detail: { url } }));
});

window.toolbox.app.onNavigateTool(({ id, section }) => {
  activate(id);
  if (section === 'ai') {
    requestAnimationFrame(() => {
      const target = document.getElementById('settings-ai');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.classList.add('settings__target');
      setTimeout(() => target?.classList.remove('settings__target'), 1400);
    });
  }
});

window.toolbox.terms.onExplainRequest(async ({ requestId, text }) => {
  try {
    const raw = await ctx.ai.json(buildTermPrompt(text), {
      system: buildTermSystemPrompt({
        domainId: ctx.config.get('terms.domainId', 'ai'),
        customDomain: ctx.config.get('terms.customDomain', ''),
      }),
      timeout: 70000,
    });
    const result = normalizeTermResult(raw, text);
    const current = ctx.config.get('terms.history', []);
    const history = [{ ...result, at: new Date().toISOString() }, ...current.filter((item) => item.term !== result.term)].slice(0, 80);
    await ctx.config.set('terms.history', history);
    window.dispatchEvent(new CustomEvent('toolbox:term-history-updated', { detail: history }));
    await window.toolbox.terms.resolve({ requestId, ok: true, result });
  } catch (err) {
    const guidance = err.code === 'need-login'
      ? 'DeepSeek 登录已失效。打开工具箱的「快问」重新登录一次。'
      : err.message;
    await window.toolbox.terms.resolve({ requestId, ok: false, error: guidance });
  }
});

window.toolbox.remote.onCommand(async ({ requestId, type, payload }) => {
  if (type !== 'ai.ask') return window.toolbox.remote.resolve({ requestId, ok: false, error: `渲染层不支持动作：${type}` });
  try {
    const text = String(payload?.prompt || '').trim();
    if (!text) throw new Error('没有输入 AI 任务。');
    const answer = await ctx.ai.chat(text, { timeout: 120000 });
    await window.toolbox.remote.resolve({ requestId, ok: true, result: { text: String(answer || '').trim() || 'AI 返回了空内容。' } });
  } catch (err) {
    await window.toolbox.remote.resolve({ requestId, ok: false, error: err.message });
  }
});

window.__ctx = ctx; // 方便在 DevTools 里手动调试
