/**
 * Mastery Challenge: walk EVERY cell in a chosen scope (Hard / Soft / Pairs /
 * All) in random order, exactly once, with no replacement. One wrong answer
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

export type MasteryScope = 'all' | 'hard' | 'soft' | 'pairs';

export interface MasteryRun {
  scope: MasteryScope;
  /** The seed that produced `order`. Only ever changes on a RESET (D2) --
   * a correct answer never reshuffles, so `seed` staying put is itself part
   * of the "no reshuffle on success" contract. */
  seed: number;
  /** Every cell id in this scope, shuffled once at run-start / reset time.
   * Fixed for the run's lifetime except across a reset. */
  order: string[];
  /** Index of the NEXT cell to present. Also equals "cells cleared so far
   * this run" -- a correct answer at `order[index]` increments this. */
  index: number;
}

/** All cells for `scope`, via the SAME filter drawFlashcard uses (D1) -- so
 * this challenge and ordinary Flashcards can never disagree about what the
 * universe for a given scope is. */
export function cellsForScope(scope: MasteryScope): Cell[] {
  return filterCellsByCategory(generateAllCells(), scope);
}

function shuffledIds(scope: MasteryScope, seed: number): string[] {
  const ids = cellsForScope(scope).map((c) => c.id);
  return fisherYatesShuffle(ids, mulberry32(seed));
}

export function startMasteryRun(scope: MasteryScope, seed: number): MasteryRun {
  return { scope, seed, order: shuffledIds(scope, seed), index: 0 };
}

/**
 * Advance the run by one graded answer.
 * - correct: only `index` moves forward. `order`/`seed` are untouched --
 *   this is what "no reshuffle on success" means concretely (D2).
 * - incorrect: the ENTIRE run restarts -- index to 0, a brand new shuffle
 *   from `nextSeed` (never `run.seed`, which would silently no-op the
 *   reshuffle). `nextSeed` is supplied by the caller (a component), which is
 *   the one place allowed to read a wall-clock/Math.random-derived seed --
 *   this module itself never calls Date.now()/Math.random() (project rule).
 */
export function advanceMasteryRun(run: MasteryRun, correct: boolean, nextSeed: number): MasteryRun {
  if (correct) return { ...run, index: run.index + 1 };
  return startMasteryRun(run.scope, nextSeed);
}

export function isMasteryRunComplete(run: MasteryRun): boolean {
  return run.index >= run.order.length;
}

/** The cell id the learner should be shown next, or null once the run is
 * complete (nothing left to present). */
export function currentCellId(run: MasteryRun): string | null {
  return isMasteryRunComplete(run) ? null : run.order[run.index];
}

/* ------------------------------------------------------------------ */
/* Persistence (D8): only {scope, seed, index} is stored -- `order` is   */
/* cheaply re-derived from scope+seed, so the stored blob can never       */
/* drift from what startMasteryRun would produce for the same inputs.    */
/* Guarded try/catch + typeof-window idiom matches gradeAnswer.ts's       */
/* loadSrDeck/saveSrDeck exactly.                                        */
/* ------------------------------------------------------------------ */

export interface PersistedMasteryRun {
  scope: MasteryScope;
  seed: number;
  index: number;
}

const MASTERY_RUN_KEY = 'bjtrainer.masteryrun.v1';
const SCOPES: readonly MasteryScope[] = ['all', 'hard', 'soft', 'pairs'];

function isMasteryScope(value: unknown): value is MasteryScope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

/** Reconstruct a full MasteryRun from persisted {scope, seed, index}. Falls
 * back to a fresh run at index 0 (same scope/seed) if the persisted index is
 * out of range for that scope -- corrupt/stale data degrades to "start over",
 * never a crash or an out-of-bounds currentCellId(). */
export function hydrateMasteryRun(persisted: PersistedMasteryRun | null): MasteryRun | null {
  if (!persisted) return null;
  if (!isMasteryScope(persisted.scope) || typeof persisted.seed !== 'number' || typeof persisted.index !== 'number') {
    return null;
  }
  const order = shuffledIds(persisted.scope, persisted.seed);
  const index = persisted.index >= 0 && persisted.index <= order.length ? persisted.index : 0;
  return { scope: persisted.scope, seed: persisted.seed, order, index };
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
    const persisted: PersistedMasteryRun = { scope: run.scope, seed: run.seed, index: run.index };
    window.localStorage.setItem(MASTERY_RUN_KEY, JSON.stringify(persisted));
  } catch {
    // best-effort persistence only, matching every other drill's SR-deck save
  }
}
