'use strict';
/**
 * macOS 自更新：electron-updater 在 mac 上装更新要走 Squirrel.Mac，而它只认签过名的包；
 * 咱们 CI 出的是不签名的，于是「现在重启」在 mac 上会静默失败——看起来就像永远更不上。
 * 这里绕开它：自己下 release 里的 zip → ditto 解压 → 起一个 bash 等主进程退出后把 .app 换掉 → 重新打开。
 *
 * 纯函数（URL / 路径 / 脚本文本）不依赖 electron，方便测；真正跑的那步由 updater.js 注入 electron 的东西。
 */
const fs = require('fs');
const path = require('path');

const REPO = 'guoshaung/agent-toolbox';

/** release 里 mac 包的下载地址（和 CI 的产物命名对应） */
function assetUrl(version, arch = process.arch) {
  const v = String(version).replace(/^v/, '');
  const a = arch === 'x64' ? 'x64' : 'arm64';
  return `https://github.com/${REPO}/releases/download/v${v}/Agent-Toolbox-${v}-mac-${a}.zip`;
}

/** 从可执行文件路径推出 .app 包路径：…/Foo.app/Contents/MacOS/Foo → …/Foo.app */
function bundlePathFromExe(exe) {
  // 这是 mac 专用逻辑，但测试会在 Windows CI 上跑：path.resolve 会把分隔符换成反斜杠，
  // 所以固定用 posix 语义，别看当前平台
  const p = String(exe).replace(/\\/g, '/');
  const idx = p.indexOf('.app/Contents/');
  if (idx >= 0) return p.slice(0, idx + 4);
  return path.posix.dirname(path.posix.dirname(path.posix.dirname(p)));
}

/** 等 pid 退出 → 换包 → 去掉隔离标记 → 重新打开。写成脚本是因为换包时本进程必须已经退出。 */
function swapScript({ pid, target, newApp, open = true }) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  return [
    '#!/bin/bash',
    `for i in $(seq 1 200); do kill -0 ${Number(pid)} 2>/dev/null || break; sleep 0.25; done`,
    `rm -rf ${q(target)}`,
    `mv ${q(newApp)} ${q(target)}`,
    `xattr -dr com.apple.quarantine ${q(target)} 2>/dev/null`,
    open ? `open -n ${q(target)}` : 'true',
    '',
  ].join('\n');
}

/** 下载 zip 到 dir 并解压，返回解压出的 .app 路径。fetch / execFile 注入，方便测。 */
async function downloadAndExtract({ url, dir, fetchFn = globalThis.fetch, execFile, onProgress = () => {} }) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'update.zip');
  const res = await fetchFn(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') || 0);
  let got = 0;
  const ws = fs.createWriteStream(zip);
  for await (const chunk of res.body) {
    if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
    got += chunk.length;
    onProgress(total ? got / total : -1, got, total);
  }
  await new Promise((resolve, reject) => { ws.on('error', reject); ws.end(resolve); });
  if (got < 1024 * 1024) throw new Error('下载的文件太小，不像是完整的包');
  await execFile('/usr/bin/ditto', ['-x', '-k', zip, dir]);
  const bundle = fs.readdirSync(dir).find((n) => n.endsWith('.app'));
  if (!bundle) throw new Error('压缩包里没有 .app');
  return path.join(dir, bundle);
}

/** 写好脚本并起一个脱离的 bash；返回脚本路径。之后调用方 app.quit() 即可。 */
function launchSwap({ pid, target, newApp, dir, spawn }) {
  const script = path.join(dir, 'swap.sh');
  fs.writeFileSync(script, swapScript({ pid, target, newApp }), { mode: 0o755 });
  const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' });
  child.unref();
  return script;
}

module.exports = { assetUrl, bundlePathFromExe, swapScript, downloadAndExtract, launchSwap, REPO };
