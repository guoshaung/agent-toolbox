'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('dropActions：按拖进来的东西给选项', async () => {
  const { dropActions } = await import('../src/renderer/core/dropzone.js');
  const ids = (paths, o) => dropActions(paths, o).map((a) => a.id);
  assert.deepEqual(ids(['/Users/x/proj']), ['learn', 'container', 'phone', 'reveal'], '一个文件夹：能看懂');
  assert.deepEqual(ids(['/Users/x/a.pdf']), ['lit', 'container', 'phone', 'reveal'], 'PDF：能进文献库');
  assert.deepEqual(ids(['/Users/x/a.png', '/Users/x/b.jpg']), ['container', 'phone', 'avatar', 'reveal'], '全是图：能建模');
  assert.deepEqual(ids(['/Users/x/a.pdf'], { hasPhone: false }), ['lit', 'container', 'reveal']);
  assert.deepEqual(ids([]), []);
  const lit = dropActions(['/Users/x/a.pdf', '/Users/x/b.png']).find((a) => a.id === 'lit');
  assert.deepEqual(lit.only, ['/Users/x/a.pdf'], '文献只收 PDF 那一个');
});
