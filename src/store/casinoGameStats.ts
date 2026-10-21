import type { CasinoGame } from './casinoLog';
import type { Profile } from './types';
import { strategyRulesFor } from './profiles';
import { subscribeToExternalWrites } from './crossTab';
import { methodsFor, type BetMethod } from '../engine/betMethods';
import type { Accum, SimSpec } from '../engine/casinoSim';
import type { RunStatus } from '../engine/casinoRun';
import { CUT_MIN_DECKS } from '../engine/cut';
import type { RuleSet } from '../engine/ruleset';

/**
 * Wave K: what the ranking needs per logged game -- the simulator's input,
 * built from the game and the active Play profile, and the cache of results.
 *
 * THE INPUT. Unknown rules are simulated as the conservative choice and the
 * screen says "assumed" beside each one: 6 decks, H17, no DAS, no surrender,
 * 6:5 (the worse payout), the cut 1.5 decks from the end, the profile's unit
 * as the minimum bet. Two exceptions, by the owner's ruling (Wave P): an
 * unknown split cap is 4 hands and an unknown double-on is any two cards --
 * the best case, so those two can only flatter a game (BEST_CASE_ASSUMED).
 *
 * THE CACHE lives under its own key, not in the casino log: it is derived,
 * rebuildable data, it must never ride along in the log's export, and a
 * write here must not move a casino's `updatedAt` (which decides imports).
 * Each game's entry carries the hash of everything the simulation read
 * (`simKey`). When the game or the profile's counting setup changes, the
 * stored key no longer matches and the entry is STALE: shown, marked, with a
 * Re-run -- never passed off as current.
 *
 * Ruling: rounds per hour and the bankroll are NOT in the key. Neither
 * changes a single simulated round; they only scale the stored per-round
 * sums into hours and risk, which the screen does at display time, so
 * editing them updates the figures at once instead of forcing a re-run.
 * Nor are the minutes an exit costs (review B1): the sums carry each
 * method's exits and their per-shoe cross sums, so the time is charged at
 * display time too (casinoStats.ts `summarize`).
 *
 * The key is new with wave K, so no older build reads it: no v1/v2 key
 * split is needed here (unlike the casino log); SIM_VERSION covers changes
 * in what a stored entry holds.
 */

export const GAME_STATS_KEY = 'bjtrainer.casinoGameStats.v1';
/**
 * Bump when the simulator changes what it computes, so every entry goes stale.
 * 2: exits are counted and their time charged (entries from 1 have no exit sums).
 * 3: an exit on a shoe's last round is not counted (re-review R3).
 * 4: Wave M -- RSA, doubling split aces, the split cap, double-on and card-room
 *    commission are simulated; 4- and 5-deck shoes.
 * 5: Wave P -- an unknown split cap is simulated at 4 hands and an unknown
 *    double-on at any two cards (were 2 hands and 10-11).
 */
export const SIM_VERSION = 5;

export type AssumedField =
  | 'decks' | 's17' | 'das' | 'surrender' | 'payout' | 'cut' | 'minBet'
  // Wave M
  | 'rsa' | 'doubleSplitAces' | 'maxSplitHands' | 'doubleOn' | 'commission';

/**
 * Wave M: the choice for each new rule when the game does not say -- no
 * resplitting or doubling of aces (the conservative choice). Commission: none
 * at a casino (they do not charge it); at a card room,
 * ASSUMED_COMMISSION_PER_100, which is what every California card room in the
 * owner's notes that states one charges ($1 per $100).
 *
 * Wave P, owner's ruling: the split cap and double-on are assumed at the BEST
 * case, split to 4 hands and double any two cards, not the conservative 2 /
 * 10-11. Those two are the only assumptions that can make a figure too good.
 */
export const ASSUMED_MAX_SPLIT_HANDS: 2 | 3 | 4 = 4;
export const ASSUMED_DOUBLE_ON: 'any2' | '9-11' | '10-11' = 'any2';
export const ASSUMED_COMMISSION_PER_100 = 1;
/** The assumed fields simulated at the best case rather than the conservative choice. */
export const BEST_CASE_ASSUMED: readonly AssumedField[] = ['maxSplitHands', 'doubleOn'];

export interface SimInput {
  spec: SimSpec;
  key: string;
  seed: number;
  /** Fields the game does not say, simulated at the assumed choice (conservative, or BEST_CASE_ASSUMED). */
  assumed: AssumedField[];
  /** The cut the simulator actually used, in decks (clamped to the shoe). */
  cutUsed: number;
  methods: BetMethod[];
  /** Wave M: dollars per $100 the simulation charged (0 = none). */
  commissionPer100: number;
}

export const ASSUMED_CUT = 1.5;
export const ASSUMED_DECKS = 6;
export const FALLBACK_UNIT = 25;

/** The game's RuleSet rules, every unknown filled with the conservative choice. */
export function simRules(game: CasinoGame): { rules: RuleSet; assumed: AssumedField[] } {
  const assumed: AssumedField[] = [];
  const pick = <T>(v: T | null | undefined, fallback: T, field: AssumedField): T => {
    if (v === null || v === undefined) {
      assumed.push(field);
      return fallback;
    }
    return v;
  };
  const shoe = pick(game.decks, ASSUMED_DECKS, 'decks');
  const rules: RuleSet = {
    // 4 and 5 decks: the multi-deck chart, as charts/index.ts reads any 4+;
    // the physical shoe size travels separately (`shoeDecksOf`).
    decks: shoe === 4 || shoe === 5 ? 6 : shoe,
    s17: pick(game.s17, false, 's17'),
    das: pick(game.das, false, 'das'),
    ls: pick(game.surrender, false, 'surrender'),
    rsa: pick(game.rsa, false, 'rsa'),
    bj65: pick(game.payout, '6:5' as const, 'payout') === '6:5',
  };
  return { rules, assumed };
}

/** Wave M: the rules RuleSet has no room for, unknowns filled with the assumed choice (best case for the split cap and double-on). */
export function simExtras(
  game: CasinoGame,
  kind: 'casino' | 'cardroom' | undefined,
): { extras: Pick<SimSpec, 'shoeDecks' | 'maxSplitHands' | 'doubleOn' | 'doubleSplitAces' | 'commissionPct'>; assumed: AssumedField[]; commissionPer100: number } {
  const assumed: AssumedField[] = [];
  const extras: Pick<SimSpec, 'shoeDecks' | 'maxSplitHands' | 'doubleOn' | 'doubleSplitAces' | 'commissionPct'> = {};
  if (game.decks === 4 || game.decks === 5) extras.shoeDecks = game.decks;
  if (game.doubleSplitAces == null) assumed.push('doubleSplitAces');
  if (game.doubleSplitAces === true) extras.doubleSplitAces = true;
  const split = game.maxSplitHands ?? (assumed.push('maxSplitHands'), ASSUMED_MAX_SPLIT_HANDS);
  if (split !== 4) extras.maxSplitHands = split;
  const on = game.doubleOn ?? (assumed.push('doubleOn'), ASSUMED_DOUBLE_ON);
  if (on !== 'any2') extras.doubleOn = on;
  let fee = game.commissionPer100;
  if (fee == null) {
    if (kind === 'cardroom') {
      assumed.push('commission');
      fee = ASSUMED_COMMISSION_PER_100;
    } else fee = 0;
  }
  if (fee > 0) extras.commissionPct = fee;
  return { extras, assumed, commissionPer100: fee };
}

/** FNV-1a, 32-bit: a stable hash of the input text (a cache key and a seed, not security). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function simInputFor(
  game: CasinoGame,
  profile: Profile,
  custom: readonly BetMethod[],
  kind?: 'casino' | 'cardroom',
): SimInput {
  const { rules, assumed } = simRules(game);
  const wm = simExtras(game, kind);
  assumed.push(...wm.assumed);
  const shoeDecks = wm.extras.shoeDecks ?? rules.decks;
  let cut = game.cutDecksLeft;
  if (cut === null || cut === undefined) {
    assumed.push('cut');
    cut = ASSUMED_CUT;
  }
  const cutUsed = Math.min(Math.max(CUT_MIN_DECKS, shoeDecks - CUT_MIN_DECKS), Math.max(CUT_MIN_DECKS, cut));
  let unit = game.minBet;
  if (unit === null || unit === undefined || !(unit > 0)) {
    assumed.push('minBet');
    unit = profile.unitDollars && profile.unitDollars > 0 ? profile.unitDollars : FALLBACK_UNIT;
  }
  const methods = game.csm ? [] : methodsFor(profile, custom, game.midShoeEntry);
  const spec: SimSpec = {
    rules: strategyRulesFor({ ...profile, rules }),
    cutDecks: cutUsed,
    csm: game.csm,
    unit,
    maxBet: game.maxBet ?? null,
    spread: [...profile.spread].sort((a, b) => a.minTc - b.minTc),
    tcRounding: profile.tcRounding ?? 'floor',
    indices: profile.gradeDeviations !== false,
    methods,
    ...wm.extras,
  };
  const text = JSON.stringify({ v: SIM_VERSION, ...spec });
  const h = fnv1a(text);
  return { spec, key: `${SIM_VERSION}:${h.toString(36)}:${text.length.toString(36)}`, seed: h, assumed, cutUsed, methods, commissionPer100: wm.commissionPer100 };
}

// ---------------------------------------------------------------- the cache

export interface GameResult {
  /** The `simKey` the result was computed for. */
  key: string;
  computedAt: string;
  profileName: string;
  status: RunStatus | 'cancelled';
  ms: number;
  basicRounds: number;
  countRounds: number;
  unit: number;
  basic: Accum;
  methods: { method: BetMethod; acc: Accum }[] | null;
}

type Results = Record<string, GameResult>;

type MinimalStore = Pick<Storage, 'getItem' | 'setItem'>;
let injected: MinimalStore | null = null;
const memory = new Map<string, string>();
const fallback: MinimalStore = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };

/** Tests only. */
export function _setGameStatsStorage(s: MinimalStore | null): void {
  injected = s;
}

function store(): MinimalStore {
  if (injected) return injected;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    /* sandboxed */
  }
  return fallback;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Every cached result by game id. Unreadable storage reads as empty: it is all recomputable. */
export function loadGameResults(): Results {
  try {
    const raw = store().getItem(GAME_STATS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!isObj(parsed) || parsed.version !== 1 || !isObj(parsed.results)) return {};
    const out: Results = {};
    for (const [id, r] of Object.entries(parsed.results)) {
      if (isObj(r) && typeof r.key === 'string' && isObj(r.basic)) out[id] = r as unknown as GameResult;
    }
    return out;
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();

function write(results: Results): void {
  try {
    store().setItem(GAME_STATS_KEY, JSON.stringify({ version: 1, results }));
  } catch {
    /* a full phone loses a cache, not data: the result shows until reload */
  }
  for (const fn of [...listeners]) fn();
}

export function saveGameResult(gameId: string, result: GameResult): void {
  write({ ...loadGameResults(), [gameId]: result });
}

/** Drop results for games no longer in the log. */
export function pruneGameResults(liveIds: ReadonlySet<string>): void {
  const all = loadGameResults();
  const kept = Object.fromEntries(Object.entries(all).filter(([id]) => liveIds.has(id)));
  if (Object.keys(kept).length !== Object.keys(all).length) write(kept);
}

export function subscribeGameResults(fn: () => void): () => void {
  listeners.add(fn);
  const off = subscribeToExternalWrites([GAME_STATS_KEY], () => fn());
  return () => {
    listeners.delete(fn);
    off();
  };
}

export type ResultState = { kind: 'none' } | { kind: 'current'; result: GameResult } | { kind: 'stale'; result: GameResult };

/** Whether a stored result is for the game and setup as they are now. */
export function resultState(result: GameResult | undefined, key: string): ResultState {
  if (!result) return { kind: 'none' };
  return result.key === key ? { kind: 'current', result } : { kind: 'stale', result };
}
