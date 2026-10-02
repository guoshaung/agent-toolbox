export const UNDO_LIMIT = 256;

export function validateDisks(disks) {
  if (!Number.isInteger(disks) || disks < 3 || disks > 6) throw new RangeError('盘数须为 3–6 的整数。');
  return disks;
}
export function minimumMoves(disks) { return 2 ** validateDisks(disks) - 1; }

export function validateTowers(towers, disks) {
  validateDisks(disks);
  if (!Array.isArray(towers) || towers.length !== 3 || towers.some((t) => !Array.isArray(t))) throw new RangeError('必须有三根柱子。');
  const all = towers.flat();
  if (all.length !== disks || new Set(all).size !== disks || all.some((d) => !Number.isInteger(d) || d < 1 || d > disks)
    || towers.some((t) => t.some((d, i) => i > 0 && t[i - 1] < d))) throw new RangeError('盘必须各出现一次，且大盘在下。');
  return towers;
}

function decode(code, disks) {
  const positions = [];
  for (let i = 0; i < disks; i++) { positions.push(code % 3); code = Math.floor(code / 3); }
  return positions;
}
function encode(towers, disks) {
  let code = 0;
  towers.forEach((tower, position) => tower.forEach((disk) => { code += position * 3 ** (disk - 1); }));
  return code;
}
function legalNeighbors(code, disks) {
  const positions = decode(code, disks);
  const tops = [null, null, null];
  positions.forEach((tower, disk) => { if (tops[tower] === null) tops[tower] = disk; });
  const result = [];
  for (let from = 0; from < 3; from++) {
    const disk = tops[from];
    if (disk === null) continue;
    for (let to = 0; to < 3; to++) {
      if (from === to || (tops[to] !== null && disk > tops[to])) continue;
      result.push({ from, to, disk: disk + 1, next: code + (to - from) * 3 ** disk });
    }
  }
  return result;
}

// Four fixed state graphs at most; six disks have just 3^6 = 729 legal states.
const distances = new Map();
function distanceTable(disks) {
  if (distances.has(disks)) return distances.get(disks);
  const goal = 3 ** disks - 1;
  const result = new Map([[goal, 0]]);
  const queue = [goal];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const move of legalNeighbors(current, disks)) {
      if (result.has(move.next)) continue;
      result.set(move.next, result.get(current) + 1); queue.push(move.next);
    }
  }
  distances.set(disks, result);
  return result;
}

/** Exact shortest continuation from any legal arrangement, not the initial recursive script. */
export function shortestHint(towers, disks) {
  validateTowers(towers, disks);
  const code = encode(towers, disks);
  const table = distanceTable(disks);
  const remaining = table.get(code);
  if (!remaining) return { remaining: 0, move: null };
  const move = legalNeighbors(code, disks).find((m) => table.get(m.next) === remaining - 1);
  return { remaining, move: { from: move.from, to: move.to, disk: move.disk } };
}

export class Hanoi {
  #disks;
  #towers;
  #undo = [];
  #moves = 0;
  #undos = 0;
  #hints = 0;
  #phase = 'ready';
  #elapsed = 0;
  #started = null;
  #clock;
  constructor(disks = 3, { now = () => Date.now() } = {}) {
    this.#disks = validateDisks(disks);
    this.#clock = now;
    this.#towers = [Array.from({ length: disks }, (_, i) => disks - i), [], []];
  }
  #playable() { return this.#phase === 'ready' || this.#phase === 'running'; }
  #elapsedNow() { return this.#elapsed + (this.#started === null ? 0 : Math.max(0, this.#clock() - this.#started)); }
  #finish(phase) { this.#elapsed = this.#elapsedNow(); this.#started = null; this.#phase = phase; }
  move(from, to) {
    if (!this.#playable()) return { ok: false, reason: 'pausedOrFinished' };
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 2 || to < 0 || to > 2) return { ok: false, reason: 'invalidTower' };
    if (from === to) return { ok: false, reason: 'sameTower' };
    const disk = this.#towers[from].at(-1);
    if (disk === undefined) return { ok: false, reason: 'emptySource' };
    const top = this.#towers[to].at(-1);
    if (top !== undefined && disk > top) return { ok: false, reason: 'largerOnSmaller' };
    if (this.#phase === 'ready') { this.#phase = 'running'; this.#started = this.#clock(); }
    this.#towers[from].pop(); this.#towers[to].push(disk);
    this.#undo.push({ from, to, disk });
    if (this.#undo.length > UNDO_LIMIT) this.#undo.shift();
    this.#moves++;
    if (this.#towers[2].length === this.#disks) this.#finish('won');
    return { ok: true, disk };
  }
  undo() {
    if (this.#phase !== 'running' || !this.#undo.length) return false;
    const move = this.#undo.pop();
    this.#towers[move.to].pop(); this.#towers[move.from].push(move.disk); this.#undos++;
    return true;
  }
  hint() {
    if (!this.#playable()) return null;
    const result = shortestHint(this.#towers, this.#disks);
    if (result.move) this.#hints++;
    return result;
  }
  pause() { if (this.#phase !== 'running') return false; this.#finish('paused'); return true; }
  resume() { if (this.#phase !== 'paused') return false; this.#phase = 'running'; this.#started = this.#clock(); return true; }
  getView() {
    return {
      disks: this.#disks, phase: this.#phase, moves: this.#moves, undos: this.#undos, hints: this.#hints,
      minimum: minimumMoves(this.#disks), elapsedMs: Math.floor(this.#elapsedNow()), canUndo: this.#phase === 'running' && this.#undo.length > 0,
      towers: this.#phase === 'paused' ? [] : this.#towers.map((t) => [...t]),
      remaining: this.#phase === 'paused' ? null : shortestHint(this.#towers, this.#disks).remaining,
    };
  }
  result() {
    if (this.#phase !== 'won') return null;
    return { disks: this.#disks, moves: this.#moves, minimum: minimumMoves(this.#disks), undos: this.#undos, hints: this.#hints, elapsedMs: Math.floor(this.#elapsed) };
  }
}

export function validScore(score) {
  if (!score) return false;
  try { validateDisks(score.disks); } catch { return false; }
  return Number.isInteger(score.moves) && score.moves >= minimumMoves(score.disks) && score.minimum === minimumMoves(score.disks)
    && Number.isInteger(score.undos) && score.undos >= 0 && score.undos <= score.moves
    && Number.isInteger(score.hints) && score.hints >= 0 && Number.isInteger(score.elapsedMs) && score.elapsedMs >= 0;
}

export function betterScore(score, old) { return !old || score.moves < old.moves || (score.moves === old.moves && score.elapsedMs < old.elapsedMs); }
