import { h, toast } from '../../core/ui.js';

const AUTO_LIMIT = 1000;

export default {
  id: 'translate',
  title: '翻译',
  icon: 'globe',
  hint: '粘贴即译的中英快译；显示耗时，不走模型额度',

  create(root, { config }) {
    let timer = null;
    let generation = 0;
    let lastTarget = '';

    const input = h('textarea', { class: 'field translate__area', placeholder: '输入或粘贴中文、英文…', maxlength: 20000,
      oninput: () => schedule(), onkeydown: event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void run(); }
      } });
    const output = h('textarea', { class: 'field translate__area translate__area--output', placeholder: '译文会出现在这里', readOnly: true });
    const target = h('select', { class: 'field translate__target', 'aria-label': '翻译目标语言', onchange: () => {
      config.set('translation.target', target.value); schedule(true);
    } },
      h('option', { value: 'auto' }, '自动判断中 / 英'),
      h('option', { value: 'zh-CHS' }, '译成中文'),
      h('option', { value: 'en' }, 'Translate to English'));
    target.value = ['auto', 'zh-CHS', 'en'].includes(config.get('translation.target', 'auto')) ? config.get('translation.target', 'auto') : 'auto';
    const instant = h('input', { type: 'checkbox' });
    instant.checked = config.get('translation.instant', true) !== false;
    instant.addEventListener('change', () => { config.set('translation.instant', instant.checked); schedule(); });
    const status = h('span', { class: 'translate__status', role: 'status' }, '粘贴后自动翻译，或按 ⌘ Enter。');
    const sourceCount = h('span', { class: 'faint translate__count' }, '0 / 20,000');
    const runButton = h('button', { class: 'btn btn--primary', onclick: () => void run() }, '立即翻译');

    function schedule(force = false) {
      clearTimeout(timer);
      generation++;
      runButton.disabled = false;
      sourceCount.textContent = `${input.value.length.toLocaleString()} / 20,000`;
      if (!input.value.trim()) { output.value = ''; status.textContent = '输入或粘贴内容即可开始。'; return; }
      if (!force && (!instant.checked || input.value.length > AUTO_LIMIT)) {
        status.textContent = input.value.length > AUTO_LIMIT ? '长文本按「立即翻译」，避免输入时重复发送。' : '按「立即翻译」或 ⌘ Enter。';
        return;
      }
      timer = setTimeout(() => void run(), force ? 0 : 450);
    }

    async function run() {
      clearTimeout(timer);
      const text = input.value.trim();
      if (!text) return toast('先输入要翻译的内容');
      const current = ++generation;
      runButton.disabled = true;
      status.textContent = '正在快译…';
      try {
        const result = await window.toolbox.translation.fast({ text, to: target.value });
        if (current !== generation) return;
        if (!result?.ok) throw Error(result?.error || '翻译失败');
        output.value = result.translation;
        lastTarget = result.to;
        status.textContent = `有道快译 · ${result.elapsedMs} 毫秒${result.chunks > 1 ? ` · ${result.chunks} 段` : ''}`;
      } catch (error) {
        if (current === generation) status.textContent = `翻译失败：${error.message}`;
      } finally {
        if (current === generation) runButton.disabled = false;
      }
    }

    async function paste() {
      const value = await window.toolbox.clipboard.read();
      if (!value) return toast('剪贴板没有文字');
      input.value = String(value).slice(0, 20000);
      schedule(); input.focus();
    }

    async function copy() {
      if (!output.value) return toast('还没有译文');
      await window.toolbox.clipboard.write(output.value);
      toast('译文已复制', 'good');
    }

    function swap() {
      if (!output.value) return toast('先翻译一次再交换');
      input.value = output.value;
      output.value = '';
      target.value = lastTarget === 'en' ? 'zh-CHS' : 'en';
      config.set('translation.target', target.value);
      schedule(true);
    }

    const bar = h('div', { class: 'bar bar--drag' }, h('strong', {}, '翻译'), h('span', { class: 'faint' }, '短句优先，粘贴即译'));
    const body = h('div', { class: 'translate__body' },
      h('div', { class: 'translate__toolbar' }, target,
        h('label', { class: 'translate__instant' }, instant, h('span', {}, '停顿即译（1,000 字内）')),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn btn--sm', onclick: () => void paste() }, '从剪贴板粘'),
        h('button', { class: 'btn btn--sm', onclick: () => { input.value = ''; output.value = ''; schedule(); input.focus(); } }, '清空'),
        runButton),
      h('div', { class: 'translate__panes' },
        h('section', { class: 'card translate__pane' }, h('div', { class: 'translate__pane-head' }, h('strong', {}, '原文'), sourceCount), input,
          h('p', { class: 'faint' }, '⌘ Enter 立即翻译 · 最多 20,000 字')),
        h('section', { class: 'card translate__pane' }, h('div', { class: 'translate__pane-head' }, h('strong', {}, '译文'),
          h('div', { class: 'translate__actions' }, h('button', { class: 'btn btn--sm', onclick: swap }, '交换语言'), h('button', { class: 'btn btn--sm', onclick: () => void copy() }, '复制译文'))),
          output, status)),
      h('p', { class: 'faint translate__disclosure' }, '在线快译会把原文发送至有道翻译服务；不使用 DSH 或额度中枢。翻译内容不存入工具箱历史。'));
    root.append(bar, body);
    return { deactivate() { clearTimeout(timer); generation++; runButton.disabled = false; } };
  },
};
