'use strict';
/**
 * 覆盖层：把解读卡片画在对应气泡旁边。
 *
 * 位置全用百分比（OCR 出来的就是归一化坐标），所以微信窗口一缩放、一滚动，
 * 主进程重新 OCR 推一批新坐标过来，卡片就跟着走。这一层鼠标完全穿透，
 * 点击照样落到微信上。
 */
const stage = document.getElementById('stage');
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function buildCard(item) {
  const card = el('div', `card${item.pending ? ' pending' : ''}`);
  card.append(el('span', 'tag', 'JEV'));
  card.append(el('div', 'head', item.pending ? '读这句' : (item.headline || '')));
  if (!item.pending) {
    for (const q of (item.cards || []).slice(0, 2)) {
      card.append(el('div', 'q-title'));
      q.options.slice(0, 2).forEach((o, i) => {
        const row = el('div', `row${i === 0 ? ' top' : ''}`);
        row.append(el('span', 'lbl', o.label), el('span', 'pct', `${o.p}%`));
        card.append(row);
      });
    }
    if (item.risk != null || item.advice) {
      const foot = el('div', 'foot');
      if (item.risk != null) {
        const r = el('span', `risk ${item.risk >= 7 ? 'high' : item.risk >= 4 ? 'mid' : 'low'}`, `${item.risk}/10`);
        foot.append(r);
      }
      if (item.advice) foot.append(el('span', 'advice', item.advice));
      card.append(foot);
    }
  }
  // 贴在气泡左下方，稍微往右缩一点，像是从那句话里长出来的
  card.style.left = `${(item.x * 100).toFixed(2)}%`;
  card.style.top = `${(item.y * 100).toFixed(2)}%`;
  return card;
}

window.toolbox?.overlay?.onCards?.((items) => {
  stage.replaceChildren(...(items || []).map(buildCard));
});
