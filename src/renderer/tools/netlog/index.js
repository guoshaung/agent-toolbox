import { h, toast } from '../../core/ui.js';

/**
 * 抓包台。
 *
 * 两路来源：工具箱里那些内嵌网页的全部请求（不用任何权限），以及一个本机 HTTP 代理
 * （别的应用把代理指过来就能抓）。不解密 HTTPS —— 那要装根证书做中间人，不是一个
 * 工具箱该悄悄干的事；HTTPS 只看得到域名、大小、耗时。
 */
const TYPE_LABEL = {
  mainFrame: '页面', subFrame: '内嵌页', xhr: 'XHR', fetch: 'fetch', script: 'JS',
  stylesheet: 'CSS', image: '图片', font: '字体', media: '媒体', webSocket: 'WS',
  ping: 'ping', cspReport: 'CSP', other: '其它', proxy: '代理', tunnel: '隧道',
};

export default {
  id: 'netlog',
  title: '抓包台',
  icon: 'activity',
  hint: '看应用内和本机代理的 HTTP 流量',

  create(root, ctx) {
    const { config } = ctx;
    let entries = [];
    let selected = null;
    let filter = config.get('netlog.filter', '') || '';
    let paused = false;
    let timer = 0;

    // ---------- 顶栏 ----------
    const stateTag = h('span', { class: 'tag' }, '未开始');
    const startBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => toggleCapture() }, '开始抓包');
    const pauseBtn = h('button', { class: 'btn btn--sm', onclick: () => { paused = !paused; pauseBtn.textContent = paused ? '继续' : '暂停刷新'; } }, '暂停刷新');
    const clearBtn = h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => { await window.toolbox.net.clear(); entries = []; selected = null; render(); } }, '清空');
    const harBtn = h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => {
      const result = await window.toolbox.net.exportHar();
      if (result.ok) toast(`已导出：${result.path}`, 'good', 4000);
      else if (!result.canceled) toast(result.error || '导出失败', 'bad');
    } }, '导出 HAR');

    const filterInput = h('input', {
      class: 'field field--sm netlog__filter', value: filter,
      placeholder: '过滤：api   status>=400   method==POST   host~baidu   -png （空格分隔，减号排除）',
      oninput: () => { filter = filterInput.value; config.set('netlog.filter', filter); render(); },
    });
    const countTag = h('span', { class: 'faint netlog__count' }, '');

    // ---------- 代理 ----------
    const portInput = h('input', { class: 'field field--sm netlog__port', type: 'number', value: config.get('netlog.proxyPort', 8899), oninput: () => config.set('netlog.proxyPort', Number(portInput.value) || 8899) });
    const proxyTag = h('span', { class: 'tag' }, '代理未开');
    const proxyBtn = h('button', { class: 'btn btn--sm', onclick: () => toggleProxy() }, '开启本机代理');
    const proxyHint = h('span', { class: 'faint' }, '开了之后把别的应用的 HTTP 代理指到 127.0.0.1 和这个端口。');

    // ---------- 列表 ----------
    const tableBody = h('div', { class: 'netlog__rows' });
    const table = h('div', { class: 'netlog__table' },
      h('div', { class: 'netlog__head' },
        h('span', {}, '时间'), h('span', {}, '方法'), h('span', {}, '域名'),
        h('span', {}, '路径'), h('span', {}, '状态'), h('span', {}, '类型'),
        h('span', {}, '大小'), h('span', {}, '耗时')),
      tableBody);

    // ---------- 详情 ----------
    const detailBox = h('div', { class: 'netlog__detail' }, h('div', { class: 'faint netlog__empty' }, '点上面任意一条看详情。'));

    async function toggleCapture() {
      const status = await window.toolbox.net.status();
      if (status.capturing) {
        await window.toolbox.net.stop();
        startBtn.textContent = '开始抓包';
        stateTag.textContent = '已停止';
        stateTag.className = 'tag';
        clearInterval(timer);
        timer = 0;
      } else {
        const result = await window.toolbox.net.start();
        if (!result.ok) return toast(result.error || '开不了', 'bad');
        startBtn.textContent = '停止抓包';
        stateTag.textContent = '抓取中';
        stateTag.className = 'tag tag--good';
        clearInterval(timer);
        timer = setInterval(refresh, 1000);
        refresh();
      }
    }

    async function toggleProxy() {
      const status = await window.toolbox.net.status();
      if (status.proxyOn) {
        await window.toolbox.net.proxyStop();
        proxyTag.textContent = '代理未开';
        proxyTag.className = 'tag';
        proxyBtn.textContent = '开启本机代理';
      } else {
        const result = await window.toolbox.net.proxyStart(Number(portInput.value) || 8899);
        if (!result.ok) return toast(result.error || '代理起不来', 'bad');
        proxyTag.textContent = `127.0.0.1:${result.port}`;
        proxyTag.className = 'tag tag--good';
        proxyBtn.textContent = '关闭代理';
        toast(`代理开在 127.0.0.1:${result.port}，把别的应用指过来`, 'good', 5000);
      }
    }

    async function refresh() {
      if (paused) return;
      entries = await window.toolbox.net.list({ limit: 800 });
      render();
    }

    function matches(entry) {
      const text = filter.trim();
      if (!text) return true;
      return text.split(/\s+/).every((token) => {
        const negate = token.startsWith('-');
        const term = negate ? token.slice(1) : token;
        const hit = matchTerm(entry, term);
        return negate ? !hit : hit;
      });
    }
    function matchTerm(entry, term) {
      const cmp = term.match(/^(status|size|ms)\s*(>=|<=|>|<|==|=)\s*(\d+)$/i);
      if (cmp) {
        const value = Number(entry[cmp[1].toLowerCase()] || 0);
        const target = Number(cmp[3]);
        return cmp[2] === '>' ? value > target : cmp[2] === '<' ? value < target
          : cmp[2] === '>=' ? value >= target : cmp[2] === '<=' ? value <= target : value === target;
      }
      const field = term.match(/^(method|host|type|path|url)\s*(==|=|~)\s*(.+)$/i);
      if (field) {
        const value = String(entry[field[1].toLowerCase()] || '').toLowerCase();
        const target = field[3].toLowerCase();
        return field[2] === '~' ? value.includes(target) : value === target;
      }
      return `${entry.method} ${entry.url} ${entry.type} ${entry.status}`.toLowerCase().includes(term.toLowerCase());
    }

    function render() {
      const shown = entries.filter(matches);
      countTag.textContent = `${shown.length} / ${entries.length} 条`;
      const atBottom = tableBody.scrollTop + tableBody.clientHeight >= tableBody.scrollHeight - 40;
      tableBody.replaceChildren(...(shown.length ? shown.slice(-400).map((e) => {
        const bad = e.error || e.status >= 400;
        const row = h('button', {
          class: `netlog__row${bad ? ' is-bad' : ''}${selected === e.id ? ' is-on' : ''}`,
          onclick: () => showDetail(e.id),
        },
          h('span', {}, new Date(e.startedAt).toLocaleTimeString('zh-CN', { hour12: false })),
          h('span', { class: `api__badge api__badge--${(e.method || '').toLowerCase()}` }, e.method),
          h('span', { class: 'netlog__host', title: e.host }, e.host),
          h('span', { class: 'netlog__path', title: e.url }, e.path),
          h('span', { class: bad ? 'netlog__status is-bad' : 'netlog__status' }, e.error ? '失败' : (e.status || (e.done ? '—' : '…'))),
          h('span', { class: 'faint' }, TYPE_LABEL[e.type] || e.type || ''),
          h('span', { class: 'faint' }, e.size ? formatSize(e.size) : (e.fromCache ? '缓存' : '')),
          h('span', { class: 'faint' }, e.done ? `${e.ms}ms` : ''),
        );
        return row;
      }) : [h('div', { class: 'faint netlog__empty' }, entries.length ? '没有匹配这个过滤器的请求。' : '还没抓到东西 —— 点「开始抓包」，然后在工具箱里随便打开一个网页栏目。')]));
      if (atBottom) tableBody.scrollTop = tableBody.scrollHeight;
    }

    async function showDetail(id) {
      selected = id;
      render();
      const entry = await window.toolbox.net.detail(id);
      if (!entry) { detailBox.replaceChildren(h('div', { class: 'faint netlog__empty' }, '这条已经被挤掉了。')); return; }
      const section = (title, text) => (text ? [h('div', { class: 'netlog__section' }, title), h('pre', { class: 'netlog__pre' }, text)] : []);
      const headerText = (list) => (list || []).map(([k, v]) => `${k}: ${v}`).join('\n');
      detailBox.replaceChildren(
        h('div', { class: 'netlog__detail-head' },
          h('span', { class: `api__badge api__badge--${(entry.method || '').toLowerCase()}` }, entry.method),
          h('strong', { class: 'netlog__detail-url' }, entry.url),
          h('span', { style: { flex: 1 } }),
          h('button', { class: 'btn btn--sm', onclick: () => replay(entry) }, '重放到接口台'),
          h('button', { class: 'btn btn--sm btn--ghost', onclick: () => copyCurl(entry) }, '复制成 curl'),
        ),
        h('div', { class: 'faint netlog__meta' },
          `${entry.status || '—'} · ${entry.done ? `${entry.ms}ms` : '进行中'} · ${formatSize(entry.size)} · ${entry.source === 'proxy' ? '本机代理' : '应用内'}${entry.fromCache ? ' · 走了缓存' : ''}${entry.error ? ` · ${entry.error}` : ''}`),
        ...section('请求头', headerText(entry.reqHeaders)),
        ...section('请求体', entry.reqBody),
        ...section('响应头', headerText(entry.resHeaders)),
        ...section('响应体', entry.resBody || (entry.source === 'app' ? '应用内流量拿不到响应体 —— 点上面「重放到接口台」就能看到完整的。' : '')),
      );
    }

    function toRequest(entry) {
      return {
        method: entry.method === 'CONNECT' ? 'GET' : entry.method,
        url: entry.url,
        headers: (entry.reqHeaders || []).filter(([k]) => !/^(host|content-length|connection|proxy-)/i.test(k)).map(([k, v]) => `${k}: ${v}`).join('\n'),
        body: entry.reqBody || '',
        bodyType: /json/i.test(headerValue(entry.reqHeaders, 'content-type')) ? 'json' : 'raw',
      };
    }
    const headerValue = (list, name) => ((list || []).find(([k]) => k.toLowerCase() === name) || [])[1] || '';

    function replay(entry) {
      // 接口台可能还没被打开过（工具是首次进入时才创建的），所以先把请求暂存进配置，
      // 再切过去 —— 接口台挂载 / 激活时都会来取。不能依赖它已经在内存里。
      config.set('api.pending', toRequest(entry));
      if (window.__toolApi) window.__toolApi.load(toRequest(entry));
      ctx.goto?.('api');
      toast('已经填进接口台了', 'good', 1600);
    }
    async function copyCurl(entry) {
      const curl = await window.toolbox.http.toCurl(toRequest(entry), {});
      await navigator.clipboard.writeText(curl);
      toast('curl 已复制', 'good', 1400);
    }

    const formatSize = (n) => (!n ? '—' : n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n > 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`);

    /**
     * 每次切回这个栏目都重新对一次状态。
     * 工具面板只创建一次（切栏目只是显示/隐藏），离开时 deactivate 把轮询关掉了 ——
     * 只在 create 里同步一次的话，切走再回来表格就永远停在旧数据上。
     */
    async function syncStatus() {
      const status = await window.toolbox.net.status();
      startBtn.textContent = status.capturing ? '停止抓包' : '开始抓包';
      stateTag.textContent = status.capturing ? '抓取中' : '未开始';
      stateTag.className = status.capturing ? 'tag tag--good' : 'tag';
      proxyTag.textContent = status.proxyOn ? `127.0.0.1:${status.proxyPort}` : '代理未开';
      proxyTag.className = status.proxyOn ? 'tag tag--good' : 'tag';
      proxyBtn.textContent = status.proxyOn ? '关闭代理' : '开启本机代理';
      clearInterval(timer);
      timer = 0;
      if (status.capturing) {
        timer = setInterval(refresh, 1000);
        await refresh();
      } else {
        render();
      }
    }
    syncStatus();

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '抓包台'),
        h('span', { class: 'faint' }, '应用内流量 + 本机代理'),
        h('span', { style: { flex: 1 } }),
        stateTag, startBtn, pauseBtn, clearBtn, harBtn,
      ),
      h('div', { class: 'netlog' },
        h('div', { class: 'netlog__bar' }, filterInput, countTag),
        h('div', { class: 'netlog__bar netlog__bar--proxy' }, proxyTag, portInput, proxyBtn, proxyHint),
        table,
        detailBox,
      ),
    );
    return { activate: () => syncStatus(), deactivate: () => { clearInterval(timer); timer = 0; } };
  },
};
