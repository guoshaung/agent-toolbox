export const UNITS=Object.freeze({g:{title:'克',dimension:'mass',base:'kg',divisor:1000},kg:{title:'千克',dimension:'mass',base:'kg',divisor:1},ml:{title:'毫升',dimension:'volume',base:'L',divisor:1000},L:{title:'升',dimension:'volume',base:'L',divisor:1},item:{title:'件',dimension:'count',base:'件',divisor:1}});
export const CURRENCIES=Object.freeze(['CNY','USD','EUR','HKD']);
function decimal(value,places,label){
  if(typeof value!=='string'||value.length>32||!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(value.trim()))throw Error(label+'请输入非负十进制，最多'+places+'位小数且32字符。');
  const[whole,fraction='']=value.trim().split('.');return{numerator:BigInt(whole+fraction),denominator:10n**BigInt(fraction.length)};
}
function cents(value,label){
  const amount=decimal(value,2,label),result=amount.numerator*100n/amount.denominator;
  if(result>5000000000n)throw Error(label+'不能超过50,000,000。');return result;
}
export function formatFraction(numerator,denominator,places=4){
  if(typeof numerator!=='bigint'||typeof denominator!=='bigint'||numerator<0n||denominator<=0n||!Number.isInteger(places)||places<0||places>6)throw Error('无效的非负分数。');
  const scale=10n**BigInt(places),rounded=(numerator*scale*2n+denominator)/(denominator*2n),digits=rounded.toString().padStart(places+1,'0');
  return places?digits.slice(0,-places)+'.'+digits.slice(-places):digits;
}
function normalize(input,index){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('商品须为对象。');
  const name=typeof input.name==='string'?input.name.trim():'',group=typeof input.group==='string'?input.group.trim():'';
  if(!name||name.length>120)throw Error('商品名称须1–120字符。');
  if(!group||group.length>80)throw Error('请填写1–80字符的同类比较组。');
  if(!CURRENCIES.includes(input.currency))throw Error('请选择受支持的明确币种。');
  const unit=Object.hasOwn(UNITS,input.unit)?UNITS[input.unit]:null;if(!unit)throw Error('单位不受支持，不能推断换算。');
  const quantity=decimal(input.quantity,6,'每包装净含量');
  if(quantity.numerator<=0n||quantity.numerator>1000000000n*quantity.denominator)throw Error('净含量须大于0且不超过1,000,000,000。');
  const packages=Number(input.packages);
  if((typeof input.packages!=='number'&&(typeof input.packages!=='string'||!/^\d+$/u.test(input.packages)))||!Number.isInteger(packages)||packages<1||packages>10000)throw Error('包装数量须1–10000整数。');
  const goods=cents(input.price,'商品总价'),shipping=cents(input.shipping??'0','这笔采购的运费'),total=goods+shipping;
  const baseN=quantity.numerator*BigInt(packages),baseD=quantity.denominator*BigInt(unit.divisor);
  const priceN=total*baseD,priceD=100n*baseN;
  return {priceN,priceD,key:JSON.stringify([group,input.currency,unit.dimension]),view:{sourceRow:index+1,name,group,currency:input.currency,quantity:input.quantity,unit:input.unit,packages,goodsCents:Number(goods),shippingCents:Number(shipping),totalCents:Number(total),baseUnit:unit.base,dimension:unit.dimension,normalizedQuantity:formatFraction(baseN,baseD,6),quantityExact:{numerator:baseN.toString(),denominator:baseD.toString()},unitPrice:formatFraction(priceN,priceD,4),unitPriceExact:{numerator:priceN.toString(),denominator:priceD.toString()},comparable:false,rank:null,issue:'同组没有第二项同币种、同量纲商品，无法排名。'}};
}
export function comparePurchases(input){
  if(!Array.isArray(input)||!input.length||input.length>50)throw Error('请输入1–50项商品。');
  const rows=[],groups=new Map();
  for(const[at,item]of input.entries()){
    try{const row=normalize(item,at);rows.push(row.view);if(!groups.has(row.key))groups.set(row.key,[]);groups.get(row.key).push(row);}
    catch(error){rows.push({sourceRow:at+1,name:typeof item?.name==='string'?item.name.slice(0,120):'商品 '+(at+1),raw:item,comparable:false,rank:null,issue:error.message});}
  }
  const comparisons=[];
  const order=(a,b)=>{const left=a.priceN*b.priceD,right=b.priceN*a.priceD;return left<right?-1:left>right?1:0;};
  for(const group of groups.values()){
    group.sort((a,b)=>order(a,b)||a.view.sourceRow-b.view.sourceRow);
    if(group.length>=2){let rank=1;for(let at=0;at<group.length;at++){if(at>0&&order(group[at],group[at-1])!==0)rank=at+1;Object.assign(group[at].view,{rank,comparable:true,issue:''});}}
    comparisons.push({group:group[0].view.group,currency:group[0].view.currency,baseUnit:group[0].view.baseUnit,comparable:group.length>=2,sourceRows:group.map(row=>row.view.sourceRow)});
  }
  return {feature:'T087',schemaVersion:1,formula:'(goods price + shipping) / (quantity per package × package count × unit factor)',rounding:'显示单价四位小数，半入；排名使用BigInt分数交叉乘积，显示相同不代表精确单价相同。',grouping:'同类比较组 + 同币种 + 同量纲；不做汇率换算、密度转换或品质判断。',rows,comparisons,comparableCount:rows.filter(row=>row.comparable).length,uncomparableCount:rows.filter(row=>!row.comparable).length};
}
