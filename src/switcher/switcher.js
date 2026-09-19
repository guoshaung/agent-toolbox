'use strict';
/**
 * 应用切换栏。⌘Tab 那条栏越往后越分不清是第几个，这里每个应用头上都顶着编号，
 * 比出那个数字就切过去；用鼠标点也行。
 */
const row = document.getElementById('row');
const api = window.toolbox?.switcher;

function render(apps) {
  row.textContent = '';
  (apps || []).slice(0, 9).forEach((app, i) => {
    const card = document.createElement('button');
    card.className = 'app';
    card.dataset.n = String(i + 1);
    const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1);
    const img = document.createElement('img'); img.alt = ''; img.draggable = false;
    if (app.icon) img.src = app.icon;
    const name = document.createElement('span'); name.className = 'name'; name.textContent = app.name;
    card.append(n, img, name);
    card.onclick = () => api?.pick(i + 1);
    row.append(card);
  });
}

function highlight(n) {
  for (const card of row.children) card.classList.toggle('hot', card.dataset.n === String(n));
}

api?.onApps?.(render);
api?.onHighlight?.(highlight);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api?.hide();
  if (/^[1-9]$/.test(e.key)) api?.pick(Number(e.key));
});
document.getElementById('veil').addEventListener('click', (e) => { if (e.target.id === 'veil') api?.hide(); });
