'use strict';
/**
 * LocalSend（工具箱内置版）：同一局域网里的工具箱互相发现、互传文件/文字。
 *
 * - 身份：每台工具箱一个持久 id + 4 位「编号」+ 设备名（userData/localsend.json）。
 * - 发现：UDP 组播 224.0.0.168 + 各网卡广播，端口 53318，每 3 秒喊一声；收到新面孔立刻单播回一声，秒级互相看见。
 *   （避开正版 LocalSend 的 224.0.0.167:53317，两者能共存。）组播被路由器拦的网络，可按 IP 手动加。
 * - 传输：HTTP（同端口 TCP）。发送方先 POST /ls/offer 报清单 → 接收方弹窗「接受/拒绝」→ 接受后拿到一次性 token
 *   → 逐个 PUT /ls/upload 流式写盘（不进内存，大文件也行）。文字随 offer 一起过去，接受即落地。
 * - 安全：只在局域网；每次都要接收方点接受；token 一次性、只对这次 offer 有效；文件名取 basename 去掉路径穿越。
 */
const dgram = require('node:dgram');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = 53318;
const MCAST = '224.0.0.168';
const TAG = 'atb-ls';
const VER = 1;
const OFFLINE_MS = 12000;
const OFFER_TIMEOUT_MS = 90000;

function lanAddrs() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(utun|awdl|llw|bridge|vmnet|vboxnet|docker)/.test(name)) continue;
      out.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

function broadcastOf(address, netmask) {
  const a = address.split('.').map(Number), m = netmask.split('.').map(Number);
  return a.map((x, i) => (x & m[i]) | (~m[i] & 255)).join('.');
}

function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[\u0000-\u001f<>:"|?*\\/]/g, '_').trim();
  return base && base !== '.' && base !== '..' ? base.slice(0, 200) : 'file';
}

function uniquePath(dir, name) {
  let p = path.join(dir, name);
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i += 1) { p = path.join(dir, `${stem} (${i})${ext}`); if (!fs.existsSync(p)) return p; }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

class LocalSendService {
  constructor({ userDataDir, emit, recvDir, port } = {}) {
    this.userDataDir = userDataDir || path.join(os.homedir(), '.agent-toolbox');
    this.emit = typeof emit === 'function' ? emit : () => {};
    this.recvDir = recvDir || path.join(os.homedir(), 'Downloads', 'LocalSend');
    this.idFile = path.join(this.userDataDir, 'localsend.json');
    this.histFile = path.join(this.userDataDir, 'localsend-history.json');
    this.me = this._loadIdentity();
    this.peers = new Map();          // id -> { id, code, name, ip, port, lastSeen, manual }
    this.pending = new Map();        // offerId -> { resolve, timer, info }
    this.sessions = new Map();       // token -> { files:[{name,size}], from, received:0, savedPaths:[] }
    this.history = this._loadHistory();
    this.port = Number(port) || PORT;   // HTTP 端口（发现走固定 UDP 53318；自测时可给第二个实例换 HTTP 口）
    this.started = false;
  }

  // ---------- 身份 ----------
  _loadIdentity() {
    try { const j = JSON.parse(fs.readFileSync(this.idFile, 'utf8')); if (j.id && j.code) return j; } catch { /* 首次 */ }
    const me = {
      id: crypto.randomUUID(),
      code: String(1000 + crypto.randomInt(9000)),
      name: (os.hostname() || 'Mac').replace(/\.local$/, ''),
    };
    try { fs.mkdirSync(this.userDataDir, { recursive: true }); fs.writeFileSync(this.idFile, JSON.stringify(me, null, 2)); } catch { /* */ }
    return me;
  }

  info() {
    return { ...this.me, port: this.port, ips: lanAddrs().map((a) => a.address), recvDir: this.recvDir, started: this.started };
  }

  setName(name) {
    const n = String(name || '').trim().slice(0, 40);
    if (!n) return this.info();
    this.me.name = n;
    try { fs.writeFileSync(this.idFile, JSON.stringify(this.me, null, 2)); } catch { /* */ }
    this._hello();
    return this.info();
  }

  // ---------- 启动：HTTP + UDP ----------
  start() {
    if (this.started) return this.info();
    this.started = true;
    try { fs.mkdirSync(this.recvDir, { recursive: true }); } catch { /* */ }

    this.server = http.createServer((req, res) => this._handle(req, res).catch((e) => {
      try { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); } catch { /* */ }
    }));
    this.server.on('error', (e) => this.emit({ type: 'error', text: 'HTTP 服务起不来：' + e.message }));
    this.server.listen(this.port, '0.0.0.0');

    this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udp.on('error', (e) => this.emit({ type: 'error', text: '发现服务出错：' + e.message }));
    this.udp.on('message', (buf, rinfo) => this._onUdp(buf, rinfo));
    this.udp.bind(PORT, () => {
      try { this.udp.setBroadcast(true); } catch { /* */ }
      try { this.udp.setMulticastTTL(2); } catch { /* */ }
      for (const a of lanAddrs()) { try { this.udp.addMembership(MCAST, a.address); } catch { /* 某些网卡不支持 */ } }
      this._hello();
    });
    this.helloTimer = setInterval(() => { this._hello(); this._prune(); }, 3000);
    return this.info();
  }

  stop() {
    clearInterval(this.helloTimer);
    try { this.udp && this.udp.close(); } catch { /* */ }
    try { this.server && this.server.close(); } catch { /* */ }
    this.started = false;
  }

  _helloPacket(kind = 'hello') {
    return Buffer.from(JSON.stringify({ t: TAG, v: VER, kind, id: this.me.id, code: this.me.code, name: this.me.name, port: this.port }));
  }

  _hello(target) {
    if (!this.udp) return;
    const pkt = this._helloPacket();
    const send = (addr) => { try { this.udp.send(pkt, PORT, addr); } catch { /* */ } };
    if (target) return send(target);
    send(MCAST);
    for (const a of lanAddrs()) send(broadcastOf(a.address, a.netmask));
  }

  _onUdp(buf, rinfo) {
    let m; try { m = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (!m || m.t !== TAG || !m.id || m.id === this.me.id) return;
    const isNew = !this.peers.has(m.id) || Date.now() - this.peers.get(m.id).lastSeen > OFFLINE_MS;
    this.peers.set(m.id, { id: m.id, code: String(m.code || ''), name: String(m.name || '').slice(0, 40), ip: rinfo.address, port: Number(m.port) || PORT, lastSeen: Date.now(), manual: false });
    if (isNew) { this._hello(rinfo.address); this._emitPeers(); }
  }

  _prune() {
    let changed = false;
    for (const p of this.peers.values()) {
      const online = Date.now() - p.lastSeen < OFFLINE_MS;
      if (p._online !== online) { p._online = online; changed = true; }
    }
    if (changed) this._emitPeers();
  }

  listPeers() {
    return [...this.peers.values()].map((p) => ({ ...p, online: Date.now() - p.lastSeen < OFFLINE_MS }))
      .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  }

  _emitPeers() { this.emit({ type: 'peers', peers: this.listPeers() }); }

  // 组播被拦时：按 IP 手动加
  async addByIp(ip) {
    const host = String(ip || '').trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, error: 'IP 格式不对，比如 192.168.1.23' };
    try {
      const j = await this._req('GET', host, PORT, '/ls/info', null, 4000);
      if (!j || !j.id) return { ok: false, error: '那台机器没有工具箱 LocalSend 在跑' };
      if (j.id === this.me.id) return { ok: false, error: '这是本机' };
      this.peers.set(j.id, { id: j.id, code: String(j.code || ''), name: String(j.name || ''), ip: host, port: PORT, lastSeen: Date.now(), manual: true });
      this._emitPeers();
      return { ok: true, peer: j };
    } catch (e) { return { ok: false, error: '连不上 ' + host + '：' + e.message }; }
  }

  // ---------- 接收端 HTTP ----------
  async _handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (req.method === 'GET' && u.pathname === '/ls/info') {
      return json(200, { id: this.me.id, code: this.me.code, name: this.me.name, v: VER });
    }

    if (req.method === 'POST' && u.pathname === '/ls/offer') {
      const body = JSON.parse((await this._readBody(req, 1024 * 1024)) || '{}');
      const from = body.from || {};
      const files = (Array.isArray(body.files) ? body.files : []).slice(0, 500).map((f) => ({ name: safeName(f.name), size: Number(f.size) || 0 }));
      const text = typeof body.text === 'string' ? body.text.slice(0, 200000) : '';
      if (!files.length && !text) return json(400, { ok: false, error: '空的' });
      const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      // 顺手把对方记成 peer（对方可能组播不通）
      if (from.id && from.id !== this.me.id) {
        this.peers.set(from.id, { id: from.id, code: String(from.code || ''), name: String(from.name || '').slice(0, 40), ip, port: PORT, lastSeen: Date.now(), manual: false });
        this._emitPeers();
      }
      const offerId = crypto.randomUUID();
      const decision = await new Promise((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(offerId); resolve(false); }, OFFER_TIMEOUT_MS);
        this.pending.set(offerId, { resolve, timer, info: { from, files, text, ip } });
        this.emit({ type: 'incoming', offerId, from: { name: from.name, code: from.code, ip }, files, text: text.slice(0, 2000), textLen: text.length, totalSize: files.reduce((s, f) => s + f.size, 0) });
      });
      if (!decision) { this.emit({ type: 'incoming-closed', offerId, accepted: false }); return json(200, { accept: false }); }
      // 接受：文字立即落地；文件发 token
      const fromName = from.name || ip;
      if (text) {
        const tp = uniquePath(this.recvDir, `来自${safeName(fromName)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`);
        try { fs.writeFileSync(tp, text, 'utf8'); } catch { /* */ }
        this.emit({ type: 'text-received', from: fromName, text, path: tp });
      }
      let token = '';
      if (files.length) {
        token = crypto.randomBytes(16).toString('hex');
        this.sessions.set(token, { files, from: fromName, received: 0, savedPaths: [], created: Date.now() });
        setTimeout(() => this.sessions.delete(token), 6 * 60 * 60 * 1000);
      }
      this._addHistory({ dir: 'in', peer: fromName, files: files.map((f) => f.name), text: text ? text.slice(0, 80) : '', at: Date.now() });
      this.emit({ type: 'incoming-closed', offerId, accepted: true });
      return json(200, { accept: true, token });
    }

    if (req.method === 'PUT' && u.pathname === '/ls/upload') {
      const token = u.searchParams.get('token') || '';
      const idx = Number(u.searchParams.get('i'));
      const s = this.sessions.get(token);
      if (!s || !(idx >= 0 && idx < s.files.length)) return json(403, { ok: false, error: '无效 token' });
      const f = s.files[idx];
      const dest = uniquePath(this.recvDir, f.name);
      const tmp = dest + '.part';
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        let got = 0, lastEmit = 0;
        req.on('data', (c) => {
          got += c.length;
          if (Date.now() - lastEmit > 200) { lastEmit = Date.now(); this.emit({ type: 'recv-progress', name: f.name, got, size: f.size }); }
        });
        req.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
        req.on('error', reject);
      });
      fs.renameSync(tmp, dest);
      s.received += 1; s.savedPaths.push(dest);
      this.emit({ type: 'file-received', name: path.basename(dest), path: dest, from: s.from, done: s.received === s.files.length });
      if (s.received === s.files.length) this.sessions.delete(token);
      return json(200, { ok: true });
    }

    return json(404, { ok: false, error: 'not found' });
  }

  pendingList() {
    return [...this.pending.entries()].map(([offerId, p]) => ({
      offerId, from: { name: p.info.from.name, code: p.info.from.code, ip: p.info.ip },
      files: p.info.files, text: (p.info.text || '').slice(0, 2000), textLen: (p.info.text || '').length,
      totalSize: p.info.files.reduce((s, f) => s + f.size, 0),
    }));
  }

  respond(offerId, accept) {
    const p = this.pending.get(String(offerId || ''));
    if (!p) return { ok: false, error: '这个请求已经过期了' };
    clearTimeout(p.timer); this.pending.delete(offerId);
    p.resolve(Boolean(accept));
    return { ok: true };
  }

  _readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let d = '', n = 0;
      req.setEncoding('utf8');
      req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('太大')); req.destroy(); return; } d += c; });
      req.on('end', () => resolve(d));
      req.on('error', reject);
    });
  }

  // ---------- 发送端 ----------
  _req(method, host, port, p, bodyObj, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const data = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
      const r = http.request({ host, port, path: p, method, timeout, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, (res) => {
        let d = ''; res.setEncoding('utf8'); res.on('data', (c) => (d += c));
        res.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
      });
      r.on('timeout', () => r.destroy(new Error('超时')));
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  }

  _upload(host, port, token, i, file, onProgress) {
    return new Promise((resolve, reject) => {
      const r = http.request({ host, port, method: 'PUT', path: `/ls/upload?token=${encodeURIComponent(token)}&i=${i}`, headers: { 'content-type': 'application/octet-stream', 'content-length': file.size } }, (res) => {
        let d = ''; res.on('data', (c) => (d += c));
        res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error('HTTP ' + res.statusCode + ' ' + d.slice(0, 100)))));
      });
      r.on('error', reject);
      const rs = fs.createReadStream(file.path);
      let sent = 0, last = 0;
      rs.on('data', (c) => { sent += c.length; if (Date.now() - last > 200) { last = Date.now(); onProgress(sent); } });
      rs.on('error', reject);
      rs.pipe(r);
    });
  }

  async send({ peerId, files = [], text = '' } = {}) {
    const peer = this.peers.get(String(peerId || ''));
    if (!peer) return { ok: false, error: '找不到这台设备，刷新一下' };
    const list = [];
    for (const fp of files) {
      try { const st = fs.statSync(fp); if (st.isFile()) list.push({ path: fp, name: path.basename(fp), size: st.size }); } catch { /* 跳过读不到的 */ }
    }
    const t = String(text || '');
    if (!list.length && !t.trim()) return { ok: false, error: '没有要发的内容' };
    this.emit({ type: 'send-state', peer: peer.name, state: 'waiting', text: `等 ${peer.name}（${peer.code}）点接受…` });
    let ans;
    try {
      ans = await this._req('POST', peer.ip, peer.port, '/ls/offer', {
        from: { id: this.me.id, code: this.me.code, name: this.me.name },
        files: list.map((f) => ({ name: f.name, size: f.size })), text: t,
      }, OFFER_TIMEOUT_MS + 5000);
    } catch (e) {
      this.emit({ type: 'send-state', state: 'error', text: '连不上对方：' + e.message });
      return { ok: false, error: '连不上对方：' + e.message };
    }
    if (!ans.accept) { this.emit({ type: 'send-state', state: 'declined', text: `${peer.name} 拒绝了或没响应` }); return { ok: false, error: '对方拒绝了或超时没点' }; }
    const total = list.reduce((s, f) => s + f.size, 0); let doneBytes = 0;
    for (let i = 0; i < list.length; i += 1) {
      const f = list[i];
      try {
        await this._upload(peer.ip, peer.port, ans.token, i, f, (sent) => {
          this.emit({ type: 'send-progress', name: f.name, index: i, count: list.length, sent: doneBytes + sent, total });
        });
        doneBytes += f.size;
      } catch (e) {
        this.emit({ type: 'send-state', state: 'error', text: `${f.name} 发送失败：${e.message}` });
        return { ok: false, error: `${f.name} 发送失败：${e.message}` };
      }
    }
    this._addHistory({ dir: 'out', peer: peer.name, files: list.map((f) => f.name), text: t ? t.slice(0, 80) : '', at: Date.now() });
    this.emit({ type: 'send-state', state: 'done', text: `已发给 ${peer.name} ✓` });
    return { ok: true };
  }

  // ---------- 历史 ----------
  _loadHistory() { try { return JSON.parse(fs.readFileSync(this.histFile, 'utf8')); } catch { return []; } }
  _addHistory(item) {
    this.history.unshift(item); this.history = this.history.slice(0, 100);
    try { fs.writeFileSync(this.histFile, JSON.stringify(this.history)); } catch { /* */ }
    this.emit({ type: 'history', history: this.history.slice(0, 30) });
  }
  getHistory() { return this.history.slice(0, 30); }
}

module.exports = { LocalSendService, PORT };
