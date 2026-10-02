const text=(v,label,max=80)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(label+'须1–'+max+'字符。');return v.trim();};
export function grams(value,unit,label){
 if(typeof value!=='string'||value.length>20||!(unit==='g'?/^\d+$/u:/^\d+(?:\.\d{1,3})?$/u).test(value))throw Error(label+'请填整数克或最多3位小数的千克。');
 const[whole,part='']=value.split('.');const n=unit==='g'?Number(whole):Number(whole)*1000+Number(part.padEnd(3,'0'));
 if(!['g','kg'].includes(unit)||!Number.isSafeInteger(n)||n<0||n>100000000)throw Error(label+'须0–100,000,000克，单位仅g/kg。');return n;
}
function count(v,label,zero=false){if(typeof v!=='number'&&(typeof v!=='string'||!/^\d+$/u.test(v)))throw Error(label+'须整数。');const n=Number(v);if(!Number.isInteger(n)||n<(zero?0:1)||n>10000)throw Error(label+'须'+(zero?'0':'1')+'–10000整数。');return n;}
export const example=()=>({bags:[{id:'B1',name:'随身包',limit:'7',limitUnit:'kg',tare:'0',tareUnit:'g'}],items:[{id:'I1',name:'主物品',weight:'6',unit:'kg',quantity:'1',allocations:{B1:'1'}},{id:'I2',name:'可移走物品',weight:'2',unit:'kg',quantity:'1',allocations:{B1:'1'}}]});
export function calculateLuggage(input){
 if(!input||!Array.isArray(input.bags)||input.bags.length<1||input.bags.length>10||!Array.isArray(input.items)||input.items.length>100)throw Error('须1–10个包、0–100种物品。');
 const ids=new Set(),bags=input.bags.map((b,at)=>{
  const id=text(b?.id,'包标识',40);if(ids.has(id))throw Error('包标识重复。');ids.add(id);
  const limit=grams(b.limit,b.limitUnit,'包限重'),tare=grams(b.tare,b.tareUnit,'空包自重');if(limit===0)throw Error('包限重须大于0。');
  return{id,name:text(b.name,'包名称'),sourceRow:at+1,limitGrams:limit,tareGrams:tare,itemGrams:0,totalGrams:tare,contents:[]};
 });
 const byId=new Map(bags.map(b=>[b.id,b])),itemIds=new Set();let unassignedGrams=0;
 const items=input.items.map((i,at)=>{
  const id=text(i?.id,'物品标识',40);if(itemIds.has(id))throw Error('物品标识重复。');itemIds.add(id);
  const name=text(i.name,'物品名称'),weight=grams(i.weight,i.unit,'单件重量'),quantity=count(i.quantity,'物品数量');if(!weight)throw Error('物品单件重量须大于0。');
  if(!i.allocations||typeof i.allocations!=='object'||Array.isArray(i.allocations)||Object.keys(i.allocations).length>10)throw Error('分包分配须为包标识到整数数量的对象。');
  let assigned=0;const allocations=[];
  for(const[bagId,value]of Object.entries(i.allocations)){
   if(!byId.has(bagId))throw Error(name+'分配到不存在的包。');const n=count(value,'分配数量',true);assigned+=n;
   if(n){const bag=byId.get(bagId),g=weight*n;bag.itemGrams+=g;bag.totalGrams+=g;bag.contents.push({itemId:id,name,count:n,unitGrams:weight,totalGrams:g});allocations.push({bagId,count:n,weightGrams:g});}
  }
  if(assigned>quantity)throw Error(name+'分配数量超过所拥有数量。');
  const unassigned=quantity-assigned;unassignedGrams+=unassigned*weight;
  return{id,name,sourceRow:at+1,unitGrams:weight,quantity,assigned,unassigned,unassignedGrams:unassigned*weight,allocations};
 });
 for(const bag of bags){bag.overGrams=Math.max(0,bag.totalGrams-bag.limitGrams);bag.remainingGrams=Math.max(0,bag.limitGrams-bag.totalGrams);bag.status=bag.overGrams?'overweight':'within';}
 return{feature:'T088',schemaVersion:1,inputs:JSON.parse(JSON.stringify(input)),rules:['所有重量均为整数克，千克最多3位小数；空包自重计入总重。','数量分配为手动草案；未分配物品不会算入任何包，单独保留。','限重由使用者填写，未获取航空公司规定；重量合格不能证明尺寸、件数或其他规则合格。'],bags,items,unassignedGrams,overweightBags:bags.filter(b=>b.overGrams>0).length,complete:unassignedGrams===0&&bags.every(b=>b.overGrams===0)};
}
