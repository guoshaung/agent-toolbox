'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCompatibleEndpoints, readStoredCompatibleConfig,
} = require('../src/main/ai-config');

test('桌宠从已保存设置读取 Base URL 与模型，并只拼接一次 v1', () => {
  const saved = { 'ai.api.baseUrl': 'https://example.test/v1/', 'ai.api.model': 'reader-model' };
  const config = readStoredCompatibleConfig({ get: (key, fallback) => saved[key] ?? fallback }, true);
  assert.equal(config.ok, true);
  assert.equal(config.model, 'reader-model');
  assert.equal(config.endpoints.chat, 'https://example.test/v1/chat/completions');
  assert.equal('apiKey' in config, false);
});

test('兼容端点根地址、v1 地址和完整 chat completions 地址', () => {
  assert.equal(buildCompatibleEndpoints('https://example.test').chat, 'https://example.test/v1/chat/completions');
  assert.equal(buildCompatibleEndpoints('https://example.test/v1').chat, 'https://example.test/v1/chat/completions');
  assert.equal(buildCompatibleEndpoints('https://example.test/v1/chat/completions').chat, 'https://example.test/v1/chat/completions');
  assert.equal(
    buildCompatibleEndpoints('https://ark.cn-beijing.volces.com/api/v3').chat,
    'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  );
});

test('缺少保存配置时返回具体中文缺项和可操作引导', () => {
  const config = readStoredCompatibleConfig({ get: (_key, fallback) => fallback }, false);
  assert.equal(config.ok, false);
  assert.equal(config.code, 'missing-config');
  assert.deepEqual(config.missing, ['Base URL', '模型名', 'API Key']);
  assert.match(config.error, /AI 接口配置未完成/);
  assert.match(config.error, /请前往 AI 设置补全后重试/);
  assert.equal('apiKey' in config, false);
});

test('DashScope 兼容模式地址保留 compatible-mode/v1 路径', () => {
  assert.equal(
    buildCompatibleEndpoints('https://dashscope.aliyuncs.com/compatible-mode/v1').chat,
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  );
});
