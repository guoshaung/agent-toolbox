import { h, toast } from '../../core/ui.js';
import { createAiHubSetup } from './setup.js';

export default {
  id: 'ai-hub',
  title: '额度中枢',
  icon: 'plug',
  hint: '集中管理 AI 通道和额度，提供统一调用接口',
  create(root) {
    const api = window.toolbox.aiHub;
    let state = null, active = false, timer = null, editing = false, loginTimer = null, loginBusy = false, loginGeneration = 0;
    const summary = h('div', { class: 'aihub__summary' });
    const cards = h('div', { class: 'aihub__cards' });
    const catalog = h('div', { class: 'aihub__catalog' });
    const history = h('div', { class: 'aihub__history' });
    const editor = h('div', { class: 'card aihub__editor', hidden: true });
    const loginBox = h('div', { class: 'card aihub__login', hidden: true });
    const status = h('span', { class: 'tag' }, '未启动');
    const start = h('button', { class: 'btn btn--primary', onclick: () => run(() => state?.running ? api.stop() : api.start()) }, '启动本地网关');
    const setup = createAiHubSetup({ api, getGateway: () => state, applyGateway: next => { state = next; render(); } });
    const address = h('code', {}, '启动后显示本地地址');
    const resultText = h('pre', { class: 'aihub__example' });
    const help = h('details', { class: 'card aihub__help' }, h('summary', {}, '怎么接入和使用'),
      h('p', {}, '1. 添加通道，填写服务提供的 OpenAI 兼容 Base URL、模型名和 API Key，再启用。你自己部署的兼容代理也可以使用。'),
      h('p', {}, '2. 启动本地网关。在需要调用的客户端填入下方地址、复制的网关密钥，模型填 auto。优先级数字越小越优先；也可使用通道 ID 指定一家。'),
      h('p', {}, '3. 额度查询需要该服务实际提供的 JSON 接口。没有接口时可以手动记录，页面会显示来源与更新时间。各家的 credits、次数、Token 不会混成一个总余额。'),
      h('p', {}, '仅统计经此网关的请求；在原软件里消耗的用量不会自动出现在本地统计中。配置完成不代表原产品订阅已接通，需要用真实请求验证。'),
      h('p', {}, '网关支持 /v1/models 和 /v1/chat/completions（含流式）；auto 遇到 HTTP 429/502/503/504 才尝试下一通道，连接中断或已经输出时不会重发。网关随工具箱退出而停止，不自动改动工具箱原来的 AI 设置。'), resultText);
    root.append(h('div', { class: 'bar bar--drag' }, h('strong', {}, '额度中枢'), h('span', { class: 'faint' }, '一个入口，各家独立记账')),
      h('div', { class: 'aihub__body' },
        h('div', { class: 'card aihub__gateway' }, h('div', { class: 'aihub__row' }, h('strong', {}, '本地统一接口'), status, start, setup.toggle),
          h('div', { class: 'aihub__row' }, address, button('复制地址', async () => { if (!state?.baseUrl) return toast('请先启动网关'); await window.toolbox.clipboard.write(state.baseUrl); toast('地址已复制', 'good'); }),
            button('复制网关密钥', () => run(() => api.copyKey(), '网关密钥已复制')), button('更换网关密钥', () => { if (window.confirm('更换后，已有客户端需要更新网关密钥。继续吗？')) run(() => api.rotate(), '网关密钥已更换'); })),
          h('p', { class: 'faint' }, '本机地址 · Bearer 密钥鉴权 · 模型 auto 按优先级选择')),
        setup.panel, summary, h('div', { class: 'aihub__row' }, h('h3', {}, '我的通道'), button('添加通道', () => edit()),
          button('引用工具箱当前 API', () => edit({ source: 'current', name: '工具箱当前 API', enabled: false, priority: 50 }))),
        loginBox, editor, cards, h('h3', {}, '你关注的服务'), catalog, help, h('h3', {}, '最近调用'), history));
    function button(label, action) { return h('button', { class: 'btn btn--sm', onclick: action }, label); }
    async function run(fn, success) {
      try { const next = await fn(); if (!next?.ok) throw Error(next?.error || '操作失败'); if (next.channels) { state = next; render(); } if (success) toast(success, 'good'); return true; }
      catch (error) { toast(error.message, 'bad'); return false; }
    }
    async function refresh() { await run(() => api.status()); }
    async function login(id) {
      if (loginBusy || loginTimer) return toast('已有登录正在等待，请先完成或取消');
      loginBusy = true; const generation = ++loginGeneration; loginBox.hidden = false; loginBox.replaceChildren(h('p', {}, '正在打开 WorkBuddy 国内版授权页面…'));
      try {
        const response = await api.loginStart(id);
        if (!response.ok) throw Error(response.error);
        if (generation !== loginGeneration) return;
        loginBox.replaceChildren(h('p', {}, '请在浏览器完成 WorkBuddy 国内版登录授权。工具箱会自动接收结果；无需复制密码或令牌。'),
          button('取消登录', () => { loginGeneration++; clearTimeout(loginTimer); loginTimer = null; loginBusy = false; api.loginCancel(); loginBox.hidden = true; }));
        const poll = async () => {
          if (generation !== loginGeneration) return;
          try {
            const result = await api.loginPoll(response.loginId);
            if (generation !== loginGeneration) return;
            if (!result.ok) throw Error(result.error);
            if (result.loginStatus === 'connected') {
              loginTimer = null; loginBusy = false; loginBox.hidden = true; state = result; render();
              const channel = state.channels.find(c => c.id === result.channelId); if (channel) edit(channel);
              toast('授权已保存，请确认模型后启用通道', 'good'); return;
            }
            loginTimer = setTimeout(poll, 2500);
          } catch (error) { loginBusy = false; loginTimer = null; loginBox.replaceChildren(h('p', {}, error.message), button('重新登录', () => login(id))); }
        };
        loginTimer = setTimeout(poll, 2500);
      } catch (error) { loginBox.replaceChildren(h('p', {}, error.message), button('重试', () => login(id))); }
      finally { loginBusy = false; }
    }
    function label(text, input) { return h('label', { class: 'aihub__field' }, h('span', {}, text), input); }
    function edit(channel = {}) {
      editing = true; editor.hidden = false;
      const provider = h('select', { class: 'field', 'aria-label': '服务' }, h('option', { value: 'custom' }, '自定义兼容服务'), ...(state?.catalog || []).map(v => h('option', { value: v.id }, v.name)));
      provider.value = channel.provider || 'custom';
      const account = ['workbuddy-cn', 'trae-ide', 'doubao-work', 'qwenwork-cn'].includes(channel.source); if (account) provider.disabled = true;
      const name = h('input', { class: 'field', value: channel.name || '', placeholder: '例如：我的 WorkBuddy 兼容代理' });
      const baseUrl = h('input', { class: 'field', value: channel.baseUrl || '', placeholder: 'https://服务地址/v1', spellcheck: false });
      const model = h('input', { class: 'field', value: channel.model || '', placeholder: '上游服务提供的模型名', spellcheck: false });
      const models = h('datalist', { id: 'aihub-account-models' }, ...(channel.models || []).map(id => h('option', { value: id })));
      if (account) model.setAttribute('list', models.id);
      const key = h('input', { class: 'field', type: 'password', autocomplete: 'new-password', placeholder: channel.hasKey ? '已有密钥，留空保留' : '填写此通道的 API Key' });
      const priority = h('input', { class: 'field', type: 'number', min: 0, max: 999, value: channel.priority ?? 50 });
      const enabled = h('input', { type: 'checkbox' }); enabled.checked = Boolean(channel.enabled);
      const quotaPath = h('input', { class: 'field', value: channel.quotaPath || '', placeholder: '可选：/v1/usage/quota（以实际文档为准）' });
      const remainingPath = h('input', { class: 'field', value: channel.remainingPath || '', placeholder: '例如 data.remaining' });
      const quotaUnit = h('input', { class: 'field', value: channel.quotaUnit || 'credits' });
      const current = channel.source === 'current';
      const cancel = () => { editing = false; editor.hidden = true; editor.replaceChildren(); };
      const save = button('保存通道', async () => {
        save.disabled = true;
        const ok = await run(() => api.save({ id: channel.id, source: channel.source, provider: provider.value, name: name.value, baseUrl: baseUrl.value,
          model: model.value, apiKey: key.value, priority: Number(priority.value), enabled: enabled.checked, quotaPath: quotaPath.value, remainingPath: remainingPath.value, quotaUnit: quotaUnit.value }), '通道已保存');
        save.disabled = false; if (ok) cancel();
      });
      editor.replaceChildren(h('h3', {}, channel.id ? '编辑通道' : '添加通道'),
        current ? h('p', { class: 'faint' }, '仅在请求时读取工具箱现有的地址、模型和密钥，不复制或覆盖原配置。') : account ? h('p', { class: 'faint' }, channel.source === 'qwenwork-cn' ? '只读连接 QwenWork 本机登录；请选择实际模型，仅文本，完整回答后返回。到期请在原客户端刷新登录。' : channel.source === 'doubao-work' ? '使用原豆包工作 Agent 会话与客户端权限，仅支持文本，完整回复后返回。客户端需保持运行。' : channel.source === 'trae-ide' ? '只读使用本机 TRAE 国际版 IDE 登录，支持文本对话。到期后请在 IDE 重新登录；切换账号需重新连接。' : '已使用 WorkBuddy 国内版浏览器授权。选择服务返回的模型后启用；可在通道卡片刷新积分和模型。') : h('p', { class: 'faint' }, '这里填写已可用的兼容 API 或本地代理。选择服务名称不会自动取得该软件的登录态或额度。'),
        h('div', { class: 'aihub__form' }, label('服务', provider), label('通道名称', name),
          !current && !account && label('Base URL（含版本路径）', baseUrl), !current && label('上游模型', model), !current && !account && label('API Key', key), label('优先级（小的优先）', priority)), models,
        h('label', { class: 'aihub__row' }, enabled, '启用并加入调度'),
        current || account ? document.createDocumentFragment() : h('details', {}, h('summary', {}, '额度自动查询（可选）'), h('p', { class: 'faint' }, '只向同一服务发送此通道的 Key；响应中余额必须是数值。没有真实接口请留空。'),
          h('div', { class: 'aihub__form' }, label('额度接口路径', quotaPath), label('余额字段路径', remainingPath), label('余额单位', quotaUnit))),
        h('div', { class: 'aihub__row' }, save, button('取消', cancel)));
      editor.scrollIntoView({ block: 'nearest' }); name.focus();
    }
    function quotaEdit(channel) {
      const box = h('div', { class: 'aihub__quota-edit' });
      const remaining = h('input', { class: 'field', type: 'number', min: 0, step: 'any', value: channel.quota?.remaining ?? '', 'aria-label': '剩余额度', placeholder: '剩余额度' });
      const unit = h('input', { class: 'field', value: channel.quota?.unit || 'credits', 'aria-label': '额度单位' });
      const reset = h('input', { class: 'field', type: 'datetime-local', 'aria-label': '额度重置时间（可选）' });
      box.append(label('账户显示的剩余数值', remaining), label('单位', unit), label('重置时间（可选）', reset), h('div', { class: 'aihub__row' }, button('记录', async () => {
        if (remaining.value.trim() === '') return toast('请填写余额，未知不能填成零', 'bad');
        if (await run(() => api.quota({ id: channel.id, remaining: Number(remaining.value), unit: unit.value, resetAt: reset.value ? new Date(reset.value).toISOString() : null }), '已记录，来源为手动')) box.remove();
      }), button('取消', () => box.remove()))); return box;
    }
    function render() {
      setup.paint();
      const openDetails = new Set([...cards.querySelectorAll('.aihub__details[open]')].map(d => d.dataset.channelId));
      status.textContent = state.running ? '运行中' : '已停止'; start.textContent = state.running ? '停止网关' : '启动本地网关';
      address.textContent = state.baseUrl || 'http://127.0.0.1:18878/v1（未启动）';
      const totals = state.channels.reduce((n, c) => n + (c.stats?.completed || 0), 0);
      summary.replaceChildren(...[[`${state.channels.filter(c => c.ready).length} / ${state.channels.length}`, '可调度 / 已配置'], [totals, '网关成功请求'], [state.inflight, '正在处理']].map(([n, text]) => h('div', { class: 'card aihub__metric' }, h('strong', {}, n), h('span', { class: 'faint' }, text))));
      cards.replaceChildren(...(state.channels.length ? state.channels.map(c => {
        const quota = c.quota; const stamp = quota ? new Date(quota.updatedAt).toLocaleString() : '';
        const cooldown = c.cooldownUntil > Date.now();
        const card = h('article', { class: 'card aihub__channel' }, h('div', { class: 'aihub__row' }, h('strong', {}, c.name), h('span', { class: 'tag' }, !c.enabled ? '已停用' : cooldown ? '限流冷却' : c.ready ? (c.stats.completed ? '已有成功调用' : '已配置 · 待调用验证') : '待补全')),
          h('div', { class: 'aihub__balance' }, quota?.windows ? quota.plan || '工作额度' : quota ? `${quota.remaining.toLocaleString()} ${quota.unit}` : '剩余额度未知'),
          ...(quota?.windows || []).map(w => h('p', {}, `${w.label}：已用 ${w.lessThanOnePercent ? '<1' : w.usedPercent ?? '未知'}%${w.usedText != null && w.totalText != null ? `（${w.usedText} / ${w.totalText}）` : ''}${w.resetAt ? ' · 重置 ' + new Date(w.resetAt).toLocaleString() : ''}`)),
          h('p', { class: 'faint' }, quota ? `${quota.source === 'api' ? '接口查询' : '手动记录'} · ${stamp}${quota.resetAt ? ' · 重置 ' + new Date(quota.resetAt).toLocaleString() : ''}` : '尚无额度数据，不以零或无限额代替'),
          h('p', { class: 'faint' }, `${c.source === 'current' ? '引用原 API' : c.model || '未填模型'} · 优先级 ${c.priority} · ${c.source === 'trae-ide' ? (c.hasKey ? 'IDE 登录可用' : '请在 IDE 登录后刷新') : ['doubao-work','qwenwork-cn'].includes(c.source) ? '绑定本机客户端' : c.hasKey ? '密钥已保存' : '无可用密钥'}`),
          h('p', { class: 'aihub__usage' }, `网关成功 ${c.stats.completed} 次 / 失败 ${c.stats.failures} 次 · ${c.stats.usageResponses ? `已报告输入 ${c.stats.inputTokens.toLocaleString()} / 输出 ${c.stats.outputTokens.toLocaleString()} Token` : '上游未提供 Token 统计'}`),
          h('p', { class: 'faint' }, `${c.stats.usageResponses} 次成功请求返回了 Token 统计；不代表原软件总用量。`),
          h('code', { class: 'aihub__id' }, `指定模型：${c.id}`));
        if (c.accountNote) card.append(h('p', { class: 'faint' }, c.accountNote));
        if (quota?.pools) card.append(h('p', {}, quota.pools.map(p => `${p.name} ${p.remaining.toLocaleString()}`).join(' · ')));
        card.append(h('div', { class: 'aihub__row' }, button('编辑', () => edit(c)), button('测试调用', () => {
          if (!state.running || !c.ready) return toast('请先启用通道并启动网关');
          if (window.confirm('发送一条简短测试请求，会消耗此通道的额度。继续吗？')) run(async () => { const r = await api.test(c.id); if (r.ok) toast(r.testReply, 'good', 6000); return r; });
        }), !['doubao-work','qwenwork-cn'].includes(c.source) && button('记录额度', () => { if (!card.querySelector('.aihub__quota-edit')) card.append(quotaEdit(c)); }),
          (c.quotaPath || ['workbuddy-cn','trae-ide','doubao-work','qwenwork-cn'].includes(c.source)) && button(['workbuddy-cn','trae-ide','qwenwork-cn'].includes(c.source) ? '刷新额度和模型' : '刷新额度', () => run(() => api.refresh(c.id), '查询完成，请查看数据时间和状态')),
          c.source === 'workbuddy-cn' && button('重新授权', () => login(c.id)),
          button('复制模型 ID', async () => { await window.toolbox.clipboard.write(c.id); toast('已复制', 'good'); }),
          button('删除', () => { if (window.confirm(`删除通道「${c.name}」？原软件及工具箱原 Key 不受影响。`)) run(() => api.remove(c.id)); })));
        const actions = card.lastElementChild;
        actions.classList.add('aihub__actions');
        const details = h('details', { class: 'aihub__details' }, h('summary', {}, '用量详情与更多操作'));
        details.dataset.channelId = c.id; details.open = openDetails.has(c.id);
        const secondary = h('div', { class: 'aihub__row aihub__secondary' });
        const notes = [...card.querySelectorAll(':scope > p.faint')];
        for (const note of notes.slice(1)) details.append(note);
        const identifier = card.querySelector('.aihub__id'); if (identifier) details.append(identifier);
        for (const control of [...actions.children]) {
          if (control.textContent.startsWith('刷新')) control.classList.add('btn--primary');
          if (control.textContent === '删除') control.classList.add('btn--danger');
          if (!['编辑', '测试调用'].includes(control.textContent) && !control.textContent.startsWith('刷新')) secondary.append(control);
        }
        details.append(secondary); card.append(details);
        const badge = card.querySelector('.tag'); if (badge && c.enabled && c.ready && !cooldown) badge.classList.add('tag--good');
        return card;
      }) : [h('div', { class: 'card empty' }, '还没有接入通道。添加一个已可用的服务，或引用工具箱当前 API。')]));
      catalog.replaceChildren(...state.catalog.map(p => h('div', { class: 'card' }, h('strong', {}, p.name), h('p', { class: 'faint' }, p.note), h('div', { class: 'aihub__row' },
        p.id === 'workbuddy' && button('浏览器登录国内版', () => login()),
        p.id === 'qianwen-work' && button('连接本机 QwenWork', async () => { await run(async () => { const r = await api.connectQwenWork(); if (r.ok) { state = r; render(); edit(r.channels.find(c => c.id === r.channelId)); } return r; }, '已连接，请确认模型并启用'); }),
        p.id === 'doubao-work' && button('启动豆包连接', () => run(() => api.openDoubao(), '已请求启动。若客户端原本已打开，请从托盘退出后再点此按钮；就绪后点击连接。')),
        p.id === 'doubao-work' && button('连接本机豆包工作', async () => { await run(async () => { const r = await api.connectDoubao(); if (r.ok) { state = r; render(); edit(r.channels.find(c => c.id === r.channelId)); } return r; }, '已连接，请确认并启用'); }),
        p.id === 'trae' && button('连接本机 IDE', async () => { await run(async () => { const r = await api.connectTrae(); if (r.ok) { state = r; render(); edit(r.channels.find(c => c.id === r.channelId)); } return r; }, '已连接，请确认模型并启用'); }),
        button('添加兼容 API', () => edit({ provider: p.id, name: p.name, priority: 50 })), button('查看接入说明', () => window.toolbox.shell.openExternal(p.url))))));
      history.replaceChildren(...(state.requests.length ? state.requests.slice(0, 15).map(r => h('div', { class: 'aihub__log' }, h('span', {}, new Date(r.at).toLocaleTimeString()), h('span', {}, r.channel), h('span', {}, r.result), h('span', { class: 'faint' }, `${(r.elapsedMs / 1000).toFixed(1)}s`))) : [h('p', { class: 'faint' }, '还没有调用记录。只记录通道、状态和耗时，不保存提示词或回答。')]));
      resultText.textContent = `Base URL: ${state.baseUrl || 'http://127.0.0.1:18878/v1'}\nAPI Key: 点击「复制网关密钥」取得\nModel: auto\n\nPOST /v1/chat/completions\nAuthorization: Bearer <网关密钥>\nContent-Type: application/json\n\n{"model":"auto","messages":[{"role":"user","content":"你好"}],"stream":true}`;
    }
    return { async activate() { active = true; await refresh(); if (!setup.panel.hidden) await setup.load(); clearInterval(timer); timer = setInterval(() => { if (active && !editing && !root.querySelector('.aihub__quota-edit')) refresh(); }, 5000); }, deactivate() { active = false; clearInterval(timer); } };
  },
};
