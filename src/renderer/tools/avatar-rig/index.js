import { h, toast } from '../../core/ui.js';

export default {
  id: 'avatar-rig',
  title: '图片建模',
  icon: 'bot',
  hint: 'TripoSR 真实重建 → 蒙皮骨骼 → VRM / GLB',

  create(root, ctx) {
    let selected = null;
    let project = null;
    const preview = h('div', { class: 'avatar-rig__preview' }, h('span', {}, '还没有选择人物图'));
    const sourceLabel = h('span', { class: 'faint avatar-rig__source' }, '支持 PNG / JPG / WEBP');
    const status = h('div', { class: 'avatar-rig__status faint', role:'status' }, '输出标准 .vrm 和 .glb；可在 3D 查看器旋转检查、显示骨架和测试运动。');
    const result = h('div', { class: 'avatar-rig__result', hidden: true });
    const pick = h('button', { class: 'btn btn--primary', onclick: pickImage }, '选择人物图');
    const generate = h('button', { class: 'btn btn--primary avatar-rig__generate', disabled: true, onclick: generateProject }, '重建并导出 VRM');
    let timer;
    function selectImage(file) {
      if (!file) return;
      if(file.error)throw new Error(file.error);
      selected=file;
      preview.replaceChildren(h('img', {src:`data:${file.mime || 'image/png'};base64,${file.base64}`,alt:'人物图预览'}));
      sourceLabel.textContent=file.name || '已选择图片';generate.disabled=false;
      status.textContent='图片就绪。透明背景、完整全身、四肢分开的正面图通常更容易重建。';
    }

    async function pickImage() {
      const file = await window.toolbox.files.pickImage();
      if (!file) return;
      try {selectImage(file);}catch(e){toast(e.message,'bad');}
    }

    async function launchProject() {
      const started = await window.toolbox.avatarRig.preview();
      if (!started.ok)toast(started.error || '查看器启动失败','bad',5000);
    }

    async function generateProject() {
      if (!selected) return toast('先选择一张人物图', 'info');
      generate.disabled = true;
      status.textContent = '正在启动真实三维重建…';pick.disabled=true;
      timer=setInterval(async()=>{try{const s=await window.toolbox.avatarRig.status();status.textContent=s.progress;}catch{}},1000);
      try {
        const output = await window.toolbox.avatarRig.generate({
          base64: selected.base64, fileName: selected.name,
        });
        if (!output.ok) throw new Error(output.error);
        project = output.project;
        const manifest = output.manifest;
        result.hidden = false;
        result.replaceChildren(
          h('div', { class: 'avatar-rig__result-head' }, h('strong', {}, 'VRM 模型已导出'), h('span', { class: 'tag tag--good' }, '真实 3D · 自动绑定草稿')),
          h('p', { class: 'faint' }, `${manifest.vertices.toLocaleString()} 顶点 · ${manifest.triangles.toLocaleString()} 三角面 · ${manifest.bones} 骨骼`),
          h('div', { class: 'avatar-rig__result-actions' },
            h('button', { class: 'btn btn--sm btn--primary', onclick: () => window.toolbox.container.open() }, '打开容器'),
            h('button', { class: 'btn btn--sm', onclick: async()=>{const r=await window.toolbox.avatarRig.preview(output.jobId);if(!r.ok)toast(r.error,'bad');} }, '旋转查看 / 下载模型'),
          ),
        );
        status.textContent = '已保存 avatar.vrm 和 avatar.glb。自动绑定保留参考姿势，动作重定向前仍需校正 T 姿势与权重。';
        toast('VRM / GLB 已保存到容器', 'good', 5000);
      } catch (error) {
        status.textContent = error.message;
        toast(`生成失败：${error.message}`, 'bad', 6000);
      } finally {clearInterval(timer); generate.disabled = false;pick.disabled=false; }
    }

    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '图片建模'), h('span', { class: 'faint' }, 'TripoSR → 骨骼蒙皮 → VRM / GLB')),
      h('div', { class: 'avatar-rig__body' },
        h('section', { class: 'avatar-rig__hero' },
          h('div', {}, h('span', { class: 'avatar-rig__eyebrow' }, 'AVATAR RIG STUDIO'), h('h2', {}, '把立绘变成立体角色'), h('p', { class: 'faint' }, '使用本机 GPU 推断三维表面与颜色，输出带骨骼、蒙皮权重的模型文件。支持旋转查看和运动测试。')),
          preview,
        ),
        h('div', { class: 'avatar-rig__toolbar' }, pick,h('button',{class:'btn',onclick:async()=>{try{selectImage(await window.toolbox.avatarRig.sample());}catch(e){toast(e.message,'bad');}}},'使用初音全身示例'), sourceLabel),
        h('section', { class: 'avatar-rig__card' },
          h('div', { class: 'avatar-rig__card-head' }, h('strong', {}, '自动重建草稿'), h('span', { class: 'tag' }, '本地 GPU')),
          h('p', { class: 'faint' }, '单张图的背面由模型推断，细节会损失。自动骨骼为初始估计，尚无口型、表情和头发物理；精修与动作重定向需要在 Blender 中继续调整。'),
        ),
        h('div', { class: 'avatar-rig__actions' }, generate, h('button',{class:'btn',onclick:launchProject},'一键打开 3D 查看器'), h('button', { class: 'btn', onclick: () => window.toolbox.avatarRig.open() }, '打开项目目录')),
        status,
        result,
      ),
    );
    return {};
  },
};
