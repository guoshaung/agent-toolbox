import { createSiteGrid } from '../../core/sitegrid.js';
import { createResearchBrowser } from './browser.js';
import { h, toast } from '../../core/ui.js';

const ACADEMIC_SITES = [
  { name: 'Google Scholar', url: 'https://scholar.google.com/', desc: '学术论文检索', emoji: '🎓' },
  { name: '中国知网', url: 'https://www.cnki.net/', desc: '中文期刊 / 学位论文', emoji: '📚' },
  { name: '维普', url: 'https://www.cqvip.com/', desc: '中文科技期刊', emoji: '🔎' },
  { name: '万方数据', url: 'https://www.wanfangdata.com.cn/', desc: '中文学术资源', emoji: '🗃️' },
  { name: 'OpenAlex', url: 'https://openalex.org/', desc: '开放学术图谱', emoji: '🌐' },
  { name: 'Semantic Scholar', url: 'https://www.semanticscholar.org/', desc: 'AI 学术搜索', emoji: '🧠' },
  { name: 'arXiv', url: 'https://arxiv.org/', desc: '预印本论文', emoji: '📄' },
  { name: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/', desc: '医学 / 生物医学', emoji: '🧬' },
  { name: 'Crossref', url: 'https://search.crossref.org/', desc: 'DOI / 出版物检索', emoji: '🔗' },
  { name: 'CORE', url: 'https://core.ac.uk/', desc: '开放获取论文', emoji: '🟢' },
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
  });
}
