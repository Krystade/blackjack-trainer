import { describe, it, expect } from 'vitest';
import { summarize, bestSecondsPerDeck, signedErrorBreakdown } from './drillStats';

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
