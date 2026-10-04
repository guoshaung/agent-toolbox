const DAY=86400000;
export const NAMES=Object.freeze(['周日','周一','周二','周三','周四','周五','周六']);
export function dateValue(value){
  const parts=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if(!parts)throw Error('日期必须是 YYYY-MM-DD。');
  const [year,month,day]=parts.slice(1).map(Number),epoch=Date.UTC(year,month-1,day),actual=new Date(epoch);
  if(year<1900||year>2100||actual.getUTCFullYear()!==year||actual.getUTCMonth()!==month-1||actual.getUTCDate()!==day)throw Error('日期无效或超出1900–2100年。');
  return epoch;
}
const stamp=epoch=>new Date(epoch).toISOString().slice(0,10);
function calendar({weekdays=[1,2,3,4,5],holidays=[]}={}){
  if(!Array.isArray(weekdays)||!weekdays.length||weekdays.some(day=>!Number.isInteger(day)||day<0||day>6))throw Error('请至少选择一个工作星期，值须为0–6。');
  if(!Array.isArray(holidays)||holidays.length>500)throw Error('假日最多500个明确日期。');
  const uniqueDates=[...new Set(holidays.map(date=>{dateValue(date);return date;}))].sort();
  const work=new Set(weekdays),off=new Set(uniqueDates);
  return {weekdays:[...work].sort(),holidays:uniqueDates,classify(epoch){
    const date=stamp(epoch),weekday=new Date(epoch).getUTCDay(),reasons=[];
    if(!work.has(weekday))reasons.push('非工作星期');
    if(off.has(date))reasons.push('自定义假日');
    return {date,weekday,weekdayName:NAMES[weekday],working:reasons.length===0,reasons};
  }};
}
export function parseHolidays(text){
  if(typeof text!=='string'||text.length>20000)throw Error('假日文本最多20000字符。');
  const rows=text.split(/\r\n|\n|\r/u).map(line=>line.trim()).filter(Boolean);
  for(const[at,row]of rows.entries()){try{dateValue(row);}catch(error){throw Error('假日第'+(at+1)+'项：'+error.message);}}
  if(rows.length>500)throw Error('假日最多500项。');return rows;
}
function summary(days,cal){
  return {feature:'T082',schemaVersion:1,calendar:{weekdays:cal.weekdays,holidays:cal.holidays,timeBasis:'UTC civil date; no local-time or legal holiday inference'},totalDays:days.length,workingDays:days.filter(day=>day.working).length,excludedDays:days.filter(day=>!day.working).length,nonWorkWeekdayDays:days.filter(day=>day.reasons.includes('非工作星期')).length,customHolidayDays:days.filter(day=>day.reasons.includes('自定义假日')).length,days};
}
export function countRange(start,end,options={}){
  const first=dateValue(start),last=dateValue(end),cal=calendar(options);
  if(first>last)throw Error('开始日期不能晚于结束日期。');
  if((last-first)/DAY+1>3660)throw Error('区间最多3660个自然日。');
  const includeStart=options.includeStart!==false,includeEnd=options.includeEnd!==false,days=[];
  for(let at=first;at<=last;at+=DAY){if((at===first&&!includeStart)||(at===last&&!includeEnd))continue;days.push(cal.classify(at));}
  return {...summary(days,cal),mode:'range',start,end,includeStart,includeEnd};
}
export function shiftWorkdays(start,amount,options={}){
  let at=dateValue(start);const cal=calendar(options);
  if(!Number.isInteger(amount)||Math.abs(amount)>1000)throw Error('推算时长必须是−1000至1000的整数工作日。');
  const days=[],direction=Math.sign(amount);let completed=0;
  while(completed<Math.abs(amount)){
    at+=direction*DAY;
    try{dateValue(stamp(at));}catch{throw Error('推算结果超出1900–2100年，请缩短时长。');}
    if(days.length>=12000)throw Error('推算超过12000个自然日，请缩短时长或核对日历。');
    const day=cal.classify(at);days.push(day);if(day.working)completed++;
  }
  return {...summary(days,cal),mode:'shift',start,amount,resultDate:stamp(at),startCounted:false,direction:direction===0?'none':direction>0?'forward':'backward'};
}
