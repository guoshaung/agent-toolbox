'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('示意图编辑器箭头按连线独立生成，并随线宽缩放', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/tools/research/figure-drafter.html'), 'utf8');
  assert.match(source, /function edgeMarkerId\(e\)/);
  assert.match(source, /src="\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/mathjax\/es5\/tex-svg\.js"/);
  assert.match(source, /markerUnits="userSpaceOnUse"/);
  assert.match(source, /const width = Math\.max\(7, Math\.min\(18, sw \* 5\.2\)\)/);
  assert.match(source, /marker-start="url\(#\$\{mid\}\)"/);
  assert.doesNotMatch(source, /id="\$\{id\}o"/);
});
