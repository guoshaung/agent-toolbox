import { h } from '../../core/ui.js';
import { MODEL_VERSION, example, analyze, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';
const KEY = 'features.L030.state', PAGE = 20;
const outputText = value => value.ok ? `${value.type}: ${String(value.value)}` : `运行错误：${value.error}`;
function astText(node, indent = '') { const label = node.kind === 'variable' ? node.name : node.kind === 'literal' ? String(node.value) : node.op; return `${indent}${label} [${node.type}]\n${node.child ? astText(node.child, indent + '  ') : node.left ? astText(node.left, indent + '  ') + astText(node.right, indent + '  ') : ''}`; }
export default {
  id: 'L030',
  create(root, ctx = {}) {
    root.classList.add('feature-l030'); let draft = example(), report = null, running = false, controller = null, timer = null, waitTimer = null, resolveWait = null, destroyed = false, exporting = false, filter = 'counterexample', page = 0, restored = '';
    try { const raw = ctx.config?.get(KEY); if (raw) { const state = validateStoredState(raw); draft = { left: state.left, right: state.right, variables: state.variables }; restored = '已恢复输入草稿，AST/已检查结果不保存，请重新穷举。'; } } catch (error) { restored = `草稿未恢复：${error.message}`; }
    const notice = h('div', { class: 'l030-notice', role: 'status', 'aria-live': 'polite' }, restored), storage = h('div', { class: 'l030-notice', role: 'status' }), editor = h('div'), output = h('div');
    function replace(node, ...items) { node.replaceChildren(...items.flat(Infinity).filter(item => item !== null && item !== undefined && item !== false)); }
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null; if (!ctx.config?.set) return; let state;
      try { state = prepareStoredState(draft); } catch (error) { if (!destroyed) storage.textContent = `${error.message} 当前草稿未写入配置，关闭只能恢复较早输入；请导出完整JSON。`; return; }
      if (!destroyed) storage.textContent = ''; try { Promise.resolve(ctx.config.set(KEY, state)).catch(error => message(`保存失败：${error.message}，请导出完整输入/结果。`, true)); } catch (error) { message(`保存失败：${error.message}`, true); }
    }
    function changed() { report = null; filter = 'counterexample'; page = 0; renderOutput(); message('输入已改变，旧AST/反例已清空，请重新穷举。'); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function load(kind) { if (running) return; draft = example(kind); changed(); renderEditor(); persist(); }
    function expressionField(key, label) { const input = h('textarea', { class: 'field', rows: '3', maxlength: '2048', spellcheck: 'false', disabled: running, 'aria-label': label, oninput: () => { if (running) return; draft[key] = input.value; changed(); } }); input.value = draft[key]; return h('label', { class: 'l030-label' }, h('strong', {}, label), input); }
    function renderEditor() {
      replace(editor, h('div', { class: 'l030-expressions' }, expressionField('left', '左表达式'), expressionField('right', '右表达式')), h('div', { class: 'l030-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['变量','唯一有限域（空格/逗号分隔）','操作'].map(text => h('th', {}, text)))), h('tbody', {}, draft.variables.map((row, index) => {
        const name = h('select', { class: 'field', disabled: running, 'aria-label': `变量${index + 1}名称`, onchange: () => { if (running) return; draft.variables[index].name = name.value; changed(); } }, ['x','y','z'].map(value => h('option', { value }, value))); name.value = row.name;
        const values = h('textarea', { class: 'field', rows: '3', maxlength: '2048', disabled: running, 'aria-label': `变量${index + 1}输入域`, oninput: () => { if (running) return; draft.variables[index].values = values.value; changed(); } }); values.value = row.values;
        return h('tr', {}, h('td', {}, name), h('td', {}, values), h('td', {}, h('button', { class: 'btn', disabled: running || draft.variables.length === 1, onclick: () => { if (running) return; draft.variables.splice(index,1); changed(); renderEditor(); } }, `删除变量${index + 1}`)));
      })))), h('p', {}, '变量1–3个，名仅x/y/z不可重复；每域1–100唯一整数(±1000000)或true/false，同变量不能混类型，Cartesian≤10000。表达式/每域各≤2048 UTF-8字节。支持+ - *、== != < <= > >=、&& || !、括号、一元+/-；不支持小数、除法、调用、属性或JS。'),
        h('div', { class: 'l030-actions' }, h('button', { class: 'btn', disabled: running || draft.variables.length >= 3, onclick: () => { if (running) return; const name = ['x','y','z'].find(value => !draft.variables.some(row => row.name === value)); draft.variables.push({ name, values:'-1 0 1 2' }); changed(); renderEditor(); } }, '增加变量'), [['integer','载入整数反例'],['demorgan','载入德摩根真值表'],['precedence','载入优先级示例']].map(([kind,label]) => h('button',{class:'btn',disabled:running,onclick:()=>load(kind)},label)), h('button',{class:'btn primary',disabled:running,onclick:start},'开始完整穷举'), h('button',{class:'btn',disabled:!running,onclick:cancel},'取消穷举')));
    }
    function releaseWait() { if (waitTimer !== null) clearTimeout(waitTimer); waitTimer = null; const resolve = resolveWait; resolveWait = null; resolve?.(); }
    function waitControl() { return new Promise(resolve => { resolveWait = resolve; if (controller?.signal.aborted) releaseWait(); else waitTimer = setTimeout(releaseWait,0); }); }
    function cancel() { controller?.abort(); releaseWait(); if (running) message('正在取消，已检查行保留；未完成不作域内等价结论。'); }
    async function start() {
      if (running || destroyed) return; running = true; report = null; filter = 'counterexample'; page = 0; controller = new AbortController(); renderEditor(); renderOutput(); persist();
      try { const result = await analyze(draft, { signal:controller.signal, yieldControl:waitControl, onProgress: value => { if (!destroyed) { report=value; renderOutput(); } } }); if (!destroyed) { report=result; message(`${result.status==='completed'?'完成':'已取消'}：${result.checked}/${result.total}，反例${result.counterexamples}，运行错误${result.errors}。${result.conclusion}`); } }
      catch(error) { if (!destroyed) { report=null; message(error.message,true); } }
      finally { releaseWait(); running=false; controller=null; if (!destroyed) { renderEditor(); renderOutput(); persist(); } }
    }
    function renderOutput() {
      const exports=h('div',{class:'l030-actions'},h('button',{class:'btn',onclick:()=>exportReport('json')},'导出完整 JSON'),h('button',{class:'btn',onclick:()=>exportReport('md')},'导出完整 Markdown'));
      if(!report) { replace(output,h('p',{},running?'正在解析/检查类型…':'尚无有效穷举结果，可导出草稿。'),exports);return; }
      const filtered=report.rows.filter(row=>filter==='all'||row.kind===filter), maxPage=Math.max(0,Math.ceil(filtered.length/PAGE)-1);page=Math.min(page,maxPage);const listed=filtered.slice(page*PAGE,(page+1)*PAGE);
      const selector=h('select',{class:'field','aria-label':'结果筛选',onchange:()=>{filter=selector.value;page=0;renderOutput();}},[['counterexample','仅反例'],['runtimeError','仅运行错误'],['match','仅一致'],['all','全部已检查']].map(([value,label])=>h('option',{value},label)));selector.value=filter;
      replace(output,h('section',{class:'l030-summary'},h('h3',{},`${report.status==='completed'?'已完整检查':report.status==='cancelled'?'已取消，仅部分':'进行中'} ${report.checked}/${report.total}`),h('p',{},`一致${report.matches} · 反例${report.counterexamples} · 运行错误${report.errors}`),h('p',{},report.conclusion)),h('h3',{},'实际检查域与类型'),h('ul',{},report.compiled.domain.variables.map(row=>h('li',{},`${row.name}: ${row.type} · {${row.values.map(value=>String(value.value)).join(', ')}}`))),h('p',{},'Cartesian顺序：按变量行顺序，最后一行变化最快。结果是同类型且同值才一致。'),
        h('details',{},h('summary',{},'类型AST与token数'),h('div',{class:'l030-expressions'},h('pre',{},`左：${report.compiled.left.tokens} tokens / ${report.compiled.left.type}\n${astText(report.compiled.left.ast)}`),h('pre',{},`右：${report.compiled.right.tokens} tokens / ${report.compiled.right.type}\n${astText(report.compiled.right.ast)}`))),
        h('div',{class:'l030-actions'},selector,h('button',{class:'btn',disabled:page===0,onclick:()=>{page--;renderOutput();}},'上一页'),h('span',{},`第${page+1}/${maxPage+1}页 · 筛选${filtered.length}行 · 当前${listed.length}行`),h('button',{class:'btn',disabled:page>=maxPage,onclick:()=>{page++;renderOutput();}},'下一页')),h('p',{},'筛选/分页只影响界面；导出保留全部已检查行、完整域与AST。未完成报告明确标部分，不补造未检查结果。'),h('div',{class:'l030-scroll'},h('table',{},h('thead',{},h('tr',{},['域序号','变量赋值','左结果','右结果','分类'].map(text=>h('th',{},text)))),h('tbody',{},listed.map(row=>h('tr',{},h('td',{},String(row.index)),h('td',{},Object.entries(row.input).map(([name,value])=>`${name}=${String(value.value)} [${value.type}]`).join('；')),h('td',{},outputText(row.left)),h('td',{},outputText(row.right)),h('td',{},row.kind==='match'?'一致':row.kind==='counterexample'?'反例':'运行域错误')))))),exports);
    }
    async function exportReport(extension) {
      if(exporting)return;const files=window.toolbox?.files;if(files?.saveTextSupportsCopyOnly!==true){message('当前基础层缺少防覆盖导出能力，请升级后导出。',true);return;}exporting=true;
      try{const payload={feature:'L030',schemaVersion:1,modelVersion:MODEL_VERSION,exportedAt:new Date().toISOString(),draft:JSON.parse(JSON.stringify(draft)),result:report};const response=await files.saveText({content:extension==='json'?JSON.stringify(payload,null,2):reportMarkdown(payload),extension,defaultName:`L030-finite-equivalence.${extension}`,copyOnly:true});message(response?.ok===true?'已导出完整新副本，包含全部已检查行；筛选未截断导出。':response?.canceled===true?'已取消导出，输入/结果保留。':`导出失败：${response?.error||'未确认保存成功'}`,response?.ok!==true&&response?.canceled!==true);}catch(error){message(`导出失败：${error.message}`,true);}finally{exporting=false;}
    }
    root.replaceChildren(h('link',{rel:'stylesheet',href:new URL('./style.css',import.meta.url).href}),h('h2',{},'表达式等价挑战'),h('p',{},'有限域内找反例；同值必须同类型，运行错误不能当等价。'),notice,storage,h('details',{},h('summary',{},'语义、上限与保存范围'),h('p',{},'优先级从高到低：一元!/+/-，*，+/-，< <= > >=，== !=，&&，||；二元同级左结合。&&/||按布尔值短路；所有分支先静态检查类型，未执行分支也不能写bool+int。比较两表达式的结果类型可以不同，按反例报告。'),h('p',{},'整数用BigInt精确计算；输入/字面量±1000000，每次中间结果≤128十进制位(符号不计)，超限单独报运行域错误。两个错误不算一致。token≤128，AST/括号嵌套≤32；无浮点、除法、函数、赋值或JS。'),h('p',{},'每50输入让出事件循环；最多10000行，取消/切走终止并保留部分报告，未完成不声称域内一致。配置schemaVersion=1只存输入，JSON≤64KiB UTF-8，恢复重算AST/结果，超限不写配置且关闭只能恢复较早草稿。无后台任务，无域外等价证明。')),editor,output);
    renderEditor();renderOutput();return{activate(){},deactivate(){cancel();persist();},destroy(){if(destroyed)return;cancel();persist();destroyed=true;root.replaceChildren();root.classList.remove('feature-l030');}};
  },
};
