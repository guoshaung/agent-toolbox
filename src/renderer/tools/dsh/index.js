import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';

export default {
  id: 'dsh',
  title: 'DSH',
  icon: 'bot',
  hint: 'DeepSeek Harness 内置 Web 控制台',

  create(root) {
    const status = h('span', { class: 'tag dsh__status tag--warn' }, '正在连接 DSH…');
    let view = null;          // DSH 的 URL 带一次性 token：同一条地址只能装一次，之后靠 reload 走无 token 地址
    let currentUrl = '';
    let mountedUrl = '';      // 建当前 webview 时用的那条带 token 的地址
    let recovering = false;

    const frame = h('div', { class: 'dsh__frame' });
    const placeholder = h('div', { class: 'dsh__external-panel' },
      h('strong', {}, 'DSH Web 控制台'),
      h('span', { class: 'faint' }, '点「启动 DSH」，就地在工具箱里打开，不用切浏览器。'),
    );
    frame.append(placeholder);

    function mountView(url) {
      currentUrl = url;
      // 同一条带 token 的地址不能装第二次（token 一次性，再用就 401）。
      // 但 DSH 一重启就会发新 token、地址变了——这时必须换一个新 webview，老的永远停在 401 上。
      // 以前这里"只建一次"，DSH 重启后面板就再也打不开了。
      if (view && url === mountedUrl) return;
      if (view) { view.remove(); view = null; }
      mountedUrl = url;
      view = h('webview', { partition: 'persist:dsh', src: url, allowpopups: true });
      view.addEventListener('did-navigate', (e) => { currentUrl = e.url; if (e.httpResponseCode === 401) onUnauthorized(); });
      view.addEventListener('did-navigate-in-page', (e) => { currentUrl = e.url; });
      placeholder.remove();
      frame.append(view);
    }

    /** 面板拿到的 token 已被别处用掉（比如同一条链接在浏览器里开过）：重启 DSH 换新 token，只自动救一次 */
    async function onUnauthorized() {
      if (recovering) return;
      recovering = true;
      status.textContent = 'DSH 凭证已失效，正在换新凭证重连…';
      status.className = 'tag dsh__status tag--warn';
      try {
        await window.toolbox.dsh.stop();
        const r = await window.toolbox.dsh.start();
        applyState(r);
        if (!r?.ok) toast(r?.error || 'DSH 重连失败，点「启动 DSH」再试', 'bad', 6000);
      } finally { setTimeout(() => { recovering = false; }, 15000); }
    }

    function applyState(state) {
      const running = state?.status === 'running';
      status.textContent = running ? 'DSH Web 已运行' : state?.status === 'installing' ? '正在下载 DSH 启动命令…' : state?.status === 'starting' ? '正在启动 DSH Web…' : state?.error || 'DSH 尚未启动';
      status.className = `tag dsh__status ${running ? 'tag--good' : state?.status === 'error' ? 'tag--bad' : 'tag--warn'}`;
      start.disabled = running || state?.status === 'installing' || state?.status === 'starting';
      reload.disabled = !running;
      openExternal.disabled = !running;
      if (running && state.url) mountView(state.url);
    }

    async function startDsh() {
      start.disabled = true;
      const result = await window.toolbox.dsh.start();
      applyState(result);
      if (!result.ok && result.error) toast(result.error, 'bad', 6000);
    }

    const start = h('button', { class: 'btn btn--sm btn--primary', onclick: startDsh }, '启动 DSH');
    // reload 走 webview 当前地址（登录后已是无 token 地址），不要碰原始 token 链接
    const reload = h('button', { class: 'btn btn--icon', title: '刷新控制台', disabled: true, onclick: () => view?.reload() }, iconFor('refresh'));
    const openExternal = h('button', { class: 'btn btn--sm btn--ghost', title: '改用系统浏览器打开', disabled: true, onclick: () => (view?.getURL() || currentUrl) && window.toolbox.shell.openExternal(view?.getURL() || currentUrl) }, iconFor('external'), ' 浏览器');

    window.toolbox.dsh.onStatus(applyState);
    window.toolbox.dsh.status().then(applyState);

    root.append(
      h('div', { class: 'bar bar--drag dsh__bar' }, h('strong', {}, 'DeepSeek Harness'), status, h('span', { style: { flex: 1 } }), start, reload, openExternal),
      frame,
    );
    return { activate: startDsh };
  },
};
