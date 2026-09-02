import { h, toast } from '../../core/ui.js';
import { TERM_DOMAINS, buildTermPrompt, buildTermSystemPrompt, normalizeTermResult } from './prompt.js';

const HISTORY_LIMIT = 80;

function resultCard(result, { compact = false } = {}) {
  const evidence = result.evidence.length
    ? result.evidence.map((item, index) => h('div', { class: 'terms__evidence' },
      h('span', { class: 'terms__evidence-index' }, String(index + 1).padStart(2, '0')),
      h('span', {}, item),
    ))
    : [h('div', { class: 'faint' }, '这次没有返回可用依据。')];

  return h('article', { class: `terms__result${compact ? ' terms__result--compact' : ''}` },
    h('header', { class: 'terms__result-head' },
      h('div', {},
        h('div', { class: 'terms__eyebrow' }, 'TERM / EVIDENCE NOTE'),
        h('h2', { class: 'terms__term' }, result.term),
      ),
      h('button', {
        class: 'btn btn--sm btn--ghost',
        onclick: async () => {
          const text = `${result.term}\n${result.oneLine}\n\n${result.definition}`;
          await window.toolbox.clipboard.write(text);
          toast('解释已复制', 'good');
        },
      }, '复制'),
    ),
    h('p', { class: 'terms__one-line' }, result.oneLine),
    h('section', { class: 'terms__section' }, h('span', { class: 'terms__label' }, '准确解释'), h('p', {}, result.definition)),
    h('section', { class: 'terms__section' }, h('span', { class: 'terms__label' }, '为什么在这里'), h('p', {}, result.whyHere)),
    h('section', { class: 'terms__section' }, h('span', { class: 'terms__label' }, '证据链'), ...evidence),
    h('section', { class: 'terms__section' }, h('span', { class: 'terms__label' }, '最小例子'), h('p', {}, result.example)),
    h('div', { class: 'terms__foot-grid' },
      h('section', { class: 'terms__section' }, h('span', { class: 'terms__label' }, '歧义'), h('p', {}, result.ambiguity)),
      h('section', { class: 'terms__section' }, h('span', { class: 'terms__label' }, '确定性'), h('p', {}, result.uncertainty)),
    ),
    result.searchQueries.length ? h('section', { class: 'terms__section' },
      h('span', { class: 'terms__label' }, '继续搜索'),
      h('div', { class: 'terms__chips' }, result.searchQueries.map((query) => h('button', {
        class: 'tag terms__chip',
        onclick: () => window.toolbox.shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`),
      }, query))),
    ) : null,
    result.related.length ? h('div', { class: 'terms__related' }, result.related.map((item) => h('span', { class: 'tag' }, item))) : null,
  );
}

export default {
  id: 'terms',
  title: '术语',
  icon: 'scan',
  hint: '选词即查：工具内解释 + 全局外挂浮窗',

  create(root, ctx) {
    const { config, ai } = ctx;
    let history = config.get('terms.history', []);
    let busy = false;
    let domainId = config.get('terms.domainId', 'ai');
    let customDomain = config.get('terms.customDomain', '');

    const domainSelect = h('select', { class: 'field field--sm terms__domain-select', title: '限制术语解释的领域' },
      ...TERM_DOMAINS.map((domain) => h('option', { value: domain.id }, domain.label)),
    );
    domainSelect.value = TERM_DOMAINS.some((domain) => domain.id === domainId) ? domainId : 'ai';
    const customDomainInput = h('input', {
      class: 'field field--sm terms__custom-domain',
      placeholder: '例如：强化学习 / Linux 内核',
      value: customDomain,
      hidden: domainSelect.value !== 'custom',
    });
    function persistDomain() {
      domainId = domainSelect.value;
      customDomain = customDomainInput.value.trim().slice(0, 100);
      customDomainInput.hidden = domainId !== 'custom';
      config.set('terms.domainId', domainId);
      config.set('terms.customDomain', customDomain);
      domainHint.textContent = `当前锁定：${domainLabel()}`;
    }
    function domainLabel() {
      const selected = TERM_DOMAINS.find((domain) => domain.id === domainId);
      return selected?.id === 'custom' ? customDomain || '自定义领域未填写' : selected?.label || 'AI / 大模型';
    }
    const domainHint = h('span', { class: 'terms__domain-hint faint' }, `当前锁定：${domainLabel()}`);
    domainSelect.addEventListener('change', persistDomain);
    customDomainInput.addEventListener('change', persistDomain);

    const termInput = h('input', {
      class: 'field terms__term-input',
      placeholder: '输入术语、缩写或一小段陌生表达，例如：tool calling / RAG / hermetic build',
    });
    const contextInput = h('textarea', {
      class: 'field terms__context-input',
      rows: '3',
      placeholder: '可选：粘贴它出现的前后文。上下文越具体，解释越不容易跑偏。',
    });
    const output = h('div', { class: 'terms__output' },
      h('div', { class: 'empty terms__empty' }, '输入一个术语，或在 Codex / 浏览器 / VSCode 中选中文字后按快捷键。'),
    );
    const historyList = h('div', { class: 'terms__history-list' });
    const overlayState = h('span', { class: 'terms__overlay-state' });
    const overlayToggle = h('input', {
      type: 'checkbox',
      checked: config.get('terms.overlay.enabled', true),
      onchange: async () => {
        const result = await window.toolbox.terms.setOverlayEnabled(overlayToggle.checked);
        if (!result.ok) {
          overlayToggle.checked = !overlayToggle.checked;
          return toast(result.error, 'bad');
        }
        await config.set('terms.overlay.enabled', overlayToggle.checked);
        syncOverlayState(result);
      },
    });

    function syncOverlayState(state = {}) {
      if (typeof state.enabled === 'boolean') overlayToggle.checked = state.enabled;
      overlayState.textContent = overlayToggle.checked
        ? state.registered === false
          ? '快捷键被占用'
          : `已开启 · ${state.accelerator || window.toolbox.terms.shortcutLabel()}`
        : '已关闭';
      overlayState.classList.toggle('is-on', overlayToggle.checked && state.registered !== false);
    }

    async function saveHistory(result) {
      history = [{ ...result, at: new Date().toISOString() }, ...history.filter((item) => item.term !== result.term)].slice(0, HISTORY_LIMIT);
      await config.set('terms.history', history);
      renderHistory();
    }

    function renderHistory() {
      historyList.replaceChildren();
      if (!history.length) {
        historyList.append(h('div', { class: 'empty' }, '查过的术语会留在这里，方便反复看。'));
        return;
      }
      for (const item of history) {
        historyList.append(h('button', {
          class: 'terms__history-item',
          onclick: () => {
            output.replaceChildren(resultCard(normalizeTermResult(item, item.term)));
            termInput.value = item.term;
          },
        },
          h('span', { class: 'terms__history-term' }, item.term),
          h('span', { class: 'terms__history-line' }, item.oneLine),
        ));
      }
    }

    async function explain() {
      const text = termInput.value.trim();
      if (!text || busy) return;
      busy = true;
      explainBtn.disabled = true;
      output.replaceChildren(h('div', { class: 'terms__loading' }, h('span', { class: 'spinner' }), 'DeepSeek 正在建立证据链…'));
      try {
        const raw = await ai.json(buildTermPrompt(text, contextInput.value), {
          system: buildTermSystemPrompt({ domainId, customDomain }),
          timeout: 70000,
        });
        const result = normalizeTermResult(raw, text);
        output.replaceChildren(resultCard(result));
        await saveHistory(result);
      } catch (err) {
        output.replaceChildren(h('div', { class: 'empty' }, `解释失败：${err.message}`));
        if (err.code === 'need-login') toast('DeepSeek 登录已失效，先去「快问」登录一次。', 'bad');
      } finally {
        busy = false;
        explainBtn.disabled = false;
      }
    }

    const explainBtn = h('button', { class: 'btn btn--primary terms__explain', onclick: explain }, '建立解释');
    termInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        explain();
      }
    });

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '术语助手'),
        h('span', { class: 'faint' }, '先讲人话，再给依据'),
        h('span', { class: 'bar__spacer' }),
        h('span', { class: 'terms__domain-label' }, '解释领域'),
        domainSelect,
        customDomainInput,
        domainHint,
        h('label', { class: 'terms__switch' }, overlayToggle, h('span', {}, '外挂划词'), overlayState),
      ),
      h('div', { class: 'terms__layout' },
        h('main', { class: 'terms__main' },
          h('section', { class: 'terms__composer' },
            h('div', { class: 'terms__composer-mark' }, '⌁'),
            h('div', { class: 'terms__composer-fields' }, termInput, contextInput),
            explainBtn,
          ),
          h('div', { class: 'terms__shortcut-note' },
            h('strong', {}, `${window.toolbox.terms.shortcutLabel()}：`),
            '在 Codex、浏览器或 VSCode 中选中文字，按下快捷键，解释卡会出现在鼠标旁。首次使用 macOS 可能要求“辅助功能”权限。',
          ),
          output,
        ),
        h('aside', { class: 'terms__history' },
          h('div', { class: 'terms__history-head' },
            h('strong', {}, '最近查过'),
            h('button', {
              class: 'btn btn--sm btn--ghost',
              onclick: async () => {
                history = [];
                await config.set('terms.history', []);
                renderHistory();
              },
            }, '清空'),
          ),
          historyList,
        ),
      ),
    );

    renderHistory();
    window.toolbox.terms.status().then(syncOverlayState);
    window.addEventListener('toolbox:term-history-updated', (event) => {
      history = Array.isArray(event.detail) ? event.detail : history;
      renderHistory();
    });
    return {};
  },
};
