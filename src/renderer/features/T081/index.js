import { h } from '../../core/ui.js';
import { COMMON_ZONES, LIMITS, buildPlan, invitationText, localView, utcText } from './model.mjs';

const CSS = `
.t081{height:100%;overflow:auto;padding:24px;max-width:1440px;margin:auto;color:var(--text)}.t081 h2,.t081 h3{margin:0 0 10px}.t081 p{line-height:1.65}
.t081__note{font-size:12px;color:var(--text-dim);line-height:1.6}.t081__row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
.t081__field{display:flex;flex-direction:column;gap:6px;flex:1;min-width:150px}.t081 .field{background:var(--bg-sunken);border:1px solid var(--line);border-radius:6px;padding:9px;width:100%}
.t081__person{border-top:1px solid var(--line);padding:16px 0}.t081__window{padding:12px;background:var(--bg-sunken);margin:10px 0}.t081__window h4{margin:0}
.t081__grid{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:10px}.t081__offsets{display:flex;gap:10px;margin-top:10px}.t081__status{min-height:26px;margin:14px 0;color:var(--text-dim)}.t081__status[data-error=true]{color:var(--bad)}
.t081__section{border-top:1px solid var(--line);padding:20px 0}.t081__scroll{max-height:460px;overflow:auto;border:1px solid var(--line)}.t081 table{border-collapse:collapse;width:100%;font-size:12px}
.t081 th,.t081 td{text-align:left;padding:10px;vertical-align:top;border-bottom:1px solid var(--line);white-space:pre-wrap;min-width:120px}.t081 th{position:sticky;top:0;background:var(--bg-raised)}
.t081__invitation{width:100%;min-height:180px;font-family:var(--mono);line-height:1.65;resize:vertical}.t081 button:disabled{opacity:.5;cursor:not-allowed}
@media(max-width:850px){.t081__grid{grid-template-columns:repeat(2,minmax(120px,1fr))}.t081{padding:16px}}
`;
const span = (date, startTime, endTime, endDate = date) => ({ startDate: date, startTime, endDate, endTime, startOffset: 'Z', endOffset: 'Z' });
const londonExample = () => [
  { name: '伦敦团队', timeZone: 'Europe/London', mode: 'local', windows: [span('2026-07-01', '09:00', '12:00')] },
  { name: '香港团队', timeZone: 'Asia/Hong_Kong', mode: 'local', windows: [span('2026-07-01', '16:00', '18:00')] },
];
const crossDayExample = () => [
  { name: '洛杉矶团队', timeZone: 'America/Los_Angeles', mode: 'local', windows: [span('2026-07-01', '16:00', '18:00')] },
  { name: '香港团队', timeZone: 'Asia/Hong_Kong', mode: 'local', windows: [span('2026-07-02', '07:00', '09:00')] },
];
let nextInstance = 0;

export default {
  id: 'T081',
  create(root, _ctx) {
    const instance = ++nextInstance;
    let people = londonExample(), plan = null, selectedIndex = 0, controller = null, busy = false, destroyed = false;
    const wrapper = h('div', { class: 't081' });
    const personHost = h('div');
    const status = h('div', { class: 't081__status', role: 'status', 'aria-live': 'polite' });
    const title = h('input', { class: 'field', type: 'text', value: '跨时区会议', maxlength: 120, 'aria-label': '会议标题', oninput: () => refreshInvitation() });
    const duration = h('input', { class: 'field', type: 'number', min: 1, max: 1440, step: 1, value: 30, 'aria-label': '会议时长分钟', oninput: () => invalidate() });
    const step = h('input', { class: 'field', type: 'number', min: 1, max: 120, step: 1, value: 15, 'aria-label': '候选间隔分钟', oninput: () => invalidate() });
    const invitation = h('textarea', { class: 'field t081__invitation', readonly: true, 'aria-label': '邀请文本预览', spellcheck: 'false' });
    const windowsHost = h('div'), resolvedHost = h('div'), meetingHost = h('div');
    const suggestion = h('select', { class: 'field', 'aria-label': '选择会议候选', onchange: () => { selectedIndex = Number(suggestion.value); renderMeeting(); refreshInvitation(); } });
    const calculateButton = h('button', { class: 'btn btn--primary', onclick: () => calculate() }, '计算公共窗口');
    const cancelButton = h('button', { class: 'btn', hidden: true, onclick: () => cancel() }, '取消计算');
    const addPersonButton = h('button', { class: 'btn', onclick: () => {
      if (people.length >= LIMITS.people) return;
      const date = people[0]?.windows[0]?.startDate || '2026-07-01';
      people.push({ name: `参与者${people.length + 1}`, timeZone: 'UTC', mode: 'local', windows: [span(date, '09:00', '17:00')] });
      invalidate(); renderPeople();
    } }, '添加参与者');
    const copyButton = h('button', { class: 'btn', disabled: true, onclick: () => copyInvitation() }, '复制邀请文本');
    const saveButton = h('button', { class: 'btn btn--primary', disabled: true, onclick: () => saveCopy(false) }, '保存邀请副本');
    const reportButton = h('button', { class: 'btn', disabled: true, onclick: () => saveCopy(true) }, '保存窗口报告');
    const field = (label, element) => h('label', { class: 't081__field' }, h('span', {}, label), element);
    const zoneListId = `t081-zones-${instance}`;
    let zones = [...COMMON_ZONES];
    try { if (typeof Intl.supportedValuesOf === 'function') zones = [...new Set([...zones, ...Intl.supportedValuesOf('timeZone')])].sort(); } catch { /* curated list plus free-form input remains usable */ }
    wrapper.append(
      h('style', {}, CSS), h('h2', {}, '跨时区会议窗口'),
      h('p', { class: 't081__note' }, '为每位参与者填写明确的可用区间。计算后同时核对 UTC 和各地日期、时刻、偏移；邀请文本可复制或保存。初始为 2026 年 7 月伦敦与香港示例。'),
      h('datalist', { id: zoneListId }, ...zones.map(zone => h('option', { value: zone }))),
      h('div', { class: 't081__row' }, field('会议标题', title), field('会议时长（分钟）', duration), field('候选起点间隔（分钟）', step)),
      h('div', { class: 't081__row' }, h('button', { class: 'btn btn--sm', onclick: () => loadExample(false) }, '伦敦 / 香港示例'), h('button', { class: 'btn btn--sm', onclick: () => loadExample(true) }, '跨日示例')),
      personHost, h('div', { class: 't081__row' }, addPersonButton, calculateButton, cancelButton),
      h('p', { class: 't081__note' }, '当地时间使用所选 IANA 时区。夏令时不存在或重复的起止时刻会报错；重复时刻请切换明确偏移模式，例如纽约 UTC-04:00 与 UTC-05:00。跨日须填写结束日期，24:00 改填次日 00:00。最多 8 位参与者、每人 4 个区间、每区间实际跨度 7 天。'), status,
      h('section', { class: 't081__section' }, h('h3', {}, '输入区间核对'), resolvedHost),
      h('section', { class: 't081__section' }, h('h3', {}, '公共可用窗口'), windowsHost),
      h('section', { class: 't081__section' }, h('h3', {}, '选择会议时段'), suggestion, meetingHost),
      h('section', { class: 't081__section' }, h('h3', {}, '邀请预览与副本'), invitation, h('div', { class: 't081__row' }, copyButton, saveButton, reportButton), h('p', { class: 't081__note' }, '保存对话框展示最终路径，副本保护拒绝已有目标。这里生成文本和报告，不发送邀请。时区规则由当前应用运行环境提供，未来规则变化需在会议前复核。'))
    );
    root.replaceChildren(wrapper); renderPeople(); renderPlan(); syncControls();

    function setStatus(message, error = false) { if (destroyed) return; status.textContent = message; status.dataset.error = String(error); }
    function canSave() { return window.toolbox?.files?.saveTextSupportsCopyOnly === true && typeof window.toolbox?.files?.saveText === 'function'; }
    function syncControls() {
      for (const control of wrapper.querySelectorAll('input,select,button')) control.disabled = busy;
      for (const control of wrapper.querySelectorAll('[data-limit-disabled]')) control.disabled = busy || control.dataset.limitDisabled === 'true';
      cancelButton.hidden = !busy; cancelButton.disabled = false;
      addPersonButton.disabled = busy || people.length >= LIMITS.people;
      suggestion.disabled = busy || !plan?.suggestions.length;
      copyButton.disabled = busy || !invitation.value;
      saveButton.disabled = busy || !invitation.value || !canSave();
      reportButton.disabled = busy || !plan || !canSave();
    }
    function invalidate() { plan = null; selectedIndex = 0; invitation.value = ''; renderPlan(); setStatus('输入已更新，请重新计算公共窗口。'); syncControls(); }
    function loadExample(crossDay) { people = crossDay ? crossDayExample() : londonExample(); duration.value = '30'; step.value = '15'; invalidate(); renderPeople(); }
    function renderPeople() {
      personHost.replaceChildren(...people.map((person, index) => {
        const name = h('input', { class: 'field', type: 'text', maxlength: 80, value: person.name, 'aria-label': `参与者${index + 1}名称`, oninput: () => { person.name = name.value; invalidate(); } });
        const zone = h('input', { class: 'field', type: 'text', list: zoneListId, value: person.timeZone, 'aria-label': `参与者${index + 1}时区`, oninput: () => { person.timeZone = zone.value; invalidate(); } });
        const mode = h('select', { class: 'field', 'aria-label': `参与者${index + 1}输入模式`, onchange: () => { person.mode = mode.value; invalidate(); renderPeople(); } }, h('option', { value: 'local' }, '当地时间：按 IANA 时区解析'), h('option', { value: 'offset' }, '明确 UTC 偏移：所选时区仅展示'));
        mode.value = person.mode;
        const remove = h('button', { class: 'btn btn--sm', dataset: { limitDisabled: String(people.length <= 1) }, onclick: () => { if (people.length <= 1) return; people.splice(index, 1); invalidate(); renderPeople(); } }, '移除参与者');
        const windows = person.windows.map((window, windowIndex) => {
          const input = (key, type, label) => {
            const element = h('input', { class: 'field', type, value: window[key], ...(type === 'date' ? { min: '2000-01-01', max: '2100-12-31' } : type === 'time' ? { step: 60 } : { maxlength: 6, placeholder: 'Z 或 +08:00' }), 'aria-label': `参与者${index + 1}区间${windowIndex + 1}${label}`, oninput: () => { window[key] = element.value; invalidate(); } });
            return field(label, element);
          };
          return h('div', { class: 't081__window' }, h('div', { class: 't081__row' }, h('h4', {}, `可用区间 ${windowIndex + 1}`), h('button', { class: 'btn btn--sm', dataset: { limitDisabled: String(person.windows.length <= 1) }, onclick: () => { if (person.windows.length <= 1) return; person.windows.splice(windowIndex, 1); invalidate(); renderPeople(); } }, '移除区间')), h('div', { class: 't081__grid' }, input('startDate', 'date', '开始日期'), input('startTime', 'time', '开始时间'), input('endDate', 'date', '结束日期'), input('endTime', 'time', '结束时间')), h('div', { class: 't081__offsets', hidden: person.mode !== 'offset' }, input('startOffset', 'text', '开始 UTC 偏移'), input('endOffset', 'text', '结束 UTC 偏移')), h('p', { class: 't081__note' }, person.mode === 'offset' ? '日期与时刻按填写的偏移解释。所选 IANA 时区仅用于核对和邀请展示；开始、结束偏移可不同。' : '日期与时刻均为所选 IANA 时区的当地墙上时间。'));
        });
        return h('section', { class: 't081__person' }, h('h3', {}, `参与者 ${index + 1}`), h('div', { class: 't081__row' }, field('名称 / 城市标签', name), field('IANA 时区', zone), field('时间输入模式', mode), remove), ...windows, h('button', { class: 'btn btn--sm', dataset: { limitDisabled: String(person.windows.length >= LIMITS.windows) }, onclick: () => { if (person.windows.length >= LIMITS.windows) return; const date = person.windows.at(-1).endDate; person.windows.push(span(date, '09:00', '17:00')); invalidate(); renderPeople(); } }, '添加可用区间'));
      }));
      syncControls();
    }
    function cancel() { if (!controller) return; controller.abort(); setStatus('已取消当前时间计算。'); }
    async function calculate() {
      if (busy || destroyed) return;
      plan = null; selectedIndex = 0; renderPlan();
      const job = new AbortController(); controller = job; busy = true; syncControls(); setStatus('正在验证时间与计算交集…');
      try {
        const computed = await buildPlan(people, Number(duration.value), Number(step.value), { signal: job.signal, onProgress: progress => setStatus(`正在验证起止时刻… ${Math.round(progress * 100)}%`) });
        if (job.signal.aborted || destroyed) return;
        plan = computed; renderPlan();
        const outcome = !plan.windows.length ? '这些可用区间没有公共交集，请调整输入。' : !plan.suggestions.length ? '有公共窗口，但不足以容纳所选会议时长。' : `已找到 ${plan.windows.length} 个公共窗口、${plan.totalSuggestions} 个候选起点${plan.truncated ? '，展示前200个' : ''}。请核对各地日期与偏移。`;
        setStatus(outcome + (canSave() ? '' : ' 当前应用缺少副本保护保存接口，可复制邀请文本；导出需更新基础工作台。'));
      } catch (error) {
        const candidates = error.candidates?.length ? ` 候选UTC：${error.candidates.map(candidate => candidate.utc).join('；')}` : '';
        setStatus(error.name === 'AbortError' ? '已取消当前时间计算。' : error.message + candidates, error.name !== 'AbortError');
      } finally { if (controller === job) { controller = null; busy = false; if (!destroyed) syncControls(); } }
    }
    function tableView(headers, rows) {
      return h('div', { class: 't081__scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...headers.map(header => h('th', {}, header)))), h('tbody', {}, ...rows.map(row => h('tr', {}, ...row.map(value => h('td', {}, value)))))));
    }
    function renderPlan() {
      resolvedHost.replaceChildren(); windowsHost.replaceChildren(); meetingHost.replaceChildren(); suggestion.replaceChildren(); invitation.value = '';
      if (!plan) { resolvedHost.append(h('p', { class: 't081__note' }, '计算后，这里列出每个输入区间的UTC及各地实际日期。')); windowsHost.append(h('p', { class: 't081__note' }, '尚未计算公共窗口。')); return; }
      resolvedHost.append(tableView(['参与者 / 输入模式', '开始 UTC', '结束 UTC', '当地开始', '当地结束'], plan.people.flatMap(person => person.intervals.map(interval => [person.name + (person.inputMode === 'offset' ? ' / 明确偏移' : ' / 当地时间'), utcText(interval.start), utcText(interval.end), interval.startLocal.text, interval.endLocal.text]))));
      if (!plan.windows.length) windowsHost.append(h('p', { class: 't081__note' }, '没有公共交集。'));
      else windowsHost.append(tableView(['公共窗口 / 实际分钟', 'UTC 起止', ...plan.people.map(person => person.name)], plan.windows.map((window, index) => [`${index + 1} / ${window.availableMinutes}分钟\n${window.fits ? '可容纳会议' : '不足会议时长'}`, `${utcText(window.start)}\n→ ${utcText(window.end)}`, ...plan.people.map(person => `${localView(window.start, person.timeZone).text}\n→ ${localView(window.end, person.timeZone).text}`)])));
      suggestion.replaceChildren(...plan.suggestions.map((meeting, index) => h('option', { value: index }, `${index + 1}. ${utcText(meeting.start)} → ${utcText(meeting.end)}（公共窗口${meeting.windowIndex + 1}）`)));
      suggestion.value = String(selectedIndex);
      if (plan.truncated) meetingHost.append(h('p', { class: 't081__note' }, `共${plan.totalSuggestions}个候选，最多显示前${LIMITS.suggestions}个。可增大间隔或缩小区间再计算。`));
      renderMeeting(); refreshInvitation();
    }
    function renderMeeting() {
      meetingHost.replaceChildren();
      if (!plan?.suggestions[selectedIndex]) { meetingHost.append(h('p', { class: 't081__note' }, '没有足够时长的会议候选。')); return; }
      const meeting = plan.suggestions[selectedIndex];
      if (plan.truncated) meetingHost.append(h('p', { class: 't081__note' }, `展示前${LIMITS.suggestions}个候选，共${plan.totalSuggestions}个。`));
      meetingHost.append(tableView(['参与者', '会议开始（日期 / 偏移 / 时区）', '会议结束（日期 / 偏移 / 时区）'], plan.people.map(person => [person.name, localView(meeting.start, person.timeZone).text, localView(meeting.end, person.timeZone).text])));
    }
    function refreshInvitation() {
      invitation.value = '';
      if (plan?.suggestions[selectedIndex]) {
        try { invitation.value = invitationText(plan, selectedIndex, title.value); }
        catch (error) { setStatus(error.message, true); }
      }
      syncControls();
    }
    async function copyInvitation() {
      if (!invitation.value) return;
      try {
        if (typeof window.toolbox?.clipboard?.write === 'function') { await window.toolbox.clipboard.write(invitation.value); setStatus('邀请文本已复制。'); }
        else { invitation.focus(); invitation.select(); setStatus('邀请文本已选中，请按 Ctrl/Cmd+C 复制。'); }
      } catch (error) { setStatus(`复制失败：${error.message}。可在邀请文本中手动选择复制。`, true); }
    }
    async function saveCopy(report) {
      if (busy || !plan || !canSave() || (!report && !invitation.value)) return;
      busy = true; syncControls(); cancelButton.hidden = true;
      try {
        const extension = report ? 'json' : 'txt';
        const stem = title.value.trim().replace(/[\\/:*?"<>|\r\n]/gu, '_').slice(0, 80) || '跨时区会议';
        const content = report ? JSON.stringify({ feature: 'T081', title: title.value, input: people, selectedIndex, plan, selectedInvitation: invitation.value }, null, 2) : invitation.value;
        setStatus('请在保存对话框中核对新的副本路径。');
        const saved = await window.toolbox.files.saveText({ content, extension, defaultName: `${stem}.${report ? 'windows' : 'invitation'}.${extension}`, copyOnly: true });
        if (destroyed) return;
        if (saved?.ok) setStatus(`副本已保存：${saved.path}`);
        else if (saved?.canceled) setStatus('已取消保存。');
        else throw new Error(saved?.error || '未确认副本保存成功。');
      } catch (error) { setStatus(error.message, true); }
      finally { busy = false; if (!destroyed) syncControls(); }
    }
    return { activate() { if (!destroyed) syncControls(); }, deactivate() { cancel(); }, destroy() { cancel(); destroyed = true; people = []; plan = null; invitation.value = ''; root.replaceChildren(); } };
  },
};
