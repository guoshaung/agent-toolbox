import { h, toast } from '../../core/ui.js';

/**
 * 实验页：默认加载本地实时看板（http://127.0.0.1:8770，dashboard.py 提供，实时显示跑到哪、A/B 谁在做、正在调什么工具、token）。
 * 看板没起时退回同目录自包含的 explainer.html（绘本 + 架构图）。看板起法：
 *   cd agentworld-suite/agentworld && ./.venv/bin/python ../experiments/skill_distill/dashboard.py
 */
const DASH = 'http://127.0.0.1:8770';

export default {
  id: 'lab',
  title: '实验',
  icon: 'bot',
  hint: 'Skill 蒸馏复刻：实时看板（跑到哪/谁在做）+ 讲解',

  create(root) {
    let mode = 'live';   // live=实时看板, doc=讲解页
    const frame = h('iframe', { style: 'flex:1;width:100%;border:0;background:transparent' });
    const seg = (id, label) => h('button', {
      class: 'btn btn--sm ' + (mode === id ? 'btn--primary' : 'btn--ghost'),
      onclick: () => { mode = id; paint(); },
    }, label);
    const bar = h('div', { class: 'bar bar--drag' },
      h('strong', {}, '实验'),
      h('span', { style: 'flex:1' }),
      h('span', { id: 'lab-seg' }),
      h('button', { class: 'btn btn--sm btn--ghost', title: '在系统浏览器打开看板',
        onclick: () => window.toolbox?.shell?.openExternal?.(DASH) || toast('看板地址 ' + DASH, 'info') }, '外部打开'),
    );
    function paint() {
      bar.querySelector('#lab-seg').replaceChildren(seg('live', '实时看板'), seg('doc', '讲解'));
      frame.src = mode === 'live' ? DASH : new URL('./explainer.html', import.meta.url).href;
    }
    // 看板没起就默认显示讲解页
    fetch(DASH, { method: 'GET', mode: 'no-cors' }).then(() => { mode = 'live'; paint(); })
      .catch(() => { mode = 'doc'; paint(); });
    paint();
    root.append(h('div', { style: 'display:flex;flex-direction:column;height:100%' }, bar, frame));
  },
};
