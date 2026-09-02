/**
 * Understand-Anything 知识图谱的查询层。
 *
 * 图谱由那个插件在项目里跑 /understand 生成（.ua/knowledge-graph.json）：
 * 每个 function / class / file 是一个节点，calls / imports / contains 是边。
 *
 * 记事本用它干一件本地分词做不到的事：**跨文件找调用处**。
 * 你粘一段代码，里面的函数名在图谱里一查，就知道整个项目里谁调用了它。
 */

const CODE_TYPES = new Set(['function', 'class', 'module', 'file', 'endpoint', 'service']);

export const EDGE_LABEL = {
  calls: '调用', imports: '导入', contains: '包含', inherits: '继承',
  implements: '实现', depends_on: '依赖', reads_from: '读取', writes_to: '写入',
  exports: '导出', tested_by: '被测试', related: '相关', similar_to: '相似',
  documents: '文档说明', configures: '配置', transforms: '转换', validates: '校验',
  routes: '路由', triggers: '触发', subscribes: '订阅', publishes: '发布',
};

export class KnowledgeGraph {
  constructor(raw) {
    this.root = raw.root;
    // project 在新版图谱里是个对象（name/languages/frameworks/description），
    // 老版是字符串。两种都要认，否则界面上会显示 [object Object]。
    this.projectMeta = raw.project && typeof raw.project === 'object' ? raw.project : null;
    this.project = this.projectMeta?.name
      || (typeof raw.project === 'string' ? raw.project : (raw.root || '').split('/').pop() || '未命名');
    this.description = this.projectMeta?.description || '';
    this.nodes = raw.nodes || [];
    this.edges = raw.edges || [];

    this.byId = new Map(this.nodes.map((n) => [n.id, n]));

    // 同名符号可能有多个（不同文件里的同名函数），所以是 name -> 数组
    this.byName = new Map();
    for (const node of this.nodes) {
      if (!node.name) continue;
      if (!this.byName.has(node.name)) this.byName.set(node.name, []);
      this.byName.get(node.name).push(node);
    }

    this.outgoing = new Map();
    this.incoming = new Map();
    for (const edge of this.edges) {
      if (!this.outgoing.has(edge.source)) this.outgoing.set(edge.source, []);
      this.outgoing.get(edge.source).push(edge);
      if (!this.incoming.has(edge.target)) this.incoming.set(edge.target, []);
      this.incoming.get(edge.target).push(edge);
    }
  }

  get stats() {
    const byType = {};
    for (const node of this.nodes) byType[node.type] = (byType[node.type] || 0) + 1;
    const calls = this.edges.filter((e) => e.type === 'calls').length;
    return { nodes: this.nodes.length, edges: this.edges.length, calls, byType };
  }

  /** 按符号名找节点，代码类节点优先 */
  lookup(name) {
    const hits = this.byName.get(name) || [];
    return [...hits].sort((a, b) => {
      const rank = (n) => (n.type === 'function' ? 0 : n.type === 'class' ? 1 : CODE_TYPES.has(n.type) ? 2 : 3);
      return rank(a) - rank(b);
    });
  }

  /** 模糊搜索，给搜索框用 */
  search(query, limit = 30) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];
    return this.nodes
      .filter((n) => n.name?.toLowerCase().includes(needle) || n.filePath?.toLowerCase().includes(needle))
      .sort((a, b) => {
        const exactA = a.name?.toLowerCase() === needle ? 0 : 1;
        const exactB = b.name?.toLowerCase() === needle ? 0 : 1;
        return exactA - exactB;
      })
      .slice(0, limit);
  }

  /** 谁调用了它 —— 这就是「调用处」 */
  callers(nodeId) {
    return (this.incoming.get(nodeId) || [])
      .filter((e) => e.type === 'calls')
      .map((e) => ({ edge: e, node: this.byId.get(e.source) }))
      .filter((x) => x.node);
  }

  /** 它调用了谁 */
  callees(nodeId) {
    return (this.outgoing.get(nodeId) || [])
      .filter((e) => e.type === 'calls')
      .map((e) => ({ edge: e, node: this.byId.get(e.target) }))
      .filter((x) => x.node);
  }

  /** 除调用外的其它关系，双向合并 */
  relations(nodeId) {
    const out = (this.outgoing.get(nodeId) || [])
      .filter((e) => e.type !== 'calls' && e.type !== 'contains')
      .map((e) => ({ edge: e, node: this.byId.get(e.target), dir: 'out' }));
    const inc = (this.incoming.get(nodeId) || [])
      .filter((e) => e.type !== 'calls' && e.type !== 'contains')
      .map((e) => ({ edge: e, node: this.byId.get(e.source), dir: 'in' }));
    return [...out, ...inc].filter((x) => x.node);
  }

  /** 它属于哪个文件 */
  container(nodeId) {
    const edge = (this.incoming.get(nodeId) || []).find((e) => e.type === 'contains');
    return edge ? this.byId.get(edge.source) : null;
  }
}

/** 把图谱事实压成给模型看的短文本，让它说「调用关系」时有据可依而不是猜 */
export function graphFacts(graph, node) {
  if (!graph || !node) return '';
  const callers = graph.callers(node.id);
  const callees = graph.callees(node.id);
  const where = node.filePath
    ? `${node.filePath}${node.lineRange ? ` 第 ${node.lineRange[0]}-${node.lineRange[1]} 行` : ''}`
    : '未知位置';

  const lines = [
    `符号 ${node.name}（${node.type}）定义在 ${where}。`,
    node.summary ? `图谱里对它的说明：${node.summary}` : '',
    callers.length
      ? `被以下 ${callers.length} 处调用：${callers.map((c) => `${c.node.name}（${c.node.filePath || '?'}）`).join('、')}`
      : '图谱里没有记录到调用它的地方。',
    callees.length
      ? `它调用了：${callees.map((c) => `${c.node.name}（${c.node.filePath || '?'}）`).join('、')}`
      : '',
  ];
  return lines.filter(Boolean).join('\n');
}
