import { h, toast } from '../../core/ui.js';
import { createSiteGrid } from '../../core/sitegrid.js';

/** 网页版益智游戏：webview 常驻，可自己加。 */
const PRESET_GAMES = [
  { name: 'TapTap', url: 'https://www.taptap.cn', desc: '找 Q 版围棋等益智游戏', emoji: '🎮' },
  { name: '围棋 OGS', url: 'https://online-go.com', desc: '在线围棋对弈 / 死活题', emoji: '⚫' },
  { name: '腾讯野狐围棋', url: 'https://www.foxwq.com', desc: '国产围棋平台', emoji: '🏁' },
  { name: '2048', url: 'https://gabrielecirulli.github.io/2048/', desc: '原版开源（官网已禁内嵌）', emoji: '🔢' },
  { name: '数独', url: 'https://sudoku.com', desc: '网页版数独', emoji: '🧩' },
  { name: 'Lichess', url: 'https://lichess.org', desc: '国际象棋 / 谜题', emoji: '♟️' },
];

/**
 * 小游戏流：一局一换的轻量网页游戏，像刷短视频一样上下滑切换。
 * 全部实测可 iframe 内嵌、国内可达；进视口才加载，切走暂停不了就随它去（都是静态页）。
 */
const FEED_GAMES = [
  { name: 'Chrome 恐龙', url: 'https://chromedino.com/', desc: '断网小恐龙，空格跳', emoji: '🦖' },
  { name: '2048', url: 'https://gabrielecirulli.github.io/2048/', desc: '原版开源，方向键合成', emoji: '🔢' },
  { name: '俄罗斯方块', url: 'https://chvin.github.io/react-tetris/', desc: '像素完美复刻，还支持手柄', emoji: '🧱' },
  { name: '笨拙小鸟', url: 'https://ellisonleao.github.io/clumsy-bird/', desc: 'Flappy Bird 克隆，点按飞', emoji: '🐦' },
  { name: 'Floppy Bird', url: 'https://nebez.github.io/floppybird/', desc: '又一个 Flappy，上/空格', emoji: '🐤' },
  { name: '吃豆人', url: 'https://passer-by.com/pacman/', desc: '网页版 Pac-Man，方向键', emoji: '🟡' },
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

/**
 * 小游戏流：竖向滚动 + scroll-snap，一屏一个游戏，滚轮/方向键切换。
 * webview 懒加载：卡片第一次进入视口才设 src，六个游戏不会一上来全连网。
 */
function createGameFeed(host, config) {
  const scroller = h('div', { class: 'feed__scroller' });
  const positionEl = h('span', { class: 'faint feed__position' }, '');
  const webviews = new Map(); // index -> webview
  let current = 0;
  let observer = null;

  // 记住上次玩到哪个
  const saved = Math.min(FEED_GAMES.length - 1, Math.max(0, Number(config.get('focus.gameFeed.index', 0)) || 0));

  function ensureWebview(index) {
    if (webviews.has(index)) return webviews.get(index);
    const view = h('webview', { partition: 'persist:focus', src: FEED_GAMES[index].url });
    webviews.set(index, view);
    scroller.children[index].querySelector('.feed__stage').appendChild(view);
    return view;
  }

  function updatePosition() {
    positionEl.textContent = `${current + 1} / ${FEED_GAMES.length} · ${FEED_GAMES[current].name}`;
    config.set('focus.gameFeed.index', current);
  }

  function goTo(index) {
    const clamped = Math.min(FEED_GAMES.length - 1, Math.max(0, index));
    scroller.children[clamped].scrollIntoView({ behavior: 'smooth' });
  }

  function onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { goTo(current + 1); e.preventDefault(); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { goTo(current - 1); e.preventDefault(); }
  }

  host.append(
    h('div', { class: 'bar' },
      h('strong', {}, '小游戏流'),
      positionEl,
      h('button', { class: 'btn btn--sm', title: '上一局', onclick: () => goTo(current - 1) }, '↑'),
      h('button', { class: 'btn btn--sm', title: '下一局', onclick: () => goTo(current + 1) }, '↓'),
      h('span', { style: { flex: 1 } }),
      h('span', { class: 'faint' }, '游戏区外滚轮也能切换'),
      h('button', {
        class: 'btn btn--sm btn--ghost', title: '用系统浏览器打开当前游戏',
        onclick: () => window.toolbox.shell.openExternal(FEED_GAMES[current].url),
      }, '↗'),
    ),
    scroller,
  );

  // 卡片骨架先全部铺好（webview 等进视口再补）
  FEED_GAMES.forEach((game, index) => {
    scroller.appendChild(h('div', { class: 'feed__card' },
      h('div', { class: 'feed__head' },
        h('span', { class: 'feed__emoji' }, game.emoji),
        h('span', { class: 'feed__name' }, game.name),
        h('span', { class: 'faint feed__desc' }, game.desc),
        h('button', {
          class: 'btn btn--sm btn--ghost', title: '重新加载这个游戏',
          onclick: () => {
            const view = webviews.get(index);
            if (view) view.reload();
            else ensureWebview(index);
          },
        }, '⟳'),
      ),
      h('div', { class: 'feed__stage' }),
    ));
  });

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const index = [...scroller.children].indexOf(entry.target);
      if (index === -1) continue;
      ensureWebview(index);
      if (entry.intersectionRatio > 0.6) {
        current = index;
        updatePosition();
      }
    }
  }, { root: scroller, threshold: [0.2, 0.6] });
  for (const card of scroller.children) observer.observe(card);

  updatePosition();
  // 首屏：直接加载上次玩到的那个（scrollIntoView 平滑滚过去会顺路加载中间的，先瞬移）
  scroller.children[saved].scrollIntoView();

  return {
    deactivate: () => {
      if (observer) observer.disconnect();
      webviews.clear();
    },
  };
}

/** 醒脑：内置小游戏 + 小游戏流 + 网页版游戏格子铺，页签切换。 */
export function createGames(root, ctx) {
  const { config } = ctx;
  const panels = new Map();
  const deactivators = new Map();
  let current = config.get('focus.gamesTab', 'schulte');

  const tabs = [
    { id: 'schulte', label: '舒尔特方格' },
    { id: 'memory', label: '流光记忆' },
    { id: 'feed', label: '小游戏流' },
    { id: 'web', label: '网页游戏' },
  ];

  const tabBar = h('div', { class: 'research__subbar', style: { marginLeft: '0' } });
  const body = h('div', { class: 'research__subbody' });

  const factories = {
    schulte: (panel) => createSchulte(panel, config),
    memory: (panel) => createFlowMemory(panel, config),
    feed: (panel) => createGameFeed(panel, config),
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
