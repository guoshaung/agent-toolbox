'use strict';
// 生成应用:把用户一句话提示词发给 agentworld 的 build_new_app 流水线
// (intake 写PRD → 委派 demodata/arch/dev),并读 work_dir 里的进度文件回传给面板。
// 触发复用现成的 ws_launch.py(它负责 WS 握手 + 保持连接让 agent 跑完)。
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SUITE = process.env.AGENTWORLD_SUITE || '/Users/真简/agentworld-suite';
// dev_agent(小李Leo)是完整编排入口:规划任务 → 委派 intake(PRD)→ demodata → arch → dev(写代码)。
// 注意:build_new_app_intake_agent 只是其中第一段(只出 PRD),不能当整体入口。
const ENTRY_AGENT = 'dev_agent';
const PY = path.join(SUITE, 'agentworld', '.venv', 'bin', 'python');
const WS_LAUNCH = path.join(SUITE, 'experiments', 'skill_distill', 'ws_launch.py');
const AGENTS_DIR = path.join(SUITE, 'agentworld', 'workspace', 'agents');
const workRoot = (agent) => path.join(AGENTS_DIR, agent || ENTRY_AGENT, 'channels', 'web');
const LOG_DIR = path.join(SUITE, '.local', 'appgen');
const HISTORY = path.join(LOG_DIR, 'history.json');
const HOST = '127.0.0.1:4002';

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY, 'utf8')) || []; } catch { return []; }
}
function saveHistory(list) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.writeFileSync(HISTORY, JSON.stringify(list.slice(0, 30))); } catch { /* 落盘失败忽略 */ }
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function readText(f, n) { try { const t = fs.readFileSync(f, 'utf8'); return n ? t.split(/\r?\n/).slice(0, n).join('\n') : t; } catch { return ''; } }

// 遍历 work_dir 列出「生成的应用文件」(排除内部目录)
function listAppFiles(root, base = root, out = [], depth = 0) {
  if (depth > 6 || out.length > 400) return out;
  let ents = [];
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'unpackage') continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) listAppFiles(full, base, out, depth + 1);
    else out.push(path.relative(base, full));
  }
  return out;
}

class AppGenService {
  constructor() { this.runs = new Map(); }  // chatId -> {child, prompt, startedAt}

  gatewayUp() {
    return fetch('http://127.0.0.1:18791/', { signal: AbortSignal.timeout(1500) })
      .then(() => true).catch(() => false);
  }

  async start(prompt) {
    prompt = String(prompt || '').trim();
    if (!prompt) return { ok: false, error: '请先输入应用需求' };
    if (!fs.existsSync(PY)) return { ok: false, error: `找不到 agentworld venv:${PY}` };
    if (!(await this.gatewayUp())) return { ok: false, error: 'agentworld gateway 未运行(先 up.sh 起栈)' };
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const chatId = 'app-' + Date.now();
    const logFile = path.join(LOG_DIR, chatId + '.log');
    const out = fs.openSync(logFile, 'a');
    const child = spawn(PY, [WS_LAUNCH, '--agent', ENTRY_AGENT, '--text', prompt,
      '--chat-id', chatId, '--host', HOST, '--timeout', '2400', '--idle', '300'],
      { cwd: SUITE, stdio: ['ignore', out, out], detached: false });
    this.runs.set(chatId, { child, prompt, startedAt: Date.now(), logFile });
    child.on('exit', () => { const r = this.runs.get(chatId); if (r) r.exited = true; });
    // 持久化,重启后能重连
    const hist = loadHistory().filter((h) => h.chatId !== chatId);
    hist.unshift({ chatId, prompt, agent: ENTRY_AGENT, startedAt: Date.now() });
    saveHistory(hist);
    return { ok: true, chatId, prompt };
  }

  // 最近的生成记录(newest first),重启后面板用它重连
  listRuns() {
    return loadHistory().slice(0, 15).map((h) => {
      const wd = path.join(workRoot(h.agent), h.chatId, 'work_dir');
      let hasFiles = false, prdReady = false, updated = 0;
      try {
        prdReady = fs.existsSync(path.join(wd, 'PRD', 'PRD.md'));
        const st = fs.existsSync(wd) ? fs.statSync(wd) : null;
        updated = st ? st.mtimeMs : 0;
        hasFiles = fs.existsSync(wd);
      } catch { /* 目录没了 */ }
      const live = this.runs.get(h.chatId);
      return { ...h, exists: hasFiles, prdReady, running: !!(live && live.child && !live.exited), updated };
    });
  }

  status(chatId) {
    if (!chatId) return { ok: false, error: '缺少 chatId' };
    const run = this.runs.get(chatId) || {};
    const hist = loadHistory().find((h) => h.chatId === chatId) || {};
    const agent = run.agent || hist.agent || ENTRY_AGENT;
    const wd = path.join(workRoot(agent), chatId, 'work_dir');
    const progress = readJson(path.join(wd, '.run_guard', 'live_progress.json'));
    const pstate = readJson(path.join(wd, '.signals', 'pipeline_state.json'));
    const prdPath = path.join(wd, 'PRD', 'PRD.md');
    const prd = fs.existsSync(prdPath) ? readText(prdPath) : '';
    // 顶层 agent 的叙述:从 ws_launch 日志里挑 response 行(重启后按 chatId 从磁盘找)
    const logFile = run.logFile || path.join(LOG_DIR, chatId + '.log');
    const log = readText(logFile);
    const narration = [];
    for (const line of log.split(/\r?\n/)) {
      const m = line.match(/response:\s*(.+)$/);
      if (m) narration.push(m[1].trim().slice(0, 200));
    }
    const files = fs.existsSync(wd) ? listAppFiles(wd) : [];
    // 预览入口:找 index.html / app_preview.html / pages 下的页面
    const preview = files.find((f) => /(^|\/)index\.html$/.test(f)) ||
                    files.find((f) => f.endsWith('app_preview.html'));
    const running = run.child && !run.exited;
    const startedAt = run.startedAt || hist.startedAt || 0;
    return {
      ok: true, chatId, running: !!running, prompt: run.prompt || hist.prompt || '',
      elapsed: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
      scene: pstate && pstate.scene || '', hitTemplate: pstate && pstate.hit_app_template || false,
      tasks: (progress && progress.tasks || []).map((t) => ({
        agent_id: t.agent_id, name: (t.task_name || '').slice(0, 60), status: t.status,
        latest: t.latest_progress ? { label: t.latest_progress.label, status: t.latest_progress.status } : null,
        actions: (t.history || []).map((h) => h.progress && h.progress.label).filter(Boolean),
      })),
      narration: narration.slice(-12),
      prdReady: !!prd, prd: prd.slice(0, 4000),
      files: files.slice(0, 120), previewPath: preview || '',
    };
  }

  stop(chatId) {
    const run = this.runs.get(chatId);
    if (run && run.child && !run.exited) { try { run.child.kill('SIGTERM'); } catch { /* 已退 */ } }
    return { ok: true };
  }

  // 把生成的 uni-app 工程真编译成 H5 并返回预览地址(走 compile_preview.py + uni build)
  compilePreview(chatId) {
    const script = path.join(SUITE, 'experiments', 'skill_distill', 'compile_preview.py');
    const agent = (this.runs.get(chatId) || {}).agent || (loadHistory().find((h) => h.chatId === chatId) || {}).agent || ENTRY_AGENT;
    return new Promise((resolve) => {
      execFile(PY, [script, chatId, '--agent', agent], { cwd: SUITE, timeout: 600000, encoding: 'utf8' },
        (_err, stdout, stderr) => {
          const line = (String(stdout || '').trim().split('\n').pop() || '').trim();
          if (line.startsWith('OK ')) resolve({ ok: true, url: 'http://127.0.0.1:8770' + line.slice(3).trim() });
          else resolve({ ok: false, error: (line.startsWith('ERR') ? line.slice(4) : line) || String(stderr || '').slice(-300) || '编译失败' });
        });
    });
  }

  // 读单个生成文件内容(给面板看代码/预览)
  readFile(chatId, rel) {
    const wd = path.join(workRoot(ENTRY_AGENT), chatId, 'work_dir');
    const full = path.resolve(wd, rel);
    if (!full.startsWith(path.resolve(wd))) return { ok: false, error: '非法路径' };
    try { return { ok: true, content: fs.readFileSync(full, 'utf8').slice(0, 200000) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
}

function registerAppGenIpc(ipcMain) {
  const svc = new AppGenService();
  ipcMain.handle('appgen:start', (_e, prompt) => svc.start(prompt));
  ipcMain.handle('appgen:status', (_e, chatId) => svc.status(chatId));
  ipcMain.handle('appgen:listRuns', () => svc.listRuns());
  ipcMain.handle('appgen:stop', (_e, chatId) => svc.stop(chatId));
  ipcMain.handle('appgen:readFile', (_e, chatId, rel) => svc.readFile(chatId, rel));
  ipcMain.handle('appgen:compilePreview', (_e, chatId) => svc.compilePreview(chatId));
  return svc;
}

module.exports = { AppGenService, registerAppGenIpc };
