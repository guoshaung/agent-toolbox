import { h } from '../../core/ui.js';
import { MODEL_VERSION, POLICY, example, buildTree, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';
const KEY = 'features.L019.state';
const PHASES = { before: '插入前', descend: '按范围下降', insert: '叶内插入', overflow: '3键溢出暂态', split: '分裂与提升后', complete: '插入完成' };
export default {
  id: 'L019',
  create(root, ctx = {}) {
    root.classList.add('feature-l019'); let draft = example(); let result = null; let selected = 0; let timer = null; let playback = null; let active = true; let destroyed = false; let exporting = false; let restored = '';
    try { const raw = ctx.config?.get(KEY); if (raw) { draft = { sequence: validateStoredState(raw).sequence }; restored = '已恢复输入草稿；结果/播放位置未存入配置，请重新生成。'; } } catch(error) { restored = `草稿未能恢复：${error.message}`; }
    const notice = h('div', { class: 'l019-notice', role: 'status', 'aria-live': 'polite' }, restored); const storage = h('div', { class: 'l019-notice', role: 'status' }); const editor = h('div'); const output = h('div', { class: 'l019-output' });
    function replace(node,...children) { node.replaceChildren(...children.flat(Infinity).filter((child)=>child!==null&&child!==undefined&&child!==false)); }
    function message(text,error=false) { if (!destroyed) { notice.textContent=text; notice.classList.toggle('is-error',error); } }
    function pause() { if(playback!==null)clearInterval(playback); playback=null; }
    function persist() {
      if(timer!==null)clearTimeout(timer);timer=null;if(!ctx.config?.set)return;let state;
      try {state=prepareStoredState(draft);}catch(error){if(!destroyed)storage.textContent=`${error.message} 当前输入未写入全局配置，关闭后仅能恢复较早草稿；请导出完整JSON。`;return;}
      if(!destroyed)storage.textContent='';try{Promise.resolve(ctx.config.set(KEY,state)).catch(error=>message(`草稿保存失败：${error.message} 请导出完整JSON。`,true));}catch(error){message(`草稿保存失败：${error.message} 请导出完整JSON。`,true);}
    }
    function changed() {pause();result=null;selected=0;renderOutput();message('序列已改变，旧结果和播放已清空，请重新生成。');if(timer!==null)clearTimeout(timer);timer=setTimeout(persist,250);}
    function load(kind){draft=example(kind);changed();renderEditor();persist();message('示例已载入，请生成演示。');}
    function generate(){pause();try{result=buildTree(draft);selected=0;persist();renderOutput();message(`已预计算${result.sequence.length}次插入、${result.frames.length}帧；当前展示首个插入前状态。逐帧查看或播放。`);}catch(error){result=null;renderOutput();message(error.message,true);}}
    function renderEditor(){const input=h('textarea',{class:'field',rows:'4',maxlength:'4096',spellcheck:'false','aria-label':'插入键序列',oninput:()=>{draft.sequence=input.value;changed();}});input.value=draft.sequence;
      replace(editor,h('label',{class:'l019-field'},h('strong',{},'插入键序列'),input),h('p',{},'固定2-3树，不需选阶数。输入1–64个十进制整数，用空格、换行或逗号分隔；范围−1000000至1000000，重复键直接拒绝（包括0与−0），不自动去重。仅插入，不接受代码或删除。'),h('div',{class:'l019-actions'},[['basic','载入10/20/30示例'],['cascade','载入父递归分裂示例'],['mixed','载入混合顺序示例']].map(([kind,label])=>h('button',{class:'btn',onclick:()=>load(kind)},label)),h('button',{class:'btn primary',onclick:generate},'生成 / 重置演示')));
    }
    function pick(index){if(!result||!Number.isInteger(index))return;pause();selected=Math.max(0,Math.min(result.frames.length-1,index));renderOutput();}
    function nextInsertion(){if(!result)return;const next=result.insertions.find((item)=>item.completedFrame>selected);if(next)pick(next.completedFrame);}
    function play(){if(!result||!active||destroyed)return;if(playback!==null){pause();renderOutput();return;}if(selected>=result.frames.length-1)selected=0;playback=setInterval(()=>{if(!active||destroyed||!result){pause();return;}selected++;if(selected>=result.frames.length-1){selected=result.frames.length-1;pause();}renderOutput();},700);renderOutput();}
    function treeNode(node,row){
      const card=h('div',{class:`l019-node${node.keys.length===3?' is-overflow':''}${row.focus.includes(node.id)?' is-focus':''}`,'aria-label':`节点${node.id}，键${node.keys.join('、')}，${node.children.length}个孩子`},h('small',{},`节点${node.id}`),h('div',{class:'l019-keys'},node.keys.map(key=>h('strong',{},String(key)))));
      const children=node.children.length?h('ul',{class:'l019-children'},node.children.map((child,index)=>h('li',{class:'l019-child-slot'},h('span',{class:'l019-edge'},`↓ 孩子${index+1}`),h('ul',{class:'l019-subtree'},treeNode(child,row))))):h('small',{class:'l019-leaf'},'叶');
      return h('li',{class:'l019-branch'},card,children);
    }
    function renderOutput(){const exports=h('div',{class:'l019-actions'},h('button',{class:'btn',onclick:()=>exportReport('json')},'导出完整 JSON'),h('button',{class:'btn',onclick:()=>exportReport('md')},'导出完整 Markdown'));
      if(!result){replace(output,h('p',{},'尚无有效结果，可导出当前输入草稿。'),exports);return;}
      const row=result.frames[selected];const completed=result.insertions.filter(item=>item.completedFrame<=selected).length;
      const selector=h('select',{class:'field','aria-label':'查看演示帧',onchange:()=>pick(Number(selector.value))},result.frames.map((item,index)=>h('option',{value:String(index)},`帧${item.frame} 插入${item.key} · ${PHASES[item.phase]}`)));selector.value=String(selected);
      replace(output,h('p',{class:'l019-summary'},`完整结果已预计算：${result.sequence.length}键，最终树高${result.finalCheck.height}，所有叶深度${result.finalCheck.leafDepth}；当前帧已完成${completed}次插入。播放只查看快照。`),
        h('div',{class:'l019-actions'},selector,h('button',{class:'btn',disabled:selected===0,onclick:()=>pick(selected-1)},'上一帧'),h('button',{class:'btn',disabled:selected===result.frames.length-1,onclick:()=>pick(selected+1)},'下一帧'),h('button',{class:'btn',disabled:selected===result.frames.length-1,onclick:nextInsertion},'完成下一次插入'),h('button',{class:'btn',onclick:play},playback!==null?'暂停播放':'播放演示'),h('button',{class:'btn',onclick:()=>pick(0)},'返回首帧'),h('button',{class:'btn',onclick:()=>pick(result.frames.length-1)},'查看末帧')),
        h('h3',{},`帧${row.frame} / ${result.frames.length} · 第${row.insertion}次插入 ${row.key} · ${PHASES[row.phase]}`),h('p',{},row.reason),h('p',{class:row.check.stable?'l019-valid':'l019-warning'},row.check.stable?'当前帧：有效2-3树（插入是否完成以“插入完成”帧为准）':'当前帧：3键溢出暂态，不是有效2-3树，不得用作完成结果。'),
        h('p',{},`本帧结构检查：排序✓ · 子树范围✓ · 孩子数量✓ · 叶同深✓；键数${row.check.keyCount}，叶深度${row.check.leafDepth}，溢出节点${row.check.overflowNodeIds.join('、')||'无'}。有效节点容量要求：${row.check.stable?'通过':'暂未通过，等待分裂'}。`),row.split?h('p',{class:'l019-promotion'},`本步提升中间键${row.split.median}：节点${row.split.oldNode}原键[${row.split.oldKeys.join(' | ')}] → 左节点${row.split.leftId} / 右节点${row.split.rightId}${row.split.rootSplit?'；建立新根':'；提升到父节点'}`):null,
        h('div',{class:'l019-tree-scroll',role:'group','aria-label':'本帧树结构'},row.tree?h('ul',{class:'l019-tree'},treeNode(row.tree,row)):h('p',{},'空树：尚未插入首个键')),h('p',{},'图中每个节点列出全部键，向下“孩子1/2/3”与连线展示实际父子关系；高亮为本帧涉及节点，橙色表示3键溢出。'),
        h('details',{},h('summary',{},'全部插入完成检查'),h('ol',{},result.insertions.map((item)=>h('li',{},h('button',{class:'btn',onclick:()=>pick(item.completedFrame)},`查看插入${item.key}完成帧`),` 键数${item.check.keyCount}；叶深度${item.check.leafDepth}；有效容量/排序/范围/孩子数/叶深均通过`)))),exports);
    }
    async function exportReport(extension){if(exporting)return;const files=window.toolbox?.files;if(files?.saveTextSupportsCopyOnly!==true){message('当前基础层缺少防覆盖导出能力，请升级后导出。',true);return;}exporting=true;
      try{const payload={feature:'L019',schemaVersion:1,modelVersion:MODEL_VERSION,exportedAt:new Date().toISOString(),draft:JSON.parse(JSON.stringify(draft)),selected,result};const response=await files.saveText({content:extension==='json'?JSON.stringify(payload,null,2):reportMarkdown(payload),extension,defaultName:`L019-23-tree.${extension}`,copyOnly:true});message(response?.ok===true?'已导出新副本，包含完整输入、全部帧和最终树。':response?.canceled===true?'已取消导出，输入及结果保留。':`导出失败：${response?.error||'未确认保存成功'}`,response?.ok!==true&&response?.canceled!==true);}catch(error){message(`导出失败：${error.message}`,true);}finally{exporting=false;}
    }
    root.replaceChildren(h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href}),h('h2',{},'B树分裂演示'),h('p',{},'固定2-3树，用可编辑键序列观察叶溢出、中间键提升与父节点递归分裂。'),notice,storage,h('details',{},h('summary',{},'结构规则与保存范围'),h('p',{},POLICY),h('p',{},'每一帧检查排序、唯一键、孩子数量、子树范围和叶同深；3键仅在标记的暂态允许，完成帧必须满足1或2键。最多1024帧，超限直接拒绝整个结果。'),h('p',{},'配置仅保存schemaVersion=1输入草稿，≤64KiB UTF-8且序列≤4096字节；结果、帧和播放位置不恢复，需重新生成。切走会暂停，不自动续播；完整导出包括全部预计算帧，拒绝覆盖已有文件。')),editor,output);renderEditor();renderOutput();
    return{activate(){active=true;},deactivate(){active=false;pause();persist();if(!destroyed)renderOutput();},destroy(){if(destroyed)return;active=false;pause();persist();destroyed=true;root.replaceChildren();root.classList.remove('feature-l019');}};
  },
};
