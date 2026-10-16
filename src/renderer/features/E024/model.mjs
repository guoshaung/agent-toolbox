import { WORDS, normalizeAnswer, matchesWord } from './words.mjs';

export const MAX_GUESSES = 100;
export const SUMMARY_LIMIT = 10;
const clone = (value) => JSON.parse(JSON.stringify(value));

export function validateOptions(options) {
  if (!options || !Array.isArray(options.players) || options.players.length < 2 || options.players.length > 4) throw new RangeError('需要 2–4 名玩家。');
  const players = options.players.map((p) => typeof p === 'string' ? p.trim() : '');
  if (players.some((p) => !p || p.length > 20 || /[\u0000-\u001f\u007f]/.test(p)) || new Set(players).size !== players.length) throw new RangeError('玩家名称须不同，各为 1–20 个字符。');
  if (!Number.isInteger(options.roundsPerPlayer) || options.roundsPerPlayer < 1 || options.roundsPerPlayer > 2) throw new RangeError('每人作画轮数须为 1–2 的整数。');
  if (!Number.isInteger(options.durationSeconds) || options.durationSeconds < 30 || options.durationSeconds > 180) throw new RangeError('每轮时长须为 30–180 秒的整数。');
  if (typeof options.seed !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(options.seed)) throw new RangeError('局号须为 1–32 位字母、数字、下划线或短横线。');
  return { players, roundsPerPlayer: options.roundsPerPlayer, durationSeconds: options.durationSeconds, seed: options.seed };
}
export function wordDeck(seed) {
  validateOptions({ players: ['A', 'B'], roundsPerPlayer: 1, durationSeconds: 60, seed });
  const deck = [...WORDS]; let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619) >>> 0;
  for (let i = deck.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(state / 4294967296 * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function ranking(players, scores) {
  const rows = scores.map((score, playerIndex) => ({ playerIndex, playerName: players[playerIndex], score })).sort((a, b) => b.score - a.score || a.playerIndex - b.playerIndex);
  rows.forEach((r, i) => { r.rank = i > 0 && r.score === rows[i - 1].score ? rows[i - 1].rank : i + 1; }); return rows;
}

export class DrawGuess {
  #options; #deck; #choices; #word = null; #phase = 'handoff'; #rounds = []; #guesses = []; #scores;
  #remaining; #started = null; #lastGuess = null; #now;
  constructor(options, { now = () => Date.now() } = {}) {
    this.#options = validateOptions(options); this.#deck = wordDeck(options.seed); this.#choices = this.#deck.splice(0, 3);
    this.#scores = this.#options.players.map(() => 0); this.#remaining = options.durationSeconds * 1000; this.#now = now;
  }
  #remainingNow() { return Math.max(0, this.#remaining - (this.#started === null ? 0 : Math.max(0, this.#now() - this.#started))); }
  #elapsedNow() { return Math.floor(this.#options.durationSeconds * 1000 - this.#remainingNow()); }
  #drawer() { return this.#rounds.length % this.#options.players.length; }
  #finish(reason, guesserIndex = null) {
    const drawerIndex = this.#drawer(); const elapsedMs = this.#elapsedNow();
    if (reason === 'correct') { this.#scores[drawerIndex]++; this.#scores[guesserIndex]++; }
    this.#rounds.push({ number: this.#rounds.length + 1, drawerIndex, drawerName: this.#options.players[drawerIndex], word: clone(this.#word), reason, guesserIndex,
      guesserName: guesserIndex === null ? null : this.#options.players[guesserIndex], elapsedMs, guesses: this.#guesses });
    this.#started = null; this.#remaining = this.#options.durationSeconds * 1000; this.#word = null; this.#guesses = []; this.#lastGuess = null;
    if (this.#rounds.length === this.#options.players.length * this.#options.roundsPerPlayer) { this.#phase = 'finished'; this.#remaining = 0; }
    else { this.#phase = 'handoff'; this.#choices = this.#deck.splice(0, 3); }
  }
  #sync() { if (this.#phase === 'drawing' && this.#remainingNow() <= 0) this.#finish('timeout'); }
  revealChoices() { if (this.#phase !== 'handoff') return false; this.#phase = 'choosing'; return true; }
  selectWord(id) { if (this.#phase !== 'choosing') return false; const word = this.#choices.find((w) => w.id === id); if (!word) return false; this.#word = word; return true; }
  startDrawing() { if (this.#phase !== 'choosing' || !this.#word) return false; this.#phase = 'drawing'; this.#started = this.#now(); return true; }
  guess(playerIndex, text, roundNumber) {
    this.#sync();
    if (this.#phase !== 'drawing' || roundNumber !== this.#rounds.length + 1) return { ok: false, reason: 'notDrawing' };
    if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= this.#scores.length || playerIndex === this.#drawer()) return { ok: false, reason: 'invalidPlayer' };
    try { normalizeAnswer(text); } catch { return { ok: false, reason: 'invalidText' }; }
    if (this.#guesses.length >= MAX_GUESSES) return { ok: false, reason: 'guessLimit' };
    const now = this.#now(); if (this.#lastGuess !== null && now - this.#lastGuess < 300) return { ok: false, reason: 'cooldown' };
    this.#lastGuess = now; const correct = matchesWord(this.#word, text);
    this.#guesses.push({ playerIndex, playerName: this.#options.players[playerIndex], text: text.trim(), correct, atMs: this.#elapsedNow() });
    if (correct) this.#finish('correct', playerIndex);
    return { ok: true, correct };
  }
  endRound(roundNumber) { this.#sync(); if (this.#phase !== 'drawing' || roundNumber !== this.#rounds.length + 1) return false; this.#finish('manual'); return true; }
  pause() {
    this.#sync(); if (this.#phase === 'choosing') { this.#phase = 'handoff'; return true; }
    if (this.#phase !== 'drawing') return false;
    this.#remaining = this.#remainingNow(); this.#started = null; this.#phase = 'paused'; return true;
  }
  resume() { if (this.#phase !== 'paused') return false; this.#started = this.#now(); this.#phase = 'drawing'; return true; }
  getView() {
    this.#sync();
    return { options: clone(this.#options), phase: this.#phase, scores: [...this.#scores], totalRounds: this.#options.players.length * this.#options.roundsPerPlayer,
      completedRounds: this.#rounds.length, roundNumber: this.#rounds.length + 1, drawerIndex: this.#phase === 'finished' ? null : this.#drawer(), remainingMs: Math.floor(this.#remainingNow()),
      choices: this.#phase === 'choosing' ? clone(this.#choices) : [], selectedId: this.#phase === 'choosing' ? this.#word?.id || null : null,
      guesses: this.#phase === 'drawing' ? clone(this.#guesses) : [], lastRound: this.#rounds.length ? clone(this.#rounds.at(-1)) : null };
  }
  result() { this.#sync(); if (this.#phase !== 'finished') return null; return clone({ feature: 'E024', version: 1, wordVersion: 1, options: this.#options,
    scoring: { drawer: 1, correctGuesser: 1, timeout: 0, skip: 0 }, scores: this.#scores, ranking: ranking(this.#options.players, this.#scores), rounds: this.#rounds }); }
}

export function cleanSummaries(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, SUMMARY_LIMIT).filter((s) => {
    try { const options = validateOptions(s?.options); const total = options.players.length * options.roundsPerPlayer; return Array.isArray(s.scores) && s.scores.length === options.players.length && s.scores.every((n) => Number.isInteger(n) && n >= 0 && n <= total)
      && s.scores.reduce((sum, n) => sum + n, 0) <= total * 2 && s.scores.reduce((sum, n) => sum + n, 0) % 2 === 0
      && typeof s.finishedAt === 'string' && s.finishedAt.length <= 32; } catch { return false; }
  }).map((s) => ({ options: validateOptions(s.options), scores: [...s.scores], finishedAt: s.finishedAt }));
}
