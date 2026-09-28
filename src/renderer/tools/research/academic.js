import { createSiteGrid } from '../../core/sitegrid.js';
import { createResearchBrowser } from './browser.js';
import { h, toast } from '../../core/ui.js';

// 分组：让入口按用途切开，别堆成一坨
const ACADEMIC_CATEGORIES = [
  { id: 'graph', label: '🕸️ 引用图谱 · 相关发现' },
  { id: 'general', label: '🔍 综合检索' },
  { id: 'cn', label: '📚 中文文献' },
  { id: 'domain', label: '🧬 专业库' },
];

const ACADEMIC_SITES = [
  // 论文之间的「直接联系」——引用关系图谱 / 相关论文发现，几家比较权威的（放最前，最常用）
  { name: 'Connected Papers', url: 'https://www.connectedpapers.com/', desc: '一篇论文→相关论文关系图谱', emoji: '🕸️', category: 'graph' },
  { name: 'Research Rabbit', url: 'https://www.researchrabbit.ai/', desc: '引用网络 + 文献推荐', emoji: '🐇', category: 'graph' },
  { name: 'Litmaps', url: 'https://www.litmaps.com/', desc: '交互式引文地图', emoji: '🗺️', category: 'graph' },
  { name: 'Inciteful', url: 'https://inciteful.xyz/', desc: '引文网络分析 / 找关键论文', emoji: '🔬', category: 'graph' },
  { name: 'scite', url: 'https://scite.ai/', desc: '引用语境（支持/反驳）', emoji: '💬', category: 'graph' },
  // 综合检索
  { name: 'Google Scholar', url: 'https://scholar.google.com/', desc: '学术论文检索', emoji: '🎓', category: 'general' },
  { name: 'Semantic Scholar', url: 'https://www.semanticscholar.org/', desc: 'AI 学术搜索', emoji: '🧠', category: 'general' },
  { name: 'OpenAlex', url: 'https://openalex.org/', desc: '开放学术图谱', emoji: '🌐', category: 'general' },
  { name: 'Crossref', url: 'https://search.crossref.org/', desc: 'DOI / 出版物检索', emoji: '🔗', category: 'general' },
  { name: 'CORE', url: 'https://core.ac.uk/', desc: '开放获取论文', emoji: '🟢', category: 'general' },
  // 中文文献
  { name: '中国知网', url: 'https://www.cnki.net/', desc: '中文期刊 / 学位论文', emoji: '📚', category: 'cn' },
  { name: '维普', url: 'https://www.cqvip.com/', desc: '中文科技期刊', emoji: '🔎', category: 'cn' },
  { name: '万方数据', url: 'https://www.wanfangdata.com.cn/', desc: '中文学术资源', emoji: '🗃️', category: 'cn' },
  // 专业库
  { name: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/', desc: '医学 / 生物医学', emoji: '🧬', category: 'domain' },
];

export function createAcademic(root, ctx) {
  // 自动检索总有够不着的地方，得能自己翻。抓到了直接入库，不用复制粘贴。
  const browser = createResearchBrowser({
    onGrab: (result, info) => {
      const meta = result.best || {};
      const line = [meta.title, meta.year, meta.journal].filter(Boolean).join(' · ');
      if (result.ambiguous) {
        toast(`⚠️ 有 ${result.sameNameCount} 篇同名文献，去「文献库」里挑一下再入库：${line}`, 'warn', 6000);
      } else if (result.exact || result.autoImport) {
        toast(`已识别：${line}`, 'good', 5000);
      } else {
        toast(`找到（相似 ${result.score}）：${line}　不确定就去文献库核对`, 'info', 6000);
      }
      window.toolbox.clipboard.write(JSON.stringify(meta, null, 2));
    },
  });

  const openBtn = (which, label, hint) => h('button', {
    class: 'academic__browser-btn',
    onclick: () => { browser.open(which); grid.hidden = true; backBtn.hidden = false; },
  }, h('strong', {}, label), h('span', { class: 'faint' }, hint));

  const backBtn = h('button', {
    class: 'btn btn--sm', hidden: true,
    onclick: () => { browser.close(); grid.hidden = false; backBtn.hidden = true; },
  }, '← 回到入口列表');

  const bar = h('div', { class: 'bar academic__top' },
    h('span', { class: 'faint' }, '找不到就自己翻：'),
    openBtn('chrome', 'Chrome', '独立登录态'),
    openBtn('edge', 'Edge', '可同步本机 Edge 登录'),
    h('span', { style: { flex: 1 } }),
    backBtn,
  );

  const grid = h('div', { class: 'academic__grid' });
  root.append(bar, browser.root, grid);

  createSiteGrid(grid, {
    presets: ACADEMIC_SITES,
    configKey: 'research.academicSites',
    cachePrefix: 'research.academicFavicons.',
    partition: 'persist:research',
    config: ctx.config,
    categories: ACADEMIC_CATEGORIES,
  });
}
