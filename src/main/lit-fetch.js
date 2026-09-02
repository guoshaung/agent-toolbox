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

const SEARCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'using', 'use', 'based', 'study', 'paper',
  'research', 'method', 'methods', 'approach', 'towards', 'toward', '的', '和', '与', '及',
  '或', '在', '中', '对', '于', '研究', '方法', '基于', '关于', '一个', '进行', '以及',
]);

function queryTerms(query) {
  const terms = [];
  for (const token of String(query || '').toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) || []) {
    if (/^[a-z0-9]+$/.test(token)) {
      if (token.length >= 2 && !SEARCH_STOP_WORDS.has(token)) terms.push(token);
      continue;
    }
    const segments = token.split(/[的和与及或在中对关于于]/).filter((segment) => segment.length >= 2);
    for (const segment of segments) {
      if (SEARCH_STOP_WORDS.has(segment)) continue;
      terms.push(segment);
      for (let index = 0; index < segment.length - 1; index += 1) {
        const pair = segment.slice(index, index + 2);
        if (!SEARCH_STOP_WORDS.has(pair)) terms.push(pair);
      }
    }
  }
  return [...new Set(terms)];
}

function queryGroups(query) {
  const groups = [];
  for (const token of String(query || '').toLowerCase().match(/[a-z0-9 ]+|[\u4e00-\u9fff]{2,}/g) || []) {
    if (/^[a-z0-9 ]+$/.test(token)) {
      const words = token.split(/\s+/).filter((word) => word.length >= 2 && !SEARCH_STOP_WORDS.has(word));
      if (words.length) groups.push(words);
      continue;
    }
    for (const segment of token.split(/[的和与及或在中对关于于]/).filter((part) => part.length >= 2 && !SEARCH_STOP_WORDS.has(part))) groups.push([segment]);
  }
  return groups;
}

function relevanceDetail(paper, query) {
  const terms = queryTerms(query);
  const title = normalize(paper.title);
  const body = normalize(`${paper.abstract} ${paper.venue}`);
  const titleMatches = terms.filter((term) => title.includes(term));
  const bodyMatches = terms.filter((term) => body.includes(term));
  const groups = queryGroups(query);
  const matchedGroups = groups.filter((group) => group.every((term) => title.includes(term)));
  const normalizedQuery = normalize(query);
  const phrase = normalizedQuery.length >= 4 && title.includes(normalizedQuery);
  const titleCoverage = terms.length ? titleMatches.length / terms.length : 0;
  const isChinese = /[\u4e00-\u9fff]/.test(query);
  const minimumTitleMatches = isChinese ? Math.min(2, terms.length) : Math.min(1, terms.length);
  const groupCoverage = groups.length ? matchedGroups.length / groups.length : 0;
  const requiredGroupCoverage = groups.length <= 1 ? 1 : groups.length === 2 ? 1 : 0.67;
  const relevant = titleMatches.length >= minimumTitleMatches && groupCoverage >= requiredGroupCoverage &&
    (phrase || titleCoverage >= (terms.length <= 2 ? 0.5 : 0.28));
  return {
    terms,
    titleMatches,
    bodyMatches,
    titleCoverage,
    groupCoverage,
    matchedGroups,
    phrase,
    relevant,
    reason: titleMatches.length
      ? `标题命中 ${titleMatches.length}/${terms.length} 个关键词 · 主题组 ${matchedGroups.length}/${groups.length}`
      : '标题没有命中检索关键词',
  };
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

/** Europe PMC 的全文 PDF 地址稳定，给标题检索再补一条医学/生命科学来源。 */
async function searchEuropePmcByTitle(query) {
  const data = await fetchJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=10&resultType=core`,
    25000,
  );
  const hits = [];
  for (const item of data?.resultList?.result || []) {
    const title = String(item.title || '').trim();
    const score = titleScore(query, title);
    const pmcid = String(item.pmcid || '').trim();
    if (!score || !title || !pmcid) continue;
    hits.push({ title, pdfUrl: `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextPDF`, score: score + 0.01 });
  }
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
      '-fL', '--retry', '2', '--retry-delay', '1', '--connect-timeout', '15',
      '--max-filesize', String(MAX_PDF_BYTES), '--max-time', String(Math.ceil(timeout / 1000)),
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

function normalizeDoi(value) {
  return String(value || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
}

function restoreAbstract(index) {
  if (!index || typeof index !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions || []) words[position] = word;
  }
  return words.filter(Boolean).join(' ').slice(0, 2400);
}

function authorNames(authorships) {
  return (authorships || []).map((item) => item?.author?.display_name).filter(Boolean).slice(0, 8);
}

function venueName(work) {
  return work?.primary_location?.source?.display_name || '';
}

function landingUrl(work) {
  return work?.primary_location?.landing_page_url
    || work?.best_oa_location?.landing_page_url
    || work?.doi
    || work?.id
    || '';
}

function openAlexPaper(work) {
  const pdfUrl = pickPdfFromWork(work);
  const doi = normalizeDoi(work?.doi);
  return {
    id: String(work?.id || '').split('/').pop(),
    title: work?.title || work?.display_name || 'Untitled',
    authors: authorNames(work?.authorships),
    year: work?.publication_year || null,
    venue: venueName(work),
    citedBy: Number(work?.cited_by_count || 0),
    abstract: restoreAbstract(work?.abstract_inverted_index),
    doi,
    isOpenAccess: Boolean(work?.open_access?.is_oa || pdfUrl),
    oaStatus: work?.open_access?.oa_status || '',
    pdfUrl: pdfUrl || '',
    landingUrl: landingUrl(work),
    source: 'OpenAlex',
  };
}

function europePmcPaper(item) {
  const pmcid = String(item?.pmcid || '').trim();
  const doi = normalizeDoi(item?.doi);
  const open = item?.isOpenAccess === 'Y' || Boolean(pmcid);
  return {
    id: pmcid || item?.pmid || doi || item?.id || '',
    title: item?.title || 'Untitled',
    authors: String(item?.authorString || '').split(',').map((name) => name.trim()).filter(Boolean).slice(0, 8),
    year: Number(item?.pubYear || 0) || null,
    venue: item?.journalTitle || '',
    citedBy: Number(item?.citedByCount || 0),
    abstract: String(item?.abstractText || '').replace(/<[^>]+>/g, '').slice(0, 2400),
    doi,
    isOpenAccess: open,
    oaStatus: open ? 'open' : 'closed',
    pdfUrl: pmcid ? `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextPDF` : '',
    landingUrl: pmcid
      ? `https://europepmc.org/articles/${pmcid}`
      : doi ? `https://doi.org/${doi}` : item?.pmid ? `https://europepmc.org/article/MED/${item.pmid}` : '',
    source: 'Europe PMC',
  };
}

function paperKey(paper) {
  return paper.doi ? `doi:${paper.doi.toLowerCase()}` : `title:${normalize(paper.title)}`;
}

function rankPaper(paper, query) {
  const detail = relevanceDetail(paper, query);
  const recency = paper.year ? Math.max(0, paper.year - 2018) : 0;
  return detail.titleMatches.length * 45
    + (detail.phrase ? 90 : 0)
    + detail.matchedGroups.length * 55
    + detail.bodyMatches.length * 3
    + Math.log10(paper.citedBy + 1) * 2
    + recency * 0.4
    + (paper.pdfUrl ? 2 : 0);
}

/**
 * 按研究方向发现论文。只查询公开元数据；开放全文优先，但可保留需要机构登录的候选。
 */
async function discoverPapers(options = {}) {
  const query = String(options.query || options.direction || '').trim();
  if (!query) return { ok: false, error: '先填写研究方向或检索式。' };
  if (!queryTerms(query).length) return { ok: false, error: '检索词太宽泛，请输入 2-5 个具体主题词，例如“多模态 幻觉评测”。' };
  const yearFrom = Math.max(1900, Math.min(2100, Number(options.yearFrom) || new Date().getFullYear() - 3));
  const yearTo = Math.max(yearFrom, Math.min(2100, Number(options.yearTo) || new Date().getFullYear()));
  const limit = Math.max(5, Math.min(50, Number(options.limit) || 20));
  const openOnly = Boolean(options.openAccessOnly);
  const filters = [
    `from_publication_date:${yearFrom}-01-01`,
    `to_publication_date:${yearTo}-12-31`,
  ];
  if (openOnly) filters.push('open_access.is_oa:true');
  const select = [
    'id', 'doi', 'title', 'publication_year', 'authorships', 'primary_location',
    'best_oa_location', 'open_access', 'cited_by_count', 'abstract_inverted_index', 'locations',
  ].join(',');
  const candidatePageSize = Math.min(100, Math.max(limit * 4, 40));
  const openAlexUrl = `https://api.openalex.org/works?search=${encodeURIComponent(query)}`
    + `&filter=${encodeURIComponent(filters.join(','))}&per-page=${candidatePageSize}&select=${select}`;

  const [openAlex, europePmc] = await Promise.all([
    fetchJson(openAlexUrl, 25000),
    fetchJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`${query} FIRST_PDATE:[${yearFrom}-01-01 TO ${yearTo}-12-31]${openOnly ? ' OPEN_ACCESS:Y' : ''}`)}&format=json&pageSize=${Math.min(candidatePageSize, 100)}&resultType=core`, 25000),
  ]);

  const merged = new Map();
  for (const work of openAlex?.results || []) {
    const paper = openAlexPaper(work);
    merged.set(paperKey(paper), paper);
  }
  for (const item of europePmc?.resultList?.result || []) {
    const paper = europePmcPaper(item);
    const key = paperKey(paper);
    const previous = merged.get(key);
    if (!previous) merged.set(key, paper);
    else if (!previous.pdfUrl && paper.pdfUrl) merged.set(key, { ...previous, pdfUrl: paper.pdfUrl, isOpenAccess: true });
  }
  const ranked = [...merged.values()]
    .filter((paper) => !openOnly || paper.isOpenAccess)
    .map((paper) => {
      const detail = relevanceDetail(paper, query);
      return { ...paper, relevance: rankPaper(paper, query), relevanceReason: detail.reason, titleCoverage: detail.titleCoverage };
    })
    .filter((paper) => relevanceDetail(paper, query).relevant)
    .sort((a, b) => b.relevance - a.relevance || b.citedBy - a.citedBy)
  const papers = ranked.slice(0, limit);
  return {
    ok: true,
    query,
    yearFrom,
    yearTo,
    papers,
    totalCandidates: ranked.length,
    sources: ['OpenAlex', 'Europe PMC'],
  };
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

async function resolveOpenPdf(paper) {
  const direct = safeHttpUrl(paper?.pdfUrl);
  if (direct) return { pdfUrl: direct, source: paper.source || '开放全文' };
  const doi = normalizeDoi(paper?.doi);
  if (doi) {
    const data = await fetchJson(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}?${WORK_SELECT}`);
    const pdfUrl = pickPdfFromWork(data || {});
    if (pdfUrl) return { pdfUrl, source: 'OpenAlex OA' };
  }
  return null;
}

async function downloadPaperCandidate(litDir, paper) {
  const title = String(paper?.title || '').trim();
  if (!title) return { ok: false, error: '候选论文缺少标题。' };
  fs.mkdirSync(litDir, { recursive: true });
  const resolved = await resolveOpenPdf(paper);
  if (!resolved) {
    return {
      ok: false,
      code: 'login-required',
      title,
      url: safeHttpUrl(paper?.landingUrl) || (paper?.doi ? `https://doi.org/${normalizeDoi(paper.doi)}` : ''),
      error: '没有发现合法的开放 PDF。可以打开登录浏览器，使用学校或出版社账号下载；下载完成后会自动进入文献库。',
    };
  }
  const buf = await downloadPdf(resolved.pdfUrl, 90000);
  if (!buf) {
    return {
      ok: false,
      code: 'download-failed',
      title,
      url: safeHttpUrl(paper?.landingUrl) || resolved.pdfUrl,
      error: '发现了开放全文地址，但源站拒绝自动下载或返回的不是 PDF。可用登录浏览器打开论文页面继续。',
    };
  }
  const stem = sanitizeFileStem(title);
  let file = `${stem}.pdf`;
  let index = 1;
  while (fs.existsSync(path.join(litDir, file))) file = `${stem}-${index++}.pdf`;
  fs.writeFileSync(path.join(litDir, file), buf);
  return { ok: true, file, title, source: resolved.source, size: buf.length, format: 'pdf' };
}

/**
 * 批量下载开放全文：逐篇隔离错误，不能下载的论文保留原因，继续处理后面的候选。
 * onProgress 只传状态，不暴露 PDF 内容；渲染层可以据此更新进度条和重试列表。
 */
async function downloadPapersBatch(litDir, papers, onProgress = () => {}) {
  const list = Array.isArray(papers)
    ? papers.filter((paper) => paper && String(paper.title || '').trim()).slice(0, 50)
    : [];
  if (!list.length) return { ok: false, error: '没有可下载的论文。', completed: 0, total: 0, results: [] };
  const results = [];
  for (let index = 0; index < list.length; index += 1) {
    const paper = list[index];
    const title = String(paper.title).trim();
    onProgress({ index, total: list.length, title, state: 'opening' });
    try {
      const result = await downloadPaperCandidate(litDir, paper);
      results.push({ ...result, title });
      onProgress({
        index,
        total: list.length,
        title,
        state: result.ok ? 'done' : 'failed',
        error: result.error || '',
      });
    } catch (err) {
      const result = { ok: false, title, code: 'download-failed', error: err.message || '下载失败' };
      results.push(result);
      onProgress({ index, total: list.length, title, state: 'failed', error: result.error });
    }
  }
  return {
    ok: results.every((result) => result.ok),
    completed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    total: list.length,
    results,
  };
}

/**
 * 主入口：按名字找到免费 PDF 并写进文献目录。
 * 返回 { ok, file, title, source, size, format } 或 { ok: false, error }
 */
async function fetchPaperByTitle(litDir, query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: '先输入文献名' };
  fs.mkdirSync(litDir, { recursive: true });

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
    // 多源并行补候选：一个索引暂时不可用，不应让用户失去其他可下载的版本。
    merge(await searchDblp(q));
    merge(await searchOpenAlex(q));
    const [crossref, europePmc] = await Promise.all([
      searchCrossref(q),
      searchEuropePmcByTitle(q),
    ]);
    merge(crossref);
    merge(europePmc);
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

module.exports = {
  fetchPaperByTitle,
  discoverPapers,
  downloadPaperCandidate,
  downloadPapersBatch,
  restoreAbstract,
  normalizeDoi,
  normalize,
  queryTerms,
  relevanceDetail,
  rankPaper,
};
