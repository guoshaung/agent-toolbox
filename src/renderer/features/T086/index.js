import { h } from '../../core/ui.js';
import { UNITS, calculate, dimensionName, reportMarkdown } from './model.mjs';
const KEY='features.T086.draft';
export default{
 id:'T086',
 create(root,ctx={}){
  let result=null,alive=true,saving=false;
  const formula=h('textarea',{rows:3,maxlength:'1200',spellcheck:'false','aria-label':'带单位算式',oninput:changed});formula.value='1米 + 100厘米';
  const target=h('input',{value:'米',maxlength:'120','aria-label':'目标单位',oninput:changed});
  const status=h('p',{role:'status','aria-live':'polite',class:'t086-status'}),output=h('div');
  const json=h('button',{disabled:true,onclick:()=>save('json')},'导出完整 JSON 副本'),md=h('button',{disabled:true,onclick:()=>save('md')},'导出 Markdown 副本');
  const shell=h('section',{class:'feature-t086'},h('h2',{},'单位约束计算台'),h('p',{},'在同一算式里使用长度、时间、质量和派生单位，先检查量纲再换算目标单位。'),
   h('label',{},'算式',formula),h('label',{},'目标单位（留空使用SI组合）',target),
   h('div',{class:'t086-actions'},h('button',{onclick:run},'检查量纲并计算'),h('button',{onclick:()=>sample('1米 + 100厘米','米')},'长度加法示例'),h('button',{onclick:()=>sample('100m / 10s','km/h')},'速度换算示例'),h('button',{onclick:()=>sample('2 kg * (3 m / 1 s)^2','J')},'派生单位示例'),h('button',{onclick:()=>sample('1米 + 1秒','米')},'不相容示例')),
   status,output,h('div',{class:'t086-actions'},json,md),
   h('details',{},h('summary',{},'支持的单位与语法'),h('p',{},'使用+、-、*、/、^和括号。数值紧跟单位组成一个数量，100m/10s按(100m)/(10s)计算；2m^2表示2平方米，(2m)^2表示4平方米。幂指数为-6至6整数，不接受链式幂；其他乘法请用*。单位大小写敏感，L与mL不同。'),
    h('ul',{},UNITS.map(unit=>h('li',{},`${unit.symbol} / ${unit.aliases.join('、')}：1单位 = ${unit.factor} ${dimensionName(unit.dimensions)}`))),
    h('p',{},'目标只能是单位及其乘除/整数幂；无量纲可写1或scalar。不支持温标偏移、货币、函数、变量、赋值或自定义单位。不执行输入代码，不联网。'),h('p',{},'最多1200字符/256标记/16层括号，输入数字非零绝对值1e-12至1e12；中间与结果非零绝对值1e-30至1e30，量纲指数±12。有限双精度浮点计算，显示约12位有效数字，原始值保留在报告中。')));
  root.append(h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href}),shell);
  try{const saved=ctx.config?.get(KEY);if(saved?.version===1&&typeof saved.expression==='string'&&saved.expression.length<=1200&&typeof saved.target==='string'&&saved.target.length<=120){formula.value=saved.expression;target.value=saved.target;message('已恢复输入草稿，请重新计算。');}}catch{message('草稿读取失败，仍可输入计算。');}
  function message(text){if(alive)status.textContent=text;}
  function changed(){result=null;output.replaceChildren();json.disabled=md.disabled=true;message('输入已变化，旧结果已清空。');}
  function sample(expression,unit){formula.value=expression;target.value=unit;changed();run();}
  function persist(){if(formula.value.length>1200||target.value.length>120||!ctx.config?.set)return;try{Promise.resolve(ctx.config.set(KEY,{version:1,expression:formula.value,target:target.value})).catch(error=>message(`草稿未保存：${error.message}`));}catch(error){message(`草稿未保存：${error.message}`);}}
  function run(){try{const next=calculate(formula.value,target.value);result=next;persist();const display=Number(next.value.toPrecision(12)).toString();output.replaceChildren(h('h3',{},`结果：${display} ${next.targetUnit}`),h('p',{},`SI值 ${next.siValue} ${next.siUnit} · 量纲[m,kg,s]=[${next.dimensions.join(',')}]`),h('p',{},next.arithmetic),h('h4',{},'按算式顺序核对的中间步骤'),h('ol',{},next.steps.map(step=>h('li',{},`${step.operator} → ${step.result.value} ${dimensionName(step.result.dimensions)}`))));json.disabled=md.disabled=false;message('量纲相容，当前结果可预览并导出。');}catch(error){changed();message(error.message);}}
  async function save(extension){if(!result||saving)return;const files=window.toolbox?.files;if(files?.saveTextSupportsCopyOnly!==true||typeof files.saveText!=='function'){message('请更新到支持安全副本导出的基础版本。');return;}const snapshot=result;saving=true;json.disabled=md.disabled=true;try{const response=await files.saveText({content:extension==='json'?JSON.stringify(snapshot,null,2):reportMarkdown(snapshot),extension,defaultName:`T086-单位计算.${extension}`,copyOnly:true});message(response?.ok?'已保存新副本，含结果、量纲与完整中间步骤。':response?.canceled?'已取消保存，结果仍保留。':`保存失败：${response?.error||'未确认成功'}`);}catch(error){message(`保存失败：${error.message}`);}finally{saving=false;if(alive)json.disabled=md.disabled=!result;}}
  return{activate(){},deactivate(){persist();},destroy(){persist();alive=false;result=null;root.replaceChildren();}};
 }
};
