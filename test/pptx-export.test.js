'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportPptx, normalizeDeck } = require('../src/main/pptx-export');

test('PPTX 导出：规范化多页内容并写出可打开的 Office 文件', async () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const deck = normalizeDeck({
    title: '  科研演示  ',
    slides: [{ title: '问题', body: '第一点\n第二点', notes: '讲稿' }, { title: '结果', bullets: ['提升明显'], references: 'Paper A', imageDataUrl: tinyPng }],
  });
  assert.equal(deck.title, '科研演示');
  assert.deepEqual(deck.slides[0].bullets, ['第一点', '第二点']);
  assert.equal(deck.slides.length, 2);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-pptx-'));
  const file = path.join(directory, 'research.pptx');
  try {
    const result = await exportPptx(file, deck);
    assert.equal(result.ok, true);
    assert.equal(result.slides, 2);
    assert.ok(result.size > 1000);
    assert.equal(fs.readFileSync(file).subarray(0, 2).toString(), 'PK');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
