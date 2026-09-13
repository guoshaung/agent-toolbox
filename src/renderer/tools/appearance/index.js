import { h, toast } from '../../core/ui.js';
import { THEMES, EFFECTS, applyTheme, applyEffect, applyStoredTheme, applyStoredEffect } from '../../core/themes.js';
import { LOGOS, applyLogo, applyAppIcon } from '../../core/logos.js';

export default {
  id: 'appearance',
  title: '皮肤',
  icon: 'palette',
  hint: '主题与侧栏 logo 切换，即时生效并自动保存',

  create(root, ctx) {
    const { config } = ctx;
    applyStoredTheme(config);
    const currentTheme = config.get('ui.theme', 'default');

    const themeCards = h('div', { class: 'appearance__grid' }, ...THEMES.map((theme) => {
      const swatches = h('div', { class: 'appearance__swatches' },
        ...theme.swatches.map((color) => h('span', { class: 'appearance__swatch', style: { background: color } })));
      const card = h('button', { class: 'appearance__theme' },
        h('span', { class: 'appearance__theme-name' }, theme.name),
        h('span', { class: 'faint appearance__theme-desc' }, theme.desc),
        swatches,
      );
      if (theme.id === currentTheme) card.classList.add('is-active');
      card.addEventListener('click', async () => {
        applyTheme(theme.id);
        await config.set('ui.theme', theme.id);
        for (const other of themeCards.children) other.classList.toggle('is-active', other === card);
        toast(`已切换到「${theme.name}」主题`, 'good');
      });
      return card;
    }));

    const logoGrid = h('div', { class: 'appearance__grid' }, ...LOGOS.map((logo) => {
      const card = h('button', { class: 'appearance__logo', title: logo.name },
        h('span', { class: 'appearance__logo-svg', html: logo.svg }));
      if (logo.id === config.get('ui.logo', 'prism-core')) card.classList.add('is-active');
      card.addEventListener('click', async () => {
        applyLogo(logo.id);
        await config.set('ui.logo', logo.id);
        applyAppIcon(logo.id).catch((error) => toast(`应用图标更新失败：${error.message}`, 'bad'));
        for (const other of logoGrid.children) other.classList.toggle('is-active', other === card);
        toast(`侧栏 logo 与应用图标已换成「${logo.name}」`, 'good');
      });
      return card;
    }));

    const currentEffect = config.get('ui.effect', 'glass');
    const effectGrid = h('div', { class: 'appearance__grid' }, ...EFFECTS.map((effect) => {
      const card = h('button', { class: 'appearance__effect' },
        h('span', { class: 'appearance__effect-name' }, effect.name),
        h('span', { class: 'faint appearance__effect-desc' }, effect.desc),
      );
      if (effect.id === currentEffect) card.classList.add('is-active');
      card.addEventListener('click', async () => {
        applyEffect(effect.id);
        await config.set('ui.effect', effect.id);
        for (const other of effectGrid.children) other.classList.toggle('is-active', other === card);
        toast(`已切换为「${effect.name}」效果`, 'good');
      });
      return card;
    }));

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '皮肤'),
        h('span', { class: 'faint' }, '主题、质感效果与标记，即时生效'),
      ),
      h('div', { class: 'settings__body' },
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '主题'),
          h('p', { class: 'faint settings__hint' }, '主题只改变颜色变量，不影响布局与功能；切换后立即应用到整个工具箱。'),
          themeCards,
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '外观效果'),
          h('p', { class: 'faint settings__hint' }, '与主题正交的质感层：磨砂玻璃让卡片与工具条半透明并模糊背景；极光叠加流动光斑；霓虹开启辉光与发光边框。'),
          effectGrid,
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '侧栏 logo 与应用图标'),
          h('p', { class: 'faint settings__hint' }, '选择标记样式：侧栏顶部、窗口/任务栏（macOS 上还包括 Dock）图标会一起切换，点击即时生效。'),
          logoGrid,
        ),
      ),
    );

    return {};
  },
};
