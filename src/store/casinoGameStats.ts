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
 * as the minimum bet. Resplitting aces is never logged, so never assumed.
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
 */

export const GAME_STATS_KEY = 'bjtrainer.casinoGameStats.v1';
/** Bump when the simulator changes what it computes, so every entry goes stale. */
export const SIM_VERSION = 1;

export type AssumedField = 'decks' | 's17' | 'das' | 'surrender' | 'payout' | 'cut' | 'minBet';

export interface SimInput {
  spec: SimSpec;
  key: string;
  seed: number;
  /** Rules simulated at the conservative choice because the game does not say. */
  assumed: AssumedField[];
  /** The cut the simulator actually used, in decks (clamped to the shoe). */
  cutUsed: number;
  methods: BetMethod[];
}

export const ASSUMED_CUT = 1.5;
export const ASSUMED_DECKS = 6;
export const FALLBACK_UNIT = 25;

/** The game's rules, every unknown filled with the conservative choice. */
export function simRules(game: CasinoGame): { rules: RuleSet; assumed: AssumedField[] } {
  const assumed: AssumedField[] = [];
  const pick = <T>(v: T | null | undefined, fallback: T, field: AssumedField): T => {
    if (v === null || v === undefined) {
      assumed.push(field);
      return fallback;
    }
    return v;
  };
  const rules: RuleSet = {
    decks: pick(game.decks, ASSUMED_DECKS, 'decks'),
    s17: pick(game.s17, false, 's17'),
    das: pick(game.das, false, 'das'),
    ls: pick(game.surrender, false, 'surrender'),
    rsa: false,
    bj65: pick(game.payout, '6:5' as const, 'payout') === '6:5',
  };
  return { rules, assumed };
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

export function simInputFor(game: CasinoGame, profile: Profile, custom: readonly BetMethod[]): SimInput {
  const { rules, assumed } = simRules(game);
  let cut = game.cutDecksLeft;
  if (cut === null || cut === undefined) {
    assumed.push('cut');
    cut = ASSUMED_CUT;
  }
  const cutUsed = Math.min(Math.max(CUT_MIN_DECKS, rules.decks - CUT_MIN_DECKS), Math.max(CUT_MIN_DECKS, cut));
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
  };
  const text = JSON.stringify({ v: SIM_VERSION, ...spec });
  const h = fnv1a(text);
  return { spec, key: `${SIM_VERSION}:${h.toString(36)}:${text.length.toString(36)}`, seed: h, assumed, cutUsed, methods };
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
