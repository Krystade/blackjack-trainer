import type { SpreadRow } from './game';
import { firstRaiseTc, spreadHandsFor, spreadUnitsFor, entryTcOf, wongExitTcOf } from './wong';

/**
 * Wave K: A BETTING METHOD, the way a counter plays a game: when to sit down,
 * when to leave, and what to bet in between. The casino ranking works out
 * every method for every game and ranks each game by its best one.
 *
 *   - `entryTc` null: sit down at the shuffle and play from the top. A number:
 *     back-count, watching from the shuffle and sitting down only at a
 *     pre-deal true count >= it (needs mid-shoe entry).
 *   - `exitTc` null: never leave. A number: wong out, leaving the shoe at a
 *     pre-deal true count <= it.
 *   - `rampStartTc` null: the profile's ramp as it is. A number: the minimum
 *     bet below it, then the profile ramp's rows from there -- the whole ramp
 *     is moved so that its first raise lands on this count (see `methodSpread`).
 *   - `flat`: the minimum bet on every round played, no spread at all.
 *
 * Nothing here is strategy data: the counts are the user's choices (the
 * default set below is a menu of common choices, not a recommendation), and
 * the bets come from the user's own ramp.
 */
export interface BetMethod {
  id: string;
  /** Shown instead of the generated description when set. */
  label?: string;
  flat?: boolean;
  entryTc: number | null;
  exitTc: number | null;
  rampStartTc: number | null;
}

/** Every field of a method but its name (a Record, so a field added to BetMethod has to be listed here). */
const PLAY_FIELDS: Record<Exclude<keyof BetMethod, 'label'>, true> = { id: true, flat: true, entryTc: true, exitTc: true, rampStartTc: true };

/**
 * Wave Q re-review R5: whether two methods differ in nothing but their name,
 * compared field by field (`flat` absent and false alike) -- so no figure of
 * theirs changes: the name is not in the cache key.
 */
export function sameButLabel(a: BetMethod, b: BetMethod): boolean {
  return (Object.keys(PLAY_FIELDS) as (keyof typeof PLAY_FIELDS)[]).every((k) => (k === 'flat' ? (a.flat === true) === (b.flat === true) : a[k] === b[k]));
}

/** The ranges the custom-method editor offers, and what a stored method is clamped to. */
export const ENTRY_RANGE = [-2, 8] as const;
export const EXIT_RANGE = [-6, 3] as const;
export const RAMP_START_RANGE = [-2, 8] as const;

const clampInt = (n: unknown, [lo, hi]: readonly [number, number]): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;

/**
 * A stored or imported method, repaired; null when it cannot be one. An entry
 * at or below the exit would leave the moment it sat down, so it is refused.
 */
export function normMethod(x: unknown): BetMethod | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id !== '' ? o.id : null;
  if (!id) return null;
  const entryTc = clampInt(o.entryTc, ENTRY_RANGE);
  const exitTc = clampInt(o.exitTc, EXIT_RANGE);
  if (entryTc !== null && exitTc !== null && entryTc <= exitTc) return null;
  const m: BetMethod = {
    id,
    entryTc,
    exitTc,
    rampStartTc: o.flat === true ? null : clampInt(o.rampStartTc, RAMP_START_RANGE),
  };
  if (o.flat === true) m.flat = true;
  if (typeof o.label === 'string' && o.label.trim() !== '') m.label = o.label.trim().slice(0, 40);
  return m;
}

/** The part of a profile the methods read. */
export interface RampSource {
  spread: SpreadRow[];
  wongExitTc?: number;
  wongInTc?: number;
}

/**
 * The method's ramp. With a ramp start, every row of the profile ramp except
 * the bottom one moves by the same number of counts, so the first raise lands
 * on `rampStartTc` and the steps above it keep their spacing. A ramp that
 * never raises is returned as it is.
 */
export function methodSpread(m: BetMethod, spread: readonly SpreadRow[]): SpreadRow[] {
  if (m.flat) return [{ minTc: -99, units: 1 }];
  const sorted = [...spread].sort((a, b) => a.minTc - b.minTc);
  if (m.rampStartTc === null || sorted.length === 0) return sorted;
  const first = firstRaiseTc(sorted);
  if (first === null) return sorted;
  const shift = m.rampStartTc - first;
  return sorted.map((row, i) => (i === 0 ? row : { ...row, minTc: row.minTc + shift }));
}

/** Units on each hand, and how many hands, at a pre-deal true count. */
export function methodBet(spread: readonly SpreadRow[], tc: number): { units: number; hands: 1 | 2 } {
  return { units: spreadUnitsFor(tc, spread), hands: spreadHandsFor(tc, spread) };
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** "Back-count: in at +2, out at 0", "Ramp from +2, play all", "Flat min bet". */
export function describeMethod(m: BetMethod): string {
  if (m.label) return m.label;
  const bet = m.flat ? 'Flat min bet' : m.rampStartTc === null ? 'Profile ramp' : `Min bet to ${signed(m.rampStartTc)}, then ramp`;
  if (m.entryTc !== null) {
    return `${bet}, back-count in at ${signed(m.entryTc)}${m.exitTc !== null ? `, out at ${signed(m.exitTc)}` : ''}`;
  }
  if (m.exitTc !== null) return `${bet}, wong out at ${signed(m.exitTc)}`;
  return `${bet}, play all`;
}

/** The short badge a ranking row carries for its best method. */
export function methodBadge(m: BetMethod): string {
  if (m.entryTc !== null) return 'Back-count';
  if (m.exitTc !== null) return 'Wong out';
  if (m.flat) return 'Flat';
  return 'Play all';
}

/** The methods every game is worked out with, before the user's own are added. */
export function defaultMethods(p: RampSource): BetMethod[] {
  const exit = wongExitTcOf(p.wongExitTc);
  const entry = entryTcOf(p.wongInTc, p.wongExitTc);
  return [
    { id: 'flat', flat: true, entryTc: null, exitTc: null, rampStartTc: null },
    { id: 'ramp', entryTc: null, exitTc: null, rampStartTc: null },
    { id: 'wong-1', entryTc: null, exitTc: -1, rampStartTc: null },
    { id: 'wong-2', entryTc: null, exitTc: -2, rampStartTc: null },
    { id: 'wong-profile', entryTc: null, exitTc: exit, rampStartTc: null },
    { id: 'start+1', entryTc: null, exitTc: null, rampStartTc: 1 },
    { id: 'start+2', entryTc: null, exitTc: null, rampStartTc: 2 },
    { id: 'bc+1-1', entryTc: 1, exitTc: -1, rampStartTc: null },
    { id: 'bc+2+0', entryTc: 2, exitTc: 0, rampStartTc: null },
    { id: 'bc-profile', entryTc: entry, exitTc: exit, rampStartTc: null },
  ];
}

/** What makes two methods play the same: their effective entry, exit and actual ramp. */
function signature(m: BetMethod, spread: readonly SpreadRow[]): string {
  const ramp = methodSpread(m, spread)
    .map((r) => `${r.minTc}:${r.units}:${r.hands ?? 1}`)
    .join(',');
  // Every shoe starts at true count 0, so an entry at or below 0 sits down on
  // the first round: the same play as starting at the shuffle.
  const entry = m.entryTc !== null && m.entryTc > 0 ? m.entryTc : null;
  return `${entry}|${m.exitTc}|${ramp}`;
}

/**
 * Review N4: the method listed before `m` -- a default, or an earlier custom
 * one -- that plays exactly like it, so `methodsFor` computes it once under
 * that one; null when `m` is its own. `m` need not be in `custom` yet (the
 * add form asks before saving).
 */
export function duplicateOf(p: RampSource, custom: readonly BetMethod[], m: BetMethod): BetMethod | null {
  const sig = signature(m, p.spread);
  for (const x of [...defaultMethods(p), ...custom]) {
    if (x.id === m.id) return null;
    if (signature(x, p.spread) === sig) return x;
  }
  return null;
}

/**
 * The methods a game is worked out with: the defaults, then the user's own,
 * dropping any that would play exactly like one already listed (the profile's
 * own exit is often -1 or -2; a ramp start often equals the profile's own
 * first raise) and, when mid-shoe entry is not allowed, every back-count.
 */
export function methodsFor(p: RampSource, custom: readonly BetMethod[], midShoeEntry: 'allowed' | 'no' | 'unknown'): BetMethod[] {
  const seen = new Set<string>();
  const out: BetMethod[] = [];
  for (const m of [...defaultMethods(p), ...custom]) {
    if (m.entryTc !== null && midShoeEntry === 'no') continue;
    const sig = signature(m, p.spread);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(m);
  }
  return out;
}
