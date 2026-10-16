import { h } from '../../core/ui.js';
import { Minesweeper, PRESETS, bestScore, scoreKey, validScore } from './model.mjs';

const STORAGE_KEY = 'features.E002.scores';
const LOCAL_KEY = 'agent-toolbox:E002:scores:v1';
const timeText = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${Math.floor(ms % 1000 / 100)}`;
const seedNow = () => {
  const bytes = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) { globalThis.crypto.getRandomValues(bytes); return Array.from(bytes, (n) => n.toString(36)).join('-'); }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
};

function readScores(ctx) {
  let note = '';
  let stored;
  try {
    stored = ctx.config?.get ? ctx.config.get(STORAGE_KEY, null) : JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
  } catch { note = '暂时无法读取成绩，本局仍可正常游玩。'; }
  const recent = Array.isArray(stored?.recent) ? stored.recent.filter(validScore).slice(0, 20) : [];
  const best = Array.isArray(stored?.best) ? stored.best.filter((s) => validScore(s) && s.outcome === 'won').slice(-100) : [];
  return { recent, best, note };
}

export default {
  id: 'E002',
  create(root, ctx = {}) {
    let game = new Minesweeper({ ...PRESETS.beginner, seed: seedNow() }, { now: () => performance.now() });
    let active = true;
    let destroyed = false;
    let ticker = null;
    let flagMode = false;
    let focusIndex = 0;
    let recorded = false;
    let cellButtons = [];
    const downloadUrls = new Map();
    let writeQueue = Promise.resolve();
    const scores = readScores(ctx);
    const stylesheet = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
    const difficulty = h('select', { 'aria-label': '难度', onchange: setDifficulty },
      h('option', { value: 'beginner' }, '初级 · 9×9 / 10 雷'),
      h('option', { value: 'intermediate' }, '中级 · 16×16 / 40 雷'),
      h('option', { value: 'custom' }, '自定义'));
    const widthInput = h('input', { type: 'number', min: 5, max: 30, step: 1, value: 9, disabled: true });
    const heightInput = h('input', { type: 'number', min: 5, max: 24, step: 1, value: 9, disabled: true });
    const minesInput = h('input', { type: 'number', min: 1, max: 28, step: 1, value: 10, disabled: true });
    const seedInput = h('input', { type: 'text', maxlength: 64, placeholder: '留空生成新局号', 'aria-label': '指定局号' });
    const message = h('p', { class: 'e002-message', role: 'status', 'aria-live': 'polite' });
    const clock = h('strong', { class: 'e002-clock', 'aria-label': '本局用时' });
    const flags = h('strong', {});
    const progress = h('strong', {});
    const best = h('strong', {});
    const pauseButton = h('button', { type: 'button', onclick: togglePause }, '暂停');
    const flagButton = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => {
      if (destroyed) return;
      flagMode = !flagMode;
      flagButton.setAttribute('aria-pressed', String(flagMode));
      flagButton.textContent = flagMode ? '旗模式 · 已开启' : '旗模式 · 关闭';
    } }, '旗模式 · 关闭');
    const board = h('div', { class: 'e002-board', role: 'grid', 'aria-label': '扫雷棋盘', onkeydown: onBoardKey });
    const boardHost = h('div', { class: 'e002-board-scroll' }, board);
    const replayHint = h('p', { class: 'e002-replay-hint' });
    const storageNote = h('p', { class: 'e002-muted', role: 'status' }, scores.note);
    const history = h('ol', { class: 'e002-history' });
    const exportButton = h('button', { type: 'button', onclick: exportScores }, '导出成绩');
    const shell = h('section', { class: 'feature-e002', 'aria-label': '扫雷' },
      h('header', { class: 'e002-heading' }, h('div', {}, h('h2', {}, '扫雷'), h('p', {}, '首点及周围八格安全。打开全部无雷格即可获胜。')),
        h('div', { class: 'e002-actions' }, h('button', { type: 'button', class: 'e002-primary', onclick: newGame }, '新局'),
          h('button', { type: 'button', onclick: () => replay(game.getView()) }, '重玩本局'), pauseButton)),
      h('form', { class: 'e002-options', onsubmit: (event) => { event.preventDefault(); newGame(); } },
        h('label', {}, h('span', {}, '难度'), difficulty),
        h('label', {}, h('span', {}, '宽度'), widthInput), h('label', {}, h('span', {}, '高度'), heightInput),
        h('label', {}, h('span', {}, '雷数'), minesInput), h('label', { class: 'e002-seed-field' }, h('span', {}, '指定局号'), seedInput)),
      h('p', { class: 'e002-muted' }, '参数在点击“新局”后生效。自定义：宽 5–30、高 5–24，雷数不超过总格数的 35%。'),
      h('div', { class: 'e002-stats' }, stat('用时', clock), stat('已插旗 / 雷数', flags), stat('已开 / 安全格', progress), stat('此规格最佳', best)),
      message,
      h('div', { class: 'e002-board-actions' }, flagButton, h('span', {}, '点击开格 · 右键插旗 · 触屏先开旗模式')),
      boardHost,
      h('p', { class: 'e002-help' }, '方向键移动，Home / End 到行首尾；Enter 开格，F 插旗，空格按当前模式操作。双击已开数字（或按 Enter）可展开周围；插错旗也会踩雷。Esc 暂停。'),
      replayHint,
      h('section', { class: 'e002-results', 'aria-label': '本地成绩' }, h('div', { class: 'e002-result-heading' }, h('h3', {}, '最近 20 局'), exportButton), history, storageNote));
    root.append(stylesheet, shell);
    render();

    function stat(label, value) { return h('div', {}, h('span', {}, label), value); }
    function stopTicker() { if (ticker !== null) clearInterval(ticker); ticker = null; }
    function syncTicker() {
      stopTicker();
      if (active && !destroyed && game.getView().phase === 'running') ticker = setInterval(() => { clock.textContent = timeText(game.getView().elapsedMs); }, 100);
    }
    function setDifficulty() {
      if (destroyed) return;
      const preset = PRESETS[difficulty.value];
      for (const field of [widthInput, heightInput, minesInput]) field.disabled = !!preset;
      if (preset) { widthInput.value = preset.width; heightInput.value = preset.height; minesInput.value = preset.mines; }
      updateLimit();
    }
    function updateLimit() { minesInput.max = String(Math.floor(Number(widthInput.value) * Number(heightInput.value) * 35 / 100)); }
    widthInput.addEventListener('input', updateLimit);
    heightInput.addEventListener('input', updateLimit);
    function newGame() {
      if (destroyed || !active) return;
      try {
        const options = { width: Number(widthInput.value), height: Number(heightInput.value), mines: Number(minesInput.value), seed: seedInput.value.trim() || seedNow() };
        const next = new Minesweeper(options, { now: () => performance.now() });
        replaceGame(next);
      } catch (error) { message.textContent = error.message; }
    }
    function replaceGame(next) {
      game.pause();
      stopTicker();
      game = next;
      recorded = false;
      focusIndex = game.getView().firstIndex ?? 0;
      render();
      syncTicker();
    }
    function replay(record) {
      if (destroyed || !active) return;
      const options = { width: record.width, height: record.height, mines: record.mines, seed: record.seed };
      try {
        const next = new Minesweeper(options, { now: () => performance.now() });
        if (record.firstIndex !== null && record.firstIndex !== undefined) next.reveal(record.firstIndex);
        difficulty.value = Object.entries(PRESETS).find(([, p]) => p.width === record.width && p.height === record.height && p.mines === record.mines)?.[0] || 'custom';
        setDifficulty();
        widthInput.value = record.width; heightInput.value = record.height; minesInput.value = record.mines; updateLimit();
        replaceGame(next);
      } catch (error) { message.textContent = error.message; }
    }
    function togglePause() {
      if (destroyed || !active) return;
      const phase = game.getView().phase;
      if (phase === 'paused') game.resume(); else game.pause();
      render(); syncTicker();
      if (game.getView().phase === 'running') cellButtons[focusIndex]?.focus();
    }
    function act(index, kind) {
      if (destroyed || !active) return;
      const hadFocus = board.contains(document.activeElement);
      focusIndex = index;
      const before = game.getView();
      const changed = kind === 'flag' ? game.flag(index) : kind === 'chord' ? game.chord(index) : game.reveal(index);
      if (changed) { render(); syncTicker(); if (hadFocus) cellButtons[focusIndex]?.focus(); }
      else if (kind === 'flag' && (before.phase === 'ready' || before.phase === 'running') && !before.cells[index]?.revealed && !before.cells[index]?.flagged && before.flags >= before.mines) message.textContent = '旗标已用完，请先取消一面。';
      else if (kind === 'chord' && before.phase === 'running') message.textContent = '周围旗标数量须与该格数字相同，才能展开。请先核对旗的位置。';
    }
    function onBoardKey(event) {
      if (destroyed || !active) return;
      const view = game.getView();
      if (view.phase === 'paused') return;
      let next = focusIndex;
      if (event.key === 'ArrowLeft') next = Math.max(0, focusIndex - (focusIndex % view.width ? 1 : 0));
      else if (event.key === 'ArrowRight') next = Math.min(view.cells.length - 1, focusIndex + (focusIndex % view.width < view.width - 1 ? 1 : 0));
      else if (event.key === 'ArrowUp') next = Math.max(focusIndex % view.width, focusIndex - view.width);
      else if (event.key === 'ArrowDown') next = Math.min((view.height - 1) * view.width + focusIndex % view.width, focusIndex + view.width);
      else if (event.key === 'Home') next = event.ctrlKey ? 0 : Math.floor(focusIndex / view.width) * view.width;
      else if (event.key === 'End') next = event.ctrlKey ? view.cells.length - 1 : (Math.floor(focusIndex / view.width) + 1) * view.width - 1;
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); act(focusIndex, 'flag'); return; }
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        act(focusIndex, event.key === ' ' && flagMode ? 'flag' : view.cells[focusIndex].revealed ? 'chord' : 'reveal'); return;
      } else if (event.key === 'Escape') { event.preventDefault(); togglePause(); pauseButton.focus(); return; }
      else return;
      event.preventDefault();
      cellButtons[focusIndex]?.setAttribute('tabindex', '-1');
      focusIndex = next;
      cellButtons[focusIndex]?.setAttribute('tabindex', '0');
      cellButtons[focusIndex]?.focus();
    }

    function rememberResult() {
      const result = game.result();
      if (!result || recorded) return;
      recorded = true;
      const entry = { ...result, finishedAt: new Date().toISOString() };
      scores.recent = [entry, ...scores.recent].slice(0, 20);
      if (entry.outcome === 'won') {
        const previous = bestScore(scores.best, entry);
        if (!previous || entry.elapsedMs < previous.elapsedMs) scores.best = [...scores.best.filter((s) => scoreKey(s) !== scoreKey(entry)), entry].slice(-100);
      }
      const snapshot = { version: 1, recent: [...scores.recent], best: [...scores.best] };
      // Preserve ordering when several quick rounds finish before an IPC write completes.
      writeQueue = writeQueue.then(async () => {
        try {
          if (ctx.config?.set) await ctx.config.set(STORAGE_KEY, snapshot);
          else localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot));
          if (!destroyed) storageNote.textContent = '成绩保存在本机；仅完整赢局或输局计入记录，最佳按相同棋盘规格比较。';
        } catch { if (!destroyed) storageNote.textContent = '成绩保存失败，目前仅在本次打开期间保留。可以导出成绩。'; }
      });
    }
    function render() {
      if (destroyed) return;
      rememberResult();
      const view = game.getView();
      clock.textContent = timeText(view.elapsedMs);
      flags.textContent = `${view.flags} / ${view.mines}`;
      progress.textContent = `${view.revealed - (view.phase === 'lost' ? 1 : 0)} / ${view.width * view.height - view.mines}`;
      const previous = bestScore(scores.best, view);
      best.textContent = previous ? timeText(previous.elapsedMs) : '—';
      message.textContent = ({ ready: '点击任意格子开始；计时从第一次开格开始。', running: '进行中。旗标只代表你的判断，不会验证是否有雷。', paused: '已暂停，棋盘已遮住。点击“继续”恢复。', won: '全部安全格已打开，你赢了！成绩已记入本地列表。', lost: '踩到雷了。本局结束，所有雷位已显示；× 表示插错的旗。' })[view.phase];
      pauseButton.disabled = !['running', 'paused'].includes(view.phase);
      pauseButton.textContent = view.phase === 'paused' ? '继续' : '暂停';
      flagButton.disabled = !['ready', 'running'].includes(view.phase);
      board.setAttribute('aria-rowcount', String(view.height));
      board.setAttribute('aria-colcount', String(view.width));
      board.setAttribute('aria-label', `扫雷棋盘，${view.height} 行 ${view.width} 列`);
      board.style.setProperty('--e002-columns', String(view.width));
      cellButtons = [];
      if (view.phase === 'paused') board.replaceChildren(h('div', { class: 'e002-paused' }, h('strong', {}, '暂停中'), h('span', {}, '棋盘与计时都已暂停')));
      else {
        const rows = [];
        for (let row = 0; row < view.height; row++) {
          const cells = [];
          for (let col = 0; col < view.width; col++) {
            const index = row * view.width + col;
            const cell = view.cells[index];
            const text = cell.wrongFlag ? '×' : cell.mine ? '✹' : cell.flagged ? '⚑' : cell.revealed && cell.value ? String(cell.value) : '';
            const state = cell.wrongFlag ? '旗标错误' : cell.mine ? cell.exploded ? '踩中的雷' : '雷' : cell.flagged ? '已插旗，未打开' : cell.revealed ? cell.value ? `周围 ${cell.value} 个雷` : '已展开空格' : '未打开';
            const button = h('button', {
              type: 'button', role: 'gridcell', tabindex: index === focusIndex ? '0' : '-1',
              'aria-label': `第 ${row + 1} 行，第 ${col + 1} 列，${state}`,
              'aria-rowindex': row + 1, 'aria-colindex': col + 1,
              'aria-disabled': ['won', 'lost'].includes(view.phase) ? 'true' : 'false',
              class: `e002-cell${cell.revealed ? ' is-open' : ''}${cell.flagged ? ' is-flag' : ''}${cell.mine ? ' is-mine' : ''}${cell.exploded ? ' is-exploded' : ''}${cell.wrongFlag ? ' is-wrong' : ''}`,
              ...(cell.revealed && cell.value ? { dataset: { count: cell.value } } : {}),
              onfocus: () => { for (const b of cellButtons) b.setAttribute('tabindex', '-1'); focusIndex = index; button.setAttribute('tabindex', '0'); },
              onclick: () => act(index, flagMode ? 'flag' : 'reveal'),
              ondblclick: () => { if (!flagMode) act(index, 'chord'); },
              oncontextmenu: (event) => { event.preventDefault(); act(index, 'flag'); },
            }, text);
            cells.push(button); cellButtons.push(button);
          }
          rows.push(h('div', { role: 'row', class: 'e002-row' }, cells));
        }
        board.replaceChildren(...rows);
      }
      const first = view.firstIndex === null ? '首点尚未选定' : `首点：第 ${Math.floor(view.firstIndex / view.width) + 1} 行，第 ${view.firstIndex % view.width + 1} 列`;
      replayHint.textContent = `局号：${view.seed} · ${first}。相同规格、局号和首点可以重放同一棋盘。`;
      renderHistory();
    }
    function renderHistory() {
      exportButton.disabled = !scores.recent.length && !scores.best.length;
      if (!scores.recent.length) { history.replaceChildren(h('li', { class: 'e002-muted' }, '还没有完整对局。重开或中途退出不会记为失败。')); return; }
      history.replaceChildren(...scores.recent.map((s) => h('li', {},
        h('span', { class: s.outcome === 'won' ? 'e002-win' : 'e002-muted' }, s.outcome === 'won' ? '赢局' : '输局'),
        h('span', {}, scoreKey(s)), h('span', {}, `${timeText(s.elapsedMs)} · ${s.moves} 步`),
        h('button', { type: 'button', 'aria-label': `重放 ${scoreKey(s)} ${s.outcome === 'won' ? '赢局' : '输局'}，局号 ${s.seed}`, onclick: () => replay(s) }, '重放'))));
    }
    async function exportScores() {
      if (destroyed || !active) return;
      const text = JSON.stringify({ feature: 'E002', version: 1, exportedAt: new Date().toISOString(), recent: scores.recent, best: scores.best }, null, 2);
      try {
        if (window.toolbox?.files?.saveTextSupportsCopyOnly && window.toolbox.files.saveText) {
          const result = await window.toolbox.files.saveText({ content: text, extension: 'json', defaultName: '扫雷成绩.json', copyOnly: true });
          if (!destroyed) storageNote.textContent = result?.ok ? '成绩已导出到你选择的新文件。' : result?.canceled ? '已取消导出。' : result?.error || '未导出成绩。';
        } else {
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
          const revokeTimer = setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000);
          downloadUrls.set(url, revokeTimer);
          const anchor = h('a', { href: url, download: '扫雷成绩.json' });
          document.body.append(anchor); anchor.click(); anchor.remove();
          storageNote.textContent = '已提交成绩文件下载。';
        }
      } catch (error) { if (!destroyed) storageNote.textContent = `导出失败：${error.message}`; }
    }
    function onVisibility() {
      if (document.hidden && !destroyed && game.pause()) { render(); syncTicker(); }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return {
      activate() { if (!destroyed) { active = true; render(); syncTicker(); } },
      deactivate() { if (!destroyed) { active = false; game.pause(); stopTicker(); render(); } },
      destroy() {
        if (destroyed) return;
        active = false; game.pause(); stopTicker(); destroyed = true;
        document.removeEventListener('visibilitychange', onVisibility);
        for (const [url, timer] of downloadUrls) { clearTimeout(timer); URL.revokeObjectURL(url); }
        downloadUrls.clear();
        stylesheet.remove(); shell.remove(); cellButtons = [];
      },
    };
  },
};
