import { h } from '../../core/ui.js';
import { CalendarError, LIMITS, TARGETS, parseICS, analyzeICS, makeResult } from './model.mjs';
import { EXAMPLES } from './examples.mjs';

const LABELS = { preserve: '保留原时间语义（默认）', UTC: 'UTC（固定范围单次事件）', 'Asia/Shanghai': 'Asia/Shanghai（UTC+08）', 'Asia/Tokyo': 'Asia/Tokyo（UTC+09）' };
export default {
  id: 'T096',
  create(root) {
    let active = false; let destroyed = false; let generation = 0; let pending = false; let exporting = false; let analysis = null; let decisions = []; let result = null; let preview = null; let page = 0;
    const style = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
    const status = h('p', { class: 't096-status', role: 'status', 'aria-live': 'polite' });
    const source = h('textarea', { rows: '10', 'aria-label': 'ICS 源文本', placeholder: 'BEGIN:VCALENDAR … END:VCALENDAR', oninput: edited });
    const target = h('select', { 'aria-label': '目标时间语义', onchange: () => { if (!active || destroyed) return; clearPreview(); result = null; renderResult(); message('目标已改变，请重新生成副本；当前去重判定保留。'); } }, TARGETS.map(value => h('option', { value }, LABELS[value]))); target.value = 'preserve';
    const file = h('input', { type: 'file', accept: '.ics,.txt', 'aria-label': '读取本地 ICS 文件', onchange: e => readFile(e.target) });
    const check = button('校验并核对 UID', inspect); const cancel = button('取消校验或读取', () => invalidate('任务已取消，无部分结果；等待当前异步任务结束。')); const generate = button('生成当前规则副本', build);
    const eventsHost = h('section', {}); const decisionsHost = h('section', {}); const resultHost = h('section', {}); const previewHost = h('section', {});
    const shell = h('section', { class: 'feature-t096', 'aria-label': '日历事件迁移校验' }, h('h2', {}, '日历事件迁移校验'), h('p', {}, '本地核对 UID、时间类型与重复规则，先看完整副本再保存。未确认前不删除任何事件，不展开重复排期。'), field('读取单个严格 UTF-8 文件', file), source,
      h('div', { class: 't096-actions' }, check, cancel, button('每周重复演示', () => example('weekly')), button('重复与冲突演示', () => example('duplicates')), button('单次时区演示', () => example('single')), button('清除源文本和结果', clear)), status,
      h('p', { class: 't096-rule' }, '默认完整保留 UID、RRULE、EXDATE/RDATE、VTIMEZONE、参数及未知属性，只规范折行与 CRLF。未知规则或不完整日期只能原样检查，不保证目标日历导入效果。'),
      h('p', { class: 't096-muted' }, '限额：1 MiB、20000 物理行、1000 事件、3000 组件、8 层嵌套、每组件 200 属性。原文及报告仅保留当前内存，不写配置。报告可能含事件原信息。'),
      eventsHost, decisionsHost, h('div', { class: 't096-actions' }, field('目标时间语义', target), generate),
      h('p', { class: 't096-muted' }, '时区转换仅 2000–2035 年的 UTC / Asia/Shanghai / Asia/Tokyo 单次 DTSTART/DTEND，需无重复、例外、提醒、DURATION 或校验问题。源 TZID 必须有匹配固定 VTIMEZONE，并由当前 Intl 校验；DST 歧义/不存在时间与其他 TZID 不支持改写。DATE 保持全天日期，floating 不分配时区。'),
      resultHost, previewHost, h('p', { class: 't096-muted' }, '切换功能清除未保存内存，暂停或隐藏取消任务；回来后手动重试。ICS 及报告每种最多 4 MiB。保存创建新副本，不覆盖源文件；不访问云日历。'));
    root.append(style, shell); update();
    function field(label, input) { return h('label', {}, h('span', {}, label), input); }
    function button(label, fn) { return h('button', { type: 'button', onclick: e => { if (!active || destroyed || document.hidden || e.detail > 1) return; fn(); } }, label); }
    function message(text) { if (!destroyed) status.textContent = text; }
    function clearPreview() { generation++; preview = null; previewHost.replaceChildren(); }
    function invalidate(text = '') { clearPreview(); analysis = null; decisions = []; result = null; page = 0; eventsHost.replaceChildren(); decisionsHost.replaceChildren(); resultHost.replaceChildren(); update(); if (text) message(text); }
    function edited() { if (!active || destroyed) return; invalidate('源文本已改变，旧去重判定与预览全部废弃，请重新校验。'); }
    function update() { if (destroyed) return; source.disabled = !active; target.disabled = !active || pending; file.disabled = !active || pending; check.disabled = !active || pending; cancel.disabled = !active || !pending; generate.disabled = !active || pending || !analysis; }
    async function inspect() {
      if (pending) return; invalidate(); const ticket = generation; let parsed;
      try { parsed = parseICS(source.value); } catch (error) { message(error instanceof CalendarError ? error.message : '解析失败，未生成校验结果。'); return; }
      pending = true; update(); message('本地 UID 校验中，可以取消。');
      try { const next = await analyzeICS(parsed, { isCanceled: () => destroyed || ticket !== generation || !active || document.hidden, onProgress: p => { if (!destroyed && ticket === generation) message(`已检查 ${p.processed}/${p.total} 个事件。`); } }); if (destroyed || ticket !== generation) return; analysis = next; decisions = []; renderEvents(); renderDecisions(); message(`校验完成：${next.parsed.events.length} 个事件，完全相同 ${next.duplicates.length} 组，UID 冲突/系列 ${next.conflicts.length} 组；所有记录保留。`); }
      catch (error) { if (!destroyed && ticket === generation) message(error instanceof CalendarError ? error.message : '校验失败，未生成部分结果。'); }
      finally { if (!destroyed) { pending = false; update(); } }
    }
    function renderEvents() {
      eventsHost.replaceChildren(); if (!analysis) return; const max = Math.max(0, Math.ceil(analysis.parsed.events.length / 20) - 1); page = Math.min(page, max);
      const body = h('tbody', {}, analysis.parsed.events.slice(page * 20, page * 20 + 20).map(event => h('tr', {}, h('td', {}, event.id), h('td', {}, event.uid || '（缺失 UID）'), h('td', {}, event.summary || '（无标题）'), h('td', {}, formatTime(event.start)), h('td', {}, formatTime(event.end)), h('td', {}, event.recurrence.map(r => r.raw).join('\n') || '无重复属性'), h('td', {}, `行 ${event.startLine}–${event.endLine}`))));
      eventsHost.append(h('h3', {}, '时间类型与规则'), h('div', { class: 't096-actions' }, button('事件上一页', () => { if (page > 0) { page--; renderEvents(); } }), h('span', {}, `${page + 1}/${max + 1} 页，每页 20 事件`), button('事件下一页', () => { if (page < max) { page++; renderEvents(); } })), h('div', { class: 't096-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['ID', 'UID', '标题', '开始', '结束（不包含）', '原重复属性', '来源物理行'].map(t => h('th', {}, t)))), body)), h('p', {}, `完整保留 VTIMEZONE ${analysis.parsed.timezones.length} 个；审计 ${analysis.parsed.audit.length} 项，完整内容进入 JSON 报告。`));
    }
    function formatTime(time) { if (!time) return '—'; return `${time.kind}${time.tzid ? ' · ' + time.tzid : ''}\n${time.value}${time.valid ? '' : '\n' + time.reason}`; }
    function renderDecisions() {
      decisionsHost.replaceChildren(); if (!analysis) return; const owner = analysis;
      decisionsHost.append(h('h3', {}, '重复与冲突核对'));
      for (const group of analysis.duplicates) { const decision = decisions.find(d => d.groupId === group.id); const keeper = h('select', { 'aria-label': `${group.id} 保留事件 ID` }, group.members.map(id => h('option', { value: id }, id))); keeper.value = decision?.keepId || group.members[0];
        decisionsHost.append(h('article', { class: 't096-group' }, h('h4', {}, `${group.id} · 完全相同 UID：${group.uid}`), h('p', {}, `${group.members.join(' / ')}；${decision ? `已确认仅保留 ${decision.keepId}` : '未确认，全部保留'}。内容比较包含完整属性顺序、参数与嵌套组件，非排期实例去重。`), field('选择保留 ID', keeper), button(`确认去重 ${group.id}`, () => { if (analysis !== owner || pending) return; try { const next = [...decisions.filter(d => d.groupId !== group.id), { groupId: group.id, keepId: keeper.value }]; makeResult(analysis, next, 'preserve'); decisions = next; clearPreview(); result = null; renderResult(); renderDecisions(); message('仅完全相同整条记录的去重已确认，尚未生成副本；重复规则没有改变。'); } catch (error) { message(error instanceof CalendarError ? error.message : '去重判定失败。'); } }), button(`撤销去重 ${group.id}`, () => { if (analysis !== owner) return; decisions = decisions.filter(d => d.groupId !== group.id); clearPreview(); result = null; renderResult(); renderDecisions(); message('去重已撤销，原记录全部恢复；请重新生成副本。'); }))); }
      for (const conflict of analysis.conflicts) decisionsHost.append(h('article', { class: 't096-conflict' }, h('h4', {}, `${conflict.id} · ${conflict.kind === 'conflict' ? '同 UID 不同内容冲突' : '同 UID 系列实例或冲突'}`), h('p', {}, `${conflict.uid} · ${conflict.members.join(' / ')}`), h('p', {}, conflict.notice)));
      if (!analysis.duplicates.length && !analysis.conflicts.length) decisionsHost.append(h('p', {}, '本次没有 UID 重复组或内容冲突；不等于完整 RFC 或客户端兼容性验证。'));
    }
    function build() { if (!analysis || pending) return; clearPreview(); result = null; try { result = makeResult(analysis, decisions, target.value); renderResult(); message(`副本已生成：${result.report.inputEvents} → ${result.report.outputEvents} 个事件；时间改写 ${result.report.changes.length} 项，尚未保存。`); } catch (error) { renderResult(); message(error instanceof CalendarError ? error.message : '副本生成失败，无部分改写结果。'); } }
    function renderResult() { resultHost.replaceChildren(); if (!result) return; resultHost.append(h('h3', {}, '副本规则预览'), h('p', {}, `输入 ${result.report.inputEvents} → 输出 ${result.report.outputEvents}；目标 ${LABELS[result.report.target]}；确认移除 ${result.report.removedIds.join(' / ') || '无'}。`), h('ul', {}, result.report.changes.map(change => h('li', {}, `${change.eventId} · ${change.before} → ${change.after}`))), h('div', { class: 't096-actions' }, button('预览完整 ICS 副本', () => showPreview('ics')), button('预览完整校验报告', () => showPreview('json')))); }
    function showPreview(kind) { if (!result || pending) return; preview = { content: kind === 'ics' ? result.ics : JSON.stringify(result.report, null, 2), extension: kind, defaultName: kind === 'ics' ? 'T096-calendar-copy.ics' : 'T096-migration-report.json' }; renderPreview(); message('完整内容已预览，请核对规则及目标保存路径。副本不代表目标客户端已成功导入。'); }
    function renderPreview() { previewHost.replaceChildren(); if (!preview) return; const text = h('textarea', { rows: '12', readonly: true, 'aria-label': '日历副本完整预览' }); text.value = preview.content; const save = button(exporting ? '正在保存…' : '保存当前预览新副本', savePreview); save.disabled = exporting; previewHost.append(h('h3', {}, '完整副本与路径确认'), h('p', {}, `拟创建 ${preview.defaultName}；实际目标路径在原生保存对话框中确认。已有文件不能被覆盖。`), text, save); }
    async function savePreview() { if (!preview || pending || exporting) return; const files = window.toolbox?.files; if (files?.saveTextSupportsCopyOnly !== true || typeof files.saveText !== 'function') { message('当前宿主缺少支持副本保护的保存接口，已阻止导出。'); return; } const selected = preview; const ticket = generation; exporting = true; renderPreview();
      try { const saved = await files.saveText({ ...selected, copyOnly: true }); if (destroyed || ticket !== generation || preview !== selected) return; if (saved?.ok === true) message('已保存日历新副本，源文件未修改。'); else if (saved?.canceled === true) message('已取消保存；预览与去重判定保留。'); else message('保存失败；预览与去重判定保留，可重试。'); }
      catch { if (!destroyed && ticket === generation && preview === selected) message('保存失败；预览与去重判定保留，可重试。'); }
      finally { if (!destroyed) { exporting = false; renderPreview(); } }
    }
    async function readFile(control) { const selected = control.files?.[0]; control.value = ''; if (!active || destroyed || document.hidden || !selected || pending) return; invalidate(); const ticket = generation; pending = true; update(); message('读取用户选择的本地 UTF-8 ICS，可以取消。');
      try { if (!Number.isSafeInteger(selected.size) || selected.size < 0 || selected.size > LIMITS.inputBytes) throw new CalendarError('size', '文件超过 1 MiB 或大小无效，未读取。'); if (typeof selected.arrayBuffer !== 'function') throw new CalendarError('fileAPI', '当前环境缺少 File.arrayBuffer，请粘贴文本。'); const buffer = await selected.arrayBuffer(); if (destroyed || ticket !== generation || !active || document.hidden) return; if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== selected.size) throw new CalendarError('size', '读取字节数不一致，未导入。'); let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new CalendarError('utf8', '文件不是有效 UTF-8，未导入，不猜测编码。'); } if (/\x00/.test(text)) throw new CalendarError('binary', '文件含零字节，拒绝导入。'); source.value = text; message('文件已读入当前内存，尚未校验；不会保留原路径。'); }
      catch (error) { if (!destroyed && ticket === generation) message(error instanceof CalendarError ? error.message : '读取失败，未导入。'); }
      finally { if (!destroyed) { pending = false; update(); } }
    }
    function example(name) { if (pending) return; source.value = EXAMPLES[name]; target.value = 'preserve'; edited(); inspect(); }
    function clear() { source.value = ''; file.value = ''; invalidate('源文本、校验、去重判定及副本全部清除。'); }
    function hide() { if (document.hidden && !destroyed) { if (pending) invalidate('面板隐藏，读取/校验已取消；返回后重新操作。'); else generation++; } }
    document.addEventListener('visibilitychange', hide);
    return { activate() { if (destroyed) return; active = true; update(); }, deactivate() { active = false; if (pending) invalidate('面板暂停，当前读取/校验已取消。'); else { generation++; update(); } }, destroy() { if (destroyed) return; destroyed = true; active = false; generation++; source.value = ''; file.value = ''; analysis = null; decisions = []; result = null; preview = null; document.removeEventListener('visibilitychange', hide); root.replaceChildren(); } };
  }
};
