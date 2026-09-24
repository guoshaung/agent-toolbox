import { h, toast } from '../../core/ui.js';
import { md } from '../../core/md.js';

/**
 * 自动科研：五个「AI 自己做研究」的开源项目，一页切换。
 *
 * 左边选项目，右边按「拿代码 → 装环境 → 配置 → 跑 → 看产出」五步走。
 * 跑起来的进程归主进程管，这里只显示日志；起了网页的（AI-Researcher / DeepScientist）
 * 直接嵌进来。API key 不经手：配置文件由工具箱从模板复制出来，你在编辑器里填。
 */
export function createAutoResearch(root, ctx) {
  const { config } = ctx;
  const api = window.toolbox.autoresearch;
  let state = { projects: [], codeDir: '' };
  let currentId = config.get('research.autoresearch.project', 'ai-researcher');
  let currentMode = {};             // projectId -> modeId
  const fieldValues = config.get('research.autoresearch.fields', {});   // projectId.modeId.key -> value
  const consoles = new Map();       // projectId -> pre
  const views = new Map();          // projectId -> webview

  const list = h('div', { class: 'ar__list' });
  const detail = h('div', { class: 'ar__detail' });
  root.append(h('div', { class: 'ar__body' }, list, detail));

  const current = () => state.projects.find((p) => p.id === currentId) || state.projects[0];

  async function refresh() {
    state = await api.status();
    renderList();
    renderDetail();
  }

  function dot(ok, label) {
    return h('span', { class: `ar__dot ${ok ? 'is-ok' : ''}`, title: label });
  }

  function renderList() {
    list.replaceChildren(
      h('div', { class: 'ar__list-head' }, h('strong', {}, '自动科研'), h('span', { class: 'faint' }, '选一个项目')),
      ...state.projects.map((p) => h('button', {
        class: `ar__item ${p.id === currentId ? 'is-active' : ''}`,
        onclick: () => { currentId = p.id; config.set('research.autoresearch.project', p.id); renderList(); renderDetail(); },
      },
      h('div', { class: 'ar__item-top' }, h('span', { class: 'ar__item-name' }, p.name), p.job?.status === 'running' ? h('span', { class: 'tag tag--good ar__running' }, '跑着') : null),
      h('div', { class: 'ar__item-org faint' }, `${p.org} · ${p.badge}`),
      h('div', { class: 'ar__item-tags' }, ...p.tags.map((t) => h('span', { class: 'tag' }, t))),
      h('div', { class: 'ar__item-dots' }, dot(p.cloned, p.cloned ? '代码已在本机' : '还没拿代码'), dot(p.envReady, p.envReady ? '环境好了' : '环境还没装'), dot(p.configReady, p.configReady ? '配置有了' : '配置还没写')),
      )),
      h('div', { class: 'faint ar__list-foot' }, `代码都放在 ${state.codeDir}`),
    );
  }

  // ---------- 右侧 ----------

  function step(no, title, done, ...children) {
    return h('section', { class: `ar__step ${done ? 'is-done' : ''}` },
      h('div', { class: 'ar__step-head' }, h('span', { class: 'ar__step-no' }, done ? '✓' : String(no)), h('strong', {}, title)),
      h('div', { class: 'ar__step-body' }, ...children),
    );
  }

  function consoleFor(p) {
    if (!consoles.has(p.id)) {
      const pre = h('pre', { class: 'ar__console' });
      consoles.set(p.id, pre);
    }
    const pre = consoles.get(p.id);
    if (p.job && !pre.dataset.loaded) { pre.textContent = p.job.lines.join('\n'); pre.dataset.loaded = '1'; }
    return pre;
  }

  function appendLog(projectId, line) {
    const pre = consoles.get(projectId);
    if (!pre) return;
    const stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 24;
    pre.textContent += (pre.textContent ? '\n' : '') + line;
    const lines = pre.textContent.split('\n');
    if (lines.length > 600) pre.textContent = lines.slice(-600).join('\n');
    if (stick) pre.scrollTop = pre.scrollHeight;
  }

  function viewFor(p, url) {
    let view = views.get(p.id);
    if (!view) {
      view = h('webview', { partition: 'persist:autoresearch', src: url, class: 'ar__view' });
      views.set(p.id, view);
    } else if (view.getAttribute('src') !== url) view.setAttribute('src', url);
    return view;
  }

  function fieldKey(p, mode, f) { return `${p.id}.${mode.id}.${f.key}`; }

  function renderDetail() {
    const p = current();
    if (!p) { detail.replaceChildren(h('div', { class: 'empty' }, '没有可用的项目')); return; }
    const modeId = currentMode[p.id] || p.modes[0].id;
    const mode = p.modes.find((m) => m.id === modeId) || p.modes[0];
    const running = p.job?.status === 'running';

    // 头
    const head = h('div', { class: 'ar__head' },
      h('div', {},
        h('h2', { class: 'ar__title' }, p.name, h('span', { class: 'tag ar__badge' }, p.badge)),
        h('p', { class: 'ar__desc' }, p.desc),
        h('div', { class: 'ar__needs' }, ...p.needs.map((n) => h('span', { class: `tag ${n.ok ? 'tag--good' : 'tag--warn'}` }, `${n.ok ? '✓' : '✗'} ${n.label}`))),
      ),
      h('div', { class: 'ar__head-actions' },
        h('button', { class: 'btn btn--sm btn--ghost', onclick: () => window.toolbox.shell.openExternal(p.repo) }, 'GitHub ↗'),
        p.cloned && !p.workspace ? h('button', { class: 'btn btn--sm btn--ghost', title: '交给「收纳 → 看懂项目」，让 AI 讲它怎么跑、从哪读起', onclick: async () => { await config.set('tidy.pending', p.dir); ctx.goto('tidy'); } }, '让 AI 讲讲这个项目') : null,
      ),
    );

    // 1 拿代码
    const s1 = step(1, p.workspace ? '建工作目录' : '拿代码', p.cloned,
      h('div', { class: 'ar__row' },
        h('button', {
          class: 'btn btn--sm btn--primary', disabled: p.cloned,
          onclick: async (e) => {
            e.target.disabled = true; e.target.textContent = p.workspace ? '建目录…' : '克隆中…';
            const r = await api.prepare(p.id);
            if (!r.ok) toast(r.error, 'bad'); else toast(r.existed ? '已经在本机了' : `放到了 ${r.path}`, 'good');
            refresh();
          },
        }, p.cloned ? '已在本机' : (p.workspace ? '建目录' : `克隆到 ${state.codeDir.split('/').pop()}`)),
        p.cloned ? h('button', { class: 'btn btn--sm', onclick: () => api.openPath(p.dir) }, '打开文件夹') : null,
        h('span', { class: 'faint mono ar__path' }, p.dir),
      ),
    );

    // 2 装环境
    const s2 = step(2, '装环境', p.envReady,
      h('div', { class: 'ar__row' },
        h('button', {
          class: 'btn btn--sm btn--primary', disabled: !p.cloned || running,
          onclick: async () => { const r = await api.install(p.id); if (!r.ok) return toast(r.error, 'bad'); toast('开始装了，看下面的日志', 'info'); refresh(); },
        }, p.envReady ? '重新装一遍' : '一键装环境'),
        h('span', { class: 'faint' }, p.needs.filter((n) => !n.ok).length ? `缺：${p.needs.filter((n) => !n.ok).map((n) => n.label).join('、')}` : '依赖都在'),
      ),
    );

    // 3 配置
    let s3 = null;
    if (p.config) {
      const topicInput = p.id === 'agent-laboratory' ? h('input', { class: 'field field--sm ar__topic', placeholder: '研究题目，写具体一点', value: fieldValues[`${p.id}.topic`] || '', oninput: (e) => { fieldValues[`${p.id}.topic`] = e.target.value; config.set('research.autoresearch.fields', fieldValues); } }) : null;
      const copilot = p.id === 'agent-laboratory' ? h('label', { class: 'ar__check' }, h('input', { type: 'checkbox', checked: fieldValues[`${p.id}.copilot`] !== false, onchange: (e) => { fieldValues[`${p.id}.copilot`] = e.target.checked; config.set('research.autoresearch.fields', fieldValues); } }), '人机协作（每步问我一下）') : null;
      s3 = step(3, '配置', p.configReady,
        topicInput, copilot,
        h('div', { class: 'ar__row' },
          h('button', {
            class: 'btn btn--sm btn--primary', disabled: !p.cloned,
            onclick: async () => {
              const r = await api.ensureConfig(p.id, { topic: fieldValues[`${p.id}.topic`] || '', copilot: fieldValues[`${p.id}.copilot`] !== false, overwrite: p.configReady && p.id === 'agent-laboratory' && Boolean(fieldValues[`${p.id}.topic`]) });
              if (!r.ok) return toast(r.error, 'bad');
              await api.openPath(r.path);
              toast('已在编辑器里打开，填好保存就行', 'good');
              refresh();
            },
          }, p.configReady ? `打开 ${p.config.file}` : `生成并打开 ${p.config.file}`),
          h('span', { class: 'faint' }, p.config.hint),
        ),
        h('div', { class: 'faint ar__key-note' }, 'key 只写在这个文件里，工具箱不读不存。'),
      );
    }

    // 4 跑
    const modeTabs = h('div', { class: 'ar__modes' }, ...p.modes.map((m) => h('button', {
      class: `btn btn--sm ${m.id === mode.id ? 'is-active' : ''}`,
      onclick: () => { currentMode[p.id] = m.id; renderDetail(); },
    }, m.label)));
    const fields = h('div', { class: 'ar__fields' }, ...(mode.fields || []).map((f) => {
      const key = fieldKey(p, mode, f);
      const value = fieldValues[key] ?? f.default ?? '';
      const save = (v) => { fieldValues[key] = v; config.set('research.autoresearch.fields', fieldValues); };
      let input;
      if (f.type === 'select') input = h('select', { class: 'field field--sm', onchange: (e) => save(e.target.value) }, ...f.options.map((o) => h('option', { value: o, selected: o === value }, o)));
      else if (f.type === 'textarea') input = h('textarea', { class: 'field ar__textarea', rows: 3, oninput: (e) => save(e.target.value) }, value);
      else input = h('input', { class: 'field field--sm', value, oninput: (e) => save(e.target.value) });
      return h('label', { class: `ar__field ${f.type === 'textarea' ? 'ar__field--wide' : ''}` }, h('span', { class: 'ar__field-label' }, f.label), input);
    }));
    const params = () => Object.fromEntries((mode.fields || []).map((f) => [f.key, fieldValues[fieldKey(p, mode, f)] ?? f.default ?? '']));

    let runArea;
    if (mode.kind === 'manual') {
      runArea = h('div', { class: 'ar__manual' },
        h('pre', { class: 'ar__manual-text' }, mode.text),
        h('div', { class: 'ar__row' },
          h('button', { class: 'btn btn--sm btn--primary', onclick: async () => { await window.toolbox.clipboard.write(mode.text.split('\n\n').pop()); toast('提示词已复制，去 agent 里粘贴', 'good'); } }, '复制提示词'),
          p.cloned ? h('button', { class: 'btn btn--sm', onclick: () => api.openPath(p.dir) }, '打开目录') : null,
        ),
      );
    } else {
      runArea = h('div', { class: 'ar__row' },
        h('button', {
          class: 'btn btn--sm btn--primary', disabled: !p.cloned || running,
          onclick: async () => {
            const r = await api.run(p.id, mode.id, params());
            if (!r.ok) return toast(r.error, 'bad');
            consoles.get(p.id) && (consoles.get(p.id).textContent = '');
            toast(`${mode.label}：开始了`, 'good');
            refresh();
          },
        }, running && p.job?.modeId === mode.id ? '跑着…' : '开始'),
        running ? h('button', { class: 'btn btn--sm btn--danger', onclick: async () => { await api.stop(p.id); toast('已停', 'info'); setTimeout(refresh, 800); } }, `停掉「${p.job.label}」`) : null,
        p.job && p.job.status === 'exited' ? h('span', { class: `tag ${p.job.code === 0 ? 'tag--good' : 'tag--warn'}` }, `上次「${p.job.label}」${p.job.code === 0 ? '正常结束' : `退出码 ${p.job.code}`}`) : null,
      );
    }
    const s4 = step(4, '跑', false,
      modeTabs,
      mode.note ? h('p', { class: 'faint ar__note' }, mode.note) : null,
      fields, runArea,
    );

    // 网页 + 日志
    const pre = consoleFor(p);
    const logBox = h('div', { class: 'ar__log' },
      h('div', { class: 'ar__log-head' }, h('span', { class: 'faint' }, '日志'), h('button', { class: 'btn btn--sm btn--ghost', onclick: () => { pre.textContent = ''; } }, '清空')),
      pre,
    );
    const webBox = h('div', { class: 'ar__web', hidden: !(p.job?.url && running) });
    if (p.job?.url && running) {
      webBox.append(
        h('div', { class: 'ar__web-head' }, h('span', { class: 'mono faint' }, p.job.url), h('button', { class: 'btn btn--sm btn--ghost', onclick: () => window.toolbox.shell.openExternal(p.job.url) }, '在浏览器打开 ↗'), h('button', { class: 'btn btn--sm btn--ghost', onclick: () => views.get(p.id)?.reload() }, '刷新')),
        viewFor(p, p.job.url),
      );
    }

    // 5 产出
    const outList = h('div', { class: 'ar__outputs' });
    const preview = h('div', { class: 'ar__preview', hidden: true });
    async function loadOutputs() {
      const r = await api.outputs(p.id);
      outList.replaceChildren(...(r.files || []).slice(0, 20).map((f) => h('button', {
        class: 'ar__out', title: f.path,
        onclick: async () => {
          if (!/\.(md|json|txt|tex|csv|html)$/i.test(f.rel)) return api.openPath(f.path);
          const read = await api.readOutput(f.path);
          if (!read.ok) return toast(read.error, 'bad');
          preview.hidden = false;
          preview.replaceChildren(
            h('div', { class: 'ar__preview-head' }, h('span', { class: 'mono' }, f.rel), h('button', { class: 'btn btn--sm btn--ghost', onclick: () => api.openPath(f.path) }, '用系统程序打开'), h('button', { class: 'btn btn--sm btn--ghost', onclick: () => { preview.hidden = true; } }, '收起')),
            renderOutput(read),
          );
        },
      }, h('span', { class: 'ar__out-name' }, f.rel), h('span', { class: 'faint ar__out-meta' }, `${fmtSize(f.size)} · ${fmtTime(f.mtime)}`))));
      if (!(r.files || []).length) outList.replaceChildren(h('div', { class: 'faint' }, p.cloned ? '还没有产出' : '先把代码拿下来'));
    }
    const s5 = step(5, '看产出', false,
      h('div', { class: 'ar__row' }, h('button', { class: 'btn btn--sm', onclick: loadOutputs }, '刷新'), p.cloned ? h('button', { class: 'btn btn--sm btn--ghost', onclick: () => api.openPath(p.dir) }, '打开目录') : null),
      outList, preview,
    );

    detail.replaceChildren(...[head, s1, s2, s3, s4, webBox, logBox, s5].filter(Boolean));   // 没有配置步的项目 s3 是 null，别渲染成「null」
    if (p.cloned) loadOutputs();
  }

  /** idea 的 json 渲染成卡片，别的 json 直接美化；md 走 md() */
  function renderOutput(read) {
    if (read.ext === 'md') return h('div', { class: 'ar__md' }, md(read.text));
    if (read.ext === 'json') {
      try {
        const data = JSON.parse(read.text);
        const ideas = Array.isArray(data) ? data : (Array.isArray(data.ideas) ? data.ideas : null);
        if (ideas && ideas.length && typeof ideas[0] === 'object') {
          return h('div', { class: 'ar__ideas' }, ...ideas.map((idea, i) => h('div', { class: 'ar__idea' },
            h('div', { class: 'ar__idea-title' }, `${i + 1}. ${idea.Title || idea.title || idea.Name || idea.name || '未命名'}`),
            ...['Short Hypothesis', 'TL;DR', 'Abstract', 'Experiments', 'Risk Factors and Limitations', 'Related Work', 'Novelty'].filter((k) => idea[k]).map((k) => h('div', { class: 'ar__idea-sec' }, h('span', { class: 'ar__idea-k' }, k), h('span', {}, String(Array.isArray(idea[k]) ? idea[k].join('；') : idea[k])))),
          )));
        }
        return h('pre', { class: 'ar__raw' }, JSON.stringify(data, null, 2));
      } catch { /* 不是合法 JSON，按文本 */ }
    }
    return h('pre', { class: 'ar__raw' }, read.text);
  }

  function fmtSize(n) { return n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`; }
  function fmtTime(ms) { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

  // ---------- 主进程事件 ----------
  api.onLog(({ projectId, line, url }) => {
    appendLog(projectId, line);
    const p = state.projects.find((x) => x.id === projectId);
    if (p && p.job) {
      p.job.lines.push(line);
      if (url && !p.job.url) { p.job.url = url; if (projectId === currentId) renderDetail(); }
    }
  });
  api.onState(({ projectId, status, code }) => {
    const p = state.projects.find((x) => x.id === projectId);
    if (p) {
      if (status === 'exited') toast(`${p.name}：${p.job?.label || '任务'}${code === 0 ? '跑完了' : `退出了（码 ${code}）`}`, code === 0 ? 'good' : 'info');
    }
    refresh();
  });

  refresh();
  return { activate: refresh, refresh };
}
