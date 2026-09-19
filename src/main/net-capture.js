'use strict';

/**
 * 抓包台。
 *
 * 先说清楚能到哪儿、不能到哪儿，省得当成 Wireshark 用：
 *
 * - **应用内流量**：工具箱里那些内嵌网页（DeepSeek、B 站、外卖、科研浏览器…）发的每一条
 *   请求，方法、URL、请求/响应头、状态码、耗时、大小全都有。走 Electron 的 webRequest，
 *   不用任何系统权限。
 * - **本机代理**：起一个 HTTP 代理，别的应用（浏览器、Postman、你自己的程序）把代理指过来
 *   就能抓。明文 HTTP 连请求体和响应体都有；HTTPS 走 CONNECT 隧道，只看得到域名、端口、
 *   字节数、时长 —— 内容是加密的，不解密（要解密得装根证书做中间人，那是另一回事，
 *   这里不干）。
 * - **抓不到的**：网卡层的原始包（TCP 握手、DNS、非 HTTP 协议）。那个要 root + tcpdump，
 *   不是一个应用该悄悄干的事。真需要就用 Wireshark。
 */
const http = require('node:http');
const net = require('node:net');
const { URL } = require('node:url');

const MAX_ENTRIES = 3000;
const MAX_BODY = 512 * 1024;

const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };
const pathOf = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

/** 一条抓到的请求 */
function entryOf(base) {
  return {
    id: '', source: 'app', startedAt: Date.now(), method: 'GET', url: '',
    host: '', path: '', type: '', status: 0, statusText: '',
    reqHeaders: [], resHeaders: [], reqBody: '', resBody: '',
    size: 0, ms: 0, error: '', fromCache: false, done: false, ...base,
  };
}

class NetCapture {
  constructor({ session, partitions = [], onChange } = {}) {
    this.session = session;
    this.partitions = partitions;
    this.onChange = onChange;
    this.entries = [];
    this.byKey = new Map();
    this.capturing = false;
    this.proxy = null;
    this.proxyPort = 0;
    this.seq = 0;
  }

  _push(entry) {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      const dropped = this.entries.splice(0, this.entries.length - MAX_ENTRIES);
      for (const item of dropped) this.byKey.delete(item.key);
    }
    this.onChange?.();
    return entry;
  }

  /** 把 Electron 的 header 对象（值可能是数组）压成 [[k, v]] */
  static flatHeaders(headers = {}) {
    return Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]);
  }

  // ---------- 应用内流量 ----------

  start() {
    if (this.capturing) return { ok: true, already: true };
    if (!this.session) return { ok: false, error: '拿不到 session' };
    this.sessions = [...new Set(this.partitions)].map((p) => this.session.fromPartition(p));
    this.sessions.push(this.session.defaultSession);
    const filter = { urls: ['<all_urls>'] };
    for (const ses of this.sessions) {
      ses.webRequest.onBeforeRequest(filter, (details, callback) => {
        const key = `${ses.storagePath || 'default'}#${details.id}`;
        const entry = entryOf({
          id: `a${++this.seq}`, key, source: 'app', method: details.method, url: details.url,
          host: hostOf(details.url), path: pathOf(details.url), type: details.resourceType,
          startedAt: details.timestamp || Date.now(),
          reqBody: (details.uploadData || []).map((d) => (d.bytes ? d.bytes.toString('utf8') : `[文件 ${d.file || ''}]`)).join('').slice(0, MAX_BODY),
        });
        this.byKey.set(key, entry);
        this._push(entry);
        callback({});
      });
      ses.webRequest.onSendHeaders(filter, (details) => {
        const entry = this.byKey.get(`${ses.storagePath || 'default'}#${details.id}`);
        if (entry) entry.reqHeaders = NetCapture.flatHeaders(details.requestHeaders);
      });
      ses.webRequest.onHeadersReceived(filter, (details, callback) => {
        const entry = this.byKey.get(`${ses.storagePath || 'default'}#${details.id}`);
        if (entry) {
          entry.status = details.statusCode;
          entry.statusText = details.statusLine || '';
          entry.resHeaders = NetCapture.flatHeaders(details.responseHeaders);
        }
        callback({});
      });
      ses.webRequest.onCompleted(filter, (details) => {
        const entry = this.byKey.get(`${ses.storagePath || 'default'}#${details.id}`);
        if (!entry) return;
        entry.status = details.statusCode;
        entry.fromCache = Boolean(details.fromCache);
        entry.ms = Math.max(0, Math.round((details.timestamp || Date.now()) - entry.startedAt));
        entry.done = true;
        const len = (entry.resHeaders.find(([k]) => /^content-length$/i.test(k)) || [])[1];
        entry.size = Number(len) || 0;
        this.onChange?.();
      });
      ses.webRequest.onErrorOccurred(filter, (details) => {
        const entry = this.byKey.get(`${ses.storagePath || 'default'}#${details.id}`);
        if (!entry) return;
        entry.error = details.error || '请求失败';
        entry.ms = Math.max(0, Math.round((details.timestamp || Date.now()) - entry.startedAt));
        entry.done = true;
        this.onChange?.();
      });
    }
    this.capturing = true;
    return { ok: true };
  }

  stop() {
    for (const ses of this.sessions || []) {
      // 传 null 就是摘掉监听
      for (const hook of ['onBeforeRequest', 'onSendHeaders', 'onHeadersReceived', 'onCompleted', 'onErrorOccurred']) {
        try { ses.webRequest[hook](null); } catch { /* 摘不掉也不致命 */ }
      }
    }
    this.sessions = [];
    this.capturing = false;
    return { ok: true };
  }

  clear() {
    this.entries = [];
    this.byKey.clear();
    this.onChange?.();
    return { ok: true };
  }

  list({ limit = 600 } = {}) {
    // 给界面的是摘要，点开某一条再要详情，不然一屏几千条 IPC 会卡
    return this.entries.slice(-limit).map((e) => ({
      id: e.id, source: e.source, startedAt: e.startedAt, method: e.method, url: e.url,
      host: e.host, path: e.path, type: e.type, status: e.status, size: e.size,
      ms: e.ms, error: e.error, fromCache: e.fromCache, done: e.done,
    }));
  }

  detail(id) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return null;
    const { key, ...rest } = entry;
    return rest;
  }

  // ---------- 本机代理 ----------

  /**
   * 起一个 HTTP 代理。别的应用把 HTTP/HTTPS 代理指到 127.0.0.1:<port> 就会被记下来。
   * 明文 HTTP 全都有；HTTPS 只记录隧道两端和流量大小，不解密。
   */
  startProxy(port = 8899) {
    if (this.proxy) return { ok: true, port: this.proxyPort, already: true };
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => this._onProxyRequest(req, res));
      server.on('connect', (req, socket, head) => this._onProxyConnect(req, socket, head));
      server.on('error', (error) => { this.proxy = null; resolve({ ok: false, error: error.code === 'EADDRINUSE' ? `${port} 端口被占了，换一个。` : error.message }); });
      server.listen(port, '127.0.0.1', () => {
        this.proxy = server;
        this.proxyPort = server.address().port;
        resolve({ ok: true, port: this.proxyPort });
      });
    });
  }

  async stopProxy() {
    const server = this.proxy;
    this.proxy = null;
    this.proxyPort = 0;
    if (!server) return { ok: true };
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); setTimeout(resolve, 1000); });
    return { ok: true };
  }

  _onProxyRequest(req, res) {
    let target;
    try { target = new URL(req.url.startsWith('http') ? req.url : `http://${req.headers.host}${req.url}`); }
    catch { res.writeHead(400).end('bad url'); return; }
    const entry = this._push(entryOf({
      id: `p${++this.seq}`, source: 'proxy', method: req.method, url: target.href,
      host: target.host, path: target.pathname + target.search, type: 'proxy',
      reqHeaders: NetCapture.flatHeaders(req.headers),
    }));
    const chunks = [];
    req.on('data', (c) => { if (entry.reqBody.length < MAX_BODY) chunks.push(c); });
    req.on('end', () => { entry.reqBody = Buffer.concat(chunks).toString('utf8').slice(0, MAX_BODY); });

    const upstream = http.request({
      host: target.hostname, port: target.port || 80, path: target.pathname + target.search,
      method: req.method, headers: req.headers,
    }, (up) => {
      entry.status = up.statusCode;
      entry.statusText = up.statusMessage || '';
      entry.resHeaders = NetCapture.flatHeaders(up.headers);
      res.writeHead(up.statusCode, up.headers);
      const body = [];
      let size = 0;
      up.on('data', (c) => { size += c.length; if (size < MAX_BODY) body.push(c); res.write(c); });
      up.on('end', () => {
        entry.resBody = Buffer.concat(body).toString('utf8').slice(0, MAX_BODY);
        entry.size = size;
        entry.ms = Date.now() - entry.startedAt;
        entry.done = true;
        this.onChange?.();
        res.end();
      });
    });
    upstream.on('error', (error) => {
      entry.error = error.message; entry.done = true; entry.ms = Date.now() - entry.startedAt;
      this.onChange?.();
      res.writeHead(502).end(`proxy error: ${error.message}`);
    });
    req.pipe(upstream);
  }

  _onProxyConnect(req, socket, head) {
    const [host, portText] = String(req.url || '').split(':');
    const port = Number(portText) || 443;
    const entry = this._push(entryOf({
      id: `p${++this.seq}`, source: 'proxy', method: 'CONNECT', url: `https://${host}`,
      host: `${host}:${port}`, path: '（加密隧道，内容不解密）', type: 'tunnel',
      reqHeaders: NetCapture.flatHeaders(req.headers),
    }));
    const upstream = net.connect(port, host, () => {
      entry.status = 200;
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    let bytes = 0;
    const count = (c) => { bytes += c.length; entry.size = bytes; };
    upstream.on('data', count);
    socket.on('data', count);
    const finish = (error) => {
      if (entry.done) return;
      entry.done = true;
      entry.ms = Date.now() - entry.startedAt;
      if (error) entry.error = error.message;
      this.onChange?.();
    };
    upstream.on('error', (e) => { finish(e); socket.destroy(); });
    socket.on('error', () => { finish(); upstream.destroy(); });
    upstream.on('close', () => finish());
  }

  status() {
    return { capturing: this.capturing, count: this.entries.length, proxyPort: this.proxyPort, proxyOn: Boolean(this.proxy) };
  }

  /** 导成 HAR，能直接拖进 Chrome DevTools 的 Network 面板看 */
  toHar() {
    return {
      log: {
        version: '1.2',
        creator: { name: 'Agent 工具箱 抓包台', version: '1' },
        entries: this.entries.filter((e) => e.done && e.type !== 'tunnel').map((e) => ({
          startedDateTime: new Date(e.startedAt).toISOString(),
          time: e.ms,
          request: {
            method: e.method, url: e.url, httpVersion: 'HTTP/1.1',
            headers: e.reqHeaders.map(([name, value]) => ({ name, value })),
            queryString: [...(() => { try { return new URL(e.url).searchParams; } catch { return []; } })()].map(([name, value]) => ({ name, value })),
            cookies: [], headersSize: -1, bodySize: e.reqBody.length,
            ...(e.reqBody ? { postData: { mimeType: 'application/octet-stream', text: e.reqBody } } : {}),
          },
          response: {
            status: e.status, statusText: e.statusText, httpVersion: 'HTTP/1.1',
            headers: e.resHeaders.map(([name, value]) => ({ name, value })),
            cookies: [], content: { size: e.size, mimeType: (e.resHeaders.find(([k]) => /^content-type$/i.test(k)) || [])[1] || '', text: e.resBody },
            redirectURL: '', headersSize: -1, bodySize: e.size,
          },
          cache: {}, timings: { send: 0, wait: e.ms, receive: 0 },
        })),
      },
    };
  }
}

/**
 * 显示过滤器。写法学 Wireshark 那套，但只做几个真正常用的：
 *   payment            关键词，URL 里有就留
 *   status>=400        状态码比较
 *   method==POST       方法
 *   host~api           域名包含
 *   -png               减号开头 = 排除
 * 空格分隔，全部满足才留（AND）。
 */
function matchFilter(entry, query) {
  const text = String(query || '').trim();
  if (!text) return true;
  return text.split(/\s+/).every((token) => {
    const negate = token.startsWith('-');
    const term = negate ? token.slice(1) : token;
    const hit = matchTerm(entry, term);
    return negate ? !hit : hit;
  });
}

function matchTerm(entry, term) {
  const cmp = term.match(/^(status|size|ms)\s*(>=|<=|>|<|==|=)\s*(\d+)$/i);
  if (cmp) {
    const value = Number(entry[cmp[1].toLowerCase()] || 0);
    const target = Number(cmp[3]);
    switch (cmp[2]) {
      case '>': return value > target;
      case '<': return value < target;
      case '>=': return value >= target;
      case '<=': return value <= target;
      default: return value === target;
    }
  }
  const field = term.match(/^(method|host|type|path|url)\s*(==|=|~)\s*(.+)$/i);
  if (field) {
    const value = String(entry[field[1].toLowerCase()] || '').toLowerCase();
    const target = field[3].toLowerCase();
    return field[2] === '~' ? value.includes(target) : value === target;
  }
  const needle = term.toLowerCase();
  return `${entry.method} ${entry.url} ${entry.type} ${entry.status}`.toLowerCase().includes(needle);
}

module.exports = { NetCapture, matchFilter, matchTerm };
