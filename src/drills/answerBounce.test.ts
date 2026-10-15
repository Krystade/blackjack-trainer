import { describe, expect, it } from 'vitest';
import { ANSWER_BOUNCE_MS, isAnswerBounce } from './answerBounce';

describe('isAnswerBounce', () => {
  it('drops input that lands before a hand could have been read', () => {
    expect(isAnswerBounce(1000, 1000)).toBe(true);
    expect(isAnswerBounce(1000, 1000 + ANSWER_BOUNCE_MS - 1)).toBe(true);
  });

  it('takes input from the guard onwards', () => {
    expect(isAnswerBounce(1000, 1000 + ANSWER_BOUNCE_MS)).toBe(false);
    expect(isAnswerBounce(1000, 5000)).toBe(false);
  });

  it('a zero guard takes everything', () => {
    expect(isAnswerBounce(1000, 1000, 0)).toBe(false);
  });

  it('is about a quarter of a second', () => {
    expect(ANSWER_BOUNCE_MS).toBe(250);
  });
});
