import { h } from '../../core/ui.js';
export default { id: 'T043', create(root) {
  const bridge = window.toolbox?.features, supported = bridge?.callHostSupported === true;
  let active = true, destroyed = false, serial = 0, generation = 0, job = null, busy = false, currentOp = null, engine = null, versions = null, source = null, plan = null, result = null, clearAfter = false, invalidation = Promise.resolve();
  const loaded = new Map(), images = new Map(), controls = [];
  const status = h('p', { class: 't043-status', role: 'status', 'aria-live': 'polite' }, supported ? '先选择可信安装目录并预览查询计划。当前未运行任何程序。' : '缺少生产 Host 桥，无法读媒体或写副本。');
  const engineText = h('pre', { class: 't043-engine' }), sourceText = h('pre', { class: 't043-source' }), planText = h('pre', { class: 't043-plan' }), reportText = h('pre', { class: 't043-report' }), gallery = h('div', { class: 't043-gallery', 'aria-label': '全部真实帧图片预览' }), contact = h('div', { 'aria-label': '真实联系表预览' }), table = h('div', { 'aria-label': '完整帧PTS时间索引' });
  const mode = h('select', { 'aria-label': '提取模式', onchange: invalidate }, h('option', { value: 'points' }, '指定时间点'), h('option', { value: 'interval' }, '固定间隔（从0开始）'));
  const points = h('textarea', { 'aria-label': '指定时间点毫秒', maxlength: '1024', oninput: invalidate }, '0, 5000, 9000'); points.value = '0, 5000, 9000';
  const interval = h('input', { type: 'number', min: '100', max: '120000', step: '1', value: '5000', 'aria-label': '固定间隔毫秒', oninput: invalidate });
  const review = h('input', { type: 'checkbox', 'aria-label': '已核对全部真实帧和联系表与时间索引', onchange: refresh });
  const button = (text, fn, enabled = () => true) => { const b = h('button', { type: 'button', onclick: fn }, text); controls.push({ b, enabled }); return b; };
  const engineDefault = button('预览默认引擎查询计划', () => action('engine_plan', {}, r => { engine = r.engine; engineText.textContent = JSON.stringify(engine, null, 2); }));
  const engineChoose = button('选择可信引擎目录', () => action('choose_engine', {}, r => { engine = r.engine; engineText.textContent = JSON.stringify(engine, null, 2); }));
  const engineConfirm = button('确认运行3次版本和PNG编码器查询', () => action('engine_confirm', { engineToken: engine.token, confirmed: true }, r => { versions = r.versions; engineText.textContent = JSON.stringify({ ...engine, versions }, null, 2); }), () => !!engine && !versions);
  const chooseSource = button('选择本次允许读取的MP4', () => action('choose_source', {}, r => { source = r.source; sourceText.textContent = JSON.stringify(source, null, 2); }), () => !!versions);
  const inspect = button('确认一次只读媒体检查', () => action('inspect_source', { sourceId: source.id, confirmed: true }, r => { source = r.source; sourceText.textContent = JSON.stringify(source, null, 2); points.value = source.media.durationMs > 9000 ? '0, 5000, 9000' : '0'; }), () => !!source && !source.media);
  const compare = button('预览全部请求与固定执行计划', () => {
    let selection; try { selection = readSelection(); } catch { status.textContent = '请输入1–32个不重复非负整数毫秒（逗号/空格分隔），或至少100ms的整数间隔。'; return; }
    return action('plan', { sourceId: source.id, selection }, r => { plan = r.plan; planText.textContent = JSON.stringify(plan.report, null, 2); });
  }, () => !!source?.media);
  const run = button('确认提取全部实际帧和联系表', () => action('run', { planId: plan.id, confirmed: true }, r => { result = r.result; displayResult(); }), () => !!plan);
  const save = button('预览后创建PNG索引联系表新目录副本', async () => {
    if (!result || !allLoaded() || !review.checked) return; const id = result.id;
    const observations = result.images.map(img => ({ path: img.path, width: loaded.get(img.path).width, height: loaded.get(img.path).height }));
    await action('confirm_preview', { resultId: id, observations, confirmed: true }, async () => { await action('save', { resultId: id, confirmed: true }, r => { status.textContent = `已创建新目录副本：${r.path}（${r.files.length}个完整文件）`; }, true); });
  }, () => !!result && allLoaded() && review.checked);
  const clear = button('清除本次源和临时画面', () => action('clear', {}, () => { resetSource(); status.textContent = '已清除源和临时画面，引擎仍可使用。'; }));
  const cancel = h('button', { type: 'button', onclick: () => { if (job) { generation++; bridge.cancelHost('T043', job).catch(() => {}); if (currentOp === 'run') resetOutput(); status.textContent = '已请求取消，等待自己的进程关闭；未完成提帧不会作为成功结果。'; } } }, '取消当前操作');
  function nextJob() { return 'T043-' + crypto.randomUUID() + '-' + (++serial); }
  function allLoaded() { return !!result && loaded.size === result.images.length && result.images.every(i => loaded.has(i.path)); }
  function refresh() { for (const { b, enabled } of controls) b.disabled = !supported || !active || destroyed || busy || !enabled(); cancel.disabled = !busy || !job; review.disabled = busy || !allLoaded(); mode.disabled = points.disabled = interval.disabled = busy || !active || !source?.media; points.hidden = mode.value === 'interval'; interval.hidden = mode.value !== 'interval'; }
  function resetOutput() { plan = null; result = null; review.checked = false; loaded.clear(); for (const img of images.values()) img.removeAttribute('src'); images.clear(); gallery.replaceChildren(); contact.replaceChildren(); table.replaceChildren(); planText.textContent = ''; reportText.textContent = ''; }
  function resetSource() { resetOutput(); source = null; sourceText.textContent = ''; }
  function invalidate() { generation++; resetOutput(); if (supported && active && !busy) invalidation = invalidation.then(() => bridge.callHost('T043', 'discard_result', { jobId: nextJob() })).catch(() => {}); refresh(); }
  function readSelection() { if (mode.value === 'points') { if (points.value.length > 1024) throw Error('limit'); const tokens = points.value.trim().split(/[,\s]+/); if (tokens.length < 1 || tokens.length > 32 || tokens.some(t => !/^\d{1,6}$/.test(t))) throw Error('points'); return { mode: 'points', timesMs: tokens.map(Number), intervalMs: null }; } if (mode.value !== 'interval' || !/^\d{1,6}$/.test(interval.value)) throw Error('interval'); return { mode: 'interval', timesMs: null, intervalMs: Number(interval.value) }; }
  function displayResult() {
    const token = result.id; loaded.clear(); review.checked = false; reportText.textContent = JSON.stringify(result.report, null, 2);
    const rows = result.report.frames.map(f => h('tr', {}, ...[f.sequence, f.requestedMs, f.actualMs, `${f.pts} × ${f.timeBase.numerator}/${f.timeBase.denominator}s`, f.deltaMs, `${f.contactPosition.row},${f.contactPosition.column}`, f.path].map(v => h('td', {}, v))));
    table.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, ...['序号', '请求ms', '实际ms', '源PTS/时基', '偏差ms', '联系表行,列', 'PNG'].map(v => h('th', { scope: 'col' }, v)))), h('tbody', {}, ...rows)));
    for (const item of result.images) {
      const img = h('img', { alt: item.path === 'contact-sheet.png' ? '按索引行列拼接的全部真实帧联系表' : item.path + ' 真实源画面', ...(item.path === 'contact-sheet.png' ? { class: 't043-contact' } : {}) });
      img.addEventListener('load', () => { if (result?.id !== token || destroyed) return; if (img.naturalWidth !== item.width || img.naturalHeight !== item.height) { status.textContent = '画面解码尺寸不符，禁止导出。'; loaded.delete(item.path); } else loaded.set(item.path, { width: img.naturalWidth, height: img.naturalHeight }); refresh(); });
      img.addEventListener('error', () => { if (result?.id !== token || destroyed) return; loaded.delete(item.path); status.textContent = '画面无法完整解码，禁止导出。'; refresh(); });
      images.set(item.path, img); img.src = item.previewURL;
      if (item.path === 'contact-sheet.png') contact.append(h('figure', {}, img, h('figcaption', {}, '联系表按行从左到右；行列与上方索引一一对应。黑色空格不代表额外帧。')));
      else { const f = result.report.frames.find(f => f.path === item.path); gallery.append(h('figure', {}, img, h('figcaption', {}, `${f.path}：请求${f.requestedMs}ms → 实际${f.actualMs}ms（偏差${f.deltaMs}ms）`))); }
    }
  }
  async function action(op, payload, apply, nested = false) {
    if ((!nested && busy) || !active || destroyed || !supported) return;
    if (op === 'engine_plan' || op === 'choose_engine') { engine = null; versions = null; engineText.textContent = ''; resetSource(); } else if (op === 'choose_source') resetSource(); else if (op === 'inspect_source' || op === 'plan') resetOutput(); else if (op === 'run') plan = null;
    const id = nextJob(), ticket = generation; job = id; busy = true; currentOp = op; refresh(); status.textContent = `正在执行：${op}。本地源只读；不上传，不生成视频总结。`;
    try { await invalidation; const r = await bridge.callHost('T043', op, { ...payload, jobId: id }); if (ticket !== generation || !active || destroyed) { if (op === 'run') bridge.callHost('T043', 'discard_result', { jobId: nextJob() }).catch(() => {}); return; } if (r?.ok !== true) { status.textContent = r?.canceled ? '已取消；已有完整预览保留，可继续核对。' : `操作失败：${r?.code || r?.error || 'INVALID_HOST_RECEIPT'}${r?.partialPath ? '。人工核对部分目录：' + r.partialPath : ''}`; return; } status.textContent = op === 'run' ? '全部实际PNG、PTS索引与联系表已就绪；请核对完整预览后创建新目录。' : '操作完成，请核对当前计划或结果。'; if (op === 'confirm_preview') { busy = false; job = null; refresh(); } await apply(r); }
    catch { if (ticket === generation && active && !destroyed) status.textContent = '操作失败：HOST_CALL_FAILED'; }
    finally { if (job === id) { job = null; busy = false; currentOp = null; } if (clearAfter && !busy) { clearAfter = false; bridge.callHost('T043', 'clear', { jobId: nextJob() }).catch(() => {}); } if (!destroyed) refresh(); }
  }
  const panel = h('section', { class: 't043' }, h('h2', {}, '视频关键画面提取'), h('p', {}, '单本机MP4：H.264/yuv420p、可选唯一AAC（不处理音频），≤64MiB/120秒、≤1920×1080。1–32时间点，PNG不放大且限640×360；每帧<1MiB、联系表<8MiB、全部<20MiB。'), h('p', {}, '每次选择请求时间之后的第一帧，保留真实源PTS/时基及偏差；不是只截关键帧、不生成总结。保存前预览每张完整PNG及联系表；切换/隐藏清除本次未导出内容。'), status, h('div', { class: 't043-actions' }, engineDefault, engineChoose, engineConfirm), engineText, h('div', { class: 't043-actions' }, chooseSource, inspect), sourceText, h('h3', {}, '请求时间（整数毫秒）'), mode, h('label', {}, '指定时间点：逗号或空格分隔，按列表顺序', points), h('label', {}, '固定间隔：从0开始，不包含视频终点', interval), h('div', { class: 't043-actions' }, compare, run, cancel, clear), planText, h('h3', {}, '全部实际帧时间索引'), table, h('h3', {}, '全部实际PNG'), gallery, h('h3', {}, '真实联系表'), contact, reportText, h('label', { class: 't043-review' }, review, '我已核对全部PNG、联系表、实际PTS及请求偏差。'), h('p', {}, '下一步在原生对话框预览新的目录名称。保存所有 frame-NN.png、contact-sheet.png 与 frame-index.json。已有源/文件/目录均拒绝，不覆盖。报告包含源名和本机目标路径，请自行决定分享范围。'), save);
  root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), panel); refresh();
  function suspend() { if (!active) return; active = false; generation++; if (job) bridge?.cancelHost('T043', job).catch(() => {}); resetSource(); status.textContent = '已暂停并清除源与临时画面，返回后重新选择源。'; if (supported) { if (busy) clearAfter = true; else invalidation = invalidation.then(() => bridge.callHost('T043', 'clear', { jobId: nextJob() })).catch(() => {}); } refresh(); }
  const visibility = () => { if (document.hidden) suspend(); }; document.addEventListener('visibilitychange', visibility);
  return { activate() { if (!destroyed) { active = true; refresh(); } }, deactivate: suspend, destroy() { suspend(); destroyed = true; document.removeEventListener('visibilitychange', visibility); root.replaceChildren(); } };
} };
