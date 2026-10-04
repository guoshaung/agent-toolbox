export const LIMITS=Object.freeze({files:100,fileBytes:1048576,totalBytes:4*1048576,findings:10000,tokenCodePoints:1024,outputBytes:4*1048576});
export const SPECIAL=Object.freeze({
  0x061c:['bidi','ARABIC LETTER MARK'],0x200e:['bidi','LEFT-TO-RIGHT MARK'],0x200f:['bidi','RIGHT-TO-LEFT MARK'],0x202a:['bidi','LEFT-TO-RIGHT EMBEDDING'],0x202b:['bidi','RIGHT-TO-LEFT EMBEDDING'],0x202c:['bidi','POP DIRECTIONAL FORMATTING'],0x202d:['bidi','LEFT-TO-RIGHT OVERRIDE'],0x202e:['bidi','RIGHT-TO-LEFT OVERRIDE'],0x2066:['bidi','LEFT-TO-RIGHT ISOLATE'],0x2067:['bidi','RIGHT-TO-LEFT ISOLATE'],0x2068:['bidi','FIRST STRONG ISOLATE'],0x2069:['bidi','POP DIRECTIONAL ISOLATE'],
  0x200b:['invisible','ZERO WIDTH SPACE'],0x200c:['invisible','ZERO WIDTH NON-JOINER'],0x200d:['invisible','ZERO WIDTH JOINER'],0x2060:['invisible','WORD JOINER'],0xfeff:['invisible','ZERO WIDTH NO-BREAK SPACE'],0x00ad:['invisible','SOFT HYPHEN'],0x034f:['invisible','COMBINING GRAPHEME JOINER']
});
const utf8=s=>new TextEncoder().encode(s).length;
const cpText=n=>'U+'+n.toString(16).toUpperCase().padStart(4,'0');
export function escaped(text){return [...String(text)].map(c=>c==='\\'?'\\\\':SPECIAL[c.codePointAt(0)]?'\\u'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0'):c).join('');}
function path(value){if(typeof value!=='string'||!value||value.length>500||/[\\:]/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'||p.length>160)||/[\x00-\x1f\x7f]/.test(value)||[...value].some(c=>c.codePointAt(0)>=0xd800&&c.codePointAt(0)<=0xdfff))throw Error('仅有效File API相对路径，不接受绝对/遍历/非法Unicode。');return value;}
export function parseRules({extensions='.js,.jsx,.ts,.tsx,.py,.go,.rs,.c,.cpp,.h,.java,.json,.yaml,.yml,.md,.txt,.html,.css,.sh,.ps1',excludedDirs='node_modules,.git,dist',mixedScripts=true}={}){
 const list=(text,max)=>{if(typeof text!=='string'||text.length>1000)throw Error('规则文本最多1000字符。');const values=text.trim()?text.split(',').map(v=>v.trim()):[];if(values.length>max||values.some(v=>!v)||new Set(values).size!==values.length)throw Error('规则列表最多40项，不接受空项或重复。');return values;};const exts=list(extensions,40).map(v=>v.toLowerCase());if(!exts.length||exts.some(v=>!/^\.[a-z0-9]{1,12}$/.test(v))||new Set(exts).size!==exts.length)throw Error('须至少一个明确扩展名，格式如.js，最多12位字母数字。');const dirs=list(excludedDirs,40);if(dirs.some(v=>!/^[A-Za-z0-9_.-]{1,100}$/.test(v)||['.','..'].includes(v))||typeof mixedScripts!=='boolean')throw Error('排除按完整目录段，须ASCII名称，不支持glob/正则。');return{extensions:exts,excludedDirs:dirs,mixedScripts};
}
export function inventory(files,rules=parseRules()){
 if(!Array.isArray(files)||!files.length||files.length>100)throw Error('明确所选集合须1–100文件，超限不截断。');const seen=new Set();let total=0;const included=[],excluded=[];
 for(const file of files){const raw=path(file.webkitRelativePath||file.name),relative=file.webkitRelativePath?path(raw.split('/').slice(1).join('/')):raw;if(seen.has(relative))throw Error('来源相对路径重复，无法唯一定位。');seen.add(relative);const extension='.'+(relative.split('/').at(-1).split('.').at(-1)||'').toLowerCase();const reason=relative.split('/').slice(0,-1).some(p=>rules.excludedDirs.includes(p))?'excluded_directory':!rules.extensions.includes(extension)?'unselected_extension':null;
   if(reason){excluded.push({path:escaped(relative),reason});continue;}
   if(!Number.isSafeInteger(file.size)||file.size<0||file.size>LIMITS.fileBytes||typeof file.slice!=='function'||(total+=file.size)>LIMITS.totalBytes)throw Error('纳入文件单个≤1MiB、总≤4MiB，须可读取File API。');included.push({file,path:relative,size:file.size});
 }
 if(!included.length)throw Error('本次规则没有纳入任何文件。');return{included,excluded,totalBytes:total};
}
const scripts=[['Latin',/\p{Script=Latin}/u],['Cyrillic',/\p{Script=Cyrillic}/u],['Greek',/\p{Script=Greek}/u]],begin=/[$_\p{ID_Start}]/u,cont=/[$\p{ID_Continue}\u200c\u200d]/u;
export async function scanText(text,filePath='sample.js',{mixedScripts=true,signal,yieldControl=()=>new Promise(r=>setTimeout(r,0)),onProgress}={}){
 if(typeof text!=='string'||utf8(text)>LIMITS.fileBytes)throw Error('每文件文本最多1MiB严格UTF-8。');path(filePath);if(typeof mixedScripts!=='boolean')throw Error('混用脚本开关须布尔值。');const findings=[];let line=1,column=1,utf16Column=1,offset=0,previousCR=false,token=null,nextYield=16384;
 const check=()=>{if(signal?.aborted)throw Object.assign(Error('已取消，没有部分巡检报告。'),{name:'AbortError'});};check();
 const append=row=>{if(findings.length>=10000)throw Error('超过10000项发现，整份报告拒绝。');findings.push({path:escaped(filePath),...row});};
 function finish(){if(token&&mixedScripts&&token.scripts.size>1)append({...token.position,kind:'mixed_script_candidate',codePoint:null,unicodeName:null,scripts:[...token.scripts].sort(),tokenCodePoints:token.length,note:'仅标识符形态文本的Latin/Cyrillic/Greek混用候选；没有语言语法解析或形似字符证明，不输出原token。'});token=null;}
 for(const c of text){const point=c.codePointAt(0);if(point>=0xd800&&point<=0xdfff)throw Error('源含孤立Unicode代理项，整份拒绝。');const position={line,column,utf16Column,utf16Offset:offset};
   if(token&&!cont.test(c))finish();if(!token&&begin.test(c))token={position,length:0,scripts:new Set()};if(token){if(++token.length>1024)throw Error('标识符形态连续片段超过1024码点，整份拒绝。');for(const[name,re]of scripts)if(re.test(c))token.scripts.add(name);}
   if(SPECIAL[point]){const[kind,unicodeName]=SPECIAL[point];append({...position,kind:point===0xfeff&&offset===0?'initial_bom':kind,codePoint:cpText(point),unicodeName,note:point===0xfeff&&offset===0?'开头BOM单独提示，可能是正常编码标记。':'可合法用于语言/格式；请人工核对，发现不等于恶意。'});}
   if(c==='\r'){line++;column=utf16Column=1;previousCR=true;}else if(c==='\n'){if(!previousCR)line++;column=utf16Column=1;previousCR=false;}else{column++;utf16Column+=c.length;previousCR=false;}offset+=c.length;
   if(offset>=nextYield){check();onProgress?.({scannedUtf16Units:offset,totalUtf16Units:text.length});await yieldControl();check();nextYield=offset+16384;}
 }
 finish();check();return findings.sort((a,b)=>a.utf16Offset-b.utf16Offset||a.kind.localeCompare(b.kind));
}
export async function auditFiles(files,options={},hooks={}){
 const rules=parseRules(options),plan=inventory(files,rules),findings=[],scanned=[];const check=()=>{if(hooks.signal?.aborted)throw Object.assign(Error('已取消，没有部分巡检报告。'),{name:'AbortError'});};check();
 for(const entry of plan.included){check();const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});let text='';try{for(let at=0;at<entry.size;at+=65536){check();const end=Math.min(entry.size,at+65536),buffer=await entry.file.slice(at,end).arrayBuffer();check();if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==end-at)throw Error('来源实际读取字节数不符。');text+=decoder.decode(buffer,{stream:true});await(hooks.yieldControl||(()=>new Promise(r=>setTimeout(r,0))))();check();}text+=decoder.decode();}catch(error){if(error.name==='AbortError')throw error;throw Error('来源读取失败或不是严格UTF-8；没有部分结果，不回显源码上下文。');}
   const rows=await scanText(text,entry.path,{...hooks,mixedScripts:rules.mixedScripts});if(findings.length+rows.length>10000)throw Error('全部文件超过10000项发现，整份拒绝。');findings.push(...rows);scanned.push({path:escaped(entry.path),bytes:entry.size,findings:rows.length});hooks.onFile?.({done:scanned.length,total:plan.included.length});
 }
 check();const report={feature:'T060',version:1,rules,selectedFiles:files.length,scannedFiles:scanned,excludedFiles:plan.excluded,summary:{scanned:scanned.length,excluded:plan.excluded.length,findings:findings.length,bidi:findings.filter(f=>f.kind==='bidi').length,invisible:findings.filter(f=>f.kind==='invisible').length,initialBom:findings.filter(f=>f.kind==='initial_bom').length,mixedScriptCandidates:findings.filter(f=>f.kind==='mixed_script_candidate').length},findings,scope:'只读取用户所选File集合，排除规则按完整目录段/扩展名，不使用glob。行列1起、column按Unicode码点，utf16Column按UTF-16码元；utf16Offset从0起，CRLF按一个换行，BOM保留并计入位置。固定19种格式字符给Unicode名称；混用仅Latin/Cyrillic/Greek的标识符形态片段，含注释/字符串也可能提示，没有编程语言语法解析、完整UTS39或同脚本形似字符检测。没有发现不等于安全。报告不含源码正文/token，路径中的所列格式字符转成可见反斜杠u码位；仍需核对路径分享范围。不执行或自动修复源码。'};
 if(utf8(JSON.stringify(report,null,2))>LIMITS.outputBytes)throw Error('完整报告超过4MiB，整份拒绝。');return report;
}
export const EXAMPLE='const ok = 1;\n// 双向符：\u202E\nconst hidden\u200B = 2;\nconst p\u0430ypal = 3;\n';
