'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 图板快捷键挂在 document 上；它必须只在面板真的可见时响应，否则在别的工具里按 ⌘V 会往图板贴图
test('科研图板：全局快捷键先判面板可见（offsetParent）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'tools', 'research', 'figureboard.js'), 'utf8');
  const fn = src.slice(src.indexOf('function handleShortcut'), src.indexOf('function handleShortcut') + 600);
  assert.match(fn, /root\.offsetParent === null/);
  assert.ok(src.includes("document.addEventListener('keydown', handleShortcut)"));
});
