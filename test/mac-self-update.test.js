const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assetUrl, bundlePathFromExe, swapScript } = require('../src/main/mac-self-update');

test('mac 自更新：下载地址和 CI 产物命名对得上', () => {
  assert.equal(assetUrl('0.40.0', 'arm64'), 'https://github.com/guoshaung/agent-toolbox/releases/download/v0.40.0/Agent-Toolbox-0.40.0-mac-arm64.zip');
  assert.equal(assetUrl('v0.40.0', 'x64'), 'https://github.com/guoshaung/agent-toolbox/releases/download/v0.40.0/Agent-Toolbox-0.40.0-mac-x64.zip');
});

test('mac 自更新：从可执行文件路径推出 .app', () => {
  assert.equal(bundlePathFromExe('/Applications/Agent 工具箱.app/Contents/MacOS/Agent 工具箱'), '/Applications/Agent 工具箱.app');
  assert.equal(bundlePathFromExe('/Users/x/Downloads/Foo.app/Contents/MacOS/Foo'), '/Users/x/Downloads/Foo.app');
});

test('mac 自更新：换包脚本等进程退出后再换，路径里的引号和空格都安全', { skip: process.platform !== 'darwin' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-'));
  const target = path.join(root, "Agent 工具箱 it's.app");
  const fresh = path.join(root, 'new', 'Agent.app');
  fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'old'), 'old');
  fs.mkdirSync(fresh, { recursive: true }); fs.writeFileSync(path.join(fresh, 'new'), 'new');
  // 用一个很快退出的 pid（已结束的 sleep）模拟主进程退出
  const p = spawnSync('sleep', ['0']);
  const script = path.join(root, 'swap.sh');
  fs.writeFileSync(script, swapScript({ pid: p.pid, target, newApp: fresh, open: false }), { mode: 0o755 });
  const r = spawnSync('/bin/bash', [script]);
  assert.equal(r.status, 0, String(r.stderr));
  assert.ok(fs.existsSync(path.join(target, 'new')), '新包应替换到目标位置');
  assert.ok(!fs.existsSync(path.join(target, 'old')), '旧包应被删掉');
  assert.ok(!fs.existsSync(fresh), '新包应是被移走而不是拷贝');
  fs.rmSync(root, { recursive: true, force: true });
});
