import { h } from '../../core/ui.js';
import { iconLabel } from '../../core/icons.js';
import { createPortal } from './portal.js';
import { createLiterature } from './literature.js';
import { createIdeas } from './ideas.js';
import { createLibrary } from './library.js';
import { createFigureboard } from './figureboard.js';
import { createAcademic } from './academic.js';
import { createSchools } from './schools.js';

const SUB_SECTIONS = [
  { id: 'portal', label: '门户', icon: 'globe' },
  { id: 'academic', label: '学术入口', icon: 'graduation' },
  { id: 'schools', label: '学校访问', icon: 'book' },
  { id: 'literature', label: '文献', icon: 'book' },
  { id: 'ideas', label: '想法', icon: 'zap' },
  { id: 'figureboard', label: 'PPT图板', icon: 'pen' },
  { id: 'library', label: '文献库', icon: 'archive' },
];

/**
 * 科研：门户（网站格子铺）/ 文献管理器 / 想法区（AI 拆解落实）。
 * 四个子区共用一个工具位，顶栏切换；门户的 webview 常驻不销毁。
 */
export default {
  id: 'research',
  title: '科研',
  icon: 'flask',
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
      figureboard: createFigureboard,
      library: createLibrary,
      academic: createAcademic,
      schools: createSchools,
    };

    function selectSub(id) {
      currentSub = id;
      config.set('research.sub', id);
      for (const btn of subBar.children) {
        btn.classList.toggle('is-active', btn.dataset.sub === id);
      }
      if (!panels.has(id)) {
        const panel = h('div', { class: 'research__panel' });
        panel._instance = factories[id](panel, ctx);
        panels.set(id, panel);
        body.appendChild(panel);
      } else {
        // 文献库切回来时重新拉一次，否则「文献」页刚下载的看不见
        panels.get(id)._instance?.refresh?.();
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
      }, iconLabel(s.icon, s.label, 'subnav-label')));
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
