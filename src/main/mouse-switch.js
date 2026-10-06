'use strict';

// 鼠标侧键 → 切换应用：把 src/main/native/sideswitch.swift 在本机 swiftc 编译成
// 小二进制，作为工具箱子进程常驻（继承工具箱的“辅助功能”权限），用 CGEventTap
// 拦截鼠标拇指键，合成 Cmd+Tab / Cmd+Shift+Tab 实现前后切换应用。macOS 专用。

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let child = null;          // 常驻的映射进程
let learnChild = null;     // 临时的“学习按键”进程
let lastError = '';

function workDir(getUserDataPath) {
  const dir = path.join(getUserDataPath(), 'mouse-switch');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sourceText() {
  return fs.readFileSync(path.join(__dirname, 'native', 'sideswitch.swift'), 'utf8');
}

function findSwiftc() {
  return new Promise((resolve) => {
    execFile('/usr/bin/xcrun', ['--find', 'swiftc'], (err, stdout) => {
      if (!err && stdout && stdout.trim()) return resolve(stdout.trim());
      // 兜底：常见路径
      for (const p of ['/usr/bin/swiftc']) { if (fs.existsSync(p)) return resolve(p); }
      resolve(null);
    });
  });
}

// 需要就编译，返回二进制路径；源码没变且二进制在就直接复用。
async function ensureBinary(getUserDataPath) {
  const dir = workDir(getUserDataPath);
  const src = sourceText();
  const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 16);
  const bin = path.join(dir, 'sideswitch');
  const hashFile = path.join(dir, 'sideswitch.hash');
  const cachedHash = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, 'utf8').trim() : '';
  if (fs.existsSync(bin) && cachedHash === hash) return bin;

  const swiftc = await findSwiftc();
  if (!swiftc) throw new Error('没找到 swiftc（需要 Xcode 命令行工具：xcode-select --install）');
  const srcFile = path.join(dir, 'sideswitch.swift');
  fs.writeFileSync(srcFile, src);
  await new Promise((resolve, reject) => {
    const c = spawn(swiftc, ['-O', srcFile, '-o', bin], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += d.toString(); });
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error('swiftc 编译失败：' + err.slice(0, 400)))));
  });
  fs.writeFileSync(hashFile, hash);
  return bin;
}

function stop() {
  if (child) { try { child.kill('SIGTERM'); } catch (_) {} child = null; }
}

// 启动常驻映射。back/fwd 是鼠标键号（otherMouse buttonNumber）。
async function start({ getUserDataPath }, back, fwd) {
  stop();
  lastError = '';
  const bin = await ensureBinary(getUserDataPath);
  return await new Promise((resolve) => {
    const c = spawn(bin, [String(back), String(fwd)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    const done = (res) => { if (!settled) { settled = true; resolve(res); } };
    c.stderr.on('data', (d) => {
      const s = d.toString();
      if (s.includes('READY')) { child = c; done({ ok: true }); }
      if (s.includes('ERR_NO_TAP')) { lastError = '没拿到事件 tap：请到 系统设置→隐私与安全性→辅助功能 打开「Agent 工具箱」'; done({ ok: false, error: lastError }); }
    });
    c.on('error', (e) => { lastError = e.message; done({ ok: false, error: e.message }); });
    c.on('close', () => { if (child === c) child = null; });
    setTimeout(() => done(child ? { ok: true } : { ok: false, error: lastError || '启动超时' }), 4000);
  });
}

// 学习模式：跑 --learn，捕获用户按下的第一个鼠标键号，返回它，然后退出。
async function learn({ getUserDataPath }, timeoutMs = 8000) {
  if (learnChild) { try { learnChild.kill('SIGTERM'); } catch (_) {} learnChild = null; }
  const wasRunning = Boolean(child);
  stop();  // 学习时先停常驻的，免得它把键吞了
  const bin = await ensureBinary(getUserDataPath);
  const detected = await new Promise((resolve) => {
    const c = spawn(bin, ['--learn'], { stdio: ['ignore', 'pipe', 'pipe'] });
    learnChild = c;
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; try { c.kill('SIGTERM'); } catch (_) {} learnChild = null; resolve(val); } };
    c.stdout.on('data', (d) => {
      const m = d.toString().match(/mousebutton\s+(\d+)/);
      if (m) finish(Number(m[1]));
    });
    c.on('error', () => finish(null));
    setTimeout(() => finish(null), timeoutMs);
  });
  return { button: detected, wasRunning };
}

function status() {
  return { running: Boolean(child), error: lastError };
}

function registerMouseSwitchIpc(ipcMain, { getUserDataPath }) {
  if (process.platform !== 'darwin') return;  // 仅 macOS
  ipcMain.handle('mouseSwitch:start', (_e, back, fwd) => start({ getUserDataPath }, Number(back) || 3, Number(fwd) || 4));
  ipcMain.handle('mouseSwitch:stop', () => { stop(); return { ok: true }; });
  ipcMain.handle('mouseSwitch:status', () => status());
  ipcMain.handle('mouseSwitch:learn', (_e, timeoutMs) => learn({ getUserDataPath }, Number(timeoutMs) || 8000));
}

module.exports = { registerMouseSwitchIpc, start, stop, learn, status, stopMouseSwitch: stop };
