import { describe, it, expect } from 'vitest';
import { gradeTcConversion, tcWorking, tcConventionNote, signedTc } from './tcFeedback';

describe('gradeTcConversion (#54)', () => {
  it('grades against the profile convention only', () => {
    // −6 ÷ 5.5 = −1.09: floor −2, truncate −1.
    expect(gradeTcConversion(-2, -6, 5.5, 'floor')).toBe(true);
    expect(gradeTcConversion(-1, -6, 5.5, 'floor')).toBe(false);
    expect(gradeTcConversion(-1, -6, 5.5, 'truncate')).toBe(true);
    expect(gradeTcConversion(-2, -6, 5.5, 'truncate')).toBe(false);
    // +7 ÷ 2.5 = 2.8: round +3, floor +2.
    expect(gradeTcConversion(3, 7, 2.5, 'floor')).toBe(false);
    expect(gradeTcConversion(3, 7, 2.5, 'round')).toBe(true);
  });

  it("accepts either neighbour on an exact half under 'round', and nothing else", () => {
    // −3 ÷ 2 = −1.5: Math.round gives −1, half-away-from-zero −2.
    expect(gradeTcConversion(-1, -3, 2, 'round')).toBe(true);
    expect(gradeTcConversion(-2, -3, 2, 'round')).toBe(true);
    expect(gradeTcConversion(-3, -3, 2, 'round')).toBe(false);
    expect(tcConventionNote(-2, -3, 2, 'round')).toBeNull();
    // Not a tie: −6 ÷ 5.5 = −1.09 rounds to −1 only.
    expect(gradeTcConversion(-2, -6, 5.5, 'round')).toBe(false);
    // Floor and truncate stay strict on the same tie.
    expect(gradeTcConversion(-1, -3, 2, 'floor')).toBe(false);
    expect(gradeTcConversion(-2, -3, 2, 'truncate')).toBe(false);
  });
});

describe('tcWorking (#54)', () => {
  it('shows the exact quotient and the rule', () => {
    expect(tcWorking(-6, 5.5, 'floor')).toBe('−6 ÷ 5.5 = −1.09 → floor −2');
    expect(tcWorking(7, 2.5, 'round')).toBe('+7 ÷ 2.5 = 2.8 → round +3');
    expect(tcWorking(6, 3, 'truncate')).toBe('+6 ÷ 3 = 2 → truncate +2');
  });
});

describe('tcConventionNote (#54)', () => {
  it('names the convention a wrong answer belongs to', () => {
    expect(tcConventionNote(-1, -6, 5.5, 'floor')).toBe(
      '−1 is truncate or round; your profile floors',
    );
    expect(tcConventionNote(-2, -6, 5.5, 'truncate')).toBe('−2 is floor; your profile truncates');
  });
  it('is silent on a right answer and on a guess no convention gives', () => {
    expect(tcConventionNote(-2, -6, 5.5, 'floor')).toBeNull();
    expect(tcConventionNote(4, -6, 5.5, 'floor')).toBeNull();
  });
  it('signedTc uses a real minus sign', () => {
    expect(signedTc(-3)).toBe('−3');
    expect(signedTc(0)).toBe('0');
    expect(signedTc(2)).toBe('+2');
  });
});
