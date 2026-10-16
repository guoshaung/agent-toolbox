export const LIMITS = Object.freeze({ records: 10000, bytes: 2 * 1024 * 1024, label: 200 });
export function parseRecords(source) {
  if(typeof source!=='string'||new TextEncoder().encode(source).byteLength>LIMITS.bytes)throw Error('JSON 输入最多 2 MiB。');
  let parsed;
  try{parsed=JSON.parse(source.replace(/^\uFEFF/u,''));}catch(error){throw Error('JSON 无法解析：'+error.message);}
  return Array.isArray(parsed)?parsed:parsed?.records;
}
export function calibrate(input,{binCount=5,threshold=0.8}={}) {
  if(!Array.isArray(input)||input.length<1||input.length>LIMITS.records)throw Error('请输入 1–10000 条记录的 JSON 数组。');
  if(!Number.isInteger(binCount)||binCount<2||binCount>10)throw Error('等宽分箱数必须是 2–10 的整数。');
  if(typeof threshold!=='number'||!Number.isFinite(threshold)||threshold<0.5||threshold>1)throw Error('高信心阈值必须在 0.5–1。');
  const records=input.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw Error('第 '+(index+1)+' 条不是记录对象。');
    const probability=item.probability,outcome=item.outcome;
    if(typeof probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1)throw Error('第 '+(index+1)+' 条 probability 必须是 0–1 的有限数字。');
    if(outcome!==0&&outcome!==1)throw Error('第 '+(index+1)+' 条 outcome 必须为数字 0（错误）或 1（正确）。');
    if(item.label!==undefined&&(typeof item.label!=='string'||item.label.length>LIMITS.label))throw Error('第 '+(index+1)+' 条 label 须为不超过 200 字符的字符串。');
    const difference=probability-outcome;
    return {sourceRow:index+1,label:item.label??'任务 '+(index+1),probability,outcome,squaredError:difference*difference};
  });
  const buckets=Array.from({length:binCount},(_,index)=>({index,lower:index/binCount,upper:(index+1)/binCount,upperInclusive:index===binCount-1,count:0,probabilitySum:0,outcomeSum:0}));
  let loss=0,probabilitySum=0,outcomeSum=0;
  for(const record of records){
    const bin=buckets.find(bucket=>record.probability<bucket.upper||bucket.upperInclusive);
    bin.count++;bin.probabilitySum+=record.probability;bin.outcomeSum+=record.outcome;
    record.bin=bin.index;loss+=record.squaredError;probabilitySum+=record.probability;outcomeSum+=record.outcome;
  }
  const bins=buckets.map(bucket=>{
    const meanProbability=bucket.count?bucket.probabilitySum/bucket.count:null,actualRate=bucket.count?bucket.outcomeSum/bucket.count:null;
    return {index:bucket.index,lower:bucket.lower,upper:bucket.upper,upperInclusive:bucket.upperInclusive,count:bucket.count,meanProbability,actualRate,gap:bucket.count?meanProbability-actualRate:null};
  });
  const eligible=records.length>=5;
  return {feature:'L051',schemaVersion:1,definition:'binary mean((probability - outcome)^2), range [0,1]',recordCount:records.length,brier:loss/records.length,meanProbability:probabilitySum/records.length,actualRate:outcomeSum/records.length,binCount,threshold,chartEligible:eligible,bins:eligible?bins:[],records,highConfidenceErrors:records.filter(record=>record.probability>=threshold&&record.outcome===0),lowConfidenceSuccesses:records.filter(record=>record.probability<=1-threshold&&record.outcome===1)};
}
