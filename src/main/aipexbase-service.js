'use strict';
// AipexBase 服务管理:起停本地移植的公司开源 BaaS(Spring Boot :8080),
// 读日志、跑开通脚本,并把数据接口(/api/data/invoke)代理给渲染层——
// 走主进程 fetch,天然无 CORS。容器在 agentworld-suite 里。
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SUITE = process.env.AGENTWORLD_SUITE || '/Users/真简/agentworld-suite';
const BAAS = 'http://127.0.0.1:8080';

function tailFile(file, n = 60) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const lines = txt.split(/\r?\n/);
    return lines.slice(-n).join('\n');
  } catch { return ''; }
}

class AipexBaseService {
  constructor({ suiteDir } = {}) {
    this.suiteDir = suiteDir || DEFAULT_SUITE;
  }

  paths() {
    const s = this.suiteDir;
    return {
      start: path.join(s, 'aipexbase-run', 'start.sh'),
      stop: path.join(s, 'aipexbase-run', 'stop.sh'),
      provision: path.join(s, 'aipexbase-run', 'provision-demo.py'),
      py: path.join(s, 'agentworld', '.venv', 'bin', 'python'),
      logfile: path.join(s, '.local', 'logs', 'aipexbase.log'),
      demoApp: path.join(s, 'aipexbase-run', '.demo-app'),
    };
  }

  appId() {
    try { return fs.readFileSync(this.paths().demoApp, 'utf8').trim(); } catch { return ''; }
  }

  async healthy() {
    // AipexBase 根路径返回 200(体 {code:401}),只要 fetch 不抛网络错就算活着
    try { await fetch(BAAS + '/', { signal: AbortSignal.timeout(1500) }); return true; }
    catch { return false; }
  }

  async status() {
    const running = await this.healthy();
    const p = this.paths();
    return {
      running,
      appId: this.appId(),
      suiteDir: this.suiteDir,
      hasScripts: fs.existsSync(p.start),
      baseUrl: BAAS,
      log: tailFile(p.logfile, 60),
    };
  }

  _run(cmd, args, { timeout = 120000 } = {}) {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout, cwd: this.suiteDir, encoding: 'utf8' }, (err, stdout, stderr) => {
        resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    });
  }

  async start() {
    const p = this.paths();
    if (!fs.existsSync(p.start)) return { ok: false, error: `找不到 start.sh:${p.start}` };
    if (await this.healthy()) return { ok: true, running: true, note: '已在运行' };
    await this._run('/bin/bash', [p.start], { timeout: 20000 }); // start.sh 自己 background java 后即返回
    for (let i = 0; i < 40; i += 1) {                            // 最多等 ~80s 让 Spring Boot 起来
      await new Promise((r) => setTimeout(r, 2000));
      if (await this.healthy()) return { ok: true, running: true };
    }
    return { ok: false, error: 'AipexBase 起了但 80s 内未在 :8080 应答,看日志' };
  }

  async stop() {
    const p = this.paths();
    const r = await this._run('/bin/bash', [p.stop], { timeout: 15000 });
    return { ok: true, running: false, output: (r.stdout + r.stderr).trim() };
  }

  async provision() {
    const p = this.paths();
    if (!await this.healthy()) return { ok: false, error: 'AipexBase 未运行,先启动再开通' };
    const py = fs.existsSync(p.py) ? p.py : 'python3';
    const r = await this._run(py, [p.provision], { timeout: 60000 });
    return { ok: r.ok, appId: this.appId(), output: (r.stdout + r.stderr).trim() };
  }

  // 把 baas-api 数据接口代理给渲染层。method: list|add|get|page|update|delete
  async data(method, params = {}, table = 'todos') {
    const appId = this.appId();
    if (!appId) return { ok: false, error: '还没有 appId,先点「开通 demo」' };
    try {
      const r = await fetch(`${BAAS}/api/data/invoke?table=${encodeURIComponent(table)}&method=${encodeURIComponent(method)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', APP_ID: appId },
        body: JSON.stringify(params || {}),
        signal: AbortSignal.timeout(8000),
      });
      const json = await r.json();
      return { ok: json.success !== false, data: json.data, raw: json };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }
}

function registerAipexBaseIpc(ipcMain, deps = {}) {
  const svc = new AipexBaseService({ suiteDir: deps.suiteDir });
  ipcMain.handle('aipexbase:status', () => svc.status());
  ipcMain.handle('aipexbase:start', () => svc.start());
  ipcMain.handle('aipexbase:stop', () => svc.stop());
  ipcMain.handle('aipexbase:provision', () => svc.provision());
  ipcMain.handle('aipexbase:data', (_e, method, params, table) => svc.data(method, params, table));
  return svc;
}

module.exports = { AipexBaseService, registerAipexBaseIpc, BAAS };
