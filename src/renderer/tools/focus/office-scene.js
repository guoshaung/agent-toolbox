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
  dsh:      { sprite: 'sprite-dsh.png',    accent: '#4e8cff', tag: '◆', who: 'DeepSeek' },
  codex:    { sprite: 'sprite-codex.png',  accent: '#c9d2e6', tag: '⌘', who: 'GPT' },
  claude:   { sprite: 'sprite-claude.png', accent: '#e89b68', tag: '✦', who: 'Claude' },
  gemini:   { sprite: 'sprite-gemini.png', accent: '#8d9cf6', tag: '✧', who: 'Gemini' },
  kimi:     { sprite: 'sprite-kimi.png',   accent: '#b9b6e8', tag: '☾', who: 'Kimi' },
  glm:      { sprite: 'sprite-glm.png',    accent: '#7f8797', tag: 'Z', who: 'GLM' },
  grok:     { sprite: 'sprite-grok.png',   accent: '#d7b45e', tag: '✕', who: 'Grok' },
  // OpenCode 没有原画。手画过一个，风格跟 AI 生成的那几张对不齐，撤了。
  // 没图就只摆桌子不摆人 —— 比放一个明显不搭的小人干净。
  opencode: { sprite: '', accent: '#ba86ed', tag: '◈', who: 'OpenCode' },
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
 * 一个小人就是一张整图。
 *
 * 之前按轮廓把图拆成「上半身 + 两条腿」再分别转 —— 两条腿单独摆起来很鬼畜，
 * 而且裙子及地的那几位本来就没腿可拆，同一个办公室里两种动法更怪。
 * 现在统一只做左右移动，朝向靠镜像，别的都不动。
 */
function portrait(look) {
  if (!look.sprite) return '';
  return `<img class="office-person__img" src="${ASSET}/${look.sprite}" alt="" draggable="false">`;
}

/**
 * 工位：桌子 + 显示器 + 键盘 + 鼠标 + 马克杯。
 *
 * 上一版的「电脑」就是一个空心方框摆在一块板上，太简陋。现在补了支架、底座、
 * 键盘键帽、鼠标和杯子；屏幕里画了几行长短不一的「代码」，干活时会亮起来 ——
 * 一眼就能看出这个位子上有没有人在跑东西。
 */
function deskSvg(accent) {
  const line = (y, w, o) => `<rect x="34" y="${y}" width="${w}" height="2" rx="1" fill="${accent}" opacity="${o}"/>`;
  return `<svg viewBox="0 0 128 92" width="128" height="92">
    <!-- 桌面 + 桌腿 -->
    <rect x="4" y="62" width="120" height="8" rx="2.5" fill="#454d5c"/>
    <rect x="4" y="62" width="120" height="3" rx="1.5" fill="#525b6c"/>
    <rect x="14" y="70" width="7" height="20" rx="2" fill="#343b48"/>
    <rect x="107" y="70" width="7" height="20" rx="2" fill="#343b48"/>
    <!-- 显示器：外壳、屏幕、支架、底座 -->
    <rect x="28" y="10" width="72" height="46" rx="4" fill="#1b202a"/>
    <rect x="31" y="13" width="66" height="38" rx="2.5" fill="#0e131b"/>
    <g class="office-screen-lines">
      ${line(19, 40, .85)}${line(25, 28, .6)}${line(31, 46, .7)}${line(37, 22, .5)}${line(43, 34, .6)}
    </g>
    <rect x="31" y="13" width="66" height="38" rx="2.5" fill="${accent}" opacity=".1" class="office-monitor-glow"/>
    <rect x="59" y="56" width="10" height="6" fill="#2b323e"/>
    <rect x="49" y="60" width="30" height="3" rx="1.5" fill="#39404e"/>
    <!-- 键盘：一排键帽，比一块灰板子像样 -->
    <rect x="40" y="70" width="48" height="8" rx="2" fill="#39404e"/>
    ${Array.from({ length: 9 }, (_, i) => `<rect x="${43 + i * 5}" y="72" width="3.4" height="2.4" rx="1" fill="#5a6376"/>`).join('')}
    <rect x="49" y="75.5" width="30" height="1.6" rx=".8" fill="#5a6376"/>
    <!-- 鼠标 + 马克杯 -->
    <ellipse cx="97" cy="74" rx="4.5" ry="6" fill="#39404e"/>
    <rect x="95.6" y="69" width="2.8" height="4" rx="1.4" fill="#5a6376"/>
    <rect x="14" y="52" width="10" height="10" rx="2" fill="#6d7688"/>
    <path d="M24 55 q5 0 5 3 q0 3-5 3z" fill="none" stroke="#6d7688" stroke-width="1.6"/>
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
  // 墙面挂钟 / 白板 / 窗户 / 地毯 / 绿植 / 饮水机：一次性铺好，之后不动。
  // 上一版只有一扇门和一盆草，空得像毛坯房。
  room.insertAdjacentHTML('beforeend', `
    <div class="office-room__wall"></div>
    <div class="office-room__window"><span></span><span></span></div>
    <div class="office-room__board">
      <i style="width:62%"></i><i style="width:44%"></i><i style="width:71%"></i><i style="width:38%"></i>
    </div>
    <div class="office-room__clock"></div>
    <div class="office-room__floor"></div>
    <div class="office-room__rug"></div>
    <div class="office-room__door" title="出去转转"><i></i></div>
    <div class="office-room__plant"><b></b><u></u></div>
    <div class="office-room__cooler"><b></b><u></u></div>
  `);

  const stage = h('div', { class: 'office-room__stage' });
  room.append(stage);

  agents.forEach((agent, index) => {
    const look = lookOf(agent.id);
    // 8 家排 4 列 2 行。原来是 3 列，第 7、8 个会掉到第三排、被房间底边切掉半截。
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = 4 + column * 22 + row * 4;
    // 小人站在桌子上方 12%，所以第一排本身不能太靠上 —— 8% 时算出来是 -4%，
    // 整排人头顶被房间上边界切掉。
    const y = 13 + row * 40;

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
      style: { left: `${x + 3}%`, top: `${y - 7}%` },
    }, bubble);
    person.insertAdjacentHTML('afterbegin', portrait(look));

    stage.append(desk);
    if (look.sprite) stage.append(person);
    seats.set(agent.id, {
      desk, person, bubble, look, state: 'idle',
      home: { x: x + 3, y: y - 7 },
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

    // 只做两件事：朝向翻个面、挪过去。没有迈腿、没有起伏 —— 拆开的腿单独摆
    // 太鬼畜，而且裙子及地的那几位本来就没腿可拆，同一屋两种动法更怪。
    entry.person.classList.toggle('is-flipped', x < fromX - 0.5);
    entry.person.style.transitionDuration = `${ms}ms, ${ms}ms, .4s`;
    entry.person.style.left = `${x}%`;
    entry.person.style.top = `${y}%`;
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
      walkTo(id, 82 + Math.random() * 6, 34 + Math.random() * 10);
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
      }
    },
    has: (id) => seats.has(id),
  };
}
