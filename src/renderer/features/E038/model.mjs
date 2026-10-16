export const SOURCES=Object.freeze([
  {title:'NHS · Sitting exercises',url:'https://www.nhs.uk/live-well/exercise/sitting-exercises/'},
  {title:'NHS · Wrist pain',url:'https://www.nhs.uk/symptoms/hand-pain/wrist-pain/'},
  {title:'HSE · Work routine and breaks',url:'https://www.hse.gov.uk/msd/dse/work-routine.htm'}
]);
const BASE=[{id:'shoulders',title:'肩部放松',instruction:'双臂自然放松，肩膀轻轻向后、向下回到舒适位置，再松开。可以做几次小幅活动，其余时间安静休息。',hint:'不压头、不用力拉扯，不必持续保持姿势。'},
  {id:'wrists',title:'手腕轻动',instruction:'前臂轻放在腿上或桌上，手指轻轻打开、放松，手腕做舒适的小幅上下活动，然后休息。',hint:'不用另一只手强拉，不握紧、不负重。'}];
export function plan(posture='sit',minutes=3){
  if(!['sit','stand'].includes(posture)||!Number.isInteger(minutes)||minutes<2||minutes>5)throw Error('请选择坐姿/站姿和整数2至5分钟。');
  const last=posture==='sit'?{id:'seated-change',title:'椅上换姿',instruction:'在稳固无轮椅子上，双脚落地，轻轻调整到另一种舒服坐姿，双手放松，视线离开屏幕休息。',hint:'不需要站起、屏气或做大幅扭转。'}:{id:'walk',title:'起身走动',instruction:'确认脚下平稳、周围无障碍，按自己的节奏慢走几步，再在舒服位置休息。',hint:'不需要踮脚、单脚站立或追求步数；不方便走动可跳过。'};
  return [...BASE,last].map(c=>({...c,plannedMs:minutes*20000}));
}
export function createSession({posture='sit',minutes=3}={},clock=()=>performance.now()){
  const cards=plan(posture,minutes).map(c=>({...c,status:'pending',elapsedMs:0}));
  let lastClock=-Infinity,lastTick=null,index=0,phase='ready',pausedAt=null,pausedTotal=0,pauseCount=0,pausedBecause='',ended=false;
  const now=()=>{const n=clock();if(!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER)throw Error('单调时钟无效。');lastClock=Math.max(lastClock,n);return lastClock;};
  now();
  function advance(){const n=now();if(phase==='running'){
    let delta=n-lastTick;lastTick=n;
    while(delta>0&&index<cards.length){const c=cards[index],used=Math.min(delta,c.plannedMs-c.elapsedMs);c.elapsedMs+=used;delta-=used;
      if(c.elapsedMs===c.plannedMs){c.status='completed';index++;if(index<cards.length)cards[index].status='active';else{phase='finished';ended=true;lastTick=null;}}
    }
  }return n;}
  function snapshot(){const n=advance(),rows=cards.map(c=>({...c})),activeMs=rows.reduce((s,c)=>s+c.elapsedMs,0),skippedUnusedMs=rows.filter(c=>c.status==='skipped').reduce((s,c)=>s+c.plannedMs-c.elapsedMs,0),unspentMs=rows.filter(c=>!['skipped','completed'].includes(c.status)).reduce((s,c)=>s+c.plannedMs-c.elapsedMs,0);
    return{schema:1,posture,minutes,phase,pausedBecause,index:index<cards.length?index:null,plannedMs:minutes*60000,activeMs,remainingMs:ended?0:unspentMs,skippedUnusedMs,interruptedUnusedMs:ended?unspentMs:0,pausedMs:pausedTotal+(pausedAt===null?0:n-pausedAt),pauseCount,counts:{completed:rows.filter(c=>c.status==='completed').length,skipped:rows.filter(c=>c.status==='skipped').length,interrupted:rows.filter(c=>c.status==='interrupted').length,pending:rows.filter(c=>c.status==='pending').length},cards:rows,outcome:phase==='finished'?(rows.some(c=>c.status==='skipped')?'finished-with-skips':'timed-complete'):phase==='interrupted'?'interrupted':'in-progress',completionMeaning:'completed仅指卡片计时结束，未检测或核验身体动作。'};
  }
  function resume(){const n=advance();if(ended||phase==='running')return snapshot();if(pausedAt!==null){pausedTotal+=n-pausedAt;pausedAt=null;}phase='running';pausedBecause='';cards[index].status='active';lastTick=n;return snapshot();}
  function pause(reason='manual'){if(!['manual','left','hidden','export'].includes(reason))throw Error('暂停原因无效。');const n=advance();if(phase==='running'){phase='paused';lastTick=null;pausedAt=n;pauseCount++;pausedBecause=reason;}return snapshot();}
  function skip(expectedIndex=index){const n=advance();if(ended)return{changed:false,reason:'本次休息已结束。',session:snapshot()};if(index!==expectedIndex)return{changed:false,reason:'卡片已经切换，请核对当前卡再跳过。',session:snapshot()};cards[index].status='skipped';index++;
    if(index===cards.length){if(pausedAt!==null){pausedTotal+=n-pausedAt;pausedAt=null;}ended=true;phase='finished';lastTick=null;}else{if(phase==='running'){cards[index].status='active';lastTick=n;}else if(phase==='paused')cards[index].status='active';}
    return{changed:true,reason:'该卡已跳过，不计完成。',session:snapshot()};}
  function finish(){const n=advance();if(ended)return snapshot();if(pausedAt!==null){pausedTotal+=n-pausedAt;pausedAt=null;}if(cards[index].status==='active')cards[index].status='interrupted';phase='interrupted';ended=true;lastTick=null;return snapshot();}
  return{snapshot,tick:snapshot,resume,pause,skip,finish};
}
const sec=ms=>(ms/1000).toFixed(3).replace(/\.?0+$/,'');
export function report(session,history=[]){if(history.length>10)throw Error('记录最多10次；请先导出再明确清空。');return{schema:1,feature:'E038',current:session,history,assumptions:['纯本地休息计时；不是医疗处方、诊断或康复方案。','跳过不计完成；completed仅表示卡片计时到期，未核验身体活动。','2至5分钟是未跳过时的计划总时长；暂停不扣时间，跳过会缩短实际时长。','记录仅在当前模块内；销毁或重开不恢复，请主动另存。'],sources:SOURCES};}
export function markdown(value){const rows=s=>s.cards.map(c=>`| ${c.title} | ${sec(c.plannedMs)} | ${sec(c.elapsedMs)} | ${c.status} |`).join('\n');const block=(s,title)=>`## ${title}\n\n方式：${s.posture==='sit'?'坐姿':'站姿'}；状态：${s.outcome}；计划 ${sec(s.plannedMs)} 秒，计时 ${sec(s.activeMs)} 秒，剩余 ${sec(s.remainingMs)} 秒，跳过未用 ${sec(s.skippedUnusedMs)} 秒，中断未用 ${sec(s.interruptedUnusedMs)} 秒，暂停 ${sec(s.pausedMs)} 秒。\n\n| 卡片 | 计划秒 | 已计时秒 | 状态 |\n| --- | ---: | ---: | --- |\n${rows(s)}\n`;
  return`# 拉伸休息卡记录\n\n${value.assumptions.map(s=>'- '+s).join('\n')}\n\n${block(value.current,'当前计划')}\n${value.history.map((s,i)=>block(s,`此前记录 ${i+1}`)).join('\n')}\n## 核对来源\n\n${SOURCES.map(s=>`- [${s.title}](${s.url})`).join('\n')}\n`;
}
// Project-original static vectors; no copied photos, remote resources, animation or user HTML.
export function illustration(id,posture='sit'){
  if(!['shoulders','wrists','seated-change','walk'].includes(id)||!['sit','stand'].includes(posture))throw Error('未知插图。');
  const chair='<path d="M214 145V210H298M224 210V247M298 210V247" fill="none" stroke="#A29A86" stroke-width="10" stroke-linecap="round"/>',head='<circle cx="271" cy="61" r="24" fill="#C89978"/><path d="M252 57Q253 31 277 37Q292 40 293 58" fill="#4A5147"/>',body='<path d="M272 93L268 167" stroke="#69897C" stroke-width="43" stroke-linecap="round"/>';
  const seated=`${chair}${head}${body}<path d="M270 168L315 186L317 236M266 169L279 197L280 239M317 245H334M280 245H297" stroke="#4E625A" stroke-width="19" fill="none" stroke-linecap="round"/>`;
  const standing=`${head}${body}<path d="M271 168L251 211L236 243M271 169L306 203L326 237" stroke="#4E625A" stroke-width="19" fill="none" stroke-linecap="round"/>`;
  let shapes,label;
  if(id==='shoulders'){label='双肩放松，双臂自然下垂';shapes=(posture==='sit'?seated:standing)+'<path d="M245 102L225 145L223 177M295 102L311 145L313 177" fill="none" stroke="#C89978" stroke-width="13" stroke-linecap="round"/><path d="M207 89V119M335 89V119M200 112L207 120L214 112M328 112L335 120L342 112" fill="none" stroke="#B17957" stroke-width="3"/>';}
  else if(id==='wrists'){label='前臂有支撑，手指和手腕轻动';shapes='<rect x="170" y="203" width="316" height="13" rx="6" fill="#A29A86"/><rect x="170" y="175" width="136" height="28" rx="5" fill="#DED4BC"/><path d="M190 156L315 158" stroke="#C89978" stroke-width="39" stroke-linecap="round"/><path d="M307 148L348 137L375 129Q384 128 384 136L361 146L385 142Q395 143 391 151L361 158L387 156Q397 159 390 166L359 174L380 174Q390 178 381 185L348 189L312 169Z" fill="#C89978" stroke="#986F52" stroke-width="2"/><path d="M414 127Q437 158 414 188M408 132L414 125L424 128M408 181L414 190L424 187" fill="none" stroke="#B17957" stroke-width="3"/><path d="M185 218V249M465 218V249" stroke="#A29A86" stroke-width="9"/>';}
  else if(id==='walk'){label='周围平稳无障碍，按自己的节奏慢走';shapes=standing+'<path d="M245 101L219 127L197 138M296 100L314 123L348 117" stroke="#C89978" stroke-width="13" fill="none" stroke-linecap="round"/><path d="M374 223H445M434 215L446 223L434 231" fill="none" stroke="#B17957" stroke-width="3"/><ellipse cx="407" cy="251" rx="15" ry="5" fill="#D5C3AB"/><ellipse cx="453" cy="242" rx="15" ry="5" fill="#D5C3AB"/>';}
  else{label='双脚落地，换个舒适坐姿';shapes=seated+'<path d="M246 102L236 156L264 177M296 100L306 154L294 177" stroke="#C89978" stroke-width="13" fill="none" stroke-linecap="round"/><path d="M356 80H399M389 72L401 80L389 88" stroke="#B17957" stroke-width="3" fill="none"/>';}
  return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 310" role="img" aria-label="${label}"><rect width="640" height="310" rx="18" fill="#F2EFE6"/><path d="M145 253H491" stroke="#D4D8CE" stroke-width="3"/>${shapes}<text x="320" y="289" text-anchor="middle" font-family="Microsoft YaHei,sans-serif" font-size="18" fill="#3C5548">${label}</text></svg>`;
}
