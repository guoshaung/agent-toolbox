'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {LocalPaperService,buildPaper,sourceId}=require('../src/main/paper-talk-local');
const {PaperTalkService}=require('../src/main/paper-talk-service');
const {BilibiliPublishService}=require('../src/main/bilibili-publish');
const id='pdf-'+'a'.repeat(32);
function raw(){return{title:'本地论文',authors:'作者',pages:[{text:'正文机制与实验。'.repeat(160)+'\nFigure 1: Evidence'},{text:'结果指标与局限。'.repeat(160)}]};}
function setup(t,helper){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-local-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const pdf=path.join(dir,'my-paper.pdf');fs.writeFileSync(pdf,'%PDF-1.7\ntest fixture');return{dir,pdf,svc:new LocalPaperService({userDataDir:dir,resourcesDir:path.join(__dirname,'../resources'),runHelper:helper})};}
test('上传内容存储在本机，按内容去重，未触发 AI 调用',async t=>{
  let inspections=0;const f=setup(t,async(mode,file,out)=>{if(mode==='inspect'){inspections++;return JSON.stringify(raw());}fs.writeFileSync(path.join(out,'page-1.png'),'image');return'OK';});
  const result=await f.svc.importFile(f.pdf);assert.equal(result.ok,true);assert.equal(result.paper.pageCount,2);assert.equal(result.paper.figures,1);
  const paper=f.svc.load(result.paper.id);assert.match(paper.body,/PDF 第 2 页/);assert.equal(paper.sourceType,'local-pdf');
  assert.notEqual(result.paper.file,f.pdf);assert.equal(fs.readFileSync(f.pdf,'utf8'),'%PDF-1.7\ntest fixture');
  assert.equal((await f.svc.importFile(f.pdf)).paper.id,result.paper.id);assert.equal(inspections,1);
});
test('拒绝伪扩展名、目录、过大文件和不存在的文件',async t=>{
  const f=setup(t,async()=>{throw Error('must not parse');});
  const fake=path.join(f.dir,'fake.pdf');fs.writeFileSync(fake,'not a pdf');assert.equal((await f.svc.importFile(fake)).ok,false);
  const huge=path.join(f.dir,'huge.pdf');const fd=fs.openSync(huge,'w');fs.ftruncateSync(fd,64*1024*1024+1);fs.closeSync(fd);
  assert.match((await f.svc.importFile(huge)).error,/64 MB/);
  assert.equal((await f.svc.importFile(f.dir)).ok,false);assert.match((await f.svc.importFile(path.join(f.dir,'missing.pdf'))).error,/找不到/);
});
test('扫描件与加密文件错误清楚，不保存不完整缓存，原文件不变',async t=>{
  const scan=setup(t,async()=>JSON.stringify({pages:[{text:''},{text:''}]}));assert.match((await scan.svc.importFile(scan.pdf)).error,/OCR/);
  assert.equal(fs.readdirSync(scan.svc.root).length,0);
  const locked=setup(t,async()=>{throw Error('PDF 已加密，请先解锁');});assert.match((await locked.svc.importFile(locked.pdf)).error,/加密/);assert.ok(fs.existsSync(locked.pdf));
});
test('混合扫描件与页数过多时拒绝拿残缺正文生成',()=>{
  assert.throws(()=>buildPaper({pages:[{text:'正文'.repeat(1000)},{text:''},{text:''}]},{id,name:'x.pdf',dir:'/tmp/imported'}),/大量页面/);
  assert.throws(()=>buildPaper({pages:Array(201).fill({text:'x'})},{id,name:'x.pdf',dir:'/tmp/imported'}),/页数/);
});
test('本地论文标识不能用路径穿越代替，AI 上下文不含本机路径',async t=>{
  const f=setup(t,async()=>JSON.stringify(raw()));assert.equal(sourceId('local:'+id),id);assert.equal(sourceId('../private.pdf'),'');
  assert.throws(()=>f.svc.load('../private'),/编号/);
  const svc=new PaperTalkService({userDataDir:f.dir});const context=svc._paperContext({title:'本地',body:'正文',figures:[{id:'pdf-p1',caption:'原文第1页',localPath:'/private/secret.png'}]},'');
  assert.ok(!context.includes('/private/secret'));assert.match(context,/pdf-p1/);
});
test('本地 PDF 未确认云端处理时不进入生成或读取凭据',async t=>{
  const f=setup(t,async()=>JSON.stringify(raw()));let loads=0;
  const svc=new PaperTalkService({userDataDir:f.dir,loadLocalPaper:()=>{loads++;throw Error('not yet');}});
  const r=await svc.run({localPaperId:id});assert.equal(r.ok,false);assert.match(r.error,/确认/);assert.equal(loads,0);assert.equal(svc._busy,false);
});
test('确认后本地 PDF 复用现有规划与配音链路，不调用 arXiv',async t=>{
  const f=setup(t,async()=>JSON.stringify(raw()));const paper={id,title:'本地论文',body:'正文',figures:[],sourceType:'local-pdf'};
  const svc=new PaperTalkService({userDataDir:f.dir,loadLocalPaper:key=>{assert.equal(key,id);return paper;}});
  svc.fetchPaper=()=>{throw Error('must not fetch arxiv');};svc.planLesson=async p=>({title:p.title,slides:[{id:'s1'}]});svc.writeScript=async()=>({title:paper.title,slides:[{id:'s1'}],segments:[{text:'台词'}]});
  svc.synth=async()=>{const file=path.join(svc.outDir,'stub.mp4');fs.writeFileSync(file,'test');fs.writeFileSync(file.replace('.mp4','.srt'),'subtitle');return file;};
  const r=await svc.run({localPaperId:id,allowCloud:true});assert.equal(r.ok,true);assert.equal(svc.state().input,'local:'+id);assert.equal(svc.plan('local:'+id).title,'本地论文');
});
test('本地论文投稿草稿不伪造 arXiv 链接或暴露本机文件路径',t=>{
  const f=setup(t,async()=>JSON.stringify(raw()));const output=path.join(f.dir,'paper-talk');fs.mkdirSync(output,{recursive:true});const file=path.join(output,'local.mp4');fs.writeFileSync(file,'test');
  fs.writeFileSync(file.replace('.mp4','.timeline.json'),JSON.stringify({title:'本地论文',slides:[]}));fs.writeFileSync(path.join(output,id+'-script.json'),JSON.stringify({title:'本地论文',paper:{id,title:'本地论文',sourceType:'local-pdf'}}));
  const r=new BilibiliPublishService({outputDir:output}).prepare(file);assert.ok(!r.draft.description.includes('arxiv.org'));assert.match(r.draft.description,/补充论文公开链接/);assert.ok(!r.draft.description.includes(f.dir));
});
