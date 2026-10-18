import { h, toast } from '../../core/ui.js';

/**
 * 论文讲解：贴一个 arXiv 链接，出一条「组会式」对话讲解 mp4（甲主持 + 乙专家）。
 * 读论文、写脚本走配置的 AI 接口；配音用 macOS 系统中文嗓；
 * 画面 + 合成用随包的 papervid（AVFoundation，不依赖 ffmpeg）。
 */
const STYLE = `
.pt{display:flex;flex-direction:column;gap:12px;padding:16px;max-width:860px;margin:0 auto}
.pt__head{display:flex;align-items:baseline;gap:10px}
.pt__row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pt__row .field{flex:1;min-width:200px}
.pt__voice{flex:0 0 auto;min-width:200px}
.pt__cg{width:100%;resize:vertical}
.pt__bar{height:6px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}
.pt__bar-fill{height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,#FB7299,#00AEEC);transition:width .3s}
.pt__status{font-size:12px;min-height:16px}
.pt__card{border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px;margin-top:8px;background:rgba(255,255,255,.03)}
.pt__card-title{font-weight:600;margin-bottom:8px}
.pt__video{width:100%;border-radius:10px;background:#000;display:block;margin-bottom:8px}
.pt__history{display:flex;flex-direction:column;gap:6px}
.pt__hist-row{display:flex;align-items:center;gap:8px}
.pt__hist-name{flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}
.pt__publication label{display:flex;flex-direction:column;gap:6px;margin:10px 0}
.pt__publication label.pt__row{flex-direction:row}
.pt__publication label>.field{width:100%;box-sizing:border-box}
`;

export function createPaperTalk(root, ctx) {
  const { config } = ctx;
  const api = (window.toolbox && window.toolbox.paperTalk) || null;
  let unsub = null;
  let unpublish = null;
  let publicationId = '';
  let busy = false;
  if (!api) { root.append(h('div', { class: 'faint', style: 'padding:16px' }, '论文讲解服务没加载（重启工具箱试试）。')); return { refresh() {}, deactivate() {} }; }

  if (!document.getElementById('pt-style')) {
    const st = document.createElement('style'); st.id = 'pt-style'; st.textContent = STYLE; document.head.appendChild(st);
  }

  const input = h('input', { class: 'field', type: 'text', placeholder: 'arXiv 链接或编号，如 1706.03762 或 https://arxiv.org/abs/1706.03762',
    value: config.get('research.papertalk.last', '') });
  const voiceSel = h('select', { class: 'field pt__voice' },
    h('option', { value: 'mf' }, '配音：男女（Li-mu + 婷婷）'),
    h('option', { value: 'ff' }, '配音：女女（婷婷 + 雨舒）'),
    h('option', { value: 'mm' }, '配音：男男（需另下中文男声）'));
  voiceSel.value = config.get('research.papertalk.voice', 'mf');
  const cg = h('textarea', { class: 'field pt__cg', rows: '3',
    placeholder: 'CogniGuard 一句话简介（可留空）：它解决什么问题、核心方法——用于片尾「CogniGuard 视角」点评',
    value: config.get('research.papertalk.cg', '') });
  const goBtn = h('button', { class: 'btn btn--primary', onclick: run }, '🎬 生成讲解视频');
  const testBtn = h('button', { class: 'btn btn--ghost', onclick: async () => {
    if (busy) return;
    busy = true; goBtn.disabled = true; testBtn.disabled = true;
    setProgress(0, '正在测试 AI 连接…');
    try {
      const r = await api.test();
      setProgress(0, r.ok ? 'AI 连接正常：' + r.model : 'AI 连接失败：' + r.error);
    } catch (e) { setProgress(0, 'AI 连接失败：' + e.message); }
    finally { busy = false; goBtn.disabled = false; testBtn.disabled = false; }
  } }, '测试 AI 连接');

  const bar = h('div', { class: 'pt__bar-fill' });
  const barWrap = h('div', { class: 'pt__bar' }, bar);
  const status = h('div', { class: 'pt__status faint' }, '贴一篇 arXiv 论文，点生成。约 10–15 分钟一条，出片耗时看论文长度。');
  const result = h('div', { class: 'pt__result' });
  const publishPanel = h('div', { class: 'pt__publication' });
  const outline = h('details', { open: '', style: 'border-top:1px solid var(--line);padding-top:10px' });
  const historyWrap = h('div', { class: 'pt__history' });

  function renderPlan(slides) {
    if (!slides?.length) return;
    outline.innerHTML = '';
    outline.append(h('summary', {}, `教学规划：${slides.length} 个主题页 · 方法与实验重点展开`),
      h('ol', { style: 'line-height:1.8;padding-left:24px' }, ...slides.map(s => h('li', {},
        h('strong', {}, `${s.emphasis === 'core' ? '【重点】' : ''}${s.title}`),
        h('div', { class: 'faint', style: 'font-size:12px' }, s.objective),
        h('div', { style: 'font-size:12px' }, s.points.map(p => p.heading).join(' / '))))));
  }

  root.append(h('div', { class: 'pt' },
    h('div', { class: 'pt__head' },
      h('strong', {}, '论文讲解'),
      h('span', { class: 'faint' }, '组会式 · 甲主持 + 乙专家 · 一条 mp4')),
    h('div', { class: 'pt__row' }, input, voiceSel, goBtn, testBtn),
    cg,
    barWrap, status, publishPanel, outline, result,
    h('div', { class: 'pt__head', style: 'margin-top:14px' }, h('strong', {}, '历史'), h('span', { class: 'faint' }, '都在 userData/paper-talk/')),
    historyWrap));

  function setProgress(pct, text) {
    bar.style.width = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + '%';
    if (text != null) status.textContent = text;
  }

  function playerFor(p, title) {
    const vid = h('video', { class: 'pt__video', controls: '', src: 'file://' + p });
    return h('div', { class: 'pt__card' },
      h('div', { class: 'pt__card-title' }, title || p.split('/').pop()),
      vid,
      h('div', { class: 'pt__row' },
        h('button', { class: 'btn btn--sm', onclick: () => api.open(p) }, '▶ 用播放器打开'),
        h('button', { class: 'btn btn--sm btn--primary', onclick: () => publish(p) }, '投稿到哔哩哔哩'),
        h('button', { class: 'btn btn--sm btn--ghost', onclick: () => api.reveal(p) }, '📂 所在文件夹')));
  }

  async function publish(file) {
    if (!api.publishPrepare) { toast('请重启工具箱加载投稿功能'); return; }
    const r = await api.publishPrepare(file);
    if (!r.ok) { toast(r.error); return; }
    const d = r.draft; publicationId = d.id;
    const title = h('input', { class: 'field', value: d.title, maxlength: '80', 'aria-label': '投稿标题' });
    const desc = h('textarea', { class: 'field', rows: '8', value: d.description, maxlength: '2000', 'aria-label': '投稿简介' });
    const tags = h('input', { class: 'field', value: d.tags.join('，'), 'aria-label': '投稿标签' });
    const consent = h('input', { type: 'checkbox' });
    const note = h('div', { class: 'faint', style: 'font-size:12px;line-height:1.7' },
      '扫码登录在B站官方窗口完成，登录状态保存在本机。视频上传后，请核对封面、分区、标签和AI创作声明，最后在B站页面确认发布。');
    const pubStatus = h('div', { class: 'pt__status', id: 'pt-publish-status' }, '尚未上传：先核对视频与文案。');
    const open = h('button', { class: 'btn btn--primary', disabled: true, onclick: async () => {
      open.disabled = true; pubStatus.textContent = '正在打开B站官方投稿窗口…';
      try {
        const sent = await api.publishOpen({ id: d.id, title: title.value, description: desc.value,
          tags: tags.value, consent: consent.checked });
        pubStatus.textContent = sent.ok ? '已打开官方投稿页，请扫码登录并在上传后确认发布。' : '未开始：' + sent.error;
      } catch (e) { pubStatus.textContent = '打开失败：' + e.message; }
      finally { open.disabled = !consent.checked; }
    } }, '开始上传 · 打开B站官方页面');
    consent.addEventListener('change', () => { open.disabled = !consent.checked; });
    publishPanel.innerHTML = '';
    publishPanel.append(h('div', { class: 'pt__card' }, h('strong', {}, '哔哩哔哩投稿预览'),
      h('p', { class: 'faint', style: 'font-size:12px;word-break:break-all' }, `${d.file}（${(d.size / 1024 / 1024).toFixed(1)} MB）`),
      h('label', {}, '标题', title), h('label', {}, '简介与原论文来源', desc), h('label', {}, '标签（逗号分隔）', tags),
      note,
      h('label', { class: 'pt__row', style: 'margin:12px 0;font-size:13px' }, consent, '我确认将以上视频、标题、简介和标签发送至哔哩哔哩'),
      h('div', { class: 'pt__row' }, open,
        h('button', { class: 'btn btn--ghost', onclick: () => api.reveal(d.file) }, '显示视频文件'),
        h('button', { class: 'btn btn--ghost', onclick: async () => { await navigator.clipboard.writeText(desc.value); toast('简介已复制'); } }, '复制简介'),
        h('button', { class: 'btn btn--ghost', onclick: () => { publishPanel.innerHTML = ''; publicationId = ''; } }, '收起预览')),
      pubStatus));
    publishPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function run() {
    if (busy) return;
    const val = input.value.trim();
    if (!val) { toast('先贴一个 arXiv 链接或编号'); return; }
    busy = true; goBtn.disabled = true; goBtn.textContent = '出片中…';
    config.set('research.papertalk.last', val);
    config.set('research.papertalk.voice', voiceSel.value);
    config.set('research.papertalk.cg', cg.value);
    result.innerHTML = '';
    setProgress(2, '开始…');
    try {
      const r = await api.run({ input: val, cogniGuard: cg.value.trim(), voiceMode: voiceSel.value });
      if (r && r.ok) {
        setProgress(100, `完成：${r.title || ''}（${r.pages || 0} 个主题页，${r.segments || 0} 段对话）`);
        result.append(playerFor(r.mp4, r.title));
        if (r.lesson) result.append(h('button', { class: 'btn btn--sm', onclick: () => api.open(r.lesson) }, '打开分层讲义'));
        if (r.srt) result.append(h('button', { class: 'btn btn--sm btn--ghost', onclick: () => api.reveal(r.srt) }, '字幕文件'));
        refresh();
      } else {
        setProgress(0, '失败：' + ((r && r.error) || '未知错误'));
        toast('出片失败：' + ((r && r.error) || ''));
      }
    } catch (e) {
      setProgress(0, '失败：' + e.message);
    } finally {
      busy = false; goBtn.disabled = false; goBtn.textContent = '🎬 生成讲解视频';
    }
  }

  async function refresh() {
    let list = [];
    try { list = await api.list(); } catch { /* */ }
    historyWrap.innerHTML = '';
    if (!list.length) { historyWrap.append(h('div', { class: 'faint' }, '还没有产出。')); return; }
    for (const it of list.slice(0, 12)) {
      historyWrap.append(h('div', { class: 'pt__hist-row' },
        h('span', { class: 'pt__hist-name', title: it.path }, it.name),
        h('button', { class: 'btn btn--sm', onclick: () => api.open(it.path) }, '▶ 打开'),
        h('button', { class: 'btn btn--sm btn--primary', onclick: () => publish(it.path) }, '投稿'),
        h('button', { class: 'btn btn--sm btn--ghost', onclick: () => api.reveal(it.path) }, '📂')));
    }
  }

  // 进度订阅
  if (api.onProgress) unsub = api.onProgress((e) => { if (e) { setProgress(e.pct, e.text); if (e.slides) renderPlan(e.slides); } });
  if (api.plan) api.plan(input.value).then(p => renderPlan(p?.slides)).catch(() => {});
  if (api.onPublishState) unpublish = api.onPublishState(e => {
    if (e?.id !== publicationId) return;
    const el = publishPanel.querySelector('#pt-publish-status');
    if (el) el.textContent = e.text || '';
  });
  refresh();

  return {
    refresh,
    deactivate() { /* Keep progress while the official upload window is open. */ },
    dispose() { if (unsub) unsub(); if (unpublish) unpublish(); },
  };
}
