'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const LIMITS=Object.freeze({entries:10000,links:1000,depth:32,hops:40,reportBytes:4194304,senders:32,jobs:128,deadlineMs:30000});
const key=p=>process.platform==='win32'?p.toLowerCase():p;
const within=(root,p)=>{const r=path.relative(root,p);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
function input(payload,keys){if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!keys.includes(k)))throw Error('请求字段无效。');}
function check(hooks){if(hooks.signal?.aborted)throw Object.assign(Error('已取消，未生成部分巡检报告。'),{name:'AbortError'});if(Date.now()>hooks.deadline)throw Error('巡检超过30秒期限，未生成部分报告。');}
function safePath(p){if(typeof p!=='string'||p.length>4096||/[\x00-\x1f\x7f]/u.test(p))throw Error('路径过长或含不可显示控制字符。');return p;}
async function resolveTarget(root,start,hooks={}){
 let candidate=path.resolve(start),hops=0;const seen=new Set(),chain=[];check(hooks);
 while(true){
  if(!within(root,candidate))return{status:'outside',resolvedPath:candidate,chain,reason:'outside_selected_root_not_inspected'};
  const rel=path.relative(root,candidate),parts=rel?rel.split(path.sep):[];let current=root,restart=false,last=null;
  for(let i=0;i<parts.length;i++){
   check(hooks);current=path.join(current,parts[i]);let stat;
   try{stat=await fs.lstat(current);}catch(e){return{status:e.code==='ENOENT'||e.code==='ENOTDIR'?'broken':'unknown',resolvedPath:current,chain,errorCode:String(e.code||'UNKNOWN')};}
   if(stat.isSymbolicLink()){
    const identity=key(current)+'|'+parts.slice(i+1).join(path.sep);if(seen.has(identity))return{status:'loop',loopKind:'symlink_chain',resolvedPath:current,chain,reason:'repeated_link_and_remaining_suffix'};seen.add(identity);
    if(++hops>LIMITS.hops)return{status:'unknown',resolvedPath:current,chain,reason:'link_hop_limit_not_proven_loop'};
    let target;try{target=safePath(await fs.readlink(current));}catch(e){return{status:'unknown',resolvedPath:current,chain,errorCode:String(e.code||'INVALID_LINK_TARGET')};}
    chain.push({link:current,target});candidate=path.resolve(path.dirname(current),target,...parts.slice(i+1));restart=true;break;
   }
   if(i<parts.length-1&&!stat.isDirectory())return{status:'broken',resolvedPath:current,chain,errorCode:'ENOTDIR'};last=stat;
  }
  if(restart)continue;
  if(!last){try{last=await fs.lstat(root);}catch(e){return{status:'unknown',resolvedPath:root,chain,errorCode:String(e.code||'UNKNOWN')};}}
  return{status:last.isDirectory()?'valid_directory':last.isFile()?'valid_file':'valid_other',resolvedPath:candidate,chain};
 }
}
function graphCycles(directories,links){
 const graph=new Map();const add=(a,b)=>{a=key(a);b=key(b);if(!graph.has(a))graph.set(a,new Set());graph.get(a).add(b);};
 for(const d of directories)if(d.parent)add(d.parent,d.path);
 for(const l of links)if(l.resolution.status==='valid_directory')add(path.dirname(l.absolutePath),l.resolution.resolvedPath);
 function reachable(from,to){const pending=[key(from)],seen=new Set(),target=key(to);while(pending.length){const p=pending.pop();if(p===target)return true;if(seen.has(p))continue;seen.add(p);for(const child of graph.get(p)||[])pending.push(child);}return false;}
 for(const l of links)if(l.resolution.status==='valid_directory'&&reachable(l.resolution.resolvedPath,path.dirname(l.absolutePath)))Object.assign(l.resolution,{status:'loop',loopKind:'directory_graph',reason:'directory_edges_and_link_edges_form_cycle_without_traversing_links'});
}
async function scanRoot(root,hooks={}){
 root=safePath(path.resolve(root));hooks={...hooks,deadline:hooks.deadline??Date.now()+LIMITS.deadlineMs};check(hooks);
 const first=await fs.lstat(root);if(first.isSymbolicLink()||!first.isDirectory()||key(await fs.realpath(root))!==key(root))throw Error('所选根必须保持实际普通目录，不接受链接根或已改变路径。');
 const links=[],errors=[],directories=[{path:root,parent:null}],pending=[{dir:root,depth:0}];let entries=0,files=0,other=0;
 while(pending.length){
  check(hooks);const {dir,depth}=pending.pop();if(depth>LIMITS.depth)throw Error('普通目录深度超过32，整份拒绝。');
  const dirStat=await fs.lstat(dir);if(dirStat.isSymbolicLink()||!dirStat.isDirectory()||!within(root,await fs.realpath(dir)))throw Error('扫描期间目录身份/边界改变，整份拒绝。');
  let handle;try{handle=await fs.opendir(dir);}catch(e){errors.push({path:path.relative(root,dir)||'.',operation:'opendir',errorCode:String(e.code||'UNKNOWN')});continue;}
  try{for await(const item of handle){
   check(hooks);if(++entries>LIMITS.entries)throw Error('条目超过10000，整份拒绝。');const abs=safePath(path.join(dir,item.name)),relative=path.relative(root,abs);let stat;
   try{stat=await fs.lstat(abs);}catch(e){errors.push({path:relative,operation:'lstat',errorCode:String(e.code||'UNKNOWN')});continue;}
   if(stat.isSymbolicLink()){
    if(links.length>=LIMITS.links)throw Error('链接超过1000，整份拒绝。');let target;try{target=safePath(await fs.readlink(abs));}catch(e){links.push({path:relative,absolutePath:abs,target:null,resolution:{status:'unknown',errorCode:String(e.code||'INVALID_LINK_TARGET')}});continue;}
    const candidate=path.resolve(dir,target);links.push({path:relative,absolutePath:abs,target,resolution:await resolveTarget(root,candidate,hooks)});
   }else if(stat.isDirectory()){directories.push({path:abs,parent:dir});pending.push({dir:abs,depth:depth+1});}else if(stat.isFile())files++;else other++;
   if(entries%32===0)await(hooks.yieldControl||(()=>new Promise(r=>setImmediate(r))))();
  }}catch(e){if(e.name==='AbortError'||!e.code)throw e;errors.push({path:path.relative(root,dir)||'.',operation:'read_directory',errorCode:String(e.code)});}
 }
 check(hooks);const after=await fs.lstat(root);if(first.dev!==after.dev||first.ino!==after.ino||after.isSymbolicLink()||key(await fs.realpath(root))!==key(root))throw Error('根目录身份改变，整份拒绝。');
 graphCycles(directories,links);check(hooks);links.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);errors.sort((a,b)=>a.path<b.path?-1:1);const counts={};for(const l of links)counts[l.resolution.status]=(counts[l.resolution.status]||0)+1;
 const report={feature:'T020',version:1,root,platform:process.platform,summary:{entries,ordinaryDirectories:directories.length,ordinaryFiles:files,otherEntries:other,links:links.length,statusCounts:counts,unreadableOrChanged:errors.length},scanScopeComplete:errors.length===0,links,errors,limits:LIMITS,scope:'只读lstat/readlink/opendir元数据，不读取正文，不进入目录链接。范围外目标只报路径与outside，不检验存在。链循环与目录图循环分别标记；40跳上限只标unknown。权限/消失项保留未知，不等于无问题。运行时非原子快照，外部并发改动可能导致结果变化；不提供对恶意并发替换的文件系统沙箱。'};
 if(Buffer.byteLength(JSON.stringify(report),'utf8')>LIMITS.reportBytes)throw Error('完整报告超过4MiB，整份拒绝。');return report;
}
function createHost({chooseDirectory=async()=>{const r=await require('electron').dialog.showOpenDialog({title:'选择允许只读巡检的普通根目录',properties:['openDirectory']});return r.canceled?null:r.filePaths[0];}}={}){
 const senders=new Map();function owner(id){if(!Number.isSafeInteger(id)||id<1)throw Error('窗口无效。');if(!senders.has(id)){if(senders.size>=LIMITS.senders)throw Error('窗口状态达到上限。');senders.set(id,{selection:null,job:null,used:new Set(),generation:0});}return senders.get(id);}
 const api={async invoke(operation,payload,{senderId}){
  const state=owner(senderId);
  if(operation==='select'){input(payload,[]);if(state.job)throw Error('当前窗口有运行中的任务。');const gen=++state.generation;state.selection=null;const selected=await chooseDirectory();if(gen!==state.generation||!senders.has(senderId))return{canceled:true};if(!selected)return{canceled:true};const root=safePath(path.resolve(selected)),s=await fs.lstat(root);if(s.isSymbolicLink()||!s.isDirectory()||key(await fs.realpath(root))!==key(root))throw Error('仅接受实际普通目录根。');if(gen!==state.generation||!senders.has(senderId))return{canceled:true};const selectionId=randomUUID();state.selection={root,selectionId};return{ok:true,selectionId,root,limits:LIMITS};}
  if(operation==='release'){input(payload,[]);state.generation++;state.job?.controller.abort();state.selection=null;return{ok:true};}
  if(operation==='scan'){input(payload,['selectionId','jobId','confirmed']);if(!state.selection||payload.selectionId!==state.selection.selectionId||payload.confirmed!==true)throw Error('需要当前窗口明确目录选择及确认。');if(state.job)throw Error('当前窗口已有任务。');if(typeof payload.jobId!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(payload.jobId)||state.used.has(payload.jobId)||state.used.size>=LIMITS.jobs)throw Error('任务编号无效/已使用/达到128次上限。');state.used.add(payload.jobId);const controller=new AbortController(),job={id:payload.jobId,controller};state.job=job;try{return{ok:true,report:await scanRoot(state.selection.root,{signal:controller.signal})};}finally{if(state.job===job)state.job=null;}}
  throw Error('操作不支持。');
 },cancel(jobId,{senderId}){const state=senders.get(senderId);if(state?.job?.id===jobId){state.job.controller.abort();return{ok:true,canceled:true};}return{ok:false,canceled:false};},disposeSender(senderId){const state=senders.get(senderId);if(state){state.generation++;state.job?.controller.abort();senders.delete(senderId);}}};return api;
}
module.exports={...createHost(),createHost,scanRoot,resolveTarget,graphCycles,within,LIMITS};
