import {h} from '../../core/ui.js';
import {LIMITS,EXAMPLE_MAP,EXAMPLE_STACK,mapStack,relativePath,sourceInventory,readSource,sourceLine} from './model.mjs';
export default {id:'T059',create(root){
 let alive=true,active=false,busy=false,nativePending=false,epoch=0,job=null,report=null,preview=null,sources=new Map(),cache=new Map(),cacheBytes=0;const bindings=[];
 const on=(n,t,f)=>{n.addEventListener(t,f);bindings.push([n,t,f]);return n;};
 const say=s=>{if(alive)status.textContent=s;};
 const status=h('p',{role:'status','aria-label':'操作状态'});
 const stack=h('textarea',{rows:8,'aria-label':'V8 错误堆栈'}),mapText=h('textarea',{rows:9,'aria-label':'flat version3 source map JSON'});
 const mapPath=h('input',{value:'dist/bundle.js.map','aria-label':'map 项目相对位置'}),generatedPath=h('input',{value:'dist/bundle.js','aria-label':'对应生成文件项目相对位置'});
 const mapFile=h('input',{type:'file',accept:'.map,.json','aria-label':'选择本地 map 文件'}),folder=h('input',{type:'file',multiple:true,webkitdirectory:true,'aria-label':'选择源码项目目录集合'});
 const results=h('div',{'aria-label':'完整帧映射结果'}),excerpt=h('pre',{'aria-label':'所选源码完整定位行'}),previewHost=h('pre',{'aria-label':'完整报告预览'}),scope=h('p',{'aria-label':'源码范围'});
 const button=(label,fn)=>on(h('button',{type:'button',class:'btn'},label),'click',()=>{if(alive&&active&&!busy)fn();});
 const demo=button('载入可复现示例',()=>{stack.value=EXAMPLE_STACK;mapText.value=EXAMPLE_MAP;mapPath.value='dist/bundle.js.map';generatedPath.value='dist/bundle.js';const f=new File(['export function example() {\n  throw new Error("示例 🐱");\n}\n'],'example.ts');Object.defineProperty(f,'webkitRelativePath',{value:'example-project/src/example.ts'});sources=sourceInventory([f]);mapFile.value=folder.value='';invalidate('示例为内存文件：点击映射，再打开 src/example.ts 第2行。');updateScope();});
 const run=button('映射完整堆栈',async()=>{
  invalidate();const own=++epoch;busy=true;job=new AbortController();update();
  try{const next=await mapStack({stack:stack.value,mapText:mapText.value,mapPath:mapPath.value,generatedPath:generatedPath.value},{signal:job.signal});if(!current(own))return;report=next;render();say(`已处理全部${next.summary.frames}帧：映射${next.summary.mapped}，未映射${next.summary.unmapped}；忽略${next.ignoredStackLines.length}行。报告尚未保存。`);}
  catch(e){if(current(own))say(`映射未完成：${e.message}`);}finally{finish(own);}
 });
 const json=button('预览完整 JSON 报告',()=>show('json')),md=button('预览完整 Markdown 报告',()=>show('md'));
 const save=button('保存已预览报告新副本',async()=>{
  const api=window.toolbox?.files;if(!preview||api?.saveTextSupportsCopyOnly!==true||typeof api.saveText!=='function'){say('需要文本新副本接口并先预览报告。');return;}const own=epoch,chosen=preview;busy=nativePending=true;update();
  try{const r=await api.saveText({...chosen,copyOnly:true});if(!current(own)||preview!==chosen)return;say(r?.ok===true?'完整映射报告新副本保存成功。':r?.canceled===true?'已取消另存，预览保留。':`未确认保存成功：${r?.error||'接口返回失败'}${r?.partialPath?'；请核对 '+r.partialPath:''}`);}catch{if(current(own))say('保存失败，预览保留。');}finally{finish(own);}
 });
 const cancel=on(h('button',{type:'button',class:'btn'},'取消当前读取或映射'),'click',()=>{if(!alive||!active||!busy||nativePending)return;invalidate('已取消，没有部分映射或源码预览。');busy=false;job=null;update();});
 const clear=button('清空输入和源码集合',()=>{stack.value=mapText.value='';mapFile.value=folder.value='';sources.clear();invalidate('输入、源码引用和旧报告已清空。');updateScope();});
 const current=own=>alive&&active&&own===epoch;
 function finish(own){if(current(own)){busy=nativePending=false;job=null;update();}}
 function invalidate(message='输入或所选范围改变，旧报告已失效。'){epoch++;job?.abort();report=preview=null;cache.clear();cacheBytes=0;results.replaceChildren();excerpt.textContent=previewHost.textContent='';say(message);update();}
 function updateScope(){scope.textContent=`明确所选源码集合：${sources.size}文件；只有点击定位行才读取对应文件，单个≤1MiB，当前集合成功读取缓存合计≤4MiB。没有目录后台访问。`;}
 function update(){if(!alive)return;for(const n of[stack,mapText,mapPath,generatedPath,mapFile,folder,demo,run,clear])n.disabled=!active||busy;json.disabled=md.disabled=!active||busy||!report;save.disabled=!active||busy||!preview||window.toolbox?.files?.saveTextSupportsCopyOnly!==true;cancel.disabled=!active||!busy||nativePending;for(const n of results.querySelectorAll('button'))n.disabled=!active||busy||n.dataset.missing==='true';}
 async function openSource(position){
  if(!alive||!active||busy)return;const file=sources.get(position.path);if(!file){say('该源码未明确选择；映射位置保留，不读取外部资源。');return;}
  const own=epoch;busy=true;job=new AbortController();excerpt.textContent='';update();
  try{let body=cache.get(position.path);if(body===undefined){if(!Number.isSafeInteger(file.size)||file.size<0||cacheBytes+file.size>LIMITS.totalSourceBytes)throw Error('所选范围源码缓存合计超过4MiB；不输出部分定位行。');body=await readSource(file,{signal:job.signal});if(!current(own))return;cache.set(position.path,body);cacheBytes+=file.size;}const line=sourceLine(body,position);if(!current(own))return;excerpt.textContent=line.available?`${position.path}:${position.line}:${position.column}（UTF16列、1起）\n${line.text}`:`${position.path}：${line.reason}；没有可核对定位行。`;say(line.available?'已打开所选文件的完整定位行；映射不等于错误根因证明。':'映射行/UTF16列越过所选源文件范围，请核对 map 与生成文件版本。');}
  catch(e){if(current(own))say(`源码行未打开：${e.message}`);}finally{finish(own);}
 }
 function render(){
  results.replaceChildren();if(!report)return;
  const rows=report.frames.map(f=>{const p=f.original,selected=p&&sources.has(p.path),node=p?button(selected?'打开所选源码定位行':'源码未选择',()=>openSource(p)):null;if(node){node.dataset.missing=String(!selected);node.disabled=!selected;}
   return h('tr',{},h('td',{},String(f.stackLine)),h('td',{},`${f.file}:${f.line}:${f.column}`),h('td',{},f.status),h('td',{},p?`${p.path}:${p.line}:${p.column}${p.name?' · '+p.name:''}`:f.reason),h('td',{},node));});
  results.append(h('table',{},h('thead',{},h('tr',{},...['堆栈行','生成位置','状态','原始位置或原因','本地查看'].map(t=>h('th',{},t)))),h('tbody',{},rows)),h('pre',{'aria-label':'忽略行及 map 范围'},JSON.stringify({ignoredStackLines:report.ignoredStackLines,mapSummary:report.mapSummary},null,2)));update();
 }
 function show(kind){if(!report)return;const body=JSON.stringify(report,null,2);preview={content:kind==='json'?body:`# 本地 source map 映射报告\n\n全部结构化结果如下（不含源码正文）：\n\n\`\`\`\`\`\`\`\`\`\`json\n${body.replaceAll('`','\\u0060')}\n\`\`\`\`\`\`\`\`\`\`\n`,extension:kind==='json'?'json':'md',defaultName:`source-map-report-copy.${kind==='json'?'json':'md'}`};previewHost.textContent=preview.content;say('已预览全部帧及未映射原因，保存会创建新副本；堆栈 URL/路径/名称可能含私人信息。');update();}
 for(const input of[stack,mapText,mapPath,generatedPath])on(input,'input',()=>{if(alive&&active&&!busy)invalidate();});
 on(folder,'change',()=>{if(!alive||!active||busy)return;invalidate();sources.clear();try{sources=sourceInventory(Array.from(folder.files||[]));say('源码集合已明确选择；尚未读取任何正文。');}catch(e){say(`源码范围拒绝：${e.message}`);}updateScope();});
 on(mapFile,'change',async()=>{
  if(!alive||!active||busy)return;invalidate();mapText.value='';const file=mapFile.files?.[0];if(!file)return;const own=epoch;busy=true;job=new AbortController();update();
  try{if(!Number.isSafeInteger(file.size)||file.size>LIMITS.mapBytes)throw Error('map 文件≤256KiB。');const body=await readSource(file,{signal:job.signal});if(!current(own))return;mapText.value=body.startsWith('\uFEFF')?body.slice(1):body;say('本地 map 已严格UTF-8读取；请填写其项目相对位置并映射。');}catch(e){if(current(own))say(`map 未载入：${e.message}`);}finally{finish(own);}
 });
 const hide=()=>{if(alive&&document.hidden){epoch++;job?.abort();busy=nativePending=false;cache.clear();cacheBytes=0;excerpt.textContent='';preview=null;previewHost.textContent='';update();}};document.addEventListener('visibilitychange',hide);
 const field=(label,node)=>h('label',{},label,node);
 root.replaceChildren(h('section',{class:'t059'},h('style',{},'.t059{display:grid;gap:12px;max-width:1100px;margin:auto}.t059 label{display:grid;gap:6px}.t059 input,.t059 textarea,.t059 pre{padding:10px;background:var(--bg-raised);color:var(--text);border:1px solid var(--line);width:100%;box-sizing:border-box}.t059 pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:440px;overflow:auto}.t059 table{width:100%;border-collapse:collapse}.t059 th,.t059 td{padding:7px;text-align:left;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.t059-row{display:flex;gap:8px;flex-wrap:wrap}'),h('h2',{},'错误堆栈本地 source map 映射'),h('p',{},'有限 flat version3 / V8 at 文件:行:列。只读用户所选源文件，不访问 URL、不读取嵌入源码、不执行代码。'),status,field('V8 堆栈（最多100行 / 16KiB）',stack),field('对应生成文件的项目相对位置，由你明确指定',generatedPath),field('map 文件在同一项目的相对位置',mapPath),field('本地 map 文件（会替换 JSON 输入）',mapFile),field('map JSON（最多256KiB）',mapText),field('可选：源码项目目录集合（最多500文件）',folder),scope,h('div',{class:'t059-row'},demo,run,cancel,clear),results,excerpt,h('div',{class:'t059-row'},json,md),previewHost,save,h('p',{},'UTF16列与行号均1起。同一生成行取不超过输入列的最后片段，原始列不插值；没有片段时给出未映射原因。最多200 sources / 500 names / 10000片段与生成行，超限整份拒绝。报告不含源码定位行正文；映射依赖用户文件版本对应，不证明根因。')));
 updateScope();say('填写堆栈、map 和对应位置，或先载入示例。不会自动读取磁盘或保存输入。');update();
 return{activate(){if(alive){active=true;update();}},deactivate(){if(alive){active=false;epoch++;job?.abort();busy=nativePending=false;cache.clear();cacheBytes=0;excerpt.textContent='';preview=null;previewHost.textContent='';update();}},destroy(){if(!alive)return;alive=active=false;epoch++;job?.abort();for(const[n,t,f]of bindings)n.removeEventListener(t,f);document.removeEventListener('visibilitychange',hide);sources.clear();cache.clear();report=preview=null;stack.value=mapText.value='';root.replaceChildren();}};
}};
