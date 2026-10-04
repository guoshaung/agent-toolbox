'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const CTRL_Q = 'Alt+Q';
const CTRL_TILDE = 'Alt+`';
const ALT_TAB = 'Alt+Tab';
// 一键退出工具箱本身。和上面两个不一样：那两个作用于「前台的别的应用」，
// 这个作用于工具箱自己，所以加 Shift 区分开，也避免误触。
const QUIT_SELF = 'CommandOrControl+Shift+Q';
const SHORTCUTS = { close: 'Alt+Q', cycle: 'Alt+~', altTab: 'Alt+Tab', quitSelf: 'Ctrl+Shift+Q' };
const SAFE_PROCESS_NAMES = new Set([
  'system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'services', 'lsass',
  'svchost', 'winlogon', 'dwm', 'fontdrvhost', 'sihost', 'taskhostw', 'explorer',
]);

// RegisterHotKey 无法接管 Windows 保留的 Alt+Tab，所以只在用户打开该功能时
// 启动一个 WH_KEYBOARD_LL 钩子。钩子只拦 Alt+Tab / Alt+Shift+Tab / Alt+Esc，
// 其余按键原样交给系统；进程结束时 Windows 会自动移除钩子。
const ALT_TAB_HOOK_SCRIPT = String.raw`
param([int]$OwnPid)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing @'
using System;
using System.Text;
using System.IO;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
using System.Drawing.Imaging;
public static class ToolboxAltTabHook {
  const int WH_KEYBOARD_LL=13, WM_KEYDOWN=0x100, WM_KEYUP=0x101, WM_SYSKEYDOWN=0x104, WM_SYSKEYUP=0x105;
  const int VK_TAB=0x09, VK_ESCAPE=0x1B, VK_SPACE=0x20, VK_MENU=0x12, VK_LMENU=0xA4, VK_RMENU=0xA5, VK_SHIFT=0x10;
  const int GWL_EXSTYLE=-20, WS_EX_TOOLWINDOW=0x80, WS_EX_APPWINDOW=0x40000, DWMWA_CLOAKED=14, SW_RESTORE=9;
  delegate IntPtr HookProc(int code,IntPtr w,IntPtr l); delegate bool EnumProc(IntPtr h,IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct Kbd { public uint vk,scan,flags,time; public IntPtr extra; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id,HookProc cb,IntPtr mod,uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h,int code,IntPtr w,IntPtr l);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb,IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint command);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern long GetWindowLongPtr(IntPtr h,int index);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process,int flags,StringBuilder path,ref int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint id,uint msg,IntPtr w,IntPtr l);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int attr,out int value,int size);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h,int cmd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from,uint to,bool attach);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h,bool altTab);
  [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=false)] static extern void SHCreateItemFromParsingName(string path,IntPtr bindCtx,[MarshalAs(UnmanagedType.LPStruct)]Guid riid,[MarshalAs(UnmanagedType.Interface)]out IShellItemImageFactory factory);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx,cy; public SIZE(int x,int y){cx=x;cy=y;} }
  [Flags] enum SIIGBF { BIGGERSIZEOK=1, ICONONLY=4 }
  [ComImport,InterfaceType(ComInterfaceType.InterfaceIsIUnknown),Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
  interface IShellItemImageFactory { void GetImage(SIZE size,SIIGBF flags,out IntPtr bitmap); }
  static HookProc callback; static IntPtr hook; static bool tabDown; static volatile bool switching; static int ownPid; static uint mainThread; static System.Threading.Timer releaseTimer; static readonly object stateGate=new object();
  static Dictionary<string,string> iconCache=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
  static string B64(string s){return Convert.ToBase64String(Encoding.UTF8.GetBytes(s??""));}
  static string ProcessPath(Process p){
    try{return p.MainModule.FileName;}catch{}
    IntPtr handle=IntPtr.Zero;try{handle=OpenProcess(0x1000,false,p.Id);if(handle==IntPtr.Zero)return "";var value=new StringBuilder(32768);int size=value.Capacity;return QueryFullProcessImageName(handle,0,value,ref size)?value.ToString():"";}catch{return "";}finally{if(handle!=IntPtr.Zero)CloseHandle(handle);}
  }
  static string Snapshot(){
    var rows=new List<string>();
    EnumWindows((h,l)=>{ try {
      if(!IsWindowVisible(h))return true;long style=GetWindowLongPtr(h,GWL_EXSTYLE);bool appWindow=(style&WS_EX_APPWINDOW)!=0;
      if((style&WS_EX_TOOLWINDOW)!=0&&!appWindow)return true;
      if(GetWindow(h,4)!=IntPtr.Zero&&!appWindow)return true;
      int cloaked=0;if(DwmGetWindowAttribute(h,DWMWA_CLOAKED,out cloaked,4)==0&&cloaked!=0)return true;
      uint pid;GetWindowThreadProcessId(h,out pid);if(pid==0||pid==ownPid)return true;
      var p=Process.GetProcessById((int)pid);string file=ProcessPath(p);
      rows.Add(h.ToInt64()+","+pid+","+B64(p.ProcessName)+","+B64(file));
    }catch{} return true;},IntPtr.Zero);
    return String.Join(";",rows);
  }
  static void Emit(string value){Console.WriteLine(value);Console.Out.Flush();}
  static string JumboIcon(string file){
    if(String.IsNullOrWhiteSpace(file)||!File.Exists(file))return "";string cached;if(iconCache.TryGetValue(file,out cached))return cached;
    IntPtr bitmap=IntPtr.Zero;try{IShellItemImageFactory factory;SHCreateItemFromParsingName(file,IntPtr.Zero,new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"),out factory);factory.GetImage(new SIZE(256,256),SIIGBF.ICONONLY|SIIGBF.BIGGERSIZEOK,out bitmap);using(var image=Image.FromHbitmap(bitmap))using(var stream=new MemoryStream()){image.Save(stream,ImageFormat.Png);cached=Convert.ToBase64String(stream.ToArray());iconCache[file]=cached;return cached;}}catch{return "";}finally{if(bitmap!=IntPtr.Zero)DeleteObject(bitmap);}
  }
  static bool Activate(IntPtr h){
    IntPtr foreground=GetForegroundWindow();uint ignored;uint foregroundThread=GetWindowThreadProcessId(foreground,out ignored);uint targetThread=GetWindowThreadProcessId(h,out ignored);uint current=GetCurrentThreadId();
    bool attachedForeground=false,attachedTarget=false;try{if(foregroundThread!=0&&foregroundThread!=current)attachedForeground=AttachThreadInput(current,foregroundThread,true);if(targetThread!=0&&targetThread!=current)attachedTarget=AttachThreadInput(current,targetThread,true);if(IsIconic(h))ShowWindowAsync(h,SW_RESTORE);BringWindowToTop(h);bool ok=SetForegroundWindow(h);SetFocus(h);if(!ok&&GetForegroundWindow()!=h){SwitchToThisWindow(h,true);Thread.Sleep(18);ok=SetForegroundWindow(h);}return ok||GetForegroundWindow()==h;}finally{if(attachedTarget)AttachThreadInput(current,targetThread,false);if(attachedForeground)AttachThreadInput(current,foregroundThread,false);}
  }
  static void FinishSwitch(string result){lock(stateGate){if(!switching)return;tabDown=false;switching=false;Emit(result);}}
  static string CycleSameApp(){
    IntPtr foreground=GetForegroundWindow();uint pid;GetWindowThreadProcessId(foreground,out pid);if(pid==0||pid==ownPid)return "0\t0";
    var windows=new List<IntPtr>();EnumWindows((h,l)=>{try{if(IsWindowVisible(h)){uint candidate;GetWindowThreadProcessId(h,out candidate);if(candidate==pid)windows.Add(h);}}catch{}return true;},IntPtr.Zero);
    if(windows.Count<2)return "0\t0";int current=windows.IndexOf(foreground);IntPtr target=windows[(current<0?0:current+1)%windows.Count];return (Activate(target)?"1":"0")+"\t"+target.ToInt64();
  }
  static IntPtr OnKey(int code,IntPtr w,IntPtr l){
    if(code>=0){var k=(Kbd)Marshal.PtrToStructure(l,typeof(Kbd));int msg=w.ToInt32();bool down=msg==WM_KEYDOWN||msg==WM_SYSKEYDOWN;bool up=msg==WM_KEYUP||msg==WM_SYSKEYUP;
      bool alt=(GetAsyncKeyState(VK_MENU)&0x8000)!=0;
      bool altKey=k.vk==VK_MENU||k.vk==VK_LMENU||k.vk==VK_RMENU;
      // 只拦截 Tab，不拦截、不伪造任何修饰键。Alt-down / Alt-up 会完整成对
      // 到达系统，从根上避免 Alt 卡住、Delete 失效和快捷键重复触发。
      if(k.vk==VK_TAB&&(alt||tabDown)){if(down&&!tabDown){tabDown=true;switching=true;bool reverse=(GetAsyncKeyState(VK_SHIFT)&0x8000)!=0;Emit("TAB\t"+(reverse?"1":"0")+"\t"+GetForegroundWindow().ToInt64()+"\t"+Snapshot());}else if(down&&tabDown){bool reverse=(GetAsyncKeyState(VK_SHIFT)&0x8000)!=0;Emit("TAB\t"+(reverse?"1":"0")+"\t\t");}if(up)tabDown=false;return (IntPtr)1;}
      if(k.vk==VK_ESCAPE&&alt&&down&&switching){FinishSwitch("CANCEL");return (IntPtr)1;}
      // 极少数键盘/输入法会让 Alt-up 没有正常抵达钩子。切换条还在时，
      // Space 是明确的确认键；down/up 都吞掉，避免空格落进原应用。
      if(k.vk==VK_SPACE&&switching){if(down)FinishSwitch("COMMIT");return (IntPtr)1;}
      if(altKey&&up&&switching)FinishSwitch("COMMIT");
    }
    return CallNextHookEx(hook,code,w,l);
  }
  static void Reader(){string line;while((line=Console.ReadLine())!=null){if(line.StartsWith("ACTIVATE\t")){long value;if(Int64.TryParse(line.Substring(9),out value))Emit("ACTIVATED\t"+(Activate((IntPtr)value)?"1":"0")+"\t"+value);}else if(line=="CYCLE"){Emit("CYCLED\t"+CycleSameApp());}else if(line.StartsWith("ICONS\t")){var rows=new List<string>();foreach(var encoded in line.Substring(6).Split(',')){try{string file=Encoding.UTF8.GetString(Convert.FromBase64String(encoded));string png=JumboIcon(file);rows.Add(encoded+","+png);}catch{rows.Add(encoded+",");}}Emit("ICONS\t"+String.Join(";",rows));}else if(line=="RESET"){tabDown=false;switching=false;}else if(line=="STOP"){PostThreadMessage(mainThread,0x0012,IntPtr.Zero,IntPtr.Zero);break;}}}
  public static void Run(int pid){ownPid=pid;mainThread=GetCurrentThreadId();callback=OnKey;hook=SetWindowsHookEx(WH_KEYBOARD_LL,callback,GetModuleHandle(null),0);if(hook==IntPtr.Zero){Emit("ERROR\t无法安装键盘钩子");return;}new Thread(Reader){IsBackground=true}.Start();releaseTimer=new System.Threading.Timer(_=>{if(switching&&(GetAsyncKeyState(VK_MENU)&0x8000)==0)FinishSwitch("COMMIT");},null,30,30);Emit("READY");Emit("PRELOAD\t"+Snapshot());Application.Run();releaseTimer.Dispose();UnhookWindowsHookEx(hook);}
}
'@
[ToolboxAltTabHook]::Run($OwnPid)
`;

const ALT_TAB_OVERLAY_HTML = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:"Segoe UI",sans-serif;color:#fff;user-select:none}
#panel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:18px 22px 30px;border:1px solid rgba(255,255,255,.22);border-radius:26px;background:rgba(24,27,36,.78);backdrop-filter:blur(24px) saturate(150%);box-shadow:0 24px 80px rgba(0,0,0,.48)}
#items{display:flex;align-items:center;justify-content:center;gap:var(--gap,10px);width:100%;height:100%;overflow:hidden;padding:8px}.item{flex:1 1 0;min-width:0;max-width:156px;height:var(--tile-height,132px);border-radius:calc(var(--icon-size,76px)*.27);display:flex;flex-direction:column;gap:7px;align-items:center;justify-content:center;border:2px solid transparent;cursor:pointer;transition:transform .18s cubic-bezier(.2,.85,.2,1),background .18s,box-shadow .18s,border-color .18s;background:rgba(255,255,255,.04)}
.item.selected{border-color:#8db1ff;background:linear-gradient(145deg,rgba(118,158,255,.32),rgba(92,112,195,.18));transform:translateY(-3px) scale(1.06);box-shadow:0 14px 34px rgba(30,70,180,.38),0 0 26px rgba(91,140,255,.3)}img,.fallback{width:var(--icon-size,76px);height:var(--icon-size,76px);object-fit:contain;border-radius:24%;filter:drop-shadow(0 8px 12px rgba(0,0,0,.3));clip-path:inset(0 round 24%)}img{background:rgba(255,255,255,.055)}.fallback{display:grid;place-items:center;background:linear-gradient(145deg,#54637d,#293345);color:#dce7ff}.fallback svg{width:56%;height:56%}.name{width:94%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;color:rgba(255,255,255,.88);font-size:var(--label-size,12px);font-weight:600}#counter{position:absolute;bottom:10px;color:rgba(255,255,255,.58);font:11px/1 "Segoe UI",sans-serif;letter-spacing:.6px}
</style><div id="panel"><div id="items"></div><div id="counter"></div></div><script>
window.render=(items,selected)=>{const host=document.getElementById('items');const count=Math.max(1,items.length);const usable=Math.max(120,host.clientWidth-16-(count-1)*10);const slot=usable/count;const icon=Math.max(28,Math.min(94,slot-24));host.style.setProperty('--icon-size',icon+'px');host.style.setProperty('--tile-height',Math.max(72,Math.min(142,icon+48))+'px');host.style.setProperty('--gap',(count>16?4:count>10?7:10)+'px');host.style.setProperty('--label-size',(count>16?9:count>10?10:12)+'px');const counter=document.getElementById('counter');const signal=(action,value)=>{document.title='toolbox:'+action+':'+value+':'+Date.now();};const select=(index,notify)=>{host.querySelectorAll('.item').forEach((node,i)=>node.classList.toggle('selected',i===index));counter.textContent=(index+1)+' / '+items.length;if(notify)signal('hover',index);};counter.textContent=(selected+1)+' / '+items.length;host.replaceChildren(...items.map((x,i)=>{const el=document.createElement('div');el.className='item'+(i===selected?' selected':'');el.title=x.name||'应用';let media;if(x.icon){media=Object.assign(document.createElement('img'),{src:x.icon,alt:x.name||''});}else{media=Object.assign(document.createElement('div'),{className:'fallback'});media.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/></svg>';}const label=Object.assign(document.createElement('div'),{className:'name',textContent:x.name||'系统窗口'});el.append(media,label);el.addEventListener('mouseenter',()=>select(i,true));el.addEventListener('click',()=>{select(i,false);signal('activate',x.handle);});return el;}));};
</script>`;

// 0.21.6: tile the switcher into a compact grid instead of a wheel/strip.
const ALT_TAB_OVERLAY_HTML_TILED = ALT_TAB_OVERLAY_HTML
  .replace('width: 900, height: 276', 'width: 900, height: 276')
  .replace('#items{display:flex;align-items:center;justify-content:safe center;gap:18px;width:100%;overflow-x:auto;padding:12px;scroll-behavior:smooth;scrollbar-width:none}', '#items{display:flex;flex-flow:row nowrap;align-items:center;justify-content:center;gap:12px;width:100%;height:100%;overflow:hidden;padding:4px}')
  .replace('.item{flex:0 0 142px;width:142px;height:142px;border-radius:22px;display:flex;align-items:center;justify-content:center;', '.item{flex:0 0 104px;width:104px;height:112px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;')
  .replace('img,.fallback{width:86px;height:86px;', 'img,.fallback{width:48px;height:48px;')
  .replace('padding:28px 48px 38px', 'padding:12px 16px 18px')
  .replace('background:rgba(20,22,28,.90)', 'background:rgba(24,28,38,.52);backdrop-filter:blur(18px) saturate(145%)')
  .replace('border:1px solid rgba(255,255,255,.2)', 'border:1px solid rgba(255,255,255,.24)')
  .replace('gap:12px;width:100%;height:100%', 'gap:7px;width:100%;height:100%')
  .replace('width:104px;height:112px', 'width:96px;height:96px')
  .replace('width:48px;height:48px', 'width:42px;height:42px')
  .replace('font-size:11px', 'font-size:10px')
  .replace('img,.fallback{width:48px;height:48px;', 'img,.fallback{width:clamp(30px,calc(540px / var(--count,5)),42px);height:clamp(30px,calc(540px / var(--count,5)),42px);border-radius:14px;')
  .replace('width:96px;height:96px', 'width:clamp(58px,calc(620px / var(--count,5)),96px);height:clamp(76px,calc(760px / var(--count,5)),96px)')
  .replace('window.render=(items,selected)=>{const host=document.getElementById(\"items\");', 'window.render=(items,selected)=>{const host=document.getElementById(\"items\");host.style.setProperty(\"--count\",items.length);')
  .replace("el.append(media);return el;", "const label=Object.assign(document.createElement('div'),{className:'name',textContent:x.name||'应用'});el.append(media,label);return el;")
  .replace("requestAnimationFrame(()=>host.querySelector('.selected')?.scrollIntoView({block:'nearest',inline:'center'}));", "")
  .replace('</style><div id="panel">', '.item .name{max-width:126px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:rgba(255,255,255,.8)}#items::-webkit-scrollbar{display:none}</style><div id="panel">');

// 0.21.7: pointer proximity gives the tiled switcher a responsive, physical feel.
const ALT_TAB_OVERLAY_HTML_DYNAMIC = ALT_TAB_OVERLAY_HTML_TILED
  .replace('</style>', '.item{transform-style:preserve-3d;will-change:transform,box-shadow;transition:transform .16s cubic-bezier(.2,.8,.2,1),box-shadow .16s,background .16s}.item::after{content:"";position:absolute;inset:0;border-radius:inherit;opacity:0;background:radial-gradient(circle at var(--mx,50%) var(--my,50%),rgba(255,255,255,.28),transparent 55%);pointer-events:none;transition:opacity .16s}.item:hover{transform:translateY(-6px) scale(1.08) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));box-shadow:0 12px 30px rgba(70,130,255,.34),0 0 0 1px rgba(170,205,255,.65)}.item:hover::after{opacity:1}#items{perspective:900px}</style>')
  .replace('</script>`;', 'const host=document.getElementById("items");host.addEventListener("mousemove",(event)=>{const item=event.target.closest(".item");if(!item)return;const r=item.getBoundingClientRect();const x=(event.clientX-r.left)/r.width;const y=(event.clientY-r.top)/r.height;item.style.setProperty("--mx",`${x*100}%`);item.style.setProperty("--my",`${y*100}%`);item.style.setProperty("--rx",`${(0.5-y)*10}deg`);item.style.setProperty("--ry",`${(x-0.5)*10}deg`);});host.addEventListener("mouseleave",()=>host.querySelectorAll(".item").forEach((item)=>{item.style.removeProperty("--rx");item.style.removeProperty("--ry");}));</script>`;');

const WINDOWS_SCRIPT = String.raw`
param([string]$Command, [string[]]$Rest)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
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
function EmitJson {
  param([Parameter(ValueFromPipeline = $true)]$value)
  process { $value | ConvertTo-Json -Compress }
}
$own = [uint32]$env:AGENT_TOOLBOX_OWN_PID
if ($Command -eq 'foreground') { $h=[AppControlsWin32]::Foreground(); @{handle=$h.ToInt64().ToString();pid=[AppControlsWin32]::Pid($h);title=[AppControlsWin32]::Title($h)} | EmitJson; exit }
if ($Command -eq 'windows') { $items = @([AppControlsWin32]::Windows() | ForEach-Object { @{handle=$_.ToInt64().ToString();pid=[AppControlsWin32]::Pid($_);title=[AppControlsWin32]::Title($_)} }); @{windows=$items} | EmitJson; exit }
if ($Command -eq 'snapshot') { $h=[AppControlsWin32]::Foreground(); $items = @([AppControlsWin32]::Windows() | ForEach-Object { @{handle=$_.ToInt64().ToString();pid=[AppControlsWin32]::Pid($_);title=[AppControlsWin32]::Title($_)} }); @{foreground=@{handle=$h.ToInt64().ToString();pid=[AppControlsWin32]::Pid($h);title=[AppControlsWin32]::Title($h)};windows=$items} | EmitJson; exit }
if ($Command -eq 'activate') { $ok=[AppControlsWin32]::Activate([IntPtr]::new([long]$Rest[0])); @{ok=$ok} | EmitJson; exit }
@{ok=$false;error='unknown command'} | EmitJson
`;

function runPowerShell(command, args, { exec = execFileAsync, env = process.env } = {}) {
  // PowerShell 5 的 -Command 只取第一个字符串作为命令，多余的参数会被当成独立命令
  // 解析（日志里常见的 “foreground 不是 cmdlet” 就是这么来的）。
  // 改成写临时 .ps1 再用 -File 执行，与 window-dock 同一模式；脚本含中文，需带 BOM。
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-appcontrols-'));
  const script = path.join(directory, 'probe.ps1');
  fs.writeFileSync(script, `\uFEFF${WINDOWS_SCRIPT}`, 'utf8');
  const nextEnv = { ...env, AGENT_TOOLBOX_OWN_PID: String(process.pid) };
  return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, command, ...(args || []).map(String)], { env: nextEnv, timeout: 15000, windowsHide: true })
    .then(({ stdout }) => { if (!String(stdout).trim()) throw new Error('窗口探测没有返回结果。'); return JSON.parse(stdout); })
    // execFile 超时杀掉进程后只给一句 "Command failed"、stderr 是空的，看日志根本猜不到是超时。
    // 第一次跑 Add-Type 要编译一段 C#，冷机器上不止 5 秒（CI 的 Windows 机器实测 5034ms 被杀）。
    .catch((error) => {
      if (error?.killed || error?.signal === 'SIGTERM') throw new Error('窗口探测超时：PowerShell 首次加载要编译一段代码，机器慢的话得等几秒，再试一次。');
      const detail = String(error?.stderr || '').trim();
      throw new Error(detail ? `窗口探测失败：${detail.split('\n')[0]}` : (error?.message || '窗口探测失败'));
    })
    .finally(() => { try { fs.unlinkSync(script); fs.rmdirSync(directory); } catch { /* already removed */ } });
}

class AppControls {
  constructor({ store, platform = process.platform, ownPid = process.pid, exec = execFileAsync, spawnProcess = spawn, app, BrowserWindow, screen, onQuitSelf, onResult } = {}) {
    this.onQuitSelf = onQuitSelf;
    this.onResult = onResult;
    this.store = store;
    this.platform = platform;
    this.ownPid = ownPid;
    this.exec = exec;
    this.spawnProcess = spawnProcess;
    this.app = app;
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.cycleIndex = 0;
    this.altTabProcess = null;
    this.altTabOverlay = null;
    this.altTabItems = [];
    this.altTabIndex = 0;
    this.altTabIconCache = new Map();
    this.altTabIconPending = new Set();
    this.altTabKnownItems = [];
    this.altTabFailsafeTimer = null;
    this.altTabBuffer = '';
    this.altTabHookState = 'stopped';
    this.registeredState = { registered: false, closeRegistered: false, cycleRegistered: false, altTabRegistered: false };
  }

  enabled() { return Boolean(this.store?.get('appControls.enabled', false)); }
  altTabEnabled() { return Boolean(this.store?.get('appControls.altTabEnabled', false)); }
  status() {
    const conflicts = [];
    if (this.enabled() && !this.registeredState?.closeRegistered) conflicts.push({ action: '强制关闭当前应用', shortcut: SHORTCUTS.close });
    if (this.enabled() && !this.registeredState?.cycleRegistered) conflicts.push({ action: '循环同应用窗口', shortcut: SHORTCUTS.cycle });
    if (this.altTabEnabled() && !this.registeredState?.altTabRegistered) conflicts.push({ action: '大图标应用切换器', shortcut: SHORTCUTS.altTab });
    return {
      supported: this.platform === 'win32',
      enabled: this.enabled(),
      altTabEnabled: this.altTabEnabled(),
      altTabHookState: this.altTabHookState,
      shortcuts: SHORTCUTS,
      registered: Boolean(this.registeredState?.registered),
      quitRegistered: Boolean(this.registeredState?.quitRegistered),
      closeRegistered: Boolean(this.registeredState?.closeRegistered),
      cycleRegistered: Boolean(this.registeredState?.cycleRegistered),
      altTabRegistered: Boolean(this.registeredState?.altTabRegistered),
      conflicts,
    };
  }
  setEnabled(enabled) { this.store?.set('appControls.enabled', Boolean(enabled)); return this.status(); }
  setAltTabEnabled(enabled) {
    this.store?.set('appControls.altTabEnabled', Boolean(enabled));
    return this.status();
  }

  ensureAltTabOverlay() {
    if (this.altTabOverlay && !this.altTabOverlay.isDestroyed()) return this.altTabOverlay;
    if (!this.BrowserWindow) return null;
    this.altTabOverlay = new this.BrowserWindow({
      width: 900, height: 200, show: false, frame: false, transparent: true, resizable: false,
      movable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, hasShadow: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    this.altTabOverlay.setAlwaysOnTop(true, 'screen-saver');
    this.altTabOverlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.altTabOverlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(ALT_TAB_OVERLAY_HTML)}`);
    this.altTabOverlay.webContents.on('page-title-updated', (event, title) => {
      const match = String(title || '').match(/^toolbox:(hover|activate):(\d+):/);
      if (!match) return;
      event.preventDefault();
      if (match[1] === 'hover') {
        const index = Number(match[2]);
        if (Number.isInteger(index) && index >= 0 && index < this.altTabItems.length) this.altTabIndex = index;
        return;
      }
      const index = this.altTabItems.findIndex((item) => item.handle === match[2]);
      if (index >= 0) this.altTabIndex = index;
      this.commitAltTab(false);
    });
    this.altTabOverlay.webContents.on('did-navigate-in-page', (_event, url) => {
      let hash = '';
      try { hash = decodeURIComponent(String(url).split('#').pop() || ''); } catch { return; }
      const hover = hash.match(/^hover=(\d+)/);
      if (hover) {
        const index = Number(hover[1]);
        if (Number.isInteger(index) && index >= 0 && index < this.altTabItems.length) this.altTabIndex = index;
        return;
      }
      const activate = hash.match(/^activate=(\d+)/);
      if (activate) {
        const index = this.altTabItems.findIndex((item) => item.handle === activate[1]);
        if (index >= 0) this.altTabIndex = index;
        this.commitAltTab(false);
      }
    });
    this.altTabOverlay.on('closed', () => { this.altTabOverlay = null; });
    return this.altTabOverlay;
  }

  parseHookItems(serialized) {
    const decode = (value) => { try { return Buffer.from(value || '', 'base64').toString('utf8'); } catch { return ''; } };
    return String(serialized || '').split(';').filter(Boolean).map((row) => {
      const [handle, pid, name, executable] = row.split(',');
      return { handle, pid: Number(pid), name: decode(name), executable: decode(executable) };
    }).filter((item) => item.handle && Number.isSafeInteger(item.pid));
  }

  renderAltTabOverlay() {
    const overlay = this.altTabOverlay;
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
    overlay.webContents.executeJavaScript(`window.render(${JSON.stringify(this.altTabItems)},${this.altTabIndex})`).catch(() => {});
  }

  requestJumboIcons(items) {
    const missing = [];
    for (const item of items) {
      const key = String(item.executable || '').toLowerCase();
      if (!key) continue;
      if (this.altTabIconCache.has(key)) item.icon = this.altTabIconCache.get(key);
      else if (!this.altTabIconPending.has(key)) missing.push(item.executable);
    }
    if (missing.length && this.altTabProcess?.stdin?.writable) {
      // Shell 的 256px PNG 体积不小，分批取图标，避免一次 stdout 行过大拖慢键盘钩子。
      const batch = [...new Set(missing)].slice(0, 8);
      for (const file of batch) this.altTabIconPending.add(String(file).toLowerCase());
      const encoded = batch.map((file) => Buffer.from(file, 'utf8').toString('base64'));
      this.altTabProcess.stdin.write(`ICONS\t${encoded.join(',')}\n`);
    }
  }

  async hydrateNativeIcons(items) {
    if (!this.app?.getFileIcon) return;
    await Promise.all(items.map(async (item) => {
      const key = String(item.executable || '').toLowerCase();
      if (!key) return;
      if (this.altTabIconCache.has(key)) { item.icon = this.altTabIconCache.get(key) || ''; return; }
      try {
        const image = await this.app.getFileIcon(item.executable, { size: 'large' });
        const dataUrl = image && !image.isEmpty() ? image.toDataURL() : '';
        if (dataUrl) { this.altTabIconCache.set(key, dataUrl); item.icon = dataUrl; }
      } catch { /* Shell 取不到时继续走 PowerShell 的 256px 备用提取 */ }
    }));
  }

  async preloadAltTabIcons(items) {
    // Shell 能给出更清晰的 256px 图标，先让它分批预热；Electron 原生接口
    // 只为权限受限或特殊应用补漏，避免把低分辨率图标提前写进缓存。
    this.requestJumboIcons(items);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await this.hydrateNativeIcons(items);
  }

  async showAltTab(reverse, foreground, serialized) {
    clearTimeout(this.altTabFailsafeTimer);
    this.altTabFailsafeTimer = setTimeout(() => this.commitAltTab(true), 15000);
    this.altTabFailsafeTimer.unref?.();
    const overlayWasVisible = Boolean(this.altTabOverlay?.isVisible());
    const raw = this.parseHookItems(serialized);
    if (!raw.length && !overlayWasVisible) return;
    if (!raw.length && overlayWasVisible) {
      const items = this.altTabItems;
      if (!items.length || !this.altTabProcess) return;
      this.altTabIndex = (this.altTabIndex + (reverse ? -1 : 1) + items.length) % items.length;
      this.renderAltTabOverlay();
      return;
    }
    // 保留 Windows 返回的实际窗口顺序，不按可执行文件合并；
    // 同一个应用的多个页面/窗口也必须能逐个切换。
    // 键盘钩子的 Snapshot 传回的是进程名 name（不读取窗口内容），不是 title。
    // 这里曾检查不存在的 item.title，导致所有候选都被过滤，Alt+Tab 被接管后却没有任何界面。
    const seenApps = new Set();
    const items = raw.filter((item) => {
      if (!item.name || Number(item.pid) === this.ownPid) return false;
      const key = String(item.executable || item.name).toLowerCase();
      if (seenApps.has(key)) return false;
      seenApps.add(key);
      return true;
    });
    if (!items.length || !this.altTabProcess) return;
    const current = Math.max(0, items.findIndex((item) => item.handle === foreground));
    if (!this.altTabOverlay?.isVisible()) this.altTabIndex = (current + (reverse ? -1 : 1) + items.length) % items.length;
    else this.altTabIndex = (this.altTabIndex + (reverse ? -1 : 1) + items.length) % items.length;
    await this.hydrateNativeIcons(items);
    this.altTabItems = items;
    this.altTabKnownItems = items;
    if (!overlayWasVisible) this.requestJumboIcons(items);
    const overlay = this.ensureAltTabOverlay();
    if (!overlay) return;
    const display = this.screen?.getDisplayNearestPoint?.(this.screen.getCursorScreenPoint()) || this.screen?.getPrimaryDisplay?.();
    const area = display?.workArea || { x: 0, y: 0, width: 1280, height: 720 };
    const maxWidth = Math.max(420, area.width - 48);
    const naturalSlot = items.length <= 4 ? 156 : items.length <= 8 ? 142 : items.length <= 12 ? 118 : 92;
    const width = Math.min(maxWidth, Math.max(360, items.length * naturalSlot + 56));
    const slot = (width - 56) / Math.max(1, items.length);
    const icon = Math.max(28, Math.min(94, slot - 24));
    const height = Math.round(Math.max(122, Math.min(206, icon + 104)));
    overlay.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height });
    overlay.showInactive();
    const draw = () => overlay.webContents.executeJavaScript(`window.render(${JSON.stringify(items)},${this.altTabIndex})`).catch(() => {});
    if (overlay.webContents.isLoading()) overlay.webContents.once('did-finish-load', draw); else draw();
  }

  commitAltTab(cancel = false) {
    clearTimeout(this.altTabFailsafeTimer);
    this.altTabFailsafeTimer = null;
    if (!cancel) {
      const target = this.altTabItems[this.altTabIndex];
      if (target && this.altTabProcess?.stdin?.writable) this.altTabProcess.stdin.write(`ACTIVATE\t${target.handle}\n`);
    }
    if (this.altTabProcess?.stdin?.writable) this.altTabProcess.stdin.write('RESET\n');
    this.altTabOverlay?.hide();
    this.altTabItems = [];
  }

  handleAltTabOutput(chunk) {
    this.altTabBuffer += String(chunk);
    const lines = this.altTabBuffer.split(/\r?\n/); this.altTabBuffer = lines.pop() || '';
    for (const line of lines) {
      if (line === 'READY') { this.altTabHookState = 'running'; this.registeredState.altTabRegistered = true; this.registeredState.registered = !this.enabled() || (this.registeredState.closeRegistered && this.registeredState.cycleRegistered); this.onResult?.({ action: 'status', ...this.status() }); continue; }
      if (line.startsWith('ERROR\t')) { this.altTabHookState = 'error'; this.registeredState.altTabRegistered = false; this.registeredState.registered = false; this.onResult?.({ action: 'status', ...this.status(), error: line.slice(6) }); continue; }
      if (line === 'COMMIT') { this.commitAltTab(false); continue; }
      if (line === 'CANCEL') { this.commitAltTab(true); continue; }
      if (line.startsWith('ICONS\t')) {
        for (const row of line.slice(6).split(';').filter(Boolean)) {
          const comma = row.indexOf(','); if (comma < 0) continue;
          try { const file = Buffer.from(row.slice(0, comma), 'base64').toString('utf8'); const key = file.toLowerCase(); const png = row.slice(comma + 1); this.altTabIconPending.delete(key); this.altTabIconCache.set(key, png ? `data:image/png;base64,${png}` : ''); } catch { /* ignore malformed icon */ }
        }
        for (const item of this.altTabItems) item.icon = this.altTabIconCache.get(String(item.executable || '').toLowerCase()) || item.icon;
        this.renderAltTabOverlay();
        this.requestJumboIcons(this.altTabKnownItems);
        continue;
      }
      if (line.startsWith('ACTIVATED\t')) {
        const [, ok] = line.split('\t');
        if (ok !== '1') this.onResult?.({ ok: false, action: 'altTab', error: '目标应用没有获得前台焦点，请再试一次。' });
        continue;
      }
      if (line.startsWith('CYCLED\t')) {
        const [, ok] = line.split('\t');
        this.onResult?.(ok === '1'
          ? { ok: true, action: 'cycle' }
          : { ok: false, skipped: true, action: 'cycle', error: '当前应用没有可循环的多个窗口。' });
        continue;
      }
      if (line.startsWith('PRELOAD\t')) { this.altTabKnownItems = this.parseHookItems(line.slice(8)); this.preloadAltTabIcons(this.altTabKnownItems).catch(() => this.requestJumboIcons(this.altTabKnownItems)); continue; }
      if (line.startsWith('TAB\t')) { const [, reverse, foreground, serialized] = line.split('\t'); this.showAltTab(reverse === '1', foreground, serialized).catch((error) => this.onResult?.({ ok: false, action: 'altTab', error: error.message })); }
    }
  }

  startAltTabHook() {
    if (this.platform !== 'win32' || this.altTabProcess) return Boolean(this.altTabProcess);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-alttab-'));
    const script = path.join(directory, 'hook.ps1');
    fs.writeFileSync(script, `\uFEFF${ALT_TAB_HOOK_SCRIPT}`, 'utf8');
    this.altTabHookState = 'starting';
    try {
      const child = this.spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, String(this.ownPid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.altTabProcess = child;
      this.registeredState.altTabRegistered = true;
      child.stdout.on('data', (chunk) => this.handleAltTabOutput(chunk));
      child.stderr.on('data', (chunk) => console.warn('[alt-tab]', String(chunk).trim()));
      child.once('error', (error) => { this.altTabHookState = 'error'; this.registeredState.altTabRegistered = false; this.registeredState.registered = false; this.onResult?.({ action: 'status', ...this.status(), error: error.message }); });
      child.once('exit', () => { this.altTabProcess = null; this.altTabHookState = 'stopped'; this.registeredState.altTabRegistered = false; if (this.altTabEnabled()) this.registeredState.registered = false; this.altTabOverlay?.hide(); try { fs.rmSync(directory, { recursive: true, force: true }); } catch {} });
      return true;
    } catch (error) {
      this.altTabHookState = 'error'; this.registeredState.altTabRegistered = false;
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
      return false;
    }
  }

  stopAltTabHook() {
    clearTimeout(this.altTabFailsafeTimer);
    this.altTabFailsafeTimer = null;
    const child = this.altTabProcess; this.altTabProcess = null;
    if (child) { try { child.stdin.write('STOP\n'); } catch {} setTimeout(() => { try { if (!child.killed) child.kill(); } catch {} }, 500).unref?.(); }
    this.altTabHookState = 'stopped'; this.registeredState.altTabRegistered = false;
    if (this.altTabOverlay && !this.altTabOverlay.isDestroyed()) this.altTabOverlay.destroy();
    this.altTabOverlay = null; this.altTabItems = []; this.altTabKnownItems = []; this.altTabIconPending.clear();
  }

  dispose() { this.stopAltTabHook(); }

  async run(command, args = []) { return runPowerShell(command, args, { exec: this.exec }); }

  async closeForeground() {
    if (this.platform !== 'win32') return { ok: false, error: '快捷控制目前仅支持 Windows。' };
    const foreground = await this.run('foreground');
    const pid = Number(foreground.pid);
    if (!Number.isSafeInteger(pid) || pid <= 4 || pid === this.ownPid) {
      return { ok: false, skipped: true, error: '当前窗口属于受保护应用或没有可关闭窗口，已跳过。' };
    }
    let processInfo;
    try { processInfo = await this.exec('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress)`], { timeout: 5000 }); processInfo = JSON.parse(processInfo.stdout); } catch { return { ok: false, skipped: true, error: '无法识别当前前台应用，已跳过。' }; }
    const name = String(processInfo.ProcessName || '').toLowerCase();
    if (!pid || pid === this.ownPid || SAFE_PROCESS_NAMES.has(name)) return { ok: false, skipped: true, error: '当前窗口属于受保护应用或没有可关闭窗口，已跳过。' };
    // 先按 PID 连进程树一起杀（/T 覆盖它拉起的子进程，比如各种渲染进程）。
    try {
      await this.exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 5000 });
    } catch (error) {
      // QQ 等以管理员权限运行时，普通 taskkill 会返回 Access Denied。
      // 通过系统提权重试，避免全局快捷键看起来像“没有反应”。
      try {
        const args = `/PID ${pid} /T /F`;
        await this.exec('powershell.exe', [
          '-NoProfile', '-Command',
          `$ErrorActionPreference = 'Stop'; $quitProcess = Start-Process -FilePath "$env:SystemRoot\\System32\\taskkill.exe" -ArgumentList '${args}' -Verb RunAs -Wait -PassThru; exit $quitProcess.ExitCode`,
        ], { timeout: 15000, windowsHide: true });
      } catch (elevatedError) {
        return { ok: false, error: elevatedError.message || error.message };
      }
    }

    // 再按映像名扫一遍同名的残留。
    // 光按 PID 杀不干净：很多应用的更新器、后台服务、托盘进程并不挂在前台窗口
    // 那棵树下面，杀完主进程它们还在，表现就是「叉掉了但还在后台」。
    let sweptExtra = 0;
    if (name) {
      try {
        const image = `${name}.exe`;
        const before = await this.exec('powershell.exe', ['-NoProfile', '-Command',
          `@(Get-Process -Name '${name.replaceAll("'", "''")}' -ErrorAction SilentlyContinue).Count`], { timeout: 5000, windowsHide: true });
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
    if (this.altTabProcess?.stdin?.writable && this.altTabHookState === 'running') {
      this.altTabProcess.stdin.write('CYCLE\n');
      return { ok: true, pending: true };
    }
    const snapshot = await this.run('snapshot');
    const foreground = snapshot.foreground;
    const list = snapshot;
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
    if (this.platform !== 'win32') {
      this.stopAltTabHook();
      this.registeredState = { registered: false, closeRegistered: false, cycleRegistered: false, altTabRegistered: false, quitRegistered };
      return this.status();
    }
    const closeRegistered = this.enabled() && globalShortcut.register(CTRL_Q, () => {
      if(this.closing) return;
      this.closing = true;
      return this.closeForeground()
        .then((result) => this.onResult?.({...result, action:'close'}))
        .catch((error) => this.onResult?.({ ok: false, error: error.message }))
        .finally(() => { this.closing = false; });
    });
    const cycleRegistered = this.enabled() && globalShortcut.register(CTRL_TILDE, () => {
      return this.cycleWindows()
        .then((result) => { if (!result?.pending) this.onResult?.({...result, action:'cycle'}); })
        .catch((error) => this.onResult?.({ ok: false, error: error.message }));
    });
    const altTabRegistered = this.altTabEnabled() ? this.startAltTabHook() : (this.stopAltTabHook(), false);
    const registered = (this.enabled() || this.altTabEnabled()) && (!this.enabled() || (closeRegistered && cycleRegistered)) && (!this.altTabEnabled() || altTabRegistered);
    this.registeredState = { registered, closeRegistered, cycleRegistered, altTabRegistered, quitRegistered };
    return this.status();
  }
}

module.exports = { AppControls, CTRL_Q, CTRL_TILDE, ALT_TAB, QUIT_SELF, SHORTCUTS, SAFE_PROCESS_NAMES, WINDOWS_SCRIPT, ALT_TAB_HOOK_SCRIPT };
