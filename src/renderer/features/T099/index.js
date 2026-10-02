import {h} from '../../core/ui.js';
import {KINDS,example,checklist,restore,resetCompletion,link,markdown} from './model.mjs';
export default{id:'T099',create(root){let draft=example(),report=null,alive=true,busy=false,nextAccount=2,nextItem=4;
 const host=h('div'),output=h('div'),status=h('p',{class:'t099-status',role:'status','aria-live':'polite'}),files=window.toolbox?.files,completionViews=new Map();
 const safeSave=()=>files?.saveTextSupportsCopyOnly===true&&typeof files.saveText==='function';
 const say=v=>{if(alive)status.textContent=v;};const button=(v,fn)=>h('button',{type:'button',class:'btn',onclick:fn},v);
 const invalidate=()=>{report=null;output.replaceChildren();exports.forEach(b=>b.disabled=true);say('输入或人工完成记录已改变，请重新生成准备清单。');};
 const field=(label,value,setter,aria,max=300)=>{const input=h('input',{type:'text',maxlength:max,'aria-label':aria,oninput:()=>{setter(input.value);invalidate();}});input.value=value;return h('label',{},label,input);};
 async function copy(value){try{const url=link(value);if(!url)throw Error('当前事项没有外链。');const api=window.toolbox?.clipboard;if(typeof api?.write!=='function')throw Error('当前环境没有剪贴板接口。');const result=await api.write(url);say(result===true?'外链已复制，请自行核对和使用。':'复制失败：接口未确认成功。');}catch(e){say('复制失败：'+e.message);}}
 const completionText=t=>t.done?'人工确认UTC：'+t.confirmedAt:'待处理；尚无人工作出完成声明';
 function refreshCompletion(t){const v=completionViews.get(t.id);if(v){v.done.checked=t.done;v.stamp.textContent=completionText(t);}}
 function editors(){completionViews.clear();host.replaceChildren(...draft.accounts.map((a,ai)=>h('section',{class:'t099-account'},h('h3',{},a.id),field('账号名称',a.name,v=>{if(v!==a.name)a.items.forEach(t=>{resetCompletion(t);refreshCompletion(t);});a.name=v;},`账号${ai+1}名称`,120),button(`删除账号${ai+1}`,()=>{if(draft.accounts.length===1){say('至少保留一个账号。');return;}draft.accounts.splice(ai,1);invalidate();editors();}),...a.items.map((t,ti)=>{
  const set=(key,v)=>{if(t[key]!==v){resetCompletion(t);refreshCompletion(t);}t[key]=v;};
  const kind=h('select',{'aria-label':`${a.id}事项${ti+1}类别`,onchange:()=>{set('kind',kind.value);invalidate();editors();}},Object.entries(KINDS).map(([key,label])=>h('option',{value:key},label)));kind.value=t.kind;
  const done=h('input',{type:'checkbox','aria-label':`${a.id}事项${ti+1}人工完成`,onchange:()=>{t.done=done.checked;t.confirmedAt=t.done?new Date().toISOString():null;invalidate();editors();}});done.checked=t.done;
  const stamp=h('small',{},completionText(t));completionViews.set(t.id,{done,stamp});
  return h('div',{class:'t099-item'},h('strong',{},t.id),h('label',{},'类别',kind),field('准备事项',t.title,v=>set('title',v),`${a.id}事项${ti+1}标题`,160),field('外链（只可复制）',t.url,v=>set('url',v),`${a.id}事项${ti+1}外链`,500),field('备注',t.note,v=>{t.note=v;},`${a.id}事项${ti+1}备注`,300),h('label',{},'我已人工完成',done),stamp,button(`复制外链 ${t.id}`,()=>copy(t.url)),button(`删除事项 ${t.id}`,()=>{if(a.items.length===1){say('每账号至少保留一项。');return;}a.items.splice(ti,1);invalidate();editors();}));}),button(`添加事项 ${a.id}`,()=>{if(a.items.length>=50||draft.accounts.reduce((s,x)=>s+x.items.length,0)>=200){say('每账号最多50项，全部最多200项。');return;}let id;do{id='I'+nextItem++;}while(draft.accounts.some(x=>x.items.some(t=>t.id===id)));a.items.push({id,kind:'other',title:'新准备事项',url:'',note:'',done:false,confirmedAt:null});invalidate();editors();}))));}
 function generate(){
  invalidate();
  try{
   report=checklist(draft);
   const accounts=report.accounts.map(a=>h('section',{},
    h('h3',{},`${a.name}：人工完成${a.done}/${a.total}`),
    h('p',{},Object.entries(a.byKind).map(([k,n])=>`${KINDS[k]} ${n}`).join(' · ')),
    h('ol',{},a.items.map(t=>h('li',{},`${t.kindLabel} · ${t.title} · ${t.done?'人工完成':'待处理'}${t.url?' · 外链文本：'+t.url:''}${t.note?' · '+t.note:''}`)))
   ));
   output.replaceChildren(h('p',{class:'t099-summary'},`共 ${report.accounts.length} 个账号、${report.total} 项准备；人工完成 ${report.done}，待处理 ${report.pending}。`),...accounts,h('p',{},report.policy));
   exports.forEach(b=>b.disabled=busy||!safeSave());say('准备清单已生成；完成记录只代表你手工声明。');
  }catch(e){say('生成失败：'+e.message);}
 }
 async function save(ext){if(!report||!safeSave()||busy)return;busy=true;exports.forEach(b=>b.disabled=true);const snapshot=report;try{const r=await files.saveText({content:ext==='json'?JSON.stringify(snapshot,null,2):markdown(snapshot),extension:ext,defaultName:`T099-account-preparation.${ext}`,copyOnly:true});say(r?.ok===true?'准备清单副本已保存。':r?.canceled?'已取消保存，清单保留。':'保存失败：'+(r?.error||'未确认保存成功'));}catch(e){say('保存失败：'+e.message);}finally{busy=false;if(alive)exports.forEach(b=>b.disabled=!report||!safeSave());}}
 const exports=[button('导出清单 JSON 副本',()=>save('json')),button('导出清单 Markdown 副本',()=>save('md'))];exports.forEach(b=>b.disabled=true);const pasted=h('textarea',{rows:4,maxlength:65536,'aria-label':'恢复清单JSON'});
 root.replaceChildren(h('section',{class:'t099'},h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href}),h('h2',{},'账号注销材料清单'),h('p',{},'按手填账号整理数据导出、解绑事项和其他准备；外链保留为文本，复制后由你自行使用。'),button('载入两导出一解绑示例',()=>{draft=example();invalidate();editors();generate();}),host,button('添加账号',()=>{if(draft.accounts.length>=20){say('最多20个账号。');return;}if(draft.accounts.reduce((s,a)=>s+a.items.length,0)>=200){say('全部账号合计最多200项。');return;}let id;do{id='A'+nextAccount++;}while(draft.accounts.some(a=>a.id===id));let itemId;do{itemId='I'+nextItem++;}while(draft.accounts.some(a=>a.items.some(t=>t.id===itemId)));draft.accounts.push({id,name:'新账号',items:[{id:itemId,kind:'other',title:'新准备事项',url:'',note:'',done:false,confirmedAt:null}]});invalidate();editors();}),button('生成准备清单',generate),status,output,h('div',{class:'t099-actions'},exports),h('details',{},h('summary',{},'从JSON恢复手填清单'),pasted,button('恢复手填清单',()=>{try{const next=restore(pasted.value);draft=next;invalidate();editors();generate();say('已恢复手填清单及人工声明，统计重新计算；未验证平台实际状态。');}catch(e){say('恢复失败，原清单保留：'+e.message);}})),h('p',{},'修改事项标题/类别/外链会撤销该项完成声明；修改账号名称撤销该账号全部完成声明。备注变更不影响状态。每账号1–50项，总量200项；当前面板内存保留，切换前导出JSON，恢复限制64KiB UTF-8。请填写账号标识及事项，不把口令当作材料。完成时间为本机UTC，仅为人工记录。')));
 editors();return{activate(){},deactivate(){},destroy(){alive=false;root.replaceChildren();}};
}};
