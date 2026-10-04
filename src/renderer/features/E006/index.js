import { h } from '../../core/ui.js';
import { Hanoi, UNDO_LIMIT, betterScore, validScore } from './model.mjs';

const SCORE_KEY = 'features.E006.scores';
const LOCAL_KEY = 'agent-toolbox:E006:scores:v1';
const NAMES = ['A · 起点', 'B · 辅助', 'C · 目标'];
const LETTERS = ['A', 'B', 'C'];
const timeText = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${Math.floor(ms % 1000 / 100)}`;

function loadScores(ctx) {
  let saved = null;
  let note = '';
  try { saved = ctx.config?.get ? ctx.config.get(SCORE_KEY, null) : JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); }
  catch { note = '成绩读取失败，可以继续游玩。'; }
  const recent = Array.isArray(saved?.recent) ? saved.recent.filter(validScore).slice(0, 20) : [];
  const best = [];
  for (const score of Array.isArray(saved?.best) ? saved.best.filter(validScore) : []) {
    const old = best.find((s) => s.disks === score.disks);
    if (!old) best.push(score); else if (betterScore(score, old)) best[best.indexOf(old)] = score;
  }
  return { recent, best, note };
}

export default {
  id: 'E006',
  create(root, ctx = {}) {
    let game = new Hanoi(3, { now: () => performance.now() });
    let active = true;
    let destroyed = false;
    let ticker = null;
    let selected = null;
    let suggestion = null;
    let focusIndex = 0;
    let recorded = false;
    let drag = null;
    let round = 0;
    let towers = [];
    let writeQueue = Promise.resolve();
    const scores = loadScores(ctx);
    const downloadUrls = new Map();
    const style = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
    const disksSelect = h('select', { 'aria-label': '新局盘数' }, [3, 4, 5, 6].map((n) => h('option', { value: n }, `${n} 层`)));
    const pauseButton = h('button', { type: 'button', onclick: togglePause }, '暂停');
    const undoButton = h('button', { type: 'button', onclick: undo }, '撤销');
    const hintButton = h('button', { type: 'button', onclick: hint }, '单步提示');
    const clock = h('strong', { 'aria-label': '本局用时' });
    const moves = h('strong', {});
    const minimum = h('strong', {});
    const remaining = h('strong', {});
    const best = h('strong', {});
    const status = h('p', { class: 'e006-status', role: 'status', 'aria-live': 'polite' });
    const helpState = h('p', { class: 'e006-help-state' });
    const board = h('div', { class: 'e006-board', role: 'group', 'aria-label': '汉诺塔三根柱子', onkeydown: onKey });
    const history = h('ol', { class: 'e006-history' });
    const storageNote = h('p', { class: 'e006-muted', role: 'status' }, scores.note);
    const exportButton = h('button', { type: 'button', onclick: exportScores }, '导出成绩');
    const shell = h('section', { class: 'feature-e006', 'aria-label': '汉诺塔' },
      h('header', { class: 'e006-heading' }, h('div', {}, h('h2', {}, '汉诺塔'), h('p', {}, '把所有盘从 A 移到 C；只移顶盘，大盘不能压小盘。')),
        h('div', { class: 'e006-actions' }, h('label', {}, disksSelect), h('button', { type: 'button', onclick: () => newGame(Number(disksSelect.value)) }, '新局'), h('button', { type: 'button', onclick: () => newGame(game.getView().disks) }, '重置本局'), pauseButton)),
      h('p', { class: 'e006-muted' }, '选择 3–6 层后点击“新局”。时间从首次合法移动开始；选柱、非法尝试和提示都不会启动计时。'),
      h('div', { class: 'e006-stats' }, stat('已走步数', moves), stat('初始理论最少', minimum), stat('当前最短剩余', remaining), stat('用时', clock), stat('同层最佳', best)),
      status,
      h('div', { class: 'e006-tools' }, undoButton, hintButton, h('button', { type: 'button', onclick: () => { if (active && !destroyed) { selected = null; suggestion = null; render(); } } }, '取消选柱'), helpState),
      board,
      h('p', { class: 'e006-help' }, '先点源柱，再点目标柱；也可拖动顶盘到另一根柱。方向键移焦点，Enter / 空格或 1、2、3 选柱，U 撤销，H 提示，Esc 暂停。'),
      h('p', { class: 'e006-muted' }, `撤销保留最近 ${UNDO_LIMIT} 次移动；撤销不扣已走步数，最终成绩包含尝试成本。提示只显示下一步，由你完成移动。`),
      h('section', { class: 'e006-results', 'aria-label': '本地完成记录' }, h('div', { class: 'e006-result-heading' }, h('h3', {}, '最近 20 次完成'), exportButton), history, storageNote));
    root.append(style, shell);
    disksSelect.value = '3';
    render();

    function stat(label, value) { return h('div', {}, h('span', {}, label), value); }
    function stopTicker() { if (ticker !== null) clearInterval(ticker); ticker = null; }
    function syncTicker() {
      stopTicker();
      if (active && !destroyed && game.getView().phase === 'running') ticker = setInterval(() => { clock.textContent = timeText(game.getView().elapsedMs); }, 100);
    }
    function newGame(disks) {
      if (!active || destroyed) return;
      try {
        const next = new Hanoi(disks, { now: () => performance.now() });
        game.pause(); stopTicker(); game = next; disksSelect.value = String(disks); round++;
        selected = null; suggestion = null; drag = null; recorded = false; focusIndex = 0;
        render();
      } catch (error) { status.textContent = error.message; }
    }
    function choose(tower) {
      if (!active || destroyed || !['ready', 'running'].includes(game.getView().phase)) return;
      focusIndex = tower;
      const hadFocus = board.contains(document.activeElement);
      if (selected === null) {
        if (!game.getView().towers[tower].length) { status.textContent = '这根柱子是空的，请选择有盘的源柱。'; return; }
        selected = tower; suggestion = null; render();
      } else if (selected === tower) { selected = null; suggestion = null; render(); }
      else move(selected, tower);
      if (hadFocus) towers[focusIndex]?.focus();
    }
    function move(from, to) {
      if (!active || destroyed) return;
      const result = game.move(from, to);
      if (!result.ok) {
        status.textContent = ({ largerOnSmaller: '大盘不能压小盘。请换一根目标柱，当前盘没有移动。', emptySource: '源柱没有顶盘可以移动。', sameTower: '源柱与目标柱相同。', invalidTower: '柱子编号无效。', pausedOrFinished: '当前已暂停或完成，请继续或重开。' })[result.reason];
        return;
      }
      selected = null; suggestion = null; drag = null; focusIndex = to;
      render(); syncTicker();
    }
    function undo() {
      if (!active || destroyed) return;
      const hadFocus = board.contains(document.activeElement);
      if (game.undo()) { selected = null; suggestion = null; drag = null; render(); syncTicker(); if (hadFocus) towers[focusIndex]?.focus(); }
    }
    function hint() {
      if (!active || destroyed) return;
      const result = game.hint();
      if (!result?.move) return;
      suggestion = result; selected = result.move.from; render();
    }
    function togglePause() {
      if (!active || destroyed) return;
      if (game.getView().phase === 'paused') game.resume(); else game.pause();
      selected = null; suggestion = null; drag = null; render(); syncTicker();
      if (game.getView().phase === 'running') towers[focusIndex]?.focus();
    }
    function onKey(event) {
      if (!active || destroyed || game.getView().phase === 'paused') return;
      let next = focusIndex;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, next - 1);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(2, next + 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 2;
      else if (['1', '2', '3'].includes(event.key)) { event.preventDefault(); choose(Number(event.key) - 1); towers[focusIndex]?.focus(); return; }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(focusIndex); return; }
      else if (event.key.toLowerCase() === 'u') { event.preventDefault(); undo(); return; }
      else if (event.key.toLowerCase() === 'h') { event.preventDefault(); hint(); towers[focusIndex]?.focus(); return; }
      else if (event.key === 'Escape') { event.preventDefault(); togglePause(); pauseButton.focus(); return; }
      else return;
      event.preventDefault(); towers[focusIndex]?.setAttribute('tabindex', '-1'); focusIndex = next; towers[next]?.focus();
    }
    function startDrag(event, from, disk) {
      const view = game.getView();
      if (!active || destroyed || !['ready', 'running'].includes(view.phase) || view.towers[from].at(-1) !== disk) { event.preventDefault(); return; }
      drag = { from, disk, round }; selected = from; suggestion = null;
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', `E006:${from}:${disk}`); }
      status.textContent = `正在拖动盘 ${disk}，从 ${LETTERS[from]} 放到另一根柱子。`;
    }
    function drop(event, to) {
      event.preventDefault();
      const source = drag; drag = null;
      if (!source || source.round !== round || !active || destroyed) return;
      const view = game.getView();
      if (!['ready', 'running'].includes(view.phase) || view.towers[source.from].at(-1) !== source.disk) return;
      move(source.from, to);
    }
    function endDrag() {
      if (drag && !destroyed) { drag = null; selected = null; render(); }
    }
    function remember() {
      const result = game.result();
      if (!result || recorded) return;
      recorded = true;
      const entry = { ...result, finishedAt: new Date().toISOString() };
      scores.recent = [entry, ...scores.recent].slice(0, 20);
      const old = scores.best.find((s) => s.disks === entry.disks);
      if (!old) scores.best.push(entry); else if (betterScore(entry, old)) scores.best[scores.best.indexOf(old)] = entry;
      const snapshot = { version: 1, recent: [...scores.recent], best: [...scores.best] };
      writeQueue = writeQueue.then(async () => {
        try {
          if (ctx.config?.set) await ctx.config.set(SCORE_KEY, snapshot);
          else localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot));
          if (!destroyed) storageNote.textContent = '成绩保存在本机；同层先比步数，同步数再比用时。重开和中途退出不计成绩。';
        } catch { if (!destroyed) storageNote.textContent = '保存失败，目前仅本次打开期间保留，可以导出成绩。'; }
      });
    }
    function render() {
      if (destroyed) return;
      remember();
      const view = game.getView();
      moves.textContent = `${view.moves} 步`; minimum.textContent = `${view.minimum} 步`;
      remaining.textContent = view.remaining === null ? '已遮住' : `${view.remaining} 步`;
      clock.textContent = timeText(view.elapsedMs);
      const record = scores.best.find((s) => s.disks === view.disks);
      best.textContent = record ? `${record.moves} 步 / ${timeText(record.elapsedMs)}` : '—';
      pauseButton.disabled = !['running', 'paused'].includes(view.phase); pauseButton.textContent = view.phase === 'paused' ? '继续' : '暂停';
      undoButton.disabled = !view.canUndo; hintButton.disabled = !['ready', 'running'].includes(view.phase);
      helpState.textContent = `${view.disks} 层 · 已撤销 ${view.undos} 次 · 已看提示 ${view.hints} 次`;
      towers = [];
      if (view.phase === 'paused') {
        status.textContent = '已暂停，棋盘和计时都已停止。点击“继续”恢复。';
        board.replaceChildren(h('div', { class: 'e006-paused' }, h('strong', {}, '暂停中'), h('span', {}, '盘的位置会保留')));
      } else {
        if (view.phase === 'won') status.textContent = `全部 ${view.disks} 个盘已移到 C！${view.moves} 步完成；初始理论最少 ${view.minimum} 步。`;
        else if (suggestion) status.textContent = `提示：盘 ${suggestion.move.disk} 从 ${LETTERS[suggestion.move.from]} 移到 ${LETTERS[suggestion.move.to]}。当前局面最短还需 ${suggestion.remaining} 步。`;
        else status.textContent = selected === null ? `当前 ${view.disks} 层。先选有盘的源柱，再选目标柱；只移动顶盘。` : `已选 ${LETTERS[selected]} 的顶盘 ${view.towers[selected].at(-1)}。请选择目标柱，或再点源柱取消。`;
        const buttons = view.towers.map((tower, index) => {
          const top = tower.at(-1);
          const button = h('button', {
            type: 'button', class: `e006-tower${selected === index ? ' is-selected' : ''}${suggestion?.move.to === index ? ' is-target' : ''}`,
            tabindex: index === focusIndex ? '0' : '-1', 'aria-pressed': selected === index ? 'true' : 'false', 'aria-disabled': view.phase === 'won' ? 'true' : 'false',
            'aria-label': `${NAMES[index]}，${tower.length ? `从下到上盘 ${tower.join('、')}，顶盘 ${top}` : '空柱'}${selected === index ? '，已选择源柱' : ''}${suggestion?.move.to === index ? '，提示目标柱' : ''}`,
            onfocus: () => { towers.forEach((b) => b.setAttribute('tabindex', '-1')); focusIndex = index; button.setAttribute('tabindex', '0'); },
            onclick: () => choose(index),
            ondragover: (event) => { if (drag && active && !destroyed) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; } },
            ondrop: (event) => drop(event, index),
          }, h('span', { class: 'e006-tower-name', 'aria-hidden': 'true' }, NAMES[index]),
            h('span', { class: 'e006-rod', 'aria-hidden': 'true' }), h('span', { class: 'e006-base', 'aria-hidden': 'true' }),
            h('span', { class: 'e006-stack', 'aria-hidden': 'true' }, [...tower].reverse().map((disk) => h('span', {
              class: `e006-disk${disk === top ? ' is-top' : ''}`, style: { width: `${32 + Math.round(disk / view.disks * 62)}%` },
              draggable: disk === top && view.phase !== 'won' ? 'true' : 'false', dataset: { disk },
              ondragstart: (event) => startDrag(event, index, disk), ondragend: endDrag,
            }, String(disk)))));
          towers.push(button); return button;
        });
        board.replaceChildren(...buttons);
      }
      renderHistory();
    }
    function renderHistory() {
      exportButton.disabled = !scores.recent.length && !scores.best.length;
      if (!scores.recent.length) { history.replaceChildren(h('li', { class: 'e006-muted' }, '完整移动到 C 后，会在这里留下完成记录。')); return; }
      history.replaceChildren(...scores.recent.map((s) => h('li', {}, h('strong', {}, `${s.disks} 层 · ${s.moves} 步`), h('span', {}, timeText(s.elapsedMs)), h('span', { class: 'e006-muted' }, `撤销 ${s.undos} · 提示 ${s.hints}`), h('button', { type: 'button', onclick: () => newGame(s.disks) }, '重玩'))));
    }
    async function exportScores() {
      if (!active || destroyed) return;
      const content = JSON.stringify({ feature: 'E006', version: 1, exportedAt: new Date().toISOString(), recent: scores.recent, best: scores.best }, null, 2);
      try {
        if (window.toolbox?.files?.saveTextSupportsCopyOnly && window.toolbox.files.saveText) {
          const result = await window.toolbox.files.saveText({ content, extension: 'json', defaultName: '汉诺塔成绩.json', copyOnly: true });
          if (!destroyed) storageNote.textContent = result?.ok ? '成绩已导出。' : result?.canceled ? '已取消导出。' : result?.error || '未导出成绩。';
        } else {
          const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
          downloadUrls.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000));
          const a = h('a', { href: url, download: '汉诺塔成绩.json' }); document.body.append(a); a.click(); a.remove(); storageNote.textContent = '已提交成绩文件下载。';
        }
      } catch (error) { if (!destroyed) storageNote.textContent = `导出失败：${error.message}`; }
    }
    function onVisibility() { if (document.hidden && !destroyed && game.pause()) { selected = null; suggestion = null; drag = null; render(); stopTicker(); } }
    document.addEventListener('visibilitychange', onVisibility);
    return {
      activate() { if (!destroyed) { active = true; render(); syncTicker(); } },
      deactivate() { if (!destroyed) { active = false; game.pause(); selected = null; suggestion = null; drag = null; stopTicker(); render(); } },
      destroy() {
        if (destroyed) return;
        active = false; game.pause(); stopTicker(); destroyed = true;
        document.removeEventListener('visibilitychange', onVisibility);
        for (const [url, timer] of downloadUrls) { clearTimeout(timer); URL.revokeObjectURL(url); }
        downloadUrls.clear(); drag = null; towers = []; style.remove(); shell.remove();
      },
    };
  },
};
