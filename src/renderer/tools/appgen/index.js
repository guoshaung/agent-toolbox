import { h, toast } from '../../core/ui.js';

// 生成应用:输入一句话需求 → 驱动 agentworld 的 build_new_app 流水线
// (intake 写PRD → 委派 demodata/arch/dev)→ 实时看进度 → 出 PRD / 文件 / 预览。
const api = () => window.toolbox?.appgen;

const EXAMPLES = [
  '做一个极简待办清单小程序,能新增待办、勾选完成、按优先级排序',
  '做一个记账小程序,记录每笔收支、按分类统计、看月度报表',
  '做一个美食探店小程序,首页菜品卡片流、详情页、收藏',
];

export default {
  id: 'appgen',
  title: '生成应用',
  icon: 'zap',
  hint: '一句话 → 驱动 build_new_app 流水线生成应用',

  create(root) {
    if (!api()) {
      root.append(h('div', { class: 'card' }, h('p', { class: 'faint' }, '当前构建未接入生成服务(需 appgen-service)。')));
      return;
    }
    let chatId = null, timer = null;

    // ---- 输入区 ----
    const ta = h('textarea', { class: 'field', rows: 3, placeholder: '用一句话描述你要做的应用…',
      style: 'width:100%;resize:vertical;font-size:14px;line-height:1.6' });
    const genBtn = h('button', { class: 'btn btn--primary', onclick: onGen }, '⚡ 生成应用');
    const stopBtn = h('button', { class: 'btn btn--sm btn--ghost', onclick: onStop, style: 'display:none' }, '停止');
    const statusTag = h('span', { class: 'tag tag--warn', style: 'display:none' }, '');
    const chips = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:10px' },
      ...EXAMPLES.map((e) => h('button', { class: 'btn btn--sm btn--ghost',
        style: 'font-size:12px;text-align:left', onclick: () => { ta.value = e; } }, e.slice(0, 18) + '…')));

    const histSel = h('select', { class: 'field', style: 'max-width:180px;font-size:12px', onchange: (e) => { if (e.target.value) restore(e.target.value); } });
    const inputCard = h('div', { class: 'card' },
      h('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:10px' },
        h('strong', {}, '生成应用'), statusTag, h('span', { style: 'flex:1' }),
        h('span', { class: 'faint', style: 'font-size:12px' }, '最近'), histSel, stopBtn),
      ta,
      h('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:10px' }, genBtn,
        h('span', { class: 'faint', style: 'font-size:12px' }, '走 CodeFlying 全流水线,需数分钟')),
      chips,
    );

    // ---- 进度区 ----
    const sceneEl = h('div', { class: 'faint', style: 'font-size:13px' }, '');
    const narrEl = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    const tasksEl = h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:10px' });
    const progCard = h('div', { class: 'card', style: 'margin-top:10px;display:none' },
      h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' },
        h('strong', {}, '实时进度'), sceneEl),
      narrEl, tasksEl);

    // ---- PRD ----
    const prdPre = h('pre', { style: 'margin:0;max-height:260px;overflow:auto;font-size:12px;line-height:1.6;white-space:pre-wrap' }, '');
    const prdCard = h('details', { class: 'card', style: 'margin-top:10px;display:none' },
      h('summary', { style: 'cursor:pointer;font-weight:600' }, '📄 PRD 需求文档'), prdPre);

    // ---- 文件 / 预览 ----
    const filesEl = h('div', { style: 'font-size:12px;font-family:ui-monospace,monospace;max-height:200px;overflow:auto' });
    const previewBtn = h('button', { class: 'btn btn--sm btn--primary', style: 'display:none' }, '📱 编译并预览');
    const filesCard = h('div', { class: 'card', style: 'margin-top:10px;display:none' },
      h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' },
        h('strong', {}, '生成的文件'), h('span', { style: 'flex:1' }), previewBtn),
      filesEl);

    // 预览区:编译好的 H5 装进手机框 webview
    const frame = h('webview', { style: 'width:100%;height:100%;border:none', partition: 'persist:appgen' });
    const phone = h('div', { style: 'width:390px;max-width:100%;height:760px;margin:0 auto;border-radius:36px;overflow:hidden;background:#000;box-shadow:0 20px 60px rgba(0,0,0,.3);border:10px solid #1d1f26' }, frame);
    const previewCard = h('div', { class: 'card', style: 'margin-top:10px;display:none' },
      h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:10px' },
        h('strong', {}, '📱 应用预览'), h('span', { class: 'faint', style: 'font-size:12px' }, 'uni-app → H5 真编译'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'btn btn--sm btn--ghost', onclick: () => frame.reload && frame.reload() }, '刷新')),
      phone);

    root.append(inputCard, progCard, prdCard, filesCard, previewCard);

    // ---- 逻辑 ----
    async function onGen() {
      const prompt = ta.value.trim();
      if (!prompt) { toast('先写一句应用需求', 'warn'); return; }
      genBtn.disabled = true; statusTag.style.display = ''; statusTag.textContent = '启动中…';
      statusTag.className = 'tag tag--warn';
      const r = await api().start(prompt);
      if (!r.ok) { toast(r.error || '启动失败', 'bad', 6000); genBtn.disabled = false; statusTag.style.display = 'none'; return; }
      chatId = r.chatId;
      stopBtn.style.display = ''; progCard.style.display = 'block';
      toast('已提交,流水线开始跑', 'good');
      startPolling(); refreshHistory();
    }
    async function onStop() {
      if (chatId) await api().stop(chatId);
      stopPolling(); statusTag.textContent = '已停止'; statusTag.className = 'tag tag--bad';
      genBtn.disabled = false; stopBtn.style.display = 'none';
    }
    function startPolling() { stopPolling(); poll(); timer = setInterval(poll, 3000); }
    function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

    async function poll() {
      if (!chatId) return;
      const s = await api().status(chatId);
      if (!s.ok) return;
      statusTag.style.display = '';
      statusTag.textContent = s.running ? `生成中 · ${s.elapsed}s` : '流水线已停';
      statusTag.className = 'tag ' + (s.running ? 'tag--warn' : 'tag--good');
      sceneEl.textContent = s.scene ? `场景:${s.scene}${s.hitTemplate ? ' · 命中模版' : ' · 从零搭建'}` : '';

      narrEl.innerHTML = '';
      (s.narration || []).forEach((n) => narrEl.append(
        h('div', { style: 'font-size:13px;color:var(--fg,#222);padding-left:14px;border-left:2px solid var(--primary,#4d7fff)' }, n)));

      tasksEl.innerHTML = '';
      (s.tasks || []).forEach((t) => {
        const done = t.status === 'completed';
        tasksEl.append(h('div', { style: 'background:var(--bg,#f5f6f8);border-radius:10px;padding:10px 12px' },
          h('div', { style: 'display:flex;align-items:center;gap:8px' },
            h('span', { style: `font-size:11px;padding:1px 7px;border-radius:8px;color:#fff;background:${done ? '#07c160' : '#f5a623'}` }, done ? '完成' : '进行中'),
            h('b', { style: 'font-size:12px' }, t.agent_id)),
          h('div', { class: 'faint', style: 'font-size:12px;margin-top:5px' }, t.name),
          t.actions && t.actions.length ? h('div', { style: 'font-size:11px;color:var(--sub,#888);margin-top:6px' },
            '动作:' + Array.from(new Set(t.actions)).join(' → ')) : null));
      });

      if (s.prdReady) { prdCard.style.display = 'block'; prdPre.textContent = s.prd; }
      if (s.files && s.files.length) {
        filesCard.style.display = 'block';
        filesEl.innerHTML = s.files.map((f) => `<div>${f.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('');
      }
      // 只要生成物里出现了 uni-app 工程(有 pages.json),就允许编译预览
      const hasUniProj = (s.files || []).some((f) => /(^|\/)pages\.json$/.test(f));
      if (hasUniProj || s.previewPath) {
        previewBtn.style.display = '';
        previewBtn.onclick = compileAndPreview;
      }
      if (!s.running) { stopPolling(); genBtn.disabled = false; stopBtn.style.display = 'none'; }
    }

    async function refreshHistory() {
      const runs = await api().listRuns();
      if (!runs || !runs.length) { histSel.innerHTML = '<option value="">（暂无）</option>'; return; }
      histSel.innerHTML = '<option value="">选择…</option>' + runs.map((r) => {
        const label = (r.prompt || r.chatId).slice(0, 16) + (r.running ? ' ·跑' : r.prdReady ? ' ·✓' : '');
        return `<option value="${r.chatId}" ${r.chatId === chatId ? 'selected' : ''}>${label.replace(/</g, '&lt;')}</option>`;
      }).join('');
    }

    // 重连到某次生成(重启后 / 切历史):恢复 UI + 拉一次状态 + 若在跑则续轮询
    async function restore(cid) {
      chatId = cid;
      progCard.style.display = 'block';
      stopBtn.style.display = 'none';
      await poll();               // 先拉一次,填充进度/PRD/文件
      const s = await api().status(cid);
      if (s.ok && s.running) { stopBtn.style.display = ''; startPolling(); }
    }

    async function compileAndPreview() {
      if (!chatId) return;
      previewBtn.disabled = true;
      const old = previewBtn.textContent;
      previewBtn.textContent = '⏳ 编译中(uni build,约 20-60s)…';
      const r = await api().compilePreview(chatId);
      previewBtn.disabled = false; previewBtn.textContent = old;
      if (!r.ok) { toast(r.error || '编译失败', 'bad', 7000); return; }
      previewCard.style.display = 'block';
      frame.src = r.url;
      toast('编译完成,已加载预览', 'good');
      previewCard.scrollIntoView({ behavior: 'smooth' });
    }

    // 首次打开:填历史,并自动重连最近一次(重启后不再空白)
    (async () => {
      await refreshHistory();
      if (!chatId) {
        const runs = await api().listRuns();
        if (runs && runs.length) await restore(runs[0].chatId);
      }
    })();

    return {
      activate() { refreshHistory(); if (chatId && !timer) startPolling(); },
      deactivate() { stopPolling(); },
    };
  },
};
