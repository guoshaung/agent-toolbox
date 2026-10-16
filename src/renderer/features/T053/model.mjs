export const LIMITS = Object.freeze({inputBytes:65536,depth:8,nodes:200,outputBytes:2097152});
export class SchemaError extends Error { constructor(code) { super('输入语法、规则或容量不支持；源内容和解析上下文未回显。'); this.name = 'SchemaError'; this.code = code; } }
const fail = code => { throw new SchemaError(code); }; const encoder = new TextEncoder();
function unicode(text) { for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const n = text.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail('invalid_unicode'); } else if (c >= 0xdc00 && c <= 0xdfff) fail('invalid_unicode'); } }
export function checkText(text) { if (typeof text !== 'string' || text.length > LIMITS.inputBytes || encoder.encode(text).length > LIMITS.inputBytes) fail('input_limit'); unicode(text); if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || /\r(?!\n)/.test(text)) fail('invalid_control'); return text; }
export function parseStrictJSON(text) {
  checkText(text); let at = 0; let nodes = 0; const ws = () => { while (/[\x20\t\r\n]/.test(text[at] || '\0')) at++; };
  function string() { const start = at++; while (at < text.length) { const c = text[at++]; if (c === '"') { try { const value = JSON.parse(text.slice(start, at)); unicode(value); return value; } catch (error) { if (error instanceof SchemaError) throw error; fail('json_syntax'); } } if (c === '\\') at++; else if (c.charCodeAt(0) < 32) fail('json_syntax'); } fail('json_syntax'); }
  function value(depth = 0) { if (depth > LIMITS.depth || ++nodes > LIMITS.nodes) fail('structure_limit'); ws(); const c = text[at]; if (c === '"') return string(); if (c === '{') { at++; const out = Object.create(null); ws(); if (text[at] === '}') { at++; return out; } while (true) { ws(); if (text[at] !== '"') fail('json_syntax'); const key = string(); if (Object.hasOwn(out, key)) fail('json_duplicate_key'); ws(); if (text[at++] !== ':') fail('json_syntax'); out[key] = value(depth + 1); ws(); const next = text[at++]; if (next === '}') return out; if (next !== ',') fail('json_syntax'); } } if (c === '[') { at++; const out = []; ws(); if (text[at] === ']') { at++; return out; } while (true) { out.push(value(depth + 1)); ws(); const next = text[at++]; if (next === ']') return out; if (next !== ',') fail('json_syntax'); } } for (const [token, result] of [['true', true], ['false', false], ['null', null]]) if (text.slice(at, at + token.length) === token) { at += token.length; return result; } const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at)); if (!match) fail('json_syntax'); at += match[0].length; const n = Number(match[0]); if (!Number.isFinite(n)) fail('nonfinite_number'); if(Number.isInteger(n)&&!Number.isSafeInteger(n))fail('unsafe_integer_number'); return n; }
  const out = value(); ws(); if (at !== text.length) fail('json_syntax'); return out;
}
export const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
export const EXAMPLE = JSON.stringify({$schema:DRAFT,title:'User',type:'object',properties:{name:{type:'string'},tags:{type:'array',items:{type:'string'}}},required:['name']},null,2);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ptr = key => key.replace(/~/g,'~0').replace(/\//g,'~1');
const quote = text => JSON.stringify(text).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const TYPES = ['string','number','integer','boolean','null','object','array'];
const ANNOTATIONS = ['title','description','$comment'];
const STRUCTURAL_UNSUPPORTED = new Set(['allOf','anyOf','oneOf','not','if','then','else','prefixItems','contains','additionalProperties','patternProperties','propertyNames','dependentSchemas','dependentRequired','unevaluatedProperties','unevaluatedItems','$id','$anchor','$dynamicRef','$dynamicAnchor','$vocabulary','definitions','const']);
function issue(path,code,severity='warning') { return {path,code,severity}; }
function withIssues(issues) { const error = new SchemaError('schema_not_supported'); error.issues=issues; throw error; }
export function project(text) {
  const root=parseStrictJSON(text);const issues=[];const records=[];const refs=[];
  if (!(object(root)||typeof root==='boolean')) withIssues([issue('#','schema_object_or_boolean','error')]);
  if (object(root)&&('openapi' in root||'swagger' in root)) withIssues([issue('#','openapi_not_supported','error')]);
  const definitions=object(root)&&root.$defs!==undefined?root.$defs:Object.create(null);if(!object(definitions))withIssues([issue('#/$defs','defs_object_required','error')]);
  const names=Object.keys(definitions).sort();const aliases=new Map(names.map((name,i)=>[name,'Def'+(i+1)]));
  const rootName=object(root)&&typeof root.title==='string'&&/^[A-Z][A-Za-z0-9_]{0,63}$/.test(root.title)&&!/^Def\d+$/.test(root.title)&&root.title!=='Array'?root.title:'Root';
  if(object(root)&&root.title!==undefined&&rootName==='Root'&&root.title!=='Root')issues.push(issue('#/title','unsafe_title_fallback_Root'));
  if(!object(root)||root.$schema===undefined)issues.push(issue('#/$schema','draft_assumed_2020_12','info'));
  function error(path,code){issues.push(issue(path,code,'error'));}
  function schema(node,path,owner='Root') {
    if(typeof node==='boolean'){records.push({path,projection:node?'unknown':'never',sourceType:'boolean-schema',required:[],enum:null,ref:null});return node?'unknown':'never';}
    if(!object(node)){error(path,'schema_object_or_boolean');return 'unknown';}
    const supported=['type','properties','required','items','enum','$defs','$ref','$schema',...ANNOTATIONS];
    for(const key of Object.keys(node)) { const at=path+'/'+ptr(key);if(!supported.includes(key))issues.push(issue(at,STRUCTURAL_UNSUPPORTED.has(key)?'structural_keyword_unsupported':'constraint_or_unknown_keyword_omitted',STRUCTURAL_UNSUPPORTED.has(key)?'error':'warning'));
      if(ANNOTATIONS.includes(key)&&typeof node[key]!=='string')error(at,'annotation_string_required'); }
    if(node.$schema!==undefined&&(path!=='#'||node.$schema!==DRAFT))error(path+'/$schema','draft_not_supported');
    if(node.$defs!==undefined&&path!=='#')error(path+'/$defs','nested_defs_not_supported');
    let types=node.type===undefined?[]:typeof node.type==='string'?[node.type]:Array.isArray(node.type)?node.type:[];
    if(node.type!==undefined&&(!types.length||types.some(t=>!TYPES.includes(t))||new Set(types).size!==types.length))error(path+'/type','type_invalid');
    if(types.includes('integer'))issues.push(issue(path+'/type','integer_projects_to_number_no_runtime_check'));
    const properties=node.properties===undefined?Object.create(null):node.properties;const required=node.required===undefined?[]:node.required;
    if(!object(properties))error(path+'/properties','properties_object_required');
    if(!Array.isArray(required)||required.some(k=>typeof k!=='string')||new Set(required).size!==required.length)error(path+'/required','required_unique_strings');
    const requiredList=Array.isArray(required)?required.filter(k=>typeof k==='string'):[];
    if(node.properties!==undefined||node.required!==undefined){if(!types.includes('object'))error(path,'object_keywords_need_explicit_object_type');if(object(properties))for(const key of requiredList)if(!Object.hasOwn(properties,key))error(path+'/required','required_property_not_declared');}
    if(node.items!==undefined&&!types.includes('array'))error(path+'/items','items_need_explicit_array_type');
    if(types.includes('array')&&node.items===undefined)error(path+'/items','array_items_required');
    let enumValues=null;
    if(node.enum!==undefined){if(!Array.isArray(node.enum)||!node.enum.length||node.enum.some(v=>v!==null&&typeof v!=='string'&&typeof v!=='number'&&typeof v!=='boolean')||new Set(node.enum.map(v=>JSON.stringify(v))).size!==node.enum.length)error(path+'/enum','enum_unique_primitive_literals_required');else enumValues=node.enum;}
    if(enumValues&&types.length){const matches=(v,t)=>t==='null'?v===null:t==='integer'?typeof v==='number'&&Number.isInteger(v):t==='number'?typeof v==='number':t==='string'?typeof v==='string':t==='boolean'?typeof v==='boolean':false;if(enumValues.some(v=>!types.some(t=>matches(v,t))))error(path+'/enum','enum_type_conflict');}
    let refAlias=null;
    if(node.$ref!==undefined){const ref=node.$ref;const match=typeof ref==='string'?/^#\/\$defs\/([^/]+)$/.exec(ref):null;let key=null;if(match&&!ref.includes('%')&&!/~(?![01])/.test(match[1]))key=match[1].replace(/~1/g,'/').replace(/~0/g,'~');if(key===null||!aliases.has(key))error(path+'/$ref','local_defs_ref_required_and_must_exist');else{refAlias=aliases.get(key);refs.push({owner,target:refAlias,path:path+'/$ref'});}if(['type','properties','required','items','enum'].some(k=>Object.hasOwn(node,k)))error(path+'/$ref','ref_structural_siblings_not_supported');}
    const propTypes=object(properties)?Object.keys(properties).sort().map(key=>[key,schema(properties[key],path+'/properties/'+ptr(key),owner)]):[];
    const itemType=node.items!==undefined?schema(node.items,path+'/items',owner):'unknown';
    let expression;
    if(refAlias)expression=refAlias;
    else if(enumValues)expression=enumValues.map(v=>quote(v)).join(' | ');
    else if(!types.length)expression='unknown';
    else expression=[...new Set(types.map(t=>t==='integer'?'number':t==='object'?(propTypes.length?'{\n'+propTypes.map(([key,type])=>'  '+quote(key)+(requiredList.includes(key)?'':'?')+': '+type.replace(/\n/g,'\n  ')+';').join('\n')+'\n}':'{ [key: string]: unknown }'):t==='array'?'Array<'+itemType+'>':t))].join(' | ');
    records.push({path,projection:expression,sourceType:types.length?types:[],required:[...requiredList],enum:enumValues,ref:refAlias});return expression;
  }
  const definitionsTS=[];for(const name of names)definitionsTS.push('export type '+aliases.get(name)+' = '+schema(definitions[name],'#/$defs/'+ptr(name),aliases.get(name))+';');
  const expression=schema(root,'#');
  const graph=new Map();for(const ref of refs){const list=graph.get(ref.owner)||[];list.push(ref);graph.set(ref.owner,list);}const visiting=new Set();const done=new Set();function visit(name,via='#/$defs'){if(done.has(name))return;if(visiting.has(name)){error(via,'ref_cycle_not_supported');return;}visiting.add(name);for(const edge of graph.get(name)||[])visit(edge.target,edge.path);visiting.delete(name);done.add(name);}for(const name of aliases.values())visit(name);
  if(issues.some(i=>i.severity==='error'))withIssues(issues);
  const declaration='// T053 finite JSON Schema 2020-12 projection. Static types only.\n// No runtime validator; omitted constraints are listed in generation-manifest.json.\n\n'+definitionsTS.concat('export type '+rootName+' = '+expression+';').join('\n\n')+'\n';
  const mapping={format:'T053-validation-mapping',version:1,draft:DRAFT,runtimeValidation:false,scope:'Informational static mapping; type/required/items/primitive enum/local refs only. No validator execution or full Schema conformance.',records:records.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),definitions:names.map(name=>({path:'#/$defs/'+ptr(name),alias:aliases.get(name)}))};
  return {declaration,mapping,issues,rootName,draftDeclared:object(root)&&root.$schema!==undefined};
}
export async function sha256(bytes,options={}){const subtle=options.subtle||globalThis.crypto?.subtle;if(!subtle)fail('crypto_missing');const digest=await subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');}
function base64(bytes){let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s);}
export async function generate(text,options={}) {
  const stopped=()=>{if(options.isCanceled?.())fail('canceled');};const yieldTask=options.yieldTask||(()=>new Promise(r=>setTimeout(r,0)));stopped();const projection=project(text);await yieldTask();stopped();
  const files=[];async function add(path,content){const bytes=encoder.encode(content);if(bytes.length+files.reduce((n,f)=>n+f.bytes,0)>LIMITS.outputBytes)fail('output_limit');const hash=await sha256(bytes,options);stopped();files.push({path,content,bytes:bytes.length,sha256:hash,base64:base64(bytes)});}
  await add('types.d.ts',projection.declaration);await add('validation-mapping.json',JSON.stringify(projection.mapping,null,2)+'\n');
  const manifest={format:'T053-generation-manifest',version:1,draft:DRAFT,draftDeclared:projection.draftDeclared,rootType:projection.rootName,sourceSha256:await sha256(encoder.encode(text),options),runtimeValidation:false,projectionScope:'Finite static projection, not a full JSON Schema validator. Unknown constraints are omitted and reported; structural unsupported schemas and ref cycles block all output.',issues:projection.issues,files:files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256})),manifestSelfHash:'Not embedded: prevents circular self-hash. Transport verifies all three files including this manifest.'};stopped();await add('generation-manifest.json',JSON.stringify(manifest,null,2)+'\n');
  const totalBytes=files.reduce((sum,f)=>sum+f.bytes,0);if(totalBytes>LIMITS.outputBytes)fail('output_limit');return {files,totalBytes,issues:projection.issues,rootName:projection.rootName};
}
export function bundlePayload(result){if(!result||!Array.isArray(result.files)||result.files.length!==3||result.files.map(f=>f.path).join('|')!=='types.d.ts|validation-mapping.json|generation-manifest.json'||result.totalBytes>LIMITS.outputBytes)fail('preview_required');return{copyOnly:true,defaultName:'T053-interface-types-copy',files:result.files.map(({path,base64,sha256})=>({path,base64,sha256}))};}
