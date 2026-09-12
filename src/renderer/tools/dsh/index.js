import { h, toast } from '../../core/ui.js';

export default {
  id: 'dsh',
  title: 'DSH',
  icon: 'bot',
  hint: 'DeepSeek Harness 内置 Web 控制台',

  create(root) {
    const status = h('span', { class: 'faint dsh__status' }, '正在连接 DSH…');
    let currentUrl = '';
    const view = h('div', { class: 'dsh__external-panel' },
      h('strong', {}, 'DSH Web 在系统浏览器中运行'),
      h('span', { class: 'faint' }, '启动后点击“在浏览器打开”；关闭浏览器不会停止本地 DSH 服务。'),
    );
    const openExternal = h('button', { class: 'btn btn--sm', onclick: () => currentUrl && window.toolbox.shell.openExternal(currentUrl) }, '在浏览器打开');
    const reloadPlugins = h('button', {
      class: 'btn btn--sm',
      title: '在系统浏览器中重新打开 DSH',
      onclick: () => currentUrl && window.toolbox.shell.openExternal(currentUrl),
    }, '重新打开');
    const start = h('button', { class: 'btn btn--sm btn--primary', onclick: startDsh }, '启动 DSH');

    function applyState(state) {
      const running = state?.status === 'running';
      if (running) currentUrl = state.url;
      status.textContent = running ? `DSH Web 已运行 · ${state.url}` : state?.status === 'installing' ? '正在下载 DSH 启动命令…' : state?.status === 'starting' ? '正在启动 DSH Web…' : state?.error || 'DSH 尚未启动';
      status.className = `tag dsh__status ${running ? 'tag--good' : state?.status === 'error' ? 'tag--bad' : 'tag--warn'}`;
      start.disabled = running || state?.status === 'installing' || state?.status === 'starting';
      openExternal.disabled = !running;
      // token 是一次性的；浏览器只在用户点击按钮时打开启动地址。
    }

    async function startDsh() {
      start.disabled = true;
      const result = await window.toolbox.dsh.start();
      applyState(result);
      if (!result.ok) toast(result.error || 'DSH 启动失败', 'bad', 6000);
      else if (result.url) window.toolbox.shell.openExternal(result.url);
    }
    window.toolbox.dsh.onStatus(applyState);
    window.toolbox.dsh.status().then(applyState);
    root.append(
      h('div', { class: 'bar bar--drag dsh__bar' }, h('strong', {}, 'DeepSeek Harness'), status, h('span', { style: { flex: 1 } }), start, reloadPlugins, openExternal),
      view,
    );
    window.toolbox.dsh.onStatus(applyState);
    window.toolbox.dsh.status().then(applyState);
    return { activate: startDsh };
  },
};
