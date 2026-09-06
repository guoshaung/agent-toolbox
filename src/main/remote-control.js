'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const MAX_BODY = 64 * 1024;

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

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function pageHtml(token, deviceName) {
  const safeToken = escapeHtml(token);
  const safeName = escapeHtml(deviceName);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#10151b"><link rel="manifest" href="/manifest.webmanifest?token=${encodeURIComponent(token)}"><title>Agent 手机控制</title>
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;background:#10151b;color:#edf2f4}*{box-sizing:border-box}body{margin:0;max-width:760px;margin:auto;padding:18px 16px 42px}header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:12px 2px 18px;border-bottom:1px solid #29333a}h1{margin:5px 0 0;font-size:24px}h2{font-size:14px;margin:0 0 10px}.eyebrow{color:#6ee0cc;font:700 10px ui-monospace,monospace;letter-spacing:1.2px}.muted{color:#829199;font-size:12px}.card{margin-top:14px;padding:15px;border:1px solid #2b373d;border-radius:12px;background:#151c22}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}textarea,input{width:100%;border:1px solid #334149;border-radius:8px;padding:10px;background:#0f1418;color:#edf2f4;font:inherit}textarea{min-height:92px;resize:vertical}button{border:1px solid #3b4b52;border-radius:8px;padding:9px 11px;background:#202b31;color:#edf2f4;font-weight:650}button.primary{background:#2d9b8c;border-color:#54cbbb;color:#071312}button.danger{background:#552e32;border-color:#a35c64}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.grid button{text-align:left}.log{min-height:36px;max-height:220px;overflow:auto;white-space:pre-wrap;color:#c1ccd0;font-size:12px;line-height:1.65}.status{color:#6ee0cc;font-size:12px}small{color:#829199;font-weight:400}@media(max-width:460px){.grid{grid-template-columns:1fr}h1{font-size:21px}}
</style></head><body>
<header><div><div class="eyebrow">AGENT TOOLBOX / REMOTE</div><h1>手机控制台</h1></div><div class="status" id="status">已配对</div></header>
<div class="card"><h2>切换工具</h2><div class="grid" id="tools"></div></div>
<div class="card"><h2>问当前 AI <small>使用电脑端当前配置</small></h2><textarea id="prompt" placeholder="输入要交给 AI 的任务"></textarea><div class="row" style="margin-top:8px"><button class="primary" id="ask">发送给 AI</button><button id="copyPrompt">复制到电脑剪贴板</button></div><div class="log" id="answer"></div></div>
<div class="card"><h2>发送给其他 AI</h2><textarea id="payload" placeholder="输入要发送的文字，先复制到电脑剪贴板"></textarea><div class="row" style="margin-top:8px"><button id="copyPayload">复制到电脑</button><button data-url="https://chat.deepseek.com/">打开 DeepSeek</button><button data-url="https://claude.ai/">打开 Claude</button><button data-url="https://chatgpt.com/">打开 ChatGPT</button></div></div>
<div class="card"><h2>电脑动作</h2><div class="row"><button data-url="https://www.google.com/">打开网页</button><button id="readClipboard">读取电脑剪贴板</button><button class="danger" id="stop">停止手机控制</button></div><div class="log" id="clipboard"></div></div>
<div class="card"><div class="row"><h2 style="margin-right:auto">手机分享收件箱</h2><button id="refreshInbox">刷新</button></div><div class="log" id="inbox">正在加载…</div><p class="muted">Android 安装到主屏幕后，可从浏览器、视频、公众号等应用直接分享文字或链接到这里。</p></div>
<p class="muted">设备：${safeName} · 可通过局域网或已连接的 VPN 访问。手机控制不会自动执行任意命令；需要登录、付款、验证码或系统权限时请在电脑端确认。</p>
<script>
const token=${JSON.stringify(token)};const tools=[['ask','⚡ 快问'],['focus','🎯 专注'],['research','🔬 科研'],['terms','⌁ 术语'],['history','🗂 记录'],['video','📺 视频'],['coach','🧑‍🏫 陪读'],['settings','⚙ 设置']];
const $=id=>document.getElementById(id); const log=(el,text)=>{$(el).textContent=String(text||'')};
async function command(type,payload={}){const response=await fetch('/api/command?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload})});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'请求失败');return data;}
async function loadInbox(){try{const response=await fetch('/api/inbox?token='+encodeURIComponent(token));const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'读取失败');const items=data.items||[];const box=$('inbox');box.textContent='';if(!items.length){box.textContent='还没有分享内容。';return;}for(const item of items){const row=document.createElement('div');row.style='padding:9px 0;border-bottom:1px solid #29333a';const title=document.createElement('strong');title.textContent=item.title||item.url||'手机分享';const body=document.createElement('div');body.className='muted';body.textContent=[item.text,item.url].filter(Boolean).join('\\n');const copy=document.createElement('button');copy.textContent='复制到电脑';copy.onclick=()=>command('clipboard.write',{text:[item.title,item.text,item.url].filter(Boolean).join('\\n')}).then(()=>alert('已复制到电脑剪贴板'));row.append(title,body,copy);box.append(row)}}catch(error){log('inbox','读取失败：'+error.message)}}
for(const [id,label] of tools){const b=document.createElement('button');b.textContent=label;b.onclick=()=>command('tool.open',{id}).catch(e=>alert(e.message));$('tools').append(b)}
$('ask').onclick=async()=>{const text=$('prompt').value.trim();if(!text)return;log('answer','正在请求…');try{const r=await command('ai.ask',{prompt:text});log('answer',r.text)}catch(e){log('answer','失败：'+e.message)}};
$('copyPrompt').onclick=()=>{const text=$('prompt').value.trim();if(text)command('clipboard.write',{text}).catch(e=>alert(e.message))};
$('copyPayload').onclick=()=>{const text=$('payload').value.trim();if(text)command('clipboard.write',{text}).then(()=>alert('已复制到电脑剪贴板')).catch(e=>alert(e.message))};
for(const b of document.querySelectorAll('[data-url]'))b.onclick=()=>command('url.open',{url:b.dataset.url}).catch(e=>alert(e.message));
$('readClipboard').onclick=async()=>{try{const r=await command('clipboard.read');log('clipboard',r.text||'（剪贴板为空）')}catch(e){log('clipboard','失败：'+e.message)}};
$('refreshInbox').onclick=loadInbox;
$('stop').onclick=async()=>{if(confirm('停止后手机将不能再控制工具箱，确定吗？')){await command('remote.stop');location.reload()}};
loadInbox();navigator.serviceWorker?.register('/sw.js?token='+encodeURIComponent(token)).catch(()=>{});
</script></body></html>`;
}

class RemoteControl {
  constructor({ deviceName = 'Agent 工具箱', onCommand, onInbox, preferredPort = 43127, inbox = [], apkPath = '', apkName = 'Agent-Toolbox-Remote.apk' }) {
    this.deviceName = deviceName;
    this.onCommand = onCommand;
    this.onInbox = onInbox;
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

  async stop() {
    const server = this.server;
    this.server = null;
    this.token = '';
    this.port = 0;
    if (server) await new Promise((resolve) => server.close(() => resolve()));
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
      response.end(pageHtml(this.token, this.deviceName));
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
