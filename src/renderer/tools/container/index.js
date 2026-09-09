import { h, toast } from '../../core/ui.js';

const GROUP_LABELS = new Set(['文档', '图片', '视频', '音频', '代码', '数据', '压缩包', '其他']);
const GROUP_ICONS = { 文档: '▤', 图片: '▧', 视频: '▶', 音频: '♫', 代码: '</>', 数据: '⌗', 压缩包: '◌', 其他: '•' };

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function dateLabel(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default {
  id: 'container',
  title: '容器',
  icon: 'folder',
  hint: '工具箱本地资料容器：浏览、整理和 AI 归类',

  create(root, ctx) {
    const { ai } = ctx;
    let currentPath = '';
    let items = [];
    let busy = false;
    // 放进容器的工具要能直接跑起来 —— 不然「放进来」和「用起来」中间还隔着
    // 「打开终端、想起命令、激活虚拟环境」三步。
    let containerRoot = '';
    let runnable = {};        // 绝对路径 -> { kind, command, notes }
    let runStatus = {};       // 绝对路径 -> 运行状态
    let runTimer = null;

    const breadcrumb = h('div', { class: 'container__breadcrumb' });
    const countLabel = h('span', { class: 'faint container__count' });
    const status = h('span', { class: 'faint container__status' }, '只访问工具箱容器');
    const list = h('div', { class: 'container__list' });
    const menu = h('div', { class: 'container__menu', hidden: true });
    const preview = h('div', { class: 'container__preview', hidden: true });
    const previewTitle = h('strong', { class: 'container__preview-title' });
    const editor = h('textarea', { class: 'container__editor', spellcheck: false });
    let previewItem = null;
    const searchInput = h('input', { class: 'field container__search', placeholder: '筛选当前文件夹…' });
    const newFolderInput = h('input', { class: 'field field--sm container__new-folder-input', placeholder: '新文件夹名称' });
    const isFileDrag = (dataTransfer) => {
      const types = Array.from(dataTransfer?.types || []);
      return types.includes('Files') || types.includes('text/uri-list') || Boolean(dataTransfer?.files?.length);
    };

    function closeMenu() { menu.setAttribute('hidden', ''); }

    async function openPreview(item) {
      closeMenu();
      previewItem = item;
      previewTitle.textContent = item.name;
      editor.hidden = true;
      preview.hidden = false;
      const body = preview.querySelector('.container__preview-body');
      body.textContent = '';
      const ext = item.name.split('.').pop()?.toLowerCase();
      if (ext === 'pdf') {
        const result = await window.toolbox.container.filePath(item.relPath);
        if (!result.ok) return body.textContent = result.error;
        body.append(h('webview', { class: 'container__pdf', src: `file://${result.path.replace(/\\/g, '/')}` }));
        return;
      }
      const result = await window.toolbox.container.readFile(item.relPath);
      if (!result.ok) return body.textContent = result.error;
      editor.value = result.content;
      editor.hidden = false;
      body.append(editor);
    }

    async function savePreview() {
      if (!previewItem || editor.hidden) return;
      const result = await window.toolbox.container.writeFile({ relPath: previewItem.relPath, content: editor.value });
      toast(result.ok ? '已保存到容器' : result.error, result.ok ? 'good' : 'bad');
    }

    async function toLiterature(item) {
      closeMenu();
      const result = await window.toolbox.container.toLiterature([item.relPath]);
      toast(result.count ? `已转入科研文献库：${result.count} 个文件` : '没有找到支持的文献文件', result.count ? 'good' : 'info', 5000);
    }

    function renderBreadcrumb() {
      breadcrumb.textContent = '';
      const parts = currentPath ? currentPath.split('/').filter(Boolean) : [];
      breadcrumb.append(h('button', { class: 'container__crumb', onclick: () => refresh('') }, '容器'));
      let path = '';
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        const target = path;
        breadcrumb.append(h('span', { class: 'container__crumb-sep' }, '/'));
        breadcrumb.append(h('button', { class: 'container__crumb', onclick: () => refresh(target) }, part));
      }
    }

    function visibleItems() {
      const query = searchInput.value.trim().toLowerCase();
      return query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
    }

    function renderList() {
      list.textContent = '';
      const visible = visibleItems();
      countLabel.textContent = `${visible.length}${visible.length === items.length ? '' : ` / ${items.length}`} 项`;
      if (!visible.length) {
        list.append(h('div', { class: 'container__empty' },
          h('div', { class: 'container__empty-icon' }, '⌂'),
          h('strong', {}, searchInput.value ? '没有匹配内容' : '容器还是空的'),
          h('p', { class: 'faint' }, searchInput.value ? '换个关键词试试。' : '把工具箱产生的学习资料放进这里，右键即可整理；外部 Finder 可以直接访问这个目录。'),
        ));
        return;
      }
      for (const item of visible) {
        const row = h('div', { class: `container__item${item.isDir ? ' is-folder' : ''}`, oncontextmenu: (event) => { event.preventDefault(); showMenu(event, item); } });
        row.append(
          h('button', { class: 'container__item-main', ondblclick: () => item.isDir ? refresh(item.relPath) : openPreview(item), onclick: () => item.isDir && refresh(item.relPath) },
            h('span', { class: 'container__item-icon' }, item.isDir ? '▰' : (GROUP_ICONS[categoryOf(item.name)] || '·')),
            h('span', { class: 'container__item-copy' },
              h('strong', {}, item.name),
              h('span', { class: 'faint' }, item.isDir ? '文件夹' : `${humanSize(item.size)} · ${dateLabel(item.modifiedAt)}`),
            ),
          ),
          h('button', { class: 'container__item-more', title: '更多操作', onclick: (event) => { event.stopPropagation(); showMenu(event, item); } }, '⋯'),
        );
        // 这个文件夹是个能跑的项目（Python / Node / Shell），给它一个启动按钮
        const abs = item.isDir && containerRoot ? `${containerRoot}/${item.relPath}` : '';
        const info = abs && runnable[abs];
        if (info) {
          const st = runStatus[abs];
          const isRunning = st && st.running;
          row.insertBefore(
            h('span', { class: 'container__run' },
              h('span', { class: `container__run-kind${isRunning ? ' is-on' : ''}`, title: info.command }, info.kind),
              info.kind === 'Python' ? h('button', {
                class: 'btn btn--xs',
                title: '依赖管理：查看 / 安装 Python 库',
                onclick: (event) => { event.stopPropagation(); openDeps(abs, item.name, info); },
              }, '⬇') : null,
              h('button', {
                class: `btn btn--xs${isRunning ? '' : ' btn--primary'}`,
                title: isRunning ? '停止' : `启动：${info.command}`,
                onclick: (event) => { event.stopPropagation(); isRunning ? stopTool(abs) : startTool(abs, item.name, info); },
              }, isRunning ? '■' : '▶')),
            row.lastChild,
          );
        }
        list.append(row);
      }
    }

    function categoryOf(name) {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      if (['pdf', 'doc', 'docx', 'md', 'txt', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext)) return '文档';
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic'].includes(ext)) return '图片';
      if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return '视频';
      if (['mp3', 'wav', 'flac', 'm4a', 'aac'].includes(ext)) return '音频';
      if (['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'css', 'html', 'vue', 'sh', 'sql'].includes(ext)) return '代码';
      if (['csv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'parquet', 'npy', 'npz'].includes(ext)) return '数据';
      if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return '压缩包';
      return '其他';
    }

    // ---------- 把容器里的工具跑起来 ----------
    async function probeRunnables() {
      runnable = {};
      if (!containerRoot) return;
      const dirs = items.filter((i) => i.isDir).map((i) => `${containerRoot}/${i.relPath}`);
      if (!dirs.length) return;
      runnable = (await window.toolbox.shelf.probeMany(dirs)) || {};
    }

    async function syncRunStatus() {
      runStatus = (await window.toolbox.shelf.status()) || {};
      renderList();
    }

    async function startTool(abs, name, info) {
      const result = await window.toolbox.shelf.start({ id: abs, cwd: abs, command: info.command });
      if (!result.ok) return toast(result.error, 'bad');
      toast(`已启动 ${name}（${info.command}）`, 'good');
      runPanel.hidden = false;
      runTitle.textContent = `${name} · ${info.command}`;
      activeRun = abs;
      await syncRunStatus();
      startRunPolling();
    }

    async function stopTool(abs) {
      const result = await window.toolbox.shelf.stop(abs);
      if (!result.ok) return toast(result.error, 'info');
      setTimeout(syncRunStatus, 400);
    }

    function startRunPolling() {
      if (runTimer) return;
      runTimer = setInterval(async () => {
        if (activeRun) {
          runLog.textContent = (await window.toolbox.shelf.log(activeRun)) || '';
          runLog.scrollTop = runLog.scrollHeight;
        }
        await syncRunStatus();
      }, 1000);
    }

    function stopRunPolling() {
      if (runTimer) clearInterval(runTimer);
      runTimer = null;
    }

    async function refresh(relPath = currentPath) {
      if (busy) return;
      busy = true;
      closeMenu();
      list.replaceChildren(h('div', { class: 'container__loading' }, h('span', { class: 'spinner' }), ' 正在读取容器…'));
      try {
        const result = await window.toolbox.container.list(relPath);
        if (!result.ok) { list.replaceChildren(h('div', { class: 'empty' }, result.error)); return; }
        currentPath = result.relPath || '';
        items = result.items || [];
        containerRoot = result.root ? `${result.root}${currentPath ? '/' + currentPath : ''}` : '';
        renderBreadcrumb();
        renderList();
        status.textContent = '隔离容器 · 外部可访问，工具不越界';
        // 探测和状态是异步的，先把列表画出来别让人等
        probeRunnables().then(syncRunStatus);
      } finally { busy = false; }
    }

    async function makeFolder() {
      const name = newFolderInput.value.trim();
      if (!name) return toast('先输入文件夹名称', 'info');
      const result = await window.toolbox.container.mkdir({ relPath: currentPath, name });
      if (!result.ok) return toast(result.error, 'bad');
      newFolderInput.value = '';
      toast(`已创建文件夹：${name}`, 'good');
      refresh();
    }

    async function organize(targetPath = currentPath) {
      closeMenu();
      const result = await window.toolbox.container.organize(targetPath);
      if (!result.ok) return toast(result.error || '整理失败', 'bad', 5000);
      toast(result.moved ? `一键整理完成，移动 ${result.moved} 个文件` : '当前文件夹没有需要整理的散文件', result.moved ? 'good' : 'info', 5000);
      refresh(currentPath);
    }

    function normalizePlan(raw, sourceItems) {
      const existing = new Set(sourceItems.filter((item) => !item.isDir).map((item) => item.name));
      const claimed = new Set();
      const groups = [];
      for (const group of Array.isArray(raw?.groups) ? raw.groups : []) {
        const folder = String(group.folder || '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 50);
        const files = [...new Set((Array.isArray(group.files) ? group.files : []).map(String).filter((name) => existing.has(name) && !claimed.has(name)))];
        if (!folder || !files.length) continue;
        files.forEach((name) => claimed.add(name));
        groups.push({ folder, files });
      }
      const unclaimed = [...existing].filter((name) => !claimed.has(name));
      if (unclaimed.length) groups.push({ folder: unclaimed.length >= 6 ? `垃圾文件-${new Date().toISOString().slice(0, 10)}` : '其他', files: unclaimed });
      return groups;
    }

    async function deepOrganize(targetPath = currentPath) {
      closeMenu();
      const result = await window.toolbox.container.list(targetPath);
      if (!result.ok) return toast(result.error || '读取失败', 'bad');
      const files = (result.items || []).filter((item) => !item.isDir);
      if (!files.length) return toast('当前文件夹没有可供 AI 整理的散文件', 'info');
      const names = files.map((item) => `${item.name}（${humanSize(item.size)}）`).join('\n');
      try {
        status.textContent = 'AI 正在按文件名和扩展名规划归类…';
        const raw = await ai.json(`你是本地文件整理助手。只根据下面的文件名和大小，把它们归到合适的文件夹。不要读取文件内容，不要猜测敏感内容。\n规则：1. 每个文件必须且只能出现一次；2. 文件夹名用简短中文；3. 明显无用、临时、缓存、重复或无法判断的文件归入“其他”；4. 如果“其他”超过 5 个，使用“垃圾文件”类文件夹；5. 只返回 JSON，不要 Markdown。格式：{"groups":[{"folder":"文件夹名","files":["原文件名"]}]}\n\n文件列表：\n${names}`, { timeout: 90000 });
        const groups = normalizePlan(raw, result.items || []);
        if (!groups.length) return toast('AI 没有给出可执行的整理方案', 'bad');
        const applied = await window.toolbox.container.applyPlan({ relPath: targetPath, groups });
        if (!applied.ok) return toast(applied.error || 'AI 整理执行失败', 'bad', 6000);
        toast(`深度整理完成，AI 归类并移动 ${applied.moved} 个文件`, 'good', 6000);
        refresh(currentPath);
      } catch (error) {
        status.textContent = '隔离容器 · 外部可访问，工具不越界';
        toast(`AI 深度整理失败：${error.message}`, 'bad', 6000);
      }
    }

    function showMenu(event, item = null) {
      menu.textContent = '';
      const targetPath = item?.isDir ? item.relPath : (item ? currentPath : currentPath);
      const title = item ? `${item.isDir ? '文件夹' : '文件'}：${item.name}` : (currentPath ? '当前文件夹' : '容器根目录');
      menu.append(h('div', { class: 'container__menu-title' }, title));
      menu.append(
        h('button', { class: 'container__menu-item', onclick: () => organize(targetPath) }, '⌁ 一键整理'),
        h('button', { class: 'container__menu-item container__menu-item--ai', onclick: () => deepOrganize(targetPath) }, '✦ 深度整理（AI）'),
      );
      if (item?.isDir) menu.append(h('button', { class: 'container__menu-item', onclick: () => refresh(item.relPath) }, '进入文件夹'));
      if (item && !item.isDir) menu.append(h('button', { class: 'container__menu-item', onclick: () => openPreview(item) }, '预览 / 编辑'));
      if (item && (item.isDir || ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(item.name.split('.').pop()?.toLowerCase()))) {
        menu.append(h('button', { class: 'container__menu-item', onclick: () => toLiterature(item) }, '转入科研文献库'));
      }
      const rect = root.getBoundingClientRect();
      menu.style.left = `${Math.min(Math.max(8, event.clientX - rect.left), Math.max(8, rect.width - 210))}px`;
      menu.style.top = `${Math.min(Math.max(8, event.clientY - rect.top), Math.max(8, rect.height - 150))}px`;
      menu.removeAttribute('hidden');
    }

    function droppedPaths(dataTransfer) {
      const paths = [...(dataTransfer?.files || [])].map((file) => {
        if (file.path) return file.path;
        return window.toolbox.files.getPathForFile(file);
      }).filter(Boolean);
      if (paths.length) return paths.slice(0, 30);
      return String(dataTransfer?.getData('text/uri-list') || '').split(/\r?\n/)
        .filter((uri) => uri.startsWith('file://'))
        .map((uri) => decodeURIComponent(uri.replace(/^file:\/\//, '')))
        .slice(0, 30);
    }

    async function importDroppedFiles(dataTransfer) {
      const paths = droppedPaths(dataTransfer);
      if (!paths.length) return toast('没有识别到文件路径，请从 Finder 或 VSCode 的文件列表拖入', 'bad', 5000);
      status.textContent = '正在导入到容器…';
      const result = await window.toolbox.container.import({ sources: paths, relPath: currentPath });
      if (!result.ok) return toast(result.error || '导入失败', 'bad');
      toast(`已导入 ${result.importedFiles} 个文件${result.importedFolders ? `、${result.importedFolders} 个文件夹` : ''}${result.skipped ? `，跳过 ${result.skipped} 个重复/不支持项目` : ''}`, 'good', 4000);
      refresh(currentPath);
    }

    searchInput.addEventListener('input', renderList);
    root.addEventListener('click', (event) => { if (!menu.contains(event.target)) closeMenu(); });
    root.addEventListener('contextmenu', (event) => { if (event.target === root || event.target === list) { event.preventDefault(); showMenu(event); } });

    const previewBody = h('div', { class: 'container__preview-body' });
    preview.append(
      h('div', { class: 'container__preview-head' }, previewTitle, h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn btn--sm btn--primary', onclick: savePreview }, '保存'),
        h('button', { class: 'btn btn--sm', onclick: () => { preview.hidden = true; previewItem = null; } }, '关闭')),
      previewBody,
    );
    const workspace = h('div', { class: 'container__workspace' }, list, menu, preview);
    const markFileDrag = (event) => {
      if (!isFileDrag(event.dataTransfer)) return false;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      workspace.classList.add('is-drop-target');
      return true;
    };
    const clearFileDrag = (event) => {
      if (!event.relatedTarget || !workspace.contains(event.relatedTarget)) workspace.classList.remove('is-drop-target');
    };
    const handleFileDrop = async (event) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      workspace.classList.remove('is-drop-target');
      try { await importDroppedFiles(event.dataTransfer); } catch (error) { toast(`导入失败：${error.message}`, 'bad', 5000); }
    };
    workspace.addEventListener('dragenter', markFileDrag);
    workspace.addEventListener('dragover', markFileDrag);
    workspace.addEventListener('dragleave', clearFileDrag);
    workspace.addEventListener('drop', handleFileDrop);
    root.addEventListener('dragenter', markFileDrag, true);
    root.addEventListener('dragover', markFileDrag, true);
    root.addEventListener('dragleave', clearFileDrag, true);
    root.addEventListener('drop', handleFileDrop, true);

    let activeRun = null;
    const runTitle = h('span', { class: 'container__run-title faint' });
    const runLog = h('pre', { class: 'container__run-log' });
    const runPanel = h('div', { class: 'container__run-panel', hidden: true },
      h('div', { class: 'container__run-head' },
        h('strong', {}, '运行输出'),
        runTitle,
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn btn--xs btn--ghost', onclick: () => { runPanel.hidden = true; } }, '收起')),
      runLog,
    );

    // ---------- 依赖管理（Python 工具）：查看 / 手动装 / AI 补库 ----------
    let activeDeps = null;       // { abs, name }
    const depsTitle = h('span', { class: 'container__run-title faint' });
    const depsDeclared = h('div', { class: 'container__deps-declared' });
    const depsInput = h('input', { class: 'field field--sm container__deps-input', placeholder: '包名，如 requests numpy pandas（空格分隔）' });
    const depsLog = h('pre', { class: 'container__run-log' });
    const depsPanel = h('div', { class: 'container__run-panel container__deps-panel', hidden: true },
      h('div', { class: 'container__run-head' },
        h('strong', {}, '依赖管理'),
        depsTitle,
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn btn--xs btn--ghost', onclick: () => { depsPanel.hidden = true; activeDeps = null; } }, '收起')),
      depsDeclared,
      h('div', { class: 'container__deps-row' },
        depsInput,
        h('button', { class: 'btn btn--xs btn--primary', onclick: installDepsNow }, '安装'),
        h('button', { class: 'btn btn--xs', title: '让免费 Agnes AI 分析项目缺什么库并自动安装', onclick: aiSuggestDeps }, '✦ AI 补库')),
      depsLog,
    );

    function relFromRoot(abs) {
      const prefix = `${containerRoot}/`;
      return abs && abs.startsWith(prefix) ? abs.slice(prefix.length) : '';
    }

    async function refreshDeclared() {
      if (!activeDeps) return;
      const listed = await window.toolbox.shelf.depsList(activeDeps.abs);
      depsDeclared.textContent = listed.ok
        ? (listed.kind === 'uv'
          ? `已声明（pyproject.toml）：${listed.deps.join('、') || '（空）'}`
          : listed.kind === 'requirements'
            ? `requirements.txt：${listed.deps.join('、') || '（空）'}`
            : '还没有 pyproject.toml 或 requirements.txt，点「安装」会让 uv 自动建一个最小项目。')
        : listed.error;
      depsDeclared.classList.toggle('container__deps-declared--warn', !listed.ok);
    }

    function openDeps(abs, name) {
      activeDeps = { abs, name };
      depsTitle.textContent = name;
      depsLog.textContent = '';
      depsPanel.hidden = false;
      refreshDeclared();
    }

    async function installDepsNow() {
      if (!activeDeps) return;
      const text = depsInput.value.trim();
      if (!text) return toast('先输入要安装的包名', 'info');
      depsLog.textContent = '正在安装（uv init/add）…';
      const result = await window.toolbox.shelf.depsInstall({ cwd: activeDeps.abs, packages: text });
      depsLog.textContent = result.log || '(无输出)';
      if (result.ok) toast(`已安装：${text}`, 'good');
      refreshDeclared();
    }

    async function aiSuggestDeps() {
      if (!activeDeps) return;
      status.textContent = 'AI 正在分析缺什么依赖…';
      try {
        // 把项目入口源码 + 已声明依赖喂给 AI，让它判断缺哪些库。
        const relPath = relFromRoot(activeDeps.abs);
        const entries = ['main.py', 'app.py', 'run.py', '__main__.py', 'requirements.txt', 'pyproject.toml'];
        const snippets = [];
        for (const entry of entries.slice(0, 4)) {
          if (!relPath) continue;
          const target = relPath ? `${relPath}/${entry}` : entry;
          const read = await window.toolbox.container.readFile(target);
          if (read.ok && read.content) snippets.push(`--- ${entry} ---\n${String(read.content).slice(0, 1200)}`);
        }
        const req = relPath ? await window.toolbox.container.readFile(`${relPath}/requirements.txt`) : null;
        const declared = req && req.ok ? String(req.content || '') : '';
        const prompt = `你是 Python 依赖分析助手。容器里有一个工具项目，以下是它的部分源码${declared ? '和已声明的依赖' : ''}。请判断运行它至少需要哪些第三方 Python 库。\n规则：1. 不重复列出已声明的库；2. 只返回标准 PyPI 包名；3. 只返回 JSON，不要 Markdown 和解释。格式：{"packages":["包名"]}\n\n已声明依赖：\n${declared || '（无）'}\n\n源码：\n${snippets.join('\n') || '（读不到源码，请按目录名推断）'}`;
        const raw = await ai.json(prompt, { timeout: 90000 });
        const packages = [...new Set((Array.isArray(raw?.packages) ? raw.packages : []).map(String).filter(Boolean))];
        if (!packages.length) { depsLog.textContent = 'AI 没有给出可安装的包，可能已经够用或源码信息不足。'; return; }
        depsLog.textContent = `AI 建议安装：${packages.join('、')}`;
        depsInput.value = packages.join(' ');
        await installDepsNow();
      } catch (error) {
        depsLog.textContent = `AI 补库失败：${error.message}`;
      } finally {
        status.textContent = '隔离容器 · 外部可访问，工具不越界';
      }
    }

    root.append(
      h('div', { class: 'bar bar--drag container__bar' }, h('strong', {}, '容器'), h('span', { class: 'faint' }, '工具箱本地资料空间'), h('span', { style: { flex: 1 } }), h('button', { class: 'btn btn--sm', onclick: () => window.toolbox.container.open().then((r) => r.ok ? toast('已在 Finder 中打开容器', 'good') : toast(r.error, 'bad')) }, '在 Finder 中打开')),
      h('div', { class: 'container__toolbar' },
        breadcrumb,
        searchInput,
        newFolderInput,
        h('button', { class: 'btn btn--sm', onclick: makeFolder }, '新建文件夹'),
        h('button', { class: 'btn btn--sm', title: '同步 Finder 刚放进来的文件', onclick: () => refresh(currentPath) }, '刷新'),
        h('span', { style: { flex: 1 } }),
        countLabel,
        status,
      ),
      workspace,
      runPanel,
      depsPanel,
    );
    newFolderInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') makeFolder(); });
    refresh('');
    return {
      activate: () => { refresh(currentPath); },
      deactivate: () => stopRunPolling(),
    };
  },
};
