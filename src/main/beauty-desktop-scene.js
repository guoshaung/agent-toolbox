'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
class DesktopScene {
 constructor(){this.window=null;this.parent=null;}
 list(){return {running:!!this.window&&!this.window.isDestroyed(),parent:this.parent,scope:'primary-display',animation:'portrait-float-and-light'};}
 async apply(beauty,profile){const {BrowserWindow,screen}=require('electron');if(!BrowserWindow)throw Error('桌面轻动效需要在 Toolbox 应用内使用');this.close();
  const bounds=screen.getPrimaryDisplay().bounds,win=new BrowserWindow({...bounds,show:false,frame:false,focusable:false,skipTaskbar:true,resizable:false,backgroundColor:profile.tint,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'toolbox-beauty-desktop',backgroundThrottling:true}});this.window=win;
  win.setIgnoreMouseEvents(true);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  win.webContents.session.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!details.url.startsWith('file:')&&!details.url.startsWith('data:')}));
  const data={tint:profile.tint,accent:profile.accent};for(const [key,id]of [['character',profile.characterId],['background',profile.backgroundId]])if(id){if(!beauty.read().assets.some(a=>a.id===id))throw Error('桌面动效素材缺失');data[key]=pathToFileURL(beauty.assetPath(id)).href;}
  try{
   await win.loadFile(path.join(__dirname,'../beauty-desktop/index.html'),{hash:JSON.stringify(data)});
   const directory=fs.mkdtempSync(path.join(os.tmpdir(),'toolbox-desktop-scene-')),script=path.join(directory,'bridge.ps1');
   try{fs.writeFileSync(script,Buffer.concat([Buffer.from([239,187,191]),fs.readFileSync(path.join(__dirname,'beauty-desktop-native.ps1'))]));const env={...process.env};for(const k of Object.keys(env))if(k.toLowerCase()==='psmodulepath')delete env[k];const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Window',win.getNativeWindowHandle().readBigUInt64LE().toString(),'-OwnerPid',String(process.pid),'-ExpectedExe',process.execPath],{env,windowsHide:true,timeout:15000,maxBuffer:32768});this.parent=JSON.parse(stdout.trim());}
   finally{if(fs.existsSync(script))fs.unlinkSync(script);fs.rmdirSync(directory);}
   win.on('closed',()=>{if(this.window===win){this.window=null;this.parent=null;}});win.showInactive();return this.list();
  }catch(error){this.close();const message=String(error.message||'');throw Error(/DPI modes differ/.test(message)?'桌面与播放器 DPI 模式不一致，已保留静态壁纸':/compatible background layer|Desktop shell not available/.test(message)?'当前桌面没有兼容的背景层，已保留静态壁纸':'桌面轻动效连接失败，已保留静态壁纸');}
 }
 close(){if(this.window&&!this.window.isDestroyed())this.window.destroy();this.window=null;this.parent=null;return {stopped:true};}
}
module.exports={DesktopScene};
