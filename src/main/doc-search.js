'use strict';
/**
 * 按名字找官方文档站。
 *
 * 预置书签再多也有没收的（比如 LangChain），所以要能现搜。三个免费源：
 *   · PyPI      —— Python 包的 project_urls 里就写着 Documentation，最准
 *   · npm       —— 前端包的 homepage
 *   · DevDocs   —— 832 个文档集的索引，覆盖语言和大框架
 * 都不需要 key。放主进程是因为渲染层是 file:// 源，跨域取不到。
 */

const UA = 'AgentToolbox/0.1 (personal docs finder)';
const TIMEOUT = 12000;

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** DevDocs 的索引不小（800+ 条），进程内缓存一小时，别每次都拉。 */
let devdocsCache = { at: 0, list: [] };
async function devdocsIndex() {
  if (Date.now() - devdocsCache.at < 3600_000 && devdocsCache.list.length) return devdocsCache.list;
  const data = await getJson('https://devdocs.io/docs.json');
  if (Array.isArray(data)) devdocsCache = { at: Date.now(), list: data };
  return devdocsCache.list;
}

const clean = (u) => String(u || '').trim();
const isHttp = (u) => /^https?:\/\//i.test(u);

/** 从 PyPI 的 project_urls 里挑最像文档的那个。字段名各家写法不一，得挨个认。 */
function pickPypiDocs(info) {
  const urls = info?.project_urls || {};
  const out = [];
  for (const [key, value] of Object.entries(urls)) {
    if (!isHttp(value)) continue;
    if (/doc|guide|manual|reference|api/i.test(key)) out.push({ label: key, url: clean(value) });
  }
  if (isHttp(info?.docs_url)) out.push({ label: 'docs_url', url: clean(info.docs_url) });
  const home = clean(info?.home_page || urls.Homepage || urls.homepage || '');
  // 主页本身就是文档站的情况很常见（docs.xxx.com / xxx.readthedocs.io）
  if (isHttp(home) && /docs?\.|readthedocs|\/docs/i.test(home)) out.push({ label: '主页(文档)', url: home });
  else if (isHttp(home)) out.push({ label: '主页', url: home });
  return out;
}

async function search(query) {
  const name = String(query || '').trim();
  if (name.length < 2) return { ok: false, error: '至少输两个字符。' };

  const [pypi, npm, devdocs] = await Promise.all([
    getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`),
    getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`),
    devdocsIndex(),
  ]);

  const results = [];
  const seen = new Set();
  const push = (item) => {
    const key = item.url.replace(/\/+$/, '').toLowerCase();
    if (!item.url || seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  if (pypi?.info) {
    for (const hit of pickPypiDocs(pypi.info)) {
      push({ name: `${pypi.info.name} · ${hit.label}`, url: hit.url, source: 'PyPI', summary: clean(pypi.info.summary).slice(0, 90) });
    }
  }

  if (npm?.['dist-tags']?.latest) {
    const v = npm.versions?.[npm['dist-tags'].latest] || {};
    if (isHttp(v.homepage)) push({ name: `${npm.name} · 主页`, url: clean(v.homepage), source: 'npm', summary: clean(v.description).slice(0, 90) });
  }

  const lower = name.toLowerCase();
  const ddHits = (devdocs || []).filter((d) => String(d.name || '').toLowerCase().includes(lower));
  // 同一个文档集会有多个版本，按名字去重只留一条
  const byName = new Map();
  for (const d of ddHits) if (!byName.has(d.name)) byName.set(d.name, d);
  for (const d of [...byName.values()].slice(0, 6)) {
    const home = clean(d.links?.home);
    if (home) push({ name: `${d.name} · 官网`, url: home, source: 'DevDocs', summary: '' });
    push({ name: `${d.name} · 在 DevDocs 里看`, url: `https://devdocs.io/${d.slug}`, source: 'DevDocs', summary: '' });
  }

  if (!results.length) {
    return { ok: true, results: [], fallback: `https://www.bing.com/search?q=${encodeURIComponent(`${name} official documentation`)}` };
  }
  return { ok: true, results: results.slice(0, 12) };
}

function registerDocSearchIpc(ipcMain) {
  ipcMain.handle('docs:search', (_e, query) => search(query));
}

module.exports = { registerDocSearchIpc, search };
