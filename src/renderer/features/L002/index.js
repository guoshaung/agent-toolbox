import { h } from '../../core/ui.js';
import { buildReport, createSession, reportMarkdown, restoreSession, sampleExercise, submitReason, updateReflection } from './model.mjs';

const STORAGE_KEY = 'features.L002.state';
const lines = (value) => String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
const copy = (value) => JSON.parse(JSON.stringify(value));

export default {
  id: 'L002',
  create(root, ctx = {}) {
    root.classList.add('feature-l002');
    const saved = ctx.config?.get(STORAGE_KEY);
    let draft = sampleExercise();
    let session = null;
    let currentStep = 0;
    let view = 'practice';
    let reasonDraft = '';
    let selectedPremises = [];
    let timer = null;
    let destroyed = false;
    let exporting = false;
    let initialNotice = '';
    if (saved) {
      try {
        // A partially edited draft is retained only if its shape can render safely.
        if (saved.draft && typeof saved.draft.title === 'string' && typeof saved.draft.problem === 'string' && Array.isArray(saved.draft.premises) && Array.isArray(saved.draft.steps) && saved.draft.steps.length > 0 && saved.draft.steps.length <= 20 && saved.draft.steps.every((step) => step && ['title', 'prompt', 'answer', 'reason'].every((key) => typeof step[key] === 'string') && Array.isArray(step.premises))) draft = copy(saved.draft);
        if (saved.session) session = restoreSession(saved.session);
        currentStep = session && Number.isInteger(saved.currentStep) ? Math.max(0, Math.min(saved.currentStep, session.records.length, session.exercise.steps.length - 1)) : 0;
        view = saved.view === 'editor' ? 'editor' : 'practice';
        reasonDraft = typeof saved.reasonDraft === 'string' ? saved.reasonDraft : '';
        selectedPremises = session && Array.isArray(saved.selectedPremises) ? saved.selectedPremises.filter((value) => session.exercise.premises.includes(value)) : [];
      } catch (error) {
        initialNotice = `保存的练习未能恢复：${error.message} 可以重新开始，原配置不会在此刻覆盖。`;
      }
    }
    const notice = h('div', { class: 'l002-notice', role: 'status', 'aria-live': 'polite' }, initialNotice);
    const body = h('div', { class: 'l002-body' });
    const style = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });

    function message(value, error = false) {
      if (destroyed) return;
      notice.textContent = value;
      notice.classList.toggle('is-error', error);
    }
    function persist() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!ctx.config?.set) return;
      const state = copy({ draft, session, currentStep, view, reasonDraft, selectedPremises });
      try {
        Promise.resolve(ctx.config.set(STORAGE_KEY, state)).catch((error) => message(`当前记录仍在页面中，但本机保存失败：${error.message}`, true));
      } catch (error) { message(`当前记录仍在页面中，但本机保存失败：${error.message}`, true); }
    }
    function schedulePersist() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(persist, 250);
    }
    function field(label, value, oninput, { multiline = false, rows = 3, placeholder = '' } = {}) {
      const input = h(multiline ? 'textarea' : 'input', { class: 'field', rows: multiline ? rows : null, placeholder, maxlength: multiline ? '10000' : '200', oninput: () => { oninput(input.value); schedulePersist(); } });
      input.value = value || '';
      return h('label', { class: 'l002-field' }, h('span', {}, label), input);
    }
    function startExercise() {
      try {
        const pool = [...new Set([...draft.premises, ...draft.steps.flatMap((step) => step.premises)].map((value) => value.trim()).filter(Boolean))];
        session = createSession({ ...draft, premises: pool });
        draft = copy(session.exercise);
        currentStep = 0;
        reasonDraft = '';
        selectedPremises = [];
        view = 'practice';
        persist();
        message('新练习已开始。先说明依据，再解封参考内容；已完成的旧练习请在替换前导出。');
        render();
      } catch (error) { message(error.message, true); }
    }
    async function exportReport(format) {
      if (exporting || !session) return;
      try {
        const content = format === 'json' ? `${JSON.stringify(buildReport(session), null, 2)}\n` : reportMarkdown(session);
        if (!window.toolbox?.files?.saveText || !window.toolbox.files.saveTextSupportsCopyOnly) throw new Error('当前版本尚未提供防覆盖导出接口，请合入功能工作台基础层后再导出。');
        exporting = true;
        render();
        const result = await window.toolbox.files.saveText({ content, extension: format, defaultName: `例题步骤解封.${format}`, copyOnly: true });
        if (destroyed) return;
        if (result?.ok) message(`完整记录已导出：${result.path}`);
        else if (result?.canceled) message('已取消导出，练习记录保留。');
        else message(result?.error || '导出失败，练习记录保留。', true);
      } catch (error) { message(error.message, true); }
      finally { exporting = false; if (!destroyed) render(); }
    }
    function renderEditor() {
      const editor = h('section', { class: 'l002-editor' },
        h('h3', {}, '编辑例题'),
        h('p', { class: 'faint' }, '为每步填写提示、参考结果、理由和参考前提。提示在作答前展示，参考内容提交后展示。最多 20 步。'),
        field('例题标题', draft.title, (value) => { draft.title = value; }),
        field('题目与已知条件', draft.problem, (value) => { draft.problem = value; }, { multiline: true }),
        field('额外可选前提（每行一条）', draft.premises.join('\n'), (value) => { draft.premises = lines(value); }, { multiline: true, placeholder: '每步参考前提也会自动加入前提池；可添加其他候选前提。' }),
      );
      const stepEditors = h('div', { class: 'l002-step-editors' });
      draft.steps.forEach((step, index) => {
        const tools = h('div', { class: 'l002-row' }, h('strong', {}, `第 ${index + 1} 步`),
          h('button', { class: 'btn btn--sm', disabled: index === 0, onclick: () => { [draft.steps[index - 1], draft.steps[index]] = [draft.steps[index], draft.steps[index - 1]]; persist(); render(); } }, '上移'),
          h('button', { class: 'btn btn--sm', disabled: index === draft.steps.length - 1, onclick: () => { [draft.steps[index + 1], draft.steps[index]] = [draft.steps[index], draft.steps[index + 1]]; persist(); render(); } }, '下移'),
          h('button', { class: 'btn btn--sm btn--danger', disabled: draft.steps.length === 1, onclick: () => { draft.steps.splice(index, 1); persist(); render(); } }, '删除该步'));
        stepEditors.append(h('section', { class: 'l002-edit-step' }, tools,
          field('步骤标题', step.title, (value) => { step.title = value; }),
          field('提交前的提示', step.prompt, (value) => { step.prompt = value; }, { multiline: true, rows: 2 }),
          field('参考结果（提交后解封）', step.answer, (value) => { step.answer = value; }, { multiline: true, rows: 2 }),
          field('参考理由（提交后解封）', step.reason, (value) => { step.reason = value; }, { multiline: true, rows: 2 }),
          field('参考中采用的前提（每行一条，可为空）', step.premises.join('\n'), (value) => { step.premises = lines(value); }, { multiline: true, rows: 2 })));
      });
      const actions = h('div', { class: 'l002-row' },
        h('button', { class: 'btn', disabled: draft.steps.length >= 20, onclick: () => { draft.steps.push({ title: `步骤 ${draft.steps.length + 1}`, prompt: '', answer: '', reason: '', premises: [] }); persist(); render(); } }, '添加步骤'),
        h('button', { class: 'btn', onclick: () => { draft = { title: '', problem: '', premises: [], steps: [{ title: '步骤 1', prompt: '', answer: '', reason: '', premises: [] }] }; persist(); render(); } }, '清空编辑器'),
        h('button', { class: 'btn', onclick: () => { draft = sampleExercise(); persist(); render(); message('示例已载入编辑器；当前练习不变。'); } }, '载入三步示例'),
        h('button', { class: 'btn btn--primary', onclick: startExercise }, session ? '用此例题开始新练习' : '开始练习'));
      editor.append(stepEditors, session ? h('p', { class: 'l002-caution' }, '开始新练习会替换当前练习记录。需要保留时，先返回练习并导出已完成的记录；编辑本身不会改动当前练习。') : null, actions);
      body.append(editor);
    }
    function renderPractice() {
      if (!session) {
        body.append(h('section', { class: 'l002-welcome' }, h('span', { class: 'l002-kicker' }, 'SELF EXPLANATION'), h('h2', {}, '把每一步为什么成立说出来'),
          h('p', {}, '先尝试解释，再解封参考答案。保留最初的理由和前提选择，回看时分清当时会的与后来补上的。'),
          h('p', { class: 'faint' }, '内置三步方程示例，也可以编辑自己的例题。完整练习可导出 JSON 或 Markdown。'),
          h('div', { class: 'l002-row' }, h('button', { class: 'btn btn--primary', onclick: () => { draft = sampleExercise(); startExercise(); } }, '开始三步示例'), h('button', { class: 'btn', onclick: () => { view = 'editor'; persist(); render(); } }, '编写自己的例题'))));
        return;
      }
      const exercise = session.exercise;
      const completed = session.records.length;
      const record = session.records[currentStep];
      const step = exercise.steps[currentStep];
      const nav = h('nav', { class: 'l002-step-nav', 'aria-label': '练习步骤' });
      exercise.steps.forEach((item, index) => nav.append(h('button', { class: `l002-nav-step${index === currentStep ? ' is-current' : ''}`, disabled: index > completed, 'aria-current': index === currentStep ? 'step' : null, onclick: () => { currentStep = index; persist(); render(); } }, h('span', {}, index < completed ? '✓' : String(index + 1)), h('span', {}, item.title), h('small', {}, index < completed ? '已解封' : index > completed ? '待前一步完成' : '先写依据'))));
      const task = h('section', { class: 'l002-task' }, h('span', { class: 'l002-kicker' }, `STEP ${currentStep + 1} / ${exercise.steps.length}`), h('h3', {}, step.title), h('p', { class: 'l002-pre' }, step.prompt));
      if (!record) {
        const explanation = h('textarea', { class: 'field l002-explanation', rows: '5', maxlength: '10000', 'aria-label': '自己的依据', placeholder: '写下你会做的操作，以及为什么这样做仍成立。只写空白不能解封。', oninput: () => { reasonDraft = explanation.value; unlock.disabled = !reasonDraft.trim(); schedulePersist(); } });
        explanation.value = reasonDraft;
        const pool = h('fieldset', { class: 'l002-premises' }, h('legend', {}, '标记采用的前提（可不选，提交后核对）'));
        exercise.premises.forEach((value) => {
          const checkbox = h('input', { type: 'checkbox', onchange: () => { selectedPremises = checkbox.checked ? [...new Set([...selectedPremises, value])] : selectedPremises.filter((item) => item !== value); schedulePersist(); } });
          checkbox.checked = selectedPremises.includes(value);
          pool.append(h('label', {}, checkbox, h('span', {}, value)));
        });
        if (!exercise.premises.length) pool.append(h('p', { class: 'faint' }, '本例题没有设置前提；仍需写出自己的依据。'));
        const unlock = h('button', { class: 'btn btn--primary', disabled: !reasonDraft.trim(), onclick: () => {
          try {
            session = submitReason(session, currentStep, explanation.value, selectedPremises);
            reasonDraft = '';
            selectedPremises = [];
            persist();
            render();
            message('原始依据已锁定保存。现在可对照参考内容，并另写反思。');
          } catch (error) { message(error.message, true); }
        } }, '提交依据，解封本步');
        task.append(h('label', { class: 'l002-field' }, h('span', {}, '自己的依据'), explanation), pool, unlock, h('p', { class: 'faint' }, '参考结果和理由尚未解封。提交后的原始依据不再改写；下一步须先完成本步。'));
      } else {
        task.append(h('div', { class: 'l002-comparison' },
          h('section', {}, h('h4', {}, '提交时的原始依据'), h('p', { class: 'l002-pre' }, record.originalReason), h('small', { class: 'faint' }, record.submittedAt), h('h4', {}, '当时采用的前提'), list(record.selectedPremises, '未选择前提。')),
          h('section', {}, h('h4', {}, '参考结果'), h('p', { class: 'l002-pre' }, record.referenceAnswer), h('h4', {}, '参考理由'), h('p', { class: 'l002-pre' }, record.referenceReason), h('h4', {}, '参考中采用的前提'), list(record.referencePremises, '未设置参考前提。'))),
          h('section', { class: 'l002-gaps' }, h('h4', {}, '参考中采用，但当时未选'), list(record.unselectedReferencePremises, '没有未选的参考前提。'), record.otherSelectedPremises.length ? h('div', {}, h('h4', {}, '你另选的前提'), list(record.otherSelectedPremises)) : null, h('p', { class: 'faint' }, '这是前提选择差异，不是自动判分。你的推理可能采用其他合理依据；请结合参考内容自查。')),
          field('后续反思：漏掉了哪段推理？有哪些其他合理依据？', record.reflection, (value) => { session = updateReflection(session, currentStep, value); }, { multiline: true, rows: 3 }));
        if (currentStep < exercise.steps.length - 1) task.append(h('button', { class: 'btn btn--primary', onclick: () => { currentStep += 1; persist(); render(); } }, '进入下一步'));
      }
      body.append(h('div', { class: 'l002-exercise-heading' }, h('h2', {}, exercise.title), h('p', { class: 'l002-pre' }, exercise.problem), h('div', { class: 'l002-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(exercise.steps.length), 'aria-valuenow': String(completed) }, h('span', { style: { width: `${completed / exercise.steps.length * 100}%` } })), h('p', { class: 'faint' }, `已解封 ${completed} / ${exercise.steps.length} 步`)), h('div', { class: 'l002-workspace' }, nav, task));
      const complete = completed === exercise.steps.length;
      body.append(h('section', { class: 'l002-results' }, h('h3', {}, complete ? '完整练习记录' : '完成全部步骤后导出'), h('p', { class: 'faint' }, complete ? `${completed} 条原始依据已保留，后续反思单独列出。前提差异可回到各步查看。` : '导出仅在完成后开放，未提交的参考理由不会通过导出提前展示。'),
        complete ? h('ol', {}, session.records.map((item) => h('li', {}, `${item.title}：未选参考前提 ${item.unselectedReferencePremises.length} 条；${item.reflection ? '已写反思' : '尚未写反思'}`))) : null,
        h('div', { class: 'l002-row' }, h('button', { class: 'btn', disabled: !complete || exporting, onclick: () => exportReport('json') }, '导出 JSON 原始记录'), h('button', { class: 'btn', disabled: !complete || exporting, onclick: () => exportReport('md') }, '导出 Markdown 复盘'))));
    }
    function list(values, empty = '无。') { return values.length ? h('ul', {}, values.map((value) => h('li', {}, value))) : h('p', { class: 'faint' }, empty); }
    function render() {
      body.replaceChildren();
      if (view === 'editor') renderEditor();
      else renderPractice();
    }
    root.append(style, h('header', { class: 'l002-header' }, h('div', {}, h('h2', {}, '例题步骤解封'), h('p', { class: 'faint' }, '主动学习与理解 · 本地保存 · 无需 AI')),
      h('div', { class: 'l002-row' }, h('button', { class: 'btn', onclick: () => { view = 'practice'; persist(); render(); } }, '练习与记录'), h('button', { class: 'btn', onclick: () => { view = 'editor'; persist(); render(); } }, '编辑例题'))), notice, body);
    render();
    return {
      activate() { if (!destroyed) render(); },
      deactivate() { persist(); },
      destroy() { persist(); destroyed = true; if (timer) clearTimeout(timer); timer = null; root.replaceChildren(); root.classList.remove('feature-l002'); },
    };
  },
};
