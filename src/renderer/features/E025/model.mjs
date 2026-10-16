import { QUESTIONS } from './questions.mjs';

export const KEYS = Object.freeze(['KeyA','KeyS','KeyD','KeyF','KeyQ','KeyW','KeyE','KeyR','KeyZ','KeyX','KeyC','KeyV','KeyJ','KeyK','KeyL','KeyM']);
export const MAX_IMPORT = 65536;
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) throw new RangeError(`${label}需为 1–${max} 字的单行文本。`);
  return value.trim();
}
function exact(object, fields, label) { if (!plain(object) || Object.keys(object).length !== fields.length || fields.some((f) => !Object.hasOwn(object, f))) throw new RangeError(`${label}字段必须为 ${fields.join('、')}。`); }
export function validateQuestions(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) throw new RangeError('题库须有 1–50 道题。');
  const ids = new Set(); const prompts = new Set();
  return Object.freeze(input.map((q, i) => {
    exact(q, ['id','question','answer','explanation','source'], `第 ${i + 1} 题`);
    const id = text(q.id,32,'题号'); if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) throw new RangeError('题号需唯一，且仅含字母、数字、_、-。'); ids.add(id);
    const question = text(q.question,240,'题目'); const normalized = question.normalize('NFKC').replace(/\s/g,''); if (prompts.has(normalized)) throw new RangeError('题目不可重复。'); prompts.add(normalized);
    return Object.freeze({ id, question, answer: text(q.answer,120,'答案'), explanation: text(q.explanation,400,'解释'), source: text(q.source,300,'来源简述') });
  }));
}
export function parseBank(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_IMPORT) throw new RangeError('JSON 草稿最多 65536 个字符。');
  let value; try { value = JSON.parse(raw); } catch { throw new RangeError('不是有效 JSON。'); }
  exact(value,['version','questions'],'题库'); if (value.version !== 1) throw new RangeError('只支持题库 version: 1。');
  return validateQuestions(value.questions);
}
export function validateOptions(value, bankSize) {
  if (!plain(value) || !Array.isArray(value.players) || value.players.length < 2 || value.players.length > 4) throw new RangeError('玩家人数须为 2–4。');
  const names = new Set(); const keys = new Set();
  const players = value.players.map((p) => { if (!plain(p)) throw new RangeError('玩家设置无效。'); const name = text(p.name,20,'玩家名称'); const n = name.normalize('NFKC').toLowerCase(); if (names.has(n)) throw new RangeError('玩家名称不可重复。'); names.add(n); if (!KEYS.includes(p.key) || keys.has(p.key)) throw new RangeError('玩家键位需不同，且从列出的字母键选择。'); keys.add(p.key); return Object.freeze({name,key:p.key}); });
  if (!Number.isInteger(value.questionCount) || value.questionCount < 1 || value.questionCount > bankSize) throw new RangeError(`题数须为 1–${bankSize} 的整数。`);
  if (typeof value.retryWrong !== 'boolean') throw new RangeError('答错续抢选项无效。');
  return Object.freeze({players:Object.freeze(players), questionCount:value.questionCount, retryWrong:value.retryWrong});
}
export class Quiz {
  #bank; #options; #phase = 'ready'; #savedPhase = null; #index = 0; #owner = null; #rejected = new Set(); #attempts = []; #scores; #records = []; #claim = 0; #now; #opened = 0; #latency = 0;
  constructor(options, {bank = QUESTIONS, now = () => performance.now()} = {}) { this.#bank = validateQuestions(bank); this.#options = validateOptions(options,this.#bank.length); this.#scores = this.#options.players.map(()=>0); this.#now=now; }
  view() { const q = this.#bank[this.#index]; return {phase:this.#phase, questionNo:this.#index+1,total:this.#options.questionCount, options:this.#options, prompt:this.#phase==='finished'?null:q.question, owner:this.#owner, claim:this.#claim, rejected:[...this.#rejected], scores:[...this.#scores], attempts:this.#attempts.map(a=>({...a})), last:this.#records.length?structuredClone(this.#records.at(-1)):null}; }
  open(questionNo) { if (questionNo !== this.#index+1 || !['ready','retryReady'].includes(this.#phase)) return false; this.#phase='open'; this.#owner=null; this.#opened=this.#now(); this.#latency=0; return true; }
  buzz(player,questionNo) { if (questionNo!==this.#index+1 || this.#phase!=='open' || !Number.isInteger(player) || player<0 || player>=this.#scores.length || this.#rejected.has(player)) return false; this.#owner=player; this.#claim++; this.#latency += Math.max(0,this.#now()-this.#opened); this.#phase='locked'; return true; }
  hostAnswer(questionNo) { if (questionNo!==this.#index+1 || this.#phase!=='locked') return null; const q=this.#bank[this.#index]; return {answer:q.answer,explanation:q.explanation,source:q.source}; }
  judge(correct,questionNo,claim) {
    if (typeof correct!=='boolean' || questionNo!==this.#index+1 || claim!==this.#claim || this.#phase!=='locked') return false;
    const player=this.#owner; this.#scores[player]+=correct?2:-1; this.#attempts.push({player,name:this.#options.players[player].name,key:this.#options.players[player].key,correct,points:correct?2:-1,latencyMs:Math.round(this.#latency)});
    if (correct) this.#close('correct'); else { this.#rejected.add(player); this.#owner=null; if (this.#rejected.size===this.#scores.length) this.#close('allWrong'); else if (!this.#options.retryWrong) this.#close('wrongNoRetry'); else this.#phase='retryReady'; }
    return true;
  }
  skip(questionNo) { if (questionNo!==this.#index+1 || !['ready','open','locked','retryReady'].includes(this.#phase)) return false; this.#close('hostEnd'); return true; }
  #close(reason) { const q=this.#bank[this.#index]; this.#records.push({questionNo:this.#index+1,...q,reason,attempts:this.#attempts.map(a=>({...a})),scoresAfter:[...this.#scores]}); this.#phase='closed'; this.#owner=null; }
  next(questionNo) { if (questionNo!==this.#index+1 || this.#phase!=='closed') return false; if (this.#records.length===this.#options.questionCount) this.#phase='finished'; else {this.#index++;this.#phase='ready';this.#owner=null;this.#rejected.clear();this.#attempts=[];this.#latency=0;} return true; }
  pause() { if (['paused','finished'].includes(this.#phase)) return false; if (this.#phase==='open') this.#latency+=Math.max(0,this.#now()-this.#opened); this.#savedPhase=this.#phase;this.#phase='paused'; return true; }
  resume() { if(this.#phase!=='paused')return false;this.#phase=this.#savedPhase;this.#savedPhase=null;if(this.#phase==='open')this.#opened=this.#now();return true; }
  result() { if(this.#phase!=='finished')return null; const ranking=this.#options.players.map((p,i)=>({...p,player:i,score:this.#scores[i]})).sort((a,b)=>b.score-a.score||a.player-b.player); ranking.forEach((p,i)=>{p.rank=i&&p.score===ranking[i-1].score?ranking[i-1].rank:i+1;});return {feature:'E025',version:1,options:this.#options,scoring:{correct:2,wrong:-1,unanswered:0},scores:[...this.#scores],ranking,rounds:structuredClone(this.#records)}; }
}
export function cleanHistory(value) { if(!Array.isArray(value))return [];return value.slice(0,10).flatMap(s=>{try{if(!plain(s))return [];const options=validateOptions(s.options,50);if(!Array.isArray(s.scores)||s.scores.length!==options.players.length||s.scores.some(n=>!Number.isInteger(n)||n < -options.questionCount||n>2*options.questionCount)||typeof s.finishedAt!=='string'||s.finishedAt.length>32)return [];return [{options,scores:[...s.scores],finishedAt:s.finishedAt}];}catch{return [];}}); }
