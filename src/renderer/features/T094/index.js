import { h } from '../../core/ui.js';
import { ContactError, LIMITS, FIELDS, parseCSV, mapCSV, suggestMapping, parseVCard, buildDataset, mergeCandidate, resolveDataset, serializeResult } from './model.mjs';

const TITLES = { name: '姓名', email: '邮箱', phone: '电话', address: '地址', note: '备注', unmapped: '未映射（保留审计）' };
const STATES = { pending: '未确认：保留原联系人', keep: '保留两条，本对不合并', merge: '已确认合并', coveredByOtherMerge: '共享 ID 已在其他确认合并中，本对不可继续合并' };
export default {
  id: 'T094',
  create(root) {
    let active = false; let destroyed = false; let generation = 0; let pending = false; let exporting = false;
    let sources = []; let nextId = 1; let draft = null; let mapping = []; let mappingInputs = []; let dataset = null; let decisions = []; let result = null; let proposal = null; let preview = null; let conflictPage = 0; let contactPage = 0;
    const style = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
    const status = h('p', { role: 'status', 'aria-live': 'polite', class: 't094-status' });
    const label = h('input', { type: 'text', maxlength: '80', value: '来源 1', 'aria-label': '来源名称', oninput: edited });
    const format = h('select', { 'aria-label': '来源格式', onchange: edited }, h('option', { value: 'csv' }, 'CSV'), h('option', { value: 'vcard' }, 'vCard 3.0')); format.value = 'csv';
    const file = h('input', { type: 'file', accept: '.csv,.vcf,.vcard,.txt', 'aria-label': '读取本地联系人文件', onchange: e => readFile(e.target) });
    const input = h('textarea', { rows: '8', 'aria-label': '来源联系人文本', placeholder: 'CSV 表头加数据，或 BEGIN:VCARD … END:VCARD', oninput: edited });
    const parseButton = button('解析当前来源', parseDraft);
    const addButton = button('确认映射并加入来源', addSource);
    const compareButton = button('重新核对全部来源', compare);
    const cancelButton = button('取消核对或读取', () => invalidate('任务已取消，未保留部分核对；等待当前异步操作结束。'));
    const mappingHost = h('section', { class: 't094-mapping' }); const sourcesHost = h('section', {}); const dataHost = h('section', {}); const conflictsHost = h('section', {}); const proposalHost = h('section', { class: 't094-proposal' }); const previewHost = h('section', {});
    const shell = h('section', { class: 'feature-t094', 'aria-label': '联系人迁移与冲突核对' }, h('h2', {}, '联系人迁移与冲突核对'), h('p', {}, '本地导入、人工核对、保存新副本。未确认候选保留原联系人；不会访问云通讯录或修改源文件。'),
      h('div', { class: 't094-inputs' }, field('来源名称', label), field('格式', format), field('单个 UTF-8 文件，可反复加入不同来源', file)), input,
      h('p', { class: 't094-muted' }, '合计 1 MiB / 10 个来源 / 1000 联系人；CSV 100 列、单元格 65536 字符。vCard 仅 3.0 基础文本，不接受 ENCODING 或非 UTF-8 CHARSET；其他版本或错误编码会阻止整来源导入。输入只留当前面板内存。'),
      h('div', { class: 't094-actions' }, parseButton, button('填入来源 A 演示', () => sample('a')), button('填入来源 B 演示', () => sample('b')), button('清空当前草稿', clearDraft), button('清空所有来源与结果', clearAll)), mappingHost, addButton, status, sourcesHost,
      h('p', { class: 't094-rule' }, '邮箱只将比较用域名转小写，local-part 保留大小写，不猜测别名。电话按修剪首尾空白后的原格式精确比较，不推断国家码。同名只是候选；任何候选都不自动合并。'),
      h('div', { class: 't094-actions' }, compareButton, cancelButton), dataHost, conflictsHost, proposalHost, previewHost,
      h('p', { class: 't094-muted' }, '导出包含未映射字段原值及合并前记录，请核对分享范围。CSV 通过 metadata_json、vCard 通过 X-T094-METADATA 保留扩展信息，目标通讯录可能忽略它们；审计报告可另存。字段优先只决定姓名及并集顺序，合并不会丢弃另一条原记录。隐藏或暂停取消处理；切换功能清除未保存内存，不写全局配置。'));
    root.append(style, shell); renderSources(); update();
    function field(title, control) { return h('label', {}, h('span', {}, title), control); }
    function button(title, action) { return h('button', { type: 'button', onclick: e => { if (!active || destroyed || document.hidden || e.detail > 1) return; action(); } }, title); }
    function message(text) { if (!destroyed) status.textContent = text; }
    function clearPreview() { generation++; proposal = null; preview = null; proposalHost.replaceChildren(); previewHost.replaceChildren(); }
    function invalidate(text = '') { clearPreview(); dataset = null; decisions = []; result = null; conflictPage = 0; contactPage = 0; dataHost.replaceChildren(); conflictsHost.replaceChildren(); update(); if (text) message(text); }
    function edited() { if (!active || destroyed) return; draft = null; mapping = []; mappingInputs = []; mappingHost.replaceChildren(); invalidate('对照输入已修改，旧人工判定及预览全部废弃。解析草稿、加入来源后重新核对。'); }
    function update() { if (destroyed) return; label.disabled = !active; input.disabled = !active; format.disabled = !active; file.disabled = !active || pending; parseButton.disabled = !active || pending; addButton.disabled = !active || pending || !draft; compareButton.disabled = !active || pending || !sources.length; cancelButton.disabled = !active || !pending; mappingInputs.forEach(control => { control.disabled = !active; }); }
    function sourceInfo() { if (nextId > 9999) throw new ContactError('ids', '本面板来源编号已达限额，请导出后清空全部来源。'); return { id: `S${String(nextId).padStart(3, '0')}`, label: label.value }; }
    function parseDraft() {
      if (pending) return; draft = null; mapping = []; mappingInputs = []; mappingHost.replaceChildren(); invalidate();
      try { draft = format.value === 'csv' ? { format: 'csv', parsed: parseCSV(input.value, sourceInfo()), text: input.value } : { format: 'vcard', parsed: parseVCard(input.value, sourceInfo()), text: input.value }; if (draft.format === 'csv') { mapping = suggestMapping(draft.parsed.headers); renderMapping(); message(`CSV 已解析 ${draft.parsed.records.length} 条。建议映射需你确认，未映射列会完整保留审计。`); } else { mappingHost.append(h('p', {}, `已解析 ${draft.parsed.contacts.length} 张 vCard 3.0；未映射及参数信息：${draft.parsed.contacts.reduce((n, c) => n + c.unmapped.length, 0)} 项。`)); message('来源已解析，确认范围后加入；尚未核对其他来源。'); } }
      catch (error) { message(error instanceof ContactError ? error.message : '解析失败，未加入来源。'); }
      update();
    }
    function renderMapping() {
      mappingHost.replaceChildren(); mappingInputs = []; if (!draft || draft.format !== 'csv') return; const owner = draft;
      const body = h('tbody', {}); draft.parsed.headers.forEach((header, col) => { const select = h('select', { 'aria-label': `第 ${col + 1} 列映射`, onchange: e => { if (!active || destroyed || draft !== owner) return; mapping[col] = e.target.value; invalidate('CSV 映射已改变，旧人工判定及预览废弃。'); } }, ['unmapped', ...FIELDS].map(value => h('option', { value }, TITLES[value]))); select.value = mapping[col]; mappingInputs.push(select); body.append(h('tr', {}, h('td', {}, `第 ${col + 1} 列`), h('td', {}, header), h('td', {}, select))); });
      mappingHost.append(h('h3', {}, 'CSV 字段映射'), h('p', {}, '姓名最多一列；邮箱/电话列每个单元格按一个值处理，不自动拆分列表。来源字段与物理起止行会保留，未映射列不丢弃。'), h('table', {}, h('thead', {}, h('tr', {}, ['列', '原字段名', '映射'].map(t => h('th', {}, t)))), body));
    }
    function addSource() {
      if (!draft || pending) return;
      try { const prepared = draft.format === 'csv' ? mapCSV(draft.parsed, mapping) : draft.parsed;
        if (sources.length >= LIMITS.sources || sources.reduce((n, s) => n + s.prepared.source.inputBytes, 0) + prepared.source.inputBytes > LIMITS.inputBytes || sources.reduce((n, s) => n + s.prepared.contacts.length, 0) + prepared.contacts.length > LIMITS.contacts) throw new ContactError('limits', '加入后超过 10 来源、1 MiB 或 1000 联系人限额，未加入。');
        sources.push({ prepared, text: draft.text, format: draft.format }); nextId++; draft = null; mapping = []; mappingInputs = []; mappingHost.replaceChildren(); input.value = ''; file.value = ''; label.value = `来源 ${nextId}`; invalidate(); renderSources(); message(`已加入 ${prepared.source.id}：${prepared.contacts.length} 条。请继续加入来源，或重新核对全部来源。`);
      } catch (error) { message(error instanceof ContactError ? error.message : '来源加入失败。'); } update();
    }
    function renderSources() {
      sourcesHost.replaceChildren(); sourcesHost.append(h('h3', {}, `已加入来源（${sources.length}/10）`));
      for (const entry of sources) { const info = entry.prepared.source; sourcesHost.append(h('div', { class: 't094-source' }, h('span', {}, `${info.id} · ${info.label} · ${info.format} · ${info.records} 条`), button(`编辑 ${info.id}`, () => { if (!sources.includes(entry)) return; sources = sources.filter(s => s !== entry); input.value = entry.text; label.value = info.label; format.value = entry.format; edited(); renderSources(); message('该旧来源已从核对中移除，修改后解析并重新加入；会分配新 ID。'); }), button(`移除 ${info.id}`, () => { if (!sources.includes(entry)) return; sources = sources.filter(s => s !== entry); invalidate('来源已移除，全部旧判定废弃；请重新核对。'); renderSources(); }))); }
    }
    async function compare() {
      if (pending || !sources.length) return; invalidate(); const ticket = generation; const snapshot = sources.map(s => s.prepared); pending = true; update(); message('本地生成候选中，可以取消。');
      try { const next = await buildDataset(snapshot, { isCanceled: () => destroyed || ticket !== generation || !active || document.hidden, onProgress: p => { if (!destroyed && ticket === generation) message(`核对 ${p.processed}/${p.total} 条。`); } }); if (destroyed || ticket !== generation) return; dataset = next; decisions = []; result = resolveDataset(dataset); renderData(); renderConflicts(); message(`已核对 ${next.contacts.length} 条、发现 ${next.candidates.length} 对候选；未确认前全部保留。`); }
      catch (error) { if (!destroyed && ticket === generation) message(error instanceof ContactError ? error.message : '核对失败，未生成部分候选。'); }
      finally { if (!destroyed) { pending = false; update(); } }
    }
    function renderData() {
      dataHost.replaceChildren(); if (!result) return;
      const max = Math.max(0, Math.ceil(result.contacts.length / 20) - 1); contactPage = Math.min(contactPage, max);
      const body = h('tbody', {}, result.contacts.slice(contactPage * 20, contactPage * 20 + 20).map(c => h('tr', {}, h('td', {}, c.id), h('td', {}, c.name || '（未命名联系人）'), h('td', {}, c.emails.join('\n') || '—'), h('td', {}, c.phones.join('\n') || '—'), h('td', {}, c.provenance.map(p => `${p.sourceId} 记录 ${p.record} 行 ${p.startLine}–${p.endLine}`).join('\n')))));
      dataHost.append(h('h3', {}, '统一联系人预览'), h('p', {}, `原始 ${result.report.originalCount} 条 → 输出 ${result.contacts.length} 条；未确认候选 ${result.report.pendingCount} 对；未映射审计 ${result.report.unmapped.length} 项。待确认的合并预览尚未进入导出。`),
        h('div', { class: 't094-actions' }, button('联系人上一页', () => { if (contactPage > 0) { contactPage--; renderData(); } }), h('span', {}, `联系人 ${contactPage + 1}/${max + 1} 页，每页 20 条`), button('联系人下一页', () => { if (contactPage < max) { contactPage++; renderData(); } })), h('div', { class: 't094-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['ID', '姓名', '邮箱', '电话', '来源与物理行'].map(t => h('th', {}, t)))), body)),
        h('div', { class: 't094-actions' }, button('预览 JSON 副本', () => makePreview('json')), button('预览 CSV 副本', () => makePreview('csv')), button('预览 vCard 副本', () => makePreview('vcard')), button('预览冲突与未映射报告', () => makePreview('report'))));
    }
    function renderConflicts() {
      conflictsHost.replaceChildren(); if (!dataset) return; const owner = dataset; const max = Math.max(0, Math.ceil(dataset.candidates.length / 10) - 1); conflictPage = Math.min(conflictPage, max);
      conflictsHost.append(h('h3', {}, '逐条候选核对'), h('div', { class: 't094-actions' }, button('候选上一页', () => { if (dataset !== owner) return; if (conflictPage > 0) { conflictPage--; renderConflicts(); } }), h('span', {}, `候选 ${conflictPage + 1}/${max + 1} 页，每页 10 对`), button('候选下一页', () => { if (dataset !== owner) return; if (conflictPage < max) { conflictPage++; renderConflicts(); } })));
      if (!dataset.candidates.length) conflictsHost.append(h('p', {}, '当前规则未发现候选，仍请核对字段与未映射报告。'));
      for (const candidate of dataset.candidates.slice(conflictPage * 10, conflictPage * 10 + 10)) {
        const contacts = candidate.members.map(id => dataset.contacts.find(c => c.id === id)); const state = result.report.conflicts.find(c => c.id === candidate.id).status; const previous = decisions.find(d => d.candidateId === candidate.id); const priority = {};
        const choices = FIELDS.map(fieldName => { const select = h('select', { 'aria-label': `${candidate.id} ${TITLES[fieldName]}优先`, onchange: () => { if (dataset !== owner || !active) return; clearPreview(); message('优先来源已改变，请重新预览；尚未修改已确认判定。'); } }, contacts.map(c => h('option', { value: c.id }, `${c.id} · ${c.name || '未命名'}`))); select.value = previous?.priority?.[fieldName] || contacts[0].id; priority[fieldName] = select; return field(`${TITLES[fieldName]}优先`, select); });
        const keep = button(`保留两条 ${candidate.id}`, () => { if (dataset !== owner) return; decide({ candidateId: candidate.id, type: 'keep' }); });
        const merge = button(`预览合并 ${candidate.id}`, () => { if (dataset !== owner) return; try { const values = Object.fromEntries(FIELDS.map(f => [f, priority[f].value])); const decision = { candidateId: candidate.id, type: 'merge', priority: values }; resolveDataset(dataset, [...decisions.filter(d => d.candidateId !== candidate.id), decision]); clearPreview(); proposal = { owner, decision, contact: mergeCandidate(dataset, candidate.id, values) }; renderProposal(); message('正在预览拟合并联系人；点击确认才会减少输出条数，原记录保留在元数据。'); } catch (error) { message(error instanceof ContactError ? error.message : '合并预览失败。'); } });
        const blocked = state === 'coveredByOtherMerge'; keep.disabled = blocked; merge.disabled = blocked;
        conflictsHost.append(h('article', { class: 't094-candidate' }, h('h4', {}, `${candidate.id} · ${candidate.reasons.map(r => TITLES[r]).join(' / ')}匹配`), h('p', {}, STATES[state]), h('div', { class: 't094-pair' }, contacts.map(c => h('div', {}, h('strong', {}, `${c.id} · ${c.name || '未命名'}`), h('p', {}, `邮箱：${c.emails.join(' / ') || '—'}`), h('p', {}, `电话：${c.phones.join(' / ') || '—'}`), h('p', {}, `备注：${c.notes.join(' / ') || '—'}`)))), h('div', { class: 't094-priorities' }, choices), h('div', { class: 't094-actions' }, keep, merge, button(`撤销判定 ${candidate.id}`, () => { if (dataset !== owner) return; decisions = decisions.filter(d => d.candidateId !== candidate.id); result = resolveDataset(dataset, decisions); clearPreview(); renderData(); renderConflicts(); message('本候选判定已撤销，输出按当前其余判定重新生成。'); }))));
      }
    }
    function decide(decision) { if (!dataset || pending) return; try { const next = [...decisions.filter(d => d.candidateId !== decision.candidateId), decision]; const resolved = resolveDataset(dataset, next); decisions = next; result = resolved; clearPreview(); renderData(); renderConflicts(); message(decision.type === 'merge' ? '合并已确认，原始两条在合并元数据中保留。请重新预览副本。' : '本对保留两条、不合并。请重新预览副本。'); } catch (error) { message(error instanceof ContactError ? error.message : '判定失败。'); } }
    function renderProposal() { proposalHost.replaceChildren(); if (!proposal) return; const selected = proposal; const text = h('textarea', { rows: '10', readonly: true, 'aria-label': '待确认合并完整预览' }); text.value = JSON.stringify(selected.contact, null, 2); proposalHost.append(h('h3', {}, '待确认合并预览'), h('p', {}, '当前导出尚未应用这个合并。姓名取优先来源非空值；其他字段保留精确去重并集，原来源记录保留。'), text, button('确认此合并', () => { if (proposal !== selected || dataset !== selected.owner) return; decide(selected.decision); }), button('取消合并预览', () => { clearPreview(); message('未应用合并预览，联系人及已确认判定不变。'); })); }
    function makePreview(kind) { if (!result || pending) return; try { const content = serializeResult(result, kind); const extension = kind === 'vcard' ? 'vcf' : kind === 'csv' ? 'csv' : 'json'; preview = { content, extension, defaultName: kind === 'report' ? 'T094-conflicts-unmapped.json' : `T094-contacts.${extension}` }; renderPreview(); message('完整副本已预览；包含来源及未映射原值，请确认内容和实际保存路径。'); } catch (error) { preview = null; previewHost.replaceChildren(); message(error instanceof ContactError ? error.message : '副本生成失败。'); } }
    function renderPreview() { previewHost.replaceChildren(); if (!preview) return; const text = h('textarea', { rows: '12', readonly: true, 'aria-label': '联系人副本完整预览' }); text.value = preview.content; const save = button(exporting ? '正在保存…' : '保存当前预览新副本', savePreview); save.disabled = exporting; previewHost.append(h('h3', {}, '完整导出预览'), h('p', {}, `拟创建 ${preview.defaultName}；实际目标路径在原生保存对话框中确认。已有文件会被拒绝覆盖。CSV 的列表列使用 JSON；vCard 的扩展元数据可能被目标通讯录忽略，请同时保留 JSON 或审计报告。`), text, save); }
    async function savePreview() { if (!preview || pending || exporting) return; const files = window.toolbox?.files; if (files?.saveTextSupportsCopyOnly !== true || typeof files.saveText !== 'function') { message('当前宿主缺少支持副本保护的保存接口，已阻止导出。'); return; } const selected = preview; const ticket = generation; exporting = true; renderPreview();
      try { const saved = await files.saveText({ ...selected, copyOnly: true }); if (destroyed || ticket !== generation || preview !== selected) return; if (saved?.ok === true) message('已保存联系人新副本；源文件未修改。'); else if (saved?.canceled === true) message('已取消保存；预览与核对判定保留。'); else message('保存失败；预览与核对判定保留，可重试。'); }
      catch { if (!destroyed && ticket === generation && preview === selected) message('保存失败；预览与核对判定保留，可重试。'); }
      finally { if (!destroyed) { exporting = false; renderPreview(); } }
    }
    async function readFile(control) { const selected = control.files?.[0]; control.value = ''; if (!active || destroyed || document.hidden || !selected || pending) return; edited(); const ticket = generation; pending = true; update(); message('读取选择的本地文件，可以取消。');
      try { if (!Number.isSafeInteger(selected.size) || selected.size < 0 || selected.size > LIMITS.inputBytes) throw new ContactError('size', '文件超过 1 MiB 或大小无效，未读取。'); if (typeof selected.arrayBuffer !== 'function') throw new ContactError('fileAPI', '当前环境缺少 File.arrayBuffer，请粘贴文本。'); const buffer = await selected.arrayBuffer(); if (destroyed || ticket !== generation || !active || document.hidden) return; if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== selected.size) throw new ContactError('size', '文件读取字节数不一致，未导入。'); let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new ContactError('utf8', '文件不是有效 UTF-8，未导入，不猜测其他编码。'); } if (/\x00/.test(text)) throw new ContactError('binary', '文件含零字节，未导入。'); input.value = text; if (/\.(vcf|vcard)$/i.test(selected.name || '')) format.value = 'vcard'; else if (/\.csv$/i.test(selected.name || '')) format.value = 'csv'; label.value = String(selected.name || `来源 ${nextId}`).slice(0, 80); message('文件已读入内存，尚未加入，请解析并确认映射。'); }
      catch (error) { if (!destroyed && ticket === generation) message(error instanceof ContactError ? error.message : '本地文件读取失败，未导入。'); }
      finally { if (!destroyed) { pending = false; update(); } }
    }
    function clearDraft() { input.value = ''; file.value = ''; draft = null; mapping = []; mappingInputs = []; mappingHost.replaceChildren(); invalidate('草稿已清除，旧判定与预览废弃；已加入来源保留，可重新核对。'); }
    function clearAll() { sources = []; nextId = 1; label.value = '来源 1'; clearDraft(); renderSources(); message('所有来源、源文本、人工判定和结果已清除。'); }
    function sample(which) { if (pending) return; label.value = which === 'a' ? '设备 A' : '设备 B'; format.value = 'csv'; input.value = which === 'a' ? 'name,email,phone,tag\n林晓,lin@example.test,13800138000,旧设备标签\n' : 'name,email,phone,tag\n林小晓,lin@EXAMPLE.TEST,+8613800138000,新设备标签\n'; edited(); parseDraft(); }
    function hide() { if (document.hidden && !destroyed) { if (pending) invalidate('面板隐藏，核对/读取已取消；返回后重新操作。'); else generation++; } }
    document.addEventListener('visibilitychange', hide);
    return { activate() { if (destroyed) return; active = true; update(); }, deactivate() { active = false; if (pending) invalidate('面板暂停，当前核对/读取已取消。'); else { generation++; update(); } }, destroy() { if (destroyed) return; destroyed = true; active = false; generation++; input.value = ''; file.value = ''; sources = []; draft = null; mapping = []; mappingInputs = []; dataset = null; decisions = []; result = null; proposal = null; preview = null; document.removeEventListener('visibilitychange', hide); root.replaceChildren(); } };
  }
};
