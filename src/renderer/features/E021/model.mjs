import { CARDS, PACKS } from './cards.mjs';

export const SCORING = Object.freeze({ hit: 1, skip: 0, foul: -1, unanswered: 0 });
export const REPORT_LIMIT = 3;
export const ACTION_COOLDOWN_MS = 250;
const clone = (value) => JSON.parse(JSON.stringify(value));

export function validateOptions(options) {
  if (!options || !Array.isArray(options.teams) || options.teams.length !== 2) throw new RangeError('请填写两个队伍名称。');
  const teams = options.teams.map((name) => typeof name === 'string' ? name.trim() : '');
  if (teams.some((name) => !name || name.length > 20 || /[\u0000-\u001f\u007f]/.test(name)) || teams[0] === teams[1]) throw new RangeError('两队名称须不同，各为 1–20 个字符。');
  if (!Number.isInteger(options.roundsPerTeam) || options.roundsPerTeam < 1 || options.roundsPerTeam > 5) throw new RangeError('每队轮数须为 1–5 的整数。');
  if (!Number.isInteger(options.durationSeconds) || options.durationSeconds < 30 || options.durationSeconds > 180) throw new RangeError('每轮时长须为 30–180 秒的整数。');
  if (!Object.hasOwn(PACKS, options.pack)) throw new RangeError('请选择内置题包。');
  if (typeof options.seed !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(options.seed)) throw new RangeError('局号须为 1–32 位字母、数字、下划线或短横线。');
  return { teams, roundsPerTeam: options.roundsPerTeam, durationSeconds: options.durationSeconds, pack: options.pack, seed: options.seed };
}

export function shuffledDeck(pack, seed) {
  validateOptions({ teams: ['A', 'B'], roundsPerTeam: 1, durationSeconds: 60, pack, seed });
  const deck = CARDS.filter((card) => pack === 'all' || card.pack === pack);
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619) >>> 0;
  for (let i = deck.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(state / 4294967296 * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function counts(events) { return Object.fromEntries(Object.keys(SCORING).map((outcome) => [outcome, events.filter((e) => e.outcome === outcome).length])); }
function winner(scores) { return scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1; }

export class Taboo {
  #options;
  #deck;
  #next = 0;
  #card = null;
  #phase = 'ready';
  #rounds = [];
  #events = [];
  #scores = [0, 0];
  #remaining = 0;
  #started = null;
  #lastAction = null;
  #reason = null;
  #now;
  constructor(options, { now = () => Date.now() } = {}) {
    this.#options = validateOptions(options); this.#deck = shuffledDeck(this.#options.pack, this.#options.seed); this.#now = now;
    this.#remaining = this.#options.durationSeconds * 1000;
  }
  #remainingNow() { return Math.max(0, this.#remaining - (this.#started === null ? 0 : Math.max(0, this.#now() - this.#started))); }
  #elapsedNow() { return this.#options.durationSeconds * 1000 - this.#remainingNow(); }
  #deal() { this.#card = this.#deck[this.#next] || null; if (this.#card) this.#next++; return this.#card !== null; }
  #ticket() { return this.#card ? `${this.#rounds.length + 1}:${this.#card.id}` : null; }
  #event(outcome, atMs = Math.floor(this.#elapsedNow())) {
    return { cardId: this.#card.id, target: this.#card.target, forbidden: [...this.#card.forbidden], outcome, delta: SCORING[outcome], atMs };
  }
  #settle(reason) {
    const elapsedMs = Math.floor(this.#elapsedNow());
    if (this.#card) this.#events.push(this.#event('unanswered', elapsedMs));
    const teamIndex = this.#rounds.length % 2;
    const scoreDelta = this.#events.reduce((sum, e) => sum + e.delta, 0);
    this.#rounds.push({ number: this.#rounds.length + 1, teamIndex, teamName: this.#options.teams[teamIndex], elapsedMs, reason, counts: counts(this.#events), scoreDelta, events: this.#events });
    this.#remaining = this.#remainingNow(); this.#started = null; this.#card = null;
    if (reason === 'deckExhausted' || this.#rounds.length === this.#options.roundsPerTeam * 2) {
      this.#phase = 'finished'; this.#reason = reason === 'deckExhausted' ? 'deckExhausted' : 'plannedRounds';
    } else this.#phase = 'between';
  }
  #sync() { if (this.#phase === 'running' && this.#remainingNow() <= 0) this.#settle('timeout'); }
  startRound() {
    if (!['ready', 'between'].includes(this.#phase)) return false;
    this.#events = []; this.#remaining = this.#options.durationSeconds * 1000; this.#started = this.#now(); this.#lastAction = null;
    this.#phase = 'running'; this.#deal(); return true;
  }
  judge(outcome, ticket) {
    this.#sync();
    if (this.#phase !== 'running') return { ok: false, reason: 'notRunning' };
    if (!['hit', 'skip', 'foul'].includes(outcome)) return { ok: false, reason: 'invalidOutcome' };
    if (ticket !== this.#ticket()) return { ok: false, reason: 'staleCard' };
    const now = this.#now();
    if (this.#lastAction !== null && now - this.#lastAction < ACTION_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
    this.#lastAction = now;
    const event = this.#event(outcome); this.#events.push(event); this.#scores[this.#rounds.length % 2] += event.delta;
    this.#card = null;
    if (!this.#deal()) this.#settle('deckExhausted');
    return { ok: true, ...event };
  }
  endRound(number) {
    this.#sync();
    if (this.#phase !== 'running' || number !== this.#rounds.length + 1) return false;
    this.#settle('manual'); return true;
  }
  pause() {
    this.#sync(); if (this.#phase !== 'running') return false;
    this.#remaining = this.#remainingNow(); this.#started = null; this.#phase = 'paused'; return true;
  }
  resume() { if (this.#phase !== 'paused') return false; this.#started = this.#now(); this.#phase = 'running'; return true; }
  getView() {
    this.#sync();
    const roundNumber = Math.min(this.#rounds.length + 1, this.#options.roundsPerTeam * 2);
    const teamIndex = this.#phase === 'finished' ? null : this.#rounds.length % 2;
    return {
      options: clone(this.#options), phase: this.#phase, scores: [...this.#scores], roundNumber, totalRounds: this.#options.roundsPerTeam * 2, teamIndex,
      remainingMs: Math.floor(this.#remainingNow()), deckLeft: this.#deck.length - this.#next, cardsUsed: this.#next, deckSize: this.#deck.length,
      card: this.#phase === 'running' ? clone(this.#card) : null, ticket: this.#phase === 'running' ? this.#ticket() : null,
      currentCounts: counts(this.#events), lastRound: this.#rounds.length ? clone(this.#rounds.at(-1)) : null,
    };
  }
  result() {
    this.#sync(); if (this.#phase !== 'finished') return null;
    return clone({ feature: 'E021', version: 1, deckVersion: 1, options: this.#options, scoring: SCORING, reason: this.#reason, scores: this.#scores, winner: winner(this.#scores), cardsUsed: this.#next, rounds: this.#rounds });
  }
}

/** Parse only complete, internally consistent, bounded reports, rebuilding canonical card data. */
export function cleanReport(value) {
  try {
    if (!value || value.feature !== 'E021' || value.version !== 1 || value.deckVersion !== 1) return null;
    const options = validateOptions(value.options);
    const deck = shuffledDeck(options.pack, options.seed);
    if (!Array.isArray(value.rounds) || value.rounds.length < 1 || value.rounds.length > options.roundsPerTeam * 2) return null;
    if (!['plannedRounds', 'deckExhausted'].includes(value.reason) || (value.reason === 'plannedRounds' && value.rounds.length !== options.roundsPerTeam * 2)) return null;
    let index = 0; const scores = [0, 0]; const rounds = [];
    for (const [i, round] of value.rounds.entries()) {
      if (!round || round.number !== i + 1 || round.teamIndex !== i % 2 || !['timeout', 'manual', 'deckExhausted'].includes(round.reason)
        || !Number.isInteger(round.elapsedMs) || round.elapsedMs < 0 || round.elapsedMs > options.durationSeconds * 1000
        || (round.reason === 'timeout' && round.elapsedMs !== options.durationSeconds * 1000)
        || !Array.isArray(round.events) || !round.events.length || round.events.length > deck.length) return null;
      let lastAt = 0; const events = [];
      for (const [j, event] of round.events.entries()) {
        const card = deck[index++];
        if (!card || event?.cardId !== card.id || !Object.hasOwn(SCORING, event?.outcome) || !Number.isInteger(event.atMs)
          || event.atMs < lastAt || event.atMs > round.elapsedMs || (event.outcome === 'unanswered' && j !== round.events.length - 1)) return null;
        lastAt = event.atMs;
        events.push({ cardId: card.id, target: card.target, forbidden: [...card.forbidden], outcome: event.outcome, delta: SCORING[event.outcome], atMs: event.atMs });
      }
      const last = events.at(-1);
      if ((round.reason === 'deckExhausted' && (i !== value.rounds.length - 1 || last.outcome === 'unanswered'))
        || (round.reason !== 'deckExhausted' && last.outcome !== 'unanswered')) return null;
      const scoreDelta = events.reduce((sum, e) => sum + e.delta, 0); scores[i % 2] += scoreDelta;
      rounds.push({ number: i + 1, teamIndex: i % 2, teamName: options.teams[i % 2], elapsedMs: round.elapsedMs, reason: round.reason, counts: counts(events), scoreDelta, events });
    }
    if (index !== value.cardsUsed || (value.reason === 'deckExhausted' && (index !== deck.length || rounds.at(-1).reason !== 'deckExhausted'))
      || (value.reason === 'plannedRounds' && rounds.some((r) => r.reason === 'deckExhausted'))) return null;
    return { feature: 'E021', version: 1, deckVersion: 1, options, scoring: { ...SCORING }, reason: value.reason, scores, winner: winner(scores), cardsUsed: index, rounds,
      finishedAt: typeof value.finishedAt === 'string' && value.finishedAt.length <= 32 ? value.finishedAt : '' };
  } catch { return null; }
}

export function cleanReports(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, REPORT_LIMIT).map(cleanReport).filter(Boolean);
}
