import { h } from '../../core/ui.js';

/**
 * 火柴人酷跑：横版无限跑酷，同时是一块给 AI（jev）玩的「靶场」。
 *
 * 操作（人玩）：↑/W 跳、再按二连跳；↓/S 蹲（空中=快速下坠）；空格/J 向前扑。
 * 三类障碍各有唯一解，中缝门只能「扑」。道具：❤ 加命、⚡ 冲刺无敌。
 *
 * 给 AI 玩：window.__runner 暴露一套接口——
 *   state()            结构化观测：下一个障碍的实心区间 / 距离 / 到达秒数、角色姿态、各姿态占据的高度带
 *   act(name)          立刻执行 start|jump|crouch|release|dive
 *   plan(name, id?)    把动作挂到某个障碍上，到时机自动执行（LLM 有延迟，这样它不用掐时间）
 *   setAgent(fn)       每个障碍进入决策区时调 fn(obs)，可返回 Promise；配合 pause 模式，游戏会停下来等它想
 *   setMode('off'|'demo'|'jev')
 * 界面上「AI 试玩」= 内置规则机器人；「让 jev 玩」= 把观测发给 ctx.ai，等它回 JSON 再放行。
 *
 * 世界坐标：worldY 从地面往上，0=地面。canvasY = GY - worldY。碰撞全在 worldY 上算。
 */

const W = 900, H = 360, GY = 300;
const PX = 150, HALF = 13;
const STAND = 66, CROUCH_TOP = 30, DIVE_LO = 30, DIVE_HI = 58;
const G = -1750, JUMP_V = 640, JUMP_V2 = 560, FAST_FALL = -980, DIVE_DUR = 0.42;
const BASE_SPEED = 330, MAX_SPEED = 720;
const JUMP_APEX = Math.round((JUMP_V * JUMP_V) / (2 * -G));       // 单跳最高抬多少
const DECIDE_ETA = 1.6;                                            // 障碍还有这么多秒到就要决策
const LEAD = { jump: 0.30, double_jump: 0.32, crouch: 0.28, dive: 0.21 }; // 动作提前量（秒），按到达时间触发，随速度自适应

// 障碍：rects 是 worldY 上的实心段；need 是唯一解
const OBSTACLES = {
  ground:  { w: 40, rects: [[0, 52]],            need: 'jump',   label: '跳', desc: '地面尖刺箱' },
  ceiling: { w: 46, rects: [[50, 240]],          need: 'crouch', label: '蹲', desc: '头顶横梁' },
  middle:  { w: 44, rects: [[0, 28], [60, 240]], need: 'dive',   label: '扑', desc: '中缝门（只有中间一条缝）' },
  // 断开的地面：宽度按当前速度算（wf × 速度），这样跳跃距离和坑宽一起随速度缩放，难度恒定
  gap:      { gap: true, wf: 0.33, rects: [], need: 'jump',        label: '跳',   desc: '地面断开（单跳能跨过）' },
  gap_long: { gap: true, wf: 0.52, rects: [], need: 'double_jump', label: '二跳', desc: '长断崖（单跳跨不过，要二连跳）' },
  gap_isle: { gap: true, wf: 0.30, rects: [], need: 'jump',        label: '跳',   desc: '断崖的一段（中间有一小块落脚点，两段各跳一次）' },
};
const AIR1 = 2 * JUMP_V / -G;                                            // 单跳滞空 ≈0.73s
const AIR2 = 0.17 + (JUMP_V2 + Math.sqrt(JUMP_V2 * JUMP_V2 + 2 * -G * (JUMP_V * 0.17 + 0.5 * G * 0.17 * 0.17))) / -G; // 二连跳滞空 ≈0.94s
const ISLE_WF = 0.24;                                                    // 落脚点宽度系数（× 速度）
const PICKUPS = {
  life: { color: '#ff5c7a', ring: '#ffd0dc', glyph: '❤', desc: '加一条命' },
  dash: { color: '#ffd166', ring: '#fff0c0', glyph: '⚡', desc: '冲刺无敌 3 秒' },
};
// 障碍节奏：不是一个一个随机丢，而是成组出，中间留够反应时间
const PATTERNS = [
  ['ground'], ['ceiling'], ['gap'], ['middle'],
  ['gap_long'], ['island'], ['ground', 'gap'], ['gap', 'ceiling'],
  ['middle', 'gap_long'], ['island', 'ground'], ['ground', 'ceiling', 'middle'], ['gap', 'middle', 'gap_long'],
];

export function createRunner(panel, ctx) {
  const { config, ai } = ctx;
  panel.classList.add('runner');

  const canvas = h('canvas', { class: 'runner__canvas', width: W, height: H });
  const cx = canvas.getContext('2d');
  const scoreEl = h('div', { class: 'runner__score' }, '0');
  const bestEl = h('div', { class: 'runner__best' });
  const livesEl = h('div', { class: 'runner__lives' });
  const dashEl = h('div', { class: 'runner__dash' });
  const btnDemo = h('button', { class: 'btn btn--sm', onclick: () => setMode(mode === 'demo' ? 'off' : 'demo') }, 'AI 试玩');
  const btnJev = h('button', { class: 'btn btn--sm', onclick: () => setMode(mode === 'jev' ? 'off' : 'jev') }, '让 jev 玩');
  const agentLog = h('div', { class: 'runner__agentlog' });
  const hud = h('div', { class: 'runner__hud' },
    h('div', { class: 'runner__hud-left' }, livesEl, dashEl),
    h('div', { class: 'runner__hud-mid' }, btnDemo, btnJev),
    h('div', { class: 'runner__hud-right' }, scoreEl, bestEl));
  const hint = h('div', { class: 'runner__hint' }, '↑跳/二连跳 · ↓蹲(空中=快落) · 空格/J 向前扑（穿中缝）· 断崖要跳、长断崖要二连跳、带落脚点的先落再跳 · ❤加命 ⚡冲刺 · AI 接口：window.__runner');
  panel.append(hud, h('div', { class: 'runner__stage' }, canvas), agentLog, hint);

  let best = Number(config.get('game.runner.best', 0)) || 0;
  let mode = 'off';          // off | demo | jev
  let agent = null;          // (obs) => action | Promise<action>
  let pauseForAgent = false; // jev 模式：进决策区就停下来等
  let timeScale = 1;
  let raf = 0, last = 0, running = false, active = false;
  const keys = new Set();
  const listeners = {};
  let seq = 0;
  const S = {};

  function reset() {
    Object.assign(S, {
      phase: 'ready', t: 0, dist: 0, score: 0, speed: BASE_SPEED,
      lives: 3, invuln: 0, dashT: 0,
      footY: 0, vy: 0, jumps: 0, posture: 'run', diveT: 0,
      crouchAmt: 0, land: 0, lean: 0,              // 平滑量：蹲的深度、落地挤压、前倾
      obstacles: [], pickups: [], dust: [],
      spawnT: 1.2, pickT: 2.0, queue: [], dblT: 0, bridge: null, airDash: false,
      shake: 0, flash: 0,
      waiting: null, thinkT: 0,                    // 等 AI 的障碍 id、已等秒数
    });
  }
  reset();

  // ---------- 事件 ----------
  const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => off(ev, fn); };
  const off = (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); };
  const emit = (ev, data) => { for (const f of listeners[ev] || []) { try { f(data); } catch { /* 监听器自己的错不打断游戏 */ } } };

  // ---------- 命中框 ----------
  function hitbox() {
    if (S.posture === 'dive') return [S.footY + DIVE_LO, S.footY + DIVE_HI];
    if (S.posture === 'crouch') return [S.footY, S.footY + CROUCH_TOP];
    return [S.footY, S.footY + STAND];
  }
  const curSpeed = () => S.speed * (S.dashT > 0 ? 1.6 : 1);
  const front = () => PX + HALF;
  // 脚下有没有地：只看脚的中心点，压在坑上就算悬空。
  // 冲刺时速度是 1.6 倍，坑和间距都是按基础速度排的，跳跃会飞过落脚点掉进第二个坑——所以冲刺=无敌也包括「踩着空气冲过坑」。
  const gapUnder = () => S.obstacles.find((o) => OBSTACLES[o.type].gap && o.x < PX && o.x + o.w > PX) || null;
  const supported = () => {
    const g = gapUnder();
    if (!g) { S.bridge = null; return true; }
    if (S.dashT > 0) { S.bridge = g.id; return true; }   // 冲刺中：踩着空气过坑
    if (S.bridge === g.id) return true;                    // 冲刺正好在坑上用完：让它把这个坑走完，别当场掉下去
    return false;
  };

  // ---------- 动作 ----------
  function start() { if (S.phase === 'over') reset(); S.phase = 'play'; emit('start'); }
  function jump() {
    if (S.phase !== 'play') { start(); return true; }
    if (S.posture === 'dive') return false;
    if (S.posture === 'run' || S.posture === 'crouch') { S.vy = JUMP_V; S.posture = 'air'; S.jumps = 1; S.airDash = S.dashT > 0; puff(4); return true; }
    if (S.posture === 'air' && S.jumps < 2) { S.vy = JUMP_V2; S.jumps = 2; S.airDash = S.airDash || S.dashT > 0; puff(3, S.footY); return true; }
    return false;
  }
  function crouch() {
    if (S.phase !== 'play') return false;
    if (S.posture === 'air') { S.vy = FAST_FALL; return true; }
    if (S.posture === 'run') { S.posture = 'crouch'; puff(3); return true; }
    return false;
  }
  function release() { if (S.posture === 'crouch') S.posture = 'run'; }
  function dive() {
    if (S.phase !== 'play') { start(); return true; }
    if (S.posture === 'dive') return false;
    S.posture = 'dive'; S.diveT = DIVE_DUR; S.vy = 0; puff(5); return true;
  }
  // 二连跳的第二下走游戏时间（dblT），不用 setTimeout：暂停等 AI 时不会乱触发，慢放时也跟着慢
  const ACTIONS = { start, jump, crouch, release, dive,
    double_jump: () => { const ok = jump(); if (ok) S.dblT = 0.17; return ok; } };
  function act(name) { const fn = ACTIONS[name]; return fn ? Boolean(fn()) : false; }

  // ---------- 键盘 / 点击 ----------
  function onKeyDown(e) {
    if (!active) return;
    const k = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
    if (keys.has(k)) return; keys.add(k);
    if (k === 'ArrowUp' || k === 'w' || k === 'W') jump();
    else if (k === 'ArrowDown' || k === 's' || k === 'S') crouch();
    else if (k === ' ' || k === 'j' || k === 'J') dive();
    else if (k === 'Enter' && S.phase !== 'play') start();
  }
  function onKeyUp(e) { keys.delete(e.key); if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') release(); }
  canvas.addEventListener('pointerdown', (e) => {
    if (S.phase !== 'play') { start(); return; }
    if (e.offsetY / canvas.clientHeight < 0.5) jump(); else crouch();
  });
  canvas.addEventListener('pointerup', release);

  // ---------- 生成 ----------
  const level = () => S.score / 900;
  function spawnObstacle(type, x = W + 30) {
    const spec = OBSTACLES[type];
    const w = spec.gap ? Math.round(spec.wf * S.speed) : spec.w;
    const o = { id: ++seq, type, x, w, passed: false, hit: false, decided: false, plan: null, done: false, bob: Math.random() * 6.28 };
    S.obstacles.push(o); emit('spawn', o);
    return o;
  }
  function spawnPickup() {
    const type = Math.random() < 0.3 ? 'life' : 'dash';
    S.pickups.push({ id: ++seq, type, x: W + 30, y: 34 + Math.random() * 24, r: 13, got: false });
  }

  // ---------- 观测（给 AI）----------
  function state() {
    const spd = curSpeed();
    const next = S.obstacles.filter((o) => !o.passed && o.x + o.w > PX - HALF).sort((a, b) => a.x - b.x).slice(0, 3)
      .map((o) => { const spec = OBSTACLES[o.type]; const dist = Math.max(0, Math.round(o.x - front())); return { id: o.id, type: o.type, gap: Boolean(spec.gap), desc: spec.desc, solid: spec.rects, width: o.w, dist, eta: +(dist / spd).toFixed(2), planned: o.plan }; });
    const pickups = S.pickups.filter((p) => !p.got && p.x > PX - HALF).sort((a, b) => a.x - b.x).slice(0, 2)
      .map((p) => { const dist = Math.max(0, Math.round(p.x - front())); return { type: p.type, desc: PICKUPS[p.type].desc, height: Math.round(p.y), dist, eta: +(dist / spd).toFixed(2) }; });
    return {
      phase: S.phase, score: S.score, best, lives: S.lives, speed: Math.round(spd), dashLeft: +S.dashT.toFixed(1),
      player: { posture: S.posture, height: Math.round(S.footY), vy: Math.round(S.vy), jumpsLeft: S.posture === 'air' ? 2 - S.jumps : 2 },
      bands: { stand: [0, STAND], crouch: [0, CROUCH_TOP], dive: [DIVE_LO, DIVE_HI], jumpApex: JUMP_APEX,
        // 缺口能力：按当前速度算，单跳 / 二连跳最多能跨过多宽的坑（已扣掉起跳提前量和身宽）
        singleJumpClears: Math.round((AIR1 - LEAD.jump) * spd - 2 * HALF), doubleJumpClears: Math.round((AIR2 - LEAD.jump) * spd - 2 * HALF) },
      next, pickups,
    };
  }

  // ---------- 计划执行：把动作挂到障碍上，到时机自动放 ----------
  function plan(name, id) {
    const o = id ? S.obstacles.find((x) => x.id === id) : S.obstacles.filter((x) => !x.passed && !x.plan).sort((a, b) => a.x - b.x)[0];
    if (!o) return null;
    o.plan = name in LEAD || name === 'none' ? name : 'none';
    return o.id;
  }
  function runPlans() {
    const spd = curSpeed();
    for (const o of S.obstacles) {
      if (!o.plan || o.plan === 'none') continue;
      const eta = (o.x - front()) / spd;
      if (!o.done && eta <= LEAD[o.plan]) {
        const isGap = OBSTACLES[o.type].gap;
        if (S.posture === 'air' && (isGap || o.plan === 'dive' || o.plan === 'crouch')) {
          // 扑 / 蹲 必须在地面做：还没落地就先快速下坠。跨坑的跳也只在地面起跳（落脚点那种就得先落上去再跳），
          // 但跨坑时不能催下坠——催了可能直接掉进前一个坑。
          if (!isGap) S.vy = Math.min(S.vy, FAST_FALL);
        } else { o.done = true; act(o.plan); }
      }
      // 蹲要一直按到过去为止
      if (o.plan === 'crouch' && o.done && !o.passed && S.posture === 'run' && o.x + o.w > PX - HALF) S.posture = 'crouch';
      if (o.plan === 'crouch' && o.passed && S.posture === 'crouch' && !keys.has('ArrowDown')) release();
    }
  }

  // ---------- AI 决策：障碍进入决策区时问一次 ----------
  async function decide(o) {
    o.decided = true;
    if (!agent) return;
    const obs = state();
    const target = obs.next.find((n) => n.id === o.id);
    if (!target) return;
    if (pauseForAgent) { S.waiting = o.id; S.thinkT = 0; }
    let action = 'none', why = '';
    try {
      const r = await Promise.race([Promise.resolve(agent(obs, target)), new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 30000))]);
      if (typeof r === 'string') action = r; else if (r && typeof r === 'object') { action = r.action || 'none'; why = r.why || ''; }
    } catch (err) { why = `失败：${err.message}`; }
    if (!(action in LEAD)) action = 'none';
    if (S.obstacles.includes(o)) plan(action, o.id);
    logAgent(`${mode === 'jev' ? 'jev' : 'AI'} → ${OBSTACLES[o.type].desc}：${action}${why ? '（' + why + '）' : ''}`);
    emit('decide', { id: o.id, action, why });
    if (S.waiting === o.id) S.waiting = null;
  }
  function logAgent(text) { agentLog.textContent = text; agentLog.hidden = !text; }

  // ---------- 内置机器人 & jev ----------
  const demoAgent = (obs, target) => ({ action: OBSTACLES[target.type].need, why: '规则：按障碍类型选唯一解' });
  const JEV_SYSTEM = `你在操控一个横版跑酷游戏里的火柴人，它自动向右跑，你只负责在障碍到来前选一个动作。
可选动作：jump（起跳）、double_jump（二连跳，跳得更高）、crouch（蹲下滑过）、dive（向前扑，身体压到半空中间高度）、none（什么都不做）。
判断方法：障碍给出的 solid 是它实心部分离地的高度区间 [低,高]（像素，可能有多段）。角色各姿态占据的高度区间在 bands 里：stand 站立/跑步、crouch 蹲下、dive 向前扑；起跳会把整个身体往上平移，单跳最高抬 jumpApex，但上升途中仍会经过中间高度。
只要角色占据的区间和任一实心段重叠，就会撞。选一个能完全避开所有实心段的动作。
另一类障碍是断开的地面（gap 为 true，solid 为空）：不跳就掉下去。width 是坑宽（像素）。bands 里 singleJumpClears 是单跳最多能跨过的坑宽，doubleJumpClears 是二连跳能跨的：坑宽不超过 singleJumpClears 选 jump；超过就得 double_jump；desc 里说「有落脚点」的断崖被拆成两段，每段都不超过单跳，各选 jump 即可（会先落在落脚点上再起跳）。
只输出 JSON，不要别的：{"action":"jump|double_jump|crouch|dive|none","why":"一句话理由"}`;
  const jevAgent = async (obs, target) => {
    if (!ai) throw new Error('没有 AI 接口');
    const prompt = `下一个障碍：${JSON.stringify(target)}\n角色：${JSON.stringify(obs.player)}\n姿态高度带：${JSON.stringify(obs.bands)}\n附近道具：${JSON.stringify(obs.pickups)}`;
    const r = await ai.json(prompt, { system: JEV_SYSTEM, timeout: 30000 });
    return { action: String(r.action || 'none').toLowerCase(), why: String(r.why || '') };
  };
  function setMode(next) {
    mode = next;
    agent = next === 'demo' ? demoAgent : next === 'jev' ? jevAgent : null;
    pauseForAgent = next === 'jev';
    S.waiting = null;
    btnDemo.classList.toggle('is-active', mode === 'demo');
    btnJev.classList.toggle('is-active', mode === 'jev');
    logAgent(mode === 'off' ? '' : mode === 'demo' ? 'AI 试玩：内置规则机器人接管，按障碍类型自动选动作' : `让 jev 玩：每个障碍到来前暂停，把几何信息发给 ${ai?.describe?.() || 'AI'}，等它回答再放行`);
    if (mode !== 'off' && S.phase !== 'play') start();
  }

  // ---------- 每帧 ----------
  function step(dt) {
    if (S.phase !== 'play') return;
    // 等 AI 想：世界冻结，只走思考计时
    if (S.waiting) { S.thinkT += dt; return; }
    S.t += dt;
    S.speed = Math.min(MAX_SPEED, BASE_SPEED + level() * 60);
    const spd = curSpeed();
    S.dist += spd * dt;
    S.score = Math.floor(S.dist / 10);
    for (const k of ['invuln', 'dashT', 'shake', 'flash', 'land']) if (S[k] > 0) S[k] -= dt;

    // 二连跳第二下
    if (S.dblT > 0) { S.dblT -= dt; if (S.dblT <= 0 && S.posture === 'air' && S.jumps < 2) jump(); }
    // 竖直
    if (S.posture === 'dive') {
      S.diveT -= dt;
      if (S.diveT <= 0) { S.posture = S.footY > 0.5 ? 'air' : 'run'; if (S.posture === 'air') S.vy = 0; }
      if (S.footY <= 0 && !supported()) { S.posture = 'air'; S.vy = 0; S.jumps = Math.max(S.jumps, 1); }   // 扑到坑上照样掉
    } else if (S.posture === 'air') {
      S.vy += G * dt; S.footY += S.vy * dt;
      if (S.footY <= 0) {
        // 脚下有地、而且没掉太深才落得住；掉进坑里就一直往下，到底算摔
        // 冲刺中起的跳，轨迹是按冲刺速度飞的；冲刺半路用完也让它稳稳落下（落在坑上就接着把坑走完）
        if (S.footY > -12 && (supported() || S.airDash)) {
          if (S.airDash) S.bridge = gapUnder()?.id ?? null;
          S.airDash = false; S.footY = 0; S.vy = 0; S.jumps = 0; S.posture = keys.has('ArrowDown') ? 'crouch' : 'run'; S.land = 0.16; puff(6);
        }
        else if (S.footY < -90) fall();
      }
    } else if (!supported()) {
      // 跑着跑着地没了：直接往下掉，而且第一跳算用掉了（只剩空中那一下）
      S.posture = 'air'; S.vy = 0; S.jumps = 1;
    }
    // 平滑量：蹲深度、前倾
    S.crouchAmt += ((S.posture === 'crouch' ? 1 : 0) - S.crouchAmt) * Math.min(1, dt * 16);
    S.lean += ((S.dashT > 0 ? 1.4 : 1) - S.lean) * Math.min(1, dt * 6);

    // 生成：按组出，组内按速度留间距
    S.spawnT -= dt; S.pickT -= dt;
    if (S.spawnT <= 0) {
      if (!S.queue.length) S.queue = [...PATTERNS[Math.floor(Math.random() * Math.min(PATTERNS.length, 4 + Math.floor(level() * 2)))]];
      const tok = S.queue.shift();
      let crossT = 0;                                   // 坑本身要花时间跨过去，下一个障碍得排在坑后面
      if (tok === 'island') {
        // 带落脚点的断崖：坑 + 一小块地 + 坑。总宽超过二连跳极限，所以必须在落脚点上落一下再跳
        const a = spawnObstacle('gap_isle');
        const isle = Math.round(ISLE_WF * S.speed);
        const b = spawnObstacle('gap_isle', a.x + a.w + isle);
        crossT = (a.w + isle + b.w) / S.speed;
      } else {
        const o = spawnObstacle(tok);
        if (OBSTACLES[tok].gap) crossT = o.w / S.speed;
      }
      // 组内间距必须 > 单跳滞空（≈0.73s）：否则跳完还没落地，下一个「扑/蹲」根本做不了，不公平
      S.spawnT = (S.queue.length ? (1.0 + Math.random() * 0.25) : Math.max(1.05, 1.8 - level() * 0.08) * (0.9 + Math.random() * 0.4)) + crossT;
    }
    if (S.pickT <= 0) { spawnPickup(); S.pickT = 2.4 + Math.random() * 2.6; }

    // 决策区 + 计划执行
    for (const o of S.obstacles) if (!o.decided && (o.x - front()) / spd <= DECIDE_ETA) decide(o);
    runPlans();

    // 移动 + 碰撞
    const [lo, hi] = hitbox();
    for (const o of S.obstacles) {
      o.x -= spd * dt;
      const overlapX = o.x < PX + HALF && o.x + o.w > PX - HALF;
      if (overlapX && !o.hit && S.invuln <= 0 && S.dashT <= 0) {
        if (OBSTACLES[o.type].rects.some(([a, b]) => hi > a && lo < b)) { o.hit = true; loseLife(o); }
      }
      if (!o.passed && o.x + o.w < PX - HALF) { o.passed = true; if (!o.hit) { S.score += 5; emit('pass', o); } }
    }
    for (const p of S.pickups) {
      p.x -= spd * dt;
      if (!p.got && p.x < PX + HALF + p.r && p.x > PX - HALF - p.r && hi > p.y - p.r && lo < p.y + p.r) { p.got = true; grab(p); }
    }
    for (const d of S.dust) { d.x += d.vx * dt; d.y += d.vy * dt; d.vy -= 300 * dt; d.life -= dt; }
    S.obstacles = S.obstacles.filter((o) => o.x + o.w > -20);
    S.pickups = S.pickups.filter((p) => !p.got && p.x > -30);
    S.dust = S.dust.filter((d) => d.life > 0);
  }

  function loseLife(o) {
    S.lives -= 1; S.invuln = 1.3; S.shake = 0.3; S.flash = 0.25;
    emit('hit', o);
    if (S.lives <= 0) {
      S.phase = 'over';
      if (S.score > best) { best = S.score; config.set('game.runner.best', best); }
      emit('over', { score: S.score, best });
    }
  }
  /** 掉进坑里：扣一条命，把脚下还压着的坑挪走，放回地面继续跑 */
  function fall() {
    const pit = S.obstacles.find((o) => OBSTACLES[o.type].gap && o.x < PX && o.x + o.w > PX) || { type: 'gap' };
    loseLife(pit);
    S.obstacles = S.obstacles.filter((o) => !(OBSTACLES[o.type].gap && o.x < PX + 40));
    S.footY = 0; S.vy = 0; S.posture = 'run'; S.jumps = 0; S.dblT = 0; S.airDash = false; S.bridge = null; puff(6);
  }
  function grab(p) {
    if (p.type === 'life') S.lives = Math.min(5, S.lives + 1); else { S.dashT = 3; S.flash = 0.2; }
    emit('pickup', p);
  }
  function puff(n, y = 0) {
    for (let i = 0; i < n; i++) S.dust.push({ x: PX + (Math.random() - 0.5) * 16, y: y + Math.random() * 4, vx: -60 - Math.random() * 90, vy: 40 + Math.random() * 80, life: 0.35 + Math.random() * 0.25, r: 2 + Math.random() * 2 });
  }

  // ---------- 渲染 ----------
  const toY = (worldY) => GY - worldY;
  function draw() {
    cx.clearRect(0, 0, W, H);
    const sx = S.shake > 0 ? (Math.random() - 0.5) * 8 : 0;
    cx.save(); cx.translate(sx, 0);
    const g = cx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1b2440'); g.addColorStop(1, '#0d1220');
    cx.fillStyle = g; cx.fillRect(-10, 0, W + 20, H);
    drawParallax();
    cx.fillStyle = '#233152'; cx.fillRect(-10, GY, W + 20, H - GY);
    cx.strokeStyle = '#3a4c78'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(-10, GY); cx.lineTo(W + 10, GY); cx.stroke();
    const off = S.dist % 60;
    cx.strokeStyle = 'rgba(120,150,220,.28)'; cx.lineWidth = 2;
    for (let x = -off; x < W; x += 60) { cx.beginPath(); cx.moveTo(x, GY + 14); cx.lineTo(x + 22, GY + 14); cx.stroke(); }
    for (const o of S.obstacles) drawObstacle(o);
    for (const p of S.pickups) drawPickup(p);
    for (const d of S.dust) { cx.globalAlpha = Math.max(0, d.life * 2); cx.fillStyle = '#9fb3d9'; cx.beginPath(); cx.arc(d.x, toY(d.y), d.r, 0, 7); cx.fill(); }
    cx.globalAlpha = 1;
    drawStick();
    if (S.dashT > 0) {
      cx.strokeStyle = 'rgba(255,209,102,.45)'; cx.lineWidth = 2;
      for (let i = 0; i < 6; i++) { const y = 50 + i * 42 + (S.t * 300 % 20); cx.beginPath(); cx.moveTo(PX + 60, y); cx.lineTo(PX + 120 + Math.random() * 40, y); cx.stroke(); }
    }
    if (S.flash > 0) { cx.fillStyle = `rgba(255,255,255,${S.flash * 0.6})`; cx.fillRect(0, 0, W, H); }
    cx.restore();
    if (S.phase !== 'play') drawOverlay(); else if (S.waiting) drawThinking();
    scoreEl.textContent = String(S.score);
    bestEl.textContent = `最高 ${best}`;
    livesEl.textContent = '❤'.repeat(Math.max(0, S.lives)) + '·'.repeat(Math.max(0, 5 - S.lives));
    dashEl.textContent = S.dashT > 0 ? `⚡冲刺 ${S.dashT.toFixed(1)}s` : '';
  }
  function drawParallax() {
    cx.fillStyle = '#141b30';
    const o1 = (S.dist * 0.15) % 300;
    for (let x = -o1; x < W + 120; x += 300) {
      cx.beginPath(); cx.moveTo(x, GY); cx.lineTo(x + 80, GY - 90); cx.lineTo(x + 160, GY); cx.closePath(); cx.fill();
      cx.beginPath(); cx.moveTo(x + 120, GY); cx.lineTo(x + 190, GY - 64); cx.lineTo(x + 260, GY); cx.closePath(); cx.fill();
    }
    cx.fillStyle = 'rgba(200,220,255,.5)';
    for (let i = 0; i < 30; i++) { const x = (i * 137.5 - S.dist * 0.05) % W; cx.fillRect((x + W) % W, (i * 53) % 160 + 10, 2, 2); }
  }
  function roundRect(x, y, w, hh, r) {
    r = Math.min(r, w / 2, hh / 2); cx.beginPath();
    cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + hh, r); cx.arcTo(x + w, y + hh, x, y + hh, r); cx.arcTo(x, y + hh, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath();
  }
  function drawObstacle(o) {
    const spec = OBSTACLES[o.type];
    cx.save();
    if (spec.gap) {
      // 坑：把地面挖掉露出深处，两侧描一道亮边，坑底几根钟乳石
      const pit = cx.createLinearGradient(0, GY, 0, H); pit.addColorStop(0, '#0a0e18'); pit.addColorStop(1, '#04060b');
      cx.fillStyle = pit; cx.fillRect(o.x, GY - 2, o.w, H - GY + 2);
      cx.strokeStyle = '#4d6396'; cx.lineWidth = 3;
      cx.beginPath(); cx.moveTo(o.x, GY); cx.lineTo(o.x, GY + 26); cx.moveTo(o.x + o.w, GY); cx.lineTo(o.x + o.w, GY + 26); cx.stroke();
      cx.fillStyle = '#141b30';
      for (let x = o.x + 6; x < o.x + o.w - 6; x += 14) { cx.beginPath(); cx.moveTo(x, H); cx.lineTo(x + 5, H - 18 - (Math.round(x) * 7) % 12); cx.lineTo(x + 10, H); cx.closePath(); cx.fill(); }
      cx.restore();
      badge(o, spec, GY - 16);
      return;
    }
    // 地上的影子
    cx.fillStyle = 'rgba(0,0,0,.28)'; cx.beginPath(); cx.ellipse(o.x + o.w / 2, GY + 4, o.w * 0.7, 5, 0, 0, 7); cx.fill();
    if (o.type === 'ground') {
      // 木箱 + 尖刺
      cx.fillStyle = '#8a5a3a'; roundRect(o.x, toY(38), o.w, 38, 4); cx.fill();
      cx.strokeStyle = '#5a3520'; cx.lineWidth = 2; cx.strokeRect(o.x + 4, toY(34), o.w - 8, 30);
      cx.beginPath(); cx.moveTo(o.x + 4, toY(34)); cx.lineTo(o.x + o.w - 4, toY(4)); cx.moveTo(o.x + o.w - 4, toY(34)); cx.lineTo(o.x + 4, toY(4)); cx.stroke();
      cx.fillStyle = '#e2574b';
      for (let i = 0; i < 4; i++) { const x0 = o.x + i * (o.w / 4); cx.beginPath(); cx.moveTo(x0, toY(38)); cx.lineTo(x0 + o.w / 8, toY(52)); cx.lineTo(x0 + o.w / 4, toY(38)); cx.closePath(); cx.fill(); }
    } else if (o.type === 'ceiling') {
      // 吊着的横梁：两根链子 + 警示条纹，轻微摆
      const sway = Math.sin(S.t * 2 + o.bob) * 2;
      cx.strokeStyle = '#6f7d9c'; cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(o.x + 8, 0); cx.lineTo(o.x + 8 + sway, toY(96)); cx.moveTo(o.x + o.w - 8, 0); cx.lineTo(o.x + o.w - 8 + sway, toY(96)); cx.stroke();
      cx.translate(sway, 0);
      cx.fillStyle = '#3a3f52'; roundRect(o.x, toY(96), o.w, 46, 5); cx.fill();
      cx.save(); cx.beginPath(); roundRect(o.x, toY(96), o.w, 46, 5); cx.clip();
      cx.fillStyle = '#e6b45b';
      for (let x = o.x - 20; x < o.x + o.w + 20; x += 14) { cx.beginPath(); cx.moveTo(x, toY(96)); cx.lineTo(x + 7, toY(96)); cx.lineTo(x - 7, toY(50)); cx.lineTo(x - 14, toY(50)); cx.closePath(); cx.fill(); }
      cx.restore();
      cx.fillStyle = '#c28be8'; roundRect(o.x, toY(240), o.w, 240 - 96, 0); cx.fill();
    } else {
      // 中缝门：上下两块能量板，中间一条会闪的缝
      const glow = 0.6 + Math.sin(S.t * 8 + o.bob) * 0.3;
      cx.fillStyle = '#2a7f95'; roundRect(o.x, toY(28), o.w, 28, 4); cx.fill(); roundRect(o.x, toY(240), o.w, 180, 4); cx.fill();
      cx.fillStyle = '#4ec2d8'; roundRect(o.x + 3, toY(28), o.w - 6, 6, 3); cx.fill(); roundRect(o.x + 3, toY(66), o.w - 6, 6, 3); cx.fill();
      cx.shadowColor = '#7ff0ff'; cx.shadowBlur = 14 * glow;
      cx.strokeStyle = `rgba(140,245,255,${glow})`; cx.lineWidth = 2; cx.setLineDash([6, 5]);
      cx.strokeRect(o.x + 2, toY(60), o.w - 4, 32); cx.setLineDash([]); cx.shadowBlur = 0;
    }
    cx.restore();
    badge(o, spec, o.type === 'ceiling' ? toY(40) : o.type === 'middle' ? toY(44) : toY(64));
  }
  /** 动作提示牌 + AI 已计划动作的小角标 */
  function badge(o, spec, badgeY) {
    cx.save();
    cx.font = 'bold 13px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'alphabetic';
    const bw = Math.max(22, cx.measureText(spec.label).width + 10);
    cx.fillStyle = 'rgba(0,0,0,.45)'; roundRect(o.x + o.w / 2 - bw / 2, badgeY - 11, bw, 16, 5); cx.fill();
    cx.fillStyle = '#fff'; cx.fillText(spec.label, o.x + o.w / 2, badgeY + 1);
    if (o.plan && o.plan !== 'none') { cx.fillStyle = o.done ? '#21e6a5' : '#ffd166'; cx.font = 'bold 10px sans-serif'; cx.fillText(o.plan, o.x + o.w / 2, badgeY - 14); }
    cx.restore();
  }
  function drawPickup(p) {
    const spec = PICKUPS[p.type];
    const y = toY(p.y), bob = Math.sin(S.t * 6 + p.x) * 2;
    cx.save(); cx.shadowColor = spec.color; cx.shadowBlur = 12;
    cx.fillStyle = spec.ring; cx.beginPath(); cx.arc(p.x, y + bob, p.r, 0, 7); cx.fill();
    cx.fillStyle = spec.color; cx.beginPath(); cx.arc(p.x, y + bob, p.r - 4, 0, 7); cx.fill();
    cx.shadowBlur = 0; cx.fillStyle = '#fff'; cx.font = 'bold 13px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(spec.glyph, p.x, y + bob + 1); cx.restore();
  }

  /** 火柴人。膝盖往后折、肘往前折，跑步有支撑/摆动两个相位，落地挤压，蹲下有过渡。 */
  function drawStick() {
    const blink = S.invuln > 0 && Math.floor(S.t * 12) % 2 === 0;
    cx.save(); cx.globalAlpha = blink ? 0.35 : 1;
    const col = S.dashT > 0 ? '#ffd166' : '#eaf2ff';
    cx.strokeStyle = col; cx.fillStyle = col; cx.lineWidth = 4; cx.lineCap = 'round'; cx.lineJoin = 'round';
    const feet = toY(S.footY);
    const line = (x1, y1, x2, y2) => { cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke(); };
    const head = (x, y) => { cx.beginPath(); cx.arc(x, y, 8, 0, 7); cx.stroke(); };
    // 落地挤压：整体压扁一下再弹回
    const sq = S.land > 0 ? 1 - Math.sin((S.land / 0.16) * Math.PI) * 0.12 : 1;
    cx.translate(PX, feet); cx.scale(1 / sq, sq); cx.translate(-PX, -feet);

    if (S.posture === 'dive') {
      const midY = toY(S.footY + (DIVE_LO + DIVE_HI) / 2);
      const bx = PX - 12, fx = PX + 22;
      head(fx + 9, midY - 1);
      line(bx, midY, fx, midY);
      line(bx, midY, bx - 10, midY - 10); line(bx - 10, midY - 10, bx - 20, midY - 4);   // 后腿蹬直再折
      line(bx, midY, bx - 8, midY + 9);  line(bx - 8, midY + 9, bx - 19, midY + 6);
      line(fx - 4, midY, fx + 8, midY - 12); line(fx - 4, midY + 1, fx + 10, midY + 8);   // 双臂前伸
      // 扑的气流线
      cx.globalAlpha *= 0.5; line(bx - 26, midY - 6, bx - 40, midY - 6); line(bx - 24, midY + 4, bx - 36, midY + 4);
    } else {
      // 站/跑/蹲：蹲下是站的连续压缩（crouchAmt 0→1）
      const c = S.crouchAmt;
      const bodyH = STAND - (STAND - CROUCH_TOP) * c;                 // 头顶高度
      const hipH = 28 - 12 * c;                                        // 髋高
      const lean = S.posture === 'air' ? 4 : (6 + 10 * c) * S.lean;   // 前倾像素
      const hipX = PX - 2, hipY = toY(S.footY + hipH);
      const neckX = hipX + lean, neckY = toY(S.footY + bodyH - 10);
      const cad = S.dist * 0.085;                                      // 步频跟前进速度绑定
      const bobY = S.posture === 'run' ? Math.abs(Math.sin(cad)) * 2 : 0;
      head(neckX + 3, neckY - 6 + bobY);
      line(neckX, neckY + 2 + bobY, hipX, hipY);
      const TH = 17 - 4 * c, SH = 16 - 4 * c;
      if (S.posture === 'air') {
        // 腾空：前腿屈膝上抬，后腿向后蹬；手臂张开找平衡
        legs(hipX, hipY, 0.9, -1.4, TH, SH); legs(hipX, hipY, -0.6, -0.9, TH, SH);
        line(neckX, neckY + 6, neckX - 13, neckY + 16); line(neckX, neckY + 6, neckX + 14, neckY - 4);
      } else {
        for (const offp of [0, Math.PI]) {
          const ph = cad + offp;
          const swing = Math.sin(ph);                                   // >0 腿在前
          const thigh = swing * (0.95 - 0.5 * c) - 0.1;                 // 大腿摆角，前为正
          const recovering = Math.cos(ph) > 0;                          // 正往前摆 = 摆动相，脚离地、膝盖折得深
          const flex = (recovering ? 1.35 : 0.35) * (1 - 0.6 * c) + 0.45 * c;
          legs(hipX, hipY, thigh, -flex, TH, SH, !recovering);
        }
        // 手臂和腿反相，肘往前折
        for (const offp of [Math.PI, 0]) {
          const ph = cad + offp;
          const up = Math.sin(ph) * (0.8 - 0.5 * c);
          const shX = neckX - 1, shY = neckY + 5 + bobY;
          const elX = shX + Math.sin(up) * 12, elY = shY + Math.cos(up) * 12;
          const fa = up + 1.5;                                          // 肘弯：小臂往前抬
          line(shX, shY, elX, elY); line(elX, elY, elX + Math.sin(fa) * 11, elY + Math.cos(fa) * 11);
        }
        // 围巾：一段往后飘的线，速度感
        cx.globalAlpha *= 0.85; cx.lineWidth = 3;
        cx.beginPath(); cx.moveTo(neckX - 2, neckY + 3 + bobY);
        for (let i = 1; i <= 4; i++) cx.lineTo(neckX - 2 - i * 7, neckY + 3 + bobY + Math.sin(S.t * 18 + i) * 3 + i * 1.2);
        cx.stroke();
      }
    }
    cx.restore();

    /** 一条腿：thigh 大腿角（从竖直向下量，前为正），flexRel 小腿相对大腿的折角（负=往后折，膝盖朝前）。stance=支撑相时脚踩地。 */
    function legs(hx, hy, thigh, flexRel, TH, SH, stance) {
      const kx = hx + Math.sin(thigh) * TH, ky = hy + Math.cos(thigh) * TH;
      const sa = thigh + flexRel;
      let fx = kx + Math.sin(sa) * SH, fy = ky + Math.cos(sa) * SH;
      if (stance || fy > feet) { fy = Math.min(fy, feet); }
      line(hx, hy, kx, ky); line(kx, ky, fx, fy);
      line(fx, fy, fx + 6, fy);                                       // 脚掌朝前
    }
  }

  function drawThinking() {
    cx.fillStyle = 'rgba(9,13,24,.45)'; cx.fillRect(0, 0, W, H);
    const o = S.obstacles.find((x) => x.id === S.waiting);
    cx.textAlign = 'center'; cx.fillStyle = '#ffd166'; cx.font = 'bold 20px sans-serif';
    cx.fillText(`jev 思考中… ${S.thinkT.toFixed(1)}s`, W / 2, 60);
    cx.fillStyle = '#a9bde0'; cx.font = '14px sans-serif';
    if (o) cx.fillText(`下一个：${OBSTACLES[o.type].desc} · 实心 ${JSON.stringify(OBSTACLES[o.type].rects)}`, W / 2, 86);
  }
  function drawOverlay() {
    cx.fillStyle = 'rgba(9,13,24,.72)'; cx.fillRect(0, 0, W, H);
    cx.textAlign = 'center'; cx.fillStyle = '#eaf2ff';
    if (S.phase === 'ready') {
      cx.font = 'bold 34px sans-serif'; cx.fillText('火柴人酷跑', W / 2, H / 2 - 34);
      cx.font = '15px sans-serif'; cx.fillStyle = '#a9bde0';
      cx.fillText('↑ 跳 / 二连跳    ↓ 蹲(空中=快落)    空格 / J 向前扑', W / 2, H / 2 + 2);
      cx.fillText('中缝门只能「扑」· 断崖要跳、长断崖二连跳、有落脚点的先落再跳 · ❤ 加命 ⚡ 冲刺 · 上面按钮可让 AI / jev 来玩', W / 2, H / 2 + 26);
      cx.fillStyle = '#ffd166'; cx.font = 'bold 18px sans-serif';
      cx.fillText('按 ↑ / 空格 / 点屏幕 开始', W / 2, H / 2 + 64);
    } else {
      cx.font = 'bold 34px sans-serif'; cx.fillText('撞上啦', W / 2, H / 2 - 26);
      cx.font = '20px sans-serif'; cx.fillStyle = '#a9bde0'; cx.fillText(`本局 ${S.score} · 最高 ${best}`, W / 2, H / 2 + 6);
      cx.fillStyle = '#ffd166'; cx.font = 'bold 18px sans-serif'; cx.fillText('按 ↑ / 空格 重新开始', W / 2, H / 2 + 44);
    }
  }

  // ---------- 主循环 ----------
  function frame(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0) * timeScale; last = ts;
    step(dt); draw();
    raf = requestAnimationFrame(frame);
  }

  // 对外接口（给 jev / 脚本用）
  const api = {
    state, act, plan, on, off,
    setAgent(fn, { pause = false } = {}) { agent = typeof fn === 'function' ? fn : null; pauseForAgent = Boolean(pause); mode = agent ? 'custom' : 'off'; },
    setMode, getMode: () => mode,
    setTimeScale(x) { timeScale = Math.max(0.1, Math.min(2, Number(x) || 1)); },
    reset: () => { reset(); },
    ACTIONS: Object.keys(LEAD).concat('none'), OBSTACLES, BANDS: { stand: [0, STAND], crouch: [0, CROUCH_TOP], dive: [DIVE_LO, DIVE_HI], jumpApex: JUMP_APEX },
  };
  window.__runner = api;

  return {
    activate() {
      active = true;
      window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
      if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    },
    deactivate() {
      active = false; running = false; cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
      keys.clear();
    },
    api,
  };
}
