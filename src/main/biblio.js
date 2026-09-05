'use strict';
/**
 * 书目元数据与导出。
 *
 * 文献库里原来只存了文件名和备注，没有作者/年份/期刊/DOI —— 光靠这些拼不出一条
 * 能用的引用。这里从 Crossref 按标题反查补全（免费、不用 key）。
 *
 * 关键点：**匹配可能是错的**。标题相近的论文很多，自动填错元数据比不填更坑人，
 * 所以这里返回匹配分数和候选列表，让界面把不确定的标出来，由人确认。
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const UA = 'AgentToolbox/0.1 (personal research tool)';
const CROSSREF = 'https://api.crossref.org/works';
const OPENALEX = 'https://api.openalex.org/works';
const ARXIV_API = 'https://export.arxiv.org/api/query';
// OpenAlex 要求带联系方式换取更好的限流额度，给个不外发的占位邮箱即可。
const POLITE = 'mailto=toolbox@local';

/** 标题归一化后比对，用于判断 Crossref 返回的是不是同一篇 */
function normalizeTitle(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // Gödel → Godel：作者名带变音符时两边对不上
    .toLowerCase()
    .replace(/[\s\-_—–]+/g, ' ')
    .replace(/[^\w一-龥 ]/g, '')
    .trim();
}

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const item of a) if (b.has(item)) hit += 1;
  return hit / new Set([...a, ...b]).size;
};

const bigrams = (words) => {
  const out = new Set();
  for (let i = 0; i < words.length - 1; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
};

/**
 * 标题相似度。
 *
 * 只用词集合 Jaccard 会出大事："Attention Is All You Need" 和
 * "Is Attention All You Need?" 词集合完全相同，会拿到满分 1.0 —— 但它们是两篇
 * 完全不同的文献。所以必须把**词序**算进去：二元词组的重合率对语序敏感，
 * 上面那对只有 2/6 重合，加权后掉到 0.6，就不会被当成同一篇自动填进去。
 */
function similarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const wa = na.split(' ').filter(Boolean);
  const wb = nb.split(' ').filter(Boolean);
  const uni = jaccard(new Set(wa), new Set(wb));
  const bi = jaccard(bigrams(wa), bigrams(wb));
  return 0.4 * uni + 0.6 * bi;      // 词序权重更高
}

function normalizeCrossref(work) {
  const dateParts = work.issued?.['date-parts']?.[0]
    || work['published-print']?.['date-parts']?.[0]
    || work['published-online']?.['date-parts']?.[0]
    || [];
  const typeMap = {
    'journal-article': 'article',
    'proceedings-article': 'inproceedings',
    book: 'book',
    'book-chapter': 'inbook',
  };
  return {
    title: Array.isArray(work.title) ? work.title[0] : work.title || '',
    authors: (work.author || []).map((a) => ({
      family: a.family || a.name || '',
      given: a.given || '',
    })).filter((a) => a.family),
    year: dateParts[0] ? String(dateParts[0]) : '',
    journal: Array.isArray(work['container-title']) ? work['container-title'][0] : '',
    volume: work.volume || '',
    issue: work.issue || '',
    pages: work.page || '',
    doi: work.DOI || '',
    url: work.URL || '',
    publisher: work.publisher || '',
    type: typeMap[work.type] || 'article',
  };
}

/** 带退避重试的取数。Crossref 连着打会 429，退避一下比直接失败友好 */
async function fetchText(url, { timeout = 15000, accept = 'application/json', retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: accept },
        signal: controller.signal,
      });
      if (response.status === 429 && attempt < retries) {
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));   // 1.5s, 3s
        continue;
      }
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }
}

const fetchJson = async (url, timeout = 15000) => JSON.parse(await fetchText(url, { timeout }));

/**
 * arXiv 走官方 API，不走 Crossref。
 *
 * 原因：arXiv 的 DOI（10.48550/arXiv.xxxx）注册在 **DataCite**，
 * Crossref 查不到，之前那条路一直落空、白白退回标题模糊搜索。
 */
async function lookupArxiv(rawId) {
  const id = String(rawId || '').replace(/v\d+$/, '').trim();
  if (!id) return { ok: false, error: 'arXiv 编号为空' };
  try {
    const xml = await fetchText(
      `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`,
      { accept: 'application/atom+xml' },
    );
    const entry = xml.slice(xml.indexOf('<entry>'), xml.indexOf('</entry>'));
    if (!entry || entry.indexOf('<entry>') === -1) return { ok: false, error: `arXiv 上没有 ${id}` };

    const pick = (tag) => {
      const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    };
    const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)]
      .map((m) => m[1].trim()).filter(Boolean)
      .map((name) => {
        const parts = name.split(/\s+/);
        return { family: parts.pop() || name, given: parts.join(' ') };
      });

    const published = pick('published');
    const journalRef = pick('arxiv:journal_ref');
    const publishedDoi = pick('arxiv:doi');

    return {
      ok: true,
      exact: true,
      best: {
        title: pick('title'),
        authors,
        year: published ? published.slice(0, 4) : '',
        // 没正式发表的预印本，把 arXiv 编号放到"期刊"位，引用里至少说得清出处
        journal: journalRef || `arXiv:${id}`,
        volume: '', issue: '', pages: '',
        doi: publishedDoi || `10.48550/arXiv.${id}`,
        url: `https://arxiv.org/abs/${id}`,
        publisher: journalRef ? '' : 'arXiv',
        type: 'article',
      },
      score: 1,
    };
  } catch (err) {
    return { ok: false, error: `arXiv 查询失败：${err.message}` };
  }
}

/**
 * 按标题（或 DOI）查元数据。
 * @returns { ok, best, score, candidates } —— score < 0.6 时界面应提示"可能不是同一篇"
 */
/** OpenAlex 的一条 work 转成本地统一结构。 */
function normalizeOpenAlex(work) {
  const typeMap = {
    article: 'article',
    preprint: 'article',
    'proceedings-article': 'inproceedings',
    book: 'book',
    'book-chapter': 'inbook',
  };
  const loc = work.primary_location || {};
  const doi = String(work.doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  return {
    title: work.display_name || work.title || '',
    authors: (work.authorships || []).map((a) => {
      const parts = String(a.author?.display_name || '').trim().split(/\s+/);
      const family = parts.length > 1 ? parts.pop() : (parts[0] || '');
      return { family, given: parts.join(' ') };
    }).filter((a) => a.family),
    year: work.publication_year ? String(work.publication_year) : '',
    journal: loc.source?.display_name || '',
    volume: work.biblio?.volume || '',
    issue: work.biblio?.issue || '',
    pages: [work.biblio?.first_page, work.biblio?.last_page].filter(Boolean).join('-'),
    doi,
    url: work.doi || loc.landing_page_url || '',
    publisher: loc.source?.host_organization_name || '',
    type: typeMap[work.type] || 'article',
    // 下面几个是选片时要看的，不进引用格式
    _source: 'OpenAlex',
    _isPreprint: work.type === 'preprint' || /arxiv/i.test(loc.source?.display_name || ''),
    _cited: work.cited_by_count || 0,
    _pdf: loc.pdf_url || work.best_oa_location?.pdf_url || '',
  };
}

/** arXiv 全文检索（按标题），返回统一结构。 */
async function searchArxiv(title) {
  const q = `ti:"${String(title).replace(/"/g, '')}"`;
  const xml = await fetchText(
    `${ARXIV_API}?search_query=${encodeURIComponent(q)}&max_results=5`,
    { accept: 'application/atom+xml' },
  );
  const entries = xml.split('<entry>').slice(1);
  return entries.map((entry) => {
    const pick = (tag) => (entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
    const id = pick('id').trim();
    const bare = id.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
    return {
      title: pick('title').replace(/\s+/g, ' ').trim(),
      authors: [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => {
        const parts = m[1].trim().split(/\s+/);
        const family = parts.length > 1 ? parts.pop() : (parts[0] || '');
        return { family, given: parts.join(' ') };
      }).filter((a) => a.family),
      year: (pick('published').match(/^(\d{4})/) || [])[1] || '',
      journal: 'arXiv',
      volume: '', issue: '', pages: '',
      doi: bare ? `10.48550/arXiv.${bare}` : '',
      url: id,
      publisher: 'arXiv',
      type: 'article',
      _source: 'arXiv',
      _isPreprint: true,
      _cited: 0,
      _pdf: bare ? `https://arxiv.org/pdf/${bare}` : '',
      _arxivId: bare,
    };
  }).filter((x) => x.title);
}

/**
 * 按标题多源检索。
 *
 * 为什么不只用 Crossref：实测 5 篇常见 AI 论文，Crossref 一篇都没匹配对
 * ——「Attention Is All You Need」它返回「Is Attention All You Need?」，
 * 「Deep Residual Learning」返回一篇蝴蝶识别。原因是 Crossref 不收 arXiv 预印本，
 * 只能拿词面最像的顶上来。OpenAlex 收录预印本且排序好得多，所以让它当主力，
 * arXiv 补预印本，Crossref 退居兜底。
 */
async function searchByTitle(title) {
  const jobs = [
    fetchJson(`${OPENALEX}?search=${encodeURIComponent(title)}&per-page=5&${POLITE}`)
      .then((d) => (d.results || []).map(normalizeOpenAlex)).catch(() => []),
    searchArxiv(title).catch(() => []),
    fetchJson(`${CROSSREF}?query.bibliographic=${encodeURIComponent(title)}&rows=5`)
      .then((d) => (d.message?.items || []).map(normalizeCrossref)
        .map((m) => ({ ...m, _source: 'Crossref', _isPreprint: false, _cited: 0 }))).catch(() => []),
  ];
  const [oa, ax, cr] = await Promise.all(jobs);

  // 合并去重。
  // 注意别只看标题：真有两篇不同论文标题一模一样，按标题合并会把它们并成一条，
  // 「同名要提示」这个功能就永远触发不了了。
  // 所以只在「DOI 相同」或「标题相同且其中一方没 DOI（同一条记录的跨源补全）」时合并。
  const merged = [];
  for (const item of [...oa, ...ax, ...cr]) {
    if (!item.title) continue;
    const sameTitle = (m) => normalizeTitle(m.title) === normalizeTitle(item.title);
    const hit = merged.find((m) => {
      if (m.doi && item.doi) return m.doi.toLowerCase() === item.doi.toLowerCase();
      return sameTitle(m);
    });
    if (!hit) { merged.push(item); continue; }
    // arXiv 那条能补上 PDF 直链和 arXiv 号，合并进已有条目
    if (!hit._pdf && item._pdf) hit._pdf = item._pdf;
    if (!hit._arxivId && item._arxivId) hit._arxivId = item._arxivId;
    if (!hit.doi && item.doi) hit.doi = item.doi;
    if (!hit.journal && item.journal) hit.journal = item.journal;
  }
  return merged;
}

async function lookup({ title, doi, arxiv }) {
  try {
    if (arxiv) return await lookupArxiv(arxiv);
    // 10.48550 是 arXiv 在 DataCite 的前缀，Crossref 没有，直接转走
    if (doi && /^10\.48550\/arxiv\./i.test(String(doi))) {
      return await lookupArxiv(String(doi).replace(/^10\.48550\/arxiv\./i, ''));
    }
    if (doi) {
      const clean = String(doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
      const data = await fetchJson(`${CROSSREF}/${encodeURIComponent(clean)}`);
      const meta = normalizeCrossref(data.message);
      return { ok: true, best: meta, score: 1, candidates: [meta], exact: true };
    }

    const query = String(title || '').trim();
    if (query.length < 6) return { ok: false, error: '标题太短，查不了。' };

    const items = (await searchByTitle(query))
      .map((meta) => ({ ...meta, _score: similarity(query, meta.title) }))
      .sort((a, b) => b._score - a._score || b._cited - a._cited);

    if (!items.length) return { ok: false, error: '三个库（OpenAlex / arXiv / Crossref）里都没找到这篇。' };

    const best = items[0];
    const score = Number(best._score.toFixed(2));

    // ---- 同名判定 ----
    // 只要有第二条标题跟第一条基本一样、但 DOI 或年份不同，就是「同名不同篇」，
    // 这种情况自动入库必错，必须让人挑。
    const sameName = items.slice(1).filter((it) => similarity(best.title, it.title) >= 0.95
      && ((it.doi && best.doi && it.doi.toLowerCase() !== best.doi.toLowerCase())
        || (it.year && best.year && it.year !== best.year)));

    // ---- arXiv 直通 ----
    // 「只是 arXiv」= 有 arXiv 号，且没有正式出版的 DOI（或者 DOI 就是 arXiv 自己的 10.48550）。
    // 不能用 OpenAlex 的 type==='preprint' 判断：实测 ResNet 的 primary_location
    // 写着 arXiv、DOI 却是 CVPR 的，DGM 又被挂到一个第三方期刊上，那个字段不可靠。
    const bestDoi = String(best.doi || '');
    const publishedElsewhere = bestDoi && !/^10\.48550\//i.test(bestDoi);
    const arxivOnly = !sameName.length && score >= 0.9
      && Boolean(best._arxivId) && !publishedElsewhere;

    return {
      ok: true,
      best,
      score,
      candidates: items.slice(0, 6),
      exact: false,
      ambiguous: sameName.length > 0,
      sameNameCount: sameName.length + 1,
      autoImport: arxivOnly,
      source: best._source || '',
    };
  } catch (err) {
    return { ok: false, error: `查询失败：${err.message}` };
  }
}

function registerBiblioIpc(ipcMain, { dialog, getWindow, clipboard }) {
  ipcMain.handle('biblio:lookup', (_e, payload) => lookup(payload || {}));

  /** 批量补全。串行 + 间隔，避免把 Crossref 打出限流 */
  ipcMain.handle('biblio:lookupMany', async (_e, list) => {
    const out = [];
    for (const entry of (list || []).slice(0, 60)) {
      out.push({ file: entry.file, ...(await lookup(entry)) });
      await new Promise((r) => setTimeout(r, 900));   // Crossref 打太快会 429
    }
    return out;
  });

  /** 导出成文件：.bib / .ris / .txt */
  ipcMain.handle('biblio:export', async (_e, { content, defaultName, ext }) => {
    const result = await dialog.showSaveDialog(getWindow?.(), {
      title: '导出引用',
      defaultPath: defaultName || `references.${ext || 'txt'}`,
      filters: [{ name: ext === 'bib' ? 'BibTeX' : ext === 'ris' ? 'RIS' : '文本', extensions: [ext || 'txt'] }],
    });
    if (result.canceled || !result.filePath) return null;
    try {
      await fs.writeFile(result.filePath, String(content || ''), 'utf8');
      return { ok: true, filePath: result.filePath, name: path.basename(result.filePath) };
    } catch (err) {
      return { ok: false, error: `写入失败：${err.message}` };
    }
  });

  /**
   * 富文本复制。写入 HTML 剪贴板，粘进 Word 才能保留段落和悬挂缩进；
   * 同时写纯文本，粘进纯文本编辑器也不会变成一坨标签。
   */
  ipcMain.handle('biblio:copyRich', (_e, { text, html }) => {
    clipboard.write({ text: String(text || ''), html: String(html || '') });
    return true;
  });
}

module.exports = { registerBiblioIpc, lookup, similarity };
