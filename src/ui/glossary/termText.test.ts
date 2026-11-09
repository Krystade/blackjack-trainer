import { describe, expect, it } from 'vitest';
import { splitTerms } from './splitTerms';

describe('splitTerms', () => {
  it('marks each term once, in order, and keeps the text intact', () => {
    const t = 'Divide the running count by the decks left. The running count, then the true count.';
    const parts = splitTerms(t);
    expect(parts.map((p) => (typeof p === 'string' ? p : p[0])).join('')).toBe(t);
    expect(parts.filter((p) => typeof p !== 'string')).toEqual([
      ['running count', 'rc'],
      ['true count', 'tc'],
    ]);
  });
  it('no terms: the text unchanged', () => {
    expect(splitTerms('Hit or stand.')).toEqual(['Hit or stand.']);
  });
  it('keeps the case as written', () => {
    expect(splitTerms('Deviations and Basic strategy')).toEqual([['Deviations', 'deviation'], ' and ', ['Basic strategy', 'basic-strategy']]);
  });
});
