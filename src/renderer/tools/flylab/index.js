import { h, toast } from '../../core/ui.js';

/**
 * 果蝇观察箱：在 toolbox 里跑 NeuroMechFly v2（flygym + MuJoCo）仿真。
 * 主进程在独立 venv 里起 Python 子进程，进度按行流过来；跑完把 mp4 当 data URL 播。
 * 首次点「开始仿真」会先建环境、下 flygym（几百 MB），之后直接跑。
 */

// 约 1000 步 ≈ 1 秒视频、渲染约 5.5 秒（单只）。循环播放，越长越像"一直在看"。
const LENGTHS = [
  { id: 4000, label: '约 4 秒（先看效果，渲染 ~20s）' },
  { id: 15000, label: '约 15 秒（渲染 ~1.5 分钟）' },
  { id: 30000, label: '约 30 秒（渲染 ~3 分钟）' },
  { id: 60000, label: '约 1 分钟（渲染 ~6 分钟）' },
];
const SPEEDS = [
  { id: 0.1, label: '慢动作 0.1×' },
  { id: 0.2, label: '0.2×' },
  { id: 0.5, label: '0.5×' },
];

export default {
  id: 'flylab',
  title: '果蝇观察箱',
  icon: 'flask',
  hint: '把 3D 果蝇放进空白世界跑仿真（flygym / MuJoCo）',

  create(root, ctx) {
    const { config } = ctx;
    const api = window.toolbox.flylab;
    let busy = false;

    const cameraSel = h('select', { class: 'field field--sm' });
    const lengthSel = h('select', { class: 'field field--sm' }, ...LENGTHS.map((l) => h('option', { value: String(l.id) }, l.label)));
    const speedSel = h('select', { class: 'field field--sm' }, ...SPEEDS.map((s) => h('option', { value: String(s.id) }, s.label)));
    lengthSel.value = String(config.get('flylab.steps', 15000));
    speedSel.value = String(config.get('flylab.speed', 0.1));

    const runBtn = h('button', { class: 'btn btn--primary', onclick: start }, '▶ 开始仿真');
    const cancelBtn = h('button', { class: 'btn btn--ghost', hidden: true, onclick: () => api.cancel() }, '取消');
    const folderBtn = h('button', { class: 'btn btn--ghost btn--sm', onclick: () => api.openFolder() }, '打开文件夹');

    const bar = h('div', { class: 'flylab__pbar-fill' });
    const barWrap = h('div', { class: 'flylab__pbar', hidden: true }, bar);
    const statusLine = h('div', { class: 'faint flylab__status' });
    const logLine = h('div', { class: 'faint flylab__log mono' });

    const video = h('video', { class: 'flylab__video', controls: true, loop: true, hidden: true });
    const stage = h('div', { class: 'flylab__stage' },
      h('div', { class: 'flylab__placeholder faint' }, '还没跑过。选好机位和时长，点「开始仿真」——第一次会先装环境（几百 MB，要联网），之后直接出视频。'),
      video,
    );
    const gallery = h('div', { class: 'flylab__gallery' });

    async function loadCameras() {
      const cams = await api.cameras();
      cameraSel.replaceChildren(...cams.map((c) => h('option', { value: c.id }, c.label)));
      cameraSel.value = config.get('flylab.camera', cams[0]?.id || 'Animat/camera_top');
    }

    function setBusy(on) {
      busy = on;
      runBtn.disabled = on;
      runBtn.textContent = on ? '仿真中…' : '▶ 开始仿真';
      cancelBtn.hidden = !on;
      barWrap.hidden = !on;
      for (const el of [cameraSel, lengthSel, speedSel]) el.disabled = on;
    }

    async function start() {
      if (busy) return;
      config.set('flylab.camera', cameraSel.value);
      config.set('flylab.steps', Number(lengthSel.value));
      config.set('flylab.speed', Number(speedSel.value));
      setBusy(true);
      bar.style.width = '0%';
      statusLine.textContent = '准备中…';
      logLine.textContent = '';
      video.hidden = true;
      const r = await api.run({
        camera: cameraSel.value,
        sim_steps: Number(lengthSel.value),
        play_speed: Number(speedSel.value),
      });
      setBusy(false);
      if (!r.ok) { toast(r.error || '仿真失败', 'bad', 6000); statusLine.textContent = r.error || '失败'; return; }
      showVideo(r.dataUrl);
      statusLine.textContent = '完成 ✓';
      refreshGallery();
    }

    function showVideo(dataUrl) {
      if (!dataUrl) return;
      stage.querySelector('.flylab__placeholder')?.style.setProperty('display', 'none');
      video.src = dataUrl;
      video.hidden = false;
      video.play().catch(() => {});
    }

    async function refreshGallery() {
      const r = await api.list();
      const items = r.items || [];
      gallery.replaceChildren(
        h('div', { class: 'flylab__gallery-head faint' }, items.length ? `历史 ${items.length} 段` : ''),
        ...items.map((it) => h('div', { class: 'flylab__gitem' },
          h('button', {
            class: 'btn btn--sm', title: '播放',
            onclick: async () => { const v = await api.readVideo(it.path); if (v.ok) showVideo(v.dataUrl); else toast(v.error, 'bad'); },
          }, '▶ ' + new Date(it.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
          h('button', { class: 'btn btn--sm btn--ghost', title: '删除', onclick: async () => { await api.remove(it.path); refreshGallery(); } }, '删'),
        )),
      );
    }

    api.onProgress((s) => {
      if (s.phase === 'installing') { statusLine.textContent = '首次安装环境中（几百 MB，请稍候）…'; if (s.line) logLine.textContent = s.line; bar.style.width = '5%'; }
      else if (s.phase === 'running') {
        if (typeof s.pct === 'number') { bar.style.width = Math.max(5, s.pct) + '%'; statusLine.textContent = `仿真中 ${s.pct}%${s.frames ? `（已渲 ${s.frames} 帧）` : ''}`; }
        if (s.line) logLine.textContent = s.line;
      } else if (s.phase === 'done') { bar.style.width = '100%'; if (s.dataUrl) showVideo(s.dataUrl); }
      else if (s.phase === 'error') { statusLine.textContent = s.line || '出错'; logLine.textContent = s.line || ''; }
    });

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '果蝇观察箱'),
        h('span', { class: 'flylab__spacer' }),
        folderBtn,
      ),
      h('div', { class: 'flylab__body' },
        h('div', { class: 'flylab__controls' },
          h('label', { class: 'flylab__ctl' }, h('span', {}, '机位'), cameraSel),
          h('label', { class: 'flylab__ctl' }, h('span', {}, '时长'), lengthSel),
          h('label', { class: 'flylab__ctl' }, h('span', {}, '回放'), speedSel),
          runBtn, cancelBtn,
        ),
        barWrap,
        statusLine,
        logLine,
        stage,
        gallery,
        h('p', { class: 'faint flylab__note' }, '视频循环播放，选长一点就像一直在观察。NeuroMechFly v2：真实果蝇显微 CT 重建的 3D 模型，在 MuJoCo 里用 CPG 步态走 + 拐弯。纯 CPU，不用显卡；单只带渲染约实时的 1/50，所以是「跑完出视频」而不是实时窗口。'),
      ),
    );

    loadCameras();
    refreshGallery();
    api.status().then((st) => { if (st.ready === false && st.hasBootstrap === false) statusLine.textContent = window.toolbox ? '注意：这台机器还没准备好运行环境，首次仿真可能需要先装 Python/uv。' : ''; });

    return {};
  },
};
