import { h } from '../../core/ui.js';
import { SchemaError, LIMITS, EXAMPLE, checkText, generate, bundlePayload } from './model.mjs';

export default {
  id: 'T053',
  create(root) {
    let active = false; let destroyed = false; let ticket = 0; let busy = false; let result = null;
    const status = h('p', { class: 't053-status', role: 'status', 'aria-live': 'polite' });
    const source = h('textarea', { rows: '14', 'aria-label': 'JSON Schema 源文本', oninput: () => { if (!active || destroyed || document.hidden || busy) return; invalidate(); message('源已编辑，旧文件预览废弃，请重新生成。'); } }); source.value = EXAMPLE;
    const file = h('input', { type: 'file', accept: '.json,.schema.json', 'aria-label': '读取 UTF-8 JSON Schema 文件', onchange: e => readFile(e.target) });
    const inspect = button('生成并预览全部文件', inspectSource); const cancel = button('取消当前读取或生成', () => { ticket++; message('已取消，未保存部分产物；等待当前异步操作结束后重试。'); });
    const issuesHost = h('section', {}); const resultHost = h('section', {});
    root.append(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('section', { class: 'feature-t053', 'aria-label': '接口类型离线生成' }, h('h2', {}, '接口类型离线生成'), h('p', {}, '本机 JSON Schema → types.d.ts、validation-mapping.json、generation-manifest.json。只生成有限静态类型，不请求接口、不联网解析引用、不执行 Schema 或生成代码。'),
      h('p', { class: 't053-rule' }, '支持域：JSON Schema 2020-12（未声明时按此有限域），type/properties/required/items/原始 enum/根 $defs 本地引用。源 ≤64 KiB、JSON深度 ≤8、节点 ≤200，全部产物 ≤2 MiB。OpenAPI、结构组合、外部/缺失/循环引用阻止生成。'),
      h('p', { class: 't053-muted' }, 'min/max/pattern/format 等未表达约束逐 JSON Pointer 标记，明确从投影省略；integer 静态映射为 number。validation mapping 是说明表，不运行校验，不保证完整 Schema 等价或通过元 Schema 验证。'), source, field('只读用户选中的本地文件', file), actions(inspect, cancel, button('载入必填字符串与可选数组示例', () => { if (busy) return; source.value = EXAMPLE; invalidate(); message('示例已载入，点击生成预览。'); }), button('清除源与所有预览', clear)), status, issuesHost, resultHost,
      h('p', { class: 't053-muted' }, '源与生成结果仅当前面板内存，不自动写配置；切换功能销毁未保存内容。源文本和输出可包含属性名/enum 字面量，分享前自行检查敏感信息。本项不做匿名化。所有文件必须先完整预览，再显式创建全新副本目录；已有目录拒绝，无源文件修改。')));
    update();
    function button(label, fn) { return h('button', { type: 'button', onclick: e => { if (!active || destroyed || document.hidden || e.detail > 1) return; fn(); } }, label); }
    function actions(...nodes) { return h('div', { class: 't053-actions' }, nodes); }
    function field(label, input) { return h('label', {}, h('span', {}, label), input); }
    function message(text) { if (!destroyed) status.textContent = text; }
    function invalidate() { ticket++; result = null; resultHost.replaceChildren(); issuesHost.replaceChildren(); }
    function update() { if (destroyed) return; source.disabled = !active || busy; file.disabled = !active || busy; inspect.disabled = !active || busy; cancel.disabled = !active || !busy; }
    async function task(fn) { if (busy) return; const owner = ++ticket; busy = true; update(); const options = { isCanceled: () => destroyed || !active || document.hidden || owner !== ticket }; try { await fn(options); } catch (error) { if (!destroyed && owner === ticket) { if (error instanceof SchemaError) { renderIssues(error.issues || []); message(`${error.code}：${error.message} 没有部分类型文件。`); } else message('本地处理失败，异常上下文已隐藏；已预览产物若存在会保留。'); } } finally { if (!destroyed) { busy = false; update(); } } }
    async function inspectSource() { if (busy) return; invalidate(); const text = source.value; await task(async options => { await new Promise(r => setTimeout(r, 0)); if (options.isCanceled()) return; const next = await generate(text, options); if (options.isCanceled()) return; result = next; renderIssues(next.issues); renderFiles(); message(`已生成 ${next.files.length} 个完整文件 / ${next.totalBytes} 字节；投影提示 ${next.issues.length} 项。请逐个预览；没有运行时校验或代码执行。`); }); }
    async function readFile(control) { const selected = control.files?.[0]; control.value = ''; if (!active || destroyed || document.hidden || busy || !selected) return; source.value = ''; invalidate(); await task(async options => { if (!Number.isSafeInteger(selected.size) || selected.size < 0 || selected.size > LIMITS.inputBytes || typeof selected.slice !== 'function') throw new SchemaError('input_limit'); const data = await selected.slice(0, selected.size).arrayBuffer(); if (options.isCanceled()) return; if (!(data instanceof ArrayBuffer) || data.byteLength !== selected.size) throw new SchemaError('read_size'); let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new SchemaError('invalid_utf8'); } checkText(text); if (options.isCanceled()) return; source.value = text; message('UTF-8 文件已只读载入，尚未生成；未保存文件名或任意路径。'); }); }
    function renderIssues(issues) { issuesHost.replaceChildren(); if (!issues.length) return; issuesHost.append(h('h3', {}, '逐路径投影范围与阻止原因'), h('table', { class: 't053-data' }, h('thead', {}, h('tr', {}, ['JSON Pointer', '级别', '原因码'].map(x => h('th', {}, x)))), h('tbody', {}, issues.map(i => h('tr', {}, h('td', {}, i.path), h('td', {}, i.severity), h('td', {}, i.code)))))); }
    function renderFiles() { resultHost.replaceChildren(); const expected = result; resultHost.append(h('h3', {}, '全部生成文件完整预览'), h('p', {}, '拟创建 T053-interface-types-copy 新目录，实际路径由保存对话框确认。三个固定相对文件名；不可覆盖已有目录。'), ...expected.files.map(f => { const text = h('textarea', { rows: '10', readonly: true, 'aria-label': `完整预览 ${f.path}` }); text.value = f.content; return h('section', {}, h('h4', {}, f.path), h('p', {}, `${f.bytes} 字节 · SHA-256 ${f.sha256}`), text); }), button('确认导出已预览文件到全新目录', () => save(expected))); }
    async function save(expected) { if (busy || result !== expected) return; const api = window.toolbox?.files; if (api?.exportBundleSupportsCopyOnly !== true || typeof api.exportBundle !== 'function') { message('当前宿主缺少多文件副本保护接口，已阻止保存。'); return; } await task(async options => { const saved = await api.exportBundle(bundlePayload(expected)); if (options.isCanceled() || result !== expected) return; if (saved?.ok === true) message('已创建包含三个生成文件的全新副本目录，源文件未修改。'); else if (saved?.canceled === true) message('已取消保存，完整预览保留。'); else if (saved?.partialPath) message('保存失败且新目录清理未完成；请核对保存对话框选择的目录，完整预览保留。'); else message('保存失败，完整预览保留；不能覆盖已有目录。'); }); }
    function clear() { source.value = ''; file.value = ''; invalidate(); message('源与所有生成预览已清除；不承诺物理内存擦除。'); }
    function hide() { if (document.hidden && !destroyed) { ticket++; message('面板隐藏，当前读取/生成取消，返回后手动重试；不会自动导出。'); } }
    document.addEventListener('visibilitychange', hide);
    return { activate() { if (destroyed) return; active = true; update(); }, deactivate() { if (destroyed) return; active = false; ticket++; update(); message('面板暂停，任务取消；已完成预览保留，不自动导出。'); }, destroy() { if (destroyed) return; clear(); destroyed = true; active = false; ticket++; document.removeEventListener('visibilitychange', hide); root.replaceChildren(); } };
  }
};
