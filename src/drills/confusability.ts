/**
 * DRAWING THE CELL YOU'RE MOST LIKELY TO MIX UP WITH THE LAST ONE (V5-1).
 *
 * Brunmair & Richter's meta-analysis of interleaved learning (59 studies, 238
 * effect sizes, 158 samples; Psychological Bulletin 2019) puts the overall
 * interleaving effect at Hedges' g = 0.42, but the moderators are the actual
 * finding: the effect is stronger "for learning material more similar BETWEEN
 * categories, for learning material LESS similar WITHIN categories, and for
 * more complex learning material" -- and, from the discussion, interleaving is
 * "effective only when items are presented in immediate succession without
 * spacing".
 *
 * The chart is a category-learning task whose categories are maximally
 * confusable on purpose: hard 16 v 10 against hard 15 v 10, soft 18 v 9
 * against hard 18 v 9. That is the high-between-category-similarity condition
 * where the effect is largest. But the draw weights by SR due-ness and (V4-1)
 * by frequency, and BOTH are independent of what came before -- so a
 * confusable pair landing back to back is a coincidence, and "immediate
 * succession", the condition the effect is said to require, happens only by
 * luck.
 *
 * This module supplies the missing term: given the cell just answered, how
 * confusable is each candidate with it. It is a THIRD axis, multiplying into
 * SR and frequency rather than replacing either -- what you're due for, how
 * often you meet it, and what you'll mix it up with are three different
 * questions.
 *
 * Caveat worth keeping visible: the meta-analysis' mathematical-tasks subgroup
 * was its weak one (g = 0.34; b = -0.43 against paintings as the reference
 * category), and a strategy chart is closer to that than to paintings. Hence
 * opt-in, and hence compressed rather than winner-take-all.
 */

/** A cell id split into the three things that make two cells confusable. */
interface CellKey {
  kind: 'hard' | 'soft' | 'pair';
  /** Hard/soft total, or the pair's card value (ace = 11, to sort above ten). */
  value: number;
  /** Upcard value, ace = 11 so it neighbours the ten the way it does on the chart. */
  up: number;
}

function upValue(up: string): number {
  return up === 'A' ? 11 : Number(up);
}

/**
 * Parse "hard-16-v-9" / "soft-18-v-A" / "pair-8-v-10".
 *
 * Returns null for anything unrecognised rather than guessing, so a new cell
 * shape shows up as "never boosted" in a test instead of silently getting an
 * invented neighbour set.
 */
export function parseCell(cellId: string): CellKey | null {
  const parts = cellId.split('-v-');
  if (parts.length !== 2) return null;
  const [head, up] = parts;
  if (head === undefined || up === undefined) return null;

  const upNum = upValue(up);
  if (!Number.isFinite(upNum) || upNum < 2 || upNum > 11) return null;

  const dash = head.indexOf('-');
  if (dash < 0) return null;
  const kind = head.slice(0, dash);
  const rest = head.slice(dash + 1);

  if (kind !== 'hard' && kind !== 'soft' && kind !== 'pair') return null;

  const value = kind === 'pair' ? upValue(rest) : Number(rest);
  if (!Number.isFinite(value)) return null;

  return { kind, value, up: upNum };
}

/**
 * How much MORE likely a cell should be to follow `previous`, as a multiplier.
 *
 * The three ways two chart cells get mixed up at a table, in the order they
 * cost you:
 *
 * 1. SAME UPCARD, ADJACENT TOTAL — the row you're reading off is right and you
 *    land one line out. Hard 16 v 10 and hard 15 v 10 are the canonical pair,
 *    and they genuinely differ in play.
 * 2. SAME TOTAL, ADJACENT UPCARD — the column slips instead. 12 v 2 and 12 v 3
 *    are the classic, and the boundary between them is a real index.
 * 3. SAME TOTAL, DIFFERENT KIND — soft 18 against hard 18, or pair 8s against
 *    hard 16. Same number in your head, three different right answers. This is
 *    the one a learner who memorised totals rather than hands gets wrong, and
 *    it is exactly what V4-2's varied compositions were built to expose.
 *
 * A cell is never boosted against ITSELF: repeating the card just answered is
 * not interleaving, it is massed practice, which is the thing being avoided.
 * That early return is REDUNDANT as the rules below currently stand -- a cell
 * is its own kind, its own total and its own upcard, so it matches none of the
 * "adjacent" branches and falls through to 1 anyway. Deleting it passes every
 * test, which is why this is written down rather than left to be rediscovered:
 * it is kept as a guard against a future rule that WOULD match self (anything
 * keyed on same-kind-same-total, say), not because it is load-bearing today.
 *
 * Returns 1.0 (no change) for a non-neighbour, so this can only ever raise a
 * cell's odds and never zero one out -- the complete chart stays complete, the
 * same guarantee handFrequency.ts makes.
 */
export function confusabilityWeight(cellId: string, previousCellId: string | null): number {
  if (!previousCellId || cellId === previousCellId) return 1;

  const a = parseCell(cellId);
  const b = parseCell(previousCellId);
  if (!a || !b) return 1;

  const sameUp = a.up === b.up;
  const sameValue = a.value === b.value;
  const adjacentUp = Math.abs(a.up - b.up) === 1;
  const adjacentValue = Math.abs(a.value - b.value) === 1;

  // Same number, different hand shape -- the costliest confusion, so the
  // largest boost.
  if (sameValue && sameUp && a.kind !== b.kind) return 4;
  if (sameValue && a.kind !== b.kind) return 2.5;

  // Same row, neighbouring line.
  if (sameUp && adjacentValue && a.kind === b.kind) return 3;

  // Same line, neighbouring column.
  if (sameValue && adjacentUp && a.kind === b.kind) return 3;

  // Same row, two lines out, or same line two columns out: still a plausible
  // slip, worth a nudge rather than the full boost.
  if (sameUp && a.kind === b.kind && Math.abs(a.value - b.value) === 2) return 1.5;
  if (sameValue && a.kind === b.kind && Math.abs(a.up - b.up) === 2) return 1.5;

  return 1;
}
