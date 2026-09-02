import { h, toast } from '../../core/ui.js';
import { createSiteGrid } from '../../core/sitegrid.js';

const SCHOOL_LIBRARIES = [
  { name: '华中师范大学', url: 'https://lib.ccnu.edu.cn/', desc: '官方图书馆入口', emoji: '🏫' },
  { name: '上海第二工业大学', url: 'https://library.sspu.edu.cn/', desc: '官方图书馆入口', emoji: '🏫' },
  { name: '哈尔滨工业大学', url: 'https://lib.hit.edu.cn/', desc: '官方图书馆 / 数据库', emoji: '🏛️' },
  { name: '香港中文大学', url: 'https://www.lib.cuhk.edu.hk/sc/', desc: '官方图书馆 / 电子资源', emoji: '🌏' },
];

export function createSchools(root, ctx) {
  const intro = h('div', { class: 'research__school-intro' },
    h('div', {},
      h('strong', {}, '学校访问'),
      h('p', { class: 'faint' }, '点击学校图标进入官方图书馆。需要校内权限时，请先用学校提供的 VPN / EasyConnect 正常连接，再在这里打开资源。'),
    ),
    h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        const result = await window.toolbox.shell.openEasyConnect();
        toast(result.ok ? '已打开 EasyConnect，请在官方客户端中完成连接。' : result.error, result.ok ? 'good' : 'bad', 5000);
      },
    }, '打开 EasyConnect'),
  );
  root.appendChild(intro);
  createSiteGrid(root, {
    presets: SCHOOL_LIBRARIES,
    configKey: 'research.schoolLibraries',
    cachePrefix: 'research.schoolFavicons.',
    partition: 'persist:research',
    config: ctx.config,
  });
}
