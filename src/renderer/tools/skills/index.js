import { h, toast } from '../../core/ui.js';

const AI_SYSTEM = `你是一个严谨的 Agent Skill 架构师。把用户提供的经验整理成可复用、可执行的 SKILL.md。
输出只允许是 Markdown 文件内容，不要解释，不要包裹代码围栏。
必须包含 YAML frontmatter：name（小写字母、数字和连字符）、description（说明做什么以及何时使用）、disable-model-invocation: true。
正文要短而具体，包含 Instructions；把隐含前提、输入输出、失败处理和验证方法写出来。`;

function cleanMarkdown(text) {
  return String(text || '').trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function metaFromMarkdown(markdown) {
  const name = String(markdown || '').match(/^name:\s*([^\r\n]+)/m)?.[1]?.replace(/^['"]|['"]$/g, '').trim();
  const description = String(markdown || '').match(/^description:\s*(.+)$/m)?.[1]?.replace(/^['"]|['"]$/g, '').trim();
  return { name: name || '', description: description || '' };
}

function targetPicker(targetsPromise, registry) {
  const select = h('select', { class: 'field field--sm skills__target-select' });
  const custom = h('input', { class: 'field field--sm skills__target-custom', placeholder: '/Users/你/.cursor/skills', hidden: true });
  const root = h('div', { class: 'skills__target' },
    h('span', { class: 'skills__field-label' }, '输出到'),
    select,
    custom,
  );
  const state = { targets: [], custom };
  registry.push(state);
  select.addEventListener('change', () => {
    custom.hidden = select.value !== '__custom__';
  });
  targetsPromise.then((targets) => {
    state.targets = Array.isArray(targets) ? targets : [];
    select.textContent = '';
    for (const target of state.targets) select.appendChild(h('option', { value: target.path }, target.label));
    select.appendChild(h('option', { value: '__custom__' }, '自定义目录…'));
    if (state.targets[0]) select.value = state.targets[0].path;
  }).catch(() => {
    select.appendChild(h('option', { value: '__custom__' }, '自定义目录…'));
    select.value = '__custom__';
    custom.hidden = false;
  });
  return {
    root,
    getDirectory: () => select.value === '__custom__' ? custom.value.trim() : select.value,
  };
}

function labeled(label, control, className = '') {
  return h('label', { class: `skills__labeled ${className}`.trim() }, h('span', {}, label), control);
}

function sectionHead(kicker, title, detail = '') {
  return h('div', { class: 'skills__section-head' },
    h('div', {},
      h('span', { class: 'skills__eyebrow' }, kicker),
      h('h2', {}, title),
      detail && h('p', { class: 'faint' }, detail),
    ),
  );
}

export default {
  id: 'skills',
  title: 'Skill 工厂',
  icon: 'testTube',
  hint: '蒸馏经验、创建和管理 Agent Skill',

  create(root, ctx) {
    const { ai, config } = ctx;
    const tool = window.toolbox.skill;
    const targetsPromise = tool.targets();
    const targetRegistry = [];
    const panels = new Map();
    const tabBar = h('div', { class: 'research__subbar skills__tabs' });
    const body = h('div', { class: 'research__subbody' });
    const tabs = [
      { id: 'distill', label: '蒸馏 Skill' },
      { id: 'create', label: '创建 Skill' },
      { id: 'library', label: '技能库' },
      { id: 'mcp', label: '自定义 MCP' },
    ];
    let current = config.get('skills.view', 'distill');
    let refreshLibrary = () => {};

    async function saveSkill({ picker, name, description, content }) {
      if (!name.trim()) return toast('先填 Skill 名称', 'info');
      if (!description.trim()) return toast('补一句这个 Skill 什么时候使用', 'info');
      const directory = picker.getDirectory();
      if (!directory) return toast('先选择 Skill 输出目录', 'info');
      let result = await tool.write({ directory, name, description, content });
      if (result.code === 'exists') {
        if (!window.confirm(`「${name}」已经存在，覆盖它吗？`)) return;
        result = await tool.write({ directory, name, description, content, overwrite: true });
      }
      if (!result.ok) return toast(result.error || 'Skill 保存失败', 'bad');
      toast(`已生成 ${result.name}/SKILL.md`, 'good');
      refreshLibrary();
      return result;
    }

    function makeDistill() {
      const name = h('input', { class: 'field', placeholder: '例如：research-paper-review' });
      const description = h('input', { class: 'field', placeholder: '例如：审阅研究论文并提取方法、证据与风险；用户要求看论文或做文献评审时使用' });
      const focus = h('input', { class: 'field', placeholder: '希望它重点保留什么？例如：只保留可验证的研究流程和检查清单' });
      const source = h('textarea', { class: 'field skills__source', placeholder: '粘贴聊天记录、操作笔记、提示词、代码片段或一段经验…' });
      const preview = h('textarea', { class: 'field skills__editor', placeholder: '蒸馏结果会出现在这里，也可以直接修改后保存。' });
      const status = h('span', { class: 'faint skills__status' });
      const picker = targetPicker(targetsPromise, targetRegistry);
      const distill = h('button', { class: 'btn btn--primary', onclick: async () => {
        const input = source.value.trim();
        if (!input) return toast('先粘贴一段经验或聊天记录', 'info');
        if (input.length > 80000) return toast('素材太长了，先压缩到 8 万字以内', 'info');
        distill.disabled = true;
        status.textContent = 'AI 正在提炼可复用规则…';
        try {
          const prompt = `请把下面素材蒸馏成一个可复用 Skill。\nSkill 名称：${name.value.trim() || '请根据内容命名'}\n初始描述：${description.value.trim() || '请补全'}\n重点：${focus.value.trim() || '保留最有价值、可执行、可验证的部分'}\n\n素材：\n${input}`;
          const result = cleanMarkdown(await ai.chat(prompt, { system: AI_SYSTEM }));
          const meta = metaFromMarkdown(result);
          if (meta.name && !name.value.trim()) name.value = meta.name;
          if (meta.description && !description.value.trim()) description.value = meta.description;
          preview.value = result;
          status.textContent = '蒸馏完成，可以检查后保存。';
        } catch (err) {
          status.textContent = '';
          toast(`蒸馏失败：${err.message}`, 'bad', 6000);
        } finally { distill.disabled = false; }
      } }, '开始蒸馏');
      const save = h('button', { class: 'btn', onclick: () => saveSkill({ picker, name: name.value.trim(), description: description.value.trim(), content: preview.value }) }, '保存 Skill');
      const copy = h('button', { class: 'btn btn--ghost', onclick: async () => { await window.toolbox.clipboard.write(preview.value); toast('SKILL.md 已复制', 'good'); } }, '复制');
      return h('div', { class: 'skills__panel skills__distill' },
        sectionHead('DISTILL', '把经验变成 Skill', '把真正有用的做法留下来，生成可以反复调用的工作规范。'),
        h('div', { class: 'skills__form-grid' },
          labeled('名称', name), labeled('描述', description, 'skills__wide'), labeled('蒸馏重点', focus, 'skills__wide'), picker.root,
        ),
        h('div', { class: 'skills__split' },
          h('div', { class: 'skills__editor-pane' }, labeled('素材', source), h('div', { class: 'skills__actions' }, distill, status)),
          h('div', { class: 'skills__editor-pane' }, labeled('SKILL.md 预览', preview), h('div', { class: 'skills__actions' }, save, copy)),
        ),
      );
    }

    function makeCreate() {
      const name = h('input', { class: 'field', placeholder: '例如：meeting-notes' });
      const description = h('input', { class: 'field', placeholder: '做什么；什么情况下触发' });
      const when = h('textarea', { class: 'field skills__compact-text', placeholder: '触发条件：\n- 用户要求整理会议记录\n- 输入包含会议纪要或逐字稿' });
      const instructions = h('textarea', { class: 'field skills__source', placeholder: '写清楚输入、步骤、判断标准、失败处理和最终输出。' });
      const references = h('textarea', { class: 'field skills__compact-text', placeholder: '可选：参考文件、命令或工具。' });
      const examples = h('textarea', { class: 'field skills__compact-text', placeholder: '可选：给一个最小输入和期望输出。' });
      const preview = h('textarea', { class: 'field skills__editor', placeholder: '点「生成草稿」后可继续编辑。' });
      const picker = targetPicker(targetsPromise, targetRegistry);

      function buildDraft() {
        const title = name.value.trim() || 'my-skill';
        const body = [
          '## When to use', '', when.value.trim() || 'Describe when this Skill should be used.',
          '', '## Instructions', '', instructions.value.trim() || '1. Clarify the input.\n2. Follow the workflow.\n3. Verify the result before returning it.',
          references.value.trim() && ['', '## References', '', references.value.trim()].join('\n'),
          examples.value.trim() && ['', '## Examples', '', examples.value.trim()].join('\n'),
        ].filter(Boolean).join('\n');
        return `---\nname: ${title}\ndescription: "${description.value.trim() || 'Describe what this Skill does and when to use it.'}"\ndisable-model-invocation: true\n---\n\n# ${title}\n\n${body}`;
      }

      const generate = h('button', { class: 'btn btn--primary', onclick: () => { preview.value = buildDraft(); } }, '生成草稿');
      const polish = h('button', { class: 'btn', onclick: async () => {
        if (!instructions.value.trim()) return toast('先写一点工作步骤，AI 才有东西可补全', 'info');
        polish.disabled = true;
        try {
          const prompt = `请补全下面 Skill 的 Instructions，只返回正文 Markdown，不要 frontmatter。\n名称：${name.value.trim()}\n描述：${description.value.trim()}\n触发条件：${when.value.trim()}\n现有步骤：${instructions.value.trim()}\n要求：补上输入输出、边界条件、失败处理和验证清单，保持简洁可执行。`;
          instructions.value = cleanMarkdown(await ai.chat(prompt, { system: AI_SYSTEM }));
          preview.value = buildDraft();
          toast('步骤已补全', 'good');
        } catch (err) { toast(`AI 补全失败：${err.message}`, 'bad', 6000); }
        finally { polish.disabled = false; }
      } }, 'AI 补全步骤');
      const save = h('button', { class: 'btn', onclick: () => saveSkill({ picker, name: name.value.trim(), description: description.value.trim(), content: preview.value || buildDraft() }) }, '保存 Skill');
      const copy = h('button', { class: 'btn btn--ghost', onclick: async () => { await window.toolbox.clipboard.write(preview.value || buildDraft()); toast('SKILL.md 已复制', 'good'); } }, '复制');
      return h('div', { class: 'skills__panel skills__create' },
        sectionHead('CREATE', '从零创建 Skill', '你掌握流程，工厂负责把它装进正确的文件结构。'),
        h('div', { class: 'skills__form-grid' },
          labeled('名称', name), labeled('描述', description, 'skills__wide'), picker.root,
          labeled('什么时候用', when, 'skills__wide'), labeled('工作步骤', instructions, 'skills__wide'),
          labeled('参考资料', references), labeled('示例', examples),
        ),
        h('div', { class: 'skills__actions skills__create-actions' }, generate, polish),
        h('div', { class: 'skills__preview-block' }, labeled('SKILL.md 预览', preview), h('div', { class: 'skills__actions' }, save, copy)),
      );
    }

    function makeLibrary() {
      const search = h('input', { class: 'field skills__library-search', placeholder: '搜索名称、描述或目录…' });
      const list = h('div', { class: 'skills__library-list' });
      const detail = h('div', { class: 'skills__library-detail' });
      let records = [];
      let selected = null;

      async function open(record) {
        selected = record;
        detail.textContent = '';
        detail.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), '正在读取 Skill…'));
        const result = await tool.read(record.path);
        detail.textContent = '';
        if (!result.ok) return detail.append(h('div', { class: 'empty' }, result.error));
        const content = h('textarea', { class: 'field skills__library-editor', readonly: true });
        content.value = result.content;
        detail.append(
          h('div', { class: 'skills__library-detail-head' },
            h('div', {}, h('h2', {}, record.name), h('span', { class: 'faint' }, record.scope)),
            h('div', { class: 'skills__actions' },
              h('button', { class: 'btn btn--sm', onclick: async () => { await window.toolbox.clipboard.write(result.content); toast('Skill 已复制', 'good'); } }, '复制'),
              h('button', { class: 'btn btn--sm btn--ghost', onclick: () => tool.reveal(record.path) }, '在文件夹中显示'),
            ),
          ),
          h('p', { class: 'faint skills__library-description' }, record.description),
          content,
        );
      }

      function render() {
        const query = search.value.trim().toLowerCase();
        const shown = records.filter((item) => `${item.name} ${item.description} ${item.scope}`.toLowerCase().includes(query));
        list.textContent = '';
        list.appendChild(h('div', { class: 'skills__library-count faint' }, `${shown.length} 个 Skill`));
        if (!shown.length) {
          list.appendChild(h('div', { class: 'empty' }, h('span', { class: 'empty__icon' }, '🧪'), records.length ? '没有匹配的 Skill' : '还没有发现本机 Skill。'));
          return;
        }
        for (const record of shown) list.appendChild(h('button', {
          class: `skills__library-item${selected?.path === record.path ? ' is-active' : ''}`,
          onclick: () => { open(record); render(); },
        }, h('span', { class: 'skills__library-item-name' }, record.name), h('span', { class: 'skills__library-item-desc' }, record.description), h('span', { class: 'faint' }, record.scope)));
      }

      async function refresh() {
        try { records = await tool.list(); render(); }
        catch (err) { list.textContent = ''; list.appendChild(h('div', { class: 'empty' }, `扫描失败：${err.message}`)); }
      }

      search.addEventListener('input', render);
      refreshLibrary = refresh;
      const panel = h('div', { class: 'skills__panel skills__library' },
        h('div', { class: 'skills__library-top' }, sectionHead('LIBRARY', '我的 Skills', '扫描项目和个人目录，选中后可直接查看全文。'), h('div', { class: 'skills__actions' }, search, h('button', { class: 'btn btn--sm btn--primary', onclick: refresh }, '刷新'))),
        h('div', { class: 'skills__library-workspace' }, list, detail),
      );
      refresh();
      return panel;
    }

    function makeMcp() {
      const name = h('input', { class: 'field', placeholder: '例如：context7、filesystem、my-search' });
      const target = h('select', { class: 'field' });
      const targetPath = h('code', { class: 'faint skills__mcp-target-path' });
      const transport = h('select', { class: 'field' },
        h('option', { value: 'stdio' }, '本地进程 · stdio'),
        h('option', { value: 'streamable-http' }, '远程服务 · Streamable HTTP'),
        h('option', { value: 'sse' }, '远程服务 · SSE'),
      );
      const command = h('input', { class: 'field mono', placeholder: '例如：npx' });
      const args = h('textarea', { class: 'field skills__mcp-args', placeholder: '参数，每行一个：\n-y\n@modelcontextprotocol/server-filesystem\n/Users/你/Documents' });
      const url = h('input', { class: 'field mono', placeholder: 'https://example.com/mcp' });
      const env = h('textarea', { class: 'field skills__mcp-map mono', placeholder: '{\n  \"API_KEY\": \"填你的值\"\n}' });
      const headers = h('textarea', { class: 'field skills__mcp-map mono', placeholder: '{\n  \"Authorization\": \"Bearer ...\"\n}' });
      const enabled = h('input', { type: 'checkbox', checked: true });
      const preview = h('textarea', { class: 'field skills__mcp-preview', readonly: true, spellcheck: false, placeholder: '生成后这里会显示可复制的配置。' });
      const serverList = h('div', { class: 'skills__mcp-servers' });
      const status = h('span', { class: 'faint skills__status' });
      let targets = [];

      function currentTarget() { return targets.find((item) => item.id === target.value); }
      function parseMap(value, label) {
        if (!value.trim()) return {};
        try {
          const parsed = JSON.parse(value);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(label + ' 必须是 JSON 对象');
          return parsed;
        } catch (error) { throw new Error(label + ' JSON 无效：' + error.message); }
      }
      function definition() {
        return {
          name: name.value.trim(),
          transport: transport.value,
          command: command.value.trim(),
          args: args.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
          url: url.value.trim(),
          env: parseMap(env.value, '环境变量'),
          headers: parseMap(headers.value, '请求头'),
          enabled: enabled.checked,
        };
      }
      function syncTransport() {
        const local = transport.value === 'stdio';
        command.parentElement?.classList.toggle('skills__mcp-hidden', !local);
        args.parentElement?.classList.toggle('skills__mcp-hidden', !local);
        url.parentElement?.classList.toggle('skills__mcp-hidden', local);
        headers.parentElement?.classList.toggle('skills__mcp-hidden', local);
      }
      function syncTarget() {
        const item = currentTarget();
        targetPath.textContent = item ? item.path + ' · ' + item.hint : '';
        refreshServers();
        updatePreview();
      }
      async function updatePreview() {
        const item = currentTarget();
        if (!item) return;
        try {
          const result = await tool.mcpSnippet({ targetId: item.id, definition: definition() });
          preview.value = result.ok ? result.content : result.error;
        } catch (error) { preview.value = error.message; }
      }
      async function refreshServers() {
        const item = currentTarget();
        if (!item) return;
        const result = await tool.mcpList(item.id);
        serverList.replaceChildren();
        if (!result.ok) return serverList.append(h('div', { class: 'empty' }, result.error));
        if (!result.servers.length) return serverList.append(h('div', { class: 'empty' }, '这个目标还没有 MCP 服务。'));
        for (const service of result.servers) {
          serverList.append(h('div', { class: 'skills__mcp-server' },
            h('code', {}, service),
            h('button', {
              class: 'btn btn--sm btn--ghost',
              title: '从目标配置中删除这个服务（删除前会备份）',
              onclick: async () => {
                if (!window.confirm('确定从 ' + item.label + ' 删除 ' + service + '？')) return;
                const removed = await tool.mcpRemove({ targetId: item.id, name: service });
                if (!removed.ok) return toast(removed.error, 'bad');
                toast('已删除 ' + service + '，备份：' + removed.backup, 'good', 5000);
                refreshServers();
              },
            }, '删除'),
          ));
        }
      }
      async function refreshTargets() {
        try {
          targets = await tool.mcpTargets();
          target.replaceChildren(...targets.map((item) => h('option', { value: item.id }, item.label + (item.exists ? ' · 已存在' : ' · 将新建'))));
          if (targets[0]) target.value = (targets.find((item) => item.id === 'claude-code') || targets[0]).id;
          syncTarget();
        } catch (error) { status.textContent = '读取 MCP 目标失败：' + error.message; }
      }
      async function save() {
        try {
          const item = currentTarget();
          if (!item) return toast('没有可写入的 MCP 目标', 'bad');
          const result = await tool.mcpWrite({ targetId: item.id, definition: definition(), overwrite: true });
          if (!result.ok) return toast(result.error, 'bad', 6000);
          preview.value = result.format === 'codex'
            ? result.snippet
            : JSON.stringify({ [result.format === 'opencode' ? 'mcp' : 'mcpServers']: { [result.name]: JSON.parse(result.snippet) } }, null, 2);
          status.textContent = '已写入 ' + result.path + (result.backup ? ' · 旧配置备份为 ' + result.backup : '');
          toast(result.name + ' 已写入 ' + item.label + '。重启对应 AI 客户端后生效。', 'good', 6000);
          refreshServers();
        } catch (error) { toast(error.message, 'bad', 6000); }
      }
      const generate = h('button', { class: 'btn', onclick: updatePreview }, '生成配置');
      const saveButton = h('button', { class: 'btn btn--primary', onclick: save }, '写入目标');
      const copy = h('button', { class: 'btn btn--ghost', onclick: async () => { if (!preview.value) return updatePreview(); await window.toolbox.clipboard.write(preview.value); toast('MCP 配置已复制', 'good'); } }, '复制配置');
      const fields = h('div', { class: 'skills__mcp-fields' },
        labeled('服务键名', name),
        labeled('写入哪个客户端', h('div', { class: 'skills__mcp-target-control' }, target, targetPath), 'skills__wide'),
        labeled('连接方式', transport),
        labeled('启动命令', command),
        labeled('命令参数', args, 'skills__wide'),
        labeled('远程 MCP URL', url, 'skills__wide'),
        labeled('环境变量 JSON', env),
        labeled('请求头 JSON', headers),
        h('label', { class: 'skills__mcp-enabled' }, enabled, '启用这个服务'),
      );
      const panel = h('div', { class: 'skills__panel skills__mcp' },
        sectionHead('MCP SERVER', '自定义 MCP 服务', '把 MCP 服务注册到常用 AI 客户端；本地服务用 stdio，远程服务用 HTTP 或 SSE。'),
        h('div', { class: 'skills__mcp-layout' },
          h('div', { class: 'skills__mcp-config' },
            fields,
            h('div', { class: 'skills__mcp-actions skills__actions' }, generate, saveButton, copy, status),
            h('label', { class: 'skills__labeled' }, h('span', {}, '配置预览'), preview),
            h('p', { class: 'faint skills__mcp-note' }, '写入前会保留 bak 备份。服务中的 API Key 只写到你选择的本机配置文件，请确认文件权限和分享范围。启动本地服务前请确保命令已安装。'),
          ),
          h('aside', { class: 'skills__mcp-existing' },
            h('div', { class: 'skills__mcp-existing-head' }, h('strong', {}, '目标中的服务'), h('span', { class: 'faint' }, '选择客户端后刷新')),
            serverList,
          ),
        ),
      );
      transport.addEventListener('change', () => { syncTransport(); updatePreview(); });
      target.addEventListener('change', syncTarget);
      for (const field of [name, command, args, url, env, headers]) field.addEventListener('input', updatePreview);
      enabled.addEventListener('change', updatePreview);
      refreshTargets();
      syncTransport();
      return panel;
    }

    const factories = { distill: makeDistill, create: makeCreate, library: makeLibrary, mcp: makeMcp };
    function select(id) {
      current = id;
      config.set('skills.view', id);
      for (const btn of tabBar.children) btn.classList.toggle('is-active', btn.dataset.tab === id);
      if (!panels.has(id)) { const panel = factories[id](); panels.set(id, panel); body.appendChild(panel); }
      for (const [pid, panel] of panels) panel.style.display = pid === id ? 'flex' : 'none';
    }
    for (const tab of tabs) tabBar.appendChild(h('button', { class: 'btn btn--sm research__subbtn', dataset: { tab: tab.id }, onclick: () => select(tab.id) }, tab.label));
    root.append(h('div', { class: 'bar' }, h('strong', {}, 'Skill 工厂'), tabBar), body);
    select(tabs.some((tab) => tab.id === current) ? current : 'distill');
  },
};
