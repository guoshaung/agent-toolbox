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
        h('section', { class: 'card pet-settings__how' },
          h('h3', { class: 'card__title' }, '快捷操作'),
          h('ol', {},
            h('li', {}, h('b', {}, '从会话里吃'), h('span', {}, '直接读本机的 Codex / Claude 会话记录，勾中哪几段就吃哪几段，不用复制粘贴。')),
            h('li', {}, h('b', {}, '吃剪贴板'), h('span', {}, '任何地方复制的内容都能吃，来源记作「剪贴板」。')),
            h('li', {}, h('b', {}, '之后用搜索找回'), h('span', {}, '标题、正文、批注一起搜——这就是它替代「往上翻」的地方。')),
            h('li', {}, h('b', {}, '收进记事本'), h('span', {}, '当前筛选出的条目一次性导出成 markdown 片段。')),
          ),
        ),
      ),
    );
    return {};
  },
};
