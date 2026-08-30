/**
 * 预置的学习网站库。选的标准：官方文档 > 公认经典教程 > 个人博客。
 * 「AI 找站」抓回来的和你自己加的，都存在 config 的 study.sites 里，和这份合并。
 */
export const BUILTIN_SITES = [
  // ---- 算法 ----
  { domain: 'algorithms', name: 'LeetCode', url: 'https://leetcode.cn/problemset/', note: '刷题主战场，按标签和公司筛题' },
  { domain: 'algorithms', name: 'Hello 算法', url: 'https://www.hello-algo.com/', note: '开源中文动画图解，入门期最省力的一本' },
  { domain: 'algorithms', name: 'labuladong 算法笔记', url: 'https://labuladong.online/algo/', note: '框架思维，模板讲得最清楚的中文资料' },
  { domain: 'algorithms', name: 'OI Wiki', url: 'https://oi-wiki.org/', note: '竞赛向的算法百科，深度和覆盖面最好' },
  { domain: 'algorithms', name: 'VisuAlgo', url: 'https://visualgo.net/zh', note: '算法动画可视化，理解排序和树结构很直观' },

  // ---- 设计模式 / 工程 ----
  { domain: 'patterns', name: 'Refactoring Guru', url: 'https://refactoringguru.cn/design-patterns', note: '设计模式中文版，图 + 多语言代码，公认最好' },
  { domain: 'patterns', name: 'Python 设计模式', url: 'https://python-patterns.guide/', note: 'Brandon Rhodes 写的，重点讲"Python 里哪些模式不需要"' },
  { domain: 'patterns', name: 'Martin Fowler', url: 'https://martinfowler.com/', note: '重构、微服务、架构模式的源头' },
  { domain: 'patterns', name: 'Google 工程实践', url: 'https://google.github.io/eng-practices/', note: 'Code Review 标准，写给评审者也写给作者' },

  // ---- Python ----
  { domain: 'python', name: 'Python 官方文档（中文）', url: 'https://docs.python.org/zh-cn/3/', note: '标准库部分建议通读一遍目录' },
  { domain: 'python', name: 'Real Python', url: 'https://realpython.com/', note: '英文教程质量最稳的一家' },
  { domain: 'python', name: 'PEP 索引', url: 'https://peps.python.org/', note: 'PEP 8 风格、PEP 484 类型注解、PEP 20 之禅' },
  { domain: 'python', name: 'Python Cookbook 3（中文）', url: 'https://python3-cookbook.readthedocs.io/zh-cn/latest/', note: '按问题查解法，比从头读教程高效' },

  // ---- 深度学习 / Transformer ----
  { domain: 'transformer', name: 'The Illustrated Transformer', url: 'https://jalammar.github.io/illustrated-transformer/', note: '图解 Transformer，几乎所有人的入门第一篇' },
  { domain: 'transformer', name: 'The Annotated Transformer', url: 'https://nlp.seas.harvard.edu/annotated-transformer/', note: '哈佛的逐行代码注解版，边读论文边看实现' },
  { domain: 'transformer', name: '动手学深度学习 d2l', url: 'https://zh.d2l.ai/', note: '李沐的书，中文 + 可运行代码，体系最完整' },
  { domain: 'transformer', name: 'Hugging Face 课程', url: 'https://huggingface.co/learn/nlp-course/zh-CN/chapter1/1', note: '从用到训，工程链路讲得最全' },
  { domain: 'transformer', name: 'Karpathy: Let us build GPT', url: 'https://karpathy.ai/zero-to-hero.html', note: '从零手写 GPT，看完对细节的理解会上一个台阶' },
  { domain: 'transformer', name: 'PyTorch 官方文档', url: 'https://pytorch.org/docs/stable/index.html', note: 'API 以它为准，教程区也值得刷' },

  // ---- 搜广推 ----
  { domain: 'recsys', name: 'Papers with Code · RecSys', url: 'https://paperswithcode.com/task/recommendation-systems', note: '找 SOTA 和开源实现' },
  { domain: 'recsys', name: 'RecBole', url: 'https://recbole.io/', note: '推荐算法统一实现库，读源码学模型结构很方便' },
  { domain: 'recsys', name: 'Google 推荐系统课程', url: 'https://developers.google.com/machine-learning/recommendation', note: '召回/排序/重排的标准框架' },
  { domain: 'recsys', name: 'EasyRec（阿里）', url: 'https://easyrec.readthedocs.io/', note: '工业级推荐框架，能看到真实生产的做法' },
  { domain: 'recsys', name: 'arXiv cs.IR', url: 'https://arxiv.org/list/cs.IR/recent', note: '信息检索/推荐的最新论文' },

  // ---- 前端 / 通用 ----
  { domain: 'general', name: 'MDN Web Docs', url: 'https://developer.mozilla.org/zh-CN/', note: 'Web 相关的唯一权威' },
  { domain: 'general', name: 'JavaScript.info', url: 'https://zh.javascript.info/', note: '现代 JS 教程，比很多书讲得清楚' },
  { domain: 'general', name: 'GitHub Trending', url: 'https://github.com/trending', note: '看现在大家在做什么' },
  { domain: 'general', name: 'System Design Primer', url: 'https://github.com/donnemartin/system-design-primer', note: '系统设计面试的公认起点' },
];

export const DOMAIN_LABELS = {
  algorithms: '算法',
  patterns: '设计模式 / 工程',
  python: 'Python',
  transformer: 'Transformer / 深度学习',
  recsys: '搜广推',
  general: '通用 / 前端',
  custom: '我加的',
};
