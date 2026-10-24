param([ValidatePattern('^[1-9][0-9]{0,18}$')][string]$Window,[uint32]$OwnerPid,[string]$ExpectedExe)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type @'
using System;using System.Text;using System.Diagnostics;using System.Runtime.InteropServices;
public static class BeautyDesktopLayer {
 public delegate bool Visitor(IntPtr h,IntPtr parameter);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr FindWindow(string cls,string title);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
 [DllImport("user32.dll")]public static extern bool EnumWindows(Visitor visitor,IntPtr parameter);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]public static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
 [DllImport("user32.dll",SetLastError=true)]public static extern IntPtr SetParent(IntPtr child,IntPtr parent);
 [DllImport("user32.dll")]public static extern IntPtr GetParent(IntPtr child);
 [DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr insert,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")]public static extern int GetSystemMetrics(int index);
 [DllImport("user32.dll")]public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
 [DllImport("user32.dll")]public static extern bool AreDpiAwarenessContextsEqual(IntPtr a,IntPtr b);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]public static extern IntPtr GetWindowLongPtr(IntPtr h,int index);
 [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")]public static extern IntPtr SetWindowLongPtr(IntPtr h,int index,IntPtr value);
 public static bool ShellOwned(IntPtr h,string exe,int session){uint pid;GetWindowThreadProcessId(h,out pid);try{using(var p=Process.GetProcessById((int)pid)){return p.SessionId==session&&String.Equals(p.MainModule.FileName,exe,StringComparison.OrdinalIgnoreCase);}}catch{return false;}}
}
'@
$child=[IntPtr]([long]$Window);[uint32]$childPid=0;$null=[BeautyDesktopLayer]::GetWindowThreadProcessId($child,[ref]$childPid)
$owner=[Diagnostics.Process]::GetProcessById([int]$OwnerPid);$null=$owner.Handle
if($childPid -ne $OwnerPid -or $owner.MainModule.FileName -ine $ExpectedExe -or $owner.SessionId -ne [Diagnostics.Process]::GetCurrentProcess().SessionId){throw 'Refused non-owned wallpaper window'}
$shellExe=Join-Path $env:WINDIR 'explorer.exe';$session=$owner.SessionId
$progman=[BeautyDesktopLayer]::FindWindow('Progman',$null)
if($progman -ne [IntPtr]::Zero -and [BeautyDesktopLayer]::ShellOwned($progman,$shellExe,$session)){[UIntPtr]$reply=[UIntPtr]::Zero;$null=[BeautyDesktopLayer]::SendMessageTimeout($progman,0x052c,[IntPtr]::Zero,[IntPtr]::Zero,2,1000,[ref]$reply)}
$script:layer=[IntPtr]::Zero
$visitor=[BeautyDesktopLayer+Visitor]{param($h,$unused)
 $view=[BeautyDesktopLayer]::FindWindowEx($h,[IntPtr]::Zero,'SHELLDLL_DefView',$null)
 if($view -ne [IntPtr]::Zero){$candidate=[BeautyDesktopLayer]::FindWindowEx([IntPtr]::Zero,$h,'WorkerW',$null);if($candidate -ne [IntPtr]::Zero -and [BeautyDesktopLayer]::ShellOwned($candidate,$shellExe,$session)){$script:layer=$candidate;return $false}}
 return $true
}
$null=[BeautyDesktopLayer]::EnumWindows($visitor,[IntPtr]::Zero)
if($script:layer -eq [IntPtr]::Zero -and $progman -ne [IntPtr]::Zero){$candidate=[BeautyDesktopLayer]::FindWindowEx($progman,[IntPtr]::Zero,'WorkerW',$null);if($candidate -ne [IntPtr]::Zero -and [BeautyDesktopLayer]::FindWindowEx($candidate,[IntPtr]::Zero,'SHELLDLL_DefView',$null) -eq [IntPtr]::Zero){$script:layer=$candidate}}
if($script:layer -eq [IntPtr]::Zero -or -not [BeautyDesktopLayer]::ShellOwned($script:layer,$shellExe,$session)){throw 'This Windows desktop layout does not expose a compatible background layer'}
if(-not [BeautyDesktopLayer]::AreDpiAwarenessContextsEqual([BeautyDesktopLayer]::GetWindowDpiAwarenessContext($child),[BeautyDesktopLayer]::GetWindowDpiAwarenessContext($script:layer))){throw 'Desktop and player DPI modes differ; kept the static wallpaper'}
$style=[BeautyDesktopLayer]::GetWindowLongPtr($child,-16).ToInt64();$style=($style -band -2147483649L) -bor 0x40000000L
$null=[BeautyDesktopLayer]::SetWindowLongPtr($child,-16,[IntPtr]$style)
$null=[BeautyDesktopLayer]::SetParent($child,$script:layer)
if([BeautyDesktopLayer]::GetParent($child) -ne $script:layer){throw 'Windows refused background attachment; no desktop settings changed'}
$width=[BeautyDesktopLayer]::GetSystemMetrics(0);$height=[BeautyDesktopLayer]::GetSystemMetrics(1)
if(-not [BeautyDesktopLayer]::SetWindowPos($child,[IntPtr]::Zero,0,0,$width,$height,0x14)){throw 'Could not size owned wallpaper window'}
@{attached=$true;parent=$script:layer.ToInt64().ToString();primaryDisplay=$true}|ConvertTo-Json -Compress
