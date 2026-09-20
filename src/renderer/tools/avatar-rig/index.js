import { h, toast } from '../../core/ui.js';

const VIEW_LABELS = { front: '正面', left: '左侧（鼻尖朝左）', back: '背面', right:'右侧（可选，鼻尖朝右）' };

export default {
  id: 'avatar-rig',
  title: '图片建模',
  icon: 'bot',
  hint: '单图 / 三视图 → 真实网格与贴图 → VRM / GLB',

  create(root) {
    let single = null, busy = false, timer = null, sequence = 0;
    const views = {};
    let environments = { single: false, multiview: false };
    const mode = h('select', { class: 'field', 'aria-label': '建模模式' },
      h('option', { value: 'multiview' }, '三视图重建 · Hunyuan3D-2mv'),
      h('option', { value: 'single' }, '单图草模 · TripoSR'));
    const name = h('input', { class: 'field', placeholder: '角色名称（可选）', 'aria-label': '角色名称', maxlength: 100 });
    const state = h('div', { class: 'avatar-rig__status', role: 'status' }, '正在检查本机环境…');
    const environmentLabel = h('span', { class: 'tag' }, '检查中');
    const results = h('section', { class: 'avatar-rig__result', hidden: true });
    const singlePreview = h('div', { class: 'avatar-rig__preview' }, '选择一张完整人物图');
    const singleLabel = h('span', { class: 'faint' }, 'PNG / JPG / WEBP，最多 40MB');
    const pickSingle = h('button', { class: 'btn btn--primary', onclick: () => pick('single') }, '选择人物图');
    const sample = h('button', { class: 'btn', onclick: async () => {
      try { setImage('single', await window.toolbox.avatarRig.sample()); } catch (error) { fail(error); }
    } }, '本机初音示例');
    const singlePanel = h('div', { class: 'avatar-rig__card', hidden: true }, singlePreview,
      h('div', { class: 'avatar-rig__toolbar' }, pickSingle, sample, singleLabel));
    const cards = {};
    const multiviewPanel = h('div', { class: 'avatar-rig__views' });
    for (const [key, label] of Object.entries(VIEW_LABELS)) {
      const preview = h('div', { class: 'avatar-rig__preview' }, '尚未选择');
      const filename = h('span', { class: 'faint avatar-rig__filename' }, '透明或纯白背景');
      const button = h('button', { class: 'btn', onclick: () => pick(key) }, '选择' + label);
      cards[key] = { preview, filename, button };
      multiviewPanel.append(h('section', { class: 'avatar-rig__view' }, h('strong', {}, label), preview, filename, button));
    }
    const generate = h('button', { class: 'btn btn--primary', onclick: generateProject, disabled: true }, '重建并导出 VRM');
    const torsoCloth = h('label', { class: 'avatar-rig__option' }, h('input', { type: 'checkbox', checked: true }), '上躯干布料层（走路轻微软动效）');
    const setup = h('button', { class: 'btn', onclick: install }, '安装所选环境');
    const refresh = h('button', { class: 'btn', onclick: refreshProject }, '更新项目脚本（自动备份）');
    const open = h('button', { class: 'btn', onclick: async () => {
      const result = await window.toolbox.avatarRig.open();
      if (!result.ok) fail(new Error(result.error));
    } }, '打开项目目录');
    const previewLast = h('button', { class: 'btn', onclick: () => showModel() }, '打开最近模型');
    function update() {
      const mv = mode.value === 'multiview';
      singlePanel.hidden = mv;
      multiviewPanel.hidden = !mv;
      torsoCloth.hidden = !mv;
      const complete = mv ? ['front','left','back'].every(k => views[k]) : Boolean(single);
      generate.disabled = busy || !complete || !environments[mode.value];
      generate.textContent = busy ? '执行中…' : '重建并导出 VRM';
      [mode, name, setup, refresh, pickSingle, sample, torsoCloth.querySelector('input'), ...Object.values(cards).map(c => c.button)]
        .forEach(el => { el.disabled = busy; });
      environmentLabel.textContent = environments[mode.value] ? '环境就绪' : '需要安装环境';
      environmentLabel.className = environments[mode.value] ? 'tag tag--good' : 'tag tag--warn';
    }
    function fail(error) { state.textContent = error.message; toast(error.message, 'bad', 6000); }
    function setImage(key, file) {
      if (!file) return;
      if (file.error) throw new Error(file.error);
      if (busy) return;
      const image = h('img', { src: 'data:' + (file.mime || 'image/png') + ';base64,' + file.base64, alt: key === 'single' ? '人物参考图' : VIEW_LABELS[key] });
      if (key === 'single') { single = file; singlePreview.replaceChildren(image); singleLabel.textContent = file.name; }
      else { views[key] = file; cards[key].preview.replaceChildren(image); cards[key].filename.textContent = file.name; }
      state.textContent = mode.value === 'multiview'
        ? '必需三图已选择 ' + ['front','left','back'].filter(k=>views[k]).length + '/3。可另加右侧图；缺少时右侧贴图只能镜像近似。'
        : '参考图就绪。背面和遮挡部分由模型推断。';
      update();
    }
    async function pick(key) {
      try { setImage(key, await window.toolbox.files.pickImage()); } catch (error) { fail(error); }
    }
    async function checkEnvironment() {
      const token = sequence;
      try {
        const result = await window.toolbox.avatarRig.status();
        if (token !== sequence) return;
        environments = result.engines || { single: result.ready, multiview: false };
        busy = result.running;
        state.textContent = result.running ? result.progress : '选择参考图后开始。首次安装需下载模型，已有任务和模型会保留。';
        update();
      } catch (error) { fail(error); }
    }
    function startPolling() {
      const token = ++sequence;
      clearInterval(timer);
      timer = setInterval(async () => {
        try {
          const result = await window.toolbox.avatarRig.status();
          if (sequence === token && busy) state.textContent = result.progress;
        } catch { /* Final operation response provides the error. */ }
      }, 1200);
    }
    async function operation(fn) {
      if (busy) return;
      busy = true; update(); startPolling();
      try { await fn(); } catch (error) { fail(error); }
      finally {
        sequence++; clearInterval(timer); timer = null; busy = false;
        try { environments = (await window.toolbox.avatarRig.status()).engines || environments; } catch {}
        update();
      }
    }
    async function install() {
      await operation(async () => {
        state.textContent = '安装环境与下载权重，首次可能需要数分钟…';
        const result = await window.toolbox.avatarRig.setup(mode.value);
        if (!result.ok) throw new Error(result.error);
        state.textContent = '安装完成，可以生成模型。';
      });
    }
    async function refreshProject() {
      await operation(async () => {
        const result = await window.toolbox.avatarRig.refresh();
        if (!result.ok) throw new Error(result.error);
        state.textContent = '项目脚本已更新。' + (result.backedUp ? '旧文件已保存在项目 _backups 目录。' : '');
      });
    }
    async function showModel(jobId) {
      try {
        const result = await window.toolbox.avatarRig.preview(jobId);
        if (!result.ok) throw new Error(result.error);
      } catch (error) { fail(error); }
    }
    async function generateProject() {
      if (generate.disabled) return;
      const payload = mode.value === 'multiview'
        ? { mode: 'multiview', name: name.value, views, options: { torsoCloth: torsoCloth.querySelector('input').checked } }
        : { mode: 'single', name: name.value, base64: single.base64 };
      await operation(async () => {
        results.hidden = true;
        state.textContent = '开始重建…';
        const output = await window.toolbox.avatarRig.generate(payload);
        if (!output.ok) throw new Error(output.error);
        const m = output.manifest;
        results.replaceChildren(
          h('div', { class: 'avatar-rig__result-head' }, h('strong', {}, 'VRM / GLB 已导出'), h('span', { class: 'tag tag--good' }, m.source)),
          h('p', {}, m.vertices.toLocaleString() + ' 顶点 · ' + m.triangles.toLocaleString() + ' 三角面 · ' + m.bones + ' 骨骼'),
          h('p', { class: 'faint' }, '初步绑定草稿，仍需检查视图接缝、T 姿势和运动权重。' + (m.clothPhysics ? ' 已导出上躯干布料层。' : '')),
          h('button', { class: 'btn btn--primary', onclick: () => showModel(output.jobId) }, '旋转查看 / 下载模型'));
        results.hidden = false;
        state.textContent = '完成。可切换正面、侧面、背面和无贴图网格检查。';
      });
    }
    mode.addEventListener('change', update);
    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '图片建模'), h('span', { class: 'faint' }, '单图 / 三视图 → VRM / GLB')),
      h('div', { class: 'avatar-rig__body' },
        h('section', { class: 'avatar-rig__hero' },
          h('div', {}, h('span', { class: 'avatar-rig__eyebrow' }, 'AVATAR RIG STUDIO'),
            h('h2', {}, '让三维角色，拥有侧面。'),
            h('p', { class: 'faint' }, '用正面、左侧和背面共同约束形状，再生成贴图与初步骨骼。单图模式保留为快速草模入口。')), environmentLabel),
        h('div', { class: 'avatar-rig__toolbar' }, mode, name),
        singlePanel, multiviewPanel,
        torsoCloth,
        h('details', { class: 'avatar-rig__card' }, h('summary', {}, '参考图要求与首次安装'),
          h('p', {}, '必需正面、左侧、背面；可加右侧。图片需同一姿势、等高全身、透明或纯白背景。左侧图鼻尖朝画面左边，右侧图鼻尖朝画面右边。缺少右侧时使用镜像近似，不保证服装左右不对称细节准确。拼图请先裁成独立文件。'),
          h('p', {}, '可以在豆包等工具生成一致三视图后导入。这里不会自动登录网页，也不承诺 AI 视图完全一致。'),
          h('p', {}, '三视图模式实测 RTX 4070 Laptop 8GB；需要 NVIDIA CUDA、Python 3.12、uv 和 Git。首次下载约 4.9GB 权重及依赖，遵循 Hunyuan 项目的模型许可。旧环境不被替换。'),
          h('p', {}, '升级后请点击“更新项目脚本”；覆盖前自动备份。用户图片、任务、权重与虚拟环境保留。')),
        h('div', { class: 'avatar-rig__actions' }, generate, previewLast, open),
        h('div', { class: 'avatar-rig__actions' }, setup, refresh),
        state, results,
        h('p', { class: 'avatar-rig__status faint' }, '当前仍为自动重建草稿。贴图是参考图投影，可能有接缝；骨骼需精修。表情需要人工核对面部区域后导出 Morph，头发和衣服没有物理。')));
    update(); void checkEnvironment();
    return { activate() { if (!busy) void checkEnvironment(); }, dispose() { sequence++; clearInterval(timer); } };
  },
};
