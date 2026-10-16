import { h } from '../../core/ui.js';
import { LIMITS } from './model.mjs';
export default { id: 'T048', create(root) {
  const bridge = window.toolbox?.features, supported = bridge?.callHostSupported === true;
  let active = true, destroyed = false, serial = 0, generation = 0, job = null, busy = false, currentOp = null, engine = null, versions = null, source = null, plan = null, result = null, loaded = false, clearAfter = false, invalidation = Promise.resolve();
  const link = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
  const status = h('p', { class: 't048-status', role: 'status', 'aria-live': 'polite' }, supported ? '先选择可信安装目录并预览查询计划。当前未运行任何程序。' : '缺少生产 Host 桥；本工具无法读媒体或写副本。');
  const engineText = h('pre', { class: 't048-engine' }), sourceText = h('pre', { class: 't048-source' }), planText = h('pre', { class: 't048-plan' }), reportText = h('pre', { class: 't048-report' });
  const rows = h('div', { class: 't048-clips' });
  const video = h('video', { controls: true, muted: true, preload: 'metadata', class: 't048-video', 'aria-label': '完整实际重封装成片预览' }); video.muted = true;
  const review = h('input', { type: 'checkbox', 'aria-label': '已核对完整成片及轨道报告' });
  const controls = [];
  const button = (text, fn, enabled) => { const b = h('button', { type: 'button', onclick: fn }, text); controls.push({ b, enabled: enabled || (() => true) }); return b; };
  const engineDefault = button('预览默认引擎查询计划', () => action('engine_plan', {}, r => { engine = r.engine; versions = null; resetSource(); engineText.textContent = JSON.stringify(engine, null, 2); }), () => !busy);
  const engineChoose = button('选择可信引擎目录', () => action('choose_engine', {}, r => { engine = r.engine; versions = null; resetSource(); engineText.textContent = JSON.stringify(engine, null, 2); }), () => !busy);
  const engineConfirm = button('确认运行3次版本和封装器查询', () => action('engine_confirm', { engineToken: engine.token, confirmed: true }, r => { versions = r.versions; engineText.textContent = JSON.stringify({ ...engine, versions }, null, 2); }), () => !!engine && !versions);
  const chooseSource = button('选择本次允许读取的MP4', () => action('choose_source', {}, r => { resetSource(); source = r.source; sourceText.textContent = JSON.stringify(source, null, 2); }), () => !!versions);
  const inspect = button('确认一次只读媒体检查', () => action('inspect_source', { sourceId: source.id, confirmed: true }, r => { resetOutput(); source = r.source; sourceText.textContent = JSON.stringify(source, null, 2); renderTracks(); }), () => !!source && !source.media);
  const compare = button('预览所选轨道与固定复制计划', () => { const keep=readKeep();return action('plan',{sourceId:source.id,keep},r=>{resetOutput();plan=r.plan;planText.textContent=JSON.stringify(plan.report,null,2);});},()=>!!source?.media);
  const run = button('确认无损复制所选轨道', () => action('run', { planId: plan.id, confirmed: true }, r => { plan = null; result = r.result; loaded = false; review.checked = false; reportText.textContent = JSON.stringify(result.report, null, 2); video.src = result.previewURL; video.load(); }), () => !!plan);
  const save = button('预览后创建视频和报告新目录副本', async () => {
    if (!loaded || !review.checked || !result) return;
    const id = result.id, observedDurationMs = Math.round(video.duration * 1000);
    await action('confirm_preview', { resultId: id, observedDurationMs, confirmed: true }, async () => {
      await action('save', { resultId: id, confirmed: true }, r => { status.textContent = `已创建新目录副本：${r.path}（完整视频和来源报告）`; }, true);
    });
  }, () => !!result && loaded && review.checked);
  const clear = button('清除本次源和临时成片', () => action('clear', {}, () => { resetSource(); status.textContent = '已清除本次源与临时成片；可信引擎仍可使用。'; }), () => !busy);
  const cancel = h('button', { type: 'button', onclick: () => { if (job) { generation++; bridge.cancelHost('T048', job).catch(() => {}); if (currentOp === 'run') resetOutput(); status.textContent = '已请求取消，等待进程关闭；不把未完成成片当作成功。'; } } }, '取消当前操作');
  function refresh() { for (const { b, enabled } of controls) b.disabled = !supported || !active || destroyed || busy || !enabled(); cancel.disabled = !busy || !job; review.disabled = busy || !loaded || !result; for (const el of rows.querySelectorAll('input,button')) el.disabled = busy || !active || el.getAttribute('data-required')==='true'; }
  function resetOutput() { plan = null; result = null; loaded = false; review.checked = false; planText.textContent = ''; reportText.textContent = ''; video.pause(); video.removeAttribute('src'); video.load(); }
  function resetSource() { resetOutput(); source = null; sourceText.textContent = ''; rows.replaceChildren(); }
  function invalidate() { generation++; resetOutput(); if (supported && active && !busy) invalidation = invalidation.then(() => bridge.callHost('T048', 'discard_result', { jobId: nextJob() })).catch(() => {}); refresh(); }
  function nextJob() { return 'T048-' + crypto.randomUUID() + '-' + (++serial); }
  async function action(op, payload, apply, nested = false) {
    if ((!nested && busy) || !active || destroyed || !supported) return;
    if (op === 'engine_plan' || op === 'choose_engine') { engine = null; versions = null; engineText.textContent = ''; resetSource(); }
    else if (op === 'choose_source') resetSource();
    else if (op === 'inspect_source' || op === 'plan') resetOutput();
    else if (op === 'run') plan = null;
    const id = nextJob(), ticket = generation; job = id; busy = true; currentOp = op; refresh(); status.textContent = `正在执行：${op}。源文件只读；生成/保存取消会等待自己的资源收尾。`;
    try {
      await invalidation;
      const r = await bridge.callHost('T048', op, { ...payload, jobId: id });
      if (ticket !== generation || !active || destroyed) { if (op === 'run') bridge.callHost('T048', 'discard_result', { jobId: nextJob() }).catch(() => {}); return; }
      if (r?.ok !== true) { status.textContent = r?.canceled ? '已取消；保留已有预览以便重新核对。' : `操作失败：${r?.code || r?.error || 'INVALID_HOST_RECEIPT'}${r?.partialPath ? '。需人工核对部分目录：' + r.partialPath : ''}`; return; }
      status.textContent = op === 'run' ? '实际重封装成片与完整轨道报告已就绪。逐轨压缩包SHA相同；请播放核对唯一视频与默认音轨，其他轨道以实际报告核验。' : '操作完成，请核对当前计划或结果。';
      if (op === 'confirm_preview') { busy = false; job = null; refresh(); }
      await apply(r);
    } catch { if (ticket === generation && active && !destroyed) status.textContent = '操作失败：HOST_CALL_FAILED'; }
    finally { if (job === id) { job = null; busy = false; currentOp = null; } if (clearAfter && !busy) { clearAfter = false; bridge.callHost('T048', 'clear', { jobId: nextJob() }).catch(() => {}); } if (!destroyed) refresh(); }
  }
  function readKeep(){return [...rows.querySelectorAll('input')].filter(n=>n.checked).map(n=>Number(n.getAttribute('data-track')));}
  function renderTracks(){rows.replaceChildren();for(const t of source.media.tracks){const c=h('input',{type:'checkbox','aria-label':'保留源轨道'+t.index,'data-track':String(t.index),'data-required':String(t.type==='video')});c.checked=true;c.addEventListener('change',invalidate);rows.append(h('label',{class:'t048-clip'},c,'源'+t.index+' · '+t.type+' / '+t.codec+' · language='+JSON.stringify(t.language)+' · title='+JSON.stringify(t.title)+(t.type==='video'?'（唯一视频必须保留）':'')));}refresh();}
  video.addEventListener('loadedmetadata', () => { loaded = !!result && Number.isFinite(video.duration) && Math.abs(video.duration * 1000 - result.report.output.actualDurationMs) <= 100; if (!loaded && result) status.textContent = '成片浏览器时长无法核验，暂不允许保存。'; refresh(); });
  video.addEventListener('error', () => { loaded = false; if (result) status.textContent = 'Chromium无法播放该实际成片，预览未通过，保存已阻止。'; refresh(); });
  review.addEventListener('change', refresh);
  const panel = h('section', { class: 't048' }, h('h2', {}, '媒体轨道检查与重封装'), h('p', {}, '单个MP4：唯一H.264视频、0–4 AAC音轨、0–1 mov_text字幕，最长120秒/≤64MiB。显示所有语言/编码与实际索引，选择轨道后不重编码复制，输出<64MiB。'), h('p', {}, '预览全部所选/丢弃轨道及固定执行计划再确认；默认静音。源和输出所选编码包逐轨streamhash必须一致，输出轨道编码/属性须一致。浏览器默认只播首音轨，不保证展示字幕/切换音轨；请核对报告，必要时保存后用自己的播放器检查。未支持其他编码/旋转/HDR/外部引用/网络源。'), status, h('div', { class: 't048-actions' }, engineDefault, engineChoose, engineConfirm), engineText, h('div', { class: 't048-actions' }, chooseSource, inspect), sourceText, h('h3', {}, '保留轨道（源stream.index，不以同语言推断同一轨）'), rows, h('div', { class: 't048-actions' }, compare, run, cancel, clear), planText, h('h3', {}, '完整实际成片与来源报告'), video, reportText, h('label', { class: 't048-review' }, review, '我已核对实际成片、唯一视频、默认声音、全部所选/丢弃轨道及压缩包SHA与完整报告。'), h('p', {}, '下一步原生对话框选择全新目录名称；目录内 remuxed.mp4 + track-report.json，已有文件或目录拒绝，不覆盖源。目录可能记录本机目标路径，请自行决定分享范围。'), save);
  root.replaceChildren(link, panel); refresh();
  function suspend() { if (!active) return; active = false; generation++; if (job) bridge?.cancelHost('T048', job).catch(() => {}); resetSource(); status.textContent = '已暂停并清除本次源和成片。返回后需重新选择源。'; if (supported) { if (busy) clearAfter = true; else invalidation = invalidation.then(() => bridge.callHost('T048', 'clear', { jobId: nextJob() })).catch(() => {}); } refresh(); }
  const visibility = () => { if (document.hidden) suspend(); };
  document.addEventListener('visibilitychange', visibility);
  return { activate() { if (destroyed) return; active = true; refresh(); }, deactivate: suspend, destroy() { suspend(); destroyed = true; document.removeEventListener('visibilitychange', visibility); root.replaceChildren(); } };
} };
