export const PRESETS = Object.freeze({
  beginner: Object.freeze({ width: 9, height: 9, mines: 10 }),
  intermediate: Object.freeze({ width: 16, height: 16, mines: 40 }),
});

export function validateOptions({ width, height, mines, seed }) {
  if (!Number.isInteger(width) || width < 5 || width > 30) throw new RangeError('宽度须为 5–30 的整数。');
  if (!Number.isInteger(height) || height < 5 || height > 24) throw new RangeError('高度须为 5–24 的整数。');
  const limit = Math.floor(width * height * 35 / 100);
  if (!Number.isInteger(mines) || mines < 1 || mines > limit) throw new RangeError(`雷数须为 1–${limit} 的整数（不超过格数的 35%）。`);
  if (typeof seed !== 'string' || !seed.trim() || seed.length > 64) throw new RangeError('局号须为 1–64 个字符。');
  return { width, height, mines, seed };
}

export function neighbors(index, width, height) {
  const x = index % width;
  const y = Math.floor(index / width);
  const result = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) result.push((y + dy) * width + x + dx);
    }
  }
  return result;
}

function randomFromSeed(seed) {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure board generation for replay/tests; the renderer receives only getView(). */
export function generateBoard(options, firstIndex) {
  const { width, height, mines, seed } = validateOptions(options);
  if (!Number.isInteger(firstIndex) || firstIndex < 0 || firstIndex >= width * height) throw new RangeError('首点不在棋盘内。');
  const safe = new Set([firstIndex, ...neighbors(firstIndex, width, height)]);
  const candidates = Array.from({ length: width * height }, (_, i) => i).filter((i) => !safe.has(i));
  const random = randomFromSeed(`${seed}|${width}|${height}|${mines}|${firstIndex}`);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const cells = Array.from({ length: width * height }, () => ({ mine: false, adjacent: 0 }));
  for (const i of candidates.slice(0, mines)) cells[i].mine = true;
  cells.forEach((cell, i) => {
    if (!cell.mine) cell.adjacent = neighbors(i, width, height).filter((n) => cells[n].mine).length;
  });
  return cells;
}

export class Minesweeper {
  #options;
  #clock;
  #layout = null;
  #revealed;
  #flags;
  #phase = 'ready';
  #elapsed = 0;
  #started = null;
  #firstIndex = null;
  #exploded = null;
  #moves = 0;

  constructor(options, { now = () => Date.now() } = {}) {
    this.#options = validateOptions(options);
    this.#clock = now;
    this.#revealed = new Set();
    this.#flags = new Set();
  }

  #valid(index) { return Number.isInteger(index) && index >= 0 && index < this.#options.width * this.#options.height; }
  #playable() { return this.#phase === 'ready' || this.#phase === 'running'; }
  #elapsedNow() { return this.#elapsed + (this.#started === null ? 0 : Math.max(0, this.#clock() - this.#started)); }
  #finish(phase) {
    this.#elapsed = this.#elapsedNow();
    this.#started = null;
    this.#phase = phase;
  }

  flag(index) {
    if (!this.#valid(index) || !this.#playable() || this.#revealed.has(index)) return false;
    if (this.#flags.has(index)) this.#flags.delete(index);
    else {
      if (this.#flags.size >= this.#options.mines) return false;
      this.#flags.add(index);
    }
    this.#moves++;
    return true;
  }

  reveal(index) {
    if (!this.#valid(index) || !this.#playable() || this.#flags.has(index) || this.#revealed.has(index)) return false;
    if (this.#phase === 'ready') {
      this.#layout = generateBoard(this.#options, index);
      this.#firstIndex = index;
      this.#started = this.#clock();
      this.#phase = 'running';
    }
    this.#moves++;
    this.#open([index]);
    return true;
  }

  #open(initial) {
    const pending = [...initial];
    while (pending.length && this.#phase === 'running') {
      const i = pending.pop();
      if (this.#revealed.has(i) || this.#flags.has(i)) continue;
      this.#revealed.add(i);
      const cell = this.#layout[i];
      if (cell.mine) {
        this.#exploded = i;
        this.#finish('lost');
        return;
      }
      if (!cell.adjacent) pending.push(...neighbors(i, this.#options.width, this.#options.height));
    }
    if (this.#phase === 'running' && this.#revealed.size === this.#options.width * this.#options.height - this.#options.mines) this.#finish('won');
  }

  chord(index) {
    if (!this.#valid(index) || this.#phase !== 'running' || !this.#revealed.has(index)) return false;
    const count = this.#layout[index].adjacent;
    const around = neighbors(index, this.#options.width, this.#options.height);
    if (!count || around.filter((n) => this.#flags.has(n)).length !== count) return false;
    const candidates = around.filter((n) => !this.#flags.has(n) && !this.#revealed.has(n));
    if (!candidates.length) return false;
    this.#moves++;
    this.#open(candidates);
    return true;
  }

  pause() {
    if (this.#phase !== 'running') return false;
    this.#finish('paused');
    return true;
  }

  resume() {
    if (this.#phase !== 'paused') return false;
    this.#phase = 'running';
    this.#started = this.#clock();
    return true;
  }

  getView() {
    const terminal = this.#phase === 'won' || this.#phase === 'lost';
    return {
      ...this.#options,
      phase: this.#phase,
      firstIndex: this.#firstIndex,
      exploded: this.#exploded,
      elapsedMs: Math.floor(this.#elapsedNow()),
      flags: this.#flags.size,
      revealed: this.#revealed.size,
      moves: this.#moves,
      cells: Array.from({ length: this.#options.width * this.#options.height }, (_, i) => {
        const visible = this.#revealed.has(i) && this.#phase !== 'paused';
        return {
          revealed: visible,
          flagged: this.#flags.has(i),
          value: visible && !this.#layout[i].mine ? this.#layout[i].adjacent : null,
          mine: terminal ? this.#layout[i].mine : visible && this.#layout[i]?.mine === true,
          exploded: this.#exploded === i,
          wrongFlag: this.#phase === 'lost' && this.#flags.has(i) && !this.#layout[i].mine,
        };
      }),
    };
  }

  result() {
    if (this.#phase !== 'won' && this.#phase !== 'lost') return null;
    return { ...this.#options, firstIndex: this.#firstIndex, outcome: this.#phase, elapsedMs: Math.floor(this.#elapsed), moves: this.#moves };
  }
}

export function scoreKey(score) { return `${score.width}×${score.height} / ${score.mines} 雷`; }
export function bestScore(scores, options) {
  const matches = scores.filter((s) => s.outcome === 'won' && scoreKey(s) === scoreKey(options));
  return matches.length ? matches.reduce((best, score) => score.elapsedMs < best.elapsedMs ? score : best) : null;
}

export function validScore(score) {
  if (!score || (score.outcome !== 'won' && score.outcome !== 'lost')) return false;
  try { validateOptions(score); } catch { return false; }
  return Number.isInteger(score.firstIndex) && score.firstIndex >= 0 && score.firstIndex < score.width * score.height
    && Number.isInteger(score.elapsedMs) && score.elapsedMs >= 0 && Number.isInteger(score.moves) && score.moves > 0;
}
