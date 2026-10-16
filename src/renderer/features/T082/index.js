import { h } from '../../core/ui.js';
import { countRange, NAMES, parseHolidays, shiftWorkdays } from './model.mjs';
export default{
  id:'T082',
  create(root){
    let report=null,page=0,busy=false,alive=true;
    const status=h('p',{role:'status','aria-live':'polite'}),output=h('div'),detail=h('div');
    const input=(type,label,value)=>h('input',{class:'field',type,value,min:type==='date'?'1900-01-01':-1000,max:type==='date'?'2100-12-31':1000,step:1,'aria-label':label,oninput:invalidate});
    const start=input('date','开始日期','2026-06-01'),end=input('date','结束日期','2026-06-05'),amount=input('number','推算工作日数',4);
    const holidays=h('textarea',{class:'field',rows:5,maxlength:20000,'aria-label':'自定义假日',oninput:invalidate},'2026-06-03');
    const includeStart=h('input',{type:'checkbox',checked:true,onchange:invalidate}),includeEnd=h('input',{type:'checkbox',checked:true,onchange:invalidate});
    const week=NAMES.map((name,day)=>({day,box:h('input',{type:'checkbox',checked:day>0&&day<6,onchange:invalidate}),name}));
    const rangeFields=h('div',{class:'feature-lab__actions'},h('label',{},'结束日期 ',end),h('label',{},includeStart,'计入开始日'),h('label',{},includeEnd,'计入结束日'));
    const shiftFields=h('div',{},h('label',{},'工作日数 ',amount),h('p',{class:'faint'},'正数向后、负数向前推算；不计开始日，0直接返回开始日。'));
    const mode=h('select',{class:'field','aria-label':'计算模式',onchange:()=>{invalidate();syncMode();}},h('option',{value:'range'},'区间工作日数量'),h('option',{value:'shift'},'按工作日推算日期'));
    const calculate=h('button',{class:'btn btn--primary',onclick:run},'按当前规则计算');
    const saveButton=h('button',{class:'btn',disabled:true,onclick:save},'导出日期计算 JSON');
    root.append(h('h2',{},'日期工作日计算'),h('p',{},'明确工作周和自定义假日，再计算可用工作日或截止日期。只使用填写的规则，不自动读取法定节假日或系统日历。'),
      mode,h('label',{},'开始日期 ',start),rangeFields,shiftFields,h('h3',{},'每周哪些日子算工作日'),h('div',{class:'feature-lab__actions'},...week.map(({box,name})=>h('label',{},box,name))),
      h('h3',{},'自定义假日（每行 YYYY-MM-DD）'),holidays,
      h('div',{class:'feature-lab__actions'},h('button',{class:'btn',onclick:example},'载入周三休假示例'),calculate,saveButton),status,output,detail,
      h('p',{class:'faint'},'按日历日期计算，不包含时刻或时区。区间最多3660自然日，推算最多±1000工作日，假日最多500项；重复假日只计一次。内容只在当前页面，切换前请导出。'));
    syncMode();run();
    function syncMode(){rangeFields.hidden=mode.value!=='range';shiftFields.hidden=mode.value!=='shift';}
    function invalidate(){report=null;saveButton.disabled=true;output.replaceChildren();detail.replaceChildren();status.textContent='规则或日期已改变，请重新计算。';}
    function example(){mode.value='range';start.value='2026-06-01';end.value='2026-06-05';amount.value='4';holidays.value='2026-06-03';includeStart.checked=includeEnd.checked=true;for(const entry of week)entry.box.checked=entry.day>0&&entry.day<6;syncMode();invalidate();run();}
    function run(){
      if(!alive||busy)return;
      try{
        const options={weekdays:week.filter(entry=>entry.box.checked).map(entry=>entry.day),holidays:parseHolidays(holidays.value),includeStart:includeStart.checked,includeEnd:includeEnd.checked};
        if(mode.value==='shift'&&!amount.value.trim())throw Error('请填写推算工作日数，可明确输入0。');
        report=mode.value==='range'?countRange(start.value,end.value,options):shiftWorkdays(start.value,Number(amount.value),options);
        page=0;saveButton.disabled=false;
        status.textContent=report.mode==='range'?'共 '+report.totalDays+' 个计入日期，'+report.workingDays+' 个工作日，排除 '+report.excludedDays+' 日。':'推算结果 '+report.resultDate+'；经过 '+report.totalDays+' 自然日、'+report.workingDays+' 工作日。';
        output.replaceChildren(h('p',{},'非工作星期：'+report.nonWorkWeekdayDays+' 日；自定义假日：'+report.customHolidayDays+' 日。两类重叠时有两条原因，但只排除一次。'),
          h('p',{},'工作周：'+report.calendar.weekdays.map(day=>NAMES[day]).join('、')+'；唯一假日 '+report.calendar.holidays.length+' 个。'));
        render();
      }catch(error){report=null;saveButton.disabled=true;output.replaceChildren();detail.replaceChildren();status.textContent=error.message;}
    }
    function render(){
      if(!report)return;
      const pages=Math.max(1,Math.ceil(report.days.length/50));page=Math.min(page,pages-1);
      detail.replaceChildren(h('h3',{},'逐日明细 · 第 '+(page+1)+' / '+pages+' 页'),
        h('div',{style:{overflowX:'auto',maxHeight:'450px',overflowY:'auto'}},h('table',{class:'feature-lab__table'},h('thead',{},h('tr',{},...['日期','星期','是否计为工作日','排除原因'].map(title=>h('th',{},title)))),h('tbody',{},...report.days.slice(page*50,(page+1)*50).map(day=>h('tr',{},...[day.date,day.weekdayName,day.working?'是':'否',day.reasons.join('、')||'—'].map(value=>h('td',{},value))))))),
        h('button',{class:'btn',disabled:page===0,onclick:()=>{page--;render();}},'上一页'),h('button',{class:'btn',disabled:page+1>=pages,onclick:()=>{page++;render();}},'下一页'));
    }
    async function save(){
      if(!report||busy)return;
      try{
        if(window.toolbox?.files?.saveTextSupportsCopyOnly!==true)throw Error('当前版本缺少防覆盖导出接口。');
        const content=JSON.stringify(report,null,2);busy=true;calculate.disabled=saveButton.disabled=true;
        const result=await window.toolbox.files.saveText({content,extension:'json',defaultName:'日期工作日计算.json',copyOnly:true});
        if(alive)status.textContent=result?.ok?'副本已保存：'+result.path:result?.canceled?'已取消保存。':result?.error||'未确认保存成功。';
      }catch(error){if(alive)status.textContent=error.message;}
      finally{busy=false;if(alive){calculate.disabled=false;saveButton.disabled=!report;}}
    }
    return{destroy(){alive=false;report=null;root.replaceChildren();}};
  }
};
