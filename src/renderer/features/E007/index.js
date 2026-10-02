import { h } from '../../core/ui.js';
import { ColorCode, COLORS, MAX_ROUNDS, RECORD_LIMIT, cleanRecords } from './model.mjs';

const KEY = 'features.E007.records';
const LOCAL_KEY = 'agent-toolbox:E007:records:v1';
const NAMES = { A: '红', B: '蓝', C: '绿', D: '黄', E: '紫', F: '橙' };
const timeText = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const randomSeed = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 0x1000000).toString(36)}`;

export default {
  id: 'E007',
  create(root, ctx = {}) {
    let game = new ColorCode(randomSeed(), { now: () => performance.now() });
    let draft = [null, null, null, null];
    let position = 0;
    let slots = [];
    let active = true;
    let destroyed = false;
    let ticker = null;
    let recorded = false;
    let writeQueue = Promise.resolve();
    let records = [];
    let loadNote = '';
    const urls = new Map();
    try {
      const saved = ctx.config?.get ? ctx.config.get(KEY, null) : JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      records = cleanRecords(saved?.recent);
    } catch { loadNote = '成绩读取失败，可以继续游玩。'; }

    const style = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
    const seedInput = h('input', { type: 'text', maxlength: '32', spellcheck: 'false', autocomplete: 'off', 'aria-label': '局号', value: game.getView().seed });
    const pauseButton = h('button', { type: 'button', onclick: togglePause }, '暂停');
    const clock = h('strong', { 'aria-label': '本局用时' });
    const roundText = h('strong', {});
    const seedText = h('strong', {});
    const status = h('p', { class: 'e007-status', role: 'status', 'aria-live': 'polite', tabindex: '-1' });
    const playArea = h('div', { class: 'e007-play' });
    const history = h('ol', { class: 'e007-records' });
    const storageNote = h('p', { class: 'e007-muted', role: 'status' }, loadNote);
    const exportButton = h('button', { type: 'button', onclick: exportRecords }, '导出成绩');
    const shell = h('section', { class: 'feature-e007', 'aria-label': '猜颜色密码' },
      h('header', { class: 'e007-heading' }, h('div', {}, h('h2', {}, '猜颜色密码'), h('p', {}, '六色四位，可重复。根据反馈，在十轮内解出密码。')),
        h('div', { class: 'e007-actions' }, h('button', { type: 'button', onclick: () => newGame(randomSeed()) }, '随机新局'), h('button', { type: 'button', onclick: () => newGame(game.getView().seed) }, '重玩本局'), pauseButton)),
      h('div', { class: 'e007-seed-control' }, h('label', {}, '复现局号 ', seedInput), h('button', { type: 'button', onclick: () => newGame(seedInput.value.trim()) }, '按局号开局')),
      h('p', { class: 'e007-muted' }, '局号支持 1–32 位字母、数字、下划线或短横线。相同局号生成相同密码；首次提交完整猜测开始计时。'),
      h('div', { class: 'e007-stats' }, stat('当前局号', seedText), stat('剩余轮数', roundText), stat('用时', clock)),
      status,
      h('p', { class: 'e007-rule' }, '“位置命中”表示颜色和位置都对；“仅颜色命中”表示颜色对、位置错。每个密码位最多计一次，两类不重复相加。反馈不指出具体是哪一位。'),
      playArea,
      h('section', { class: 'e007-results', 'aria-label': '本地完成记录' }, h('div', { class: 'e007-result-heading' }, h('h3', {}, `最近 ${RECORD_LIMIT} 局成绩`), exportButton), history, storageNote));
    root.append(style, shell);
    render();

    function stat(label, node) { return h('div', {}, h('span', {}, label), node); }
    function playable() { return active && !destroyed && ['ready', 'running'].includes(game.getView().phase); }
    function stopTicker() { if (ticker !== null) clearInterval(ticker); ticker = null; }
    function syncTicker() {
      stopTicker();
      if (active && !destroyed && game.getView().phase === 'running') ticker = setInterval(() => { clock.textContent = timeText(game.getView().elapsedMs); }, 200);
    }
    function newGame(seed) {
      if (!active || destroyed) return;
      try {
        const next = new ColorCode(seed, { now: () => performance.now() });
        game.pause(); stopTicker(); game = next; seedInput.value = seed;
        draft = [null, null, null, null]; position = 0; recorded = false;
        render();
      } catch (error) { status.textContent = error.message; }
    }
    function chooseColor(color) {
      if (!playable() || !COLORS.includes(color)) return;
      draft[position] = color; position = (position + 1) % 4; render(); slots[position]?.focus();
    }
    function submit() {
      if (!playable()) return;
      if (draft.some((c) => c === null)) { status.textContent = '请填满四位 A–F 再提交；未填满不消耗轮数。'; return; }
      const result = game.submit(draft.join(''));
      if (!result.ok) return;
      draft = [null, null, null, null]; position = 0;
      render(); syncTicker();
      if (playable()) slots[0]?.focus(); else status.focus();
    }
    function onDraftKey(event) {
      if (!playable()) return;
      const key = event.key.toUpperCase();
      if (COLORS.includes(key)) { event.preventDefault(); chooseColor(key); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        position = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (position + (event.key === 'ArrowLeft' ? 3 : 1)) % 4;
        render(); slots[position]?.focus();
      } else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); draft[position] = null; render(); slots[position]?.focus(); }
      else if (event.key === 'Enter') { event.preventDefault(); submit(); }
      else if (event.key === 'Escape') { event.preventDefault(); togglePause(); pauseButton.focus(); }
    }
    function togglePause() {
      if (!active || destroyed) return;
      if (game.getView().phase === 'paused') game.resume(); else game.pause();
      render(); syncTicker();
      if (playable()) slots[position]?.focus();
    }
    function remember() {
      const result = game.result();
      if (!result || recorded) return;
      recorded = true;
      records = cleanRecords([{ ...result, finishedAt: new Date().toISOString() }, ...records]);
      const snapshot = { version: 1, recent: records.map((r) => ({ ...r })) };
      writeQueue = writeQueue.then(async () => {
        try {
          if (ctx.config?.set) await ctx.config.set(KEY, snapshot); else localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot));
          if (!destroyed) storageNote.textContent = '成绩已保存在本机；中途重开或退出不计成绩。';
        } catch { if (!destroyed) storageNote.textContent = '保存失败，目前仅本次打开期间保留，可以导出成绩。'; }
      });
    }
    function chip(color) { return h('span', { class: `e007-chip e007-color-${color}`, 'aria-label': `${color} ${NAMES[color]}` }, color); }
    function render() {
      if (destroyed) return;
      remember();
      const view = game.getView();
      seedText.textContent = view.seed; roundText.textContent = `${view.left} / ${MAX_ROUNDS}`; clock.textContent = timeText(view.elapsedMs);
      pauseButton.disabled = !['running', 'paused'].includes(view.phase); pauseButton.textContent = view.phase === 'paused' ? '继续' : '暂停';
      slots = [];
      if (view.phase === 'paused') {
        status.textContent = '已暂停，猜测记录和输入已遮住，计时停止。点击“继续”恢复。';
        playArea.replaceChildren(h('div', { class: 'e007-paused' }, '暂停中，当前输入和已提交记录会保留。'));
      } else {
        const rows = h('ol', { class: 'e007-guesses', 'aria-label': '逐轮猜测与反馈' }, view.rows.length ? view.rows.map((r) => h('li', {},
          h('strong', {}, `第 ${r.round} 轮`), h('div', { class: 'e007-code', 'aria-label': `猜测 ${r.guess}` }, [...r.guess].map(chip)),
          h('p', {}, `位置命中 ${r.exact} · 仅颜色命中 ${r.colorOnly}`))) : h('li', { class: 'e007-empty' }, '还没有提交猜测。先选择四位，再查看第一轮反馈。'));
        if (view.answer !== null) {
          status.textContent = view.phase === 'won' ? `已解出密码！第 ${view.rounds} 轮通关。答案：${view.answer}。` : `十轮已用完，本局结束。答案：${view.answer}。`;
          playArea.replaceChildren(h('div', { class: 'e007-answer', 'aria-label': '本局答案' }, h('strong', {}, '本局答案'), h('div', { class: 'e007-code' }, [...view.answer].map(chip))), rows);
        } else {
          status.textContent = `第 ${view.rounds + 1} 轮：点输入位，再点颜色；允许重复使用同一颜色。`;
          const draftRow = h('div', { class: 'e007-draft', role: 'group', 'aria-label': '本轮四位输入', onkeydown: onDraftKey },
            draft.map((color, i) => {
              const slot = h('button', { type: 'button', class: `e007-slot${position === i ? ' is-selected' : ''}${color ? ` e007-color-${color}` : ''}`, dataset: { position: i },
                'aria-label': `第 ${i + 1} 位：${color ? `${color} ${NAMES[color]}` : '未选择'}`, 'aria-pressed': position === i ? 'true' : 'false',
                onclick: () => { if (playable()) { position = i; render(); slots[i]?.focus(); } },
                onfocus: () => { if (position !== i && playable()) { position = i; slots.forEach((s, n) => { s.setAttribute('aria-pressed', String(n === i)); s.className = `e007-slot${n === i ? ' is-selected' : ''}${draft[n] ? ` e007-color-${draft[n]}` : ''}`; }); } },
              }, color || '?'); slots.push(slot); return slot;
            }));
          const palette = h('div', { class: 'e007-palette', role: 'group', 'aria-label': '六种颜色 A 至 F' }, COLORS.map((color) => h('button', { type: 'button', class: `e007-color-${color}`, 'aria-label': `${color} ${NAMES[color]}`, dataset: { color }, onclick: () => chooseColor(color) }, h('strong', {}, color), h('span', {}, NAMES[color]))));
          const submitButton = h('button', { type: 'button', class: 'e007-submit', onclick: submit }, '提交猜测');
          playArea.replaceChildren(h('div', { class: 'e007-editor' }, draftRow, palette, h('div', { class: 'e007-editor-actions' }, submitButton, h('button', { type: 'button', onclick: () => { if (playable()) { draft = [null, null, null, null]; position = 0; render(); slots[0]?.focus(); } } }, '清空输入')),
            h('p', { class: 'e007-muted' }, '键盘：Tab 到输入位后按 A–F，左右键选位，Delete 清当前位，Enter 提交，Esc 暂停。')), rows);
        }
      }
      exportButton.disabled = records.length === 0;
      history.replaceChildren(...(records.length ? records.map((r) => h('li', {}, h('strong', {}, r.outcome === 'won' ? `${r.rounds} 轮通关` : '10 轮未解'), h('span', {}, `局号 ${r.seed}`), h('span', {}, timeText(r.elapsedMs)), h('button', { type: 'button', onclick: () => newGame(r.seed) }, '重玩此局'))) : [h('li', { class: 'e007-muted' }, '通关或用完十轮后，在这里记录成绩。')]));
    }
    async function exportRecords() {
      if (!active || destroyed || !records.length) return;
      const content = JSON.stringify({ feature: 'E007', version: 1, generatorVersion: 1, exportedAt: new Date().toISOString(), recent: records }, null, 2);
      try {
        if (window.toolbox?.files?.saveTextSupportsCopyOnly && window.toolbox.files.saveText) {
          const result = await window.toolbox.files.saveText({ content, extension: 'json', defaultName: '猜颜色密码成绩.json', copyOnly: true });
          if (!destroyed) storageNote.textContent = result?.ok ? '成绩已导出。' : result?.canceled ? '已取消导出。' : result?.error || '未导出成绩。';
        } else {
          const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
          urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000));
          const a = h('a', { href: url, download: '猜颜色密码成绩.json' }); document.body.append(a); a.click(); a.remove(); storageNote.textContent = '已提交成绩文件下载。';
        }
      } catch (error) { if (!destroyed) storageNote.textContent = `导出失败：${error.message}`; }
    }
    function onVisibility() { if (document.hidden && !destroyed && game.pause()) { stopTicker(); render(); } }
    document.addEventListener('visibilitychange', onVisibility);
    return {
      activate() { if (!destroyed) { active = true; render(); syncTicker(); } },
      deactivate() { if (!destroyed) { active = false; game.pause(); stopTicker(); render(); } },
      destroy() {
        if (destroyed) return;
        active = false; game.pause(); stopTicker(); destroyed = true;
        document.removeEventListener('visibilitychange', onVisibility);
        for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); }
        urls.clear(); slots = []; style.remove(); shell.remove();
      },
    };
  },
};
