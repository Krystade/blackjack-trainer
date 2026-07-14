import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { classifyAction, actionCategory } from './grade';
import { correctPlay, basicPlay } from './strategy';
import type { PlayContext } from './strategy';

function cards(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

function ctx(overrides: Partial<PlayContext> = {}): PlayContext {
  return { canDouble: true, canSplit: true, canSurrender: false, ...overrides };
}

describe('classifyAction: (10,6)v10 tc 2 (correct stand with deviation)', () => {
  const hand = cards('10', '6');
  const up = '10' as Rank;
  const tc = 2;
  const withCount = correctPlay(hand, up, tc, ctx());
  const basicOnly = basicPlay(hand, up, ctx());

  it('taken stand -> correct', () => {
    const result = classifyAction('stand', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(true);
    expect(result.classification).toBe('correct');
  });

  it('taken hit -> missed-deviation', () => {
    const result = classifyAction('hit', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(false);
    expect(result.classification).toBe('missed-deviation');
  });

  it('taken double -> wrong-anyway', () => {
    const result = classifyAction('double', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(false);
    expect(result.classification).toBe('wrong-anyway');
  });
});

describe('classifyAction: (10,6)v10 tc -2 (correct hit, no deviation)', () => {
  const hand = cards('10', '6');
  const up = '10' as Rank;
  const tc = -2;
  const withCount = correctPlay(hand, up, tc, ctx());
  const basicOnly = basicPlay(hand, up, ctx());

  it('taken stand -> phantom-deviation', () => {
    const result = classifyAction('stand', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(false);
    expect(result.classification).toBe('phantom-deviation');
  });

  it('taken double -> basic-error', () => {
    const result = classifyAction('double', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(false);
    expect(result.classification).toBe('basic-error');
  });
});

describe('classifyAction: (10,2)v4 tc -3 (correct hit with deviation)', () => {
  const hand = cards('10', '2');
  const up = '4' as Rank;
  const tc = -3;
  const withCount = correctPlay(hand, up, tc, ctx());
  const basicOnly = basicPlay(hand, up, ctx());

  it('taken stand -> missed-deviation', () => {
    const result = classifyAction('stand', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(false);
    expect(result.classification).toBe('missed-deviation');
  });

  it('taken double -> wrong-anyway', () => {
    const result = classifyAction('double', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(false);
    expect(result.classification).toBe('wrong-anyway');
  });
});

describe('classifyAction: (10,10)v6 tc 2 (pair10 phantom — below TTv6 threshold 4)', () => {
  const hand = cards('10', '10');
  const up = '6' as Rank;
  const tc = 2;
  const withCount = correctPlay(hand, up, tc, ctx()); // basic stand (TTv6 needs tc >= 4)
  const basicOnly = basicPlay(hand, up, ctx());

  // Pins the pair10 branch of isPhantomDeviation: splitting tens when the
  // count does not justify TTv6 must read as a phantom deviation.
  it('taken split -> phantom-deviation', () => {
    const result = classifyAction('split', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(false);
    expect(result.classification).toBe('phantom-deviation');
  });
});

describe('classifyAction: (A,5)v10 tc -1 (soft-hand exclusion from hard entries)', () => {
  const hand = cards('A', '5'); // soft 16
  const up = '10' as Rank;
  const tc = -1;
  const withCount = correctPlay(hand, up, tc, ctx()); // basic hit (soft 16 v 10)
  const basicOnly = basicPlay(hand, up, ctx());

  // Pins the hv.soft guard in isPhantomDeviation: soft 16 must NOT match the
  // hard 16v10 entry, so a wrong stand is a plain basic-error, not phantom.
  it('taken stand -> basic-error (not phantom via hard 16v10)', () => {
    const result = classifyAction('stand', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(false);
    expect(result.classification).toBe('basic-error');
  });
});

describe('classifyAction: (6,5)vA (inactive 11vA entry exclusion)', () => {
  const hand = cards('6', '5'); // hard 11
  const up = 'A' as Rank;

  // Pins that the inactive 11vA entry never surfaces as a deviation:
  // basic strategy (H17) already doubles 11 v A at ANY count, so a double at
  // tc -5 is plain 'correct' with source basic — no deviation involved.
  it('tc -5 taken double -> correct (11vA absorbed into basic, stays basic)', () => {
    const tc = -5;
    const withCount = correctPlay(hand, up, tc, ctx());
    expect(withCount.source).toBe('basic'); // guard the fixture: not a deviation
    const basicOnly = basicPlay(hand, up, ctx());
    const result = classifyAction('double', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(true);
    expect(result.classification).toBe('correct');
  });

  // Sanity companion: a wrong stand on 11 v A is a basic-error; no active
  // entry (and no entry at all with action 'stand' for hard 11) can match.
  it('tc 0 taken stand -> basic-error (never phantom via inactive 11vA)', () => {
    const tc = 0;
    const withCount = correctPlay(hand, up, tc, ctx());
    const basicOnly = basicPlay(hand, up, ctx());
    const result = classifyAction('stand', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(false);
    expect(result.classification).toBe('basic-error');
  });

  // Genuinely exercises the active:false guard in isPhantomDeviation:
  // with canDouble:false, the correct/basic play is HIT, so taken 'double'
  // reaches the phantom check with an action that MATCHES the inactive 11vA
  // entry (hard 11 v A, action 'double'). Without the `if (!dev.active)`
  // guard this would misclassify as phantom-deviation.
  it('tc 0, canDouble:false, taken double -> basic-error (active:false guard)', () => {
    const tc = 0;
    const noDouble = ctx({ canDouble: false });
    const withCount = correctPlay(hand, up, tc, noDouble); // hit (double unavailable)
    const basicOnly = basicPlay(hand, up, noDouble);
    const result = classifyAction('double', withCount, basicOnly, hand, up, tc);
    expect(result.correct).toBe(false);
    expect(result.classification).toBe('basic-error');
  });
});

describe('actionCategory', () => {
  it('(8,8)v9 correct split -> pairs', () => {
    const hand = cards('8', '8');
    const result = actionCategory(hand, 'split');
    expect(result).toBe('pairs');
  });

  it('(10,6)v10 correct surrender -> surrender', () => {
    const hand = cards('10', '6');
    const result = actionCategory(hand, 'surrender');
    expect(result).toBe('surrender');
  });

  it('(A,6)v3 -> soft', () => {
    const hand = cards('A', '6');
    const result = actionCategory(hand, 'hit');
    expect(result).toBe('soft');
  });

  it('(10,9)v5 -> hard', () => {
    const hand = cards('10', '9');
    const result = actionCategory(hand, 'stand');
    expect(result).toBe('hard');
  });
});
