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

const LEARNING_GAMES = [
  { name: 'Human Benchmark', url: 'https://humanbenchmark.com', desc: '反应、记忆、数字与语言测试', category: '思维', emoji: '⚡' },
  { name: 'Lichess 训练', url: 'https://lichess.org/training', desc: '国际象棋战术题', category: '思维', emoji: '♟️' },
  { name: 'The Evolution of Trust', url: 'https://ncase.me/trust/', desc: '用博弈理解合作与背叛', category: '思维', emoji: '🤝' },
  { name: '多边形寓言', url: 'https://ncase.me/polygons/', desc: '用互动模型理解偏见如何形成', category: '思维', emoji: '🔺' },
  { name: 'Loopy 因果图', url: 'https://ncase.me/loopy/', desc: '拖拽节点探索反馈回路', category: '思维', emoji: '🔁' },
  { name: 'Seterra 地理', url: 'https://www.geoguessr.com/seterra/en', desc: '国家、城市与地形地图测验', category: '地理', emoji: '🗺️' },
  { name: 'Worldle', url: 'https://worldle.teuteuf.fr/', desc: '根据轮廓猜国家', category: '地理', emoji: '🌍' },
  { name: 'Globle', url: 'https://globle-game.com/', desc: '根据距离猜国家', category: '地理', emoji: '🌐' },
  { name: 'The True Size Of', url: 'https://www.thetruesize.com/', desc: '拖动地图比较真实国土面积', category: '地理', emoji: '📐' },
  { name: '世界地理游戏', url: 'https://world-geography-games.com/', desc: '国家、首都与旗帜练习', category: '地理', emoji: '🏳️' },
  { name: 'PhET 分数搭建', url: 'https://phet.colorado.edu/sims/html/build-a-fraction/latest/build-a-fraction_all.html', desc: '用图形和数字理解分数', category: '数学科学', emoji: '➗' },
  { name: 'PhET 重力轨道', url: 'https://phet.colorado.edu/sims/html/gravity-and-orbits/latest/gravity-and-orbits_all.html', desc: '调整质量与距离观察轨道', category: '数学科学', emoji: '🪐' },
  { name: 'PhET 能量滑板', url: 'https://phet.colorado.edu/sims/html/energy-skate-park/latest/energy-skate-park_all.html', desc: '在运动中看懂能量转换', category: '数学科学', emoji: '🛹' },
  { name: 'PhET 色觉', url: 'https://phet.colorado.edu/sims/html/color-vision/latest/color-vision_all.html', desc: '探索光、颜色与视觉', category: '数学科学', emoji: '🌈' },
  { name: '宇宙尺度', url: 'https://htwins.net/scale2/', desc: '从量子到星系的尺度探索', category: '数学科学', emoji: '🔭' },
  { name: 'Monkeytype', url: 'https://monkeytype.com/', desc: '英文打字速度与准确率', category: '语言', emoji: '⌨️' },
  { name: 'TypingClub', url: 'https://www.typingclub.com/', desc: '循序渐进练习盲打', category: '语言', emoji: '📝' },
  { name: 'JetPunk', url: 'https://www.jetpunk.com/', desc: '历史、文化与知识问答', category: '知识', emoji: '🧠' },
  { name: 'Sporcle', url: 'https://www.sporcle.com/', desc: '海量主题限时测验', category: '知识', emoji: '❓' },
  { name: 'Neal.fun', url: 'https://neal.fun/', desc: '一组关于世界的互动实验', category: '知识', emoji: '🧪' },
];

/**
 * 小游戏流：一局一换的轻量网页游戏，像刷短视频一样上下滑切换。
 * 网页游戏进视口才加载；微信小程序使用专用启动卡，复制口令后唤起微信。
 */
const FEED_GAMES = [
  {
    name: '行测小助手',
    kind: 'wechat-mini-program',
    token: '#小程序://行测小助手/ulSZDfWNItmr3wH',
    desc: '行测刷题与思维训练 · 微信小程序',
    emoji: '🧠',
  },
  { name: 'Chrome 恐龙', url: 'https://chromedino.com/', desc: '断网小恐龙，空格跳', emoji: '🦖' },
  { name: '2048', url: 'https://gabrielecirulli.github.io/2048/', desc: '原版开源，方向键合成', emoji: '🔢' },
  { name: '俄罗斯方块', url: 'https://chvin.github.io/react-tetris/', desc: '像素完美复刻，还支持手柄', emoji: '🧱' },
  { name: '笨拙小鸟', url: 'https://ellisonleao.github.io/clumsy-bird/', desc: 'Flappy Bird 克隆，点按飞', emoji: '🐦' },
  { name: 'Floppy Bird', url: 'https://nebez.github.io/floppybird/', desc: '又一个 Flappy，上/空格', emoji: '🐤' },
  { name: '吃豆人', url: 'https://passer-by.com/pacman/', desc: '网页版 Pac-Man，方向键', emoji: '🟡' },
  { name: 'Hextris', url: 'https://hextris.io/', desc: '六边形消除，练空间判断', emoji: '⬡' },
  { name: '纸牌接龙', url: 'https://solitaired.com/', desc: '经典纸牌合集，轻量休息', emoji: '🃏' },
  { name: '小游戏合集', url: 'https://poki.com/', desc: '浏览器小游戏目录', emoji: '🕹️' },
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
 * webview 懒加载：卡片第一次进入视口才设 src；小程序卡不创建 webview。
 */
function createGameFeed(host, config) {
  const scroller = h('div', { class: 'feed__scroller' });
  const positionEl = h('span', { class: 'faint feed__position' }, '');
  const gameViews = new Map(); // index -> webview | 小程序启动卡
  let current = 0;
  let observer = null;

  // 记住上次玩到哪个
  const saved = Math.min(FEED_GAMES.length - 1, Math.max(0, Number(config.get('focus.gameFeed.index', 0)) || 0));

  async function launchMiniProgram(game) {
    await window.toolbox.clipboard.write(game.token);
    const result = await window.toolbox.shell.openWeChat();
    toast(
      result.ok
        ? '小程序口令已复制并打开微信：粘贴到文件传输助手或任意聊天，点击口令进入'
        : `口令已复制，但微信打开失败：${result.error}`,
      result.ok ? 'good' : 'bad',
      7000,
    );
  }

  function miniProgramLauncher(game) {
    return h('div', { class: 'feed__mini' },
      h('div', { class: 'feed__mini-icon' }, game.emoji),
      h('h2', { class: 'feed__mini-title' }, game.name),
      h('div', { class: 'feed__mini-desc' }, '这个游戏运行在微信小程序里，不能作为普通网页嵌入。'),
      h('button', { class: 'btn btn--primary feed__mini-open', onclick: () => launchMiniProgram(game) }, '复制口令并打开微信'),
      h('code', { class: 'feed__mini-token' }, game.token),
      h('ol', { class: 'feed__mini-steps' },
        h('li', {}, '点击按钮，工具箱自动复制口令并打开微信'),
        h('li', {}, '粘贴到文件传输助手或任意聊天窗口'),
        h('li', {}, '点击识别出来的「行测小助手」进入'),
      ),
    );
  }

  function ensureGameView(index) {
    if (gameViews.has(index)) return gameViews.get(index);
    const game = FEED_GAMES[index];
    const view = game.kind === 'wechat-mini-program'
      ? miniProgramLauncher(game)
      : h('webview', { partition: 'persist:focus', src: game.url });
    gameViews.set(index, view);
    scroller.children[index].querySelector('.feed__stage').appendChild(view);
    return view;
  }

  function openCurrentGame() {
    const game = FEED_GAMES[current];
    if (game.kind === 'wechat-mini-program') return launchMiniProgram(game);
    return window.toolbox.shell.openExternal(game.url);
  }

  const openBtn = h('button', {
    class: 'btn btn--sm btn--ghost',
    onclick: openCurrentGame,
  }, '↗');

  function updatePosition() {
    const game = FEED_GAMES[current];
    positionEl.textContent = `${current + 1} / ${FEED_GAMES.length} · ${game.name}`;
    openBtn.textContent = game.kind === 'wechat-mini-program' ? '打开微信' : '↗';
    openBtn.title = game.kind === 'wechat-mini-program' ? '复制小程序口令并打开微信' : '用系统浏览器打开当前游戏';
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
      openBtn,
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
          class: 'btn btn--sm btn--ghost',
          title: game.kind === 'wechat-mini-program' ? '复制口令并打开微信' : '重新加载这个游戏',
          onclick: () => {
            if (game.kind === 'wechat-mini-program') return launchMiniProgram(game);
            const view = gameViews.get(index);
            if (view) view.reload();
            else ensureGameView(index);
          },
        }, game.kind === 'wechat-mini-program' ? '打开' : '⟳'),
      ),
      h('div', { class: 'feed__stage' }),
    ));
  });

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const index = [...scroller.children].indexOf(entry.target);
      if (index === -1) continue;
      ensureGameView(index);
      if (entry.intersectionRatio > 0.6) {
        current = index;
        updatePosition();
      }
    }
  }, { root: scroller, threshold: [0.2, 0.6] });
  for (const card of scroller.children) observer.observe(card);

  updatePosition();
  // 首屏立即创建当前内容，避免 IntersectionObserver 尚未触发时出现空白卡片。
  ensureGameView(saved);
  scroller.children[saved].scrollIntoView();

  return {
    deactivate: () => {
      if (observer) observer.disconnect();
      gameViews.clear();
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
    { id: 'learning', label: '学习游戏' },
    { id: 'feed', label: '小游戏流' },
    { id: 'web', label: '轻松网页' },
  ];

  const tabBar = h('div', { class: 'research__subbar', style: { marginLeft: '0' } });
  const body = h('div', { class: 'research__subbody' });

  const factories = {
    schulte: (panel) => createSchulte(panel, config),
    memory: (panel) => createFlowMemory(panel, config),
    learning: (panel) => createSiteGrid(panel, {
      presets: LEARNING_GAMES,
      categories: [
        { id: '思维', label: '思维' },
        { id: '地理', label: '地理' },
        { id: '数学科学', label: '数学科学' },
        { id: '语言', label: '语言' },
        { id: '知识', label: '知识' },
      ],
      configKey: 'focus.learningGames',
      cachePrefix: 'focus.learningGameFavicons.',
      partition: 'persist:focus',
      config,
    }),
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
