import { describe, expect, it } from 'vitest';
import { afterAnswer, reviewDoneLine, reviewHeading, reviewPool, reviewStatus } from './reviewSession';

describe('review session (Wave B2 R7, #42)', () => {
  it('a right answer takes the item out; a miss keeps it', () => {
    expect(afterAnswer(['a', 'b', 'c'], 'b', true)).toEqual(['a', 'c']);
    expect(afterAnswer(['a', 'b', 'c'], 'b', false)).toEqual(['a', 'b', 'c']);
  });
  it('never deals the item just answered while another is left', () => {
    expect(reviewPool(['a', 'b'], 'a')).toEqual(['b']);
    expect(reviewPool(['a'], 'a')).toEqual(['a']);
    expect(reviewPool(['a', 'b'], null)).toEqual(['a', 'b']);
    expect(reviewPool([], 'a')).toEqual([]);
  });
  it('answering every item right, once each, empties the set: nothing repeats first', () => {
    let left = ['a', 'b', 'c', 'd'];
    const dealt: string[] = [];
    let prev: string | null = null;
    while (left.length > 0) {
      const id: string = reviewPool(left, prev)[0]!;
      dealt.push(id);
      left = afterAnswer(left, id, true);
      prev = id;
    }
    expect(dealt.sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('labels: "Review · N due", what is left, and the end state', () => {
    expect(reviewHeading('review', 45)).toBe('Review · 45 due');
    expect(reviewStatus('review', 45, 12, 'cell')).toBe('45 cells due · 12 left');
    expect(reviewStatus('review', 8, 1, 'index')).toBe('8 indexes due · 1 left');
    expect(reviewStatus('session', 3, 3, 'hand')).toBe('Drilling 3 hands from your session · 3 left');
    expect(reviewDoneLine('review', 45, 'cell')).toBe('Review done: all 45 cells answered right.');
    expect(reviewDoneLine('session', 1, 'hand')).toBe('Done: the hand from your session answered right.');
    expect(reviewDoneLine('review', 8, 'index')).toBe('Review done: all 8 indexes answered right.');
  });
});
