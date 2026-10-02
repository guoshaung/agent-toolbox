export const LIMITS=Object.freeze({sourceBytes:1048576,sourceChars:500000,cards:50,quoteChars:10000,claimChars:2000});
function scalarString(value,label,max){
 if(typeof value!=='string'||value.length>max)throw Error(label+'超出文本上限。');
 for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw Error(label+'含未配对代理字符。');}else if(code>=0xdc00&&code<=0xdfff)throw Error(label+'含未配对代理字符。');}
 return value;
}
const boundary=(text,at)=>!(at>0&&at<text.length&&text.charCodeAt(at)>=0xdc00&&text.charCodeAt(at)<=0xdfff&&text.charCodeAt(at-1)>=0xd800&&text.charCodeAt(at-1)<=0xdbff);
export function normalizeForSelection(text){
 scalarString(text,'原文',LIMITS.sourceChars);const chars=[],offsets=[0];
 for(let i=0;i<text.length;){if(text[i]==='\r'){chars.push('\n');i+=text[i+1]==='\n'?2:1;}else chars.push(text[i++]);offsets.push(i);}
 return{display:chars.join(''),offsets};
}
export async function sourceInfo(name,text){
 scalarString(name,'来源名称',120);if(!name.trim())throw Error('请填写来源名称。');scalarString(text,'原文',LIMITS.sourceChars);
 const bytes=new TextEncoder().encode(text);if(bytes.byteLength>LIMITS.sourceBytes)throw Error('原文UTF-8最多1MiB。');
 if(!globalThis.crypto?.subtle)throw Error('当前环境缺少SHA-256能力，无法创建或核对绑定。');
 const digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 return{name:name.trim(),text,hash,sizeBytes:bytes.byteLength,utf16Length:text.length};
}
export async function bindClaim(name,text,id,start,end,claim){
 scalarString(claim,'论断',LIMITS.claimChars);if(!claim.trim())throw Error('请先填写自己的论断。');
 if(typeof id!=='string'||!/^C\d{1,9}$/u.test(id))throw Error('论断编号无效。');
 const normalized=normalizeForSelection(text);
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>normalized.display.length||!boundary(normalized.display,start)||!boundary(normalized.display,end))throw Error('请选择完整字符组成的非空原文范围。');
 const rawStart=normalized.offsets[start],rawEnd=normalized.offsets[end];if(rawEnd-rawStart>LIMITS.quoteChars)throw Error('单个引文最多10000个UTF-16单位。');
 const source=await sourceInfo(name,text);
 return{id,claim:claim.trim(),sourceName:source.name,sourceHash:source.hash,sourceByteLength:source.sizeBytes,sourceUTF16Length:source.utf16Length,rawStart,rawEnd,quote:text.slice(rawStart,rawEnd)};
}
export function validateCards(cards){
 if(!Array.isArray(cards)||cards.length>LIMITS.cards)throw Error('论断卡最多50张。');const ids=new Set();
 return cards.map(c=>{
  if(!c||typeof c.id!=='string'||!/^C\d{1,9}$/u.test(c.id)||ids.has(c.id))throw Error('论断编号无效或重复。');ids.add(c.id);
  scalarString(c.claim,'论断',LIMITS.claimChars);scalarString(c.sourceName,'来源名',120);scalarString(c.quote,'引文',LIMITS.quoteChars);
  if(!c.claim.trim()||!c.sourceName.trim()||!c.quote||typeof c.sourceHash!=='string'||!(/^[0-9a-f]{64}$/u.test(c.sourceHash))||!Number.isInteger(c.sourceByteLength)||c.sourceByteLength<0||c.sourceByteLength>LIMITS.sourceBytes||!Number.isInteger(c.sourceUTF16Length)||c.sourceUTF16Length<1||c.sourceUTF16Length>LIMITS.sourceChars||!Number.isInteger(c.rawStart)||!Number.isInteger(c.rawEnd)||c.rawStart<0||c.rawEnd<=c.rawStart||c.rawEnd>c.sourceUTF16Length||c.rawEnd-c.rawStart!==c.quote.length)throw Error('论断卡的引文、哈希或原始偏移不完整。');
  return{id:c.id,claim:c.claim,sourceName:c.sourceName,sourceHash:c.sourceHash,sourceByteLength:c.sourceByteLength,sourceUTF16Length:c.sourceUTF16Length,rawStart:c.rawStart,rawEnd:c.rawEnd,quote:c.quote};
 });
}
export async function inspectBindings(name,text,cards){
 const clean=validateCards(cards),currentSource=await sourceInfo(name,text);
 const checked=clean.map(card=>{
  const status=card.sourceHash!==currentSource.hash?'sourceMismatch':card.sourceByteLength!==currentSource.sizeBytes||card.sourceUTF16Length!==text.length||text.slice(card.rawStart,card.rawEnd)!==card.quote?'anchorMismatch':'bound';
  return{...card,status,reason:status==='sourceMismatch'?'源版本不一致：全文SHA-256不同；保留原始引文，不迁移偏移。':status==='anchorMismatch'?'哈希相同但引文或原始长度不一致，绑定校验失效。':card.sourceName===currentSource.name?'源哈希、原始偏移与引文一致。':'全文内容一致但来源名称不同，请核对是否同一材料。'};
 });
 return{feature:'L031',schemaVersion:1,offsetPolicy:'rawStart/rawEnd是原始文本UTF-16索引，左闭右开；界面CRLF/CR显示为LF，通过边界映射回原始偏移。UTF-8全文SHA-256保留原始换行及BOM。',currentSource,cards:checked,validCount:checked.filter(c=>c.status==='bound').length,invalidCount:checked.filter(c=>c.status!=='bound').length};
}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/gu,ch=>'\\'+ch).replace(/\r\n|\r|\n/gu,'<br>');
export function reportMarkdown(report){return['# 论断原文绑定','',`当前来源：${escape(report.currentSource.name)}`,`SHA-256：${report.currentSource.hash}`,`有效${report.validCount}，失效${report.invalidCount}。`,'',report.offsetPolicy,'',...report.cards.flatMap(c=>[`## ${c.id}`,'',escape(c.claim),'',`${c.status}：${escape(c.reason)}`,`原始来源：${escape(c.sourceName)}；SHA-256：${c.sourceHash}`,`原始UTF-16区间：[${c.rawStart},${c.rawEnd})`,'','原始引文：','',...c.quote.split(/\r\n|\r|\n/gu).map(line=>'    '+line),''])].join('\n');}
