'use strict';
const fs=require('node:fs'),path=require('node:path');
const {listFeatures,validFeatureId}=require('./feature-catalog');
const MAX_PAYLOAD_BYTES=65536,MAX_MODULE_BYTES=262144;
function contained(base,target){const relative=path.relative(base,target);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
/** Bundled trusted host modules only; renderer never supplies code or a filesystem path. */
function loadHost(base,id){
 if(!validFeatureId(id))throw Error('功能编号无效。');
 if(!listFeatures(base).features.some(f=>f.id===id))throw Error('功能没有有效的已安装描述。');
 const realBase=fs.realpathSync(base),folder=path.join(base,id),file=path.join(folder,'host.cjs');
 const folderStat=fs.lstatSync(folder),fileStat=fs.lstatSync(file);
 if(folderStat.isSymbolicLink()||!folderStat.isDirectory()||fileStat.isSymbolicLink()||!fileStat.isFile()||fileStat.size>MAX_MODULE_BYTES)throw Error('功能后端文件无效。');
 if(!contained(realBase,fs.realpathSync(folder))||!contained(fs.realpathSync(folder),fs.realpathSync(file)))throw Error('功能后端超出已安装目录。');
 const host=require(file);if(!host||typeof host.invoke!=='function'||typeof host.cancel!=='function')throw Error('功能后端接口无效。');return host;
}
function validatePayload(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('后端请求须JSON对象。');
 let count=0;const visiting=new Set();function walk(value,depth){if(depth>12||++count>5000)throw Error('后端请求结构超限。');if(value===null||typeof value==='boolean'||typeof value==='string')return;if(typeof value==='number'&&Number.isFinite(value))return;if(typeof value!=='object'||visiting.has(value)||(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))throw Error('后端请求只接受有限JSON。');visiting.add(value);for(const item of Object.values(value))walk(item,depth+1);visiting.delete(value);}walk(payload,0);
 if(Buffer.byteLength(JSON.stringify(payload),'utf8')>MAX_PAYLOAD_BYTES)throw Error('后端请求超过64KiB。');return payload;
}
function senderContext(event){const sender=event?.sender;if(!sender||!Number.isSafeInteger(sender.id)||sender.id<1||typeof sender.getURL!=='function'||sender.isDestroyed?.())throw Error('调用窗口无效。');if(!sender.getURL().startsWith('file:'))throw Error('只有本地应用窗口可调用功能后端。');if(event.senderFrame&&sender.mainFrame&&event.senderFrame!==sender.mainFrame)throw Error('只有应用顶层窗口可调用功能后端。');return{senderId:sender.id};}
function registerHostIpc(ipcMain,{featureRoot}){
 const seen=new Map();
 const hostFor=(event,id)=>{const context=senderContext(event),host=loadHost(featureRoot,id);let entry=seen.get(context.senderId);if(!entry){entry={hosts:new Set()};seen.set(context.senderId,entry);event.sender.once?.('destroyed',()=>{for(const item of entry.hosts){try{item.disposeSender?.(context.senderId);}catch{/* disposed sender must not crash the app */}}seen.delete(context.senderId);});}entry.hosts.add(host);return{host,context};};
 ipcMain.handle('features:hostCall',async(event,id,operation,payload)=>{try{if(typeof operation!=='string'||!/^[_a-z][_a-z0-9]{0,39}$/.test(operation))throw Error('操作编号无效。');validatePayload(payload);const{host,context}=hostFor(event,id);return await host.invoke(operation,payload,context);}catch{throw Error('功能后端请求被拒绝或失败；没有自动重试。');}});
 ipcMain.handle('features:hostCancel',async(event,id,jobId)=>{try{if(typeof jobId!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(jobId))throw Error('任务编号无效。');const{host,context}=hostFor(event,id);return await host.cancel(jobId,context);}catch{throw Error('功能后端取消请求失败。');}});
}
module.exports={MAX_PAYLOAD_BYTES,MAX_MODULE_BYTES,loadHost,validatePayload,senderContext,registerHostIpc};
