import { h } from '../../core/ui.js';
import { Party, MAX_DRAFT, parseBank, validateBank, cleanHistory } from './model.mjs';
import { CARDS } from './cards.mjs';

const KEY='features.E026.history';
const LOCAL_KEY='agent-toolbox:E026:history:v1';
const LABELS={truth:'真心话',dare:'小挑战',both:'两类混合'};
const ACTIONS={completed:'完成',skipped:'跳过',removed:'移除',unresolved:'结束时未处理'};
const ENDS={turnLimit:'达到设定轮数',exhausted:'可用卡片已抽完',hostEnd:'主动结束'};
export default {
  id:'E026',
  create(root,ctx={}){
    let active=false;let destroyed=false;let game=null;let bank=[...CARDS];let bankSource='内置原创';let bankRemoved=[];let initialRemoved=[];let recorded=false;let generation=0;let editorOpen=false;let recent=[];let queue=Promise.resolve();let exportBusy=false;let saveMessage='';
    try{const saved=ctx.config?.get?ctx.config.get(KEY,null):JSON.parse(localStorage.getItem(LOCAL_KEY)||'null');recent=cleanHistory(saved?.version===1?saved.recent:null);}catch{saveMessage='历史读取失败，仍可开始新局。';}
    const style=h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href});
    const names=h('textarea',{'aria-label':'玩家名称',rows:'3',maxlength:'263'});names.value='小明\n小红';
    const filter=h('select',{'aria-label':'卡片类别'},['truth','dare','both'].map(kind=>h('option',{value:kind},LABELS[kind])));filter.value='both';
    const rotation=h('select',{'aria-label':'玩家轮换'},h('option',{value:'sequential'},'按名单顺序'),h('option',{value:'random'},'局号随机循环'));rotation.value='sequential';
    const turns=h('input',{type:'number',min:'1',max:'100',step:'1',value:'10','aria-label':'本局轮数'});
    const seed=h('input',{value:'demo',maxlength:'32','aria-label':'局号'});
    const pause=h('button',{type:'button',onclick:togglePause},'暂停');pause.disabled=true;
    const status=h('p',{role:'status','aria-live':'polite',class:'e026-status'});
    const bankNote=h('p',{class:'e026-muted'});
    const stage=h('section',{class:'e026-stage','aria-label':'当前抽卡'});
    const summaries=h('div',{class:'e026-summary','aria-label':'完成记录汇总'});
    const draft=h('textarea',{'aria-label':'题库 JSON 草稿',rows:'7',maxlength:String(MAX_DRAFT),spellcheck:'false',oninput:()=>{if(draft.value.length>MAX_DRAFT){draft.value=draft.value.slice(0,MAX_DRAFT);message('草稿已限制为 65536 字符。');}}});
    const customKind=h('select',{'aria-label':'新卡类别'},h('option',{value:'truth'},'真心话'),h('option',{value:'dare'},'小挑战'));customKind.value='truth';
    const customPrompt=h('input',{'aria-label':'新卡内容',maxlength:'240',placeholder:'输入一个日常话题或轻松小挑战'});
    const bankList=h('div',{class:'e026-bank-list'});
    const editor=h('section',{class:'e026-editor'},h('h3',{},'题库编辑'),h('p',{},'新增、整库导入或恢复内置题库在下一局生效；删除未抽卡立即从当前局排除。当前卡请返回局内点“移除此卡”。本局保持暂停，关闭编辑后需手动继续。'),
      h('div',{class:'e026-add'},field('类别',customKind),field('自定义内容',customPrompt),button('添加卡片',addCard)),
      h('details',{},h('summary',{},'用 JSON 替换下一局题库'),h('p',{},'格式：{"version":1,"cards":[{"id":"MY001","kind":"truth","prompt":"一个日常问题？"}]}。kind 为 truth/dare；1–200 张卡，内容 1–240 字。'),draft,button('校验并替换题库',importBank)),
      button('恢复内置 100 张卡',()=>{bank=[...CARDS];bankSource='内置原创';bankRemoved=[];draft.value='';customPrompt.value='';render();message('已恢复下一局内置题库；当前局已消耗或移除的卡不会恢复。');}),
      button('导出题库 JSON 副本',()=>exportData('bank')),button('关闭题库编辑',()=>{editorOpen=false;draft.value='';render();}),bankList);
    const history=h('ol',{});const storage=h('p',{class:'e026-muted',role:'status'},saveMessage);
    const shell=h('section',{class:'feature-e026','aria-label':'真心话大冒险'},h('header',{class:'e026-heading'},h('div',{},h('h2',{},'真心话大冒险'),h('p',{},'日常话题、小小创意，轮到谁都可以轻松跳过。')),pause),
      h('div',{class:'e026-settings'},field('玩家：每行一位',names),field('类别',filter),field('轮换',rotation),field('轮数',turns),field('局号',seed),button('建立新局',newGame)),
      h('p',{class:'e026-muted'},'2–12 人，每个名字 1–20 字且不同；1–100 轮；局号用 1–32 位字母、数字、_ 或 -。相同题库、选项和局号可复现顺序。'),
      h('p',{class:'e026-rule'},'任何人都可以点跳过，不需解释。所有行动均为零惩罚，不设分数或排名。'),
      h('p',{class:'e026-muted'},'关闭工作台、失焦或隐藏页面会暂停。切换具体功能、新建一局或退出应用会丢失未导出的题库与详细记录。'),
      bankNote,button('编辑题库',()=>{game?.pause();editorOpen=true;render();}),editor,status,summaries,stage,
      h('section',{class:'e026-history'},h('h3',{},'最近 10 局摘要'),history,storage));
    root.append(style,shell);render();
    function field(label,input){return h('label',{},h('span',{},label),input);}
    function button(label,fn){return h('button',{type:'button',onclick:e=>{if(!active||destroyed||document.hidden||e.detail>1)return;fn();}},label);}
    function message(value){status.textContent=value;}
    function newGame(){if(editorOpen)return;try{const next=new Party({players:names.value.split(/\r?\n/).map(n=>n.trim()).filter(Boolean),filter:filter.value,rotation:rotation.value,turns:Number(turns.value),seed:seed.value},{bank});remember();game=next;initialRemoved=bankRemoved.map(c=>({...c}));generation++;recorded=false;render();}catch(error){message(error.message);}}
    function togglePause(){if(!active||destroyed||document.hidden||editorOpen||!game)return;if(game.view().phase==='paused')game.resume();else game.pause();render();}
    function freeze(){if(destroyed)return;game?.pause();editorOpen=false;render();}
    function addCard(){try{const used=new Set([...bank,...bankRemoved].map(c=>c.id));let n=1;while(used.has(`C${String(n).padStart(3,'0')}`))n++;const next=validateBank([...bank,{id:`C${String(n).padStart(3,'0')}`,kind:customKind.value,prompt:customPrompt.value}]);bank=[...next];bankSource='编辑题库';customPrompt.value='';render();message('新卡已添加，将在下一局使用。');}catch(error){message(error.message);}}
    function importBank(){try{const next=parseBank(draft.value);bank=[...next];bankSource='导入题库';bankRemoved=[];draft.value='';render();message(`已通过校验，下一局使用 ${next.length} 张卡；当前局不改变。`);}catch(error){message(error.message);}}
    function rememberRemoved(card){bankRemoved=[...bankRemoved.filter(c=>c.id!==card.id),{...card}].slice(-200);}
    function removeBankCard(id){const card=bank.find(c=>c.id===id);if(!card)return;const v=game?.view();if(v&&v.phase!=='finished'&&v.current?.id===id){message('这是当前卡，请关闭编辑后在局内点“移除此卡”。');return;}game?.removeAvailable(id);bank=bank.filter(c=>c.id!==id);rememberRemoved(card);render();message('卡片已移除，当前局不会再抽到它；下一局题库也已删除。');}
    function resolve(action,turn,id,job){if(!active||destroyed||editorOpen||job!==generation)return;if(game.resolve(action,turn,id)){if(action==='removed'){const card=bank.find(c=>c.id===id);bank=bank.filter(c=>c.id!==id);if(card)rememberRemoved(card);}render();}}
    function remember(){const report=game?.result();if(!report||recorded)return;recorded=true;recent=cleanHistory([{options:report.options,finishedAt:new Date().toISOString(),endReason:report.endReason,completed:report.summary.reduce((n,s)=>n+s.completed,0),skipped:report.summary.reduce((n,s)=>n+s.skipped,0),removed:report.summary.reduce((n,s)=>n+s.removed,0)},...recent]);const value={version:1,recent};queue=queue.then(async()=>{try{if(ctx.config?.set)await ctx.config.set(KEY,value);else localStorage.setItem(LOCAL_KEY,JSON.stringify(value));storage.textContent='';}catch{storage.textContent='历史保存失败，完整报告仍在本局内存，可以导出。';}});}
    function render(){
      if(destroyed)return;remember();const truth=bank.filter(c=>c.kind==='truth').length;bankNote.textContent=`${bankSource}：${bank.length} 张卡 · 真心话 ${truth} · 小挑战 ${bank.length-truth}。`;editor.style.display=editorOpen?'':'none';stage.replaceChildren();summaries.replaceChildren();bankList.replaceChildren();history.replaceChildren(...recent.map(s=>h('li',{},`${s.finishedAt.slice(0,10)} · ${s.options.players.join(' / ')} · 完成 ${s.completed} / 跳过 ${s.skipped} / 移除 ${s.removed}`)));pause.disabled=!game||game.view().phase==='finished'||editorOpen;
      if(editorOpen){const current=game?.view().phase==='finished'?null:game?.view().current?.id;bankList.append(h('h4',{},'下一局题库（删除立即排除当前局同卡号）'),...bank.map(c=>{const b=button(`删除 ${c.id}`,()=>removeBankCard(c.id));b.disabled=c.id===current;return h('div',{class:'e026-bank-row'},h('p',{},`${c.id} · ${LABELS[c.kind]} · ${c.prompt}${c.id===current?'（当前卡，请在局内移除）':''}`),b);}));message('题库编辑中，抽卡已停止。');return;}
      if(!game){message('设置玩家后建立新局，再点击“开始抽卡”。');stage.append(h('p',{},'内置 50 道真心话与 50 个轻松小挑战。'));return;}
      const v=game.view();pause.textContent=v.phase==='paused'?'继续':'暂停';summaries.append(...v.summary.map(s=>h('div',{},h('strong',{},s.name),h('span',{},`完成 ${s.completed} · 跳过 ${s.skipped} · 移除 ${s.removed} · 未处理 ${s.unresolved} · 惩罚 0`))));
      if(v.phase==='paused'){message('已暂停，当前卡和轮到的玩家保持不变。');stage.append(h('h3',{},'抽卡暂停'),h('p',{},'点击“继续”恢复。'));return;}
      if(v.phase==='ready'){const readyJob=generation;message(`本局 ${LABELS[v.options.filter]}，可抽 ${v.remaining} 张；准备好再开始。`);stage.append(button('开始抽卡',()=>{if(readyJob===generation&&game.start())render();}),button('结束本局',()=>{if(readyJob===generation&&game.view().phase==='ready'&&game.end())render();}));return;}
      if(v.phase==='finished'){const report=game.result();message(`本局结束：${ENDS[report.endReason]}。`);stage.append(h('h3',{},'本局完整记录'),h('p',{},`已记录 ${report.turns.length} 轮，所有玩家惩罚均为 0。`),button('导出完整报告 JSON 副本',()=>exportData('report')),button('导出当前题库 JSON 副本',()=>exportData('bank')),h('ol',{class:'e026-records'},report.turns.map(r=>h('li',{},h('strong',{},`第 ${r.turn} 轮 · ${r.name} · ${ACTIONS[r.action]}`),h('p',{},`${LABELS[r.kind]} ${r.id}：${r.prompt}`)))),h('h4',{},'本局移除记录'),h('ul',{},report.removals.length?report.removals.map(c=>h('li',{},`${c.id} · ${c.prompt} · ${c.source==='current'?'当前卡移除':'题库编辑删除'} · 第 ${c.atTurn} 轮`)):h('li',{},'本局未移除卡片。')));return;}
      const job=generation;const card=v.current;const turn=v.turn;
      message(`第 ${turn}/${v.total} 轮 · 轮到 ${v.options.players[v.player]} · 剩余 ${v.remaining} 张未抽卡。`);
      stage.append(h('p',{class:'e026-kicker'},`${LABELS[card.kind]} · ${card.id}`),h('h3',{class:'e026-prompt'},card.prompt),h('div',{class:'e026-actions'},button('完成，下一张',()=>resolve('completed',turn,card.id,job)),button('跳过，下一张',()=>resolve('skipped',turn,card.id,job)),button('移除此卡，下一张',()=>resolve('removed',turn,card.id,job))),button('结束本局',()=>{const current=game.view();if(job===generation&&current.turn===turn&&current.current?.id===card.id&&game.end())render();}));
    }
    async function exportData(kind){if(!active||destroyed||exportBusy)return;const report=game?.result();if(kind==='report'&&!report)return;const files=window.toolbox?.files;if(files?.saveTextSupportsCopyOnly!==true||typeof files.saveText!=='function'){message('需要升级到支持副本保护的文件接口，当前不能导出。');return;}const job=generation;const value=kind==='bank'?{version:1,cards:bank}:{...report,initialBankRemovals:initialRemoved,exportedAt:new Date().toISOString()};if(kind==='bank'&&!bank.length){message('当前题库为空，请先添加卡片或恢复内置题库。');return;}exportBusy=true;try{const result=await files.saveText({content:JSON.stringify(value,null,2),extension:'json',defaultName:kind==='bank'?'真心话大冒险题库.json':'真心话大冒险完整报告.json',copyOnly:true});if(active&&!destroyed&&job===generation)message(result?.ok?'已保存为新 JSON 副本。':result?.canceled?'已取消保存。':`保存失败：${result?.error||'未确认成功'}`);}catch(error){if(active&&!destroyed&&job===generation)message(`保存失败：${error.message||error}`);}finally{exportBusy=false;}}
    function visibility(){if(document.hidden)freeze();}
    document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',freeze);
    return {activate(){if(destroyed)return;active=true;render();},deactivate(){active=false;freeze();},destroy(){if(destroyed)return;active=false;game?.pause();remember();destroyed=true;draft.value='';customPrompt.value='';document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',freeze);root.replaceChildren();game=null;bank=[];recent=[];bankRemoved=[];initialRemoved=[];}};
  }
};
