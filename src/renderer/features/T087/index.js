import { h } from '../../core/ui.js';
import { comparePurchases, UNITS, CURRENCIES } from './model.mjs';
const css=`.t087{display:grid;gap:14px;max-width:1300px;margin:auto}.t087 label{display:grid;gap:4px}.t087 input,.t087 select{padding:7px;background:var(--bg-sunken);color:var(--text);border:1px solid var(--line);border-radius:4px;max-width:180px}.t087 .t087-editor{display:flex;gap:8px;flex-wrap:wrap;padding:12px;border:1px solid var(--line);border-radius:6px}.t087 .t087-muted{color:var(--text-dim);font-size:13px;line-height:1.6}.t087 .t087-actions{display:flex;flex-wrap:wrap;gap:8px}.t087 .t087-scroll{overflow:auto}.t087 table{border-collapse:collapse;width:100%;font-size:13px}.t087 td,.t087 th{padding:8px;text-align:left;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.t087 pre{white-space:pre-wrap;overflow-wrap:anywhere}.t087 .t087-status{padding:10px;background:var(--bg-sunken);border-radius:5px}`;
const blank=()=>({name:'',group:'',currency:'CNY',quantity:'',unit:'g',packages:'1',price:'',shipping:'0'});
const sample=()=>[{name:'A 500克大米',group:'大米',currency:'CNY',quantity:'500',unit:'g',packages:'1',price:'20',shipping:'0'},{name:'B 1千克大米',group:'大米',currency:'CNY',quantity:'1',unit:'kg',packages:'1',price:'35',shipping:'0'}];
export default {
  id:'T087',
  create(root){
    let draft=sample(), report=null, alive=true, exporting=false;
    const editor=h('div'),output=h('div'),status=h('p',{class:'t087-status',role:'status','aria-live':'polite'},'核对商品总价与规格后计算。');
    const button=(text,fn)=>h('button',{type:'button',class:'btn',onclick:fn},text);
    const say=text=>{if(alive)status.textContent=text;};
    const invalidate=()=>{report=null;output.replaceChildren();save.disabled=true;say('输入已改变，请重新计算后核对预览。');};
    function field(label,key,row,index,maxlength){
      let control;
      const aria=`商品${index+1} ${label}`;
      if(key==='unit'||key==='currency'){
        const options=key==='unit'?Object.entries(UNITS).map(([value,unit])=>[value,unit.title+' ('+value+')']):CURRENCIES.map(value=>[value,value]);
        control=h('select',{'aria-label':aria,onchange:()=>{row[key]=control.value;invalidate();}},options.map(([value,text])=>h('option',{value},text)));
      }else control=h('input',{type:'text',maxlength,spellcheck:false,'aria-label':aria,inputmode:['quantity','packages','price','shipping'].includes(key)?'decimal':'text',oninput:()=>{row[key]=control.value;invalidate();}});
      control.value=row[key];return h('label',{},label,control);
    }
    function renderEditor(){
      editor.replaceChildren(...draft.map((row,index)=>h('section',{class:'t087-editor','aria-label':`商品${index+1}`},h('strong',{},`商品 ${index+1}`),
        field('名称','name',row,index,120),field('同类比较组','group',row,index,80),field('币种','currency',row,index),
        field('每包装净含量','quantity',row,index,32),field('单位','unit',row,index),field('包装数量','packages',row,index,5),
        field('商品总价（这些包装合计）','price',row,index,32),field('本笔运费','shipping',row,index,32),
        button('删除商品 '+(index+1),()=>{draft.splice(index,1);invalidate();renderEditor();}))));
      add.disabled=draft.length>=50;
    }
    const table=(headers,rows)=>h('div',{class:'t087-scroll'},h('table',{},h('thead',{},h('tr',{},headers.map(text=>h('th',{scope:'col'},text)))),h('tbody',{},rows.map(cells=>h('tr',{},cells.map(text=>h('td',{},String(text))))))));
    function calculate(){
      invalidate();
      try{
        report=comparePurchases(draft.map(row=>({...row})));
        const grouped=report.comparisons.map(group=>h('section',{},h('h3',{},`${group.group} · ${group.currency}/${group.baseUnit}`),
          group.comparable?h('p',{},'按精确单价从低到高排序；同价同名次。'):h('p',{},'只有一项同币种、同量纲商品，无法排名。'),
          table(['原始行','商品','总净含量','商品价 + 运费','每标准单位价格','名次'],group.sourceRows.map(index=>{
            const row=report.rows[index-1];return[index,row.name,row.normalizedQuantity+' '+row.baseUnit,(row.goodsCents/100).toFixed(2)+' + '+(row.shippingCents/100).toFixed(2)+' '+row.currency,row.unitPrice+' '+row.currency+'/'+row.baseUnit,row.rank??'无法比较'];
          }))));
        const invalid=report.rows.filter(row=>!Object.hasOwn(row,'unitPrice'));
        output.replaceChildren(h('p',{class:'t087-summary'},`${report.comparableCount} 项可比较，${report.uncomparableCount} 项无法比较；全部 ${report.rows.length} 项保留。`),...grouped,
          ...(invalid.length?[h('h3',{},'输入有误，未参与排名'),table(['原始行','商品','原因'],invalid.map(row=>[row.sourceRow,row.name,row.issue]))]:[]),
          h('details',{},h('summary',{},'完整审计预览（含精确分数与无效原始行）'),h('pre',{},JSON.stringify(report,null,2))));
        save.disabled=!safeSave();say('比较完成，请核对分组、总价及运费，随后导出新的报告副本。');
      }catch(error){report=null;say(error.message);}
    }
    const files=window.toolbox?.files;
    const safeSave=()=>files?.saveTextSupportsCopyOnly===true&&typeof files.saveText==='function';
    const add=button('添加商品',()=>{if(draft.length>=50)return;draft.push(blank());invalidate();renderEditor();});
    const save=button('导出采购比较 JSON',async()=>{
      if(!report||!safeSave()||exporting)return;
      const snapshot=report;exporting=true;save.disabled=true;
      try{const result=await files.saveText({content:JSON.stringify(snapshot,null,2),extension:'json',defaultName:'T087-purchase-comparison.json',copyOnly:true});say(result?.ok?'报告副本已保存。':result?.canceled?'已取消保存。':'保存失败：'+(result?.error||'未确认成功'));}
      catch(error){say('保存失败：'+error.message);}finally{exporting=false;if(alive)save.disabled=!report||!safeSave();}
    });
    save.disabled=true;
    const panel=h('section',{class:'t087'},h('style',{},css),h('h2',{},'采购规格单价比较'),
      h('p',{},'把同类商品统一成每千克、每升或每件价格，按精确单价排序。'),
      h('p',{class:'t087-muted'},'商品总价是所填包装数量的合计价格，运费每笔只加一次。例：2包各500g、合计商品价30元、运费5元，得到35元/kg。不要将单包价格误填为两包合计。'),
      h('p',{class:'t087-muted'},'同类比较组由你明确填写；只有组名、币种、量纲都相同的至少两项才能排名。支持克/千克、毫升/升、件；不推断品质、密度、汇率或折扣。'),
      h('div',{class:'t087-actions'},button('载入500克与1千克示例',()=>{draft=sample();invalidate();renderEditor();}),add,button('清空输入',()=>{draft=[blank()];invalidate();renderEditor();})),
      editor,h('p',{class:'t087-muted'},'最多50项；金额最多2位小数，净含量最多6位小数，包装数量1–10000整数。每个金额≤50,000,000，净含量>0且≤1,000,000,000。'),
      button('计算并预览单价',calculate),status,output,save,
      h('p',{class:'t087-muted'},'显示单价四位小数、净含量六位小数，采用半入；排名始终比较精确分数，显示相同不一定同价。输入仅在当前面板保留，切换功能会丢失未导出内容。保存时选择新文件，已有路径不能覆盖。'),
      ...(!safeSave()?[h('p',{class:'t087-muted'},'当前版本缺少副本保护接口，导出不可用。')]:[]));
    root.replaceChildren(panel);renderEditor();
    return {activate(){},deactivate(){},destroy(){alive=false;root.replaceChildren();}};
  }
};
