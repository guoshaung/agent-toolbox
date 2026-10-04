export const LIMITS = Object.freeze({ players: 8, rounds: 10, paragraph: 1000, draftUnits: 2000, totalCharacters: 80000, hint: 80, exportBytes: 512 * 1024 });
export const OPENINGS = Object.freeze([
  ['C01', '迟到的邮筒', '小镇的邮筒每天只收一封信，而且总在昨天被寄出。今天，邮筒里第一次传来了敲门声。'],
  ['C02', '云端菜市场', '早市里有人卖半朵云，价签写着三次真心的笑。阿禾刚付完钱，天空就空出了一块。'],
  ['C03', '会迷路的地图', '这张地图每到夜里便把街道重新排列。今晨，家门口多出了一条通往海底的路。'],
  ['C04', '口袋里的星期八', '我在旧外套口袋里找到一张星期八的日历。窗外所有钟表，都比刚才慢了一拍。'],
  ['C05', '屋顶售票员', '屋顶上的猫每天替日出检票，从不允许谁逃票。今天，它把一张票递给了我。'],
  ['C06', '镜中空座', '咖啡馆的镜子里总比现实多一张空椅。今夜，椅子上出现了一把还带雨水的伞。'],
  ['C07', '沉默的广播', '村里的广播停了十年，却仍按时播放寂静。某个清晨，寂静里有人念出了我的名字。'],
  ['C08', '种下一盏灯', '祖母让我把坏掉的台灯埋进花园，说春天会长出答案。三天后，土里亮起了一个问号。'],
  ['C09', '借来的影子', '影子租赁店只在阴天开门，每次租期恰好一小时。我借来的影子，却不肯跟我回家。'],
  ['C10', '旧站台的新车', '最后一班火车已经停运二十年，站长仍每天擦拭时刻表。今晚，表上多了一行没有目的地的车次。'],
  ['C11', '装满海浪的瓶', '我买了一只玻璃瓶，瓶口偶尔传来退潮的声音。倒过来时，一座小小的灯塔掉在了桌上。'],
  ['C12', '密码是一首歌', '仓库门上的锁不认钥匙，只认没被唱完的歌。我刚唱出第一句，门后就接上了第二句。'],
  ['C13', '雨伞招领处', '招领处收到一把会自己撑开的伞，标签上写着失主是雨。值班员决定等下一场雨亲自来取。'],
  ['C14', '纸船的航海日志', '我折的纸船沿水沟出发，第二天带回一册航海日志。最后一页画着我们家尚未建成的窗户。'],
  ['C15', '消失的零点', '整座城市的钟都从十一点五十九跳到了零点零一。只有面包店的烤箱，留下了那失踪的一分钟。'],
  ['C16', '月亮的失物清单', '天文台收到一份月亮寄来的失物清单，其中包括一枚蓝色纽扣。我低头一看，袖口正好少了一枚。'],
  ['C17', '空白书的读者', '图书馆里有一本没有任何字的书，却每天被不同的人借走。轮到我时，借书卡上写着请不要读最后一页。'],
  ['C18', '向北的电梯', '这部电梯没有楼层按钮，只有四个方向。按下向北后，门外出现了一片正在下雪的树林。'],
  ['C19', '修理梦的铺子', '修理铺门口挂着歪斜的梦，老板说只能修好结尾。我带来的梦却只有一段模糊的开头。'],
  ['C20', '会发芽的车票', '长途车票在抽屉里发了芽，枝叶上挂着未去过的地名。第一片叶子落下时，远方有人按响了门铃。'],
  ['C21', '风的值班表', '气象站收到一张风的值班表，周三那栏空着。到了周三，整片森林都屏住了呼吸。'],
  ['C22', '小岛的招工启事', '一座会漂移的小岛招聘守岸人，条件是记得每个访客的鞋印。我报到时，沙滩上只有一对向海里走的脚印。'],
  ['C23', '沙漏里的种子', '那只沙漏落下的不是沙，而是一粒粒不同颜色的种子。最后一粒落下之前，屋外已经长出一片夏天。'],
  ['C24', '记忆换零钱', '街角自动售货机接受记忆付款，找零是一段陌生往事。我换了一杯热茶，却想起了从没见过的港口。'],
  ['C25', '隔壁的微型宇宙', '隔壁新搬来的住户每天给阳台上的宇宙浇水。今天，宇宙里的一颗星敲响了我的玻璃。'],
  ['C26', '不会关门的剧场', '剧场演完后观众已经离开，帷幕却始终不肯落下。我回头时，舞台上站着小时候的自己。'],
  ['C27', '雪地留言板', '第一场雪落下后，地面出现一行谁都不认识的字。清洁工读完，轻轻把扫帚放了下来。'],
  ['C28', '多出来的盆栽', '每天醒来，窗台都会多一盆来自陌生季节的植物。今天的新盆里，种着一把很小的钥匙。'],
  ['C29', '暂停键的主人', '旧遥控器上只剩一枚暂停键，按下后连雨滴都停在半空。唯独街对面的老人，还在慢慢喝茶。'],
  ['C30', '寄往明天的包裹', '快递员交来一个标着明天签收的包裹，里面不断传出翻页声。我拆开封条，看到了一本正在写我的书。']
].map(([id, title, text]) => Object.freeze({ id, title, text })));
export const RULES = Object.freeze({ privacy: '同一屏幕的合作隐私，不是账号授权、加密或安全隔离；玩家需按交接约定操作，内存/开发者工具可能读取故事', viewing: '全文模式只显示上一段（首段看开头卡），盲接只显示上一段末句/尾片段，局结束前不展示或导出历史全文', sentence: '句末符为。！？!?；英文.仅后接空白/闭引号/闭括号或文本结尾时算句末；连续句末符和闭引号/括号合并；末尾未完片段视作最后句', hint: '末句超过80 Unicode码点仅显示最后80码点并标省略；没有句末符时仅显示最后80码点；不是自然语言句法识别', paragraph: '提交先去首尾空白，按Unicode码点计1–1000，内部换行保留；不按UTF-16单位或视觉字形计数，emoji组合可占多个码点', handoff: '每次提交后清空并替换旧写作DOM/输入节点，下一位先确认接手再看提示；旧输入节点不复用，不提供历史浏览入口', finishing: '达到预定人数×轮数自动完成；主动提前结束须明确确认，未提交草稿不计入作品，标记中断与已提交/计划段数', lifecycle: '暂停只在本模块内存保留当前玩家未提交草稿，回来以新节点恢复；交接清空草稿，切换具体功能/销毁清理全部未保存内容和监听', local: '无网络/AI调用、无账号隔离、不自动保存；只有已完成/确认中断的作品可导出完整Markdown/JSON副本' });
export const countCharacters = value => [...value].length;
const invalidScalar = value => [...value].some(char => { const code = char.codePointAt(0); return code >= 0xd800 && code <= 0xdfff; });
export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['title', 'players', 'rounds', 'mode', 'openingId'].includes(key))) throw new Error('新局设置结构不合法。');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title !== input.title.trim() || countCharacters(input.title) > 80 || /[\u0000-\u001f\u007f]/u.test(input.title) || invalidScalar(input.title)) throw new Error('作品名须为1–80码点，无首尾空白/控制字符。');
  if (!Array.isArray(input.players) || input.players.length < 2 || input.players.length > LIMITS.players) throw new Error('玩家须为2–8人。');
  const seen = new Set(), players = input.players.map(name => { if (typeof name !== 'string' || !name.trim() || name !== name.trim() || countCharacters(name) > 40 || /[\u0000-\u001f\u007f]/u.test(name) || invalidScalar(name)) throw new Error('玩家名须为1–40码点，无首尾空白/控制字符。'); const key = name.normalize('NFC'); if (seen.has(key)) throw new Error('玩家名字须唯一。'); seen.add(key); return name; });
  if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > LIMITS.rounds) throw new Error('轮数须为1–10整数。');
  if (!['full', 'blind'].includes(input.mode)) throw new Error('请选择上一段完整查看或盲接末句。');
  if (!OPENINGS.some(card => card.id === input.openingId)) throw new Error('请选择内置开头卡。');
  return Object.freeze({ title: input.title, players: Object.freeze(players), rounds: input.rounds, mode: input.mode, openingId: input.openingId });
}
export function createGame(input) { const config = validateConfig(input); return Object.freeze({ config, plannedSegments: config.players.length * config.rounds, status: 'active', segments: Object.freeze([]), totalCharacters: 0 }); }
export function currentTurn(game) { if (game?.status !== 'active') throw new Error('本局已经结束。'); const index = game.segments.length, playerIndex = index % game.config.players.length; return { ordinal: index + 1, round: Math.floor(index / game.config.players.length) + 1, playerIndex, playerId: 'P' + (playerIndex + 1), author: game.config.players[playerIndex], isLast: index + 1 === game.plannedSegments }; }
const closers = new Set([..."”’\"'」』）)】］]}"]);
const hardStops = new Set([..."。！？!?"]);
export function endingHint(text) {
  if (typeof text !== 'string') throw new Error('末句输入须为文本。'); const points = [...text.trim()]; let start = 0, last = '', hadStop = false;
  const isStop = index => hardStops.has(points[index]) || (points[index] === '.' && (index + 1 === points.length || /\s/u.test(points[index + 1]) || closers.has(points[index + 1])));
  for (let index = 0; index < points.length; index++) if (isStop(index)) {
    hadStop = true; let end = index + 1; while (end < points.length && (isStop(end) || closers.has(points[end]))) end++;
    const sentence = points.slice(start, end).join('').trim(); if (sentence) last = sentence; start = end; index = end - 1;
  }
  const tail = points.slice(start).join('').trim(); if (tail) last = tail; const all = [...last], truncated = all.length > LIMITS.hint;
  return { text: all.slice(-LIMITS.hint).join(''), truncated, fallback: !hadStop, characters: Math.min(all.length, LIMITS.hint) };
}
export function visibleContext(game) {
  currentTurn(game); const previous = game.segments.at(-1), source = previous ? 'segment' : 'opening', text = previous ? previous.text : OPENINGS.find(card => card.id === game.config.openingId).text;
  return game.config.mode === 'blind' ? { mode: 'blind', source, ...endingHint(text) } : { mode: 'full', source, text, truncated: false, fallback: false, characters: countCharacters(text) };
}
export function submitTurn(game, input) {
  const turn = currentTurn(game); if (typeof input !== 'string' || input.length > LIMITS.draftUnits) throw new Error('单段须为文本，最多2000 UTF-16单位并且1000码点。');
  const text = input.trim(), characters = countCharacters(text); if (!characters || characters > LIMITS.paragraph || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) || invalidScalar(text)) throw new Error('每段须为1–1000码点的非空正文，不含非法控制/Unicode字符。');
  if (game.totalCharacters + characters > LIMITS.totalCharacters) throw new Error('作品正文超过80000码点。');
  const segment = Object.freeze({ ordinal: turn.ordinal, round: turn.round, playerIndex: turn.playerIndex, playerId: turn.playerId, author: turn.author, text, characters });
  const segments = Object.freeze([...game.segments, segment]); return Object.freeze({ ...game, segments, totalCharacters: game.totalCharacters + characters, status: segments.length === game.plannedSegments ? 'completed' : 'active' });
}
export function interruptGame(game, confirmed) { currentTurn(game); if (confirmed !== true) throw new Error('提前结束必须明确确认。'); return Object.freeze({ ...game, status: 'interrupted' }); }
export function finalReport(game) {
  if (!['completed', 'interrupted'].includes(game?.status)) throw new Error('本局未结束，禁止输出完整故事。');
  return { feature: 'E028', version: 1, kind: 'work', title: game.config.title, status: game.status, complete: game.status === 'completed', submittedSegments: game.segments.length, plannedSegments: game.plannedSegments, totalCharacters: game.totalCharacters, mode: game.config.mode, rounds: game.config.rounds, players: game.config.players.map((name, index) => ({ playerId: 'P' + (index + 1), name })), opening: { ...OPENINGS.find(card => card.id === game.config.openingId) }, segments: game.segments.map(segment => ({ ...segment })), rules: { ...RULES } };
}
export function checkAbort(signal) { if (signal?.aborted) throw Object.assign(new Error('已取消导出。'), { name: 'AbortError' }); }
export async function serializeGame(game, format, hooks = {}) {
  if (!['json', 'md'].includes(format)) throw new Error('只支持JSON/Markdown。'); const report = finalReport(game); checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal);
  let content;
  if (format === 'json') content = JSON.stringify(report, null, 2) + '\n';
  else {
    const escape = value => String(value).replaceAll('\\', '\\\\').replace(/[|`*_\[\]#!()+.\-]/gu, match => '\\' + match).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    content = `# ${escape(report.title)}\n\n状态：${report.complete ? '完整完成' : '主动中断'}；已提交${report.submittedSegments}/${report.plannedSegments}段；正文${report.totalCharacters}码点；${report.mode === 'blind' ? '盲接末句' : '上一段完整查看'}。\n\n玩家顺序：${report.players.map(player => escape(player.name)).join(' → ')}；计划${report.rounds}轮。\n\n## 开头卡：${escape(report.opening.title)}\n\n${escape(report.opening.text)}\n`;
    for (const segment of report.segments) content += `\n## 第${segment.round}轮 · 第${segment.ordinal}段 · ${escape(segment.author)} (${segment.playerId})\n\n${escape(segment.text)}\n`;
    content += '\n## 本局规则\n\n' + Object.values(report.rules).map(rule => '- ' + escape(rule) + '\n').join('');
  }
  if (new TextEncoder().encode(content).length > LIMITS.exportBytes) throw new Error('作品副本超过512 KiB。'); checkAbort(hooks.signal); return content;
}
