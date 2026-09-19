'use strict';

/**
 * 接口台的后端：在主进程里发请求。
 *
 * 为什么不在渲染层直接 fetch：那边是网页环境，跨域会被拦，自定义 Header（Origin、
 * Referer、Cookie 这些）也改不了 —— 调接口时恰恰最需要改这些。主进程没有同源策略，
 * 发出去的就是你写的那一份。
 */
const { performance } = require('node:perf_hooks');

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const MAX_BODY = 8 * 1024 * 1024;          // 响应体最多留 8MB，再大就截断，不然界面卡死

/** 只允许 http/https。file:// 之类的交给别的工具，别从这里读本地文件。 */
function parseUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('没有填网址。');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try { url = new URL(withScheme); } catch { throw new Error(`网址看不懂：${text}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`只支持 http / https，不支持 ${url.protocol}`);
  return url;
}

/** 文本框里一行一个 `Key: value`，空行和 # 开头的当注释 */
function parseHeaderLines(text) {
  const headers = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf(':');
    if (at <= 0) continue;
    headers.push([trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim()]);
  }
  return headers;
}

/** {{name}} 换成环境变量里的值；没定义的原样留着，好让人一眼看出漏了哪个 */
function applyVars(text, vars = {}) {
  return String(text || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole
  ));
}

function isTextual(contentType = '') {
  return /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql)|application\/.*\+json|application\/.*\+xml)/i.test(contentType);
}

/**
 * 发一次请求。
 * 返回体永远带上 durationMs 和真实发出去的 header，方便对着抓包核对。
 */
async function send(request = {}, { fetchImpl = fetch } = {}) {
  const method = String(request.method || 'GET').toUpperCase();
  if (!METHODS.has(method)) throw new Error(`不支持的方法：${method}`);
  const vars = request.vars || {};
  const url = parseUrl(applyVars(request.url, vars));

  // 查询参数单独填的那些，合并进 URL
  for (const [key, value] of request.query || []) {
    if (!key) continue;
    url.searchParams.append(applyVars(key, vars), applyVars(value, vars));
  }

  const headers = new Headers();
  const warnings = [];
  for (const [key, value] of parseHeaderLines(applyVars(request.headers, vars))) {
    try {
      headers.append(key, value);
    } catch (error) {
      // HTTP 头只能放 0–255 的字节，中文直接 append 会抛。curl 的做法是把 UTF-8 原始字节
      // 发出去，这里照做（latin1 一个字符一个字节，正好把字节序列原样塞进去）。
      // 之前这里是 catch 了什么都不做 —— 头悄悄没了，调接口时最坑的就是这种。
      try {
        headers.append(key, Buffer.from(value, 'utf8').toString('latin1'));
        warnings.push(`${key} 里有非 ASCII 字符，已按 UTF-8 字节发出去（和 curl 一致）`);
      } catch {
        warnings.push(`${key} 这个头不合法，没发出去：${error.message}`);
      }
    }
  }

  let body;
  if (!['GET', 'HEAD'].includes(method) && request.body) {
    body = applyVars(request.body, vars);
    if (request.bodyType === 'json' && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (request.bodyType === 'form' && !headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded');
  }

  const controller = new AbortController();
  const timeoutMs = Math.min(Math.max(Number(request.timeout) || 30000, 1000), 300000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(url.href, {
      method,
      headers,
      body,
      redirect: request.followRedirects === false ? 'manual' : 'follow',
      signal: controller.signal,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const durationMs = Math.round(performance.now() - startedAt);
    const contentType = response.headers.get('content-type') || '';
    const truncated = buffer.length > MAX_BODY;
    const kept = truncated ? buffer.subarray(0, MAX_BODY) : buffer;
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      url: response.url || url.href,
      durationMs,
      size: buffer.length,
      truncated,
      contentType,
      headers: [...response.headers.entries()],
      warnings,
      textual: isTextual(contentType) || (!contentType && kept.length < 200000),
      body: kept.toString('utf8'),
      bodyBase64: isTextual(contentType) ? '' : kept.toString('base64'),
      request: { method, url: url.href, headers: [...headers.entries()], body: body || '' },
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const aborted = error.name === 'AbortError';
    return {
      ok: false,
      durationMs,
      error: aborted ? `超时了（${timeoutMs / 1000}s 没回来）` : describeFetchError(error),
      warnings,
      request: { method, url: url.href, headers: [...headers.entries()], body: body || '' },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Node 的 fetch 报错都是一句 "fetch failed"，把底下的 cause 翻出来说人话 */
function describeFetchError(error) {
  const cause = error?.cause || {};
  const code = cause.code || error.code;
  // fetch 对一些端口直接拒绝连（1、7、25 这些历史上被滥用的），报错只有一句 bad port
  if (/bad port/i.test(cause.message || '')) return '这个端口被浏览器内核拉黑了（1、7、25、110… 这类端口不让连），换一个端口。';
  const map = {
    ENOTFOUND: '域名解析不了，检查网址拼写或 DNS。',
    ECONNREFUSED: '对方端口没开（连接被拒），本地服务起了吗？',
    ECONNRESET: '连接被对方掐断了。',
    ETIMEDOUT: '连接超时，网络不通或被墙。',
    EPROTO: '协议对不上，http 和 https 写反了？',
    CERT_HAS_EXPIRED: '对方证书过期了。',
    DEPTH_ZERO_SELF_SIGNED_CERT: '对方用的是自签名证书。',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: '证书链验不过。',
  };
  const hint = map[code];
  const detail = cause.message || error.message || '请求失败';
  return hint ? `${hint}（${code}）` : `${detail}${code ? `（${code}）` : ''}`;
}

// ---------- curl 互转 ----------

/** 把请求拼成一条能直接粘进终端的 curl */
function toCurl(request = {}, vars = {}) {
  const method = String(request.method || 'GET').toUpperCase();
  const url = applyVars(request.url, vars);
  const parts = ['curl'];
  if (method !== 'GET') parts.push('-X', method);
  parts.push(shellQuote(url));
  for (const [key, value] of parseHeaderLines(applyVars(request.headers, vars))) {
    parts.push('\\\n  -H', shellQuote(`${key}: ${value}`));
  }
  if (request.body && !['GET', 'HEAD'].includes(method)) {
    parts.push('\\\n  --data-raw', shellQuote(applyVars(request.body, vars)));
  }
  return parts.join(' ');
}

function shellQuote(text) {
  const value = String(text ?? '');
  return `'${value.split("'").join(`'\\''`)}'`;
}

/**
 * 粘一条 curl 进来，拆成请求。
 * 浏览器「Copy as cURL」那种一大坨也能吃，常见的 --data / -H / -X / --compressed 都认。
 */
function fromCurl(text) {
  const tokens = tokenizeShell(String(text || '').replace(/\\\r?\n/g, ' '));
  if (!tokens.length || !/curl$/.test(tokens[0])) throw new Error('这不像一条 curl 命令。');
  const result = { method: '', url: '', headers: [], body: '', bodyType: 'raw' };
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = () => tokens[++i] ?? '';
    if (token === '-X' || token === '--request') result.method = next().toUpperCase();
    else if (token === '-H' || token === '--header') result.headers.push(next());
    else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary' || token === '--data-ascii') result.body = next();
    else if (token === '--data-urlencode') { result.body = next(); result.bodyType = 'form'; }
    else if (token === '-F' || token === '--form') result.body = `${result.body ? `${result.body}\n` : ''}${next()}`;
    else if (token === '-u' || token === '--user') result.headers.push(`Authorization: Basic ${Buffer.from(next()).toString('base64')}`);
    else if (token === '-b' || token === '--cookie') result.headers.push(`Cookie: ${next()}`);
    else if (token === '-A' || token === '--user-agent') result.headers.push(`User-Agent: ${next()}`);
    else if (token === '-e' || token === '--referer') result.headers.push(`Referer: ${next()}`);
    else if (token === '--url') result.url = next();
    else if (token.startsWith('-')) { /* --compressed / -L / -k 这些对我们没影响，忽略 */ }
    else if (!result.url) result.url = token;
  }
  if (!result.url) throw new Error('这条 curl 里没找到网址。');
  if (!result.method) result.method = result.body ? 'POST' : 'GET';
  const contentType = result.headers.find((h) => /^content-type:/i.test(h)) || '';
  if (/json/i.test(contentType)) result.bodyType = 'json';
  else if (/x-www-form-urlencoded/i.test(contentType)) result.bodyType = 'form';
  return { ...result, headers: result.headers.join('\n') };
}

/** 极简 shell 分词：够解析 curl 就行，不求通用 */
function tokenizeShell(text) {
  const tokens = [];
  let current = '';
  let quote = '';
  let has = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = '';
      else if (char === '\\' && quote === '"' && i + 1 < text.length) { current += text[++i]; }
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; has = true; continue; }
    if (char === '\\' && i + 1 < text.length) { current += text[++i]; has = true; continue; }
    if (/\s/.test(char)) { if (current || has) tokens.push(current); current = ''; has = false; continue; }
    current += char;
    has = true;
  }
  if (current || has) tokens.push(current);
  return tokens;
}

module.exports = { send, toCurl, fromCurl, parseHeaderLines, applyVars, parseUrl, describeFetchError, tokenizeShell, METHODS };
