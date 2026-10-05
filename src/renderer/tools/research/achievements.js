import { h, toast } from '../../core/ui.js';

/**
 * 论文阅读成就系统 —— 专治「读了跟没读一样」的懒。
 *
 * 规则（强制）：一篇要标成「已读」，必须先有 >=2 条批注 + 一段 >=20 字的心得体会。
 *   点「标记已读」时若没达标，直接拦下来：缺批注就提醒去选中原文写批注，缺心得就当场弹框逼你写。
 * 激励（游戏化）：每条批注 / 划重点 / 心得 / 读完都给经验值，攒修为等级（炼气→渡劫），
 *   连续阅读有连击，达成里程碑解锁成就徽章并弹庆祝。一个奖杯按钮随时看进度。
 *
 * 数据：成就自身状态存 config 的 research.achieve（xp / 解锁列表 / 连击 / 已庆祝）；
 *   篇数、批注数、心得数都从权威存储（litMeta / litAnno / litHighlights）实时推导，不怕漂移。
 */
const KEY = 'research.achieve';
export const REQUIRE_ANNOS = 2;      // 标为已读所需最少批注
export const REFLECT_MIN = 20;       // 心得体会最少字数
const DEEP_ANNOS = 5;                // 「深读」门槛：一篇 >=5 批注且有心得
const XP = { anno: 10, highlight: 4, reflection: 25, read: 60, deep: 40 };

// 等级：按累计经验，名字走修仙阶位，够中二够上头
const LEVELS = [
  { at: 0, name: '炼气', icon: '🌱' },
  { at: 120, name: '筑基', icon: '🪨' },
  { at: 350, name: '结丹', icon: '🟡' },
  { at: 750, name: '元婴', icon: '👶' },
  { at: 1400, name: '化神', icon: '🔮' },
  { at: 2600, name: '炼虚', icon: '🌫' },
  { at: 4200, name: '合体', icon: '☯' },
  { at: 6500, name: '大乘', icon: '✨' },
  { at: 10000, name: '渡劫', icon: '⚡' },
];

// 成就徽章：test 收到 stats() 的结果
const ACHIEVEMENTS = [
  { id: 'anno-1', name: '第一笔', icon: '✍️', desc: '写下第一条批注', test: (s) => s.annos >= 1 },
  { id: 'anno-10', name: '勤批注', icon: '🖊', desc: '累计 10 条批注', test: (s) => s.annos >= 10 },
  { id: 'anno-50', name: '批注狂魔', icon: '🪶', desc: '累计 50 条批注', test: (s) => s.annos >= 50 },
  { id: 'hl-20', name: '荧光笔', icon: '🖍', desc: '累计划 20 处重点', test: (s) => s.highlights >= 20 },
  { id: 'reflect-1', name: '有感而发', icon: '💭', desc: '写下第一篇心得', test: (s) => s.reflections >= 1 },
  { id: 'reflect-10', name: '思考者', icon: '🧠', desc: '写满 10 篇心得', test: (s) => s.reflections >= 10 },
  { id: 'read-1', name: '破冰', icon: '📖', desc: '认真读完第一篇', test: (s) => s.reads >= 1 },
  { id: 'read-5', name: '小有积累', icon: '📚', desc: '读完 5 篇', test: (s) => s.reads >= 5 },
  { id: 'read-20', name: '博览', icon: '🏮', desc: '读完 20 篇', test: (s) => s.reads >= 20 },
  { id: 'read-50', name: '著作等身', icon: '🗄', desc: '读完 50 篇', test: (s) => s.reads >= 50 },
  { id: 'deep-1', name: '深读', icon: '🔎', desc: '一篇里写满 5 条批注且有心得', test: (s) => s.deepReads >= 1 },
  { id: 'deep-5', name: '钻研', icon: '⛏', desc: '深读 5 篇', test: (s) => s.deepReads >= 5 },
  { id: 'streak-3', name: '三天不断', icon: '🔥', desc: '连续 3 天有阅读', test: (s) => s.streak >= 3 },
  { id: 'streak-7', name: '一周坚持', icon: '🔥', desc: '连续 7 天有阅读', test: (s) => s.streak >= 7 },
  { id: 'streak-30', name: '月度自律', icon: '🏆', desc: '连续 30 天有阅读', test: (s) => s.streak >= 30 },
  { id: 'lvl-5', name: '登堂入室', icon: '🎓', desc: '修为突破「炼虚」', test: (s) => s.level >= 5 },
];

const CSS = `
.ach-badge { display:inline-flex; align-items:center; gap:5px; cursor:pointer; padding:3px 9px; border-radius:999px; border:1px solid rgba(214,190,140,.5); background:rgba(214,190,140,.14); color:#f0e4c8; font:600 11.5px/1 var(--font); }
.ach-badge:hover { background:rgba(214,190,140,.26); }
.ach-badge b { color:#fff; }
.ach-badge__bar { width:46px; height:5px; border-radius:3px; background:rgba(255,255,255,.14); overflow:hidden; }
.ach-badge__fill { height:100%; background:linear-gradient(90deg,#d6be8c,#ffe9b0); }
.ach-ov { position:fixed; inset:0; z-index:2600; display:flex; align-items:center; justify-content:center; background:rgba(8,10,14,.6); backdrop-filter:blur(3px); }
.ach-panel { width:min(680px,92vw); max-height:86vh; overflow:auto; border-radius:18px; border:1px solid rgba(214,190,140,.4); background:linear-gradient(180deg,#1b1813,#141821); box-shadow:0 30px 90px rgba(0,0,0,.6); color:#ece6d8; font-family:${'"Charter","Iowan Old Style","Georgia","Songti SC",serif'}; }
.ach-panel__head { position:relative; padding:22px 24px 16px; border-bottom:1px solid rgba(214,190,140,.26); background:radial-gradient(ellipse at 20% 0%, rgba(214,190,140,.14), transparent 60%); }
.ach-panel__kicker { font-family:var(--font); font-size:10.5px; letter-spacing:.3em; text-transform:uppercase; color:#d6be8c; }
.ach-panel__lvl { display:flex; align-items:center; gap:12px; margin-top:6px; }
.ach-panel__lvl-icon { font-size:38px; }
.ach-panel__lvl-name { font-size:24px; font-weight:600; }
.ach-panel__lvl-sub { font-family:var(--font); font-size:12px; color:#b9b1a1; }
.ach-xpbar { margin-top:10px; height:9px; border-radius:5px; background:rgba(255,255,255,.1); overflow:hidden; }
.ach-xpbar__fill { height:100%; background:linear-gradient(90deg,#d6be8c,#ffe9b0); transition:width .5s; }
.ach-x { position:absolute; top:14px; right:16px; border:0; background:transparent; color:#b9b1a1; font-size:20px; cursor:pointer; }
.ach-x:hover { color:#fff; }
.ach-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; padding:16px 24px; }
.ach-stat { border:1px solid rgba(255,255,255,.1); border-radius:12px; padding:10px 8px; text-align:center; background:rgba(255,255,255,.03); }
.ach-stat b { display:block; font-size:22px; color:#fff; font-family:var(--font); }
.ach-stat span { font-size:11px; color:#b9b1a1; }
.ach-nudge { margin:0 24px 8px; padding:10px 14px; border-radius:10px; font-size:13px; line-height:1.6; background:rgba(223,161,69,.12); border:1px solid rgba(223,161,69,.4); color:#f3dcb0; }
.ach-nudge.is-done { background:rgba(63,185,138,.12); border-color:rgba(63,185,138,.4); color:#bfe6d2; }
.ach-sec { padding:4px 24px 20px; }
.ach-sec h4 { font-family:var(--font); font-size:13px; color:#d6be8c; margin:10px 0 8px; letter-spacing:.04em; }
.ach-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
.ach-card { display:flex; gap:10px; align-items:flex-start; border:1px solid rgba(255,255,255,.1); border-radius:12px; padding:10px 12px; background:rgba(255,255,255,.03); }
.ach-card.is-locked { opacity:.42; filter:grayscale(.6); }
.ach-card.is-new { border-color:#d6be8c; box-shadow:0 0 0 1px rgba(214,190,140,.5),0 0 22px rgba(214,190,140,.25); }
.ach-card__icon { font-size:26px; line-height:1; }
.ach-card__name { font-weight:600; font-size:13.5px; }
.ach-card__desc { font-family:var(--font); font-size:11.5px; color:#b9b1a1; line-height:1.5; margin-top:2px; }
/* 解锁庆祝 */
.ach-pop { position:fixed; left:50%; top:30%; transform:translateX(-50%) scale(.6); z-index:2700; padding:18px 26px; border-radius:16px; text-align:center; background:linear-gradient(180deg,#2a2213,#14110a); border:1px solid #d6be8c; box-shadow:0 0 40px rgba(214,190,140,.5); color:#fff; font-family:${'"Charter","Songti SC",serif'}; opacity:0; animation:ach-pop 2.6s ease forwards; pointer-events:none; }
.ach-pop__icon { font-size:46px; }
.ach-pop__t { font-size:12px; color:#d6be8c; letter-spacing:.2em; margin-top:4px; }
.ach-pop__n { font-size:20px; font-weight:700; margin-top:2px; }
@keyframes ach-pop { 12%{opacity:1;transform:translateX(-50%) scale(1.05);} 20%{transform:translateX(-50%) scale(1);} 85%{opacity:1;} 100%{opacity:0;transform:translateX(-50%) scale(1) translateY(-14px);} }
/* 心得强制弹框 */
.ach-reflect textarea { width:100%; min-height:150px; font-family:${'"Charter","Songti SC",serif'}; font-size:14px; line-height:1.8; background:#f5f0e6; color:#201d19; border:1px solid #d9d0bf; border-radius:6px; padding:16px 18px; }
.ach-reflect textarea::placeholder { color:#8f887b; font-style:italic; }
.ach-reflect__count { font-family:var(--font); font-size:11.5px; color:#b9b1a1; }
.ach-reflect__hint { font-family:var(--font); font-size:12px; color:#b9b1a1; line-height:1.6; margin:4px 0 10px; }
`;

const today = () => new Date().toISOString().slice(0, 10);
const levelOf = (xp) => { let i = 0; for (let k = 0; k < LEVELS.length; k += 1) if (xp >= LEVELS[k].at) i = k; return i; };

export function createAchievements(ctx) {
  const { config } = ctx;
  if (!document.getElementById('ach-css')) document.head.append(h('style', { id: 'ach-css' }, CSS));

  const getState = () => ({ xp: 0, unlocked: [], streak: { count: 0, last: '' }, firstDay: '', ...(config.get(KEY) || {}) });
  const save = (s) => config.set(KEY, s);

  function stats() {
    const r = (config.cache && config.cache.research) || {};
    const meta = r.litMeta || {}; const annoMap = r.litAnno || {}; const hlMap = r.litHighlights || {};
    let reads = 0; let reflections = 0; let deepReads = 0;
    for (const [file, m] of Object.entries(meta)) {
      const reflectLen = String(m?.note || '').trim().length;
      const annoN = (annoMap[file] || []).length;
      if (m?.readStatus === 'read') reads += 1;
      if (reflectLen >= REFLECT_MIN) reflections += 1;
      if (m?.readStatus === 'read' && annoN >= DEEP_ANNOS && reflectLen >= REFLECT_MIN) deepReads += 1;
    }
    const annos = Object.values(annoMap).reduce((a, x) => a + (x?.length || 0), 0);
    const highlights = Object.values(hlMap).reduce((a, x) => a + (x?.length || 0), 0);
    const st = getState();
    return { reads, reflections, deepReads, annos, highlights, xp: st.xp || 0, level: levelOf(st.xp || 0), streak: st.streak?.count || 0, unlocked: st.unlocked || [] };
  }

  function paperStatus(file) {
    const r = (config.cache && config.cache.research) || {};
    const m = (r.litMeta || {})[file] || {};
    const annoN = ((r.litAnno || {})[file] || []).length;
    const reflectLen = String(m.note || '').trim().length;
    return { annoN, reflectLen, hasReflection: reflectLen >= REFLECT_MIN, enoughAnnos: annoN >= REQUIRE_ANNOS, readStatus: m.readStatus };
  }
  function canMarkRead(file) {
    const p = paperStatus(file); const missing = [];
    if (!p.enoughAnnos) missing.push(`再写 ${REQUIRE_ANNOS - p.annoN} 条批注（在原文里选中文字 → 批注）`);
    if (!p.hasReflection) missing.push(`写一段心得体会（至少 ${REFLECT_MIN} 字，现在 ${p.reflectLen} 字）`);
    return { ok: missing.length === 0, missing, ...p };
  }

  function bumpXp(delta) {
    const s = getState(); const t = today();
    if (s.streak.last !== t) {
      const yd = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      s.streak.count = s.streak.last === yd ? (s.streak.count || 0) + 1 : 1;
      s.streak.last = t;
    }
    if (!s.firstDay) s.firstDay = t;
    const before = levelOf(s.xp || 0);
    s.xp = (s.xp || 0) + delta;
    save(s);
    const after = levelOf(s.xp);
    if (after > before) setTimeout(() => celebrate([{ icon: LEVELS[after].icon, name: `突破：${LEVELS[after].name}`, kicker: '境界突破' }]), 350);
    return s;
  }
  function checkUnlocks() {
    const st = stats(); const s = getState(); const newly = [];
    for (const a of ACHIEVEMENTS) { if (s.unlocked.includes(a.id)) continue; if (a.test(st)) { s.unlocked.push(a.id); newly.push(a); } }
    if (newly.length) save(s);
    return newly;
  }
  function celebrate(list) {
    list.forEach((a, i) => setTimeout(() => {
      const pop = h('div', { class: 'ach-pop' }, h('div', { class: 'ach-pop__icon' }, a.icon || '🏆'), h('div', { class: 'ach-pop__t' }, a.kicker || '解锁成就'), h('div', { class: 'ach-pop__n' }, a.name));
      document.body.append(pop); setTimeout(() => pop.remove(), 2700);
    }, i * 700));
  }
  function afterEvent(delta) { bumpXp(delta); celebrate(checkUnlocks()); refreshBadge(); }

  // ---- 事件钩子（literature.js 调用）----
  function onAnnotation() { afterEvent(XP.anno); }
  function onHighlight() { afterEvent(XP.highlight); }
  function onReflection(len) { if (Number(len) >= REFLECT_MIN) afterEvent(XP.reflection); }
  function onRead(file) { const p = paperStatus(file); afterEvent(XP.read + (p.annoN >= DEEP_ANNOS ? XP.deep : 0)); }

  // ---- 奖杯徽章（放工具栏）----
  const badge = h('button', { class: 'ach-badge', title: '阅读成就 · 点开看进度', onclick: openPanel });
  function refreshBadge() {
    const st = stats(); const lv = LEVELS[st.level]; const next = LEVELS[st.level + 1];
    const into = next ? (st.xp - lv.at) / (next.at - lv.at) : 1;
    badge.replaceChildren(h('span', {}, lv.icon), h('b', {}, `Lv.${st.level}`), h('span', { class: 'faint' }, st.streak ? `🔥${st.streak}` : ''), h('span', { class: 'ach-badge__bar' }, h('span', { class: 'ach-badge__fill', style: { width: `${Math.round(into * 100)}%` } })));
  }
  refreshBadge();

  // ---- 强制写心得的弹框（gate 用）----
  function promptReflection(file, { title = '', onDone } = {}) {
    const r = (config.cache && config.cache.research) || {};
    const m = (r.litMeta || {})[file] || {};
    const ta = h('textarea', { placeholder: '这篇讲了什么？最有用 / 最可疑的一点是什么？和你在做的事有什么关系？随便写，写真话。' });
    ta.value = m.note || '';
    const count = h('span', { class: 'ach-reflect__count' }, '');
    const sync = () => { const n = ta.value.trim().length; count.textContent = `${n} / ${REFLECT_MIN} 字`; count.style.color = n >= REFLECT_MIN ? '#bfe6d2' : '#dfa145'; saveBtn.disabled = n < REFLECT_MIN; };
    ta.addEventListener('input', sync);
    const ov = h('div', { class: 'ach-ov', onclick: (e) => { if (e.target === ov) ov.remove(); } });
    const saveBtn = h('button', { class: 'btn btn--primary', onclick: async () => {
      const text = ta.value.trim(); if (text.length < REFLECT_MIN) return;
      const next = (config.get('research.litMeta') || {}); next[file] = { ...(next[file] || {}), note: text };
      await config.set('research.litMeta', next);
      onReflection(text.length);
      ov.remove(); onDone && onDone(text);
    } }, '存下心得');
    ov.append(h('div', { class: 'ach-panel ach-reflect', style: { width: 'min(620px,92vw)' } },
      h('div', { class: 'ach-panel__head' }, h('div', { class: 'ach-panel__kicker' }, '读完这篇 · 写点心得'), h('div', { class: 'ach-panel__lvl-name', style: { fontSize: '18px' } }, title || file), h('button', { class: 'ach-x', onclick: () => ov.remove() }, '×')),
      h('div', { class: 'ach-sec' },
        h('div', { class: 'ach-reflect__hint' }, '懒人规则：想标「已读」，先留下一段心得。哪怕三句话 —— 这一步才是真读进去了。'),
        ta, h('div', { class: 'ach-panel__lvl', style: { justifyContent: 'space-between', marginTop: '8px' } }, count, h('div', {}, h('button', { class: 'btn', onclick: () => ov.remove() }, '再想想'), ' ', saveBtn)))));
    document.body.append(ov); sync(); setTimeout(() => ta.focus(), 30);
  }

  // ---- 成就面板 ----
  function openPanel() {
    const st = stats(); const lv = LEVELS[st.level]; const next = LEVELS[st.level + 1];
    const into = next ? (st.xp - lv.at) / (next.at - lv.at) : 1;
    const s = getState(); const didToday = s.streak?.last === today();
    const ov = h('div', { class: 'ach-ov', onclick: (e) => { if (e.target === ov) ov.remove(); } });
    const tile = (n, label) => h('div', { class: 'ach-stat' }, h('b', {}, String(n)), h('span', {}, label));
    const unlocked = new Set(st.unlocked);
    ov.append(h('div', { class: 'ach-panel' },
      h('div', { class: 'ach-panel__head' },
        h('div', { class: 'ach-panel__kicker' }, 'Reading Achievements · 读论文成就'),
        h('div', { class: 'ach-panel__lvl' }, h('span', { class: 'ach-panel__lvl-icon' }, lv.icon),
          h('div', {}, h('div', { class: 'ach-panel__lvl-name' }, `Lv.${st.level} ${lv.name}`),
            h('div', { class: 'ach-panel__lvl-sub' }, next ? `距「${next.name}」还差 ${next.at - st.xp} 修为` : '已达顶级 · 飞升在即'))),
        h('div', { class: 'ach-xpbar' }, h('div', { class: 'ach-xpbar__fill', style: { width: `${Math.round(into * 100)}%` } })),
        h('button', { class: 'ach-x', onclick: () => ov.remove() }, '×')),
      h('div', { class: 'ach-stats' }, tile(st.reads, '读完'), tile(st.annos, '批注'), tile(st.reflections, '心得'), tile(st.deepReads, '深读'), tile(st.highlights, '重点'), tile(st.streak, '连击(天)'), tile(unlocked.size, '成就'), tile(st.xp, '经验')),
      h('div', { class: `ach-nudge${didToday ? ' is-done' : ''}` }, didToday ? '✓ 今天已经读过了，连击保住了。继续保持。' : '⏰ 今天还没动过论文。随便打开一篇、划个重点，连击就不断。'),
      h('div', { class: 'ach-sec' }, h('h4', {}, `成就徽章 ${unlocked.size}/${ACHIEVEMENTS.length}`),
        h('div', { class: 'ach-grid' }, ...ACHIEVEMENTS.map((a) => h('div', { class: `ach-card${unlocked.has(a.id) ? '' : ' is-locked'}` },
          h('div', { class: 'ach-card__icon' }, unlocked.has(a.id) ? a.icon : '🔒'),
          h('div', {}, h('div', { class: 'ach-card__name' }, a.name), h('div', { class: 'ach-card__desc' }, a.desc))))))));
    document.body.append(ov);
  }

  return { badge, refreshBadge, openPanel, promptReflection, canMarkRead, paperStatus, onAnnotation, onHighlight, onReflection, onRead, REQUIRE_ANNOS, REFLECT_MIN };
}
