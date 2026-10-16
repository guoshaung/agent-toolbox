'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const model=import(pathToFileURL(path.join(__dirname,'model.mjs')).href);
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
function strict(p,keys){if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join('|')!==[...keys].sort().join('|'))throw Error('请求字段无效。');}
async function absent(p){try{await fs.lstat(p);throw Error('目标已存在，不能覆盖或合并。');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function writeSkeleton(target,plan,{signal,deadline=Date.now()+10000,writeFile=fs.writeFile}={}){
 let created=false;const manifest=[],identities=new Map();
 const check=()=>{if(signal?.aborted)throw Error('创建已取消，完整骨架未完成。');if(Date.now()>deadline)throw Error('创建超过10秒等待期限，完整骨架未完成。');};
 async function verify(dir){const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||!same(stat,identities.get(dir)))throw Error('本次目录身份改变，已停止创建。');if(await fs.realpath(dir)!==dir)throw Error('本次目录路径改变，已停止创建。');}
 try{
  const parent=await fs.realpath(path.dirname(target)),destination=path.join(parent,path.basename(target));if(destination!==target)throw Error('预览目标父路径改变，请重新选择。');const parentIdentity=await fs.stat(parent);check();await absent(target);await fs.mkdir(target,{mode:0o700});created=true;identities.set(target,await fs.lstat(target));if(!same(parentIdentity,await fs.stat(parent)))throw Error('目标父目录身份改变。');
  for(const item of plan.directories){check();const output=path.join(target,...item.path.split('/'));await verify(path.dirname(output));await fs.mkdir(output,{mode:0o700});identities.set(output,await fs.lstat(output));manifest.push({kind:'directory',path:item.path,emptyAtCreation:true});}
  for(const file of plan.files){check();const output=path.join(target,...file.path.split('/'));await verify(path.dirname(output));const data=Buffer.from(file.content,'utf8');await writeFile(output,data,{flag:'wx',mode:0o600});const actual=await fs.readFile(output);if(!actual.equals(data))throw Error('文本副本回读不一致。');manifest.push({kind:'file',path:file.path,utf8Bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
  check();for(const dir of identities.keys())await verify(dir);return{ok:true,report:{format:'T015-created-skeleton',schemaVersion:1,path:target,complete:true,manifest,totalTextBytes:plan.totalTextBytes,scope:'新建空目录与显式UTF-8样板；来源未修改、未运行任何样板。'}};
 }catch(e){return{ok:false,error:['EEXIST','ENOENT','EACCES','EPERM','ENOTDIR'].includes(e.code)?e.code:String(e.message||'创建失败'),partialPath:created?target:null,completedEntries:manifest,complete:false,scope:'失败后保留本次部分新目录供人工核对，不递归清理或宣称完整创建。'};}
}
function createHost({chooseTarget=async(senderId)=>{const{dialog,BrowserWindow,webContents}=require('electron');return dialog.showSaveDialog(BrowserWindow.fromWebContents(webContents.fromId(senderId)),{title:'选择尚不存在的新骨架目录名',defaultPath:'project-skeleton',buttonLabel:'预览新目录位置'});}}={}){
 const states=new Map();const stateFor=id=>{if(!Number.isInteger(id)||id<=0)throw Error('无效sender');if(!states.has(id)){if(states.size>=32)throw Error('最多32个sender');states.set(id,{generation:0,target:null,plan:null,busy:false,job:null});}return states.get(id);};
 return{async invoke(op,p,{senderId}={}){const s=stateFor(senderId);const m=await model;if(s.busy||states.get(senderId)!==s)throw Error('该窗口已有操作进行中或已销毁。');
  if(op==='choose_target'){strict(p,[]);s.target=s.plan=null;s.busy=true;const own=++s.generation;try{const result=await chooseTarget(senderId);if(own!==s.generation)return{ok:false,canceled:true};if(result.canceled||!result.filePath)return{ok:false,canceled:true};const selected=path.resolve(result.filePath);if(!path.isAbsolute(result.filePath)||!m.segment(path.basename(selected)))throw Error('目标必须为本地绝对路径和安全新目录名。');const parent=await fs.realpath(path.dirname(selected));if(!(await fs.stat(parent)).isDirectory())throw Error('目标父目录无效。');const target=path.join(parent,path.basename(selected));await absent(target);s.target={id:randomUUID(),path:target};return{ok:true,target:s.target};}finally{s.busy=false;}}
  if(op==='plan'){strict(p,['targetId','template','variables']);s.plan=null;if(!s.target||p.targetId!==s.target.id)throw Error('须在本窗口选择新目标。');s.busy=true;try{const value=m.buildPlan(p.template,p.variables);await absent(s.target.path);if(states.get(senderId)!==s)throw Error('窗口已销毁。');const plan={...value,targetPath:s.target.path,planId:randomUUID()};s.plan=plan;return{ok:true,plan};}finally{s.busy=false;}}
  if(op==='create'){strict(p,['planId','jobId','confirmed']);if(p.confirmed!==true||typeof p.jobId!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(p.jobId)||!s.plan||p.planId!==s.plan.planId)throw Error('须确认本窗口完整预览。');s.busy=true;const chosen=s.plan;s.plan=null;s.job={id:p.jobId,controller:new AbortController()};try{return await writeSkeleton(chosen.targetPath,chosen,{signal:s.job.controller.signal});}finally{s.busy=false;s.job=null;s.target=null;}}
  throw Error('只支持choose_target/plan/create。');
 },cancel(jobId,{senderId}={}){const s=states.get(senderId);if(!s?.job||s.job.id!==jobId)return{ok:true,canceled:false};s.job.controller.abort();return{ok:true,canceled:true};},disposeSender(id){const s=states.get(id);if(s){s.generation++;s.job?.controller.abort();states.delete(id);}}};
}
module.exports={...createHost(),createHost,writeSkeleton};
