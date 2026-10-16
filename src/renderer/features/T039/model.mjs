export const SVG_NS='http://www.w3.org/2000/svg';
export const LIMITS={files:8,fileBytes:262144,totalBytes:1048576,elements:2000,attributes:12000,depth:32,findings:15000,outputBytes:1048576};
const shapeTags=new Set(['g','path','rect','circle','ellipse','line','polyline','polygon']);
const numericAttrs=new Set(['x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','width','height','stroke-width','font-size','dx','dy']);
const colors=new Set(['none','black','white','red','green','blue','yellow','gray','grey','orange','purple','pink','transparent','currentColor']);
const NUMBER='[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const numRE=new RegExp('^'+NUMBER+'$');
const utf8=s=>new TextEncoder().encode(s).length;
export function finiteNumber(s,{positive=false,nonnegative=false,max=1000000}={}){if(typeof s!=='string'||!numRE.test(s)||!Number.isFinite(Number(s))||Math.abs(Number(s))>max||positive&&Number(s)<=0||nonnegative&&Number(s)<0)return null;return Number(s);}
export function attributeValue(name,value){
 if(typeof value!=='string'||value.length>4096||/[\u0000-\u001f\u007f]/u.test(value))return null;
 if(numericAttrs.has(name))return finiteNumber(value,{nonnegative:['r','rx','ry','width','height','stroke-width','font-size'].includes(name)})===null?null:value;
 if(['opacity','fill-opacity','stroke-opacity'].includes(name)){const n=finiteNumber(value,{nonnegative:true,max:1});return n===null?null:value;}
 if(['fill','stroke','color'].includes(name))return colors.has(value)||/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)?value:null;
 if(name==='fill-rule')return['nonzero','evenodd'].includes(value)?value:null;
 if(name==='stroke-linecap')return['butt','round','square'].includes(value)?value:null;
 if(name==='stroke-linejoin')return['miter','round','bevel'].includes(value)?value:null;
 if(name==='text-anchor')return['start','middle','end'].includes(value)?value:null;
 if(name==='d'||name==='points'){const token=new RegExp(name==='d'?'[MmZzLlHhVvCcSsQqTtAa]|'+NUMBER:NUMBER,'g');let end=0,count=0;for(const m of value.matchAll(token)){if(!/^[\s,]*$/.test(value.slice(end,m.index))||++count>1000)return null;if(m[0].length>1||!/[A-Za-z]/.test(m[0]))if(finiteNumber(m[0])===null)return null;end=m.index+m[0].length;}return count>0&&/^[\s,]*$/.test(value.slice(end))?value:null;}
 if(name==='transform'){let end=0,count=0;const rx=/(translate|scale|rotate|matrix|skewX|skewY)\(([^()]*)\)/g;for(const m of value.matchAll(rx)){if(!/^\s*$/.test(value.slice(end,m.index))||++count>16)return null;const raw=m[2].trim(),parts=raw.split(/[\s,]+/);const allowed={translate:[1,2],scale:[1,2],rotate:[1,3],matrix:[6],skewX:[1],skewY:[1]};if(!allowed[m[1]].includes(parts.length)||parts.some(n=>finiteNumber(n)===null))return null;end=m.index+m[0].length;}return count>0&&/^\s*$/.test(value.slice(end))?value:null;}
 return null;
}
export function viewport(root){const get=name=>root.hasAttribute(name)?root.getAttribute(name):null,width=get('width'),height=get('height'),viewBox=get('viewBox');const view={};if(width!==null||height!==null){const w=finiteNumber(width?.replace(/px$/,''),{positive:true,max:8192}),h=finiteNumber(height?.replace(/px$/,''),{positive:true,max:8192});if(w===null||h===null||w*h>16777216)throw Error('width/height须成对、正数/px且≤8192、面积≤16MP。');view.width=String(w);view.height=String(h);}if(viewBox!==null){const p=viewBox.trim().split(/[\s,]+/);if(p.length!==4||p.some(v=>finiteNumber(v)===null)||Number(p[2])<=0||Number(p[3])<=0)throw Error('viewBox须四个有限数且宽高为正。');view.viewBox=p.map(Number).join(' ');if(!view.width){view.width='800';view.height='600';view.previewSizing='仅viewBox来源的预览固定800×600；viewBox原样数值保留。';}}if(!view.width)throw Error('须有合法成对width/height或viewBox供有界预览。');return view;}
export function sanitizeSvg(text,{allowText=true,DOMParser:Parser=globalThis.DOMParser,XMLSerializer:Serializer=globalThis.XMLSerializer}={}){
 if(typeof text!=='string'||utf8(text)>LIMITS.fileBytes||/[\u0000\ud800-\udfff]/u.test(text)||typeof allowText!=='boolean')throw Error('SVG须有效Unicode且≤256KiB，文本规则须布尔。');
 if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)||/<\?(?!xml(?:\s|\?>))/i.test(text))throw Error('DTD/ENTITY与非XML声明处理指令不支持；未解析或预览。');
 if(typeof Parser!=='function'||typeof Serializer!=='function')throw Error('缺少生产XML解析器。');const doc=new Parser().parseFromString(text,'image/svg+xml');
 if(['http://www.mozilla.org/newlayout/xml/parsererror.xml','http://www.w3.org/1999/xhtml'].some(ns=>doc.getElementsByTagNameNS(ns,'parsererror').length)||doc.documentElement?.localName==='parsererror')throw Error('SVG不是合法XML。');const source=doc.documentElement;if(source?.localName!=='svg'||source.namespaceURI!==SVG_NS)throw Error('根元素须SVG命名空间中的svg。');
 const dimensions=viewport(source),out=doc.implementation.createDocument(SVG_NS,'svg',null),dest=out.documentElement;for(const name of['width','height','viewBox'])if(dimensions[name])dest.setAttribute(name,dimensions[name]);
 const findings=[];let elements=0,attributes=0,keptElements=1,findingBytes=0;
 const add=(kind,nodePath,detail)=>{const finding={kind,nodePath,detail};findingBytes+=utf8(JSON.stringify(finding))+2;if(findings.length>=15000||findingBytes>1048576)throw Error('风险/改动记录超过15000项或1MiB，整份拒绝。');findings.push(finding);};
 function walk(node,parent,nodePath,depth){if(depth>32||++elements>2000||node.nodeName.length>80||nodePath.length>1200)throw Error('SVG深度/元素数量/名称或定位路径超限，整份拒绝。');const name=node.localName,allowed=node===source||node.namespaceURI===SVG_NS&&(shapeTags.has(name)||allowText&&['text','tspan','title','desc'].includes(name));
  let copy=node===source?dest:null;if(!allowed){add(name==='script'?'script':name==='image'?'image_removed':node.namespaceURI!==SVG_NS?'foreign_namespace':'unsupported_element',nodePath,`移除${node.nodeName}及其子树；限定静态规则不保留该元素。`);}else if(node!==source){copy=out.createElementNS(SVG_NS,name);parent?.appendChild(copy);if(parent)keptElements++;}
  for(const attr of Array.from(node.attributes)){if(++attributes>12000||attr.name.length>80)throw Error('SVG属性数量/名称超限，整份拒绝。');const key=attr.localName,value=attr.value;
   if(/^on/i.test(key)){add('event_attribute',nodePath,attr.name);continue;}if(['href','src'].includes(key)){add('reference_removed',nodePath,`移除引用属性${attr.name}；原值长度${value.length}，不请求目标。`);continue;}if(key==='style'||name==='style'){add('css_removed',nodePath,attr.name);continue;}
   if(attr.namespaceURI==='http://www.w3.org/2000/xmlns/'){if(node===source&&attr.name==='xmlns'&&value===SVG_NS)continue;add('namespace_declaration_removed',nodePath,attr.name);continue;}
   if(node===source&&['width','height','viewBox'].includes(key)&&!attr.namespaceURI)continue;
   const safe=!attr.namespaceURI?attributeValue(key,value):null;if(safe!==null&&allowed&&copy&&parent!==null){copy.setAttribute(key,safe);}else add('attribute_removed',nodePath,attr.name);
  }
  for(const[childIndex,child]of Array.from(node.childNodes).entries()){if(child.nodeType===1)walk(child,allowed&&parent!==null?copy:null,`${nodePath}/${child.nodeName}[${childIndex+1}]`,depth+1);else if(child.nodeType===3||child.nodeType===4){if(allowed&&parent!==null&&copy&&['text','tspan','title','desc'].includes(name))copy.appendChild(out.createTextNode(child.nodeValue));else if(child.nodeValue.trim())add('text_removed',nodePath,'仅允许text/tspan/title/desc的文本；其他非空文本已移除。');}else if(child.nodeType!==8)add('node_removed',nodePath,'不支持的非元素节点已移除。');}
 }
 walk(source,dest,'/svg',0);const sanitized=new Serializer().serializeToString(out);if(utf8(sanitized)>LIMITS.outputBytes)throw Error('净化输出超过1MiB，整份拒绝。');return{sanitized,report:{feature:'T039',schemaVersion:1,policy:'static-geometry-no-references-v1',allowText,sourceUtf8Bytes:utf8(text),outputUtf8Bytes:utf8(sanitized),elementsInspected:elements,attributesInspected:attributes,keptElements,dimensions,findings,scope:'限定规则的静态副本；未保留样式/图片/外链/use/渐变/滤镜/动画，视觉可能变化。不声称所有SVG安全或绘制语义不变；源文档从未装入可见DOM。'}};
}
