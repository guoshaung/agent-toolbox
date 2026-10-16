export const LIMITS=Object.freeze({inputBytes:65536,nodes:500,depth:16,messageChars:8192,targets:4,outputBytes:4*1024*1024});
const bytes=s=>new TextEncoder().encode(s).length;
function unicode(s){for(const c of s)if(c.codePointAt(0)>=0xd800&&c.codePointAt(0)<=0xdfff)throw Error('JSON含孤立Unicode代理项。');}
export function parseJson(text){
 if(typeof text!=='string'||bytes(text)>LIMITS.inputBytes)throw Error('每份JSON最多64KiB UTF-8，超限拒绝。');text=text.replace(/^\uFEFF/,'');let at=0,nodes=0;
 const fail=()=>{throw Error('JSON语法/重复键/容量无效，未截断或选后者覆盖。');};const ws=()=>{while(/[ \r\n\t]/.test(text[at]||'\0'))at++;};
 function string(){const start=at++;while(at<text.length){const c=text[at++];if(c==='"'){let s;try{s=JSON.parse(text.slice(start,at));}catch{fail();}unicode(s);if(s.length>8192)throw Error('JSON字符串最多8192 UTF-16码元。');return s;}if(c==='\\')at++;else if(c.charCodeAt(0)<32)fail();}fail();}
 function value(depth=0){if(depth>16||++nodes>500)throw Error('JSON最多16层、500节点，包括对象与叶值。');ws();const c=text[at];if(c==='"')return string();if(c==='{'){at++;const out=Object.create(null);ws();if(text[at]==='}'){at++;return out;}while(true){ws();if(text[at]!=='"')fail();const key=string();if(key.length>160||/[\x00-\x1f\x7f]/.test(key))throw Error('键最长160码元，不允许控制符。');if(Object.hasOwn(out,key))fail();ws();if(text[at++]!==':')fail();out[key]=value(depth+1);ws();const next=text[at++];if(next==='}')return out;if(next!==',')fail();}}if(c==='[')throw Error('当前语言文件不支持数组，请使用嵌套对象/字符串键。');for(const[t,v]of [['true',true],['false',false],['null',null]])if(text.slice(at,at+t.length)===t){at+=t.length;return v;}const match=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));if(!match)fail();at+=match[0].length;const number=Number(match[0]);if(!Number.isFinite(number))fail();return number;}
 const parsed=value();ws();if(at!==text.length||!parsed||typeof parsed!=='object')fail();return parsed;
}
const type=v=>v===null?'null':typeof v==='object'?'object':typeof v;
const pointer=key=>key.replaceAll('~','~0').replaceAll('/','~1');
export function flatten(parsed){const out=new Map();function visit(value,path){out.set(path,{type:type(value),...(typeof value==='string'?{text:value}:{})});if(value&&typeof value==='object')for(const[key,v]of Object.entries(value))visit(v,path+'/'+pointer(key));}visit(parsed,'');return out;}
export function placeholders(text,dialect='single'){
 if(!['single','double'].includes(dialect))throw Error('占位符方言须single或double。');const counts=Object.create(null);let at=0;
 while(at<text.length){if(text[at]!== '{'&&text[at]!=='}'){at++;continue;}const open=dialect==='single'?'{':'{{',close=dialect==='single'?'}':'}}';if(!text.startsWith(open,at))return{valid:false,code:'unsupported_brace_syntax',counts};const end=text.indexOf(close,at+open.length);if(end<0)return{valid:false,code:'unsupported_brace_syntax',counts};const name=text.slice(at+open.length,end);if(name.length>64||! /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name))return{valid:false,code:'unsupported_brace_syntax',counts};counts[name]=(counts[name]||0)+1;at=end+close.length;}
 return{valid:true,counts};
}
export async function compareLocales({baseline,targets,dialect='single',strictCounts=false},hooks={}){
 if(!Array.isArray(targets)||!targets.length||targets.length>4||!['single','double'].includes(dialect)||typeof strictCounts!=='boolean')throw Error('须1–4份目标语言和明确方言。');
 const check=()=>{if(hooks.signal?.aborted)throw Object.assign(Error('已取消，无部分完整性报告。'),{name:'AbortError'});};check();
 const base=flatten(parseJson(baseline)),seen=new Set(),sources=targets.map(t=>{if(typeof t?.label!=='string'||!t.label.trim()||[...t.label].length>40||/[\x00-\x1f\x7f]/.test(t.label)||seen.has(t.label))throw Error('语言别名须唯一、1–40码点且无控制符。');unicode(t.label);seen.add(t.label);return{label:t.label,nodes:flatten(parseJson(t.text))};});
 const baselineIssues=[];for(const[path,n]of base){if(!['object','string'].includes(n.type))baselineIssues.push({path,code:'baseline_non_string',type:n.type});if(n.type==='string'&&!placeholders(n.text,dialect).valid)baselineIssues.push({path,code:'baseline_unsupported_brace_syntax'});}
 const records=[];let processed=0;
 for(const target of sources)for(const path of [...new Set([...base.keys(),...target.nodes.keys()])].sort()){
   check();const a=base.get(path),b=target.nodes.get(path);const row={locale:target.label,path,expectedType:a?.type||null,actualType:b?.type||null,codes:[],missingVariables:[],extraVariables:[],countDifferences:[]};
   if(!a)row.codes.push('extra_key');else if(!b)row.codes.push('missing_key');else if(a.type!==b.type)row.codes.push('type_mismatch');else if(a.type==='string'){
     const pa=placeholders(a.text,dialect),pb=placeholders(b.text,dialect);row.expectedVariables=pa.counts;row.actualVariables=pb.counts;
     if(!pa.valid)row.codes.push('baseline_uncheckable');if(!pb.valid)row.codes.push('target_unsupported_brace_syntax');
     if(pa.valid&&pb.valid){row.missingVariables=Object.keys(pa.counts).filter(n=>!Object.hasOwn(pb.counts,n));row.extraVariables=Object.keys(pb.counts).filter(n=>!Object.hasOwn(pa.counts,n));row.countDifferences=Object.keys(pa.counts).filter(n=>Object.hasOwn(pb.counts,n)&&pa.counts[n]!==pb.counts[n]).map(name=>({name,expected:pa.counts[name],actual:pb.counts[name]}));if(row.missingVariables.length||row.extraVariables.length||(strictCounts&&row.countDifferences.length))row.codes.push('placeholder_mismatch');}
   }else if(a.type!=='object')row.codes.push('baseline_uncheckable');
   if(!row.codes.length)row.codes.push('match');records.push(row);if(++processed%50===0){await(hooks.yieldControl||(()=>new Promise(resolve=>setTimeout(resolve,0))))();check();}
 }
 check();const issues=records.filter(r=>!r.codes.includes('match')),report={feature:'T058',version:1,rules:{dialect,strictCounts,pathSyntax:'RFC6901 JSON Pointer; root is empty string; no normalization',comparison:'key/type/placeholder names; translation meaning and equal string values not checked'},baseline:{nodes:base.size,messages:[...base.values()].filter(n=>n.type==='string').length,issues:baselineIssues},locales:sources.map(t=>({label:t.label,nodes:t.nodes.size})),summary:{records:records.length,issues:issues.length,missingKeys:records.filter(r=>r.codes.includes('missing_key')).length,extraKeys:records.filter(r=>r.codes.includes('extra_key')).length,placeholderMismatches:records.filter(r=>r.codes.includes('placeholder_mismatch')).length},accepted:baselineIssues.length===0&&issues.length===0,records,scope:'只比较选中的JSON资源；空对象属于对象节点。非字符串基准/未支持花括号语法标记不可核验，不自动翻译或修复。默认变量集合比较，重复次数差异单列但不判失败；启用次数严格比较才判差异。报告无文案正文，键名/语言名仍需分享前核对。'};if(bytes(JSON.stringify(report,null,2))>LIMITS.outputBytes)throw Error('完整报告超过4MiB，整份拒绝。');return report;
}
export const EXAMPLE_BASE=JSON.stringify({greeting:'你好，{name}',cart:{count:'共{count}件'},help:'帮助'},null,2);
export const EXAMPLE_TARGET=JSON.stringify({greeting:'Hello',cart:{count:'{count} items'},extra:'Extra'},null,2);
