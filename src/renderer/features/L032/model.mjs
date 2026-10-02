export const LIMITS=Object.freeze({bytes:1048576,characters:600000,rows:1000});
const decisionMap=new Map([['include','include'],['exclude','exclude'],['纳入','include'],['排除','exclude']]);
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)||/[\ud800-\udfff]/u.test(value.replace(/[\ud800-\udbff][\udc00-\udfff]/gu,'')))throw Error(label+'无效或超出长度上限。');return value.trim();}
export function parseReview(raw){
 if(typeof raw!=='string'||raw.length>LIMITS.characters||new TextEncoder().encode(raw).byteLength>LIMITS.bytes)throw Error('每份CSV最多1MiB及600000字符。');
 const s=raw.replace(/^\uFEFF/u,''),records=[];let at=0,line=1;
 while(at<s.length){const fields=[],startLine=line;let done=false;
  while(!done){let value='';
   if(s[at]==='"'){at++;let closed=false;while(at<s.length){const ch=s[at++];if(ch==='"'){if(s[at]==='"'){value+='"';at++;}else{closed=true;break;}}else{value+=ch;if(ch==='\r'){if(s[at]==='\n'){value+='\n';at++;}line++;}else if(ch==='\n')line++;}}if(!closed)throw Error(`CSV第${startLine}行引号未闭合。`);if(at<s.length&&!['\r','\n',','].includes(s[at]))throw Error(`CSV第${startLine}行引号后只能是分隔符或换行。`);
   }else{while(at<s.length&&!['\r','\n',','].includes(s[at])){if(s[at]==='"')throw Error(`CSV第${line}行未加引号字段含引号。`);value+=s[at++];}}
   fields.push(value);if(fields.length>3)throw Error(`CSV第${startLine}行必须有3列。`);
   if(s[at]===','){at++;continue;}if(s[at]==='\r'){at++;if(s[at]==='\n')at++;line++;}else if(s[at]==='\n'){at++;line++;}done=true;
  }
  if(fields.length===1&&!fields[0].trim())continue;records.push({fields,line:startLine});if(records.length>LIMITS.rows+1)throw Error('每位评审最多1000条。');
 }
 if(records.length<2||records[0].fields.map(v=>v.trim()).join(',')!=='id,title,decision')throw Error('CSV须有id,title,decision三列及至少一条记录，顺序固定。');
 const ids=new Set();return records.slice(1).map(r=>{if(r.fields.length!==3)throw Error(`CSV第${r.line}行必须有3列。`);const id=text(r.fields[0],80,'文献ID'),title=text(r.fields[1],500,'文献标题'),decision=decisionMap.get(r.fields[2].trim().toLowerCase());if(/[\r\n]/u.test(id)||ids.has(id))throw Error(`文献ID ${id}重复或含换行。`);ids.add(id);if(!decision)throw Error(`第${r.line}行判定须为include/exclude或纳入/排除。`);return{id,title,decision,line:r.line};});
}
export function compareReviews(rules,a,b){
 const ruleText=text(rules,4000,'纳排规则'),byA=new Map(a.map(row=>[row.id,row])),byB=new Map(b.map(row=>[row.id,row]));
 const missingA=b.filter(row=>!byA.has(row.id)).map(row=>row.id),missingB=a.filter(row=>!byB.has(row.id)).map(row=>row.id),titleMismatch=a.filter(row=>byB.has(row.id)&&byB.get(row.id).title!==row.title).map(row=>({id:row.id,titleA:row.title,titleB:byB.get(row.id).title}));
 const aligned=!missingA.length&&!missingB.length&&!titleMismatch.length;
 const base={feature:'L032',schemaVersion:1,rules:ruleText,reviewerA:a,reviewerB:b,alignment:{aligned,missingA,missingB,titleMismatch},statistics:null,conflicts:[],pairs:[]};if(!aligned)return base;
 const matrix=[[0,0],[0,0]],labels=['include','exclude'];let agree=0;
 const pairs=a.map(row=>{const other=byB.get(row.id),match=row.decision===other.decision;matrix[labels.indexOf(row.decision)][labels.indexOf(other.decision)]++;if(match)agree++;return{id:row.id,title:row.title,decisionA:row.decision,decisionB:other.decision,match,lineA:row.line,lineB:other.line};});
 const n=pairs.length,rowTotals=matrix.map(row=>row.reduce((x,y)=>x+y,0)),columnTotals=[matrix[0][0]+matrix[1][0],matrix[0][1]+matrix[1][1]],chanceNumerator=rowTotals[0]*columnTotals[0]+rowTotals[1]*columnTotals[1],denominator=n*n-chanceNumerator;
 return{...base,pairs,conflicts:pairs.filter(row=>!row.match),statistics:{n,agreements:agree,agreement:agree/n,labels,matrix,rowTotals,columnTotals,expectedAgreement:chanceNumerator/(n*n),kappa:denominator===0?null:(agree*n-chanceNumerator)/denominator,kappaReason:denominator===0?'两位评审全部使用同一标签，期望一致率为1，kappa分母为0，未定义。':'按各评审经验标签比例计算，未加权。'}};
}
export const exampleCSV='id,title,decision\r\nP1,本地文献一,include\r\nP2,本地文献二,include\r\nP3,本地文献三,exclude\r\nP4,本地文献四,exclude';
const escape=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/gu,ch=>'\\'+ch).replace(/\r\n|\r|\n/gu,'<br>');
export function reportMarkdown(r){const s=r.statistics;return['# 双人文献筛选校准','',`规则：${escape(r.rules)}`,'',s?`同配对${s.n}条，一致${s.agreements}条；一致率${s.agreement}；期望一致率${s.expectedAgreement}；Cohen kappa ${s.kappa===null?'未定义':s.kappa}。`:'条目未对齐，不计算部分样本的指标。','',s?.kappaReason||'',...r.pairs.map(p=>`${escape(p.id)} / ${escape(p.title)}：A=${p.decisionA}，B=${p.decisionB}，${p.match?'一致':'冲突'}`),'',`缺A：${r.alignment.missingA.map(escape).join('、')||'无'}`,`缺B：${r.alignment.missingB.map(escape).join('、')||'无'}`,...r.alignment.titleMismatch.map(p=>`${escape(p.id)}标题不同：A=${escape(p.titleA)}；B=${escape(p.titleB)}`)].join('\n');}
