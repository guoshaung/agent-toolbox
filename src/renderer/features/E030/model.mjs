// Private mutable state stays in a WeakMap. Public views/reports are detached snapshots.
const states = new WeakMap();
export const LIMITS = Object.freeze({ playersMin: 3, playersMax: 6, dicePerPlayer: 5, namePoints: 20, rounds: 29, exportBytes: 2 * 1024 * 1024 });
export const RULES = Object.freeze({ bid: '数量优先、点数其次的词典顺序；数量1至当前总骰数，点数1至6。', wild: '默认1不万能；开启后，叫2至6时1也计入，叫1只计1；递增规则不变。', loss: '实际数量少于叫价，叫价者扣1骰；否则质疑者扣1骰；恰好等于叫价时质疑失败。', starter: '下一轮失败方起手；若其退出，则顺时针下一存活玩家起手。', privacy: '同屏交接依赖参与者合作，不能抵抗旁观、开发者工具或设备访问。仅导出已亮骰轮次，不含当前私密骰。' });
const clone = value => JSON.parse(JSON.stringify(value));
function state(game) { const s = states.get(game); if (!s) throw Error('无效或已销毁的本局'); return s; }
function namesValid(names) {
  if (!Array.isArray(names) || names.length < 3 || names.length > 6) throw Error('玩家须3至6位');
  if (names.some(n => typeof n !== 'string' || !n || n.trim() !== n || [...n].length > 20 || /[\p{Cc}\p{Cs}]/u.test(n))) throw Error('名称须1至20字符、无首尾空格或控制字符');
  if (new Set(names.map(n => n.normalize('NFC'))).size !== names.length) throw Error('玩家名称须唯一');
}
export function randomDie(fill = array => globalThis.crypto.getRandomValues(array)) {
  // 0..251 consists of exactly42 representatives of each residue mod6.
  const bytes = new Uint8Array(32);
  for (let attempt = 0; attempt < 128; attempt++) { fill(bytes); for (const byte of bytes) if (byte < 252) return byte % 6 + 1; }
  throw Error('随机源持续返回拒绝区，未生成骰子');
}
function nextAlive(s, index) { for (let d = 1; d <= s.players.length; d++) { const i = (index + d) % s.players.length; if (s.players[i].remaining > 0) return i; } throw Error('没有存活玩家'); }
function prepare(s, starter) {
  const dice = s.players.map(p => Array.from({ length: p.remaining }, () => { const n = s.roll(); if (!Number.isInteger(n) || n < 1 || n > 6) throw Error('骰子随机源须返回1至6整数'); return n; }));
  // Commit only after a complete successful roll. A failed source cannot partially reroll.
  s.dice = dice; s.starter = starter; s.current = starter; s.inspectOrder = [starter]; let i = nextAlive(s, starter);
  while (i !== starter) { s.inspectOrder.push(i); i = nextAlive(s, i); }
  s.inspectPosition = 0; s.phase = 'inspect'; s.visible = false; s.bid = null; s.calls = []; s.round++;
}
export function createGame({ players, wildOnes = false }, { roll = randomDie } = {}) {
  namesValid(players); if (typeof wildOnes !== 'boolean' || typeof roll !== 'function') throw Error('规则或随机源无效');
  const game = Object.freeze({ feature: 'E030' }), s = { players: players.map((name, id) => ({ id, name, remaining: 5 })), wildOnes, roll, round: 0, history: [], winner: null };
  prepare(s, 0); states.set(game, s); return game;
}
export function publicView(game) {
  const s = state(game); return clone({ phase: s.phase, round: s.round, wildOnes: s.wildOnes, visible: s.visible, players: s.players, current: s.current, starter: s.starter, inspectPosition: s.inspectPosition, inspectCount: s.inspectOrder.length, totalDice: s.players.reduce((n, p) => n + p.remaining, 0), bid: s.bid, calls: s.calls, winner: s.winner, revealedRounds: s.history.length, latestRevealed: ['revealed', 'finished'].includes(s.phase) ? s.history.at(-1) : null });
}
export function showDice(game) { const s = state(game); if (!['inspect', 'turn'].includes(s.phase)) throw Error('此阶段没有私密看骰'); s.visible = true; return privateDice(game); }
export function privateDice(game) { const s = state(game); if (!s.visible || !['inspect', 'turn'].includes(s.phase)) throw Error('骰子已遮盖'); return [...s.dice[s.current]]; }
export function coverDice(game) { state(game).visible = false; }
export function finishInspection(game) {
  const s = state(game); if (s.phase !== 'inspect' || !s.visible) throw Error('请本人先查看骰子'); s.visible = false; s.inspectPosition++;
  if (s.inspectPosition === s.inspectOrder.length) { s.phase = 'turn'; s.current = s.starter; } else s.current = s.inspectOrder[s.inspectPosition];
}
export function legalBid(game, quantity, face) {
  const s = state(game), total = s.players.reduce((n, p) => n + p.remaining, 0);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= total && Number.isInteger(face) && face >= 1 && face <= 6 && (!s.bid || quantity > s.bid.quantity || quantity === s.bid.quantity && face > s.bid.face);
}
export function makeBid(game, quantity, face) {
  const s = state(game); if (s.phase !== 'turn' || !s.visible) throw Error('请当前玩家先私密查看');
  if (!legalBid(game, quantity, face)) throw Error('叫价须在总骰数内，按数量、点数词典顺序严格递增');
  s.bid = { player: s.current, quantity, face }; s.calls.push({ ...s.bid, ordinal: s.calls.length + 1 }); s.current = nextAlive(s, s.current); s.visible = false;
}
export function challenge(game) {
  const s = state(game); if (s.phase !== 'turn' || !s.visible || !s.bid) throw Error('须本人查看且已有叫价才可质疑');
  const actual = s.dice.flat().filter(face => face === s.bid.face || s.wildOnes && s.bid.face !== 1 && face === 1).length, success = actual < s.bid.quantity, loser = success ? s.bid.player : s.current;
  const before = s.players.map(p => p.remaining); s.players[loser].remaining--;
  const revealed = { round: s.round, starter: s.starter, dice: s.dice.map((faces, player) => ({ player, name: s.players[player].name, faces: [...faces] })), calls: clone(s.calls), bid: { ...s.bid }, challenger: s.current, actual, challengeSucceeded: success, loser, before, after: s.players.map(p => p.remaining), eliminated: s.players[loser].remaining === 0, nextStarter: s.players[loser].remaining > 0 ? loser : nextAlive(s, loser) };
  s.history.push(revealed); s.visible = false; s.dice = null; const alive = s.players.filter(p => p.remaining > 0); s.winner = alive.length === 1 ? alive[0].id : null; s.phase = s.winner === null ? 'revealed' : 'finished'; return clone(revealed);
}
export function nextRound(game) { const s = state(game); if (s.phase !== 'revealed') throw Error('须已结算且尚未结束'); if (s.round >= LIMITS.rounds) throw Error('轮次安全上限'); prepare(s, s.history.at(-1).nextStarter); }
export function destroyGame(game) { const s = states.get(game); if (s) { s.dice = null; s.history = []; s.roll = null; states.delete(game); } }
export function revealedReport(game) {
  const s = state(game); if (!s.history.length) throw Error('尚无已亮骰轮次可导出');
  return clone({ feature: 'E030', version: 1, complete: s.phase === 'finished', phase: s.phase === 'finished' ? 'finished' : 'ongoing', wildOnes: s.wildOnes, rules: RULES, players: s.players, winner: s.winner, revealedRounds: s.history.length, currentUnrevealedRoundExcluded: ['inspect', 'turn'].includes(s.phase), rounds: s.history });
}
const md = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|])/g, '\\$1');
function abort(signal) { if (signal?.aborted) throw new DOMException('已取消报告生成', 'AbortError'); }
export async function serializeGame(game, format, { signal, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  abort(signal); if (!['json', 'md'].includes(format)) throw Error('只支持JSON或Markdown'); const report = revealedReport(game); await yieldControl(); abort(signal);
  let content;
  if (format === 'json') content = JSON.stringify(report, null, 2);
  else { const lines = ['# 吹牛骰子已揭示历史', '', report.complete ? `已结束；胜者：${md(report.players[report.winner].name)}` : '进行中；仅包含已亮骰轮次，当前私密骰不在报告中。', `万能1：${report.wildOnes ? '开启' : '关闭'}`, ...Object.values(RULES).map(text => md(text))];
    for (const round of report.rounds) { lines.push('', `## 第${round.round}轮`, `起手：${md(report.players[round.starter].name)}`); for (const die of round.dice) lines.push(`${md(die.name)}：${die.faces.join('、') || '已退出'}`); for (const call of round.calls) lines.push(`叫价${call.ordinal}：${md(report.players[call.player].name)}，${call.quantity}个${call.face}`); lines.push(`质疑者：${md(report.players[round.challenger].name)}；实际${round.actual}；质疑${round.challengeSucceeded ? '成功' : '失败'}；${md(report.players[round.loser].name)}扣1骰${round.eliminated ? '并退出' : ''}。`, `剩余：${round.after.map((n, i) => `${md(report.players[i].name)}=${n}`).join('；')}`); await yieldControl(); abort(signal); } content = lines.join('\n') + '\n'; }
  if (new TextEncoder().encode(content).length > LIMITS.exportBytes) throw Error('报告超过2MiB，拒绝截断'); abort(signal); return content;
}
