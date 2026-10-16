import { h } from '../../core/ui.js';
import { DrawGuess, MAX_GUESSES, cleanSummaries } from './model.mjs';
import { Sketch, paint, albumSize, WIDTH, HEIGHT, COLORS, BRUSHES } from './drawing.mjs';

const KEY = 'features.E024.summaries';
const LOCAL_KEY = 'agent-toolbox:E024:summaries:v1';
const randomSeed = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 0x1000000).toString(36)}`;
const COLOR_NAMES = ['墨色', '红色', '蓝色', '绿色', '紫色', '橙色', '白色橡皮'];
const REASONS = { correct: '猜中', timeout: '到时未猜中', manual: '主持人结束' };

export default {
  id: 'E024',
  create(root, ctx = {}) {
    let game = new DrawGuess({ players: ['小明', '小红'], roundsPerPlayer: 1, durationSeconds: 60, seed: randomSeed() }, { now: () => performance.now() });
    let active = false; let destroyed = false; let ticker = null; let generation = 0; let recorded = false;
    let sketch = new Sketch(); let canvas = null; let pointer = null; let brushColor = COLORS[0]; let brushWidth = 5; let guesserChoice = null; let draftGuess = '';
    let summaries = []; let storageMessage = ''; let writeQueue = Promise.resolve(); let lastReport = null;
    let albumBusy = false; let albumJob = 0; let downloadSerial = 0;
    const drawings = new Map(); const urls = new Map();
    try {
      const saved = ctx.config?.get ? ctx.config.get(KEY, null) : JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      summaries = cleanSummaries(saved?.recent);
    } catch { storageMessage = '历史成绩读取失败，可以继续游玩。'; }

    const style = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
    const countInput = h('select', { 'aria-label': '玩家人数', onchange: updatePlayerFields }, [2, 3, 4].map((n) => h('option', { value: n }, `${n} 人`)));
    const playerInputs = ['小明', '小红', '小蓝', '小绿'].map((name, i) => h('input', { type: 'text', value: name, maxlength: '20', 'aria-label': `玩家 ${i + 1} 名称` }));
    const playerFields = playerInputs.map((input, i) => field(`玩家 ${i + 1}`, input));
    const roundsInput = h('input', { type: 'number', min: '1', max: '2', step: '1', value: '1', 'aria-label': '每人作画轮数' });
    const durationInput = h('input', { type: 'number', min: '30', max: '180', step: '1', value: '60', 'aria-label': '每轮秒数' });
    const seedInput = h('input', { type: 'text', value: game.getView().options.seed, maxlength: '32', spellcheck: 'false', 'aria-label': '局号' });
    const pauseButton = h('button', { type: 'button', onclick: togglePause }, '暂停');
    const status = h('p', { class: 'e024-status', role: 'status', 'aria-live': 'polite' });
    const scores = h('div', { class: 'e024-scores', 'aria-label': '玩家比分' });
    const clock = h('strong', { 'aria-label': '剩余秒数' });
    const stage = h('div', { class: 'e024-stage' });
    const storageNote = h('p', { class: 'e024-muted', role: 'status' }, storageMessage);
    const recent = h('ol', { class: 'e024-recent' });
    const shell = h('section', { class: 'feature-e024', 'aria-label': '你画我猜' },
      h('header', { class: 'e024-heading' }, h('div', {}, h('h2', {}, '你画我猜'), h('p', {}, '私下选词，隐藏后作画；其他玩家用文本猜答案。')), pauseButton),
      h('div', { class: 'e024-settings' }, field('人数', countInput), ...playerFields, field('每人作画轮数', roundsInput), field('每轮秒数', durationInput), field('局号', seedInput),
        h('button', { type: 'button', onclick: newGame }, '建立新局')),
      h('p', { class: 'e024-muted' }, '2–4 人，名字各 1–20 字且不同；每人画 1–2 轮，每轮 30–180 秒。局号用 1–32 位字母、数字、_ 或 -，相同局号提供同样选词。'),
      h('p', { class: 'e024-rule' }, '预设计分：第一个猜中的玩家 +1，画者 +1；到时或提前结束均不加分。匹配标准答案或预设别名，不进行模糊判分。'),
      h('p', { class: 'e024-warning' }, '本机轮流看屏：选词时其他玩家请转身，画者必须点“隐藏词题，开始作画”。关闭工作台会暂停；切换具体功能或建立新局会丢失未导出的绘画和详细报告。'),
      scores, h('div', { class: 'e024-progress' }, status, clock), stage,
      h('section', { class: 'e024-history' }, h('h3', {}, '最近 10 局成绩摘要'), recent, storageNote));
    root.append(style, shell); countInput.value = '2'; updatePlayerFields(); render();

    function field(label, input) { return h('label', {}, h('span', {}, label), input); }
    function updatePlayerFields() { const n = Number(countInput.value); playerFields.forEach((label, i) => { label.style.display = i < n ? '' : 'none'; playerInputs[i].disabled = i >= n; }); }
    function stopTicker() { if (ticker !== null) clearInterval(ticker); ticker = null; }
    function syncTicker() { stopTicker(); if (active && !destroyed && game.getView().phase === 'drawing') ticker = setInterval(pulse, 100); }
    function pulse() {
      const view = game.getView();
      if (view.phase !== 'drawing') { finishGesture(); stopTicker(); render(); return; }
      clock.textContent = `${Math.ceil(view.remainingMs / 1000)} 秒`;
    }
    function finishGesture() {
      const id = pointer; pointer = null; sketch.commit();
      if (canvas && id !== null) { try { canvas.releasePointerCapture(id); } catch {} }
    }
    function imageOf(strokes) {
      const offscreen = h('canvas', { width: WIDTH, height: HEIGHT });
      const context = offscreen.getContext('2d'); if (!context) throw new Error('设备无法创建画布。');
      paint(context, strokes); return offscreen.toDataURL('image/png');
    }
    function collectDrawing(view) {
      const round = view.lastRound;
      if (!round || drawings.has(round.number)) return;
      finishGesture(); const strokes = sketch.view();
      try { drawings.set(round.number, { number: round.number, png: imageOf(strokes), strokes: null }); }
      catch (error) { drawings.set(round.number, { number: round.number, png: null, strokes }); storageNote.textContent = `本轮 PNG 尚未生成，画笔记录仍保留：${error.message}`; }
    }
    function remember() {
      const result = game.result(); if (!result || recorded) return;
      recorded = true; lastReport = { ...result, finishedAt: new Date().toISOString() };
      summaries = cleanSummaries([{ options: result.options, scores: result.scores, finishedAt: lastReport.finishedAt }, ...summaries]);
      const snapshot = { version: 1, recent: summaries };
      writeQueue = writeQueue.then(async () => {
        try { if (ctx.config?.set) await ctx.config.set(KEY, snapshot); else localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot)); if (!destroyed) storageNote.textContent = '仅成绩摘要保存在本机；详细报告和画册请在切换功能前导出。'; }
        catch { if (!destroyed) storageNote.textContent = '摘要保存失败，当前完整报告和画册仍可导出。'; }
      });
    }
    function newGame() {
      if (!active || destroyed) return;
      try {
        const next = new DrawGuess({ players: playerInputs.slice(0, Number(countInput.value)).map((e) => e.value), roundsPerPlayer: Number(roundsInput.value), durationSeconds: Number(durationInput.value), seed: seedInput.value.trim() }, { now: () => performance.now() });
        finishGesture(); game.pause(); collectDrawing(game.getView()); remember(); stopTicker(); game = next;
        generation++; albumJob++; albumBusy = false; recorded = false; lastReport = null; drawings.clear(); sketch = new Sketch(); guesserChoice = null; draftGuess = ''; render();
      } catch (error) { status.textContent = error.message; }
    }
    function togglePause(event) {
      if (!active || destroyed || event?.detail > 1) return;
      finishGesture(); if (game.getView().phase === 'paused') game.resume(); else game.pause(); render(); syncTicker();
    }
    function isDrawing(localCanvas, round, version) {
      if (!active || destroyed || version !== generation || canvas !== localCanvas) return false;
      const view = game.getView();
      if (view.phase !== 'drawing' || view.roundNumber !== round) { finishGesture(); render(); syncTicker(); return false; }
      return true;
    }
    function pointOf(event, localCanvas) { const rect = localCanvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height }; }
    function setupCanvas(localCanvas, view) {
      const context = localCanvas.getContext('2d'); if (!context) throw new Error('当前环境不支持 2D 画布。');
      const version = generation; const round = view.roundNumber; const redraw = () => paint(context, sketch.view()); redraw();
      localCanvas.addEventListener('pointerdown', (event) => {
        if (!isDrawing(localCanvas, round, version) || pointer !== null || event.button > 0 || event.isPrimary === false) return;
        event.preventDefault(); const p = pointOf(event, localCanvas);
        try {
          if (!sketch.begin(p.x, p.y, brushColor, brushWidth)) { status.textContent = '已达到画笔限制，请撤销或清空后继续。'; return; }
          pointer = event.pointerId; try { localCanvas.setPointerCapture(pointer); } catch {} redraw();
        } catch (error) { status.textContent = error.message; }
      });
      localCanvas.addEventListener('pointermove', (event) => {
        if (!isDrawing(localCanvas, round, version) || pointer !== event.pointerId) return;
        event.preventDefault(); const p = pointOf(event, localCanvas);
        try { if (!sketch.add(p.x, p.y)) status.textContent = '单笔最多 400 点，整幅最多 10000 点；请抬起画笔后继续或清空。'; redraw(); }
        catch (error) { status.textContent = error.message; }
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) localCanvas.addEventListener(type, (event) => { if (pointer === event.pointerId) { finishGesture(); if (isDrawing(localCanvas, round, version)) redraw(); } });
    }
    function submitGuess(view, input, player, version, event) {
      if (!active || destroyed || generation !== version || event?.detail > 1 || event?.repeat) return;
      finishGesture(); guesserChoice = Number(player.value); const result = game.guess(guesserChoice, input.value, view.roundNumber);
      if (!result.ok) {
        render(); syncTicker(); status.textContent = ({ invalidPlayer: '画者不能猜自己的题，请选择其他玩家。', invalidText: '请输入 1–32 个字符，不要输入控制字符。', cooldown: '请间隔 0.3 秒再提交，避免重复猜测。', guessLimit: '本轮最多 100 次猜测，请结束本轮或等待到时。', notDrawing: '当前已暂停或到时，不能再猜测计分。' })[result.reason]; return;
      }
      draftGuess = ''; render(); syncTicker(); if (!result.correct) status.textContent = '尚未猜中。按图继续猜，不会显示当前答案。';
    }
    function reportMetadata() {
      const report = lastReport || game.result(); if (!report) return null;
      return { ...report, artwork: { format: 'PNG', canvasWidth: WIDTH, canvasHeight: HEIGHT, album: albumSize(report.rounds.length),
        rounds: report.rounds.map((r) => ({ roundNumber: r.number, pngCaptured: Boolean(drawings.get(r.number)?.png) })) } };
    }
    function render() {
      if (destroyed) return;
      const view = game.getView(); collectDrawing(view); remember(); canvas = null;
      scores.replaceChildren(...view.options.players.map((p, i) => h('div', { class: i === view.drawerIndex ? 'is-drawer' : '' }, h('span', {}, p), h('strong', {}, `${view.scores[i]} 分`))));
      clock.textContent = view.phase === 'finished' ? '已结束' : `${Math.ceil(view.remainingMs / 1000)} 秒`;
      pauseButton.disabled = !['drawing', 'paused'].includes(view.phase); pauseButton.textContent = view.phase === 'paused' ? '继续' : '暂停';
      if (view.phase === 'handoff') {
        status.textContent = `第 ${view.roundNumber}/${view.totalRounds} 轮：${view.options.players[view.drawerIndex]} 作画，已自动轮换。请让其他玩家避开屏幕后私下选词。`;
        stage.replaceChildren(...(view.lastRound ? [h('p', { class: 'e024-last' }, `上一轮：${REASONS[view.lastRound.reason]}，答案 ${view.lastRound.word.target}${view.lastRound.guesserName ? `，${view.lastRound.guesserName} 与画者各 +1` : '，无人加分'}。`)] : []),
          h('div', { class: 'e024-private' }, h('h3', {}, '先交给画者单独看屏幕'), h('p', {}, '查看选词后必须明确隐藏，再让猜词者看画布。'),
            h('button', { type: 'button', onclick: () => { if (active && !destroyed && game.revealChoices()) render(); } }, '画者已独处，查看选词')));
      } else if (view.phase === 'choosing') {
        status.textContent = `仅 ${view.options.players[view.drawerIndex]} 看屏幕。选一个词，然后隐藏开始作画；现在不计时。`;
        const startButton = h('button', { type: 'button', disabled: !view.selectedId, onclick: () => { if (active && !destroyed && game.startDrawing()) { sketch = new Sketch(); guesserChoice = null; draftGuess = ''; render(); syncTicker(); } } }, '隐藏词题，开始作画');
        stage.replaceChildren(h('div', { class: 'e024-private' }, h('h3', {}, '私密选词'), h('div', { class: 'e024-choices' }, view.choices.map((w) => h('button', { type: 'button', 'aria-pressed': view.selectedId === w.id ? 'true' : 'false', dataset: { wordId: w.id }, onclick: () => { if (active && !destroyed && game.selectWord(w.id)) render(); } }, w.target))),
          startButton, h('button', { type: 'button', onclick: () => { if (active && !destroyed) { game.pause(); render(); } } }, '暂时隐藏选词')));
      } else if (view.phase === 'paused') {
        status.textContent = '已暂停，画布与猜测遮住，计时和画笔停止；继续后恢复同一幅图。';
        stage.replaceChildren(h('div', { class: 'e024-paused' }, '暂停中'));
      } else if (view.phase === 'drawing') {
        const version = generation; const round = view.roundNumber;
        status.textContent = `第 ${round}/${view.totalRounds} 轮 · ${view.options.players[view.drawerIndex]} 作画；画布不显示词题。`;
        const brushes = h('select', { 'aria-label': '笔画粗细', onchange: (e) => { brushWidth = Number(e.target.value); } }, BRUSHES.map((n) => h('option', { value: n }, `${n} px`))); brushes.value = String(brushWidth);
        const localCanvas = h('canvas', { width: WIDTH, height: HEIGHT, class: 'e024-canvas', 'aria-label': `第 ${round} 轮绘画画布` }); canvas = localCanvas;
        const player = h('select', { 'aria-label': '猜词玩家', onchange: (event) => { guesserChoice = Number(event.target.value); } }, view.options.players.map((name, i) => i === view.drawerIndex ? null : h('option', { value: i }, name)));
        if (guesserChoice === null || guesserChoice === view.drawerIndex) guesserChoice = view.options.players.findIndex((_, i) => i !== view.drawerIndex); player.value = String(guesserChoice);
        const input = h('input', { type: 'text', value: draftGuess, maxlength: '32', autocomplete: 'off', 'aria-label': '本轮猜测', placeholder: '输入你猜的词', oninput: (event) => { draftGuess = event.target.value; }, onkeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); submitGuess(view, input, player, version, event); } } });
        const boardControls = h('div', { class: 'e024-brushes' }, ...COLORS.map((color, i) => h('button', { type: 'button', 'aria-label': COLOR_NAMES[i], 'aria-pressed': color === brushColor ? 'true' : 'false', style: { borderBottomColor: color }, onclick: () => { if (active && !destroyed && generation === version && game.getView().phase === 'drawing') { finishGesture(); brushColor = color; render(); } } }, COLOR_NAMES[i])), brushes,
          h('button', { type: 'button', onclick: () => editSketch('undo', round, version) }, '撤销'), h('button', { type: 'button', onclick: () => editSketch('clear', round, version) }, '清空'));
        stage.replaceChildren(boardControls, localCanvas, h('p', { class: 'e024-muted' }, '鼠标、触屏或触控笔作画；200 笔、每笔 400 点、总 10000 点，撤销保留 20 次操作。白色画笔可擦除。'),
          h('div', { class: 'e024-guess-form' }, player, input, h('button', { type: 'button', onclick: (event) => submitGuess(view, input, player, version, event) }, '提交猜测'),
            h('button', { type: 'button', onclick: () => { if (active && !destroyed && generation === version) { finishGesture(); game.endRound(round); render(); syncTicker(); } } }, '结束本轮')),
          h('p', { class: 'e024-muted' }, `本轮已猜 ${view.guesses.length}/${MAX_GUESSES} 次，标准词或预设别名均可。`), h('ol', { class: 'e024-guesses' }, view.guesses.map((g) => h('li', {}, `${g.playerName}：${g.text} · 尚未猜中`))));
        try { setupCanvas(localCanvas, view); } catch (error) { game.pause(); stopTicker(); status.textContent = error.message; stage.replaceChildren(h('p', {}, '画布不可用，已暂停。请在支持 Canvas 的工具箱环境打开。')); }
      } else {
        status.textContent = '全部轮次已完成。下面显示揭晓词题、比分与各轮绘画；请在切换功能前导出。';
        const report = lastReport || game.result();
        stage.replaceChildren(h('div', { class: 'e024-result' }, h('h3', {}, '最终排名'), h('ol', {}, report.ranking.map((r) => h('li', {}, `第 ${r.rank} 名 · ${r.playerName} · ${r.score} 分`))),
          h('button', { type: 'button', disabled: albumBusy, onclick: exportAlbum }, albumBusy ? '正在拼画册…' : '下载 PNG 画册副本'), h('button', { type: 'button', onclick: exportMetadata }, '导出 JSON 报告副本')),
          h('div', { class: 'e024-gallery' }, report.rounds.map((r) => h('figure', {}, drawings.get(r.number)?.png ? h('img', { src: drawings.get(r.number).png, alt: `第 ${r.number} 轮 ${r.drawerName} 的绘画` }) : h('p', {}, 'PNG 暂未生成，导出时重试'),
            h('figcaption', {}, `第 ${r.number} 轮 · ${r.drawerName} · ${r.word.target} · ${REASONS[r.reason]}`)))));
      }
      recent.replaceChildren(...(summaries.length ? summaries.map((s) => h('li', {}, `${s.options.players.map((p, i) => `${p} ${s.scores[i]} 分`).join(' / ')} · 局号 ${s.options.seed}`)) : [h('li', {}, '完整局结束后记录摘要；历史摘要不含绘画。')]));
    }
    function editSketch(operation, round, version) {
      if (!active || destroyed || version !== generation) return;
      const view = game.getView(); if (view.phase !== 'drawing' || view.roundNumber !== round) { render(); syncTicker(); return; }
      finishGesture(); sketch[operation](); render();
    }
    async function exportMetadata() {
      if (!active || destroyed) return; const report = reportMetadata(); if (!report) return;
      try {
        const files = window.toolbox?.files;
        if (files?.saveTextSupportsCopyOnly !== true || typeof files.saveText !== 'function') { storageNote.textContent = '当前版本不支持 JSON 副本安全导出，请更新工具箱；PNG 下载仍可使用。'; return; }
        const result = await files.saveText({ content: JSON.stringify(report, null, 2), extension: 'json', defaultName: '你画我猜完整报告.json', copyOnly: true });
        if (!destroyed) storageNote.textContent = result?.ok ? 'JSON 报告已导出。' : result?.canceled ? '已取消 JSON 导出。' : result?.error || '未导出 JSON 报告。';
      } catch (error) { if (!destroyed) storageNote.textContent = `JSON 导出失败：${error.message}`; }
    }
    async function exportAlbum() {
      if (!active || destroyed || albumBusy || !lastReport) return;
      const job = ++albumJob; albumBusy = true; render();
      try {
        const report = lastReport; const size = albumSize(report.rounds.length);
        const album = h('canvas', { width: size.width, height: size.height }); const context = album.getContext('2d'); if (!context) throw new Error('不能创建画册画布。');
        context.fillStyle = '#eef0f4'; context.fillRect(0, 0, size.width, size.height); context.fillStyle = '#182335'; context.font = 'bold 24px sans-serif';
        context.fillText(`你画我猜 · 局号 ${report.options.seed}`, 20, 32); context.font = '18px sans-serif'; context.fillText(report.options.players.map((p, i) => `${p} ${report.scores[i]} 分`).join(' / '), 20, 60);
        for (const [i, round] of report.rounds.entries()) {
          const entry = drawings.get(round.number); if (!entry) throw new Error(`缺少第 ${round.number} 轮绘画。`);
          if (!entry.png) { entry.png = imageOf(entry.strokes); entry.strokes = null; }
          const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('绘画 PNG 解码失败。')); img.src = entry.png; });
          if (destroyed || !active || job !== albumJob) return;
          const x = 20 + (i % 2) * (WIDTH + 20); const y = 90 + Math.floor(i / 2) * 480;
          context.fillStyle = '#ffffff'; context.fillRect(x, y, WIDTH, 470); context.fillStyle = '#182335'; context.font = '18px sans-serif';
          const label = `第 ${round.number} 轮 · 画者 ${round.drawerName}`; context.fillText(label, x + 10, y + 25, WIDTH - 20);
          context.fillText(`答案 ${round.word.target} · ${round.guesserName ? `${round.guesserName} 猜中` : REASONS[round.reason]}`, x + 10, y + 52, WIDTH - 20);
          context.drawImage(image, x, y + 70, WIDTH, HEIGHT);
        }
        const blob = await new Promise((resolve, reject) => album.toBlob((result) => result ? resolve(result) : reject(new Error('画册 PNG 编码失败。')), 'image/png'));
        if (destroyed || !active || job !== albumJob) return;
        const url = URL.createObjectURL(blob); urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000));
        const filename = `你画我猜-${report.options.seed}-${Date.now()}-${++downloadSerial}.png`;
        const anchor = h('a', { href: url, download: filename }); document.body.append(anchor); anchor.click(); anchor.remove();
        storageNote.textContent = '已提交 PNG 画册副本下载请求，请在下载目录查看；PNG 使用浏览器下载，不走文本保存接口。';
      } catch (error) { if (!destroyed && job === albumJob) storageNote.textContent = `PNG 导出失败：${error.message}`; }
      finally { if (!destroyed && job === albumJob) { albumBusy = false; render(); } }
    }
    function onVisibility() { if (document.hidden && !destroyed) { finishGesture(); game.pause(); stopTicker(); albumJob++; albumBusy = false; render(); } }
    document.addEventListener('visibilitychange', onVisibility);
    return {
      activate() { if (!destroyed) { active = true; render(); syncTicker(); } },
      deactivate() { if (!destroyed) { active = false; finishGesture(); game.pause(); stopTicker(); albumJob++; albumBusy = false; render(); } },
      destroy() {
        if (destroyed) return; active = false; finishGesture(); game.pause(); collectDrawing(game.getView()); remember(); stopTicker(); destroyed = true; generation++; albumJob++;
        document.removeEventListener('visibilitychange', onVisibility); for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); }
        urls.clear(); drawings.clear(); canvas = null; style.remove(); shell.remove();
      },
    };
  },
};
