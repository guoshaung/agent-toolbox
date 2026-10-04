export const CATEGORIES=Object.freeze([
 {id:'data',name:'数据',hint:'数据版本、获取方式、样本范围、划分规则与许可说明'},
 {id:'code',name:'代码',hint:'源码版本、运行入口、依赖脚本及所需修改'},
 {id:'parameters',name:'参数',hint:'超参数、随机种子、预处理和停止条件'},
 {id:'environment',name:'环境',hint:'操作系统、运行时、依赖版本与硬件需求'},
 {id:'evaluation',name:'评估证据',hint:'指标定义、评估集、基线与原文结果出处'}
]);
export const blank=()=>({feature:'L033',schemaVersion:1,title:'复现实验材料',items:Object.fromEntries(CATEGORIES.map(c=>[c.id,{evidence:'',source:'',confirmed:false}]))});
export const example=()=>{const input=blank();input.title='文本分类实验准备';Object.assign(input.items.data,{evidence:'公开数据集v1，训练/验证/测试划分及许可说明已取得。',source:'材料目录/data-readme.md',confirmed:true});Object.assign(input.items.code,{evidence:'源码提交abc123与运行入口train.py已取得。',source:'材料目录/code-notes.txt',confirmed:true});Object.assign(input.items.evaluation,{evidence:'论文表2测试集准确率及统一评估脚本定义已记录。',source:'方法说明.md：表2',confirmed:true});return input;};
export function validateProject(value){
 if(!value||value.feature!=='L033'||value.schemaVersion!==1)throw Error('仅支持L033 schemaVersion=1。');
 if(typeof value.title!=='string'||!value.title.trim()||value.title.length>120)throw Error('项目名称须1–120字符。');
 if(!value.items||typeof value.items!=='object'||Array.isArray(value.items))throw Error('材料分类须为对象。');
 const extra=Object.keys(value.items).filter(id=>!CATEGORIES.some(c=>c.id===id));if(extra.length)throw Error('出现未知材料分类，未忽略。');
 const items=Object.fromEntries(CATEGORIES.map(({id,name})=>{
  const item=value.items[id];if(!item||typeof item.evidence!=='string'||item.evidence.length>4000||typeof item.source!=='string'||item.source.length>400||typeof item.confirmed!=='boolean')throw Error(name+'材料须包含证据文本≤4000字符、来源≤400字符与布尔确认状态。');
  return[id,{evidence:item.evidence,source:item.source,confirmed:item.confirmed}];
 }));
 return{feature:'L033',schemaVersion:1,title:value.title.trim(),items};
}
export function inspectMaterials(value){
 const input=validateProject(value),categories=CATEGORIES.map(c=>{
  const item=input.items[c.id],hasEvidence=!!item.evidence.trim();
  const status=!hasEvidence?'missing':item.confirmed?'ready':'pending';
  return{...c,...item,status,reason:status==='missing'?'没有证据文本；来源或确认勾选不能替代材料。':status==='pending'?'已录入候选材料，尚未经使用者确认取得。':'使用者确认已有相应材料；工具没有验证文件或执行实验。'};
 });
 const missing=categories.filter(c=>c.status==='missing').map(c=>c.id),pending=categories.filter(c=>c.status==='pending').map(c=>c.id),ready=categories.filter(c=>c.status==='ready').length;
 return{feature:'L033',schemaVersion:1,input,categories,missing,pending,ready,total:5,completion:ready/5,scope:'仅检查五类材料记录与人工确认；来源是引用文本，未读取或验证文件/网址，未执行实验，不保证复现成功。'};
}
export function storedProject(value){const clean=validateProject(value);if(new TextEncoder().encode(JSON.stringify(clean)).byteLength>65536)throw Error('项目超过64KiB UTF-8保存上限。');return clean;}
const escape=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','\\|').replace(/\r\n|\r|\n/gu,'<br>');
export function reportMarkdown(report){return['# 复现实验材料清单','',escape(report.input.title),'',`已确认材料：${report.ready}/5（${report.completion*100}%）；缺失${report.missing.length}类；待确认${report.pending.length}类。`,'',report.scope,'','| 分类 | 状态 | 材料证据 | 来源引用 |','|---|---|---|---|',...report.categories.map(c=>`| ${c.name} | ${{ready:'已确认',missing:'缺失',pending:'待确认'}[c.status]} | ${escape(c.evidence)||'未填写'} | ${escape(c.source)||'未填写'} |`),''].join('\n');}
