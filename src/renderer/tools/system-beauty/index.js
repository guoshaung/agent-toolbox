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

    function preview() {
      const preset = library.presets.find(p => p.id === draft.preset) || library.presets[0];
      const asset = library.assets.find(a => a.id === draft.backgroundId);
      const surface = h('div', { class: `beauty__preview beauty__preview--${draft.effect}`, 'aria-label': '桌面与窗口效果预览', style: {
        backgroundImage: asset ? `url("${asset.url}")` : preset.gradient,
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
      surface.append(windowBody, h('div', { class: 'beauty__taskbar' }, '⊞　⌕　▱　◈　⚙', h('span', {}, '预览')));
      return surface;
    }

    function render() {
      if (disposed) return;
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
        const matching = library.assets.filter(a => String(a.name).toLowerCase().includes(assetQuery.toLowerCase()));
        const pages = Math.max(1, Math.ceil(matching.length / 48));
        assetPage = Math.min(assetPage, pages - 1);
        assets.replaceChildren(...matching.slice(assetPage * 48, (assetPage + 1) * 48).map(a => button([
          h('img', { src: a.thumbnailUrl || a.url, alt: '', loading: 'lazy', decoding: 'async' }),
          h('span', {}, a.name),
        ], async () => { draft.backgroundId = a.id; render(); }, {
          class: `beauty__asset${draft.backgroundId === a.id ? ' is-active' : ''}`,
          title: a.width && a.height ? `${a.name} · ${a.width} × ${a.height}` : a.name,
        })));
        if (!matching.length) assets.append(h('p', { class: 'faint' }, library.assets.length ? '没有找到匹配的素材。' : '导入喜欢的壁纸、插画或照片。支持批量选择 PNG、JPEG、WebP，每张不超过 25 MB。'));
        pageControls.replaceChildren(h('span', { class: 'faint' }, `${matching.length} 张素材 · ${assetPage + 1} / ${pages} 页`),
          button('上一页', async () => { assetPage--; drawAssets(); }, { class: 'btn btn--sm', disabled: assetPage === 0 }),
          button('下一页', async () => { assetPage++; drawAssets(); }, { class: 'btn btn--sm', disabled: assetPage >= pages - 1 }));
      };
      drawAssets();
      const assetSearch = h('input', { type: 'search', class: 'field', placeholder: '搜索素材名称', value: assetQuery, 'aria-label': '搜索素材名称' });
      assetSearch.addEventListener('input', () => { assetQuery = assetSearch.value; assetPage = 0; drawAssets(); });
      const sizeSelect = h('select', { class: 'field', 'aria-label': '壁纸尺寸' }, ...(library.wallpaperSizes || []).map(size => h('option', { value: size.id, selected: size.id === wallpaperSize }, size.name)));
      sizeSelect.addEventListener('change', () => { wallpaperSize = sizeSelect.value; });
      const generateBackground = async () => {
        library = await invoke('generateBackground', { preset: draft.preset, size: wallpaperSize });
        draft.backgroundId = library.generatedAssetId; assetQuery = ''; assetPage = 0; render();
      };
      const applyBackground = async () => {
        if (!draft.backgroundId) await generateBackground();
        try { await invoke('applyWallpaper', draft.backgroundId); toast('桌面壁纸已应用，原壁纸已备份', 'good'); }
        finally { library = await invoke('list'); render(); }
      };
      const importImages = async () => {
        const result = await invoke('importImages');
        if (result.canceled) return;
        library = result;
        assetQuery = ''; assetPage = 0;
        if (result.imported.length) draft.backgroundId = result.imported[0];
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
        const id = folderPreview.id; folderPreview = null; render();
        try {
          const result = await invoke('importImageFolder', id);
          library = result; folderImportResult = { attempted: result.attempted, added: result.added, imported: result.imported, errors: result.errors };
          assetQuery = ''; assetPage = 0;
          if (result.imported.length) draft.backgroundId = result.imported[0];
        } finally { library = await invoke('list'); render(); }
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
      body.replaceChildren(
        h('section', { class: 'beauty__hero' }, h('div', {}, h('span', { class: 'tag' }, '本地素材 · 独立主题库'), h('h2', {}, '给桌面换一种心情'), h('p', { class: 'faint' }, '先搭配背景与窗口质感，保存成自己的主题。桌面壁纸可直接应用；资源管理器和开始菜单当前为效果预览。')),
          presetStrip, h('div', { class: 'beauty__row' }, button(showAllPresets ? '收起配色' : `全部 ${library.presets.length} 套配色`, async () => { showAllPresets = !showAllPresets; render(); }, { class: 'btn btn--sm' }))),
        h('div', { class: 'beauty__layout' },
          h('section', { class: 'card beauty__preview-card' }, h('div', { class: 'beauty__row' }, ...[['explorer', '资源管理器'], ['start', '开始菜单'], ['desktop', '桌面']].map(([id, name]) => button(name, async () => { scene = id; render(); }, { class: `btn btn--sm${scene === id ? ' btn--primary' : ''}` }))), previewHost,
            h('p', { class: 'faint' }, '预览中的磨砂、云母、色彩和布局只作用于此画面。'),
            h('div', { class: 'beauty__row' }, button('打开 Windows 原生材质预览', async () => {
              await invoke('previewNative', draft);
            }, { disabled: !library.nativePreview?.supported }), h('span', { class: 'faint' }, library.nativePreview?.supported ? '另开窗口预览云母或亚克力；模糊由 Windows 控制。' : library.nativePreview?.reason || '需要 Windows 11 22H2 或更新版本')),
            h('div', { class: 'beauty__row' }, button(draft.backgroundId ? '应用这张桌面壁纸' : '应用当前渐变壁纸', applyBackground, { class: 'btn btn--primary', disabled: !library.supported }),
              button('恢复原壁纸', async () => { library = await invoke('restoreWallpaper'); render(); toast('已恢复应用前的桌面壁纸', 'good'); }, { disabled: !library.supported || !library.recovery }))),
          h('section', { class: 'card beauty__editor' }, h('h3', {}, '搭配主题'), profileName, h('label', { class: 'beauty__field' }, '窗口质感', effect),
            input('强调色', 'accent', { type: 'color' }), input('窗口底色', 'tint', { type: 'color' }), input('窗口不透明度', 'opacity', { type: 'range', min: 15, max: 100 }), input('背景模糊', 'blur', { type: 'range', min: 0, max: 40 }),
            h('div', { class: 'beauty__row' }, button('保存主题', async () => { library = await invoke('saveProfile', draft); render(); toast('主题已保存到本机', 'good'); }, { class: 'btn btn--primary' }),
              button('另存一份', async () => { const copy = { ...draft, id: crypto.randomUUID(), name: `${draft.name} 副本` }; library = await invoke('saveProfile', copy); draft = copy; render(); })),
            h('p', { class: 'faint' }, '保存主题只保存这里的搭配，不会切换系统设置。')),
        ),
        h('section', { class: 'card' }, h('div', { class: 'beauty__row' }, h('h3', {}, '我的素材'), button('＋ 导入图片', importImages), button('从文件夹导入', scanFolder), button('使用渐变背景', async () => { draft.backgroundId = ''; render(); }),
          button('删除所选素材', async () => { const id = draft.backgroundId; library = await invoke('deleteAsset', id); draft.backgroundId = ''; render(); toast('素材已从库中删除', 'good'); }, { disabled: !draft.backgroundId })),
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
          folderImportResult ? h('div', { class: 'beauty__folder-preview', role: 'status' },
            h('p', {}, `已处理 ${folderImportResult.attempted} 张：新增 ${folderImportResult.added} 张，重复 ${folderImportResult.imported.length - folderImportResult.added} 张，失败 ${folderImportResult.errors.length} 张。`),
            ...folderImportResult.errors.slice(0, 20).map(item => h('p', {}, `${item.name}：${item.error}`)),
            folderImportResult.errors.length > 20 ? h('p', {}, `另有 ${folderImportResult.errors.length - 20} 项未显示，可检查原文件后重新选择文件夹。`) : null) : null,
          assetSearch, assets, pageControls),
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
          h('p', { class: 'faint' }, '此处不会安装或启用原生引擎。原版 MToolBox 的专用主题包暂不支持导入。'), nativeStatus,
          h('div', { class: 'beauty__row' }, button('检查宿主状态', async () => {
            const state = await invoke('probe');
            if (disposed) return;
            nativeStatus.textContent = !state.supported ? '当前平台不支持 Windows 原生宿主。' : !state.running ? '原版宿主未运行。素材库、主题预览和桌面壁纸可以独立使用。' : !state.verified ? '发现宿主，但版本尚未验证，未发送控制消息。' : state.protocol === 2 ? `已识别 2.1.0 宿主，协议版本 2，状态 ${state.statusBits}。主题写入仍待验证。` : '宿主文件已识别，但通信未通过，可能需要匹配权限。';
          }), button('打开素材存储目录', () => invoke('openFolder')))),
      );
    }

    body.append(h('p', { class: 'faint' }, '正在读取本地素材库…'));
    action(async () => {
      library = await invoke('list'); const selected = library.profiles.find(p => p.id === library.activeProfileId) || library.profiles[0]; draft = selected ? { ...selected } : fresh(library.presets[0]);
      if (selected && !library.presets.slice(0, 4).some(preset => preset.id === selected.preset)) showAllPresets = true;
      render();
    });
    return { dispose() { disposed = true; if (folderPreview) api.cancelImageFolder(folderPreview.id).catch(() => {}); } };
  },
};
