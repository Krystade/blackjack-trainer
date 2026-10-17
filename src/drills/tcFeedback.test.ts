import { describe, it, expect } from 'vitest';
import { gradeTcConversion, tcWorking, tcConventionNote, signedTc, tcAnswer, tcWrongLead } from './tcFeedback';

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

describe('Wave A (s05): an exact half under round', () => {
  it('names both accepted answers, so the verdict never sits above a different number', () => {
    expect(tcWorking(2, 4, 'round')).toBe('+2 ÷ 4 = 0.5, an exact half → 0 or +1');
    expect(tcWorking(-3, 2, 'round')).toBe('−3 ÷ 2 = −1.5, an exact half → −2 or −1');
    expect(gradeTcConversion(0, 2, 4, 'round')).toBe(true);
    expect(gradeTcConversion(1, 2, 4, 'round')).toBe(true);
  });
  it('leaves floor/truncate halves alone', () => {
    expect(tcWorking(2, 4, 'floor')).toBe('+2 ÷ 4 = 0.5 → floor 0');
  });
});

/**
 * Wave A (s02 ux): "Wrong: you entered −1 — −11 ÷ 6 = −1.83 → floor −2" put an
 * em dash against a minus sign, which reads as one long dash, and buried the
 * right answer at the end. The wrong line now leads with the answer.
 */
describe('tcWrongLead / tcAnswer', () => {
  it('leads with the answer, then what was entered, then the convention', () => {
    const note = tcConventionNote(-1, -11, 6, 'floor');
    expect(tcWrongLead(tcAnswer(-11, 6, 'floor'), -1, note)).toBe(
      'Wrong: TC \u22122, not \u22121 (\u22121 is truncate; your profile floors).',
    );
    expect(tcWrongLead('+3', 5, null)).toBe('Wrong: TC +3, not +5.');
  });

  it('never puts a dash against a minus sign', () => {
    const line = `${tcWrongLead(tcAnswer(-11, 6, 'floor'), -1, null)} ${tcWorking(-11, 6, 'floor')}.`;
    expect(line).not.toMatch(/[\u2014-]\s*\u2212/);
  });

  it("an exact half under 'round' has two right answers", () => {
    expect(tcAnswer(-3, 2, 'round')).toBe('\u22122 or \u22121');
    expect(tcAnswer(7, 2.5, 'round')).toBe('+3');
  });
});
