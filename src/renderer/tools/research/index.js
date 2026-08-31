import { h } from '../../core/ui.js';
import { createPortal } from './portal.js';
import { createLiterature } from './literature.js';
import { createIdeas } from './ideas.js';

const SUB_SECTIONS = [
  { id: 'portal', label: '门户' },
  { id: 'literature', label: '文献' },
  { id: 'ideas', label: '想法' },
];

/**
 * 科研：门户（网站格子铺）/ 文献管理器 / 想法区（AI 拆解落实）。
 * 三个子区共用一个工具位，顶栏切换；门户的 webview 常驻不销毁。
 */
export default {
  id: 'research',
  title: '科研',
  icon: '🔬',
  hint: '科研门户 + 文献管理 + 想法拆解（Cmd+9）',

  create(root, ctx) {
    const { config } = ctx;
    const panels = new Map();
    let currentSub = config.get('research.sub', 'portal');

    const subBar = h('div', { class: 'research__subbar' });
    const body = h('div', { class: 'research__subbody' });

    const factories = {
      portal: createPortal,
      literature: createLiterature,
      ideas: createIdeas,
    };

    function selectSub(id) {
      currentSub = id;
      config.set('research.sub', id);
      for (const btn of subBar.children) {
        btn.classList.toggle('is-active', btn.dataset.sub === id);
      }
      if (!panels.has(id)) {
        const panel = h('div', { class: 'research__panel' });
        factories[id](panel, ctx);
        panels.set(id, panel);
        body.appendChild(panel);
      }
      for (const [pid, panel] of panels) {
        panel.style.display = pid === id ? 'flex' : 'none';
      }
    }

    for (const s of SUB_SECTIONS) {
      subBar.appendChild(h('button', {
        class: 'btn btn--sm research__subbtn',
        dataset: { sub: s.id },
        onclick: () => selectSub(s.id),
      }, s.label));
    }

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '科研'),
        subBar,
      ),
      body,
    );

    selectSub(SUB_SECTIONS.some((s) => s.id === currentSub) ? currentSub : 'portal');

    return {};
  },
};
