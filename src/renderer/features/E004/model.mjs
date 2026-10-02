export const DIRECTIONS = Object.freeze([
  Object.freeze({ bit: 1, opposite: 4, dx: 0, dy: -1, label: '上' }),
  Object.freeze({ bit: 2, opposite: 8, dx: 1, dy: 0, label: '右' }),
  Object.freeze({ bit: 4, opposite: 1, dx: 0, dy: 1, label: '下' }),
  Object.freeze({ bit: 8, opposite: 2, dx: -1, dy: 0, label: '左' }),
]);

export function ports(type, orientation) {
  if (!['straight', 'bend'].includes(type) || !Number.isInteger(orientation)) throw new RangeError('管件类型或方向无效。');
  let mask = type === 'straight' ? 5 : 3;
  const turns = ((orientation % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) mask = ((mask << 1) & 15) | (mask >> 3);
  return mask;
}

function randomSeed(seed) {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(a, b, width) {
  if (b === a + 1 && Math.floor(a / width) === Math.floor(b / width)) return 2;
  if (b === a - 1 && Math.floor(a / width) === Math.floor(b / width)) return 8;
  if (b === a + width) return 4;
  if (b === a - width) return 1;
  throw new RangeError('解路径包含不相邻格。');
}

/** Twenty fixed levels. A monotone-column route guarantees solvability without a search/AI dependency. */
export function generateLevel(id) {
  if (!Number.isInteger(id) || id < 1 || id > 20) throw new RangeError('关卡编号须为 1–20 的整数。');
  const width = 4 + Math.floor((id - 1) / 5);
  const height = id <= 10 ? 3 : 5;
  const seed = `E004-L${String(id).padStart(2, '0')}`;
  const random = randomSeed(seed);
  const route = [];
  let row = (id - 1) % height;
  const entrance = row * width;
  for (let col = 0; col < width; col++) {
    route.push(row * width + col);
    // Pick another row, then traverse vertically inside this column once.
    let target = Math.floor(random() * (height - 1));
    if (target >= row) target++;
    while (row !== target) { row += Math.sign(target - row); route.push(row * width + col); }
  }
  const exit = route.at(-1);
  const count = id <= 5 ? 1 : id <= 14 ? 2 : 3;
  const required = Array.from({ length: count }, (_, i) => route[Math.floor((i + 1) * (route.length - 1) / (count + 1))]);
  const cells = Array.from({ length: width * height }, () => ({ type: random() < 0.5 ? 'straight' : 'bend', orientation: Math.floor(random() * 4) }));
  const solution = cells.map((c) => c.orientation);
  route.forEach((index, step) => {
    const incoming = step ? between(index, route[step - 1], width) : 8;
    const outgoing = step === route.length - 1 ? 2 : between(index, route[step + 1], width);
    const mask = incoming | outgoing;
    const type = mask === 5 || mask === 10 ? 'straight' : 'bend';
    cells[index].type = type;
    solution[index] = [0, 1, 2, 3].find((orientation) => ports(type, orientation) === mask);
  });
  // Every level starts unfinished, with a visibly disconnected entrance.
  while (ports(cells[entrance].type, cells[entrance].orientation) & 8) cells[entrance].orientation = (cells[entrance].orientation + 1) % 4;
  return { id, seed, width, height, entrance, exit, required, cells, solution, solutionPath: route };
}

export function validateLevel(level) {
  if (!level || !Number.isInteger(level.width) || level.width < 2 || level.width > 10 || !Number.isInteger(level.height) || level.height < 2 || level.height > 10) throw new RangeError('棋盘尺寸无效。');
  const size = level.width * level.height;
  if (!Array.isArray(level.cells) || level.cells.length !== size) throw new RangeError('管件数量不匹配。');
  for (const cell of level.cells) { if (!cell) throw new RangeError('管件无效。'); ports(cell.type, cell.orientation); }
  if (!Number.isInteger(level.entrance) || level.entrance < 0 || level.entrance >= size || level.entrance % level.width !== 0) throw new RangeError('入口须在左侧边缘。');
  if (!Number.isInteger(level.exit) || level.exit < 0 || level.exit >= size || level.exit % level.width !== level.width - 1) throw new RangeError('出口须在右侧边缘。');
  if (!Array.isArray(level.required) || new Set(level.required).size !== level.required.length || level.required.some((i) => !Number.isInteger(i) || i < 0 || i >= size)) throw new RangeError('必经节点无效。');
  return level;
}

/** Follow the sole two-port chain. Never enter the neighbor on an unmatched port. */
export function traceFlow(level, orientations = level.cells.map((c) => c.orientation)) {
  validateLevel(level);
  if (!Array.isArray(orientations) || orientations.length !== level.cells.length || orientations.some((o) => !Number.isInteger(o))) throw new RangeError('管件方向数量或数值无效。');
  const path = [];
  const seen = new Set();
  let index = level.entrance;
  let incoming = 8;
  let leak = null;
  let reachedExit = false;
  while (true) {
    const mask = ports(level.cells[index].type, orientations[index]);
    if (!(mask & incoming)) { leak = { index, direction: incoming, neighbor: null, reason: 'entry' }; break; }
    if (seen.has(index)) { leak = { index, direction: incoming, neighbor: null, reason: 'cycle' }; break; }
    seen.add(index); path.push(index);
    const outgoing = DIRECTIONS.find((d) => (mask & d.bit) && d.bit !== incoming);
    const x = index % level.width + outgoing.dx;
    const y = Math.floor(index / level.width) + outgoing.dy;
    if (x < 0 || x >= level.width || y < 0 || y >= level.height) {
      if (index === level.exit && outgoing.bit === 2) reachedExit = true;
      else leak = { index, direction: outgoing.bit, neighbor: null, reason: 'edge' };
      break;
    }
    const next = y * level.width + x;
    if (!(ports(level.cells[next].type, orientations[next]) & outgoing.opposite)) { leak = { index, direction: outgoing.bit, neighbor: next, reason: 'mismatch' }; break; }
    index = next;
    incoming = outgoing.opposite;
  }
  const visitedRequired = level.required.filter((i) => seen.has(i));
  const missingRequired = level.required.filter((i) => !seen.has(i));
  return { path, leak, reachedExit, visitedRequired, missingRequired, won: reachedExit && !missingRequired.length };
}

export class PipeGame {
  #level;
  #orientations;
  #moves = 0;
  #phase = 'playing';
  constructor(id = 1) {
    const level = typeof id === 'number' ? generateLevel(id) : validateLevel(id);
    // Own copies: outside objects cannot mutate an ongoing round.
    this.#level = { ...level, required: [...level.required], cells: level.cells.map((c) => ({ ...c })) };
    this.#orientations = level.cells.map((c) => c.orientation);
  }
  rotate(index, direction = 1) {
    if (this.#phase !== 'playing' || !Number.isInteger(index) || index < 0 || index >= this.#orientations.length || ![1, -1].includes(direction)) return false;
    this.#orientations[index] = (this.#orientations[index] + direction + 4) % 4;
    this.#moves++;
    if (traceFlow(this.#level, this.#orientations).won) this.#phase = 'won';
    return true;
  }
  pause() { if (this.#phase !== 'playing') return false; this.#phase = 'paused'; return true; }
  resume() { if (this.#phase !== 'paused') return false; this.#phase = 'playing'; return true; }
  reset() { this.#orientations = this.#level.cells.map((c) => c.orientation); this.#moves = 0; this.#phase = 'playing'; }
  getView() {
    return {
      id: this.#level.id, seed: this.#level.seed, width: this.#level.width, height: this.#level.height,
      entrance: this.#level.entrance, exit: this.#level.exit, required: [...this.#level.required], phase: this.#phase, moves: this.#moves,
      cells: this.#phase === 'paused' ? [] : this.#level.cells.map((c, i) => ({ type: c.type, orientation: this.#orientations[i], ports: ports(c.type, this.#orientations[i]) })),
      flow: this.#phase === 'paused' ? null : traceFlow(this.#level, this.#orientations),
    };
  }
  result() {
    if (this.#phase !== 'won') return null;
    const flow = traceFlow(this.#level, this.#orientations);
    return { level: this.#level.id, seed: this.#level.seed, moves: this.#moves, path: flow.path, checkpoints: flow.visitedRequired };
  }
}

export function validScore(score) {
  if (!score || !Number.isInteger(score.level) || score.level < 1 || score.level > 20 || !Number.isInteger(score.moves) || score.moves < 1) return false;
  const level = generateLevel(score.level);
  if (score.seed !== level.seed || !Array.isArray(score.path) || !Array.isArray(score.checkpoints)) return false;
  const valid = score.path.length > 1 && score.path.length <= level.cells.length && new Set(score.path).size === score.path.length
    && score.path.every((i) => Number.isInteger(i) && i >= 0 && i < level.cells.length)
    && score.path[0] === level.entrance && score.path.at(-1) === level.exit
    && score.checkpoints.length === level.required.length && new Set(score.checkpoints).size === score.checkpoints.length
    && level.required.every((i) => score.checkpoints.includes(i) && score.path.includes(i));
  if (!valid) return false;
  try {
    return score.path.every((index, step) => {
      const mask = (step ? between(index, score.path[step - 1], level.width) : 8)
        | (step === score.path.length - 1 ? 2 : between(index, score.path[step + 1], level.width));
      return [0, 1, 2, 3].some((o) => ports(level.cells[index].type, o) === mask);
    });
  } catch { return false; }
}
