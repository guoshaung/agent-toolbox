import { h, toast } from '../../core/ui.js';

export default {
  id: 'system-beauty', title: '系统美化', icon: 'palette',
  hint: '导入图片、保存主题，预览窗口质感，应用与恢复壁纸和 Windows 外观',
  create(root) {
    const api = window.toolbox.systemBeauty;
    let library, draft, scene = 'explorer', disposed = false, busy = false;
    let showAllPresets = false, wallpaperSize = 'fhd', assetQuery = '', assetPage = 0;
    let personalizationStatus = '可先读取当前设置，再选择需要更改的项目。';
    let windowTarget = '', windowStatus = '先刷新窗口列表，再选择一个窗口。';
    let windowRecovery = null;
    let folderPreview = null, folderImportResult = null;
    let folderJobId = '', folderProgress = null;
    let catalog = { entries: [] }, catalogQuery = '', catalogCategory = '全部', catalogPage = 0, catalogSelection = '';
    let catalogStatus = '';
    let assetKind = 'all', assetSource = '', inspectedAsset = '', packagePage = 0;
    let engine = { registered: false }, themeMessage = '';
    const themeOptions = { wallpaper: true, explorer: true, colors: true };
    const windowOptions = { dark: 'keep', corners: 'keep', material: 'keep' };
    const body = h('div', { class: 'beauty__body' });
    root.append(h('div', { class: 'bar bar--drag' }, h('strong', {}, '系统美化'), h('span', { class: 'faint' }, '你的图片，你的桌面')), body);
    const invoke = async (name, ...args) => {
      const result = await api[name](...args);
      if (!result.ok) throw new Error(result.error || '操作失败');
      return result.data;
    };
    const action = async (fn) => {
      if (busy || disposed) return;
      busy = true; body.classList.add('beauty--busy');
      try { await fn(); } catch (error) { toast(error.message, 'bad', 6000); }
      finally { busy = false; body.classList.remove('beauty--busy'); }
    };
    const fresh = preset => ({ ...preset, id: crypto.randomUUID(), preset: preset.id, backgroundId: '' });
    const button = (label, fn, props = {}) => h('button', { class: 'btn', onclick: () => action(fn), ...props }, label);
    const progressContents = () => folderProgress ? [
      h('p', { role: 'status' }, `正在导入 ${folderProgress.completed} / ${folderProgress.total} 张：新增 ${folderProgress.added} 张，重复 ${folderProgress.imported - folderProgress.added} 张，失败 ${folderProgress.failed} 张。`),
      h('progress', { max: Math.max(1, folderProgress.total), value: folderProgress.completed, 'aria-label': '文件夹导入进度' }),
      h('p', { class: 'faint' }, folderProgress.cancelRequested ? '正在停止，当前这张图片处理完成后结束，已导入的素材会保留。' : folderProgress.current || '正在准备图片…'),
      h('button', { class: 'btn beauty__stop-import', disabled: !!folderProgress.cancelRequested, onclick: async () => {
        const id = folderJobId;
        folderProgress.cancelRequested = true; paintFolderProgress();
        try { await invoke('stopImageFolderImport', id); }
        catch (error) { if (folderJobId === id && !disposed) toast(error.message, 'bad'); }
      } }, folderProgress.cancelRequested ? '正在停止…' : '停止后续导入'),
    ] : [];
    const paintFolderProgress = () => { if (!disposed) body.querySelector('.beauty__import-progress')?.replaceChildren(...progressContents()); };

    async function importCharacters(id) {
      const result = await invoke('importCatalogMaterials', id);
      library = result;
      if (result.imported.length) draft.characterId = result.imported[0];
      catalogStatus = `新增 ${result.added} 张公开人物原图，失败 ${result.errors.length} 张。完整包仍需从原站获取。`;
      render(); body.querySelector('.beauty__preview-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      toast(catalogStatus, result.errors.length ? 'info' : 'good', 6000);
    }
    function gallery() {
      const grid = h('div', { class: 'beauty__catalog-grid' });
      const pages = h('div', { class: 'beauty__row beauty__pages' });
      const detail = h('div', { class: 'beauty__catalog-detail' });
      const draw = () => {
        const matching = catalog.entries.filter(item => (catalogCategory === '全部' || item.category === catalogCategory) &&
          `${item.title} ${item.author} ${item.tags.join(' ')}`.toLowerCase().includes(catalogQuery.toLowerCase()));
        const pageCount = Math.max(1, Math.ceil(matching.length / 12)); catalogPage = Math.max(0, Math.min(catalogPage, pageCount - 1));
        grid.replaceChildren(...matching.slice(catalogPage * 12, (catalogPage + 1) * 12).map(item =>
          h('article', { class: `beauty__catalog-card${catalogSelection === item.id ? ' is-active' : ''}` },
            button(item.coverUrl ? h('img', { src: item.coverUrl, alt: item.title, loading: 'lazy' }) : h('span', {}, '点击“缓存全部预览”加载图片'), async () => { catalogSelection = item.id; draw(); detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, { class: 'beauty__catalog-cover', 'aria-label': `查看 ${item.title}` }),
            h('div', { class: 'beauty__catalog-copy' }, h('span', { class: 'beauty__catalog-kind' }, item.category), h('h3', {}, item.title),
              h('p', { class: 'faint' }, item.author), h('p', { class: 'beauty__catalog-access' }, item.materials.length ? `${item.materials.length} 张人物 PNG 可导入` : item.notice)))));
        if (!matching.length) grid.append(h('p', { class: 'faint' }, '没有匹配的角色或作品。'));
        pages.replaceChildren(h('span', { class: 'faint' }, `${matching.length} 项 · ${catalogPage + 1} / ${pageCount} 页`),
          button('上一页', async () => { catalogPage--; draw(); }, { disabled: catalogPage === 0 }),
          button('下一页', async () => { catalogPage++; draw(); }, { disabled: catalogPage >= pageCount - 1 }));
        const item = catalog.entries.find(x => x.id === catalogSelection);
        detail.hidden = !item;
        detail.replaceChildren(...(item ? [
          item.coverUrl ? h('img', { src: item.coverUrl, alt: '官网效果图' }) : null,
          h('div', { class: 'beauty__catalog-info' }, h('span', { class: 'beauty__catalog-kind' }, '官网效果图 · 非完整主题'), h('h3', {}, item.title),
            h('p', { class: 'faint' }, `${item.author} · ${item.tags.join(' / ')}`), h('p', {}, item.notice),
            h('p', { class: 'faint' }, item.materials.length ? '下方按钮导入文章公开的人物透明原图，可在这里搭配窗口与合成壁纸。' : '此项目仅提供目录和效果图，尚未导入完整包或人物原图。'),
            h('div', { class: 'beauty__row' }, item.materials.length ? button(`导入 ${item.materials.length} 张人物原图`, () => importCharacters(item.id), { class: 'btn btn--primary' }) : null,
              button(item.packages.length ? '去原站登录下载完整包' : '查看原文与下载方式', () => invoke('openCatalogSource', item.id)),
              button('收起详情', async () => { catalogSelection = ''; draw(); })))
        ] : []));
      };
      const search = h('input', { class: 'field', type: 'search', value: catalogQuery, placeholder: '搜索角色、作品、作者', 'aria-label': '搜索二次元素材目录' });
      search.addEventListener('input', () => { catalogQuery = search.value; catalogPage = 0; draw(); });
      const filter = h('select', { class: 'field', 'aria-label': '素材分类' }, ...['全部', '预设包', '美化包', '文件夹背景', '鼠标指针&图标'].map(name => h('option', { value: name, selected: catalogCategory === name }, name)));
      filter.addEventListener('change', () => { catalogCategory = filter.value; catalogPage = 0; draw(); });
      draw();
      const available = catalog.entries.reduce((n, item) => n + item.materials.length, 0);
      return h('section', { class: 'card beauty__catalog' },
        h('div', { class: 'beauty__catalog-heading' }, h('div', {}, h('span', { class: 'tag' }, 'ACG COLLECTION'), h('h2', {}, '把喜欢的角色，留在桌面上'),
          h('p', { class: 'faint' }, `${catalog.entries.length} 项官网资源目录 · ${available} 张公开人物原图 · ${library.assets.filter(a => a.kind === 'character').length} 张已在本机`)),
          h('div', { class: 'beauty__row' }, button('缓存全部预览', async () => {
            catalogStatus = '正在缓存官网公开预览，完成后可离线浏览…'; render();
            catalog = await invoke('cacheCatalogCovers'); catalogStatus = `已缓存 ${catalog.entries.filter(x => x.coverUrl).length} / ${catalog.entries.length} 项预览${catalog.errors.length ? `，${catalog.errors.length} 项失败，可重试` : ''}。`; render();
          }), button(`导入全部 ${available} 张公开人物图`, () => importCharacters('all'), { class: 'btn btn--primary' }),
            button('看本机人物与搭配', async () => { body.querySelector('.beauty__preview-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }))),
        h('p', { class: 'faint' }, '收录预设、美化包、文件夹背景和鼠标图标；完整包由原作者发布，需登录的项目会跳转原站。效果截图不作为壁纸或人物素材导入。'),
        h('div', { class: 'beauty__row beauty__catalog-filters' }, search, filter), catalogStatus ? h('p', { role: 'status' }, catalogStatus) : null,
        grid, pages, detail);
    }

    function preview() {
      const preset = library.presets.find(p => p.id === draft.preset) || library.presets[0];
      const asset = library.assets.find(a => a.id === draft.backgroundId);
      const character = library.assets.find(a => a.id === draft.characterId) || (asset?.kind === 'character' ? asset : null);
      const surface = h('div', { class: `beauty__preview beauty__preview--${draft.effect}`, 'aria-label': '桌面与窗口效果预览', style: {
        backgroundImage: asset && asset.kind !== 'character' ? `url("${asset.url}")` : preset.gradient,
      } });
      surface.style.setProperty('--beauty-accent', draft.accent);
      surface.style.setProperty('--beauty-tint', draft.tint);
      surface.style.setProperty('--beauty-alpha', draft.opacity / 100);
      surface.style.setProperty('--beauty-blur', `${draft.blur}px`);
      surface.append(h('span', { class: 'beauty__preview-label' }, '效果预览'));
      const windowBody = h('div', { class: 'beauty__window' });
      if (scene === 'explorer') windowBody.append(
        h('div', { class: 'beauty__titlebar' }, '▱　文件资源管理器', h('span', {}, '—　□　×')),
        h('div', { class: 'beauty__address' }, '←　→　↑　　此电脑 › 图片 › 我的素材'),
        h('div', { class: 'beauty__explorer' }, h('aside', {}, ...['⌂　主页', '☆　收藏夹', '▱　桌面', '▧　图片', '▤　文档'].map(t => h('div', {}, t))),
          h('div', { class: 'beauty__files' }, ...['壁纸', '人物素材', '我的主题', '旅行相册', '灵感收藏', '动画素材'].map(t => h('div', {}, h('span', {}, '▰'), t)))),
      );
      else if (scene === 'start') windowBody.append(
        h('div', { class: 'beauty__address' }, '⌕　搜索应用、设置和文档'),
        h('strong', {}, '已固定'),
        h('div', { class: 'beauty__apps' }, ...['工具箱', '浏览器', '图片', '设置', '记事本', '终端', '音乐', '日历'].map((t, i) => h('div', {}, h('span', {}, ['◈', '◎', '▧', '⚙', '▤', '▣', '♫', '▦'][i]), t))),
        h('p', {}, '推荐 · 让常用的东西触手可及'),
      );
      else windowBody.append(h('div', { class: 'beauty__desktop-note' }, h('strong', {}, draft.name), h('p', {}, '选一张喜欢的图片，把桌面留给自己。')));
      windowBody.classList.toggle('beauty__window--desktop', scene === 'desktop');
      if (character) {
        const picture = h('img', { class: 'beauty__character', src: character.url, alt: character.name });
        if (scene === 'desktop') surface.append(picture); else windowBody.append(picture);
        surface.classList.add('beauty__preview--character');
      }
      surface.append(windowBody, h('div', { class: 'beauty__taskbar' }, '⊞　⌕　▱　◈　⚙', h('span', {}, '预览')));
      return surface;
    }

    function render() {
      if (disposed) return;
      if (!draft.characterId && library.assets.find(a => a.id === draft.backgroundId)?.kind === 'character') {
        draft.characterId = draft.backgroundId; draft.backgroundId = '';
      }
      draft.windows ||= { apps: 'keep', system: 'keep', transparency: 'keep' };
      const windowsOptions = h('div', { class: 'beauty__row' }, ...[
        ['apps', '应用配色', [['keep', '保持当前'], ['light', '浅色'], ['dark', '深色']]],
        ['system', 'Windows 配色', [['keep', '保持当前'], ['light', '浅色'], ['dark', '深色']]],
        ['transparency', 'Windows 透明效果', [['keep', '保持当前'], ['on', '开启'], ['off', '关闭']]],
      ].map(([key, label, options]) => {
        const select = h('select', { class: 'field', 'aria-label': label }, ...options.map(([value, name]) => h('option', { value, selected: draft.windows[key] === value }, name)));
        select.addEventListener('change', () => { draft.windows[key] = select.value; render(); });
        return h('label', { class: 'beauty__field' }, label, select);
      }));
      const changePersonalization = async restore => {
        try {
          const result = await invoke(restore ? 'restorePersonalization' : 'applyPersonalization', draft.windows);
          personalizationStatus = restore ? '已恢复本次更改前的 Windows 外观。' : '已应用所选项目，原设置已备份。';
          if (!result.personalizationNotified) personalizationStatus += ' 部分窗口可能需要重新打开才能更新。';
          toast(personalizationStatus, 'good', 6000);
        } catch (error) {
          personalizationStatus = '操作未完成，请检查错误信息；已有备份会保留。';
          throw error;
        } finally { library = await invoke('list'); render(); }
      };
      const presetStrip = h('div', { class: 'beauty__presets' }, ...(showAllPresets ? library.presets : library.presets.slice(0, 4)).map(p => button(p.name, async () => { draft = fresh(p); render(); }, {
        class: `beauty__preset${draft.preset === p.id ? ' is-active' : ''}`, style: { backgroundImage: p.gradient },
      })));
      const previewHost = h('div', {}, preview());
      const updatePreview = () => previewHost.replaceChildren(preview());
      const input = (label, key, props) => {
        const control = h('input', { ...props, value: draft[key] });
        control.addEventListener('input', () => { draft[key] = props.type === 'range' ? Number(control.value) : control.value; updatePreview(); if (output) output.textContent = `${control.value}${key === 'opacity' ? '%' : ' px'}`; });
        const output = props.type === 'range' ? h('span', { class: 'faint' }, `${draft[key]}${key === 'opacity' ? '%' : ' px'}`) : null;
        return h('label', { class: 'beauty__field' }, h('span', {}, label), control, output);
      };
      const effect = h('select', { class: 'field', 'aria-label': '窗口质感' }, ...[['glass', '透明玻璃'], ['acrylic', '亚克力磨砂'], ['mica', '云母'], ['solid', '纯色']].map(([value, label]) => h('option', { value, selected: value === draft.effect }, label)));
      effect.addEventListener('change', () => { draft.effect = effect.value; updatePreview(); });
      const profileName = input('主题名称', 'name', { type: 'text', class: 'field', maxlength: 60 });
      const assets = h('div', { class: 'beauty__assets' });
      const pageControls = h('div', { class: 'beauty__row beauty__pages' });
      const drawAssets = () => {
        const source = (library.packages || []).find(p => p.id === assetSource);
        const matching = library.assets.filter(a => (!source || source.assetIds.includes(a.id)) && (assetKind === 'all' || a.kind === assetKind) &&
          `${a.name} ${(a.sources || []).map(s => s.title || '').join(' ')}`.toLowerCase().includes(assetQuery.toLowerCase()));
        const pages = Math.max(1, Math.ceil(matching.length / 48));
        assetPage = Math.min(assetPage, pages - 1);
        assets.replaceChildren(...matching.slice(assetPage * 48, (assetPage + 1) * 48).map(a => button([
          h('img', { src: a.thumbnailUrl || a.url, alt: '', loading: 'lazy', decoding: 'async' }),
          h('span', {}, a.name),
        ], async () => { inspectedAsset = a.id; if (a.kind === 'character') draft.characterId = a.id; else if (a.kind !== 'icon') draft.backgroundId = a.id;
          render(); body.querySelector(a.kind === 'icon' ? '.beauty__asset-detail' : '.beauty__preview-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, {
          class: `beauty__asset beauty__asset--${a.kind}${[draft.backgroundId, draft.characterId, inspectedAsset].includes(a.id) ? ' is-active' : ''}`,
          title: a.width && a.height ? `${a.name} · ${a.width} × ${a.height}` : a.name,
        })));
        if (!matching.length) assets.append(h('p', { class: 'faint' }, library.assets.length ? '没有找到匹配的素材。' : '导入喜欢的壁纸、插画或图标。支持 PNG、JPEG、WebP、ICO、CUR，每张不超过 25 MB。'));
        pageControls.replaceChildren(h('span', { class: 'faint' }, `${matching.length} 张素材 · ${assetPage + 1} / ${pages} 页`),
          button('上一页', async () => { assetPage--; drawAssets(); }, { class: 'btn btn--sm', disabled: assetPage === 0 }),
          button('下一页', async () => { assetPage++; drawAssets(); }, { class: 'btn btn--sm', disabled: assetPage >= pages - 1 }));
      };
      drawAssets();
      const assetSearch = h('input', { type: 'search', class: 'field', placeholder: '搜索素材名称', value: assetQuery, 'aria-label': '搜索素材名称' });
      assetSearch.addEventListener('input', () => { assetQuery = assetSearch.value; assetPage = 0; drawAssets(); });
      const kindSelect = h('select', { class: 'field', 'aria-label': '本地素材类型' }, ...[['all', '全部类型'], ['character', '人物立绘'], ['wallpaper', '壁纸底图'], ['icon', '系统图标'], ['imported', '自行导入'], ['generated', '生成的壁纸']].map(([value, text]) => h('option', { value, selected: assetKind === value }, text)));
      kindSelect.addEventListener('change', () => { assetKind = kindSelect.value; assetPage = 0; drawAssets(); });
      const sourceSelect = h('select', { class: 'field', 'aria-label': '本地预设来源' }, h('option', { value: '', selected: !assetSource }, '全部预设'), ...(library.packages || []).map(p => h('option', { value: p.id, selected: assetSource === p.id }, p.title)));
      sourceSelect.addEventListener('change', () => { assetSource = sourceSelect.value; assetPage = 0; drawAssets(); });
      const sizeSelect = h('select', { class: 'field', 'aria-label': '壁纸尺寸' }, ...(library.wallpaperSizes || []).map(size => h('option', { value: size.id, selected: size.id === wallpaperSize }, size.name)));
      sizeSelect.addEventListener('change', () => { wallpaperSize = sizeSelect.value; });
      const generateBackground = async () => {
        library = await invoke('generateBackground', { preset: draft.preset, size: wallpaperSize });
        draft.backgroundId = library.generatedAssetId; assetQuery = ''; assetPage = 0; render();
      };
      const applyBackground = async () => {
        if (!draft.backgroundId && !draft.characterId) await generateBackground();
        let wallpaperId = draft.backgroundId;
        if (draft.characterId) {
          const composed = await invoke('composeCharacterWallpaper', { id: draft.characterId, backgroundId: draft.backgroundId, preset: draft.preset, size: wallpaperSize });
          wallpaperId = composed.generatedAssetId;
        }
        try { await invoke('applyWallpaper', wallpaperId); toast('桌面壁纸已应用，原壁纸已备份', 'good'); }
        finally { library = await invoke('list'); render(); }
      };
      const importImages = async () => {
        const result = await invoke('importImages');
        if (result.canceled) return;
        library = result;
        assetQuery = ''; assetPage = 0;
        const first = result.assets.find(a => a.id === result.imported[0]);
        if (first?.kind === 'icon') inspectedAsset = first.id;
        else if (first?.kind === 'character') draft.characterId = first.id;
        else if (first) draft.backgroundId = first.id;
        render();
        toast(result.errors.length ? `导入 ${result.imported.length} 张；${result.errors.map(e => `${e.name}：${e.error}`).join('；')}` : `已导入 ${result.imported.length} 张素材`, result.errors.length ? 'info' : 'good', 6000);
      };
      const scanFolder = async () => {
        if (folderPreview) await invoke('cancelImageFolder', folderPreview.id);
        folderPreview = null; render();
        const result = await invoke('scanImageFolder');
        if (result.canceled) return;
        folderPreview = result; folderImportResult = null; render();
      };
      const importFolder = async () => {
        const id = folderPreview.id; folderJobId = id;
        folderProgress = { total: folderPreview.count, completed: 0, added: 0, imported: 0, failed: 0, current: '', cancelRequested: false };
        folderPreview = null; folderImportResult = null; render();
        let finished = false;
        const poll = async () => {
          while (!finished && !disposed) {
            await new Promise(resolve => setTimeout(resolve, 300));
            if (finished || disposed) break;
            try {
              const state = await invoke('imageFolderProgress', id);
              if (!finished && folderJobId === id) {
                const requested = folderProgress.cancelRequested;
                folderProgress = { ...state, cancelRequested: requested || state.cancelRequested }; paintFolderProgress();
              }
            } catch { /* The final import reply reports any terminal error. */ }
          }
        };
        void poll();
        try {
          const result = await invoke('importImageFolder', id);
          library = result; folderImportResult = { attempted: result.attempted, added: result.added, imported: result.imported, errors: result.errors, stopped: result.stopped, unprocessed: result.unprocessed };
          assetQuery = ''; assetPage = 0;
          if (result.imported.length) draft.backgroundId = result.imported[0];
        } finally { finished = true; folderJobId = ''; folderProgress = null; if (!disposed) { library = await invoke('list'); render(); } }
      };
      const profiles = h('div', { class: 'beauty__profile-list' }, ...library.profiles.map(p => button(p.name, async () => {
        library = await invoke('selectProfile', p.id); draft = { ...p };
        if (!library.presets.slice(0, 4).some(preset => preset.id === p.preset)) showAllPresets = true;
        render();
      }, { class: `btn${draft.id === p.id ? ' btn--primary' : ''}` })));
      const importBundle = async () => {
        const result = await invoke('importBundle');
        if (result.canceled) return;
        library = result;
        draft = { ...result.profiles.find(p => p.id === result.importedProfileId) };
        render(); toast('主题和背景图片已导入', 'good');
      };
      const exportRecipe = engine => async () => {
        const result = await invoke('exportRecipe', { engine, profile: draft });
        if (!result.canceled) toast('配方已导出，请在对应原生引擎中手动导入', 'good', 5000);
      };
      const mergeRecipe = engine => async () => {
        const result = await invoke('exportMergedRecipe', { engine, profile: draft });
        if (!result.canceled) toast('合并版已另存，原文件保留；请在对应引擎中手动导入', 'good', 6000);
      };
      const nativeStatus = h('p', { class: 'faint', role: 'status' }, '可读取本机原版 2.1.0 宿主的运行状态。');
      const windows = library.windowAppearance || { supported: false, candidates: [], records: [] };
      if (!windows.candidates.some(item => item.id === windowTarget)) windowTarget = '';
      const targetSelect = h('select', { class: 'field', 'aria-label': '目标窗口' }, h('option', { value: '' }, '请选择窗口'),
        ...windows.candidates.map(item => h('option', { value: item.id, selected: item.id === windowTarget }, `${item.title || '无标题'} · ${item.processName}`)));
      targetSelect.addEventListener('change', () => { windowTarget = targetSelect.value; render(); });
      const windowFields = h('div', { class: 'beauty__row' }, ...[
        ['dark', '窗口标题栏深色', [['keep', '保持当前'], ['on', '跟随系统深色'], ['off', '浅色标题栏']]],
        ['corners', '窗口圆角', [['keep', '保持当前'], ['default', '系统默认'], ['square', '直角'], ['round', '圆角'], ['small', '小圆角']]],
        ['material', '窗口背景材质', [['keep', '保持当前'], ['auto', '系统默认'], ['none', '无材质'], ['mica', '云母'], ['acrylic', '亚克力'], ['tabbed', '云母 Alt']]],
      ].map(([key, label, options]) => {
        const select = h('select', { class: 'field', 'aria-label': label }, ...options.map(([value, name]) => h('option', { value, selected: windowOptions[key] === value }, name)));
        select.addEventListener('change', () => { windowOptions[key] = select.value; render(); });
        return h('label', { class: 'beauty__field' }, label, select);
      }));
      const changeWindow = async (method, payload) => {
        windowRecovery = null;
        if (method === 'restoreAllWindowAppearances') { windowStatus = '正在逐个恢复窗口，请稍候…'; render(); }
        try {
          library = await invoke(method, payload);
          windowRecovery = library.windowRestoreSummary || null;
          windowStatus = windowRecovery ? `已恢复 ${windowRecovery.restored.length} / ${windowRecovery.attempted} 个窗口；剩余 ${windowRecovery.remaining} 条记录。` : method === 'applyWindowAppearance' ? '已应用到所选窗口，原值已备份。' : '窗口恢复记录已更新。';
        }
        catch (error) { windowStatus = error.message; throw error; }
        finally { library = await invoke('list'); render(); }
      };
      const packageItems = library.packages || [];
      packagePage = Math.min(packagePage, Math.max(0, Math.ceil(packageItems.length / 8) - 1));
      const packageCards = h('div', { class: 'beauty__catalog-grid' }, ...packageItems.slice(packagePage * 8, packagePage * 8 + 8).map(pkg => {
        const items = library.assets.filter(a => pkg.assetIds.includes(a.id));
        return h('article', { class: 'beauty__catalog-card beauty__local-package' },
          button(h('img', { src: pkg.previewUrl || items[0]?.thumbnailUrl, alt: `${pkg.title} 原包预览`, loading: 'lazy' }), async () => {
            const profile = library.profiles.find(p => p.id === pkg.profileId); if (profile) { library = await invoke('selectProfile', profile.id); draft = { ...profile }; }
            assetSource = pkg.id; assetKind = 'all'; assetQuery = ''; assetPage = 0; render(); body.querySelector('.beauty__preview-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }, { class: 'beauty__catalog-cover', 'aria-label': `使用预设 ${pkg.title}`, disabled: !library.profiles.some(p => p.id === pkg.profileId) }),
          h('div', { class: 'beauty__catalog-copy' }, h('span', { class: 'beauty__catalog-kind' }, pkg.failedCount ? `已解析 · ${pkg.failedCount} 项待重试` : '完整包已解析 · 本机可用'), h('h3', {}, pkg.title),
            h('p', { class: 'faint' }, `${items.filter(a => a.kind === 'character').length} 张人物 · ${items.filter(a => a.kind === 'wallpaper').length} 张底图 · ${items.filter(a => a.kind === 'icon').length} 个图标`),
            h('p', { class: 'faint' }, '点击载入素材搭配；系统设置需手动应用')));
      }));
      const inspected = library.assets.find(a => a.id === inspectedAsset);
      const deleteId = inspectedAsset || draft.characterId || draft.backgroundId;
      const changeSystemTheme = async restore => {
        try {
          library = await invoke(restore ? 'restoreSystemTheme' : 'applySystemTheme', ...(restore ? [] : [{ profile: draft, options: themeOptions }]));
          engine = library.explorerEngine || engine;
          themeMessage = restore ? (library.restoreErrors.length ? `部分恢复失败：${library.restoreErrors.map(e => `${e.part}：${e.error}`).join('；')}` : '已撤销本次主题，恢复应用前的桌面和 Windows 配色。') : themeOptions.explorer && !engine.painted ? '已处理所选桌面与配色；资源管理器图片尚未确认生效。请打开测试文件夹并检查加载状态，必要时手动重启资源管理器。' : '主题已应用到电脑；可随时恢复应用前外观。';
          toast(themeMessage, library.restoreErrors?.length ? 'bad' : 'good', 7000);
        } finally { library = await invoke('list'); render(); }
      };
      const themeState = library.themeSession;
      body.replaceChildren(
        h('section', { class: 'card beauty__system-apply' }, h('h2', {}, '切换电脑主题'),
          h('p', {}, `当前搭配：${draft.name}。选择下方预设或素材，再应用到电脑。`),
          h('div', { class: 'beauty__row' }, ...[['wallpaper', '桌面壁纸'], ['explorer', '资源管理器人物／背景'], ['colors', 'Windows 深浅色与透明效果']].map(([key, label]) => {
            const check = h('input', { type: 'checkbox', checked: themeOptions[key], 'aria-label': label }); check.addEventListener('change', () => { themeOptions[key] = check.checked; });
            return h('label', { class: 'beauty__theme-option' }, check, label);
          })),
          h('p', { class: 'faint', role: 'status' }, engine.error ? `组件检测：${engine.error}` : engine.registered ? engine.enabled && engine.painted ? '资源管理器组件：已启用，已实际绘制图片' : engine.ready ? '资源管理器组件：已加载；主题图片尚未应用或绘制' : '资源管理器组件：已注册但尚未加载，图片未生效' : '资源管理器组件：未启用。首次启用会请求 Windows 管理员授权。'),
          h('div', { class: 'beauty__row' }, button('应用主题到电脑', () => changeSystemTheme(false), { class: 'btn btn--primary', disabled: !library.supported }),
            button('恢复应用前电脑外观', () => changeSystemTheme(true), { disabled: !library.supported || !(themeState || library.recovery || library.personalizationRecovery || engine.enabled) }),
            !engine.registered ? button('启用资源管理器组件', async () => { themeMessage = '等待 Windows 授权…'; library = await invoke('installExplorerEngine'); engine = library.explorerEngine; themeMessage = '组件已注册；选好搭配后点击“应用主题到电脑”。'; render(); }, { disabled: !library.supported }) : null,
            button('打开测试文件夹', async () => { await invoke('openExplorerThemeTest'); }, { disabled: !engine.registered }),
            button('检查生效', async () => { engine = await invoke('explorerEngineStatus'); render(); }),
            engine.registered && !engine.ready ? button('重启资源管理器（关闭文件夹）', async () => { library = await invoke('restartExplorerEngine'); engine = library.explorerEngine; themeMessage = engine.ready ? '资源管理器已重启，组件已加载，请打开文件夹检查图片。' : '资源管理器已重启，但组件仍未加载，图片尚未生效。'; render(); }) : null,
            engine.registered || engine.machineRegistered || engine.userRegistered ? button('移除资源管理器组件', async () => { library = await invoke('uninstallExplorerEngine'); engine = library.explorerEngine; render(); }, { disabled: !library.supported }) : null),
          themeMessage ? h('p', { role: 'status' }, themeMessage) : null,
          themeState?.error ? h('p', { class: 'faint', role: 'alert' }, `上次操作未完成：${themeState.error}。恢复备份已保留。`) : null,
          h('p', { class: 'faint' }, '人物会绘制到实际资源管理器文件区域；图标目前仅作素材查看。此入口不会修改字体、Key 或 Toolbox 偏好。恢复会停止图片绘制并还原首次应用前的桌面与配色；移除组件需要另一次 Windows 授权。')),
        packageItems.length ? h('section', { class: 'card beauty__local-packages' }, h('div', { class: 'beauty__row' }, h('h2', {}, `已解析的完整预设 · ${packageItems.length} 套`),
          h('span', { class: 'faint' }, '人物、底图与图标分开收纳，保留来源')), packageCards,
          h('div', { class: 'beauty__row beauty__pages' }, h('span', { class: 'faint' }, `第 ${packagePage + 1} / ${Math.ceil(packageItems.length / 8)} 页`),
            button('上一组预设', async () => { packagePage--; render(); }, { disabled: packagePage === 0 }),
            button('下一组预设', async () => { packagePage++; render(); }, { disabled: packagePage >= Math.ceil(packageItems.length / 8) - 1 }))) : null,
        gallery(),
        h('section', { class: 'beauty__hero' }, h('div', {}, h('h2', {}, '人物与窗口搭配'), h('p', { class: 'faint' }, '选择下方人物原图，再搭配底色与窗口质感。人物会贴在窗口右下角；桌面壁纸会先合成完整背景。资源管理器和开始菜单当前为效果预览。')),
          presetStrip, h('div', { class: 'beauty__row' }, button(showAllPresets ? '收起配色' : `全部 ${library.presets.length} 套配色`, async () => { showAllPresets = !showAllPresets; render(); }, { class: 'btn btn--sm' }))),
        h('div', { class: 'beauty__layout' },
          h('section', { class: 'card beauty__preview-card' }, h('div', { class: 'beauty__row' }, ...[['explorer', '资源管理器'], ['start', '开始菜单'], ['desktop', '桌面']].map(([id, name]) => button(name, async () => { scene = id; render(); }, { class: `btn btn--sm${scene === id ? ' btn--primary' : ''}` }))), previewHost,
            h('p', { class: 'faint' }, '人物贴图和窗口质感当前仅在此预览；桌面壁纸需点击下方按钮应用。'),
            h('div', { class: 'beauty__row' }, button('打开 Windows 原生材质预览', async () => {
              await invoke('previewNative', draft);
            }, { disabled: !library.nativePreview?.supported }), h('span', { class: 'faint' }, library.nativePreview?.supported ? '另开窗口预览云母或亚克力；模糊由 Windows 控制。' : library.nativePreview?.reason || '需要 Windows 11 22H2 或更新版本')),
            h('div', { class: 'beauty__row' }, button(draft.backgroundId || draft.characterId ? '应用这张桌面壁纸' : '应用当前渐变壁纸', applyBackground, { class: 'btn btn--primary', disabled: !library.supported }),
              button('恢复原壁纸', async () => { library = await invoke('restoreWallpaper'); render(); toast('已恢复应用前的桌面壁纸', 'good'); }, { disabled: !library.supported || !library.recovery }))),
          h('section', { class: 'card beauty__editor' }, h('h3', {}, '搭配主题'), profileName, h('label', { class: 'beauty__field' }, '窗口质感', effect),
            input('强调色', 'accent', { type: 'color' }), input('窗口底色', 'tint', { type: 'color' }), input('窗口不透明度', 'opacity', { type: 'range', min: 15, max: 100 }), input('背景模糊', 'blur', { type: 'range', min: 0, max: 40 }),
            h('div', { class: 'beauty__row' }, button('保存主题', async () => { library = await invoke('saveProfile', draft); render(); toast('主题已保存到本机', 'good'); }, { class: 'btn btn--primary' }),
              button('另存一份', async () => { const copy = { ...draft, id: crypto.randomUUID(), name: `${draft.name} 副本` }; library = await invoke('saveProfile', copy); draft = copy; render(); })),
            h('p', { class: 'faint' }, '保存主题只保存这里的搭配，不会切换系统设置。')),
        ),
        h('section', { class: 'card' }, h('div', { class: 'beauty__row' }, h('h3', {}, '我的素材'), button('＋ 导入图片', importImages), button('从文件夹导入', scanFolder), button('使用渐变背景', async () => { draft.backgroundId = ''; render(); }),
          button('移除预览人物', async () => { draft.characterId = ''; render(); }, { disabled: !draft.characterId }),
          button('删除所选素材', async () => { library = await invoke('deleteAsset', deleteId); if (draft.backgroundId === deleteId) draft.backgroundId = ''; if (draft.characterId === deleteId) draft.characterId = ''; inspectedAsset = ''; render(); toast('素材已从库中删除', 'good'); }, { disabled: !deleteId })),
          h('div', { class: 'beauty__row beauty__asset-tools' }, sizeSelect, button('生成渐变壁纸', async () => { await generateBackground(); toast('壁纸已加入素材库，桌面尚未切换', 'good'); }),
            button('优化素材加载', async () => { const result = await invoke('prepareThumbnails'); library = result; render(); toast(result.errors.length ? `已优化 ${result.prepared} 张，${result.errors.length} 张无法读取` : `已优化 ${result.prepared} 张素材，原图保持不变`, result.errors.length ? 'info' : 'good'); })),
          folderPreview ? h('div', { class: 'beauty__folder-preview', role: 'status' },
            h('strong', {}, `文件夹预览 · ${folderPreview.name}`),
            h('p', {}, `${folderPreview.count} 张候选图片 · ${(folderPreview.bytes / 1024 / 1024).toFixed(1)} MB。导入时验证图片内容，重复图片自动合并，原文件保留。`),
            h('p', { class: 'faint' }, `包括最多 ${folderPreview.limits.depth} 层子文件夹；每次最多 ${folderPreview.limits.files} 张、${Math.round(folderPreview.limits.bytes / 1024 / 1024)} MB。跳过：非图片 ${folderPreview.skipped.unsupported}、链接 ${folderPreview.skipped.links}、过大 ${folderPreview.skipped.oversized}、无法读取 ${folderPreview.skipped.unreadable}、更深目录 ${folderPreview.skipped.depth}。`),
            folderPreview.reached.length ? h('p', {}, '已达到本次扫描上限，只列出部分素材。可选择更小的子文件夹继续导入。') : null,
            h('ul', {}, ...folderPreview.samples.map(name => h('li', {}, name))),
            h('div', { class: 'beauty__row' }, button('导入预览中的图片', importFolder, { disabled: !folderPreview.count }),
              button('取消文件夹导入', async () => { await invoke('cancelImageFolder', folderPreview.id); folderPreview = null; render(); }))) : null,
          folderProgress ? h('div', { class: 'beauty__folder-preview beauty__import-progress' }, ...progressContents()) : null,
          folderImportResult ? h('div', { class: 'beauty__folder-preview', role: 'status' },
            h('p', {}, `已处理 ${folderImportResult.attempted} 张：新增 ${folderImportResult.added} 张，重复 ${folderImportResult.imported.length - folderImportResult.added} 张，失败 ${folderImportResult.errors.length} 张。`),
            folderImportResult.stopped ? h('p', {}, `已停止后续导入，剩余 ${folderImportResult.unprocessed} 张尚未处理。已导入素材和原文件均保留。`) : null,
            ...folderImportResult.errors.slice(0, 20).map(item => h('p', {}, `${item.name}：${item.error}`)),
            folderImportResult.errors.length > 20 ? h('p', {}, `另有 ${folderImportResult.errors.length - 20} 项未显示，可检查原文件后重新选择文件夹。`) : null) : null,
          h('div', { class: 'beauty__row beauty__asset-filters' }, assetSearch, kindSelect, sourceSelect),
          inspected ? h('div', { class: 'beauty__asset-detail' }, h('img', { src: inspected.url, alt: inspected.name }), h('div', {}, h('strong', {}, inspected.name), h('p', { class: 'faint' }, `${inspected.width} × ${inspected.height} · ${inspected.kind === 'icon' ? '图标素材预览，未应用系统图标' : inspected.kind === 'character' ? '人物图层，与底图独立选择' : '背景素材'}`))) : null,
          assets, pageControls),
        h('section', { class: 'card' }, h('div', { class: 'beauty__row' }, h('h3', {}, '我的主题'), button('导入主题包', importBundle), button('导出当前主题', async () => {
          const result = await invoke('exportBundle', draft); if (!result.canceled) toast('主题包已导出，包含当前背景图片', 'good');
        })), profiles, !library.profiles.length ? h('p', { class: 'faint' }, '搭配好后点“保存主题”，下次可以接着用。') : null,
          library.profiles.some(p => p.id === draft.id) ? button('删除当前主题', async () => { library = await invoke('deleteProfile', draft.id); draft = fresh(library.presets[0]); render(); }) : null),
        h('section', { class: 'card' }, h('h3', {}, 'Windows 原生外观'),
          h('p', { class: 'faint' }, '更改当前 Windows 用户的应用配色、系统配色与透明效果。选择“保持当前”的项目不会改动；保存主题只记录选择，点击应用后才生效。'),
          windowsOptions,
          h('p', { class: 'faint', role: 'status' }, personalizationStatus),
          h('div', { class: 'beauty__row' }, button('读取 Windows 外观', async () => {
            const { values } = await invoke('personalization');
            const describe = (key, off, on) => !values[key]?.exists ? '系统默认' : values[key].kind !== 'DWord' ? '值类型暂不支持' : values[key].value === 0 ? off : values[key].value === 1 ? on : '自定义值';
            personalizationStatus = `应用：${describe('AppsUseLightTheme', '深色', '浅色')}；Windows：${describe('SystemUsesLightTheme', '深色', '浅色')}；透明效果：${describe('EnableTransparency', '关闭', '开启')}。`;
            render();
          }, { disabled: !library.supported }),
          button('应用 Windows 外观', () => changePersonalization(false), { class: 'btn btn--primary', disabled: !library.supported || !Object.values(draft.windows).some(value => value !== 'keep') }),
          button('恢复 Windows 外观', () => changePersonalization(true), { disabled: !library.supported || !library.personalizationRecovery })),
          h('p', { class: 'faint' }, '应用前会保存所改项目的原值；透明效果的实际呈现取决于 Windows 和应用。此处不会改变字体。')),
        h('section', { class: 'card beauty__window-controls' }, h('div', { class: 'beauty__row' }, h('h3', {}, '指定窗口外观'),
          button('恢复全部已调整窗口', () => changeWindow('restoreAllWindowAppearances'), { disabled: !windows.supported || !windows.records.length })),
          h('p', { class: 'faint' }, '选择一个正在运行的窗口，手动调整圆角、标题栏与材质。只作用于这个窗口；自绘界面或不透明背景可能不显示材质效果。'),
          h('div', { class: 'beauty__row' }, button('刷新窗口列表', async () => { library = await invoke('refreshWindows'); windowStatus = `找到 ${library.windowAppearance.candidates.length} 个窗口。`; render(); }, { disabled: !windows.supported }), targetSelect),
          windowFields, h('p', { class: 'faint', role: 'status' }, windowStatus),
          windowRecovery?.failed.length ? h('div', { class: 'beauty__restore-summary', role: 'status' },
            h('p', {}, '以下项目未完成，恢复记录已保留：'), ...windowRecovery.failed.map(item => h('p', {}, `${item.title}：${item.error}`))) : null,
          h('div', { class: 'beauty__row' }, button('应用到所选窗口', () => changeWindow('applyWindowAppearance', { targetId: windowTarget, options: windowOptions }), { class: 'btn btn--primary', disabled: !windows.supported || !windowTarget || !Object.values(windowOptions).some(value => value !== 'keep') })),
          ...windows.records.map(record => h('div', { class: 'beauty__row' }, h('span', {}, `${record.title} · ${record.processName}`),
            button('恢复此窗口', () => changeWindow('restoreWindowAppearance', record.id)), button('清理已关闭窗口记录', () => changeWindow('forgetClosedWindow', record.id)))),
          !windows.supported ? h('p', { class: 'faint' }, windows.reason || '需要 Windows 11 22H2 或更新版本') : null),
        h('section', { class: 'card' }, h('h3', {}, '原生效果接入'),
          h('p', { class: 'faint' }, '把当前颜色、透明度和质感导出成开源引擎配方，再在对应引擎里手动导入。配方不包含背景图片；系统效果与这里的预览可能有差异。'),
          h('div', { class: 'beauty__row' }, button('导出标题栏配方 · DWMBlurGlass', exportRecipe('dwm')), button('导出资源管理器配方 · ExplorerBlurMica', exportRecipe('explorer'))),
          h('div', { class: 'beauty__row' }, button('合并已有 INI · DWMBlurGlass', mergeRecipe('dwm')), button('合并已有 INI · ExplorerBlurMica', mergeRecipe('explorer'))),
          h('p', { class: 'faint' }, '合并只更新颜色、模糊与材质字段，保留其他参数、注释和编码，另存新文件。原文件不变，手动导入引擎后生效。'),
          h('p', { class: 'faint' }, '已解析的原包图片在顶部本地预设中使用；这里不会套用原软件的字体、账户或系统配置。'), nativeStatus,
          h('div', { class: 'beauty__row' }, button('检查宿主状态', async () => {
            const state = await invoke('probe');
            if (disposed) return;
            nativeStatus.textContent = !state.supported ? '当前平台不支持 Windows 原生宿主。' : !state.running ? '原版宿主未运行。素材库、主题预览和桌面壁纸可以独立使用。' : !state.verified ? '发现宿主，但版本尚未验证，未发送控制消息。' : state.protocol === 2 ? `已识别 2.1.0 宿主，协议版本 2，状态 ${state.statusBits}。主题写入仍待验证。` : '宿主文件已识别，但通信未通过，可能需要匹配权限。';
          }), button('打开素材存储目录', () => invoke('openFolder')))),
      );
    }

    body.append(h('p', { class: 'faint' }, '正在读取本地素材库…'));
    action(async () => {
      library = await invoke('list'); catalog = await invoke('catalog');
      engine = await invoke('explorerEngineStatus');
      const selected = library.profiles.find(p => p.id === library.activeProfileId) || library.profiles[0]; draft = selected ? { ...selected } : fresh(library.presets[0]);
      if (!selected) draft.characterId = library.assets.find(a => a.kind === 'character')?.id || '';
      if (selected && !library.presets.slice(0, 4).some(preset => preset.id === selected.preset)) showAllPresets = true;
      render();
    });
    return { dispose() { disposed = true; if (folderPreview) api.cancelImageFolder(folderPreview.id).catch(() => {}); if (folderJobId) api.stopImageFolderImport(folderJobId).catch(() => {}); } };
  },
};
