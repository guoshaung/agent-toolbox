import { h } from '../../core/ui.js';

/**
 * 聚焦调用图：选中的符号居中，**调用它的**在左、**它调用的**在右。
 *
 * 为什么不做插件那种全景力导向图：177 个节点铺开是一团毛线，
 * 好看但回答不了"这个函数被谁调用"。三栏聚焦图一眼就能看清一跳的关系，
 * 点任意节点重新居中，就能一跳一跳地走完整条调用链。
 */
const NS = 'http://www.w3.org/2000/svg';
const NODE_W = 168;
const NODE_H = 34;
const GAP_Y = 12;
const COL_GAP = 116;
const MAX_PER_SIDE = 7;

const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) el.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child) el.append(child);
  return el;
};

const TYPE_COLOR = {
  function: '#5b8cff',
  class: '#c085d8',
  file: '#6b7382',
  module: '#3fb98a',
};

const truncate = (text, max = 20) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function renderCallGraph(graph, center, { onFocus, onOpenSource }) {
  const callers = graph.callers(center.id).slice(0, MAX_PER_SIDE);
  const callees = graph.callees(center.id).slice(0, MAX_PER_SIDE);
  const totalCallers = graph.callers(center.id).length;
  const totalCallees = graph.callees(center.id).length;

  const rows = Math.max(callers.length, callees.length, 1);
  const height = Math.max(rows * (NODE_H + GAP_Y) + 40, 160);
  const width = NODE_W * 3 + COL_GAP * 2 + 24;

  const colX = [12, 12 + NODE_W + COL_GAP, 12 + (NODE_W + COL_GAP) * 2];
  const centerY = height / 2 - NODE_H / 2;

  const columnY = (count, index) => {
    const blockHeight = count * NODE_H + (count - 1) * GAP_Y;
    return (height - blockHeight) / 2 + index * (NODE_H + GAP_Y);
  };

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    class: 'nb__cg',
    preserveAspectRatio: 'xMidYMid meet',
  });

  root.append(svg('defs', {},
    svg('marker', {
      id: 'nbArrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse',
    }, svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#3a4252' })),
  ));

  const edges = svg('g', { class: 'nb__cg-edges' });
  const nodes = svg('g', {});
  root.append(edges, nodes);

  function drawNode(node, x, y, { isCenter = false } = {}) {
    const color = TYPE_COLOR[node.type] || '#6b7382';
    const group = svg('g', {
      class: `nb__cg-node${isCenter ? ' is-center' : ''}`,
      transform: `translate(${x} ${y})`,
    });
    group.append(
      svg('rect', {
        width: NODE_W, height: NODE_H, rx: 8,
        fill: isCenter ? 'rgba(91,140,255,.18)' : '#1c2029',
        stroke: isCenter ? '#5b8cff' : '#262b36',
        'stroke-width': isCenter ? 2 : 1,
      }),
      svg('rect', { x: 0, y: 0, width: 3, height: NODE_H, rx: 1.5, fill: color }),
      svg('text', {
        x: 12, y: NODE_H / 2 + 4, fill: isCenter ? '#e6e9ef' : '#9aa2b1',
        'font-size': '12', 'font-family': 'ui-monospace, Menlo, monospace',
      }, document.createTextNode(truncate(node.name || '?'))),
    );

    if (!isCenter) {
      group.addEventListener('click', () => onFocus(node));
      group.style.cursor = 'pointer';
    }
    group.append(svg('title', {}, document.createTextNode(
      `${node.type} ${node.name}\n${node.filePath || ''}\n${node.summary || ''}`)));
    nodes.append(group);
    return group;
  }

  function drawEdge(fromX, fromY, toX, toY) {
    const midX = (fromX + toX) / 2;
    edges.append(svg('path', {
      d: `M${fromX},${fromY} C${midX},${fromY} ${midX},${toY} ${toX},${toY}`,
      fill: 'none', stroke: '#2c3240', 'stroke-width': 1.5,
      'marker-end': 'url(#nbArrow)',
    }));
  }

  // 左：调用方 → 中心
  callers.forEach((entry, index) => {
    const y = columnY(callers.length, index);
    drawNode(entry.node, colX[0], y);
    drawEdge(colX[0] + NODE_W, y + NODE_H / 2, colX[1] - 4, centerY + NODE_H / 2);
  });

  // 右：中心 → 被调用方
  callees.forEach((entry, index) => {
    const y = columnY(callees.length, index);
    drawNode(entry.node, colX[2], y);
    drawEdge(colX[1] + NODE_W, centerY + NODE_H / 2, colX[2] - 4, y + NODE_H / 2);
  });

  drawNode(center, colX[1], centerY, { isCenter: true });

  const more = (total, shown, side) => (total > shown
    ? h('span', { class: 'faint' }, `${side}还有 ${total - shown} 个没画`)
    : null);

  return h('div', { class: 'nb__cg-wrap' },
    h('div', { class: 'nb__cg-legend' },
      h('span', { class: 'faint' }, `调用它的 ${totalCallers}`),
      h('code', {}, center.name),
      h('span', { class: 'faint' }, `它调用的 ${totalCallees}`),
    ),
    root,
    h('div', { class: 'nb__cg-foot' },
      more(totalCallers, callers.length, '左边'),
      more(totalCallees, callees.length, '右边'),
      center.filePath ? h('button', {
        class: 'btn btn--sm',
        onclick: () => onOpenSource(center),
      }, '读这段源码') : null,
      h('span', { class: 'faint' }, '点任意节点可以跳过去，一跳一跳走完调用链'),
    ),
  );
}
