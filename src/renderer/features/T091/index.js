import { h } from '../../core/ui.js';
import { Scan, RULES, LIMITS, toMarkdown } from './model.mjs';

const STATUS={queued:'待扫描',scanned:'已执行规则',partial:'部分扫描',unscanned:'未扫描',canceled:'已取消'};
export default {
  id:'T091',
  create(root){
    let active=false;let destroyed=false;let selected=[];let scanner=null;let report=null;let running=false;let generation=0;let page=0;let preview=null;let exporting=false;
    const style=h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href});
    const files=h('input',{type:'file',multiple:true,'aria-label':'选择文本文件',onchange:e=>choose(e.target)});
    const directory=h('input',{type:'file',multiple:true,webkitdirectory:true,directory:true,'aria-label':'选择目录',onchange:e=>choose(e.target)});
    const checks=RULES.map(rule=>h('input',{type:'checkbox',checked:true,'aria-label':rule.label}));
    const status=h('p',{class:'t091-status',role:'status','aria-live':'polite'});
    const selectedNote=h('p',{class:'t091-muted'},'尚未选择文件。');
    const start=h('button',{type:'button',onclick:startScan},'开始本地扫描');start.disabled=true;
    const cancel=h('button',{type:'button',onclick:()=>{if(!active||!running)return;scanner?.cancel('user');message('正在取消；已发现项保留，未处理文件将标为取消。');}},'取消扫描');cancel.disabled=true;
    const coverage=h('div',{class:'t091-coverage'});const findings=h('div',{class:'t091-findings'});const pager=h('div',{});const previewHost=h('section',{class:'t091-preview'});
    const shell=h('section',{class:'feature-t091','aria-label':'分享包敏感内容预检'},h('h2',{},'分享包敏感内容预检'),h('p',{},'只检查本次选择的内容，保留位置和审阅记录；不上传、不修改源文件。'),
      h('div',{class:'t091-selectors'},field('文本文件，可多选',files),field('目录，包含子目录',directory)),
      h('p',{class:'t091-muted'},'目录选择使用 HTML webkitdirectory；支持程度由 Electron/系统文件选择器决定。若目录按钮不可用，请用多选文件。不会访问用户未选择的任意路径。'),
      h('div',{class:'t091-rules'},RULES.map((rule,i)=>h('label',{},checks[i],h('span',{},rule.label)))),
      h('p',{class:'t091-rule'},'限额：50 个文件、每文件 256 KiB、总读取 2 MiB、500 项结果。只接受严格 UTF-8；二进制、未知编码、超限和取消会单独列出。选择或开始新扫描将替换当前未导出结果。'),
      selectedNote,start,cancel,status,coverage,pager,findings,
      h('div',{class:'t091-export'},button('预览 JSON 报告',()=>makePreview('json')),button('预览 Markdown 报告',()=>makePreview('md'))),previewHost,
      h('p',{class:'t091-muted'},'值和整行原文均隐藏，可按位置在自己的原文件中核对。误报标记保留原因；未发现、排除误报或扫描完成都不能证明文件安全。结果仅保留在当前面板，不写全局配置。'));
    root.append(style,shell);render();
    function field(label,input){return h('label',{},h('span',{},label),input);}
    function button(label,fn){return h('button',{type:'button',onclick:e=>{if(!active||destroyed||document.hidden||e.detail>1)return;fn();}},label);}
    function message(value){status.textContent=scanner?scanner.redact(String(value)):String(value);}
    function choose(input){if(!active||destroyed)return;const next=Array.from(input.files||[]);input.value='';if(!next.length)return;if(next.length>LIMITS.files){message('选择超过 50 个文件，未开始新扫描，保留此前结果。');return;}const pendingRead=running;scanner?.cancel('user');generation++;selected=next;scanner=null;report=null;preview=null;running=pendingRead;page=0;selectedNote.textContent=`已选择 ${next.length} 个文件，文件名将在结果中按规则遮蔽；选择顺序对应 F001 起的编号。`;render();message(pendingRead?'新选择已准备，等待此前取消的读取完成后再开始。':'已准备选择的文件，确认规则后开始。');}
    async function startScan(){if(!active||destroyed||document.hidden||running||!selected.length)return;const ids=RULES.filter((_,i)=>checks[i].checked).map(r=>r.id);let next;try{next=new Scan(ids);}catch(error){message(error.message);return;}generation++;const job=generation;scanner=next;report=null;preview=null;page=0;running=true;render();message('本地扫描中，可以取消。');try{const done=await next.run([...selected],{onProgress:value=>{if(destroyed||job!==generation)return;report=value;render();}});if(destroyed||job!==generation)return;report=done;running=false;render();message(`扫描${done.state==='canceled'?'已取消':'已结束'}：发现 ${done.summary.findings} 项；未扫描 ${done.summary.unscanned}，部分扫描 ${done.summary.partial}，取消 ${done.summary.canceled}。`);}catch(error){if(destroyed||job!==generation)return;running=false;report=next.report();render();message(`扫描失败：${next.redact(error.message||error)}`);}finally{if(!destroyed){running=false;render();}}}
    function render(){
      if(destroyed)return;start.disabled=!selected.length||running;cancel.disabled=!running;checks.forEach(c=>c.disabled=running);coverage.replaceChildren();findings.replaceChildren();pager.replaceChildren();previewHost.replaceChildren();
      if(!report){coverage.append(h('p',{},'扫描结果尚未生成。'));return;}
      const s=report.summary;coverage.append(h('h3',{},'文件覆盖'),h('p',{},`发现 ${s.findings} 项 · 完整执行 ${s.scanned} · 部分 ${s.partial} · 未扫描 ${s.unscanned} · 取消 ${s.canceled} · 已读取 ${s.readBytes} 字节`),h('ul',{},report.files.map(f=>h('li',{},`${f.id} · ${f.path} · ${STATUS[f.status]} · ${f.reasonText} · ${f.count} 项`))));
      const maxPage=Math.max(0,Math.ceil(report.findings.length/25)-1);page=Math.min(page,maxPage);pager.append(button('上一页',()=>{if(page>0){page--;render();}}),h('span',{},`风险位置 ${page+1}/${maxPage+1} 页，每页 25 项`),button('下一页',()=>{if(page<maxPage){page++;render();}}));
      if(!report.findings.length)findings.append(h('p',{},'当前未发现所选规则的匹配项；请查看未扫描和限额说明。'));
      for(const row of report.findings.slice(page*25,page*25+25)){
        const reviewGeneration=generation;
        const reason=h('input',{'aria-label':`${row.id} 审阅原因`,maxlength:'180',value:row.reason,placeholder:'误报需填写原因，可确认风险或恢复待审阅'});
        const state=h('select',{'aria-label':`${row.id} 审阅状态`},h('option',{value:'unreviewed'},'待审阅'),h('option',{value:'confirmed'},'确认风险'),h('option',{value:'falsePositive'},'人工标记误报'));state.value=row.status;state.disabled=running;reason.disabled=running;
        const apply=button('保存审阅标记',()=>{if(reviewGeneration!==generation||running)return;try{report=scanner.annotate(row.id,state.value,reason.value);reason.value='';preview=null;render();message('审阅状态已记录，原因已遮蔽；请重新预览报告。');}catch(error){message(error.message);}});apply.disabled=running;
        findings.append(h('article',{class:'t091-finding'},h('h4',{},`${row.id} · ${row.fileId} · ${row.path}`),h('p',{},`行 ${row.line} · 列 ${row.column} · offset ${row.offset} · 长度 ${row.length}（UTF-16）`),h('p',{},row.rules.map(id=>RULES.find(r=>r.id===id).label).join(' / ')),h('p',{class:'t091-mask'},row.maskedValue),h('p',{class:'t091-muted'},row.context),h('div',{class:'t091-review'},state,reason,apply)));
      }
      if(preview){const text=h('textarea',{'aria-label':'已遮蔽报告预览',readonly:true,rows:'12'});text.value=preview.content;previewHost.append(h('h3',{},'已遮蔽报告预览'),h('p',{},`拟创建新副本：${preview.defaultName}；实际目标路径在原生保存对话框中确认。源文件不被改写。`),text,button(exporting?'正在保存…':'导出当前预览副本',exportPreview));}
    }
    function makePreview(format){if(running||!report||!['completed','canceled'].includes(report.state)){message('扫描结束或取消完成后才能生成完整报告预览。');return;}report=scanner.report();preview={format,content:format==='json'?JSON.stringify(report,null,2):toMarkdown(report),defaultName:format==='json'?'分享包敏感预检报告.json':'分享包敏感预检报告.md'};render();message('已生成遮蔽预览；下一步在保存对话框选择新副本位置。');}
    async function exportPreview(){if(!preview||running||exporting||!active||destroyed)return;const api=window.toolbox?.files;if(api?.saveTextSupportsCopyOnly!==true||typeof api.saveText!=='function'){message('需要升级到支持副本保护的文件接口，当前无法导出。');return;}const job=generation;const copy=preview;exporting=true;try{const result=await api.saveText({content:copy.content,extension:copy.format,defaultName:copy.defaultName,copyOnly:true});if(active&&!destroyed&&job===generation){if(result?.canceled)message('已取消保存，结果与预览保留。');else if(result?.ok===true)message('已保存已遮蔽报告新副本，结果保留。');else message(`保存失败：${scanner.redact(result?.error||'文件接口未确认成功')}；结果保留。`);}}catch(error){if(active&&!destroyed&&job===generation)message(`保存失败：${scanner.redact(error.message||error)}；结果保留。`);}finally{exporting=false;}}
    function freeze(reason){scanner?.cancel(reason);if(running)message('扫描已请求取消，完成读取后保留已发现项与覆盖记录。');}
    function hidden(){if(document.hidden)freeze('hidden');}
    document.addEventListener('visibilitychange',hidden);
    return {activate(){if(destroyed)return;active=true;render();},deactivate(){active=false;freeze('deactivated');},destroy(){if(destroyed)return;active=false;destroyed=true;generation++;scanner?.cancel('destroyed');document.removeEventListener('visibilitychange',hidden);files.value='';directory.value='';selected=[];report=null;preview=null;scanner=null;root.replaceChildren();}};
  }
};
