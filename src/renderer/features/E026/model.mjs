import { CARDS } from './cards.mjs';

export const MAX_DRAFT=65536;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function text(v,max,label){if(typeof v!=='string'||!v.trim()||v.trim().length>max||/[\x00-\x1f\x7f]/.test(v))throw new RangeError(`${label}需为 1–${max} 字的单行文本。`);return v.trim();}
export function validateBank(input){
  if(!Array.isArray(input)||input.length<1||input.length>200)throw new RangeError('题库需有 1–200 张卡片。');
  const ids=new Set();const prompts=new Set();
  return Object.freeze(input.map((c,i)=>{if(!plain(c)||Object.keys(c).length!==3||!['id','kind','prompt'].every(k=>Object.hasOwn(c,k)))throw new RangeError(`第 ${i+1} 张卡字段必须为 id、kind、prompt。`);const id=text(c.id,32,'卡号');if(!/^[A-Za-z0-9_-]+$/.test(id)||ids.has(id))throw new RangeError('卡号需唯一且仅含字母、数字、_ 或 -。');ids.add(id);if(!['truth','dare'].includes(c.kind))throw new RangeError('kind 只能为 truth 或 dare。');const prompt=text(c.prompt,240,'卡片内容');const normalized=prompt.normalize('NFKC').replace(/\s/g,'');if(prompts.has(normalized))throw new RangeError('卡片内容不可重复。');prompts.add(normalized);return Object.freeze({id,kind:c.kind,prompt});}));
}
export function parseBank(raw){if(typeof raw!=='string'||raw.length>MAX_DRAFT)throw new RangeError('JSON 草稿最多 65536 字符。');let data;try{data=JSON.parse(raw);}catch{throw new RangeError('不是有效 JSON。');}if(!plain(data)||Object.keys(data).length!==2||!Object.hasOwn(data,'cards')||data.version!==1)throw new RangeError('题库只支持 {version:1,cards:[...]}。');return validateBank(data.cards);}
export function validateOptions(input){
  if(!plain(input)||!Array.isArray(input.players)||input.players.length<2||input.players.length>12)throw new RangeError('玩家需有 2–12 人。');const seen=new Set();const players=input.players.map(p=>{const name=text(p,20,'玩家名称');const n=name.normalize('NFKC').toLowerCase();if(seen.has(n))throw new RangeError('玩家名称不可重复。');seen.add(n);return name;});
  if(!['truth','dare','both'].includes(input.filter))throw new RangeError('请选择真心话、挑战或两类。');if(!['sequential','random'].includes(input.rotation))throw new RangeError('请选择顺序或随机轮换。');if(!Number.isInteger(input.turns)||input.turns<1||input.turns>100)throw new RangeError('本局轮数须为 1–100 的整数。');const seed=text(input.seed,32,'局号');if(!/^[A-Za-z0-9_-]+$/.test(seed))throw new RangeError('局号仅可含字母、数字、_ 或 -。');return Object.freeze({players:Object.freeze(players),filter:input.filter,rotation:input.rotation,turns:input.turns,seed});
}
function rng(seed){let state=2166136261;for(const ch of seed){state^=ch.charCodeAt(0);state=Math.imul(state,16777619)>>>0;}return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}
function shuffle(items,random){const list=[...items];for(let i=list.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}return list;}
export class Party {
  #options;#bank;#deck;#players=[];#random;#phase='ready';#paused=false;#current=null;#player=null;#records=[];#removed=new Set();#removals=[];#endReason=null;
  constructor(options,{bank=CARDS}={}){this.#options=validateOptions(options);this.#bank=validateBank(bank);const available=this.#bank.filter(c=>this.#options.filter==='both'||c.kind===this.#options.filter);if(!available.length)throw new RangeError('所选类别没有可用卡片，请修改筛选或题库。');this.#random=rng(this.#options.seed+'-players');this.#deck=shuffle(available,rng(this.#options.seed+'-cards'));}
  view(){return {phase:this.#paused&&this.#phase!=='finished'?'paused':this.#phase,turn:this.#records.length+1,total:this.#options.turns,options:this.#options,current:this.#current?{...this.#current}:null,player:this.#player,remaining:this.#deck.filter(c=>!this.#removed.has(c.id)).length,consumed:this.#records.length,removed:[...this.#removed],summary:this.#summary(),endReason:this.#endReason};}
  start(){if(this.#phase!=='ready'||this.#paused)return false;this.#next();return true;}
  #next(){
    if(this.#records.length>=this.#options.turns){this.#finish('turnLimit');return;}
    let card;while(this.#deck.length){const next=this.#deck.shift();if(!this.#removed.has(next.id)){card=next;break;}}
    if(!card){this.#finish('exhausted');return;}
    if(this.#options.rotation==='sequential')this.#player=this.#records.length%this.#options.players.length;
    else{if(!this.#players.length){this.#players=shuffle(this.#options.players.map((_,i)=>i),this.#random);if(this.#players.length>1&&this.#players[0]===this.#player)[this.#players[0],this.#players[1]]=[this.#players[1],this.#players[0]];}this.#player=this.#players.shift();}
    this.#current=card;this.#phase='active';
  }
  resolve(action,turn,id){if(this.#paused||this.#phase!=='active'||turn!==this.#records.length+1||id!==this.#current.id||!['completed','skipped','removed'].includes(action))return false;const card=this.#current;this.#records.push({turn,player:this.#player,name:this.#options.players[this.#player],...card,action,penalty:0});if(action==='removed'){this.#removed.add(card.id);this.#removals.push({...card,atTurn:turn,source:'current'});}this.#current=null;this.#next();return true;}
  removeAvailable(id){const card=this.#bank.find(c=>c.id===id);if(this.#phase==='finished'||!card||this.#removed.has(id)||this.#current?.id===id)return false;this.#removed.add(id);this.#removals.push({...card,atTurn:this.#records.length+1,source:'editor'});return true;}
  end(){if(this.#paused||!['ready','active'].includes(this.#phase))return false;if(this.#current)this.#records.push({turn:this.#records.length+1,player:this.#player,name:this.#options.players[this.#player],...this.#current,action:'unresolved',penalty:0});this.#finish('hostEnd');return true;}
  #finish(reason){this.#phase='finished';this.#current=null;this.#player=null;this.#paused=false;this.#endReason=reason;}
  pause(){if(this.#paused||this.#phase==='finished')return false;this.#paused=true;return true;}
  resume(){if(!this.#paused)return false;this.#paused=false;return true;}
  #summary(){return this.#options.players.map((name,player)=>({player,name,completed:this.#records.filter(r=>r.player===player&&r.action==='completed').length,skipped:this.#records.filter(r=>r.player===player&&r.action==='skipped').length,removed:this.#records.filter(r=>r.player===player&&r.action==='removed').length,unresolved:this.#records.filter(r=>r.player===player&&r.action==='unresolved').length,penalty:0}));}
  result(){if(this.#phase!=='finished')return null;return {feature:'E026',version:1,options:this.#options,endReason:this.#endReason,penaltyPolicy:'所有行动均为零惩罚，不设置分数或排名',summary:this.#summary(),turns:structuredClone(this.#records),removals:structuredClone(this.#removals)};}
}
export function cleanHistory(value){if(!Array.isArray(value))return [];return value.slice(0,10).flatMap(row=>{try{const options=validateOptions(row.options);if(typeof row.finishedAt!=='string'||row.finishedAt.length>32||!['turnLimit','exhausted','hostEnd'].includes(row.endReason)||!Number.isInteger(row.completed)||!Number.isInteger(row.skipped)||!Number.isInteger(row.removed)||[row.completed,row.skipped,row.removed].some(n=>n<0)||row.completed+row.skipped+row.removed>options.turns)return [];return [{options,finishedAt:row.finishedAt,endReason:row.endReason,completed:row.completed,skipped:row.skipped,removed:row.removed}];}catch{return [];}});}
