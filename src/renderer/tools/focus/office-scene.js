import { h } from '../../core/ui.js';

/**
 * 二次元办公室的画面层：房间、工位、小人。
 *
 * 全部用代码画，不依赖任何模型或图片文件 —— 仓库里一个 .vrm/.png 都不用带，
 * 换主题、换配色、加一个 AI 都只是改几行数据。
 *
 * 这一层只管「长什么样」和「走到哪」，谁在忙、聊了什么由 office.js 决定。
 */

/** 每家一套发色/衣服，靠颜色认人比靠名字快。 */
export const LOOKS = {
  codex:    { hair: '#3f7d63', hair2: '#68c59b', cloth: '#2c4f42', skin: '#f6d9c2', tag: '⌘' },
  claude:   { hair: '#b8703c', hair2: '#e89b68', cloth: '#5a3a26', skin: '#f8e0cb', tag: '✦' },
  opencode: { hair: '#7d52ad', hair2: '#ba86ed', cloth: '#402a56', skin: '#f3d6c6', tag: '◈' },
  dsh:      { hair: '#2f5da8', hair2: '#4e8cff', cloth: '#243a63', skin: '#f6dccb', tag: '◆' },
  gemini:   { hair: '#5566c4', hair2: '#8d9cf6', cloth: '#31386b', skin: '#f7ddc9', tag: '✧' },
  omp:      { hair: '#a8842f', hair2: '#d5ad4d', cloth: '#5a4a1f', skin: '#f6dbc4', tag: '◎' },
  qwen:     { hair: '#2f7f95', hair2: '#56b8d9', cloth: '#22505e', skin: '#f5dcc8', tag: '◌' },
};

const FALLBACK = { hair: '#5c6470', hair2: '#8b94a3', cloth: '#3a4049', skin: '#f2d9c6', tag: '●' };

export const lookOf = (id) => LOOKS[id] || FALLBACK;

/**
 * 一个 Q 版小人。用 SVG 画：头大身小、齐刘海、两撮呆毛 —— 二次元的辨识度
 * 主要来自这几处，不需要很多细节。
 */
function chibi(look) {
  const svg = (inner, extra = '') => `<svg viewBox="0 0 48 64" width="48" height="64" ${extra}>${inner}</svg>`;
  return svg(`
    <ellipse cx="24" cy="61" rx="13" ry="3" fill="rgba(0,0,0,.25)"/>
    <!-- 身子 -->
    <path d="M13 62 q0-18 11-18 q11 0 11 18 z" fill="${look.cloth}"/>
    <rect x="11" y="46" width="5" height="13" rx="2.5" fill="${look.cloth}" class="office-arm office-arm--l"/>
    <rect x="32" y="46" width="5" height="13" rx="2.5" fill="${look.cloth}" class="office-arm office-arm--r"/>
    <!-- 头 -->
    <circle cx="24" cy="28" r="15" fill="${look.skin}"/>
    <!-- 后发 -->
    <path d="M9 30 q0-19 15-19 q15 0 15 19 q0-9-15-9 q-15 0-15 9z" fill="${look.hair}"/>
    <!-- 齐刘海 -->
    <path d="M10 25 q3-14 14-14 q11 0 14 14 q-5-6-14-6 q-9 0-14 6z" fill="${look.hair2}"/>
    <!-- 呆毛 -->
    <path d="M22 11 q1-7 5-8 q-2 4 0 8z" fill="${look.hair2}"/>
    <!-- 眼睛：闭眼由 CSS 把它压扁 -->
    <g class="office-eyes">
      <ellipse cx="18.5" cy="30" rx="2.4" ry="3" fill="#20242c"/>
      <ellipse cx="29.5" cy="30" rx="2.4" ry="3" fill="#20242c"/>
      <circle cx="19.2" cy="29" r="0.9" fill="#fff"/>
      <circle cx="30.2" cy="29" r="0.9" fill="#fff"/>
    </g>
    <ellipse cx="14" cy="34" rx="2.6" ry="1.6" fill="#ef9a9a" opacity=".55"/>
    <ellipse cx="34" cy="34" rx="2.6" ry="1.6" fill="#ef9a9a" opacity=".55"/>
  `);
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
    const column = index % 3;
    const row = Math.floor(index / 3);
    // 后排往右缩一点，做出一点纵深
    const x = 8 + column * 27 + row * 8;
    const y = 16 + row * 38;

    // 桌子钉死在工位上，人可以走开 —— 这两件事必须分成两层，
    // 放一起的话人走到哪桌子跟到哪，看着像在推着桌子逛。
    const desk = h('button', {
      class: 'office-desk',
      style: { left: `${x}%`, top: `${y}%`, '--seat-accent': look.hair2 },
      title: `${agent.label} 的屏幕 · 点开看它在聊什么`,
      onclick: () => onOpen(agent.id),
    });
    desk.innerHTML = deskSvg(look.hair2);
    desk.append(h('span', { class: 'office-desk__name' }, `${look.tag} ${agent.label}`));

    const bubble = h('div', { class: 'office-person__bubble', hidden: true }, '');
    const person = h('div', {
      class: 'office-person',
      style: { left: `${x + 2}%`, top: `${y - 9}%` },
    }, bubble);
    person.insertAdjacentHTML('afterbegin', chibi(look));

    stage.append(desk, person);
    seats.set(agent.id, {
      desk, person, bubble, look, state: 'idle',
      home: { x: x + 2, y: y - 9 },
    });
  });

  /** 让某个小人走到房间里的某处（百分比坐标）。CSS 负责过渡，这里只给目标。 */
  function walkTo(id, x, y) {
    const entry = seats.get(id);
    if (!entry) return;
    const from = parseFloat(entry.person.style.left) || 0;
    // 往左走就把小人镜像过来，不然永远是同一个朝向
    entry.person.classList.toggle('is-flipped', x < from - 1);
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

  /** 闲着的时候到处逛：随机挑个点走过去，偶尔走到门口算「出门了」。 */
  function wander() {
    for (const [id, entry] of seats) {
      if (entry.state === 'working' || entry.state === 'missing') continue;
      if (Math.random() < 0.55) continue;                 // 不是每次都动，不然满屏乱晃
      const goOut = Math.random() < 0.18;
      if (goOut) {
        // 每个人的门口站位错开一点：都走到同一个坐标的话，两个人会严丝合缝地
        // 叠在一起，看着像只出去了一个
        walkTo(id, 86 + Math.random() * 7, 52 + Math.random() * 12);
        entry.person.classList.add('is-away');
        setTimeout(() => {
          if (entry.state === 'working') return;
          entry.person.classList.remove('is-away');
          walkTo(id, entry.home.x, entry.home.y);
        }, 6000 + Math.random() * 6000);
      } else {
        // 只在地板那一带逛，别飘到墙上去
        walkTo(id, 6 + Math.random() * 76, 42 + Math.random() * 26);
      }
    }
  }

  const timer = setInterval(wander, 4200);

  return {
    el: room,
    setState,
    stop: () => clearInterval(timer),
    has: (id) => seats.has(id),
  };
}
