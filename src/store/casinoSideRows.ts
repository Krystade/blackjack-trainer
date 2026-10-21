import type { CasinoGame } from './casinoLog';
import type { CasinoSideBet } from './casinoSideBets';
import { ASSUMED_CUT, SIM_VERSION, simRules } from './casinoGameStats';
import { CUT_MIN_DECKS } from '../engine/cut';
import { CUT_FOR_DECKS, sideBetRow } from '../engine/sideBets/plan';
import type { SideBetRow } from '../engine/sideBets/plan';
import type { SideRowSpec } from '../engine/sideBets/build';
import { SIDE_SIM_VERSION, seedFor } from '../engine/sideBets/build';
import { subscribeToExternalWrites } from './crossTab';

/**
 * Wave L: a casino game's side bet, simulated at THAT game's cut.
 *
 * The generated table (engine/sideBets/generated.ts) holds every preset at
 * the standard cut for its deck count; a game cut anywhere else is simulated
 * in a worker (screens/casino/sideBet.worker.ts) and the row cached here.
 * Rebuildable data, like the game stats cache: never exported with the log.
 */

export const SIDE_ROWS_KEY = 'bjtrainer.casinoSideBets.v1';
/** Rounds a game's own side-bet run simulates: about a second on a laptop. */
export const CASINO_SIDE_ROUNDS = 300_000;
const MAX_CACHED = 120;

/** The cut a game's side bet is simulated at: the game's own (as the main simulator clamps it), to the quarter deck. */
export function sideCutOf(game: CasinoGame): number {
  const { rules } = simRules(game);
  const cut = game.cutDecksLeft ?? ASSUMED_CUT;
  const clamped = Math.min(Math.max(CUT_MIN_DECKS, rules.decks - CUT_MIN_DECKS), Math.max(CUT_MIN_DECKS, cut));
  return Math.round(clamped * 4) / 4;
}

export function sideRowSpec(game: CasinoGame, sb: CasinoSideBet): SideRowSpec {
  const { rules } = simRules(game);
  const s17 = sb.bet === 'buster' ? rules.s17 : null;
  const cutDecks = sideCutOf(game);
  const key = `${sb.bet}/${sb.payTable}/${rules.decks}/${s17 === null ? '-' : s17 ? 's17' : 'h17'}/${cutDecks}`;
  return { bet: sb.bet, payTable: sb.payTable, decks: rules.decks, s17, cutDecks, rounds: CASINO_SIDE_ROUNDS, seed: seedFor(key) };
}

/** The cache key: the spec, and the versions of both simulators (review S5) -- an engine fix retires every cached row. */
export function sideSpecKey(s: SideRowSpec): string {
  return `side${SIDE_SIM_VERSION}.sim${SIM_VERSION}/${s.bet}/${s.payTable}/${s.decks}/${s.s17 === null ? '-' : s.s17 ? 's17' : 'h17'}/${s.cutDecks}/${s.rounds}`;
}

type MinimalStore = Pick<Storage, 'getItem' | 'setItem'>;
const memory = new Map<string, string>();
const fallback: MinimalStore = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };
function store(): MinimalStore {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    /* sandboxed */
  }
  return fallback;
}

function loadAll(): Record<string, SideBetRow> {
  try {
    const raw = store().getItem(SIDE_ROWS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { version?: number; rows?: Record<string, SideBetRow> };
    return parsed.version === 1 && parsed.rows && typeof parsed.rows === 'object' ? parsed.rows : {};
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();

export function saveSideRow(spec: SideRowSpec, row: SideBetRow): void {
  const all = { ...loadAll(), [sideSpecKey(spec)]: row };
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_CACHED))) delete all[k];
  try {
    store().setItem(SIDE_ROWS_KEY, JSON.stringify({ version: 1, rows: all }));
  } catch {
    /* a lost cache recomputes */
  }
  for (const fn of [...listeners]) fn();
}

export function subscribeSideRows(fn: () => void): () => void {
  listeners.add(fn);
  const off = subscribeToExternalWrites([SIDE_ROWS_KEY], () => fn());
  return () => {
    listeners.delete(fn);
    off();
  };
}

/**
 * The row for a game's side bet: from the generated table when the game is
 * cut where it was simulated, else from the cache, else null (to be run).
 */
export function sideRowFor(game: CasinoGame, sb: CasinoSideBet): SideBetRow | null {
  const spec = sideRowSpec(game, sb);
  if (CUT_FOR_DECKS[spec.decks] === spec.cutDecks) {
    const gen = sideBetRow(spec.bet, spec.payTable, spec.decks, spec.s17 ?? true);
    if (gen) return gen;
  }
  return loadAll()[sideSpecKey(spec)] ?? null;
}
