/**
 * V3-6: retention, broken out by how long the gap actually was.
 *
 * `Stats.retention.history` has recorded `gapMs` and `box` on every row since
 * RV4, and nothing has ever read either one. The screen showed a single pooled
 * percentage instead — which averages a card recalled after three days
 * together with one recalled after five weeks, and those are not the same
 * measurement. Retention is a DECAY CURVE; one number is the one shape that
 * cannot show a curve.
 *
 * The second thing a lone percentage hides is its own precision. "67%" off
 * three reviews and "67%" off three hundred are the same string, and the first
 * is noise. Every figure here therefore carries the interval it could honestly
 * be, so a good-looking first reading cannot be mistaken for a result.
 */

import type { Stats } from './types';

/** Local, as everywhere else in this repo that needs it (srStatus, timeRange). */
const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionRow = Stats['retention']['history'][number];

/**
 * Gap bands, edged on the Leitner schedule (`BOX_INTERVALS_MS`: 1, 3, 7, 14,
 * 30 days) so a band boundary means something — each one is the interval a box
 * promotion actually buys. `maxDays` is exclusive; the last band is open.
 *
 * A gap review requires box >= LEARNED_BOX (3 days scheduled), so the first
 * band is normally thin. It is not dropped: an entry there means an item came
 * due early or was answered ahead of schedule, and that is worth seeing rather
 * than silently folding into the 3-7 band.
 */
export const GAP_BANDS: readonly { label: string; maxDays: number }[] = [
  { label: 'under 3 days', maxDays: 3 },
  { label: '3-7 days', maxDays: 7 },
  { label: '1-2 weeks', maxDays: 14 },
  { label: '2-4 weeks', maxDays: 30 },
  { label: 'over a month', maxDays: Infinity },
];

/** z for a 95% two-sided normal interval. */
const Z = 1.96;

export interface Proportion {
  reviews: number;
  correct: number;
  /** Point estimate in 0..1, or null with no reviews. */
  rate: number | null;
  /** 95% Wilson score bounds in 0..1, or null with no reviews. */
  low: number | null;
  high: number | null;
}

/**
 * A 95% Wilson score interval — HOW FAR OFF THIS READING COULD BE.
 *
 * Wilson rather than the textbook normal interval on purpose: at the small
 * counts this screen actually sees, and at rates near 100% where a well-drilled
 * deck lives, the normal interval produces bounds above 1 and a zero-width
 * interval at a perfect score, both of which would read as confidence the data
 * does not contain. Wilson stays inside 0..1 and keeps real width at 3-for-3.
 */
export function wilson(correct: number, reviews: number): Proportion {
  if (reviews <= 0) return { reviews: 0, correct: 0, rate: null, low: null, high: null };
  const p = correct / reviews;
  const denom = reviews + Z * Z;
  const centre = (correct + (Z * Z) / 2) / denom;
  const half = (Z / denom) * Math.sqrt((correct * (reviews - correct)) / reviews + (Z * Z) / 4);
  return {
    reviews,
    correct,
    rate: p,
    low: Math.max(0, centre - half),
    high: Math.min(1, centre + half),
  };
}

export interface GapBandResult extends Proportion {
  label: string;
}

/**
 * Every band, in order, with the rows that fall in it. Empty bands are kept —
 * the caller decides whether to draw them, and "you have never tested this far
 * out" is itself the finding at the long end of a young deck.
 */
export function retentionByGap(rows: readonly RetentionRow[]): GapBandResult[] {
  const counts = GAP_BANDS.map(() => ({ reviews: 0, correct: 0 }));
  for (const row of rows) {
    const days = row.gapMs / DAY_MS;
    // A clock change can hand us a negative gap and a corrupt blob a NaN one.
    // The negated comparison files both at the short end rather than dropping
    // them -- they are real reviews, and losing them would understate the
    // denominator. The one input it cannot place is a non-finite gap, which no
    // JSON blob can carry but a caller could still pass; that falls to the
    // open-ended last band rather than indexing at -1 and throwing.
    const index = GAP_BANDS.findIndex((band) => !(days >= band.maxDays));
    const bucket = counts[index === -1 ? GAP_BANDS.length - 1 : index]!;
    bucket.reviews += 1;
    if (row.correct) bucket.correct += 1;
  }
  return GAP_BANDS.map((band, i) => ({
    label: band.label,
    ...wilson(counts[i]!.correct, counts[i]!.reviews),
  }));
}

/**
 * True when the curve is worth drawing at all: more than one band has data.
 * With every review at one gap length there is no curve, only the pooled
 * figure wearing a table, and saying so beats implying a shape.
 */
export function hasCurve(bands: readonly GapBandResult[]): boolean {
  return bands.filter((b) => b.reviews > 0).length > 1;
}

/** "43%-79%", the honest width of a reading. Null bounds render as an em dash. */
export function formatInterval(p: Proportion): string {
  if (p.low === null || p.high === null) return '—';
  return `${Math.round(p.low * 100)}%-${Math.round(p.high * 100)}%`;
}
