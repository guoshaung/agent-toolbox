import {h} from '../../core/ui.js';
import {CATEGORIES,blank,example,inspectMaterials,storedProject,reportMarkdown} from './model.mjs';
const KEY='features.L033.project';
const LABEL={ready:'已确认材料',missing:'缺失',pending:'待确认'};
const css=`.l033{display:grid;gap:12px;margin:auto;max-width:1100px}.l033 label{display:grid;gap:5px}.l033 input,.l033 textarea{padding:8px;color:var(--text);background:var(--bg-sunken);border:1px solid var(--line);border-radius:5px}.l033 textarea{resize:vertical}.l033 .l033-category{padding:12px;display:grid;gap:10px;border:1px solid var(--line);border-radius:7px;margin:10px 0}.l033 .l033-confirm{display:flex;align-items:center;gap:8px}.l033 .l033-muted{font-size:13px;color:var(--text-dim);line-height:1.6}.l033 .l033-actions{display:flex;gap:8px;flex-wrap:wrap}.l033 .l033-summary{padding:12px;background:var(--bg-sunken)}.l033 .l033-scroll{overflow:auto}.l033 table{border-collapse:collapse;width:100%}.l033 td,.l033 th{padding:8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}.l033 pre{white-space:pre-wrap;overflow-wrap:anywhere}`;
export default{
 id:'L033',
 create(root,ctx={}){
  let project=blank(),report=null,destroyed=false,active=false,timer=null,exporting=false;
  const editor=h('div'),output=h('div'),notice=h('p',{role:'status','aria-live':'polite',class:'l033-muted'}),storage=h('p',{role:'status',class:'l033-muted'});
  try{const old=ctx.config?.get(KEY);if(old){project=storedProject(old);notice.textContent='已恢复材料草稿，请重新检查确认状态；没有执行复现实验。';}}catch(error){notice.textContent='旧草稿未恢复：'+error.message;}
  const button=(title,fn)=>h('button',{class:'btn',type:'button',onclick:fn},title);
  const say=text=>{if(!destroyed)notice.textContent=text;};
  function persist(){if(destroyed||!ctx.config?.set)return;try{const snapshot=storedProject(project);Promise.resolve(ctx.config.set(KEY,snapshot)).then(()=>{if(!destroyed)storage.textContent='已保存本机材料草稿；结果需重新检查。';}).catch(error=>{if(!destroyed)storage.textContent='草稿保存失败：'+error.message;});}catch(error){storage.textContent=error.message+' 未写入配置，请导出报告保留当前内容。';}}
  function changed(){report=null;output.replaceChildren();json.disabled=md.disabled=true;say('材料已改变，请重新检查准备清单。');if(timer!==null)clearTimeout(timer);timer=null;if(active)timer=setTimeout(()=>{timer=null;persist();},250);}
  function renderEditor(){
   const title=h('input',{'aria-label':'材料项目名称',maxlength:120,oninput:()=>{project.title=title.value;changed();}});title.value=project.title;
   editor.replaceChildren(h('label',{},'项目名称',title),...CATEGORIES.map(category=>{
    const item=project.items[category.id],confirmed=h('input',{type:'checkbox','aria-label':category.name+'材料已确认',onchange:()=>{item.confirmed=confirmed.checked;changed();}});confirmed.checked=item.confirmed;
    const evidence=h('textarea',{rows:4,maxlength:4000,'aria-label':category.name+'材料证据',placeholder:category.hint,oninput:()=>{item.evidence=evidence.value;item.confirmed=false;confirmed.checked=false;changed();}});evidence.value=item.evidence;
    const source=h('input',{maxlength:400,'aria-label':category.name+'材料来源',placeholder:'文件路径、页码或网址（仅记录，不读取）',oninput:()=>{item.source=source.value;item.confirmed=false;confirmed.checked=false;changed();}});source.value=item.source;
    return h('section',{class:'l033-category'},h('h3',{},category.name),h('p',{class:'l033-muted'},category.hint),h('label',{},'材料证据（至少说明版本/范围/取得情况）',evidence),h('label',{},'来源引用（可选）',source),h('label',{class:'l033-confirm'},confirmed,'我确认已经取得以上材料；工具未验证文件或实验结果。'));
   }));
  }
  const files=window.toolbox?.files,safeSave=()=>files?.saveTextSupportsCopyOnly===true&&typeof files.saveText==='function';
  function inspect(){changed();try{
   report=inspectMaterials(project);
   output.replaceChildren(h('p',{class:'l033-summary'},`材料完成率 ${report.ready}/5（${report.completion*100}%）；缺失 ${report.missing.length} 类，待确认 ${report.pending.length} 类。`),
    h('p',{},report.scope),h('div',{class:'l033-scroll'},h('table',{},h('thead',{},h('tr',{},['类别','状态','下一步','证据','来源'].map(label=>h('th',{scope:'col'},label)))),h('tbody',{},report.categories.map(c=>h('tr',{},h('td',{},c.name),h('td',{},LABEL[c.status]),h('td',{},c.reason),h('td',{},c.evidence||'未填写'),h('td',{},c.source||'未填写')))))),
    h('details',{},h('summary',{},'完整清单预览'),h('pre',{},JSON.stringify(report,null,2))));
   json.disabled=md.disabled=!safeSave();say('检查完成；请依据缺失与待确认清单继续收集材料。');
  }catch(error){report=null;say(error.message);}}
  async function save(extension){if(!report||exporting||!safeSave())return;const snapshot=report;exporting=true;json.disabled=md.disabled=true;try{
   const r=await files.saveText({content:extension==='json'?JSON.stringify(snapshot,null,2):reportMarkdown(snapshot),extension,defaultName:'L033-materials.'+extension,copyOnly:true});say(r?.ok?'材料清单副本已保存。':r?.canceled?'已取消保存。':'保存失败：'+(r?.error||'未确认成功'));
  }catch(error){say('保存失败：'+error.message);}finally{exporting=false;if(!destroyed)json.disabled=md.disabled=!report||!safeSave();}}
  const json=button('导出材料 JSON',()=>save('json')),md=button('导出材料 Markdown',()=>save('md'));json.disabled=md.disabled=true;
  const restore=h('textarea',{rows:4,maxlength:128000,'aria-label':'材料项目JSON',placeholder:'粘贴本工具导出的JSON报告或版本1草稿。'});
  root.replaceChildren(h('section',{class:'l033'},h('style',{},css),h('h2',{},'复现实验材料清单'),
   h('p',{},'按数据、代码、参数、环境、评估证据五类记录已有材料。只有非空证据且经人工确认，才计入材料完成率。'),
   h('div',{class:'l033-actions'},button('载入缺两类示例',()=>{project=example();changed();renderEditor();inspect();}),button('新建空白材料项目',()=>{project=blank();changed();renderEditor();})),
   notice,storage,editor,button('检查材料准备情况',inspect),output,h('div',{class:'l033-actions'},json,md),
   h('details',{},h('summary',{},'恢复材料项目'),restore,button('恢复材料项目',()=>{try{if(restore.value.length>128000)throw Error('JSON输入超过128000字符。');const parsed=JSON.parse(restore.value),candidate=storedProject(parsed.input??parsed);project=candidate;changed();renderEditor();inspect();say('材料项目已恢复并重新检查，旧报告结果未直接采用。');}catch(error){say('恢复失败，当前项目保留：'+error.message);}})),
   h('p',{class:'l033-muted'},'证据修改或来源修改会取消该类的旧确认，需要重新勾选。来源是文字引用，不打开文件或访问网站。每类证据最多4000字符、来源400字符；草稿保存和恢复有64KiB UTF-8上限，超限保留界面内容并提示导出。只记录人工材料，不自动执行实验或生成AI证据。保存副本禁止覆盖已有文件，切换前应保留重要导出。'),
   ...(!safeSave()?[h('p',{class:'l033-muted'},'当前缺少副本安全接口，报告导出不可用。')]:[])));
  renderEditor();return{activate(){active=true;},deactivate(){active=false;if(timer!==null)clearTimeout(timer);timer=null;persist();},destroy(){active=false;if(timer!==null)clearTimeout(timer);timer=null;persist();destroyed=true;root.replaceChildren();}};
 }
};
