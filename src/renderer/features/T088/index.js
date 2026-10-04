import {h} from '../../core/ui.js';
import {calculateLuggage,example} from './model.mjs';
const kg=g=>(g/1000).toFixed(3)+' kg';
const css=`.t088{display:grid;gap:12px;margin:auto;max-width:1300px}.t088 label{display:grid;gap:4px}.t088 input,.t088 select,.t088 textarea{padding:7px;background:var(--bg-sunken);color:var(--text);border:1px solid var(--line);border-radius:4px}.t088 input{max-width:160px}.t088 .t088-editor{padding:10px;border:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:8px 0}.t088 .t088-actions{display:flex;gap:8px;flex-wrap:wrap}.t088 .t088-muted{font-size:13px;color:var(--text-dim);line-height:1.6}.t088 .t088-scroll{overflow:auto}.t088 table{border-collapse:collapse;width:100%;font-size:13px}.t088 td,.t088 th{padding:8px;border-bottom:1px solid var(--line);text-align:left}.t088 pre{white-space:pre-wrap;overflow-wrap:anywhere}.t088 .t088-status{padding:10px;background:var(--bg-sunken)}`;
export default{
 id:'T088',
 create(root){
  let draft=example(),report=null,alive=true,exporting=false,serial=3;
  const bagsHost=h('div'),itemsHost=h('div'),output=h('div'),status=h('p',{class:'t088-status',role:'status','aria-live':'polite'},'按自己填写的限重核对手动分包草案。');
  const button=(title,fn,disabled=false)=>h('button',{type:'button',class:'btn',onclick:fn,disabled},title);
  const say=text=>{if(alive)status.textContent=text;};
  const files=window.toolbox?.files,safeSave=()=>files?.saveTextSupportsCopyOnly===true&&typeof files.saveText==='function';
  const invalidate=()=>{report=null;output.replaceChildren();save.disabled=true;say('输入已改变，请重新核对重量预算。');};
  const field=(label,value,setter,aria,maxlength=20)=>{const input=h('input',{type:'text',maxlength,'aria-label':aria,oninput:()=>{setter(input.value);invalidate();}});input.value=value;return h('label',{},label,input);};
  const unit=(value,setter,aria)=>{const select=h('select',{'aria-label':aria,onchange:()=>{setter(select.value);invalidate();}},h('option',{value:'g'},'克 g'),h('option',{value:'kg'},'千克 kg'));select.value=value;return h('label',{},'单位',select);};
  function renderEditor(){
   bagsHost.replaceChildren(...draft.bags.map((bag,index)=>h('section',{class:'t088-editor','aria-label':'包'+(index+1)},h('strong',{},bag.id),
    field('包名称',bag.name,value=>{bag.name=value;},'包'+(index+1)+'名称',80),field('限重',bag.limit,value=>{bag.limit=value;},'包'+(index+1)+'限重'),unit(bag.limitUnit,value=>{bag.limitUnit=value;},'包'+(index+1)+'限重单位'),
    field('空包自重',bag.tare,value=>{bag.tare=value;},'包'+(index+1)+'自重'),unit(bag.tareUnit,value=>{bag.tareUnit=value;},'包'+(index+1)+'自重单位'),
    button('删除包 '+(index+1),()=>{draft.bags.splice(index,1);draft.items.forEach(item=>delete item.allocations[bag.id]);invalidate();renderEditor();},draft.bags.length===1))));
   itemsHost.replaceChildren(...draft.items.map((item,index)=>h('section',{class:'t088-editor','aria-label':'物品'+(index+1)},h('strong',{},item.id),
    field('物品名称',item.name,value=>{item.name=value;},'物品'+(index+1)+'名称',80),field('单件重量',item.weight,value=>{item.weight=value;},'物品'+(index+1)+'重量'),unit(item.unit,value=>{item.unit=value;},'物品'+(index+1)+'单位'),
    field('所拥有数量',item.quantity,value=>{item.quantity=value;},'物品'+(index+1)+'数量',5),
    ...draft.bags.map(bag=>field('分到 '+bag.name+' 数量',item.allocations[bag.id]??'0',value=>{item.allocations[bag.id]=value;},'物品'+(index+1)+'分到'+bag.id,5)),
    button('删除物品 '+(index+1),()=>{draft.items.splice(index,1);invalidate();renderEditor();}))));
   addBag.disabled=draft.bags.length>=10;addItem.disabled=draft.items.length>=100;
  }
  const table=(headers,rows)=>h('div',{class:'t088-scroll'},h('table',{},h('thead',{},h('tr',{},headers.map(title=>h('th',{scope:'col'},title)))),h('tbody',{},rows.map(cells=>h('tr',{},cells.map(text=>h('td',{},String(text))))))));
  function calculate(){
   invalidate();try{
    report=calculateLuggage(draft);
    output.replaceChildren(h('p',{class:'t088-summary'},`超重 ${report.overweightBags} 个包；未分配 ${kg(report.unassignedGrams)}。${report.complete?'全部物品已分配且各包在手填限重以内。':'草案未完整满足手填重量规则。'}`),
     table(['包','限重','空包自重','物品重','总重','超重/余量'],report.bags.map(b=>[b.name,kg(b.limitGrams),kg(b.tareGrams),kg(b.itemGrams),kg(b.totalGrams),b.overGrams?'超重 '+kg(b.overGrams):'余量 '+kg(b.remainingGrams)])),
     ...report.bags.map(b=>h('section',{},h('h3',{},b.name+' 装包草案'),b.contents.length?table(['物品','数量','单件重量','合计'],b.contents.map(c=>[c.name,c.count,kg(c.unitGrams),kg(c.totalGrams)])):h('p',{},'未分配物品到此包。'))),
     h('h3',{},'未分配物品'),table(['物品','所拥有数量','已分配','尚未分配','未分配重量'],report.items.filter(i=>i.unassigned>0).map(i=>[i.name,i.quantity,i.assigned,i.unassigned,kg(i.unassignedGrams)])),
     h('details',{},h('summary',{},'完整整数克、来源与输入审计'),h('pre',{},JSON.stringify(report,null,2))));
    save.disabled=!safeSave();say('核对完成；物品分配及包限重由你填写，未自动查询航司规则。');
   }catch(error){report=null;say(error.message);}
  }
  const addBag=button('添加包',()=>{if(draft.bags.length>=10)return;let id;do{id='B'+serial++;}while(draft.bags.some(b=>b.id===id));draft.bags.push({id,name:'新包',limit:'7',limitUnit:'kg',tare:'0',tareUnit:'g'});invalidate();renderEditor();});
  const addItem=button('添加物品',()=>{if(draft.items.length>=100)return;let id;do{id='I'+serial++;}while(draft.items.some(i=>i.id===id));draft.items.push({id,name:'新物品',weight:'100',unit:'g',quantity:'1',allocations:{}});invalidate();renderEditor();});
  const save=button('导出行李预算 JSON',async()=>{
   if(!report||!safeSave()||exporting)return;const snapshot=report;exporting=true;save.disabled=true;
   try{const r=await files.saveText({content:JSON.stringify(snapshot,null,2),extension:'json',defaultName:'T088-luggage-plan.json',copyOnly:true});say(r?.ok?'重量预算副本已保存。':r?.canceled?'已取消保存。':'保存失败：'+(r?.error||'未确认成功'));}
   catch(error){say('保存失败：'+error.message);}finally{exporting=false;if(alive)save.disabled=!report||!safeSave();}
  });save.disabled=true;
  const importText=h('textarea',{rows:4,maxlength:200000,'aria-label':'预算报告JSON',placeholder:'粘贴本工具导出的JSON，恢复其中inputs。'});
  root.replaceChildren(h('section',{class:'t088'},h('style',{},css),h('h2',{},'行李重量预算'),
   h('p',{},'手填各包限重与物品单件重，按数量手动分包；整数克计算超重、余量和未分配物品。'),
   h('p',{class:'t088-muted'},'空包自重也算入限重。拆分物品时给不同包分配数量；分配总数不可超过拥有数。未分配物品不会偷偷算入某个包，删除包后其分配返回未分配。'),
   h('div',{class:'t088-actions'},button('载入7kg限重示例',()=>{draft=example();invalidate();renderEditor();calculate();}),button('示例移走2kg',()=>{draft=example();draft.items[1].allocations.B1='0';invalidate();renderEditor();calculate();})),
   h('h3',{},'包和限重'),bagsHost,addBag,h('h3',{},'物品及各包分配数量'),itemsHost,addItem,
   button('核对重量预算',calculate),status,output,save,
   h('details',{},h('summary',{},'从导出JSON恢复草案'),importText,button('恢复预算草案',()=>{
    try{if(importText.value.length>200000)throw Error('恢复输入最多200000字符。');const parsed=JSON.parse(importText.value);if(parsed.feature!=='T088'||parsed.schemaVersion!==1)throw Error('仅支持T088版本1报告。');calculateLuggage(parsed.inputs);draft=JSON.parse(JSON.stringify(parsed.inputs));invalidate();renderEditor();calculate();say('已恢复输入并重新计算，请核对当前限重。');}catch(error){say('恢复失败，原草案保留：'+error.message);}
   })),
   h('p',{class:'t088-muted'},'最多10包、100种物品；单件/限重/空包自重≤100,000,000克，数量1–10000。克必须整数，千克最多3位小数。结果是手动分包草案；重量符合不能证明尺寸、件数、危险品或实际运输要求符合。输入留在当前面板内存，切换功能前先导出。'),
   ...(!safeSave()?[h('p',{class:'t088-muted'},'当前缺少安全副本接口，导出已禁用。')]:[])));
  renderEditor();return{activate(){},deactivate(){},destroy(){alive=false;root.replaceChildren();}};
 }
};
