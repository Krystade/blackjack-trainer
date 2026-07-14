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
