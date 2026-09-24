'use strict';

/**
 * 自动科研：把 GitHub 上那几个「AI 自己做研究」的项目接进来。
 *
 * 这里只做四件事：克隆、装环境、按模式起进程（流式日志回渲染层）、列产出。
 * API key 一律不经手 —— 每个项目自己的 .env / yaml 由用户在编辑器里填，
 * 工具箱只负责把文件从模板复制出来、再帮忙打开。
 *
 * 五个项目各自的命令都抄自它们 README（2026-09 读的），改动时对照原仓库。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile, execFileSync } = require('node:child_process');

const HOME = os.homedir();
const MAX_LINES = 600;
const OUTPUT_EXT = /\.(md|json|pdf|tex|txt|html|csv|png)$/i;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', 'venv_agent_lab', '__pycache__', 'cache', 'data', '.cache', 'dist', 'build']);

/** Posix 下 GUI 进程的 PATH 很干净，uv / brew / nvm 装的东西都要自己补进去 */
const PATH_PRELUDE = 'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"';

const PY_VENV = (dir) => `. ${dir}/bin/activate`;

const PROJECTS = [
  {
    id: 'ai-researcher', name: 'AI-Researcher', org: 'HKUDS', badge: 'NeurIPS 2025 Spotlight',
    repo: 'https://github.com/HKUDS/AI-Researcher', dirName: 'AI-Researcher',
    desc: '文献综述 → 出 idea → 设计算法 → 跑实验 → 写稿，一条龙。自带网页界面，综述和找 idea 在网页里选。',
    tags: ['综述', '找 idea', '全流程'],
    needs: [{ cmd: 'uv', label: 'uv' }, { cmd: 'docker', label: 'Docker（跑实验时才要）' }],
    install: 'uv venv --python 3.11 && . .venv/bin/activate && uv pip install -e . && playwright install chromium',
    envCheck: '.venv/bin/python',
    config: { file: '.env', template: '.env.template', hint: '把 OPENROUTER_API_KEY（或别的 LiteLLM 支持的 key）填进去；COMPLETION_MODEL 选你有额度的模型。' },
    outputDirs: ['research_agent/workplace', 'paper_agent', 'cache'],
    modes: [
      { id: 'gui', label: '网页界面', kind: 'web', url: 'http://127.0.0.1:7039',
        script: '. .venv/bin/activate && python web_ai_researcher.py',
        note: '起一个本地网页（Gradio）。综述、找 idea、全流程都在里面点；跑实验那步要 Docker。' },
      { id: 'idea', label: '找 idea（命令行）', kind: 'job',
        fields: [
          { key: 'category', label: '方向', type: 'select', options: ['vq', 'gnn', 'diffu_flow', 'reasoning', 'recommendation'], default: 'vq' },
          { key: 'instance', label: '参考任务（benchmark/final/<方向>/ 下的 json 名）', default: 'one_layer_vq' },
          { key: 'model', label: '模型（LiteLLM 写法）', default: 'openrouter/google/gemini-2.5-pro-preview-05-20' },
        ],
        script: (p) => `. .venv/bin/activate && cd research_agent && python run_infer_idea.py --instance_path ../benchmark/final/${p.category}/${p.instance}.json --container_name paper_eval --model ${p.model} --workplace_name workplace --cache_path cache --port 12372 --max_iter_times 0 --category ${p.category}`,
        note: '按参考论文出新 idea 并实现。要 Docker 起沙箱容器。' },
    ],
  },
  {
    id: 'deepscientist', name: 'DeepScientist', org: 'ResearAI', badge: 'ICLR 2026',
    repo: 'https://github.com/ResearAI/DeepScientist', dirName: 'DeepScientist-workspace',
    desc: '本地优先的「自主研究工作室」：从 baseline 复现、实验轮次到论文产出一直跑，失败路径也留着当资产。国内团队，有中文文档。',
    tags: ['全流程', '长期跑'],
    needs: [{ cmd: 'npm', label: 'Node.js / npm' }, { cmd: 'ds', label: 'ds 命令（装完就有）' }, { cmd: 'codex|claude|opencode|kimi', label: '一个已登录的编码 agent（codex / claude / opencode / kimi）' }],
    workspace: true,   // 不是 clone 仓库，而是 npm 全局装 + 在一个工作目录里起
    install: 'npm install -g @researai/deepscientist && ds --help | head -5',
    envCheck: { cmd: 'ds' },
    config: null,
    outputDirs: ['.'],
    modes: [
      { id: 'doctor', label: '体检', kind: 'job',
        fields: [{ key: 'runner', label: '编码 agent', type: 'select', options: ['claude', 'codex', 'opencode', 'kimi'], default: 'claude' }],
        script: (p) => `ds doctor --runner ${p.runner}`,
        note: '先确认 agent 登录了、环境齐了。' },
      { id: 'studio', label: '打开工作室', kind: 'web', url: 'http://127.0.0.1:20999',
        fields: [{ key: 'runner', label: '编码 agent', type: 'select', options: ['claude', 'codex', 'opencode', 'kimi'], default: 'claude' }],
        script: (p) => `ds --here --runner ${p.runner}`,
        stopScript: 'ds --stop',
        note: '在工作目录里起本地网页工作室，喂一篇论文 / 一个仓库 / 一句研究目标就开始。' },
    ],
  },
  {
    id: 'ai-scientist', name: 'AI Scientist v2', org: 'Sakana AI', badge: '树搜索',
    repo: 'https://github.com/SakanaAI/AI-Scientist-v2', dirName: 'AI-Scientist-v2',
    desc: '最早出名的那个。给一段主题描述，它脑暴 idea 并用 Semantic Scholar 查新；全流程用树搜索跑实验再写论文。',
    tags: ['找 idea', '全流程'],
    needs: [{ cmd: 'python3', label: 'Python 3.11' }, { cmd: 'nvidia-smi', label: 'NVIDIA GPU（只有全流程要）' }],
    install: 'python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt',
    envCheck: '.venv/bin/python',
    config: { file: '.env', template: null, hint: 'OPENAI_API_KEY 或 GEMINI_API_KEY 二选一；S2_API_KEY 可不填（查新会慢）。', seed: '# AI Scientist v2 用到的环境变量，填完保存即可（工具箱启动时会 source 这个文件）\nOPENAI_API_KEY=\nGEMINI_API_KEY=\nS2_API_KEY=\n' },
    outputDirs: ['ai_scientist/ideas', 'experiments'],
    modes: [
      { id: 'idea', label: '找 idea', kind: 'job',
        topic: true,   // 渲染层先写主题 md，再跑
        fields: [
          { key: 'title', label: '主题标题', default: '' },
          { key: 'keywords', label: '关键词（逗号分开）', default: '' },
          { key: 'tldr', label: '一句话', type: 'textarea', default: '' },
          { key: 'abstract', label: '主题描述（越具体 idea 越靠谱）', type: 'textarea', default: '' },
          { key: 'model', label: '模型', default: 'gpt-4o-2024-05-13' },
          { key: 'n', label: '出几个 idea', default: '10' },
          { key: 'reflections', label: '每个打磨几轮', default: '3' },
        ],
        script: (p) => `. .venv/bin/activate && python ai_scientist/perform_ideation_temp_free.py --workshop-file "ai_scientist/ideas/${p.slug}.md" --model ${p.model} --max-num-generations ${p.n} --num-reflections ${p.reflections}`,
        note: '只用模型 API，Mac 上就能跑。产出在 ai_scientist/ideas/<主题>.json。' },
      { id: 'full', label: '全流程', kind: 'job',
        fields: [
          { key: 'ideas', label: 'idea 文件（上一步产出的 json）', default: 'ai_scientist/ideas/my_topic.json' },
          { key: 'writeup', label: '写稿模型', default: 'o1-preview-2024-09-12' },
          { key: 'cite', label: '引用 / 评审模型', default: 'gpt-4o-2024-11-20' },
        ],
        script: (p) => `. .venv/bin/activate && python launch_scientist_bfts.py --load_ideas "${p.ideas}" --add_dataset_ref --model_writeup ${p.writeup} --model_citation ${p.cite} --model_review ${p.cite} --model_agg_plots o3-mini-2025-01-31 --num_cite_rounds 20`,
        note: '要 Linux + NVIDIA GPU，Mac 上跑不动实验。树搜索参数在 bfts_config.yaml。' },
    ],
  },
  {
    id: 'autoresearch', name: 'autoresearch', org: 'Karpathy', badge: '630 行',
    repo: 'https://github.com/karpathy/autoresearch', dirName: 'autoresearch',
    desc: '最小的自动科研闭环：一个小训练底座，让编码 agent 不停改 train.py、跑、看指标、再改。适合学「自动科研到底在干什么」。pyproject 锁的是 CUDA 版 torch，Mac 上装不上，得在有 NVIDIA 卡的 Linux 机器上跑。',
    tags: ['学习', '实验闭环', '要 GPU'],
    needs: [{ cmd: 'uv', label: 'uv' }, { cmd: 'nvidia-smi', label: 'NVIDIA GPU（Linux）' }, { cmd: 'claude|codex', label: '一个编码 agent（Claude Code / Codex）' }],
    install: 'uv sync && uv run prepare.py',
    envCheck: '.venv/bin/python',
    config: null,
    outputDirs: ['.'],
    modes: [
      { id: 'train', label: '手动跑一次实验', kind: 'job', script: 'uv run train.py', note: '约 5 分钟，看一眼指标长什么样。' },
      { id: 'agent', label: '让 agent 接管', kind: 'manual',
        text: '在这个目录里打开 Claude Code（或 Codex），发下面这句，它会照 program.md 里的规则开始自己迭代：\n\nHi have a look at program.md and let\'s kick off a new experiment! let\'s do the setup first.',
        note: '这一步是编码 agent 干的，工具箱帮你复制提示词、打开目录。' },
    ],
  },
  {
    id: 'agent-laboratory', name: 'Agent Laboratory', org: 'Samuel Schmidgall', badge: '协作助理',
    repo: 'https://github.com/SamuelSchmidgall/AgentLaboratory', dirName: 'AgentLaboratory',
    desc: '几个 LLM 当研究助理分工：文献综述 → 定计划 → 写代码跑实验 → 写论文。一份 yaml 配好主题就开跑，支持中文、支持人机协作模式。',
    tags: ['综述', '全流程', '中文'],
    needs: [{ cmd: 'python3', label: 'Python 3.12' }],
    install: 'python3 -m venv venv_agent_lab && . venv_agent_lab/bin/activate && pip install -r requirements.txt',
    envCheck: 'venv_agent_lab/bin/python',
    config: { file: 'experiment_configs/toolbox.yaml', template: 'experiment_configs/MATH_agentlab.yaml', hint: 'api-key 填 OpenAI 的，或者把那行改成 deepseek-api-key；research-topic 写你的题目。' },
    outputDirs: ['research_dir', 'state_saves', '.'],
    modes: [
      { id: 'run', label: '开跑', kind: 'job',
        fields: [{ key: 'yaml', label: '配置文件', default: 'experiment_configs/toolbox.yaml' }],
        script: (p) => `${PY_VENV('venv_agent_lab')} && python ai_lab_repo.py --yaml-location "${p.yaml}"`,
        note: '综述几篇、写几篇、要不要人机协作，都在 yaml 里。' },
    ],
  },
];

function resolveCommand(command) {
  const names = process.platform === 'win32' ? [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command] : [command];
  const dirs = [
    path.join(HOME, '.local', 'bin'), path.join(HOME, '.cargo', 'bin'), '/opt/homebrew/bin', '/usr/local/bin',
    path.join(HOME, '.nvm', 'versions', 'node', 'v22.23.1', 'bin'), path.join(HOME, 'AppData', 'Roaming', 'npm'),
  ];
  for (const dir of dirs) for (const name of names) { const c = path.join(dir, name); if (fs.existsSync(c)) return c; }
  try {
    return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { encoding: 'utf8', timeout: 2000 })
      .split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  } catch { return ''; }
}

/** 'a|b' 表示有一个就行 */
function commandAvailable(spec) {
  return spec.split('|').some((c) => Boolean(resolveCommand(c)));
}

function findWebUrl(text) {
  const m = String(text || '').match(/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?[^\s"'<>]*/);
  return m ? m[0].replace('0.0.0.0', '127.0.0.1') : '';
}

function slugify(text) {
  const s = String(text || '').trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '_').replace(/^_+|_+$/g, '');
  return (s || 'topic').slice(0, 48);
}

/** 主题 md，格式照 ai_scientist/ideas/i_cant_believe_its_not_better.md */
function topicMarkdown({ title, keywords, tldr, abstract }) {
  return `# Title: ${String(title || '').trim()}\n\n## Keywords\n${String(keywords || '').trim()}\n\n## TL;DR\n${String(tldr || '').trim()}\n\n## Abstract\n${String(abstract || '').trim()}\n`;
}

/** 把 AgentLab 的模板 yaml 改成中文 + 你的题目，key 那行原样留着让用户自己填 */
function agentLabYaml(template, { topic, copilot }) {
  let out = String(template || '');
  if (topic) out = out.replace(/^research-topic:.*$/m, `research-topic: ${JSON.stringify(String(topic).trim())}`);
  out = out.replace(/^language:.*$/m, 'language: "中文"');
  out = out.replace(/^copilot-mode:.*$/m, `copilot-mode: ${copilot ? 'True' : 'False'}`);
  return out;
}

function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); return; }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* 已经没了 */ } }
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已退出 */ } }, 4000);
}

class AutoResearchService {
  constructor({ getWindow, codeDir }) {
    this.getWindow = getWindow;
    this.codeDir = codeDir;   // () => ~/Projects 之类
    this.jobs = new Map();    // projectId -> job
    this.installFailed = new Set();   // 上次「装环境」非 0 退出的项目：venv 目录虽然建了，但不能算好
  }

  project(id) { return PROJECTS.find((p) => p.id === id); }
  dirOf(p) { return path.join(this.codeDir(), p.dirName); }

  _win() { const win = this.getWindow?.(); return win && !win.isDestroyed() ? win : null; }
  // 两个事件名写死在这里，接线静态检查（test/wiring.test.js）靠字面量对上 preload
  emitLog(payload) { this._win()?.webContents.send('autoresearch:log', payload); }
  emitState(payload) { this._win()?.webContents.send('autoresearch:state', payload); }

  /** 给渲染层的全量状态：每个项目克隆没、环境好没、配置有没有、依赖命令在不在 */
  status() {
    return {
      codeDir: this.codeDir(),
      platform: process.platform,
      projects: PROJECTS.map((p) => {
        const dir = this.dirOf(p);
        const cloned = fs.existsSync(dir);
        const envReady = !this.installFailed.has(p.id) && (typeof p.envCheck === 'string' ? fs.existsSync(path.join(dir, p.envCheck)) : commandAvailable(p.envCheck.cmd));
        const configReady = p.config ? fs.existsSync(path.join(dir, p.config.file)) : true;
        const job = this.jobs.get(p.id);
        return {
          id: p.id, name: p.name, org: p.org, badge: p.badge, repo: p.repo, desc: p.desc, tags: p.tags, dir, cloned, envReady, configReady,
          workspace: Boolean(p.workspace),
          config: p.config ? { file: p.config.file, hint: p.config.hint } : null,
          needs: p.needs.map((n) => ({ ...n, ok: commandAvailable(n.cmd) })),
          modes: p.modes.map((m) => ({ id: m.id, label: m.label, kind: m.kind, url: m.url || '', fields: m.fields || [], note: m.note || '', text: m.text || '', topic: Boolean(m.topic) })),
          job: job ? this._jobView(job) : null,
        };
      }),
    };
  }

  _jobView(job) {
    return { projectId: job.projectId, modeId: job.modeId, label: job.label, status: job.status, code: job.code, url: job.url, startedAt: job.startedAt, lines: job.lines.slice(-MAX_LINES) };
  }

  /** 克隆或建工作目录。DeepScientist 不是 clone，只建目录。 */
  async prepare(id) {
    const p = this.project(id);
    if (!p) return { ok: false, error: '没有这个项目' };
    const dir = this.dirOf(p);
    if (fs.existsSync(dir)) return { ok: true, path: dir, existed: true };
    fs.mkdirSync(this.codeDir(), { recursive: true });
    if (p.workspace) { fs.mkdirSync(dir, { recursive: true }); return { ok: true, path: dir, existed: false }; }
    return new Promise((resolve) => {
      execFile(resolveCommand('git') || 'git', ['clone', '--depth', '1', p.repo, dir], { timeout: 300000 }, (err, _out, stderr) => {
        if (err) return resolve({ ok: false, error: `克隆失败：${String(stderr || err.message).split('\n').filter(Boolean).pop()?.slice(0, 200)}` });
        resolve({ ok: true, path: dir, existed: false });
      });
    });
  }

  /** 把配置从模板复制出来（已存在就不动），返回路径让渲染层去 openPath */
  ensureConfig(id, options = {}) {
    const p = this.project(id);
    if (!p || !p.config) return { ok: false, error: '这个项目不用配置文件' };
    const dir = this.dirOf(p);
    if (!fs.existsSync(dir)) return { ok: false, error: '先把代码拿下来' };
    const target = path.join(dir, p.config.file);
    if (!fs.existsSync(target) || options.overwrite) {
      let content = p.config.seed || '';
      if (p.config.template) {
        const tpl = path.join(dir, p.config.template);
        if (!fs.existsSync(tpl)) return { ok: false, error: `仓库里没有模板 ${p.config.template}` };
        content = fs.readFileSync(tpl, 'utf8');
        if (id === 'agent-laboratory') content = agentLabYaml(content, options);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
    }
    return { ok: true, path: target, created: true };
  }

  /** AI Scientist 的主题 md */
  writeTopic(id, fields) {
    const p = this.project(id);
    if (!p) return { ok: false, error: '没有这个项目' };
    const slug = slugify(fields.title);
    const file = path.join(this.dirOf(p), 'ai_scientist', 'ideas', `${slug}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, topicMarkdown(fields), 'utf8');
    return { ok: true, slug, path: file };
  }

  install(id) {
    const p = this.project(id);
    if (!p) return { ok: false, error: '没有这个项目' };
    return this._spawn(p, { id: 'install', label: '装环境', script: p.install, kind: 'job' }, {});
  }

  run(id, modeId, params = {}) {
    const p = this.project(id);
    const mode = p?.modes.find((m) => m.id === modeId);
    if (!p || !mode) return { ok: false, error: '没有这个模式' };
    if (mode.kind === 'manual') return { ok: false, error: '这一步要在编码 agent 里做' };
    const filled = {};
    for (const f of mode.fields || []) filled[f.key] = String(params[f.key] ?? f.default ?? '').trim();
    if (mode.topic) {
      if (!filled.title) return { ok: false, error: '先写主题标题' };
      const wrote = this.writeTopic(id, filled);
      filled.slug = wrote.slug;
    }
    // 参数只允许进 shell 的安全字符：路径、模型名、数字。别的直接拒，不然就是命令注入
    for (const [k, v] of Object.entries(filled)) {
      if (['title', 'keywords', 'tldr', 'abstract'].includes(k)) continue;
      if (/[;&|`$<>\\]/.test(v)) return { ok: false, error: `「${k}」里有 shell 不允许的字符` };
    }
    const script = typeof mode.script === 'function' ? mode.script(filled) : mode.script;
    return this._spawn(p, mode, filled, script);
  }

  _spawn(p, mode, params, script = mode.script) {
    if (this.jobs.get(p.id)?.status === 'running') return { ok: false, error: '这个项目已经有一个任务在跑，先停掉' };
    const dir = this.dirOf(p);
    if (!fs.existsSync(dir)) return { ok: false, error: '先把代码拿下来' };
    const bash = resolveCommand('bash');
    if (!bash) return { ok: false, error: '找不到 bash（Windows 请装 Git Bash）' };
    const full = `${PATH_PRELUDE}\nset -a; [ -f .env ] && . ./.env; set +a\ncd ${JSON.stringify(dir)}\nexport PYTHONUNBUFFERED=1\n${script}`;
    const child = spawn(bash, ['-lc', full], { cwd: dir, env: { ...process.env, TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const job = { projectId: p.id, modeId: mode.id, label: mode.label, status: 'running', code: null, url: '', startedAt: Date.now(), lines: [], child, stopScript: mode.stopScript || '' };
    this.jobs.set(p.id, job);
    const push = (chunk) => {
      const text = String(chunk).replace(/\r/g, '\n');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        job.lines.push(line);
        if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
        if (!job.url && mode.kind === 'web') { const url = findWebUrl(line); if (url) job.url = url; }
        this.emitLog({ projectId: p.id, line, url: job.url });
      }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (err) => { push(`[工具箱] 起不来：${err.message}`); });
    child.on('exit', (code) => {
      job.status = 'exited'; job.code = code; job.child = null;
      if (mode.id === 'install') { if (code === 0) this.installFailed.delete(p.id); else this.installFailed.add(p.id); }
      // 有的网页服务不打印地址，退出前没拿到就按模式里写死的
      this.emitState({ projectId: p.id, status: 'exited', code });
    });
    // web 模式：日志里没打印地址的（gradio 有时只打 0.0.0.0），几秒后按预设地址探一下
    if (mode.kind === 'web' && mode.url) {
      setTimeout(() => { if (job.status === 'running' && !job.url) { job.url = mode.url; this.emitLog({ projectId: p.id, line: `[工具箱] 按预设地址打开：${mode.url}`, url: job.url }); } }, 6000);
    }
    this.emitState({ projectId: p.id, status: 'running', label: mode.label });
    return { ok: true, job: this._jobView(job) };
  }

  stop(id) {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') return { ok: true, idle: true };
    killTree(job.child);
    const p = this.project(id);
    if (job.stopScript && p) {
      const bash = resolveCommand('bash');
      if (bash) execFile(bash, ['-lc', `${PATH_PRELUDE}\ncd ${JSON.stringify(this.dirOf(p))}\n${job.stopScript}`], { timeout: 15000 }, () => {});
    }
    return { ok: true };
  }

  stopAll() { for (const id of this.jobs.keys()) this.stop(id); }

  /** 最近改动的产出文件：按项目声明的目录，找不到就整个仓库浅扫 */
  outputs(id) {
    const p = this.project(id);
    if (!p) return { ok: false, error: '没有这个项目' };
    const root = this.dirOf(p);
    if (!fs.existsSync(root)) return { ok: true, files: [] };
    const files = [];
    const walk = (dir, depth) => {
      if (depth < 0 || files.length > 400) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, depth - 1);
        else if (OUTPUT_EXT.test(e.name)) {
          try { const st = fs.statSync(full); files.push({ path: full, rel: path.relative(root, full), size: st.size, mtime: st.mtimeMs }); } catch { /* 读不了就跳过 */ }
        }
      }
    };
    for (const sub of p.outputDirs) { const d = path.join(root, sub); if (fs.existsSync(d)) walk(d, sub === '.' ? 1 : 3); }
    files.sort((a, b) => b.mtime - a.mtime);
    return { ok: true, files: files.slice(0, 40) };
  }

  readOutput(file) {
    const target = String(file || '');
    if (!target.startsWith(this.codeDir())) return { ok: false, error: '只读项目目录里的文件' };
    if (!/\.(md|json|txt|tex|csv|html)$/i.test(target)) return { ok: false, error: '这种文件用系统程序打开' };
    try {
      const st = fs.statSync(target);
      if (st.size > 400 * 1024) return { ok: false, error: '文件太大，用系统程序打开' };
      return { ok: true, text: fs.readFileSync(target, 'utf8'), ext: path.extname(target).slice(1).toLowerCase() };
    } catch (err) { return { ok: false, error: err.message }; }
  }
}

module.exports = { AutoResearchService, PROJECTS, findWebUrl, slugify, topicMarkdown, agentLabYaml, commandAvailable };
