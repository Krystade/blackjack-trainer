import { describe, expect, it } from 'vitest';
import { createMisheardLadder, hintLine, playHint } from './misheardLadder';

describe('misheard-answer escalation (C-R4)', () => {
  it('tone, then re-ask, then the hint, on one prompt', () => {
    const ladder = createMisheardLadder();
    const prompt = {};
    expect(ladder.miss(prompt)).toBe('tone');
    expect(ladder.miss(prompt)).toBe('reask');
    expect(ladder.miss(prompt)).toBe('hint');
    // Keeps listening: further misses keep naming the words.
    expect(ladder.miss(prompt)).toBe('hint');
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

describe('hintLine', () => {
  it('names the accepted words, with "or" before the last', () => {
    expect(hintLine(['hit', 'stand', 'double', 'split', 'surrender'])).toBe(
      'Say hit, stand, double, split or surrender.',
    );
    expect(hintLine(['yes', 'no'])).toBe('Say yes or no.');
    expect(hintLine(['repeat'])).toBe('Say repeat.');
  });
});

describe('playHint', () => {
  it('names only the legal plays, in action-bar order', () => {
    expect(playHint(['stand', 'hit', 'double'])).toBe('Say hit, stand or double.');
  });
});
