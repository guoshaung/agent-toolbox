import { h } from '../../core/ui.js';
import { EXAMPLE, LIMITS, parseSubtitles, repairSubtitles, seconds, subtitleText } from './model.mjs';

export default { id: 'T046', create(root) {
  let active=false, alive=true, busy=false, nativePending=false, generation=0, controller=null, report=null, preview=null;
  const bindings=[];
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);bindings.push([node,type,fn]);return node;};
  const status=h('p',{role:'status','aria-live':'polite'},'选择格式并输入字幕，先生成完整报告，再预览新副本。');
  const source=h('textarea',{rows:10,'aria-label':'字幕源文本'});
  const format=h('select',{'aria-label':'字幕格式'},h('option',{value:'srt'},'SRT'),h('option',{value:'vtt'},'简单 WebVTT'));
  const file=h('input',{type:'file',accept:'.srt,.vtt,text/plain','aria-label':'读取字幕文件'});
  const offset=h('input',{type:'text',value:'2','aria-label':'整体偏移秒'});
  const minimum=h('input',{type:'text',value:'1','aria-label':'最短展示秒'});
  const extend=h('input',{type:'checkbox','aria-label':'延长短字幕到最短展示时间'});
  const duration=h('input',{type:'text',value:'','aria-label':'可选媒体时长秒',placeholder:'留空不检查媒体边界'});
  const ack=h('input',{type:'checkbox','aria-label':'确认重叠和短展示提示'});
  const output=h('div'), previewHost=h('div');
  const say=text=>{if(alive)status.textContent=text;};
  const button=(name,fn)=>listen(h('button',{type:'button',class:'btn'},name),'click',()=>{if(alive&&active&&!busy)fn();});
  const example=button('载入两条重叠示例',()=>{source.value=EXAMPLE;format.value='srt';offset.value='2';minimum.value='1';duration.value='';extend.checked=false;invalidate('示例已载入：1秒起点整体后移2秒；两条字幕重叠1秒。');});
  const analyze=button('生成完整时间轴报告',async()=>{
    invalidate();const own=++generation;busy=true;controller=new AbortController();update();
    try{const parsed=parseSubtitles(source.value,format.value);const next=await repairSubtitles(parsed,{offsetMs:seconds(offset.value,{signed:true}),minMs:seconds(minimum.value),extendShort:extend.checked,mediaMs:seconds(duration.value,{optional:true})},{signal:controller.signal});if(!alive||own!==generation)return;report=next;render();say(`已分析${next.summary.cues}条，重叠${next.summary.overlapPairs}对，越界${next.summary.blockedCueIds.length}条。尚未保存。`);}
    catch(error){if(alive&&own===generation)say(`分析失败：${error.message}`);}
    finally{if(alive){busy=false;controller=null;update();}}
  });
  const reportPreview=button('预览完整 JSON 报告',()=>showPreview('json'));
  const subtitlePreview=button('预览修复字幕新副本',()=>showPreview('subtitle'));
  const save=button('保存已预览的新副本',async()=>{
    const api=window.toolbox?.files;if(!preview)return;
    if(api?.saveTextSupportsCopyOnly!==true||typeof api.saveText!=='function'){say('宿主缺少文本新副本保护接口，已阻止保存。');return;}
    const own=generation,chosen=preview;busy=true;nativePending=true;update();
    try{const result=await api.saveText({...chosen,copyOnly:true});if(!alive||own!==generation||preview!==chosen)return;say(result?.ok===true?'新副本保存成功。':result?.canceled===true?'已取消保存，完整预览保留。':'保存失败，已有文件不会被覆盖，完整预览保留。');}
    catch{if(alive&&own===generation)say('保存失败，完整预览保留。');}
    finally{if(alive){busy=false;nativePending=false;update();}}
  });
  const cancel=listen(h('button',{type:'button',class:'btn'},'取消当前分析'),'click',()=>{if(alive&&active&&busy&&!nativePending){generation++;controller?.abort();report=null;preview=null;render();say('已取消分析，未发布部分报告。');}});
  const clear=button('清空字幕和结果',()=>{source.value='';file.value='';invalidate('字幕和全部结果已清空。');});
  function invalidate(message='输入改变，旧报告和导出预览已失效。'){generation++;controller?.abort();report=null;preview=null;ack.checked=false;render();say(message);}
  function canExport(){return report&&!report.summary.blockedCueIds.length&&(!report.summary.warningCueIds.length||ack.checked);}
  function update(){if(!alive)return;for(const control of [source,format,file,offset,minimum,extend,duration,example,analyze,clear])control.disabled=!active||busy;ack.disabled=!active||busy||!report;reportPreview.disabled=!active||busy||!report;subtitlePreview.disabled=!active||busy||!canExport();save.disabled=!active||busy||!preview;cancel.disabled=!active||!busy||nativePending;}
  function render(){output.replaceChildren();previewHost.replaceChildren();if(report){output.append(h('p',{},`完整结果：${report.summary.cues}条 / ${report.summary.overlapPairs}对重叠 / 提示编号${report.summary.warningCueIds.join(',')||'无'} / 越界编号${report.summary.blockedCueIds.join(',')||'无'}`),h('p',{},'formatBounds：格式时间越界；mediaBounds：超过所填媒体时长；shortDisplay：展示不足；overlap：有交叠。越界阻止字幕副本，JSON报告仍可导出。'),h('pre',{'aria-label':'完整时间轴报告'},JSON.stringify(report,null,2)));}update();}
  function showPreview(kind){try{const extension=kind==='json'?'json':report.format;const content=kind==='json'?JSON.stringify(report,null,2)+'\n':subtitleText(report,ack.checked);preview={content,extension,defaultName:`T046-${kind==='json'?'report':'repaired'}.${extension}`};const text=h('textarea',{rows:12,readonly:true,'aria-label':'完整导出预览'});text.value=content;previewHost.replaceChildren(h('p',{},`拟创建 ${preview.defaultName}；源字幕不写回，已有目标不会覆盖。`),text);update();say('完整内容已预览，核对后显式保存新副本。');}catch(error){preview=null;previewHost.replaceChildren();update();say(error.message);}}
  for(const node of [source,offset,minimum,duration])listen(node,'input',()=>{if(alive&&active&&!busy)invalidate();});
  for(const node of [format,extend])listen(node,'change',()=>{if(alive&&active&&!busy)invalidate();});
  listen(ack,'change',()=>{if(alive&&active&&!busy){preview=null;previewHost.replaceChildren();update();}});
  listen(file,'change',async()=>{const chosen=file.files?.[0];file.value='';if(!alive||!active||busy||!chosen)return;invalidate();const own=++generation;busy=true;update();try{if(chosen.size>LIMITS.inputBytes)throw Error('字幕文件超过1MiB。');const bytes=await chosen.arrayBuffer();if(!alive||own!==generation)return;source.value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);say('严格UTF-8字幕已读取，请确认格式和规则后生成报告。');}catch(error){if(alive&&own===generation)say(`读取失败：${error.message}`);}finally{if(alive){busy=false;update();}}});
  const hidden=()=>{if(alive&&document.hidden){generation++;controller?.abort();preview=null;previewHost.replaceChildren();update();}};document.addEventListener('visibilitychange',hidden);
  const field=(label,node)=>h('label',{},label,node);
  root.replaceChildren(h('section',{class:'t046'},h('style',{},'.t046{display:grid;gap:12px;max-width:1100px;margin:auto}.t046 label{display:grid;gap:6px}.t046 input,.t046 textarea,.t046 select,.t046 pre{background:var(--bg-raised);color:var(--text);border:1px solid var(--line);padding:10px;box-sizing:border-box;max-width:100%}.t046 pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto}.t046-row{display:flex;gap:10px;flex-wrap:wrap}'),h('h2',{},'字幕时间轴修复'),h('p',{},'SRT / 简单VTT，最多1MiB、1000条、每条正文8KiB、20000对重叠；超限整份拒绝。按整数毫秒处理，保留正文与原顺序。'),status,field('输入格式',format),field('读取严格UTF-8文件',file),field('字幕文本（正文标签按文本显示）',source),field('整体偏移秒，负数提前',offset),field('最短展示秒，0–60',minimum),field('启用可选延长，可能新增重叠',extend),field('可选媒体时长秒',duration),h('div',{class:'t046-row'},example,analyze,cancel,clear),output,field('我已核对全部重叠/短展示提示，允许导出',ack),h('div',{class:'t046-row'},reportPreview,subtitlePreview),previewHost,save,h('p',{},'不自动剪掉越界字幕或删除重叠；多说话者VTT可以合法重叠。不与音频比对，不声称自动对齐。VTT头部仅WEBVTT，不支持NOTE/STYLE/REGION、定位设置或正文内时间戳；SRT导出重新连续编号，原编号保留于JSON。无自动草稿。')));
  update();return{activate(){if(alive){active=true;update();}},deactivate(){if(alive){active=false;generation++;controller?.abort();preview=null;previewHost.replaceChildren();update();}},destroy(){if(!alive)return;alive=false;active=false;generation++;controller?.abort();for(const[node,type,fn]of bindings)node.removeEventListener(type,fn);document.removeEventListener('visibilitychange',hidden);source.value='';report=null;preview=null;root.replaceChildren();}};
} };
