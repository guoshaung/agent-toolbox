import { h, toast } from '../../core/ui.js';

/**
 * 快捷控制：Windows 全局快捷键（默认关闭）。
 *  - Ctrl+Q：强制关闭当前前台应用
 *  - Ctrl+~：在当前前台应用的多个窗口间循环
 * 主进程 app-controls.js 负责安全名单与窗口 API，这里只做开关和演示。
 */
export default {
  id: 'controls',
  title: '快捷控制',
  icon: 'zap',
  hint: 'Ctrl+Q 强关当前应用 / Ctrl+~ 循环同应用窗口（默认关闭）',

  create(root) {
    const isWindows = window.toolbox.platform === 'win32';
    if (!isWindows) {
      root.append(
        h('div', { class: 'bar bar--drag' },
          h('strong', {}, '快捷控制'),
          h('span', { class: 'faint' }, '仅 Windows 可用'),
        ),
        h('div', { class: 'dock__body' },
          h('section', { class: 'card dock__unsupported' },
            h('h2', {}, '这个功能在当前系统上用不了'),
            h('p', { class: 'faint' },
              '快捷控制依赖 Windows 全局窗口 API（user32 枚举/激活窗口、taskkill 结束进程）。' +
              'macOS 上系统自带的 Cmd+Q / Cmd+` 已经覆盖同样的场景。'),
          ),
        ),
      );
      return {};
    }

    let state = { supported: true, enabled: false, registered: false, shortcuts: { close: 'Ctrl+Q', cycle: 'Ctrl+~' } };

    const masterToggle = h('input', { type: 'checkbox', class: 'switch__input' });
    const statusTag = h('span', { class: 'tag' }, '已关闭');
    const registeredHint = h('span', { class: 'controls__reg-hint faint' }, '');

    function render(next) {
      state = { ...state, ...next };
      if (typeof state.enabled === 'boolean') masterToggle.checked = state.enabled;
      if (state.enabled && state.registered !== false) {
        statusTag.textContent = '已开启';
        statusTag.className = 'tag tag--good';
        registeredHint.textContent = `已注册 · ${state.shortcuts.close} 强关 / ${state.shortcuts.cycle} 循环`;
      } else if (state.enabled && state.registered === false) {
        statusTag.textContent = '快捷键冲突';
        statusTag.className = 'tag tag--bad';
        registeredHint.textContent = '其中一个快捷键被其他应用占用了，请先关闭占用方再重试。';
      } else {
        statusTag.textContent = '已关闭';
        statusTag.className = 'tag';
        registeredHint.textContent = '默认关闭：打开后才会在全局生效。';
      }
    }

    masterToggle.addEventListener('change', async () => {
      const result = await window.toolbox.appControls.setEnabled(masterToggle.checked);
      render(result);
      toast(result.registered !== false ? `快捷控制已${result.enabled ? '开启' : '关闭'}` : '快捷键有冲突，未能全部注册', result.registered !== false ? (result.enabled ? 'good' : 'info') : 'bad');
    });

    const closeBtn = h('button', { class: 'btn btn--sm controls__try', onclick: tryClose }, '试一下');
    const cycleBtn = h('button', { class: 'btn btn--sm controls__try', onclick: tryCycle }, '试一下');

    async function tryClose() {
      const result = await window.toolbox.appControls.closeForeground();
      if (result.ok) toast(`已强制关闭 ${result.name || result.pid}`, 'good');
      else if (result.skipped) toast(result.error || '当前应用受保护，已跳过。', 'info');
      else toast(result.error || '强关失败。', 'bad');
    }

    async function tryCycle() {
      const result = await window.toolbox.appControls.cycleWindows();
      if (result.ok) toast('已切到下一个窗口', 'good', 1800);
      else toast(result.error || '当前应用没有可循环的窗口。', 'info');
    }

    async function refresh() {
      render(await window.toolbox.appControls.status());
    }

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '快捷控制'),
        h('span', { class: 'faint' }, 'Windows 全局按键，默认关闭'),
        h('span', { class: 'bar__spacer' }),
        registeredHint,
        statusTag,
      ),
      h('div', { class: 'settings__body' },
        h('section', { class: 'card' },
          h('div', { class: 'settings__row settings__row--first' },
            h('div', {},
              h('div', {}, '启用快捷控制'),
              h('div', { class: 'faint settings__hint' },
                '开启后在任意应用中生效：按 ',
                h('kbd', { class: 'controls__kbd' }, 'Ctrl+Q'),
                ' 强制关闭当前前台应用；按 ',
                h('kbd', { class: 'controls__kbd' }, 'Ctrl+~'),
                ' 在当前应用的多个窗口之间循环切换。'),
            ),
            h('label', { class: 'switch' }, masterToggle, h('span', { class: 'switch__track' })),
          ),
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '两个按键说明'),
          h('div', { class: 'controls__row' },
            h('div', { class: 'controls__row-icon' }, '✕'),
            h('div', { class: 'controls__row-copy' },
              h('strong', {}, '强制关闭当前应用'),
              h('p', { class: 'faint' }, '立即结束前台应用的全部进程（含子进程）。未保存的内容会丢失，请谨慎使用。'),
            ),
            h('div', { class: 'controls__row-close' }, closeBtn),
          ),
          h('div', { class: 'controls__row' },
            h('div', { class: 'controls__row-icon' }, '⇄'),
            h('div', { class: 'controls__row-copy' },
              h('strong', {}, '循环同一应用的窗口'),
              h('p', { class: 'faint' }, '与 Alt+Tab 不同：只在当前前台应用（如浏览器/编辑器）自己的窗口间切换，不打断别的应用。'),
            ),
            h('div', { class: 'controls__row-cycle' }, cycleBtn),
          ),
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '安全机制'),
          h('div', { class: 'faint settings__hint' },
            '① 关闭动作只作用于前台窗口，工具箱自身永远不会被关闭；' +
            '② 窗口标题为空、系统关键进程（explorer、svchost 等）一律跳过；' +
            '③ 窗口循环会跳过工具箱自身的窗口；' +
            '④ 默认关闭，开关持久保存在本机配置中。',
          ),
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '隐私说明'),
          h('div', { class: 'faint settings__hint' },
            '仅读取前台窗口的 PID、标题和窗口句柄，用于关闭与切换；不上传、不记录、不访问窗口内容。'),
        ),
      ),
    );

    refresh();

    return {};
  },
};