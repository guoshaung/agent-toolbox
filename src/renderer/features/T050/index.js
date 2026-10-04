import { h } from '../../core/ui.js';
import { LIMITS } from './model.mjs';
export default { id: 'T050', create(root) {
  const bridge = window.toolbox?.features, supported = bridge?.callHostSupported === true;
  let active = true, destroyed = false, serial = 0, generation = 0, job = null, busy = false, currentOp = null, engine = null, versions = null, source = null, plan = null, result = null, loaded = false, clearAfter = false, invalidation = Promise.resolve();
  const link = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
  const status = h('p', { class: 't050-status', role: 'status', 'aria-live': 'polite' }, supported ? '先选择可信安装目录并预览查询计划。当前未运行任何程序。' : '缺少生产 Host 桥；本工具无法读媒体或写副本。');
  const engineText = h('pre', { class: 't050-engine' }), sourceText = h('pre', { class: 't050-source' }), planText = h('pre', { class: 't050-plan' }), reportText = h('pre', { class: 't050-report' });
  const chapterLinks = h('div', {class:'t050-actions'}), summary = h('p',{class:'t050-summary',role:'status'});
  const rows = h('div', { class: 't050-chapters' });
  const video = h('video', { controls: true, muted: true, preload: 'metadata', class: 't050-video', 'aria-label': '完整实际带章节成片预览' }); video.muted = true;
  const review = h('input', { type: 'checkbox', 'aria-label': '已核对实际全部章节及完整报告' });
  const controls = [];
  const button = (text, fn, enabled) => { const b = h('button', { type: 'button', onclick: fn }, text); controls.push({ b, enabled: enabled || (() => true) }); return b; };
  const engineDefault = button('预览默认引擎查询计划', () => action('engine_plan', {}, r => { engine = r.engine; versions = null; resetSource(); engineText.textContent = JSON.stringify(engine, null, 2); }), () => !busy);
  const engineChoose = button('选择可信引擎目录', () => action('choose_engine', {}, r => { engine = r.engine; versions = null; resetSource(); engineText.textContent = JSON.stringify(engine, null, 2); }), () => !busy);
  const engineConfirm = button('确认运行3次版本和MP4封装查询', () => action('engine_confirm', { engineToken: engine.token, confirmed: true }, r => { versions = r.versions; engineText.textContent = JSON.stringify({ ...engine, versions }, null, 2); }), () => !!engine && !versions);
  const chooseSource = button('选择本次允许读取的MP4', () => action('choose_source', {}, r => { resetSource(); source = r.source; sourceText.textContent = JSON.stringify(source, null, 2); }), () => !!versions);
  const inspect = button('确认一次只读媒体检查', () => action('inspect_source', { sourceId: source.id, confirmed: true }, r => { resetOutput(); source = r.source; sourceText.textContent = JSON.stringify(source, null, 2); if (!rows.children.length) addRow(0, '章节1'); }), () => !!source && !source.media);
  const add = button('添加章节', () => { invalidate(); const last = rows.lastElementChild?.querySelector('input'); const start = Math.min(source.media.durationMs - 1, Number(last?.value || 0) + 120000); addRow(start, '章节' + (rows.children.length + 1)); }, () => !!source?.media && rows.children.length < LIMITS.chapters);
  const compare = button('预览全部章节与固定封装计划', () => { let chapters; try { chapters = readChapters(); } catch { status.textContent = '首章必须0毫秒；其它起点须完整非负整数毫秒，标题不能留空；重复、乱序、越界整体拒绝。'; return; } return action('plan', { sourceId: source.id, chapters }, r => { resetOutput(); plan = r.plan; planText.textContent = JSON.stringify(plan.report, null, 2); }); }, () => !!source?.media && rows.children.length > 0);
  const run = button('确认生成带章节媒体副本', () => action('run', { planId: plan.id, confirmed: true }, r => { plan = null; result = r.result; loaded = false; review.checked = false; reportText.textContent = JSON.stringify(result.report, null, 2); summary.textContent = `实测${result.report.output.chapters.length}条章节，${result.report.output.actualDurationMs}毫秒，${result.report.output.bytes}字节。未重编码；完整标题和实际时间见报告。`; chapterLinks.replaceChildren(); for (const c of result.report.output.chapters) chapterLinks.append(h('button',{type:'button',onclick:()=>{if(busy||!active||!loaded)return;video.pause();video.currentTime=c.startMs/1000;status.textContent=`实际章节定位：${c.title}，${c.startMs}毫秒。`}}, `${c.title} · ${c.startMs}ms`)); video.src = result.previewURL; video.load(); }), () => !!plan);
  const save = button('预览后创建视频和报告新目录副本', async () => {
    if (!loaded || !review.checked || !result) return;
    const id = result.id, observedDurationMs = Math.round(video.duration * 1000);
    await action('confirm_preview', { resultId: id, observedDurationMs, confirmed: true }, async () => {
      await action('save', { resultId: id, confirmed: true }, r => { status.textContent = `已创建新目录副本：${r.path}（完整带章节MP4和章节报告）`; }, true);
    });
  }, () => !!result && loaded && review.checked);
  const clear = button('清除本次源和临时成片', () => action('clear', {}, () => { resetSource(); status.textContent = '已清除本次源与临时成片；可信引擎仍可使用。'; }), () => !busy);
  const cancel = h('button', { type: 'button', onclick: () => { if (job) { generation++; bridge.cancelHost('T050', job).catch(() => {}); if (currentOp === 'run') resetOutput(); status.textContent = '已请求取消，等待进程关闭；不把未完成成片当作成功。'; } } }, '取消当前操作');
  function refresh() { for (const { b, enabled } of controls) b.disabled = !supported || !active || destroyed || busy || !enabled(); cancel.disabled = !busy || !job; review.disabled = busy || !loaded || !result; for (const el of rows.querySelectorAll('input,button')) el.disabled = busy || !active; for (const b of chapterLinks.children) b.disabled = busy || !active || !loaded; }
  function resetOutput() { plan = null; result = null; loaded = false; review.checked = false; planText.textContent = ''; reportText.textContent = ''; summary.textContent = ''; chapterLinks.replaceChildren(); video.pause(); video.removeAttribute('src'); video.load(); }
  function resetSource() { resetOutput(); source = null; sourceText.textContent = ''; rows.replaceChildren(); }
  function invalidate() { generation++; resetOutput(); if (supported && active && !busy) invalidation = invalidation.then(() => bridge.callHost('T050', 'discard_result', { jobId: nextJob() })).catch(() => {}); refresh(); }
  function nextJob() { return 'T050-' + crypto.randomUUID() + '-' + (++serial); }
  async function action(op, payload, apply, nested = false) {
    if ((!nested && busy) || !active || destroyed || !supported) return;
    if (op === 'engine_plan' || op === 'choose_engine') { engine = null; versions = null; engineText.textContent = ''; resetSource(); }
    else if (op === 'choose_source') resetSource();
    else if (op === 'inspect_source' || op === 'plan') resetOutput();
    else if (op === 'run') plan = null;
    const id = nextJob(), ticket = generation; job = id; busy = true; currentOp = op; refresh(); status.textContent = `正在执行：${op}。源文件只读；生成/保存取消会等待自己的资源收尾。`;
    try {
      await invalidation;
      const r = await bridge.callHost('T050', op, { ...payload, jobId: id });
      if (ticket !== generation || !active || destroyed) { if (op === 'run') bridge.callHost('T050', 'discard_result', { jobId: nextJob() }).catch(() => {}); return; }
      if (r?.ok !== true) { status.textContent = r?.canceled ? '已取消；保留已有预览以便重新核对。' : `操作失败：${r?.code || r?.error || 'INVALID_HOST_RECEIPT'}${r?.partialPath ? '。需人工核对部分目录：' + r.partialPath : ''}`; return; }
      status.textContent = op === 'run' ? '实际带章节成片与全部探测记录已就绪。请逐章跳转并核对完整报告，再保存新目录。' : '操作完成，请核对当前计划或结果。';
      if (op === 'confirm_preview') { busy = false; job = null; refresh(); }
      await apply(r);
    } catch { if (ticket === generation && active && !destroyed) status.textContent = '操作失败：HOST_CALL_FAILED'; }
    finally { if (job === id) { job = null; busy = false; currentOp = null; } if (clearAfter && !busy) { clearAfter = false; bridge.callHost('T050', 'clear', { jobId: nextJob() }).catch(() => {}); } if (!destroyed) refresh(); }
  }
  function readChapters() { return [...rows.children].map((row, i) => { const inputs = row.querySelectorAll('input'); if (!/^\d{1,6}$/.test(inputs[0].value) || !inputs[1].value || i === 0 && Number(inputs[0].value) !== 0) throw Error('range'); return { startMs: Number(inputs[0].value), title: inputs[1].value }; }); }
  function addRow(start, title) {
    const row = h('div', { class: 't050-chapter' });
    const point = h('input', {type:'number',min:'0',max:'599999',step:'1',value:start,'aria-label':'章节起点毫秒',oninput:invalidate});
    const text = h('input', {type:'text',maxlength:'80',value:title,'aria-label':'章节标题',oninput:invalidate});
    const move = direction => { const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling; if (!sibling) return; invalidate(); if (direction < 0) rows.insertBefore(row, sibling); else rows.insertBefore(sibling, row); };
    row.append(h('label',{},'起点毫秒',point),h('label',{},'标题',text),h('button',{type:'button',onclick:()=>move(-1),'aria-label':'章节上移'},'↑'),h('button',{type:'button',onclick:()=>move(1),'aria-label':'章节下移'},'↓'),h('button',{type:'button',onclick:()=>{invalidate();row.remove();refresh();}},'移除'));
    rows.append(row); refresh();
  }
  video.addEventListener('loadedmetadata', () => { loaded = !!result && Number.isFinite(video.duration) && Math.abs(video.duration * 1000 - result.report.output.actualDurationMs) <= 100 && video.videoWidth === result.report.output.media.video.width && video.videoHeight === result.report.output.media.video.height; if (!loaded && result) status.textContent = '成片浏览器时长无法核验，暂不允许保存。'; refresh(); });
  video.addEventListener('error', () => { loaded = false; if (result) status.textContent = 'Chromium无法播放该实际成片，预览未通过，保存已阻止。'; refresh(); });
  review.addEventListener('change', refresh);
  const panel = h('section', { class: 't050' }, h('h2', {}, '媒体章节标记生成'), h('p', {}, '有限MP4：单条H.264 8bit/可选单AAC，无旧章节/字幕/其它轨道。源≤64MiB/600秒，最多64个标题和整数毫秒起点。首章必须0毫秒；严格递增、不重复、不越界，不会自动排序。固定-c copy重封装，不转码。'), h('p', {}, '先预览固定计划并确认，生成全部章节和完整成片后逐章核对。已有目标拒绝，原文件不改。隐藏/切换/退出清除本次源、草稿和临时成片，不存配置。'), status, h('div', { class: 't050-actions' }, engineDefault, engineChoose, engineConfirm), engineText, h('div', { class: 't050-actions' }, chooseSource, inspect), sourceText, h('h3', {}, '人工章节（严格列表顺序）'), rows, h('div', { class: 't050-actions' }, add, compare, run, cancel, clear), planText, h('h3', {}, '实际完整成片与章节跳转'), summary, video, chapterLinks, reportText, h('label', { class: 't050-review' }, review, '我已逐章核对实际标题/起点、成片、声音和完整探测报告。'), h('p', {}, '下一步原生选择全新目录名称：chaptered.mp4 + chapter-report.json。播放器未必提供章节菜单，本工具用实际探测章节按钮定位。报告含所选媒体名与目标路径，请自行决定分享范围。目录写入非跨文件崩溃事务。'), save);
  root.replaceChildren(link, panel); refresh();
  function suspend() { if (!active) return; active = false; generation++; if (job) bridge?.cancelHost('T050', job).catch(() => {}); resetSource(); status.textContent = '已暂停并清除本次源和成片。返回后需重新选择源。'; if (supported) { if (busy) clearAfter = true; else invalidation = invalidation.then(() => bridge.callHost('T050', 'clear', { jobId: nextJob() })).catch(() => {}); } refresh(); }
  const visibility = () => { if (document.hidden) suspend(); };
  document.addEventListener('visibilitychange', visibility);
  return { activate() { if (destroyed) return; active = true; refresh(); }, deactivate: suspend, destroy() { suspend(); destroyed = true; document.removeEventListener('visibilitychange', visibility); root.replaceChildren(); } };
} };
