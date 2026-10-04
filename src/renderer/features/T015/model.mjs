export const LIMITS={templateBytes:24576,variableBytes:4096,entries:100,directories:200,fileBytes:8192,totalTextBytes:32768};
const bytes=s=>new TextEncoder().encode(s).length;
function unicode(s){return typeof s==='string'&&!/[\u0000\ud800-\udfff]/u.test(s);}
export function segment(s){return unicode(s)&&s.length>0&&[...s].length<=80&&bytes(s)<=240&&!/[\u0000-\u001f\u007f<>:"|?*\\/]/u.test(s)&&!/[. ]$/u.test(s)&&s!=='.'&&s!=='..'&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s);}
const canonical=s=>s.normalize('NFC').toLowerCase();
export function buildPlan(template,variables){
 if(!unicode(template)||bytes(template)>LIMITS.templateBytes||!unicode(variables)||bytes(variables)>LIMITS.variableBytes)throw Error('模板须≤24KiB，变量须≤4KiB且为有效Unicode。');
 const vars=new Map();for(const line of variables.split(/\r?\n/)){if(line.trim()===''||line.startsWith('#'))continue;const i=line.indexOf('='),key=line.slice(0,i),value=line.slice(i+1);if(i<1||!/^[_a-zA-Z][_a-zA-Z0-9]{0,31}$/.test(key)||vars.has(key)||vars.size>=20||/[\u0000-\u001f\u007f]/u.test(value)||value.includes('{{')||value.includes('}}'))throw Error('变量每行name=value，名称唯一、最多20项，值不含控制字符或嵌套占位符。');vars.set(key,value);}
 const expand=s=>{const value=s.replace(/\{\{([_a-zA-Z][_a-zA-Z0-9]{0,31})\}\}/g,(_all,name)=>{if(!vars.has(name))throw Error(`缺失变量：${name}`);return vars.get(name);});if(value.includes('{{')||value.includes('}}'))throw Error('未知或不完整的变量占位符。');return value;};
 const explicit=[],seen=new Map();let total=0;
 for(const[lineIndex,line]of template.split(/\r?\n/).entries()){
  if(line.trim()===''||line.startsWith('#'))continue;if(explicit.length>=100)throw Error('模板最多100个显式条目。');let kind,path,content=null;
  if(line.startsWith('D ')){kind='directory';path=expand(line.slice(2));}
  else if(line.startsWith('F ')){kind='file';const tab=line.indexOf('\t',2);if(tab<0)throw Error(`第${lineIndex+1}行文件须F 路径<TAB>JSON字符串。`);path=expand(line.slice(2,tab));let decoded;try{decoded=JSON.parse(line.slice(tab+1));}catch{throw Error(`第${lineIndex+1}行文本须合法JSON字符串。`);}if(typeof decoded!=='string'||!unicode(decoded))throw Error('样板须显式Unicode文本字符串，禁止NUL/孤立代理码元。');content=expand(decoded);if(bytes(content)>8192)throw Error('单个文本样板超过8KiB。');total+=bytes(content);if(total>32768)throw Error('全部文本超过32KiB，未截断。');}
  else throw Error(`第${lineIndex+1}行须D 空目录或F 文本样板。`);
  if(path.length>500||path.split('/').length>12||!path.split('/').every(segment))throw Error(`第${lineIndex+1}行路径须安全相对路径，禁止绝对路径、遍历、保留名、尾点/空格。`);
  const key=canonical(path);if(seen.has(key))throw Error('显式路径重复（忽略大小写/NFC），未创建目录。');const item={kind,path,content,line:lineIndex+1};seen.set(key,item);explicit.push(item);
 }
 if(!explicit.length)throw Error('至少一个空目录或文本样板。');
 const dirs=new Map();function addDir(path){const key=canonical(path),old=dirs.get(key);if(old&&old.path!==path)throw Error('父目录的大小写/NFC表示不一致。');const other=seen.get(key);if(other?.kind==='file')throw Error('文件路径和目录路径冲突。');if(other&&other.path!==path)throw Error('父目录表示不一致。');if(!old)dirs.set(key,{kind:'directory',path,explicit:other?.kind==='directory'});}
 for(const item of explicit){const parts=item.path.split('/');for(let i=1;i<parts.length;i++)addDir(parts.slice(0,i).join('/'));if(item.kind==='directory')addDir(item.path);}
 if(dirs.size>200)throw Error('包含自动父目录后超过200目录，未截断。');
 return{format:'T015-skeleton-plan',schemaVersion:1,directories:[...dirs.values()].sort((a,b)=>a.path.split('/').length-b.path.split('/').length||a.path.localeCompare(b.path,'en')),files:explicit.filter(v=>v.kind==='file').map(v=>({kind:'file',path:v.path,content:v.content,utf8Bytes:bytes(v.content),line:v.line})),totalTextBytes:total,explicitEntries:explicit.length,scope:'仅空目录及显式UTF-8文本，无脚本执行、依赖安装或已有目录合并。'};
}
