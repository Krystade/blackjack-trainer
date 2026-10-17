import type { Stats } from '../../store/types';
import type { HandPrefix } from '../../store/cellStats';
import { judgedAccuracy } from '../../store/cellStats';
import type { HandScope } from '../../drills/handScope';

/**
 * Wave A / W3: the ONE place the hard / soft / pairs figures come from.
 *
 * Home's Next step, Home's "weakest" line and Stats' Accuracy by category all
 * read this, so they can no longer disagree about whether a category has hit
 * the 90% goal (they used to read two different tallies: per-cell sums here,
 * `stats.categories` on Stats, which files surrender cells apart).
 *
 * A category is JUDGED on its recent window (`stats.handRecent`, the last
 * HAND_WINDOW answers) once that holds at least MIN_CATEGORY_ANSWERS results,
 * so mistakes made while learning age out. Until then -- a blob written
 * before the window shipped, or a category barely started -- the lifetime
 * sum of its cells is used. MIN_CATEGORY_ANSWERS lifetime answers are needed
 * before a category is judged at all.
 */

export const MIN_CATEGORY_ANSWERS = 20;
export const CATEGORY_TARGET = 0.9;
export const MIN_CELL_ANSWERS = 5;
export const WEAK_CELL_BELOW = 0.78;

export const HAND_CATEGORIES: readonly { prefix: HandPrefix; scope: HandScope; label: string }[] = [
  { prefix: 'hard', scope: 'hard', label: 'Hard totals' },
  { prefix: 'soft', scope: 'soft', label: 'Soft totals' },
  { prefix: 'pair', scope: 'pairs', label: 'Pairs' },
];

export interface HandCategoryProgress {
  prefix: HandPrefix;
  scope: HandScope;
  label: string;
  /** Lifetime answers, summed over the category's cells. */
  right: number;
  n: number;
  /** The figure the goal is judged on, 0..1 (0 with no answers). */
  pct: number;
  /** Answers behind `pct`: the recent window's length, or `n`. */
  judgedN: number;
  /** True when `pct` is the recent window rather than the lifetime sum. */
  recent: boolean;
  /** Fewer than MIN_CATEGORY_ANSWERS answers: too few to judge. */
  thin: boolean;
  /** Judged, and at or above CATEGORY_TARGET. */
  onTarget: boolean;
}

export function handCategoryProgress(stats: Stats): HandCategoryProgress[] {
  const cells = Object.entries(stats.cellStats ?? {});
  return HAND_CATEGORIES.map(({ prefix, scope, label }) => {
    let right = 0;
    let wrong = 0;
    for (const [id, t] of cells) {
      if (id.startsWith(`${prefix}-`)) {
        right += t.right;
        wrong += t.wrong;
      }
    }
    const n = right + wrong;
    const window = stats.handRecent?.[prefix] ?? '';
    const recent = window.length >= MIN_CATEGORY_ANSWERS;
    const judgedRight = recent ? [...window].filter((c) => c === '1').length : right;
    const judgedN = recent ? window.length : n;
    const pct = judgedN === 0 ? 0 : judgedRight / judgedN;
    const thin = n < MIN_CATEGORY_ANSWERS;
    return { prefix, scope, label, right, n, pct, judgedN, recent, thin, onTarget: !thin && pct >= CATEGORY_TARGET };
  });
}

export interface WeakCell {
  id: string;
  n: number;
  pct: number;
}

/**
 * Cells judged weak: at least `minAnswers` lifetime answers and a judged
 * accuracy (recent window once it holds MIN_CELL_ANSWERS results) below
 * WEAK_CELL_BELOW. Worst first. `prefix` limits it to one hand type.
 */
export function weakCells(stats: Stats, opts: { prefix?: HandPrefix; minAnswers?: number } = {}): WeakCell[] {
  const min = opts.minAnswers ?? MIN_CELL_ANSWERS;
  return Object.entries(stats.cellStats ?? {})
    .filter(([id]) => !opts.prefix || id.startsWith(`${opts.prefix}-`))
    .map(([id, t]) => ({ id, n: t.right + t.wrong, pct: judgedAccuracy(t, MIN_CELL_ANSWERS) ?? 1 }))
    .filter((c) => c.n >= min && c.pct < WEAK_CELL_BELOW)
    .sort((a, b) => a.pct - b.pct || b.n - a.n || a.id.localeCompare(b.id));
}

/** A whole percent that never rounds a miss up to the target. */
export function pctDown(p: number): number {
  return Math.floor(p * 100 + 1e-9);
}
