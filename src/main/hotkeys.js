'use strict';

/**
 * 全局快捷键的登记表和校验。
 *
 * 默认键刻意避开 ⌘⇧X 这类别的软件也爱用的组合（⌘⇧A 就和用户别的软件撞过）。
 * 用户在设置里可以改、可以关（存空串）。
 */

const IS_MAC = process.platform === 'darwin';

const HOTKEYS = {
  wake: { label: '叫回工具箱窗口', hint: '关掉窗口后从任何地方按它把窗口叫回来（菜单栏图标和 Dock 图标也行）', def: IS_MAC ? 'Alt+Shift+A' : 'Control+Alt+A' },
  explain: { label: '选中即讲', hint: '在任何应用里选中一段文字，桌宠弹出四行解释', def: 'CommandOrControl+Shift+L' },
  monologue: { label: '内心独白', hint: '选中一句话，浮窗给解读', def: 'CommandOrControl+Shift+M' },
};

const MODIFIERS = new Set(['Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta']);
const KEY_RE = /^([A-Z]|[0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Plus|[`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>\/?])$/;

/** 校验并规整成 Electron 认的写法；不合法返回 null；空串表示关闭 */
function normalizeAccelerator(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;                   // 至少一个修饰键
  const key = parts.pop();
  const canon = { cmd: 'Command', command: 'Command', ctrl: 'Control', control: 'Control', option: 'Alt', alt: 'Alt', altgr: 'AltGr', shift: 'Shift', super: 'Super', meta: 'Meta', cmdorctrl: 'CommandOrControl', commandorcontrol: 'CommandOrControl' };
  const mods = parts.map((m) => canon[m.toLowerCase()] || m);
  if (!mods.every((m) => MODIFIERS.has(m))) return null;
  const upperKey = key.length === 1 ? key.toUpperCase() : key;
  if (!KEY_RE.test(upperKey)) return null;
  if (new Set(mods).size !== mods.length) return null;
  return [...mods, upperKey].join('+');
}

/** 显示用：mac 上 ⌘⇧A，别的平台 Ctrl+Shift+A */
function accelLabel(accel, isMac = IS_MAC) {
  if (!accel) return '已关闭';
  const parts = accel.split('+');
  if (!isMac) return parts.map((p) => ({ CommandOrControl: 'Ctrl', Command: 'Win', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift' }[p] || p)).join('+');
  const sym = { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Space: '␣' };
  return parts.map((p) => sym[p] || p).join('');
}

module.exports = { HOTKEYS, normalizeAccelerator, accelLabel, IS_MAC };
