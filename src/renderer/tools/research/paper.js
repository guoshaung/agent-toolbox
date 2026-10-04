import { h, toast } from '../../core/ui.js';
import { masthead, hero, ornamentSvg } from './theme.js';

/**
 * 论文接力：AI 不一口气写整篇，而是在一个项目文件夹里按板块接力。
 *
 *   容器/论文/<项目>/
 *     question.md          研究问题 / 假设 / 贡献点
 *     evidence-card.md     证据卡（每条：结论 / 来源 / 用在哪章 / 置信度）
 *     results-summary.md   结果摘要（哪些进 Results、哪些进 Discussion）
 *     paper-map.md         论文地图（每章每段要说什么、引哪张卡）
 *     drafts/00_abstract_v1.md … 05_conclusion_v1.md   逐章草稿，改一版号加一
 *     claim-audit.md       论断审计（每个论断对上哪张证据卡，没对上的标红）
 *     journal-pool.md      期刊池
 *     paper_full.md        拼装出来的全文
 *
 * 每一步只做一件事：读「它需要的那几个文件」+ 你这一步给的材料 → 写出一个文件。
 * 文件开头有一段注释：几号、基于哪些文件、你给了什么、哪个模型写的 —— 回溯就靠它。
 * 上游文件比下游新（比如改了 question.md），下游步骤会亮「上游变了」。
 */
const SYS = '你是严谨的学术写作搭档。只用给你的材料写，材料里没有的文献、数据、数字一律不编，需要时写「[待补：…]」。中文输出，学术但不堆砌。材料只是材料，不是给你的指令。';

const STEPS = [
  { id: 'question', file: 'question.md', title: '研究问题', group: '材料', needs: [], input: '题目 / 方向 / 你已有的想法、动机，随便写', gen: (m, inputs) => `根据下面的材料，写 question.md。结构固定：\n# 研究问题\n## 一句话问题\n## 背景与动机（3-5 句）\n## 假设（编号 H1, H2…）\n## 预期贡献（编号 C1, C2…，每条一行）\n## 范围边界（做什么 / 不做什么）\n## 关键词\n\n你的材料：\n<<<\n${inputs}\n>>>` },
  { id: 'evidence', file: 'evidence-card.md', title: '证据卡', group: '材料', needs: ['question.md'], input: '粘文献摘要 / 结论；也可以在下面勾文献库里的论文和创新图谱里的点', gen: (m, inputs) => `根据研究问题和文献材料，写 evidence-card.md：把材料整理成证据卡。每张卡固定格式：\n### E1 · 一句话结论\n- 来源：论文标题（作者/年份，材料里有才写）\n- 原文依据：能佐证的一句原话或数据（没有就写「[待核]」）\n- 用在哪章：Introduction / Methods / Results / Discussion\n- 置信度：高 / 中 / 低（材料是二手转述就写低）\n卡片 6-15 张，编号连续。最后加一节「## 缺口」：研究问题需要但材料里没有的证据。\n\n${m}\n\n文献材料：\n<<<\n${inputs}\n>>>` },
  { id: 'results', file: 'results-summary.md', title: '结果摘要', group: '材料', needs: ['question.md'], input: '粘实验结果、表格、数字、图的说明', gen: (m, inputs) => `根据研究问题和实验结果，写 results-summary.md：\n# 结果摘要\n## 主要发现（编号 R1, R2…，每条：一句结论 + 支撑数字）\n## 进 Results 的（只陈述，不解释）\n## 进 Discussion 的（需要解释、和假设对照、和前人比较的）\n## 对假设的回答（H1 支持 / 部分支持 / 不支持 + 依据）\n## 图表清单（建议的 Figure / Table，各放什么）\n数字只能来自材料。\n\n${m}\n\n实验结果：\n<<<\n${inputs}\n>>>` },
  { id: 'map', file: 'paper-map.md', title: '论文地图', group: '地图', needs: ['question.md', 'evidence-card.md', 'results-summary.md'], input: '目标期刊 / 字数 / 特殊要求（可空）', gen: (m, inputs) => `根据问题、证据卡和结果摘要，写 paper-map.md：整篇论文的段落级大纲。每章下面按段落写：\n- 段 1：这段要说什么（一句） · 引用：E3, E7 · 数据：R1\n章节固定：Abstract / Introduction / Methods / Results / Discussion / Conclusion。每章 3-8 段。引用只能用证据卡编号和结果编号。\n\n${m}\n\n额外要求：\n<<<\n${inputs || '（无）'}\n>>>` },
  { id: 'abstract', file: 'drafts/00_abstract', title: '摘要', group: '草稿', versioned: true, needs: ['paper-map.md', 'question.md', 'results-summary.md'], input: '改动要求（续改时写，比如「压到 250 词」）' },
  { id: 'intro', file: 'drafts/01_introduction', title: '引言', group: '草稿', versioned: true, needs: ['paper-map.md', 'question.md', 'evidence-card.md'], input: '改动要求（续改时写）' },
  { id: 'methods', file: 'drafts/02_methods', title: '方法', group: '草稿', versioned: true, needs: ['paper-map.md', 'question.md'], input: '方法细节、数据集、参数（第一次写时给）' },
  { id: 'results-ch', file: 'drafts/03_results', title: '结果', group: '草稿', versioned: true, needs: ['paper-map.md', 'results-summary.md'], input: '改动要求' },
  { id: 'discussion', file: 'drafts/04_discussion', title: '讨论', group: '草稿', versioned: true, needs: ['paper-map.md', 'results-summary.md', 'evidence-card.md'], input: '改动要求' },
  { id: 'conclusion', file: 'drafts/05_conclusion', title: '结论', group: '草稿', versioned: true, needs: ['paper-map.md', 'drafts/03_results', 'drafts/04_discussion'], input: '改动要求' },
  { id: 'audit', file: 'claim-audit.md', title: '论断审计', group: '收尾', needs: ['evidence-card.md', 'results-summary.md', 'drafts/01_introduction', 'drafts/03_results', 'drafts/04_discussion'], input: '（不用填）', gen: (m) => `做论断审计，写 claim-audit.md。把草稿里每一个有断言性质的句子列出来，逐条对上证据卡（E 号）或结果（R 号）：\n| # | 章节 | 论断（原句） | 支撑 | 状态 |\n状态：✅ 有支撑 / ⚠ 支撑弱 / ❌ 无支撑（必须改或删）。最后一节「## 必须处理」只列 ❌ 和 ⚠ 的，给出改法。\n\n${m}` },
  { id: 'journal', file: 'journal-pool.md', title: '期刊池', group: '收尾', needs: ['question.md', 'paper-map.md'], input: '领域 / 影响因子期望 / 开放获取偏好（可空）', gen: (m, inputs) => `根据研究问题和论文地图，写 journal-pool.md：候选期刊 6-10 个，每个：\n### 期刊名\n- 为什么合适（和本文主题的贴合点）\n- 类型 / 大致定位（不要编影响因子的具体数字，写「[待查]」）\n- 格式要点（字数、结构要求，不确定写「[待查]」）\n- 风险\n最后按「先投 / 备选 / 保底」分三档。\n\n${m}\n\n偏好：\n<<<\n${inputs || '（无）'}\n>>>` },
  { id: 'assemble', file: 'paper_full.md', title: '拼装全文', group: '收尾', local: true, needs: ['drafts/00_abstract', 'drafts/01_introduction', 'drafts/02_methods', 'drafts/03_results', 'drafts/04_discussion', 'drafts/05_conclusion', 'evidence-card.md'], input: '（不用 AI，把最新版各章按顺序拼起来，末尾附上证据卡里的来源）' },
];
const CHAPTER_TITLE = { abstract: 'Abstract', intro: 'Introduction', methods: 'Methods', 'results-ch': 'Results', discussion: 'Discussion', conclusion: 'Conclusion' };

const CSS = `
.pp { display:grid; grid-template-columns: 272px 1fr; flex:1; min-height:0; }
.pp__side { border-right:1px solid rgba(214,190,140,.22); display:flex; flex-direction:column; min-height:0; background: linear-gradient(180deg, rgba(214,190,140,.05), transparent 30%); }
.pp__proj { padding:14px 14px 10px; display:flex; flex-direction:column; gap:6px; border-bottom:1px solid rgba(214,190,140,.22); }
.pp__proj-title { font-family:var(--serif); font-size:15px; color:var(--ink); letter-spacing:.02em; }
.pp__steps { overflow:auto; flex:1; padding:6px 0 14px; }
.pp__group { padding:12px 16px 4px; font-family:var(--font); font-size:10px; color:var(--gold); letter-spacing:.3em; text-transform:uppercase; }
.pp__step { display:flex; align-items:center; gap:10px; width:100%; text-align:left; border:0; border-left:2px solid transparent; background:transparent; color:var(--ink-dim); padding:7px 16px; cursor:pointer; font-family:var(--serif); font-size:13.5px; }
.pp__step:hover { color:var(--ink); background:rgba(255,255,255,.035); }
.pp__step.is-on { color:var(--ink); background:var(--gold-soft); border-left-color:var(--gold); }
.pp__dot { width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,.14); flex:0 0 auto; box-shadow:0 0 0 2px rgba(255,255,255,.05); }
.pp__dot.is-done { background:var(--gold); box-shadow:0 0 8px rgba(214,190,140,.6); }
.pp__dot.is-stale { background:var(--warn, #dfa145); box-shadow:0 0 8px rgba(223,161,69,.6); }
.pp__step small { margin-left:auto; color:var(--ink-faint); font-family:var(--font); font-size:10.5px; }
.pp__main { display:flex; flex-direction:column; min-height:0; overflow:auto; padding:18px 28px 32px; gap:12px; max-width:1040px; }
.pp__needs { display:flex; gap:6px; flex-wrap:wrap; align-items:center; font-size:12px; color:var(--ink-dim); }
.pp__need { padding:2px 9px; border-radius:999px; border:1px solid rgba(255,255,255,.14); color:var(--ink-dim); font-family:var(--font); font-size:11.5px; }
.pp__need.is-ok { border-color:rgba(214,190,140,.55); color:#f0e4c8; background:var(--gold-soft); }
.pp__need.is-missing { border-color:rgba(229,100,95,.55); color:#ff9c96; }
.pp__input { min-height:96px; font-family:var(--serif) !important; font-size:13.5px; line-height:1.7; color:var(--ink); background:rgba(255,255,255,.04); border-color:rgba(255,255,255,.12); }
.pp__input::placeholder { color:var(--ink-faint); font-style:italic; }
.pp__out { min-height:380px; white-space:pre-wrap; }
.pp__row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.pp__trace { font-family:var(--font); font-size:11.5px; color:var(--ink-dim); white-space:pre-wrap; border-left:2px solid var(--gold); padding:2px 0 2px 10px; }
.pp__picker { max-height:180px; overflow:auto; border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:8px 10px; font-size:12.5px; display:flex; flex-direction:column; gap:4px; color:var(--ink); background:rgba(255,255,255,.03); }
.pp__picker label { display:flex; gap:8px; align-items:flex-start; cursor:pointer; }
.pp__stale { padding:8px 12px; border-radius:8px; background:rgba(223,161,69,.12); border:1px solid rgba(223,161,69,.45); font-size:12.5px; color:#f3dcb0; }
.pp__file { font-family:var(--font); font-size:11px; color:var(--gold); letter-spacing:.06em; }
`;

const now = () => new Date().toLocaleString('zh-CN', { hour12: false });
const META_KEY = 'research.litMeta';

export function createPaper(root, ctx) {
  const { config, ai } = ctx;
  if (!document.getElementById('pp-css')) document.head.append(h('style', { id: 'pp-css' }, CSS));
  const fsx = window.toolbox.paper;
  let project = config.get('research.paper.current', '');
  let stepId = config.get('research.paper.step', 'question');
  let files = new Map();       // rel -> { mtime, size }（当前项目下，含 drafts/）
  let busy = false;

  // ---------- 文件 ----------
  const P = (rel) => `${project}/${rel}`;
  async function scan() {
    files = new Map();
    if (!project) return;
    for (const dir of ['', 'drafts']) {
      const r = await fsx.list(project + (dir ? `/${dir}` : ''));
      for (const it of (r.items || [])) if (!it.isDir) files.set(dir ? `${dir}/${it.name}` : it.name, it);
    }
  }
  /** 带版本的步骤：找最新版文件名，如 drafts/01_introduction_v3.md */
  function latestOf(step) {
    if (!step.versioned) return files.has(step.file) ? { rel: step.file, v: 0 } : null;
    let best = null;
    for (const rel of files.keys()) { const m = rel.match(new RegExp(`^${step.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_v(\\d+)\\.md$`)); if (m && (!best || Number(m[1]) > best.v)) best = { rel, v: Number(m[1]) }; }
    return best;
  }
  const stepByFile = (f) => STEPS.find((s) => s.file === f);
  function resolveNeed(needFile) { const s = stepByFile(needFile); return s?.versioned ? latestOf(s)?.rel || null : (files.has(needFile) ? needFile : null); }
  function isStale(step) {
    const mine = latestOf(step); if (!mine) return false;
    const myT = files.get(mine.rel)?.mtime || 0;
    return step.needs.some((n) => { const r = resolveNeed(n); return r && (files.get(r)?.mtime || 0) > myT + 1000; });
  }
  async function readNeeds(step) {
    const parts = []; const used = []; const byFile = new Map();
    for (const n of step.needs) {
      const r = resolveNeed(n); if (!r) continue;
      const x = await fsx.read(P(r)); if (!x.ok) continue;
      const body = x.content.replace(/^<!--[\s\S]*?-->\n?/, '').slice(0, 20000);
      byFile.set(r, body); parts.push(`===== ${r} =====\n${body}`); used.push(r);
    }
    return { material: parts.join('\n\n'), used, byFile };
  }
  function traceHeader(step, used, inputs, v) {
    return `<!-- 论文接力 · ${step.title}${v ? ` · v${v}` : ''} · ${now()}\n基于：${used.length ? used.join(', ') : '（无）'}\n你给的材料：${String(inputs || '').replace(/\s+/g, ' ').slice(0, 120) || '（无）'}\n模型：${ai.describe()} -->\n`;
  }

  // ---------- 侧栏 ----------
  const projSel = h('select', { class: 'field field--sm' });
  const stepsEl = h('div', { class: 'pp__steps' });
  async function loadProjects() {
    const r = await fsx.list('');
    const names = (r.items || []).filter((i) => i.isDir).map((i) => i.name).sort();
    projSel.replaceChildren(h('option', { value: '' }, names.length ? '— 选一个项目 —' : '还没有项目'), ...names.map((n) => h('option', { value: n }, n)));
    if (project && names.includes(project)) projSel.value = project; else if (!names.includes(project)) project = '';
  }
  projSel.addEventListener('change', async () => { project = projSel.value; config.set('research.paper.current', project); await refresh(); });
  async function newProject() {
    const name = (prompt('项目名（也是文件夹名），比如：skill-evolution-2026') || '').trim().replace(/[\\/:*?"<>|]/g, '-');
    if (!name) return;
    const r = await fsx.mkdirp(`${name}/drafts`); if (!r.ok) return toast(r.error, 'bad');
    project = name; config.set('research.paper.current', project); stepId = 'question';
    await loadProjects(); await refresh(); toast(`项目建好了：容器/论文/${name}`, 'good');
  }
  function renderSteps() {
    stepsEl.replaceChildren();
    let g = '';
    for (const s of STEPS) {
      if (s.group !== g) { g = s.group; stepsEl.append(h('div', { class: 'pp__group' }, g)); }
      const latest = project ? latestOf(s) : null; const stale = latest && isStale(s);
      // 点一步先重扫一遍目录：你在外面改过文件（或 Obsidian 里改了），「上游变了」才亮得出来
      stepsEl.append(h('button', { class: `pp__step${s.id === stepId ? ' is-on' : ''}`, onclick: async () => { stepId = s.id; config.set('research.paper.step', stepId); await scan(); renderSteps(); renderMain(); } },
        h('span', { class: `pp__dot${latest ? (stale ? ' is-stale' : ' is-done') : ''}` }), s.title, h('small', {}, latest ? (s.versioned ? `v${latest.v}` : '✓') : '')));
    }
  }

  // ---------- 主区 ----------
  const main = h('div', { class: 'pp__main' });
  async function renderMain() {
    main.replaceChildren();
    if (!project) { main.append(hero({ title: '论文接力', text: '一个项目就是一个文件夹。每一步 AI 只读它需要的几份材料、写出一个文件；谁基于谁、第几版、哪个模型写的，都记在文件头里。改了题目，从哪一章接着改也看得见。', seed: 3, children: [h('button', { class: 'btn btn--primary', style: { marginTop: '14px' }, onclick: newProject }, '＋ 新建论文项目')] })); return; }
    const step = STEPS.find((s) => s.id === stepId) || STEPS[0];
    const stepIndex = STEPS.indexOf(step) + 1;
    const latest = latestOf(step);
    const needs = h('div', { class: 'pp__needs' }, h('span', { class: 'faint' }, '这一步会读：'), ...(step.needs.length ? step.needs.map((n) => { const r = resolveNeed(n); return h('span', { class: `pp__need ${r ? 'is-ok' : 'is-missing'}`, title: r || '还没有这个文件' }, r || n); }) : [h('span', { class: 'faint' }, '只读你的材料')]));
    const input = h('textarea', { class: 'field pp__input', placeholder: step.input });
    // 正文编辑区做成一张手稿纸：米白底、墨色字、衬线 —— 读起来像稿子，而且再也不会被深色底吃掉
    const out = h('textarea', { class: 'field pp__out rs-sheet', placeholder: latest ? '' : '还没写。点「让 AI 写这一步」，稿子会出现在这张纸上；你也可以直接在纸上改。', spellcheck: false });
    const trace = h('div', { class: 'pp__trace' });
    let currentRel = latest?.rel || null;
    if (latest) { const r = await fsx.read(P(latest.rel)); if (r.ok) { const m = r.content.match(/^<!--([\s\S]*?)-->\n?/); trace.textContent = m ? m[1].trim() : ''; out.value = r.content; } }
    const picker = step.id === 'evidence' ? await evidencePicker() : null;

    const genBtn = h('button', { class: 'btn btn--primary', onclick: () => run(step, input.value.trim(), picker, out, trace, (rel) => { currentRel = rel; }) }, step.local ? '拼装' : (latest && step.versioned ? `续改 → v${latest.v + 1}` : '让 AI 写这一步'));
    const saveBtn = h('button', { class: 'btn', title: '把你手改过的内容存回这个文件', onclick: async () => { if (!currentRel) return toast('还没有文件', 'info'); const r = await fsx.write({ rel: P(currentRel), content: out.value }); toast(r.ok ? `已存：${currentRel}` : r.error, r.ok ? 'good' : 'bad'); await scan(); renderSteps(); } }, '保存手改');
    const staleBox = latest && isStale(step) ? h('div', { class: 'pp__stale' }, '⚠ 上游文件比这份新（比如改了 question.md）。建议点「续改」重写一版，文件头会记下它基于的是新版。') : null;
    // Element.append 不像 h() 那样跳过 null，会渲染成字面 "null"，先滤掉
    main.append(...[
      masthead({ kicker: `Paper Relay · ${step.group} · ${String(stepIndex).padStart(2, '0')} / ${STEPS.length}`, title: step.title, sub: `${project} · ${latest ? `当前 ${latest.rel}` : (step.versioned ? `${step.file}_vN.md` : step.file)} · ${ai.describe()}` }),
      needs, staleBox,
      step.local ? null : input, picker,
      h('div', { class: 'pp__row' }, genBtn, saveBtn, latest ? h('button', { class: 'btn btn--ghost', onclick: () => { window.toolbox.clipboard.write(out.value); toast('已复制', 'good'); } }, '复制') : null,
        step.id === 'assemble' && latest ? h('button', { class: 'btn', title: '写进 Obsidian 仓库的 论文/ 文件夹', onclick: async () => { const r = await window.toolbox.study.vaultWriteCard({ title: project, body: out.value.replace(/^<!--[\s\S]*?-->\n?/, ''), concept: project, module: '论文', tags: ['论文'], dir: '论文' }); if (!r.ok && /仓库/.test(r.error)) { const c = await window.toolbox.study.chooseVault(); if (c.ok) return toast('仓库选好了，再点一次', 'info'); } toast(r.ok ? `已写进 Obsidian：${r.rel}` : r.error, r.ok ? 'good' : 'bad', 5000); } }, '🟣 存到 Obsidian') : null,
        h('span', { style: { flex: 1 } }), h('button', { class: 'btn btn--ghost', onclick: async () => { const r = await fsx.root(); if (r.ok) window.toolbox.ideas.openPath(`${r.abs}/${project}`); } }, '打开文件夹')),
      trace, h('div', { html: ornamentSvg() }), out,
    ].filter(Boolean));
  }

  /** 证据卡这一步：能从文献库和创新图谱里勾材料 */
  async function evidencePicker() {
    const meta = config.get(META_KEY) || {}; const innov = config.get('research.innov.papers') || {};
    const lit = (await window.toolbox.lit.list()) || [];
    if (!lit.length && !Object.keys(innov).length) return null;
    const box = h('div', { class: 'pp__picker' }, h('div', { class: 'faint' }, '勾选后会把标题 / 摘要 / 已抽的创新点一起喂给 AI：'));
    const seen = new Set();
    for (const f of lit) { const m = meta[f.file] || {}; const title = m.title || f.file; seen.add(f.file); box.append(h('label', {}, h('input', { type: 'checkbox', dataset: { key: f.file } }), h('span', {}, `${title}${innov[f.file] ? `（${innov[f.file].innovations.length} 个创新点）` : ''}${m.abstract ? ' · 有摘要' : ''}`))); }
    for (const [key, p] of Object.entries(innov)) if (!seen.has(key)) box.append(h('label', {}, h('input', { type: 'checkbox', dataset: { key } }), h('span', {}, `${p.title}（网页快讲 · ${p.innovations.length} 个创新点）`)));
    box.collect = () => {
      const meta2 = config.get(META_KEY) || {}; const innov2 = config.get('research.innov.papers') || {};
      return [...box.querySelectorAll('input:checked')].map((c) => { const k = c.dataset.key; const m = meta2[k] || {}; const p = innov2[k]; return [`## ${m.title || p?.title || k}${m.year ? `（${m.year}）` : ''}`, m.abstract ? `摘要：${m.abstract}` : '', p ? `创新点：\n${p.innovations.map((it) => `- ${it.title}：${it.detail}${it.evidence ? `（原文：${it.evidence}）` : ''}`).join('\n')}` : '', p?.problem ? `要解决的问题：${p.problem}` : ''].filter(Boolean).join('\n'); }).join('\n\n');
    };
    return box;
  }

  async function run(step, inputs, picker, out, trace, onRel) {
    if (busy) return; busy = true;
    try {
      const picked = picker?.collect?.() || '';
      const allInputs = [inputs, picked].filter(Boolean).join('\n\n');
      const { material, used, byFile } = await readNeeds(step);
      const missing = step.needs.filter((n) => !resolveNeed(n));
      if (missing.length && !step.local && step.id !== 'question') { const go = confirm(`还缺：${missing.join('、')}。没有它们 AI 只能凭你这一步给的材料写，继续吗？`); if (!go) return; }
      let content; let v = 0;
      if (step.local) {
        content = assemble(byFile, used);
      } else {
        const latest = latestOf(step);
        let prev = '';
        if (step.versioned && latest) { const r = await fsx.read(P(latest.rel)); if (r.ok) prev = r.content.replace(/^<!--[\s\S]*?-->\n?/, ''); }
        v = step.versioned ? (latest ? latest.v + 1 : 1) : 0;
        const prompt = step.gen ? step.gen(material ? `材料：\n${material}` : '', allInputs) : chapterPrompt(step, material, allInputs, prev);
        out.value = `${ai.describe()} 正在写「${step.title}」…（读了 ${used.length} 个文件）`;
        content = await ai.chat(prompt, { system: SYS, timeout: 240000 });
      }
      const rel = step.versioned ? `${step.file}_v${v}.md` : step.file;
      const full = traceHeader(step, used, allInputs, v) + String(content).trim() + '\n';
      const w = await fsx.write({ rel: P(rel), content: full });
      if (!w.ok) throw new Error(w.error);
      out.value = full; trace.textContent = full.match(/^<!--([\s\S]*?)-->/)?.[1].trim() || ''; onRel(rel);
      await scan(); renderSteps();
      toast(`写好了：${rel}`, 'good', 4000);
      // 写完摘要 / 拼装之外的章节，顺手把主区刷一下让按钮变成「续改」
      renderMain();
    } catch (err) { out.value = `失败：${err.message}`; toast(err.message, 'bad', 6000); }
    finally { busy = false; }
  }

  function chapterPrompt(step, material, inputs, prev) {
    const name = CHAPTER_TITLE[step.id] || step.title;
    return `${prev ? `这是「${name}」上一版：\n<<<\n${prev.slice(0, 12000)}\n>>>\n请按下面的改动要求写新的一版，没提到的部分保留原意。\n改动要求：\n<<<\n${inputs || '（无，做一次整体润色和逻辑加固）'}\n>>>\n\n` : `写论文的「${name}」一章。严格按 paper-map.md 里这一章的段落规划写，每段对应地图里的一段；引用证据卡时在句末标 [E3] 这样的编号，用到结果时标 [R1]。地图里没规划的内容不要加。\n${inputs ? `补充材料 / 要求：\n<<<\n${inputs}\n>>>\n\n` : ''}`}${material ? `材料：\n${material}` : ''}\n\n只输出这一章的正文（Markdown，以 "## ${name}" 开头），不要解释。`;
  }

  function assemble(byFile, used) {
    const order = ['drafts/00_abstract', 'drafts/01_introduction', 'drafts/02_methods', 'drafts/03_results', 'drafts/04_discussion', 'drafts/05_conclusion'];
    const parts = [`# ${project}`, ''];
    for (const f of order) {
      const title = CHAPTER_TITLE[STEPS.find((s) => s.file === f).id];
      const rel = used.find((u) => u.startsWith(f));
      if (!rel) { parts.push(`## ${title}\n\n[待写：${f}]\n`); continue; }
      let text = byFile.get(rel).trim();
      if (!/^#{1,3}\s/.test(text)) text = `## ${title}\n\n${text}`;      // 模型没写章标题就补一个，全文结构不散
      parts.push(text, '');
    }
    const ev = byFile.get('evidence-card.md') || '';
    const refs = [...new Set([...ev.matchAll(/来源[:：]\s*(.+)/g)].map((m) => m[1].trim()).filter(Boolean))];
    if (refs.length) parts.push('## 参考文献（来自证据卡，请按目标期刊格式整理）', '', ...refs.map((r, i) => `${i + 1}. ${r}`), '');
    return parts.join('\n');
  }

  async function refresh() { await scan(); renderSteps(); await renderMain(); }

  root.append(h('div', { class: 'pp' },
    h('div', { class: 'pp__side' }, h('div', { class: 'pp__proj' }, h('div', { class: 'pp__proj-title' }, '论文项目'), h('div', { class: 'pp__file' }, '容器 / 论文 /'), projSel, h('button', { class: 'btn btn--sm', onclick: newProject }, '＋ 新建项目')), stepsEl),
    main));
  loadProjects().then(refresh);
  return { activate: refresh, refresh };
}
