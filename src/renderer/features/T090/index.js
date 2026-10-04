import {h} from '../../core/ui.js';
import {example,calculateCapacity,restore,duration,markdown} from './model.mjs';
export default{id:'T090',create(root){
 let draft=example(),report=null,alive=true,busy=false,serial=6;
 const days=h('div'),tasks=h('div'),output=h('div'),status=h('p',{role:'status','aria-live':'polite',class:'t090-status'});
 const files=window.toolbox?.files,safeSave=()=>files?.saveTextSupportsCopyOnly===true&&typeof files.saveText==='function';
 const say=text=>{if(alive)status.textContent=text;};
 const button=(text,fn)=>h('button',{type:'button',class:'btn',onclick:fn},text);
 const invalidate=()=>{report=null;output.replaceChildren();exports.forEach(b=>{b.disabled=true;});say('输入已变化，请重新核算。');};
 const field=(label,value,set,aria,maxlength=20)=>{const node=h('input',{type:'text',maxlength,'aria-label':aria,oninput:()=>{set(node.value);invalidate();}});node.value=value;return h('label',{},label,node);};
 const table=(headers,rows)=>h('div',{class:'t090-scroll'},h('table',{},h('thead',{},h('tr',{},headers.map(v=>h('th',{scope:'col'},v)))),h('tbody',{},rows.map(row=>h('tr',{},row.map(v=>h('td',{},String(v))))))));
 function editors(){
  days.replaceChildren(...draft.days.map((d,i)=>h('section',{class:'t090-row'},field('日期',d.date,v=>d.date=v,`日期${i+1}`,10),field('可用分钟',d.available,v=>d.available=v,`日期${i+1}可用分钟`,4),field('固定占用分钟',d.fixed,v=>d.fixed=v,`日期${i+1}固定占用分钟`,4),button(`删除日期${i+1}`,()=>{if(draft.days.length===1){say('至少保留一个日期。');return;}draft.days.splice(i,1);invalidate();editors();}))));
  tasks.replaceChildren(...draft.tasks.map((t,i)=>{const check=h('input',{type:'checkbox','aria-label':`任务${i+1}可延后`,onchange:()=>{t.deferrable=check.checked;invalidate();}});check.checked=t.deferrable;return h('section',{class:'t090-row'},h('strong',{},t.id),field('标题',t.title,v=>t.title=v,`任务${i+1}标题`,120),field('分配日期',t.date,v=>t.date=v,`任务${i+1}日期`,10),field('估时分钟',t.minutes,v=>t.minutes=v,`任务${i+1}估时分钟`,4),h('label',{},'允许人工延后',check),button(`删除任务${i+1}`,()=>{draft.tasks.splice(i,1);invalidate();editors();}));}));
 }
 function run(){invalidate();try{report=calculateCapacity(draft);const r=report;
  output.replaceChildren(h('p',{class:'t090-summary'},`总可用 ${duration(r.totals.availableMinutes)}；总负荷 ${duration(r.totals.loadMinutes)}；总量${r.totals.netMinutes>=0?'净余':'不足'} ${duration(Math.abs(r.totals.netMinutes))}。超负荷 ${r.overloadedDates.length} 日，逐日缺口合计 ${duration(r.totals.dailyDeficitMinutes)}。`),h('p',{},`其他日期余量合计 ${duration(r.totals.dailySpareMinutes)}。总量有余仍可能单日超负荷，未跨日期自动调配。`),
   table(['日期','可用分钟','固定占用','任务分钟','总负荷','缺口','余量'],r.days.map(d=>[d.date,d.availableMinutes,d.fixedMinutes,d.taskMinutes,d.loadMinutes,d.deficitMinutes,d.spareMinutes])),h('h3',{},'用户标记可延后的候选'),h('p',{},'每行是独立移走这一项的试算。没有更改原日期或估时，也没有替你选择新日期；多行效果不能直接相加。'),table(['任务','原日期','原估时分钟','当天原缺口','仅移走此项后缺口'],r.candidates.map(t=>[t.id+' '+t.title,t.originalDate,t.originalEstimateMinutes,t.dayDeficitMinutes,t.deficitIfRemovedMinutes])),h('details',{},h('summary',{},'完整输入与核算结果'),h('pre',{},JSON.stringify(r,null,2))));
  exports.forEach(b=>{b.disabled=!safeSave();});say('核算完成，原任务与日期保持不变。');
 }catch(error){say('核算失败：'+error.message);}}
 async function save(ext){if(!report||!safeSave()||busy)return;const snapshot=report;busy=true;exports.forEach(b=>b.disabled=true);try{const r=await files.saveText({content:ext==='json'?JSON.stringify(snapshot,null,2):markdown(snapshot),extension:ext,defaultName:`T090-capacity.${ext}`,copyOnly:true});say(r?.ok===true?'容量报告副本已保存。':r?.canceled?'已取消保存，报告保留。':'保存失败：'+(r?.error||'未确认保存成功'));}catch(e){say('保存失败：'+e.message);}finally{busy=false;if(alive)exports.forEach(b=>b.disabled=!report||!safeSave());}}
 const exports=[button('导出容量 JSON 副本',()=>save('json')),button('导出容量 Markdown 副本',()=>save('md'))];exports.forEach(b=>b.disabled=true);
 const json=h('textarea',{rows:4,maxlength:65536,'aria-label':'容量报告JSON'});
 root.replaceChildren(h('section',{class:'t090'},h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href}),h('h2',{},'计划工时与容量核算'),h('p',{},'所有时长均填整数分钟；逐日比较任务估时、固定占用与当天可用时长。固定占用包括已经保留的会议或日常安排，请避免与任务重复填写。'),
 button('载入周容量20小时示例',()=>{draft=example();invalidate();editors();run();}),h('h3',{},'逐日容量（1–31天，可不连续）'),days,button('添加日期',()=>{if(draft.days.length>=31){say('最多31个日期。');return;}draft.days.push({date:'',available:'0',fixed:'0'});invalidate();editors();}),h('h3',{},'已分配日期的任务（最多200项）'),tasks,
 button('添加任务',()=>{if(draft.tasks.length>=200){say('最多200项任务。');return;}let id;do{id='T'+serial++;}while(draft.tasks.some(t=>t.id===id));draft.tasks.push({id,title:'新任务',date:draft.days[0].date,minutes:'60',deferrable:false});invalidate();editors();}),button('核算每日容量',run),status,output,h('div',{class:'t090-actions'},exports),
 h('details',{},h('summary',{},'从本功能JSON恢复输入'),json,button('恢复容量草案',()=>{try{const next=restore(json.value);draft=next;invalidate();editors();run();say('已恢复输入并重新核算，导入的旧派生结果未被采用。');}catch(e){say('恢复失败，原草案保留：'+e.message);}})),
 h('p',{},'日期1900–2100年；每日期可用/固定占用0–1440分钟，每任务估时1–1440分钟。任务日期必须存在于容量表，重复日期或编号拒绝。候选只来自超负荷日并由用户允许延后。输入仅在当前面板内存，切换前导出；JSON恢复限64KiB UTF-8。副本接口缺失时导出禁用。')));
 editors();return{activate(){},deactivate(){},destroy(){alive=false;root.replaceChildren();}};
}};
