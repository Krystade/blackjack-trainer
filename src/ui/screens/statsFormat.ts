import { wilson } from '../../store/retentionCurve';

/**
 * A percentage that never claims more than it has.
 *
 * Plain `Math.round` prints "100%" for 999/1000 and "0%" for 1/1000. On this
 * screen those are the two most consequential numbers there are: a perfect
 * score is the thing the learner is trying to reach, and being told they
 * have it when they have not is the one error that changes what they do
 * next (stop drilling the cell). A miss that rounds away is the same lie in
 * the other direction.
 */
export function pct(right: number, total: number): string {
  if (total === 0) return '\u2014';
  const rounded = Math.round((right / total) * 100);
  if (rounded === 100 && right < total) return '99%';
  if (rounded === 0 && right > 0) return '<1%';
  return `${rounded}%`;
}

export interface ClockGap {
  /** Whether the two buckets can be told apart at all. */
  distinguishable: boolean;
  /** Percentage points, untimed minus timed. Rounded, sign carried. */
  gap: number;
  text: string;
}

/**
 * The clock-vs-no-clock verdict, and whether there is one.
 *
 * The section used to require one answer in each bucket and then state the
 * difference as fact: 1/1 against 0/1 reads "You are 100 points better
 * without the clock", which is noise printed as a finding. Wilson intervals
 * at 95% are already used for retention on this same screen; if they
 * overlap, the honest sentence is that the two cannot be told apart yet.
 */
export function clockGap(
  timed: { right: number; wrong: number },
  untimed: { right: number; wrong: number },
): ClockGap {
  const tn = timed.right + timed.wrong;
  const un = untimed.right + untimed.wrong;
  const gap = Math.round((untimed.right / un - timed.right / tn) * 100);

  const t = wilson(timed.right, tn);
  const u = wilson(untimed.right, un);
  const separated =
    t.low !== null && t.high !== null && u.low !== null && u.high !== null
      ? u.low > t.high || t.low > u.high
      : false;

  if (!separated) {
    return {
      distinguishable: false,
      gap,
      text:
        `Too few answers to tell the two apart yet (${tn} under the clock, ${un} without). ` +
        `The difference so far is ${gap > 0 ? '+' : ''}${gap} points, which a handful of ` +
        `answers either way would erase.`,
    };
  }
  return {
    distinguishable: true,
    gap,
    text:
      gap > 0
        ? `You are ${gap} points better without the clock. That gap is the part of your score the deadline is taking, not the part you have yet to learn.`
        : gap < 0
          ? `You are ${-gap} points better WITH the clock \u2014 unusual, and usually a sign the untimed answers came from a different stretch of practice.`
          : 'The clock is costing you nothing measurable.',
  };
}
