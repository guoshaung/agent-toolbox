import { createSiteGrid } from '../../core/sitegrid.js';

const PRESET_SITES = [
  { name: '玻尔 Bohrium', url: 'https://www.bohrium.com', desc: '科研空间站 · AI4S 平台', emoji: '🔬' },
  { name: '掌桥科研', url: 'https://www.zhangqiaokeyan.com', desc: 'AI 毕业论文写作 / 查重', emoji: '🎓' },
  { name: '纳米 AI', url: 'https://www.n.cn', desc: '360 纳米 AI 搜索', emoji: '🔍' },
  { name: '当贝 AI', url: 'https://ai.dangbei.com', desc: '当贝 AI 助手', emoji: '🤖' },
  { name: '讯飞星火', url: 'https://xinghuo.xfyun.cn', desc: '讯飞星火大模型', emoji: '✨' },
];

/** 门户：科研/AI 网站格子铺。实现抽在 core/sitegrid.js，这里只留预置站点和配置键。 */
export function createPortal(root, ctx) {
  createSiteGrid(root, {
    presets: PRESET_SITES,
    configKey: 'research.sites',
    cachePrefix: 'research.favicons.',
    partition: 'persist:research',
    config: ctx.config,
  });
}
