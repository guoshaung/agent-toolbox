/**
 * 设置页录快捷键用：把 keydown 事件翻译成 Electron 的加速键写法。
 * 只认「修饰键 + 一个键」，纯修饰键或没有修饰键都返回 null。
 */
export function acceleratorFromKeyEvent(e, isMac = navigator.platform.includes('Mac')) {
  const mods = [];
  if (e.metaKey) mods.push(isMac ? 'Command' : 'Super');
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (!mods.length) return null;
  const code = String(e.code || '');
  let key = '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else key = { Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Enter: 'Return', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' }[code] || '';
  if (!key) return null;
  return [...mods, key].join('+');
}
