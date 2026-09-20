'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
const QUIT = MAIN.slice(MAIN.indexOf("app.on('will-quit'"), MAIN.indexOf("app.on('will-quit'") + 1800);

test('退出收尾里每个服务调用都是可选调用，不会因为某个类没这个方法就抛', () => {
  // 之前写成 voiceBoxService?.stop() —— 对象存在但没有 stop，照样 TypeError
  const bare = QUIT.match(/\w+Service\?\.\w+\(\)/g) || [];
  assert.deepEqual(bare, [], `这些要写成 ?.方法?.() 才安全：${bare.join(', ')}`);
});

test('退出收尾逐个 try 兜住：一步失败不影响后面的', () => {
  assert.match(QUIT, /try\s*\{\s*run\(\);?\s*\}\s*catch/, '每一步都要单独兜住');
});

test('负责杀掉 voicebox-server 子进程的那一步还在收尾清单里', () => {
  assert.match(QUIT, /voiceboxService\?\.stop\?\.\(\)/, '漏了它，语音服务子进程会被强退硬掐');
});

test('VoiceBoxService 确实没有 stop —— 这就是当初崩的原因，别再直接调', () => {
  const { VoiceBoxService, VoiceboxService } = require('../src/main/voicebox-service');
  assert.equal(typeof VoiceBoxService.prototype.stop, 'undefined', '外部应用那个类本来就没有 stop');
  assert.equal(typeof VoiceboxService.prototype.stop, 'function', '受管服务那个必须有 stop');
});
