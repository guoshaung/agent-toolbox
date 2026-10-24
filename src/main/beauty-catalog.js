'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const catalog = require('./beauty-catalog.json');
const MAX_DOWNLOAD = 25 * 1024 * 1024;

// Only curated public article images are fetched. Protected workshop downloads
// stay on the original site; credentials are never read or forwarded here.
function imageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'dl.winmoes.com' || url.port || url.username || url.password ||
      !/^\/uploads\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp|gif)$/i.test(url.pathname) || url.search || url.hash) throw new Error('素材来源地址无效');
  return url.href;
}
async function fetchImage(url, fetcher = fetch) {
  const response = await fetcher(imageUrl(url), { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`素材下载失败（${response.status}）`);
  if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD) throw new Error('素材超过 25 MB');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_DOWNLOAD) throw new Error('素材超过 25 MB');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
class BeautyCatalog {
  constructor({ root, fetcher = fetch, data = catalog }) { this.root = root; this.fetcher = fetcher; this.data = data; this.pending = null; }
  entry(id) { const item = this.data.entries.find(x => x.id === id); if (!item) throw new Error('目录项目不存在'); return item; }
  coverPath(item) {
    const hash = crypto.createHash('sha256').update(item.cover).digest('hex');
    return path.join(this.root, 'covers', hash + '.webp');
  }
  list() {
    return { updatedAt: this.data.updatedAt, source: this.data.source, entries: this.data.entries.map(item => ({ ...item,
      coverUrl: fs.existsSync(this.coverPath(item)) ? pathToFileURL(this.coverPath(item)).href : '' })) };
  }
  cacheCovers() {
    if (this.pending) return this.pending;
    this.pending = this.prepareCovers().finally(() => { this.pending = null; });
    return this.pending;
  }
  async prepareCovers() {
    const errors = []; let prepared = 0;
    for (let offset = 0; offset < this.data.entries.length; offset += 3) {
      await Promise.all(this.data.entries.slice(offset, offset + 3).map(async item => {
        try {
          const target = this.coverPath(item);
          if (fs.existsSync(target)) return;
          const bytes = await fetchImage(item.cover, this.fetcher);
          const sharp = require('sharp');
          const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
          if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format)) throw new Error('来源不是可用图片');
          const thumbnail = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 640, height: 400, fit: 'cover', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
          fs.mkdirSync(path.dirname(target), { recursive: true });
          try { fs.writeFileSync(target, thumbnail, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
          prepared++;
        } catch (error) { errors.push({ id: item.id, title: item.title, error: error.message }); }
      }));
    }
    return { ...this.list(), prepared, errors };
  }
  async material(id, index) {
    const item = this.entry(id), material = item.materials[index];
    if (!Number.isInteger(index) || !material) throw new Error('该项目没有这张公开原图');
    return { buffer: await fetchImage(material.url, this.fetcher), name: material.name, source: { articleId: id, url: item.url, imageUrl: material.url, author: item.author } };
  }
}
module.exports = { BeautyCatalog, fetchImage, imageUrl };
