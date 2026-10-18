'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.join(__dirname,'..'),bin=path.join(root,'resources/bin/papervid');
const native=process.platform==='darwin' && fs.existsSync(bin);
test('安装版要求新版模板引擎，不静默沿用旧模板',()=>{
  const source=fs.readFileSync(path.join(root,'src/main/paper-talk-service.js'),'utf8');
  assert.match(source,/=== 'papervid 3'/);assert.match(source,/papervid-v3/);
});
test('原生模板渲染封面、三栏讲解、四要点对比和表格，无溢出', {skip:!native},t=>{
  assert.equal(cp.execFileSync(bin,['version'],{encoding:'utf8'}).trim(),'papervid 3');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-layout-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const base={chapter:'方法',title:'序列多智能体系统的信息论隐私控制',takeaway:'用原文机制和证据解释方法，保留结论的适用边界',source:'Section 5 / 原文事实',speaker:'甲·主持',caption:'核心机制与证据需要对应',focus:0};
  const points=Array.from({length:4},(_,i)=>({heading:'方法要点'+i,detail:'这里保留完整的机制说明和证据，不只展示标题，也不会用空白页补足页数。'}));
  for(const [i,layout,count] of [[1,'outline',3],[2,'outline',3],[3,'comparison',4],[4,'table',4]]){
    const spec={...base,pageLabel:`${i} / 4`,layout,points:points.slice(0,count)};
    if(layout==='table')spec.table={columns:['维度','方法','结果'],rows:[['任务','有证据的描述','原文报告'],['指标','保留单位','说明比较条件'],['边界','限制条件','避免泛化']]};
    const file=path.join(dir,i+'.json'),image=path.join(dir,i+'.png');fs.writeFileSync(file,JSON.stringify(spec));
    cp.execFileSync(bin,['page',file,image],{stdio:['ignore','pipe','pipe']});assert.ok(fs.statSync(image).size>10000);
  }
});
