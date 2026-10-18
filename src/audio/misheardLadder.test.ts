import { describe, expect, it } from 'vitest';
import { createMisheardLadder } from './misheardLadder';

describe('misheard-answer escalation (C-R4)', () => {
  it('tone, then re-ask, then keeps alternating -- never a hint (D-R5)', () => {
    const ladder = createMisheardLadder();
    const prompt = {};
    const steps = Array.from({ length: 6 }, () => ladder.miss(prompt));
    expect(steps).toEqual(['tone', 'reask', 'tone', 'reask', 'tone', 'reask']);
  });

  it('a recognised answer resets the count', () => {
    const ladder = createMisheardLadder();
    const prompt = {};
    ladder.miss(prompt);
    ladder.miss(prompt);
    ladder.heard();
    expect(ladder.miss(prompt)).toBe('tone');
  });

  it('a new prompt resets the count', () => {
    const ladder = createMisheardLadder();
    ladder.miss('card-1');
    ladder.miss('card-1');
    expect(ladder.miss('card-2')).toBe('tone');
    expect(ladder.miss('card-2')).toBe('reask');
  });
});

describe('array prompt keys', () => {
  it('compare element-wise, so a fresh array per render is the same prompt', () => {
    const ladder = createMisheardLadder();
    const round = {};
    ladder.miss(['answering', round]);
    expect(ladder.miss(['answering', round])).toBe('reask');
    expect(ladder.miss(['feedback', round])).toBe('tone');
  });
});
