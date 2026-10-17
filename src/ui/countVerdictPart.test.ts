import { describe, expect, it } from 'vitest';
import { countVerdictPart } from './countVerdictPart';

describe('countVerdictPart (B2 #21: the tick repeats what you typed)', () => {
  it('an exact answer reads as before', () => {
    expect(countVerdictPart('Count', 5, true, 5)).toBe('Count ✓ +5');
    expect(countVerdictPart('True count', -3, true, -3)).toBe('True count ✓ −3');
  });
  it('an answer accepted through the depth band shows what you typed, and the graded TC as also right', () => {
    // Round 37 of the finding: peek TC −2.7, typed −2, graded −3.
    expect(countVerdictPart('True count', -2, true, -3)).toBe('True count ✓ −2 (−3 also right)');
    expect(countVerdictPart('True count', 1, true, 2)).toBe('True count ✓ +1 (+2 also right)');
  });
  it('a wrong answer is unchanged', () => {
    expect(countVerdictPart('Count', 1, false, -5)).toBe('Count ✗ you said +1, it was −5');
    expect(countVerdictPart('Count', null, false, -5)).toBe('Count ✗ you said —, it was −5');
  });
});
