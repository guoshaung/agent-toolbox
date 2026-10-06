import { h, toast } from '../../core/ui.js';

/**
 * 快捷控制：Windows 全局快捷键（默认关闭）。
 *  - Alt+Q：强制关闭当前前台应用
 *  - Alt+~：在当前前台应用的多个窗口间循环
 *  - Alt+Tab：可选的 Mac 风格大图标应用切换器
 * 主进程 app-controls.js 负责安全名单与窗口 API，这里只做开关和演示。
 */
export default {
  id: 'controls',
  title: '快捷控制',
  icon: 'zap',
  hint: 'Alt+Tab 大图标切换 / Alt+Q 强关 / Alt+~ 循环窗口（默认关闭）',

  create(root, ctx) {
    const isWindows = window.toolbox.platform === 'win32';
    if (!isWindows) {
      // macOS：把「快捷控制」做成「鼠标侧键 → 切换应用」。
      const config = ctx?.config;
      const get = (k, d) => (config ? config.get(k, d) : d);
      const setCfg = (k, v) => (config ? config.set(k, v) : Promise.resolve());
      let back = Number(get('mouseSwitch.back', 3)) || 3;
      let fwd = Number(get('mouseSwitch.fwd', 4)) || 4;

      const enabledToggle = h('input', { type: 'checkbox', class: 'switch__input' });
      const statusTag = h('span', { class: 'tag' }, '已关闭');
      const backLabel = h('kbd', { class: 'controls__key' }, `侧键 ${back}`);
      const fwdLabel = h('kbd', { class: 'controls__key' }, `侧键 ${fwd}`);

      async function refreshStatus() {
        const st = await window.toolbox.mouseSwitch.status();
        if (st.running) { statusTag.textContent = '已开启'; statusTag.className = 'tag tag--good'; }
        else if (enabledToggle.checked) { statusTag.textContent = st.error || '未启动'; statusTag.className = 'tag tag--bad'; }
        else { statusTag.textContent = '已关闭'; statusTag.className = 'tag'; }
      }

      async function applyEnabled(on) {
        await setCfg('mouseSwitch.enabled', on);
        if (on) {
          const r = await window.toolbox.mouseSwitch.start(back, fwd);
          toast(r.ok ? '鼠标侧键切换已开启' : (r.error || '启动失败'), r.ok ? 'good' : 'bad', r.ok ? 2500 : 6000);
        } else {
          await window.toolbox.mouseSwitch.stop();
          toast('鼠标侧键切换已关闭', 'info');
        }
        refreshStatus();
      }
      enabledToggle.addEventListener('change', () => applyEnabled(enabledToggle.checked));

      async function learnButton(which) {
        const name = which === 'back' ? '上一个应用' : '下一个应用';
        toast(`请在 8 秒内按一下你想用作「${name}」的鼠标侧键…`, 'info', 6000);
        const r = await window.toolbox.mouseSwitch.learn(8000);
        if (r.button == null) {
          toast('没捕捉到侧键（超时）。确认鼠标侧键能发 otherMouse 事件，且已在「辅助功能」里打开 Agent 工具箱。', 'bad', 7000);
        } else if (which === 'back') {
          back = r.button; backLabel.textContent = `侧键 ${back}`; await setCfg('mouseSwitch.back', back);
          toast(`已把侧键 ${back} 设为「上一个应用」`, 'good');
        } else {
          fwd = r.button; fwdLabel.textContent = `侧键 ${fwd}`; await setCfg('mouseSwitch.fwd', fwd);
          toast(`已把侧键 ${fwd} 设为「下一个应用」`, 'good');
        }
        if (enabledToggle.checked) await window.toolbox.mouseSwitch.start(back, fwd);  // 用新键号重启
        refreshStatus();
      }

      root.append(
        h('div', { class: 'bar bar--drag' },
          h('strong', {}, '鼠标侧键切换'),
          h('span', { class: 'faint' }, 'macOS · 侧键当 Cmd+Tab'),
          h('span', { style: { flex: 1 } }),
          statusTag,
        ),
        h('div', { class: 'dock__body' },
          h('section', { class: 'card' },
            h('h2', {}, '用鼠标拇指键切换应用'),
            h('p', { class: 'faint' }, '长按侧键呼出应用切换器(Cmd+Tab 大图标)并保持，再连点侧键在应用间移动高亮，停一下就落定切换；轻点一下则是快速切到上/下一个。'),
            h('label', { class: 'switch switch--large', style: { margin: '6px 0 10px' } }, enabledToggle, h('span', { class: 'switch__track' }), '启用'),
            h('div', { class: 'controls__shortcut-row' }, backLabel, h('span', { class: 'controls__shortcut-name' }, '→ 上一个应用（Cmd+Tab）'), h('button', { class: 'btn btn--sm', onclick: () => learnButton('back') }, '学习此键')),
            h('div', { class: 'controls__shortcut-row' }, fwdLabel, h('span', { class: 'controls__shortcut-name' }, '→ 下一个应用（Cmd+Shift+Tab）'), h('button', { class: 'btn btn--sm', onclick: () => learnButton('fwd') }, '学习此键')),
            h('p', { class: 'faint' }, '默认用「后退/前进」两个侧键（编号 3 / 4）。要是不对，点「学习此键」再按一下你的侧键就行。首次启用需要在 系统设置 → 隐私与安全性 → 辅助功能 里打开「Agent 工具箱」。'),
          ),
        ),
      );
      enabledToggle.checked = Boolean(get('mouseSwitch.enabled', false));
      refreshStatus();
      return {};
    }

    let state = { supported: true, enabled: false, altTabEnabled: false, registered: false, shortcuts: { close: 'Alt+Q', cycle: 'Alt+~', altTab: 'Alt+Tab' }, conflicts: [] };

    const masterToggle = h('input', { type: 'checkbox', class: 'switch__input' });
    const altTabToggle = h('input', { type: 'checkbox', class: 'switch__input' });
    const heroAltTabToggle = h('input', { type: 'checkbox', class: 'switch__input' });
    const statusTag = h('span', { class: 'tag' }, '已关闭');
    const registeredHint = h('span', { class: 'controls__reg-hint faint' }, '');
    const shortcutStatus = h('div', { class: 'controls__shortcut-status' });

    function renderShortcutStatus() {
      const rows = [
        ['closeRegistered', state.shortcuts.close, '强制关闭当前应用', state.enabled],
        ['cycleRegistered', state.shortcuts.cycle, '循环同应用窗口', state.enabled],
        ['altTabRegistered', state.shortcuts.altTab, '大图标应用切换器', state.altTabEnabled],
        ['quitRegistered', state.shortcuts.quitSelf || 'Ctrl+Shift+Q', '退出 Toolbox', true],
      ];
      shortcutStatus.replaceChildren(...rows.map(([key, shortcut, label, wanted]) => {
        const ok = Boolean(state[key]);
        const status = !wanted ? '未开启' : ok ? '可用' : '冲突';
        return h('div', { class: `controls__shortcut-row ${wanted && !ok ? 'is-conflict' : ''}` },
          h('kbd', { class: 'controls__key' }, shortcut),
          h('span', { class: 'controls__shortcut-name' }, label),
          h('span', { class: `tag ${ok ? 'tag--good' : wanted ? 'tag--bad' : ''}` }, status),
        );
      }));
    }

    function render(next) {
      state = { ...state, ...next };
      if (typeof state.enabled === 'boolean') masterToggle.checked = state.enabled;
      if (typeof state.altTabEnabled === 'boolean') { altTabToggle.checked = state.altTabEnabled; heroAltTabToggle.checked = state.altTabEnabled; }
      const anyEnabled = state.enabled || state.altTabEnabled;
      if (anyEnabled && state.registered !== false) {
        statusTag.textContent = '已开启';
        statusTag.className = 'tag tag--good';
        registeredHint.textContent = state.altTabEnabled ? 'Alt+Tab 已由 Toolbox 接管' : '基础快捷键已注册';
      } else if (anyEnabled && state.registered === false) {
        statusTag.textContent = '快捷键冲突';
        statusTag.className = 'tag tag--bad';
        const labels = (state.conflicts || []).map((item) => item.shortcut).join('、');
        registeredHint.textContent = labels ? `${labels} 被占用或启动失败` : '其中一个快捷键被其他应用占用了';
      } else {
        statusTag.textContent = '已关闭';
        statusTag.className = 'tag';
        registeredHint.textContent = '默认关闭：打开后才会在全局生效。';
      }
      renderShortcutStatus();
    }

    masterToggle.addEventListener('change', async () => {
      const result = await window.toolbox.appControls.setEnabled(masterToggle.checked);
      render(result);
      toast(result.registered !== false ? `快捷控制已${result.enabled ? '开启' : '关闭'}` : '快捷键有冲突，未能全部注册', result.registered !== false ? (result.enabled ? 'good' : 'info') : 'bad');
    });

    async function toggleAltTab(enabled) {
      altTabToggle.disabled = true; heroAltTabToggle.disabled = true;
      try {
        const result = await window.toolbox.appControls.setAltTabEnabled(enabled);
        render(result);
        if (result.altTabEnabled && !result.altTabRegistered) toast('Alt+Tab 接管启动失败，冲突状态已列在下方', 'bad');
        else toast(result.altTabEnabled ? 'Alt+Tab 已换成大图标切换器' : 'Alt+Tab 已恢复为 Windows 默认样式', result.altTabEnabled ? 'good' : 'info');
      } finally {
        altTabToggle.disabled = false; heroAltTabToggle.disabled = false;
      }
    }
    altTabToggle.addEventListener('change', () => toggleAltTab(altTabToggle.checked));
    heroAltTabToggle.addEventListener('change', () => toggleAltTab(heroAltTabToggle.checked));

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
      if (result.pending) return;
      if (result.ok) toast('已切到下一个窗口', 'good', 1800);
      else toast(result.error || '当前应用没有可循环的窗口。', 'info');
    }

    async function refresh() {
      render(await window.toolbox.appControls.status());
    }

    window.toolbox.appControls.onResult((result) => {
      if (result?.action === 'status') { render(result); if (result.error) toast(result.error, 'bad'); return; }
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
            h('h2', {}, '像 Mac 一样切换应用'),
            h('p', { class: 'faint' }, 'Alt+Tab 只显示大图标，不展示窗口内容；关闭开关或退出 Toolbox 后立即恢复系统默认。'),
          ),
          h('div', { class: 'controls__hero-action' },
            h('div', { class: 'controls__key-stack' },
              h('kbd', { class: 'controls__key controls__key--large' }, 'Alt + Tab'),
              h('span', { class: 'faint' }, '大图标切换应用'),
            ),
            h('label', { class: 'switch controls__switch', title: '开启 Mac 风格 Alt+Tab' }, heroAltTabToggle, h('span', { class: 'switch__track' })),
          ),
        ),
        h('div', { class: 'controls__section-label' }, '应用切换'),
        h('section', { class: 'controls__alt-tab-card' },
          h('div', { class: 'controls__alt-tab-preview', 'aria-hidden': 'true' },
            ...['◈', '◆', '●', '▣'].map((symbol, index) => h('span', { class: index === 1 ? 'is-selected' : '' }, symbol)),
          ),
          h('div', { class: 'controls__alt-tab-copy' },
            h('strong', {}, 'Mac 风格 Alt+Tab'),
            h('p', { class: 'faint' }, '按住 Alt 连按 Tab 选择，松开 Alt 切换。只按应用分组显示大图标，不显示标题和内容缩略图。'),
            h('small', { class: 'faint' }, 'Alt+Shift+Tab 反向 · Alt+Esc 取消'),
          ),
          h('label', { class: 'switch controls__switch', title: '覆盖 Windows Alt+Tab' }, altTabToggle, h('span', { class: 'switch__track' })),
        ),
        h('div', { class: 'controls__section-label' }, '其他快捷动作'),
        h('section', { class: 'controls__basic-toggle' },
          h('div', {}, h('strong', {}, 'Alt 快捷动作总开关'), h('p', { class: 'faint' }, '只控制下方 Alt+Q 和 Alt+~，与 Alt+Tab 独立。')),
          h('label', { class: 'switch controls__switch', title: '启用 Ctrl 快捷动作' }, masterToggle, h('span', { class: 'switch__track' })),
        ),
        h('div', { class: 'controls__actions' },
          h('section', { class: 'controls__action-card controls__action-card--danger' },
            h('div', { class: 'controls__action-top' },
              h('div', { class: 'controls__row-icon' }, '✕'),
              h('kbd', { class: 'controls__key' }, 'Alt + Q'),
            ),
            h('strong', {}, '强制关闭当前应用'),
            h('p', { class: 'faint' }, '结束当前前台应用及其子进程。未保存的内容会丢失。'),
            closeBtn,
          ),
          h('section', { class: 'controls__action-card' },
            h('div', { class: 'controls__action-top' },
              h('div', { class: 'controls__row-icon' }, '⇄'),
              h('kbd', { class: 'controls__key' }, 'Alt + ~'),
            ),
            h('strong', {}, '循环同一应用窗口'),
            h('p', { class: 'faint' }, '只在当前应用自己的多个窗口之间切换，不打断其他应用。'),
            cycleBtn,
          ),
        ),
        h('div', { class: 'controls__section-label' }, '快捷键状态'),
        shortcutStatus,
        h('section', { class: 'controls__note' },
          h('div', { class: 'controls__note-icon' }, '盾'),
          h('div', {},
            h('strong', {}, '安全与隐私'),
            h('p', { class: 'faint' }, 'Alt+Tab 只读取应用名称、图标和窗口句柄；不会读取或截图窗口内容。所有数据只在本机处理。'),
          ),
        ),
      ),
    );

    refresh();

    return { activate: refresh };
  },
};
