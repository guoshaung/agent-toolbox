'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const { RemoteControl } = require('../src/main/remote-control');

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: pathname, method: options.method || 'GET', headers: options.headers || {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('手机控制服务要求一次性令牌，并执行受控动作', async () => {
  const calls = [];
  const remote = new RemoteControl({ preferredPort: 0, deviceName: 'Test Toolbox', onCommand: async (type, payload) => {
    calls.push({ type, payload });
    return { accepted: true };
  } });
  const state = await remote.start({ token: 'persisted-test-token' });
  try {
    const denied = await request(state.port, '/');
    assert.equal(denied.status, 401);
    const page = await request(state.port, `/?token=${encodeURIComponent(state.token)}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Test Toolbox/);
    assert.ok(state.urls.some((url) => url.includes('persisted-test-token')));
    const result = await request(state.port, `/api/command?token=${encodeURIComponent(state.token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clipboard.write', payload: { text: 'hello' } }),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(calls, [{ type: 'clipboard.write', payload: { text: 'hello' } }]);
  } finally {
    await remote.stop();
  }
});

test('停止后手机控制端口关闭', async () => {
  const remote = new RemoteControl({ preferredPort: 0, onCommand: async () => ({}) });
  const state = await remote.start();
  await remote.stop();
  await assert.rejects(request(state.port, '/'), /ECONNREFUSED|socket hang up|AggregateError|ECONNRESET/);
});

test('重启服务时可以复用持久化令牌', async () => {
  const remote = new RemoteControl({ preferredPort: 0, onCommand: async () => ({}) });
  const first = await remote.start({ token: 'stable-pairing-token' });
  await remote.stop();
  const second = await remote.start({ token: 'stable-pairing-token' });
  try {
    assert.equal(second.token, first.token);
    assert.ok(second.port > 0);
  } finally {
    await remote.stop();
  }
});

test('手机分享目标把链接与文字同步到电脑收件箱', async () => {
  const received = [];
  const remote = new RemoteControl({ preferredPort: 0, onCommand: async () => ({}), onInbox: (item) => received.push(item) });
  const state = await remote.start({ token: 'share-target-token' });
  try {
    const manifest = await request(state.port, `/manifest.webmanifest?token=${state.token}`);
    assert.equal(manifest.status, 200);
    assert.match(manifest.body, /share_target/);
    const shared = await request(state.port, `/share?token=${state.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'title=一篇论文&text=值得阅读&url=https%3A%2F%2Fexample.com%2Fpaper',
    });
    assert.equal(shared.status, 303);
    const inbox = await request(state.port, `/api/inbox?token=${state.token}`);
    const data = JSON.parse(inbox.body);
    assert.equal(data.ok, true);
    assert.equal(data.items[0].url, 'https://example.com/paper');
    assert.equal(received[0].title, '一篇论文');
  } finally {
    await remote.stop();
  }
});

test('手机 APK 下载地址受配对令牌保护并返回 APK', async () => {
  const apkPath = '/tmp/agent-toolbox-test.apk';
  fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const remote = new RemoteControl({ preferredPort: 0, apkPath, apkName: 'test-remote.apk' });
  const state = await remote.start({ token: 'apk-token' });
  try {
    const denied = await request(state.port, `/download/test-remote.apk?token=wrong`);
    assert.equal(denied.status, 401);
    const result = await request(state.port, `/download/test-remote.apk?token=${state.token}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.length, 4);
  } finally {
    await remote.stop();
    fs.rmSync(apkPath, { force: true });
  }
});
