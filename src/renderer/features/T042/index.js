import { h } from '../../core/ui.js';
import { LIMITS } from './model.mjs';
export default { id: 'T042', create(root) {
  const bridge = window.toolbox?.features, supported = bridge?.callHostSupported === true;
  let active = true, destroyed = false, serial = 0, generation = 0, job = null, busy = false, currentOp = null, engine = null, versions = null, source = null, plan = null, result = null, loaded = false, sourceLoaded = false, clearAfter = false, invalidation = Promise.resolve();
  const link = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
  const status = h('p', { class: 't042-status', role: 'status', 'aria-live': 'polite' }, supported ? '先选择可信安装目录并预览查询计划。当前未运行任何程序。' : '缺少生产 Host 桥；本工具无法读媒体或写副本。');
  const engineText = h('pre', { class: 't042-engine' }), sourceText = h('pre', { class: 't042-source' }), planText = h('pre', { class: 't042-plan' }), reportText = h('pre', { class: 't042-report' });
  const resultSummary = h('p', {class:'t042-result-summary',role:'status'});
  const sourceVideo = h('video', { controls: true, muted: true, preload: 'metadata', class: 't042-source-video', 'aria-label': '只读源副本抽样预览' }); sourceVideo.muted = true;
  const sourceReview = h('input', { type: 'checkbox', 'aria-label': '已抽样核对源视频' });
  const targetInput = h('input', { type: 'number', min: '1', max: '20000000', step: '1', value: '20000000', 'aria-label': '目标体积字节', oninput: invalidate });
  const widthInput = h('input', { type: 'number', min: '2', max: '1920', step: '2', 'aria-label': '明确输出宽像素', oninput: invalidate });
  const heightInput = h('input', { type: 'number', min: '2', max: '1080', step: '2', 'aria-label': '明确输出高像素', oninput: invalidate });
  const settings = [targetInput, widthInput, heightInput];
  const sampleButtons = [];
  const video = h('video', { controls: true, muted: true, preload: 'metadata', class: 't042-video', 'aria-label': '完整实际交付成片预览' }); video.muted = true;
  const review = h('input', { type: 'checkbox', 'aria-label': '已核对完整成片及交付报告' });
  const controls = [];
  const button = (text, fn, enabled) => { const b = h('button', { type: 'button', onclick: fn }, text); controls.push({ b, enabled: enabled || (() => true) }); return b; };
  const engineDefault = button('预览默认引擎查询计划', () => action('engine_plan', {}, r => { engine = r.engine; versions = null; resetSource(); engineText.textContent = JSON.stringify(engine, null, 2); }), () => !busy);
  const engineChoose = button('选择可信引擎目录', () => action('choose_engine', {}, r => { engine = r.engine; versions = null; resetSource(); engineText.textContent = JSON.stringify(engine, null, 2); }), () => !busy);
  const engineConfirm = button('确认运行3次版本和编码器查询', () => action('engine_confirm', { engineToken: engine.token, confirmed: true }, r => { versions = r.versions; engineText.textContent = JSON.stringify({ ...engine, versions }, null, 2); }), () => !!engine && !versions);
  const chooseSource = button('选择本次允许读取的MP4', () => action('choose_source', {}, r => { resetSource(); source = r.source; sourceText.textContent = JSON.stringify(source, null, 2); }), () => !!versions);
  const inspect = button('确认一次只读媒体检查', () => action('inspect_source', { sourceId: source.id, confirmed: true }, r => { resetOutput(); source = r.source; sourceText.textContent = JSON.stringify({ ...source, previewURL: undefined }, null, 2); widthInput.value = String(source.media.video.width); heightInput.value = String(source.media.video.height); sourceLoaded = false; sourceReview.checked = false; sourceVideo.src = source.previewURL; sourceVideo.load(); }), () => !!source && !source.media);
  const compare = button('预览体积与固定尺寸编码计划', () => { let constraints; try { constraints = readConstraints(); } catch { status.textContent = '体积、宽、高必须为完整正整数字段；尺寸须等比例偶数且不放大。'; return; } return action('plan', { sourceId: source.id, constraints, sourcePreviewConfirmed: sourceReview.checked && sourceLoaded }, r => { plan = r.plan; planText.textContent = JSON.stringify(plan.report, null, 2); if (!plan.report.feasible) status.textContent = '不合格：目标预算不足以保留所选尺寸、最低视频码率、音轨和容器余量。不会自动降低尺寸，也不会开始编码。'; }); }, () => !!source?.media && sourceLoaded && sourceReview.checked);
  const run = button('确认本次完整编码（最多两次）', () => action('run', { planId: plan.id, confirmed: true }, r => { plan = null; result = r.result; loaded = false; review.checked = false; reportText.textContent = JSON.stringify(result.report, null, 2); resultSummary.textContent = `${result.report.qualified ? '实际达标' : '不合格：实际超限'} · ${result.report.output.bytes} / ${result.report.output.targetBytes} 字节 · ${result.report.output.media.video.width}×${result.report.output.media.video.height} · ${result.report.output.actualDurationMs} 毫秒 · 第${result.report.output.attempt}次；全部${result.report.attempts.length}次记录见下方完整报告。`; video.src = result.previewURL; video.load(); }), () => !!plan?.report.feasible && sourceReview.checked && sourceLoaded);
  const save = button('预览后创建视频和报告新目录副本', async () => {
    if (!loaded || !review.checked || !result) return;
    const id = result.id, observedDurationMs = Math.round(video.duration * 1000);
    await action('confirm_preview', { resultId: id, observedDurationMs, confirmed: true }, async () => {
      await action('save', { resultId: id, confirmed: true }, r => { status.textContent = `已创建新目录副本：${r.path}（${result.report.qualified ? "达标" : "不合格候选，未标为达标"}视频和交付报告）`; }, true);
    });
  }, () => !!result && loaded && review.checked);
  const clear = button('清除本次源和临时成片', () => action('clear', {}, () => { resetSource(); status.textContent = '已清除本次源与临时成片；可信引擎仍可使用。'; }), () => !busy);
  const cancel = h('button', { type: 'button', onclick: () => { if (job) { generation++; bridge.cancelHost('T042', job).catch(() => {}); if (currentOp === 'run') resetOutput(); status.textContent = '已请求取消，等待进程关闭；不把未完成成片当作成功。'; } } }, '取消当前操作');
  function refresh() { sourceReview.disabled = busy || !sourceLoaded || !source?.media; for (const x of settings) x.disabled = busy || !active || !source?.media; for (const { b, enabled } of controls) b.disabled = !supported || !active || destroyed || busy || !enabled(); cancel.disabled = !busy || !job; review.disabled = busy || !loaded || !result; for (const b of sampleButtons) b.disabled = busy || !active || !sourceLoaded; }
  function resetOutput() { plan = null; result = null; loaded = false; review.checked = false; planText.textContent = ''; reportText.textContent = ''; resultSummary.textContent = ''; video.pause(); video.removeAttribute('src'); video.load(); }
  function resetSource() { resetOutput(); source = null; sourceLoaded = false; sourceReview.checked = false; sourceText.textContent = ''; sourceVideo.pause(); sourceVideo.removeAttribute('src'); sourceVideo.load(); widthInput.value = ''; heightInput.value = ''; }
  function invalidate() { generation++; resetOutput(); if (supported && active && !busy) invalidation = invalidation.then(() => bridge.callHost('T042', 'discard_result', { jobId: nextJob() })).catch(() => {}); refresh(); }
  function nextJob() { return 'T042-' + crypto.randomUUID() + '-' + (++serial); }
  async function action(op, payload, apply, nested = false) {
    if ((!nested && busy) || !active || destroyed || !supported) return;
    if (op === 'engine_plan' || op === 'choose_engine') { engine = null; versions = null; engineText.textContent = ''; resetSource(); }
    else if (op === 'choose_source') resetSource();
    else if (op === 'inspect_source') resetOutput(); else if (op === 'plan') { plan = null; planText.textContent = ''; }
    else if (op === 'run') plan = null;
    const id = nextJob(), ticket = generation; job = id; busy = true; currentOp = op; refresh(); status.textContent = `正在执行：${op}。源文件只读；生成/保存取消会等待自己的资源收尾。`;
    try {
      await invalidation;
      const r = await bridge.callHost('T042', op, { ...payload, jobId: id });
      if (ticket !== generation || !active || destroyed) { if (op === 'run') bridge.callHost('T042', 'discard_result', { jobId: nextJob() }).catch(() => {}); return; }
      if (r?.ok !== true) { status.textContent = r?.canceled ? '已取消；保留已有预览以便重新核对。' : `操作失败：${r?.code || r?.error || 'INVALID_HOST_RECEIPT'}${r?.partialPath ? '。需人工核对部分目录：' + r.partialPath : ''}`; return; }
      status.textContent = op === 'run' ? (r.result?.report.qualified ? '实际成片的字节、尺寸、时长及完整解码已达标。请抽样核对质量和声音。' : '不合格：实际字节超限。保持所选尺寸；可预览第二次更低码率计划，最多两次，或另存标为不合格的候选。') : '操作完成，请核对当前计划或结果。';
      if (op === 'confirm_preview') { busy = false; job = null; refresh(); }
      await apply(r);
    } catch { if (ticket === generation && active && !destroyed) status.textContent = '操作失败：HOST_CALL_FAILED'; }
    finally { if (job === id) { job = null; busy = false; currentOp = null; } if (clearAfter && !busy) { clearAfter = false; bridge.callHost('T042', 'clear', { jobId: nextJob() }).catch(() => {}); } if (!destroyed) refresh(); }
  }
  function readConstraints() { if (settings.some(i => !/^\d{1,8}$/.test(i.value))) throw Error('range'); return { targetBytes: Number(targetInput.value), width: Number(widthInput.value), height: Number(heightInput.value) }; }
  const samples = h('div', { class: 't042-actions' });
  for (const [i, fraction] of [.1, .5, .9].entries()) { const b = h('button', { type: 'button', onclick: () => { if (!sourceLoaded || busy) return; const t = source.media.durationMs * fraction / 1000; sourceVideo.pause(); sourceVideo.currentTime = t; if (loaded && result) { video.pause(); video.currentTime = t; } status.textContent = `已定位源${result ? '和实际成片' : ''}的第${i+1}个抽样位置：${Math.floor(t*1000)}毫秒。可播放查看质量与声音。`; } }, `查看${Math.round(fraction*100)}%质量抽样`); sampleButtons.push(b); samples.append(b); }
  sourceVideo.addEventListener('loadedmetadata', () => { sourceLoaded = !!source?.media && Number.isFinite(sourceVideo.duration) && Math.abs(sourceVideo.duration * 1000 - source.media.durationMs) <= 100 && sourceVideo.videoWidth === source.media.video.width && sourceVideo.videoHeight === source.media.video.height; refresh(); });
  sourceVideo.addEventListener('error', () => { sourceLoaded = false; sourceReview.checked = false; status.textContent = '源副本无法在Chromium预览；不能跳过质量抽样开始编码。'; refresh(); });
  sourceReview.addEventListener('change', refresh);
  video.addEventListener('loadedmetadata', () => { loaded = !!result && Number.isFinite(video.duration) && Math.abs(video.duration * 1000 - result.report.output.actualDurationMs) <= 100 && video.videoWidth === result.report.output.media.video.width && video.videoHeight === result.report.output.media.video.height; if (!loaded && result) status.textContent = '成片浏览器时长无法核验，暂不允许保存。'; refresh(); });
  video.addEventListener('error', () => { loaded = false; if (result) status.textContent = 'Chromium无法播放该实际成片，预览未通过，保存已阻止。'; refresh(); });
  review.addEventListener('change', refresh);
  const panel = h('section', { class: 't042' }, h('h2', {}, '媒体交付体积预估'), h('p', {}, '有限MP4/H.264 8bit + 可选单AAC；源≤64MiB/120秒。目标≤20,000,000字节（20MB十进制）。输出尺寸由你明确选择，等比例偶数、不放大；不会自动降分辨率。'), h('p', {}, '源先复制到自己的临时预览文件，不转码、不写源；抽样后最多两次完整ABR编码。每次实际字节与全视频解码核验。切换或退出清除本次源、成片和临时文件，不存全局配置。'), status, h('div', { class: 't042-actions' }, engineDefault, engineChoose, engineConfirm), engineText, h('div', { class: 't042-actions' }, chooseSource, inspect), sourceText, h('h3', {}, '源视频质量抽样（仅自己的只读临时副本）'), sourceVideo, samples, h('label', {}, sourceReview, '我已抽样核对源画面和声音。'), h('div', { class: 't042-actions' }, h('label', {}, '目标字节（20MB = 20000000）', targetInput), h('label', {}, '明确宽像素', widthInput), h('label', {}, '明确高像素', heightInput)), h('div', { class: 't042-actions' }, compare, run, cancel, clear), planText, h('h3', {}, '全部实际成片与逐次体积报告'), resultSummary, video, reportText, h('label', { class: 't042-review' }, review, '我已核对实际成片、10%/50%/90%抽样、声音和完整交付报告。'), h('p', {}, '下一步创建全新目录：达标产物 qualified.mp4，未达标候选 unqualified.mp4；另有 delivery-report.json。未达标另存不代表合格。已有目标拒绝，目录保存非跨文件崩溃事务。'), save);
  root.replaceChildren(link, panel); refresh();
  function suspend() { if (!active) return; active = false; generation++; if (job) bridge?.cancelHost('T042', job).catch(() => {}); resetSource(); status.textContent = '已暂停并清除本次源和成片。返回后需重新选择源。'; if (supported) { if (busy) clearAfter = true; else invalidation = invalidation.then(() => bridge.callHost('T042', 'clear', { jobId: nextJob() })).catch(() => {}); } refresh(); }
  const visibility = () => { if (document.hidden) suspend(); };
  document.addEventListener('visibilitychange', visibility);
  return { activate() { if (destroyed) return; active = true; refresh(); }, deactivate: suspend, destroy() { suspend(); destroyed = true; document.removeEventListener('visibilitychange', visibility); root.replaceChildren(); } };
} };
