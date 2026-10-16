export const PLANTS = Object.freeze({ fern: '蕨叶', succulent: '多肉', flower: '小花' });
export const LIGHTS = Object.freeze({ bright: '明亮窗边（1倍）', shade: '散光角落（0.5倍）' });
export const LIMITS = Object.freeze({ archiveBytes: 65536, history: 100, pngBytes: 10 * 1024 * 1024 });
const HOUR = 3600000, MAX_TIME = 8640000000000000;
const time = n => { if (!Number.isSafeInteger(n) || n < 0 || n > MAX_TIME) throw Error('本地时间须有效非负整数毫秒'); return n; };
const amount = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
function keys(value, expected) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== expected.slice().sort().join('|')) throw Error('存档结构/字段不符'); }
function inspectValues(s) { if (!Object.hasOwn(LIGHTS, s.light) || !amount(s.water, 100) || !amount(s.growthHours, 72) || typeof s.paused !== 'boolean') throw Error('存档水分/光照/生长/暂停值无效'); }
export function validateState(s) {
  keys(s, ['version','plant','water','light','growthHours','paused','updatedAt','history','droppedHistory']);
  if (s.version !== 1) throw Error('只接受存档版本1');
  if (!Object.hasOwn(PLANTS, s.plant)) throw Error('植物无效'); inspectValues(s); time(s.updatedAt);
  if (!Array.isArray(s.history) || s.history.length < 1 || s.history.length > LIMITS.history || !Number.isSafeInteger(s.droppedHistory) || s.droppedHistory < 0) throw Error('照看历史数量无效');
  let previous = -1;
  for (const item of s.history) { keys(item, ['at','action','water','light','growthHours','paused']); time(item.at); inspectValues(item); if (item.at < previous || item.at > s.updatedAt || !['new','water','light','pause','resume'].includes(item.action)) throw Error('照看历史时间或操作无效'); previous = item.at; }
  return s;
}
const clone = s => JSON.parse(JSON.stringify(s));
function record(s, action) { s.history.push({ at:s.updatedAt, action, water:s.water, light:s.light, growthHours:s.growthHours, paused:s.paused }); if (s.history.length > LIMITS.history) { s.history.shift(); s.droppedHistory = Math.min(Number.MAX_SAFE_INTEGER, s.droppedHistory + 1); } }
export function newPlant(plant = 'fern', at = Date.now()) { if (!Object.hasOwn(PLANTS, plant)) throw Error('植物无效'); const s = { version:1, plant, water:60, light:'bright', growthHours:0, paused:false, updatedAt:time(at), history:[], droppedHistory:0 }; record(s, 'new'); return s; }
export function advance(input, at = Date.now()) {
  validateState(input); time(at); const s = clone(input), rollback = at < s.updatedAt;
  if (rollback) return { state:s, rollback:true }; // Keep the high-water timestamp; do not count the same interval twice.
  const hours = (at - s.updatedAt) / HOUR;
  if (!s.paused) { const wetHours = Math.min(hours, s.water / 2); s.growthHours = Math.min(72, s.growthHours + wetHours * (s.light === 'bright' ? 1 : .5)); s.water = Math.max(0, s.water - hours * 2); }
  s.updatedAt = at; return { state:s, rollback:false };
}
export function care(input, action, at = Date.now(), value) {
  const {state:s,rollback} = advance(input, at);
  if (action === 'water') s.water = Math.min(100, s.water + 25);
  else if (action === 'light') { if (!Object.hasOwn(LIGHTS, value)) throw Error('光照位置无效'); s.light = value; }
  else if (action === 'pause') s.paused = true;
  else if (action === 'resume') s.paused = false;
  else throw Error('照看操作无效');
  record(s, action); return {state:s,rollback};
}
export const stage = s => { validateState(s); return Math.min(3, Math.floor(s.growthHours / 24)); };
export const STAGES = Object.freeze(['幼芽','舒展','茂盛','成熟']);
export function archive(s) { validateState(s); const text = JSON.stringify(s,null,2); if (new TextEncoder().encode(text).length > LIMITS.archiveBytes) throw Error('存档超过64KiB'); return text; }
export function restore(text) { if (typeof text !== 'string' || text.length > LIMITS.archiveBytes || new TextEncoder().encode(text).length > LIMITS.archiveBytes) throw Error('存档限64KiB UTF-8'); let parsed; try { parsed=JSON.parse(text); } catch { throw Error('不是有效JSON存档'); }
  // JSON.parse accepts duplicate keys; this finite token pass rejects ambiguous archives.
  const tokens=text.match(/"(?:\\.|[^"\\])*"|[{}:[\],]/g)||[],stack=[];
  for(let i=0;i<tokens.length;i++){const token=tokens[i];if(token==='{'||token==='['){stack.push(token==='{'?new Set():null);if(stack.length>8)throw Error('存档嵌套过深');}else if(token==='}'||token===']')stack.pop();else if(token.startsWith('"')&&tokens[i+1]===':'){const key=JSON.parse(token),seen=stack.at(-1);if(!(seen instanceof Set))throw Error('存档对象无效');if(seen.has(key))throw Error('存档存在重复字段');seen.add(key);}}
  validateState(parsed); return clone(parsed); }
export function plantSVG(s) {
  validateState(s); const n=stage(s), scale=.62+n*.15, green=s.water===0?'#9b9b70':'#658a69'; let foliage='';
  if(s.plant==='fern') for(let i=0;i<5+n*2;i++){const angle=(i-(4+n*2)/2)*13, length=120+(i%3)*22; let leaves='';for(let j=1;j<=5;j++){const y=-j*length/6;leaves+=`<ellipse cx="-15" cy="${y}" rx="22" ry="8" transform="rotate(28 -15 ${y})"/><ellipse cx="15" cy="${y}" rx="22" ry="8" transform="rotate(-28 15 ${y})"/>`;}foliage+=`<g transform="rotate(${angle})" fill="${green}"><path d="M0 0 Q-8 -80 0 -${length}" fill="none" stroke="#496c51" stroke-width="4"/>${leaves}</g>`;}
  if(s.plant==='succulent') for(let layer=0;layer<3;layer++)for(let i=0;i<8;i++){const angle=i*45+layer*18;foliage+=`<ellipse cx="0" cy="-${29+layer*8}" rx="${16+layer*4}" ry="${40+layer*7}" transform="rotate(${angle})" fill="${['#aec2a2','#83a88e','#5f897c'][layer]}" stroke="#dce4c8" stroke-width="2"/>`;}
  if(s.plant==='flower') {foliage=`<path d="M0 0 Q-18 -75 0 -157" stroke="#597e59" stroke-width="6" fill="none"/><ellipse cx="-20" cy="-53" rx="28" ry="11" transform="rotate(25 -20 -53)" fill="${green}"/><ellipse cx="18" cy="-87" rx="26" ry="10" transform="rotate(-25 18 -87)" fill="${green}"/>`;if(n>=2){for(let i=0;i<6;i++)foliage+=`<ellipse cx="0" cy="-181" rx="13" ry="25" transform="rotate(${i*60} 0 -157)" fill="#d9a2a0"/>`;foliage+='<circle cy="-157" r="16" fill="#edcf79"/>';}else foliage+='<ellipse cy="-157" rx="12" ry="19" fill="#a1b889"/>';}
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="e034-bg" x2="0" y2="1"><stop stop-color="${s.light==='bright'?'#e6eee0':'#d2dddd'}"/><stop offset="1" stop-color="#f4efe1"/></linearGradient></defs><rect width="800" height="600" fill="url(#e034-bg)"/><rect x="80" y="42" width="640" height="360" rx="6" fill="#f8f4e7"/><rect x="96" y="58" width="608" height="328" fill="${s.light==='bright'?'#c6dedc':'#b5c4ce'}"/><circle cx="613" cy="120" r="31" fill="#f6e6b5" opacity="${s.light==='bright'?1:.35}"/><path d="M96 336 Q290 224 481 329 T704 291 L704 386 H96Z" fill="#a5bda6"/><path d="M400 58 V386 M96 215 H704" stroke="#f8f4e7" stroke-width="12"/><rect y="461" width="800" height="139" fill="#c7b39a"/><ellipse cx="400" cy="514" rx="127" ry="16" fill="#a38b71" opacity=".3"/><g transform="translate(400 389) scale(${scale})">${foliage}</g><path d="M325 389 H475 L460 503 H340Z" fill="#b78566"/><path d="M343 402 H458 L446 490 H354Z" fill="#c59574"/><ellipse cx="400" cy="389" rx="75" ry="14" fill="#a97656"/><ellipse cx="400" cy="386" rx="63" ry="9" fill="#685447"/><path d="M327 392 H473" stroke="#d9b497" stroke-width="7"/><g transform="translate(659 450)"><path d="M0 -22 Q-22 3 0 18 Q22 3 0 -22Z" fill="#719cac"/><rect x="-43" y="34" width="86" height="7" rx="3" fill="#e5ddc8"/><rect x="-43" y="34" width="${s.water*.86}" height="7" rx="3" fill="#719cac"/></g></svg>`;
}
export function pngBlob(canvas) { return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG编码失败')),'image/png')); }
export async function pngPayload(blob,name) { if(!blob||blob.type!=='image/png'||blob.size>LIMITS.pngBytes)throw Error('PNG限10MiB');const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.length!==blob.size||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))throw Error('PNG字节无效');const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));return{copyOnly:true,defaultName:name,base64:btoa(raw),sha256}; }
