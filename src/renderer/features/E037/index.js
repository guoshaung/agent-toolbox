import {h} from '../../core/ui.js';
import {FONT,validateText,layoutText,drawCard,clearCanvas,pngBlob,pngPayload,releaseFrame} from './model.mjs';

export default {id:'E037',create(root){
  let text='',message='可以先写下来，再选择保留或放下。',confirmed=false,reduced=false,active=false,alive=true,generation=0,sequence=0,nativePending=false,localPending=false,raf=null,releaseStart=null;
  let editor,fullPreview,cardHost,status,confirmation,reduceInput,fragmentHost,prepared=null,previewCanvas=null;
  const listeners=[],canvases=new Set(),jobs=new Set(),buttons=[];
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const files=()=>window.toolbox?.files;
  function on(node,type,fn){node.addEventListener(type,fn);listeners.push([node,type,fn]);}
  function wipePrepared(){if(prepared){prepared.lines.fill('');prepared.lines.length=0;prepared=null;}}
  function wipeJobs(){for(const j of jobs){j.text='';if(j.layout){j.layout.lines.fill('');j.layout.lines.length=0;}j.layout=null;j.blob=null;j.payload=null;j.canvas=null;}jobs.clear();}
  function wipeCards(){wipePrepared();for(const canvas of canvases)clearCanvas(canvas);canvases.clear();previewCanvas=null;cardHost?.replaceChildren();}
  function stopAnimation(){if(raf!==null)cancelAnimationFrame(raf);raf=null;releaseStart=null;fragmentHost?.replaceChildren();}
  function detach(){for(const[n,t,f]of listeners)n.removeEventListener(t,f);listeners.length=0;}
  function scrubDOM(){if(editor)editor.value='';if(fullPreview)fullPreview.textContent='';detach();root.replaceChildren();editor=fullPreview=cardHost=status=confirmation=reduceInput=fragmentHost=null;buttons.length=0;}
  function invalidate(){generation++;localPending=false;wipeCards();wipeJobs();}
  function clearBody(){invalidate();text='';confirmed=false;scrubDOM();}
  function update(){
    if(!alive||!editor)return;
    let metrics;try{metrics=validateText(text);}catch(error){message=error.message;}
    status.textContent=message;root.querySelector('[data-metrics]')?.replaceChildren(document.createTextNode(metrics?`${metrics.points}/8000码点 · ${metrics.bytes}/32768 UTF-8字节`:'正文不符合输入限制'));
    editor.disabled=nativePending||!active||document.hidden;confirmation.disabled=nativePending||!active||document.hidden;confirmation.checked=confirmed;
    for(const b of buttons)b.node.disabled=nativePending||!active||document.hidden||(!text&&b.needsText)||(b.kind==='png'&&files()?.saveBinarySupportsCopyOnly!==true)||(b.kind==='txt'&&files()?.saveTextSupportsCopyOnly!==true)||(['png','txt'].includes(b.kind)&&localPending);
    fullPreview.textContent=text;
  }
  function render(){
    scrubDOM();
    editor=h('textarea',{'aria-label':'临时正文',rows:9,style:{width:'100%',boxSizing:'border-box',font:'18px "Microsoft YaHei",sans-serif',lineHeight:'1.7'},spellcheck:'false'});editor.value=text;
    on(editor,'input',()=>{if(nativePending||!alive||!active||document.hidden){editor.value=text;return;}try{validateText(editor.value);}catch(error){editor.value=text;message=error.message;update();return;}stopAnimation();invalidate();text=editor.value;confirmed=false;message='正文只在当前模块临时保留；切走、隐藏或放下会清空。';update();});
    fullPreview=h('pre',{'aria-label':'全文文字预览',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'420px',overflow:'auto',font:'18px "Microsoft YaHei",sans-serif',lineHeight:'1.8'}});
    cardHost=h('div',{'aria-label':'全文文字卡画布',style:{maxHeight:'480px',overflow:'auto'}});
    confirmation=h('input',{type:'checkbox','aria-label':'确认放下并清空当前文字'});on(confirmation,'change',()=>{if(!nativePending)confirmed=confirmation.checked;});
    reduceInput=h('input',{type:'checkbox','aria-label':'减少动效'});reduceInput.checked=reduced;on(reduceInput,'change',()=>{reduced=reduceInput.checked;if(reduced||media?.matches)stopAnimation();});
    status=h('p',{'aria-label':'操作状态',role:'status'});fragmentHost=h('div',{'aria-label':'无文字收尾',style:{height:'130px'}});
    function button(label,fn,kind,needsText=true){const node=h('button',{type:'button'},label);on(node,'click',fn);buttons.push({node,kind,needsText});return node;}
    root.append(h('section',{style:{maxWidth:'960px',margin:'0 auto',padding:'18px'}},h('h2',{},'写完放下'),h('p',{},'写下此刻牵挂的一件事。你可以留一份文字卡，也可以在这里结束。'),h('p',{},'不自动存档；最多8000码点 / 32KiB。切走模块、隐藏窗口或关闭会清空未保留的正文。'),editor,h('p',{'data-metrics':''}),h('div',{},button('生成全文文字卡预览',prepare,'preview'),button('保留完整PNG副本',()=>save('png'),'png'),button('保留全文TXT副本',()=>save('txt'),'txt')),h('p',{},'先核对全文预览。PNG逐行扩展高度；过大时拒绝生成，TXT保留原始全文。制表符在卡片中显示为四个空格。'),fullPreview,cardHost,h('label',{},confirmation,' 确认放下并清空当前文字'),h('div',{},button('放下并清空',release,'release')),h('label',{},reduceInput,' 减少动效（系统偏好也会生效）'),status,fragmentHost,h('p',{},'“放下”清空本模块正文引用、预览、输入和画布。它不是浏览器或操作系统内存的安全擦除；剪贴板和已保存文件不会被删除。')));
    update();
  }
  function prepare(){
    if(nativePending||!text||!alive||!active||document.hidden)return false;
    try{
      wipeCards();const canvas=document.createElement('canvas');canvases.add(canvas);const c=canvas.getContext('2d');if(!c)throw Error('本地画布不可用。');c.font=FONT;
      const layout=layoutText(text,s=>c.measureText(s).width);drawCard(canvas,layout);canvas.style.width='100%';canvas.style.height='auto';canvas.setAttribute('aria-label','完整文字卡');prepared=layout;previewCanvas=canvas;cardHost.replaceChildren(canvas);message=`全文卡片已生成：${layout.lines.length}行，${layout.width}×${layout.height}px。`;update();return true;
    }catch(error){wipeCards();message=error.message;update();return false;}
  }
  async function save(kind){
    if(nativePending||localPending||!alive||!active||document.hidden||!text)return;
    const bridge=files();if((kind==='png'?bridge?.saveBinarySupportsCopyOnly:bridge?.saveTextSupportsCopyOnly)!==true){message='需要支持新副本导出的公共文件接口。';update();return;}
    const token=generation,job={text,layout:null,canvas:null,blob:null,payload:null};jobs.add(job);localPending=true;update();
    const current=()=>alive&&active&&token===generation;
    try{
      validateText(job.text);const name=`write-and-release-${kind==='png'?'card':'text'}-${++sequence}-copy.${kind}`;
      if(kind==='png'){
        if(!prepare())return;
        job.canvas=previewCanvas;const blob=await pngBlob(job.canvas);if(!current())return;job.blob=blob;
        const payload=await pngPayload(blob,name);if(!current())return;job.payload=payload;
      }else job.payload={copyOnly:true,content:job.text,extension:'txt',defaultName:name};
      if(!current())return;
      nativePending=true;localPending=false;message='正在原生另存；完成前暂时锁定正文和放下操作。';update();
      const response=await (kind==='png'?bridge.saveBinary(job.payload):bridge.saveText(job.payload));
      if(!current())return;
      message=response?.ok===true?'已保留新副本。正文仍在这里，需要你明确放下。':response?.canceled?'已取消另存，正文仍在这里。':`保存失败：${response?.error||'未确认写入成功'}${response?.partialPath?'；请人工核对 '+response.partialPath:''}`;
    }catch(error){if(current())message=`未保留副本：${error.message}`;}
    finally{job.text='';job.layout=null;job.canvas=null;job.blob=null;job.payload=null;jobs.delete(job);if(current()){nativePending=false;localPending=false;update();}}
  }
  function fragments(ms){
    if(!fragmentHost)return;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 400 140');svg.setAttribute('width','400');svg.setAttribute('height','130');svg.setAttribute('aria-label','不含文字的纸片');
    for(const f of releaseFrame(ms)){const r=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const[k,v]of Object.entries({x:-8,y:-5,width:16,height:10,fill:'#D8D0BF',opacity:f.opacity,transform:`translate(${f.x} ${f.y}) rotate(${f.angle})`}))r.setAttribute(k,String(v));svg.append(r);}fragmentHost.replaceChildren(svg);
  }
  function animate(now){if(!alive||!active||document.hidden||reduced||media?.matches){stopAnimation();return;}if(releaseStart===null)releaseStart=now;const elapsed=now-releaseStart;fragments(elapsed);if(elapsed<1200)raf=requestAnimationFrame(animate);else{raf=null;releaseStart=null;fragmentHost?.replaceChildren();}}
  function release(){
    if(nativePending||!text||!alive||!active||document.hidden)return;if(!confirmed){message='请先勾选确认，再放下当前文字。';update();return;}
    stopAnimation();clearBody();message='这段文字已经从当前模块放下。现在可以停一会儿。';render();if(active&&!document.hidden&&!reduced&&!media?.matches){releaseStart=performance.now();raf=requestAnimationFrame(animate);}else fragments(0);
  }
  function leave(){stopAnimation();clearBody();nativePending=false;message='这里是新的空白页；离开时的临时正文没有保留。';if(alive)render();}
  const visibility=()=>{if(document.hidden)leave();else update();};document.addEventListener('visibilitychange',visibility);
  const mediaChanged=()=>{if(media.matches)stopAnimation();};media?.addEventListener?.('change',mediaChanged);
  render();
  return {activate(){if(alive){active=true;update();}},deactivate(){active=false;leave();},destroy(){if(!alive)return;active=false;alive=false;stopAnimation();clearBody();document.removeEventListener('visibilitychange',visibility);media?.removeEventListener?.('change',mediaChanged);}};
}};
