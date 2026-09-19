'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const MAX_BODY = 12 * 1024 * 1024;

function networkAddresses() {
  const result = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal) result.push(info.address);
    }
  }
  return [...new Set(result)];
}

function deviceHostnames() {
  const hostname = os.hostname().replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (/^\d+(?:-\d+){3}$/.test(hostname)) return [];
  return hostname ? [`${hostname}.local`] : [];
}

function randomToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const { pageHtml } = require('./remote-page');

class RemoteControl {
  constructor({ deviceName = 'Agent 工具箱', onCommand, onInbox, onScreen, preferredPort = 43127, inbox = [], apkPath = '', apkName = 'Agent-Toolbox-Remote.apk', assetsDir = '' }) {
    this.deviceName = deviceName;
    // 工具表由渲染层推过来（setTools）。写死的话每加一个工具手机端就少一个，
    // 之前手机上只能切到 8 个，而工具箱已经有 19 个了。
    this.tools = [{ id: 'ask', label: '快问', color: '#f0b93d' }, { id: 'docs', label: '文档', color: '#4fb3d9' }, { id: 'research', label: '科研', color: '#3fbf87' }, { id: 'settings', label: '设置', color: '#98a2b3' }];
    this.assetsDir = assetsDir;
    this.onCommand = onCommand;
    this.onInbox = onInbox;
    this.onScreen = onScreen;              // 抓一帧主窗口画面（JPEG Buffer），手机上看
    this.preferredPort = preferredPort;
    this.server = null;
    this.token = '';
    this.port = 0;
    this.inbox = Array.isArray(inbox) ? inbox.slice(0, 100) : [];
    this.apkPath = apkPath;
    this.apkName = path.basename(apkName);
  }

  async start({ token = '', port = this.preferredPort } = {}) {
    if (this.server) return this.status();
    this.token = token || randomToken();
    this.server = http.createServer((request, response) => this._handle(request, response));
    await new Promise((resolve, reject) => {
      const onError = (error) => { this.server?.off('listening', resolve); reject(error); };
      this.server.once('error', onError);
      this.server.listen(port, '0.0.0.0', () => { this.server.off('error', onError); resolve(); });
    });
    this.port = this.server.address().port;
    return this.status();
  }

  /** 渲染层启动时把真实的工具列表推过来，手机端据此生成按钮。 */
  setTools(list) {
    if (!Array.isArray(list) || !list.length) return;
    this.tools = list
      .filter((t) => t && t.id && t.title)
      .map((t) => ({ id: String(t.id), label: String(t.title), color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '#9aa4b5' }))
      .slice(0, 24);
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.token = '';
    this.port = 0;
    if (server) {
      // server.close() 只是不再接受新连接，**会一直等现有连接结束**。
      // 手机端那个页面 15 秒轮询一次收件箱、保持着 keep-alive 连接，
      // 于是 close 的回调永远不来，这些 socket 还吊着 Node 的事件循环 ——
      // 表现就是点了叉号、应用却留在后台不退。必须主动把连接掐掉。
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        server.close(finish);
        server.closeAllConnections?.();
        setTimeout(finish, 1500);      // 老版本 Node 没有 closeAllConnections，兜个底
      });
    }
    return this.status();
  }

  status() {
    const addresses = networkAddresses();
    const hosts = deviceHostnames();
    return {
      enabled: Boolean(this.server),
      port: this.port,
      addresses,
      token: this.token,
      urls: this.server
        ? [...addresses.map((address) => `http://${address}:${this.port}/?token=${this.token}`), ...hosts.map((host) => `http://${host}:${this.port}/?token=${this.token}`)]
        : [],
      apkUrls: this.server && this.apkPath && fs.existsSync(this.apkPath)
        ? [...addresses.map((address) => `http://${address}:${this.port}/download/${encodeURIComponent(this.apkName)}?token=${encodeURIComponent(this.token)}`), ...hosts.map((host) => `http://${host}:${this.port}/download/${encodeURIComponent(this.apkName)}?token=${encodeURIComponent(this.token)}`)]
        : [],
      hosts,
      inbox: this.inbox,
    };
  }

  addInbox(payload = {}) {
    const item = {
      id: crypto.randomUUID(),
      title: String(payload.title || '').trim().slice(0, 240),
      text: String(payload.text || '').trim().slice(0, 20000),
      url: String(payload.url || '').trim().slice(0, 4000),
      mime: String(payload.mime || 'text/plain').slice(0, 120),
      source: String(payload.source || 'mobile-share').slice(0, 80),
      receivedAt: new Date().toISOString(),
    };
    if (!item.title && !item.text && !item.url) throw new Error('分享内容为空。');
    this.inbox = [item, ...this.inbox].slice(0, 100);
    this.onInbox?.(item);
    return item;
  }

  async _handle(request, response) {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/') {
      if (!constantTimeEqual(url.searchParams.get('token'), this.token)) return this._json(response, 401, { ok: false, error: '配对地址无效，请在电脑端重新开启。' });
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(pageHtml(this.token, this.deviceName, this.tools));
      return;
    }
    // 办公室头像。只放行 assets/office 下的 sprite-*.png，路径不参与拼接，拿不到别的文件。
    if (request.method === 'GET' && url.pathname.startsWith('/assets/office/')) {
      if (!constantTimeEqual(url.searchParams.get('token'), this.token)) return this._json(response, 401, { ok: false, error: '配对地址无效。' });
      const name = url.pathname.slice('/assets/office/'.length);
      const file = this.assetsDir && /^sprite-[a-z]+\.png$/.test(name) ? path.join(this.assetsDir, 'office', name) : '';
      if (!file || !fs.existsSync(file)) return this._json(response, 404, { ok: false, error: 'Not found' });
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
      fs.createReadStream(file).pipe(response);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/manifest.webmanifest') {
      if (!constantTimeEqual(url.searchParams.get('token'), this.token)) return this._json(response, 401, { ok: false, error: '配对地址无效。' });
      const manifest = { name: `${this.deviceName} 手机收件箱`, short_name: 'Agent 收件箱', start_url: `/?token=${encodeURIComponent(this.token)}`, scope: '/', display: 'standalone', theme_color: '#10151b', background_color: '#10151b', share_target: { action: `/share?token=${encodeURIComponent(this.token)}`, method: 'POST', enctype: 'application/x-www-form-urlencoded', params: { title: 'title', text: 'text', url: 'url' } } };
      return this._json(response, 200, manifest, 'application/manifest+json');
    }
    if (request.method === 'GET' && url.pathname === '/sw.js') {
      if (!constantTimeEqual(url.searchParams.get('token'), this.token)) return this._json(response, 401, { ok: false, error: '配对地址无效。' });
      response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(clients.claim()));self.addEventListener('fetch',event=>{if(event.request.method==='GET')event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)))})");
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/screen') {
      if (!constantTimeEqual(url.searchParams.get('token'), this.token)) return this._json(response, 401, { ok: false, error: '配对已失效。' });
      let frame = null;
      try { frame = await this.onScreen?.({ width: Number(url.searchParams.get('w')) || 900 }); } catch { frame = null; }
      if (!frame) return this._json(response, 204, { ok: false });
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': frame.length });
      response.end(frame);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/inbox') {
      if (!constantTimeEqual(url.searchParams.get('token'), this.token)) return this._json(response, 401, { ok: false, error: '配对已失效。' });
      return this._json(response, 200, { ok: true, items: this.inbox });
    }
    if (request.method === 'GET' && url.pathname === `/download/${encodeURIComponent(this.apkName)}`) {
      if (!constantTimeEqual(url.searchParams.get('token'), this.token)) return this._json(response, 401, { ok: false, error: '配对地址无效。' });
      if (!this.apkPath || !fs.existsSync(this.apkPath)) return this._json(response, 404, { ok: false, error: '手机 APK 尚未构建。' });
      response.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': fs.statSync(this.apkPath).size, 'Content-Disposition': `attachment; filename="${this.apkName}"`, 'Cache-Control': 'no-store' });
      fs.createReadStream(this.apkPath).pipe(response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/share') {
      if (!constantTimeEqual(url.searchParams.get('token'), this.token)) return this._json(response, 401, { ok: false, error: '配对已失效。' });
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (raw.length > MAX_BODY) return this._json(response, 413, { ok: false, error: '分享内容太大。' }); }
      const form = new URLSearchParams(raw);
      try { this.addInbox({ title: form.get('title'), text: form.get('text'), url: form.get('url'), source: 'share-target' }); } catch (error) { return this._json(response, 400, { ok: false, error: error.message }); }
      response.writeHead(303, { Location: `/?token=${encodeURIComponent(this.token)}&shared=1`, 'Cache-Control': 'no-store' }); response.end(); return;
    }
    if (request.method === 'POST' && url.pathname === '/api/share') {
      if (!constantTimeEqual(url.searchParams.get('token'), this.token)) return this._json(response, 401, { ok: false, error: '配对已失效。' });
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (raw.length > MAX_BODY) return this._json(response, 413, { ok: false, error: '文件过大，最多 8MB。' }); }
      try {
        const body = JSON.parse(raw || '{}');
        const data = String(body.data || '');
        if (data.length > 10 * 1024 * 1024) return this._json(response, 413, { ok: false, error: '文件过大，最多 8MB。' });
        const item = this.addInbox({ title: body.title || '手机手动分享', text: body.text, url: body.url, mime: body.mime || 'text/plain', data, source: 'mobile-manual' });
        return this._json(response, 200, { ok: true, item });
      } catch (error) { return this._json(response, 400, { ok: false, error: error.message }); }
    }
    if (url.pathname === '/api/command' && request.method === 'POST') {
      if (!constantTimeEqual(url.searchParams.get('token'), this.token)) return this._json(response, 401, { ok: false, error: '配对已失效。' });
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > MAX_BODY) return this._json(response, 413, { ok: false, error: '请求太大。' });
      }
      try {
        const body = JSON.parse(raw || '{}');
        const result = await this.onCommand?.(String(body.type || ''), body.payload || {});
        return this._json(response, 200, { ok: true, ...(result || {}) });
      } catch (error) {
        return this._json(response, 400, { ok: false, error: error.message });
      }
    }
    this._json(response, 404, { ok: false, error: 'Not found' });
  }

  _json(response, status, data, contentType = 'application/json; charset=utf-8') {
    response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
  }
}

module.exports = { RemoteControl, networkAddresses, pageHtml };
