import { h, toast } from '../../core/ui.js';

// AipexBase —— 移植进容器的公司开源 BaaS(CodeFlying 后端)。
// 这个面板管起停、跑开通、并直接读写真实数据(通过主进程代理 baas-api,无 CORS)。
const api = () => window.toolbox?.aipexbase;

const PRI = { 1: ['低', '#4d7fff', '#eef2ff'], 2: ['中', '#f5a623', '#fff6e6'], 3: ['高', '#ff5a5f', '#ffecec'], 5: ['!', '#ff5a5f', '#ffecec'] };

export default {
  id: 'aipexbase',
  title: 'AipexBase',
  icon: 'plug',
  hint: '公司开源 BaaS 后端:起停 + 真实数据读写',

  create(root) {
    if (!api()) {
      root.append(h('div', { class: 'card' }, h('p', { class: 'faint' }, '当前构建未接入 AipexBase 服务(需要主进程 aipexbase-service)。')));
      return;
    }

    // ---- 顶部:状态 + 操作 ----
    const statusTag = h('span', { class: 'tag tag--warn' }, '检查中…');
    const appIdTag = h('span', { class: 'faint', style: 'font-size:12px' }, '');
    const btnStart = h('button', { class: 'btn btn--sm btn--primary', onclick: onStart }, '启动');
    const btnStop = h('button', { class: 'btn btn--sm btn--ghost', onclick: onStop }, '停止');
    const btnProv = h('button', { class: 'btn btn--sm btn--ghost', onclick: onProvision }, '开通 demo');
    const btnRefresh = h('button', { class: 'btn btn--sm btn--ghost', onclick: () => refresh(), title: '刷新状态' }, '↻');

    const head = h('div', { class: 'card' },
      h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' },
        h('strong', {}, 'AipexBase 服务'), statusTag, h('span', { style: 'flex:1' }), btnRefresh, btnStart, btnStop, btnProv),
      h('div', { style: 'margin-top:6px' }, appIdTag),
    );

    // ---- 日志 ----
    const logPre = h('pre', { style: 'margin:0;max-height:180px;overflow:auto;font-size:11px;line-height:1.5;white-space:pre-wrap' }, '');
    const logBox = h('details', { class: 'card', style: 'margin-top:10px' },
      h('summary', { style: 'cursor:pointer;font-weight:600' }, '服务日志'), logPre);

    // ---- 真实数据:todos ----
    const inp = h('input', { class: 'field', placeholder: '新增一条待办…', style: 'flex:1',
      onkeydown: (e) => { if (e.key === 'Enter') addRow(); } });
    const addBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: addRow }, '添加');
    const rowsBox = h('div', {});
    const dataCard = h('div', { class: 'card', style: 'margin-top:10px' },
      h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' },
        h('strong', {}, '真实数据 · todos'),
        h('span', { class: 'faint', style: 'font-size:11px' }, 'baas-api /api/data/invoke')),
      h('div', { style: 'display:flex;gap:8px;margin-bottom:10px' }, inp, addBtn),
      rowsBox,
    );

    root.append(head, dataCard, logBox);

    // ---- 逻辑 ----
    function setStatus(running) {
      statusTag.textContent = running ? '运行中 · :8080' : '未运行';
      statusTag.className = `tag ${running ? 'tag--good' : 'tag--bad'}`;
      btnStart.disabled = running;
      btnStop.disabled = !running;
      btnProv.disabled = !running;
    }

    async function refresh() {
      const s = await api().status();
      setStatus(s.running);
      appIdTag.textContent = s.appId ? `应用 appId:${s.appId}   ·   ${s.baseUrl}` : (s.running ? '尚未开通应用,点「开通 demo」' : `容器:${s.suiteDir}`);
      logPre.textContent = s.log || '(暂无日志)';
      if (s.running && s.appId) loadRows();
      else rowsBox.innerHTML = '';
    }

    async function onStart() {
      btnStart.disabled = true; statusTag.textContent = '启动中…(Spring Boot 冷启约 50s)'; statusTag.className = 'tag tag--warn';
      const r = await api().start();
      if (!r.ok) toast(r.error || '启动失败', 'bad', 6000); else toast(r.note || 'AipexBase 已就绪', 'good');
      refresh();
    }
    async function onStop() {
      btnStop.disabled = true;
      await api().stop();
      toast('已停止', 'info');
      refresh();
    }
    async function onProvision() {
      btnProv.disabled = true; toast('开通中…', 'info');
      const r = await api().provision();
      if (!r.ok) toast(r.error || '开通失败', 'bad', 6000); else toast(`已开通:${r.appId}`, 'good');
      refresh();
    }

    async function loadRows() {
      const r = await api().data('list', {});
      if (!r.ok) { rowsBox.innerHTML = ''; rowsBox.append(h('p', { class: 'faint' }, r.error || '读取失败')); return; }
      const rows = (r.data || []).slice().sort((a, b) => (a.done - b.done) || (b.priority - a.priority) || (a.id - b.id));
      rowsBox.innerHTML = '';
      if (!rows.length) { rowsBox.append(h('p', { class: 'faint', style: 'text-align:center;padding:16px' }, '还没有数据,加一条试试 👆')); return; }
      for (const row of rows) rowsBox.append(renderRow(row));
    }

    function renderRow(row) {
      const [plabel, pcolor, pbg] = PRI[row.priority] || ['P' + row.priority, '#8a90a0', '#f0f2f5'];
      const check = h('span', {
        style: `width:20px;height:20px;border-radius:50%;flex:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border:2px solid ${row.done ? '#07c160' : '#d5d9e2'};background:${row.done ? '#07c160' : 'transparent'};color:#fff;font-size:12px`,
        onclick: async () => { await api().data('update', { id: row.id, done: row.done ? 0 : 1 }); loadRows(); },
      }, row.done ? '✓' : '');
      const txt = h('span', { style: `flex:1;${row.done ? 'color:#b4bac6;text-decoration:line-through' : ''}` }, row.title || '');
      const pri = h('span', { style: `flex:none;font-size:11px;font-weight:600;padding:2px 8px;border-radius:8px;color:${pcolor};background:${pbg}` }, plabel);
      const del = h('button', { class: 'btn btn--sm btn--ghost', style: 'color:#ff5a5f;padding:2px 8px',
        onclick: async () => { await api().data('delete', { id: row.id }); toast('已删除', 'info'); loadRows(); } }, '✕');
      return h('div', { style: 'display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--line,#eef0f5)' }, check, txt, pri, del);
    }

    async function addRow() {
      const v = inp.value.trim(); if (!v) return;
      inp.value = '';
      const r = await api().data('add', { title: v, done: 0, priority: 2 });
      if (!r.ok) toast(r.error || '写入失败', 'bad', 5000); else { toast('已添加', 'good'); loadRows(); }
    }

    refresh();
    let timer = null;
    return {
      activate() { refresh(); if (!timer) timer = setInterval(refresh, 8000); },
      deactivate() { if (timer) { clearInterval(timer); timer = null; } },
    };
  },
};
