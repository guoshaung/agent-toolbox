import { h } from '../../core/ui.js';
import { PACKS } from './cards.mjs';
import { Charades, REPORT_LIMIT, cleanReports } from './model.mjs';

const KEY = 'features.E023.reports';
const LOCAL_KEY = 'agent-toolbox:E023:reports:v1';
const OUTCOMES = { hit: '猜中', skip: '跳过', unanswered: '未判定' };
const REASONS = { timeout: '到时', manual: '主持人提前结束', deckExhausted: '题卡耗尽', plannedRounds: '计划轮次完成' };
const randomSeed = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 0x1000000).toString(36)}`;

export default {
  id: 'E023',
  create(root, ctx = {}) {
    let game = new Charades({ teams: ['红队', '蓝队'], roundsPerTeam: 2, durationSeconds: 60, pack: 'all', seed: randomSeed() }, { now: () => performance.now() });
    let active = false;
    let destroyed = false;
    let ticker = null;
    let recorded = false;
    let lastReport = null;
    let hostNode = null;
    let reports = [];
    let writeQueue = Promise.resolve();
    let loadNote = '';
    try {
      const saved = ctx.config?.get ? ctx.config.get(KEY, null) : JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      reports = cleanReports(saved?.recent);
    } catch { loadNote = '报告读取失败，可以继续游戏。'; }
    const style = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
    const teamInputs = [0, 1].map((i) => h('input', { type: 'text', maxlength: '20', 'aria-label': `队伍 ${i + 1} 名称` }));
    const roundsInput = h('input', { type: 'number', min: '1', max: '5', step: '1', 'aria-label': '每队轮数' });
    const durationInput = h('input', { type: 'number', min: '30', max: '180', step: '1', 'aria-label': '每轮秒数' });
    const seedInput = h('input', { type: 'text', maxlength: '32', spellcheck: 'false', autocomplete: 'off', 'aria-label': '局号' });
    const packSelect = h('select', { 'aria-label': '题包' }, Object.entries(PACKS).map(([id, title]) => h('option', { value: id }, `${title} · ${id === 'all' ? 150 : 50} 题`)));
    const pauseButton = h('button', { type: 'button', onclick: togglePause }, '暂停');
    const status = h('p', { class: 'e023-status', role: 'status', 'aria-live': 'polite', tabindex: '-1' });
    const clock = h('strong', { 'aria-label': '剩余秒数', class: 'e023-clock' });
    const stage = h('div', { class: 'e023-stage' });
    const scoreBoard = h('div', { class: 'e023-scoreboard', 'aria-label': '两队比分' });
    const progress = h('p', { class: 'e023-muted' });
    const recent = h('ol', { class: 'e023-recent' });
    const storageNote = h('p', { class: 'e023-muted', role: 'status' }, loadNote);
    const shell = h('section', { class: 'feature-e023', 'aria-label': '动作猜词' },
      h('header', { class: 'e023-heading' }, h('div', {}, h('h2', {}, '动作猜词'), h('p', {}, '只用肢体动作演题，两队轮流猜，主持人判定。')), pauseButton),
      h('div', { class: 'e023-settings' }, ...teamInputs.map((input, i) => field(`队伍 ${i + 1}`, input)), field('每队轮数', roundsInput), field('每轮秒数', durationInput), field('题包', packSelect), field('局号', seedInput),
        h('button', { type: 'button', onclick: () => newGame({ teams: teamInputs.map((e) => e.value), roundsPerTeam: Number(roundsInput.value), durationSeconds: Number(durationInput.value), pack: packSelect.value, seed: seedInput.value.trim() }) }, '建立新局'),
        h('button', { type: 'button', onclick: () => { if (active && !destroyed) seedInput.value = randomSeed(); } }, '换随机局号')),
      h('p', { class: 'e023-muted' }, '每队 1–5 轮，每轮 30–180 秒；队名各 1–20 字且不同，局号为 1–32 位字母、数字、_ 或 -。改设置后点“建立新局”，会放弃未完成局。'),
      h('p', { class: 'e023-rule' }, '表演者只能用肢体动作，不能发声、写字或用口型给语言提示；猜词队可说答案并请避开屏幕。固定计分：猜中 +1，跳过 0，未判定 0；违规提示由主持人判跳过。全部人工判定，不使用摄像头或麦克风。'),
      scoreBoard,
      h('div', { class: 'e023-progress' }, progress, clock), status, stage,
      h('section', { class: 'e023-history', 'aria-label': '最近完整局报告' }, h('h3', {}, `最近 ${REPORT_LIMIT} 局报告`), recent, storageNote));
    root.append(style, shell); fillSettings(game.getView().options); render();

    function field(label, input) { return h('label', {}, h('span', {}, label), input); }
    function fillSettings(options) { teamInputs.forEach((e, i) => { e.value = options.teams[i]; }); roundsInput.value = String(options.roundsPerTeam); durationInput.value = String(options.durationSeconds); packSelect.value = options.pack; seedInput.value = options.seed; }
    function stopTicker() { if (ticker !== null) clearInterval(ticker); ticker = null; }
    function pulse() {
      const view = game.getView();
      if (view.phase !== 'running') { stopTicker(); render(); return; }
      clock.textContent = `${Math.ceil(view.remainingMs / 1000)} 秒`;
    }
    function syncTicker() { stopTicker(); if (active && !destroyed && game.getView().phase === 'running') ticker = setInterval(pulse, 100); }
    function newGame(options) {
      if (!active || destroyed) return;
      try {
        const next = new Charades(options, { now: () => performance.now() });
        game.pause(); stopTicker(); game = next; recorded = false; lastReport = null;
        fillSettings(game.getView().options); render();
      } catch (error) { status.textContent = error.message; }
    }
    function startRound(event) { if (!active || destroyed || event?.detail > 1 || event?.repeat || !game.startRound()) return; render(); syncTicker(); hostNode?.focus(); }
    function judge(outcome, ticket, event) {
      if (!active || destroyed || event?.detail > 1 || event?.repeat) return;
      const result = game.judge(outcome, ticket); render(); syncTicker(); hostNode?.focus();
      if (!result.ok && result.reason === 'cooldown') status.textContent = '操作间隔至少 0.25 秒，防止连按误判下一张卡；请看清新卡再判定。';
    }
    function endRound(number) { if (!active || destroyed) return; game.endRound(number); render(); syncTicker(); }
    function togglePause(event) {
      if (!active || destroyed || event?.detail > 1 || event?.repeat) return;
      if (game.getView().phase === 'paused') game.resume(); else game.pause();
      render(); syncTicker();
    }
    function remember() {
      const result = game.result();
      if (!result || recorded) return;
      recorded = true;
      lastReport = { ...result, finishedAt: new Date().toISOString() };
      reports = cleanReports([lastReport, ...reports]);
      const snapshot = { version: 1, recent: reports };
      writeQueue = writeQueue.then(async () => {
        try {
          if (ctx.config?.set) await ctx.config.set(KEY, snapshot); else localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot));
          if (!destroyed) storageNote.textContent = '完整局报告已保存在本机，最多保留最近三局。';
        } catch { if (!destroyed) storageNote.textContent = '保存失败，本次打开期间的完整局仍可导出。'; }
      });
    }
    function roundSummary(round) {
      return h('div', { class: 'e023-round-summary' }, h('strong', {}, `第 ${round.number} 轮 · ${round.teamName} · ${REASONS[round.reason]}`),
        h('p', {}, `猜中 ${round.counts.hit} · 跳过 ${round.counts.skip} · 未判定 ${round.counts.unanswered}；本轮 +${round.scoreDelta} 分`));
    }
    function render() {
      if (destroyed) return;
      remember(); const view = game.getView(); hostNode = null;
      scoreBoard.replaceChildren(...view.options.teams.map((name, i) => h('div', { class: view.teamIndex === i ? 'is-active' : '' }, h('span', {}, name), h('strong', {}, `${view.scores[i]} 分`))));
      progress.textContent = `局号 ${view.options.seed} · ${PACKS[view.options.pack]} · 每队 ${view.options.roundsPerTeam} 轮 / 每轮 ${view.options.durationSeconds} 秒 · 已出 ${view.cardsUsed}/${view.deckSize} 张，未出 ${view.deckLeft} 张`;
      clock.textContent = `${Math.ceil(view.remainingMs / 1000)} 秒`;
      pauseButton.disabled = !['running', 'paused'].includes(view.phase); pauseButton.textContent = view.phase === 'paused' ? '继续' : '暂停';
      if (view.phase === 'ready' || view.phase === 'between') {
        status.textContent = view.phase === 'ready' ? `准备好了。先由 ${view.options.teams[0]} 表演，点击开始才计时和出题。` : `本轮已锁定并结算。下一轮由 ${view.options.teams[view.teamIndex]} 表演，准备后再开始。`;
        stage.replaceChildren(...(view.lastRound ? [roundSummary(view.lastRound)] : []), h('div', { class: 'e023-ready' }, h('h3', {}, `第 ${view.roundNumber} / ${view.totalRounds} 轮 · ${view.options.teams[view.teamIndex]}`),
          h('p', {}, '换好表演者，再开始计时。已出题不会在本局重复；题包耗尽会提前结束整局。'), h('button', { type: 'button', onclick: startRound }, `开始第 ${view.roundNumber} 轮`)));
      } else if (view.phase === 'paused') {
        status.textContent = '已暂停，题卡遮住，操作与倒计时停止。点击“继续”恢复本轮。';
        stage.replaceChildren(h('div', { class: 'e023-paused' }, '暂停中，当前题卡和比分会保留。'));
      } else if (view.phase === 'running') {
        status.textContent = `第 ${view.roundNumber} / ${view.totalRounds} 轮 · ${view.options.teams[view.teamIndex]} 表演。主持人按规则判定。`;
        const action = (outcome, title) => h('button', { type: 'button', dataset: { outcome }, onclick: (event) => judge(outcome, view.ticket, event) }, title);
        stage.replaceChildren(hostNode = h('div', { class: 'e023-host', tabindex: '0', 'aria-label': '主持人题卡与判定区', onkeydown: (event) => {
          if (event.repeat) return;
          const outcome = { 1: 'hit', 2: 'skip' }[event.key];
          if (outcome) { event.preventDefault(); judge(outcome, view.ticket, event); }
          else if (event.key === 'Escape') { event.preventDefault(); togglePause(); pauseButton.focus(); }
        } },
          h('div', { class: 'e023-card', dataset: { cardId: view.card.id } }, h('p', { class: 'e023-card-caption' }, `${PACKS[view.card.pack]} · ${view.card.id}`), h('h3', {}, view.card.target),
            h('p', {}, '只用肢体动作，不能发声或给文字提示')),
          h('div', { class: 'e023-judges' }, action('hit', '猜中 +1'), action('skip', '跳过 0')),
          h('p', { class: 'e023-muted' }, '键盘：Tab 到题卡区后按 1 猜中、2 跳过，Esc 暂停。操作间隔至少 0.25 秒，防止双击误判。'),
          h('p', { class: 'e023-counts' }, `本轮：猜中 ${view.currentCounts.hit} · 跳过 ${view.currentCounts.skip}`),
          h('button', { type: 'button', onclick: () => endRound(view.roundNumber) }, '提前结束本轮')));
      } else {
        const report = lastReport || game.result();
        const result = report.winner === null ? '平局' : `${report.options.teams[report.winner]} 获胜`;
        status.textContent = `${REASONS[report.reason]}，${result}！最终比分 ${report.scores.join(' : ')}。`;
        stage.replaceChildren(h('div', { class: 'e023-finish' }, h('h3', {}, '完整局结算'),
          h('p', {}, report.reason === 'deckExhausted' ? '题包耗尽，未完成计划轮次。请对照各队实际轮数理解比分；本局不会自动重复题卡。' : '两队已完成计划轮次。'),
          h('button', { type: 'button', onclick: () => exportReport(report) }, '导出本局报告'), h('button', { type: 'button', onclick: () => newGame(view.options) }, '重玩相同局号')),
          h('div', { class: 'e023-ranking' }, h('h3', {}, '队伍排名'), h('ol', {}, report.teamRanking.map((row) => h('li', {}, `第 ${row.rank} 名 · ${row.teamName} · ${row.score} 分`))),
            h('h3', {}, '轮次排名'), h('p', { class: 'e023-muted' }, '按猜中数量排序，相同数量并列；主持人提前结束的轮次也按实际猜中数排名。'),
            h('table', {}, h('thead', {}, h('tr', {}, ['排名', '轮次', '队伍', '猜中', '跳过'].map((title) => h('th', { scope: 'col' }, title)))),
              h('tbody', {}, report.roundRanking.map((row) => h('tr', {}, h('td', {}, row.rank), h('td', {}, row.number), h('td', {}, row.teamName), h('td', {}, row.hits), h('td', {}, row.skips)))))),
          ...report.rounds.map((round) => h('details', { class: 'e023-round-detail' }, h('summary', {}, `第 ${round.number} 轮 · ${round.teamName} · ${round.scoreDelta >= 0 ? '+' : ''}${round.scoreDelta} 分`), roundSummary(round),
            h('ol', {}, round.events.map((e) => h('li', {}, `${e.cardId} ${e.target} · ${OUTCOMES[e.outcome]} ${e.delta >= 0 ? '+' : ''}${e.delta} · ${(e.atMs / 1000).toFixed(1)} 秒`))))));
      }
      recent.replaceChildren(...(reports.length ? reports.map((report) => h('li', {}, h('strong', {}, `${report.options.teams.join(' / ')} · ${report.scores.join(' : ')}`),
        h('span', {}, `局号 ${report.options.seed} · ${report.rounds.length} 轮 · ${REASONS[report.reason]}`), h('button', { type: 'button', onclick: () => exportReport(report) }, '导出此局'), h('button', { type: 'button', onclick: () => newGame(report.options) }, '重玩此局'))) : [h('li', { class: 'e023-muted' }, '完成计划轮次或题包耗尽后，会记录完整局报告。')]));
    }
    async function exportReport(report) {
      if (!active || destroyed) return;
      const content = JSON.stringify(report, null, 2);
      try {
        if (window.toolbox?.files?.saveTextSupportsCopyOnly === true && typeof window.toolbox.files.saveText === 'function') {
          const result = await window.toolbox.files.saveText({ content, extension: 'json', defaultName: '动作猜词完整局报告.json', copyOnly: true });
          if (!destroyed) storageNote.textContent = result?.ok ? '完整局报告已导出。' : result?.canceled ? '已取消导出。' : result?.error || '未导出报告。';
        } else {
          storageNote.textContent = '当前版本不支持副本安全导出，请更新工具箱后重试；本次报告仍保留。';
        }
      } catch (error) { if (!destroyed) storageNote.textContent = `导出失败：${error.message}`; }
    }
    function onVisibility() { if (document.hidden && !destroyed) { game.pause(); stopTicker(); render(); } }
    document.addEventListener('visibilitychange', onVisibility);
    return {
      activate() { if (!destroyed) { active = true; render(); syncTicker(); } },
      deactivate() { if (!destroyed) { active = false; game.pause(); stopTicker(); render(); } },
      destroy() {
        if (destroyed) return; active = false; game.pause(); stopTicker(); remember(); destroyed = true;
        document.removeEventListener('visibilitychange', onVisibility);
        hostNode = null; style.remove(); shell.remove();
      },
    };
  },
};
