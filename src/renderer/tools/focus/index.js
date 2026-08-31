import { h } from '../../core/ui.js';
import { createTimer } from './timer.js';
import { createGames } from './games.js';
import { createNews } from './news.js';
import { createWatch } from './watch.js';

const SUB_SECTIONS = [
  { id: 'timer', label: '专注' },
  { id: 'games', label: '醒脑' },
  { id: 'news', label: '情报' },
  { id: 'watch', label: '大佬动态' },
];

/**
 * 专注：和 AI 聊太久、大脑滑进「只看不想」模式时的复位区。
 * 专注（番茄钟/白噪音/呼吸/帮你决定）+ 醒脑（记忆小游戏）+ AI 情报 + X 大佬动态。
 * 四个子区共用一个工具位，顶栏切换；内嵌网页常驻不销毁。
 */
export default {
  id: 'focus',
  title: '专注',
  icon: '🎯',
  hint: '番茄钟 / 醒脑小游戏 / AI 情报 / 大佬动态（Cmd+4）',

  create(root, ctx) {
    const { config } = ctx;
    const panels = new Map();
    const deactivators = new Map();
    let currentSub = config.get('focus.sub', 'timer');

    const subBar = h('div', { class: 'research__subbar' });
    const body = h('div', { class: 'research__subbody' });

    const factories = {
      timer: createTimer,
      games: createGames,
      news: createNews,
      watch: createWatch,
    };

    function selectSub(id) {
      currentSub = id;
      config.set('focus.sub', id);
      for (const btn of subBar.children) {
        btn.classList.toggle('is-active', btn.dataset.sub === id);
      }
      if (!panels.has(id)) {
        const panel = h('div', { class: 'research__panel' });
        const handle = factories[id](panel, ctx);
        if (handle && typeof handle.deactivate === 'function') deactivators.set(id, handle.deactivate);
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
        h('strong', {}, '回归思考'),
        subBar,
      ),
      body,
    );

    selectSub(SUB_SECTIONS.some((s) => s.id === currentSub) ? currentSub : 'timer');

    return {
      deactivate: () => deactivators.forEach((fn) => fn()),
    };
  },
};
