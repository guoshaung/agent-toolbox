import { h, toast } from '../../core/ui.js';

/**
 * 接口台：发 GET / POST 这些请求，看回了什么。
 *
 * 请求是主进程发的，所以没有跨域拦截，Origin / Referer / Cookie 这些平时改不了的头
 * 在这儿都能随便写 —— 调后端接口恰恰最需要改它们。
 */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const BLANK = {
  name: '', method: 'GET', url: '', headers: '', body: '', bodyType: 'json',
  query: [], timeout: 30000, followRedirects: true,
};

export default {
  id: 'api',
  title: '接口台',
  icon: 'plug',
  hint: '发 HTTP 请求、看响应，支持 curl 互转',

  create(root, ctx) {
    const { config } = ctx;
    let current = { ...BLANK, ...(config.get('api.draft', {}) || {}) };
    let history = config.get('api.history', []) || [];
    let saved = config.get('api.saved', []) || [];
    let vars = config.get('api.vars', { base: 'http://127.0.0.1:3000' }) || {};
    let lastResponse = null;
    let sending = false;

    const save = () => {
      config.set('api.draft', current);
      config.set('api.history', history.slice(0, 60));
      config.set('api.saved', saved);
      config.set('api.vars', vars);
    };

    // ---------- 请求行 ----------
    const methodSelect = h('select', { class: 'field field--sm api__method', onchange: () => { current.method = methodSelect.value; syncBodyVisibility(); save(); } },
      ...METHODS.map((m) => h('option', { value: m }, m)));
    const urlInput = h('input', {
      class: 'field api__url', placeholder: 'https://api.example.com/users  或  {{base}}/users  （回车发送）',
      oninput: () => { current.url = urlInput.value; save(); },
      onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendNow(); } },
    });
    const sendBtn = h('button', { class: 'btn btn--primary api__send', onclick: () => sendNow() }, '发送');

    // ---------- 请求详情 ----------
    const headersArea = h('textarea', {
      class: 'field api__area', rows: 8, spellcheck: false,
      placeholder: '一行一个：\nContent-Type: application/json\nAuthorization: Bearer {{token}}',
      oninput: () => { current.headers = headersArea.value; save(); },
    });
    const bodyTypeRow = h('div', { class: 'api__chips' },
      ...[['json', 'JSON'], ['form', '表单'], ['raw', '纯文本']].map(([value, label]) => h('button', {
        class: 'btn btn--sm', dataset: { type: value },
        onclick: (e) => {
          current.bodyType = value; save();
          for (const b of bodyTypeRow.children) b.classList.toggle('btn--primary', b === e.currentTarget);
        },
      }, label)));
    const bodyArea = h('textarea', {
      class: 'field api__area', rows: 10, spellcheck: false, placeholder: '{\n  "name": "hello"\n}',
      oninput: () => { current.body = bodyArea.value; save(); },
    });
    const prettyBodyBtn = h('button', {
      class: 'btn btn--sm btn--ghost',
      onclick: () => {
        try { bodyArea.value = JSON.stringify(JSON.parse(bodyArea.value), null, 2); current.body = bodyArea.value; save(); }
        catch (error) { toast(`这不是合法 JSON：${error.message}`, 'bad'); }
      },
    }, '格式化 JSON');
    const bodyBox = h('div', { class: 'api__body-box' }, h('div', { class: 'api__row' }, bodyTypeRow, h('span', { style: { flex: 1 } }), prettyBodyBtn), bodyArea);

    const varsArea = h('textarea', {
      class: 'field api__area', rows: 6, spellcheck: false,
      placeholder: 'base=http://127.0.0.1:3000\ntoken=abc123',
      oninput: () => {
        vars = {};
        for (const line of varsArea.value.split('\n')) {
          const at = line.indexOf('=');
          if (at > 0) vars[line.slice(0, at).trim()] = line.slice(at + 1).trim();
        }
        save();
      },
    });

    const panes = {
      headers: h('div', { class: 'api__pane' }, h('p', { class: 'faint settings__hint' }, '想写什么头就写什么头 —— 主进程发的请求，浏览器那些限制在这里不存在。'), headersArea),
      body: h('div', { class: 'api__pane', hidden: true }, bodyBox),
      vars: h('div', { class: 'api__pane', hidden: true }, h('p', { class: 'faint settings__hint' }, '一行一个 名字=值。上面任何地方写 {{名字}} 都会被替换，换环境不用改一堆 URL。'), varsArea),
    };
    const tabRow = h('div', { class: 'api__tabs' },
      ...[['headers', '请求头'], ['body', '请求体'], ['vars', '环境变量']].map(([key, label], i) => h('button', {
        class: `btn btn--sm${i === 0 ? ' btn--primary' : ''}`,
        onclick: (e) => {
          for (const [k, pane] of Object.entries(panes)) pane.hidden = k !== key;
          for (const b of tabRow.children) b.classList.toggle('btn--primary', b === e.currentTarget);
        },
      }, label)));

    function syncBodyVisibility() {
      const noBody = ['GET', 'HEAD'].includes(current.method);
      bodyArea.disabled = noBody;
      bodyArea.placeholder = noBody ? `${current.method} 一般不带请求体` : '{\n  "name": "hello"\n}';
    }

    // ---------- 响应 ----------
    const statusPill = h('span', { class: 'tag' }, '还没发过');
    const timing = h('span', { class: 'faint api__timing' }, '');
    const respBody = h('pre', { class: 'api__resp' }, '发一条试试。左边能存常用的，右边是历史。');
    const respHeaders = h('pre', { class: 'api__resp', hidden: true }, '');
    const respTabs = h('div', { class: 'api__tabs' },
      ...[['body', '响应体'], ['headers', '响应头']].map(([key, label], i) => h('button', {
        class: `btn btn--sm${i === 0 ? ' btn--primary' : ''}`,
        onclick: (e) => {
          respBody.hidden = key !== 'body';
          respHeaders.hidden = key !== 'headers';
          for (const b of respTabs.children) b.classList.toggle('btn--primary', b === e.currentTarget);
        },
      }, label)));
    const copyRespBtn = h('button', { class: 'btn btn--sm btn--ghost', onclick: () => {
      navigator.clipboard.writeText(respBody.hidden ? respHeaders.textContent : respBody.textContent);
      toast('已复制', 'good', 1200);
    } }, '复制');

    // ---------- 左栏：收藏 + 历史 ----------
    const savedList = h('div', { class: 'api__list' });
    const historyList = h('div', { class: 'api__list' });

    function load(request) {
      current = { ...BLANK, ...request };
      methodSelect.value = current.method;
      urlInput.value = current.url;
      headersArea.value = current.headers || '';
      bodyArea.value = current.body || '';
      for (const b of bodyTypeRow.children) b.classList.toggle('btn--primary', b.dataset.type === current.bodyType);
      syncBodyVisibility();
      save();
    }

    function renderSaved() {
      savedList.replaceChildren(...(saved.length ? saved.map((item, i) => h('div', { class: 'api__item' },
        h('button', { class: 'api__item-main', onclick: () => load(item) },
          h('span', { class: `api__badge api__badge--${item.method.toLowerCase()}` }, item.method),
          h('span', { class: 'api__item-name' }, item.name || item.url)),
        h('button', { class: 'btn btn--icon btn--ghost', title: '删掉', onclick: () => { saved.splice(i, 1); save(); renderSaved(); } }, '×'),
      )) : [h('div', { class: 'faint api__empty' }, '常用的接口存在这里，点一下就填好。')]));
    }

    function renderHistory() {
      historyList.replaceChildren(...(history.length ? history.slice(0, 40).map((item) => h('button', { class: 'api__item-main', onclick: () => load(item) },
        h('span', { class: `api__badge api__badge--${(item.method || 'get').toLowerCase()}` }, item.method),
        h('span', { class: 'api__item-name' }, item.url),
        h('span', { class: `faint api__item-status${!item.status || item.status >= 400 ? ' is-bad' : ''}` }, item.status || '失败'),
      )) : [h('div', { class: 'faint api__empty' }, '发过的请求会记在这里。')]));
    }

    const saveBtn = h('button', { class: 'btn btn--sm', onclick: () => {
      if (!current.url.trim()) return toast('先写个网址', 'info');
      const name = window.prompt('给这个请求起个名字', current.name || `${current.method} ${current.url.slice(0, 40)}`);
      if (name == null) return;
      saved = [{ ...current, name }, ...saved.filter((s) => s.name !== name)].slice(0, 60);
      save(); renderSaved(); toast('存好了', 'good', 1400);
    } }, '存为常用');

    const curlInBtn = h('button', { class: 'btn btn--sm', onclick: async () => {
      const text = window.prompt('把 curl 粘进来（浏览器「Copy as cURL」出来的那一大坨也行）');
      if (!text) return;
      const result = await window.toolbox.http.fromCurl(text);
      if (!result.ok) return toast(result.error, 'bad');
      load(result.request);
      toast('拆好了', 'good', 1400);
    } }, '粘 curl 进来');

    const curlOutBtn = h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => {
      const curl = await window.toolbox.http.toCurl(current, vars);
      await navigator.clipboard.writeText(curl);
      toast('curl 已复制，可以直接粘进终端', 'good', 2200);
    } }, '复制成 curl');

    // ---------- 发送 ----------
    async function sendNow() {
      if (sending) return;
      if (!current.url.trim()) return toast('先写个网址', 'info');
      sending = true;
      sendBtn.disabled = true;
      sendBtn.textContent = '发送中…';
      statusPill.textContent = '等回应…';
      statusPill.className = 'tag';
      const response = await window.toolbox.http.send({ ...current, vars });
      sending = false;
      sendBtn.disabled = false;
      sendBtn.textContent = '发送';
      lastResponse = response;
      const warn = (response.warnings || []).length ? `\n\n⚠ ${response.warnings.join('\n⚠ ')}` : '';
      if (!response.ok) {
        statusPill.textContent = '没发出去';
        statusPill.className = 'tag tag--bad';
        timing.textContent = `${response.durationMs}ms`;
        respBody.textContent = response.error + warn;
        respHeaders.textContent = '';
        // 失败的也记进历史 —— 调接口时「刚才那条连不上的是哪个」同样要能翻回来
        history = [{ method: current.method, url: current.url, headers: current.headers, body: current.body, bodyType: current.bodyType, status: 0, at: Date.now() }, ...history].slice(0, 60);
        save();
        renderHistory();
        return;
      }
      const kind = response.status >= 500 ? 'bad' : response.status >= 400 ? 'warn' : 'good';
      statusPill.textContent = `${response.status} ${response.statusText || ''}`.trim();
      statusPill.className = `tag tag--${kind}`;
      timing.textContent = `${response.durationMs}ms · ${formatSize(response.size)}${response.truncated ? ' · 太大了只显示前 8MB' : ''}`;
      respBody.textContent = (pretty(response.body, response.contentType) || '（空响应体）') + warn;
      respHeaders.textContent = response.headers.map(([k, v]) => `${k}: ${v}`).join('\n');
      history = [{ method: current.method, url: response.url, headers: current.headers, body: current.body, bodyType: current.bodyType, status: response.status, at: Date.now() }, ...history].slice(0, 60);
      save();
      renderHistory();
    }

    function pretty(text, contentType) {
      if (/json/i.test(contentType || '')) {
        try { return JSON.stringify(JSON.parse(text), null, 2); } catch { /* 不是合法 JSON 就原样显示 */ }
      }
      return text;
    }
    const formatSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n > 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`);

    // 抓包台点「重放到接口台」时把请求送过来。它可能在本工具还没创建时就按了，
    // 所以除了直接调用，还会往 api.pending 里放一份，这边挂载和每次切回来都取一次。
    window.__toolApi = { load: (request) => { load(request); ctx.goto?.('api'); } };
    function takePending() {
      const pending = config.get('api.pending', null);
      if (!pending) return;
      config.set('api.pending', null);
      load(pending);
      toast('抓包台重放过来的请求已填好', 'good', 1800);
    }

    load(current);
    takePending();
    varsArea.value = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');
    renderSaved();
    renderHistory();

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '接口台'),
        h('span', { class: 'faint' }, '主进程发请求，没有跨域限制'),
        h('span', { style: { flex: 1 } }),
        curlInBtn, curlOutBtn, saveBtn,
      ),
      h('div', { class: 'api' },
        h('aside', { class: 'api__side' },
          h('div', { class: 'api__side-title' }, '常用'),
          savedList,
          h('div', { class: 'api__side-title' }, '历史'),
          historyList,
        ),
        h('section', { class: 'api__main' },
          h('div', { class: 'api__line' }, methodSelect, urlInput, sendBtn),
          tabRow,
          ...Object.values(panes),
          h('div', { class: 'api__resp-head' }, statusPill, timing, h('span', { style: { flex: 1 } }), respTabs, copyRespBtn),
          respBody, respHeaders,
        ),
      ),
    );
    return { activate: () => takePending() };
  },
};
