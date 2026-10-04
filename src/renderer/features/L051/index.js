import { h } from '../../core/ui.js';
import { calibrate, LIMITS, parseRecords } from './model.mjs';
const TWO=[{label:'预测必对且答对',probability:1,outcome:1},{label:'预测必错但答对',probability:0,outcome:1}];
const FIVE=[{label:'任务A',probability:0.1,outcome:0},{label:'任务B',probability:0.3,outcome:0},{label:'任务C',probability:0.5,outcome:1},{label:'任务D',probability:0.9,outcome:0},{label:'任务E',probability:1,outcome:1}];
const numeric=value=>value===null?'—':value.toFixed(6);
function table(headers,rows){return h('div',{style:{overflowX:'auto'}},h('table',{class:'feature-lab__table'},h('thead',{},h('tr',{},...headers.map(text=>h('th',{},text)))),h('tbody',{},...rows.map(row=>h('tr',{},...row.map(text=>h('td',{},text)))))));}
function graph(bins) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 520 350');svg.setAttribute('role','img');svg.setAttribute('aria-label','可靠性分箱图：横轴平均预测成功概率，纵轴实际正确比例');svg.style.maxWidth='620px';svg.style.width='100%';
  const add=(tag,attributes,text)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[key,value]of Object.entries(attributes))el.setAttribute(key,String(value));if(text!==undefined)el.textContent=text;svg.append(el);return el;};
  const x=p=>55+p*410,y=p=>290-p*250;
  for(let i=0;i<=5;i++){const p=i/5;add('line',{x1:x(0),y1:y(p),x2:x(1),y2:y(p),stroke:'#34434b'});add('text',{x:45,y:y(p)+4,fill:'currentColor','text-anchor':'end','font-size':12},p.toFixed(1));add('text',{x:x(p),y:310,fill:'currentColor','text-anchor':'middle','font-size':12},p.toFixed(1));}
  add('line',{x1:x(0),y1:y(0),x2:x(1),y2:y(1),stroke:'#a9b9c4','stroke-dasharray':'6 5'});
  const populated=bins.filter(bin=>bin.count);
  add('polyline',{points:populated.map(bin=>x(bin.meanProbability)+','+y(bin.actualRate)).join(' '),fill:'none',stroke:'#6ac9b8','stroke-width':2});
  for(const bin of populated){const dot=add('circle',{cx:x(bin.meanProbability),cy:y(bin.actualRate),r:5,fill:'#6ac9b8'});const title=document.createElementNS(svg.namespaceURI,'title');title.textContent='n='+bin.count+'，平均预测 '+numeric(bin.meanProbability)+'，实际 '+numeric(bin.actualRate);dot.append(title);}
  add('text',{x:260,y:338,fill:'currentColor','text-anchor':'middle','font-size':13},'平均预测成功概率');return svg;
}
export default{
  id:'L051',
  create(root){
    let report=null,alive=true,busy=false,generation=0;
    const input=h('textarea',{class:'field',rows:10,'aria-label':'概率与结果 JSON',spellcheck:false,oninput:invalidate});
    const bins=h('input',{class:'field',type:'number',min:2,max:10,step:1,value:5,'aria-label':'等宽分箱数',oninput:invalidate});
    const threshold=h('input',{class:'field',type:'number',min:0.5,max:1,step:0.05,value:0.8,'aria-label':'高信心阈值',oninput:invalidate});
    const status=h('p',{role:'status','aria-live':'polite'}),output=h('div');
    const calculate=h('button',{class:'btn btn--primary',onclick:run},'分析既有结果');
    const saveButton=h('button',{class:'btn',disabled:true,onclick:save},'导出完整校准 JSON');
    const file=h('input',{type:'file',accept:'.json,application/json','aria-label':'导入结果 JSON 文件',onchange:async()=>{
      const selected=file.files?.[0],token=++generation;if(!selected)return;
      try{if(selected.size>LIMITS.bytes)throw Error('文件超过 2 MiB。');const text=new TextDecoder('utf-8',{fatal:true}).decode(await selected.arrayBuffer());if(!alive||token!==generation)return;input.value=text;invalidate();status.textContent='已导入 '+selected.name+'，请核对格式再分析。';}
      catch(error){if(alive&&token===generation)status.textContent='导入失败：'+error.message;}
      finally{if(alive)file.value='';}
    }});
    root.append(h('h2',{},'信心校准分析'),h('p',{},'导入已经完成的任务记录。probability 是你事先估计“会答对”的概率（0–1）；outcome 是核对后的实际结果，答对为1、错误为0。'),
      h('p',{class:'faint'},'JSON 数组，每项含 probability、outcome，可选 label。没有实际结果的记录请先核对，不把未知当错误。'),input,file,
      h('div',{class:'feature-lab__actions'},h('label',{},'分箱数 ',bins),h('label',{},'高信心阈值 ',threshold),h('button',{class:'btn',onclick:()=>sample(TWO)},'载入两条验收示例'),h('button',{class:'btn',onclick:()=>sample(FIVE)},'载入五条分箱示例'),calculate,saveButton),
      status,output,h('p',{class:'faint'},'至少五条才展示可靠性分箱。Brier 是概率预测平方误差，不能单独视为掌握程度或纯校准质量；小样本分箱只供观察。输入不保存到全局配置，切换前请导出。'));
    function invalidate(){generation++;report=null;saveButton.disabled=true;output.replaceChildren();status.textContent='输入已改变，请重新分析。';}
    function sample(records){input.value=JSON.stringify(records,null,2);invalidate();run();}
    function run(){
      if(!alive||busy)return;
      try{
        report=calibrate(parseRecords(input.value),{binCount:Number(bins.value),threshold:Number(threshold.value)});
        status.textContent='共 '+report.recordCount+' 条，Brier 分数 '+numeric(report.brier)+'。';
        output.replaceChildren(h('p',{},'平均预测概率 '+numeric(report.meanProbability)+'；实际正确比例 '+numeric(report.actualRate)+'。Brier 越接近0表示这批预测的平方误差越小。'),
          report.chartEligible?h('section',{},h('h3',{},'可靠性分箱'),graph(report.bins),h('p',{class:'faint'},'纵轴为实际正确比例；虚线为平均预测概率等于实际比例。空箱没有点，不按零绘制；每箱样本数见表。'),table(['区间','样本数','平均预测','实际正确','预测−实际'],report.bins.map(bin=>['['+numeric(bin.lower)+', '+numeric(bin.upper)+(bin.upperInclusive?']':')'),bin.count,numeric(bin.meanProbability),numeric(bin.actualRate),numeric(bin.gap)]))):h('p',{},'只有 '+report.recordCount+' 条，少于5条；不绘制分箱，仍可核对 Brier 和逐条误差。'),
          h('h3',{},'高信心失误 · '+report.highConfidenceErrors.length+' 条'),h('p',{},'规则：预测成功概率 ≥ '+report.threshold+'，实际结果为0。前50条如下，完整内容见JSON。'),detail(report.highConfidenceErrors),
          h('h3',{},'低估成功 · '+report.lowConfidenceSuccesses.length+' 条'),detail(report.lowConfidenceSuccesses),
          h('h3',{},'逐条误差（预览前50条）'),detail(report.records));
        saveButton.disabled=false;
      }catch(error){report=null;saveButton.disabled=true;output.replaceChildren();status.textContent=error.message;}
    }
    function detail(records){return records.length?table(['原始序号','任务','预测概率','实际结果','平方误差'],records.slice(0,50).map(record=>[record.sourceRow,record.label,numeric(record.probability),record.outcome,numeric(record.squaredError)])):h('p',{},'没有符合规则的记录。');}
    async function save(){
      if(!report||busy)return;
      try{
        if(window.toolbox?.files?.saveTextSupportsCopyOnly!==true)throw Error('当前版本缺少防覆盖导出接口。');
        const content=JSON.stringify(report,null,2);busy=true;calculate.disabled=saveButton.disabled=true;
        const result=await window.toolbox.files.saveText({content,extension:'json',defaultName:'信心校准分析.json',copyOnly:true});
        if(alive)status.textContent=result?.ok?'副本已保存：'+result.path:result?.canceled?'已取消导出。':result?.error||'未确认保存成功。';
      }catch(error){if(alive)status.textContent=error.message;}
      finally{busy=false;if(alive){calculate.disabled=false;saveButton.disabled=!report;}}
    }
    return{deactivate(){generation++;},destroy(){alive=false;generation++;report=null;root.replaceChildren();}};
  }
};
