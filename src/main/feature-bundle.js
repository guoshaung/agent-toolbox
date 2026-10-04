'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const LIMITS=Object.freeze({files:100,fileBytes:2*1024*1024,totalBytes:10*1024*1024});
function segment(value){return typeof value==='string'&&value.length>0&&value.length<=120&&Buffer.from(value,'utf8').toString('utf8')===value&&!/[\x00-\x1f\x7f<>:"|?*\\/]/u.test(value)&&!/[. ]$/u.test(value)&&value!=='.'&&value!=='..'&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value);}
function validateBundle(payload){
 if(!payload||payload.copyOnly!==true||!Array.isArray(payload.files)||!payload.files.length||payload.files.length>LIMITS.files)throw Error('多文件副本需copyOnly=true且有1–100个文件。');
 const names=new Set();let total=0;
 const files=payload.files.map(file=>{
  if(!file||typeof file.path!=='string'||file.path.length>500||!file.path.split('/').every(segment))throw Error('文件路径须为有效相对路径，禁止绝对路径、遍历和保留名称。');
  const key=file.path.normalize('NFC').toLowerCase();if(names.has(key))throw Error('文件路径重复（不区分大小写及NFC表示）。');names.add(key);
  if(typeof file.base64!=='string'||file.base64.length>Math.ceil(LIMITS.fileBytes/3)*4||file.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))throw Error('文件Base64格式或大小无效。');
  const data=Buffer.from(file.base64,'base64');if(data.toString('base64')!==file.base64||data.length>LIMITS.fileBytes)throw Error('文件Base64不是规范编码或超过2MiB。');total+=data.length;if(total>LIMITS.totalBytes)throw Error('文件总大小超过10MiB。');
  const sha256=crypto.createHash('sha256').update(data).digest('hex');if(typeof file.sha256!=='string'||file.sha256!==sha256)throw Error('文件SHA-256不匹配，未创建目录。');return{path:file.path,data,sha256};
 });
 for(const name of names){const parts=name.split('/');for(let i=1;i<parts.length;i++)if(names.has(parts.slice(0,i).join('/')))throw Error('文件路径与目录路径冲突。');}
 return{files,total};
}
function writeNewBundle(target,payload,{writeFile=fs.writeFileSync}={}){
 let created=false,destination=null;
 try{
  const bundle=validateBundle(payload);if(typeof target!=='string'||!path.isAbsolute(target))throw Error('目标需为保存对话框返回的绝对路径。');
  const requested=path.resolve(target),name=path.basename(requested);if(!segment(name))throw Error('新目录名称不合法。');
  const parent=fs.realpathSync(path.dirname(requested));if(!fs.statSync(parent).isDirectory())throw Error('父目录无效。');destination=path.join(parent,name);
  fs.mkdirSync(destination,{mode:0o700});created=true;
  for(const file of bundle.files){
   const parts=file.path.split('/');let dir=destination;
   for(const piece of parts.slice(0,-1)){dir=path.join(dir,piece);try{fs.mkdirSync(dir,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('副本目录结构不合法。');}
   const output=path.resolve(destination,...parts);const relative=path.relative(destination,output);if(!relative||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw Error('文件路径超出新目录。');
   writeFile(output,file.data,{flag:'wx',mode:0o600});
  }
  return{ok:true,path:destination,count:bundle.files.length,size:bundle.total,manifest:bundle.files.map(f=>({path:f.path,size:f.data.length,sha256:f.sha256}))};
 }catch(error){
  if(created&&destination){try{const stat=fs.lstatSync(destination);if(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.realpathSync(destination)===destination)fs.rmSync(destination,{recursive:true,force:false});else return{ok:false,error:'写入失败，暂存目录状态改变，未自动删除；请手动核对新目录。',partialPath:destination};}catch(cleanup){if(cleanup.code!=='ENOENT')return{ok:false,error:'写入失败，清理新目录未完成，请手动核对。',partialPath:destination};}}
  return{ok:false,error:error.code==='EEXIST'?'副本不能写入已有文件或目录，请选择一个新目录名。':`副本写入失败：${error.message}`};
 }
}
function registerBundleIpc(ipcMain,{dialog,getWindow,getDownloads}){
 ipcMain.handle('files:exportBundle',async(_event,payload)=>{
  try{validateBundle(payload);}catch(error){return{ok:false,error:error.message};}
  const name=segment(payload.defaultName)?payload.defaultName:'文件恢复副本';
  const result=await dialog.showSaveDialog(getWindow(),{title:'创建新的副本目录（不能覆盖已有目录）',defaultPath:path.join(getDownloads(),name),buttonLabel:'创建副本目录'});
  if(result.canceled||!result.filePath)return{ok:false,canceled:true};return writeNewBundle(result.filePath,payload);
 });
}
module.exports={LIMITS,validateBundle,writeNewBundle,registerBundleIpc};
