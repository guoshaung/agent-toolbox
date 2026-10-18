'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {extractObject,generateValidated}=require('../src/main/paper-talk-generation');
const {requestPaperText}=require('../src/main/paper-talk-api');
const {PaperTalkService}=require('../src/main/paper-talk-service');
function rawPlan(n=8){return{title:'Test',slides:Array.from({length:n},(_,i)=>({id:`s${i+1}`,title:'完整主题'+i,objective:'解释机制',takeaway:'证据支持的结论',source:'Section 2',emphasis:'core',points:[{heading:'机制',detail:'来自原文的具体解释'},{heading:'证据',detail:'来自原文的具体证据'}]}))};}
function svc(t,ask){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new PaperTalkService({userDataDir:dir,generateScript:ask});}
test('精确提取完整JSON，说明文字的括号及字符串内大括号不破坏解析',()=>{
  assert.deepEqual(extractObject('说明：{非JSON}\n```json\n{"text":"重点 } { ","slides":[]}\n```\n结束{}'),{text:'重点 } { ',slides:[]});
});
test('不合格结果携具体错误自动修正，不降低内容校验',async()=>{
  let calls=0;const progress=[];
  const result=await generateValidated({stage:'规划',prompt:'JSON',ask:async p=>{calls++;if(calls===1)return'{}';assert.match(p,/缺少页面/);return'{"slides":[1]}';},validate:r=>{if(!r.slides)throw Error('缺少页面');return r;},progress:p=>progress.push(p)});
  assert.equal(calls,2);assert.deepEqual(result.slides,[1]);assert.equal(progress.length,1);
});
test('鉴权失败不浪费额度反复重试',async()=>{
  let calls=0;await assert.rejects(generateValidated({stage:'规划',prompt:'JSON',ask:async()=>{calls++;throw Error('AI HTTP 401：invalid key');},validate:x=>x}),/401/);assert.equal(calls,1);
});
test('临时断网可重连，重试次数有上限',async()=>{
  let calls=0;const delays=[];await generateValidated({stage:'规划',prompt:'JSON',ask:async()=>{if(++calls===1)throw Error('fetch failed');return'{"ok":true}';},validate:x=>x,delay:async x=>delays.push(x)});assert.equal(calls,2);assert.equal(delays.length,1);
  await assert.rejects(generateValidated({stage:'规划',prompt:'JSON',ask:async()=>'{}',validate:()=>{throw Error('没有证据');},attempts:2}),/修正 2 次/);
});
test('结构化JSON不支持时只降级该选项，保留模型与流式传输',async()=>{
  let calls=0;const r=await requestPaperText({endpoint:'https://example.test/chat',apiKey:'fake-key',model:'chosen',prompt:'JSON',jsonMode:true,fetchFn:async(_,opt)=>{const body=JSON.parse(opt.body);assert.equal(body.model,'chosen');assert.equal(body.stream,true);if(++calls===1){assert.equal(body.response_format.type,'json_object');return new Response('unsupported response_format',{status:400});}assert.equal(body.response_format,undefined);return new Response(JSON.stringify({choices:[{message:{content:'{}'}}]}));}});
  assert.equal(r,'{}');assert.equal(calls,2);
});
test('整份规划失败后分四批得到12页，仍有具体要点和来源',async t=>{
  let calls=0;const service=svc(t,async prompt=>{calls++;if(!prompt.includes('【当前仅生成局部】'))return JSON.stringify(rawPlan(2));const n=Math.floor((calls-4)/1)*3;const raw=rawPlan(3);raw.slides.forEach((s,j)=>{const i=n+j;s.id='s'+(i+1);s.emphasis=i>=2&&i<=9?'core':'support';});return JSON.stringify(raw);});
  const plan=await service.planLesson({id:'2603.05520',title:'Test',figures:[]},'');
  assert.equal(plan.slides.length,12);assert.equal(calls,7);assert.ok(plan.slides.every(s=>s.points.every(p=>p.detail)&&s.source));
});
test('规划第一次不合格、第二次通过，保存真实修正记录',async t=>{
  let calls=0;const service=svc(t,async()=>JSON.stringify(rawPlan(++calls===1?2:8)));
  assert.equal((await service.planLesson({id:'2603.05520',title:'Test'},'')).slides.length,8);
  const records=fs.readdirSync(path.join(service.outDir,'diagnostics')).map(f=>JSON.parse(fs.readFileSync(path.join(service.outDir,'diagnostics',f),'utf8')));
  assert.ok(records.some(r=>!r.ok&&r.response&&r.error.includes('2页')));
});
test('整份台词失败后逐页修复，不省略页面，不用重复文本补齐',async t=>{
  const plan=rawPlan();const service=svc(t,async prompt=>{if(!prompt.includes('【当前仅生成局部】'))return'{}';const id=prompt.match(/只输出以下这一页的segments[^\n]*?"id":"(s\d+)"/)?.[1];assert.ok(id);return JSON.stringify({segments:['A','B'].map(speaker=>({slideId:id,speaker,text:'第'+id+'页的独立解释与证据',focus:0}))});});
  const script=await service.writeScript({title:'Test'},'',plan);assert.equal(script.segments.length,16);assert.equal(new Set(script.segments.map(s=>s.slideId)).size,8);
});
test('失败状态持久化，重启不能把未完成任务显示成功',async t=>{
  const service=svc(t,async()=>{throw Error('AI HTTP 401');});service.fetchPaper=async()=>({id:'2603.05520',title:'Test'});
  const result=await service.run({input:'2603.05520'});assert.equal(result.ok,false);assert.equal(service.state().stage,'error');assert.equal(service.state().running,false);
  const reopened=new PaperTalkService({userDataDir:service.userDataDir});assert.equal(reopened.state().stage,'error');
  fs.writeFileSync(path.join(service.outDir,'last-task.json'),JSON.stringify({running:true,stage:'synth'}));assert.equal(new PaperTalkService({userDataDir:service.userDataDir}).state().stage,'interrupted');
});
