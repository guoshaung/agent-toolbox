/**
 * 反斜杠命令：在记事本里敲 \ 唤出命令面板，插入常用块。
 *
 * 为什么需要它：像结构树、表格这种东西，手敲又慢又容易对不齐；
 * 而且树形图必须落在 ``` 代码块里才不会被 contenteditable 折叠空格、揉烂缩进。
 * 命令面板把"选对容器"这件事替人做了。
 */

/**
 * 缩进大纲 → 结构树。
 *
 * 手画 │ ├ └ ─ 是最费时间也最容易错的一步。写成缩进大纲（每层两个空格或一个 Tab），
 * 这里自动算出连接线。层级深了也不会画歪。
 *
 * 输入：
 *   Self-Improving Agents
 *     Model / Weight RSI
 *     Harness RSI
 *       Context
 *         ACE
 */
export function outlineToTree(text) {
  const rows = String(text || '').replace(/\t/g, '  ').split('\n')
    .map((line) => ({ raw: line, indent: line.match(/^ */)[0].length, label: line.trim() }))
    .filter((row) => row.label);
  if (!rows.length) return '';

  // 用缩进宽度还原层级：取所有缩进值排序去重，位置即层级，
  // 这样每层缩进 2 格、4 格甚至混用都能正确识别
  const levels = [...new Set(rows.map((r) => r.indent))].sort((a, b) => a - b);
  const depthOf = (indent) => levels.indexOf(indent);

  const out = [];
  rows.forEach((row, index) => {
    const depth = depthOf(row.indent);
    if (depth === 0) { out.push(row.label); return; }

    // 判断同层后面还有没有兄弟：往后找到第一个层级 <= 自己的
    let isLast = true;
    for (let j = index + 1; j < rows.length; j++) {
      const d = depthOf(rows[j].indent);
      if (d < depth) break;
      if (d === depth) { isLast = false; break; }
    }

    // 祖先层：还有后续兄弟的画竖线，否则留空
    let prefix = '';
    for (let level = 1; level < depth; level++) {
      let ancestorHasMore = false;
      for (let j = index + 1; j < rows.length; j++) {
        const d = depthOf(rows[j].indent);
        if (d < level) break;
        if (d === level) { ancestorHasMore = true; break; }
      }
      prefix += ancestorHasMore ? '│   ' : '    ';
    }
    out.push(`${prefix}${isLast ? '└── ' : '├── '}${row.label}`);
  });
  return out.join('\n');
}

const now = () => new Date().toLocaleString('zh-CN', { hour12: false });

/**
 * 每条命令返回 { markdown } —— 插入的是 markdown 源码，
 * 由 markdownToHtml 转成可编辑的 HTML，保证和手写的内容格式一致。
 */
export const SLASH_COMMANDS = [
  {
    id: 'code',
    label: '代码块',
    hint: '带语言高亮，空格缩进原样保留',
    keywords: 'code daima 代码',
    markdown: () => '```python\n\n```\n',
    caretOffset: 10,          // 光标落到第二行
  },
  {
    id: 'tree',
    label: '结构树',
    hint: '分类树 / 目录树，写缩进大纲后可一键转成连线',
    keywords: 'tree jiegou 树 目录 分类',
    markdown: () => '```\n根节点\n├── 分支一\n│   └── 叶子\n└── 分支二\n```\n',
  },
  {
    id: 'outline',
    label: '大纲转结构树',
    hint: '把选中的缩进大纲转成 │├└ 连线图',
    keywords: 'outline dagang 转换',
    transform: true,          // 特殊：作用于选中的文本，而不是插入
  },
  {
    id: 'table',
    label: '表格',
    hint: '三列表格骨架',
    keywords: 'table biaoge 表格',
    markdown: () => '| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n|  |  |  |\n',
  },
  {
    id: 'todo',
    label: '待办清单',
    hint: '可勾选的任务列表',
    keywords: 'todo daiban 待办 任务',
    markdown: () => '- [ ] \n- [ ] \n',
  },
  {
    id: 'quote',
    label: '引用',
    hint: '引用别人的话或原文',
    keywords: 'quote yinyong 引用',
    markdown: () => '> \n',
  },
  {
    id: 'h1', label: '一级标题', hint: '章', keywords: 'h1 title 标题',
    markdown: () => '# \n',
  },
  {
    id: 'h2', label: '二级标题', hint: '节', keywords: 'h2 title 标题',
    markdown: () => '## \n',
  },
  {
    id: 'hr', label: '分隔线', hint: '把内容分段', keywords: 'hr fenge 分隔',
    markdown: () => '\n---\n\n',
  },
  {
    id: 'time', label: '当前时间', hint: '插入时间戳，记录进度用', keywords: 'time shijian 时间',
    markdown: () => `${now()} `,
  },
];

/** 按输入过滤命令；匹配 id、标签和拼音关键词 */
export function filterCommands(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((cmd) => `${cmd.id} ${cmd.label} ${cmd.keywords}`.toLowerCase().includes(needle));
}
