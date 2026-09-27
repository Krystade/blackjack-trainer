import type { Card, Rank } from '../../engine/cards';
import type { StrategyRules } from '../../engine/ruleset';
import type { PlayContext } from '../../engine/strategy';
import { basicPlay } from '../../engine/strategy';

/**
 * Why the ringed cell and the correction disagree, said out loud on the
 * chart page -- or `null` when they do not.
 *
 * The chart is basic strategy and nothing else: `getChart(rules)` has no
 * count in it. The trainer, on a quiz item or at a live table, grades with
 * the indices too. Both are correct and the page said they were the same
 * thing ("Exactly the chart the trainer grades you against."), which is a
 * sentence the learner reads while looking at a cell that contradicts the
 * answer they were just marked against.
 *
 * Derived, not asserted: the note appears when the graded expectation
 * actually differs from what this chart prints, so a deviation-side item
 * that happens to agree with basic strategy stays quiet.
 */
export function chartNoteFor(args: {
  cards: Card[] | null | undefined;
  dealerUp: Rank | null | undefined;
  rules: StrategyRules;
  /** The graded expectation, from the event the overlay was opened over. */
  expected: string | undefined;
  /** The engine's own prose for it, e.g. "16 v 10: stand at TC >= 0". */
  reason?: string;
  /** True count the hand was graded at. */
  tc?: number;
  canSplit?: boolean;
}): string | null {
  const { cards, dealerUp, rules, expected, reason, tc, canSplit } = args;
  if (!cards || !dealerUp || !expected) return null;

  /*
   * The ctx the CELL has to be read under, not a fixed one.
   *
   * `canDouble: cards.length === 2` is the load-bearing part. A Dh cell is
   * "double if allowed, else hit", and after a hit doubling is not allowed
   * -- so on a three-card 11 the chart and the grade agree on HIT, and a
   * fixed `canDouble: true` would have resolved the same cell to `double`
   * and printed a note contradicting a correction that was never wrong.
   * That is precisely the hand the live table opens this overlay on.
   */
  const ctx: PlayContext = {
    canDouble: cards.length === 2,
    canSplit: canSplit ?? true,
    canSurrender: rules.ls,
  };
  const basic = basicPlay(cards, dealerUp, ctx, rules);
  if (basic.action === expected) return null;

  const count = tc === undefined ? '' : ` at a true count of ${tc > 0 ? `+${tc}` : tc}`;
  const because = reason ? ` ${reason}.` : '';
  return `This chart is basic strategy. That hand was graded ${expected}${count}, not ${basic.action}.${because}`;
}
