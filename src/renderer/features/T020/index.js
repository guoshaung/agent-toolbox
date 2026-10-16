import {h} from '../../core/ui.js';
export default{id:'T020',create(root){
 let alive=true,active=false,busy=false,nativePending=false,epoch=0,selection=null,report=null,preview=null,jobId=null,page=0;const bindings=[];
 const bridge=()=>window.toolbox?.features,available=()=>bridge()?.callHostSupported===true&&typeof bridge()?.callHost==='function';
 const on=(n,t,f)=>{n.addEventListener(t,f);bindings.push([n,t,f]);return n;},say=s=>{if(alive)status.textContent=s;};
 const status=h('p',{role:'status','aria-label':'操作状态'}),plan=h('pre',{'aria-label':'已选择巡检范围'}),results=h('div'),previewHost=h('pre',{'aria-label':'完整巡检报告预览'});
 const button=(label,fn,tracked=true)=>{const n=h('button',{type:'button',class:'btn'},label),callback=()=>{if(alive&&active&&!busy)fn();};if(tracked)on(n,'click',callback);else n.addEventListener('click',callback);return n;};
 const choose=button('选择允许巡检的目录',async()=>{
  invalidate();const own=epoch;selection=null;plan.textContent='';busy=true;update();
  try{const r=await bridge().callHost('T020','select',{});if(!current(own)){release();return;}if(r?.ok===true){selection=r;plan.textContent=JSON.stringify({root:r.root,limits:r.limits,mode:'只读元数据，未启动巡检；目录链接不进入，越界目标不检查'},null,2);say('目录已选择；核对范围后，明确确认才开始巡检。');}else say(r?.canceled?'目录选择已取消。':'目录未确认，不能启动巡检。');}catch{if(current(own))say('目录选择被拒绝或失败；仅支持当前窗口选择的实际普通目录。');}finally{finish(own);}
 });
 const run=button('确认以上目录并开始只读巡检',async()=>{
  if(!selection)return;invalidate();const own=epoch;busy=true;jobId=crypto.randomUUID();update();
  try{const r=await bridge().callHost('T020','scan',{selectionId:selection.selectionId,jobId,confirmed:true});if(!current(own))return;if(r?.ok!==true||r.report?.feature!=='T020')throw Error('未收到完整巡检结果。');report=r.report;page=0;render();say(`已巡检${report.summary.entries}条目、${report.summary.links}链接。${report.scanScopeComplete?'范围内元数据遍历完成。':'部分目录/条目不可读取，见未知项。'}尚未保存；未发现不等于没有问题。`);}catch{if(current(own))say('巡检未完成：可能已取消、超限、权限不足或目录变化。没有输出部分巡检报告。');}finally{finish(own);}
 });
 const cancel=on(h('button',{type:'button',class:'btn'},'取消当前巡检'),'click',()=>{if(!active||!busy||nativePending||!jobId)return;const id=jobId;epoch++;void bridge()?.cancelHost?.('T020',id).catch(()=>{});jobId=null;busy=false;report=preview=null;render();previewHost.textContent='';say('已请求取消，忽略晚回调，没有部分巡检报告。');update();});
 const json=button('预览完整 JSON 报告',()=>show('json')),md=button('预览完整 Markdown 报告',()=>show('md'));
 const save=button('保存已预览报告新副本',async()=>{
  const api=window.toolbox?.files;if(!preview||api?.saveTextSupportsCopyOnly!==true||typeof api.saveText!=='function')return;const own=epoch,chosen=preview;busy=nativePending=true;update();
  try{const r=await api.saveText({...chosen,copyOnly:true});if(!current(own))return;say(r?.ok===true?'完整巡检报告新副本保存成功。':r?.canceled===true?'已取消另存，预览保留。':`保存失败：${r?.error||'未确认写入'}${r?.partialPath?'；请人工核对 '+r.partialPath:''}`);}catch{if(current(own))say('保存失败，预览保留。');}finally{finish(own);}
 });
 const clear=button('清空范围与报告',()=>{invalidate();selection=null;plan.textContent='';release();say('范围及报告已清空，不会自动重新巡检。');update();});
 const current=own=>alive&&active&&epoch===own;
 function finish(own){if(current(own)){busy=nativePending=false;jobId=null;update();}}
 function release(){if(available())void bridge().callHost('T020','release',{}).catch(()=>{});}
 function invalidate(){epoch++;report=preview=null;results.replaceChildren();previewHost.textContent='';update();}
 function update(){if(!alive)return;choose.disabled=clear.disabled=!active||busy||!available();run.disabled=!active||busy||!selection||!available();cancel.disabled=!active||!busy||nativePending||!jobId;json.disabled=md.disabled=!active||busy||!report;save.disabled=!active||busy||!preview||window.toolbox?.files?.saveTextSupportsCopyOnly!==true;}
 function render(){
  results.replaceChildren();if(!report)return;const pages=Math.max(1,Math.ceil(report.links.length/50));page=Math.min(page,pages-1);const previous=button('上一页',()=>{page--;render();},false),next=button('下一页',()=>{page++;render();},false);previous.disabled=page===0;next.disabled=page===pages-1;
  const rows=report.links.slice(page*50,page*50+50).map(l=>h('tr',{},h('td',{},l.path),h('td',{},l.target??'目标未能读取'),h('td',{},l.resolution.status+(l.resolution.loopKind?' / '+l.resolution.loopKind:'')),h('td',{},l.resolution.resolvedPath??''),h('td',{},l.resolution.reason??l.resolution.errorCode??'')));
  results.append(h('p',{},`${report.summary.links}链接 · 第${page+1}/${pages}页；报告包含全部链接、链条和未知项。`),h('div',{class:'t020-row'},previous,next),h('table',{},h('thead',{},h('tr',{},...['链接相对位置','原始目标','状态','解析位置','原因'].map(s=>h('th',{},s)))),h('tbody',{},rows)),h('pre',{'aria-label':'范围与不可读项'},JSON.stringify({summary:report.summary,scanScopeComplete:report.scanScopeComplete,errors:report.errors},null,2)));update();
 }
 function show(kind){if(!report)return;const body=JSON.stringify(report,null,2);preview={content:kind==='json'?body:'# 符号链接与断链只读巡检\n\n完整结构化报告（绝对路径可能含私人信息）：\n\n'+('`'.repeat(10))+'json\n'+body.replaceAll('`','\\u0060')+'\n'+('`'.repeat(10))+'\n',extension:kind==='json'?'json':'md',defaultName:`symlink-audit-copy.${kind==='json'?'json':'md'}`};previewHost.textContent=preview.content;say('完整报告已预览；含绝对根路径/链接目标/解析链，分享前核对。保存为新副本。');update();}
 function leave(){epoch++;if(jobId)void bridge()?.cancelHost?.('T020',jobId).catch(()=>{});jobId=null;busy=nativePending=false;selection=report=preview=null;plan.textContent=previewHost.textContent='';results.replaceChildren();release();update();}
 const hide=()=>{if(alive&&document.hidden){leave();say('窗口隐藏，范围已释放；返回需重新选择并确认。');}};document.addEventListener('visibilitychange',hide);
 root.replaceChildren(h('section',{class:'t020'},h('style',{},'.t020{display:grid;gap:12px;max-width:1100px;margin:auto}.t020 pre{padding:12px;background:var(--bg-raised);color:var(--text);border:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere;max-height:450px;overflow:auto}.t020 table{width:100%;border-collapse:collapse}.t020 th,.t020 td{padding:7px;border-bottom:1px solid var(--line);text-align:left;overflow-wrap:anywhere}.t020-row{display:flex;gap:8px;flex-wrap:wrap}'),h('h2',{},'符号链接与断链巡检'),h('p',{},'只读所选目录元数据，不读取正文、不改文件、不进入目录链接。越界目标只报告路径，不检验其存在。'),status,h('div',{class:'t020-row'},choose,run,cancel,clear),plan,results,h('div',{class:'t020-row'},json,md),previewHost,save,h('p',{},'有效文件/目录、断链、链接链循环及目录关系循环分别报告；权限不足/40跳上限为未知。最多10000条目、1000链接、32层普通目录、30秒、4MiB完整报告，超限整份拒绝。非原子快照；外部并发改动或特殊重解析点可能影响结果，不作恶意并发沙箱或所有Windows重解析点保证。')));
 say(available()?'请选择允许巡检的普通目录。选择只确定范围，不启动扫描。':'需要包含公共 Host 桥的版本才能只读巡检。');update();
 return{activate(){if(alive){active=true;update();}},deactivate(){if(alive){active=false;leave();}},destroy(){if(!alive)return;active=false;leave();alive=false;for(const[n,t,f]of bindings)n.removeEventListener(t,f);document.removeEventListener('visibilitychange',hide);root.replaceChildren();}};
}};
