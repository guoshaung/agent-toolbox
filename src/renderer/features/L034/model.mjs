export const MODEL_VERSION='L034-linear-single-series-v1';
const bytes=text=>new TextEncoder().encode(text).length;
const clone=value=>JSON.parse(JSON.stringify(value));
export const formatNumber=value=>String(Number(value.toPrecision(8)));
export function example(kind='default') {
  if(kind==='negative')return{csv:'label,value\n负基期,-100\n负本期,-90',min:'-115',max:'-80',chartType:'bar',unit:'数值（单位未指定）',from:'0',to:'1'};
  if(kind==='zero')return{csv:'label,value\n零基期,0\n本期,10',min:'0',max:'15',chartType:'bar',unit:'数值（单位未指定）',from:'0',to:'1'};
  return{csv:'label,value\n基期,100\n本期,110',min:'95',max:'115',chartType:'bar',unit:'数值（单位未指定）',from:'0',to:'1'};
}
export function numeric(text,label) {
  if(typeof text!=='string'||text.length>32||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d{1,3})?$/.test(text))throw new Error(`${label}须≤32字符有限十进制/科学计数法`);
  const value=Number(text);if(!Number.isFinite(value)||Math.abs(value)>1e9)throw new Error(`${label}须有限且绝对值≤10亿`);
  if(value===0&&/[1-9]/.test(text.split(/[eE]/)[0]))throw new Error(`${label}非零值下溢为0，拒绝`);return value;
}
function csvLine(line) {
  const fields=[];let index=0;
  while(true){let value='';if(line[index]==='"'){index++;let closed=false;while(index<line.length){const char=line[index++];if(char==='"'){if(line[index]==='"'){value+='"';index++;}else{closed=true;break;}}else value+=char;}if(!closed)throw new Error('CSV引号未闭合；不支持引号内换行标签');if(index<line.length&&line[index]!==',')throw new Error('CSV闭引号后只能逗号或行末');}
    else{while(index<line.length&&line[index]!==','){if(line[index]==='"')throw new Error('CSV未引号字段内不能出现引号');value+=line[index++];}}
    fields.push(value);if(index>=line.length)break;index++;if(index===line.length){fields.push('');break;}
  }return fields;
}
export function parseCsv(text) {
  if(typeof text!=='string'||bytes(text)>16384)throw new Error('CSV须≤16384 UTF-8字节');
  text=text.replace(/^\uFEFF/,'');if(/\r(?!\n)/.test(text))throw new Error('CSV换行只允许LF/CRLF');
  const lines=text.split(/\r?\n/);if(lines.at(-1)==='')lines.pop();if(lines.length<2||lines.length>101)throw new Error('CSV须表头加1–100数据行，不截断');
  const header=csvLine(lines.shift());if(header.length!==2||header[0]!=='label'||header[1]!=='value')throw new Error('CSV表头必须两列label,value');
  return lines.map((line,index)=>{const fields=csvLine(line);if(fields.length!==2)throw new Error(`CSV第${index+2}行必须恰两列`);const[label,value]=fields;
    if(!label.trim()||[...label].length>40||/[\x00-\x1F\x7F]/.test(label)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(label))throw new Error('标签须1–40 Unicode码点，禁止控制符/孤立代理项');
    return{index,label,value:numeric(value,`第${index+2}行value`),rawValue:value};});
}
function axis(min,max) {
  if(!(min<max))throw new Error('轴最小值必须小于最大值');
  const ticks=Array.from({length:5},(_,i)=>min+(max-min)*i/4);if(ticks.some((value,i)=>i>0&&!(value>ticks[i-1])))throw new Error('轴范围过窄，无法生成5个不同Number刻度');return{min,max,ticks,containsZero:min<=0&&max>=0};
}
export function derive(draft) {
  const series=parseCsv(draft?.csv);if(!['bar','line'].includes(draft.chartType))throw new Error('图表类型仅bar/line');
  if(typeof draft.unit!=='string'||!draft.unit.trim()||[...draft.unit].length>40||/[\x00-\x1F\x7F]/.test(draft.unit)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(draft.unit))throw new Error('单位文本须1–40码点且无控制符/孤立代理项');
  const userAxis=axis(numeric(draft.min,'轴最小值'),numeric(draft.max,'轴最大值')),dataMin=Math.min(...series.map(row=>row.value)),dataMax=Math.max(...series.map(row=>row.value));
  if(userAxis.min>dataMin||userAxis.max<dataMax)throw new Error('用户轴必须包含全部数据，不裁切；请扩大范围');
  let low=Math.min(0,dataMin),high=Math.max(0,dataMax);if(low===high)high=1;const baselineAxis=axis(low,high);
  const indices=[draft.from,draft.to].map(value=>{if(typeof value!=='string'||!/^\d{1,3}$/.test(value)||Number(value)>=series.length)throw new Error('比较索引须是现有数据行（0起）');return Number(value);});
  const[a,b]=indices.map(index=>series[index].value),delta=b-a,p=(delta/a)*100;
  const percent=a===0?{defined:false,reason:'基准为0，百分变化未定义'}:Number.isFinite(p)?{defined:true,value:p}:{defined:false,reason:'百分变化无法以有限Number表示，未定义'};
  const warnings=['小数与计算采用JS Number双精度，十进制可能舍入；摘要/刻度最多8位有效数字，JSON保留实际Number和CSV原文。','单位由用户声明；横轴按CSV行顺序等间距，不把标签自动解析为时间/数值。'];
  if(!userAxis.containsZero)warnings.unshift(draft.chartType==='bar'?`柱图非零基线：零位于轴${userAxis.min>0?'下方':'上方'}；可见柱从${userAxis.min>0?userAxis.min:userAxis.max}起，柱长被截断，数据点未裁切。`:'折线图非零轴：零不在当前范围；零基线仅为参考，折线并非必须从零开始，不自动判定误导。');
  else if(draft.chartType==='line')warnings.unshift('折线图零基线仅供对照；轴选择应结合研究语境，不自动判定误导。');
  if(a<0)warnings.push('基准为负：百分变化仍按(b-a)/a×100带符号公式，不自动改绝对值分母，也不自动解释为增长率。');
  if(!percent.defined)warnings.push(percent.reason);
  return{modelVersion:MODEL_VERSION,series,chartType:draft.chartType,unit:draft.unit,userAxis,baselineAxis,comparison:{from:indices[0],to:indices[1],fromLabel:series[indices[0]].label,toLabel:series[indices[1]].label,a,b,delta,magnitude:Math.abs(delta),percent,formula:'(b-a)/a*100'},warnings};
}
export function geometry(series,range) {
  const left=80,top=70,width=530,height=255,y=value=>top+(range.max-value)/(range.max-range.min)*height;
  const base=Math.min(range.max,Math.max(range.min,0)),baseY=y(base),step=width/series.length;
  return{left,top,width,height,base,baseY,zeroY:range.containsZero?y(0):null,points:series.map((row,index)=>({index,x:left+step*(index+.5),y:y(row.value),barX:left+step*(index+.15),barWidth:step*.7,barY:Math.min(baseY,y(row.value)),barHeight:Math.abs(baseY-y(row.value))}))};
}
const xml=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function chartSvg(report,kind='user') {
  const range=kind==='user'?report.userAxis:report.baselineAxis,g=geometry(report.series,range),title=kind==='user'?'用户轴':'包含零的参考轴';
  const ticks=range.ticks.map(value=>{const y=g.top+(range.max-value)/(range.max-range.min)*g.height;return`<line x1="80" y1="${y}" x2="610" y2="${y}" stroke="#d8dee9"/><text x="70" y="${y+4}" text-anchor="end">${xml(formatNumber(value))}</text>`;}).join('');
  const sampled=new Set([0,report.series.length-1,...report.series.map((_,i)=>i).filter(i=>i%Math.ceil(report.series.length/8)===0)]);
  const labels=report.series.filter((_,i)=>sampled.has(i)).map(row=>{const label=[...row.label],short=label.length>10?label.slice(0,10).join('')+'…':row.label;return`<text x="${g.points[row.index].x}" y="350" text-anchor="middle" transform="rotate(-25 ${g.points[row.index].x} 350)">${xml(short)}</text>`;}).join('');
  const shapes=report.chartType==='bar'?g.points.map(point=>`<rect data-row="${point.index}" x="${point.barX}" y="${point.barY}" width="${point.barWidth}" height="${point.barHeight}" fill="#4979c9"><title>${xml(report.series[point.index].label)}: ${xml(report.series[point.index].rawValue)}</title></rect>`).join(''):`<polyline points="${g.points.map(point=>`${point.x},${point.y}`).join(' ')}" fill="none" stroke="#4979c9" stroke-width="3"/>`+g.points.map(point=>`<circle cx="${point.x}" cy="${point.y}" r="4" fill="#4979c9"><title>${xml(report.series[point.index].label)}: ${xml(report.series[point.index].rawValue)}</title></circle>`).join('');
  const values=report.series.length<=12?g.points.map(point=>`<text x="${point.x}" y="${point.y-8}" text-anchor="middle" fill="#17263a">${xml(formatNumber(report.series[point.index].value))}</text>`).join(''):'';
  const note=report.chartType==='bar'&&!range.containsZero?`截断柱基线 = ${formatNumber(g.base)}（零在轴外）`:report.chartType==='bar'?'柱基线 = 0':'折线；零基线仅参考';
  return`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420" role="img" aria-label="${xml(title)}"><rect width="640" height="420" fill="#ffffff"/><g font-family="Arial, Microsoft YaHei, sans-serif" font-size="12" fill="#233449"><text x="320" y="26" text-anchor="middle" font-size="18" font-weight="bold">${xml(title)} · ${range.min} 至 ${range.max}</text><text x="80" y="50">${xml(report.unit)}</text>${ticks}<line x1="80" y1="70" x2="80" y2="325" stroke="#233449"/><line x1="80" y1="325" x2="610" y2="325" stroke="#233449"/>${g.zeroY===null?'':`<line x1="80" y1="${g.zeroY}" x2="610" y2="${g.zeroY}" stroke="#233449" stroke-width="2" stroke-dasharray="5 3"/>`}${shapes}${values}${labels}<text x="320" y="399" text-anchor="middle">${xml(note)} · 同一系列，线性纵轴</text></g></svg>`;
}
export function comparisonSvg(report) {const c=report.comparison,stats=`Δ=${formatNumber(c.delta)}；|Δ|=${formatNumber(c.magnitude)}；百分变化=${c.percent.defined?formatNumber(c.percent.value)+'%':c.percent.reason}（(b-a)/a×100）`;return`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="480" viewBox="0 0 1280 480"><title>同数据用户轴与零参考轴对照</title><metadata>${xml(JSON.stringify(report))}</metadata><rect width="1280" height="480" fill="#ffffff"/>${chartSvg(report,'user').replace('width="640"','x="0" width="640"')}${chartSvg(report,'baseline').replace('width="640"','x="640" width="640"')}<g fill="#233449" font-family="Arial, Microsoft YaHei, sans-serif" font-size="14"><text x="640" y="445" text-anchor="middle">${xml(stats)}</text><text x="640" y="468" text-anchor="middle" font-size="12">${xml(report.warnings[0])}</text></g></svg>`;}
export function prepareStoredState(draft) {
  if(bytes(JSON.stringify(draft))>65536)throw new Error('草稿超过64KiB UTF-8，不保存');
  const fields=['csv','min','max','chartType','unit','from','to'];if(fields.some(key=>typeof draft?.[key]!=='string'))throw new Error('草稿字段类型无效');
  if(bytes(draft.csv)>16384||draft.min.length>32||draft.max.length>32||[...draft.unit].length>40||draft.from.length>3||draft.to.length>3||!['bar','line'].includes(draft.chartType))throw new Error('草稿字段容量/类型无效');
  return{schemaVersion:1,...Object.fromEntries(fields.map(key=>[key,draft[key]]))};
}
export function validateStoredState(raw) {if(bytes(JSON.stringify(raw))>65536)throw new Error('草稿超过64KiB UTF-8');if(raw?.schemaVersion!==1)throw new Error('草稿版本不支持');return prepareStoredState(raw);}
export function reportMarkdown(payload) {const escape=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');const text=escape(JSON.stringify({draft:payload.draft,result:payload.result},null,2)),fence='`'.repeat(Math.max(3,...[...text.matchAll(/`+/g)].map(match=>match[0].length+1)));return['# L034 图表证据辨识','单系列线性轴，无图像识别/因果判断；数据不裁切，零参考轴不是所有折线的强制标准。','## 完整数据、轴、变化与提示',`${fence}json\n${text}\n${fence}`,payload.result?'百分公式(b-a)/a*100，基准0或非有限计算时未定义；小数为JS Number双精度。':'尚无有效图表。'].join('\n\n');}
