'use strict';
/**
 * 论文讲解（科研页「论文讲解」）——宿主侧编排，不进容器（依赖 macOS 的 say / AVFoundation）。
 *
 * 链路：取论文(arXiv) → 调 Claude 强模型写「对话式讲解脚本」(甲主持/乙专家) → 逐句 say 合成中文语音
 *      → papervid 画 B 站风幻灯片 + 合成 mp4。进度通过 emit 往渲染端发。
 * 配音：男女 = Li-mu(男) + Tingting(女)，都是系统自带 zh 嗓；男男需用户另下一个中文男声。
 * 第一版幻灯片走文字（标题 + 字幕），论文配图留作下一步。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const VOICE_SETS = {
  mf: { A: 'Li-mu', B: 'Tingting' },     // 男 + 女（现成）
  mm: { A: 'Li-mu', B: 'Li-mu' },        // 男 + 男（没有第二个中文男声时退化成同一把，提示用户去下载）
  ff: { A: 'Tingting', B: 'Yu-shu' },    // 女 + 女
};

class PaperTalkService {
  constructor({ userDataDir, resourcesDir, resolveClaude, emit } = {}) {
    this.userDataDir = userDataDir || path.join(os.homedir(), '.agent-toolbox');
    this.resourcesDir = resourcesDir || path.join(__dirname, '..', '..', 'resources');
    this.resolveClaude = resolveClaude || (() => null);
    this.emit = typeof emit === 'function' ? emit : () => {};
    this.outDir = path.join(this.userDataDir, 'paper-talk');
    try { fs.mkdirSync(this.outDir, { recursive: true }); } catch { /* */ }
    this._busy = false;
  }

  _progress(stage, text, pct) { this.emit({ type: 'progress', stage, text: text || '', pct: pct == null ? null : pct }); }

  // ---- papervid 二进制：优先随包，缺了就现编到 userData ----
  papervidPath() {
    const bundled = path.join(this.resourcesDir, 'bin', 'papervid');
    try { fs.accessSync(bundled, fs.constants.X_OK); return bundled; } catch { /* */ }
    const built = path.join(this.userDataDir, 'papervid');
    try { fs.accessSync(built, fs.constants.X_OK); return built; } catch { /* */ }
    const src = path.join(__dirname, 'native', 'papervid.swift');
    if (!fs.existsSync(src)) throw new Error('缺少 papervid 源码，无法出片');
    const r = spawnSync('xcrun', ['swiftc', '-O', src, '-o', built], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('papervid 编译失败：' + (r.stderr || '').slice(-300));
    return built;
  }

  // ---- 取论文：arXiv id/链接 → 标题/摘要 + 正文(ar5iv，取不到就只用摘要) ----
  async fetchPaper(input) {
    const id = this._arxivId(input);
    if (!id) throw new Error('暂时只支持 arXiv 链接或编号（如 1706.03762 或 arxiv.org/abs/1706.03762）');
    this._progress('fetch', `拉取 arXiv:${id} …`, 5);
    let title = '', abstract = '', authors = '';
    try {
      const api = await this._get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
      title = (api.match(/<title>([\s\S]*?)<\/title>/g) || [])[1]?.replace(/<\/?title>/g, '').trim() || '';
      abstract = (api.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/\s+/g, ' ').trim() || '';
      authors = (api.match(/<name>([\s\S]*?)<\/name>/g) || []).map((s) => s.replace(/<\/?name>/g, '')).join('、');
    } catch { /* 摘要拉不到也继续 */ }
    let body = '';
    try {
      const html = await this._get(`https://ar5iv.labs.arxiv.org/html/${id}`);
      body = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24000);
    } catch { /* 正文可选 */ }
    if (!title && !abstract && !body) throw new Error('取不到论文内容，确认网络能连 arXiv');
    return { id, title, authors, abstract, body };
  }

  _arxivId(input) {
    const s = String(input || '').trim();
    let m = s.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})(v\d+)?/i);
    if (m) return m[1];
    m = s.match(/^([0-9]{4}\.[0-9]{4,5})(v\d+)?$/);
    if (m) return m[1];
    m = s.match(/([a-z-]+\/[0-9]{7})/i);     // 旧式 id，如 hep-th/9901001
    return m ? m[1] : '';
  }

  _get(url) {
    // Electron 主进程有全局 fetch，走系统代理；纯 node 环境也兼容
    return Promise.resolve().then(() => {
      if (typeof fetch === 'function') return fetch(url, { redirect: 'follow' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
      return new Promise((resolve, reject) => {
        const https = require('node:https');
        https.get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { this._get(res.headers.location).then(resolve, reject); return; }
          if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
          let d = ''; res.setEncoding('utf8'); res.on('data', (c) => (d += c)); res.on('end', () => resolve(d));
        }).on('error', reject);
      });
    });
  }

  // ---- 调 Claude 强模型写对话脚本（订阅通道，剥掉污染 env）----
  async writeScript(paper, cogniGuard) {
    const bin = this.resolveClaude();
    if (!bin) throw new Error('没找到 claude CLI，脚本这步需要它走订阅模型');
    this._progress('script', '让强模型读论文、写对话讲解脚本…', 25);
    const prompt = this._scriptPrompt(paper, cogniGuard);
    const text = await this._claude(bin, prompt);
    const json = this._extractJson(text);
    if (!json || !Array.isArray(json.segments) || !json.segments.length) throw new Error('脚本没解析出有效 JSON（模型可能没按格式输出）');
    // 规范化
    json.segments = json.segments.map((s, i) => ({
      speaker: s.speaker === 'B' || /乙|专家/.test(String(s.speaker || '')) ? 'B' : 'A',
      text: String(s.text || s.say || '').trim(),
      title: String((s.slide && s.slide.title) || s.title || '').trim(),
      subtitle: String((s.slide && (s.slide.subtitle || s.slide.caption)) || s.subtitle || s.text || '').trim(),
    })).filter((s) => s.text);
    return json;
  }

  _scriptPrompt(paper, cg) {
    return [
      '你是在做一期「论文组会式」讲解视频的脚本。两位主播用中文对话：甲是主持人（代观众提问、串场、追问“为什么”），乙是专家（讲清问题、算法怎么工作、实验说明什么）。',
      '要求：口语、像真人聊天；不要照读摘要，要举例、打比方、讲清算法步骤和实验结论；全程中文；总时长约 10–15 分钟，大约 24–36 轮对话。',
      '最后额外加 2–3 轮，固定做「CogniGuard 视角」点评：这篇和下面这个研究的区别、可借鉴点。',
      'CogniGuard 简介：' + (cg && cg.trim() ? cg.trim() : '（用户暂未提供，这几轮就从方法论层面谈“和一个做 agent/LLM 行为可靠性的研究相比有什么异同”）'),
      '',
      '只输出 JSON，不要任何解释、不要 markdown 代码围栏。结构：',
      '{"title":"视频标题","segments":[{"speaker":"A"或"B","text":"这句要念出来的话","slide":{"title":"这段幻灯片大标题(短)","subtitle":"屏幕上显示的要点(≤40字)"}}]}',
      'speaker A=甲(主持) B=乙(专家)。text 是要用 TTS 念出来的口语句子。',
      '',
      '=== 论文信息 ===',
      '标题：' + (paper.title || '(未知)'),
      '作者：' + (paper.authors || '(未知)'),
      '摘要：' + (paper.abstract || '(无)'),
      paper.body ? ('正文节选：' + paper.body) : '',
    ].join('\n');
  }

  // 按 orchestrator 验证过的可用写法：prompt 当参数 + --output-format json（一次性非交互，
  // 不走 stream-json 初始化，避开桥接版 claude 的挂起）；env 剥掉污染变量、PATH 前置 claude 目录，走订阅、不要 key。
  _claude(bin, prompt) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, PATH: `${path.dirname(bin)}:${process.env.PATH || ''}` };
      // 剥掉会覆盖订阅代理的变量；并清掉 HTTP(S)_PROXY —— 订阅端点要直连，走代理会 ECONNREFUSED（实测）
      for (const k of Object.keys(env)) if (/^ANTHROPIC_|^CLAUDE_CODE_|^CLAUDECODE$|^CLAUDE_PID$|^CLAUDE_EFFORT$|^(HTTPS?|ALL)_PROXY$|^(https?|all)_proxy$|^NO_PROXY$|^no_proxy$/.test(k)) delete env[k];
      // 论文讲解走本机 Claude 订阅，不应继承用户给 cc-switch/中转配置的
      // settings.json。该配置可能指向已经停止的 127.0.0.1 端口，表现为
      // ECONNREFUSED；空 setting source 仍保留 CLI 自己的登录态，但跳过
      // user/project/local settings（尤其是 ANTHROPIC_BASE_URL）。
      const args = ['--setting-sources', '', '-p', String(prompt || ''), '--output-format', 'json', '--allowedTools', ''];
      const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      let out = '', err = '';
      const killer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); } }, 8 * 60 * 1000);
      child.stdout.on('data', (c) => (out += c));
      child.stderr.on('data', (c) => (err += c));
      child.on('error', (e) => { clearTimeout(killer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(killer);
        let text = out.trim(); let isErr = false;
        try { const j = JSON.parse(text); isErr = Boolean(j.is_error); text = String(j.result ?? j.text ?? text); } catch { /* 非 json 用原文 */ }
        if (isErr) return reject(new Error('claude 返回错误：' + text.slice(0, 200)));
        if (code === 0 && text) resolve(text);
        else reject(new Error('claude 失败：' + ((err.trim() || '退出码 ' + code)).slice(0, 300)));
      });
    });
  }

  _extractJson(text) {
    let t = String(text || '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
  }

  // ---- 合成：逐句 say → m4a，papervid 画片 → mux mp4 ----
  async synth(script, voiceMode) {
    const voices = VOICE_SETS[voiceMode] || VOICE_SETS.mf;
    const pv = this.papervidPath();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ptalk-'));
    const W = 1280, H = 720;
    const segs = [];
    const total = script.segments.length;
    for (let i = 0; i < total; i++) {
      const s = script.segments[i];
      const voice = voices[s.speaker] || voices.A;
      const aiff = path.join(work, `a${i}.aiff`), m4a = path.join(work, `a${i}.m4a`), png = path.join(work, `s${i}.png`);
      this._progress('synth', `配音 + 画面 ${i + 1}/${total}`, 40 + Math.round((i / total) * 50));
      this._run('say', ['-v', voice, '-o', aiff, s.text]);
      this._run('afconvert', [aiff, m4a, '-d', 'aac', '-f', 'm4af']);
      const speaker = s.speaker === 'B' ? '乙·讲解' : '甲·主持';
      this._run(pv, ['slide', png, String(W), String(H), speaker, s.title || script.title || '', s.subtitle || s.text, '']);
      segs.push({ image: png, audio: m4a });
    }
    this._progress('mux', '合成 mp4 …', 92);
    const manifest = path.join(work, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ w: W, h: H, segments: segs }));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const out = path.join(this.outDir, `${stamp}.mp4`);
    this._run(pv, ['mux', manifest, out]);
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* */ }
    return out;
  }

  _run(cmd, args) {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${path.basename(cmd)} 失败：` + ((r.stderr || r.stdout || '').slice(-200)));
    return r.stdout;
  }

  // ---- 入口 ----
  async run({ input, cogniGuard, voiceMode } = {}) {
    if (this._busy) return { ok: false, error: '正在出片，稍等这条完成' };
    this._busy = true;
    try {
      const paper = await this.fetchPaper(input);
      const script = await this.writeScript(paper, cogniGuard);
      const mp4 = await this.synth(script, voiceMode);
      this._progress('done', '出片完成', 100);
      return { ok: true, mp4, title: script.title || paper.title, segments: script.segments.length };
    } catch (e) {
      this._progress('error', e.message, null);
      return { ok: false, error: e.message };
    } finally {
      this._busy = false;
    }
  }

  // 给渲染端列历史产物
  list() {
    try {
      return fs.readdirSync(this.outDir).filter((f) => f.endsWith('.mp4'))
        .map((f) => ({ name: f, path: path.join(this.outDir, f), at: fs.statSync(path.join(this.outDir, f)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
    } catch { return []; }
  }
}

module.exports = { PaperTalkService, VOICE_SETS };
