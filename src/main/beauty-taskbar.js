'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const VERSION='2026.2',URL='https://github.com/TranslucentTB/TranslucentTB/releases/download/2026.2/TranslucentTB-portable-x64.zip',HASH='0dbe8e0255c20e131cde536dcd0ae490d45989a7d360e26d0150dff1922ac420';
// Hashes of executable inputs from the pinned, SHA256-verified official archive.
// An editable installation receipt cannot authorize a replacement executable.
const FILES={'TranslucentTB.exe':'f933f5bf70405e13feadbcc53883f2676b5a8a1dae214b52c0fe0971c583a0ff','Xaml.dll':'473cc6ed8e9a1f37dbfee0c0b4ef04de9bbe5b8872b7f75d7cb2c9e50576f13c','ProgramLog.dll':'0ac96ac53f5575369ad7b2f12ee2bd272e77438de8d041ec8aa6d4b900d2f701','resources.pri':'6b6766492e75aa80bfc802265f10d3c32ed7757be2dc9ffa96738b0e159aeb3c','ExplorerTAP.dll':'c48f1a06168acd7839269dde0d15ccf5d09c702512b94dd6ba9a05df1b153dc2','ExplorerHooks.dll':'5ab9ca00b41a0676c94430c43a5de106acef2ade5c42e6c2ee45912de7a718d6'};
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function taskbarConfig(profile){const appearance={accent:profile.effect==='solid'?'opaque':'acrylic',color:profile.tint+Math.round(profile.opacity*2.55).toString(16).padStart(2,'0'),show_peek:true,show_line:false,blur_radius:profile.blur};const c={desktop_appearance:appearance,hide_tray:false,disable_saving:true,verbosity:'warn',language:'zh-CN'};for(const k of ['visible_window_appearance','maximized_window_appearance','start_opened_appearance','search_opened_appearance','task_view_opened_appearance'])c[k]={enabled:true,...appearance};return c;}
class TaskbarStyle {
 constructor({root,fetcher=fetch,exec=promisify(execFile),spawnProcess=spawn}={}){this.root=root;this.directory=path.join(root,VERSION);this.receipt=path.join(root,'session.json');this.fetch=fetcher;this.exec=exec;this.spawn=spawnProcess;}
 exe(){return path.join(this.directory,'TranslucentTB.exe');}
 async helper(operation){const env={...process.env};for(const k of Object.keys(env))if(k.toLowerCase()==='psmodulepath')delete env[k];const temp=fs.mkdtempSync(path.join(os.tmpdir(),'toolbox-taskbar-')),script=path.join(temp,'bridge.ps1');try{fs.writeFileSync(script,Buffer.concat([Buffer.from([239,187,191]),fs.readFileSync(path.join(__dirname,'beauty-taskbar-native.ps1'))]));const {stdout}=await this.exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Operation',operation,'-Root',this.directory,'-Receipt',this.receipt],{env,windowsHide:true,timeout:25000,maxBuffer:128*1024});return JSON.parse(stdout.replace(/^\uFEFF/,'').trim());}finally{if(fs.existsSync(script))fs.unlinkSync(script);fs.rmdirSync(temp);}}
 async prepare(){if(process.platform!=='win32'||process.arch!=='x64'||Number(os.release().split('.')[2])<22000)throw Error('任务栏材质组件需要 Windows 11 x64');
  const inventory=path.join(this.directory,'toolbox-inventory.json');
  if(fs.existsSync(inventory)){for(const [file,hash]of Object.entries(FILES))if(digest(fs.readFileSync(path.join(this.directory,file)))!==hash)throw Error('任务栏组件文件校验失败，请保留现有文件并重新安装');return {installed:true,version:VERSION};}
  if(fs.existsSync(this.directory)&&fs.readdirSync(this.directory).length)throw Error('任务栏组件目录存在未完成安装，请保留目录后重试');
  fs.mkdirSync(this.root,{recursive:true});const response=await this.fetch(URL,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('任务栏组件官方下载失败：'+response.status);
  const pieces=[];let size=0;for await(const part of response.body){size+=part.length;if(size>5*1024*1024)throw Error('任务栏组件下载超出大小限制');pieces.push(part);}const bytes=Buffer.concat(pieces);if(digest(bytes)!==HASH)throw Error('任务栏组件 SHA256 与官方发行记录不符');
  const archive=path.join(this.root,'TranslucentTB-'+VERSION+'.zip');if(fs.existsSync(archive)&&digest(fs.readFileSync(archive))!==HASH)throw Error('任务栏下载缓存已改变');if(!fs.existsSync(archive))fs.writeFileSync(archive,bytes,{flag:'wx'});await this.helper('extract');return this.prepare();
 }
 async apply(profile){await this.prepare();const status=await this.helper('status');if(status.foreign)throw Error('已有其他 TranslucentTB 正在运行，已保留其配置；请先退出它再应用任务栏材质');
  const target=path.join(this.directory,'settings.json'),temporary=target+'.tmp';fs.writeFileSync(temporary,JSON.stringify(taskbarConfig(profile),null,2));fs.renameSync(temporary,target);
  if(!status.running){const child=this.spawn(this.exe(),[],{cwd:this.directory,windowsHide:true,detached:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();await new Promise(r=>setTimeout(r,1800));await this.helper('record');}
  const current=await this.helper('status');if(!current.running)throw Error('任务栏组件未保持运行，原始恢复记录已保留');if(!fs.existsSync(this.receipt))await this.helper('record');return {running:true,version:VERSION,material:profile.effect==='solid'?'opaque':'acrylic'};
 }
 async preflight(){await this.prepare();if((await this.helper('status')).foreign)throw Error('已有其他 TranslucentTB 正在运行，请先退出它；尚未修改本次电脑主题');}
 async restore(){if(!fs.existsSync(this.receipt))return {restored:true,wasRunning:false};return this.helper('stop');}
 list(){return {installed:fs.existsSync(path.join(this.directory,'toolbox-inventory.json')),session:fs.existsSync(this.receipt),version:VERSION,source:'https://github.com/TranslucentTB/TranslucentTB'};}
}
module.exports={TaskbarStyle,taskbarConfig};
