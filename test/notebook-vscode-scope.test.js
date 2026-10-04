'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'tools', 'notebook', 'index.js'), 'utf8');

test('内嵌 VS Code 只用于代码工具，笔记始终使用经典 Markdown 编辑器', () => {
  assert.match(source, /const supportsVscode = boundMode === 'code'/);
  assert.match(source, /const vscodePanel = supportsVscode \? createVscodePanel/);
  assert.match(source, /let nbMode = supportsVscode \? config\.get\('notebook\.editorMode', 'vscode'\) : 'classic'/);
  assert.match(source, /if \(supportsVscode\) config\.set\('notebook\.editorMode', m\)/);
  assert.match(source, /if \(vscodePanel\) root\.append\(vscodePanel\.el\)/);
});
