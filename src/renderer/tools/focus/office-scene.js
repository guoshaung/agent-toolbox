import { h } from '../../core/ui.js';

/**
 * 二次元办公室的画面层：房间、工位、小人。
 *
 * 全部用代码画，不依赖任何模型或图片文件 —— 仓库里一个 .vrm/.png 都不用带，
 * 换主题、换配色、加一个 AI 都只是改几行数据。
 *
 * 这一层只管「长什么样」和「走到哪」，谁在忙、聊了什么由 office.js 决定。
 */

/**
 * 每家一个像素小人。
 *
 * 图是从原画缩到 52px 宽、压到 32 色做出来的，白底用「从边缘泛洪」的方式抠 ——
 * 按颜色一刀切会把白裙子、白围裙一起抠成窟窿（白龙和 Kimi 整个人都快没了）。
 * accent 仍然保留：工位边框、名牌、屏幕光都用它，和小人配色对得上。
 */
export const LOOKS = {
  dsh:      { sprite: 'sprite-dsh.png',    accent: '#4e8cff', tag: '◆', who: 'DeepSeek', rig: { hem: 72, mid: 29, h: 93 } },
  codex:    { sprite: 'sprite-codex.png',  accent: '#c9d2e6', tag: '⌘', who: 'GPT' },
  claude:   { sprite: 'sprite-claude.png', accent: '#e89b68', tag: '✦', who: 'Claude',   rig: { hem: 80, mid: 28, h: 89 } },
  gemini:   { sprite: 'sprite-gemini.png', accent: '#8d9cf6', tag: '✧', who: 'Gemini',   rig: { hem: 54, mid: 25, h: 82 } },
  kimi:     { sprite: 'sprite-kimi.png',   accent: '#b9b6e8', tag: '☾', who: 'Kimi' },
  glm:      { sprite: 'sprite-glm.png',    accent: '#7f8797', tag: 'Z', who: 'GLM',      rig: { hem: 82, mid: 26, h: 103 } },
  grok:     { sprite: 'sprite-grok.png',   accent: '#d7b45e', tag: '✕', who: 'Grok',     rig: { hem: 73, mid: 30, h: 86 } },
  opencode: { sprite: '',                  accent: '#ba86ed', tag: '◈', who: 'OpenCode' },
};

const FALLBACK = { sprite: '', accent: '#8b94a3', tag: '●', who: '' };

export const lookOf = (id) => LOOKS[id] || FALLBACK;

/** 没给图的（比如 OpenCode）用一个同色的剪影顶上，别开天窗。 */
function silhouette(look) {
  return `<svg viewBox="0 0 52 86" width="52" height="86">
    <ellipse cx="26" cy="83" rx="13" ry="3" fill="rgba(0,0,0,.3)"/>
    <path d="M13 82 q0-26 13-26 q13 0 13 26 z" fill="${look.accent}" opacity=".8"/>
    <circle cx="26" cy="40" r="13" fill="${look.accent}"/>
  </svg>`;
}

const ASSET = '../../assets/office';

/**
 * 按轮廓把精灵图拆成「上半身 + 左腿 + 右腿」，动的是她自己的腿。
 *
 * 之前是在脚下贴两根统一的小方块当腿 —— 每张原画的裙长、腿的位置都不一样，
 * 方块跟画对不上，一走就露馅。现在 hem（裙摆线）和 mid（左右腿分界）都是
 * 从每张图自己的轮廓量出来的，切口就落在她的裙边上。
 *
 * 手没有拆：这几张图两侧那几列基本都是垂下来的长头发，不是手臂，
 * 照着切会把头发削掉。所以手臂的动作由上半身整体的摆动来带。
 */
function rigged(person, look, id) {
  const { hem, mid } = look.rig;
  const img = (cls, src) => {
    const el = document.createElement('img');
    el.className = `office-part ${cls}`;
    el.src = `${ASSET}/${src}`;
    el.alt = '';
    el.draggable = false;
    return el;
  };
  const body = img('office-part--body', `part-${id}-body.png`);
  const legL = img('office-part--leg office-part--legL', `part-${id}-legL.png`);
  const legR = img('office-part--leg office-part--legR', `part-${id}-legR.png`);
  // 这里必须用 JS 设样式，不能写成 style="..." 属性 ——
  // 页面的 CSP 是 style-src 'self'，内联 style 属性会被直接丢掉，
  // 实测两条腿会贴在容器顶端（接缝差 -72px），整个人断成两截。
  legL.style.top = `${hem}px`;
  legL.style.left = '0';
  legL.style.width = `${mid}px`;
  legR.style.top = `${hem}px`;
  legR.style.left = `${mid}px`;
  person.append(body, legL, legR);
}

function portrait(look, id) {
  if (!look.sprite) return silhouette(look);
  // 像素图必须 image-rendering: pixelated，否则浏览器会把它插值成一团糊
  // 裙子及地的（白龙、Kimi）没有露出来的腿可切，整张用，靠身体起伏表现走路
  return `<img class="office-person__img" src="${ASSET}/${look.sprite}" alt="" draggable="false">`;
}

/** 工位：桌子 + 显示器。显示器是可点的，点开看这家 AI 在聊什么。 */
function deskSvg(accent) {
  return `<svg viewBox="0 0 96 64" width="96" height="64">
    <rect x="4" y="40" width="88" height="7" rx="2" fill="#3b424e"/>
    <rect x="10" y="47" width="6" height="15" fill="#2f353f"/>
    <rect x="80" y="47" width="6" height="15" fill="#2f353f"/>
    <rect x="26" y="12" width="44" height="28" rx="3" fill="#20252e" stroke="${accent}" stroke-width="1.5"/>
    <rect x="29" y="15" width="38" height="22" rx="2" fill="${accent}" opacity=".16" class="office-monitor-glow"/>
    <rect x="44" y="40" width="8" height="4" fill="#2f353f"/>
  </svg>`;
}

/**
 * 建一个办公室。
 * @param {Array<{id,label}>} agents
 * @param {(id:string)=>void} onOpen 点显示器时回调
 */
export function createScene(agents, onOpen) {
  const seats = new Map();
  const room = h('div', { class: 'office-room' });

  // 地板、墙、门、绿植：一次性铺好，之后不动
  room.insertAdjacentHTML('beforeend', `
    <div class="office-room__wall"></div>
    <div class="office-room__floor"></div>
    <div class="office-room__door" title="出去转转"></div>
    <div class="office-room__plant"></div>
  `);

  const stage = h('div', { class: 'office-room__stage' });
  room.append(stage);

  agents.forEach((agent, index) => {
    const look = lookOf(agent.id);
    // 8 家排 4 列 2 行。原来是 3 列，第 7、8 个会掉到第三排、被房间底边切掉半截。
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = 5 + column * 21 + row * 5;
    // 小人站在桌子上方 12%，所以第一排本身不能太靠上 —— 8% 时算出来是 -4%，
    // 整排人头顶被房间上边界切掉。
    const y = 15 + row * 38;

    // 桌子钉死在工位上，人可以走开 —— 这两件事必须分成两层，
    // 放一起的话人走到哪桌子跟到哪，看着像在推着桌子逛。
    const desk = h('button', {
      class: 'office-desk',
      style: { left: `${x}%`, top: `${y}%`, '--seat-accent': look.accent },
      title: `${agent.label} 的屏幕 · 点开看它在聊什么`,
      onclick: () => onOpen(agent.id),
    });
    desk.innerHTML = deskSvg(look.accent);
    desk.append(h('span', { class: 'office-desk__name' }, `${look.tag} ${agent.label}`));

    const bubble = h('div', { class: 'office-person__bubble', hidden: true }, '');
    const person = h('div', {
      class: 'office-person',
      style: { left: `${x + 2}%`, top: `${y - 12}%` },
    }, bubble);
    if (look.rig) rigged(person, look, agent.id);
    else person.insertAdjacentHTML('afterbegin', portrait(look, agent.id));

    stage.append(desk, person);
    seats.set(agent.id, {
      desk, person, bubble, look, state: 'idle',
      home: { x: x + 2, y: y - 12 },
    });
  });

  /**
   * 走到房间里的某处（百分比坐标）。
   *
   * 关键是「按距离定速」：原来不管远近一律 2.4 秒，走两步的和横穿整个房间的
   * 用同样时间，近的像瞬移、远的像飘。现在固定速度，时长由距离算出来，
   * 顺便让腿的摆动频率和时长对上，不然脚在原地乱蹬、人已经到了。
   */
  const SPEED = 13;          // 每秒走多少「百分比宽度」
  const MIN_MS = 500;
  const MAX_MS = 5200;

  function walkTo(id, x, y) {
    const entry = seats.get(id);
    if (!entry) return;
    const fromX = parseFloat(entry.person.style.left) || 0;
    const fromY = parseFloat(entry.person.style.top) || 0;
    const dist = Math.hypot(x - fromX, (y - fromY) * 0.55);   // 纵向看着比横向短，按视觉比例折算
    const ms = Math.min(MAX_MS, Math.max(MIN_MS, (dist / SPEED) * 1000));
    if (dist < 0.6) return;                                    // 原地不动就别触发动画

    entry.person.classList.toggle('is-flipped', x < fromX - 0.5);
    entry.person.style.transitionDuration = `${ms}ms, ${ms}ms, .4s`;
    // 步频跟着走 —— 一步约 0.34 秒，走得久就多迈几步
    entry.person.style.setProperty('--step', `${Math.max(260, Math.min(420, ms / Math.max(2, Math.round(ms / 340))))}ms`);
    entry.person.style.left = `${x}%`;
    entry.person.style.top = `${y}%`;
    entry.person.classList.add('is-walking');
    clearTimeout(entry.walkTimer);
    entry.walkTimer = setTimeout(() => entry.person.classList.remove('is-walking'), ms + 60);
  }

  /**
   * @param {'idle'|'working'|'away'|'missing'} state
   */
  function setState(id, state, note = '') {
    const entry = seats.get(id);
    if (!entry) return;
    entry.state = state;
    for (const el of [entry.person, entry.desk]) {
      el.classList.toggle('is-working', state === 'working');
      el.classList.toggle('is-away', state === 'away');
      el.classList.toggle('is-missing', state === 'missing');
    }
    if (note) {
      entry.bubble.textContent = note;
      entry.bubble.hidden = false;
    } else {
      entry.bubble.hidden = true;
    }
    if (state === 'working') walkTo(id, entry.home.x, entry.home.y);
  }

  /**
   * 闲着的时候到处逛。
   *
   * 原来是每 4.2 秒把所有人一起随机丢到一个新坐标，看着像一屋子人同时抽搐。
   * 现在每个人各走各的：走完站一会儿（3~9 秒）再决定下一步，而且只在地板那一带
   * 横向移动为主，不会斜穿整个房间。
   */
  function strollOnce(id) {
    const entry = seats.get(id);
    if (!entry || entry.state === 'working' || entry.state === 'missing') return scheduleStroll(id, 4000);
    const roll = Math.random();
    if (roll < 0.16) {
      // 出门待一会儿。门口站位错开，不然两个人严丝合缝叠在一起
      walkTo(id, 84 + Math.random() * 7, 42 + Math.random() * 10);
      entry.person.classList.add('is-away');
      scheduleStroll(id, 7000 + Math.random() * 6000, () => {
        entry.person.classList.remove('is-away');
        walkTo(id, entry.home.x, entry.home.y);
      });
      return;
    }
    if (roll < 0.34) {
      walkTo(id, entry.home.x, entry.home.y);            // 回自己位子附近待着
    } else {
      // 主要横向走，纵向只在地板那一条带里小幅移动
      const nx = 4 + Math.random() * 74;
      const ny = 34 + Math.random() * 20;
      walkTo(id, nx, ny);
    }
    scheduleStroll(id, 3000 + Math.random() * 6000);
  }

  function scheduleStroll(id, delay, before) {
    const entry = seats.get(id);
    if (!entry) return;
    clearTimeout(entry.strollTimer);
    entry.strollTimer = setTimeout(() => {
      if (before) before();
      strollOnce(id);
    }, delay);
  }

  // 每个人错开起步，避免一屋子人整整齐齐同时迈腿
  for (const id of seats.keys()) scheduleStroll(id, 1500 + Math.random() * 5000);

  return {
    el: room,
    setState,
    stop: () => {
      for (const entry of seats.values()) {
        clearTimeout(entry.strollTimer);
        clearTimeout(entry.walkTimer);
      }
    },
    has: (id) => seats.has(id),
  };
}
