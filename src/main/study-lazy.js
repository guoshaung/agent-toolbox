'use strict';
const fs = require('fs');
const path = require('path');
const { buildCompatibleEndpoints } = require('./ai-config');

/**
 * 「懒人学习」的主进程后端。四件事：
 *  1. Obsidian 仓库：列笔记 / 读笔记 / 把学会的卡片写回仓库（和「想法→提问」共用 ideas.vault）
 *  2. vibe 陪练模型：一条独立的弱模型通道（默认本地 Ollama，不填 Key 也能用）——
 *     故意用弱模型，它给不了完整答案，你才真的在写
 *  3. 书架：内嵌网页面板里下载的文件，一律落进 容器/书架
 *  4. 终端选择题：把题库导出成 JSON + 一个可直接跑的 CLI，写个 .command 双击就开考
 */
const CARD_DIR = '学习卡片';
const SHELF = '书架';
const STUDY_DIR = '学习';
const PROJECT_DIR = '学习项目';

const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';

function walkMd(dir, base, out, limit) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (out.length >= limit) return;
    if (ent.name.startsWith('.')) continue;                      // .obsidian / .trash
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) { walkMd(abs, base, out, limit); continue; }
    if (!/\.md$/i.test(ent.name)) continue;
    let st; try { st = fs.statSync(abs); } catch { continue; }
    out.push({ rel: path.relative(base, abs).split(path.sep).join('/'), name: ent.name.replace(/\.md$/i, ''), size: st.size, mtime: st.mtimeMs });
  }
}

function registerStudyLazy(ipcMain, {
  store, readApiKey, performCompatibleRequest, getUserDataPath, containerRoot, hookContainerDownloads, dialog, getMainWindow, shell,
}) {
  // ---- 1) 书架：所有内嵌网页面板的下载都落进 容器/书架 ----
  for (const p of ['persist:webpanel', 'persist:aimodel', 'persist:stickers-maker', 'persist:shelf']) hookContainerDownloads(p, SHELF);
  ipcMain.handle('study:shelfInfo', () => ({ folder: SHELF, root: containerRoot(getUserDataPath) }));

  // ---- 2) Obsidian 仓库 ----
  const vault = () => store.get('ideas.vault', '') || '';
  const insideVault = (rel) => {
    const v = vault(); if (!v) return '';
    const abs = path.resolve(v, String(rel || ''));
    return abs.startsWith(path.resolve(v) + path.sep) || abs === path.resolve(v) ? abs : '';
  };

  ipcMain.handle('study:vaultStatus', () => { const v = vault(); return { vault: v, exists: Boolean(v && fs.existsSync(v)) }; });
  ipcMain.handle('study:chooseVault', async () => {
    const r = await dialog.showOpenDialog(getMainWindow() || undefined, { title: '选你的 Obsidian 仓库文件夹', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    store.set('ideas.vault', r.filePaths[0]);
    return { ok: true, vault: r.filePaths[0] };
  });
  ipcMain.handle('study:vaultNotes', (_e, { sub = '', limit = 400 } = {}) => {
    const v = vault();
    if (!v || !fs.existsSync(v)) return { ok: false, error: '还没选 Obsidian 仓库' };
    const start = sub ? insideVault(sub) : v;
    if (!start) return { ok: false, error: '路径不在仓库里' };
    const out = [];
    walkMd(start, v, out, Math.min(Number(limit) || 400, 2000));
    out.sort((a, b) => b.mtime - a.mtime);
    return { ok: true, notes: out, vault: v };
  });
  ipcMain.handle('study:vaultRead', (_e, rel) => {
    const abs = insideVault(rel);
    if (!abs) return { ok: false, error: '路径不在仓库里' };
    try { return { ok: true, content: fs.readFileSync(abs, 'utf8').slice(0, 60000) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  // dir 可选：默认写进 学习卡片/；创新图谱之类想单独一个文件夹就传一个（只取文件夹名，不许带路径）
  ipcMain.handle('study:vaultWriteCard', (_e, { title, body, tags = [], concept = '', module: mod = '', dir: sub = '' } = {}) => {
    const v = vault();
    if (!v || !fs.existsSync(v)) return { ok: false, error: '还没选 Obsidian 仓库' };
    const dir = path.join(v, safeName(sub) === 'untitled' ? CARD_DIR : safeName(sub));
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { return { ok: false, error: err.message }; }
    const file = path.join(dir, `${safeName(title)}.md`);
    const stamp = new Date();
    const iso = new Date(stamp.getTime() - stamp.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
    const fm = ['---', `title: "${safeName(title).replace(/"/g, "'")}"`, `concept: "${String(concept).replace(/"/g, "'")}"`, `module: "${String(mod).replace(/"/g, "'")}"`, `tags: [${[...new Set([sub ? safeName(sub) : '学习卡片', ...tags])].map((t) => `"${String(t).replace(/"/g, "'")}"`).join(', ')}]`, `learned: ${iso}`, '---', ''].join('\n');
    try { fs.writeFileSync(file, fm + String(body || '') + '\n', 'utf8'); } catch (err) { return { ok: false, error: err.message }; }
    return { ok: true, path: file, rel: path.relative(v, file).split(path.sep).join('/') };
  });
  ipcMain.handle('study:openInObsidian', (_e, rel) => {
    const v = vault(); const abs = insideVault(rel);
    if (!abs) return { ok: false };
    try {
      shell.openExternal(`obsidian://open?vault=${encodeURIComponent(path.basename(v))}&file=${encodeURIComponent(path.relative(v, abs).split(path.sep).join('/'))}`);
      return { ok: true };
    } catch { shell.openPath(abs); return { ok: true, fallback: true }; }
  });

  // ---- 3) vibe 陪练：弱模型通道（默认本地 Ollama；Key 可不填）----
  const vibeConfig = () => ({
    baseUrl: store.get('study.vibe.baseUrl', 'http://localhost:11434/v1'),
    model: store.get('study.vibe.model', 'qwen2.5-coder:1.5b'),
  });
  ipcMain.handle('ai:vibe', async (_e, { messages, temperature = 0.4, timeout = 120000 } = {}) => {
    const { baseUrl, model } = vibeConfig();
    const endpoints = buildCompatibleEndpoints(baseUrl);
    if (!endpoints || !String(model).trim()) return { ok: false, code: 'missing-config', error: 'vibe 陪练模型还没配好：点懒人模式右上角 ⚙，填 Base URL 和模型名（默认本地 Ollama）。' };
    const apiKey = readApiKey('vibe') || 'ollama';          // Ollama 不校验 Key，但 Header 得有东西
    try {
      return await performCompatibleRequest({ endpoint: endpoints.chat, apiKey, model: String(model).trim(), messages, temperature, timeout });
    } catch (err) {
      return { ok: false, code: 'http', error: `陪练模型请求失败：${err.message}。本地 Ollama 的话先确认它在跑（ollama serve）。` };
    }
  });
  ipcMain.handle('ai:vibeModels', async () => {
    const { baseUrl } = vibeConfig();
    const endpoints = buildCompatibleEndpoints(baseUrl);
    if (!endpoints) return { ok: false, error: 'Base URL 不对' };
    try {
      const r = await fetch(endpoints.models, { headers: { Authorization: `Bearer ${readApiKey('vibe') || 'ollama'}` } });
      if (!r.ok) return { ok: false, error: `拉模型列表失败（${r.status}）` };
      const j = await r.json();
      return { ok: true, models: (Array.isArray(j?.data) ? j.data : []).map((m) => String(m?.id || '')).filter(Boolean).sort() };
    } catch (err) { return { ok: false, error: `连不上：${err.message}` }; }
  });

  // ---- 4) 终端选择题：导出题库 + CLI + 双击就跑的启动文件 ----
  ipcMain.handle('study:exportQuiz', (_e, { questions = [], title = '题库' } = {}) => {
    const dir = path.join(containerRoot(getUserDataPath), STUDY_DIR);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { return { ok: false, error: err.message }; }
    const stamp = new Date().toISOString().slice(0, 10);
    const json = path.join(dir, `${safeName(title)}-${stamp}.json`);
    const cli = path.join(dir, 'quiz-cli.mjs');
    try {
      fs.writeFileSync(json, JSON.stringify({ title, exportedAt: Date.now(), questions }, null, 2), 'utf8');
      // CLI 源码打包在 app 里（asar 也读得到），每次导出都同步一份到容器，保证是最新版
      fs.writeFileSync(cli, fs.readFileSync(path.join(__dirname, 'quiz-cli.mjs'), 'utf8'), 'utf8');
      let launcher;
      if (process.platform === 'win32') {
        launcher = path.join(dir, `${safeName(title)}-${stamp}.bat`);
        fs.writeFileSync(launcher, `@echo off\r\nchcp 65001 >nul\r\nnode "%~dp0quiz-cli.mjs" "${json}"\r\npause\r\n`, 'utf8');
      } else {
        launcher = path.join(dir, `${safeName(title)}-${stamp}.command`);
        fs.writeFileSync(launcher, `#!/bin/bash\ncd "$(dirname "$0")"\nnode "./quiz-cli.mjs" "${json}"\n`, 'utf8');
        fs.chmodSync(launcher, 0o755);
      }
      return { ok: true, json, cli, launcher, command: `node "${cli}" "${json}"` };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('study:runQuizInTerminal', async (_e, launcher) => {
    if (!launcher || !fs.existsSync(launcher)) return { ok: false, error: '启动文件不存在' };
    const err = await shell.openPath(launcher);        // mac 的 .command / win 的 .bat 都会在终端里跑
    return err ? { ok: false, error: err } : { ok: true };
  });

  // ---- 5) vibe 做出来的项目落进容器（容器那栏能直接 ▶ 跑）----
  ipcMain.handle('study:saveProject', (_e, { name, files = {} } = {}) => {
    const dir = path.join(containerRoot(getUserDataPath), PROJECT_DIR, safeName(name));
    try {
      fs.mkdirSync(dir, { recursive: true });
      let count = 0;
      for (const [rel, content] of Object.entries(files)) {
        const target = path.resolve(dir, String(rel));
        if (!target.startsWith(dir + path.sep)) continue;     // 别让文件名带 ../ 跑出去
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, String(content ?? ''), 'utf8');
        count += 1;
      }
      return { ok: true, dir, count, rel: `${PROJECT_DIR}/${safeName(name)}` };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ---- 6) 流式对话：给「⚡ 讲这篇」用，逐字往渲染层推，快 ----
  // 模型顺序：出题专用 Qwen（有 Key 就用，快）→ 全局自定义 API。都没有就返回 no-stream，渲染层自己退到网页版。
  const streams = new Map();   // id -> AbortController
  ipcMain.handle('ai:stream', async (event, { id, messages, temperature = 0.3, timeout = 120000 } = {}) => {
    const cands = [];
    const quizKey = readApiKey('quiz');
    if (quizKey) cands.push({ baseUrl: store.get('study.quiz.baseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), model: store.get('study.quiz.model', 'qwen3.5-flash'), key: quizKey });
    const mainKey = readApiKey('default');
    if (store.get('ai.provider', 'deepseek-web') === 'openai-api' && mainKey) cands.push({ baseUrl: store.get('ai.api.baseUrl', ''), model: store.get('ai.api.model', ''), key: mainKey });
    const c = cands.find((x) => buildCompatibleEndpoints(x.baseUrl) && String(x.model).trim());
    if (!c) return { ok: false, code: 'no-stream', error: '没有可流式的 API 模型' };
    const ep = buildCompatibleEndpoints(c.baseUrl);
    const ctl = new AbortController(); streams.set(id, ctl);
    const timer = setTimeout(() => ctl.abort(), Math.min(Number(timeout) || 120000, 300000));
    const send = (p) => { try { if (!event.sender.isDestroyed()) event.sender.send('ai:stream:chunk', { id, ...p }); } catch { /* 窗口没了 */ } };
    (async () => {
      try {
        const res = await fetch(ep.chat, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` }, body: JSON.stringify({ model: String(c.model).trim(), messages, temperature, stream: true }), signal: ctl.signal });
        if (!res.ok) { send({ error: `${res.status} ${(await res.text()).split(c.key).join('[已隐藏]').slice(0, 200)}`, done: true }); return; }
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try { const j = JSON.parse(data); const t = j?.choices?.[0]?.delta?.content; if (t) send({ text: t }); } catch { /* 半截 JSON，下一行再来 */ }
          }
        }
        send({ done: true });
      } catch (err) {
        send({ error: err.name === 'AbortError' ? '已停止 / 超时' : err.message, done: true });
      } finally { clearTimeout(timer); streams.delete(id); }
    })();
    return { ok: true, model: c.model };
  });
  ipcMain.handle('ai:streamStop', (_e, id) => { streams.get(id)?.abort(); streams.delete(id); return { ok: true }; });

  // ---- 7) 抓页面文字：渲染层的 webview.executeJavaScript 只看得到顶层 frame，
  //         很多站（B 站的小玩具、各种内嵌阅读器）正文在 iframe 里。这里走主进程把所有 frame 都扫一遍。 ----
  const GRAB = `(() => { try { const s = String((window.getSelection && window.getSelection()) || '').trim(); const t = document.body ? document.body.innerText : ''; return { sel: s.slice(0, 12000), text: String(t || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 14000), title: document.title || '', url: location.href, top: window === window.top }; } catch (e) { return { sel: '', text: '', title: '', url: '', top: false }; } })()`;
  ipcMain.handle('study:grabPage', async (_e, webContentsId) => {
    const { webContents } = require('electron');
    const wc = webContents.fromId(Number(webContentsId));
    if (!wc || wc.isDestroyed()) return { ok: false, error: '页面不在了' };
    const frames = wc.mainFrame ? wc.mainFrame.framesInSubtree : [];
    const parts = [];
    for (const fr of frames.slice(0, 12)) {
      try { parts.push(await fr.executeJavaScript(GRAB, false)); } catch { /* 跨域或没准备好的 frame 跳过 */ }
    }
    const top = parts.find((p) => p && p.top) || parts[0] || {};
    const sel = parts.map((p) => p?.sel || '').find(Boolean) || '';
    // 顶层文字在前，子 frame 的接在后面；同一段别重复
    const seen = new Set(); const text = parts.map((p) => p?.text || '').filter((t) => t && !seen.has(t) && seen.add(t)).join('\n\n').slice(0, 16000);
    return { ok: true, page: { sel, text, title: top.title || wc.getTitle(), url: top.url || wc.getURL(), frames: parts.length } };
  });
}

module.exports = { registerStudyLazy, SHELF, CARD_DIR, STUDY_DIR, PROJECT_DIR };
