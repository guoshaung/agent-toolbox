param([Parameter(Mandatory=$true)][string]$DllPath,[Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedHash,[ValidatePattern('^([0-9]+(,[0-9]+)*)?$')][string]$SkipProcessIds='')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if ([IntPtr]::Size -ne 8) { throw 'Explorer artwork requires x64' }
if ((Get-FileHash -LiteralPath $DllPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedHash) { throw 'Component bytes changed; no window was connected' }
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class BeautyWindowAttach {
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 public static bool SameUser(IntPtr process){IntPtr token;if(!OpenProcessToken(process,8,out token))return false;try{using(var identity=new System.Security.Principal.WindowsIdentity(token)){return identity.User.Equals(System.Security.Principal.WindowsIdentity.GetCurrent().User);}}finally{CloseHandle(token);}}
 public delegate bool Visitor(IntPtr window,IntPtr parameter);
 [DllImport("user32.dll")]public static extern bool EnumWindows(Visitor visitor,IntPtr parameter);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr window,StringBuilder name,int size);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr LoadLibraryEx(string file,IntPtr reserved,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Ansi,SetLastError=true)]public static extern IntPtr GetProcAddress(IntPtr module,string name);
 [DllImport("kernel32.dll")]public static extern bool FreeLibrary(IntPtr module);
 [DllImport("user32.dll",SetLastError=true)]public static extern IntPtr SetWindowsHookEx(int kind,IntPtr callback,IntPtr module,uint thread);
 [DllImport("user32.dll",SetLastError=true)]public static extern bool UnhookWindowsHookEx(IntPtr hook);
 [DllImport("user32.dll",SetLastError=true)]public static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
}
'@
$expectedExplorer=Join-Path $env:WINDIR 'explorer.exe'
$session=[Diagnostics.Process]::GetCurrentProcess().SessionId
$processes=@{};$skip=@{}
if($SkipProcessIds){foreach($item in $SkipProcessIds.Split(',')){$skip[[uint32]$item]=$true}}
foreach($process in @([Diagnostics.Process]::GetProcessesByName('explorer'))) {
 try {
  $null=$process.Handle
  if($process.MainModule.FileName -ine $expectedExplorer -or $process.SessionId -ne $session -or -not [BeautyWindowAttach]::SameUser($process.Handle)){$process.Dispose();continue}
  $processes[[uint32]$process.Id]=$process
 }catch{$process.Dispose()}
}
$script:targets=@();$script:threads=@{};$script:folderCount=0
$visitor=[BeautyWindowAttach+Visitor]{param($window,$unused)
 $name=New-Object Text.StringBuilder 128
 $null=[BeautyWindowAttach]::GetClassName($window,$name,128)
 if($name.ToString() -ne 'CabinetWClass' -and $name.ToString() -ne 'Shell_TrayWnd'){return $true}
 [uint32]$windowProcess=0
 $thread=[BeautyWindowAttach]::GetWindowThreadProcessId($window,[ref]$windowProcess)
 if($thread -ne 0 -and $processes.ContainsKey($windowProcess) -and -not $script:threads.ContainsKey($thread)){
  if($name.ToString() -eq 'CabinetWClass'){$script:folderCount++}
  if($skip.ContainsKey($windowProcess)){return $true}
  $script:threads[$thread]=$true
  $script:targets+=@{window=$window;thread=$thread;pid=$windowProcess}
 }
 return $script:targets.Count -lt 32
}
$null=[BeautyWindowAttach]::EnumWindows($visitor,[IntPtr]::Zero)
$module=[IntPtr]::Zero;$results=@()
try {
 if($script:targets.Count -eq 0){@{targets=@();noFolderWindow=($script:folderCount -eq 0)}|ConvertTo-Json -Compress;exit}
 # Map exports without running this Explorer-only DLL inside the helper process.
 $module=[BeautyWindowAttach]::LoadLibraryEx($DllPath,[IntPtr]::Zero,1)
 if($module -eq [IntPtr]::Zero){throw ('Could not map component exports: '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}
 $callback=[BeautyWindowAttach]::GetProcAddress($module,'ToolboxBeautyAttach')
 if($callback -eq [IntPtr]::Zero){throw 'Installed component needs a loader update'}
 foreach($target in $script:targets){
  [uint32]$actualPid=0
  if($processes[$target.pid].HasExited -or [BeautyWindowAttach]::GetWindowThreadProcessId($target.window,[ref]$actualPid) -ne $target.thread -or $actualPid -ne $target.pid){continue}
  $hook=[BeautyWindowAttach]::SetWindowsHookEx(4,$callback,$module,$target.thread)
  if($hook -eq [IntPtr]::Zero){$results+=@{pid=$target.pid;connected=$false;error=[Runtime.InteropServices.Marshal]::GetLastWin32Error()};continue}
  try {
   [UIntPtr]$reply=[UIntPtr]::Zero
   $sent=[BeautyWindowAttach]::SendMessageTimeout($target.window,0x8112,[IntPtr]0xb001,[IntPtr]::Zero,3,3000,[ref]$reply)
   $results+=@{pid=$target.pid;connected=($sent -ne [IntPtr]::Zero);error=if($sent -eq [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::GetLastWin32Error()}else{0}}
  }finally{$null=[BeautyWindowAttach]::UnhookWindowsHookEx($hook)}
 }
}finally{
 if($module -ne [IntPtr]::Zero){$null=[BeautyWindowAttach]::FreeLibrary($module)}
 foreach($process in $processes.Values){$process.Dispose()}
}
@{targets=$results;noFolderWindow=($script:folderCount -eq 0)}|ConvertTo-Json -Depth 4 -Compress
