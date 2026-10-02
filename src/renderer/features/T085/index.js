import {h} from '../../core/ui.js';
import {calculateScenarios,simpleExample,tariffExample} from './model.mjs';
const css=`.t085{display:grid;gap:14px;margin:auto;max-width:1300px}.t085 label{display:grid;gap:4px;font-size:13px}.t085 input,.t085 select{padding:7px;background:var(--bg-sunken);color:var(--text);border:1px solid var(--line);border-radius:4px;max-width:170px}.t085 .t085-scenario{padding:14px;border:1px solid var(--line);border-radius:8px;margin:10px 0;display:grid;gap:10px}.t085 .t085-row{display:flex;flex-wrap:wrap;gap:9px;align-items:end}.t085 .t085-device{padding:10px;background:var(--bg-sunken);display:grid;gap:8px}.t085 .t085-muted{font-size:13px;line-height:1.6;color:var(--text-dim)}.t085 .t085-scroll{overflow:auto}.t085 table{border-collapse:collapse;width:100%;font-size:13px}.t085 td,.t085 th{border-bottom:1px solid var(--line);padding:8px;text-align:left}.t085 pre{white-space:pre-wrap;overflow-wrap:anywhere}.t085 .t085-status{padding:10px;background:var(--bg-sunken)}`;
export default {
 id:'T085',
 create(root){
  let inputs=simpleExample(),report=null,alive=true,exporting=false;
  const editor=h('div'),output=h('div'),status=h('p',{class:'t085-status',role:'status','aria-live':'polite'},'功率与电价来自你填写的输入；结果是固定功率假设下的估计。');
  const button=(text,fn,disabled=false)=>h('button',{type:'button',class:'btn',onclick:fn,disabled},text);
  const files=window.toolbox?.files,safeSave=()=>files?.saveTextSupportsCopyOnly===true&&typeof files.saveText==='function';
  const say=text=>{if(alive)status.textContent=text;};
  const invalidate=()=>{report=null;output.replaceChildren();save.disabled=true;say('输入已改变，请重新计算并核对估计值。');};
  function field(label,value,onchange,aria=label){const input=h('input',{type:'text',maxlength:24,'aria-label':aria,oninput:()=>{onchange(input.value);invalidate();}});input.value=String(value);return h('label',{},label,input);}
  function namedField(label,value,onchange,aria){const node=field(label,value,onchange,aria);node.querySelector('input').maxLength=80;return node;}
  function renderEditor(){
    editor.replaceChildren(...inputs.map((scenario,si)=>{
      const prefix='情景'+(si+1)+' ';
      const currency=h('select',{'aria-label':prefix+'币种',onchange:()=>{scenario.currency=currency.value;invalidate();}},['CNY','USD','EUR','HKD'].map(value=>h('option',{value},value)));currency.value=scenario.currency;
      return h('section',{class:'t085-scenario','aria-label':prefix.trim()},
        h('div',{class:'t085-row'},h('strong',{},prefix),namedField('名称',scenario.name,value=>{scenario.name=value;},prefix+'名称'),
          field('天数',scenario.days,value=>{scenario.days=/^\d+$/u.test(value)?Number(value):null;},prefix+'天数'),h('label',{},'币种',currency),button('删除情景 '+(si+1),()=>{inputs.splice(si,1);invalidate();renderEditor();},inputs.length===1)),
        h('h3',{},'每天电价时段（依次划分，长度合计24小时）'),
        ...scenario.periods.map((period,pi)=>h('div',{class:'t085-row'},namedField('时段名',period.name,value=>{period.name=value;},prefix+'时段'+(pi+1)+'名称'),
          field('长度（小时）',period.hours,value=>{period.hours=value;},prefix+'时段'+(pi+1)+'长度'),field('每度电价',period.price,value=>{period.price=value;},prefix+'时段'+(pi+1)+'电价'),
          button('删除时段 '+(pi+1),()=>{scenario.periods.splice(pi,1);scenario.devices.forEach(d=>d.activeHours.splice(pi,1));invalidate();renderEditor();},scenario.periods.length===1))),
        button('情景'+(si+1)+' 添加电价时段',()=>{scenario.periods.push({name:'新增时段',hours:'0',price:'1'});scenario.devices.forEach(d=>d.activeHours.push('0'));invalidate();renderEditor();},scenario.periods.length>=6),
        h('h3',{},'设备输入（非运行时间全部视为待机）'),
        ...scenario.devices.map((device,di)=>h('div',{class:'t085-device'},
          h('div',{class:'t085-row'},namedField('设备名称',device.name,value=>{device.name=value;},prefix+'设备'+(di+1)+'名称'),
            field('运行功率 W',device.powerW,value=>{device.powerW=value;},prefix+'设备'+(di+1)+'运行功率'),field('待机功率 W',device.standbyW,value=>{device.standbyW=value;},prefix+'设备'+(di+1)+'待机功率'),
            button('删除设备 '+(di+1),()=>{scenario.devices.splice(di,1);invalidate();renderEditor();},scenario.devices.length===1)),
          h('div',{class:'t085-row'},...scenario.periods.map((period,pi)=>field(`${period.name} 每日运行小时`,device.activeHours[pi],value=>{device.activeHours[pi]=value;},prefix+'设备'+(di+1)+'时段'+(pi+1)+'运行小时'))))),
        button('情景'+(si+1)+' 添加设备',()=>{scenario.devices.push({name:'新设备',powerW:'100',standbyW:'0',activeHours:scenario.periods.map(()=> '0')});invalidate();renderEditor();},scenario.devices.length>=20));
    }));add.disabled=inputs.length>=6;
  }
  const table=(headers,rows)=>h('div',{class:'t085-scroll'},h('table',{},h('thead',{},h('tr',{},headers.map(text=>h('th',{scope:'col'},text)))),h('tbody',{},rows.map(cells=>h('tr',{},cells.map(text=>h('td',{},String(text))))))));
  function calculate(){
    invalidate();try{
      report=calculateScenarios(inputs);
      output.replaceChildren(h('h3',{},'情景估计汇总'),table(['情景','天数','运行电量（度）','待机电量（度）','总电量（度）','估计费用'],report.scenarios.map(s=>[s.name,s.days,s.activeKWh,s.standbyKWh,s.totalKWh,s.cost+' '+s.currency])),
        ...report.comparisons.map(c=>h('p',{},c.comparable?`${c.name} 相对 ${c.baseline}：估计费用变化 ${c.costDelta}`:`${c.name} 相对 ${c.baseline}：${c.reason}`)),
        ...report.scenarios.map(s=>h('section',{},h('h3',{},s.name+' 逐设备时段估计明细'),table(['设备','时段','每日运行h','每日待机h','电价/度','运行度数','待机度数','总度数','费用'],s.devices.flatMap(d=>d.entries.map(e=>[d.name,e.period,e.activeHoursPerDay,e.standbyHoursPerDay,e.pricePerKWh+' '+s.currency,e.activeKWh,e.standbyKWh,e.totalKWh,e.cost+' '+s.currency]))))),
        h('details',{},h('summary',{},'完整输入、估计假设与精确审计预览'),h('pre',{},JSON.stringify(report,null,2))));
      save.disabled=!safeSave();say('估计完成；未测量真实耗电，核对功率、待机、电价及24小时时段后再使用结果。');
    }catch(error){report=null;say(error.message);}
  }
  const add=button('复制首个情景进行比较',()=>{if(inputs.length>=6)return;const clone=JSON.parse(JSON.stringify(inputs[0]));clone.name='比较情景 '+(inputs.length+1);inputs.push(clone);invalidate();renderEditor();});
  const save=button('导出用电估计 JSON',async()=>{
    if(!report||exporting||!safeSave())return;const snapshot=report;exporting=true;save.disabled=true;
    try{const response=await files.saveText({content:JSON.stringify(snapshot,null,2),extension:'json',defaultName:'T085-electricity-scenarios.json',copyOnly:true});say(response?.ok?'估计报告副本已保存。':response?.canceled?'已取消保存。':'保存失败：'+(response?.error||'未确认成功'));}
    catch(error){say('保存失败：'+error.message);}finally{exporting=false;if(alive)save.disabled=!report||!safeSave();}
  });save.disabled=true;
  root.replaceChildren(h('section',{class:'t085'},h('style',{},css),h('h2',{},'用电成本情景计算'),
    h('p',{},'按手填设备运行功率、待机功率、每日时长和分时电价估算电量与费用。'),
    h('p',{class:'t085-muted'},'每天电价时段依次划分完整24小时；设备在各时段的非运行时间自动计为待机。其余时间断电时填待机0W。所有功率、电价与时长是输入；表格输出是估计，不是实测或账单。'),
    h('div',{class:'t085-row'},button('载入100W基础示例',()=>{inputs=simpleExample();invalidate();renderEditor();}),button('载入分时与待机比较',()=>{inputs=tariffExample();invalidate();renderEditor();}),add),
    editor,button('计算并预览用电估计',calculate),status,output,save,
    h('p',{class:'t085-muted'},'最多6情景、20设备/情景、6时段/天，天数1–3660；功率≤1,000,000W、最多3小数；电价≤1000、最多4小数；时长最多3小数。无实时电价、阶梯费、税费、固定服务费或损耗模型。只直接比较同天数同币种情景。'),
    h('p',{class:'t085-muted'},'先精确相加再将费用半入到2位，分项显示的费用之和可能不等于总计。输入仅在当前面板内存，切换功能会丢失未导出内容。导出只创建新文件，已有路径禁止覆盖。'),
    ...(!safeSave()?[h('p',{class:'t085-muted'},'缺少副本保护接口，导出已禁用。')]:[])));
  renderEditor();return{activate(){},deactivate(){},destroy(){alive=false;root.replaceChildren();}};
 }
};
