export const STEPS=Object.freeze([
  {id:'color',title:'周围的颜色',prompt:'看一看身边一个物体的颜色。可以只留意一种颜色，不需要说出名称。',alternative:'不方便看或不想做，可以跳过。'},
  {id:'surface',title:'表面与纹理',prompt:'留意一个熟悉物体的表面，看看它是光滑、粗糙还是有纹路。想触摸时，只选你知道安全的表面；只看也可以。',alternative:'不必触碰陌生、高温或锋利的物体；可以跳过。'},
  {id:'sound',title:'此刻的声音',prompt:'留意周围已有的一个声音。也许很轻，也许此刻安静，都不需要寻找或制造声音。',alternative:'应用不会打开麦克风或录音。不方便听或不想做，可以跳过。'},
  {id:'shape',title:'轮廓与形状',prompt:'留意身边一件物体的轮廓，看看它是直线、弧线还是别的形状。不需要判断好坏。',alternative:'不需要移动物体，也不必辨认精确形状；可以跳过。'},
  {id:'space',title:'近处与远处',prompt:'在舒服位置留意一件近处的东西和一件较远的东西，看看它们在空间中的位置。然后决定是否结束这次观察。',alternative:'不必移动身体、调整呼吸或强迫转移视线；可以跳过。'}
].map(s=>Object.freeze({...s,suggestedMs:36000})));
export const TOTAL_MS=180000;
export function createSession(clock=()=>performance.now()){
  const rows=STEPS.map(s=>({...s,status:'unobserved',timedMs:0}));let index=0,ended=false,timerState='ready',lastClock=-Infinity,lastTick=null,timedMs=0,pausedAt=null,pausedTotal=0,pauseCount=0,pauseReason='';
  const now=()=>{const n=clock();if(!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER)throw Error('单调时钟无效。');lastClock=Math.max(lastClock,n);return lastClock;};now();
  function advance(){const n=now();if(timerState==='running'){const delta=Math.min(TOTAL_MS-timedMs,n-lastTick);rows[index].timedMs+=delta;timedMs+=delta;lastTick=n;if(timedMs===TOTAL_MS){timerState='expired';lastTick=null;}}return n;}
  function snapshot(){const n=advance();return{schema:1,phase:ended?'ended':'observing',timerState,pauseReason,index:ended?null:index,suggestedMs:TOTAL_MS,timedMs,suggestedUnspentMs:TOTAL_MS-timedMs,pausedMs:pausedTotal+(pausedAt===null?0:n-pausedAt),pauseCount,counts:{confirmed:rows.filter(s=>s.status==='confirmed').length,skipped:rows.filter(s=>s.status==='skipped').length,unobserved:rows.filter(s=>s.status==='unobserved').length},steps:rows.map(s=>({...s})),meaning:'confirmed仅指用户主动确认；计时到期不确认、不推进、不结束观察，未核验感官活动。'};}
  function resume(){const n=advance();if(ended||timerState==='running'||timerState==='expired')return snapshot();if(pausedAt!==null){pausedTotal+=n-pausedAt;pausedAt=null;}timerState='running';lastTick=n;pauseReason='';return snapshot();}
  function pause(reason='manual'){if(!['manual','left','hidden','export'].includes(reason))throw Error('暂停原因无效。');const n=advance();if(timerState==='running'){timerState='paused';lastTick=null;pausedAt=n;pauseCount++;pauseReason=reason;}return snapshot();}
  function finish(){const n=advance();if(ended)return snapshot();if(pausedAt!==null){pausedTotal+=n-pausedAt;pausedAt=null;}ended=true;if(timerState!=='expired')timerState='stopped';lastTick=null;pauseReason='';return snapshot();}
  function decide(status,expectedIndex=index){advance();if(!['confirmed','skipped'].includes(status))throw Error('观察状态无效。');if(ended)return{changed:false,reason:'本次已经结束。',session:snapshot()};if(index!==expectedIndex)return{changed:false,reason:'步骤已切换，请核对当前提示。',session:snapshot()};rows[index].status=status;if(index===rows.length-1){finish();index=rows.length;}else index++;return{changed:true,reason:status==='confirmed'?'已记下你的主动确认。':'这一步已跳过，不计观察完成。',session:snapshot()};}
  return{snapshot,tick:snapshot,resume,pause,finish,decide};
}
export function report(session){return{schema:1,feature:'E039',session,assumptions:['五步固定顺序：颜色、表面、声音、轮廓、空间；每步建议36秒，总建议180秒。','建议倒计时不自动确认、不推进步骤、不结束观察；提前确认/跳过/结束不会伪造用满180秒。','confirmed只表示用户点击确认，skipped与unobserved均不算完成；无感官活动核验。','timedMs仅为已运行的建议倒计时，最多180秒；建议到期后的观察时长不追踪，不是总实际观察时长。','无摄像头/麦克风/录音/必填文字/呼吸调整；只有选择和计时记录。','仅当前模块临时记录；重开不会恢复，主动另存副本可保留。']};}
export function markdown(value){const s=value.session;return`# 感官观察记录\n\n${value.assumptions.map(s=>'- '+s).join('\n')}\n\n状态：${s.phase}；建议计时：${s.timerState}。建议 ${(s.suggestedMs/1000).toFixed(3)} 秒，已运行 ${(s.timedMs/1000).toFixed(3)} 秒，建议未用 ${(s.suggestedUnspentMs/1000).toFixed(3)} 秒，暂停 ${(s.pausedMs/1000).toFixed(3)} 秒。\n\n主动确认 ${s.counts.confirmed}/5；跳过 ${s.counts.skipped}/5；未观察 ${s.counts.unobserved}/5。\n\n| 顺序 | 提示 | 建议秒 | 已计时秒 | 状态 |\n| ---: | --- | ---: | ---: | --- |\n${s.steps.map((r,i)=>`| ${i+1} | ${r.title} | 36 | ${(r.timedMs/1000).toFixed(3)} | ${r.status} |`).join('\n')}\n\n${s.steps.map((r,i)=>`## ${i+1}. ${r.title}\n\n${r.prompt}\n\n${r.alternative}\n`).join('\n')}\n`;
}
