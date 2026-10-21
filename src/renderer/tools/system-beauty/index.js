import { h, toast } from '../../core/ui.js';

export default {
  id: 'system-beauty', title: '系统美化', icon: 'palette',
  hint: '导入图片、保存主题、预览窗口质感，应用与恢复桌面壁纸',
  create(root) {
    const api = window.toolbox.systemBeauty;
    let library, draft, scene = 'explorer', disposed = false, busy = false;
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
      const presetStrip = h('div', { class: 'beauty__presets' }, ...library.presets.map(p => button(p.name, async () => { draft = fresh(p); render(); }, {
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
      const assets = h('div', { class: 'beauty__assets' }, ...library.assets.map(a => button(a.name, async () => { draft.backgroundId = a.id; render(); }, {
        class: `beauty__asset${draft.backgroundId === a.id ? ' is-active' : ''}`, title: a.name, style: { backgroundImage: `url("${a.url}")` },
      })));
      if (!library.assets.length) assets.append(h('p', { class: 'faint' }, '导入喜欢的壁纸、插画或照片。支持批量选择 PNG、JPEG、WebP，每张不超过 25 MB。'));
      const importImages = async () => {
        const result = await invoke('importImages');
        if (result.canceled) return;
        library = result;
        if (result.imported.length) draft.backgroundId = result.imported[0];
        render();
        toast(result.errors.length ? `导入 ${result.imported.length} 张；${result.errors.map(e => `${e.name}：${e.error}`).join('；')}` : `已导入 ${result.imported.length} 张素材`, result.errors.length ? 'info' : 'good', 6000);
      };
      const profiles = h('div', { class: 'beauty__profile-list' }, ...library.profiles.map(p => button(p.name, async () => {
        library = await invoke('selectProfile', p.id); draft = { ...p }; render();
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
      const nativeStatus = h('p', { class: 'faint', role: 'status' }, '可读取本机原版 2.1.0 宿主的运行状态。');
      body.replaceChildren(
        h('section', { class: 'beauty__hero' }, h('div', {}, h('span', { class: 'tag' }, '本地素材 · 独立主题库'), h('h2', {}, '给桌面换一种心情'), h('p', { class: 'faint' }, '先搭配背景与窗口质感，保存成自己的主题。桌面壁纸可直接应用；资源管理器和开始菜单当前为效果预览。')), presetStrip),
        h('div', { class: 'beauty__layout' },
          h('section', { class: 'card beauty__preview-card' }, h('div', { class: 'beauty__row' }, ...[['explorer', '资源管理器'], ['start', '开始菜单'], ['desktop', '桌面']].map(([id, name]) => button(name, async () => { scene = id; render(); }, { class: `btn btn--sm${scene === id ? ' btn--primary' : ''}` }))), previewHost,
            h('p', { class: 'faint' }, '预览中的磨砂、云母、色彩和布局只作用于此画面。'),
            h('div', { class: 'beauty__row' }, button('应用这张桌面壁纸', async () => { library = await invoke('applyWallpaper', draft.backgroundId); render(); toast('桌面壁纸已应用，原壁纸已备份', 'good'); }, { class: 'btn btn--primary', disabled: !library.supported || !draft.backgroundId }),
              button('恢复原壁纸', async () => { library = await invoke('restoreWallpaper'); render(); toast('已恢复应用前的桌面壁纸', 'good'); }, { disabled: !library.supported || !library.recovery }))),
          h('section', { class: 'card beauty__editor' }, h('h3', {}, '搭配主题'), profileName, h('label', { class: 'beauty__field' }, '窗口质感', effect),
            input('强调色', 'accent', { type: 'color' }), input('窗口底色', 'tint', { type: 'color' }), input('窗口不透明度', 'opacity', { type: 'range', min: 15, max: 100 }), input('背景模糊', 'blur', { type: 'range', min: 0, max: 40 }),
            h('div', { class: 'beauty__row' }, button('保存主题', async () => { library = await invoke('saveProfile', draft); render(); toast('主题已保存到本机', 'good'); }, { class: 'btn btn--primary' }),
              button('另存一份', async () => { const copy = { ...draft, id: crypto.randomUUID(), name: `${draft.name} 副本` }; library = await invoke('saveProfile', copy); draft = copy; render(); })),
            h('p', { class: 'faint' }, '保存主题只保存这里的搭配，不会切换系统设置。')),
        ),
        h('section', { class: 'card' }, h('div', { class: 'beauty__row' }, h('h3', {}, '我的素材'), button('＋ 导入图片', importImages), button('使用渐变背景', async () => { draft.backgroundId = ''; render(); }),
          button('删除所选素材', async () => { const id = draft.backgroundId; library = await invoke('deleteAsset', id); draft.backgroundId = ''; render(); toast('素材已从库中删除', 'good'); }, { disabled: !draft.backgroundId })), assets),
        h('section', { class: 'card' }, h('div', { class: 'beauty__row' }, h('h3', {}, '我的主题'), button('导入主题包', importBundle), button('导出当前主题', async () => {
          const result = await invoke('exportBundle', draft); if (!result.canceled) toast('主题包已导出，包含当前背景图片', 'good');
        })), profiles, !library.profiles.length ? h('p', { class: 'faint' }, '搭配好后点“保存主题”，下次可以接着用。') : null,
          library.profiles.some(p => p.id === draft.id) ? button('删除当前主题', async () => { library = await invoke('deleteProfile', draft.id); draft = fresh(library.presets[0]); render(); }) : null),
        h('section', { class: 'card' }, h('h3', {}, '原生效果接入'),
          h('p', { class: 'faint' }, '把当前颜色、透明度和质感导出成开源引擎配方，再在对应引擎里手动导入。配方不包含背景图片；系统效果与这里的预览可能有差异。'),
          h('div', { class: 'beauty__row' }, button('导出标题栏配方 · DWMBlurGlass', exportRecipe('dwm')), button('导出资源管理器配方 · ExplorerBlurMica', exportRecipe('explorer'))),
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
      library = await invoke('list'); const selected = library.profiles.find(p => p.id === library.activeProfileId) || library.profiles[0]; draft = selected ? { ...selected } : fresh(library.presets[0]); render();
    });
    return { dispose() { disposed = true; } };
  },
};
