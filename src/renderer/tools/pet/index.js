import { h, toast } from '../../core/ui.js';
import { PET_SKINS } from '../../../pet/skins.js';

export default {
  id: 'pet',
  title: '桌宠',
  icon: 'bot',
  hint: '记忆栈：把 Codex / Claude 里的好回答吃下来，之后搜，不用往上翻',

  create(root, ctx) {
    const { config } = ctx;
    const get = (key, fallback) => config.get(`pet.${key}`, fallback);
    const save = (key, value) => config.set(`pet.${key}`, value);

    const enabled = h('input', { type: 'checkbox', class: 'switch__input' });
    enabled.checked = get('enabled', false);
    enabled.addEventListener('change', async () => {
      await save('enabled', enabled.checked);
      await window.toolbox.pet.setEnabled(enabled.checked);
      state.textContent = enabled.checked ? '运行中' : '默认关闭';
      state.className = `tag ${enabled.checked ? 'tag--good' : ''}`;
      toast(enabled.checked ? '桌宠已出现在屏幕边缘' : '桌宠已关闭', 'good');
    });

    const state = h('span', { class: `tag ${enabled.checked ? 'tag--good' : ''}` }, enabled.checked ? '运行中' : '默认关闭');
    let custom;
    const builtInButtons = PET_SKINS.map((meta) => {
      const button = h('button', {
        class: `pet-settings__skin ${get('skin', 'study-buddy') === meta.id ? 'is-selected' : ''}`,
        onclick: async () => {
          await save('skin', meta.id);
          for (const candidate of builtInButtons) candidate.classList.toggle('is-selected', candidate === button);
          custom.classList.remove('is-selected');
        },
      },
      h('img', { class: 'pet-settings__preview', src: `../pet/${meta.src}`, alt: `${meta.name}预览` }),
      h('span', {}, meta.name), h('small', {}, meta.note));
      return button;
    });
    custom = h('button', {
      class: `pet-settings__skin ${get('skin', 'study-buddy') === 'custom' ? 'is-selected' : ''}`,
      onclick: async () => {
        const result = await window.toolbox.files.pickPetSkin();
        if (!result) return;
        if (result.error) return toast(result.error, 'bad');
        const fresh = await window.toolbox.pet.getState();
        const preview = h('img', { class: 'pet-settings__preview', src: fresh.settings.customSkin.dataUrl, alt: '本地皮肤预览' });
        custom.replaceChildren(preview, h('span', {}, result.name), h('small', {}, '本地导入'));
        for (const button of builtInButtons) button.classList.remove('is-selected');
        custom.classList.add('is-selected');
        config.cache.pet = fresh.settings;
        toast('本地皮肤已导入', 'good');
      },
    }, get('skin', 'study-buddy') === 'custom' && get('customSkin.dataUrl')
      ? h('img', { class: 'pet-settings__preview', src: get('customSkin.dataUrl'), alt: '本地皮肤预览' })
      : h('span', { class: 'pet-settings__add' }, '+'),
    h('span', {}, get('skin', 'study-buddy') === 'custom' ? get('customSkin.name', '本地皮肤') : '导入本地图片'),
    h('small', {}, 'PNG / WebP / GIF'));

    const rangeRow = (label, key, min, max, step, fallback, format) => {
      const value = h('span', { class: 'pet-settings__value mono' }, format(get(key, fallback)));
      const input = h('input', { type: 'range', min, max, step, value: get(key, fallback) });
      input.addEventListener('input', () => { value.textContent = format(Number(input.value)); });
      input.addEventListener('change', () => save(key, Number(input.value)));
      return h('label', { class: 'pet-settings__range' }, h('span', {}, label), input, value);
    };

    const behavior = (label, hint, key, fallback) => {
      const input = h('input', { type: 'checkbox', class: 'switch__input' });
      input.checked = get(key, fallback);
      input.addEventListener('change', () => save(key, input.checked));
      return h('div', { class: 'settings__row' },
        h('div', {}, h('div', {}, label), h('div', { class: 'faint settings__hint' }, hint)),
        h('label', { class: 'switch' }, input, h('span', { class: 'switch__track' })),
      );
    };

    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '桌宠 · 记忆栈'), state),
      h('div', { class: 'settings__body pet-settings' },
        h('section', { class: 'card pet-settings__hero' },
          h('div', {}, h('div', { class: 'pet-settings__eyebrow' }, 'MEMORY STACK'),
            h('h2', {}, '别让好答案沉到聊天记录底下'),
            h('p', { class: 'faint settings__hint' }, '在 Codex / Claude 里问出了有价值的东西，接着往下问，几十轮后就翻不回去了。点桌宠打开记忆栈，把那几段吃下来，之后靠搜索找回，而不是一路往上滚。原来的四行快速解释挪到了记忆栈右上角的「解释」。')),
          h('label', { class: 'switch switch--large' }, enabled, h('span', { class: 'switch__track' }), h('span', {}, '启用桌宠')),
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '皮肤'),
          h('div', { class: 'pet-settings__skins' }, ...builtInButtons, custom),
          h('p', { class: 'faint settings__hint' }, '只导入你有权使用的素材。建议使用透明背景、主体居中的小尺寸图片；不会联网下载或移植第三方角色。'),
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '显示'),
          rangeRow('大小', 'size', 0.75, 1.3, 0.05, 1, (v) => `${Math.round(v * 100)}%`),
          rangeRow('透明度', 'opacity', 0.4, 1, 0.05, 0.96, (v) => `${Math.round(v * 100)}%`),
          behavior('贴边停靠', '拖动结束后停到最近的屏幕侧边', 'snapToEdge', true),
          behavior('始终置顶', '保持可见；展开知识卡时才占用较大区域', 'alwaysOnTop', true),
        ),
        (() => {
          // 守望：摄像头看眼睛。画面不出电脑；开关、校准、光圈都在这
          const gz = window.toolbox.gaze;
          const card = h('section', { class: 'card', id: 'pet-gaze' }, h('h3', { class: 'card__title' }, '守望 · 用摄像头看你有没有在看屏幕'),
            h('p', { class: 'faint settings__hint' }, '本机跑人脸 478 点模型，画面一帧都不出电脑、不落盘、不开预览窗，只有摄像头旁边那个系统绿灯藏不住。桌宠头上一个小灯：绿在看、黄走神、红看手机 / 不在、蓝眼睛累；走神久了它会说一句。'));
          const body = h('div', {});
          card.append(body);
          let timer = 0;
          async function render() {
            const s = await gz.status();
            const cam = await gz.cameraStatus();
            const fmt = (sec) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} 小时` : sec >= 60 ? `${Math.round(sec / 60)} 分钟` : `${sec} 秒`);
            const t = s.today || {};
            body.replaceChildren(
              h('div', { class: 'settings__row' }, h('div', {}, h('div', {}, '开启守望'), h('div', { class: 'faint settings__hint' }, s.enabled ? (s.ready ? `摄像头就绪 · 现在：${s.stateLabel || '…'}` : s.cameraError ? `摄像头打不开：${s.cameraError}` : '正在打开摄像头…') : '关着')),
                h('label', { class: 'switch' }, h('input', { type: 'checkbox', class: 'switch__input', checked: s.enabled, onchange: async (e) => { await gz.setEnabled(e.target.checked); setTimeout(render, 1500); } }), h('span', { class: 'switch__track' }))),
              h('div', { class: 'settings__row' }, h('div', {}, h('div', {}, '视线光圈'), h('div', { class: 'faint settings__hint' }, s.calibrated ? `已校准（${new Date(s.calibratedAt).toLocaleDateString('zh-CN')}，误差约 ${s.errorPx} 像素）。屏幕上一个光圈跟着你的视线走。` : '还没校准。校准前光圈不会出现。')),
                h('label', { class: 'switch' }, h('input', { type: 'checkbox', class: 'switch__input', checked: s.haloOn, onchange: (e) => gz.setHalo(e.target.checked) }), h('span', { class: 'switch__track' }))),
              h('div', { class: 'settings__row' }, h('div', {}, h('div', {}, '校准视线（13 个点，约 40 秒）'), h('div', { class: 'faint settings__hint' }, '换了坐姿、屏幕角度或者觉得光圈偏了就重做一次。摄像头视线估计的极限大约 1.5～3 度，光圈就是那么大，不会精确到某一行字。')),
                h('div', { class: 'pet-gaze__btns' }, h('button', { class: 'btn btn--sm btn--primary', onclick: async () => { await gz.calibrate(); } }, s.calibrated ? '重新校准' : '开始校准'), s.calibrated ? h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => { await gz.clearModel(); render(); } }, '清掉') : null)),
              h('div', { class: 'faint settings__hint' }, `今天：在看 ${fmt(t.looking || 0)} · 走神 ${fmt(t.distracted || 0)} · 看手机 ${fmt(t.phone || 0)} · 不在 ${fmt(t.away || 0)} · 眼睛累 ${fmt(t.tired || 0)}`),
              cam.system && cam.system !== 'granted' && cam.system !== 'n/a' ? h('div', { class: 'faint settings__hint' }, `系统摄像头权限：${cam.system}。第一次开会弹系统询问，选「允许」；拒绝过的话去 系统设置 → 隐私与安全性 → 摄像头 里勾上工具箱。`) : null,
            );
          }
          render();
          timer = setInterval(() => { if (card.isConnected && card.offsetParent !== null) render(); }, 4000);
          card.addEventListener('DOMNodeRemoved', () => clearInterval(timer));
          return card;
        })(),

        h('section', { class: 'card pet-settings__how' },
          h('h3', { class: 'card__title' }, '快捷操作'),
          h('p', { class: 'faint settings__hint' }, '在任何应用里选中一段代码或一句话，按 ⌘⇧L，桌宠直接弹出四行解释 —— 学代码最常用的一下。'),
          h('ol', {},
            h('li', {}, h('b', {}, '工具箱不见了'), h('span', {}, '双击桌宠就叫回来；右键桌宠有菜单（打开工具箱 / 今天 / 任务 / 守望开关 / 隐藏桌宠）。菜单栏图标、Dock 图标、⌥⇧A 也都行。')),
            h('li', {}, h('b', {}, '从会话里吃'), h('span', {}, '直接读本机的 Codex / Claude 会话记录，勾中哪几段就吃哪几段，不用复制粘贴。')),
            h('li', {}, h('b', {}, '吃剪贴板'), h('span', {}, '任何地方复制的内容都能吃，来源记作「剪贴板」。')),
            h('li', {}, h('b', {}, '之后用搜索找回'), h('span', {}, '标题、正文、批注一起搜——这就是它替代「往上翻」的地方。')),
            h('li', {}, h('b', {}, '收进笔记'), h('span', {}, '当前筛选出的条目一次性导出成 markdown 片段。')),
          ),
        ),
      ),
    );
    return {};
  },
};
