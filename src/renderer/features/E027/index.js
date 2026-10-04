import { h } from '../../core/ui.js';
import { Estimate, MAX_DRAFT, validateBank, parseBank, cleanHistory } from './model.mjs';
import { QUESTIONS } from './questions.mjs';

const KEY='features.E027.history';
const LOCAL_KEY='agent-toolbox:E027:history:v1';
export default {
  id:'E027',
  create(root,ctx={}){
    let active=false;let destroyed=false;let game=null;let bank=[...QUESTIONS];let source='内置原创';let editorOpen=false;let guessInput=null;let generation=0;let recorded=false;let recent=[];let queue=Promise.resolve();let exportBusy=false;let storageMessage='';
    try{const saved=ctx.config?.get?ctx.config.get(KEY,null):JSON.parse(localStorage.getItem(LOCAL_KEY)||'null');recent=cleanHistory(saved?.version===1?saved.recent:null);}catch{storageMessage='历史读取失败，可以继续竞猜。';}
    const style=h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href});
    const names=h('textarea',{'aria-label':'玩家名称',rows:'3',maxlength:'175'});names.value='小明\n小红\n小蓝';
    const count=h('input',{type:'number',min:'1',max:'30',step:'1',value:'5','aria-label':'题数'});
    const pause=h('button',{type:'button',onclick:togglePause},'暂停');pause.disabled=true;
    const status=h('p',{class:'e027-status',role:'status','aria-live':'polite'});
    const bankNote=h('p',{class:'e027-muted'});const stage=h('section',{class:'e027-stage','aria-label':'竞猜区'});const scores=h('div',{class:'e027-scores','aria-label':'累计积分'});
    const customPrompt=h('input',{'aria-label':'自建题题面',maxlength:'240'});const customUnit=h('input',{'aria-label':'自建题单位',maxlength:'20'});const customReference=h('input',{'aria-label':'主持人参考值',inputmode:'decimal',maxlength:'10',autocomplete:'off'});const explanation=h('input',{'aria-label':'参考值说明',maxlength:'400'});
    const draft=h('textarea',{'aria-label':'主持人题库 JSON',rows:'7',maxlength:String(MAX_DRAFT),spellcheck:'false',oninput:()=>{if(draft.value.length>MAX_DRAFT){draft.value=draft.value.slice(0,MAX_DRAFT);message('JSON 草稿已限制为 65536 字符。');}}});
    const bankList=h('div',{class:'e027-bank-list'});
    const editor=h('section',{class:'e027-editor'},h('h3',{},'主持人私密题库编辑'),h('p',{},'其他玩家请转身。这里显示参考值；所有题库修改只在下一局生效，当前局快照不变。关闭编辑、隐藏或失焦会清空未提交草稿和参考输入。'),
      h('div',{class:'e027-custom'},field('题面',customPrompt),field('单位',customUnit),field('参考值',customReference),field('可复算说明或来源',explanation),button('添加自建题',addQuestion)),
      h('details',{},h('summary',{},'JSON 整库替换'),h('p',{},'结构：version 为 1，questions 数组；每题含 id、prompt、unit、reference、explanation，reference 必须是十进制字符串。题库 1–100 题。'),draft,button('校验并替换题库',importBank)),
      button('恢复内置 30 题',()=>{bank=[...QUESTIONS];source='内置原创';clearEditor();render();message('已恢复下一局内置题库，当前局不变。');}),button('导出题库 JSON 副本',()=>exportData('bank')),button('隐藏参考值，关闭编辑',()=>{editorOpen=false;clearEditor();render();}),bankList);
    const history=h('ol',{});const storage=h('p',{class:'e027-muted',role:'status'},storageMessage);
    const shell=h('section',{class:'feature-e027','aria-label':'估价竞猜'},h('header',{class:'e027-heading'},h('div',{},h('h2',{},'估价竞猜'),h('p',{},'逐人密封输入，所有人提交后再一起揭晓。')),pause),
      h('div',{class:'e027-settings'},field('玩家：每行一位',names),field('本局题数',count),button('建立新局',newGame)),
      h('p',{class:'e027-rule'},'单轮按绝对误差从小到大排名；相同误差并列。每轮积分 = 玩家人数 − 单轮名次 + 1；累计排名只比较积分总和，不把不同单位的误差相加。'),
      h('p',{class:'e027-muted'},'2–8 人，名字各 1–20 字且不同。参考和猜测均为 0–1000000，最多两位小数；使用整数百分位计算，拒绝指数和额外小数。内置价格题明确是假定价格，所有参考值固定、可复算。'),
      h('p',{class:'e027-warning'},'共同本机合作：每次输入请其他人转身，再交接电脑；没有账号或权限隔离。密封提交后从界面移除已输入数值。关闭工作台、失焦或隐藏会暂停并清空未提交输入；切换功能或新建一局会丢失未导出的详细记录与题库。'),
      bankNote,button('主持人独处，编辑题库',()=>{clearGuess();game?.pause();editorOpen=true;render();}),editor,status,scores,stage,h('section',{class:'e027-history'},h('h3',{},'最近 10 局摘要'),history,storage));
    root.append(style,shell);render();
    function field(label,input){return h('label',{},h('span',{},label),input);}
    function button(label,fn){return h('button',{type:'button',onclick:e=>{if(!active||destroyed||document.hidden||e.detail>1)return;fn();}},label);}
    function message(value){status.textContent=value;}
    function clearGuess(){if(guessInput)guessInput.value='';guessInput=null;}
    function clearEditor(){customReference.value='';draft.value='';customPrompt.value='';customUnit.value='';explanation.value='';bankList.replaceChildren();}
    function newGame(){if(editorOpen)return;try{const next=new Estimate({players:names.value.split(/\r?\n/).map(n=>n.trim()).filter(Boolean),questionCount:Number(count.value)},{bank});remember();clearGuess();clearEditor();game=next;generation++;recorded=false;render();}catch(error){message(error.message);}}
    function togglePause(){if(!active||destroyed||document.hidden||editorOpen||!game)return;clearGuess();if(game.view().phase==='paused')game.resume();else game.pause();render();}
    function freeze(){if(destroyed)return;clearGuess();clearEditor();editorOpen=false;game?.pause();render();}
    function addQuestion(){try{const used=new Set(bank.map(q=>q.id));let n=1;while(used.has(`M${String(n).padStart(3,'0')}`))n++;const next=validateBank([...bank,{id:`M${String(n).padStart(3,'0')}`,prompt:customPrompt.value,unit:customUnit.value,reference:customReference.value,explanation:explanation.value}]);bank=[...next];source='编辑题库';clearEditor();render();message('自建题已添加，下一局生效。');}catch(error){message(error.message);}}
    function importBank(){try{bank=[...parseBank(draft.value)];source='导入题库';clearEditor();if(Number(count.value)>bank.length)count.value=String(bank.length);render();message('题库校验通过，下一局生效。');}catch(error){message(error.message);}}
    function removeQuestion(id){bank=bank.filter(q=>q.id!==id);render();message('已删除下一局题库中的题目；当前局快照不变。');}
    function remember(){const report=game?.result();if(!report||recorded)return;recorded=true;const points=report.options.players.map((_,i)=>report.ranking.find(p=>p.player===i).points);recent=cleanHistory([{options:report.options,finishedAt:new Date().toISOString(),completedRounds:report.rounds.length,points},...recent]);const value={version:1,recent};queue=queue.then(async()=>{try{if(ctx.config?.set)await ctx.config.set(KEY,value);else localStorage.setItem(LOCAL_KEY,JSON.stringify(value));storage.textContent='';}catch{storage.textContent='历史保存失败；完整报告仍可导出。';}});}
    function run(job,fn){if(!active||destroyed||editorOpen||job!==generation)return;if(fn()){clearGuess();render();}}
    function render(){
      if(destroyed)return;remember();bankNote.textContent=`${source}：${bank.length} 题，按题库顺序使用；当前局采用建立时的快照。`;count.setAttribute('max',String(Math.max(1,bank.length)));editor.style.display=editorOpen?'':'none';stage.replaceChildren();scores.replaceChildren();bankList.replaceChildren();history.replaceChildren(...recent.map(s=>h('li',{},`${s.finishedAt.slice(0,10)} · 已揭晓 ${s.completedRounds} 轮 · ${s.options.players.map((p,i)=>`${p} ${s.points[i]} 分`).join(' / ')}`)));pause.disabled=!game||game.view().phase==='finished'||editorOpen;
      if(editorOpen){bankList.append(...bank.map(q=>h('article',{class:'e027-bank-row'},h('p',{},`${q.id}：${q.prompt}`),h('p',{},`参考 ${q.reference} ${q.unit} · ${q.explanation}`),button(`删除 ${q.id}`,()=>removeQuestion(q.id)))));message('主持人私密编辑中，竞猜已暂停。');return;}
      if(!game){message('建立新局后开始第一题。');stage.append(h('p',{},'内置 30 道原创固定数量及明确假定价格题。'));return;}
      const v=game.view();const job=generation;const token=v.questionNo;pause.textContent=v.phase==='paused'?'继续':'暂停';scores.append(...v.options.players.map((name,i)=>h('div',{},h('strong',{},name),h('span',{},`${v.scores[i]} 积分`))));
      if(v.phase==='paused'){message('已暂停；密封提交保留，未提交输入已清空。');stage.append(h('h3',{},'竞猜暂停'),h('p',{},'点击“继续”后重新交接输入。'));return;}
      if(v.phase==='finished'){const report=game.result();message(`本局结束，已统一揭晓 ${report.rounds.length} 轮。`);stage.append(h('h3',{},'累计积分排名'),cumulative(report.ranking),button('导出完整报告 JSON 副本',()=>exportData('report')),h('h3',{},'逐轮误差与排名'),...report.rounds.map(round=>roundTable(round)),...(report.abandoned?[h('p',{},`第 ${report.abandoned.questionNo} 题提前结束，未揭晓数值不导出。`)]:[]));return;}
      stage.append(h('p',{class:'e027-kicker'},`第 ${token} / ${v.total} 题 · ${v.id}`),h('h3',{class:'e027-prompt'},v.prompt),h('p',{},`本题所有输入单位：${v.unit}`));
      if(v.phase==='ready'){message('准备好后开始本题，参考值保持密封。');stage.append(button('开始本题',()=>run(job,()=>game.start(token))));}
      if(v.phase==='handoff'){const player=v.player;message(`请交给 ${v.options.players[player]}，其他玩家转身后再输入。`);stage.append(h('p',{},`已密封提交：${v.submittedPlayers.length}/${v.options.players.length} 人；数值不展示。`),button(`我是${v.options.players[player]}，独处输入`,()=>run(job,()=>game.enter(token,player))));}
      if(v.phase==='input'){const player=v.player;message(`${v.options.players[player]} 私密输入中，单位：${v.unit}。`);guessInput=h('input',{'aria-label':'我的密封猜测',inputmode:'decimal',maxlength:'10',autocomplete:'off',spellcheck:'false'});const input=guessInput;function submit(e){if(e?.repeat)return;if(e)e.preventDefault();if(!active||destroyed||editorOpen||job!==generation)return;try{if(game.submit(input.value,token,player)){input.value='';clearGuess();render();}}catch(error){message(error.message);}}input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing)submit(e);});stage.append(field(`我的猜测（${v.unit}）`,input),button('密封提交，交给下一位',()=>submit()));input.focus();}
      if(v.phase==='sealed'){message('所有玩家已密封提交，统一揭晓前不显示任何猜测或参考。');stage.append(button('统一揭晓',()=>run(job,()=>game.reveal(token))));}
      if(v.phase==='revealed'){message('本轮已统一揭晓。单轮比较误差，累计比较积分。');stage.append(roundTable(v.round),button(token===v.total?'结算本局':'下一题',()=>run(job,()=>game.next(token))));}
      stage.append(button('结束本局，保留已揭晓轮',()=>run(job,()=>game.end(token))));
    }
    function cumulative(rows){return h('ol',{},rows.map(p=>h('li',{},`第 ${p.rank} 名 · ${p.name} · ${p.points} 积分`)));}
    function roundTable(round){
      const head=h('thead',{},h('tr',{},['单轮名次','玩家','猜测','绝对误差','本轮积分'].map(label=>h('th',{scope:'col'},label))));
      const body=h('tbody',{},round.ranking.map(p=>h('tr',{},h('td',{},p.rank),h('td',{},p.name),h('td',{},`${p.guess} ${round.unit}`),h('td',{},`${p.error} ${round.unit}`),h('td',{},p.points))));
      return h('article',{class:'e027-round'},h('h4',{},`第 ${round.questionNo} 题：${round.prompt}`),h('p',{class:'e027-reference'},`固定参考：${round.reference} ${round.unit}`),h('p',{},round.explanation),h('table',{},head,body));
    }
    async function exportData(kind){if(!active||destroyed||exportBusy)return;const report=game?.result();if(kind==='report'&&!report)return;if(kind==='bank'&&!bank.length){message('题库为空，请添加题目或恢复内置题库。');return;}const files=window.toolbox?.files;if(files?.saveTextSupportsCopyOnly!==true||typeof files.saveText!=='function'){message('需要升级到支持副本保护的文件接口，当前不能导出。');return;}const job=generation;const value=kind==='bank'?{version:1,questions:bank}:{...report,exportedAt:new Date().toISOString()};exportBusy=true;try{const result=await files.saveText({content:JSON.stringify(value,null,2),extension:'json',defaultName:kind==='bank'?'估价竞猜题库.json':'估价竞猜完整报告.json',copyOnly:true});if(active&&!destroyed&&job===generation){if(result?.canceled)message('已取消保存。');else if(result?.ok===true)message('已保存为新 JSON 副本。');else message(`保存失败：${result?.error||'文件接口未确认成功'}`);}}catch(error){if(active&&!destroyed&&job===generation)message(`保存失败：${error.message||error}`);}finally{exportBusy=false;}}
    function visibility(){if(document.hidden)freeze();}
    document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',freeze);
    return {activate(){if(destroyed)return;active=true;render();},deactivate(){active=false;freeze();},destroy(){if(destroyed)return;active=false;clearGuess();clearEditor();game?.pause();remember();destroyed=true;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',freeze);root.replaceChildren();game=null;bank=[];recent=[];}};
  }
};
