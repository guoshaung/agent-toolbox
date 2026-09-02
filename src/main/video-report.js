'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

/**
 * 视频报告：B 站链接 → 抓公开信息 → 拉字幕（官方优先，AI 兜底）→ 本地存 Markdown
 * → 可选 lark-cli 发到飞书。
 *
 * - 抓信息走 B 站公开 API（x/web-interface/view），不需要登录；
 * - 字幕走 yt-dlp + 浏览器 Cookie 登录态，官方字幕（zh-CN 等）优先，
 *   没有官方字幕才拉 B 站 AI 生成字幕（ai-zh）；
 * - 报告一律先落盘 userData/reports/*.md，发不发飞书都不丢。
 * - lark-cli / yt-dlp 多在 nvm、pipx 目录下，Electron 从 Finder 启动时 PATH 里没有，
 *   要挨个候选路径找。
 */

function extractBvid(url) {
  const m = String(url || '').match(/BV[0-9A-Za-z]{10}/);
  return m ? m[0] : null;
}

async function fetchBilibiliInfo(url) {
  const bvid = extractBvid(url);
  if (!bvid) return { ok: false, error: '没认出来 BV 号，链接里要有 BV 开头的那串。' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: 'https://www.bilibili.com',
      },
      signal: controller.signal,
    });
    const payload = await res.json();
    if (payload.code !== 0 || !payload.data) {
      return { ok: false, error: `B 站 API 返回错误（${payload.code}：${payload.message || '未知'}）。视频可能不存在或需登录。` };
    }
    const d = payload.data;
    return {
      ok: true,
      info: {
        bvid,
        url: `https://www.bilibili.com/video/${bvid}`,
        title: d.title || '',
        desc: (d.desc || '').trim(),
        owner: d.owner?.name || '',
        pubdate: d.pubdate ? new Date(d.pubdate * 1000).toISOString().slice(0, 10) : '',
        duration: d.duration || 0, // 总时长（秒）
        pages: (d.pages || []).map((p) => ({ page: p.page, part: p.part || '', duration: p.duration || 0 })),
        stat: {
          view: d.stat?.view || 0,
          danmaku: d.stat?.danmaku || 0,
          like: d.stat?.like || 0,
          coin: d.stat?.coin || 0,
          favorite: d.stat?.favorite || 0,
        },
      },
    };
  } catch (err) {
    const aborted = err.name === 'AbortError';
    return { ok: false, error: aborted ? '请求 B 站超时。' : `网络请求失败：${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 找 lark-cli 可执行文件：Electron 从 Dock 启动时 PATH 很秃，nvm 的路径得手动猜。
 *  返回 { cli, env } —— lark-cli 是 node 脚本（#!/usr/bin/env node），
 *  必须把它所在 bin 目录（里面有 node）前置进 PATH，否则 env 找不到 node。 */
function findLarkCli() {
  const candidates = [];
  for (const dir of String(process.env.PATH || '').split(':')) {
    if (dir) candidates.push(path.join(dir, 'lark-cli'));
  }
  const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    for (const ver of fs.readdirSync(nvmDir)) candidates.push(path.join(nvmDir, ver, 'bin', 'lark-cli'));
  } catch { /* 没装 nvm */ }
  candidates.push('/usr/local/bin/lark-cli', '/opt/homebrew/bin/lark-cli');

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      const binDir = path.dirname(p);
      return { cli: p, env: { ...process.env, PATH: `${binDir}:${process.env.PATH || ''}` } };
    } catch { /* 下一个 */ }
  }
  return null;
}

/**
 * 字幕拉取：优先 UP 主上传的官方字幕（zh-CN 等），没有再拉 B 站 AI 生成字幕（ai-zh）。
 * 两种字幕 B 站都要求登录态，所以走 yt-dlp --cookies-from-browser 借浏览器登录态。
 * 字幕是整集文本，可能很长（57 集约 20 万字），通过 scope 控制拉取范围。
 */

const SUB_SCOPES = {
  p1: { items: '1', timeout: 120000, label: '仅第 1 集' },
  p5: { items: '1-5', timeout: 360000, label: '前 5 集' },
  all: { items: null, timeout: 900000, label: '全部集' },
};

const SUB_BROWSERS = ['edge', 'chrome', 'firefox', 'safari'];
// B 站把 AI 生成字幕（ai-zh）也归在「字幕」而不是「自动字幕」里，
// 所以一趟 --write-subs 把官方和 AI 字幕语言都要上，拿到哪种算哪种
const SUB_LANGS = 'zh-CN,zh-Hans,zh-Hant,zh,en,ai-zh';

/** 找 yt-dlp：pipx 装在 ~/.local/bin，Electron 从 Dock 启动时 PATH 里没有 */
function findYtDlp() {
  const candidates = [];
  for (const dir of String(process.env.PATH || '').split(':')) {
    if (dir) candidates.push(path.join(dir, 'yt-dlp'));
  }
  candidates.push(
    path.join(os.homedir(), '.local', 'bin', 'yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/opt/homebrew/bin/yt-dlp',
  );
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* 下一个 */ }
  }
  return null;
}

/** 把 SRT/VTT 字幕文件剥成纯文本 */
function subtitleFileToText(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^\d+$/.test(t)) continue; // SRT 序号
    if (t.includes('-->')) continue; // 时间轴
    if (/^(WEBVTT|Kind:|Language:)/.test(t)) continue;
    lines.push(t.replace(/<[^>]+>/g, '')); // 去内联标签
  }
  return lines.join('');
}

/** 扫输出目录里下到的字幕文件，按分 P 序号归组；文件名带 ai- 前缀的是 B 站 AI 字幕 */
function collectSubtitleFiles(dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.(srt|vtt)$/i.test(f));
  } catch { /* 目录不存在 */ }
  const out = [];
  for (const f of files) {
    const pageMatch = f.match(/^(\d+)/);
    // 单视频不是播放列表时，yt-dlp 会把 playlist_index 写成 NA；它就是第 1 集。
    const page = pageMatch ? Number(pageMatch[1]) : /^NA\./i.test(f) ? 1 : NaN;
    if (!Number.isFinite(page)) continue;
    try {
      const text = subtitleFileToText(path.join(dir, f));
      if (!text.trim()) continue;
      out.push({
        page,
        ai: /\.ai[-.]/i.test(f) || /ai-zh/i.test(f) || /\.auto(?:\.|-)/i.test(f),
        text,
      });
    } catch { /* 跳过坏文件 */ }
  }
  const byPage = new Map();
  for (const e of out) {
    const prev = byPage.get(e.page);
    // 同一集同时有官方和 AI 字幕时，官方优先
    if (!prev || (prev.ai && !e.ai)) byPage.set(e.page, e);
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

async function runYtDlp(ytdlp, args, timeout) {
  try {
    await execFileAsync(ytdlp, args, {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout,
      env: process.env,
    });
    return { ok: true, error: '' };
  } catch (err) {
    const detail = String(err.stderr || err.stdout || err.message || '').replace(/\s+/g, ' ').trim();
    return { ok: false, error: detail.slice(-500) };
  }
}

/**
 * 拉字幕。返回 { ok, kind: 'official'|'ai'|'mixed', episodes: [{page, text, chars}], error? }
 * 依次借各浏览器的登录态跑 yt-dlp，哪个浏览器下到文件就用哪个。
 */
async function fetchSubtitles(url, scope, options = {}) {
  const bvid = extractBvid(url);
  if (!bvid) return { ok: false, error: '没认出来 BV 号。' };
  const sc = SUB_SCOPES[scope] || SUB_SCOPES.p1;
  const ytdlp = findYtDlp();
  if (!ytdlp) {
    return { ok: false, error: '没找到 yt-dlp（查过 PATH、~/.local/bin、/usr/local/bin、/opt/homebrew/bin）。先在终端跑 pipx install yt-dlp。' };
  }

  const videoUrl = `https://www.bilibili.com/video/${bvid}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-subs-'));
  const outTpl = path.join(dir, '%(playlist_index)s.%(ext)s');
  const baseArgs = [
    '--skip-download', '--no-warnings', '--ignore-errors', '--socket-timeout', '20',
    '--output-na-placeholder', '1', '-o', outTpl,
  ];
  if (sc.items) baseArgs.push('--playlist-items', sc.items);

  try {
    const sources = [];
    if (options.cookieFile) sources.push({ label: '内置 B 站会话', args: ['--cookies', options.cookieFile] });
    for (const browser of SUB_BROWSERS) sources.push({ label: browser, args: ['--cookies-from-browser', browser] });
    const failures = [];
    for (const source of sources) {
      // B 站 AI 字幕有两种暴露方式：有些版本归在 subtitles（ai-zh），
      // 有些版本归在 automatic_captions；两种开关都跑一遍。
      const modes = [
        ['--write-subs', '字幕'],
        ['--write-auto-subs', '自动字幕'],
      ];
      for (const [mode, modeLabel] of modes) {
        const run = await runYtDlp(
          ytdlp,
          [...baseArgs, ...source.args, mode, '--sub-langs', SUB_LANGS, videoUrl],
          sc.timeout,
        );
        if (!run.ok && run.error) failures.push(`${source.label}/${modeLabel}：${run.error}`);
        const episodes = collectSubtitleFiles(dir);
        if (!episodes.length) continue;
        const aiCount = episodes.filter((e) => e.ai).length;
        const kind = aiCount === 0 ? 'official' : aiCount === episodes.length ? 'ai' : 'mixed';
        return {
          ok: true,
          kind,
          browser: source.label,
          episodes: episodes.map((e) => ({ page: e.page, text: e.text, chars: e.text.length })),
        };
      }
    }
    const diagnostic = failures.length ? `最近一次尝试：${failures.at(-1)}` : '';
    return {
      ok: false,
      code: 'subtitle-not-found',
      error: `没有拿到 B 站字幕（已尝试官方字幕和 AI 字幕）。请确认左侧 B 站页面已登录，并打开具体视频页面后重试。${diagnostic}`,
    };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 临时目录清不掉就算了 */ }
  }
}

function reportsDir(userDataDir) {
  const dir = path.join(userDataDir, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function publishMarkdown(userDataDir, file, { title, markdown, bvid }) {
  const found = findLarkCli();
  if (!found) {
    return { ok: false, publishError: '没找到 lark-cli。报告已存本地，请先安装或登录 lark-cli。' };
  }
  try {
    const out = execFileSync(
      found.cli,
      ['docs', '+create', '--doc-format', 'markdown', '--content', '-', '--title', title],
      { encoding: 'utf8', input: markdown, maxBuffer: 16 * 1024 * 1024, timeout: 120000, env: found.env },
    );
    const parsed = JSON.parse(out);
    const docUrl = parsed?.data?.document?.url || '';
    if (!parsed?.ok || !docUrl) {
      return { ok: false, publishError: `lark-cli 创建文档返回异常：${out.slice(0, 300)}` };
    }
    const grant = parsed?.data?.permission_grant;
    const warnings = parsed?.data?.warnings;
    try {
      fs.writeFileSync(
        `${file}.json`,
        JSON.stringify({ title, docUrl, bvid: bvid || '', publishedAt: new Date().toISOString() }, null, 2),
        'utf8',
      );
    } catch { /* 存不上也不影响报告本身 */ }
    return {
      ok: true,
      docUrl,
      publishNote: [
        grant && grant.status !== 'granted' ? `权限授予：${grant.status}（${grant.message || ''}）` : '',
        Array.isArray(warnings) && warnings.length ? `警告：${warnings.join('；')}` : '',
      ].filter(Boolean).join(' '),
    };
  } catch (err) {
    const stderr = String(err.stderr || err.message || '').slice(0, 300);
    return { ok: false, publishError: `lark-cli 执行失败：${stderr}` };
  }
}

function saveReport(userDataDir, { title, markdown, bvid, publish }) {
  const dir = reportsDir(userDataDir);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // 202608310145
  const safeBvid = bvid || 'video';
  const file = path.join(dir, `${stamp}-${safeBvid}.md`);
  fs.writeFileSync(file, markdown, 'utf8');

  const result = { ok: true, localPath: file, docUrl: '' };
  if (!publish) return result;
  return { ...result, ...publishMarkdown(userDataDir, file, { title, markdown, bvid }) };
}

function publishReport(userDataDir, fileName, force = false) {
  const dir = reportsDir(userDataDir);
  const safe = path.basename(String(fileName || ''));
  if (!safe.endsWith('.md')) return { ok: false, publishError: '报告文件名不对。' };
  const file = path.join(dir, safe);
  try {
    const markdown = fs.readFileSync(file, 'utf8');
    const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || safe.replace(/\.md$/, '');
    let bvid = '';
    try { bvid = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8')).bvid || ''; } catch { /* 旧报告没有元数据 */ }
    let existing = '';
    try { existing = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8')).docUrl || ''; } catch { /* 未发布 */ }
    if (existing && !force) return { ok: true, docUrl: existing, alreadyPublished: true };
    return publishMarkdown(userDataDir, file, { title, markdown, bvid });
  } catch {
    return { ok: false, publishError: '报告文件读不到，可能被删了。' };
  }
}

function listReports(userDataDir) {
  const dir = reportsDir(userDataDir);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      const full = path.join(dir, f);
      try {
        const stat = fs.statSync(full);
        const head = fs.readFileSync(full, 'utf8').slice(0, 2000);
        const titleMatch = head.match(/^#\s+(.+)$/m);
        let docUrl = '';
        try {
          docUrl = String(JSON.parse(fs.readFileSync(`${full}.json`, 'utf8')).docUrl || '');
        } catch { /* 没发布过 */ }
        return {
          file: full,
          name: f,
          title: titleMatch ? titleMatch[1].trim() : f,
          mtime: stat.mtime.toISOString(),
          size: stat.size,
          docUrl,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
    .slice(0, 50);
}

function readReport(userDataDir, fileName) {
  const dir = reportsDir(userDataDir);
  const safe = path.basename(String(fileName || '')); // 挡路径穿越
  const full = path.join(dir, safe);
  try {
    const result = { ok: true, path: full, content: fs.readFileSync(full, 'utf8'), docUrl: '' };
    // 伴随元数据里可能存着飞书链接（发布成功时写入）
    try {
      const meta = JSON.parse(fs.readFileSync(`${full}.json`, 'utf8'));
      result.docUrl = String(meta.docUrl || '');
    } catch { /* 没发布过或元数据丢了 */ }
    return result;
  } catch {
    return { ok: false, error: '报告文件读不到，可能被删了。' };
  }
}

module.exports = {
  collectSubtitleFiles,
  fetchBilibiliInfo,
  fetchSubtitles,
  saveReport,
  publishReport,
  listReports,
  readReport,
};
