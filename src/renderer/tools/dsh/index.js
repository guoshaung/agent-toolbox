import { h, toast } from '../../core/ui.js';

export default {
  id: 'dsh',
  title: 'DSH',
  icon: 'bot',
  hint: 'DeepSeek Harness 内置 Web 控制台',

  create(root) {
    const status = h('span', { class: 'faint dsh__status' }, '正在连接 DSH…');
    let currentUrl = '';
    let loadedLaunchUrl = '';
    const view = h('webview', { class: 'dsh__view', partition: 'persist:dsh', src: 'about:blank', allowpopups: true });
    const openExternal = h('button', { class: 'btn btn--sm', onclick: () => currentUrl && window.toolbox.shell.openExternal(currentUrl) }, '浏览器打开');
    const reloadPlugins = h('button', {
      class: 'btn btn--sm',
      title: '忽略缓存重新加载 DSH 前端，安装或更新插件后使用',
      onclick: () => {
        view.reloadIgnoringCache();
        status.textContent = '正在刷新 DSH 插件…';
      },
    }, '刷新插件');
    const start = h('button', { class: 'btn btn--sm btn--primary', onclick: startDsh }, '启动 DSH');

    function applyState(state) {
      const running = state?.status === 'running';
      if (running) currentUrl = state.url;
      status.textContent = running ? `DSH Web 已运行 · ${state.url}` : state?.status === 'installing' ? '正在下载 DSH 启动命令…' : state?.status === 'starting' ? '正在启动 DSH Web…' : state?.error || 'DSH 尚未启动';
      status.className = `tag dsh__status ${running ? 'tag--good' : state?.status === 'error' ? 'tag--bad' : 'tag--warn'}`;
      start.disabled = running || state?.status === 'installing' || state?.status === 'starting';
      openExternal.disabled = !running;
      // token 是一次性的：认证后 DSH 会跳转到不含 token 的根地址。
      // 不能用 getURL() 与启动 URL 比较，否则再次进入板块会重放已消费 token。
      if (running && currentUrl && loadedLaunchUrl !== currentUrl) {
        loadedLaunchUrl = currentUrl;
        view.src = currentUrl;
      }
    }

    async function startDsh() {
      start.disabled = true;
      const result = await window.toolbox.dsh.start();
      applyState(result);
      if (!result.ok) toast(result.error || 'DSH 启动失败', 'bad', 6000);
    }
    view.addEventListener('did-finish-load', async () => {
      try {
        const report = await view.executeJavaScript(`({
          title: document.title,
          textLength: document.body?.innerText?.trim().length || 0,
          htmlLength: document.body?.innerHTML?.length || 0,
          background: getComputedStyle(document.body).backgroundColor
        })`);
        status.textContent = report.textLength
          ? `DSH Harness 已加载 · ${report.title}`
          : `DSH 页面为空 · HTML ${report.htmlLength} 字符`;
        console.log('[dsh webview] render report', report);
      } catch (error) {
        status.textContent = `DSH 页面诊断失败：${error.message}`;
      }
    });
    view.addEventListener('dom-ready', () => { status.textContent = 'DSH Harness 正在渲染…'; });
    view.addEventListener('did-fail-load', (event) => {
      if (event.errorCode === -3) return;
      status.textContent = `DSH 加载失败：${event.errorDescription || event.errorCode}`;
      toast(status.textContent, 'bad', 6000);
    });
    view.addEventListener('console-message', (event) => {
      if (event.level >= 2) console.error('[dsh webview]', event.message, event.sourceId, event.line);
    });
    root.append(
      h('div', { class: 'bar bar--drag dsh__bar' }, h('strong', {}, 'DeepSeek Harness'), status, h('span', { style: { flex: 1 } }), start, reloadPlugins, openExternal),
      view,
    );
    window.toolbox.dsh.onStatus(applyState);
    window.toolbox.dsh.status().then(applyState);
    return { activate: startDsh };
  },
};
