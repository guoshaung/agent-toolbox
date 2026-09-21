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
      if (result.ok) {
        // 把「顺带扫掉几个同名残留」说出来 —— 不然你按完不知道后台还有没有剩的
        const swept = Number(result.sweptExtra) || 0;
        toast(swept > 0
          ? `已强制关闭 ${result.name || result.pid}，另清掉 ${swept} 个同名后台进程`
          : `已强制关闭 ${result.name || result.pid}`, 'good');
      }
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

    window.toolbox.appControls.onResult((result) => {
      if (result?.ok && result.action === 'cycle') { toast('已切到下一个窗口', 'good', 1800); return; }
      if (result?.ok) {
        const swept = Number(result.sweptExtra) || 0;
        toast(swept > 0 ? `已强制关闭 ${result.name || result.pid}，另清掉 ${swept} 个同名后台进程` : `已强制关闭 ${result.name || result.pid}`, 'good');
      } else if (result?.error) {
        toast(result.error, 'bad');
      }
    });

    root.append(
      h('div', { class: 'bar bar--drag controls__bar' },
        h('div', { class: 'controls__bar-title' },
          h('strong', {}, '快捷控制'),
          h('span', { class: 'faint' }, 'Windows 全局按键'),
        ),
        h('span', { class: 'bar__spacer' }), registeredHint, statusTag,
      ),
      h('div', { class: 'controls__body' },
        h('section', { class: 'controls__hero' },
          h('div', { class: 'controls__hero-copy' },
            h('span', { class: 'controls__eyebrow' }, 'FOCUS CONTROL'),
            h('h2', {}, '把当前窗口交给快捷键'),
            h('p', { class: 'faint' }, '在任何应用中快速收束窗口，工具箱本身始终受到保护。'),
          ),
          h('div', { class: 'controls__hero-action' },
            h('div', { class: 'controls__key-stack' },
              h('kbd', { class: 'controls__key controls__key--large' }, 'Ctrl + Q'),
              h('span', { class: 'faint' }, '强制退出当前应用'),
            ),
            h('label', { class: 'switch controls__switch', title: '启用全局快捷键' }, masterToggle, h('span', { class: 'switch__track' })),
          ),
        ),
        h('div', { class: 'controls__section-label' }, '快捷动作'),
        h('div', { class: 'controls__actions' },
          h('section', { class: 'controls__action-card controls__action-card--danger' },
            h('div', { class: 'controls__action-top' },
              h('div', { class: 'controls__row-icon' }, '✕'),
              h('kbd', { class: 'controls__key' }, 'Ctrl + Q'),
            ),
            h('strong', {}, '强制关闭当前应用'),
            h('p', { class: 'faint' }, '结束当前前台应用及其子进程。未保存的内容会丢失。'),
            closeBtn,
          ),
          h('section', { class: 'controls__action-card' },
            h('div', { class: 'controls__action-top' },
              h('div', { class: 'controls__row-icon' }, '⇄'),
              h('kbd', { class: 'controls__key' }, 'Ctrl + ~'),
            ),
            h('strong', {}, '循环同一应用窗口'),
            h('p', { class: 'faint' }, '只在当前应用自己的多个窗口之间切换，不打断其他应用。'),
            cycleBtn,
          ),
        ),
        h('section', { class: 'controls__note' },
          h('div', { class: 'controls__note-icon' }, '盾'),
          h('div', {},
            h('strong', {}, '安全与隐私'),
            h('p', { class: 'faint' }, '只读取前台窗口的 PID、标题和句柄；系统关键进程与工具箱自身永远不会被关闭。数据只在本机处理。'),
          ),
        ),
      ),
    );

    refresh();

    return { activate: refresh };
  },
};
