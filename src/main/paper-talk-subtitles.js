'use strict';
// Never substitute a takeaway or guessed whole-turn timing for spoken subtitles.
function timedCues(words, duration, maxChars = 38) {
  if (!Array.isArray(words) || !Number.isFinite(duration) || duration <= 0) return [];
  const seen = new Set();
  const valid = words.flatMap(w => {
    if(typeof w?.startTime !== 'number' || typeof w?.endTime !== 'number')return [];
    const text = String(w?.word || ''), start = Number(w?.startTime), end = Number(w?.endTime);
    const key = `${start}:${end}:${text}`;
    if (!text.trim() || [...text].length > maxChars || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + 0.1 || seen.has(key)) return [];
    seen.add(key); return [{text, start, end:Math.min(end,duration)}];
  }).sort((a,b)=>a.start-b.start || a.end-b.end);
  const cues=[]; let current=null;
  const flush=()=>{if(current)cues.push({...current,text:current.text.trim()});current=null;};
  for (const word of valid) {
    if (current && word.start < current.end - 0.03) return []; // ambiguous alignment: hide, don't guess
    const gap=current && /[A-Za-z0-9]$/.test(current.text) && /^[A-Za-z0-9]/.test(word.text) ? ' ' : '';
    if (current && (word.start-current.end>0.45 || [...current.text+gap+word.text].length>maxChars)) flush();
    if (!current) current={text:word.text,start:word.start,end:word.end};
    else {current.text+=gap+word.text;current.end=word.end;}
    if (/[。！？!?；;]$/.test(word.text) || (/[，,:：]$/.test(word.text) && [...current.text].length>=12)) flush();
  }
  flush(); return cues;
}
module.exports={timedCues};
