'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
class Element{
  constructor(tag,props={},children=[]){this.tag=tag;this.children=[];this.style={};this.events={};this.value=props.value||'';this.checked=false;this.dataset={};Object.assign(this,props);if(typeof this.style==='string')this.style={};children.flat(Infinity).forEach(c=>this.children.push(c));}
  append(...items){this.children.push(...items);}appendChild(item){this.children.push(item);}
  addEventListener(name,fn){this.events[name]=fn;}
  set innerHTML(value){this.children=[];}get innerHTML(){return'';}
  set textContent(value){this.children=[value];}get textContent(){return this.children.map(c=>typeof c==='string'?c:c?.textContent||'').join('');}
  querySelectorAll(tag){return this.children.flatMap(c=>c instanceof Element?[...(c.tag===tag?[c]:[]),...c.querySelectorAll(tag)]:[]);}
}
async function mount(){
  const calls=[],messages=[],values=new Map(),root=new Element('root');
  const paper={id:'pdf-'+'a'.repeat(32),title:'上传的本地论文',name:'paper.pdf',pageCount:5,textChars:9000,figures:2,warnings:[],preview:'已提取正文',file:'/local/source.pdf'};
  const api={list:async()=>[],plan:async()=>null,state:async()=>null,voiceStatus:async()=>({configured:true}),pickPdf:async()=>({ok:true,paper}),importPdf:async file=>{calls.push(['import',file]);return{ok:true,paper};},run:async p=>{calls.push(['run',p]);return{ok:false,error:'test-stop'};}};
  const context={console,window:{toolbox:{paperTalk:api,files:{getPathForFile:()=>'/selected/drop.pdf'}}},document:{getElementById:()=>null,createElement:tag=>new Element(tag),head:new Element('head')},h:(tag,props,...children)=>new Element(tag,props,children),toast:m=>messages.push(m)};
  const source=fs.readFileSync(path.join(__dirname,'../src/renderer/tools/research/paper-talk.js'),'utf8').replace(/^import[^\n]+\n/,'').replace('export function createPaperTalk','function createPaperTalk');
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.mountPaper=createPaperTalk;',context);context.mountPaper(root,{config:{get:(k,d)=>values.get(k)??d,set:(k,v)=>values.set(k,v)}});
  await new Promise(r=>setImmediate(r));
  const button=text=>root.querySelectorAll('button').find(e=>e.textContent.includes(text));
  const mode=root.querySelectorAll('select').find(e=>e['aria-label']==='论文来源');
  return{root,calls,messages,mode,button};
}
test('上传入口选择PDF后显示预览，未勾选确认不会调用生成',async()=>{
  const f=await mount();f.mode.value='local';f.mode.events.change();await f.button('选择 PDF 文件').onclick();
  assert.match(f.root.textContent,/上传的本地论文/);assert.match(f.root.textContent,/5 页/);
  await f.button('生成讲解视频').onclick();assert.ok(f.messages.some(m=>/确认/.test(m)));assert.equal(f.calls.filter(c=>c[0]==='run').length,0);
});
test('默认链接模式下也能直接选择PDF，成功后自动切换来源',async()=>{
  const f=await mount();assert.equal(f.mode.value,'arxiv');await f.button('选择 PDF 文件').onclick();assert.equal(f.mode.value,'local');assert.match(f.root.textContent,/上传的本地论文/);
});
test('确认后把本地论文ID而非伪造arXiv链接交给生成服务',async()=>{
  const f=await mount();f.mode.value='local';f.mode.events.change();await f.button('选择 PDF 文件').onclick();
  f.root.querySelectorAll('input').find(e=>e['aria-label']==='允许 AI 读取论文正文').checked=true;
  await f.button('生成讲解视频').onclick();const payload=f.calls.find(c=>c[0]==='run')[1];assert.equal(payload.allowCloud,true);assert.equal(payload.input,'');assert.match(payload.localPaperId,/^pdf-/);
});
test('拖入PDF使用Electron文件路径接口，取消选择不删除原文件',async()=>{
  const f=await mount();f.mode.value='local';f.mode.events.change();const drop=f.root.querySelectorAll('div').find(e=>e.class==='pt__drop');
  drop.events.drop({preventDefault(){},dataTransfer:{files:[{name:'drop.pdf'}]}});await new Promise(r=>setImmediate(r));assert.deepEqual(f.calls[0],['import','/selected/drop.pdf']);
  f.button('取消选择').onclick();assert.match(f.root.textContent,/尚未选择 PDF/);
});
