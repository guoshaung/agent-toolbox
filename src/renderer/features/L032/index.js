import { h } from '../../core/ui.js';
import { LIMITS, parseReview, compareReviews, reportMarkdown, exampleCSV } from './model.mjs';
export default {
 id:'L032',
 create(root){
  let submitted=[],result=null,phase='A',busy=false,alive=true,epoch=0,page=0;
  const rules=h('textarea',{rows:3,maxlength:'4000','aria-label':'共同纳排规则'});rules.value='纳入：符合预先约定主题且满足研究类型；排除：不符合任一条件。请替换为你们实际的规则。';
  const status=h('p',{role:'status','aria-live':'polite',class:'l032-status'}),pane=h('div'),output=h('div');
  const shell=h('section',{class:'feature-l032'},h('h2',{},'双人文献筛选校准'),h('p',{},'两名评审分别提交自己的CSV，双方都提交后才展示判定、一致率与冲突。'),
   h('p',{class:'l032-warning'},'本机轮流输入：评审独处时导入，另一个人避开屏幕。界面隐藏另一份未揭晓判定，不提供账号或权限隔离；结果只是筛选一致性，不证明文献质量或规则正确。'),
   h('label',{},'共同纳排规则（首份提交后锁定）',rules),h('button',{onclick:reset},'重新开始全部筛选'),status,pane,output,
   h('p',{},'每份CSV最多1MiB、1000条，表头固定id,title,decision；判定include/exclude或纳入/排除。两份必须有同样ID和标题，顺序可不同；不匹配时列出问题，不用部分配对计算指标。未导出数据只留本功能当前内存。'));
  root.append(h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href}),shell);
  function message(value){if(alive)status.textContent=value;}
  function reset(){if(busy)return;epoch++;submitted=[];result=null;phase='A';page=0;rules.disabled=false;output.replaceChildren();render();message('已清空两位判定与结果，请按共同规则重新独立提交。');}
  function render(){
   if(!alive)return;pane.replaceChildren();
   if(phase==='handoff'){pane.append(h('h3',{},'评审 A 已提交'),h('p',{},'A的原始输入及判定不显示。请将屏幕交给评审B独自输入。'),h('button',{onclick:()=>{phase='B';render();message('请评审B独立输入，A的判定尚未揭晓。');}},'评审 B 已独处，开始输入'));return;}
   if(phase==='done'){renderResult();return;}
   const who=phase,area=h('textarea',{rows:10,maxlength:String(LIMITS.characters),'aria-label':`评审 ${who} CSV`}),file=h('input',{type:'file',accept:'.csv,text/csv','aria-label':`评审 ${who} CSV文件`});
   const sample=h('button',{onclick:()=>{area.value=exampleCSV;message('已载入四条演示判定；实际筛选请独立导入自己的结果。');}},`载入评审 ${who} 演示CSV`);
   const submit=h('button',{onclick:()=>{if(busy)return;try{if(!rules.value.trim()||rules.value.length>4000)throw Error('请先填写最多4000字符的共同规则。');const rows=parseReview(area.value);submitted.push(rows);area.value='';file.value='';rules.disabled=true;
     if(who==='A'){phase='handoff';render();message('A已提交，判定暂不展示。');}else{result=compareReviews(rules.value,submitted[0],submitted[1]);phase='done';render();message(result.alignment.aligned?'两份已对齐并计算，全部判定现在揭晓。':'条目未对齐，指标未计算；请核对问题后重新开始。');}
    }catch(error){message(error.message);}}},`提交评审 ${who} 并隐藏输入`);
   file.addEventListener('change',async()=>{const selected=file.files?.[0];if(!selected||busy)return;const ticket=epoch;busy=true;area.disabled=sample.disabled=submit.disabled=file.disabled=true;
    try{if(selected.size>LIMITS.bytes)throw Error('每份CSV文件最多1MiB。');const text=new TextDecoder('utf-8',{fatal:true}).decode(await selected.arrayBuffer());parseReview(text);if(!alive||ticket!==epoch)return;area.value=text;message('CSV校验通过，请检查自己的输入再提交；尚未提交不会揭晓。');}
    catch(error){message(`导入失败：${error.message} 当前输入未替换。`);}finally{if(alive&&ticket===epoch){busy=false;area.disabled=sample.disabled=submit.disabled=file.disabled=false;file.value='';}}
   });pane.append(h('h3',{},`评审 ${who} 独立输入`),h('label',{},'本地CSV文件',file),h('label',{},'自己的判定CSV',area),h('div',{class:'l032-actions'},sample,submit));
  }
  function renderResult(){
   const s=result.statistics;
   const exports=h('div',{class:'l032-actions'},h('button',{onclick:()=>save('json')},'导出完整 JSON 副本'),h('button',{onclick:()=>save('md')},'导出 Markdown 副本'));
   if(!s){output.replaceChildren(h('h3',{},'条目未对齐，未计算一致率或 kappa'),h('p',{},`缺少A判定：${result.alignment.missingA.join('、')||'无'}`),h('p',{},`缺少B判定：${result.alignment.missingB.join('、')||'无'}`),...result.alignment.titleMismatch.map(p=>h('p',{},`${p.id}标题不一致：A=${p.titleA}；B=${p.titleB}`)),exports);return;}
   const pages=Math.max(1,Math.ceil(result.pairs.length/50));page=Math.max(0,Math.min(page,pages-1));
   const prev=h('button',{disabled:page===0,onclick:()=>{page--;renderResult();}},'上一页'),next=h('button',{disabled:page===pages-1,onclick:()=>{page++;renderResult();}},'下一页');
   output.replaceChildren(h('h3',{},'两位独立判定对照'),h('p',{class:'l032-summary'},`${s.n}条 · 一致${s.agreements}条 · 一致率${(s.agreement*100).toFixed(2)}% · 冲突${result.conflicts.length}条 · Cohen kappa ${s.kappa===null?'未定义':s.kappa.toFixed(4)}`),
    h('p',{},`期望一致率 Pe=${s.expectedAgreement}；κ=(Po−Pe)/(1−Pe)。${s.kappaReason}`),
    h('p',{},`交叉计数：A纳入/B纳入${s.matrix[0][0]}，A纳入/B排除${s.matrix[0][1]}，A排除/B纳入${s.matrix[1][0]}，A排除/B排除${s.matrix[1][1]}。`),
    h('div',{class:'l032-scroll'},h('table',{},h('thead',{},h('tr',{},['ID','文献标题','A','B','对照','来源物理行 A/B'].map(t=>h('th',{},t)))),h('tbody',{},result.pairs.slice(page*50,page*50+50).map(p=>h('tr',{class:p.match?'':'l032-conflict'},[p.id,p.title,p.decisionA,p.decisionB,p.match?'一致':'冲突',`${p.lineA}/${p.lineB}`].map(t=>h('td',{},t))))))),
    h('div',{class:'l032-actions'},prev,h('span',{},`第${page+1}/${pages}页，完整报告不截断`),next),exports);
  }
  async function save(extension){if(busy||!result)return;const files=window.toolbox?.files;if(files?.saveTextSupportsCopyOnly!==true||typeof files.saveText!=='function'){message('需要支持安全副本导出的基础版本。');return;}busy=true;const ticket=epoch;try{const response=await files.saveText({content:extension==='json'?JSON.stringify(result,null,2):reportMarkdown(result),extension,defaultName:`L032-筛选校准.${extension}`,copyOnly:true});if(alive&&ticket===epoch)message(response?.ok?'完整对照已保存为新副本。':response?.canceled?'已取消保存，结果仍保留。':`保存失败：${response?.error||'未确认成功'}`);}catch(error){message(`保存失败：${error.message}`);}finally{if(alive&&ticket===epoch)busy=false;}}
  render();return{activate(){},deactivate(){},destroy(){alive=false;epoch++;submitted=[];result=null;rules.value='';root.replaceChildren();}};
 }
};
