import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';

export default {
  id: 'dsh',
  title: 'DSH',
  icon: 'bot',
  hint: 'DeepSeek Harness 内置 Web 控制台',

  create(root) {
    const status = h('span', { class: 'tag dsh__status tag--warn' }, '正在连接 DSH…');
    let view = null;          // DSH 的 URL 带一次性 token，只能装一次，之后靠 reload 走无 token 地址
    let currentUrl = '';
    let botOn = null;         // ds-bot 开没开（null=还没查到）
    let botBusy = false;      // 正在切换

    const frame = h('div', { class: 'dsh__frame' });
    const placeholder = h('div', { class: 'dsh__external-panel' },
      h('strong', {}, 'DSH Web 控制台'),
      h('span', { class: 'faint' }, '点「启动 DSH」，就地在工具箱里打开，不用切浏览器。'),
    );
    frame.append(placeholder);

    function mountView(url) {
      // 只创建一次：token 是一次性的，重复用原始带 token 地址会 401
      currentUrl = url;
      if (view) return;
      view = h('webview', { partition: 'persist:dsh', src: url, allowpopups: true });
      view.addEventListener('did-navigate', (e) => { currentUrl = e.url; });
      view.addEventListener('did-navigate-in-page', (e) => { currentUrl = e.url; });
      placeholder.remove();
      frame.append(view);
    }

    // 切换/重启后 DSH 发的是新 token，老 webview 那条已作废，必须换一个新的
    function remountView(url) {
      if (!url) return;
      if (view) { try { view.remove(); } catch (_) { /* 已经没了 */ } view = null; }
      mountView(url);
    }

    function paintBot() {
      botToggle.textContent = botOn == null ? 'DS Bot：…' : botOn ? 'DS Bot：开' : 'DS Bot：关';
      botToggle.title = botOn
        ? '关掉即切回原来的 DSH（侧栏不再有 Chief / Dev 两个助手）'
        : '开启 DS Bot 助手（侧栏会多出 Chief / Dev）';
      botToggle.classList.toggle('btn--primary', botOn === true);
    }

    function applyState(state) {
      const running = state?.status === 'running';
      status.textContent = running ? 'DSH Web 已运行' : state?.status === 'installing' ? '正在下载 DSH 启动命令…' : state?.status === 'starting' ? '正在启动 DSH Web…' : state?.status === 'stopping' ? '正在重启 DSH…' : state?.error || 'DSH 尚未启动';
      status.className = `tag dsh__status ${running ? 'tag--good' : state?.status === 'error' ? 'tag--bad' : 'tag--warn'}`;
      const transient = botBusy || ['installing', 'starting', 'stopping'].includes(state?.status);
      start.disabled = running || transient;
      reload.disabled = !running || botBusy;
      openExternal.disabled = !running || botBusy;
      botToggle.disabled = botBusy || botOn == null || transient;
      if (running && state.url) mountView(state.url);
    }

    async function startDsh() {
      start.disabled = true;
      const result = await window.toolbox.dsh.start();
      applyState(result);
      if (!result.ok && result.error) toast(result.error, 'bad', 6000);
    }

    async function toggleBot() {
      if (botBusy || botOn == null) return;
      const next = !botOn;
      botBusy = true;
      status.textContent = next ? '正在开启 DS Bot 并重启 DSH…' : '正在切回原来模式并重启 DSH…';
      status.className = 'tag dsh__status tag--warn';
      botToggle.disabled = true;
      try {
        const result = await window.toolbox.dsh.bot.set(next);
        if (typeof result.botEnabled === 'boolean') botOn = result.botEnabled;
        remountView(result.url);
        botBusy = false;
        paintBot();
        applyState(result);
        if (!result.ok && result.error) toast(result.error, 'bad', 6000);
        else toast(botOn ? 'DS Bot 已开启' : '已切回原来的 DSH', 'good', 3000);
      } catch (error) {
        botBusy = false;
        paintBot();
        toast(`切换失败：${error.message}`, 'bad', 6000);
      }
    }

    const start = h('button', { class: 'btn btn--sm btn--primary', onclick: startDsh }, '启动 DSH');
    const botToggle = h('button', { class: 'btn btn--sm btn--ghost', disabled: true, onclick: toggleBot }, 'DS Bot：…');
    // reload 走 webview 当前地址（登录后已是无 token 地址），不要碰原始 token 链接
    const reload = h('button', { class: 'btn btn--icon', title: '刷新控制台', disabled: true, onclick: () => view?.reload() }, iconFor('refresh'));
    const openExternal = h('button', { class: 'btn btn--sm btn--ghost', title: '改用系统浏览器打开', disabled: true, onclick: () => (view?.getURL() || currentUrl) && window.toolbox.shell.openExternal(view?.getURL() || currentUrl) }, iconFor('external'), ' 浏览器');

    window.toolbox.dsh.onStatus(applyState);
    window.toolbox.dsh.status().then(applyState);
    window.toolbox.dsh.bot.get().then((on) => { botOn = on; paintBot(); if (!botBusy) botToggle.disabled = false; }).catch(() => {});

    root.append(
      h('div', { class: 'bar bar--drag dsh__bar' }, h('strong', {}, 'DeepSeek Harness'), status, h('span', { style: { flex: 1 } }), botToggle, start, reload, openExternal),
      frame,
    );
    return { activate: startDsh };
  },
};
