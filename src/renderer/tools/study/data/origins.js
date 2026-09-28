/** 英文原文来源：按模块 id 归组；_general 是通用的。level: 入门 | 进阶 | 参考 */
export const ORIGINS = {
  algorithms: [
    { topic: '排序 / 数据结构', name: 'CLRS: Introduction to Algorithms (MIT Press)', url: 'https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/', note: '算法教材的"圣经"，几乎所有课程和面试题都从这本书出来。', level: '参考' },
    { topic: '复杂度 / 大 O', name: 'Big-O Cheat Sheet', url: 'https://www.bigocheatsheet.com/', note: '一页纸对照常见数据结构和排序的时间/空间复杂度，查表用。', level: '入门' },
    { topic: '算法可视化', name: 'VisuAlgo', url: 'https://visualgo.net/en', note: '新加坡国立大学做的动画演示，看排序、图、树怎么一步步动。', level: '入门' },
    { topic: '动态规划 / 图', name: 'Algorithms (Jeff Erickson, free)', url: 'https://jeffe.cs.illinois.edu/teaching/algorithms/', note: 'UIUC 教授免费公开的算法书，讲递归和 DP 特别清楚。', level: '进阶' },
    { topic: 'Python 内置排序', name: 'Python Sorting HOW TO', url: 'https://docs.python.org/3/howto/sorting.html', note: 'Python 官方讲 sorted / key / 稳定排序的原文。', level: '入门' },
  ],

  patterns: [
    { topic: '设计模式总览', name: 'Refactoring.Guru: Design Patterns', url: 'https://refactoring.guru/design-patterns', note: '目前最好读的模式教程，每个模式有图、有问题描述、有多语言代码。', level: '入门' },
    { topic: 'GoF 原书', name: 'Design Patterns: Elements of Reusable Object-Oriented Software', url: 'https://en.wikipedia.org/wiki/Design_Patterns', note: '1994 年"四人帮"原书，23 个模式的出处。读起来硬，当字典查；此页有原书信息和各模式链接。', level: '参考' },
    { topic: 'Python 视角', name: 'Python Patterns (Brandon Rhodes)', url: 'https://python-patterns.guide/', note: 'Python 核心圈作者写的，讲哪些 GoF 模式在 Python 里可以简化。', level: '进阶' },
    { topic: '重构 / 坏味道', name: 'Refactoring.Guru: Code Smells', url: 'https://refactoring.guru/refactoring/smells', note: '先认坏味道，再选模式。这页列了所有常见坏味道。', level: '入门' },
    { topic: 'Wikipedia', name: 'Software design pattern', url: 'https://en.wikipedia.org/wiki/Software_design_pattern', note: '模式的分类和历史，术语对照用。', level: '参考' },
  ],

  'patterns-practice': [
    { topic: '按场景选模式', name: 'Refactoring.Guru: Design Patterns Catalog', url: 'https://refactoring.guru/design-patterns/catalog', note: '每个模式页都有"适用场景"一节，练"什么情况用什么"就看这一节。', level: '入门' },
    { topic: '重构手法', name: 'Refactoring (Martin Fowler)', url: 'https://refactoring.com/', note: '从烂代码到模式的中间步骤（提取方法、替换条件为多态）在这本书。', level: '进阶' },
    { topic: '替换条件为多态', name: 'Replace Conditional with Polymorphism', url: 'https://refactoring.guru/replace-conditional-with-polymorphism', note: '"一堆 if/else 按类型分支"该怎么改，就是这一条。', level: '入门' },
    { topic: '反模式 / 过度设计', name: 'Wikipedia: Anti-pattern', url: 'https://en.wikipedia.org/wiki/Anti-pattern', note: '知道什么时候不该上模式，和知道模式一样重要。', level: '参考' },
  ],

  transformer: [
    { topic: 'Transformer 原论文', name: 'Attention Is All You Need (arXiv 1706.03762)', url: 'https://arxiv.org/abs/1706.03762', note: '2017 年 Google 原论文，Transformer 的出处。', level: '参考' },
    { topic: '图解', name: 'The Illustrated Transformer (Jay Alammar)', url: 'https://jalammar.github.io/illustrated-transformer/', note: '全网最出名的图解，先看这个再看论文。', level: '入门' },
    { topic: '带代码逐行讲', name: 'The Annotated Transformer (Harvard NLP)', url: 'https://nlp.seas.harvard.edu/annotated-transformer/', note: '把论文每一段配上 PyTorch 代码，能跑。', level: '进阶' },
    { topic: 'GPT 结构', name: 'The Illustrated GPT-2 (Jay Alammar)', url: 'https://jalammar.github.io/illustrated-gpt2/', note: '只用 decoder 的 Transformer 长什么样，看这篇。', level: '入门' },
    { topic: '手写实现', name: 'nanoGPT (Karpathy)', url: 'https://github.com/karpathy/nanoGPT', note: '几百行代码从零训一个 GPT，读代码比读论文直观。', level: '进阶' },
    { topic: 'Attention 机制起源', name: 'Neural Machine Translation by Jointly Learning to Align and Translate (arXiv 1409.0473)', url: 'https://arxiv.org/abs/1409.0473', note: 'Bahdanau 2014，attention 这个概念最早的论文。', level: '参考' },
  ],

  recsys: [
    { topic: '推荐系统入门', name: 'Google ML: Recommendation Systems', url: 'https://developers.google.com/machine-learning/recommendation', note: 'Google 官方免费课程，召回/排序/embedding 讲得最系统。', level: '入门' },
    { topic: '协同过滤', name: 'Google ML: Collaborative Filtering', url: 'https://developers.google.com/machine-learning/recommendation/collaborative-filtering', note: 'Google 课程里专讲协同过滤和矩阵分解的一节。', level: '入门' },
    { topic: 'YouTube 双塔', name: 'Deep Neural Networks for YouTube Recommendations', url: 'https://research.google/pubs/pub45530/', note: '2016 年 Google 论文，工业界"召回 + 排序"两阶段架构的范本。', level: '进阶' },
    { topic: 'Wide & Deep', name: 'Wide & Deep Learning for Recommender Systems (arXiv 1606.07792)', url: 'https://arxiv.org/abs/1606.07792', note: '记忆 + 泛化结合，很多排序模型的起点。', level: '进阶' },
    { topic: '总览', name: 'Wikipedia: Recommender system', url: 'https://en.wikipedia.org/wiki/Recommender_system', note: '术语总览，每种方法都有原始论文的引用。', level: '参考' },
  ],

  'llm-security': [
    { topic: 'LLM 应用十大风险', name: 'OWASP Top 10 for LLM Applications', url: 'https://genai.owasp.org/llm-top-10/', note: 'OWASP 官方，提示注入、数据泄露等十大风险的权威清单。', level: '入门' },
    { topic: '提示注入', name: 'Prompt injection explained (Simon Willison)', url: 'https://simonwillison.net/series/prompt-injection/', note: '"提示注入"这个词就是他起的，系列文章讲得最清楚。', level: '入门' },
    { topic: '越狱研究', name: 'Universal and Transferable Adversarial Attacks on Aligned Language Models (arXiv 2307.15043)', url: 'https://arxiv.org/abs/2307.15043', note: '2023 年经典越狱论文，自动生成对抗后缀。', level: '进阶' },
    { topic: 'AI 风险框架', name: 'NIST AI Risk Management Framework', url: 'https://www.nist.gov/itl/ai-risk-management-framework', note: '美国标准局的 AI 风险管理框架，合规文档常引用。', level: '参考' },
    { topic: '安全评估', name: 'MITRE ATLAS', url: 'https://atlas.mitre.org/', note: '对 AI 系统的攻击手法知识库，类似 ATT&CK。', level: '参考' },
  ],

  middleware: [
    { topic: 'Redis', name: 'Redis Documentation', url: 'https://redis.io/docs/latest/', note: 'Redis 官方文档，数据类型、持久化、集群都在这。', level: '入门' },
    { topic: 'Kafka', name: 'Apache Kafka Documentation', url: 'https://kafka.apache.org/documentation/', note: 'Kafka 官方文档，"Design" 一章讲为什么这么设计。', level: '进阶' },
    { topic: 'RabbitMQ', name: 'RabbitMQ Tutorials', url: 'https://www.rabbitmq.com/tutorials', note: 'RabbitMQ 官方六个教程，从 Hello World 到 RPC。', level: '入门' },
    { topic: '消息队列原理', name: 'Designing Data-Intensive Applications (Kleppmann)', url: 'https://dataintensive.net/', note: '"DDIA"，讲分布式数据系统的经典，消息队列在第 11 章。', level: '参考' },
    { topic: 'Nginx', name: 'NGINX Documentation', url: 'https://nginx.org/en/docs/', note: 'Nginx 官方文档，反向代理和负载均衡配置的原文。', level: '入门' },
    { topic: 'MySQL', name: 'MySQL 8.0 Reference Manual', url: 'https://dev.mysql.com/doc/refman/8.0/en/', note: 'MySQL 官方手册，索引、事务、锁的权威解释。', level: '参考' },
  ],

  'math-notation': [
    { topic: '数学符号表', name: 'Wikipedia: Glossary of mathematical symbols', url: 'https://en.wikipedia.org/wiki/Glossary_of_mathematical_symbols', note: '看论文遇到不认识的符号，先查这页。', level: '入门' },
    { topic: '希腊字母', name: 'Wikipedia: Greek letters used in mathematics', url: 'https://en.wikipedia.org/wiki/Greek_letters_used_in_mathematics,_science,_and_engineering', note: 'α β γ σ 在不同领域各代表什么。', level: '入门' },
    { topic: '线性代数', name: 'Linear Algebra (MIT OCW 18.06, Gilbert Strang)', url: 'https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/', note: 'Strang 的公开课，矩阵、向量、特征值最好的入门。', level: '进阶' },
    { topic: '机器学习数学', name: 'Mathematics for Machine Learning (free book)', url: 'https://mml-book.github.io/', note: '免费公开的书，专门讲 ML 用到的数学。', level: '进阶' },
    { topic: '深度学习数学', name: 'Deep Learning (Goodfellow, Bengio, Courville)', url: 'https://www.deeplearningbook.org/', note: '"花书"，前几章是数学基础，免费在线。', level: '参考' },
  ],

  oop: [
    { topic: 'Python 类', name: 'Python Tutorial: Classes', url: 'https://docs.python.org/3/tutorial/classes.html', note: 'Python 官方教程讲类、继承、私有变量的原文。', level: '入门' },
    { topic: '数据模型 / 魔法方法', name: 'Python Data Model', url: 'https://docs.python.org/3/reference/datamodel.html', note: '__init__ __new__ __repr__ 这些下划线方法的官方定义。', level: '参考' },
    { topic: 'dataclass', name: 'Python dataclasses', url: 'https://docs.python.org/3/library/dataclasses.html', note: '少写样板代码的官方方案。', level: '入门' },
    { topic: '抽象基类', name: 'Python abc module', url: 'https://docs.python.org/3/library/abc.html', note: '接口 / 抽象类在 Python 里怎么写。', level: '进阶' },
    { topic: 'SOLID 原则', name: 'Wikipedia: SOLID', url: 'https://en.wikipedia.org/wiki/SOLID', note: '面向对象五大原则的总览，每条都有出处链接。', level: '参考' },
    { topic: '深入', name: 'Fluent Python (Luciano Ramalho)', url: 'https://www.fluentpython.com/', note: 'Python 面向对象和数据模型讲得最透的书。', level: '进阶' },
  ],

  concurrency: [
    { topic: '线程', name: 'Python threading', url: 'https://docs.python.org/3/library/threading.html', note: 'Python 官方线程文档，Lock、Event、Condition 都在这。', level: '入门' },
    { topic: '协程', name: 'Python asyncio', url: 'https://docs.python.org/3/library/asyncio.html', note: 'Python 官方 asyncio 文档，async/await 的原文。', level: '入门' },
    { topic: '并发 vs 并行', name: 'Concurrency is not Parallelism (Rob Pike)', url: 'https://go.dev/blog/waza-talk', note: 'Go 作者的著名演讲，把两个词彻底讲清楚。', level: '入门' },
    { topic: 'GIL', name: 'Python Glossary: global interpreter lock', url: 'https://docs.python.org/3/glossary.html#term-global-interpreter-lock', note: 'GIL 的官方定义，为什么 Python 多线程跑不满多核。', level: '参考' },
    { topic: '多进程', name: 'Python multiprocessing', url: 'https://docs.python.org/3/library/multiprocessing.html', note: '绕过 GIL 用多进程的官方文档。', level: '进阶' },
    { topic: '线程池', name: 'Python concurrent.futures', url: 'https://docs.python.org/3/library/concurrent.futures.html', note: '最省事的并发写法，ThreadPoolExecutor / ProcessPoolExecutor。', level: '入门' },
  ],

  cuda: [
    { topic: 'CUDA 编程', name: 'CUDA C++ Programming Guide', url: 'https://docs.nvidia.com/cuda/cuda-c-programming-guide/', note: 'NVIDIA 官方，kernel、线程层次、内存模型的原文。', level: '参考' },
    { topic: '性能优化', name: 'CUDA C++ Best Practices Guide', url: 'https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/', note: 'NVIDIA 官方，合并访存、占用率、bank conflict 怎么优化。', level: '进阶' },
    { topic: '入门', name: 'An Even Easier Introduction to CUDA (NVIDIA blog)', url: 'https://developer.nvidia.com/blog/even-easier-introduction-cuda/', note: 'NVIDIA 官方博客，第一个 CUDA 程序从这里开始。', level: '入门' },
    { topic: 'PyTorch 里的 CUDA', name: 'PyTorch CUDA semantics', url: 'https://pytorch.org/docs/stable/notes/cuda.html', note: '在 PyTorch 里 device、stream、显存管理怎么回事。', level: '入门' },
    { topic: '文档总入口', name: 'CUDA Toolkit Documentation', url: 'https://docs.nvidia.com/cuda/', note: 'NVIDIA 所有 CUDA 文档的根目录，找 cuBLAS、nvcc、Nsight 从这进。', level: '参考' },
  ],

  _general: [
    { topic: 'Python 官方文档', name: 'Python 3 Documentation', url: 'https://docs.python.org/3/', note: '一切 Python 问题的最终答案。', level: '参考' },
    { topic: 'PEP', name: 'Python Enhancement Proposals', url: 'https://peps.python.org/', note: 'Python 每个语言特性的设计文档，PEP 8 是代码风格。', level: '参考' },
    { topic: 'Web 基础', name: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/', note: 'HTML / CSS / JS / HTTP 的权威文档。', level: '入门' },
    { topic: 'Python 教程', name: 'Real Python', url: 'https://realpython.com/', note: '质量最稳定的 Python 英文教程站。', level: '入门' },
    { topic: '代码审查', name: 'Google Engineering Practices', url: 'https://google.github.io/eng-practices/', note: 'Google 公开的代码审查规范，怎么写 PR、怎么审 PR。', level: '进阶' },
    { topic: '程序员素养', name: 'The Pragmatic Programmer', url: 'https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/', note: '经典中的经典，讲的是习惯而不是技术。', level: '参考' },
  ],
};

/** 关键词 → 直达原文（懒人模式里点「原文」时先查这里再问 AI） */
export const ORIGIN_KEYWORDS = [
  { match: /cuda|kernel|gpu|thread ?idx|shared memory|warp/i, name: 'CUDA C++ Programming Guide', url: 'https://docs.nvidia.com/cuda/cuda-c-programming-guide/' },
  { match: /transformer|self[- ]?attention|multi[- ]?head|positional encoding/i, name: 'The Illustrated Transformer', url: 'https://jalammar.github.io/illustrated-transformer/' },
  { match: /softmax|attention score|scaled dot/i, name: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' },
  { match: /embedding|word2vec|向量表示/i, name: 'Google ML: Embeddings', url: 'https://developers.google.com/machine-learning/crash-course/embeddings' },
  { match: /recall|ranking|召回|排序模型|candidate generation/i, name: 'Google ML: Recommendation Systems', url: 'https://developers.google.com/machine-learning/recommendation' },
  { match: /singleton|单例/i, name: 'Refactoring.Guru: Singleton', url: 'https://refactoring.guru/design-patterns/singleton' },
  { match: /factory|工厂/i, name: 'Refactoring.Guru: Factory Method', url: 'https://refactoring.guru/design-patterns/factory-method' },
  { match: /observer|观察者|pub.?sub|发布订阅/i, name: 'Refactoring.Guru: Observer', url: 'https://refactoring.guru/design-patterns/observer' },
  { match: /strategy|策略模式/i, name: 'Refactoring.Guru: Strategy', url: 'https://refactoring.guru/design-patterns/strategy' },
  { match: /decorator pattern|装饰器模式/i, name: 'Refactoring.Guru: Decorator', url: 'https://refactoring.guru/design-patterns/decorator' },
  { match: /decorator|装饰器|@wraps|functools/i, name: 'Python Glossary: decorator', url: 'https://docs.python.org/3/glossary.html#term-decorator' },
  { match: /generator|yield|生成器/i, name: 'Python Wiki: Generators', url: 'https://wiki.python.org/moin/Generators' },
  { match: /asyncio|async|await|协程|coroutine|event loop/i, name: 'Python asyncio', url: 'https://docs.python.org/3/library/asyncio.html' },
  { match: /thread|线程|lock|mutex|gil/i, name: 'Python threading', url: 'https://docs.python.org/3/library/threading.html' },
  { match: /redis/i, name: 'Redis Documentation', url: 'https://redis.io/docs/latest/' },
  { match: /kafka/i, name: 'Apache Kafka Documentation', url: 'https://kafka.apache.org/documentation/' },
  { match: /rabbitmq|amqp/i, name: 'RabbitMQ Tutorials', url: 'https://www.rabbitmq.com/tutorials' },
  { match: /big[- ]?o|时间复杂度|空间复杂度|complexity/i, name: 'Big-O Cheat Sheet', url: 'https://www.bigocheatsheet.com/' },
  { match: /dynamic programming|动态规划|memoiz/i, name: 'Algorithms (Jeff Erickson): Dynamic Programming', url: 'https://jeffe.cs.illinois.edu/teaching/algorithms/book/03-dynprog.pdf' },
  { match: /prompt injection|提示注入|jailbreak|越狱/i, name: 'OWASP Top 10 for LLM Applications', url: 'https://genai.owasp.org/llm-top-10/' },
];

/** 给 AI 的提示词：让它找某个概念的英文原文 */
export function buildOriginPrompt(concept, moduleName) {
  return `你是一个严谨的技术文献检索助手。

任务：为下面这个概念找 3 到 5 个"英文原文"来源。
概念：${concept}
所属模块：${moduleName || '通用'}

什么算"原文"（按优先级）：
1. 官方文档（语言官网、库官网、厂商官方指南）
2. 原始论文（arXiv、ACM、IEEE 上的首发论文）
3. 概念提出者本人写的文章、书、演讲
4. 广泛公认的经典教材或权威教程（如 MDN、Real Python、Refactoring.Guru）

硬性规则：
- 只给真实存在、你确定的 URL。禁止编造、拼凑或猜测 URL。
- 不确定具体深链时，用该站点稳定的根地址或已知的落地页。
- 宁可少给，不要乱给。找不到 3 个就只给你确定的那几个。
- 只要英文来源，不要中文翻译版、不要博客搬运。
- level 取值只能是：入门、进阶、参考。

输出格式：只输出下面这个 JSON，不要加任何解释、不要加 markdown 代码块标记。
{"sources":[{"name":"来源名称","url":"https://...","note":"一句中文说明为什么它是原文或权威","level":"入门|进阶|参考"}]}`;
}
