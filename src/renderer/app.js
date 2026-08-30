import { TOOLS } from './core/registry.js';
import { DeepSeekBridge } from './core/deepseek-bridge.js';
import { Config } from './core/config.js';
import { AI } from './core/ai.js';
import { h, toast } from './core/ui.js';

const rail = document.getElementById('rail');
const stage = document.getElementById('stage');

const config = await Config.load();
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

const mounted = new Map(); // id -> { el, instance }
let currentId = null;

function activate(id) {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) return;

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
  entry.instance.activate?.();
  currentId = id;

  for (const btn of rail.children) {
    btn.classList.toggle('is-active', btn.dataset.id === id);
  }
  config.set('ui.lastTool', id);
}

for (const tool of TOOLS) {
  rail.appendChild(
    h('button', {
      class: 'rail__item',
      dataset: { id: tool.id },
      title: tool.hint || tool.title,
      onclick: () => activate(tool.id),
    },
      h('span', { class: 'rail__icon' }, tool.icon),
      h('span', { class: 'rail__label' }, tool.title),
    ),
  );
  if (tool.id === 'study') rail.appendChild(h('div', { class: 'rail__spacer' }));
}

// Cmd+1..9 快速切工具
window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const index = Number(e.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < TOOLS.length) {
    e.preventDefault();
    activate(TOOLS[index].id);
  }
});

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

window.__ctx = ctx; // 方便在 DevTools 里手动调试
