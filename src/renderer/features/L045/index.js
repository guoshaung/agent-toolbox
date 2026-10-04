import { h } from '../../core/ui.js';
import { ROLES, exampleDraft, validateDraft, moveBlock, moveSibling, addBlock, removeBlock, makeReport, reportJson, reportMarkdown } from './model.mjs';
const KEY = 'features.L045.draft', TYPE = 'application/x-toolbox-l045-block', channels = new WeakMap();
function channelFor(config) {
  if (!config || typeof config !== 'object' || typeof config.set !== 'function') return null;
  if (!channels.has(config)) channels.set(config, { owner: null, pending: null, latest: null, running: false, ticket: 0 });
  return channels.get(config);
}
async function drain(config, channel) {
  channel.running = true;
  try { while (channel.pending) { const item = channel.pending; channel.pending = null;
    try { await config.set(KEY, item.value); if (!channel.pending && channel.owner === item.owner && channel.ticket === item.ticket) item.done(); }
    catch (error) { if (!channel.pending && channel.owner === item.owner && channel.ticket === item.ticket) item.done(error); }
  } } finally { channel.running = false; }
}
export default { id: 'L045', create(root, ctx = {}) {
  root.classList.add('feature-l045'); let draft = exampleDraft(), report = null, active = true, destroyed = false, exporting = false, selectedBlock = 'C', dragging = null, dragCard = null;
  const channel = channelFor(ctx.config), owner = {}; if (channel) channel.owner = owner;
  const notice = h('div', { class: 'l045-notice', role: 'status', 'aria-live': 'polite' }), storage = h('div', { class: 'l045-notice' }), editor = h('div'), treeHost = h('div'), output = h('div');
  function clearDrag() { dragging = null; dragCard?.classList.remove('is-dragging'); dragCard = null; }
  const live = () => active && !destroyed, replace = (node, ...items) => node.replaceChildren(...items.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false));
  function message(value, error = false) { if (live()) { notice.textContent = value; notice.classList.toggle('is-error', error); } }
  function persist() {
    if (!channel || channel.owner !== owner) return;
    const ticket = ++channel.ticket; let value;
    try { value = validateDraft(draft, { forStorage: true }); }
    catch (e) { if (!destroyed) storage.textContent = `草稿未保存：${e.message}；关闭只能恢复较早合法输入。`; return; }
    channel.latest = value; channel.pending = { value, owner, ticket, done(e) { if (destroyed) return; storage.textContent = e ? `草稿保存未确认：${e.message}` : '仅schema1完整输入/人工层级/顺序/约束草稿≤64KiB已保存，不存派生报告；原句及出处为用户记录。'; } };
    if (!channel.running) void drain(ctx.config, channel);
  }
  function invalidate() { clearDrag(); report = null; renderOutput(); renderTree(); persist(); message('输入/顺序已改变，旧检查失效；请主动核对用户约束。'); }
  function textField(label, value, limit, change, rows = 0) {
    const node = h(rows ? 'textarea' : 'input', { class: 'field', type: rows ? undefined : 'text', rows: rows ? String(rows) : undefined, maxlength: String(limit * 2), 'aria-label': label, oninput: () => { if (!live()) return; change(node.value); invalidate(); } }); node.value = value; return node;
  }
  function choice(label, value, rows, change) {
    const node = h('select', { class: 'field', 'aria-label': label, onchange: () => { if (!live()) return; change(node.value); } }, rows.map(([id, title]) => h('option', { value: id }, title))); node.value = value; return node;
  }
  function mutate(action) {
    if (!live()) return;
    try { draft = action(); if (!draft.blocks.some(b => b.id === selectedBlock) || selectedBlock === draft.rootId) selectedBlock = draft.blocks.find(b => b.id !== draft.rootId)?.id ?? ''; invalidate(); renderEditor(); }
    catch (e) { message(`操作整项拒绝：${e.message}；之前层级保留。`, true); renderEditor(); }
  }
  function move(id, parentId, beforeId = null) { mutate(() => moveBlock(draft, id, parentId, beforeId)); }
  function renderEditor() {
    replace(editor, h('section', { class: 'l045-card' }, h('h3', {}, '原句与人工出处（不解析、不核验）'),
      h('label', {}, '来源名，空项为未说明', textField('来源名', draft.source.label, 160, v => draft.source.label = v)),
      h('label', {}, '原句/上下文，保留完整用户输入，≤16000码点', textField('原句上下文', draft.source.originalText, 16000, v => draft.source.originalText = v, 4)),
      h('label', {}, '出处/原句位置，空项为未说明', textField('出处说明', draft.source.location, 320, v => draft.source.location = v))),
      h('h3', {}, '人工句块与父节点'), h('p', {}, `根${draft.rootId}为人工主句框架；其他句块父节点必须已知、不成环。角色是用户标注，不从原句自动推导。`),
      h('div', { class: 'l045-grid' }, draft.blocks.map(block => {
        const parent = draft.parents.find(p => p.id === block.id).parentId;
        return h('section', { class: 'l045-card' }, h('strong', {}, `${block.id}${block.id === draft.rootId ? ' · 固定根' : ''}`),
          h('label', {}, '人工角色', choice(`${block.id}角色`, block.role, Object.entries(ROLES), value => { block.role = value; invalidate(); })),
          h('label', {}, '句块文本，非空≤240码点', textField(`${block.id}句块`, block.text, 240, value => block.text = value, 2)),
          block.id === draft.rootId ? h('p', {}, '父节点：无（根）') : h('label', {}, '实际父节点', choice(`${block.id}父节点`, parent, draft.blocks.filter(b => b.id !== block.id).map(b => [b.id, `${b.id} · ${ROLES[b.role]}`]), value => move(block.id, value))),
          h('div', { class: 'l045-actions' }, h('button', { class: 'btn', disabled: block.id === draft.rootId, onclick: () => mutate(() => moveSibling(draft, block.id, -1)) }, `${block.id}同级前移`), h('button', { class: 'btn', disabled: block.id === draft.rootId, onclick: () => mutate(() => moveSibling(draft, block.id, 1)) }, `${block.id}同级后移`), h('button', { class: 'btn', disabled: block.id === draft.rootId, onclick: () => mutate(() => removeBlock(draft, block.id)) }, `删除${block.id}`)));
      })), h('button', { class: 'btn', disabled: draft.blocks.length >= 12, onclick: () => mutate(() => addBlock(draft)) }, '添加人工句块'),
      h('h3', {}, '用户父节点约束（不是自动语法规则）'),
      draft.constraints.map(row => h('section', { class: 'l045-card' }, h('strong', {}, row.id),
        h('label', {}, '被约束子块', choice(`${row.id}子块`, row.childId, draft.blocks.filter(b => b.id !== draft.rootId).map(b => [b.id, b.id]), value => { row.childId = value; invalidate(); })),
        h('label', {}, '用户要求的父节点', choice(`${row.id}目标父节点`, row.expectedParentId, draft.blocks.map(b => [b.id, `${b.id} · ${ROLES[b.role]}`]), value => { row.expectedParentId = value; invalidate(); })),
        h('label', {}, '人工依据，空项为未说明', textField(`${row.id}依据`, row.basis, 320, value => row.basis = value)),
        h('button', { class: 'btn', onclick: () => { if (!live()) return; draft.constraints = draft.constraints.filter(r => r.id !== row.id); invalidate(); renderEditor(); } }, `删除约束${row.id}`))),
      h('div', { class: 'l045-actions' }, h('button', { class: 'btn', onclick: () => {
        if (!live()) return; const child = draft.blocks.find(b => b.id !== draft.rootId && !draft.constraints.some(row => row.childId === b.id));
        if (!child || draft.constraints.length >= 12) { message('没有未约束非根句块或已达约束上限。', true); return; }
        const id = Array.from({ length: 12 }, (_, i) => `K${i + 1}`).find(id => !draft.constraints.some(row => row.id === id)); draft.constraints.push({ id, childId: child.id, expectedParentId: draft.rootId, basis: '' }); invalidate(); renderEditor();
      } }, '添加用户约束'), h('button', { class: 'btn primary', onclick: check }, '检查用户父节点约束'), h('button', { class: 'btn', onclick: () => { if (!live()) return; draft = exampleDraft(); selectedBlock = 'C'; dragging = null; invalidate(); renderEditor(); message('已装入C挂在V下的单错误练习；请主动检查。'); } }, '重置单错误示例')));
  }
  function dropZone(parentId, beforeId = null) {
    const label = beforeId ? `移到${beforeId}前（父${parentId}）` : `挂到${parentId}末尾`;
    const node = h('button', { class: 'l045-drop', type: 'button', dataset: { parent: parentId, before: beforeId ?? '' }, 'aria-label': label,
      onclick: () => { if (!selectedBlock) { message('先选择非根移动块。', true); return; } move(selectedBlock, parentId, beforeId); },
      ondragenter: event => { if (live()) event.preventDefault(); },
      ondragover: event => { if (live()) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; } },
      ondrop: event => { event.preventDefault(); event.stopPropagation(); if (!live()) return; const id = event.dataTransfer?.getData(TYPE) || dragging; dragging = null; if (!id) { message('拖放未提供本沙盘句块ID，未移动。', true); return; } move(id, parentId, beforeId); }
    }, `拖到这里 / 点击：${label}`); return node;
  }
  function renderTree() {
    let view; try { view = makeReport(draft); } catch (e) { replace(treeHost, h('p', { class: 'l045-error' }, `当前输入不能构造树：${e.message}；编辑表单修正，未显示旧树或部分树。`)); return; }
    const selector = choice('选择移动块', selectedBlock, draft.blocks.filter(b => b.id !== draft.rootId).map(b => [b.id, `${b.id} · ${b.text}`]), value => { selectedBlock = value; message(`已选择${value}，可点击目标区或拖动句块。`); });
    function draw(node) {
      const card = h('div', { class: 'l045-drag', draggable: node.id !== draft.rootId ? 'true' : 'false', dataset: { block: node.id }, 'aria-label': `${node.id}树句块`,
        ondragstart: event => { if (!live() || node.id === draft.rootId) { event.preventDefault(); return; } dragging = node.id; selectedBlock = node.id; selector.value = node.id; if (event.dataTransfer) { event.dataTransfer.setData(TYPE, node.id); event.dataTransfer.effectAllowed = 'move'; } dragCard = card; card.classList.add('is-dragging'); },
        ondragend: clearDrag
      }, h('strong', {}, `${node.id} · ${ROLES[node.role]}`), node.text);
      return h('li', { class: 'l045-node', role: 'treeitem', 'aria-expanded': node.children.length ? 'true' : undefined }, card,
        h('ul', { role: 'group' }, node.children.map(child => [h('li', { role: 'none' }, dropZone(node.id, child.id)), draw(child)]), h('li', {}, dropZone(node.id))));
    }
    replace(treeHost, h('section', { class: 'l045-card' }, h('h3', {}, '当前人工树与同级排序（尚不等于约束检查结论）'), h('p', {}, '拖动有ID的块到目标区：末尾区修改父节点，前置区调整目标同级顺序；拖动父块携带整棵子树。也可选择移动块后点击目标区，或用上方父节点/同级前后移控件。'), h('label', {}, '键盘/点击操作选择', selector), h('ul', { class: 'l045-tree', role: 'tree', 'aria-label': '用户句块树' }, draw(view.tree)), h('p', {}, `完整树先序ID：${view.preorderIds.join(' → ')}。先序只是层级展示，不是自动生成正确语句。`)));
  }
  function check() { if (!live()) return; report = null;
    try { report = makeReport(draft); message(report.status === 'no-declared-constraints' ? '没有声明父节点约束，未提供语法正确性判断。' : `只核对用户声明：${report.totals.declaredConstraints}条约束，未满足${report.totals.unsatisfied}条；不评价未声明规则或语言能力。`); }
    catch (e) { message(`检查整份拒绝：${e.message}；没有完整报告。`, true); }
    renderOutput();
  }
  function renderOutput() {
    if (!report) { replace(output, h('p', {}, '尚无有效约束报告；人工修改后需要重新检查。')); return; }
    replace(output, h('section', { class: 'l045-card' }, h('h3', {}, `用户约束${report.totals.declaredConstraints}条 · 未满足${report.totals.unsatisfied}条`),
      report.errors.length ? h('ul', { class: 'l045-error', 'aria-label': '未满足约束' }, report.errors.map(e => h('li', { dataset: { constraint: e.constraintId } }, `${e.constraintId} · 仅父节点错误：${e.message}；人工依据：${e.basis || '未说明'}`))) : h('p', { class: 'l045-ok' }, report.status === 'no-declared-constraints' ? '未声明约束，不判断正确性。' : '全部已声明父节点约束满足；不证明语法或表达正确。'),
      h('p', {}, `来源：${report.input.source.label || '未说明'}；出处：${report.input.source.location || '未说明'}`), h('pre', { class: 'l045-preview' }, report.input.source.originalText),
      h('div', { class: 'l045-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['约束', '子块', '实际父节点', '用户目标父节点', '是否满足', '人工依据'].map(value => h('th', {}, value)))), h('tbody', {}, report.constraintResults.map(row => h('tr', {}, [row.id, row.childId, row.actualParentId, row.expectedParentId, row.satisfied ? '是' : '否', row.basis || '未说明'].map(value => h('td', {}, value))))))),
      h('ul', {}, report.definitions.map(value => h('li', {}, value))),
      h('details', {}, h('summary', {}, '完整JSON预览'), h('pre', { class: 'l045-preview' }, reportJson(report))), h('details', {}, h('summary', {}, '完整Markdown预览'), h('pre', { class: 'l045-preview' }, reportMarkdown(report))),
      h('div', { class: 'l045-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出完整 Markdown'))));
  }
  async function exportReport(extension) {
    if (!live() || !report || exporting) return; const files = window.toolbox?.files;
    if (files?.saveTextSupportsCopyOnly !== true) { message('基础桥没有防覆盖副本能力，未调用保存，请升级。', true); return; }
    let content; try { content = extension === 'json' ? reportJson(report) : reportMarkdown(report); } catch (e) { message(e.message, true); return; }
    exporting = true;
    try { const response = await files.saveText({ content, extension, defaultName: `L045-user-syntax-tree.${extension}`, copyOnly: true }); message(response?.ok === true ? '完整人工树与约束报告新副本已保存，来源未写回。' : response?.canceled === true ? '保存已取消，报告保留。' : `导出失败：${response?.error || '未确认ok===true'}`, response?.ok !== true && response?.canceled !== true); }
    catch (e) { message(`导出失败：${e.message}`, true); } finally { exporting = false; }
  }
  try { const raw = channel?.latest && (channel.running || channel.pending) ? channel.latest : ctx.config?.get?.(KEY); if (raw) { draft = validateDraft(raw, { forStorage: true }); selectedBlock = draft.blocks.find(b => b.id !== draft.rootId)?.id ?? ''; message('已恢复完整输入/人工树/顺序/约束草稿；派生报告不恢复，请重新检查。'); } }
  catch (e) { message(`草稿未恢复：${e.message}；保留示例。`, true); }
  root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '句法重排沙盘'), h('p', {}, '显式句块与父子关系练习，仅核对用户约束；不自动解析任意语句、不做语法/认知评分或标准认证。'), notice, storage,
    h('details', {}, h('summary', {}, '规则、容量与来源边界'), h('p', {}, '1–12句块，固定一个主句框架根；人工角色为主句/从句/名词/动词/修饰。句块文本非空≤240码点；用户约束≤12条，父子关系和目标约束都不能成环。删除有子块或被约束引用的节点须先人工解除，拒绝隐式丢失。'), h('p', {}, '原句≤16000码点，来源名≤160、出处/约束依据≤320；总输入≤128KiB，JSON/MD各≤1MiB，超限整份拒绝。配置只存schema1输入草稿≤64KiB、不存报告，大型输入关闭不能恢复，先导出完整报告。导出包含原句和全部标注。无AI、媒体、网络、后台扫描或自动文件改写。')), editor, treeHost, output);
  renderEditor(); renderTree(); renderOutput();
  return { activate() { if (!destroyed) active = true; }, deactivate() { if (destroyed) return; active = false; clearDrag(); persist(); }, destroy() { if (destroyed) return; persist(); destroyed = true; active = false; clearDrag(); report = null; draft = exampleDraft(); root.replaceChildren(); root.classList.remove('feature-l045'); } };
} };
