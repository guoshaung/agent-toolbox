const rows=[
 ['早餐主食','面包','粥'],['饮品温度','热饮','冷饮'],['起床节奏','早起','晚起'],['夜晚休闲','读书','看电影'],['周末出门','逛公园','逛展览'],['旅行景色','山林','海边'],['旅行节奏','提前规划','到场再安排'],['住宿偏好','市中心','安静郊外'],['交通风景','火车','公路'],['行李准备','轻装','多带备用'],
 ['午餐选择','米饭','面条'],['零食口味','咸口','甜口'],['水果选择','苹果','橙子'],['吃饭节奏','慢慢吃','快速吃'],['餐桌分享','各点一份','一起分着吃'],['厨房尝试','照食谱','凭感觉'],['菜肴温度','刚出锅','稍放凉'],['点餐习惯','熟悉菜式','试新菜式'],['饭后选择','散步','坐着聊天'],['聚餐地点','家里做饭','外面餐馆'],
 ['工作桌面','简洁留白','物品丰富'],['记事方式','纸本','电子'],['整理时间','随手整理','集中整理'],['任务顺序','先难后易','先易后难'],['学习地点','安静房间','热闹咖啡馆'],['学习材料','文字','图示'],['遇到难题','先自己试','先问别人'],['休息安排','短休多次','长休一次'],['计划精度','按小时','按一天'],['完成庆祝','安静放松','找人分享'],
 ['音乐音量','轻声背景','专心听大声'],['歌单方式','单曲循环','随机播放'],['电影类型','喜剧','悬疑'],['故事结尾','开放留白','明确收束'],['游戏合作','一起配合','友好竞赛'],['摄影对象','风景','日常物品'],['创作起点','先列提纲','边做边想'],['手工材料','纸张','木材'],['运动时段','上午','傍晚'],['运动环境','室内','户外'],
 ['聊天方式','面对面','文字消息'],['聚会人数','小组几人','一群朋友'],['邀约时间','早些确定','临时起意'],['礼物方式','实用物品','体验活动'],['生日活动','安静吃饭','热闹聚会'],['照片分享','挑几张','做整本相册'],['宠物观察','猫','狗'],['天气选择','晴天','小雨天'],['季节偏好','春天','秋天'],['房间灯光','暖色','冷色'],
 ['窗外风景','城市街景','自然景观'],['新技能','乐器','绘画'],['展览主题','科学','艺术'],['休闲阅读','短篇','长篇'],['散步路线','熟悉路线','新路线'],['购物方式','先列清单','到店再看'],['用品色彩','单色','多彩'],['纪念方式','写日记','拍照片'],['一天空闲','集中做一件事','尝试几件小事'],['结束一天','听音乐','静坐']
];
export const QUESTIONS=Object.freeze(rows.map(([title,a,b],i)=>Object.freeze({id:'Q'+String(i+1).padStart(2,'0'),title,a,b})));
const clone=x=>JSON.parse(JSON.stringify(x));
export function createGame(names,questionIds){
 if(!Array.isArray(names)||names.length<2||names.length>8||names.some(n=>typeof n!=='string'||!n.trim()||n.length>40||/[\x00-\x1f\x7f]/.test(n)))throw Error('请填写2–8名玩家，每个名字1–40字符单行文本。');
 const players=names.map(n=>n.trim());if(new Set(players.map(n=>n.normalize('NFKC').toLowerCase())).size!==players.length)throw Error('玩家名字不能重复。');
 if(!Array.isArray(questionIds)||questionIds.length<1||questionIds.length>60||new Set(questionIds).size!==questionIds.length||questionIds.some(id=>!QUESTIONS.some(q=>q.id===id)))throw Error('题目须为1–60道不重复的内置题。');
 return{version:1,players,questionIds:[...questionIds],answers:players.map(()=>[]),player:0,question:0,status:'playing'};
}
export function current(game){if(game.status!=='playing')throw Error('本局已结束。');return{player:game.player,author:game.players[game.player],questionIndex:game.question,question:QUESTIONS.find(q=>q.id===game.questionIds[game.question]),lastForPlayer:game.question===game.questionIds.length-1,lastForGame:game.player===game.players.length-1&&game.question===game.questionIds.length-1};}
export function seal(game,choice){current(game);if(!['A','B'].includes(choice))throw Error('先选择A或B，再密封本题。');const next=clone(game);next.answers[next.player].push(choice);if(next.question<next.questionIds.length-1)next.question++;else if(next.player<next.players.length-1){next.player++;next.question=0;}else next.status='completed';return next;}
export function report(game){if(game.status!=='completed')throw Error('全部玩家密封完成后才可揭晓或导出。');const n=game.questionIds.length,pairs=[];for(let i=0;i<game.players.length;i++)for(let j=i+1;j<game.players.length;j++){const same=game.answers[i].reduce((s,v,k)=>s+(v===game.answers[j][k]?1:0),0);pairs.push({left:game.players[i],right:game.players[j],same,total:n,percent:Math.round(same/n*10000)/100});}
 const questions=game.questionIds.map((id,i)=>{const q=QUESTIONS.find(q=>q.id===id),choices=game.players.map((name,p)=>({name,choice:game.answers[p][i],text:game.answers[p][i]==='A'?q.a:q.b})),a=choices.filter(c=>c.choice==='A').length;return{...q,choices,counts:{A:a,B:choices.length-a},largestSameCount:Math.max(a,choices.length-a)};});
 return{feature:'E029',version:1,complete:true,players:[...game.players],questionCount:n,pairs,questions,policy:'偏好一致率仅为本局所选题的娱乐统计，无标准答案，不推断人格或关系质量。同屏交接是合作约定，不提供登录/加密隔离。'};
}
const xml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function card(result){
 const lines=result.pairs.map(p=>`${p.left} ↔ ${p.right}：${p.same}/${p.total} = ${p.percent}%`),height=180+lines.length*38;
 const pairTexts=lines.map((s,i)=>`<text x="30" y="${135+i*38}" font-size="${Math.min(18,Math.floor(730/[...s].length*10)/10)}">${xml(s)}</text>`).join('');
 return`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}"><rect width="800" height="${height}" fill="#16211f"/><g fill="#e4ece8" font-family="sans-serif"><text x="30" y="50" font-size="28">默契测试 · ${result.questionCount}题</text><text x="30" y="88" font-size="16">只记录本局偏好一致率；不评价关系质量</text>${pairTexts}<text x="30" y="${height-20}" font-size="14">E029 · 全部玩家已密封并统一揭晓</text></g></svg>`;
}
export function markdown(result){const escape=v=>String(v).replace(/[|`\r\n]/g,' ').replaceAll('<','&lt;').replaceAll('>','&gt;');return`# 默契测试\n\n${result.policy}\n\n`+result.pairs.map(p=>`${escape(p.left)} ↔ ${escape(p.right)}：${p.same}/${p.total}，${p.percent}%`).join('\n\n')+'\n\n## 逐题选择\n\n'+result.questions.map(q=>`${q.id} ${escape(q.title)}（A ${escape(q.a)} / B ${escape(q.b)}）：`+q.choices.map(c=>`${escape(c.name)}=${c.choice}`).join('；')+`；最多同选${q.largestSameCount}人`).join('\n\n')+'\n';}
