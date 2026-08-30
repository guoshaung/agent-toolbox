import { h, toast } from '../../core/ui.js';
import { PROVIDERS } from '../../core/ai.js';

export default {
  id: 'settings',
  title: '设置',
  icon: '⚙︎',
  hint: 'AI 接口、桥接自检与维护（Cmd+6）',

  create(root, ctx) {
    const { config, bridge } = ctx;

    const probeOut = h('pre', { class: 'settings__probe mono' }, '还没检测');

    /**
     * 桥接自检。DeepSeek 改版是迟早的事，出问题时这里能立刻告诉你
     * 「是没登录，还是页面结构变了」，而不用去猜。
     */
    const probeBtn = h('button', {
      class: 'btn btn--primary',
      onclick: async () => {
        probeBtn.disabled = true;
        probeOut.textContent = '检测中…';
        try {
          const report = await bridge.probe();
          const verdict = report.ready
            ? '✅ 桥接正常，纠错和「帮我决定」可以用'
            : report.needLogin
              ? '🔑 未登录 —— 去「快问」里登录一次即可'
              : '⚠️ 页面上找不到输入框。可能是页面还没加载完，或 DeepSeek 改版了';
          probeOut.textContent = `${verdict}\n\n${JSON.stringify(report, null, 2)}`;
        } catch (err) {
          probeOut.textContent = `检测失败：${err.message}`;
        } finally {
          probeBtn.disabled = false;
        }
      },
    }, '检测桥接状态');

    const danger = (label, hint, fn) => h('div', { class: 'settings__row' },
      h('div', {},
        h('div', {}, label),
        h('div', { class: 'faint settings__hint' }, hint),
      ),
      h('button', { class: 'btn btn--sm', onclick: fn }, '执行'),
    );

    // ---- AI 接口：需求里说的「预留一个 ai 接口，后面导入」 ----
    const { ai } = ctx;

    const providerSelect = h('select', { class: 'field field--sm' },
      ...Object.entries(PROVIDERS).map(([id, meta]) => h('option', { value: id }, meta.label)));
    providerSelect.value = ai.provider;

    const apiFields = h('div', { class: 'settings__api' });
    const baseUrl = h('input', {
      class: 'field mono', placeholder: 'https://api.deepseek.com/v1',
      value: config.get('ai.api.baseUrl', ''),
      onchange: () => config.set('ai.api.baseUrl', baseUrl.value.trim()),
    });
    const apiKey = h('input', {
      class: 'field mono', type: 'password', placeholder: 'sk-...',
      value: config.get('ai.api.key', ''),
      onchange: () => config.set('ai.api.key', apiKey.value.trim()),
    });
    const model = h('input', {
      class: 'field mono', placeholder: 'deepseek-chat',
      value: config.get('ai.api.model', ''),
      onchange: () => config.set('ai.api.model', model.value.trim()),
    });

    const aiStatus = h('div', { class: 'faint settings__hint' }, '');
    function syncProvider() {
      apiFields.hidden = providerSelect.value !== 'openai-api';
      aiStatus.textContent = PROVIDERS[providerSelect.value]?.hint || '';
    }
    providerSelect.addEventListener('change', async () => {
      await config.set('ai.provider', providerSelect.value);
      syncProvider();
      toast(`AI 已切到：${PROVIDERS[providerSelect.value].label}`, 'good');
    });

    const testOut = h('pre', { class: 'settings__probe mono' }, '还没测试');
    const testBtn = h('button', {
      class: 'btn btn--primary',
      onclick: async () => {
        testBtn.disabled = true;
        testOut.textContent = `测试中…（${ai.describe()}）`;
        const started = Date.now();
        try {
          const reply = await ai.chat('只回复两个字：收到', { timeout: 60000 });
          testOut.textContent = `✅ 通了，用时 ${((Date.now() - started) / 1000).toFixed(1)}s\n\n模型回复：${reply.slice(0, 200)}`;
        } catch (err) {
          testOut.textContent = `❌ ${err.code || 'error'}：${err.message}`;
        } finally {
          testBtn.disabled = false;
        }
      },
    }, '测试当前 AI');

    apiFields.append(
      h('label', { class: 'settings__field' }, h('span', {}, 'Base URL'), baseUrl),
      h('label', { class: 'settings__field' }, h('span', {}, 'API Key'), apiKey),
      h('label', { class: 'settings__field' }, h('span', {}, '模型名'), model),
      h('div', { class: 'faint settings__hint' },
        'Base URL 填到 /v1 为止，不含 /chat/completions。常见：DeepSeek 官方 https://api.deepseek.com/v1（模型 deepseek-chat）；' +
        '本地 Ollama http://localhost:11434/v1。'),
      h('div', { class: 'faint settings__warn' },
        '注意：API Key 以明文存在本机的 config.json 里。这是个本地个人工具，没有做加密存储 —— 别填公司的生产 Key。'),
    );

    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '设置')),
      h('div', { class: 'settings__body' },
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, 'AI 接口'),
          h('p', { class: 'faint settings__hint' },
            '打字纠错、AI 出题、网站知识点整理都走这里。默认用你已登录的 DeepSeek 网页版（免费）；' +
            '以后想换成 API，在这里切一下就行，各个工具不用改。'),
          h('div', { class: 'settings__row settings__row--first' },
            h('div', {}, h('div', {}, '使用哪个'), aiStatus),
            providerSelect,
          ),
          apiFields,
          h('div', { class: 'settings__actions' }, testBtn),
          testOut,
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, 'DeepSeek 桥接'),
          h('p', { class: 'faint settings__hint' },
            '打字纠错和「帮我决定」都跑在一个隐藏的 DeepSeek 网页实例上，用的是你自己的登录态，不消耗 API 额度。' +
            '它和「快问」共用登录，登录一次两边都通。'),
          h('div', { class: 'settings__actions' },
            probeBtn,
            h('button', { class: 'btn', onclick: () => { bridge.reload(); toast('已重新加载桥接页面', 'good'); } }, '重载桥接'),
            h('button', { class: 'btn', onclick: () => ctx.goto('ask') }, '去登录'),
          ),
          probeOut,
        ),

        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '维护'),
          danger('清空纠错历史', '只删本地记录，不影响别的设置', async () => {
            await config.set('typing.history', []);
            toast('已清空', 'good');
          }),
          danger('清空专注记录', '番茄钟的历史统计', async () => {
            await config.set('focus.log', []);
            toast('已清空', 'good');
          }),
          danger('打开开发者工具', '看报错、调样式', () => window.toolbox.app.openDevTools()),
          danger('重载界面', '改了 renderer 里的代码后，不用重启 App', () => window.toolbox.app.reload()),
        ),

        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '关于'),
          h('p', { class: 'faint settings__hint' },
            '所有数据只存在本机的 userData/config.json 里，不上传任何地方。' +
            '需求与设计见仓库里的 docs/SPEC.md，加新工具见 docs/ADD-A-TOOL.md。'),
          h('p', { class: 'faint settings__hint' },
            '快捷键：Cmd+1…6 切工具，Cmd+F 页内查找，Cmd+L 定位地址栏，Cmd+Enter 触发纠错。'),
        ),
      ),
    );

    syncProvider();

    return {};
  },
};
