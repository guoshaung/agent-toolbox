const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PaperTalkService } = require('../src/main/paper-talk-service');

// 假 claude：带 --setting-sources '' 时回「未登录」，不带时（走 settings / CC Switch）正常回答
function fakeClaude(dir) {
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh
case " $* " in
  *" --setting-sources "*) echo '{"is_error":true,"result":"Not logged in · Please run /login"}' ;;
  *) echo '{"is_error":false,"result":"收到"}' ;;
esac
`, { mode: 0o755 });
  return bin;
}

test('论文讲解：CLI 没有订阅登录态时，拉起中转后带 settings 重试', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptcli-'));
  let relayed = 0;
  const svc = new PaperTalkService({ userDataDir: dir, resolveClaude: () => fakeClaude(dir), ensureRelay: async () => { relayed += 1; } });
  assert.equal(await svc._ask('hi'), '收到');
  assert.equal(relayed, 1, '应先确保本机中转起来');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('论文讲解：非登录类错误不重试，原样报出', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptcli-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\necho '{"is_error":true,"result":"rate limited"}'\n`, { mode: 0o755 });
  let relayed = 0;
  const svc = new PaperTalkService({ userDataDir: dir, resolveClaude: () => bin, ensureRelay: async () => { relayed += 1; } });
  await assert.rejects(svc._ask('hi'), /rate limited/);
  assert.equal(relayed, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
