import { h, toast } from '../../core/ui.js';

export default {
  id: 'settings',
  title: '设置',
  icon: '⚙︎',
  hint: '桥接自检与维护（Cmd+5）',

  create(root, ctx) {
    const { config, bridge } = ctx;

    const probeOut = h('pre', { class: 'settings__probe mono' }, '还没检测');

    /**
     * 桥接自检。DeepSeek 改版是迟早的事，出问题时这里能立刻告诉你
     * 「是没登录，还是页面结构变了」，而不用去猜。
     */
    const probeBtn = h('button', {
      class: 'btn btn--primary',
      onclick: async () => {
        probeBtn.disabled = true;
        probeOut.textContent = '检测中…';
        try {
          const report = await bridge.probe();
          const verdict = report.ready
            ? '✅ 桥接正常，纠错和「帮我决定」可以用'
            : report.needLogin
              ? '🔑 未登录 —— 去「快问」里登录一次即可'
              : '⚠️ 页面上找不到输入框。可能是页面还没加载完，或 DeepSeek 改版了';
          probeOut.textContent = `${verdict}\n\n${JSON.stringify(report, null, 2)}`;
        } catch (err) {
          probeOut.textContent = `检测失败：${err.message}`;
        } finally {
          probeBtn.disabled = false;
        }
      },
    }, '检测桥接状态');

    const danger = (label, hint, fn) => h('div', { class: 'settings__row' },
      h('div', {},
        h('div', {}, label),
        h('div', { class: 'faint settings__hint' }, hint),
      ),
      h('button', { class: 'btn btn--sm', onclick: fn }, '执行'),
    );

    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '设置')),
      h('div', { class: 'settings__body' },
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, 'DeepSeek 桥接'),
          h('p', { class: 'faint settings__hint' },
            '打字纠错和「帮我决定」都跑在一个隐藏的 DeepSeek 网页实例上，用的是你自己的登录态，不消耗 API 额度。' +
            '它和「快问」共用登录，登录一次两边都通。'),
          h('div', { class: 'settings__actions' },
            probeBtn,
            h('button', { class: 'btn', onclick: () => { bridge.reload(); toast('已重新加载桥接页面', 'good'); } }, '重载桥接'),
            h('button', { class: 'btn', onclick: () => ctx.goto('ask') }, '去登录'),
          ),
          probeOut,
        ),

        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '维护'),
          danger('清空纠错历史', '只删本地记录，不影响别的设置', async () => {
            await config.set('typing.history', []);
            toast('已清空', 'good');
          }),
          danger('清空专注记录', '番茄钟的历史统计', async () => {
            await config.set('focus.log', []);
            toast('已清空', 'good');
          }),
          danger('打开开发者工具', '看报错、调样式', () => window.toolbox.app.openDevTools()),
          danger('重载界面', '改了 renderer 里的代码后，不用重启 App', () => window.toolbox.app.reload()),
        ),

        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '关于'),
          h('p', { class: 'faint settings__hint' },
            '所有数据只存在本机的 userData/config.json 里，不上传任何地方。' +
            '需求与设计见仓库里的 docs/SPEC.md，加新工具见 docs/ADD-A-TOOL.md。'),
          h('p', { class: 'faint settings__hint' },
            '快捷键：Cmd+1…5 切工具，Cmd+F 页内查找，Cmd+L 定位地址栏，Cmd+Enter 触发纠错。'),
        ),
      ),
    );

    return {};
  },
};
