import { h, toast } from '../../core/ui.js';

/**
 * 实验讲解页：把 agentworld-suite 的「Skill 蒸馏复刻」实验用绘本 + 架构图讲清楚（5 岁也能看懂）。
 *
 * 内容是一份自包含的 explainer.html（同目录），这里用 iframe srcdoc 原样嵌进来，
 * 不依赖网络、不连任何服务。以后实验出了新结果，替换 explainer.html 再发版即可。
 */
export default {
  id: 'lab',
  title: '实验讲解',
  icon: 'bot',
  hint: 'Skill 蒸馏复刻实验：绘本 + 架构图，一眼看懂',

  create(root) {
    const bar = h('div', { class: 'bar bar--drag' },
      h('strong', {}, '实验讲解'),
      h('span', { class: 'faint' }, 'Skill 蒸馏复刻 · 机器人学小抄'),
      h('span', { style: 'flex:1' }),
      h('button', {
        class: 'btn btn--sm btn--ghost',
        title: '在系统浏览器里打开这张讲解页',
        onclick: () => {
          const p = new URL('./explainer.html', import.meta.url);
          window.toolbox?.shell?.openExternal?.(p.href) || toast('用左侧内嵌视图查看即可', 'info');
        },
      }, '外部打开'),
    );

    const frame = h('iframe', {
      class: 'lab__frame',
      style: 'flex:1;width:100%;border:0;background:transparent',
      // 同目录静态文件，直接引用；打包后随 asar 一起在本地，无需网络
      src: new URL('./explainer.html', import.meta.url).href,
    });

    root.append(
      h('div', { class: 'lab', style: 'display:flex;flex-direction:column;height:100%' }, bar, frame),
    );
  },
};
