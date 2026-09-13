'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  downloadPapersBatch, fetchPaperByTitle, normalizeDoi, extractDoi, classifyLiteratureInput,
  restoreAbstract, queryTerms, relevanceDetail, rankPaper, downloadPdfWithFetch, directPdfFromLink,
} = require('../src/main/lit-fetch');

test('DOI 规范化去掉链接和 doi 前缀', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1234/ABC'), '10.1234/ABC');
  assert.equal(normalizeDoi('doi: 10.1234/ABC'), '10.1234/ABC');
  assert.equal(normalizeDoi('https://doi.org/10.1234/ABC?utm_source=test'), '10.1234/ABC');
  assert.equal(extractDoi('论文 DOI: 10.48550/arXiv.2401.12345.'), '10.48550/arXiv.2401.12345');
});

test('文献输入路由不会把 DOI 和 arXiv 摘要页误当成 PDF 直链', () => {
  assert.deepEqual(classifyLiteratureInput('https://doi.org/10.1234/ABC'), { kind: 'doi', doi: '10.1234/ABC' });
  assert.deepEqual(classifyLiteratureInput('https://arxiv.org/abs/2401.12345v2'), { kind: 'arxiv', id: '2401.12345' });
  assert.deepEqual(classifyLiteratureInput('2401.12345'), { kind: 'arxiv', id: '2401.12345' });
  assert.deepEqual(classifyLiteratureInput('https://example.com/download?id=1'), { kind: 'url', url: 'https://example.com/download?id=1' });
  assert.deepEqual(classifyLiteratureInput('论文链接：https://example.com/paper.pdf?download=1。'), { kind: 'url', url: 'https://example.com/paper.pdf?download=1' });
  assert.deepEqual(classifyLiteratureInput('[PDF 下载](https://example.com/paper.pdf)'), { kind: 'url', url: 'https://example.com/paper.pdf' });
  assert.deepEqual(classifyLiteratureInput('[PDF](https://example.com/paper.pdf?download=1&amp;token=abc)'), { kind: 'url', url: 'https://example.com/paper.pdf?download=1&token=abc' });
  assert.deepEqual(classifyLiteratureInput('attention is all you need'), { kind: 'text', query: 'attention is all you need' });
});

test('标题检索识别明确的开放 PDF 链接，但不把普通论文页当成 PDF', () => {
  assert.equal(directPdfFromLink('https://openreview.net/pdf?id=abc'), 'https://openreview.net/pdf?id=abc');
  assert.equal(directPdfFromLink('https://example.com/paper.pdf?download=1'), 'https://example.com/paper.pdf?download=1');
  assert.equal(directPdfFromLink('https://example.com/paper'), null);
});

test('OpenAlex 倒排摘要按位置还原', () => {
  assert.equal(restoreAbstract({ hello: [1], world: [0, 2] }), 'world hello world');
  assert.equal(restoreAbstract(null), '');
});

test('科研检索优先要求标题命中核心关键词', () => {
  const detail = relevanceDetail({ title: 'Multimodal Large Language Models for Hallucination Evaluation', abstract: '' }, 'multimodal large language model hallucination evaluation');
  assert.equal(detail.relevant, true);
  assert.ok(detail.titleMatches.length >= 4);

  const unrelated = relevanceDetail({ title: 'A Survey of Optimization Methods', abstract: 'multimodal models and hallucination appear in related work' }, 'multimodal large language model hallucination evaluation');
  assert.equal(unrelated.relevant, false);

  const partial = relevanceDetail({ title: 'Multimodal Large Language Models for Vision', abstract: '' }, 'multimodal large language model hallucination evaluation');
  assert.equal(partial.relevant, false);
});

test('中文研究方向会去掉停用词并保留主题短语', () => {
  const terms = queryTerms('多模态大模型的幻觉评测与缓解');
  assert.ok(terms.includes('多模态大模型'));
  assert.ok(terms.includes('幻觉'));
  assert.ok(!terms.includes('的'));
  assert.ok(rankPaper({ title: '多模态大模型幻觉评测方法', abstract: '', citedBy: 0 }, '多模态大模型的幻觉评测与缓解') > 0);
});

test('只有泛词的检索式会被拒绝', async () => {
  const { discoverPapers } = require('../src/main/lit-fetch');
  const result = await discoverPapers({ query: '研究 方法' });
  assert.equal(result.ok, false);
  assert.match(result.error, /具体主题词/);
});

test('粘贴 PDF 直链时直接下载入库，不走标题检索', async () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length });
    response.end(pdf);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lit-direct-'));
  try {
    const result = await fetchPaperByTitle(directory, `[PDF](http://127.0.0.1:${port}/files/agent-paper.pdf?download=1)`);
    assert.equal(result.ok, true);
    assert.equal(result.title, 'agent-paper');
    assert.equal(result.format, 'pdf');
    assert.equal(fs.readFileSync(path.join(directory, result.file)).subarray(0, 5).toString(), '%PDF-');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('原生 fetch 下载 PDF 时同样校验文件头和大小', async () => {
  const pdf = Buffer.from('%PDF-1.7\n%%EOF');
  const server = http.createServer((request, response) => {
    if (request.url === '/html') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html>login</html>');
      return;
    }
    if (request.url === '/chunked') {
      response.writeHead(200, { 'content-type': 'application/pdf' });
      response.write('%PDF-1.7\n');
      response.end('%%EOF');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length });
    response.end(pdf);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await downloadPdfWithFetch(`http://127.0.0.1:${server.address().port}/paper.pdf`, 5000);
    assert.equal(result.toString('utf8', 0, 5), '%PDF-');
    const chunked = await downloadPdfWithFetch(`http://127.0.0.1:${server.address().port}/chunked`, 5000);
    assert.equal(chunked.toString('utf8', 0, 5), '%PDF-');
    const invalid = await downloadPdfWithFetch(`http://127.0.0.1:${server.address().port}/html`, 5000);
    assert.equal(invalid, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('开放全文批量下载会继续处理失败候选并返回汇总', async () => {
  const progress = [];
  const result = await downloadPapersBatch('/tmp/agent-toolbox-test-literature', [
    { title: '没有开放地址的论文 A', landingUrl: 'https://example.com/a' },
    { title: '没有开放地址的论文 B', landingUrl: 'https://example.com/b' },
  ], (state) => progress.push(state));
  assert.equal(result.ok, false);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 2);
  assert.equal(result.total, 2);
  assert.deepEqual(progress.map((state) => state.state), ['opening', 'failed', 'opening', 'failed']);
});
