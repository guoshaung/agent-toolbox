'use strict';

/**
 * 极简 Chrome DevTools Protocol 客户端（无第三方依赖）。
 * 用来从主进程连真·Edge（独立 profile + 调试端口），往 ChatGPT 标签页 Runtime.evaluate。
 * 只实现够用的：发现标签页、建 WebSocket、发文本帧（带 mask）、解文本帧、Runtime.evaluate。
 */

const http = require('node:http');
const crypto = require('node:crypto');

function httpJson(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 4000 }, (r) => {
      let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('CDP timeout')); });
  });
}

/** 列标签页（type==='page'） */
async function listPages(port) {
  const all = await httpJson(port, '/json');
  return (Array.isArray(all) ? all : []).filter((x) => x.type === 'page');
}

function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let header;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else if (len < 65536) header = Buffer.from([0x81, 0x80 | 126, (len >> 8) & 255, len & 255]);
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

class CDPSession {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = '';
    this.id = 0;
    this.waiters = new Map();
    socket.on('data', (chunk) => { this.buf = Buffer.concat([this.buf, chunk]); this._parse(); });
    socket.on('close', () => { for (const [, w] of this.waiters) w.reject(new Error('CDP 连接关了')); this.waiters.clear(); });
    socket.on('error', () => { /* close 会收尾 */ });
  }

  _parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0]; const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0; const opcode = b0 & 0x0f;
      let len = b1 & 0x7f; let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;   // 帧没收全，等
      const payload = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      if (opcode === 0x8) { try { this.socket.end(); } catch { /* */ } return; }   // close
      if (opcode === 0x1 || opcode === 0x0) {
        this.frag += payload.toString('utf8');
        if (fin) { const msg = this.frag; this.frag = ''; this._dispatch(msg); }
      }
      // ping/pong 忽略
    }
  }

  _dispatch(text) {
    let msg; try { msg = JSON.parse(text); } catch { return; }
    if (msg.id && this.waiters.has(msg.id)) {
      const w = this.waiters.get(msg.id); this.waiters.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error.message || 'CDP error')); else w.resolve(msg.result);
    }
  }

  send(method, params = {}, timeout = 10000) {
    const id = (this.id += 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(id); reject(new Error(`CDP ${method} 超时`)); }, timeout);
      this.waiters.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      try { this.socket.write(encodeFrame(JSON.stringify({ id, method, params }))); } catch (e) { clearTimeout(timer); this.waiters.delete(id); reject(e); }
    });
  }

  /** 在页面里跑 JS，返回 returnByValue 的值 */
  async evaluate(expression, { awaitPromise = true, timeout = 60000 } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true }, timeout);
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'JS 异常');
    return r?.result?.value;
  }

  close() { try { this.socket.end(); } catch { /* */ } }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(wsUrl); } catch (e) { return reject(e); }
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
    });
    req.on('upgrade', (_res, socket) => { socket.setNoDelay(true); resolve(new CDPSession(socket)); });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('WS 握手超时')));
    req.end();
  });
}

module.exports = { httpJson, listPages, connect };
