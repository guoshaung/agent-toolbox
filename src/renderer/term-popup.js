const termEl = document.getElementById('term');
const content = document.getElementById('content');
const copyBtn = document.getElementById('copy');
const shortcut = document.getElementById('shortcut');
let latest = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function section(label, text) {
  const block = node('section', 'section');
  block.append(node('span', 'label', label), node('p', '', text));
  return block;
}

function render(state) {
  latest = state;
  shortcut.textContent = state.shortcut || '⌘⇧E';
  termEl.textContent = state.term || '术语解释';
  content.replaceChildren();
  if (state.status === 'loading') {
    const loading = node('div', 'popup__loading');
    loading.append(node('span'), document.createTextNode('DeepSeek 正在建立解释和依据…'));
    content.append(loading);
    return;
  }
  if (state.status === 'error') {
    content.append(node('div', 'error', state.error || '解释失败。'));
    return;
  }
  const result = state.result || {};
  content.append(node('p', 'one-line', result.oneLine || ''));
  content.append(section('准确解释', result.definition || ''));
  content.append(section('为什么在这里', result.whyHere || ''));
  const evidenceBlock = node('section', 'section');
  evidenceBlock.append(node('span', 'label', '证据链'));
  for (const [index, item] of (result.evidence || []).entries()) {
    const row = node('div', 'evidence');
    row.append(node('b', '', String(index + 1).padStart(2, '0')), node('span', '', item));
    evidenceBlock.append(row);
  }
  content.append(evidenceBlock, section('最小例子', result.example || ''));
  if (result.uncertainty) content.append(section('确定性', result.uncertainty));
  if (result.searchQueries?.length) {
    const block = node('section', 'section');
    block.append(node('span', 'label', '继续搜索'));
    const queries = node('div', 'queries');
    for (const query of result.searchQueries) {
      const button = node('button', 'query', query);
      button.addEventListener('click', () => window.termPopup.search(query));
      queries.append(button);
    }
    block.append(queries);
    content.append(block);
  }
}

window.termPopup.onState(render);
document.getElementById('close').addEventListener('click', () => window.termPopup.close());
document.getElementById('open').addEventListener('click', () => window.termPopup.openTool());
copyBtn.addEventListener('click', () => {
  if (!latest?.result) return;
  window.termPopup.copy(`${latest.result.term}\n${latest.result.oneLine}\n\n${latest.result.definition}`);
  copyBtn.textContent = '已复制';
  setTimeout(() => { copyBtn.textContent = '复制解释'; }, 1200);
});
