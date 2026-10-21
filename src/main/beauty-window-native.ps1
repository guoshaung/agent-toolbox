param([ValidateSet('enumerate','describe','capture','apply','restore','clear-marker','alive')][string]$Operation,[string]$Payload)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
  $request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))|ConvertFrom-Json
  Add-Type @'
using System;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class BeautyWindowInfo {
 public string hwnd {get;set;} public uint pid {get;set;} public string started {get;set;}
 public string className {get;set;} public string processName {get;set;} public string title {get;set;}
}
public static class BeautyWindowNative {
 const string Property="AgentToolbox.Beauty.Window.v1";
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint cmd);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetProp(IntPtr h,string name,IntPtr value);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr h,string name);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr RemoveProp(IntPtr h,string name);
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,uint attr,out uint value,int size);
 [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h,uint attr,ref uint value,int size);
 static readonly HashSet<string> Blocked=new HashSet<string>(StringComparer.OrdinalIgnoreCase){"System","Idle","Registry","smss","csrss","wininit","services","lsass","svchost","winlogon","dwm","fontdrvhost","sihost","taskhostw","ShellExperienceHost","StartMenuExperienceHost","SearchHost","SearchApp","LockApp","CredentialUIBroker","consent","LogonUI"};
 public static BeautyWindowInfo Describe(IntPtr h) {
  if(!IsWindow(h))throw new Exception("WINDOW_GONE:Window closed");
  uint id;GetWindowThreadProcessId(h,out id);
  using(Process p=Process.GetProcessById((int)id)) {
   var cls=new StringBuilder(256);var title=new StringBuilder(201);GetClassName(h,cls,256);GetWindowText(h,title,201);
   string c=cls.ToString(),name=p.ProcessName;
   if(p.SessionId!=Process.GetCurrentProcess().SessionId||Blocked.Contains(name)||c=="Progman"||c=="WorkerW"||c.StartsWith("Shell_",StringComparison.OrdinalIgnoreCase)||name.Equals("explorer",StringComparison.OrdinalIgnoreCase)&&c!="CabinetWClass"&&c!="ExploreWClass")throw new Exception("WINDOW_ACCESS:Not a regular application window");
   return new BeautyWindowInfo{hwnd=h.ToInt64().ToString(),pid=id,started=p.StartTime.ToUniversalTime().Ticks.ToString(),className=c,processName=name,title=title.ToString()};
  }
 }
 public static BeautyWindowInfo[] List() {
  var result=new List<BeautyWindowInfo>();
  EnumWindows((h,l)=>{if(result.Count>=256)return false;if(!IsWindowVisible(h)||GetWindow(h,4)!=IntPtr.Zero)return true;try{var w=Describe(h);if(w.title.Length>0)result.Add(w);}catch{}return true;},IntPtr.Zero);
  return result.ToArray();
 }
 public static IntPtr Check(string hwnd,uint pid,string started,string cls,string processName) {
  long value;if(!Int64.TryParse(hwnd,out value)||value<=0)throw new Exception("WINDOW_IDENTITY:Invalid handle");
  var h=new IntPtr(value);var w=Describe(h);
  if(w.pid!=pid||w.started!=started||w.className!=cls||!w.processName.Equals(processName,StringComparison.OrdinalIgnoreCase))throw new Exception("WINDOW_IDENTITY:Window owner changed");return h;
 }
 public static long Marker(IntPtr h){return GetProp(h,Property).ToInt64();}
 public static void CheckMarker(IntPtr h,int marker){if(marker<1||Marker(h)!=marker)throw new Exception("WINDOW_MARKER:Window marker changed");}
 public static void Bind(IntPtr h,int marker,string title){if(marker<1)throw new Exception("WINDOW_MARKER:Invalid marker");if(Marker(h)!=0)throw new Exception("WINDOW_MARKER:Window already has a marker");if(Describe(h).title!=title)throw new Exception("WINDOW_IDENTITY:Window title changed; refresh the list");if(!SetProp(h,Property,new IntPtr(marker)))throw new Exception("WINDOW_ACCESS:Could not bind window marker");}
 public static void Clear(IntPtr h,int marker){long current=Marker(h);if(current==0)return;CheckMarker(h,marker);if(RemoveProp(h,Property).ToInt64()!=marker)throw new Exception("WINDOW_ACCESS:Could not remove own window marker");}
 public static uint Read(IntPtr h,uint attr){uint value;if(DwmGetWindowAttribute(h,attr,out value,4)!=0)throw new Exception("ATTRIBUTE_READ:Cannot read attribute");return value;}
 public static void Write(IntPtr h,uint attr,uint value,int marker){CheckMarker(h,marker);if(DwmSetWindowAttribute(h,attr,ref value,4)!=0||Read(h,attr)!=value)throw new Exception("ATTRIBUTE_WRITE:Window attribute failed");}
}
'@
  if($Operation -eq 'enumerate') { @{ok=$true;data=@([BeautyWindowNative]::List())}|ConvertTo-Json -Depth 8 -Compress; exit }
  if($Operation -eq 'describe') { @{ok=$true;data=[BeautyWindowNative]::Describe([IntPtr]([long]$request.hwnd))}|ConvertTo-Json -Depth 8 -Compress; exit }
  $target=$request.target
  try { $handle=[BeautyWindowNative]::Check($target.hwnd,[uint32]$target.pid,$target.started,$target.className,$target.processName) }
  catch { if($Operation -eq 'alive' -and $_.Exception.GetBaseException().Message -match '^WINDOW_(GONE|IDENTITY):') { @{ok=$true;data=$false}|ConvertTo-Json -Compress; exit }; throw }
  if($Operation -eq 'alive') { @{ok=$true;data=$true}|ConvertTo-Json -Compress; exit }
  $ranges=@{'20'=1;'33'=3;'38'=4}
  if($Operation -eq 'capture') {
    if($null -ne $request.marker) { [BeautyWindowNative]::CheckMarker($handle,[int]$request.marker) }
    $values=@{}
    if(@($request.attributes).Count -lt 1 -or @($request.attributes).Count -gt 3){throw 'ATTRIBUTE_READ:Invalid attribute list'}
    foreach($attribute in $request.attributes){$key=[string]$attribute;if(-not $ranges.ContainsKey($key)){throw 'ATTRIBUTE_READ:Unknown attribute'};$value=[BeautyWindowNative]::Read($handle,[uint32]$attribute);if($value -gt $ranges[$key]){throw 'ATTRIBUTE_READ:Unsupported original value'};$values[$key]=$value}
    @{ok=$true;data=@{values=$values;marker=[BeautyWindowNative]::Marker($handle)}}|ConvertTo-Json -Depth 8 -Compress; exit
  }
  if($request.marker -isnot [int] -and $request.marker -isnot [long]){throw 'WINDOW_MARKER:Invalid marker type'}
  if($request.marker -lt 1 -or $request.marker -gt 2147483646){throw 'WINDOW_MARKER:Invalid marker value'}
  if($Operation -eq 'clear-marker'){[BeautyWindowNative]::Clear($handle,[int]$request.marker);@{ok=$true;data=@{cleared=$true}}|ConvertTo-Json -Depth 5 -Compress;exit}
  $fields=@($request.values.PSObject.Properties)
  if($fields.Count -lt 1 -or $fields.Count -gt 3){throw 'ATTRIBUTE_WRITE:Invalid attribute values'}
  foreach($field in $fields){if(-not $ranges.ContainsKey($field.Name) -or ($field.Value -isnot [int] -and $field.Value -isnot [long]) -or $field.Value -lt 0 -or $field.Value -gt $ranges[$field.Name]){throw 'ATTRIBUTE_WRITE:Unknown attribute or invalid value'}}
  if($Operation -eq 'apply' -and $request.bind -eq $true){[BeautyWindowNative]::Bind($handle,[int]$request.marker,$target.title)}else{[BeautyWindowNative]::CheckMarker($handle,[int]$request.marker)}
  foreach($field in $fields){[BeautyWindowNative]::Write($handle,[uint32]$field.Name,[uint32]$field.Value,[int]$request.marker)}
  @{ok=$true;data=@{applied=$true}}|ConvertTo-Json -Depth 5 -Compress
} catch {
  $message=$_.Exception.GetBaseException().Message
  $code=if($message -match '^([A-Z_]+):'){$Matches[1]}else{'WINDOW_ACCESS'}
  @{ok=$false;code=$code;error=$message}|ConvertTo-Json -Depth 5 -Compress
}
