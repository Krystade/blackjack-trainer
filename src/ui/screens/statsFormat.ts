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

/**
 * F23: `pct` for a figure already in percent (0..100), with the same rule:
 * 99.6% is never "100%" and 0.4% is never "0%". Null is the no-data dash.
 */
export function pctOfPercent(p: number | null): string {
  if (p === null || Number.isNaN(p)) return '—';
  const rounded = Math.round(p);
  if (rounded === 100 && p < 100) return '99%';
  if (rounded === 0 && p > 0) return '<1%';
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

/**
 * #25: units of the base bet, to as many places as the number needs. Two
 * places hide most basic-strategy mistakes (a soft 18 v 2 stand is 0.004 u),
 * and a priced mistake printed as "0.00" reads as free.
 */
export function formatUnits(units: number): string {
  if (units === 0) return '0';
  if (units < 0.001) return '<0.001';
  return units < 0.1 ? units.toFixed(3) : units.toFixed(2);
}

/**
 * A priced mistake's hand, as the chart names it: "16 v 10", "Soft 18 v 2",
 * "8,8 v 10". Anything that is not a cell id (an old quiz label) is printed
 * as it was stored; a row with no hand says so.
 */
export function costHandLabel(hand: string | undefined): string {
  if (!hand) return 'Unidentified hand';
  const m = /^(hard|soft|pair)-([0-9]+|A)-v-([0-9]+|A)$/.exec(hand);
  if (!m) return hand;
  const [, kind, value, up] = m;
  // "8,8 v 10" is how a pair is written everywhere else in the app, and it
  // sidesteps pluralising "a pair of As".
  if (kind === 'pair') return `${value},${value} v ${up}`;
  return kind === 'soft' ? `Soft ${value} v ${up}` : `${value} v ${up}`;
}

/**
 * s04: whether a drill is getting better -- the last ten results against the
 * ten before them. Null below ten results (nothing to say yet); with fewer
 * than twenty only the last ten are stated.
 */
export function trendLine(history: readonly { correct: boolean }[], window = 10): string | null {
  if (history.length < window) return null;
  const right = (xs: readonly { correct: boolean }[]) => xs.filter((h) => h.correct).length;
  const last = right(history.slice(-window));
  if (history.length < window * 2) return `Last ${window}: ${last}/${window}`;
  const prev = right(history.slice(-window * 2, -window));
  const dir = last > prev ? 'up from' : last < prev ? 'down from' : 'same as';
  return `Last ${window}: ${last}/${window}, ${dir} ${prev}/${window} the ${window} before`;
}

/** A signed whole number with a real minus sign (U+2212): "+3", "−2", "0". */
export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}
