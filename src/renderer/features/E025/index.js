import { h } from '../../core/ui.js';
import { Quiz, KEYS, MAX_IMPORT, parseBank, cleanHistory } from './model.mjs';
import { QUESTIONS } from './questions.mjs';

const HISTORY_KEY = 'features.E025.history';
const LOCAL_KEY = 'agent-toolbox:E025:history:v1';
const REASONS = {correct:'回答正确',allWrong:'所有玩家答错',wrongNoRetry:'答错，本局关闭续抢',hostEnd:'主持人结束本题'};
export default {
  id:'E025',
  create(root,ctx={}) {
    let active=false;let destroyed=false;let game=null;let bank=QUESTIONS;let imported=false;let hostVisible=false;let editorVisible=false;let generation=0;let recorded=false;let recent=[];let queue=Promise.resolve();let storageMessage='';let exportBusy=false;
    const held=new Set();
    try { const saved=ctx.config?.get?ctx.config.get(HISTORY_KEY,null):JSON.parse(localStorage.getItem(LOCAL_KEY)||'null');recent=cleanHistory(saved?.version===1?saved.recent:null); } catch {storageMessage='历史读取失败，可以继续游玩。';}
    const style=h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href});
    const count=h('select',{'aria-label':'玩家人数',onchange:playerFields},[2,3,4].map(n=>h('option',{value:n},`${n} 人`)));count.value='2';
    const names=['小明','小红','小蓝','小绿'].map((name,i)=>h('input',{value:name,maxlength:'20','aria-label':`玩家 ${i+1} 名称`}));
    const keys=names.map((_,i)=>{const input=h('select',{'aria-label':`玩家 ${i+1} 键位`},KEYS.map(k=>h('option',{value:k},k.slice(3))));input.value=KEYS[i];return input;});
    const players=names.map((input,i)=>h('div',{class:'e025-player-setting'},field(`玩家 ${i+1}`,input),field('按键',keys[i])));
    const questionCount=h('input',{type:'number',min:'1',max:'50',step:'1',value:'10','aria-label':'题数'});
    const retry=h('select',{'aria-label':'答错续抢'},h('option',{value:'yes'},'允许剩余玩家续抢'),h('option',{value:'no'},'答错即结束本题'));retry.value='yes';
    const bankNote=h('p',{class:'e025-muted'},'内置原创题库：50 题，按题号顺序出题。');
    const stage=h('section',{class:'e025-stage','aria-label':'抢答区'});
    const scoreboard=h('div',{class:'e025-scores','aria-label':'玩家比分'});
    const status=h('p',{class:'e025-status',role:'status','aria-live':'polite'});
    const pause=h('button',{type:'button',onclick:togglePause},'暂停');pause.disabled=true;
    const draft=h('textarea',{'aria-label':'主持人题库 JSON',maxlength:String(MAX_IMPORT),rows:'9',spellcheck:'false',oninput:()=>{if(draft.value.length>MAX_IMPORT){draft.value=draft.value.slice(0,MAX_IMPORT);message('草稿已限制为 65536 字符。');}}});
    const editor=h('section',{class:'e025-editor'},h('h3',{},'主持人私密题库编辑'),h('p',{},'其他玩家请转身。格式为 {"version":1,"questions":[{"id":"MY001","question":"题目","answer":"答案","explanation":"解释","source":"来源简述"}]}。所有字段必填；导入仅作为文本，不执行代码。'),draft,
      button('校验并使用题库',importBank),button('放弃草稿并隐藏',()=>{draft.value='';editorVisible=false;render();}),button('恢复内置 50 题',()=>{bank=QUESTIONS;imported=false;draft.value='';editorVisible=false;updateBank();render();message('已恢复内置题库；建立新局后生效。');}));
    const history=h('ol',{});const storage=h('p',{class:'e025-muted',role:'status'},storageMessage);
    const shell=h('section',{class:'feature-e025','aria-label':'同屏抢答'},
      h('header',{class:'e025-heading'},h('div',{},h('h2',{},'同屏抢答'),h('p',{},'先开题，再开抢；主持人听取口头答案并判定。')),pause),
      h('div',{class:'e025-settings'},field('人数',count),...players,field('题数',questionCount),field('答错规则',retry),button('建立新局',newGame)),
      h('p',{class:'e025-rule'},'固定计分：答对 +2，答错 −1，未作答 0。首键唯一锁定；允许续抢时，已答错者不能再抢本题。'),
      h('p',{class:'e025-muted'},'键位使用物理字母键，无需输入法切换。按住、组合键及输入框内按键不会抢答；也可点击玩家抢答按钮。没有自动答案识别。'),
      h('p',{class:'e025-warning'},'答案只由主持人私下查看，请让其他玩家转身。关闭工作台、窗口失焦或隐藏页面会暂停，恢复需点击继续；切换具体功能或新建一局会丢失未导出的详细记录。'),
      bankNote,button('主持人独处，编辑题库',()=>{if(!active)return;game?.pause();hostVisible=false;editorVisible=true;render();}),
      editor,scoreboard,status,stage,h('section',{class:'e025-history'},h('h3',{},'最近 10 局成绩摘要'),history,storage));
    root.append(style,shell);playerFields();render();
    function field(label,input){return h('label',{},h('span',{},label),input);}
    function button(label,fn){return h('button',{type:'button',onclick:e=>{if(!active||destroyed||e.detail>1)return;fn();}},label);}
    function playerFields(){const n=Number(count.value);players.forEach((p,i)=>{p.style.display=i<n?'':'none';names[i].disabled=i>=n;keys[i].disabled=i>=n;});}
    function message(value){status.textContent=value;}
    function updateBank(){bankNote.textContent=`${imported?'导入':'内置原创'}题库：${bank.length} 题，按题库顺序出题。题库变更在建立新局时生效。`;questionCount.setAttribute('max',bank.length);if(Number(questionCount.value)>bank.length)questionCount.value=String(bank.length);}
    function importBank(){try{const next=parseBank(draft.value);bank=next;imported=true;draft.value='';editorVisible=false;updateBank();render();message(`题库 ${next.length} 题已通过校验；请建立新局。`);}catch(error){message(error.message);}}
    function newGame(){if(!active||editorVisible)return;try{if(!['yes','no'].includes(retry.value))throw new RangeError('请选择有效的答错规则。');const n=Number(count.value);const next=new Quiz({players:names.slice(0,n).map((p,i)=>({name:p.value,key:keys[i].value})),questionCount:Number(questionCount.value),retryWrong:retry.value==='yes'},{bank,now:()=>performance.now()});remember();game=next;generation++;recorded=false;hostVisible=false;held.clear();render();}catch(error){message(error.message);}}
    function action(fn){if(!active||destroyed||editorVisible)return;hostVisible=false;if(fn())render();}
    function togglePause(){if(!active||!game||editorVisible)return;hostVisible=false;const view=game.view();if(view.phase==='paused')game.resume();else game.pause();render();}
    function freeze(){if(destroyed)return;hostVisible=false;editorVisible=false;game?.pause();render();}
    function remember(){const report=game?.result();if(!report||recorded)return;recorded=true;recent=cleanHistory([{options:report.options,scores:report.scores,finishedAt:new Date().toISOString()},...recent]);const value={version:1,recent};queue=queue.then(async()=>{try{if(ctx.config?.set)await ctx.config.set(HISTORY_KEY,value);else localStorage.setItem(LOCAL_KEY,JSON.stringify(value));storage.textContent='';}catch{storage.textContent='历史保存失败；本局详细报告仍可导出。';}});}
    function renderHistory(){history.replaceChildren(...recent.map(s=>h('li',{},`${s.finishedAt.slice(0,10)} · ${s.options.questionCount} 题 · ${s.options.players.map((p,i)=>`${p.name} ${s.scores[i]} 分`).join(' / ')}`)));}
    function render(){
      if(destroyed)return;remember();renderHistory();editor.style.display=editorVisible?'':'none';stage.replaceChildren();scoreboard.replaceChildren();pause.disabled=!game||game.view().phase==='finished'||editorVisible;
      if(editorVisible){stage.append(h('p',{},'玩家抢答已停止。隐藏草稿后，暂停中的赛局需手动继续。'));message('主持人私密编辑中；不要让玩家查看草稿。');return;}
      if(!game){message('设置玩家和题数，点击“建立新局”。');stage.append(h('p',{},'内置题库提供 50 道明确答案题；无需联网。'));return;}
      const v=game.view();const token=v.questionNo;const job=generation;
      scoreboard.append(...v.options.players.map((p,i)=>h('div',{class:'e025-score'},h('strong',{},p.name),h('span',{},`${v.scores[i]} 分 · ${p.key.slice(3)} 键`))));
      pause.textContent=v.phase==='paused'?'继续':'暂停';
      if(v.phase==='paused'){message('已暂停，首抢归属和已错玩家保持不变。');stage.append(h('h3',{},'抢答暂停'),h('p',{},'点击“继续”恢复；暂停期间任何抢答或判分无效。'));return;}
      if(v.phase==='finished'){const report=game.result();message(`本局 ${v.total} 题已完成。`);stage.append(h('h3',{},'最终排行榜'),h('ol',{class:'e025-ranking'},report.ranking.map(p=>h('li',{},`第 ${p.rank} 名 · ${p.name} · ${p.score} 分`))),button(exportBusy?'正在保存…':'导出完整 JSON 副本',exportReport),h('h3',{},'逐题抢答判定记录'),...report.rounds.map(r=>h('article',{class:'e025-record'},h('h4',{},`${r.questionNo}. ${r.question}`),h('p',{},`答案：${r.answer} · ${REASONS[r.reason]}`),h('p',{},r.explanation),h('p',{class:'e025-muted'},r.source),attemptList(r.attempts))));return;}
      if(v.phase==='closed'){const r=v.last;message(`第 ${token}/${v.total} 题结束：${REASONS[r.reason]}。`);stage.append(h('h3',{},r.question),h('p',{class:'e025-answer'},`标准答案：${r.answer}`),h('p',{},r.explanation),h('p',{class:'e025-muted'},r.source),attemptList(r.attempts),button(token===v.total?'结算本局':'下一题',()=>{if(job===generation)action(()=>game.next(token));}));return;}
      if(hostVisible&&v.phase==='locked'){const answer=game.hostAnswer(token);message('主持人私密答案，请其他玩家转身。');stage.append(h('h3',{},'主持人私密答案'),h('p',{class:'e025-answer'},answer.answer),h('p',{},answer.explanation),h('p',{class:'e025-muted'},answer.source),button('隐藏答案，返回判定',()=>{hostVisible=false;render();}));return;}
      stage.append(h('p',{class:'e025-kicker'},`第 ${token} / ${v.total} 题`),h('h3',{class:'e025-question'},v.prompt));
      if(v.phase==='ready'||v.phase==='retryReady'){message(v.phase==='ready'?'题目已打开，主持人准备好后再开抢。':'上位玩家答错且已被排除；主持人确认后重新开抢。');stage.append(button(v.phase==='ready'?'开抢':'剩余玩家重新开抢',()=>{if(job===generation)action(()=>game.open(token));}));}
      if(v.phase==='open'){message('抢答开放：第一位按键或点击的玩家获得唯一答题权。');stage.append(h('div',{class:'e025-buzzers'},v.options.players.map((p,i)=>{const b=button(`${p.name} 抢答（${p.key.slice(3)}）`,()=>{if(job===generation)action(()=>game.buzz(i,token));});b.disabled=v.rejected.includes(i);return b;})));}
      if(v.phase==='locked'){message(`已锁定：${v.options.players[v.owner].name}。其他按键不会改变归属。`);const claim=v.claim;stage.append(h('strong',{class:'e025-owner'},`${v.options.players[v.owner].name} 请口头回答`),button('主持人独处，查看答案',()=>{hostVisible=true;render();}),h('div',{class:'e025-judges'},button('判答对（+2）',()=>{if(job===generation)action(()=>game.judge(true,token,claim));}),button('判答错（−1）',()=>{if(job===generation)action(()=>game.judge(false,token,claim));})));}
      if(v.rejected.length)stage.append(h('p',{},`本题已错：${v.rejected.map(i=>v.options.players[i].name).join('、')}；不可再抢本题。`));
      stage.append(button('主持人结束本题',()=>{if(job===generation)action(()=>game.skip(token));}));
    }
    function attemptList(attempts){return h('ol',{},attempts.length?attempts.map(a=>h('li',{},`${a.name}（${a.key.slice(3)}）· ${a.correct?'答对 +2':'答错 −1'} · 开抢后 ${a.latencyMs} ms`)):h('li',{},'无人作答，所有玩家本题 0 分。'));}
    function editing(target){for(let el=target;el;el=el.parentElement||el.parentNode){if(['INPUT','TEXTAREA','SELECT'].includes(String(el.tagName).toUpperCase())||el.isContentEditable||el.getAttribute?.('contenteditable')==='true')return true;}return false;}
    function onKey(e){if(!active||destroyed||editorVisible||hostVisible||document.hidden||e.repeat||e.isComposing||e.ctrlKey||e.altKey||e.metaKey||e.shiftKey||editing(e.target)||editing(document.activeElement)||held.has(e.code))return;const v=game?.view();if(!v||v.phase!=='open')return;const player=v.options.players.findIndex(p=>p.key===e.code);if(player<0)return;held.add(e.code);if(game.buzz(player,v.questionNo)){e.preventDefault();render();}}
    function onRelease(e){held.delete(e.code);}
    function visibility(){if(document.hidden)freeze();}
    async function exportReport(){const report=game?.result();if(!report||exportBusy||!active)return;const files=window.toolbox?.files;if(files?.saveTextSupportsCopyOnly!==true||typeof files.saveText!=='function'){message('完整报告需升级到支持副本保护的文件接口，当前无法导出。');return;}const job=generation;exportBusy=true;try{const result=await files.saveText({content:JSON.stringify({...report,exportedAt:new Date().toISOString()},null,2),extension:'json',defaultName:'同屏抢答完整报告.json',copyOnly:true});if(active&&!destroyed&&job===generation)message(result?.canceled?'已取消保存。':'完整报告已保存为新副本。');}catch(error){if(active&&!destroyed&&job===generation)message(`保存失败：${error.message||error}`);}finally{exportBusy=false;}}
    document.addEventListener('keydown',onKey);document.addEventListener('keyup',onRelease);document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',freeze);
    return {activate(){if(destroyed)return;active=true;render();},deactivate(){active=false;freeze();},destroy(){if(destroyed)return;active=false;hostVisible=false;game?.pause();remember();destroyed=true;held.clear();draft.value='';document.removeEventListener('keydown',onKey);document.removeEventListener('keyup',onRelease);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',freeze);stage.replaceChildren();root.replaceChildren();game=null;bank=QUESTIONS;recent=[];}};
  }
};
