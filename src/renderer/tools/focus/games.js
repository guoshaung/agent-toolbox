import { h, toast } from '../../core/ui.js';
import { createSiteGrid } from '../../core/sitegrid.js';

/** 网页版益智游戏：webview 常驻，可自己加。 */
const PRESET_GAMES = [
  { name: 'TapTap', url: 'https://www.taptap.cn', desc: '找 Q 版围棋等益智游戏', emoji: '🎮' },
  { name: '围棋 OGS', url: 'https://online-go.com', desc: '在线围棋对弈 / 死活题', emoji: '⚫' },
  { name: '腾讯野狐围棋', url: 'https://www.foxwq.com', desc: '国产围棋平台', emoji: '🏁' },
  { name: '2048', url: 'https://play2048.co', desc: '经典数字合成', emoji: '🔢' },
  { name: '数独', url: 'https://sudoku.com', desc: '网页版数独', emoji: '🧩' },
  { name: 'Lichess', url: 'https://lichess.org', desc: '国际象棋 / 谜题', emoji: '♟️' },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 舒尔特方格：按 1→N 顺序点格子，练注意力和视野广度。
 * 计时 + 最佳记录，格子数 3/4/5/6 可调。
 */
function createSchulte(host, config) {
  let size = Math.min(6, Math.max(3, Number(config.get('focus.schulte.size', 5))));
  let next = 1;
  let mistakes = 0;
  let startedAt = 0;
  let ticker = null;
  let playing = false;

  const timeEl = h('span', { class: 'schulte__time mono' }, '0.0s');
  const bestEl = h('span', { class: 'faint' });
  const gridEl = h('div', { class: 'schulte__grid' });
  const sizeSel = h('select', { class: 'field field--sm', onchange: () => {
    size = Number(sizeSel.value);
    config.set('focus.schulte.size', size);
    renderBest();
    deal();
  } },
    [3, 4, 5, 6].map((n) => h('option', { value: String(n), selected: n === size ? true : undefined }, `${n}×${n}`)),
  );

  const bestKey = () => `focus.schulte.best${size}`;
  function renderBest() {
    const best = config.get(bestKey());
    bestEl.textContent = best ? `最佳 ${Number(best).toFixed(1)}s` : '还没有记录';
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  function finish() {
    stopTicker();
    playing = false;
    const seconds = (Date.now() - startedAt) / 1000;
    const best = config.get(bestKey());
    if (!best || seconds < Number(best)) {
      config.set(bestKey(), seconds);
      toast(`新纪录 ${seconds.toFixed(1)}s！`, 'good');
    } else {
      toast(`完成 ${seconds.toFixed(1)}s，点错 ${mistakes} 次`, 'good');
    }
    renderBest();
  }

  function onPick(e) {
    if (!playing) return;
    const cell = e.currentTarget;
    const value = Number(cell.textContent);
    if (value === next) {
      cell.classList.add('is-done');
      next += 1;
      if (next > size * size) finish();
    } else {
      mistakes += 1;
      cell.classList.add('is-wrong');
      setTimeout(() => cell.classList.remove('is-wrong'), 300);
    }
  }

  function deal() {
    stopTicker();
    next = 1;
    mistakes = 0;
    playing = true;
    startedAt = Date.now();
    gridEl.textContent = '';
    gridEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    for (const n of shuffle([...Array(size * size).keys()].map((i) => i + 1))) {
      gridEl.appendChild(h('button', { class: 'schulte__cell', onclick: onPick }, String(n)));
    }
    ticker = setInterval(() => {
      timeEl.textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    }, 100);
  }

  host.append(
    h('div', { class: 'bar' },
      h('strong', {}, '舒尔特方格'),
      sizeSel,
      timeEl,
      bestEl,
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn btn--sm btn--primary', onclick: () => deal() }, '重新发牌'),
    ),
    h('div', { class: 'schulte__stage' }, gridEl),
    h('div', { class: 'faint', style: { padding: '0 18px 10px' } },
      '按 1 → N 的顺序点，越快越好。眼睛盯住中心，用余光找数字——练的就是这个。',
    ),
  );

  renderBest();
  deal();
  return { deactivate: stopTicker };
}

/**
 * 流光记忆：格子按顺序亮起，看一遍后照着点回来。
 * 每过一关序列多一步，考工作记忆容量，最长纪录本地保存。
 */
function createFlowMemory(host, config) {
  const PADS = 9;
  let sequence = [];
  let cursor = 0;
  let accepting = false;
  let timers = [];

  const levelEl = h('span', { class: 'mono' }, '第 0 关');
  const bestEl = h('span', { class: 'faint' });
  const msgEl = h('span', { class: 'faint' }, '点「开始」，记住亮起的顺序');
  const padsEl = h('div', { class: 'memory__pads' });

  function renderBest() {
    const best = config.get('focus.flowMemory.best');
    bestEl.textContent = best ? `最长 ${best} 步` : '';
  }

  function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers = [];
  }

  function flash(index, ms = 380) {
    const pad = padsEl.children[index];
    pad.classList.add('is-lit');
    timers.push(setTimeout(() => pad.classList.remove('is-lit'), ms));
  }

  function playSequence() {
    accepting = false;
    msgEl.textContent = '看好了…';
    sequence.forEach((padIndex, i) => {
      timers.push(setTimeout(() => flash(padIndex), 500 + i * 600));
    });
    timers.push(setTimeout(() => {
      accepting = true;
      cursor = 0;
      msgEl.textContent = '照着点回来';
    }, 500 + sequence.length * 600));
  }

  function nextRound() {
    sequence.push(Math.floor(Math.random() * PADS));
    levelEl.textContent = `第 ${sequence.length} 关`;
    playSequence();
  }

  function gameOver() {
    accepting = false;
    const reached = sequence.length - 1;
    const best = Number(config.get('focus.flowMemory.best')) || 0;
    if (reached > best) {
      config.set('focus.flowMemory.best', reached);
      toast(`新纪录：记住 ${reached} 步！`, 'good');
    } else {
      toast(`倒在第 ${sequence.length} 关，最长 ${reached} 步`, 'info');
    }
    msgEl.textContent = '点「开始」再来一局';
    renderBest();
  }

  function onPad(e) {
    if (!accepting) return;
    const index = Number(e.currentTarget.dataset.index);
    flash(index, 200);
    if (index === sequence[cursor]) {
      cursor += 1;
      if (cursor === sequence.length) {
        accepting = false;
        msgEl.textContent = '对了，加一步…';
        timers.push(setTimeout(nextRound, 800));
      }
    } else {
      gameOver();
    }
  }

  for (let i = 0; i < PADS; i += 1) {
    padsEl.appendChild(h('button', { class: 'memory__pad', dataset: { index: String(i) }, onclick: onPad }));
  }

  host.append(
    h('div', { class: 'bar' },
      h('strong', {}, '流光记忆'),
      levelEl,
      bestEl,
      h('span', { style: { flex: 1 } }),
      msgEl,
      h('button', {
        class: 'btn btn--sm btn--primary',
        onclick: () => {
          clearTimers();
          sequence = [];
          nextRound();
        },
      }, '开始'),
    ),
    h('div', { class: 'memory__stage' }, padsEl),
    h('div', { class: 'faint', style: { padding: '0 18px 10px' } },
      '格子亮起的顺序每关多一步。能在脑子里「回放」几步，就是工作记忆的边界。',
    ),
  );

  renderBest();
  return { deactivate: clearTimers };
}

/** 醒脑：内置小游戏 + 网页版游戏格子铺，三个小页签切换。 */
export function createGames(root, ctx) {
  const { config } = ctx;
  const panels = new Map();
  const deactivators = new Map();
  let current = config.get('focus.gamesTab', 'schulte');

  const tabs = [
    { id: 'schulte', label: '舒尔特方格' },
    { id: 'memory', label: '流光记忆' },
    { id: 'web', label: '网页游戏' },
  ];

  const tabBar = h('div', { class: 'research__subbar', style: { marginLeft: '0' } });
  const body = h('div', { class: 'research__subbody' });

  const factories = {
    schulte: (panel) => createSchulte(panel, config),
    memory: (panel) => createFlowMemory(panel, config),
    web: (panel) => createSiteGrid(panel, {
      presets: PRESET_GAMES,
      configKey: 'focus.gameSites',
      cachePrefix: 'focus.gameFavicons.',
      partition: 'persist:focus',
      config,
    }),
  };

  function select(id) {
    current = id;
    config.set('focus.gamesTab', id);
    for (const btn of tabBar.children) btn.classList.toggle('is-active', btn.dataset.tab === id);
    if (!panels.has(id)) {
      const panel = h('div', { class: 'research__panel' });
      const handle = factories[id](panel);
      if (handle && typeof handle.deactivate === 'function') deactivators.set(id, handle.deactivate);
      panels.set(id, panel);
      body.appendChild(panel);
    }
    for (const [pid, panel] of panels) panel.style.display = pid === id ? 'flex' : 'none';
  }

  for (const t of tabs) {
    tabBar.appendChild(h('button', {
      class: 'btn btn--sm research__subbtn',
      dataset: { tab: t.id },
      onclick: () => select(t.id),
    }, t.label));
  }

  root.append(
    h('div', { class: 'bar' }, tabBar),
    body,
  );

  select(tabs.some((t) => t.id === current) ? current : 'schulte');

  return { deactivate: () => deactivators.forEach((fn) => fn()) };
}
