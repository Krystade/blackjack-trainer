import type { Stats } from '../../store/types';
import type { Category } from '../../engine/grade';
import type { HandPrefix } from '../../store/cellStats';
import { countBits, handWindow, judgedAccuracy } from '../../store/cellStats';
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
 *
 * cellStats has no backfill: hand decisions from before it shipped live only
 * in the per-category tally (`stats.categories`). They are not judged on --
 * the goal is about what you know now -- but `allRight`/`allN` carry that
 * tally so a screen can show them and say why the goal counts fewer.
 */

export const MIN_CATEGORY_ANSWERS = 20;
export const CATEGORY_TARGET = 0.9;
export const MIN_CELL_ANSWERS = 5;
export const WEAK_CELL_BELOW = 0.78;

export const HAND_CATEGORIES: readonly { prefix: HandPrefix; scope: HandScope; category: Category; label: string }[] = [
  { prefix: 'hard', scope: 'hard', category: 'hard', label: 'Hard totals' },
  { prefix: 'soft', scope: 'soft', category: 'soft', label: 'Soft totals' },
  { prefix: 'pair', scope: 'pairs', category: 'pairs', label: 'Pairs' },
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
  /** Right answers behind `pct`. */
  judgedRight: number;
  /** Answers behind `pct`: the recent window's length, or `n`. */
  judgedN: number;
  /** True when `pct` is the recent window rather than the lifetime sum. */
  recent: boolean;
  /** Fewer than MIN_CATEGORY_ANSWERS answers: too few to judge. */
  thin: boolean;
  /** Judged, and at or above CATEGORY_TARGET. */
  onTarget: boolean;
  /**
   * The all-time per-category tally (`stats.categories`), which also holds
   * hand decisions from before per-cell tracking. Not judged on. It files
   * hands whose right play is surrender under Surrender, so it is not a
   * superset of `n`.
   */
  allRight: number;
  allN: number;
  /** The all-time tally holds more answers than the cells: older answers exist. */
  legacy: boolean;
}

export function handCategoryProgress(stats: Stats): HandCategoryProgress[] {
  const cells = Object.entries(stats.cellStats ?? {});
  return HAND_CATEGORIES.map(({ prefix, scope, category, label }) => {
    let right = 0;
    let wrong = 0;
    for (const [id, t] of cells) {
      if (id.startsWith(`${prefix}-`)) {
        right += t.right;
        wrong += t.wrong;
      }
    }
    const n = right + wrong;
    const window = handWindow(stats.handRecent, prefix);
    const recent = window.length >= MIN_CATEGORY_ANSWERS;
    const judgedRight = recent ? countBits(window).right : right;
    const judgedN = recent ? window.length : n;
    const pct = judgedN === 0 ? 0 : judgedRight / judgedN;
    const thin = n < MIN_CATEGORY_ANSWERS;
    const all = stats.categories?.[category] ?? { right: 0, wrong: 0 };
    const allN = all.right + all.wrong;
    return {
      prefix,
      scope,
      label,
      right,
      n,
      pct,
      judgedRight,
      judgedN,
      recent,
      thin,
      onTarget: !thin && pct >= CATEGORY_TARGET,
      allRight: all.right,
      allN,
      legacy: allN > n,
    };
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

/**
 * A goal figure (0..1) for display: floored like pctDown, so 89.9% is never
 * shown as the 90% goal, and never "0%" for a figure above zero (F23's rule,
 * statsFormat.pct).
 */
export function goalPct(p: number): string {
  const whole = pctDown(p);
  return whole === 0 && p > 0 ? '<1%' : `${whole}%`;
}
