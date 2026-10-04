const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/renderer/features/L018/model.mjs');
async function replay(draft, schedule) { const { createSimulation, stepSimulation } = await model(); return schedule.reduce((state, id) => stepSimulation(state, id), createSimulation(draft)); }
const coreSchedule = ['T1', 'T1', 'T2', 'T2', 'T2', 'T1', 'T1'];

test('L018 核心独立手算：同调度RC 10→20、RR 10→10', async () => {
  const { example } = await model(); const result = await replay(example(), coreSchedule);
  assert.deepEqual(result.RC.transactions.T1.reads.map((r) => r.value), [10, 20]); assert.deepEqual(result.RR.transactions.T1.reads.map((r) => r.value), [10, 10]); assert.equal(result.RC.committed, 20); assert.equal(result.RR.committed, 20); assert.equal(result.RC.anomalies.length, 1); assert.equal(result.RR.anomalies.length, 0);
  assert.deepEqual(result.RC.anomalies[0], { type: '非重复读', transaction: 'T1', firstStep: 2, secondStep: 6, firstValue: 10, secondValue: 20 }); assert.deepEqual(result.schedule, coreSchedule);
});
test('L018 BEGIN快照明确早于首次READ', async () => {
  const { example } = await model(); const result = await replay(example(), ['T1','T2','T2','T2','T1']); assert.equal(result.RC.transactions.T1.reads[0].value, 20); assert.equal(result.RR.transactions.T1.reads[0].value, 10); assert.equal(result.RR.transactions.T1.snapshot, 10);
});
test('L018 他人未提交写始终不可见，不出现脏读', async () => {
  const result = await replay({ initial:'10', t1:'BEGIN\nREAD\nREAD\nCOMMIT', t2:'BEGIN\nWRITE 99\nROLLBACK' }, ['T1','T2','T2','T1','T2','T1']); for (const policy of ['RC','RR']) { assert.deepEqual(result[policy].transactions.T1.reads.map((r) => r.value), [10,10]); assert.equal(result[policy].committed, 10); assert.equal(result[policy].anomalies.length, 0); }
});
test('L018 自身写优先于快照；自改读值不误报非重复读', async () => {
  const { example } = await model(); const result = await replay(example('own'), ['T1','T1','T1','T2','T2','T1']); for (const policy of ['RC','RR']) { assert.deepEqual(result[policy].transactions.T1.reads.map((r) => r.value), [10,15]); assert.equal(result[policy].transactions.T2.reads[0].value, 10); assert.equal(result[policy].transactions.T1.reads[1].source, '自己的未提交写'); assert.equal(result[policy].anomalies.length, 0); }
});
test('L018 ROLLBACK丢弃写，不产生COMMIT记录', async () => {
  const { example, visibleValue } = await model(); const result = await replay(example('own'), ['T1','T1','T1','T1','T1']); for (const policy of ['RC','RR']) { assert.equal(result[policy].committed,10); assert.equal(result[policy].commits.length,0); assert.equal(result[policy].transactions.T1.pending,null); assert.equal(visibleValue(result[policy],policy,'T1').value,null); }
});
test('L018 双写简化后提交覆盖前值，覆盖原因明确', async () => {
  const { example } = await model(); const result = await replay(example('writes'), ['T1','T2','T1','T2','T1','T2']); for (const policy of ['RC','RR']) { assert.equal(result[policy].committed,20); assert.deepEqual(result[policy].commits.map((r) => [r.before,r.after,r.overwritten]), [[0,10,false],[10,20,true]]); assert.match(result.steps[5].outcomes[policy].reason,/教学规则/); }
});
test('L018 串行提交无覆盖提示，BEGIN快照读取最新提交', async () => {
  const result = await replay({ initial:'0',t1:'BEGIN\nWRITE 10\nCOMMIT',t2:'BEGIN\nREAD\nCOMMIT' }, ['T1','T1','T1','T2','T2','T2']); for (const policy of ['RC','RR']) { assert.equal(result[policy].transactions.T2.reads[0].value,10); assert.equal(result[policy].commits[1].overwritten,false); assert.equal(result[policy].version,1); }
});
test('L018 相同数值提交更新版本但不误报非重复读', async () => {
  const result = await replay({ initial:'10',t1:'BEGIN\nREAD\nREAD',t2:'BEGIN\nWRITE 10\nCOMMIT' }, ['T1','T1','T2','T2','T2','T1']); assert.equal(result.RC.version,1); assert.equal(result.RC.anomalies.length,0); assert.equal(result.RR.anomalies.length,0);
});
test('L018 多次暂存WRITE只提交最后一次', async () => {
  const result = await replay({ initial:'0',t1:'BEGIN\nWRITE -1\nWRITE 0\nREAD\nCOMMIT',t2:'BEGIN' }, ['T1','T1','T1','T1','T1']); assert.equal(result.RR.transactions.T1.reads[0].value,0); assert.equal(result.RR.transactions.T1.reads[0].source,'自己的未提交写'); assert.equal(result.RC.version,1); assert.equal(result.RC.commits[0].wrote,true);
});
test('L018 无效状态消耗指令但不变数据，后续有效BEGIN可运行', async () => {
  const { createSimulation,stepSimulation } = await model(); let s=createSimulation({initial:'10',t1:'READ\nCOMMIT\nBEGIN\nBEGIN\nWRITE 30\nCOMMIT\nWRITE 40\nBEGIN',t2:'ROLLBACK'}); for (let i=0;i<8;i++) s=stepSimulation(s,'T1');
  assert.deepEqual(s.steps.map((r)=>r.outcomes.RC.ok),[false,false,true,false,true,true,false,false]); assert.equal(s.RC.committed,30); assert.equal(s.RC.transactions.T1.status,'committed'); assert.equal(s.RC.commits.length,1); assert.match(s.steps[7].outcomes.RC.reason,/只允许一次BEGIN/);
});
test('L018 未提交脚本用尽仍active，不假称完成发布', async () => {
  const { visibleValue } = await model(); const s=await replay({initial:'0',t1:'BEGIN\nWRITE 7',t2:'BEGIN'},['T1','T1']); assert.equal(s.RC.committed,0); assert.equal(s.RC.transactions.T1.status,'active'); assert.equal(visibleValue(s.RR,'RR','T1').value,7);
});
test('L018 数值边界与严格类型/语法拒绝任意代码', async () => {
  const { createSimulation,example,parseScript }=await model(); for(const initial of ['-1000000','1000000']) assert.equal(createSimulation({...example(),initial}).initial,Number(initial));
  for(const initial of ['1000001','1e2','1.5',true,null,[]]) assert.throws(()=>createSimulation({...example(),initial}));
  for(const script of ['', 'begin', 'BEGIN\n\nREAD','WRITE 1000001','WRITE 2+3','SELECT 1','global.process.exit()','WRITE Infinity','READ k']) assert.throws(()=>parseScript(script,'T1'));
  assert.deepEqual(parseScript(' BEGIN\r\n WRITE -3 \r\nCOMMIT ','T1').map(r=>r.op),['BEGIN','WRITE','COMMIT']);
});
test('L018 容量24/48步允许，超限不截断，耗尽/未知事务拒绝', async () => {
  const {createSimulation,stepSimulation,example,parseScript}=await model(); const script=['BEGIN',...Array(22).fill('READ'),'COMMIT'].join('\n'); let s=createSimulation({initial:'0',t1:script,t2:script}); for(let i=0;i<24;i++){s=stepSimulation(s,'T1');s=stepSimulation(s,'T2');} assert.equal(s.steps.length,48); assert.equal(s.RR.transactions.T1.reads.length,22); assert.throws(()=>stepSimulation(s,'T1'),/48步/); assert.throws(()=>parseScript(script+'\nREAD','T1'),/1–24/); assert.throws(()=>parseScript(' '.repeat(4097),'T1'),/4096/); assert.throws(()=>stepSimulation(createSimulation(example()),'T3'),/请选择/); const one=createSimulation({initial:'0',t1:'BEGIN',t2:'BEGIN'}); assert.throws(()=>stepSimulation(stepSimulation(one,'T1'),'T1'),/没有剩余/);
});
test('L018 纯模型不修改输入，所有轨迹快照独立', async()=>{
  const {example,createSimulation,stepSimulation}=await model(); const draft=example(); const original=structuredClone(draft); const initial=createSimulation(draft); const first=stepSimulation(initial,'T1'); assert.equal(initial.RR.transactions.T1.status,'idle'); assert.deepEqual(draft,original); const result=await replay(draft,coreSchedule); assert.deepEqual(result,await replay(draft,coreSchedule)); result.steps[0].after.RR.transactions.T1.snapshot=99; assert.equal(result.steps[1].before.RR.transactions.T1.snapshot,10); assert.equal(result.RR.transactions.T1.snapshot,10);
});
test('L018 草稿schema/完整raw UTF8/脚本边界，64KiB精确接受',async()=>{
  const {prepareStoredState,validateStoredState,example}=await model(); const draft=example(); const overhead=new TextEncoder().encode(JSON.stringify(prepareStoredState({...draft,initial:''}))).byteLength; const exact=prepareStoredState({...draft,initial:'a'.repeat(65536-overhead)}); assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength,65536); assert.deepEqual(validateStoredState(exact),exact); assert.throws(()=>prepareStoredState({...exact,initial:exact.initial+'a'}),/64KiB/); assert.throws(()=>validateStoredState({...prepareStoredState(draft),hidden:'汉'.repeat(22000)}),/64KiB/); assert.throws(()=>validateStoredState({schemaVersion:2}),/版本/); assert.throws(()=>prepareStoredState({...draft,t1:'汉'.repeat(1400)}),/4096/); assert.throws(()=>validateStoredState({...prepareStoredState(draft),initial:10}),/字段类型/);
});
test('L018 Markdown完整输入轨迹前后与规则，HTML文本安全',async()=>{
  const {example,reportMarkdown}=await model(); const draft=example(); const result=await replay(draft,coreSchedule); const md=reportMarkdown({draft,result}); assert.match(md,/步骤6 T1 READ/); assert.match(md,/非重复读/); assert.match(md,/before/); assert.match(md,/after/); assert.match(md,/BEGIN快照/); assert.match(md,/postgresql.org/); const raw=reportMarkdown({draft:{...draft,t1:'<script>bad</script>'},result:null}); assert.doesNotMatch(raw,/<script>/); assert.match(raw,/&lt;script&gt;/); assert.match(raw,/尚未开始/);
});
class NodeStub {
  constructor(tag = '', text = null) { this.tagName = tag; this.nodeType = text === null ? 1 : 3; this.text = text; this.children = []; this.attributes = {}; this.style = {}; this.dataset = {}; this.className = ''; this.events = {}; this.value = ''; this.checked = false; this.disabled = false; this.classList = { add: (name) => { this.className += ` ${name}`; }, remove: (name) => { this.className = this.className.split(' ').filter((item) => item !== name).join(' '); }, toggle: (name, yes) => { this.classList.remove(name); if (yes) this.classList.add(name); } }; }
  append(...items) { this.children.push(...items.map((item) => item?.nodeType ? item : new NodeStub('', String(item)))); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'disabled') this.disabled = true; }
  addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
  get textContent() { return this.text === null ? this.children.map((child) => child.textContent).join('') : this.text; }
  set textContent(value) { this.text = null; this.replaceChildren(String(value)); }
  set innerHTML(_value) { throw new Error('User input must be rendered as text'); }
  async fire(type) { if (type === 'click' && this.disabled) return; for (const callback of this.events[type] || []) await callback({ target: this }); }
}
const walk = (node) => [node, ...node.children.flatMap(walk)];
const button = (root, label) => { const node = walk(root).find((item) => item.tagName === 'button' && item.textContent === label); assert.ok(node, label); return node; };
const control = (root, label) => { const node = walk(root).find((item) => item.attributes['aria-label'] === label); assert.ok(node, label); return node; };
async function fill(root, label, value) { const node = control(root, label); node.value = value; await node.fire(node.tagName === 'select' ? 'change' : 'input'); }
function dom(t, files) { const oldDocument = global.document; const oldWindow = global.window; global.document = { createElement: (tag) => new NodeStub(tag), createTextNode: (value) => new NodeStub('', value) }; global.window = { toolbox: { files } }; t.after(() => { global.document = oldDocument; global.window = oldWindow; }); }

test('L018 35种保序交错按COMMIT位置独立推导读值',async()=>{
  const {example}=await model(); function interleave(a,b,prefix=[]){if(!a&&!b)return[prefix];return[...(a?interleave(a-1,b,[...prefix,'T1']):[]),...(b?interleave(a,b-1,[...prefix,'T2']):[])];} const schedules=interleave(4,3); assert.equal(schedules.length,35);
  for(const schedule of schedules){const t1Positions=schedule.map((id,i)=>id==='T1'?i:-1).filter(i=>i>=0); const commit=schedule.lastIndexOf('T2'); const rcExpected=t1Positions.slice(1,3).map(i=>i>commit?20:10); const rrExpected=Array(2).fill(t1Positions[0]>commit?20:10); const result=await replay(example(),schedule); assert.deepEqual(result.RC.transactions.T1.reads.map(r=>r.value),rcExpected); assert.deepEqual(result.RR.transactions.T1.reads.map(r=>r.value),rrExpected);}
});
test('L018 实际组件核心手动调度、历史与完整安全副本',async(t)=>{
  const exported=[];const stored=new Map();dom(t,{saveTextSupportsCopyOnly:true,saveText:async(payload)=>{exported.push(payload);return{ok:true};}});const{default:feature}=await import('../src/renderer/features/L018/index.js');const root=new NodeStub('div');const config={get:key=>stored.get(key),set:(key,value)=>stored.set(key,value)};const handle=feature.create(root,{config});t.after(()=>handle.destroy());
  await button(root,'开始 / 重置重放').fire('click');for(const id of coreSchedule)await button(root,`执行 ${id} 下一步`).fire('click');assert.match(root.textContent,/T1非重复读：步骤2值10 → 步骤6值20/);assert.match(root.textContent,/调度用尽/);assert.equal(button(root,'执行 T1 下一步').disabled,true);assert.equal(button(root,'执行 T2 下一步').disabled,true);
  await fill(root,'查看重放步骤','1');assert.match(root.textContent,/历史步骤2：T1 READ/);await button(root,'上个步骤').fire('click');assert.equal(button(root,'上个步骤').disabled,true);await button(root,'下个步骤').fire('click');
  await button(root,'导出完整 JSON').fire('click');const payload=JSON.parse(exported[0].content);assert.deepEqual(payload.result.schedule,coreSchedule);assert.deepEqual(payload.result.RR.transactions.T1.reads.map(r=>r.value),[10,10]);assert.equal(exported[0].copyOnly,true);assert.equal(payload.schemaVersion,1);
  await button(root,'导出完整 Markdown').fire('click');assert.match(exported[1].content,/步骤6 T1 READ/);assert.equal(exported[1].copyOnly,true);assert.doesNotMatch(root.textContent,/\[object Object\]|null/);
  handle.deactivate();const state=stored.get('features.L018.state');assert.equal(state.schemaVersion,1);assert.equal(Object.hasOwn(state,'result'),false);const restoredRoot=new NodeStub('div');const restored=feature.create(restoredRoot,{config});assert.match(restoredRoot.textContent,/已恢复输入草稿/);assert.match(restoredRoot.textContent,/尚无重放结果/);assert.equal(control(restoredRoot,'T1脚本').value,payload.draft.t1);restored.destroy();assert.equal(restoredRoot.children.length,0);
});
test('L018 UI真实字段编辑、回滚模板/双写覆盖/重置',async(t)=>{
  const exported=[];dom(t,{saveTextSupportsCopyOnly:true,saveText:async(p)=>{exported.push(JSON.parse(p.content));return{ok:true};}});const{default:feature}=await import('../src/renderer/features/L018/index.js');const root=new NodeStub('div');const handle=feature.create(root);t.after(()=>handle.destroy());
  await button(root,'载入暂存与回滚示例').fire('click');await button(root,'开始 / 重置重放').fire('click');for(const id of ['T1','T1','T1','T2','T2','T1','T1','T2'])await button(root,`执行 ${id} 下一步`).fire('click');await button(root,'导出完整 JSON').fire('click');assert.equal(exported[0].result.RR.committed,10);assert.equal(exported[0].result.RR.transactions.T1.status,'rolledback');assert.equal(exported[0].result.RC.transactions.T2.reads[0].value,10);
  await button(root,'载入双写覆盖示例').fire('click');await button(root,'开始 / 重置重放').fire('click');for(const id of ['T1','T2','T1','T2','T1','T2'])await button(root,`执行 ${id} 下一步`).fire('click');assert.match(root.textContent,/覆盖提示/);await button(root,'导出完整 JSON').fire('click');assert.equal(exported[1].result.RC.committed,20);
  await fill(root,'初始已提交值','-3');assert.match(root.textContent,/旧调度\/轨迹已清空/);await fill(root,'T1脚本','BEGIN\nWRITE 0\nREAD\nCOMMIT');await fill(root,'T2脚本','BEGIN\nREAD\nROLLBACK');await button(root,'开始 / 重置重放').fire('click');assert.match(root.textContent,/原始已提交值 -3/);await button(root,'执行 T1 下一步').fire('click');await button(root,'开始 / 重置重放').fire('click');assert.match(root.textContent,/已执行 0 \/ 48步/);assert.doesNotMatch(root.textContent,/\[object Object\]|null/);
});
test('L018 UI无效生命周期原因/未提交脚本终点/语法错误清结果',async(t)=>{
  dom(t,{});const{default:feature}=await import('../src/renderer/features/L018/index.js');const root=new NodeStub('div');const handle=feature.create(root);t.after(()=>handle.destroy());await fill(root,'T1脚本','READ\nBEGIN\nWRITE 7');await fill(root,'T2脚本','ROLLBACK');await button(root,'开始 / 重置重放').fire('click');await button(root,'执行 T1 下一步').fire('click');assert.match(root.textContent,/READ无效：事务状态idle/);for(const id of ['T1','T1','T2'])await button(root,`执行 ${id} 下一步`).fire('click');assert.match(root.textContent,/脚本已用尽但T1仍为active/);await fill(root,'T1脚本','<img src=x>');await button(root,'开始 / 重置重放').fire('click');assert.match(root.textContent,/第1条不合法/);assert.doesNotMatch(root.textContent,/当前状态 读提交/);await fill(root,'初始已提交值','1000001');await button(root,'开始 / 重置重放').fire('click');assert.match(root.textContent,/范围为/);
});
test('L018 UI草稿容量、版本恢复、取消/失败导出与释放',async(t)=>{
  let saves=0;let writes=0;dom(t,{saveText:async()=>{saves++;return{canceled:true};}});const{default:feature}=await import('../src/renderer/features/L018/index.js');const root=new NodeStub('div');const handle=feature.create(root,{config:{set:()=>{writes++;}}});t.after(()=>handle.destroy());await button(root,'导出完整 JSON').fire('click');assert.equal(saves,0);assert.match(root.textContent,/缺少防覆盖/);window.toolbox.files.saveTextSupportsCopyOnly=true;await button(root,'导出完整 Markdown').fire('click');assert.match(root.textContent,/已取消导出/);window.toolbox.files.saveText=async()=>{throw new Error('磁盘失败');};await button(root,'导出完整 JSON').fire('click');assert.match(root.textContent,/导出失败：磁盘失败/);
  await fill(root,'初始已提交值','汉'.repeat(22000));let before=writes;handle.deactivate();assert.equal(writes,before);assert.match(root.textContent,/当前输入未写入全局配置/);await fill(root,'初始已提交值','10');await fill(root,'T1脚本','汉'.repeat(1400));before=writes;handle.deactivate();assert.equal(writes,before);assert.match(root.textContent,/脚本超过4096/);
  const{prepareStoredState,example}=await model();for(const raw of [{schemaVersion:2},{...prepareStoredState(example()),hidden:'汉'.repeat(22000)},{...prepareStoredState(example()),t1:2}]){const r=new NodeStub('div');const h=feature.create(r,{config:{get:()=>raw}});assert.match(r.textContent,/草稿未能恢复/);h.destroy();}
  await fill(root,'T1脚本','BEGIN');handle.destroy();assert.equal(root.children.length,0);assert.doesNotMatch(root.className,/feature-l018/);handle.destroy();
});
