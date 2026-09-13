'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('PDF 文本按约 700 字合并，避免每行触发一次翻译请求', async () => {
  const { groupPdfLines } = await import('../src/renderer/tools/research/literature.js');
  const result = groupPdfLines(['第一行内容', '第二行内容', '第三行内容'], 4, 7, 700);
  assert.equal(result.length, 1);
  assert.equal(result[0].page, 4);
  assert.equal(result[0].paragraphId, 'p_008');
  assert.match(result[0].source, /第一行内容 第二行内容 第三行内容/);
});

test('文献库筛选覆盖文件名、标题、备注和阅读状态', async () => {
  const { filterLiteratureFiles } = await import('../src/renderer/tools/research/literature.js');
  const files = [
    { file: 'a.pdf' },
    { file: 'b.pdf' },
    { file: 'c.pdf' },
  ];
  const metadata = {
    'a.pdf': { title: 'Multimodal Agents', note: '重点', readStatus: 'reading' },
    'b.pdf': { title: 'Vision Models', note: 'baseline', readStatus: 'read' },
  };
  assert.deepEqual(filterLiteratureFiles(files, metadata, '重点').map((item) => item.file), ['a.pdf']);
  assert.deepEqual(filterLiteratureFiles(files, metadata, '', 'read').map((item) => item.file), ['b.pdf']);
  assert.deepEqual(filterLiteratureFiles(files, metadata, 'vision', 'all').map((item) => item.file), ['b.pdf']);
  assert.deepEqual(filterLiteratureFiles(files, metadata, '', 'unread').map((item) => item.file), ['c.pdf']);
});

test('双栏阅读先本地翻译，用户确认后才允许整篇快速翻译', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/tools/research/literature.js'), 'utf8');
  assert.match(source, /允许快速翻译（外网）/);
  assert.match(source, /allowRemote: bilingualRemoteAllowed/);
  assert.match(source, /bilingualFastButton\.hidden = false/);
});

test('整篇论文分析提示词要求原文依据、结构化字段和快速建议', async () => {
  const { buildPaperReportPrompt } = await import('../src/renderer/tools/research/readprompt.js');
  const prompt = buildPaperReportPrompt({ title: 'Test Paper', context: '[第 1 页] 方法与实验' });
  assert.match(prompt, /指出原文依据/);
  assert.match(prompt, /researchQuestion/);
  assert.match(prompt, /limitations/);
  assert.match(prompt, /quickAdvice/);
  assert.match(prompt, /原文未说明/);
  const { buildPaperReportMergePrompt } = await import('../src/renderer/tools/research/readprompt.js');
  assert.match(buildPaperReportMergePrompt({ title: 'Test Paper', parts: [{ oneLine: 'part' }] }), /分段分析/);
});

test('文献阅读器提供整篇分析按钮，并按文献恢复已保存报告', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/tools/research/literature.js'), 'utf8');
  assert.match(source, /整篇分析/);
  assert.match(source, /research\.litAnalysis\.\$\{current\.file\}/);
  assert.match(source, /restorePaperAnalysis\(\)/);
  assert.match(source, /快速解释核心机制/);
  assert.match(source, /导出 Markdown/);
  assert.match(source, /paperAnalysisMarkdown/);
  assert.match(source, /保存本地报告/);
  assert.match(source, /发布到飞书/);
  assert.match(source, /saveAnalysisReport/);
  assert.match(source, /snipOcr\(canvas\.toDataURL\('image\/png'\)\)/);
  assert.match(source, /正在汇总各章节分析/);
  assert.match(source, /explainSelection\(\)/);
  assert.match(source, /下一步学习建议/);
  assert.match(source, /正文较长，报告基于部分文本/);
  assert.match(source, /renderPaperAnalysis\(saved, Number\(saved\.sourceLength\) \|\| 0, Boolean\(saved\.truncated\)\)/);
  assert.match(source, /最近分析报告/);
  assert.match(source, /renderAnalysisHistory\(\)/);
  assert.match(source, /renderRecentReading\(\);\s*renderAnalysisHistory\(\);/);
});
