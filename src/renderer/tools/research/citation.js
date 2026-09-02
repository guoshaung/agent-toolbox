/**
 * 引用格式化。
 *
 * 引用工具好不好用，差别不在支持多少种格式，在**字段缺失时怎么办**。
 * 大多数工具缺字段就默默输出一条残缺的引用，你粘进论文才发现少了卷期页码。
 * 这里的做法是：照样输出，但把缺了哪些字段明确报出来，让你在粘贴前就知道。
 */

/** 把各种写法的作者名归一成 { family, given } */
export function parseAuthor(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') {
    const family = (raw.family || raw.last || '').trim();
    const given = (raw.given || raw.first || '').trim();
    if (family || given) return { family, given };
    return raw.name ? parseAuthor(raw.name) : null;
  }

  const text = String(raw).trim().replace(/\s+/g, ' ');
  if (!text) return null;

  // "Zhang, San" —— 逗号前是姓
  if (text.includes(',')) {
    const [family, given = ''] = text.split(',');
    return { family: family.trim(), given: given.trim() };
  }
  // 纯中日韩姓名不分词，整个当姓
  if (/^[一-龥぀-ヿ]{2,}$/.test(text)) return { family: text, given: '' };
  // "Cai Q" / "John Smith" —— 末段是名的取前面为姓，否则末段为姓
  const parts = text.split(' ');
  if (parts.length === 1) return { family: parts[0], given: '' };
  const last = parts[parts.length - 1];
  if (/^[A-Z]\.?([A-Z]\.?)*$/.test(last)) {
    return { family: parts.slice(0, -1).join(' '), given: last.replace(/\./g, '') };
  }
  return { family: last, given: parts.slice(0, -1).join(' ') };
}

const initials = (given) => (given || '')
  .split(/[\s.-]+/).filter(Boolean).map((part) => `${part[0].toUpperCase()}.`).join(' ');

const isCJK = (text) => /[一-龥]/.test(String(text || ''));

/** 预印本（arXiv / bioRxiv 之类）没有卷期页，按普通期刊去要求它只会制造假警告 */
const isPreprint = (item) => /^arxiv:/i.test(String(item.journal || ''))
  || /arxiv|biorxiv|medrxiv|ssrn/i.test(String(item.publisher || ''))
  || item.type === 'preprint';

/** 抹掉标题里的换行和多余空格，顺手去掉期刊常见的方括号标注 */
const cleanTitle = (title) => String(title || '')
  .replace(/\s+/g, ' ').replace(/^\[|\]$/g, '').trim();

/**
 * 检查一条文献缺哪些字段。不同格式要求不同，所以按格式给。
 * 返回缺失字段的中文名数组，空数组表示这条引用是完整的。
 */
export function missingFields(item, style) {
  const need = {
    bibtex: [['title', '标题'], ['authors', '作者'], ['year', '年份']],
    gbt7714: [['title', '标题'], ['authors', '作者'], ['year', '年份'], ['journal', '期刊'], ['pages', '页码']],
    apa: [['title', '标题'], ['authors', '作者'], ['year', '年份'], ['journal', '期刊']],
    ieee: [['title', '标题'], ['authors', '作者'], ['year', '年份'], ['journal', '期刊']],
    ris: [['title', '标题'], ['authors', '作者'], ['year', '年份']],
  }[style] || [];

  const preprint = isPreprint(item);
  return need.filter(([key]) => {
    if (preprint && key === 'pages') return false;   // 预印本没有页码，不算缺
    const value = item[key];
    return Array.isArray(value) ? value.length === 0 : !String(value ?? '').trim();
  }).map(([, label]) => label);
}

/** BibTeX 的 key：姓 + 年 + 标题首个实词，重复时调用方再去重 */
export function bibKey(item) {
  const first = (item.authors || []).map(parseAuthor).filter(Boolean)[0];
  // BibTeX key 必须是 ASCII —— 老的 pdfLaTeX + BibTeX 组合遇到中文 key 会直接炸。
  // 中文姓名被剥成空时，退到标题里的英文词，再不行就用标题的短哈希，保证唯一且稳定。
  let stem = (first?.family || '').replace(/[^\w]/g, '').toLowerCase();
  const year = String(item.year || 'nd');
  const word = cleanTitle(item.title).split(/\s+/)
    .find((w) => w.length > 3 && /^[A-Za-z]+$/.test(w)) || '';
  if (!stem) {
    let hash = 0;
    for (const ch of cleanTitle(item.title)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    stem = word ? '' : `ref${hash.toString(36).slice(0, 4)}`;
  }
  const key = `${stem}${year}${word.toLowerCase()}`;
  return key || `ref${year}`;
}

/** BibTeX 里的特殊字符要转义，否则 LaTeX 编译会炸 */
const escapeTex = (text) => String(text || '')
  .replace(/\\/g, '\\textbackslash{}')
  .replace(/([&%$#_{}])/g, '\\$1')
  .replace(/~/g, '\\textasciitilde{}')
  .replace(/\^/g, '\\textasciicircum{}');

function toBibtex(item, key) {
  const authors = (item.authors || []).map(parseAuthor).filter(Boolean)
    .map((a) => (a.given ? `${a.family}, ${a.given}` : a.family))
    .join(' and ');

  const type = item.type === 'book' ? 'book' : item.type === 'inproceedings' ? 'inproceedings' : 'article';
  const fields = [
    ['title', cleanTitle(item.title)],
    ['author', authors],
    [type === 'inproceedings' ? 'booktitle' : 'journal', item.journal],
    ['year', item.year],
    ['volume', item.volume],
    ['number', item.issue],
    ['pages', item.pages],
    ['publisher', item.publisher],
    ['doi', item.doi],
    ['url', item.url],
  ].filter(([, value]) => String(value ?? '').trim());

  const body = fields
    .map(([name, value]) => `  ${name} = {${name === 'doi' || name === 'url' ? value : escapeTex(value)}}`)
    .join(',\n');
  return `@${type}{${key},\n${body}\n}`;
}

/** GB/T 7714-2015：中文论文的国标格式 */
function toGbt(item, index) {
  const parsed = (item.authors || []).map(parseAuthor).filter(Boolean);
  const names = parsed.map((a) => {
    if (isCJK(a.family)) return a.family;                       // 中文名原样
    return a.given ? `${a.family} ${initials(a.given).replace(/\./g, '')}` : a.family;
  });
  // 国标：超过 3 位只列前 3 位，后加"等"
  const authorText = names.length > 3
    ? `${names.slice(0, 3).join(', ')}, ${isCJK(names[0]) ? '等' : 'et al'}`
    : names.join(', ');

  const preprint = isPreprint(item);
  const marker = preprint ? 'EB/OL' : item.type === 'book' ? 'M' : item.type === 'inproceedings' ? 'C' : 'J';
  // 国标形状：作者. 题名[J]. 刊名, 年, 卷(期): 页码.
  // 刊名后面是逗号不是句号 —— 这一个标点错了，查重和格式审查都会挑出来。
  // 作者缺失时不能留一个孤零零的句点（曾经输出过 "[1] . 标题[J].."）。
  const head = [authorText, `${cleanTitle(item.title)}[${marker}]`].filter(Boolean).join('. ');
  let text = `${head}.`;

  const volIssue = [item.volume, item.issue ? `(${item.issue})` : ''].filter(Boolean).join('');
  const tail = [item.journal, item.year, volIssue].filter(Boolean).join(', ');
  if (tail) text += ` ${tail}`;
  if (item.pages) text += `: ${item.pages}`;
  if (tail || item.pages) text += '.';          // 有尾巴才补句点，没有就别重复加
  if (preprint && item.url) text += ` ${item.url}.`;
  else if (item.doi) text += ` DOI:${item.doi}.`;
  return `[${index}] ${text}`;
}

/** APA 7th */
function toApa(item) {
  const parsed = (item.authors || []).map(parseAuthor).filter(Boolean);
  const names = parsed.map((a) => (a.given ? `${a.family}, ${initials(a.given)}` : a.family));
  let authorText;
  if (!names.length) authorText = '';
  else if (names.length === 1) authorText = names[0];
  else if (names.length <= 20) authorText = `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
  else authorText = `${names.slice(0, 19).join(', ')}, ... ${names[names.length - 1]}`;

  const link = item.doi
    ? `https://doi.org/${item.doi.replace(/^https?:\/\/doi\.org\//, '')}`
    : item.url || '';
  const bits = [
    authorText || null,
    `(${item.year || 'n.d.'})`,
    cleanTitle(item.title),
    item.journal ? `${item.journal}${item.volume ? `, ${item.volume}` : ''}${item.issue ? `(${item.issue})` : ''}${item.pages ? `, ${item.pages}` : ''}` : null,
  ].filter(Boolean);
  // APA 的 DOI 链接后面不加句号，加了会被当成链接的一部分
  const head = `${bits.join('. ').replace(/\.\s*\./g, '.')}`.replace(/\.+$/, '');
  return link ? `${head}. ${link}` : `${head}.`;
}

/** IEEE：编号制，计算机方向常用 */
function toIeee(item, index) {
  const parsed = (item.authors || []).map(parseAuthor).filter(Boolean);
  const names = parsed.map((a) => (a.given ? `${initials(a.given)} ${a.family}` : a.family));
  const authorText = names.length > 6 ? `${names.slice(0, 3).join(', ')}, et al.` : names.join(', ');

  const bits = [authorText ? `${authorText},` : null, `"${cleanTitle(item.title)},"`];
  if (item.journal) bits.push(`${item.journal},`);
  if (item.volume) bits.push(`vol. ${item.volume},`);
  if (item.issue) bits.push(`no. ${item.issue},`);
  if (item.pages) bits.push(`pp. ${item.pages},`);
  if (item.year) bits.push(`${item.year}.`);
  let text = bits.filter(Boolean).join(' ');
  if (item.doi) text += ` doi: ${item.doi}.`;
  return `[${index}] ${text}`;
}

/** RIS：Zotero / EndNote / NoteExpress 都能直接导入 */
function toRis(item) {
  const lines = [`TY  - ${item.type === 'book' ? 'BOOK' : item.type === 'inproceedings' ? 'CONF' : 'JOUR'}`];
  for (const author of (item.authors || []).map(parseAuthor).filter(Boolean)) {
    lines.push(`AU  - ${author.given ? `${author.family}, ${author.given}` : author.family}`);
  }
  lines.push(`TI  - ${cleanTitle(item.title)}`);
  if (item.journal) lines.push(`JO  - ${item.journal}`);
  if (item.year) lines.push(`PY  - ${item.year}`);
  if (item.volume) lines.push(`VL  - ${item.volume}`);
  if (item.issue) lines.push(`IS  - ${item.issue}`);
  if (item.pages) {
    const [start, end] = String(item.pages).split(/[-–—]/);
    if (start) lines.push(`SP  - ${start.trim()}`);
    if (end) lines.push(`EP  - ${end.trim()}`);
  }
  if (item.doi) lines.push(`DO  - ${item.doi}`);
  if (item.url) lines.push(`UR  - ${item.url}`);
  lines.push('ER  - ');
  return lines.join('\n');
}

export const STYLES = [
  { id: 'gbt7714', label: 'GB/T 7714', hint: '国标，中文期刊和学位论文用这个', target: 'word', ext: 'txt' },
  { id: 'apa', label: 'APA 7', hint: '社科、医学常用', target: 'word', ext: 'txt' },
  { id: 'ieee', label: 'IEEE', hint: '计算机、电子方向', target: 'word', ext: 'txt' },
  { id: 'bibtex', label: 'BibTeX', hint: 'LaTeX 用，存成 .bib 给 \\cite 引用', target: 'latex', ext: 'bib' },
  { id: 'ris', label: 'RIS', hint: '导进 Zotero / EndNote / NoteExpress', target: 'manager', ext: 'ris' },
];

/**
 * 格式化一批文献。
 * @returns { text, html, warnings }  html 是给 Word 粘贴用的（斜体期刊名会保留）
 */
export function formatAll(items, style) {
  const usedKeys = new Set();
  const entries = [];
  const warnings = [];

  items.forEach((item, index) => {
    const missing = missingFields(item, style);
    if (missing.length) {
      warnings.push({ title: cleanTitle(item.title) || item.file, missing });
    }

    if (style === 'bibtex') {
      let key = bibKey(item);
      let suffix = 97;                       // 同 key 冲突时加 a/b/c
      while (usedKeys.has(key)) key = `${bibKey(item)}${String.fromCharCode(suffix++)}`;
      usedKeys.add(key);
      entries.push(toBibtex(item, key));
    } else if (style === 'ris') entries.push(toRis(item));
    else if (style === 'apa') entries.push(toApa(item));
    else if (style === 'ieee') entries.push(toIeee(item, index + 1));
    else entries.push(toGbt(item, index + 1));
  });

  const separator = style === 'bibtex' || style === 'ris' ? '\n\n' : '\n';
  const text = entries.join(separator);

  // Word 粘贴用 HTML：等宽的（BibTeX/RIS）保留 pre，参考文献列表用段落
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = style === 'bibtex' || style === 'ris'
    ? `<pre style="font-family:Consolas,monospace;font-size:10.5pt">${escapeHtml(text)}</pre>`
    : `<div style="font-family:'Times New Roman','SimSun',serif;font-size:10.5pt;line-height:1.6">${
      entries.map((entry) => `<p style="margin:0 0 6pt 0;text-indent:-2em;padding-left:2em">${escapeHtml(entry)}</p>`).join('')
    }</div>`;

  return { text, html, warnings, count: entries.length };
}

/**
 * 把文献检索返回的 paper 对象转成库里存的书目字段。
 *
 * 下载的那一刻这些信息全都在手上（标题、作者、年份、期刊、DOI），
 * 以前只存了个备注就扔了，导致事后要么手填、要么再去 Crossref 反查一遍。
 * 在源头存下来，后面导出引用就直接能用。
 */
export function paperToMeta(paper) {
  if (!paper) return {};
  const authors = (paper.authors || [])
    .map((name) => parseAuthor(name))
    .filter(Boolean);
  return {
    title: cleanTitle(paper.title) || '',
    authors,
    year: paper.year ? String(paper.year) : '',
    journal: paper.venue || '',
    doi: String(paper.doi || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ''),
    url: paper.landingUrl || paper.url || '',
    type: 'article',
    metaFrom: 'download',        // 标明来源，界面上可以区分"下载时带的"和"事后补的"
  };
}
