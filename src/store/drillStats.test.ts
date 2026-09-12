import { describe, it, expect } from 'vitest';
import {
  summarize,
  bestSecondsPerDeck,
  signedErrorBreakdown,
  medianLatency,
  distractionSummary,
  evCostSummary,
} from './drillStats';

describe('summarize', () => {
  it('reports zero attempts / null accuracy for an empty history', () => {
    expect(summarize([])).toEqual({ attempts: 0, correct: 0, accuracyPct: null });
  });

  it('counts attempts and correct entries', () => {
    const history = [{ correct: true }, { correct: false }, { correct: true }];
    expect(summarize(history)).toEqual({ attempts: 3, correct: 2, accuracyPct: (2 / 3) * 100 });
  });

  it('reports 100% when every entry is correct', () => {
    const history = [{ correct: true }, { correct: true }];
    expect(summarize(history)).toEqual({ attempts: 2, correct: 2, accuracyPct: 100 });
  });

  it('reports 0% when every entry is wrong', () => {
    const history = [{ correct: false }, { correct: false }];
    expect(summarize(history)).toEqual({ attempts: 2, correct: 0, accuracyPct: 0 });
  });

  it('ignores extra fields on each history entry (structural typing)', () => {
    const history = [{ correct: true, date: 'x', cards: 5 }];
    expect(summarize(history)).toEqual({ attempts: 1, correct: 1, accuracyPct: 100 });
  });
});

describe('bestSecondsPerDeck', () => {
  it('returns null for an empty history', () => {
    expect(bestSecondsPerDeck([])).toBeNull();
  });

  it('returns null when no entry is correct (an incorrect fast run is not "best")', () => {
    const history = [
      { secondsPerDeck: 10, correct: false },
      { secondsPerDeck: 20, correct: false },
    ];
    expect(bestSecondsPerDeck(history)).toBeNull();
  });

  it('picks the lowest (fastest) secondsPerDeck among correct runs only', () => {
    const history = [
      { secondsPerDeck: 25, correct: true },
      { secondsPerDeck: 12, correct: false }, // faster but wrong -- must be excluded
      { secondsPerDeck: 18, correct: true },
    ];
    expect(bestSecondsPerDeck(history)).toBe(18);
  });

  it('returns the single correct value when only one correct entry exists', () => {
    const history = [
      { secondsPerDeck: 40, correct: false },
      { secondsPerDeck: 22, correct: true },
    ];
    expect(bestSecondsPerDeck(history)).toBe(22);
  });
});

describe('signedErrorBreakdown', () => {
  it('returns all-zero counts for an empty history', () => {
    expect(signedErrorBreakdown([])).toEqual({ tooHigh: 0, tooLow: 0, exact: 0 });
  });

  it('classifies a guess above the correct true count as tooHigh', () => {
    const history = [{ guess: 3, correctTc: 1 }];
    expect(signedErrorBreakdown(history)).toEqual({ tooHigh: 1, tooLow: 0, exact: 0 });
  });

  it('classifies a guess below the correct true count as tooLow', () => {
    const history = [{ guess: -1, correctTc: 2 }];
    expect(signedErrorBreakdown(history)).toEqual({ tooHigh: 0, tooLow: 1, exact: 0 });
  });

  /**
   * The eyes-free self-report has no guess at all. Counting it as `exact`
   * -- which is what a missing field compared numerically would do -- would
   * report every admitted miss as a perfect hit.
   */
  it('ignores an entry with no guess, in either direction', () => {
    expect(signedErrorBreakdown([{ correctTc: 4 }])).toEqual({ tooHigh: 0, tooLow: 0, exact: 0 });
    expect(
      signedErrorBreakdown([{ correctTc: 4 }, { guess: 9, correctTc: 4 }, { correctTc: -2 }]),
    ).toEqual({ tooHigh: 1, tooLow: 0, exact: 0 });
  });

  it('classifies a matching guess as exact', () => {
    const history = [{ guess: 4, correctTc: 4 }];
    expect(signedErrorBreakdown(history)).toEqual({ tooHigh: 0, tooLow: 0, exact: 1 });
  });

  it('tallies a mixed history across all three buckets', () => {
    const history = [
      { guess: 5, correctTc: 2 }, // too high
      { guess: 0, correctTc: 3 }, // too low
      { guess: -1, correctTc: -1 }, // exact
      { guess: 6, correctTc: 1 }, // too high
      { guess: -2, correctTc: -1 }, // too low
    ];
    expect(signedErrorBreakdown(history)).toEqual({ tooHigh: 2, tooLow: 2, exact: 1 });
  });

  it('treats negative correctTc/guess values correctly (sign of the difference, not the values)', () => {
    const history = [{ guess: -5, correctTc: -8 }]; // -5 > -8 -> too high
    expect(signedErrorBreakdown(history)).toEqual({ tooHigh: 1, tooLow: 0, exact: 0 });
  });
});

describe('medianLatency', () => {
  it('returns null for an empty history', () => {
    expect(medianLatency([])).toBeNull();
  });

  it('returns the middle value for an odd-length history', () => {
    const history = [{ elapsedMs: 500 }, { elapsedMs: 100 }, { elapsedMs: 300 }];
    expect(medianLatency(history)).toBe(300);
  });

  it('averages the two middle values for an even-length history', () => {
    const history = [{ elapsedMs: 100 }, { elapsedMs: 200 }, { elapsedMs: 300 }, { elapsedMs: 400 }];
    expect(medianLatency(history)).toBe(250);
  });

  it('ignores entries lacking elapsedMs (pre-latency data mixed with fresh data)', () => {
    const history = [{ elapsedMs: undefined }, { elapsedMs: 400 }, {}, { elapsedMs: 200 }];
    expect(medianLatency(history)).toBe(300);
  });

  it('returns null when every entry lacks elapsedMs', () => {
    const history = [{}, { elapsedMs: undefined }];
    expect(medianLatency(history)).toBeNull();
  });

  it('is not skewed by a single outlier (right-skew resistance is the whole point of using median over mean)', () => {
    const history = [{ elapsedMs: 100 }, { elapsedMs: 120 }, { elapsedMs: 110 }, { elapsedMs: 9000 }];
    // median of sorted [100,110,120,9000] -> (110+120)/2 = 115, nowhere near the mean (~2332.5)
    expect(medianLatency(history)).toBe(115);
  });
});

describe('distractionSummary', () => {
  it('reports zero attempts / null percentages for an empty history', () => {
    expect(distractionSummary([])).toEqual({
      attempts: 0,
      answerAccuracyPct: null,
      countKeptPct: null,
    });
  });

  it('reports 100% on both axes when every entry got the math right and kept the count', () => {
    const history = [
      { answerCorrect: true, countKept: true },
      { answerCorrect: true, countKept: true },
    ];
    expect(distractionSummary(history)).toEqual({
      attempts: 2,
      answerAccuracyPct: 100,
      countKeptPct: 100,
    });
  });

  it('reports 0% on both axes when every entry missed the math and lost the count', () => {
    const history = [
      { answerCorrect: false, countKept: false },
      { answerCorrect: false, countKept: false },
    ];
    expect(distractionSummary(history)).toEqual({
      attempts: 2,
      answerAccuracyPct: 0,
      countKeptPct: 0,
    });
  });

  it('tracks answer-correctness and count-kept independently on a mixed history', () => {
    // The whole point of D1: a wrong math answer and a lost count are
    // separate failure modes -- a run can get the arithmetic right but
    // still lose the count (or vice versa), so the two percentages must
    // never be derived from each other.
    const history = [
      { answerCorrect: true, countKept: false }, // nailed the math, lost the count
      { answerCorrect: false, countKept: true }, // botched the math, kept the count
      { answerCorrect: true, countKept: true },
      { answerCorrect: false, countKept: false },
    ];
    expect(distractionSummary(history)).toEqual({
      attempts: 4,
      answerAccuracyPct: 50,
      countKeptPct: 50,
    });
  });

  it('ignores extra fields on each history entry (structural typing, e.g. date/kind/elapsedMs)', () => {
    const history = [
      { answerCorrect: true, countKept: true, date: 'x', kind: 'near-count' as const, elapsedMs: 1200 },
    ];
    expect(distractionSummary(history)).toEqual({
      attempts: 1,
      answerAccuracyPct: 100,
      countKeptPct: 100,
    });
  });
});

describe('evCostSummary (V3-8: where the units went)', () => {
  const row = (hand: string, expected: string, taken: string, units: number) => ({
    hand,
    expected,
    taken,
    units,
  });

  it('reports nothing rather than zero when no mistake was ever priced', () => {
    const summary = evCostSummary([]);
    expect(summary.priced).toBe(0);
    expect(summary.unitsTotal).toBe(0);
    // null, not 0: a zero mean would read as "my mistakes are free".
    expect(summary.meanUnits).toBeNull();
    expect(summary.worst).toEqual([]);
  });

  it('groups the same mistake on the same hand and counts the repeats', () => {
    const summary = evCostSummary([
      row('soft-18-v-2', 'double', 'stand', 0.004),
      row('soft-18-v-2', 'double', 'stand', 0.004),
      row('soft-18-v-2', 'double', 'stand', 0.004),
    ]);

    expect(summary.priced).toBe(3);
    expect(summary.worst).toHaveLength(1);
    expect(summary.worst[0]!.times).toBe(3);
    expect(summary.worst[0]!.unitsEach).toBeCloseTo(0.004, 10);
    expect(summary.worst[0]!.unitsTotal).toBeCloseTo(0.012, 10);
  });

  it('keeps two different wrong answers on one hand apart', () => {
    // Hitting a 19 and doubling it are not the same habit and must not merge.
    const summary = evCostSummary([
      row('hard-19-v-6', 'stand', 'hit', 0.45),
      row('hard-19-v-6', 'stand', 'double', 0.9),
    ]);

    expect(summary.worst).toHaveLength(2);
    expect(summary.worst[0]!.taken).toBe('double');
  });

  /**
   * The ranking decision this helper exists to make. A cheap habit repeated is
   * worth more than a dear mistake made once, and a per-occurrence ranking --
   * the obvious implementation -- would print them in exactly the wrong order.
   */
  it('ranks a cheap habit above a spectacular one-off when it costs more in total', () => {
    const history = [
      ...Array.from({ length: 40 }, () => row('soft-18-v-2', 'double', 'stand', 0.0044)),
      row('pair-10-v-8', 'stand', 'double', 0.1),
    ];
    const summary = evCostSummary(history);

    expect(summary.worst[0]!.hand).toBe('soft-18-v-2');
    expect(summary.worst[0]!.unitsTotal).toBeCloseTo(0.176, 10);
    // ...even though each individual instance is worth a twentieth as much.
    expect(summary.worst[0]!.unitsEach).toBeLessThan(summary.worst[1]!.unitsEach);
  });

  it('totals and averages over every priced mistake, grouped or not', () => {
    const summary = evCostSummary([
      row('hard-19-v-6', 'stand', 'hit', 0.4),
      row('hard-19-v-6', 'stand', 'hit', 0.4),
      row('hard-14-v-6', 'stand', 'hit', 0.2),
    ]);

    expect(summary.unitsTotal).toBeCloseTo(1.0, 10);
    expect(summary.meanUnits).toBeCloseTo(1 / 3, 10);
  });

  it('caps the list and keeps the order stable across equal totals', () => {
    const history = [
      row('a', 'stand', 'hit', 0.5),
      row('b', 'stand', 'hit', 0.5),
      row('c', 'stand', 'hit', 0.5),
      row('d', 'stand', 'hit', 0.1),
    ];
    const first = evCostSummary(history, 2);
    const second = evCostSummary([...history].reverse(), 2);

    expect(first.worst.map((r) => r.hand)).toEqual(['a', 'b']);
    // Reversing the input must not reshuffle a tie: a list that reorders
    // between renders reads as noise rather than as a ranking.
    expect(second.worst.map((r) => r.hand)).toEqual(['a', 'b']);
  });

  /**
   * A mistake that genuinely cost nothing (the chart and the arithmetic disagree
   * by a rounding error on two or three cells -- see engine/handEv.test.ts) is a
   * real, priced row worth 0. It must survive into the summary and sort last,
   * not be mistaken for an unpriced one and dropped.
   */
  it('keeps a priced-at-zero mistake as a row, ranked last', () => {
    const summary = evCostSummary([
      row('soft-13-v-5', 'double', 'hit', 0),
      row('hard-19-v-6', 'stand', 'hit', 0.45),
    ]);

    expect(summary.priced).toBe(2);
    expect(summary.worst).toHaveLength(2);
    expect(summary.worst[1]!.hand).toBe('soft-13-v-5');
    expect(summary.worst[1]!.unitsTotal).toBe(0);
  });

  it('carries a row with no hand identity rather than inventing one', () => {
    const summary = evCostSummary([{ expected: 'stand', taken: 'hit', units: 0.3 }]);
    expect(summary.worst[0]!.hand).toBeUndefined();
    expect(summary.worst[0]!.unitsTotal).toBe(0.3);
  });
});
