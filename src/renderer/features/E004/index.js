import { h } from '../../core/ui.js';
import { DIRECTIONS, PipeGame, validScore } from './model.mjs';

const SCORE_KEY = 'features.E004.scores';
const LOCAL_KEY = 'agent-toolbox:E004:scores:v1';
const position = (index, width) => `${Math.floor(index / width) + 1} 行 ${index % width + 1} 列`;

function loadScores(ctx) {
  let saved = null;
  let note = '';
  try { saved = ctx.config?.get ? ctx.config.get(SCORE_KEY, null) : JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); }
  catch { note = '成绩读取失败，本局仍可正常游玩。'; }
  const recent = Array.isArray(saved?.recent) ? saved.recent.filter(validScore).slice(0, 20) : [];
  const best = [];
  for (const score of Array.isArray(saved?.best) ? saved.best.filter(validScore) : []) {
    const old = best.find((s) => s.level === score.level);
    if (!old) best.push(score); else if (score.moves < old.moves) best[best.indexOf(old)] = score;
  }
  return { recent, best, note };
}

export default {
  id: 'E004',
  create(root, ctx = {}) {
    let game = new PipeGame(1);
    let active = true;
    let destroyed = false;
    let preview = true;
    let counterclockwise = false;
    let focusIndex = 0;
    let recorded = false;
    let cells = [];
    let writeQueue = Promise.resolve();
    const downloadUrls = new Map();
    const scores = loadScores(ctx);
    const style = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
    const levelSelect = h('select', { 'aria-label': '选择关卡', onchange: () => changeLevel(Number(levelSelect.value)) },
      Array.from({ length: 20 }, (_, i) => h('option', { value: i + 1 }, `第 ${i + 1} 关`)));
    const previousButton = h('button', { type: 'button', onclick: () => changeLevel(game.getView().id - 1) }, '上一关');
    const nextButton = h('button', { type: 'button', onclick: () => changeLevel(game.getView().id + 1) }, '下一关');
    const pauseButton = h('button', { type: 'button', onclick: togglePause }, '暂停');
    const resetButton = h('button', { type: 'button', onclick: reset }, '重置本关');
    const previewButton = h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => {
      if (!active || destroyed) return;
      preview = !preview; render(true);
    } }, '路径预览 · 开');
    const turnButton = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => {
      if (!active || destroyed) return;
      counterclockwise = !counterclockwise; updateTurnButton();
    } }, '点击：顺时针');
    const moves = h('strong', {});
    const best = h('strong', {});
    const nodes = h('strong', {});
    const progress = h('strong', {});
    const status = h('p', { class: 'e004-status', role: 'status', 'aria-live': 'polite' });
    const board = h('div', { role: 'grid', class: 'e004-board', 'aria-label': '管道棋盘', onkeydown: onKey });
    const legend = h('p', { class: 'e004-legend' }, '→ 左侧进水 · 右侧出水 → · ◇ 必经节点 · 蓝色为已流到的管道 · 红色标出断口');
    const levelNote = h('p', { class: 'e004-muted' });
    const routeText = h('p', { class: 'e004-route' });
    const history = h('ol', { class: 'e004-history' });
    const storageNote = h('p', { class: 'e004-muted', role: 'status' }, scores.note);
    const exportButton = h('button', { type: 'button', onclick: exportScores }, '导出通关记录');
    const shell = h('section', { class: 'feature-e004', 'aria-label': '管道接通' },
      h('header', { class: 'e004-heading' }, h('div', {}, h('h2', {}, '管道接通'), h('p', {}, '旋转管件，让水经过全部 ◇ 节点，再到右侧出口。')),
        h('div', { class: 'e004-actions' }, resetButton, pauseButton)),
      h('nav', { class: 'e004-level-nav', 'aria-label': '关卡导航' }, previousButton, levelSelect, nextButton, levelNote),
      h('div', { class: 'e004-stats' }, stat('旋转步数', moves), stat('本关最佳', best), stat('必经节点', nodes), stat('已通关', progress)),
      status,
      h('div', { class: 'e004-tools' }, previewButton, turnButton),
      h('div', { class: 'e004-board-scroll' }, board), legend,
      h('p', { class: 'e004-help' }, '点击旋转 90°，右键反向旋转。方向键移动，Enter / 空格旋转，R 或 Shift+Enter 反向旋转，Esc 暂停。两个接口必须相向才能通水；接到出口但漏过节点仍不算完成。'),
      routeText,
      h('section', { class: 'e004-results', 'aria-label': '通关记录' }, h('div', { class: 'e004-result-heading' }, h('h3', {}, '最近 20 次通关'), exportButton), history, storageNote));
    root.append(style, shell);
    render();

    function stat(label, value) { return h('div', {}, h('span', {}, label), value); }
    function updateTurnButton() {
      turnButton.setAttribute('aria-pressed', String(counterclockwise));
      turnButton.textContent = counterclockwise ? '点击：逆时针' : '点击：顺时针';
    }
    function changeLevel(id) {
      if (!active || destroyed) return;
      try {
        const next = new PipeGame(id);
        game.pause(); game = next; focusIndex = 0; recorded = false;
        render();
      } catch (error) { status.textContent = error.message; }
    }
    function reset() {
      if (!active || destroyed) return;
      game.reset(); recorded = false; focusIndex = game.getView().entrance; render();
    }
    function togglePause() {
      if (!active || destroyed) return;
      if (game.getView().phase === 'paused') game.resume(); else game.pause();
      render();
      if (game.getView().phase === 'playing') cells[focusIndex]?.focus();
    }
    function rotate(index, direction) {
      if (!active || destroyed) return;
      const hadFocus = board.contains(document.activeElement);
      focusIndex = index;
      if (game.rotate(index, direction)) { render(); if (hadFocus) cells[focusIndex]?.focus(); }
    }
    function onKey(event) {
      if (!active || destroyed || game.getView().phase === 'paused') return;
      const view = game.getView();
      let next = focusIndex;
      if (event.key === 'ArrowLeft') next -= focusIndex % view.width ? 1 : 0;
      else if (event.key === 'ArrowRight') next += focusIndex % view.width < view.width - 1 ? 1 : 0;
      else if (event.key === 'ArrowUp') next = Math.max(focusIndex % view.width, focusIndex - view.width);
      else if (event.key === 'ArrowDown') next = Math.min((view.height - 1) * view.width + focusIndex % view.width, focusIndex + view.width);
      else if (event.key === 'Home') next = event.ctrlKey ? 0 : Math.floor(focusIndex / view.width) * view.width;
      else if (event.key === 'End') next = event.ctrlKey ? view.cells.length - 1 : (Math.floor(focusIndex / view.width) + 1) * view.width - 1;
      else if (event.key === 'Enter' || event.key === ' ' || event.key.toLowerCase() === 'r') {
        event.preventDefault(); rotate(focusIndex, event.shiftKey || event.key.toLowerCase() === 'r' ? -1 : counterclockwise ? -1 : 1); return;
      } else if (event.key === 'Escape') { event.preventDefault(); togglePause(); pauseButton.focus(); return; }
      else return;
      event.preventDefault(); cells[focusIndex]?.setAttribute('tabindex', '-1'); focusIndex = next; cells[focusIndex]?.focus();
    }
    function remember() {
      const result = game.result();
      if (!result || recorded) return;
      recorded = true;
      const entry = { ...result, finishedAt: new Date().toISOString() };
      scores.recent = [entry, ...scores.recent].slice(0, 20);
      const old = scores.best.find((s) => s.level === entry.level);
      if (!old) scores.best.push(entry); else if (entry.moves < old.moves) scores.best[scores.best.indexOf(old)] = entry;
      const snapshot = { version: 1, recent: [...scores.recent], best: [...scores.best] };
      writeQueue = writeQueue.then(async () => {
        try {
          if (ctx.config?.set) await ctx.config.set(SCORE_KEY, snapshot);
          else localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot));
          if (!destroyed) storageNote.textContent = '通关记录保存在本机；每关保存最少步数，重置或切关不会记为失败。';
        } catch { if (!destroyed) storageNote.textContent = '成绩保存失败，本次打开期间仍可查看并导出。'; }
      });
    }
    function render(keepFocus = false) {
      if (destroyed) return;
      const focused = keepFocus && board.contains(document.activeElement);
      remember();
      const view = game.getView();
      levelSelect.value = view.id;
      previousButton.disabled = view.id === 1; nextButton.disabled = view.id === 20;
      moves.textContent = `${view.moves} 步`;
      const record = scores.best.find((s) => s.level === view.id);
      best.textContent = record ? `${record.moves} 步` : '—';
      progress.textContent = `${scores.best.length} / 20`;
      nodes.textContent = view.flow ? `${view.flow.visitedRequired.length} / ${view.required.length}` : '已遮住';
      levelNote.textContent = `${view.width}×${view.height} · ${view.required.length} 个必经节点 · 局号 ${view.seed}`;
      pauseButton.textContent = view.phase === 'paused' ? '继续' : '暂停'; pauseButton.disabled = view.phase === 'won';
      previewButton.textContent = preview ? '路径预览 · 开' : '路径预览 · 关';
      previewButton.setAttribute('aria-pressed', String(preview)); previewButton.disabled = view.phase === 'paused';
      turnButton.disabled = view.phase !== 'playing'; updateTurnButton();
      board.setAttribute('aria-rowcount', String(view.height)); board.setAttribute('aria-colcount', String(view.width));
      board.style.setProperty('--e004-columns', String(view.width));
      if (view.phase === 'paused') {
        status.textContent = '已暂停，棋盘已遮住。点击“继续”恢复。';
        board.replaceChildren(h('div', { class: 'e004-paused' }, h('strong', {}, '暂停中'), h('span', {}, '回来后继续接通管道')));
        routeText.textContent = ''; cells = [];
      } else {
        const flow = view.flow;
        const showWater = preview || view.phase === 'won';
        if (view.phase === 'won') status.textContent = `水已经过全部 ${view.required.length} 个节点并到达出口！${view.moves} 步通关。`;
        else if (flow.reachedExit) status.textContent = `已接到出口，但还有 ${flow.missingRequired.length} 个必经节点未经过。`;
        else if (preview && flow.leak) {
          const direction = DIRECTIONS.find((d) => d.bit === flow.leak.direction).label;
          status.textContent = `水停在 ${position(flow.leak.index, view.width)} 的${direction}侧${flow.leak.reason === 'entry' ? '入口' : '断口'}；下一个接口还没接上。`;
        } else status.textContent = '旋转直管和弯管，把入口、必经节点和出口连起来。';
        cells = [];
        const rows = [];
        for (let row = 0; row < view.height; row++) {
          const rowCells = [];
          for (let col = 0; col < view.width; col++) {
            const index = row * view.width + col;
            const cell = view.cells[index];
            const checkpoint = view.required.indexOf(index);
            const wet = showWater && flow.path.includes(index);
            const leak = preview && flow.leak?.index === index;
            const dirs = DIRECTIONS.filter((d) => cell.ports & d.bit);
            const tags = [index === view.entrance ? '入口' : '', index === view.exit ? '出口' : '', checkpoint >= 0 ? `必经节点 ${checkpoint + 1}` : '', wet ? '水已到达' : '', leak ? '断口' : ''].filter(Boolean);
            const button = h('button', {
              type: 'button', role: 'gridcell', tabindex: index === focusIndex ? '0' : '-1', 'aria-rowindex': row + 1, 'aria-colindex': col + 1,
              'aria-disabled': view.phase === 'won' ? 'true' : 'false',
              'aria-label': `${position(index, view.width)}，${cell.type === 'straight' ? '直管' : '弯管'}，接口向${dirs.map((d) => d.label).join('和')}${tags.length ? `，${tags.join('，')}` : ''}`,
              class: `e004-cell${wet ? ' is-wet' : ''}${leak ? ' is-leak' : ''}${checkpoint >= 0 ? ' is-checkpoint' : ''}`,
              dataset: { ports: cell.ports, index },
              onfocus: () => { cells.forEach((b) => b.setAttribute('tabindex', '-1')); focusIndex = index; button.setAttribute('tabindex', '0'); },
              onclick: () => rotate(index, counterclockwise ? -1 : 1),
              oncontextmenu: (event) => { event.preventDefault(); rotate(index, -1); },
            }, h('span', { class: 'e004-pipe', 'aria-hidden': 'true' },
              dirs.map((d) => h('span', { class: `e004-arm e004-arm-${d.bit}${leak && flow.leak.direction === d.bit ? ' is-gap' : ''}` })),
              h('span', { class: 'e004-hub' })),
              checkpoint >= 0 ? h('span', { class: 'e004-node', 'aria-hidden': 'true' }, `◇${checkpoint + 1}`) : null);
            rowCells.push(button); cells.push(button);
          }
          rows.push(h('div', { class: 'e004-row', role: 'row' },
            h('span', { class: 'e004-terminal', 'aria-hidden': 'true' }, Math.floor(view.entrance / view.width) === row ? '→' : ''),
            rowCells,
            h('span', { class: 'e004-terminal', 'aria-hidden': 'true' }, Math.floor(view.exit / view.width) === row ? '→' : '')));
        }
        board.replaceChildren(...rows);
        routeText.textContent = showWater ? `水流路径（${flow.path.length} 格）：${flow.path.length ? flow.path.map((i) => `(${Math.floor(i / view.width) + 1},${i % view.width + 1})`).join(' → ') : '入口尚未接通'}。` : '路径预览已关闭；再次打开可定位水流与断口。';
      }
      levelSelect.querySelectorAll('option').forEach((option) => { const id = Number(option.value); option.textContent = `第 ${id} 关${scores.best.some((s) => s.level === id) ? ' · 已通关' : ''}`; });
      renderHistory();
      if (focused) cells[focusIndex]?.focus();
    }
    function renderHistory() {
      exportButton.disabled = !scores.recent.length && !scores.best.length;
      if (!scores.recent.length) { history.replaceChildren(h('li', { class: 'e004-muted' }, '完成一关后，这里会记录关卡、通关步数与水流路径。')); return; }
      history.replaceChildren(...scores.recent.map((s) => h('li', {}, h('span', {}, `第 ${s.level} 关`), h('strong', {}, `${s.moves} 步`), h('span', { class: 'e004-muted' }, `${s.path.length} 格路径`), h('button', { type: 'button', onclick: () => changeLevel(s.level) }, '重玩'))));
    }
    async function exportScores() {
      if (!active || destroyed) return;
      const content = JSON.stringify({ feature: 'E004', version: 1, exportedAt: new Date().toISOString(), recent: scores.recent, best: scores.best }, null, 2);
      try {
        if (window.toolbox?.files?.saveTextSupportsCopyOnly && window.toolbox.files.saveText) {
          const result = await window.toolbox.files.saveText({ content, extension: 'json', defaultName: '管道通关记录.json', copyOnly: true });
          if (!destroyed) storageNote.textContent = result?.ok ? '通关记录已导出。' : result?.canceled ? '已取消导出。' : result?.error || '未导出记录。';
        } else {
          const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
          downloadUrls.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000));
          const a = h('a', { href: url, download: '管道通关记录.json' }); document.body.append(a); a.click(); a.remove();
          storageNote.textContent = '已提交通关记录文件下载。';
        }
      } catch (error) { if (!destroyed) storageNote.textContent = `导出失败：${error.message}`; }
    }
    function onVisibility() { if (document.hidden && !destroyed && game.pause()) render(); }
    document.addEventListener('visibilitychange', onVisibility);
    return {
      activate() { if (!destroyed) { active = true; render(); } },
      deactivate() { if (!destroyed) { active = false; game.pause(); render(); } },
      destroy() {
        if (destroyed) return;
        active = false; game.pause(); destroyed = true;
        document.removeEventListener('visibilitychange', onVisibility);
        for (const [url, timer] of downloadUrls) { clearTimeout(timer); URL.revokeObjectURL(url); }
        downloadUrls.clear(); cells = []; style.remove(); shell.remove();
      },
    };
  },
};
