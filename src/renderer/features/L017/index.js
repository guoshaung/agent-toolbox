import { h } from '../../core/ui.js';
import { MODEL_VERSION, FIELDS, POLICY, example, decideCache, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L017.state';
const LABELS = { now: '当前时间秒', age: '本地缓存年龄秒', responseDelay: '模拟响应耗时秒', cacheControl: '本地Cache-Control', cachedETag: '本地ETag', cachedBody: '本地body', serverCacheControl: '服务端Cache-Control', serverETag: '服务端ETag', serverBody: '服务端body' };
const OUTCOMES = { 'reuse-local': '直接复用本地缓存', 'reuse-validated': '304验证成功，复用原body', 'replace-cache': '200替换本地缓存' };
export default {
  id: 'L017',
  create(root, ctx = {}) {
    root.classList.add('feature-l017');
    let draft = example(); let result = null; let selected = 0; let timer = null; let destroyed = false; let exporting = false; let restoredNotice = '';
    const saved = ctx.config?.get(KEY);
    if (saved) {
      try { const state = validateStoredState(saved); draft = Object.fromEntries(FIELDS.map((key) => [key, state[key]])); restoredNotice = '已恢复输入草稿；缓存更新结果和决策轨迹未写入配置，请重新判断或保留导出报告。'; }
      catch (error) { restoredNotice = `保存草稿未能恢复：${error.message} 旧配置未被自动覆盖。`; }
    }
    const notice = h('div', { class: 'l017-notice', role: 'status', 'aria-live': 'polite' }, restoredNotice); const storageNotice = h('div', { class: 'l017-storage', role: 'status' });
    const editor = h('div', { class: 'l017-editor' }); const output = h('div', { class: 'l017-output' });
    function replace(node, ...children) { node.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)); }
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null; if (!ctx.config?.set) return;
      let state;
      try { state = prepareStoredState(draft); }
      catch (error) { if (!destroyed) storageNotice.textContent = `${error.message} 当前输入未写入全局配置，关闭后只能恢复较早草稿；请导出完整JSON，切走不能保存超限内容。`; return; }
      if (!destroyed) storageNotice.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch((error) => message(`保存草稿失败：${error.message} 请导出完整JSON。`, true)); }
      catch (error) { message(`保存草稿失败：${error.message} 请导出完整JSON。`, true); }
    }
    function changed() { result = null; selected = 0; renderOutput(); message('输入已改变，旧缓存结果及判断轨迹已清空，请重新判断。'); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function load(kind) { draft = example(kind); changed(); renderEditor(); persist(); message('示例已载入，请判断缓存。'); }
    function field(key) {
      const body = key.endsWith('Body'); const numeric = ['now', 'age', 'responseDelay'].includes(key);
      const control = h(body ? 'textarea' : 'input', { class: 'field', ...(body ? { rows: '4', spellcheck: 'false' } : { type: 'text', inputmode: numeric ? 'numeric' : 'text' }), maxlength: body ? '4096' : key.includes('Control') ? '128' : key.includes('ETag') ? '70' : '10', 'aria-label': LABELS[key], oninput: () => { draft[key] = control.value; changed(); } }); control.value = draft[key];
      return h('label', { class: 'l017-field' }, h('span', {}, LABELS[key]), control);
    }
    function renderEditor() {
      replace(editor, h('div', { class: 'l017-times' }, ['now', 'age', 'responseDelay'].map(field)), h('p', {}, '时间均为抽象秒整数：now 0–1000000000，age 0–1000000，耗时0–60；now≥age且响应时刻不得越界。age是用户已计算好的输入，不从Date/Age推导。'),
        h('div', { class: 'l017-columns' }, h('section', { class: 'l017-input-pane' }, h('h3', {}, '已存在的本地缓存'), ['cacheControl', 'cachedETag', 'cachedBody'].map(field)), h('section', { class: 'l017-input-pane' }, h('h3', {}, '固定成功的模拟服务端'), ['serverCacheControl', 'serverETag', 'serverBody'].map(field))),
        h('p', {}, 'Cache-Control只填max-age=秒数、no-cache或两者组合。max-age≤604800；不支持no-store等其他指令。ETag填单个双引号ASCII标签（最多64内容字符），可用大写W/前缀；空白表示无标签。body≤4096 UTF-8字节，服务端body只用于200。'),
        h('div', { class: 'l017-actions' }, [['fresh', '载入新鲜示例'], ['stale', '载入304示例'], ['changed', '载入200示例'], ['no-cache', '载入no-cache示例'], ['weak', '载入弱ETag示例']].map(([kind, label]) => h('button', { class: 'btn', onclick: () => load(kind) }, label)), h('button', { class: 'btn primary', onclick: run }, '判断缓存')));
    }
    function run() {
      try { result = decideCache(draft); selected = 0; persist(); renderOutput(); message(`${OUTCOMES[result.outcome]}；模拟请求${result.requestCount}次。逐步查看仅切换解释，不发送真实请求。`); }
      catch (error) { result = null; renderOutput(); message(error.message, true); }
    }
    function pick(index) { if (!result || !Number.isInteger(index)) return; selected = Math.max(0, Math.min(result.steps.length - 1, index)); renderOutput(); }
    function table(headers, rows, caption) { return h('div', { class: 'l017-scroll' }, h('table', {}, h('caption', {}, caption), h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, rows))); }
    function cacheView(cache, title) {
      return h('section', { class: 'l017-cache' }, h('h4', {}, title), h('p', {}, `已存储：${cache.exists ? '是' : '否'}；Cache-Control：${cache.cacheControl}`), h('p', {}, `ETag：${cache.etag ?? '无'}；年龄：${cache.age}秒；上次存储/验证参考时间：${cache.lastValidatedAt}秒`), h('p', {}, `max-age：${cache.maxAge ?? '未声明'}；no-cache：${cache.noCache ? '每次需验证，仍已存储' : '无'}`), h('strong', {}, '缓存body（文本）'), h('pre', { class: 'l017-body' }, cache.body === '' ? '（空body）' : cache.body));
    }
    function requestView(request, response) {
      return h('div', { class: 'l017-columns' }, h('section', { class: 'l017-http' }, h('h4', {}, '本步骤模拟请求'), request ? h('pre', {}, `${request.method} ${request.target}\n发送时间：${request.sentAt}秒\n${Object.entries(request.headers).map(([key, value]) => `${key}: ${value}`).join('\n') || '无If-None-Match（普通GET）'}`) : h('p', {}, '本步骤尚无请求或直接复用。')),
        h('section', { class: 'l017-http' }, h('h4', {}, '本步骤模拟响应'), response ? h('div', {}, h('pre', {}, `状态：${response.status}\n响应时间：${response.receivedAt}秒\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\n')}`), h('p', {}, response.status === 304 ? '304无响应body；原缓存body将被复用。' : '200响应body将替换原缓存。'), response.status === 200 ? h('pre', { class: 'l017-body' }, response.body === '' ? '（空body）' : response.body) : null) : h('p', {}, '本步骤尚无响应。')));
    }
    function renderOutput() {
      const exports = h('div', { class: 'l017-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出完整 Markdown'));
      if (!result) { replace(output, h('p', {}, '请判断当前已有缓存；新鲜直接使用，过期或no-cache验证。尚无结果，可导出当前草稿。'), exports); return; }
      const step = result.steps[selected]; const selector = h('select', { class: 'field', 'aria-label': '查看决策步骤', onchange: () => pick(Number(selector.value)) }, result.steps.map((row, index) => h('option', { value: String(index) }, `步骤${row.step}：${row.title}`))); selector.value = String(selected);
      replace(output, h('div', { class: 'l017-summary' }, `全程结论：${OUTCOMES[result.outcome]} · 请求 ${result.requestCount}次 · 响应 ${result.responseStatus ?? '无请求'} · 传输body ${result.transferredBodyBytes}字节`), h('p', {}, `原始年龄判断：${result.freshness.maxAge === null ? '未声明max-age' : result.freshness.fresh ? '新鲜' : '过期'}；${result.freshness.noCache ? 'no-cache仍强制验证，缓存可存储。' : '无no-cache强制验证。'}以下选择只查看步骤，不回滚或更新输入。`),
        h('div', { class: 'l017-chain' }, result.steps.map((row, index) => h('button', { class: `btn${selected === index ? ' is-selected' : ''}`, onclick: () => pick(index) }, `查看步骤${row.step}：${row.title}`))),
        h('div', { class: 'l017-actions' }, selector, h('button', { class: 'btn', disabled: selected === 0, onclick: () => pick(selected - 1) }, '上个判断'), h('button', { class: 'btn', disabled: selected === result.steps.length - 1, onclick: () => pick(selected + 1) }, '下个判断')),
        h('h3', {}, `当前步骤${step.step}：${step.title}`), h('p', {}, step.reason), h('p', {}, `模拟时间：${step.before.time}→${step.after.time}秒`),
        h('div', { class: 'l017-columns' }, cacheView(step.before.cache, '本步骤之前的缓存'), cacheView(step.after.cache, '本步骤之后的缓存')), requestView(step.after.request, step.after.response),
        h('details', {}, h('summary', {}, '全程前后状态与最终使用body'), table(['字段', '最初', '最后'], [
          ['已存储', '是', '是'], ['Cache-Control', result.initialCache.cacheControl, result.final.cache.cacheControl], ['ETag', result.initialCache.etag ?? '无', result.final.cache.etag ?? '无'], ['年龄秒', result.initialCache.age, result.final.cache.age], ['上次存储/验证参考秒', result.initialCache.lastValidatedAt, result.final.cache.lastValidatedAt], ['body来源', '原本地body', result.responseStatus === 200 ? '新服务端body' : '原本地body'],
        ].map((row) => h('tr', {}, row.map((cell) => h('td', {}, String(cell))))), '只更新模拟缓存，不改变输入草稿；304不传输body，200替换body'), h('pre', { class: 'l017-body' }, result.final.bodyForUse === '' ? '（空body）' : result.final.bodyForUse)), exports,
      );
    }
    async function exportReport(extension) {
      if (exporting) return;
      const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      try {
        const payload = { feature: 'L017', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: JSON.parse(JSON.stringify(draft)), result };
        const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(payload), extension, defaultName: `L017-http-cache.${extension}`, copyOnly: true });
        message(response?.ok ? '已导出新文件，包含完整输入、决策链及缓存前后状态。' : response?.canceled ? '已取消导出，输入与结果保留。' : `导出失败：${response?.error || '未确认保存成功'}`, !response?.ok && !response?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); }
      finally { exporting = false; }
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, 'HTTP 缓存决策台'), h('p', {}, '从一条已有的本地缓存开始，核对年龄、验证请求，以及304/200之后究竟使用哪个body。'), notice, storageNotice,
      h('details', {}, h('summary', {}, '固定规则、协议参考与保存范围'), h('p', {}, POLICY), h('p', {}, 'ETag只支持单个ASCII标签，W/前缀大小写敏感、opaque比较大小写敏感；不支持列表/*/obs-text。服务端版本由输入ETag决定，不检查body与强标签的一致性。始终已知单条表示，简化304缓存更新，不实现多表示/强验证器筛选。'), h('p', {}, '参考 ', h('a', { href: 'https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2', target: '_blank', rel: 'noopener noreferrer' }, 'RFC 9111 新鲜度'), '、', h('a', { href: 'https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.4', target: '_blank', rel: 'noopener noreferrer' }, 'no-cache'), ' 和 ', h('a', { href: 'https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2', target: '_blank', rel: 'noopener noreferrer' }, 'RFC 9110 If-None-Match'), '。只模拟成功的GET 200/304，不模拟Date/Age/Last-Modified、共享缓存、Vary、失败、重定向或no-store，不发送真实请求。'), h('p', {}, '时间是有界抽象秒，假定新响应在响应时刻生成且Age=0；上次验证参考时间简化为now−age，不等同于完整HTTP年龄计算。只保存≤64KiB输入草稿，结果需重新判断；JSON/Markdown创建新副本并拒绝覆盖已有文件。切走无后台工作。')), editor, output);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { persist(); }, destroy() { persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l017'); } };
  },
};
