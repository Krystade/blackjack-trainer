/**
 * Mastery Challenge: walk EVERY cell in a chosen scope (#13: any of Hard /
 * Soft / Pairs, or a deck) in random order, exactly once, with no replacement. One wrong answer
 * wipes the run -- back to zero, with a fresh shuffle -- and the goal is a
 * clean sweep: every cell in the scope, correct, in one unbroken run.
 *
 * This is deliberately NOT a weighted/SR-scheduled draw like drawFlashcard --
 * it's the opposite: an exhaustive, unbiased walk of a fixed deck, because
 * the whole point is proving you know ALL of it, not the cells you're weakest
 * on. See docs/superpowers/plans/2026-08-31-B-mastery-challenge.md for the
 * full design rationale (Design Decisions D1-D10).
 */

import { generateAllCells, filterCellsByCategory } from './flashcards';
import type { Cell } from './flashcards';
import { fisherYatesShuffle, mulberry32 } from '../engine/cards';
import type { Card } from '../engine/cards';
import { pickComposition } from './buildHand';
import type { HandScope } from './handScope';

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

/** A fresh run over `cellIds` (the universe, in any order: it is sorted
 * first, so the deal depends only on the set of cells and the seed). */
export function startMasteryRun(cellIds: readonly string[], seed: number): MasteryRun {
  return { seed, order: fisherYatesShuffle([...cellIds].sort(), mulberry32(seed)), index: 0 };
}

/**
 * Advance the run by one graded answer.
 * - correct: only `index` moves forward. `order`/`seed` are untouched --
 *   this is what "no reshuffle on success" means concretely (D2).
 * - incorrect: the ENTIRE run restarts over the same cells -- index to 0, a
 *   brand new shuffle from `nextSeed` (never `run.seed`, which would silently
 *   no-op the reshuffle). `nextSeed` is supplied by the caller (a component),
 *   which is the one place allowed to read a wall-clock/Math.random-derived
 *   seed -- this module itself never calls Date.now()/Math.random() (project
 *   rule).
 */
export function advanceMasteryRun(run: MasteryRun, correct: boolean, nextSeed: number): MasteryRun {
  if (correct) return { ...run, index: run.index + 1 };
  return startMasteryRun(run.order, nextSeed);
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
  if (!cell.id.startsWith('hard-')) return cell.cards;
  const total = Number(cell.id.split('-')[1]);
  const seed = (run.seed ^ Math.imul(run.index + 1, 0x9e3779b1)) | 0;
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
