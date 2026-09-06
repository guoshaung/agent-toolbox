'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const dockSource = fs.readFileSync(path.join(root, 'src/main/window-dock.js'), 'utf8');
const askSource = fs.readFileSync(path.join(root, 'src/renderer/tools/ask/index.js'), 'utf8');

test('third-party partitions preserve Content-Security-Policy headers', () => {
  assert.doesNotMatch(mainSource, /onHeadersReceived/);
  assert.doesNotMatch(mainSource, /delete headers\[key\]/);
  assert.match(mainSource, /function configurePartition/);
});

test('BrowserWindows and attached webviews enable Chromium sandboxing', () => {
  assert.doesNotMatch(mainSource, /sandbox:\s*false/);
  assert.doesNotMatch(dockSource, /sandbox:\s*false/);
  assert.match(mainSource, /webPreferences\.sandbox = true/);
});

test('DeepSeek background uses Electron user CSS instead of page style injection', () => {
  assert.match(askSource, /view\.insertCSS\(css\)/);
  assert.match(askSource, /view\.removeInsertedCSS\(backgroundCssKey\)/);
  assert.doesNotMatch(askSource, /__tbx\.applyBackground/);
});
