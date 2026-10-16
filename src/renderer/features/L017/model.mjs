export const MODEL_VERSION = '1.0';
export const MAX_BODY_BYTES = 4096;
export const FIELDS = ['now', 'age', 'responseDelay', 'cacheControl', 'cachedETag', 'cachedBody', 'serverCacheControl', 'serverETag', 'serverBody'];
export const POLICY = '固定GET /lesson，已有一条可存储的本地缓存。年龄由用户提供，不计算Date/Age；age < max-age才新鲜，no-cache允许存储但每次必须成功验证。单个ETag用于If-None-Match，GET按opaque内容弱比较，忽略W/标记但大小写敏感；匹配304复用原body并更新元数据/验证时间，不匹配或无验证器200替换body。响应假定成功、在响应时间生成且初始年龄0；不模拟网络、共享缓存或完整HTTP。';
function integer(value, label, maximum) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value).trim())) throw new Error(`${label}须为非负十进制整数。`);
  const number = Number(value); if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw new Error(`${label}须在0至${maximum}之间。`); return number;
}
export function parseCacheControl(value, label = 'Cache-Control') {
  if (typeof value !== 'string' || value.length > 128 || !value.trim()) throw new Error(`${label}须为1–128字符的max-age或no-cache指令。`);
  let maxAge = null; let noCache = false; const directives = value.split(',').map((item) => item.trim());
  for (const directive of directives) {
    const max = /^max-age\s*=\s*(\d+)$/i.exec(directive);
    if (max) { if (maxAge !== null) throw new Error(`${label}的max-age重复。`); maxAge = integer(max[1], `${label} max-age`, 604800); }
    else if (/^no-cache$/i.test(directive)) { if (noCache) throw new Error(`${label}的no-cache重复。`); noCache = true; }
    else throw new Error(`${label}仅支持max-age和无参数no-cache；不实现no-store或其他指令。`);
  }
  return { maxAge, noCache, canonical: [maxAge === null ? null : `max-age=${maxAge}`, noCache ? 'no-cache' : null].filter(Boolean).join(', ') };
}
export function parseETag(value, label = 'ETag') {
  if (typeof value !== 'string' || value.length > 70) throw new Error(`${label}须为≤70字符文本。`);
  const tag = value.trim(); if (!tag) return null;
  const match = /^(W\/)?"([\x21\x23-\x7E]{0,64})"$/.exec(tag);
  if (!match) throw new Error(`${label}须为单个双引号ASCII标签或W/弱标签（W大写）；不支持列表、*或引号转义。`);
  return { raw: tag, weak: Boolean(match[1]), opaque: match[2] };
}
export function weakMatch(left, right) { return left !== null && right !== null && left.opaque === right.opaque; }
export function validateInput(draft) {
  if (!draft || typeof draft !== 'object') throw new Error('输入对象无效。');
  const now = integer(draft.now, '当前时间', 1000000000); const age = integer(draft.age, '本地年龄', 1000000); const responseDelay = integer(draft.responseDelay, '模拟响应耗时', 60);
  if (now < age) throw new Error('当前时间必须≥年龄，以便简化的上次验证时间非负。');
  if (now + responseDelay > 1000000000) throw new Error('当前时间+响应耗时超过1000000000。');
  for (const key of ['cachedBody', 'serverBody']) if (typeof draft[key] !== 'string' || new TextEncoder().encode(draft[key]).byteLength > MAX_BODY_BYTES) throw new Error(`${key === 'cachedBody' ? '本地' : '服务端'}body须为≤4096 UTF-8字节文本。`);
  return { now, age, responseDelay, cachePolicy: parseCacheControl(draft.cacheControl, '本地Cache-Control'), serverPolicy: parseCacheControl(draft.serverCacheControl, '服务端Cache-Control'), cachedETag: parseETag(draft.cachedETag, '本地ETag'), serverETag: parseETag(draft.serverETag, '服务端ETag'), cachedBody: draft.cachedBody, serverBody: draft.serverBody };
}
export function decideCache(draft) {
  const input = validateInput(draft); const fresh = input.cachePolicy.maxAge !== null && input.age < input.cachePolicy.maxAge; const reusable = fresh && !input.cachePolicy.noCache;
  const initialCache = { exists: true, cacheControl: input.cachePolicy.canonical, maxAge: input.cachePolicy.maxAge, noCache: input.cachePolicy.noCache, etag: input.cachedETag?.raw ?? null, body: input.cachedBody, age: input.age, lastValidatedAt: input.now - input.age };
  let current = { phase: 'initial', time: input.now, cache: structuredClone(initialCache), request: null, response: null, bodyForUse: null }; const steps = [];
  function transition(title, reason, update) { const before = structuredClone(current); update(); steps.push({ step: steps.length + 1, title, reason, before, after: structuredClone(current) }); }
  transition('读取已有本地缓存', '本例已有一条GET /lesson的可存储缓存；不是首次访问，不判断no-store。', () => { current.phase = 'cache-read'; });
  transition('判断年龄与验证要求', `${input.cachePolicy.maxAge === null ? '没有max-age，本模型不使用启发式新鲜度。' : `年龄${input.age} < max-age ${input.cachePolicy.maxAge}为${fresh ? '真（新鲜）' : '假（不新鲜；相等也过期）'}。`}${input.cachePolicy.noCache ? ' no-cache要求每次成功验证，即使年龄新鲜。' : ''}`, () => { current.phase = 'freshness-checked'; });
  if (reusable) transition('直接复用，不发送请求', '新鲜且无no-cache，使用本地body；不比较服务端ETag，不更新验证时间或年龄。', () => { current.phase = 'reuse-local'; current.bodyForUse = current.cache.body; });
  else {
    transition(input.cachedETag ? '构造条件GET' : '构造普通GET', input.cachedETag ? `携带If-None-Match: ${input.cachedETag.raw}，等待服务端按GET弱比较。` : '本地没有ETag，不构造If-None-Match；本模型不使用Last-Modified，取完整200。', () => { current.phase = 'request-prepared'; current.request = { method: 'GET', target: '/lesson', sentAt: input.now, headers: input.cachedETag ? { 'If-None-Match': input.cachedETag.raw } : {} }; });
    const matched = weakMatch(input.cachedETag, input.serverETag); const responseTime = input.now + input.responseDelay;
    transition(matched ? '服务端模拟返回304' : '服务端模拟返回200', matched ? 'opaque标签相同：If-None-Match条件不成立，GET返回304，无响应body。W/标记不影响弱比较。' : '无验证器或opaque标签不同：返回200，带服务端body；服务端版本以用户ETag为准，不从body生成标签。', () => {
      current.phase = 'response-received'; current.time = responseTime; current.cache.age += input.responseDelay;
      current.response = { status: matched ? 304 : 200, receivedAt: responseTime, headers: { 'Cache-Control': input.serverPolicy.canonical, ...(input.serverETag ? { ETag: input.serverETag.raw } : {}) }, body: matched ? null : input.serverBody };
    });
    transition(matched ? '保留body，更新验证元数据' : '替换body与元数据', `${matched ? '304复用原本地body，不取服务端body字段。' : '200使用新body，替换旧body和ETag；服务端无ETag则移除旧标签。'} 使用服务端Cache-Control，验证时间设为${responseTime}；假定新响应Age=0，不计算真实Date/Age。no-cache仍可存储。`, () => {
      current.phase = matched ? 'reuse-validated' : 'replace-cache';
      current.cache = { exists: true, cacheControl: input.serverPolicy.canonical, maxAge: input.serverPolicy.maxAge, noCache: input.serverPolicy.noCache, etag: input.serverETag?.raw ?? null, body: matched ? input.cachedBody : input.serverBody, age: 0, lastValidatedAt: responseTime };
      current.bodyForUse = current.cache.body;
    });
  }
  return { modelVersion: MODEL_VERSION, policy: POLICY, input, freshness: { fresh, maxAge: input.cachePolicy.maxAge, age: input.age, noCache: input.cachePolicy.noCache, directlyReusable: reusable }, outcome: current.phase, requestCount: current.request ? 1 : 0, responseStatus: current.response?.status ?? null, transferredBodyBytes: current.response?.body === null || !current.response ? 0 : new TextEncoder().encode(current.response.body).byteLength, initialCache, steps, final: structuredClone(current) };
}
export function example(kind = 'fresh') {
  const draft = { now: '100', age: '30', responseDelay: '2', cacheControl: 'max-age=60', cachedETag: '"v1"', cachedBody: '版本1：课程内容', serverCacheControl: 'max-age=60', serverETag: '"v1"', serverBody: '版本1：课程内容' };
  if (kind === 'stale') draft.age = '90';
  if (kind === 'changed') { draft.age = '90'; draft.serverETag = '"v2"'; draft.serverBody = '版本2：更新后的课程内容'; }
  if (kind === 'no-cache') { draft.age = '10'; draft.cacheControl = 'max-age=60, no-cache'; draft.serverCacheControl = 'max-age=60, no-cache'; }
  if (kind === 'weak') { draft.age = '90'; draft.cachedETag = 'W/"v1"'; draft.serverETag = 'W/"v1"'; }
  return draft;
}
export function prepareStoredState(draft) {
  if (!draft || FIELDS.some((key) => typeof draft[key] !== 'string')) throw new Error('草稿字段类型无效。');
  for (const key of ['cachedBody', 'serverBody']) if (new TextEncoder().encode(draft[key]).byteLength > MAX_BODY_BYTES) throw new Error('草稿body超过4096 UTF-8字节。');
  const serialized = JSON.stringify({ schemaVersion: 1, ...Object.fromEntries(FIELDS.map((key) => [key, draft[key]])) });
  if (new TextEncoder().encode(serialized).byteLength > 65536) throw new Error('草稿超过64KiB。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('草稿版本不支持。');
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 65536) throw new Error('草稿超过64KiB。');
  return prepareStoredState(state);
}
export function reportMarkdown(payload) {
  const safe = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, '&#96;').replace(/\|/g, '&#124;');
  const lines = ['# L017 HTTP 缓存决策台', '', POLICY, '', '## 完整输入草稿', '', ...FIELDS.flatMap((key) => [`### ${key}`, '', ...payload.draft[key].split(/\r?\n/).map((line) => `    ${safe(line)}`), ''])];
  if (!payload.result) { lines.push('当前输入未生成有效决策结果。'); return lines.join('\n'); }
  const result = payload.result;
  lines.push('## 决策结果', '', `请求${result.requestCount}次；模拟响应${result.responseStatus ?? '无请求/无状态码'}；响应body传输${result.transferredBodyBytes} UTF-8字节。`, '', `本地最初：${safe(JSON.stringify(result.initialCache))}`, '', `本地最后：${safe(JSON.stringify(result.final.cache))}`, '', '### 最终使用body', '', ...result.final.bodyForUse.split(/\r?\n/).map((line) => `    ${safe(line)}`));
  for (const step of result.steps) lines.push('', `## 步骤${step.step}：${step.title}`, '', safe(step.reason), '', `之前：${safe(JSON.stringify(step.before))}`, '', `之后：${safe(JSON.stringify(step.after))}`);
  lines.push('', '## 官方参考与范围', '', '[RFC 9111 §4.2](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2)新鲜度；[§5.2.2.4](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.4)no-cache。', '', '[RFC 9110 §13.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2)If-None-Match；[§8.8.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2)弱比较。', '', '仅单条已有缓存；不实现Date/Age/Last-Modified、共享缓存、多表示304筛选、no-store、ETag列表或*、失败/重定向与真实请求。');
  return lines.join('\n');
}
