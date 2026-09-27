'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HOTKEYS, normalizeAccelerator, accelLabel } = require('../src/main/hotkeys');

test('快捷键：默认值不再是 ⌘⇧A，且都合法', () => {
  for (const [id, def] of Object.entries(HOTKEYS)) {
    assert.ok(normalizeAccelerator(def.def), `${id} 默认值不合法`);
    assert.notEqual(def.def, 'CommandOrControl+Shift+A');
  }
});

test('快捷键：校验和规整', () => {
  assert.equal(normalizeAccelerator(''), '');
  assert.equal(normalizeAccelerator('Command+Shift+a'), 'Command+Shift+A');
  assert.equal(normalizeAccelerator('cmd+shift+L'), 'Command+Shift+L');
  assert.equal(normalizeAccelerator('Alt+Space'), 'Alt+Space');
  assert.equal(normalizeAccelerator('A'), null, '没有修饰键');
  assert.equal(normalizeAccelerator('Shift+Shift+A'), null, '重复修饰键');
  assert.equal(normalizeAccelerator('Foo+A'), null, '不认识的修饰键');
  assert.equal(normalizeAccelerator('Command+Shift+Ä'), null);
  assert.equal(accelLabel('Alt+Shift+A', true), '⌥⇧A');
  assert.equal(accelLabel('CommandOrControl+Shift+L', false), 'Ctrl+Shift+L');
  assert.equal(accelLabel('', true), '已关闭');
});

test('快捷键：设置页录键把 keydown 翻成加速键', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'core', 'hotkeys.js'), 'utf8').replace('export function', 'function');
  const fn = new Function(`${src}; return acceleratorFromKeyEvent;`)();
  assert.equal(fn({ altKey: true, shiftKey: true, code: 'KeyA' }, true), 'Alt+Shift+A');
  assert.equal(fn({ metaKey: true, shiftKey: true, code: 'KeyL' }, true), 'Command+Shift+L');
  assert.equal(fn({ ctrlKey: true, code: 'Digit1' }, false), 'Control+1');
  assert.equal(fn({ code: 'KeyA' }, true), null, '没有修饰键');
  assert.equal(fn({ metaKey: true, code: 'MetaLeft' }, true), null, '纯修饰键');
});
