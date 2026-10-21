/**
 * Mastery Challenge: walk EVERY cell in a chosen scope (#13: any of Hard /
 * Soft / Pairs, or a deck), exactly once, with no replacement. One wrong
 * answer wipes the run -- back to zero, with a fresh shuffle -- and the goal
 * is a clean sweep: every cell in the scope, correct, in one unbroken run.
 *
 * The walk is still exhaustive -- the point is proving you know ALL of it --
 * but since #29 its ORDER is not uniform: a seeded weighted shuffle puts the
 * cells the flashcard spaced-repetition schedule says are due (missed,
 * overdue, never seen) early in the sweep, where a run is most likely to
 * reach them. See docs/superpowers/plans/2026-08-31-B-mastery-challenge.md
 * for the original design rationale (Design Decisions D1-D10).
 */

import { generateAllCells, filterCellsByCategory } from './flashcards';
import type { Cell } from './flashcards';
import { fisherYatesShuffle, mulberry32 } from '../engine/cards';
import type { Card } from '../engine/cards';
import { eitherOrder, pickComposition } from './buildHand';
import type { HandScope } from './handScope';
import { srWeight } from './spacedRepetition';
import type { SrDeck } from './spacedRepetition';

/** The single-category scope older runs were stored under. */
export type MasteryScope = 'all' | 'hard' | 'soft' | 'pairs';

export interface MasteryRun {
  /** The seed that produced `order`. Only ever changes on a RESET (D2) --
   * a correct answer never reshuffles, so `seed` staying put is itself part
   * of the "no reshuffle on success" contract. */
  seed: number;
  /** Every cell id in the run's universe, shuffled once at run-start / reset
   * time. Fixed for the run's lifetime except across a reset. #13: the
   * universe is whatever the caller passed (a multi-select scope, a deck),
   * so the run carries its cells rather than a scope name. */
  order: string[];
  /** Index of the NEXT cell to present. Also equals "cells cleared so far
   * this run" -- a correct answer at `order[index]` increments this. */
  index: number;
}

/** All cells for `scope`, via the SAME filter drawFlashcard uses (D1) -- so
 * this challenge and ordinary Flashcards can never disagree about what the
 * universe for a given scope is. #13: `scope` may be a set of categories. */
export function cellsForScope(scope: MasteryScope | readonly HandScope[]): Cell[] {
  return filterCellsByCategory(generateAllCells(), scope);
}

/** The order a pre-#13 run was dealt in: a uniform shuffle of the scope's
 * cells in universe order. Kept so a run saved by an older build resumes on
 * the same hand. */
function legacyOrder(scope: MasteryScope, seed: number): string[] {
  const ids = cellsForScope(scope).map((c) => c.id);
  return fisherYatesShuffle(ids, mulberry32(seed));
}

/** A per-cell weight for the weighted shuffle; higher comes earlier. */
export type CellWeight = (cellId: string) => number;

/**
 * #29: a seeded weighted shuffle (Efraimidis-Spirakis A-Res). Each item draws
 * u in (0, 1] and gets the key u^(1/w); sorting by key, largest first, is a
 * weighted sample without replacement of the whole list -- so every item
 * appears exactly once, and an item twice as heavy is twice as likely to
 * come before another. The key is compared as ln(u)/w, the same order
 * without u^(1/w) underflowing for small weights. A non-positive or
 * non-finite weight is treated as a vanishingly small one, never dropped.
 */
export function weightedShuffle<T>(items: readonly T[], weightOf: (item: T) => number, rng: () => number): T[] {
  const keyed = items.map((item, i) => {
    const w = weightOf(item);
    const weight = Number.isFinite(w) && w > 0 ? w : 1e-9;
    const u = 1 - rng(); // (0, 1]: ln(0) would tie every unlucky draw at -Infinity
    return { item, key: Math.log(u) / weight, i };
  });
  keyed.sort((a, b) => b.key - a.key || a.i - b.i);
  return keyed.map((k) => k.item);
}

/** #29: the flashcard SR weight of each cell, as of `now` (epoch ms). */
export function srCellWeight(deck: SrDeck, now: number): CellWeight {
  return (cellId) => srWeight(deck[cellId], now);
}

/**
 * A fresh run over `cellIds` (the universe, in any order: it is sorted first,
 * so the deal depends only on the set of cells, the seed and the weights).
 * With `weightOf` (#29: the SR weight) the order is a weighted shuffle;
 * without it, a uniform one.
 */
export function startMasteryRun(cellIds: readonly string[], seed: number, weightOf?: CellWeight): MasteryRun {
  const sorted = [...cellIds].sort();
  const rng = mulberry32(seed);
  const order = weightOf ? weightedShuffle(sorted, weightOf, rng) : fisherYatesShuffle(sorted, rng);
  return { seed, order, index: 0 };
}

/**
 * Advance the run by one graded answer.
 * - correct: only `index` moves forward. `order`/`seed` are untouched --
 *   this is what "no reshuffle on success" means concretely (D2).
 * - incorrect: the ENTIRE run restarts over the same cells -- index to 0, a
 *   brand new shuffle (#29: weighted by `weightOf`, read fresh) from `nextSeed` (never `run.seed`, which would silently
 *   no-op the reshuffle). `nextSeed` is supplied by the caller (a component),
 *   which is the one place allowed to read a wall-clock/Math.random-derived
 *   seed -- this module itself never calls Date.now()/Math.random() (project
 *   rule).
 */
export function advanceMasteryRun(
  run: MasteryRun,
  correct: boolean,
  nextSeed: number,
  weightOf?: CellWeight,
  // Wave A review: the cells a MISS restarts over. A sweep resumed over other
  // cells than the Hands picked now (s10) loses its progress on a miss
  // anyway, so the restart follows the Hands picked now -- otherwise it read
  // "Carrying on your 0/330 sweep" and the next mount silently replaced it.
  restartOver: readonly string[] = run.order,
): MasteryRun {
  if (correct) return { ...run, index: run.index + 1 };
  const fresh = startMasteryRun(restartOver, nextSeed, weightOf);
  // Wave A F16 (spec #29): the cell just missed comes back early in the new
  // sweep. The reshuffle reads the FLASHCARD SR weights, which a Mastery miss
  // never reaches (mastery leaves that deck alone, D6), so the missed cell used
  // to land anywhere -- median 173rd of 330. It is now placed a short gap in:
  // not the very next hand (that is just reading the correction back), but
  // soon enough to be the retry the miss calls for.
  const missed = currentCellId(run);
  return missed === null ? fresh : { ...fresh, order: placeMissedEarly(fresh.order, missed) };
}

/** Wave A F16: where in the new sweep the just-missed cell is re-asked. */
export const MASTERY_MISS_RETRY_AT = 2;

/** `order` with `cellId` moved to MASTERY_MISS_RETRY_AT (or the end of a
 *  shorter run). Pure; the other cells keep their relative order. */
export function placeMissedEarly(order: readonly string[], cellId: string): string[] {
  if (!order.includes(cellId)) return [...order];
  const rest = order.filter((id) => id !== cellId);
  const at = Math.min(MASTERY_MISS_RETRY_AT, rest.length);
  return [...rest.slice(0, at), cellId, ...rest.slice(at)];
}

export function isMasteryRunComplete(run: MasteryRun): boolean {
  return run.index >= run.order.length;
}

/** The cell id the learner should be shown next, or null once the run is
 * complete (nothing left to present). */
export function currentCellId(run: MasteryRun): string | null {
  return isMasteryRunComplete(run) ? null : run.order[run.index];
}

/** True when `run` walks exactly the cells of `cellIds` -- the test for
 * resuming a saved run against the scope and deck chosen now. */
export function runCoversExactly(run: MasteryRun, cellIds: readonly string[]): boolean {
  if (run.order.length !== cellIds.length) return false;
  const want = new Set(cellIds);
  return run.order.every((id) => want.has(id));
}

/**
 * The cards a cell is SHOWN with at this point of the run (#18).
 *
 * `generateAllCells` stores one fixed representative per hard total (6+10
 * for every hard 16, forever), which teaches a card pair rather than a
 * total. A hard cell's cards are therefore drawn at presentation time with
 * the shared `pickComposition`. Seeded from the run's seed and position, so
 * the hand on screen is stable across re-renders and reloads but differs
 * between sweeps. Pairs and soft cells keep their stored cards.
 */
export function presentedCards(cell: Cell, run: Pick<MasteryRun, 'seed' | 'index'>): [Card, Card] {
  const seed = (run.seed ^ Math.imul(run.index + 1, 0x9e3779b1)) | 0;
  // Wave M: soft hands ace-first or ace-second, stable for this position.
  if (cell.id.startsWith('soft-')) return eitherOrder(cell.cards, mulberry32(seed));
  if (!cell.id.startsWith('hard-')) return cell.cards;
  const total = Number(cell.id.split('-')[1]);
  return pickComposition(total, mulberry32(seed)) ?? cell.cards;
}

/* ------------------------------------------------------------------ */
/* Persistence (D8). A run saved since #13 stores its `order`: the       */
/* universe is no longer a scope name it could be re-derived from (a     */
/* multi-select scope, a painted or marked deck). An older blob carries  */
/* `scope` instead and is re-derived exactly as it was dealt. Guarded    */
/* try/catch + typeof-window idiom matches gradeAnswer.ts's              */
/* loadSrDeck/saveSrDeck exactly.                                        */
/* ------------------------------------------------------------------ */

export interface PersistedMasteryRun {
  seed: number;
  index: number;
  order?: string[];
  /** Pre-#13 runs only. */
  scope?: MasteryScope;
}

const MASTERY_RUN_KEY = 'bjtrainer.masteryrun.v1';
const SCOPES: readonly MasteryScope[] = ['all', 'hard', 'soft', 'pairs'];

function isMasteryScope(value: unknown): value is MasteryScope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

const KNOWN_CELLS = new Set(generateAllCells().map((c) => c.id));

function isCellOrder(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === 'string' && KNOWN_CELLS.has(id)) &&
    new Set(value).size === value.length
  );
}

/** Reconstruct a full MasteryRun from what was persisted. An out-of-range
 * index restarts the same order at 0 -- corrupt/stale data degrades to
 * "start over", never a crash or an out-of-bounds currentCellId(). */
export function hydrateMasteryRun(persisted: PersistedMasteryRun | null): MasteryRun | null {
  if (!persisted) return null;
  if (typeof persisted.seed !== 'number' || typeof persisted.index !== 'number') return null;
  let order: string[];
  if (isCellOrder(persisted.order)) order = [...persisted.order];
  else if (isMasteryScope(persisted.scope)) order = legacyOrder(persisted.scope, persisted.seed);
  else return null;
  const index = persisted.index >= 0 && persisted.index <= order.length ? persisted.index : 0;
  return { seed: persisted.seed, order, index };
}

export function loadMasteryRun(): PersistedMasteryRun | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(MASTERY_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as PersistedMasteryRun;
  } catch {
    return null;
  }
}

export function saveMasteryRun(run: MasteryRun): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const persisted: PersistedMasteryRun = { seed: run.seed, index: run.index, order: run.order };
    window.localStorage.setItem(MASTERY_RUN_KEY, JSON.stringify(persisted));
  } catch {
    // best-effort persistence only, matching every other drill's SR-deck save
  }
}
