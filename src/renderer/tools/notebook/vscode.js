import { h, toast } from '../../core/ui.js';

/**
 * 「代码」的 VS Code 模式：一个 webview 装本地 code-server。
 * 独立 partition（persist:vscode），它自己的主题、扩展、设置都留在里面，不受工具箱皮肤影响。
 * 没装 code-server 就给安装面板（Homebrew / npm 二选一，日志实时刷）。
 */
const CSS = `
.vsc { display:flex; flex-direction:column; flex:1; min-height:0; }
.vsc__bar { display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid var(--line-soft, var(--line)); font-size:12px; }
.vsc__bar strong { font-size:13px; }
.vsc__folder { color:var(--text-dim); font-family:var(--mono); font-size:11.5px; max-width:42%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.vsc__frame { flex:1; min-height:0; display:flex; background:#1e1e1e; position:relative; }
.vsc__frame webview { flex:1; min-height:0; }
.vsc__setup { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:28px; text-align:center; overflow:auto; }
.vsc__setup h3 { margin:0; font-size:18px; }
.vsc__setup p { margin:0; color:var(--text-dim); max-width:560px; line-height:1.7; font-size:13px; }
.vsc__log { width:min(720px, 100%); max-height:220px; overflow:auto; text-align:left; font:11.5px/1.5 var(--mono); color:var(--text-dim); background:var(--bg-sunken); border:1px solid var(--line); border-radius:8px; padding:8px 10px; white-space:pre-wrap; }
.vsc__row { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
.vsc__logo { width:64px; height:64px; opacity:.9; }
`;
const LOGO = `<svg class="vsc__logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M74 8l16 8v68l-16 8L30 58 14 70 6 66V34l8-4 16 12z" fill="#3b8de0" opacity=".9"/><path d="M74 8L30 42 14 30 6 34l24 16L6 66l8 4 16-12 44 34 16-8V16z" fill="#2f7ad1"/><path d="M74 8v84L30 58z" fill="#61b3ff" opacity=".85"/></svg>`;

export function createVscodePanel(ctx, { onClassic } = {}) {
  const { config } = ctx;
  if (!document.getElementById('vsc-css')) document.head.append(h('style', { id: 'vsc-css' }, CSS));
  let view = null; let state = { status: 'idle' }; let loadedUrl = '';

  const status = h('span', { class: 'tag' }, '…');
  const folderEl = h('span', { class: 'vsc__folder', title: '' });
  const frame = h('div', { class: 'vsc__frame' });
  const logEl = h('pre', { class: 'vsc__log', hidden: true });

  const btnFolder = h('button', { class: 'btn btn--sm', title: '换一个文件夹当工作区', onclick: async () => { const r = await window.toolbox.vscode.chooseFolder(); if (r.ok) { config.set('notebook.vscodeFolder', r.folder); if (r.url) navigate(r.url); } } }, '📂 工作区');
  const btnRestart = h('button', { class: 'btn btn--sm', title: '重启 code-server', onclick: async () => { await window.toolbox.vscode.stop(); loadedUrl = ''; start(); } }, '↻');
  const btnExternal = h('button', { class: 'btn btn--sm btn--ghost', title: '在系统浏览器里打开同一个 VS Code', onclick: () => state.url && window.toolbox.shell.openExternal(state.url) }, '↗');
  const btnClassic = h('button', { class: 'btn btn--sm btn--ghost', title: '切回工具箱自带的编辑器', onclick: () => onClassic?.() }, '经典编辑器');
  const bar = h('div', { class: 'vsc__bar' }, h('strong', {}, 'VS Code'), status, folderEl, h('span', { style: { flex: 1 } }), btnFolder, btnRestart, btnExternal, btnClassic);

  function navigate(url) {
    if (!view) { view = h('webview', { partition: 'persist:vscode', src: url, allowpopups: true }); frame.replaceChildren(view); loadedUrl = url; return; }
    if (url !== loadedUrl) { view.loadURL(url); loadedUrl = url; }
  }

  function renderSetup() {
    const installing = state.status === 'installing';
    logEl.hidden = !state.log; logEl.textContent = state.log || '';
    frame.replaceChildren(h('div', { class: 'vsc__setup' },
      h('div', { html: LOGO }),
      h('h3', {}, installing ? '正在安装 code-server…' : state.status === 'error' ? 'code-server 没起来' : '把 VS Code 装进来'),
      h('p', {}, installing ? '第一次要下载一百多兆，取决于网速；进度在下面和 Dock 图标上。装好会自动启动。' : state.status === 'error' ? (state.error || '') : '内嵌的是 code-server —— VS Code 的开源网页版（MIT）。它自己的主题、扩展（Open VSX 市场）、快捷键都在里面，和工具箱的皮肤互不影响。装一次就行；推荐「独立包」：下到工具箱自己的目录，不碰系统。'),
      installing ? null : h('div', { class: 'vsc__row' },
        state.status === 'error' ? h('button', { class: 'btn btn--primary', onclick: () => { loadedUrl = ''; start(); } }, '再试一次') : null,
        h('button', { class: 'btn btn--primary', title: '下载官方独立包解压到工具箱自己的目录，不碰 Homebrew / npm / PATH', onclick: () => window.toolbox.vscode.install('standalone') }, '一键安装（独立包）'),
        h('button', { class: 'btn', onclick: () => window.toolbox.vscode.install('brew') }, 'Homebrew'),
        h('button', { class: 'btn', onclick: () => window.toolbox.vscode.install('npm') }, 'npm'),
        h('button', { class: 'btn btn--ghost', onclick: () => window.toolbox.shell.openExternal('https://coder.com/docs/code-server/install') }, '官方文档'),
      ),
      logEl,
    ));
    view = null; loadedUrl = '';
  }

  function apply(s) {
    state = s || state;
    const label = { idle: '未启动', starting: '启动中…', running: '已就绪', error: '出错', missing: '未安装', installing: '安装中…' }[state.status] || state.status;
    status.textContent = label; status.className = `tag ${state.status === 'running' ? 'tag--good' : state.status === 'error' || state.status === 'missing' ? 'tag--bad' : 'tag--warn'}`;
    folderEl.textContent = state.folder || ''; folderEl.title = state.folder || '';
    btnRestart.disabled = state.status === 'installing'; btnExternal.disabled = state.status !== 'running';
    if (state.status === 'running' && state.url) navigate(state.url);
    else if (state.status === 'starting') { if (!view) frame.replaceChildren(h('div', { class: 'vsc__setup' }, h('div', { html: LOGO }), h('h3', {}, '正在启动 VS Code…'), h('p', {}, state.folder || ''))); }
    else renderSetup();
  }

  async function start() {
    const folder = config.get('notebook.vscodeFolder', '') || undefined;
    const r = await window.toolbox.vscode.start({ folder });
    if (!r.ok && r.code !== 'missing') toast(r.error || 'VS Code 没起来', 'bad', 6000);
  }

  window.toolbox.vscode.onStatus(apply);
  const el = h('div', { class: 'vsc', hidden: true }, bar, frame);
  return {
    el,
    async activate() { const s = await window.toolbox.vscode.status(); apply(s); if (s.status !== 'running' && s.status !== 'starting' && s.status !== 'installing') { if (s.installed) start(); else renderSetup(); } },
  };
}
