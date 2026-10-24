import { h, toast } from '../../core/ui.js';

/**
 * MCP 配置：管理 Claude Desktop / Claude Code / OpenCode / Codex 里的 MCP 服务，
 * 另外一键安装「DeepSeek 路由」——给 Claude 一个把简单活交给 DeepSeek 的工具，省 Claude 额度。
 * 底层复用 mcp-factory（写入前留 .bak）；DeepSeek key 从保险箱取，只在主进程里过。
 */

const STYLE = `
.mcpt{display:flex;flex-direction:column;gap:14px;padding:18px;max-width:960px;margin:0 auto;height:100%;overflow:auto;box-sizing:border-box}
.mcpt__card{border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:16px 18px;background:rgba(255,255,255,.03);display:flex;flex-direction:column;gap:10px}
.mcpt__hero{background:linear-gradient(135deg,rgba(77,107,254,.16),rgba(0,174,236,.10));border-color:rgba(77,107,254,.35)}
.mcpt__h{display:flex;align-items:center;justify-content:space-between;gap:8px}
.mcpt__h h3{margin:0;font-size:15px}
.mcpt__sub{font-size:12px;opacity:.72;line-height:1.6}
.mcpt__row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mcpt__row .field{flex:1;min-width:180px}
.mcpt__lbl{font-size:12px;opacity:.75;min-width:64px}
.mcpt__chk{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,.05);font-size:13px;cursor:pointer}
.mcpt__badge{font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(63,191,135,.18);color:#3fbf87}
.mcpt__badge.is-off{background:rgba(255,255,255,.08);color:inherit;opacity:.6}
.mcpt__stat{display:flex;gap:18px;font-size:12px;opacity:.85}
.mcpt__stat b{font-size:16px;font-variant-numeric:tabular-nums}
.mcpt__status{font-size:12px;min-height:16px}
.mcpt__tabs{display:flex;gap:6px;flex-wrap:wrap}
.mcpt__tab{padding:6px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:transparent;color:inherit;cursor:pointer;font-size:12px}
.mcpt__tab.is-on{background:rgba(77,107,254,.22);border-color:rgba(77,107,254,.55)}
.mcpt__list{display:flex;flex-direction:column;gap:6px}
.mcpt__item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04)}
.mcpt__item span{flex:1;font-family:ui-monospace,Menlo,monospace;font-size:13px}
.mcpt__ta{width:100%;min-height:58px;resize:vertical;box-sizing:border-box;font-family:ui-monospace,Menlo,monospace;font-size:12px}
`;

const PASTE = '__paste__';

export default {
  id: 'mcp',
  title: 'MCP 配置',
  icon: 'link',
  hint: '管理 Claude / Codex / OpenCode 的 MCP 服务；一键给 Claude 装 DeepSeek 路由，简单活交给 DeepSeek 省额度',

  create(root) {
    const tb = window.toolbox || {};
    const skill = tb.skill || {}; const dsr = tb.deepseekRouter; const vaultApi = tb.vault;
    if (!document.getElementById('mcpt-style')) { const st = document.createElement('style'); st.id = 'mcpt-style'; st.textContent = STYLE; document.head.appendChild(st); }
    if (!dsr || !skill.mcpTargets) { root.append(h('div', { class: 'mcpt' }, h('div', { class: 'mcpt__card' }, 'MCP 配置服务没加载（重启工具箱试试）。'))); return {}; }

    // ================= DeepSeek 路由 =================
    const keySel = h('select', { class: 'field' });
    const keyInput = h('input', { class: 'field', type: 'password', placeholder: '粘贴 DeepSeek API key（sk-…）', style: 'display:none' });
    keySel.addEventListener('change', () => { keyInput.style.display = keySel.value === PASTE ? '' : 'none'; });
    const modelSel = h('select', { class: 'field', style: 'flex:0 0 auto;min-width:220px' },
      h('option', { value: 'deepseek-chat' }, 'deepseek-chat（快、便宜，默认）'),
      h('option', { value: 'deepseek-reasoner' }, 'deepseek-reasoner（推理型）'));
    const targetsWrap = h('div', { class: 'mcpt__row' });
    const checks = new Map();
    const dsStatus = h('div', { class: 'mcpt__status' });
    const statToday = h('b', {}, '0'); const statOut = h('b', {}, '0'); const statAll = h('b', {}, '0');

    const keyPayload = () => (keySel.value === PASTE ? { apiKey: keyInput.value.trim() } : { vaultId: keySel.value });
    const chosen = () => [...checks.entries()].filter(([, c]) => c.checked).map(([id]) => id);

    async function loadKeys() {
      keySel.innerHTML = '';
      let entries = [];
      try { const r = await vaultApi.list(); entries = (r && r.entries) || []; } catch { /* 没保险箱 */ }
      const ds = entries.filter((e) => /deepseek/i.test(`${e.title} ${e.url}`));
      const rest = entries.filter((e) => !ds.includes(e) && (e.kind === 'apikey' || /^sk-/i.test(e.title || '')));
      for (const e of ds) keySel.append(h('option', { value: e.id }, `🔑 ${e.title}（${(e.url || '').replace(/^https?:\/\//, '').slice(0, 30)}）`));
      if (rest.length) {
        const g = h('optgroup', { label: '保险箱里其他 key' });
        for (const e of rest) g.append(h('option', { value: e.id }, `${e.title}`));
        keySel.append(g);
      }
      keySel.append(h('option', { value: PASTE }, '✎ 直接粘贴一个 key…'));
      if (!ds.length) { keySel.value = PASTE; keyInput.style.display = ''; }
    }

    async function loadStatus() {
      const r = await dsr.status();
      targetsWrap.innerHTML = ''; checks.clear();
      targetsWrap.append(h('span', { class: 'mcpt__lbl' }, '装到'));
      for (const t of r.targets) {
        const c = h('input', { type: 'checkbox' }); c.checked = true; checks.set(t.id, c);
        const tip = t.id === 'claude-code' ? '（含桌面 Claude 的 Code 页）' : '（桌面聊天）';
        targetsWrap.append(h('label', { class: 'mcpt__chk', title: t.path }, c, `${t.label}${tip}`,
          h('span', { class: `mcpt__badge ${t.installed ? '' : 'is-off'}` }, t.installed ? '已装' : '未装')));
      }
      statToday.textContent = String(r.usage.today.n);
      statOut.textContent = String(r.usage.all.o);
      statAll.textContent = String(r.usage.all.n);
    }

    async function testKey() {
      dsStatus.textContent = '正在问 DeepSeek…';
      const r = await dsr.test({ ...keyPayload(), model: modelSel.value });
      dsStatus.textContent = r.ok ? `✓ key 可用：${r.model} 回答「${(r.reply || '').slice(0, 20)}」` : `✗ ${r.error}`;
    }

    async function install() {
      const targets = chosen();
      if (!targets.length) { toast('至少勾一个要装到的客户端'); return; }
      dsStatus.textContent = '先验证 key，再写入配置…';
      const r = await dsr.install({ ...keyPayload(), model: modelSel.value, targets });
      if (r.ok) {
        dsStatus.textContent = `✓ 已安装（${r.model}）。重启生效：Claude Desktop 要完全退出再开；Claude Code 新开一个会话。`;
        toast('DeepSeek 路由装好了');
      } else {
        const detail = (r.results || []).filter((x) => !x.ok).map((x) => `${x.label}：${x.error}`).join('；');
        dsStatus.textContent = `✗ ${r.error || detail || '安装失败'}`;
      }
      await loadStatus(); await loadServers();
    }

    async function uninstall() {
      const targets = chosen();
      if (!targets.length) return;
      await dsr.uninstall({ targets });
      dsStatus.textContent = '已从选中的客户端移除 DeepSeek 路由（重启生效）';
      await loadStatus(); await loadServers();
    }

    const dsCard = h('div', { class: 'mcpt__card mcpt__hero' },
      h('div', { class: 'mcpt__h' }, h('h3', {}, '🐋 DeepSeek 路由 · 简单活交给 DeepSeek，省 Claude 额度'),
        h('button', { class: 'btn btn--sm btn--ghost', onclick: () => { loadKeys(); loadStatus(); } }, '↻')),
      h('div', { class: 'mcpt__sub' }, '装好后 Claude 会多一个 deepseek 工具：翻译、总结、改写、格式转换、样板代码这类活它会转给 DeepSeek。'
        + '真正省额度靠两点：大文件只传路径（内容不进 Claude 上下文）、长结果直接写文件（不回灌）。'
        + 'key 会以明文写进所选客户端的 MCP 配置文件（MCP 的通行做法），写前自动备份 .bak。'),
      h('div', { class: 'mcpt__row' }, h('span', { class: 'mcpt__lbl' }, 'Key'), keySel, keyInput),
      h('div', { class: 'mcpt__row' }, h('span', { class: 'mcpt__lbl' }, '模型'), modelSel),
      targetsWrap,
      h('div', { class: 'mcpt__row' },
        h('button', { class: 'btn btn--sm', onclick: testKey }, '测试 key'),
        h('button', { class: 'btn btn--primary btn--sm', onclick: install }, '一键安装 / 更新'),
        h('button', { class: 'btn btn--ghost btn--sm', onclick: uninstall }, '从所选客户端卸载')),
      dsStatus,
      h('div', { class: 'mcpt__stat' },
        h('div', {}, '今天调用 ', statToday, ' 次'),
        h('div', {}, '累计 ', statAll, ' 次'),
        h('div', {}, '累计替 Claude 生成 ', statOut, ' tokens')));

    // ================= 已配置的 MCP =================
    let targets = []; let current = '';
    const tabs = h('div', { class: 'mcpt__tabs' });
    const pathLine = h('div', { class: 'mcpt__sub' });
    const list = h('div', { class: 'mcpt__list' });
    const fName = h('input', { class: 'field', placeholder: '名字，如 filesystem' });
    const fTransport = h('select', { class: 'field', style: 'flex:0 0 auto;min-width:150px' },
      h('option', { value: 'stdio' }, '本地命令 stdio'), h('option', { value: 'streamable-http' }, '远程 HTTP'), h('option', { value: 'sse' }, '远程 SSE'));
    const fCommand = h('input', { class: 'field', placeholder: '启动命令，如 npx 或 /usr/local/bin/uvx（远程填 URL）' });
    const fArgs = h('textarea', { class: 'field mcpt__ta', placeholder: '参数，一行一个，如\n-y\n@modelcontextprotocol/server-filesystem\n/Users/you/Documents' });
    const fEnv = h('textarea', { class: 'field mcpt__ta', placeholder: '环境变量 / 请求头，一行一个 KEY=VALUE（可留空）' });

    async function loadServers() {
      if (!targets.length) targets = await skill.mcpTargets();
      if (!current) current = (targets.find((t) => t.id === 'claude-code') || targets[0] || {}).id;
      tabs.innerHTML = '';
      for (const t of targets) tabs.append(h('button', { class: `mcpt__tab ${t.id === current ? 'is-on' : ''}`, onclick: () => { current = t.id; loadServers(); } }, `${t.label}${t.exists ? '' : '（未安装）'}`));
      list.innerHTML = '';
      const r = await skill.mcpList(current);
      pathLine.textContent = r.target ? `配置文件：${r.target.path}` : '';
      if (!r.ok) { list.append(h('div', { class: 'mcpt__sub' }, r.error)); return; }
      if (!r.servers.length) list.append(h('div', { class: 'mcpt__sub' }, '还没有 MCP 服务。'));
      for (const name of r.servers) {
        list.append(h('div', { class: 'mcpt__item' }, h('span', {}, name),
          h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => {
            const x = await skill.mcpRemove({ targetId: current, name });
            toast(x.ok ? `已删除 ${name}（备份在 .bak）` : x.error); loadServers(); loadStatus();
          } }, '删除')));
      }
    }

    function kv(text) {
      const o = {};
      for (const line of String(text || '').split('\n')) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
      return o;
    }

    async function addServer() {
      const transport = fTransport.value;
      const definition = transport === 'stdio'
        ? { name: fName.value, transport, command: fCommand.value, args: fArgs.value.split('\n').map((s) => s.trim()).filter(Boolean), env: kv(fEnv.value) }
        : { name: fName.value, transport, url: fCommand.value, headers: kv(fEnv.value) };
      const r = await skill.mcpWrite({ targetId: current, definition, overwrite: false });
      if (r.ok) { toast(`已加到 ${current}，重启该客户端生效`); fName.value = ''; fCommand.value = ''; fArgs.value = ''; fEnv.value = ''; loadServers(); }
      else toast(r.code === 'exists' ? '这个名字已经有了，先删掉旧的' : (r.error || '写入失败'));
    }

    const listCard = h('div', { class: 'mcpt__card' },
      h('div', { class: 'mcpt__h' }, h('h3', {}, '已配置的 MCP 服务')),
      tabs, pathLine, list,
      h('div', { class: 'mcpt__h', style: 'margin-top:6px' }, h('h3', {}, '添加一个 MCP')),
      h('div', { class: 'mcpt__row' }, fName, fTransport),
      h('div', { class: 'mcpt__row' }, fCommand),
      fArgs, fEnv,
      h('div', { class: 'mcpt__row' }, h('button', { class: 'btn btn--primary btn--sm', onclick: addServer }, '写入当前客户端')));

    root.append(h('div', { class: 'mcpt' }, dsCard, listCard));
    loadKeys(); loadStatus(); loadServers();
    return { activate() { loadStatus(); loadServers(); } };
  },
};
