export const LIMITS = Object.freeze({points:8000,bytes:32768,width:1000,pixels:12000000,height:16000,png:10485760});
export const FONT = '22px "Microsoft YaHei", "Segoe UI Emoji", sans-serif';
export function validateText(text) {
  if(typeof text!=='string'||text.length>16000)throw Error('正文最多8000个Unicode码点、32KiB UTF-8。');
  let points=0;
  for(let i=0;i<text.length;i++,points++){
    const c=text.charCodeAt(i);
    if(c>=0xD800&&c<=0xDBFF){const n=text.charCodeAt(++i);if(!(n>=0xDC00&&n<=0xDFFF))throw Error('正文含无效Unicode代理字符。');}
    else if(c>=0xDC00&&c<=0xDFFF)throw Error('正文含无效Unicode代理字符。');
    else if((c<32&&![9,10,13].includes(c))||c===127)throw Error('正文含不可显示控制字符；仅支持制表符和换行。');
  }
  const bytes=new TextEncoder().encode(text).length;
  if(points>LIMITS.points||bytes>LIMITS.bytes)throw Error('正文最多8000个Unicode码点、32KiB UTF-8。');
  return {points,bytes};
}
// Keep all logical lines, including trailing empty lines. Tabs visibly become four spaces.
export function layoutText(text,measure,{segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'grapheme'}):null}={}){
  const metrics=validateText(text);
  if(!segmenter||typeof measure!=='function')throw Error('PNG需要Intl.Segmenter和可测量的本地字体；可保留TXT全文。');
  const lines=[],logical=text.split(/\r\n|[\r\n\u2028\u2029]/u),bodyWidth=896;
  for(const paragraph of logical){
    let line='';
    for(const item of segmenter.segment(paragraph.replace(/\t/g,'    '))){
      const cluster=item.segment,w=measure(cluster);
      if(!Number.isFinite(w)||w<0||w>bodyWidth)throw Error('单个组合字符超出文字卡宽度，未截断；请保留TXT。');
      const next=measure(line+cluster);
      if(!Number.isFinite(next)||next<0)throw Error('本地字体测量失败。');
      if(next>bodyWidth&&line){lines.push(line);line=cluster;}else line+=cluster;
    }
    lines.push(line);
  }
  const height=Math.max(360,208+lines.length*32);
  if(height>LIMITS.height||height*LIMITS.width>LIMITS.pixels)throw Error('全文PNG超过16000px高度或1200万像素预算，未截断；全文预览和TXT仍可用。');
  return {width:LIMITS.width,height,lines,metrics,lineHeight:32,firstBaseline:136};
}
export function drawCard(canvas,layout){
  canvas.width=layout.width;canvas.height=layout.height;
  const c=canvas.getContext('2d');if(!c)throw Error('无法创建本地文字卡画布。');
  c.fillStyle='#F5EFE5';c.fillRect(0,0,canvas.width,canvas.height);
  c.fillStyle='#35524A';c.font='26px "Microsoft YaHei", sans-serif';c.fillText('写完放下 · 文字卡',52,62);
  c.fillStyle='#8C958B';c.fillRect(52,88,896,1);c.font=FONT;c.fillStyle='#273B35';
  for(let i=0;i<layout.lines.length;i++)c.fillText(layout.lines[i],52,layout.firstBaseline+i*layout.lineHeight);
  c.font='16px "Microsoft YaHei", sans-serif';c.fillStyle='#65746B';c.fillText('此刻写下的文字，由你决定如何保留。',52,layout.height-34);
}
export function clearCanvas(canvas){const c=canvas.getContext('2d');c?.clearRect(0,0,canvas.width,canvas.height);canvas.width=0;canvas.height=0;}
export function pngBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG编码失败，未写文件。')),'image/png'));}
export async function pngPayload(blob,name){
  if(!blob||blob.type!=='image/png'||blob.size>LIMITS.png)throw Error('完整PNG超过10MiB或编码失败，未截断、未写文件。');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(bytes.length>LIMITS.png||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))throw Error('PNG字节签名无效。');
  const hash=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {copyOnly:true,defaultName:name,base64:btoa(binary),sha256:[...hash].map(v=>v.toString(16).padStart(2,'0')).join('')};
}
export function releaseFrame(ms){
  const t=Math.min(1,Math.max(0,Number.isFinite(ms)?ms/1200:1));
  return Array.from({length:12},(_,i)=>({x:46+(i%6)*54+(i%2?1:-1)*t*28,y:35+Math.floor(i/6)*24+t*(52+i%3*10),angle:(i*29+t*90)%360,opacity:1-t}));
}
