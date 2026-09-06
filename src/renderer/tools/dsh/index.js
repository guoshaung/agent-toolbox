import { h, toast } from '../../core/ui.js';

export default {
  id: 'dsh',
  title: 'DSH',
  icon: 'bot',
  hint: 'DeepSeek Harness 内置 Web 控制台',

  create(root) {
    const status = h('span', { class: 'faint dsh__status' }, '正在连接 DSH…');
    const view = h('webview', { class: 'dsh__view', partition: 'persist:dsh', src: 'about:blank', allowpopups: true });
    const openExternal = h('button', { class: 'btn btn--sm', onclick: () => window.toolbox.shell.openExternal(view.getURL()) }, '外部浏览器打开');
    const start = h('button', { class: 'btn btn--sm btn--primary', onclick: startDsh }, '启动 DSH');

    function applyState(state) {
      const running = state?.status === 'running';
      status.textContent = running ? `DSH Web 已运行 · ${state.url}` : state?.status === 'installing' ? '正在下载 DSH 启动命令…' : state?.status === 'starting' ? '正在启动 DSH Web…' : state?.error || 'DSH 尚未启动';
      status.className = `tag dsh__status ${running ? 'tag--good' : state?.status === 'error' ? 'tag--bad' : 'tag--warn'}`;
      start.disabled = running || state?.status === 'installing' || state?.status === 'starting';
      if (running && view.getURL() === 'about:blank') view.src = state.url;
    }

    async function startDsh() {
      start.disabled = true;
      const result = await window.toolbox.dsh.start();
      applyState(result);
      if (!result.ok) toast(result.error || 'DSH 启动失败', 'bad', 6000);
    }

    view.addEventListener('did-finish-load', () => { if (view.getURL() !== 'about:blank') status.textContent = 'DSH Harness 页面已加载'; });
    view.addEventListener('dom-ready', () => { if (view.getURL() !== 'about:blank') status.textContent = 'DSH Harness 正在渲染…'; });
    view.addEventListener('did-fail-load', (event) => toast(`DSH 页面加载失败：${event.errorDescription || '网络错误'}`, 'bad', 5000));
    window.toolbox.dsh.onStatus(applyState);
    window.toolbox.dsh.status().then(applyState);

    root.append(
      h('div', { class: 'bar bar--drag dsh__bar' }, h('strong', {}, 'DeepSeek Harness'), status, h('span', { style: { flex: 1 } }), start, openExternal),
      view,
    );
    return { activate: startDsh };
  },
};
