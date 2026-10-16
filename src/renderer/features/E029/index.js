import {h} from '../../core/ui.js';
import {QUESTIONS,createGame,current,seal,report,card,markdown} from './model.mjs';
export default{id:'E029',create(root){
 let game=null,phase='setup',choice=null,active=true,alive=true,busy=false,previousPhase=null;const stage=h('div'),status=h('p',{role:'status',class:'e029-status'}),files=window.toolbox?.files;
 const safe=()=>files?.saveTextSupportsCopyOnly===true&&typeof files.saveText==='function';const say=v=>{if(alive)status.textContent=v;};
 const button=(label,action)=>h('button',{class:'btn',type:'button',onclick:()=>{if(alive&&active&&!busy)action();}},label);
 const scrub=node=>{if(node.nodeType===3){node.textContent='';return;}for(const child of [...node.childNodes])scrub(child);if('value' in node)node.value='';node.replaceChildren?.();};
 let names='小明\n小红',count=10;const label=(text,input)=>h('label',{},text,input);
 function render(){scrub(stage);if(!alive)return;if(!active){stage.append(h('p',{},'已暂停，返回后恢复同一玩家与当前未提交选择。'));return;}
  if(phase==='setup'){
   const players=h('textarea',{rows:4,maxlength:400,'aria-label':'每行一名玩家',oninput:()=>names=players.value});players.value=names;
   const rounds=h('input',{type:'number',min:1,max:60,step:1,'aria-label':'题数',oninput:()=>count=Number(rounds.value)});rounds.value=count;
   stage.append(label('2–8名玩家，名字唯一',players),label('题数1–60',rounds),button('开始密封测试',()=>{
    try{if(!Number.isInteger(count)||count<1||count>60)throw Error('题数须为1–60整数。');const shuffled=[...QUESTIONS];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}game=createGame(names.split(/\r?\n/),shuffled.slice(0,count).map(q=>q.id));phase='handoff';choice=null;render();say('本局题目与玩家顺序已锁定，全部完成后统一揭晓。');}catch(e){say(e.message);}
   }),button('载入两人十题验收局',()=>{game=createGame(['小明','小红'],QUESTIONS.slice(0,10).map(q=>q.id));phase='handoff';choice=null;render();say('固定前十题，用于核对7/10=70%示例。');}),h('p',{},'60道原创生活偏好题，没有标准答案。随机开始不重复抽题；验收局固定前十题。题目/玩家在局中锁定，每人连续答全部题再交接。'));
  }else if(phase==='handoff'){
   const turn=current(game);stage.append(h('h3',{},`请交给 ${turn.author}`),h('p',{},`每人${game.questionIds.length}题。该玩家亲自点击进入，交接页没有选项记录。`),button(`我是${turn.author}，开始选择`,()=>{phase='choosing';render();}),newButton());
  }else if(phase==='choosing'){
   const turn=current(game),q=turn.question;
   const selected=h('p',{'aria-live':'polite','aria-label':'自己的当前选择'},choice?`你的当前选择：${choice} ${choice==='A'?q.a:q.b}`:'尚未选择');
   const a=button(`A：${q.a}`,()=>pick('A')),b=button(`B：${q.b}`,()=>pick('B'));
   function pick(value){choice=value;selected.textContent=`你的当前选择：${value} ${value==='A'?q.a:q.b}`;a.setAttribute('aria-pressed',String(value==='A'));b.setAttribute('aria-pressed',String(value==='B'));submit.disabled=false;}
   a.setAttribute('aria-pressed',String(choice==='A'));b.setAttribute('aria-pressed',String(choice==='B'));
   const submit=button(turn.lastForGame?'密封最后一题并统一揭晓':turn.lastForPlayer?'密封本题并交接':'密封本题，进入下一题',()=>{
    try{game=seal(game,choice);choice=null;phase=game.status==='completed'?'closed':turn.lastForPlayer?'handoff':'choosing';render();say(game.status==='completed'?'所有选择已密封，现在统一揭晓。':'本题已密封，不能回改；旧选择节点已清空。');}catch(e){say(e.message);}
   });submit.disabled=!choice;
   stage.append(h('h3',{},`${turn.author} · 第${turn.questionIndex+1}/${game.questionIds.length}题`),h('h4',{},`${q.id} ${q.title}`),h('div',{class:'e029-actions'},a,b),selected,submit,newButton());
  }else if(phase==='confirmNew'){
   stage.append(h('p',{},'确认后清空本局所有选择和结果。需要保留的完成结果请先返回导出。'),button('确认清空并新建',()=>{game=null;choice=null;phase='setup';render();say('请重新设置。');}),button('返回本局',()=>{phase=previousPhase;render();}));
  }else if(phase==='closed'){
   const result=report(game);stage.append(h('h3',{},`统一揭晓 · ${result.questionCount}题`),h('p',{},result.policy),h('ul',{},result.pairs.map(p=>h('li',{class:'e029-pair'},`${p.left} ↔ ${p.right}：${p.same}/${p.total} = ${p.percent}%`))),h('img',{class:'e029-card',alt:'本局全部两人配对的一致率分享卡',src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(card(result))}),h('details',{},h('summary',{},'全部题目与选择'),result.questions.map(q=>h('p',{},`${q.id} ${q.title}：${q.choices.map(c=>`${c.name}=${c.choice}（${c.text}）`).join('；')}。A ${q.counts.A}人 / B ${q.counts.B}人，最多同选${q.largestSameCount}人。`))),h('div',{class:'e029-actions'},...['json','md','svg'].map(ext=>{const b=button(`保存 ${ext.toUpperCase()} 结果副本`,()=>save(result,ext));b.disabled=!safe();return b;})),newButton());
  }
 }
 function newButton(){return button('建立新局',()=>{previousPhase=phase;phase='confirmNew';render();});}
 async function save(result,extension){if(!safe()||busy)return;busy=true;try{const content=extension==='json'?JSON.stringify(result,null,2):extension==='md'?markdown(result):card(result);const r=await files.saveText({content,extension,defaultName:`E029-preference-results.${extension}`,copyOnly:true});say(r?.ok===true?'已保存结果新副本。':r?.canceled?'已取消保存。':'保存失败：'+(r?.error||'没有明确成功结果'));}catch(e){say('保存失败：'+e.message);}finally{busy=false;}}
 root.replaceChildren(h('section',{class:'e029'},h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href}),h('h2',{},'默契测试'),h('p',{},'逐人作答并密封，最后统一揭晓。同屏隐私依靠合作交接，不是登录权限或加密隔离。'),status,stage,h('p',{},'本局只在当前面板内存。暂停遮住界面并保留当前自己的选择；切换功能清空未保存内容。所有人完成之前不能导出，完成后JSON/Markdown/SVG副本都拒绝覆盖已有文件。')));render();
 return{activate(){if(alive){active=true;render();}},deactivate(){if(alive){active=false;render();}},destroy(){alive=false;active=false;scrub(stage);game=null;choice=null;root.replaceChildren();}};
}};
