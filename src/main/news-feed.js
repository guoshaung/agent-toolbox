'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
  return String(text || '')
    // 先还原 CDATA（可能前面有换行缩进，不能锚定行首），再去掉残留标签
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function matchTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
}

function absoluteUrl(u, base) {
  const text = String(u || '').trim();
  if (!/^https?:\/\//i.test(text)) {
    try {
      return new URL(text, base).href;
    } catch {
      return '';
    }
  }
  return text;
}

/** 从条目里抠一张配图：enclosure → media:* → 正文第一个 <img>（含 HTML 转义过的正文，如 IT之家）。 */
function extractImage(block, link) {
  const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*>/i);
  if (enclosure && /type=["']image\//i.test(enclosure[0])) return absoluteUrl(enclosure[1], link);
  const media = block.match(/<media:(?:content|thumbnail)[^>]+url=["']([^"']+)["']/i);
  if (media) return absoluteUrl(media[1], link);
  const decoded = decodeEntities(block);
  const img = decoded.match(/<img[^>]+src=["']([^"']+)["']/i) || block.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (img) return absoluteUrl(img[1], link);
  return '';
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
    items.push({ title, link, at: Date.parse(dateText) || 0, image: extractImage(block, link) });
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

/**
 * 快报配图代取：渲染进程 CSP 不放行外域图，转成 data: URL，落盘缓存避免重复抓。
 * processImage(buffer) → { mime, b64 } 由调用方提供（main 进程用 nativeImage 缩到缩略图尺寸，
 * 原图动辄几百 KB～1MB，没必要整个塞给渲染层）。不传就原样返回（≤600KB）。
 */
async function fetchImage(url, cacheDir, processImage) {
  let parsed;
  try {
    parsed = new URL(String(url));
    if (!/^https?:$/.test(parsed.protocol)) return null;
  } catch {
    return null;
  }
  const key = crypto.createHash('sha1').update(parsed.href).digest('hex');
  const file = path.join(cacheDir, `${key}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cached && cached.mime && cached.b64) return `data:${cached.mime};base64,${cached.b64}`;
  } catch { /* 缓存未命中，走网络 */ }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(parsed.href, {
      headers: {
        'User-Agent': CHROME_UA,
        Accept: 'image/*, */*',
        Referer: `${parsed.protocol}//${parsed.host}/`, // 一部分图床有防盗链，带上来源站
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || '').split(';')[0];
    if (!/^image\//.test(mime)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 3 * 1024 * 1024) return null;
    let out = processImage ? processImage(buf) : { mime, b64: buf.toString('base64') };
    if (!out && buf.length <= 600 * 1024) out = { mime, b64: buf.toString('base64') };
    if (!out || !out.mime || !out.b64) return null;
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(out));
    } catch { /* 缓存写失败不影响展示 */ }
    return `data:${out.mime};base64,${out.b64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchFeed, parseFeed, fetchImage };
