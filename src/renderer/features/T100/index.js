import { h } from '../../core/ui.js';
import { cleanUrl, cleanText, INVISIBLE, MAX_CHARS } from './model.mjs';
export default {
  id:'T100',
  create(root) {
    let report=null, alive=true, busy=false;
    const input=h('textarea',{class:'field',rows:7,maxlength:MAX_CHARS,'aria-label':'待净化内容',oninput:invalidate});
    const output=h('textarea',{class:'field',rows:6,readonly:true,'aria-label':'净化结果'});
    const status=h('p',{role:'status','aria-live':'polite'}),diff=h('div'),urlRules=h('div'),textRules=h('div');
    const trim=h('input',{type:'checkbox',checked:true,onchange:invalidate}),clickIds=h('input',{type:'checkbox',onchange:invalidate});
    const charRules=INVISIBLE.map(rule=>{const el=h('input',{type:'checkbox',checked:rule.default,onchange:invalidate});return {rule,el};});
    urlRules.append(h('label',{},trim,'修剪 URL 首尾空白'),h('br'),h('label',{},clickIds,'同时去除 gclid / dclid / fbclid / msclkid'));
    textRules.append(...charRules.map(({rule,el})=>h('label',{style:{display:'block',margin:'8px 0'}},el,rule.title)));
    const mode=h('select',{class:'field','aria-label':'净化模式',onchange:()=>{invalidate();syncMode();}},h('option',{value:'url'},'URL 追踪参数'),h('option',{value:'text'},'文本不可见字符'));
    const copy=h('button',{class:'btn',disabled:true,onclick:copyResult},'复制净化结果');
    const txt=h('button',{class:'btn',disabled:true,onclick:()=>save(false)},'导出净化 TXT 副本');
    const json=h('button',{class:'btn',disabled:true,onclick:()=>save(true)},'导出差异 JSON');
    const runButton=h('button',{class:'btn btn--primary',onclick:run},'生成净化预览');
    root.append(h('h2',{},'剪贴板内容分享净化'),h('p',{},'自行粘贴要分享的内容，选择规则后核对差异，再复制净化结果。工具不读取或监听剪贴板。'),
      mode,input,urlRules,textRules,
      h('p',{class:'faint'},'URL 默认只删除明确的 utm 参数，保留业务参数、参数值编码、顺序与片段；文本默认保留连字和方向控制。'),
      h('div',{class:'feature-lab__actions'},h('button',{class:'btn',onclick:example},'载入当前模式示例'),runButton,copy,txt,json),
      status,h('h3',{},'净化结果'),output,h('h3',{},'变更明细（预览前 50 条）'),diff,
      h('p',{class:'faint'},'最多 100000 个 UTF-16 字符；不存入应用配置。JSON 包含原文及删除内容，TXT 只包含净化结果。切换前请导出所需结果。'));
    syncMode();
    function syncMode(){urlRules.hidden=mode.value!=='url';textRules.hidden=mode.value!=='text';}
    function invalidate(){report=null;output.value='';copy.disabled=txt.disabled=json.disabled=true;diff.replaceChildren();status.textContent='输入或规则已改变，请重新生成预览。';}
    function example(){input.value=mode.value==='url'?'https://example.com/order?utm_source=newsletter&order_id=42#detail':'甲\u200B乙\uFEFF丙 👩\u200D💻';invalidate();run();}
    function run(){
      if(!alive||busy)return;
      try{
        report=mode.value==='url'?cleanUrl(input.value,{trim:trim.checked,clickIds:clickIds.checked}):cleanText(input.value,charRules.filter(({el})=>el.checked).map(({rule})=>rule.key));
        output.value=report.result;copy.disabled=txt.disabled=json.disabled=false;
        status.textContent='共 '+report.changes.length+' 处变更；请核对结果与原文。';
        diff.replaceChildren(h('ul',{},...report.changes.slice(0,50).map(change=>h('li',{},change.kind==='parameter'?'删除第 '+change.parameter+' 个参数：'+JSON.stringify(change.raw):change.kind==='trim'?'修剪 URL 首尾空白':'删除 '+change.codePoint+'，原文偏移 '+change.offset))),
          ...report.warnings.map(w=>h('p',{},'第 '+w.parameter+' 个参数：'+w.reason)),
          report.changes.length>50?h('p',{},'其余 '+(report.changes.length-50)+' 条见完整 JSON。'):null,
          !report.changes.length?h('p',{},'没有规则匹配，原文保持不变。'):null);
      }catch(error){invalidate();status.textContent=error.message;}
    }
    async function copyResult(){
      if(!report||busy)return;
      try{
        if(typeof window.toolbox?.clipboard?.write==='function'){await window.toolbox.clipboard.write(report.result);if(alive)status.textContent='净化结果已复制。';}
        else{output.focus();output.select();status.textContent='已选中净化结果，请按 Ctrl/Cmd+C 复制。';}
      }catch(error){if(alive)status.textContent='复制失败：'+error.message;}
    }
    async function save(withDiff){
      if(!report||busy)return;
      try{
        if(window.toolbox?.files?.saveTextSupportsCopyOnly!==true)throw Error('当前版本缺少防覆盖导出接口。');
        const content=withDiff?JSON.stringify(report,null,2):report.result;
        busy=true;runButton.disabled=copy.disabled=txt.disabled=json.disabled=true;
        const result=await window.toolbox.files.saveText({content,extension:withDiff?'json':'txt',defaultName:withDiff?'分享净化差异.json':'分享净化结果.txt',copyOnly:true});
        if(alive)status.textContent=result?.ok?'副本已保存：'+result.path:result?.canceled?'已取消保存。':result?.error||'未确认保存成功。';
      }catch(error){if(alive)status.textContent=error.message;}
      finally{busy=false;if(alive){runButton.disabled=false;copy.disabled=txt.disabled=json.disabled=!report;}}
    }
    return {destroy(){alive=false;report=null;root.replaceChildren();}};
  }
};
