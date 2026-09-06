'use strict';

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const MAX_TEXT_LENGTH = 20000;
const REQUEST_TIMEOUT = 45000;
const INSTALL_TIMEOUT = 15 * 60 * 1000;

/** 按平台尝试常见 Python 入口；找不到时返回明确错误，不自动安装运行时。 */
function pythonCandidates(platform = process.platform) {
  if (platform === 'win32') {
    return [
      { command: 'py', args: [] },
      { command: 'python', args: [] },
      { command: 'python3', args: [] },
    ];
  }
  return [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
}

function sidecarEnvironment(source = process.env) {
  // 只传 Python 启动和本地模型读取所需变量，API Key、Token 等敏感变量不继承。
  const allowed = [
    'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE',
    'APPDATA', 'LOCALAPPDATA', 'XDG_DATA_HOME', 'LANG', 'LC_ALL', 'TMP', 'TEMP', 'TMPDIR',
  ];
  const env = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  for (const key of allowed) if (source[key]) env[key] = source[key];
  return env;
}

function validateTranslationPayload(payload) {
  const text = String(payload?.text || '').trim();
  const sourceLanguage = String(payload?.sourceLanguage || '');
  const targetLanguage = String(payload?.targetLanguage || '');
  if (!text) return { ok: false, code: 'invalid-input', error: '没有要翻译的内容。' };
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, code: 'input-too-large', error: `单次翻译不能超过 ${MAX_TEXT_LENGTH} 字符。` };
  if (!['en', 'zh'].includes(sourceLanguage) || !['en', 'zh'].includes(targetLanguage) || sourceLanguage === targetLanguage) {
    return { ok: false, code: 'unsupported-language', error: 'Argos 当前仅支持 English 和 Chinese 互译。' };
  }
  return { ok: true, text, sourceLanguage, targetLanguage };
}

class ArgosService {
  constructor({ scriptPath, spawnImpl = spawn, platform = process.platform, env = process.env } = {}) {
    this.scriptPath = scriptPath || path.join(__dirname, 'argos-sidecar.py');
    this.spawnImpl = spawnImpl;
    this.candidates = pythonCandidates(platform);
    this.env = sidecarEnvironment(env);
    this.child = null;
    this.reader = null;
    this.starting = null;
    this.pending = new Map();
    this.nextId = 1;
    this.readyState = null;
  }

  async start() {
    if (this.child && !this.child.killed) return this.readyState;
    // 多个段落同时请求启动时共享同一个 Promise，防止拉起多个 Python 进程。
    if (this.starting) return this.starting;
    this.starting = this.startCandidates();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async startCandidates() {
    const errors = [];
    for (const candidate of this.candidates) {
      try {
        return await this.launch(candidate);
      } catch (error) {
        errors.push(`${candidate.command}: ${error.message}`);
      }
    }
    throw new Error(`找不到可用的 Python 3，无法启动 Argos Translate。${errors.length ? ` (${errors.join('; ')})` : ''}`);
  }

  launch(candidate) {
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(candidate.command, [...candidate.args, '-u', this.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: this.env,
      });
      const reader = readline.createInterface({ input: child.stdout });
      let settled = false;
      let stderr = '';
      const timer = setTimeout(() => fail(new Error('sidecar 启动超时')), 10000);
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reader.close();
        if (!child.killed) child.kill();
        reject(error);
      };
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
      child.once('error', fail);
      child.once('exit', (code) => {
        if (!settled) return fail(new Error(stderr.trim() || `sidecar 已退出 (${code})`));
        if (this.child === child) this.handleExit(stderr.trim() || `sidecar 已退出 (${code})`);
      });
      reader.on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (!settled && message.event === 'ready') {
          // 收到 ready 才把进程发布为可用，避免请求写进尚未初始化的 stdin。
          settled = true;
          clearTimeout(timer);
          this.child = child;
          this.reader = reader;
          this.readyState = message;
          resolve(message);
          return;
        }
        if (settled) this.handleMessage(message);
      });
    });
  }

  handleMessage(message) {
    // JSONL 响应通过 id 与请求配对，因此同一 sidecar 可以安全承载并发请求。
    const request = this.pending.get(message?.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(message.id);
    request.resolve(message);
  }

  handleExit(reason) {
    this.child = null;
    this.reader = null;
    this.readyState = null;
    for (const request of this.pending.values()) {
      // 子进程退出时主动结束所有等待者，不能让 UI 一直停在“翻译中”。
      clearTimeout(request.timer);
      request.resolve({ ok: false, code: 'sidecar-exited', error: reason });
    }
    this.pending.clear();
  }

  async request(action, payload = {}, timeout = REQUEST_TIMEOUT) {
    try {
      await this.start();
    } catch (error) {
      return { ok: false, code: 'python-unavailable', error: error.message };
    }
    if (!this.child?.stdin?.writable) return { ok: false, code: 'sidecar-unavailable', error: 'Argos sidecar 不可用。' };
    const id = this.nextId++;
    return new Promise((resolve) => {
      // 翻译和模型安装使用不同超时；超时只结束当前请求，不伪造成功结果。
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, code: 'timeout', error: action === 'install' ? 'Argos 模型安装超时。' : 'Argos 翻译超时。' });
      }, timeout);
      this.pending.set(id, { resolve, timer });
      this.child.stdin.write(`${JSON.stringify({ id, action, ...payload })}\n`, 'utf8', (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, code: 'sidecar-write-failed', error: error.message });
      });
    });
  }

  async translate(payload) {
    const valid = validateTranslationPayload(payload);
    if (!valid.ok) return valid;
    return this.request('translate', valid);
  }

  status() {
    return this.request('status');
  }

  installModels() {
    // 模型下载只能由 UI 的明确确认动作触发，启动应用和普通翻译都不会调用这里。
    return this.request('install', { pairs: [['en', 'zh'], ['zh', 'en']] }, INSTALL_TIMEOUT);
  }

  destroy() {
    if (this.child && !this.child.killed) this.child.kill();
    this.handleExit('Argos sidecar 已停止。');
  }
}

module.exports = {
  ArgosService,
  MAX_TEXT_LENGTH,
  pythonCandidates,
  sidecarEnvironment,
  validateTranslationPayload,
};
