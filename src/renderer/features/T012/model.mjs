export const LIMITS=Object.freeze({fileBytes:8*1024*1024,chunkMin:16*1024,chunkMax:2*1024*1024,parts:99,manifestBytes:32768});
const encoder=new TextEncoder(),hashPattern=/^[0-9a-f]{64}$/;
export function checkAbort(signal){if(signal?.aborted)throw Object.assign(Error('已取消；未发布半份分片或重组结果。'),{name:'AbortError'});}
function name(value){if(typeof value!=='string'||!value||value.length>120||/[\x00-\x1f\x7f<>:"|?*\\/]/u.test(value)||/[. ]$/u.test(value)||['.','..'].includes(value)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)||[...value].some(c=>c.codePointAt(0)>=0xd800&&c.codePointAt(0)<=0xdfff))throw Error('源文件名须为1–120字符有效文件名，不含路径/保留名/孤立Unicode。');return value;}
export async function sha256(bytes,hooks={}){checkAbort(hooks.signal);const crypto=hooks.crypto||globalThis.crypto;if(!crypto?.subtle?.digest)throw Error('宿主缺少SHA-256，未生成无摘要的结果。');const buffer=await crypto.subtle.digest('SHA-256',bytes);checkAbort(hooks.signal);return [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function base64(bytes){let text='';for(let at=0;at<bytes.length;at+=16384)text+=String.fromCharCode(...bytes.subarray(at,at+16384));return btoa(text);}
export function manifestText(value){return JSON.stringify(value,null,2)+'\n';}
function exactKeys(object,keys){if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).sort().join('|')!==[...keys].sort().join('|'))throw Error('清单字段结构无效或包含未知字段。');}
export function parseManifest(text){
 if(typeof text!=='string'||encoder.encode(text).length>LIMITS.manifestBytes)throw Error('清单最多32KiB UTF-8。');let value;try{value=JSON.parse(text);}catch{throw Error('清单不是有效JSON。');}
 // Accept the exact generated representation only. This also rejects duplicate decoded keys.
 if(text!==manifestText(value))throw Error('仅接受本工具生成的规范清单，禁止手改、重复字段或非规范格式。');
 exactKeys(value,['feature','version','original','chunkSize','parts']);exactKeys(value.original,['name','size','sha256']);
 if(value.feature!=='T012'||value.version!==1)throw Error('清单功能或版本不支持。');name(value.original.name);
 if(!Number.isSafeInteger(value.original.size)||value.original.size<0||value.original.size>LIMITS.fileBytes||!hashPattern.test(value.original.sha256)||!Number.isSafeInteger(value.chunkSize)||value.chunkSize<LIMITS.chunkMin||value.chunkSize>LIMITS.chunkMax)throw Error('清单大小、分片大小或摘要无效。');
 const count=Math.max(1,Math.ceil(value.original.size/value.chunkSize));if(count>LIMITS.parts||!Array.isArray(value.parts)||value.parts.length!==count)throw Error('分片数量无效（最多99）。');
 value.parts.forEach((part,i)=>{exactKeys(part,['index','path','size','sha256']);if(part.index!==i+1||part.path!==`part-${String(i+1).padStart(4,'0')}.bin`||part.size!==Math.min(value.chunkSize,Math.max(0,value.original.size-i*value.chunkSize))||!hashPattern.test(part.sha256))throw Error('分片索引/名称/大小/摘要无效，禁止删除、调序或路径修改。');});return value;
}
async function readFile(file,hooks){checkAbort(hooks.signal);if(typeof file?.arrayBuffer!=='function')throw Error('宿主缺少File.arrayBuffer。');const raw=await file.arrayBuffer();checkAbort(hooks.signal);if(!(raw instanceof ArrayBuffer)||raw.byteLength!==file.size)throw Error('实际读取大小与File.size不一致。');return new Uint8Array(raw);}
async function checkpoint(hooks){checkAbort(hooks.signal);await(hooks.yieldControl||(()=>new Promise(resolve=>setTimeout(resolve,0))))();checkAbort(hooks.signal);}
export async function splitFile(file,chunkSize,hooks={}){
 name(file?.name);if(!Number.isSafeInteger(file?.size)||file.size<0||file.size>LIMITS.fileBytes)throw Error('单个源文件最多8MiB，含空文件。');if(!Number.isSafeInteger(chunkSize)||chunkSize<LIMITS.chunkMin||chunkSize>LIMITS.chunkMax||Math.max(1,Math.ceil(file.size/chunkSize))>LIMITS.parts)throw Error('分片大小须16KiB–2MiB，最多99片。');
 const data=await readFile(file,hooks),manifest={feature:'T012',version:1,original:{name:file.name,size:data.length,sha256:await sha256(data,hooks)},chunkSize,parts:[]},files=[];
 for(let at=0;at<data.length||(!data.length&&!files.length);at+=chunkSize){await checkpoint(hooks);const bytes=data.subarray(at,Math.min(at+chunkSize,data.length)),index=files.length+1,path=`part-${String(index).padStart(4,'0')}.bin`,hash=await sha256(bytes,hooks);manifest.parts.push({index,path,size:bytes.length,sha256:hash});files.push({path,base64:base64(bytes),sha256:hash});hooks.onProgress?.({done:index,total:Math.max(1,Math.ceil(data.length/chunkSize))});}
 const text=manifestText(manifest);parseManifest(text);const bytes=encoder.encode(text);files.push({path:'manifest.json',base64:base64(bytes),sha256:await sha256(bytes,hooks)});checkAbort(hooks.signal);return{manifest,payload:{copyOnly:true,defaultName:'文件分片副本',files}};
}
export async function joinFiles(manifest,files,hooks={}){
 const valid=parseManifest(manifestText(manifest));if(!Array.isArray(files)||files.length!==valid.parts.length)throw Error('分片文件数量不符，存在缺失或多余文件。');const found=new Map();for(const file of files){if(typeof file?.name!=='string'||found.has(file.name)||!valid.parts.some(p=>p.path===file.name)||!Number.isSafeInteger(file.size))throw Error('分片名称重复、未知或文件大小无效。');found.set(file.name,file);}
 const output=new Uint8Array(valid.original.size);let offset=0;
 for(const part of valid.parts){await checkpoint(hooks);const file=found.get(part.path);if(!file||file.size!==part.size)throw Error(`分片${part.index}缺失或大小不符；未发布重组结果。`);const bytes=await readFile(file,hooks);if(await sha256(bytes,hooks)!==part.sha256)throw Error(`分片${part.index}SHA-256不符；未发布重组结果。`);output.set(bytes,offset);offset+=bytes.length;hooks.onProgress?.({done:part.index,total:valid.parts.length});}
 const digest=await sha256(output,hooks);if(digest!==valid.original.sha256)throw Error('重组总SHA-256不符；未发布重组结果。');checkAbort(hooks.signal);return{manifest:valid,verified:true,payload:{copyOnly:true,defaultName:valid.original.name,base64:base64(output),sha256:digest}};
}
