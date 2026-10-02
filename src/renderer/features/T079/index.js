import {h} from '../../core/ui.js';
import {inspectMedia} from './model.mjs';
export default{id:'T079',create(root){
 let alive=true,active=false,busy=false,nativePending=false,epoch=0,job=null,report=null,preview=null;const bindings=[];
 const on=(n,t,f)=>{n.addEventListener(t,f);bindings.push([n,t,f]);return n;},say=s=>{if(alive)status.textContent=s;};
 const status=h('p',{role:'status','aria-label':'操作状态'}),results=h('pre',{'aria-label':'完整权限与枚举结果'}),previewHost=h('pre',{'aria-label':'完整报告预览'});
 const type=h('select',{'aria-label':'检查设备类型'},h('option',{value:'camera'},'摄像头'),h('option',{value:'microphone'},'麦克风')),labels=h('input',{type:'checkbox','aria-label':'明确在报告显示可读取的设备标签'});
 const button=(label,fn)=>on(h('button',{type:'button',class:'btn'},label),'click',()=>{if(alive&&active&&!busy)fn();});
 const run=button('只读查询权限和可枚举设备',async()=>{
  invalidate();const own=epoch,controller=new AbortController(),chosen={deviceType:type.value,includeLabels:labels.checked};job=controller;busy=true;update();say('只读查询中：每接口最多等待3秒；不申请权限、不启动采集。');
  try{const next=await inspectMedia(chosen,{signal:controller.signal,readSystem:async deviceType=>{const api=window.toolbox?.features;if(api?.callHostSupported!==true||typeof api.callHost!=='function')throw Error('宿主接口缺失。');return api.callHost('T079','read_status',{deviceType});}});if(!current(own))return;report=next;results.textContent=JSON.stringify(next,null,2);say(`查询完成：系统${next.systemPermission.state}、浏览器${next.browserPermission.state}、枚举${next.enumeration.state}。占用/实际采集可用性仍未知，尚未保存。`);}catch(e){if(current(own))say(`未生成权限报告：${e.name==='AbortError'?'已取消':e.message}`);}finally{if(current(own)){busy=false;job=null;update();}}
 });
 const cancel=on(h('button',{type:'button',class:'btn'},'取消当前查询'),'click',()=>{if(!alive||!active||!busy||nativePending)return;epoch++;job?.abort();job=null;busy=false;report=preview=null;results.textContent=previewHost.textContent='';say('已取消并忽略晚返回；没有部分报告。公开只读接口没有底层取消句柄。');update();});
 const json=button('预览完整 JSON 报告',()=>show('json')),md=button('预览完整 Markdown 报告',()=>show('md'));
 const save=button('保存已预览报告新副本',async()=>{
  const api=window.toolbox?.files;if(!preview||api?.saveTextSupportsCopyOnly!==true||typeof api.saveText!=='function')return;const own=epoch,chosen=preview;busy=nativePending=true;update();
  try{const r=await api.saveText({...chosen,copyOnly:true});if(!current(own))return;say(r?.ok===true?'完整权限说明报告新副本保存成功。':r?.canceled===true?'已取消另存，预览保留。':`保存失败：${r?.error||'未确认写入'}${r?.partialPath?'；请人工核对 '+r.partialPath:''}`);}catch{if(current(own))say('保存失败，预览保留。');}finally{if(current(own)){busy=nativePending=false;update();}}
 });
 const clear=button('清空当前报告',()=>invalidate('报告与预览已清空，不会自动重新查询。'));
 const current=own=>alive&&active&&epoch===own;
 function invalidate(message='检查类型或标签披露选项改变，旧报告已失效。'){epoch++;job?.abort();report=preview=null;results.textContent=previewHost.textContent='';say(message);update();}
 function update(){if(!alive)return;for(const n of[type,labels,run,clear])n.disabled=!active||busy;json.disabled=md.disabled=!active||busy||!report;save.disabled=!active||busy||!preview||window.toolbox?.files?.saveTextSupportsCopyOnly!==true;cancel.disabled=!active||!busy||nativePending;}
 function show(kind){if(!report)return;const body=JSON.stringify(report,null,2);preview={content:kind==='json'?body:'# 媒体设备权限说明\n\n完整结构化报告；未知不等于拒绝，枚举不等于可采集：\n\n'+('`'.repeat(10))+'json\n'+body.replaceAll('`','\\u0060')+'\n'+('`'.repeat(10))+'\n',extension:kind==='json'?'json':'md',defaultName:`media-permission-report-copy.${kind==='json'?'json':'md'}`};previewHost.textContent=preview.content;say('完整报告已预览，不含设备ID/groupId；若明确选择显示标签，分享前核对名称。');update();}
 for(const n of[type,labels])on(n,'change',()=>{if(alive&&active&&!busy)invalidate();});
 function leave(){epoch++;job?.abort();job=null;busy=nativePending=false;report=preview=null;results.textContent=previewHost.textContent='';update();}
 const hide=()=>{if(alive&&document.hidden){leave();say('窗口隐藏，结果已清空；返回需手动查询。');}};document.addEventListener('visibilitychange',hide);
 root.replaceChildren(h('section',{class:'t079'},h('style',{},'.t079{display:grid;gap:12px;max-width:1000px;margin:auto}.t079 select,.t079 pre{padding:12px;background:var(--bg-raised);color:var(--text);border:1px solid var(--line)}.t079 pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:460px;overflow:auto}.t079-row{display:flex;gap:8px;flex-wrap:wrap}'),h('h2',{},'摄像头麦克风权限说明台'),h('p',{},'只查询公开权限状态与当前可枚举条目，不开启摄像头/麦克风、不弹授权申请、不打开系统设置。'),status,type,h('label',{},labels,' 明确在报告显示可读取的设备标签（默认隐藏名称；始终省略设备ID/groupId）'),h('div',{class:'t079-row'},run,cancel,clear),results,h('div',{class:'t079-row'},json,md),previewHost,save,h('p',{},'系统权限、浏览器权限与枚举范围分别报告。空列表不证明无设备，空标签不证明被拒绝；设备占用/实际采集可用性不测试。Windows/macOS使用Electron公开状态，其他平台系统状态为未知；权限API不支持或超时也为未知。最多100枚举条目/每标签512字节，超限该来源未知且不截断；每接口3秒，最多9秒等待。没有后台监控或自动草稿。')));
 say('选择设备类型后手动只读查询。已列出的设备仍不代表可采集或没有被占用。');update();
 return{activate(){if(alive){active=true;update();}},deactivate(){if(alive){active=false;leave();}},destroy(){if(!alive)return;active=false;leave();alive=false;for(const[n,t,f]of bindings)n.removeEventListener(t,f);document.removeEventListener('visibilitychange',hide);root.replaceChildren();}};
}};
