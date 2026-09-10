'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const CTRL_Q = 'CommandOrControl+Q';
const CTRL_TILDE = 'CommandOrControl+`';
const SHORTCUTS = { close: 'Ctrl+Q', cycle: 'Ctrl+~' };
const SAFE_PROCESS_NAMES = new Set([
  'system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'services', 'lsass',
  'svchost', 'winlogon', 'dwm', 'fontdrvhost', 'sihost', 'taskhostw', 'explorer',
]);

const WINDOWS_SCRIPT = String.raw`
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
function Out($value) { $value | ConvertTo-Json -Compress }
$own = [uint32]$env:AGENT_TOOLBOX_OWN_PID
if ($Command -eq 'foreground') { $h=[AppControlsWin32]::Foreground(); @{handle=$h.ToInt64().ToString();pid=[AppControlsWin32]::Pid($h);title=[AppControlsWin32]::Title($h)} | Out; exit }
if ($Command -eq 'windows') { $items = @([AppControlsWin32]::Windows() | ForEach-Object { @{handle=$_.ToInt64().ToString();pid=[AppControlsWin32]::Pid($_);title=[AppControlsWin32]::Title($_)} }); @{windows=$items} | Out; exit }
if ($Command -eq 'activate') { $ok=[AppControlsWin32]::Activate([IntPtr]::new([long]$Rest[0])); @{ok=$ok} | Out; exit }
@{ok=$false;error='unknown command'} | Out
`;

function runPowerShell(command, args, { exec = execFileAsync, env = process.env } = {}) {
  const nextEnv = { ...env, AGENT_TOOLBOX_OWN_PID: String(process.pid) };
  return exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT, command, ...(args || []).map(String)], { env: nextEnv, timeout: 5000 })
    .then(({ stdout }) => JSON.parse(String(stdout || '{}').trim() || '{}'));
}

class AppControls {
  constructor({ store, platform = process.platform, ownPid = process.pid, exec = execFileAsync } = {}) {
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
    try {
      await this.exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 5000 });
      return { ok: true, pid, name };
    } catch (error) { return { ok: false, error: error.message }; }
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
    globalShortcut.unregister(CTRL_Q); globalShortcut.unregister(CTRL_TILDE);
    if (this.platform !== 'win32' || !this.enabled()) {
      this.registeredState = { registered: false, closeRegistered: false, cycleRegistered: false };
      return this.status();
    }
    const closeRegistered = globalShortcut.register(CTRL_Q, () => this.closeForeground());
    const cycleRegistered = globalShortcut.register(CTRL_TILDE, () => this.cycleWindows());
    this.registeredState = { registered: closeRegistered && cycleRegistered, closeRegistered, cycleRegistered };
    return this.status();
  }
}

module.exports = { AppControls, CTRL_Q, CTRL_TILDE, SAFE_PROCESS_NAMES, WINDOWS_SCRIPT };
