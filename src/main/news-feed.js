'use strict';

/**
 * RSS/Atom 快报抓取。渲染进程 CSP 不放行跨域请求，统一由主进程代取。
 * 解析走最小化的标签匹配（这些订阅源格式都很规整），不引第三方 XML 依赖。
 */

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/130.0.0.0 Safari/537.36';

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripCdata(text) {
  return String(text || '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').replace(/<[^>]+>/g, '').trim();
}

function matchTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
}

function parseFeed(xml) {
  const isAtom = /<entry[\s>]/.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s\S]*?<\/entry>/gi : /<item[\s\S]*?<\/item>/gi) || [];
  const items = [];
  for (const block of blocks.slice(0, 30)) {
    const title = decodeEntities(stripCdata(matchTag(block, 'title')));
    let link = '';
    if (isAtom) {
      const m = block.match(/<link[^>]+href=["']([^"']+)["']/i);
      link = m ? m[1] : '';
    } else {
      link = stripCdata(matchTag(block, 'link'));
    }
    const dateText = matchTag(block, 'pubDate') || matchTag(block, 'updated')
      || matchTag(block, 'published') || matchTag(block, 'dc:date');
    if (!title || !link) continue;
    items.push({ title, link, at: Date.parse(dateText) || 0 });
  }
  return items;
}

async function fetchFeed(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('bad protocol');
  } catch {
    return { ok: false, error: '订阅源地址不对' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(parsed.href, {
      headers: { 'User-Agent': CHROME_UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const text = await res.text();
    const items = parseFeed(text);
    if (!items.length) return { ok: false, error: '没解析到条目（可能不是标准 RSS）' };
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? '请求超时' : String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchFeed, parseFeed };
