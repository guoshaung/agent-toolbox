import { h, toast } from '../../core/ui.js';
import { buildPrompt } from './prompt.js';

const MAX_HISTORY = 30;

export default {
  id: 'typing',
  title: '纠错',
  icon: 'pen',
  hint: '读懂打错的中文，拿不准就反问你（Cmd+3）',

  create(root, ctx) {
    const { config, bridge } = ctx;
    let lastRequest = null; // 反问时要拿回原文再问一轮

    const input = h('textarea', {
      class: 'field typing__input',
      placeholder: '把打错的中文粘进来或直接打在这里…\n\nCmd + Enter 纠正',
      onkeydown: (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
      },
    });

    const modeSelect = h('select', { class: 'field field--sm typing__mode' },
      h('option', { value: 'fix' }, '只纠错'),
      h('option', { value: 'polish' }, '纠错 + 顺句'),
    );
    modeSelect.value = config.get('typing.mode', 'fix');
    modeSelect.addEventListener('change', () => config.set('typing.mode', modeSelect.value));

    const threshold = h('input', {
      type: 'range', min: '0.3', max: '0.9', step: '0.05',
      value: String(config.get('typing.threshold', 0.6)),
      oninput: () => {
        thresholdLabel.textContent = Number(threshold.value).toFixed(2);
        config.set('typing.threshold', Number(threshold.value));
      },
    });
    const thresholdLabel = h('span', { class: 'faint mono' }, Number(threshold.value).toFixed(2));

    const runBtn = h('button', { class: 'btn btn--primary', onclick: () => run() }, '纠正');
    const output = h('div', { class: 'typing__output' });

    function showIdle() {
      output.textContent = '';
      output.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'empty__icon' }, '✍️'),
        '左边随便打，打错也没关系。',
        h('br'),
        h('span', { class: 'faint' }, '拿不准你想说什么的时候，它会反过来问你，而不是替你瞎猜。'),
      ));
    }

    function showBusy() {
      output.textContent = '';
      output.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'spinner' }), ' 正在读你的意思…',
        h('div', { class: 'faint typing__note' }, '走的是你自己登录的 DeepSeek 网页会话，不花钱，所以会比 API 慢几秒。'),
      ));
    }

    function showError(err) {
      output.textContent = '';
      const isLogin = err.code === 'need-login';
      output.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'empty__icon' }, isLogin ? '🔑' : '⚠️'),
        err.message,
        isLogin && h('div', { style: { marginTop: '14px' } },
          h('button', { class: 'btn btn--primary', onclick: () => ctx.goto('ask') }, '去登录 DeepSeek'),
        ),
      ));
    }

    /** 置信度够高 → 给结果；不够 → 把 AI 的反问摆出来，让用户补一句再来一轮。 */
    function showResult(result, original) {
      const confidence = Number(result.confidence);
      const limit = config.get('typing.threshold', 0.6);
      const unsure = !(confidence >= limit) || (result.question && !result.corrected);

      output.textContent = '';

      if (unsure) {
        const clarify = h('input', {
          class: 'field',
          placeholder: '用一句话说明你想表达什么，回车再试一次',
          onkeydown: (e) => {
            if (e.key !== 'Enter' || e.isComposing || !clarify.value.trim()) return;
            run({ clarification: clarify.value.trim(), text: original });
          },
        });
        output.append(
          h('div', { class: 'typing__card typing__card--ask' },
            h('div', { class: 'typing__card-head' },
              h('span', { class: 'tag tag--warn' }, `把握 ${Number.isFinite(confidence) ? confidence.toFixed(2) : '未知'}`),
              h('strong', {}, '这句我拿不准'),
            ),
            h('p', { class: 'typing__question' }, result.question || '原文的意思有多种解读，我不确定你想说哪一个。'),
            clarify,
            result.corrected && result.corrected !== original
              ? h('div', { class: 'typing__guess' }, h('span', { class: 'faint' }, '我的猜测（仅供参考）：'), result.corrected)
              : null,
          ),
        );
        setTimeout(() => clarify.focus(), 30);
        return;
      }

      const corrected = String(result.corrected ?? '');
      const changes = Array.isArray(result.changes) ? result.changes : [];

      output.append(
        h('div', { class: 'typing__card' },
          h('div', { class: 'typing__card-head' },
            h('span', { class: 'tag tag--good' }, `把握 ${confidence.toFixed(2)}`),
            h('strong', {}, changes.length ? `改了 ${changes.length} 处` : '没发现需要改的地方'),
            h('span', { style: { flex: 1 } }),
            h('button', {
              class: 'btn btn--sm btn--primary',
              onclick: async () => { await window.toolbox.clipboard.write(corrected); toast('已复制', 'good'); },
            }, '复制'),
            h('button', {
              class: 'btn btn--sm',
              onclick: () => { input.value = corrected; input.focus(); },
            }, '替换原文'),
          ),
          h('div', { class: 'typing__corrected' }, corrected),
        ),
        changes.length
          ? h('div', { class: 'typing__changes' },
              h('div', { class: 'typing__changes-head faint' }, '改了什么，为什么'),
              ...changes.map((c) => h('div', { class: 'typing__change' },
                h('span', { class: 'typing__from' }, c.from || ''),
                h('span', { class: 'typing__arrow' }, '→'),
                h('span', { class: 'typing__to' }, c.to || ''),
                h('span', { class: 'typing__why faint' }, c.why || ''),
              )),
            )
          : null,
      );

      saveHistory(original, corrected);
    }

    async function saveHistory(original, corrected) {
      const history = config.get('typing.history') || [];
      history.unshift({ at: Date.now(), original, corrected });
      await config.set('typing.history', history.slice(0, MAX_HISTORY));
      renderHistory();
    }

    const historyList = h('div', { class: 'typing__history' });
    function renderHistory() {
      const history = config.get('typing.history') || [];
      historyList.textContent = '';
      if (!history.length) {
        historyList.appendChild(h('div', { class: 'faint typing__note' }, '还没有记录'));
        return;
      }
      for (const item of history) {
        historyList.appendChild(
          h('div', { class: 'typing__history-item', title: item.original, onclick: () => { input.value = item.original; } },
            h('div', { class: 'typing__history-corrected' }, item.corrected),
            h('div', { class: 'faint typing__history-original' }, item.original),
          ),
        );
      }
    }

    async function run({ clarification = '', text = null } = {}) {
      const source = (text ?? input.value).trim();
      if (!source) return toast('先打点字', 'info');
      if (text) input.value = text;

      lastRequest = { source, clarification };
      runBtn.disabled = true;
      showBusy();
      try {
        const result = await bridge.askJSON(
          buildPrompt(source, { mode: modeSelect.value, clarification }),
          { timeout: 75000 },
        );
        showResult(result, source);
      } catch (err) {
        showError(err);
      } finally {
        runBtn.disabled = false;
      }
    }

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '打字纠错'),
        modeSelect,
        h('span', { class: 'subbar__sep' }),
        h('label', { class: 'subbar__label', title: '低于这个把握就反问你，而不是直接给结果' }, '反问阈值', threshold, thresholdLabel),
        h('span', { style: { flex: 1 } }),
        runBtn,
      ),
      h('div', { class: 'typing__body' },
        h('div', { class: 'typing__pane' },
          input,
          h('div', { class: 'typing__history-head faint' }, '最近'),
          historyList,
        ),
        h('div', { class: 'typing__pane typing__pane--out' }, output),
      ),
    );

    showIdle();
    renderHistory();

    return { activate: () => setTimeout(() => input.focus(), 30) };
  },
};
