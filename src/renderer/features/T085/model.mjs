export const LIMITS=Object.freeze({scenarios:6,devices:20,periods:6});
function decimal(value,places,max,label){
  if(typeof value!=='string'||value.length>24||!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(value))throw Error(label+'须非负十进制，最多'+places+'位小数。');
  const [whole,part='']=value.split('.'),number=BigInt(whole+part.padEnd(places,'0'));
  if(number>BigInt(max)*10n**BigInt(places))throw Error(label+'超过上限'+max+'。');return number;
}
function name(value,label){if(typeof value!=='string'||!value.trim()||value.length>80)throw Error(label+'须1–80字符。');return value.trim();}
export function displayRatio(numerator,denominator,places){
  const scale=10n**BigInt(places),n=(numerator*scale*2n+denominator)/(2n*denominator),s=n.toString().padStart(places+1,'0');return places?s.slice(0,-places)+'.'+s.slice(-places):s;
}
export const simpleExample=()=>[{name:'100W基础情景',days:30,currency:'CNY',periods:[{name:'全天',hours:'24',price:'1'}],devices:[{name:'100W设备',powerW:'100',standbyW:'0',activeHours:['5']}]}];
export const tariffExample=()=>[
  {name:'原设备',days:30,currency:'CNY',periods:[{name:'高价时段',hours:'8',price:'1.5'},{name:'低价时段',hours:'16',price:'0.5'}],devices:[{name:'设备',powerW:'100',standbyW:'5',activeHours:['5','0']}]},
  {name:'减少高价时段运行',days:30,currency:'CNY',periods:[{name:'高价时段',hours:'8',price:'1.5'},{name:'低价时段',hours:'16',price:'0.5'}],devices:[{name:'设备',powerW:'100',standbyW:'5',activeHours:['0','5']}]}
];
export function calculateScenarios(input){
  if(!Array.isArray(input)||input.length<1||input.length>LIMITS.scenarios)throw Error('情景数须1–6。');
  const seen=new Set();const scenarios=input.map((scenario,index)=>{
    const title=name(scenario?.name,'情景名称');if(seen.has(title))throw Error('情景名称须不同。');seen.add(title);
    if(!Number.isInteger(scenario.days)||scenario.days<1||scenario.days>3660)throw Error(title+'：天数须1–3660整数。');
    if(!['CNY','USD','EUR','HKD'].includes(scenario.currency))throw Error(title+'：须明确选择币种。');
    if(!Array.isArray(scenario.periods)||!scenario.periods.length||scenario.periods.length>6)throw Error(title+'：每天须1–6个电价时段。');
    let hours=0n;const periods=scenario.periods.map((p)=>{const title=name(p.name,'时段名'),h=decimal(p.hours,3,24,'时段长度'),price=decimal(p.price,4,1000,'每度电价');if(h===0n)throw Error('时段长度须大于0。');hours+=h;return{title,h,price};});
    if(hours!==24000n)throw Error(title+'：各时段长度须正好覆盖24小时；不自动补缺失时段或推断重叠。');
    if(!Array.isArray(scenario.devices)||!scenario.devices.length||scenario.devices.length>20)throw Error(title+'：设备数须1–20。');
    let energy=0n,cost=0n,activeEnergy=0n,standbyEnergy=0n;
    const devices=scenario.devices.map((device,at)=>{
      const title=name(device.name,'设备名'),power=decimal(device.powerW,3,1000000,'运行功率W'),standby=decimal(device.standbyW,3,1000000,'待机功率W');
      if(!Array.isArray(device.activeHours)||device.activeHours.length!==periods.length)throw Error('每个设备须为每个时段填写运行时长。');
      let e=0n,c=0n,ae=0n,se=0n;
      const entries=periods.map((period,i)=>{
        const ah=decimal(device.activeHours[i],3,24,'时段运行时长');if(ah>period.h)throw Error(title+'：运行时长超过所属时段长度。');
        const sh=period.h-ah,active=power*ah*BigInt(scenario.days),idle=standby*sh*BigInt(scenario.days),total=active+idle,charge=total*period.price;
        e+=total;c+=charge;ae+=active;se+=idle;
        return{period:period.title,periodHours:displayRatio(period.h,1000n,3),activeHoursPerDay:displayRatio(ah,1000n,3),standbyHoursPerDay:displayRatio(sh,1000n,3),pricePerKWh:displayRatio(period.price,10000n,4),activeKWh:displayRatio(active,1000000000n,6),standbyKWh:displayRatio(idle,1000000000n,6),totalKWh:displayRatio(total,1000000000n,6),cost:displayRatio(charge,10000000000000n,2),energyExact:{numerator:total.toString(),denominator:'1000000000'},costExact:{numerator:charge.toString(),denominator:'10000000000000'}};
      });
      energy+=e;cost+=c;activeEnergy+=ae;standbyEnergy+=se;
      return{sourceRow:at+1,name:title,powerW:device.powerW,standbyW:device.standbyW,entries,totalKWh:displayRatio(e,1000000000n,6),cost:displayRatio(c,10000000000000n,2),activeKWh:displayRatio(ae,1000000000n,6),standbyKWh:displayRatio(se,1000000000n,6)};
    });
    return{name:title,sourceRow:index+1,days:scenario.days,currency:scenario.currency,devices,totalKWh:displayRatio(energy,1000000000n,6),cost:displayRatio(cost,10000000000000n,2),activeKWh:displayRatio(activeEnergy,1000000000n,6),standbyKWh:displayRatio(standbyEnergy,1000000000n,6),energyExact:{numerator:energy.toString(),denominator:'1000000000'},costExact:{numerator:cost.toString(),denominator:'10000000000000'}};
  });
  const base=scenarios[0];
  const comparisons=scenarios.slice(1).map(s=>{
    if(s.currency!==base.currency||s.days!==base.days)return{name:s.name,baseline:base.name,comparable:false,reason:'币种或天数不同；保留总量，无法直接比较成本。'};
    const delta=BigInt(s.costExact.numerator)-BigInt(base.costExact.numerator),sign=delta<0n?'-':delta>0n?'+':'';
    return{name:s.name,baseline:base.name,comparable:true,costDelta:sign+displayRatio(delta<0n?-delta:delta,10000000000000n,2),costDeltaExact:{numerator:delta.toString(),denominator:'10000000000000'}};
  });
  return{feature:'T085',schemaVersion:1,inputs:JSON.parse(JSON.stringify(input)),assumptions:['所有功率、运行时间、电价为用户提供的输入；输出是固定功率假设下的估计，未测量真实耗电。','每天各时段依次划分完整24小时；每设备在时段内非运行时间均算待机。断电设备请填待机0W。','电量=功率W×小时×天数/1000；费用按所属时段电价加总。无阶梯、税费、固定服务费或实时电价。','只比较相同币种及相同天数情景相对第一个情景的成本。','显示电量六位小数、费用两位小数；总计先精确求和再半入，显示分项之和可能不同于总计。'],scenarios,comparisons};
}
