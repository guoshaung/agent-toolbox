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

/** 标题归一化后比对，用于判断 Crossref 返回的是不是同一篇 */
function normalizeTitle(text) {
  return String(text || '').toLowerCase()
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

    const url = `${CROSSREF}?query.bibliographic=${encodeURIComponent(query)}&rows=5`;
    const data = await fetchJson(url);
    const items = (data.message?.items || []).map(normalizeCrossref)
      .map((meta) => ({ ...meta, _score: similarity(query, meta.title) }))
      .sort((a, b) => b._score - a._score);

    if (!items.length) return { ok: false, error: 'Crossref 里没找到这篇。' };
    const best = items[0];
    return {
      ok: true,
      best,
      score: Number(best._score.toFixed(2)),
      candidates: items.slice(0, 5),
      exact: false,
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
