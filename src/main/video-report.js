'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

/**
 * 视频报告：B 站链接 → 抓公开信息 → 本地存 Markdown → 可选 lark-cli 发到飞书。
 *
 * - 抓信息走 B 站公开 API（x/web-interface/view），不需要登录，拿不到字幕；
 *   没有字幕时报告就是「内容地图」：标题/简介/分集大纲，AI 摘要基于这些生成。
 * - 报告一律先落盘 userData/reports/*.md，发不发飞书都不丢。
 * - lark-cli 在 nvm 目录下，Electron 从 Finder 启动时 PATH 里没有，要挨个候选路径找。
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

function reportsDir(userDataDir) {
  const dir = path.join(userDataDir, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveReport(userDataDir, { title, markdown, bvid, publish }) {
  const dir = reportsDir(userDataDir);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // 202608310145
  const safeBvid = bvid || 'video';
  const file = path.join(dir, `${stamp}-${safeBvid}.md`);
  fs.writeFileSync(file, markdown, 'utf8');

  const result = { ok: true, localPath: file, docUrl: '' };
  if (!publish) return result;

  const found = findLarkCli();
  if (!found) {
    return { ...result, publishError: '没找到 lark-cli（查过 PATH、nvm、/usr/local/bin、/opt/homebrew/bin）。报告已存本地，登录发布后的问题解决后再发。' };
  }
  try {
    const out = execFileSync(
      found.cli,
      // @file 只收相对路径，改成 stdin 管道喂内容
      ['docs', '+create', '--doc-format', 'markdown', '--content', '-', '--title', title],
      { encoding: 'utf8', input: markdown, maxBuffer: 16 * 1024 * 1024, timeout: 120000, env: found.env },
    );
    const parsed = JSON.parse(out);
    const docUrl = parsed?.data?.document?.url || '';
    if (!parsed?.ok || !docUrl) {
      return { ...result, publishError: `lark-cli 创建文档返回异常：${out.slice(0, 300)}` };
    }
    const grant = parsed?.data?.permission_grant;
    const warnings = parsed?.data?.warnings;
    return {
      ...result,
      docUrl,
      publishNote: [
        grant && grant.status !== 'granted' ? `权限授予：${grant.status}（${grant.message || ''}）` : '',
        Array.isArray(warnings) && warnings.length ? `警告：${warnings.join('；')}` : '',
      ].filter(Boolean).join(' '),
    };
  } catch (err) {
    const stderr = String(err.stderr || err.message || '').slice(0, 300);
    return { ...result, publishError: `lark-cli 执行失败：${stderr}` };
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
        return {
          file: full,
          name: f,
          title: titleMatch ? titleMatch[1].trim() : f,
          mtime: stat.mtime.toISOString(),
          size: stat.size,
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
    return { ok: true, path: full, content: fs.readFileSync(full, 'utf8') };
  } catch {
    return { ok: false, error: '报告文件读不到，可能被删了。' };
  }
}

module.exports = { fetchBilibiliInfo, saveReport, listReports, readReport };
