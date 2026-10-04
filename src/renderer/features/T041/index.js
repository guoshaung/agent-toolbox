import { h } from '../../core/ui.js';
import { LIMITS } from './model.mjs';
export default { id: 'T041', create(root) {
  const bridge = window.toolbox?.features, supported = bridge?.callHostSupported === true;
  let active = true, destroyed = false, serial = 0, generation = 0, job = null, busy = false, currentOp = null, engine = null, versions = null, source = null, plan = null, result = null, loaded = false, clearAfter = false, invalidation = Promise.resolve();
  const link = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
  const status = h('p', { class: 't041-status', role: 'status', 'aria-live': 'polite' }, supported ? '先选择可信安装目录并预览查询计划。当前未运行任何程序。' : '缺少生产 Host 桥；本工具无法读媒体或写副本。');
  const engineText = h('pre', { class: 't041-engine' }), sourceText = h('pre', { class: 't041-source' }), planText = h('pre', { class: 't041-plan' }), reportText = h('pre', { class: 't041-report' });
  const rows = h('div', { class: 't041-clips' });
  const video = h('video', { controls: true, muted: true, preload: 'metadata', class: 't041-video', 'aria-label': '完整实际剪接成片预览' }); video.muted = true;
  const review = h('input', { type: 'checkbox', 'aria-label': '已核对完整成片及来源报告' });
  const controls = [];
  const button = (text, fn, enabled) => { const b = h('button', { type: 'button', onclick: fn }, text); controls.push({ b, enabled: enabled || (() => true) }); return b; };
  const engineDefault = button('预览默认引擎查询计划', () => action('engine_plan', {}, r => { engine = r.engine; versions = null; resetSource(); engineText.textContent = JSON.stringify(engine, null, 2); }), () => !busy);
  const engineChoose = button('选择可信引擎目录', () => action('choose_engine', {}, r => { engine = r.engine; versions = null; resetSource(); engineText.textContent = JSON.stringify(engine, null, 2); }), () => !busy);
  const engineConfirm = button('确认运行3次版本和编码器查询', () => action('engine_confirm', { engineToken: engine.token, confirmed: true }, r => { versions = r.versions; engineText.textContent = JSON.stringify({ ...engine, versions }, null, 2); }), () => !!engine && !versions);
  const chooseSource = button('选择本次允许读取的MP4', () => action('choose_source', {}, r => { resetSource(); source = r.source; sourceText.textContent = JSON.stringify(source, null, 2); }), () => !!versions);
  const inspect = button('确认一次只读媒体检查', () => action('inspect_source', { sourceId: source.id, confirmed: true }, r => { resetOutput(); source = r.source; sourceText.textContent = JSON.stringify(source, null, 2); if (!rows.children.length) addRow(0, Math.min(10000, source.media.durationMs)); }), () => !!source && !source.media);
  const add = button('添加保留区间', () => { invalidate(); addRow(0, Math.min(10000, source.media.durationMs)); }, () => !!source?.media && rows.children.length < LIMITS.clips);
  const compare = button('预览时间线与重编码计划', () => { let clips; try { clips = readClips(); } catch { status.textContent = '区间须输入完整的非负整数毫秒，不能留空。'; return; } return action('plan', { sourceId: source.id, clips }, r => { resetOutput(); plan = r.plan; planText.textContent = JSON.stringify(plan.report, null, 2); }); }, () => !!source?.media && rows.children.length > 0);
  const run = button('确认生成实际剪接成片', () => action('run', { planId: plan.id, confirmed: true }, r => { plan = null; result = r.result; loaded = false; review.checked = false; reportText.textContent = JSON.stringify(result.report, null, 2); video.src = result.previewURL; video.load(); }), () => !!plan);
  const save = button('预览后创建视频和报告新目录副本', async () => {
    if (!loaded || !review.checked || !result) return;
    const id = result.id, observedDurationMs = Math.round(video.duration * 1000);
    await action('confirm_preview', { resultId: id, observedDurationMs, confirmed: true }, async () => {
      await action('save', { resultId: id, confirmed: true }, r => { status.textContent = `已创建新目录副本：${r.path}（完整视频和来源报告）`; }, true);
    });
  }, () => !!result && loaded && review.checked);
  const clear = button('清除本次源和临时成片', () => action('clear', {}, () => { resetSource(); status.textContent = '已清除本次源与临时成片；可信引擎仍可使用。'; }), () => !busy);
  const cancel = h('button', { type: 'button', onclick: () => { if (job) { generation++; bridge.cancelHost('T041', job).catch(() => {}); if (currentOp === 'run') resetOutput(); status.textContent = '已请求取消，等待进程关闭；不把未完成成片当作成功。'; } } }, '取消当前操作');
  function refresh() { for (const { b, enabled } of controls) b.disabled = !supported || !active || destroyed || busy || !enabled(); cancel.disabled = !busy || !job; review.disabled = busy || !loaded || !result; for (const el of rows.querySelectorAll('input,button')) el.disabled = busy || !active; }
  function resetOutput() { plan = null; result = null; loaded = false; review.checked = false; planText.textContent = ''; reportText.textContent = ''; video.pause(); video.removeAttribute('src'); video.load(); }
  function resetSource() { resetOutput(); source = null; sourceText.textContent = ''; rows.replaceChildren(); }
  function invalidate() { generation++; resetOutput(); if (supported && active && !busy) invalidation = invalidation.then(() => bridge.callHost('T041', 'discard_result', { jobId: nextJob() })).catch(() => {}); refresh(); }
  function nextJob() { return 'T041-' + crypto.randomUUID() + '-' + (++serial); }
  async function action(op, payload, apply, nested = false) {
    if ((!nested && busy) || !active || destroyed || !supported) return;
    if (op === 'engine_plan' || op === 'choose_engine') { engine = null; versions = null; engineText.textContent = ''; resetSource(); }
    else if (op === 'choose_source') resetSource();
    else if (op === 'inspect_source' || op === 'plan') resetOutput();
    else if (op === 'run') plan = null;
    const id = nextJob(), ticket = generation; job = id; busy = true; currentOp = op; refresh(); status.textContent = `正在执行：${op}。源文件只读；生成/保存取消会等待自己的资源收尾。`;
    try {
      await invalidation;
      const r = await bridge.callHost('T041', op, { ...payload, jobId: id });
      if (ticket !== generation || !active || destroyed) { if (op === 'run') bridge.callHost('T041', 'discard_result', { jobId: nextJob() }).catch(() => {}); return; }
      if (r?.ok !== true) { status.textContent = r?.canceled ? '已取消；保留已有预览以便重新核对。' : `操作失败：${r?.code || r?.error || 'INVALID_HOST_RECEIPT'}${r?.partialPath ? '。需人工核对部分目录：' + r.partialPath : ''}`; return; }
      status.textContent = op === 'run' ? '实际成片与完整报告已就绪。请播放/逐段核对，确认后再创建新目录。' : '操作完成，请核对当前计划或结果。';
      if (op === 'confirm_preview') { busy = false; job = null; refresh(); }
      await apply(r);
    } catch { if (ticket === generation && active && !destroyed) status.textContent = '操作失败：HOST_CALL_FAILED'; }
    finally { if (job === id) { job = null; busy = false; currentOp = null; } if (clearAfter && !busy) { clearAfter = false; bridge.callHost('T041', 'clear', { jobId: nextJob() }).catch(() => {}); } if (!destroyed) refresh(); }
  }
  function readClips() { return [...rows.children].map(row => { const inputs = row.querySelectorAll('input'); if ([...inputs].some(i => !/^\d{1,6}$/.test(i.value))) throw Error('range'); return { startMs: Number(inputs[0].value), endMs: Number(inputs[1].value) }; }); }
  function addRow(start, end) {
    const row = h('div', { class: 't041-clip' });
    const input = (label, value) => h('label', {}, label, h('input', { type: 'number', min: '0', max: '120000', step: '1', value, 'aria-label': label, oninput: invalidate }));
    const move = direction => { const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling; if (!sibling) return; invalidate(); if (direction < 0) rows.insertBefore(row, sibling); else rows.insertBefore(sibling, row); };
    row.append(input('起点毫秒', start), input('终点毫秒', end), h('button', { type: 'button', onclick: () => move(-1), 'aria-label': '区间上移' }, '↑'), h('button', { type: 'button', onclick: () => move(1), 'aria-label': '区间下移' }, '↓'), h('button', { type: 'button', onclick: () => { invalidate(); row.remove(); refresh(); } }, '移除'));
    rows.append(row); refresh();
  }
  video.addEventListener('loadedmetadata', () => { loaded = !!result && Number.isFinite(video.duration) && Math.abs(video.duration * 1000 - result.report.output.actualDurationMs) <= 100; if (!loaded && result) status.textContent = '成片浏览器时长无法核验，暂不允许保存。'; refresh(); });
  video.addEventListener('error', () => { loaded = false; if (result) status.textContent = 'Chromium无法播放该实际成片，预览未通过，保存已阻止。'; refresh(); });
  review.addEventListener('change', refresh);
  const panel = h('section', { class: 't041' }, h('h2', {}, '视频片段剪接台'), h('p', {}, '单个MP4：H.264 8bit、最多单条AAC。最多8段，毫秒区间按列表顺序拼接，可重排与重复。真实重编码为30fps/H.264+可选48kHz AAC，最长120秒。源≤64MiB，成片<20MiB。'), h('p', {}, '先预览固定执行计划并确认，再生成完整成片；视频默认静音。未支持多音轨/字幕/旋转/HDR/外部引用/网络源。切换或退出清除本次源和临时结果，不存全局配置。'), status, h('div', { class: 't041-actions' }, engineDefault, engineChoose, engineConfirm), engineText, h('div', { class: 't041-actions' }, chooseSource, inspect), sourceText, h('h3', {}, '保留区间（原视频毫秒，终点不包含）'), rows, h('div', { class: 't041-actions' }, add, compare, run, cancel, clear), planText, h('h3', {}, '完整实际成片与来源报告'), video, reportText, h('label', { class: 't041-review' }, review, '我已核对实际成片、全部区间顺序、声音和完整来源报告。'), h('p', {}, '下一步原生对话框选择全新目录名称；目录内 edited.mp4 + edit-report.json，已有文件或目录拒绝，不覆盖源。目录可能记录本机目标路径，请自行决定分享范围。'), save);
  root.replaceChildren(link, panel); refresh();
  function suspend() { if (!active) return; active = false; generation++; if (job) bridge?.cancelHost('T041', job).catch(() => {}); resetSource(); status.textContent = '已暂停并清除本次源和成片。返回后需重新选择源。'; if (supported) { if (busy) clearAfter = true; else invalidation = invalidation.then(() => bridge.callHost('T041', 'clear', { jobId: nextJob() })).catch(() => {}); } refresh(); }
  const visibility = () => { if (document.hidden) suspend(); };
  document.addEventListener('visibilitychange', visibility);
  return { activate() { if (destroyed) return; active = true; refresh(); }, deactivate: suspend, destroy() { suspend(); destroyed = true; document.removeEventListener('visibilitychange', visibility); root.replaceChildren(); } };
} };
