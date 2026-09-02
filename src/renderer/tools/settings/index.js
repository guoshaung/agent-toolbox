import { h, toast } from '../../core/ui.js';
import { PROVIDERS } from '../../core/ai.js';

export default {
  id: 'settings',
  title: '设置',
  icon: 'settings',
  hint: 'AI 接口、桥接自检与维护（Cmd+7）',

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
      class: 'field mono', type: 'password', placeholder: '输入新 Key（已保存内容不会回显）',
      autocomplete: 'new-password', value: '',
    });
    const model = h('input', {
      class: 'field mono', placeholder: 'deepseek-chat',
      value: config.get('ai.api.model', ''),
      list: 'ai-model-list',
      onchange: () => config.set('ai.api.model', model.value.trim()),
    });
    const modelList = h('datalist', { id: 'ai-model-list' });

    const credentialState = h('span', { class: 'tag' }, '检查中');
    async function refreshCredentialState() {
      const state = await window.toolbox.ai.credentialStatus();
      config.cache.ai ||= {};
      config.cache.ai.api ||= {};
      config.cache.ai.api.hasKey = state.hasKey;
      credentialState.textContent = state.hasKey ? '已安全保存' : '未保存';
      credentialState.className = `tag ${state.hasKey ? 'tag--good' : 'tag--warn'}`;
    }
    const saveKeyBtn = h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        if (!apiKey.value.trim()) return toast('请输入要保存的新 API Key', 'bad');
        const result = await window.toolbox.ai.saveCredential(apiKey.value);
        apiKey.value = '';
        if (!result.ok) return toast(result.error, 'bad');
        await refreshCredentialState();
        toast('API Key 已写入系统安全存储', 'good');
      },
    }, '安全保存');
    const clearKeyBtn = h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        await window.toolbox.ai.clearCredential();
        await refreshCredentialState();
        toast('已移除 API Key', 'good');
      },
    }, '移除');
    const loadModelsBtn = h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        loadModelsBtn.disabled = true;
        const result = await window.toolbox.ai.listModels(baseUrl.value.trim());
        loadModelsBtn.disabled = false;
        if (!result.ok) return toast(result.error, 'bad', 5000);
        modelList.replaceChildren(...result.models.map((id) => h('option', { value: id })));
        toast(result.models.length ? `已找到 ${result.models.length} 个模型，点击模型名输入框选择` : '端点未返回模型；可手工填写', result.models.length ? 'good' : 'info');
      },
    }, '查询模型');

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
      h('div', { class: 'settings__inline-actions' }, credentialState, saveKeyBtn, clearKeyBtn),
      h('label', { class: 'settings__field' }, h('span', {}, '模型名'), model, modelList, loadModelsBtn),
      h('div', { class: 'faint settings__hint' },
        'Base URL 填到 /v1 为止，不含 /chat/completions。常见：DeepSeek 官方 https://api.deepseek.com/v1（模型 deepseek-chat）；' +
        '本地 Ollama http://localhost:11434/v1。'),
      h('div', { class: 'faint settings__hint' },
        'API Key 由系统安全存储加密，保存后不回显，也不会进入页面配置。查询模型失败不影响手工填写模型名。'),
    );

    // ---- 学习出题专用模型：与全局 AI 分开，避免出题时切换整套工具 ----
    const quizBaseUrl = h('input', {
      class: 'field mono',
      value: config.get('study.quiz.baseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
      onchange: () => config.set('study.quiz.baseUrl', quizBaseUrl.value.trim()),
    });
    const quizKey = h('input', {
      class: 'field mono', type: 'password', placeholder: '输入通义千问 / DashScope API Key（保存后不回显）',
      autocomplete: 'new-password', value: '',
    });
    const quizModel = h('input', {
      class: 'field mono', placeholder: 'qwen3.5-flash',
      value: config.get('study.quiz.model', 'qwen3.5-flash'),
      list: 'quiz-model-list',
      onchange: () => config.set('study.quiz.model', quizModel.value.trim()),
    });
    const quizModelList = h('datalist', { id: 'quiz-model-list' });
    const quizCredentialState = h('span', { class: 'tag' }, '检查中');
    async function refreshQuizCredential() {
      const state = await window.toolbox.ai.credentialStatus('quiz');
      config.cache.study ||= {};
      config.cache.study.quiz ||= {};
      config.cache.study.quiz.hasKey = state.hasKey;
      quizCredentialState.textContent = state.hasKey ? '出题 Key 已保存' : '出题 Key 未保存';
      quizCredentialState.className = `tag ${state.hasKey ? 'tag--good' : 'tag--warn'}`;
    }
    const saveQuizKeyBtn = h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        if (!quizKey.value.trim()) return toast('请输入学习出题模型的 API Key', 'bad');
        const result = await window.toolbox.ai.saveCredential(quizKey.value, 'quiz');
        quizKey.value = '';
        if (!result.ok) return toast(result.error, 'bad');
        await refreshQuizCredential();
        toast('学习出题 Key 已安全保存', 'good');
      },
    }, '安全保存');
    const clearQuizKeyBtn = h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        await window.toolbox.ai.clearCredential('quiz');
        await refreshQuizCredential();
        toast('已移除学习出题 Key', 'good');
      },
    }, '移除');
    const loadQuizModelsBtn = h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        loadQuizModelsBtn.disabled = true;
        const result = await window.toolbox.ai.listModels(quizBaseUrl.value.trim(), 'quiz');
        loadQuizModelsBtn.disabled = false;
        if (!result.ok) return toast(result.error, 'bad', 5000);
        quizModelList.replaceChildren(...result.models.map((id) => h('option', { value: id })));
        toast(result.models.length ? `找到 ${result.models.length} 个模型` : '未返回模型列表，可手工填写', result.models.length ? 'good' : 'info');
      },
    }, '查询模型');
    const testQuizBtn = h('button', {
      class: 'btn btn--primary',
      onclick: async () => {
        testQuizBtn.disabled = true;
        await config.set('study.quiz.baseUrl', quizBaseUrl.value.trim());
        await config.set('study.quiz.model', quizModel.value.trim());
        try {
          const result = await window.toolbox.ai.quiz({
            messages: [
              { role: 'system', content: '你是测试助手，只输出 JSON：{"ok":true}' },
              { role: 'user', content: '返回测试结果。' },
            ],
            temperature: 0,
            timeout: 60000,
          });
          if (!result.ok) throw new Error(result.error);
          toast(`学习出题模型已接通：${String(result.text).slice(0, 40)}`, 'good', 5000);
        } catch (err) {
          toast(`学习出题模型测试失败：${err.message}`, 'bad', 6000);
        } finally { testQuizBtn.disabled = false; }
      },
    }, '测试出题模型');

    const quizSettingsCard = h('section', { class: 'card', id: 'settings-quiz' },
      h('h3', { class: 'card__title' }, '学习出题模型'),
      h('p', { class: 'faint settings__hint' },
        '学习工具单独使用低成本的 Qwen3.5-Flash：每轮先讲一个范围内知识点，再生成选择题考察基础、边界和迁移。不会改变快问、纠错等工具的模型。'),
      h('label', { class: 'settings__field' }, h('span', {}, '兼容接口地址'), quizBaseUrl),
      h('label', { class: 'settings__field' }, h('span', {}, 'API Key'), quizKey),
      h('div', { class: 'settings__inline-actions' }, quizCredentialState, saveQuizKeyBtn, clearQuizKeyBtn),
      h('label', { class: 'settings__field' }, h('span', {}, '模型名'), quizModel, quizModelList, loadQuizModelsBtn),
      h('div', { class: 'faint settings__hint' }, '默认：`qwen3.5-flash`。如果你的账号或自建服务提供 `qwen3.5-35b-a3b`，也可以直接填那个模型名。'),
      h('div', { class: 'settings__actions' }, testQuizBtn),
    );

    // ---- 文献翻译专用豆包：与全局 AI 分开，避免用户切模型后翻译质量跟着漂 ----
    const doubaoBaseUrl = h('input', {
      class: 'field mono',
      value: config.get('research.translation.baseUrl', 'https://ark.cn-beijing.volces.com/api/v3'),
      onchange: () => config.set('research.translation.baseUrl', doubaoBaseUrl.value.trim()),
    });
    const doubaoKey = h('input', {
      class: 'field mono', type: 'password', placeholder: '输入方舟 API Key（保存后不回显）',
      autocomplete: 'new-password', value: '',
    });
    const doubaoModel = h('input', {
      class: 'field mono', placeholder: 'ep-xxxxxxxx 或豆包模型 ID',
      value: config.get('research.translation.model', ''),
      list: 'doubao-model-list',
      onchange: () => config.set('research.translation.model', doubaoModel.value.trim()),
    });
    const doubaoModelList = h('datalist', { id: 'doubao-model-list' });
    const doubaoCredentialState = h('span', { class: 'tag' }, '检查中');
    async function refreshDoubaoCredential() {
      const state = await window.toolbox.ai.credentialStatus('translation');
      config.cache.research ||= {};
      config.cache.research.translation ||= {};
      config.cache.research.translation.hasKey = state.hasKey;
      doubaoCredentialState.textContent = state.hasKey ? '豆包 Key 已保存' : '豆包 Key 未保存';
      doubaoCredentialState.className = `tag ${state.hasKey ? 'tag--good' : 'tag--warn'}`;
    }
    const saveDoubaoKeyBtn = h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        if (!doubaoKey.value.trim()) return toast('请输入豆包/方舟 API Key', 'bad');
        const result = await window.toolbox.ai.saveCredential(doubaoKey.value, 'translation');
        doubaoKey.value = '';
        if (!result.ok) return toast(result.error, 'bad');
        await refreshDoubaoCredential();
        toast('豆包翻译 Key 已安全保存', 'good');
      },
    }, '安全保存');
    const clearDoubaoKeyBtn = h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        await window.toolbox.ai.clearCredential('translation');
        await refreshDoubaoCredential();
        toast('已移除豆包翻译 Key', 'good');
      },
    }, '移除');
    const loadDoubaoModelsBtn = h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        loadDoubaoModelsBtn.disabled = true;
        const result = await window.toolbox.ai.listModels(doubaoBaseUrl.value.trim(), 'translation');
        loadDoubaoModelsBtn.disabled = false;
        if (!result.ok) return toast(result.error, 'bad', 5000);
        doubaoModelList.replaceChildren(...result.models.map((id) => h('option', { value: id })));
        toast(result.models.length ? `找到 ${result.models.length} 个可用模型` : '未返回模型列表，可手工填 ep- 接入点', result.models.length ? 'good' : 'info');
      },
    }, '查询模型');
    const testDoubaoBtn = h('button', {
      class: 'btn btn--primary',
      onclick: async () => {
        testDoubaoBtn.disabled = true;
        await config.set('research.translation.baseUrl', doubaoBaseUrl.value.trim());
        await config.set('research.translation.model', doubaoModel.value.trim());
        try {
          const result = await window.toolbox.ai.translate({
            messages: [
              { role: 'system', content: '你是专业翻译引擎，只输出译文。' },
              { role: 'user', content: 'Translate into Chinese: Attention is all you need.' },
            ],
            temperature: 0.1,
            timeout: 60000,
          });
          if (!result.ok) throw new Error(result.error);
          toast(`豆包翻译已接通：${String(result.text).slice(0, 40)}`, 'good', 5000);
        } catch (err) {
          toast(`豆包翻译测试失败：${err.message}`, 'bad', 6000);
        } finally {
          testDoubaoBtn.disabled = false;
        }
      },
    }, '测试豆包翻译');

    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '设置')),
      h('div', { class: 'settings__body' },
        h('section', { class: 'card', id: 'settings-ai' },
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
        quizSettingsCard,
        h('section', { class: 'card', id: 'settings-translation' },
          h('h3', { class: 'card__title' }, '豆包翻译'),
          h('p', { class: 'faint settings__hint' },
            '文献的一键对照、划词和圈译优先走这里。它使用独立的豆包配置，不会因为你把全局 AI 切到别的模型而变化；豆包不可用时才退回全局 AI 和有道。'),
          h('label', { class: 'settings__field' }, h('span', {}, '方舟 Base URL'), doubaoBaseUrl),
          h('label', { class: 'settings__field' }, h('span', {}, 'API Key'), doubaoKey),
          h('div', { class: 'settings__inline-actions' }, doubaoCredentialState, saveDoubaoKeyBtn, clearDoubaoKeyBtn),
          h('label', { class: 'settings__field' }, h('span', {}, '模型 / 接入点'), doubaoModel, doubaoModelList, loadDoubaoModelsBtn),
          h('div', { class: 'faint settings__hint' },
            '默认地址已经填好。模型可填方舟控制台里的 `ep-...` 推理接入点，或账号可直接调用的豆包模型 ID。'),
          h('div', { class: 'settings__actions' }, testDoubaoBtn),
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
            '普通设置只存在本机的 userData/config.json；API Key 使用系统安全存储加密。' +
            '需求与设计见仓库里的 docs/SPEC.md，加新工具见 docs/ADD-A-TOOL.md。'),
          h('p', { class: 'faint settings__hint' },
            '快捷键：Cmd+1…7 切工具，Cmd+F 页内查找，Cmd+L 定位地址栏，Cmd+Enter 触发纠错。'),
        ),
      ),
    );

    syncProvider();
    refreshCredentialState();
    refreshQuizCredential();
    refreshDoubaoCredential();

    return {};
  },
};
