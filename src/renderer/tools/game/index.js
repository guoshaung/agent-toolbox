import { h } from '../../core/ui.js';
import { iconLabel } from '../../core/icons.js';
import { createBattle } from './battle.js';
import { createRunner } from './runner.js';

/**
 * 游戏：从「专注」里独立出来的小游戏合集。
 * 想加新游戏：写一个 create(panel, ctx) 的模块，然后在下面 GAMES 里加一行就行 ——
 * 子栏会自动多一个 tab，面板常驻不销毁（切走只 deactivate、切回再 activate）。
 */
export const GAMES = [
  { id: 'battle', label: '火柴人战斗', icon: 'zap', create: (panel, ctx) => createBattle(panel, ctx) },
  { id: 'runner', label: '火柴人酷跑', icon: 'zap', create: (panel, ctx) => createRunner(panel, ctx) },
  // 以后加游戏：{ id: 'xxx', label: '名字', icon: 'zap', create: (panel, ctx) => createXxx(panel, ctx) },
];

// 轮盘第三圈用得到：和 focus 一样导出子页清单
export const SUB_SECTIONS = GAMES.map((g) => ({ id: g.id, label: g.label, icon: g.icon }));

export default {
  id: 'game',
  title: '游戏',
  icon: 'zap',
  hint: '摸鱼小游戏合集：火柴人战斗，之后还会加更多',

  create(root, ctx) {
    const { config } = ctx;
    const panels = new Map();
    const deactivators = new Map();
    const activators = new Map();
    let currentSub = config.get('game.sub', GAMES[0].id);

    const subBar = h('div', { class: 'research__subbar' });
    const body = h('div', { class: 'research__subbody' });
    const factories = Object.fromEntries(GAMES.map((g) => [g.id, g.create]));

    function selectSub(id) {
      if (currentSub !== id) deactivators.get(currentSub)?.();
      currentSub = id;
      config.set('game.sub', id);
      for (const btn of subBar.children) btn.classList.toggle('is-active', btn.dataset.sub === id);
      if (!panels.has(id)) {
        const panel = h('div', { class: 'research__panel' });
        const handle = factories[id](panel, ctx);
        if (handle && typeof handle.deactivate === 'function') deactivators.set(id, handle.deactivate);
        if (handle && typeof handle.activate === 'function') activators.set(id, handle.activate);
        panels.set(id, panel);
        body.appendChild(panel);
      }
      for (const [pid, panel] of panels) panel.style.display = pid === id ? 'flex' : 'none';
      activators.get(id)?.();
    }

    for (const g of GAMES) {
      subBar.appendChild(h('button', {
        class: 'btn btn--sm research__subbtn',
        dataset: { sub: g.id },
        onclick: () => selectSub(g.id),
      }, iconLabel(g.icon, g.label, 'subnav-label')));
    }

    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '游戏'), subBar),
      body,
    );

    selectSub(GAMES.some((g) => g.id === currentSub) ? currentSub : GAMES[0].id);
    window.addEventListener('toolbox:tool-sub', (e) => { if (e.detail?.tool === 'game' && GAMES.some((g) => g.id === e.detail.sub)) selectSub(e.detail.sub); });

    return {
      deactivate: () => deactivators.forEach((fn) => fn()),
      activate: () => activators.get(currentSub)?.(),
    };
  },
};
