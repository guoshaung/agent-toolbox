export const COLORS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);
export const MAX_ROUNDS = 10;
export const RECORD_LIMIT = 20;

export function validateSeed(seed) {
  if (typeof seed !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(seed)) throw new RangeError('局号须为 1–32 位字母、数字、下划线或短横线。');
  return seed;
}
export function validateCode(code) {
  if (typeof code !== 'string' || !/^[A-F]{4}$/.test(code)) throw new RangeError('请填满四位，每位须为 A–F。');
  return code;
}

/** Version 1: FNV-1a hash followed by mulberry32, fixed for reproducible rounds. */
export function generateSecret(seed) {
  validateSeed(seed);
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619) >>> 0;
  let secret = '';
  for (let i = 0; i < 4; i++) {
    state = (state + 0x6D2B79F5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    secret += COLORS[Math.floor(((n ^ (n >>> 14)) >>> 0) / 4294967296 * COLORS.length)];
  }
  return secret;
}

export function feedback(secret, guess) {
  validateCode(secret); validateCode(guess);
  let exact = 0;
  const remainingSecret = new Map();
  const remainingGuess = new Map();
  for (let i = 0; i < 4; i++) {
    if (secret[i] === guess[i]) exact++;
    else {
      remainingSecret.set(secret[i], (remainingSecret.get(secret[i]) || 0) + 1);
      remainingGuess.set(guess[i], (remainingGuess.get(guess[i]) || 0) + 1);
    }
  }
  let colorOnly = 0;
  for (const [color, count] of remainingGuess) colorOnly += Math.min(count, remainingSecret.get(color) || 0);
  return { exact, colorOnly };
}

export class ColorCode {
  #seed;
  #secret;
  #rows = [];
  #phase = 'ready';
  #elapsed = 0;
  #started = null;
  #now;
  constructor(seed, { now = () => Date.now() } = {}) {
    this.#seed = validateSeed(seed); this.#secret = generateSecret(seed); this.#now = now;
  }
  #elapsedNow() { return this.#elapsed + (this.#started === null ? 0 : Math.max(0, this.#now() - this.#started)); }
  #stop(phase) { this.#elapsed = this.#elapsedNow(); this.#started = null; this.#phase = phase; }
  submit(guess) {
    if (!['ready', 'running'].includes(this.#phase)) return { ok: false, reason: 'pausedOrFinished' };
    try { validateCode(guess); } catch { return { ok: false, reason: 'invalidGuess' }; }
    if (this.#phase === 'ready') { this.#phase = 'running'; this.#started = this.#now(); }
    const result = feedback(this.#secret, guess);
    this.#rows.push({ round: this.#rows.length + 1, guess, ...result });
    if (result.exact === 4) this.#stop('won');
    else if (this.#rows.length === MAX_ROUNDS) this.#stop('lost');
    return { ok: true, ...result };
  }
  pause() { if (this.#phase !== 'running') return false; this.#stop('paused'); return true; }
  resume() { if (this.#phase !== 'paused') return false; this.#phase = 'running'; this.#started = this.#now(); return true; }
  getView() {
    return {
      seed: this.#seed, phase: this.#phase, rounds: this.#rows.length, left: MAX_ROUNDS - this.#rows.length,
      rows: this.#phase === 'paused' ? [] : this.#rows.map((r) => ({ ...r })),
      elapsedMs: Math.floor(this.#elapsedNow()),
      answer: ['won', 'lost'].includes(this.#phase) ? this.#secret : null,
    };
  }
  result() {
    if (!['won', 'lost'].includes(this.#phase)) return null;
    return { seed: this.#seed, outcome: this.#phase, rounds: this.#rows.length, elapsedMs: Math.floor(this.#elapsed) };
  }
}

export function validRecord(record) {
  if (!record) return false;
  try { validateSeed(record.seed); } catch { return false; }
  return ['won', 'lost'].includes(record.outcome) && Number.isInteger(record.rounds) && record.rounds >= 1 && record.rounds <= MAX_ROUNDS
    && (record.outcome !== 'lost' || record.rounds === MAX_ROUNDS) && Number.isInteger(record.elapsedMs) && record.elapsedMs >= 0;
}

// Retain only bounded score summaries, never secrets or old guess histories.
export function cleanRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.filter(validRecord).slice(0, RECORD_LIMIT).map((r) => ({
    seed: r.seed, outcome: r.outcome, rounds: r.rounds, elapsedMs: r.elapsedMs,
    finishedAt: typeof r.finishedAt === 'string' && r.finishedAt.length <= 32 ? r.finishedAt : '',
  }));
}
