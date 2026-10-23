'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { networkAddresses } = require('./remote-control');
const ID = /^(?!__proto__$|constructor$|prototype$)[a-zA-Z0-9_-]{1,80}$/;
const validId = value => typeof value === 'string' && ID.test(value);
const MAX_REQUEST = 9 * 1024 * 1024;
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(value));
  fs.renameSync(file + '.tmp', file);
}
function finite(v, min, max) { if (!Number.isFinite(v) || v < min || v > max) throw Error('坐标或数值无效'); return v; }
function objectValue(v, assets) {
  if (!v || !validId(v.id) || !validId(v.page)) throw Error('绘图对象无效');
  const base = { id: v.id, page: v.page, x: finite(v.x, -10000, 10000), y: finite(v.y, -10000, 10000) };
  if (v.type === 'stroke') {
    if (!['pen', 'marker'].includes(v.tool) || !/^#[\da-f]{6}$/i.test(v.color) || !Array.isArray(v.points) || !v.points.length || v.points.length > 20000) throw Error('笔迹无效');
    const extra = {};
    if (v.style) {
      if (v.style.engine !== 'ribbon-v1') throw Error('笔刷版本无效');
      extra.style = { engine: 'ribbon-v1', smoothing: finite(v.style.smoothing, 0, .85), sensitivity: finite(v.style.sensitivity, .35, 2.5) };
    }
    if (v.ink) {
      if (v.ink.format !== 'pencilkit-v1' || typeof v.ink.data !== 'string' || v.ink.data.length > 700000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.ink.data)) throw Error('原生笔迹无效');
      extra.ink = { format: 'pencilkit-v1', data: v.ink.data };
    }
    return { ...base, ...extra, type: 'stroke', tool: v.tool, color: v.color, width: finite(v.width, 0.2, 60), points: v.points.map(p => {
      if (!Array.isArray(p) || p.length !== 3) throw Error('笔迹点无效');
      return [finite(p[0], -10000, 10000), finite(p[1], -10000, 10000), finite(p[2], 0, 1)];
    }) };
  }
  if (v.type === 'image') {
    if (!/^[a-f0-9]{64}$/.test(v.asset) || !fs.existsSync(path.join(assets, v.asset + '.png'))) throw Error('图片不存在');
    return { ...base, type: 'image', asset: v.asset, w: finite(v.w, 1, 10000), h: finite(v.h, 1, 10000), background: v.background === true };
  }
  throw Error('不支持的对象');
}
class DrawingSync {
  constructor({ userDataDir, port = 43128 } = {}) {
    this.userDataDir = userDataDir; this.root = path.join(userDataDir, 'drawing-sync');
    this.assets = path.join(this.root, 'assets'); this.file = path.join(this.root, 'notebook.json');
    this.port = port; this.clients = new Set(); this.server = null; this.starting = null;
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, seq: 0, pages: { first: { id: 'first', name: '绘图本 · 01', paper: 'dots' } }, objects: {}, seen: {} };
    if (this.state.version !== 1 || !this.state.pages || !this.state.objects || !this.state.seen) throw Error('绘图本格式不兼容，请保留原文件');
  }
  identity() {
    const value = JSON.parse(fs.readFileSync(path.join(this.userDataDir, 'localsend.json'), 'utf8'));
    if (!validId(value.id) || !/^\d{4}$/.test(value.code)) throw Error('设备编号不可用');
    return { id: value.id, code: value.code, name: String(value.name || 'Toolbox').slice(0, 80) };
  }
  status() {
    const identity = this.identity(), running = !!this.server?.listening;
    const url = host => `http://${host}:${this.boundPort}/#id=${identity.id}&token=${this.token}`;
    return { enabled: running, identity, clients: this.clients.size, sequence: this.state.seq,
      desktopUrl: running ? url('127.0.0.1') : '', urls: running ? networkAddresses().sort((a, b) => {
        const rank = address => address.startsWith('192.168.') ? 0 : address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(address) ? 2 : 3;
        return rank(a) - rank(b);
      }).map(url) : [] };
  }
  async start() {
    if (this.starting) return this.starting;
    if (this.server?.listening) return this.status();
    this.starting = this._start();
    try { return await this.starting; } finally { this.starting = null; }
  }
  async _start() {
    this.identity();
    const authFile = path.join(this.root, 'pairing.json');
    this.token = fs.existsSync(authFile) ? JSON.parse(fs.readFileSync(authFile, 'utf8')).token : crypto.randomBytes(32).toString('base64url');
    if (!/^[\w-]{43}$/.test(this.token)) throw Error('绘图连接凭据损坏，请保留数据后重新配对');
    atomic(authFile, { token: this.token });
    const server = http.createServer((req, res) => this.handle(req, res).catch(error => {
      if (!res.headersSent) this.json(res, 400, { error: error.message }); else res.end();
    }));
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.port, '0.0.0.0', resolve); });
    this.server = server; this.boundPort = server.address().port;
    this.heartbeat = setInterval(() => { for (const client of this.clients) client.write(': ping\n\n'); }, 15000); this.heartbeat.unref();
    return this.status();
  }
  async stop() {
    if (this.starting) await this.starting;
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.end(); this.clients.clear();
    const server = this.server; this.server = null;
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    return this.status();
  }
  async rotate() {
    await this.stop(); atomic(path.join(this.root, 'pairing.json'), { token: crypto.randomBytes(32).toString('base64url') });
    return this.start();
  }
  json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  broadcast(kind, data) {
    const packet = `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) { if (client.writableLength > 2 * 1024 * 1024) client.end(); else client.write(packet); }
  }
  commit(input) {
    if (!input || !validId(input.id) || !validId(input.client)) throw Error('操作编号无效');
    if (Object.hasOwn(this.state.seen, input.id)) return { duplicate: true, seq: this.state.seen[input.id] };
    if (Object.keys(this.state.seen).length >= 100000 || Object.keys(this.state.objects).length >= 12000 && input.kind === 'put' && !Object.hasOwn(this.state.objects, input.value?.id)) throw Error('绘图本容量已满，请先导出备份');
    let value;
    if (input.kind === 'page') {
      if (!input.value || !validId(input.value.id) || typeof input.value.name !== 'string' || !['plain', 'grid', 'dots', 'lines'].includes(input.value.paper)) throw Error('纸张无效');
      if (!Object.hasOwn(this.state.pages, input.value.id) && Object.keys(this.state.pages).length >= 100) throw Error('最多 100 页');
      value = { id: input.value.id, name: input.value.name.slice(0, 80), paper: input.value.paper };
    } else if (input.kind === 'put') {
      value = objectValue(input.value, this.assets);
      if (!Object.hasOwn(this.state.pages, value.page)) throw Error('纸张不存在');
    } else if (input.kind === 'remove' && validId(input.target)) value = null;
    else throw Error('不支持的操作');
    const seq = this.state.seq + 1;
    const op = { id: input.id, client: input.client, kind: input.kind, ...(value ? { value } : { target: input.target }), seq };
    const next = { ...this.state, seq, seen: { ...this.state.seen, [input.id]: seq } };
    if (op.kind === 'page') next.pages = { ...next.pages, [value.id]: value };
    else { next.objects = { ...next.objects }; if (op.kind === 'put') next.objects[value.id] = { ...value, revision: seq }; else delete next.objects[op.target]; }
    const encoded = JSON.stringify(next); if (Buffer.byteLength(encoded) > 48 * 1024 * 1024) throw Error('绘图本已达到 48 MB，请导出备份');
    // Ack only after atomic persistence. Retry IDs remain durable across app restarts.
    atomic(this.file, next); this.state = next; this.broadcast('operation', op); return { seq };
  }
  async body(req, limit = MAX_REQUEST) {
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > limit) throw Error('内容过大'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    if (!['127.0.0.1', 'localhost', ...networkAddresses(), os.hostname().toLowerCase() + '.local'].includes(host)) return this.json(res, 403, { error: '无效的主机地址' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return this.json(res, 403, { error: '不允许跨站请求' });
    const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/ink.js': ['ink.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (req.method === 'GET' && ['/pdfjs/pdf.mjs', '/pdfjs/pdf.worker.mjs'].includes(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return fs.createReadStream(path.join(__dirname, '../../node_modules/pdfjs-dist/build', path.basename(url.pathname))).on('error', () => res.end()).pipe(res);
    }
    if (req.method === 'GET' && Object.hasOwn(staticFiles, url.pathname)) {
      const [file, mime] = staticFiles[url.pathname];
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors file: http://127.0.0.1:*");
      res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, '../drawing', file)));
    }
    const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('token') || '';
    const left = Buffer.from(supplied), right = Buffer.from(this.token || '');
    if (!right.length || left.length !== right.length || !crypto.timingSafeEqual(left, right) || (req.headers['x-toolbox-id'] || url.searchParams.get('id')) !== this.identity().id) return this.json(res, 401, { error: '绘图配对已失效，请重新扫描电脑二维码' });
    if (req.method === 'GET' && url.pathname === '/api/state') return this.json(res, 200, { ...this.state, seen: undefined, identity: this.identity() });
    if (req.method === 'GET' && url.pathname === '/api/events') {
      if (this.clients.size >= 12) return this.json(res, 429, { error: '连接设备过多' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      this.clients.add(res); res.write(`event: snapshot\ndata: ${JSON.stringify({ ...this.state, seen: undefined, identity: this.identity() })}\n\n`);
      res.on('close', () => this.clients.delete(res)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/op') return this.json(res, 200, this.commit(JSON.parse((await this.body(req, 2 * 1024 * 1024)).toString())));
    if (req.method === 'POST' && url.pathname === '/api/live') {
      const input = JSON.parse((await this.body(req, 96 * 1024)).toString());
      if (!validId(input.client)) throw Error('设备无效');
      const value = input.value === null ? null : objectValue(input.value, this.assets);
      this.broadcast('live', { client: input.client, value }); return this.json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/image') {
      const bytes = await this.body(req); const sharp = require('sharp');
      const image = sharp(bytes, { limitInputPixels: 24000000, animated: false });
      const info = await image.metadata(); if (!['png', 'jpeg', 'webp'].includes(info.format)) throw Error('支持 PNG、JPEG 和 WebP 图片');
      const png = await image.rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      const asset = crypto.createHash('sha256').update(png).digest('hex'); fs.mkdirSync(this.assets, { recursive: true });
      const files = fs.readdirSync(this.assets); if (!files.includes(asset + '.png') && files.reduce((n, f) => n + fs.statSync(path.join(this.assets, f)).size, 0) + png.length > 256 * 1024 * 1024) throw Error('图片库已达到 256 MB');
      fs.writeFileSync(path.join(this.assets, asset + '.png'), png); const meta = await sharp(png).metadata();
      return this.json(res, 200, { asset, width: meta.width, height: meta.height });
    }
    if (req.method === 'GET' && /^\/api\/image\/[a-f0-9]{64}$/.test(url.pathname)) {
      const file = path.join(this.assets, path.basename(url.pathname) + '.png');
      if (!fs.existsSync(file)) return this.json(res, 404, { error: '图片不存在' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return fs.createReadStream(file).pipe(res);
    }
    return this.json(res, 404, { error: '接口不存在' });
  }
}
function registerDrawingIpc(ipcMain, { app }) {
  let service;
  const get = () => service ||= new DrawingSync({ userDataDir: app.getPath('userData') });
  const valid = event => { try { const url = new URL(event.senderFrame.url); const { pathToFileURL } = require('node:url'); return url.protocol === 'file:' && url.href.startsWith(pathToFileURL(path.join(__dirname, '../renderer') + path.sep).href); } catch { return false; } };
  const handle = (channel, action) => ipcMain.handle(channel, async (event, payload) => {
    if (!valid(event)) throw Error('仅工具箱本地界面可管理绘图连接'); return action(payload);
  });
  handle('drawing:status', () => get().status());
  handle('drawing:start', async () => { const info = await get().start(); const QRCode = require('qrcode'); return { ...info, qr: info.urls[0] ? await QRCode.toDataURL(info.urls[0], { width: 240, margin: 2 }) : '' }; });
  handle('drawing:stop', () => get().stop());
  handle('drawing:rotate', () => get().rotate());
  handle('drawing:qr', url => {
    if (!get().status().urls.includes(url)) throw Error('无效的绘图地址');
    return require('qrcode').toDataURL(url, { width: 240, margin: 2 });
  });
  app.on('before-quit', () => { service?.stop().catch(() => {}); });
}
module.exports = { DrawingSync, registerDrawingIpc };
