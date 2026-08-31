import { h, toast } from '../../core/ui.js';
import { PET_SKINS } from '../../../pet/skins.js';

export default {
  id: 'pet',
  title: '桌宠',
  icon: '◉',
  hint: '代码读不懂时，打开四行快速解释',

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
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '桌宠 · 快速解释'), state),
      h('div', { class: 'settings__body pet-settings' },
        h('section', { class: 'card pet-settings__hero' },
          h('div', {}, h('div', { class: 'pet-settings__eyebrow' }, 'CODE READING · CURRENT LAYER'),
            h('h2', {}, '只在卡住的那一刻出现'),
            h('p', { class: 'faint settings__hint' }, '先看懂整体框架。函数、语法或跳转确实看不懂时，复制代码并点桌宠；它只给四行，不把你带进新的信息迷宫。')),
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
            h('li', {}, h('b', {}, '复制代码'), h('span', {}, '桌宠打开时优先读取剪贴板，也可直接粘贴。')),
            h('li', {}, h('b', {}, '点击桌宠'), h('span', {}, '填写可选语言和一行“我卡在哪里”，获取固定四行解释。')),
            h('li', {}, h('b', {}, '向上一层追溯'), h('span', {}, '只在你点击后才扩展；未提供定义时不会猜项目链路。')),
          ),
        ),
      ),
    );
    return {};
  },
};
