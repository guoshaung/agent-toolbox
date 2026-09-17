'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const CTRL_Q = 'CommandOrControl+Q';
const CTRL_TILDE = 'CommandOrControl+`';
// 一键退出工具箱本身。和上面两个不一样：那两个作用于「前台的别的应用」，
// 这个作用于工具箱自己，所以加 Shift 区分开，也避免误触。
const QUIT_SELF = 'CommandOrControl+Shift+Q';
const SHORTCUTS = { close: 'Ctrl+Q', cycle: 'Ctrl+~', quitSelf: 'Ctrl+Shift+Q' };
const SAFE_PROCESS_NAMES = new Set([
  'system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'services', 'lsass',
  'svchost', 'winlogon', 'dwm', 'fontdrvhost', 'sihost', 'taskhostw', 'explorer',
]);

const WINDOWS_SCRIPT = String.raw`
param([string]$Command, [string[]]$Rest)
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AppControlsWin32 {
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static List<IntPtr> Windows() { var result = new List<IntPtr>(); EnumWindows((h,l) => { if (IsWindowVisible(h) && h != GetShellWindow()) result.Add(h); return true; }, IntPtr.Zero); return result; }
  public static IntPtr Foreground() { return GetForegroundWindow(); }
  public static bool Activate(IntPtr h) { return IsWindow(h) && SetForegroundWindow(h); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, s.Capacity); return s.ToString(); }
}
'@
function EmitJson($value) { $value | ConvertTo-Json -Compress }
$own = [uint32]$env:AGENT_TOOLBOX_OWN_PID
if ($Command -eq 'foreground') { $h=[AppControlsWin32]::Foreground(); @{handle=$h.ToInt64().ToString();pid=[AppControlsWin32]::Pid($h);title=[AppControlsWin32]::Title($h)} | EmitJson; exit }
if ($Command -eq 'windows') { $items = @([AppControlsWin32]::Windows() | ForEach-Object { @{handle=$_.ToInt64().ToString();pid=[AppControlsWin32]::Pid($_);title=[AppControlsWin32]::Title($_)} }); @{windows=$items} | EmitJson; exit }
if ($Command -eq 'activate') { $ok=[AppControlsWin32]::Activate([IntPtr]::new([long]$Rest[0])); @{ok=$ok} | EmitJson; exit }
@{ok=$false;error='unknown command'} | EmitJson
`;

function runPowerShell(command, args, { exec = execFileAsync, env = process.env } = {}) {
  // PowerShell 5 的 -Command 只取第一个字符串作为命令，多余的参数会被当成独立命令
  // 解析（日志里常见的 “foreground 不是 cmdlet” 就是这么来的）。
  // 改成写临时 .ps1 再用 -File 执行，与 window-dock 同一模式；脚本含中文，需带 BOM。
  const script = path.join(os.tmpdir(), `agent-toolbox-appcontrols-${process.pid}.ps1`);
  fs.writeFileSync(script, `\uFEFF${WINDOWS_SCRIPT}`, 'utf8');
  const nextEnv = { ...env, AGENT_TOOLBOX_OWN_PID: String(process.pid) };
  return exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, command, ...(args || []).map(String)], { env: nextEnv, timeout: 5000 })
    .then(({ stdout }) => JSON.parse(String(stdout || '{}').trim() || '{}'))
    .finally(() => { try { fs.unlinkSync(script); } catch { /* 临时脚本清理失败可忽略 */ } });
}

class AppControls {
  constructor({ store, platform = process.platform, ownPid = process.pid, exec = execFileAsync, onQuitSelf } = {}) {
    this.onQuitSelf = onQuitSelf;
    this.store = store;
    this.platform = platform;
    this.ownPid = ownPid;
    this.exec = exec;
    this.cycleIndex = 0;
    this.registeredState = { registered: false, closeRegistered: false, cycleRegistered: false };
  }

  enabled() { return Boolean(this.store?.get('appControls.enabled', false)); }
  status() {
    return {
      supported: this.platform === 'win32',
      enabled: this.enabled(),
      shortcuts: SHORTCUTS,
      registered: Boolean(this.registeredState?.registered),
      quitRegistered: Boolean(this.registeredState?.quitRegistered),
      closeRegistered: Boolean(this.registeredState?.closeRegistered),
      cycleRegistered: Boolean(this.registeredState?.cycleRegistered),
    };
  }
  setEnabled(enabled) { this.store?.set('appControls.enabled', Boolean(enabled)); return this.status(); }

  async run(command, args = []) { return runPowerShell(command, args, { exec: this.exec }); }

  async closeForeground() {
    if (this.platform !== 'win32') return { ok: false, error: '快捷控制目前仅支持 Windows。' };
    const foreground = await this.run('foreground');
    const pid = Number(foreground.pid);
    if (!pid || pid === this.ownPid || !foreground.title) {
      return { ok: false, skipped: true, error: '当前窗口属于受保护应用或没有可关闭窗口，已跳过。' };
    }
    let processInfo;
    try { processInfo = await this.exec('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress)`], { timeout: 5000 }); processInfo = JSON.parse(processInfo.stdout); } catch { return { ok: false, skipped: true, error: '无法识别当前前台应用，已跳过。' }; }
    const name = String(processInfo.ProcessName || '').toLowerCase();
    if (!pid || pid === this.ownPid || SAFE_PROCESS_NAMES.has(name) || !foreground.title) return { ok: false, skipped: true, error: '当前窗口属于受保护应用或没有可关闭窗口，已跳过。' };
    // 先按 PID 连进程树一起杀（/T 覆盖它拉起的子进程，比如各种渲染进程）。
    try {
      await this.exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 5000 });
    } catch (error) { return { ok: false, error: error.message }; }

    // 再按映像名扫一遍同名的残留。
    // 光按 PID 杀不干净：很多应用的更新器、后台服务、托盘进程并不挂在前台窗口
    // 那棵树下面，杀完主进程它们还在，表现就是「叉掉了但还在后台」。
    let sweptExtra = 0;
    if (name) {
      try {
        const image = `${name}.exe`;
        const before = await this.exec('powershell.exe', ['-NoProfile', '-Command',
          `@(Get-Process -Name '${name}' -ErrorAction SilentlyContinue).Count`], { timeout: 5000 });
        sweptExtra = Number(String(before.stdout).trim()) || 0;
        if (sweptExtra > 0) {
          await this.exec('taskkill.exe', ['/IM', image, '/T', '/F'], { timeout: 5000 });
        }
      } catch { /* 没有残留，或者已经被上一步带走了 */ }
    }
    return { ok: true, pid, name, sweptExtra };
  }

  async cycleWindows() {
    if (this.platform !== 'win32') return { ok: false, error: '快捷控制目前仅支持 Windows。' };
    const foreground = await this.run('foreground');
    const list = await this.run('windows');
    const pid = Number(foreground.pid);
    const windows = (list.windows || []).filter((item) => Number(item.pid) === pid && item.title && Number(item.pid) !== this.ownPid);
    if (windows.length < 2) return { ok: false, skipped: true, error: '当前应用没有可循环的多个窗口。' };
    const current = windows.findIndex((item) => item.handle === foreground.handle);
    this.cycleIndex = (current >= 0 ? current : this.cycleIndex) + 1;
    const target = windows[this.cycleIndex % windows.length];
    const result = await this.run('activate', [target.handle]);
    return result.ok ? { ok: true, window: target } : { ok: false, error: '无法切换到下一个窗口。' };
  }

  register(globalShortcut) {
    globalShortcut.unregister(CTRL_Q); globalShortcut.unregister(CTRL_TILDE); globalShortcut.unregister(QUIT_SELF);

    // 一键退出工具箱本身：不分平台、也不受「快捷控制」开关影响。
    // 它只关掉自己，不动别的应用，没有需要用户先确认的风险。
    const quitRegistered = this.onQuitSelf
      ? globalShortcut.register(QUIT_SELF, () => this.onQuitSelf())
      : false;

    // 下面两个会作用到**别的应用**（关掉前台窗口、循环别人的窗口），
    // 属于要用户明确打开才生效的能力，且只有 Windows 实现。
    if (this.platform !== 'win32' || !this.enabled()) {
      this.registeredState = { registered: false, closeRegistered: false, cycleRegistered: false, quitRegistered };
      return this.status();
    }
    const closeRegistered = globalShortcut.register(CTRL_Q, () => this.closeForeground());
    const cycleRegistered = globalShortcut.register(CTRL_TILDE, () => this.cycleWindows());
    this.registeredState = { registered: closeRegistered && cycleRegistered, closeRegistered, cycleRegistered, quitRegistered };
    return this.status();
  }
}

module.exports = { AppControls, CTRL_Q, CTRL_TILDE, QUIT_SELF, SHORTCUTS, SAFE_PROCESS_NAMES, WINDOWS_SCRIPT };
