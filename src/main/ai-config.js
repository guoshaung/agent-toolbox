'use strict';

function buildCompatibleEndpoints(value) {
  const raw = String(value || '').trim();
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;

  let path = url.pathname.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(path)) path = path.replace(/\/chat\/completions$/i, '');
  if (!/\/v1$/i.test(path)) path = `${path}/v1`;
  path = path.replace(/\/{2,}/g, '/');
  const root = `${url.origin}${path}`;
  return { root, chat: `${root}/chat/completions`, models: `${root}/models` };
}

function validateCompatibleConfig({ baseUrl, model, hasKey }) {
  const endpoints = buildCompatibleEndpoints(baseUrl);
  const missing = [];
  if (!String(baseUrl || '').trim()) missing.push('Base URL');
  else if (!endpoints) missing.push('有效的 Base URL（需以 http:// 或 https:// 开头）');
  if (!String(model || '').trim()) missing.push('模型名');
  if (!hasKey) missing.push('API Key');
  if (missing.length) {
    return {
      ok: false,
      code: 'missing-config',
      missing,
      error: `AI 接口配置未完成：缺少${missing.join('、')}。请前往 AI 设置补全后重试。`,
    };
  }
  return { ok: true, baseUrl: endpoints.root, model: String(model).trim(), endpoints };
}

function readStoredCompatibleConfig(store, hasKey) {
  return validateCompatibleConfig({
    baseUrl: store.get('ai.api.baseUrl', ''),
    model: store.get('ai.api.model', ''),
    hasKey,
  });
}

module.exports = { buildCompatibleEndpoints, validateCompatibleConfig, readStoredCompatibleConfig };
