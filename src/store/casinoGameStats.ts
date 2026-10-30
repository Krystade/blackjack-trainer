import type { CasinoGame } from './casinoLog';
import type { Profile } from './types';
import { strategyRulesFor } from './profiles';
import { subscribeToExternalWrites } from './crossTab';
import { methodsFor, type BetMethod } from '../engine/betMethods';
import type { Accum, SimSpec } from '../engine/casinoSim';
import type { RunStatus } from '../engine/casinoRun';
import { simCutDecks } from '../engine/cut';
import { CUT_FOR_DECKS } from '../engine/sideBets/plan';
import { MULBERRY32_STEP } from '../engine/cards';
import type { RuleSet } from '../engine/ruleset';

/**
 * Wave K: what the ranking needs per logged game -- the simulator's input,
 * built from the game and the active Play profile, and the cache of results.
 *
 * THE INPUT. Unknown rules are simulated as the conservative choice and the
 * screen says "assumed" beside each one: 6 decks, H17, no DAS, no surrender,
 * 6:5 (the worse payout), the cut a quarter of the shoe from the end (assumedCutFor), the profile's unit
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
 * 6: audit lane C -- a single-deck cut down to a quarter deck is dealt as
 *    logged (C4), and the zero-count index cells read the running count's
 *    sign under truncate/round (C11).
 */
export const SIM_VERSION = 6;

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
  /** C4: a cut was logged, and the simulator dealt a different one (its own bound, simCutDecks). */
  cutClamped?: true;
  methods: BetMethod[];
  /** Wave M: dollars per $100 the simulation charged (0 = none). */
  commissionPer100: number;
}

/**
 * C8 (audit 2026-10-29): the cut an unlogged game is simulated at, by shoe.
 * It was 1.5 decks for every shoe, which is 75% dealt on six decks but 25%
 * on double deck (and clamped to half on single). Now the same depth for
 * every shoe -- a quarter of it behind the cut, the six-deck figure the app
 * already assumed -- and never shallower than the app's per-deck standard
 * cut (sideBets/plan.ts CUT_FOR_DECKS: half a deck on 1 and 2 decks), so
 * single deck is assumed at 50% dealt. Whichever is the larger (shallower)
 * of the two is used, as an unknown is filled with the worse choice.
 */
export const ASSUMED_PENETRATION_LEFT = 0.25;
export function assumedCutFor(shoeDecks: number): number {
  return Math.max(shoeDecks * ASSUMED_PENETRATION_LEFT, CUT_FOR_DECKS[shoeDecks] ?? 0);
}
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
    // C8: a continuous shuffler has no cut, so nothing is assumed of one.
    if (!game.csm) assumed.push('cut');
    cut = assumedCutFor(shoeDecks);
  }
  // C4: the simulator's own quarter-deck bound, not Play's half deck, so a
  // single-deck game is dealt at the cut it was logged with.
  const cutUsed = simCutDecks(cut, shoeDecks);
  const cutClamped = game.cutDecksLeft != null && cutUsed !== game.cutDecksLeft;
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
  // Review S4: a method's label is only its name -- renaming it changes no round -- so it is left out of the key.
  const text = JSON.stringify({ v: SIM_VERSION, ...spec, methods: spec.methods.map(({ label: _label, ...m }) => m) });
  const h = fnv1a(text);
  return { spec, key: `${SIM_VERSION}:${h.toString(36)}:${text.length.toString(36)}`, seed: h, assumed, cutUsed, ...(cutClamped ? { cutClamped: true as const } : {}), methods, commissionPer100: wm.commissionPer100 };
}

/**
 * Review S4: a stored result with its methods' names as they are now (by id):
 * a rename keeps the figures, and they should not show the old name.
 */
export function relabel(result: GameResult, methods: readonly BetMethod[]): GameResult {
  if (!result.methods) return result;
  const byId = new Map(methods.map((m) => [m.id, m]));
  let changed = false;
  const next = result.methods.map((x) => {
    const live = byId.get(x.method.id);
    if (!live || live.label === x.method.label) return x;
    changed = true;
    const method: BetMethod = { ...x.method };
    if (live.label === undefined) delete method.label;
    else method.label = live.label;
    return { ...x, method };
  });
  return changed ? { ...result, methods: next } : result;
}

/**
 * Wave Q: the seed of a game's `n`th run, for a result saved before the
 * continuation seeds (`GameResult.nextSeeds`) -- every later run is seeded
 * from those instead, and so deals exactly the draws after the last run's,
 * none of them twice. Run 0 is the input's own seed, so a game worked out in
 * one go deals exactly the rounds it always did.
 *
 * Review N4: every mulberry32 seed is a point on one 2^32 cycle (its state
 * steps by MULBERRY32_STEP), so two hashed seeds can land inside each
 * other's draws. Runs 1-7 here are placed 2^29 steps apart along the cycle
 * from run 0 (the count simulation's salted seed comes out spaced the same
 * way). Re-review R1: that stretch is NOT more than a run can use -- a two-
 * deck game at the round ceilings needs about 2.2 of them, a deep shoe cut
 * shallow more than the whole cycle, so no fixed slicing of it holds every
 * game -- which is why later runs carry on from where the last one stopped.
 * Past eight the stretches come back round; run n then starts in the second
 * half of stretch n mod 8, in one of sixteen 2^24-step slots: the half most
 * runs of the builds that used these seeds (short, time-capped) never got
 * past.
 */
const RNG_STEP = MULBERRY32_STEP;
export const SPACED_RUNS = 8;
const STRETCH = 2 ** 29;

/** The seed `steps` draws along the cycle from `seed`. */
const along = (seed: number, steps: number) => (seed + Math.imul(steps, RNG_STEP)) >>> 0;

export function runSeed(input: Pick<SimInput, 'key' | 'seed'>, n: number): number {
  if (n <= 0) return input.seed;
  if (n < SPACED_RUNS) return along(input.seed, n * STRETCH);
  return along(input.seed, (n % SPACED_RUNS) * STRETCH + STRETCH / 2 + ((n >> 3) % 16) * 2 ** 24);
}

// ---------------------------------------------------------------- the cache

/**
 * Wave Q: 'partial' -- figures worked out so far, with more to come on their
 * own (the quick first estimate, or a run paused when Casino closed). Every
 * other status is where a run of this key stopped: 'done' (both targets met),
 * 'time' (the cap), 'budget' (a test budget), 'cancelled' (stopped by hand,
 * builds before Wave Q).
 */
export type ResultStatus = RunStatus | 'cancelled' | 'partial';

export interface GameResult {
  /** The `simKey` the result was computed for. */
  key: string;
  computedAt: string;
  profileName: string;
  status: ResultStatus;
  /** Total time across every run merged into this result. */
  ms: number;
  basicRounds: number;
  countRounds: number;
  unit: number;
  basic: Accum;
  methods: { method: BetMethod; acc: Accum }[] | null;
  /** Wave Q: runs merged into this result (absent = 1). */
  runs?: number;
  /**
   * Wave Q re-review R1: the seeds the next run continues each stream from
   * (casinoRun.ts `RunProgress.seeds`). Absent on a result saved before
   * them; that one's next run takes `runSeed(input, runs)`.
   */
  nextSeeds?: { basic: number; count: number };
  /** Wave Q: the total time this result is allowed (absent = the automatic cap); "Run another minute" raises it. */
  capMs?: number;
}

type Results = Record<string, GameResult>;

/**
 * Wave Q: results for inputs no game has now, by key -- a rule changed back,
 * the Play profile switched back, a deleted game's twin. Looked up before
 * anything is worked out again, so going back costs nothing. The newest
 * ARCHIVE_MAX are kept.
 */
type Archive = Record<string, GameResult>;
export const ARCHIVE_MAX = 40;

type MinimalStore = Pick<Storage, 'getItem' | 'setItem'>;
let injected: MinimalStore | null = null;
const memory = new Map<string, string>();
const fallback: MinimalStore = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };

/** Tests only. Also forgets the session's unsaved copy (below). */
export function _setGameStatsStorage(s: MinimalStore | null): void {
  injected = s;
  unsaved = null;
}

/**
 * Wave Q review B1: the cache as it stands this session, when it could not be
 * saved (the phone's storage is full). Read in place of storage until a save
 * lands, so figures worked out this session still show -- and are not worked
 * out again and again, each time failing to save (simRunner.ts stops
 * scheduling a key whose save failed).
 */
let unsaved: { results: Results; archive: Archive } | null = null;

/** Whether this session holds figures that could not be saved. */
export function gameStatsUnsaved(): boolean {
  return unsaved !== null;
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

const readMap = (x: unknown): Results => {
  const out: Results = {};
  if (!isObj(x)) return out;
  for (const [id, r] of Object.entries(x)) {
    if (isObj(r) && typeof r.key === 'string' && isObj(r.basic)) out[id] = r as unknown as GameResult;
  }
  return out;
};

function readAll(): { results: Results; archive: Archive } {
  if (unsaved) return unsaved;
  try {
    const raw = store().getItem(GAME_STATS_KEY);
    if (!raw) return { results: {}, archive: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (!isObj(parsed) || parsed.version !== 1 || !isObj(parsed.results)) return { results: {}, archive: {} };
    return { results: readMap(parsed.results), archive: readMap(parsed.archive) };
  } catch {
    return { results: {}, archive: {} };
  }
}

/** Every cached result by game id. Unreadable storage reads as empty: it is all recomputable. */
export function loadGameResults(): Results {
  return readAll().results;
}

/** Wave Q: results kept by key for inputs no game has now. */
export function loadGameArchive(): Archive {
  return readAll().archive;
}

/** Wave Q: both, in one read. */
export function loadGameCache(): { results: Results; archive: Archive } {
  return readAll();
}

const listeners = new Set<() => void>();

/**
 * Wave W (review S2): keys kept in the archive however old -- the figures of
 * the games' earlier versions (casinoVersions.ts `earlierVersionKeys`), set
 * by the Casino screen whenever the log or the profile changes. They are
 * the only record of what those rules were worth, and no game asks for them
 * again to bring them back.
 */
let pinned: ReadonlySet<string> = new Set();
export function pinGameKeys(keys: Iterable<string>): void {
  pinned = new Set(keys);
}

/**
 * The newest ARCHIVE_MAX, minus any key a game's own result holds, and minus
 * keys from another SIM_VERSION (review N9: no input can ever produce them
 * again); a pinned key is kept beside them, whatever its age.
 */
function trimArchive(archive: Archive, results: Results): Archive {
  const live = new Set(Object.values(results).map((r) => r.key));
  const otherVersion = (k: string) => {
    const v = /^(\d+):/.exec(k);
    return v !== null && Number(v[1]) !== SIM_VERSION;
  };
  const usable = Object.entries(archive).filter(([k]) => !live.has(k) && !otherVersion(k));
  const kept = usable
    .filter(([k]) => !pinned.has(k))
    .sort(([, a], [, b]) => Date.parse(b.computedAt) - Date.parse(a.computedAt))
    .slice(0, ARCHIVE_MAX);
  return Object.fromEntries([...usable.filter(([k]) => pinned.has(k)), ...kept]);
}

/** Whether the save landed. When it did not, the session keeps the cache in memory (`unsaved`). */
function write(results: Results, archive: Archive): boolean {
  const trimmed = trimArchive(archive, results);
  let saved = false;
  try {
    const blob: { version: 1; results: Results; archive?: Archive } = { version: 1, results };
    if (Object.keys(trimmed).length > 0) blob.archive = trimmed;
    store().setItem(GAME_STATS_KEY, JSON.stringify(blob));
    saved = true;
  } catch {
    /* a full phone loses a cache, not data: the result shows until reload */
  }
  unsaved = saved ? null : { results, archive: trimmed };
  for (const fn of [...listeners]) fn();
  return saved;
}

/** A game's result; one it replaces for another key goes to the archive. False when it could not be saved (review B1). */
export function saveGameResult(gameId: string, result: GameResult): boolean {
  const { results, archive } = readAll();
  const prev = results[gameId];
  const nextArchive = prev && prev.key !== result.key ? { ...archive, [prev.key]: prev } : archive;
  return write({ ...results, [gameId]: result }, nextArchive);
}

/** Results for games no longer in the log go to the archive (a twin, or an undo, may want them). */
export function pruneGameResults(liveIds: ReadonlySet<string>): void {
  const { results, archive } = readAll();
  const gone = Object.entries(results).filter(([id]) => !liveIds.has(id));
  if (gone.length === 0) return;
  const kept = Object.fromEntries(Object.entries(results).filter(([id]) => liveIds.has(id)));
  const next = { ...archive };
  for (const [, r] of gone) if (!next[r.key] || Date.parse(next[r.key]!.computedAt) < Date.parse(r.computedAt)) next[r.key] = r;
  write(kept, next);
}

/** The one of two results for the same key that has more rounds behind it. */
function fuller(a: GameResult | undefined, b: GameResult): GameResult {
  if (!a) return b;
  return b.basicRounds + b.countRounds > a.basicRounds + a.countRounds ? b : a;
}

/**
 * Wave Q: a game's result for its inputs as they are now: its own, else any
 * other game's with the same key (two games dealt alike are worked out once),
 * else the archive's. Undefined when nothing has worked these inputs out.
 */
export function resultForKey(results: Readonly<Results>, archive: Readonly<Archive>, gameId: string, key: string): GameResult | undefined {
  const own = results[gameId];
  let best: GameResult | undefined = own?.key === key ? own : undefined;
  for (const r of Object.values(results)) if (r.key === key) best = fuller(best, r);
  return best ?? archive[key];
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

/**
 * Whether a stored result is for the game and setup as they are now. Wave Q:
 * `current` (resultForKey) is a result for these inputs found anywhere in the
 * cache; without one, the game's own older result is stale -- shown, marked,
 * until the new figures (worked out on their own) replace it.
 */
export function resultState(result: GameResult | undefined, key: string, current?: GameResult): ResultState {
  if (current && current.key === key) return { kind: 'current', result: current };
  if (!result) return { kind: 'none' };
  return result.key === key ? { kind: 'current', result } : { kind: 'stale', result };
}
