import { describe, it, expect } from 'vitest';
import { isDealWord } from './dealWord';

describe('isDealWord (B2 #37)', () => {
  it('hears "deal" and "deal me", in any case and punctuation', () => {
    expect(isDealWord(['deal'])).toBe(true);
    expect(isDealWord(['Deal me.'])).toBe(true);
    expect(isDealWord(['Deal!'])).toBe(true);
  });
  it('takes a runner-up reading too', () => {
    expect(isDealWord(['kneel', 'deal'])).toBe(true);
  });
  it('does not take a sentence that only contains the word', () => {
    expect(isDealWord(['what a deal'])).toBe(false);
    expect(isDealWord(['dealer has ten'])).toBe(false);
    expect(isDealWord(['hit'])).toBe(false);
    expect(isDealWord([])).toBe(false);
  });
});
