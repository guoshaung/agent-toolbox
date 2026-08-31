'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

/**
 * 按文献名自动下载免费 PDF。
 *
 * 检索顺序（export.arxiv.org 限流、Semantic Scholar 被墙，不用）：
 *   1. 输入直接是 arXiv 号/链接 → arxiv.org/pdf 直下
 *   2. OpenAlex autocomplete 标题直查 + 全文 search → arXiv 位置 / OA PDF
 *   3. Crossref 标题搜索 → link 里 content-type 为 application/pdf 的直链
 * 都找不到免费源就明确报错，让用户自己下载后手动导入。
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const MAX_PDF_BYTES = 60 * 1024 * 1024;

async function fetchJson(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
}

/** 字符 bigram Dice 相似度：词序/插词敏感（"attention is NOT all you need" 骗不过它） */
function diceScore(q, t) {
  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    return set;
  };
  const a = bigrams(q);
  const b = bigrams(t);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter += 1;
  return (2 * inter) / (a.size + b.size);
}

/** 标题相似度评分：0 = 不匹配。完全相等 1.0，互相包含 0.9，bigram 相似度 ≥0.75 按实际值。 */
function titleScore(query, title) {
  const q = normalize(query);
  const t = normalize(title);
  if (!q || !t) return 0;
  if (q === t) return 1;
  if (t.includes(q) || q.includes(t)) return 0.9;
  const dice = diceScore(q, t);
  return dice >= 0.75 ? dice : 0;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

function arxivPdfFromLink(link) {
  const m = String(link || '').match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/i)
    || String(link || '').match(/10\.48550\/arXiv\.(\d{4}\.\d{4,5})/i);
  return m ? `https://arxiv.org/pdf/${m[1]}` : null;
}

/** dblp：CS 领域标题检索最准，ee 链接常带 arXiv 号 */
async function searchDblp(query) {
  const data = await fetchJson(`https://dblp.org/search/publ/api?q=${encodeURIComponent(query)}&format=json&h=10`);
  const hits = [];
  for (const hit of data?.result?.hits?.hit || []) {
    const info = hit.info || {};
    const title = decodeEntities(info.title).replace(/\.$/, '');
    const score = titleScore(query, title);
    if (!score) continue;
    const ees = Array.isArray(info.ee) ? info.ee : [info.ee];
    for (const ee of ees.filter(Boolean)) {
      const pdfUrl = arxivPdfFromLink(ee);
      if (pdfUrl) { hits.push({ title, pdfUrl, score }); break; }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

/** 输入里直接给了 arXiv 号 / 链接的情况 */
function extractArxivId(input) {
  const m = String(input || '').match(/(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(v\d+)?/i)
    || String(input || '').match(/\b([a-z-]+\/\d{7})(v\d+)?\b/i); // 旧格式 hep-th/9901001
  return m ? m[1] : null;
}

/** 从一条 OpenAlex 记录里挑最靠谱的 PDF：arXiv 号（含 doi.org/10.48550 形式）> 任意 PDF 直链 > OA 位置 */
function pickPdfFromWork(w) {
  let anyPdf = null;
  for (const loc of w.locations || []) {
    const hay = `${loc.landing_page_url || ''} ${loc.pdf_url || ''}`;
    const aid = (hay.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i)
      || hay.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i))?.[1];
    if (aid) return `https://arxiv.org/pdf/${aid}`;
    if (!anyPdf && loc.pdf_url) anyPdf = loc.pdf_url;
  }
  return anyPdf || w.best_oa_location?.pdf_url || w.primary_location?.pdf_url || null;
}

const WORK_SELECT = 'select=title,best_oa_location,primary_location,locations';

/** OpenAlex autocomplete：专为标题检索设计，普通 search 排名漏掉的论文这里能补上 */
async function autocompleteWorkIds(query) {
  const data = await fetchJson(`https://api.openalex.org/autocomplete/works?q=${encodeURIComponent(query)}`);
  return (data?.results || []).slice(0, 4)
    .map((r) => ({ id: (r.id || '').split('/').pop(), title: r.display_name || '' }))
    .filter((r) => r.id && titleScore(query, r.title));
}

async function fetchWorkById(id) {
  return fetchJson(`https://api.openalex.org/works/${id}?${WORK_SELECT}`);
}

/** OpenAlex：autocomplete（标题直查）+ 全文 search 两路候选合并 */
async function searchOpenAlex(query) {
  const hits = [];
  const seen = new Set();
  const push = (w, score) => {
    if (!w?.title || seen.has(w.title)) return;
    const pdfUrl = pickPdfFromWork(w);
    if (!pdfUrl) return;
    seen.add(w.title);
    hits.push({ title: w.title, pdfUrl, score });
  };

  // 第一路：autocomplete 命中的作品逐个取详情
  const ids = await autocompleteWorkIds(query);
  for (const { id, title } of ids) {
    const w = await fetchWorkById(id);
    push(w, titleScore(query, w?.title || title) || 0.7);
  }

  // 第二路：全文 search 补漏
  const data = await fetchJson(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=10&${WORK_SELECT}`);
  for (const w of data?.results || []) {
    const score = titleScore(query, w.title);
    if (score) push(w, score);
  }

  // 重合度高的优先；同分 arXiv 优先（免费且本网络可下）
  hits.sort((a, b) => (b.score - a.score)
    || (Number(b.pdfUrl.includes('arxiv.org')) - Number(a.pdfUrl.includes('arxiv.org'))));
  return hits;
}

/** Crossref 兜底：部分出版商在 link 里挂全文 PDF */
async function searchCrossref(query) {
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=5&select=title,link,URL`;
  const data = await fetchJson(url);
  const hits = [];
  for (const w of data?.message?.items || []) {
    const title = Array.isArray(w.title) ? w.title[0] : w.title;
    const score = titleScore(query, title);
    if (!score) continue;
    const pdf = (w.link || []).find((l) => l['content-type'] === 'application/pdf' && l.URL);
    if (pdf) hits.push({ title, pdfUrl: pdf.URL, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

/**
 * 下载 PDF。Node fetch（undici）被 arXiv 按 TLS 指纹挂起，curl 能过，
 * 所以统一走 curl。下载到临时文件，校验 %PDF- 魔数后读回 Buffer。
 */
async function downloadPdf(url, timeout = 60000) {
  const tmp = path.join(os.tmpdir(), `toolbox-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await execFileAsync('curl', [
      '-sL', '--max-time', String(Math.ceil(timeout / 1000)),
      '-A', UA, '-o', tmp, url,
    ], { timeout: timeout + 10000 });
    const buf = fs.readFileSync(tmp);
    if (!buf.slice(0, 5).equals(Buffer.from('%PDF-'))) return null;
    if (buf.length > MAX_PDF_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 临时文件清不掉就算了 */ }
  }
}

function sanitizeFileStem(title) {
  const s = String(title || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 120) || 'paper';
}

/**
 * 主入口：按名字找到免费 PDF 并写进文献目录。
 * 返回 { ok, file, title, source, size, format } 或 { ok: false, error }
 */
async function fetchPaperByTitle(litDir, query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: '先输入文献名' };

  let hits = [];
  const directId = extractArxivId(q);
  if (directId) {
    hits = [{ title: `arXiv ${directId}`, pdfUrl: `https://arxiv.org/pdf/${directId}`, score: 1 }];
  } else {
    const seen = new Set();
    const merge = (list) => {
      for (const hit of list || []) {
        const key = normalize(hit.title);
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(hit);
      }
    };
    // dblp 标题检索最准排最前；OpenAlex 补非 CS 领域；Crossref 最后兜底
    merge(await searchDblp(q));
    merge(await searchOpenAlex(q));
    if (!hits.length) merge(await searchCrossref(q));
    hits.sort((a, b) => (b.score - a.score)
      || (Number(b.pdfUrl.includes('arxiv.org')) - Number(a.pdfUrl.includes('arxiv.org'))));
  }
  if (!hits.length) {
    return { ok: false, code: 'not-found', error: 'dblp / OpenAlex / Crossref 都没搜到匹配的免费文献。这篇可能要自己去知网/出版社站点下载，再用「导入文献」放进来。' };
  }

  // 候选挨个试，第一个下成功的入库
  let lastUrl = hits[0].pdfUrl;
  for (const hit of hits) {
    lastUrl = hit.pdfUrl;
    const buf = await downloadPdf(hit.pdfUrl);
    if (!buf) continue;
    const stem = sanitizeFileStem(hit.title);
    let file = `${stem}.pdf`;
    let n = 1;
    while (fs.existsSync(path.join(litDir, file))) file = `${stem}-${n++}.pdf`;
    fs.writeFileSync(path.join(litDir, file), buf);
    const stat = fs.statSync(path.join(litDir, file));
    return { ok: true, file, title: hit.title, source: hit.pdfUrl, size: stat.size, format: 'pdf' };
  }
  return {
    ok: false,
    code: 'download-failed',
    title: hits[0].title,
    url: lastUrl,
    error: `找到了「${hits[0].title}」但 PDF 没下载成功（源站拒绝或不是免费 PDF）。`,
  };
}

module.exports = { fetchPaperByTitle };
