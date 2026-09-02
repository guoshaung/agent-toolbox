'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Markdown 预览支持标题、加粗、列表、引用和表格', async () => {
  const { markdownToHtml } = await import('../src/renderer/tools/notebook/markdown.js');
  const html = markdownToHtml('# 标题\n\n**重点**\n\n- 一\n- 二\n\n> 提醒\n\n| 名称 | 值 |\n| --- | --- |\n| A | 1 |');
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<ul><li>一<\/li><li>二<\/li><\/ul>/);
  assert.match(html, /<blockquote>提醒<\/blockquote>/);
  assert.match(html, /<table>[\s\S]*<th>名称<\/th>[\s\S]*<td>1<\/td>/);
});

test('Markdown 预览会转义 HTML，并只保留 http(s) 链接', async () => {
  const { markdownToHtml } = await import('../src/renderer/tools/notebook/markdown.js');
  const html = markdownToHtml('<script>alert(1)</script>\n\n[文档](https://example.com/a)\n\n[危险](javascript:alert(1))');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /href="https:\/\/example\.com\/a"/);
  assert.doesNotMatch(html, /javascript:/i);
});

test('Markdown 格式化支持包裹选区和设置当前行标题', async () => {
  const { formatMarkdownHeading, formatMarkdownSelection } = await import('../src/renderer/tools/notebook/markdown.js');
  const bold = formatMarkdownSelection('hello', 0, 5, '**', '**');
  assert.deepEqual(bold, { value: '**hello**', start: 2, end: 7 });
  const heading = formatMarkdownHeading('原来的标题\n下一行', 0, 5, 2);
  assert.equal(heading.value, '## 原来的标题\n下一行');
});
