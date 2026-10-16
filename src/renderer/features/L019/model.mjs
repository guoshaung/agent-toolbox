export const MODEL_VERSION = 'L019-23-tree-v1';
export const POLICY = '固定2-3树：有效节点1或2键，内部节点有键数+1个孩子，所有叶同深。整数−1000000至1000000、1–64个、重复直接拒绝。插入只发生在叶；3键是临时溢出，提升中间键，将左右两键分到两个节点；父溢出继续向上分裂。仅完成帧作为插入结果，不支持删除或真实数据库。';
const clone = (value) => JSON.parse(JSON.stringify(value));
const bytes = (value) => new TextEncoder().encode(value).byteLength;
export function example(kind = 'basic') { return { sequence: kind === 'cascade' ? '1, 2, 3, 4, 5, 6, 7' : kind === 'mixed' ? '20, 10, 30, 5, 15, 25, 35, 1, 7, 12, 17' : '10, 20, 30' }; }
export function parseSequence(text) {
  if (typeof text !== 'string' || bytes(text) > 4096) throw new Error('序列须为≤4096 UTF-8字节文本');
  const trimmed = text.trim(); if (!trimmed) throw new Error('请输入1–64个整数键');
  const parts = trimmed.split(/[\s,，]+/); if (parts.length > 64) throw new Error('最多64个键，超限拒绝而不截断');
  const seen = new Set(); return parts.map((part) => {
    if (!/^-?\d+$/.test(part)) throw new Error(`非法键 ${part}：只接受十进制整数，不接受表达式/代码`);
    const value = Number(part); if (!Number.isSafeInteger(value) || Math.abs(value) > 1000000) throw new Error('整数范围−1000000至1000000');
    if (seen.has(value)) throw new Error(`重复键 ${value}：请明确删除重复输入，系统不自动去重`); seen.add(value); return value;
  });
}
export function inorder(root) { if (!root) return []; const result = []; root.keys.forEach((key,index) => { if(root.children.length) result.push(...inorder(root.children[index])); result.push(key); }); if(root.children.length) result.push(...inorder(root.children.at(-1))); return result; }
export function checkTree(root, { allowOverflow = false } = {}) {
  if (root === null) return { ok: true, stable: true, keyCount: 0, leafDepth: 0, height: 0, overflowNodeIds: [] };
  const ids = new Set(); const keys = new Set(); const depths = new Set(); const overflowNodeIds = [];
  function visit(node, min, max, depth) {
    if (!node || typeof node !== 'object' || !Number.isInteger(node.id) || node.id < 1 || ids.has(node.id)) throw new Error('节点标识无效或重复'); ids.add(node.id);
    if (!Array.isArray(node.keys) || node.keys.length < 1 || node.keys.length > (allowOverflow ? 3 : 2)) throw new Error('节点键数不满足1或2（暂态最多3）');
    if (!Array.isArray(node.children) || (node.children.length !== 0 && node.children.length !== node.keys.length + 1)) throw new Error('内部节点孩子数量须为键数+1');
    let previous = min;
    for (const key of node.keys) { if (!Number.isSafeInteger(key) || Math.abs(key) > 1000000 || key <= previous || key >= max || keys.has(key)) throw new Error('键排序/唯一性/子树范围不变量失败'); previous = key; keys.add(key); }
    if (node.keys.length === 3) overflowNodeIds.push(node.id);
    if (!node.children.length) depths.add(depth);
    else node.children.forEach((child,index) => visit(child,index === 0 ? min : node.keys[index - 1],index === node.keys.length ? max : node.keys[index],depth + 1));
  }
  visit(root,-Infinity,Infinity,0); if (depths.size !== 1) throw new Error('所有叶子必须同深'); if (overflowNodeIds.length > 1) throw new Error('此模型只允许单个递归溢出节点');
  const leafDepth = [...depths][0]; return { ok: true, stable: overflowNodeIds.length === 0, keyCount: keys.size, leafDepth, height: leafDepth + 1, overflowNodeIds };
}
export function buildTree(draft) {
  const sequence = parseSequence(draft?.sequence); let root = null; let nextId = 1; const frames = []; const insertions = [];
  const node = (keys, children = []) => ({ id: nextId++, keys, children });
  function frame(phase, key, inserted, reason, focus = [], split = null) {
    if (frames.length >= 1024) throw new Error('超过1024帧上限，拒绝完成，不截断');
    const check = checkTree(root, { allowOverflow: true });
    frames.push({ frame: frames.length + 1, insertion: inserted + 1, key, phase, reason, focus, split, tree: clone(root), check });
  }
  for (let index = 0; index < sequence.length; index++) {
    const key = sequence[index]; frame('before',key,index,`准备插入${key}，当前树是有效2-3树`);
    if (!root) root = node([key]);
    else {
      const path = []; let leaf = root;
      while (leaf.children.length) { const childIndex = leaf.keys.findIndex((value) => key < value); const slot = childIndex < 0 ? leaf.keys.length : childIndex; frame('descend',key,index,`${key}按键范围进入节点${leaf.id}的第${slot + 1}个孩子`,[leaf.id,leaf.children[slot].id]); path.push({ parent: leaf, slot }); leaf = leaf.children[slot]; }
      leaf.keys.push(key); leaf.keys.sort((a,b)=>a-b); frame(leaf.keys.length === 3 ? 'overflow' : 'insert',key,index,`叶节点${leaf.id}加入${key}${leaf.keys.length === 3 ? '形成3键溢出暂态，尚不是有效结果' : '，键排序有效'}`,[leaf.id]);
      while (leaf.keys.length === 3) {
        const [leftKey,median,rightKey] = leaf.keys; const oldChildren = leaf.children; const left = { id: leaf.id, keys: [leftKey], children: oldChildren.slice(0,2) }; const right = node([rightKey],oldChildren.slice(2)); const split = { oldNode: leaf.id, oldKeys: [...leaf.keys], median, leftId: left.id, rightId: right.id, rootSplit: path.length === 0 };
        if (!path.length) { root = node([median],[left,right]); frame('split',key,index,`根分裂：提升${median}到新根${root.id}，左右为${leftKey}/${rightKey}，树高增加1`,[root.id,left.id,right.id],split); break; }
        const { parent, slot } = path.pop(); parent.keys.splice(slot,0,median); parent.children.splice(slot,1,left,right); leaf = parent;
        frame(parent.keys.length === 3 ? 'overflow' : 'split',key,index,`分裂节点${split.oldNode}，提升${median}到父节点${parent.id}${parent.keys.length === 3 ? '；父形成3键溢出，需继续分裂' : '；父仍有效'}`,[parent.id,left.id,right.id],split);
      }
    }
    const check = checkTree(root); if (check.keyCount !== index + 1) throw new Error('完成帧键总数不匹配'); frame('complete',key,index,`插入${key}完成：排序、孩子数量、子树范围、叶同深均通过`,[root.id]); insertions.push({ key, completedFrame: frames.length - 1, tree: clone(root), check });
  }
  return { modelVersion: MODEL_VERSION, input: clone(draft), sequence, frames, insertions, finalTree: clone(root), finalCheck: checkTree(root), sortedKeys: inorder(root) };
}
export function prepareStoredState(draft) { if (typeof draft?.sequence !== 'string') throw new Error('草稿字段类型不合法'); const state = { schemaVersion: 1, sequence: draft.sequence }; if (bytes(JSON.stringify(state)) > 65536) throw new Error('草稿超过64KiB UTF-8限制'); if (bytes(state.sequence) > 4096) throw new Error('序列草稿超过4096字节'); return state; }
export function validateStoredState(raw) { if (bytes(JSON.stringify(raw)) > 65536) throw new Error('草稿超过64KiB UTF-8限制'); if (raw?.schemaVersion !== 1) throw new Error('草稿版本不支持'); return prepareStoredState(raw); }
const escape = (text) => String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function reportMarkdown(payload) {
  const sections = ['# L019 B树分裂演示',POLICY,'## 完整输入',`\`\`\`json\n${escape(JSON.stringify(payload.draft,null,2))}\n\`\`\``];
  if (!payload.result) sections.push('尚未生成有效结果。');
  else { const result = payload.result; sections.push('## 最终结果',`排序键：${result.sortedKeys.join(', ')}；叶深度${result.finalCheck.leafDepth}；树高${result.finalCheck.height}；所有插入完成。报告包含预计算的完整结果，当前界面查看帧为${(payload.selected ?? 0) + 1}。`);
    for(const row of result.frames) sections.push(`### 帧${row.frame} 插入${row.key} ${row.phase}`,escape(row.reason),`状态：${row.check.stable ? '有效2-3树' : '溢出暂态，不是插入结果'}；结构检查通过。`,`\`\`\`json\n${escape(JSON.stringify({tree:row.tree,split:row.split,check:row.check},null,2))}\n\`\`\``);
    sections.push('## 完整模型记录',`\`\`\`json\n${escape(JSON.stringify(result,null,2))}\n\`\`\``);
  } sections.push('## 范围与保存','仅插入2-3树，不执行用户代码或数据库操作。配置只保存有界版本输入草稿，不恢复结果；结果须重新计算或保留完整导出副本。'); return sections.join('\n\n');
}
