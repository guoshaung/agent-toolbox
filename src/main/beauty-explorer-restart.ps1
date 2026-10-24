$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# This helper is reached only through the explicit restart button. It never kills other apps.
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class BeautyRestartWindows {
  public delegate bool Visitor(IntPtr hwnd, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Visitor visitor, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder value, int count);
}
'@
$expected = [IO.Path]::GetFullPath((Join-Path $env:WINDIR 'explorer.exe'))
$session = [Diagnostics.Process]::GetCurrentProcess().SessionId
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$targets = @()
foreach ($candidate in @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'")) {
  if ($candidate.SessionId -ne $session -or $candidate.ExecutablePath -ine $expected) { continue }
  $owner = Invoke-CimMethod -InputObject $candidate -MethodName GetOwnerSid
  if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $sid) { continue }
  $process = [Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId)
  # Acquire a handle before checking identity, so PID reuse cannot select another process.
  $null = $process.Handle
  if ($process.MainModule.FileName -ine $expected -or $process.SessionId -ne $session) { $process.Dispose(); continue }
  $targets += $process
}
if (-not $targets.Count) { throw '没有找到当前用户的资源管理器，未重启任何进程' }
$script:copyWindow = $false
$targetIds = @($targets | ForEach-Object { $_.Id })
$visitor = [BeautyRestartWindows+Visitor]{ param($window, $unused)
  [uint32]$windowProcessId = 0
  $null = [BeautyRestartWindows]::GetWindowThreadProcessId($window, [ref]$windowProcessId)
  if ($targetIds -contains [int]$windowProcessId -and [BeautyRestartWindows]::IsWindowVisible($window)) {
    $name = New-Object Text.StringBuilder 128
    $null = [BeautyRestartWindows]::GetClassName($window, $name, 128)
    if ($name.ToString() -eq 'OperationStatusWindow') { $script:copyWindow = $true }
  }
  return $true
}
$null = [BeautyRestartWindows]::EnumWindows($visitor, [IntPtr]::Zero)
if ($script:copyWindow) { foreach ($process in $targets) { $process.Dispose() }; throw '检测到文件操作窗口，请先完成复制或移动再重启' }
try {
  foreach ($process in $targets) { if (-not $process.HasExited) { $process.Kill(); $null = $process.WaitForExit(5000) } }
} finally { foreach ($process in $targets) { $process.Dispose() } }
# Windows normally restarts its shell automatically. Only launch it if that did not happen.
$running = $false
for ($attempt = 0; $attempt -lt 16; $attempt++) {
  Start-Sleep -Milliseconds 500
  $running = @([Diagnostics.Process]::GetProcessesByName('explorer') | Where-Object { $_.SessionId -eq $session -and $_.MainModule.FileName -ieq $expected }).Count -gt 0
  if ($running) { break }
}
if (-not $running) { Start-Process -FilePath $expected -WindowStyle Hidden; Start-Sleep -Seconds 2 }
@{ restarted = $true; stoppedProcesses = $targets.Count; foldersMayHaveClosed = $true } | ConvertTo-Json -Compress
