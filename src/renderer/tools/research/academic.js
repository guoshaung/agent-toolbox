import { createSiteGrid } from '../../core/sitegrid.js';

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
  createSiteGrid(root, {
    presets: ACADEMIC_SITES,
    configKey: 'research.academicSites',
    cachePrefix: 'research.academicFavicons.',
    partition: 'persist:research',
    config: ctx.config,
  });
}
