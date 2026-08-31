'use strict';
const path = require('node:path');
const fs = require('node:fs');

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

/** 词级匹配：等值或 8 字符词干相同（兜住 incentivizing/incentivizes 这类词形差） */
function wordHit(a, b) {
  if (a === b) return true;
  return a.slice(0, 8) === b.slice(0, 8) && Math.min(a.length, b.length) >= 5;
}

/** 标题相似度评分：0 = 不匹配；否则是词重合率（0.7–1）。归一化后互相包含直接给 1。 */
function titleScore(query, title) {
  const q = normalize(query);
  const t = normalize(title);
  if (!q || !t) return 0;
  if (t.includes(q) || q.includes(t)) return 1;
  const qw = q.split(' ');
  const tw = t.split(' ');
  let hit = 0;
  for (const a of qw) if (tw.some((b) => wordHit(a, b))) hit += 1;
  const ratio = hit / qw.length;
  return ratio >= 0.7 ? ratio : 0;
}

/** 输入里直接给了 arXiv 号 / 链接的情况 */
function extractArxivId(input) {
  const m = String(input || '').match(/(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(v\d+)?/i)
    || String(input || '').match(/\b([a-z-]+\/\d{7})(v\d+)?\b/i); // 旧格式 hep-th/9901001
  return m ? m[1] : null;
}

/** 从一条 OpenAlex 记录里挑最靠谱的 PDF：arXiv 位置 > OA 位置 > 主位置 */
function pickPdfFromWork(w) {
  for (const loc of w.locations || []) {
    const src = ((loc.source || {}).display_name || '').toLowerCase();
    const landing = loc.landing_page_url || '';
    const aid = (landing.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/i)
      || (loc.pdf_url || '').match(/arxiv\.org\/pdf\/(\d{4}\.\d{4,5})/i))?.[1];
    if (src.includes('arxiv') || aid) {
      return `https://arxiv.org/pdf/${aid || ''}`.replace(/\/$/, '');
    }
  }
  return w.best_oa_location?.pdf_url || w.primary_location?.pdf_url || null;
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

async function downloadPdf(url, timeout = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // 有的源站 200 但回 HTML 错误页，看魔数最稳
    if (!buf.slice(0, 5).equals(Buffer.from('%PDF-'))) return null;
    if (buf.length > MAX_PDF_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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
    hits = [{ title: `arXiv ${directId}`, pdfUrl: `https://arxiv.org/pdf/${directId}` }];
  } else {
    hits = await searchOpenAlex(q);
    if (!hits.length) hits = await searchCrossref(q);
  }
  if (!hits.length) {
    return { ok: false, error: 'OpenAlex 和 Crossref 都没搜到匹配的免费文献。这篇可能要自己去知网/出版社站点下载，再用「导入文献」放进来。' };
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
  return { ok: false, error: `找到了「${hits[0].title}」但 PDF 没下载成功（源站拒绝或不是免费 PDF）。可以浏览器打开 ${lastUrl} 手动下载后导入。` };
}

module.exports = { fetchPaperByTitle };
