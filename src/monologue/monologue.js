'use strict';
/** 内心独白浮窗：只负责把主进程送来的卡片画出来，不做判断。 */

const api = window.toolbox?.monologue;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function setDot(kind, title) {
  $('dot').className = `dot${kind ? ` ${kind}` : ''}`;
  if (title) $('src').textContent = title;
}

function renderCards(data) {
  const body = $('body');
  body.textContent = '';
  if (data.headline) body.append(el('div', 'headline', data.headline));
  for (const card of data.cards || []) {
    const box = el('div', 'q');
    box.append(el('div', 'q-title', card.q));
    card.options.forEach((opt, i) => {
      const row = el('div', `opt${i === 0 ? ' top' : ''}`);
      row.append(el('span', 'opt-label', opt.label));
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.max(2, opt.p)}%`;
      bar.append(fill);
      row.append(bar, el('span', 'pct', `${opt.p}%`));
      box.append(row);
    });
    body.append(box);
  }
  const foot = $('foot');
  const hasFoot = data.risk != null || data.advice;
  foot.hidden = !hasFoot;
  if (hasFoot) {
    const risk = $('risk');
    if (data.risk == null) risk.hidden = true;
    else {
      risk.hidden = false;
      risk.textContent = `危险 ${data.risk}/10`;
      risk.className = `risk ${data.risk >= 7 ? 'high' : data.risk >= 4 ? 'mid' : 'low'}`;
    }
    $('advice').textContent = data.advice || '';
  }
}

function showMessage(text, kind) {
  $('body').replaceChildren(el('div', 'empty', text));
  $('foot').hidden = true;
  setDot(kind);
}

api?.onUpdate?.((payload) => {
  if (!payload) return;
  if (payload.type === 'thinking') {
    setDot('work', payload.text ? `正在读：${payload.text.slice(0, 24)}` : '分析中…');
    return;
  }
  if (payload.type === 'error') {
    showMessage(payload.error || '出错了', 'bad');
    return;
  }
  if (payload.type === 'result') {
    setDot('on', payload.source ? payload.source.slice(0, 30) : '');
    renderCards(payload);
  }
});

// 模板切换
api?.templates?.().then((list) => {
  const sel = $('tpl');
  sel.replaceChildren(...list.map((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.icon} ${t.name}`;
    o.title = t.desc;
    return o;
  }));
  api.status().then((s) => { sel.value = s.template || 'chat'; });
  sel.onchange = () => api.setTemplate(sel.value);
});

// 自动盯窗口
const watchBtn = $('watch');
async function syncWatch() {
  const s = await api.status();
  watchBtn.classList.toggle('on', !!s.watching);
  watchBtn.textContent = s.watching ? '■ 自动' : '▶ 自动';
  if (s.watching) setDot('on', `盯着「${s.app}」`);
}
watchBtn.onclick = async () => {
  const s = await api.status();
  await (s.watching ? api.stopWatch() : api.startWatch());
  syncWatch();
};
$('close').onclick = () => api.hide();
api?.status?.().then(syncWatch);
