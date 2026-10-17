import { describe, expect, it } from 'vitest';
import { MINUS, plainNumber, signed, withMinusSigns } from './signed';

/**
 * Wave A: one minus sign throughout the drills. The index labels use U+2212
 * ("TC ≤ −3"); the TC readouts, keypad and prompts beside them used the ASCII
 * hyphen, which is short and easy to misread at a glance.
 */
describe('signed numbers', () => {
  it('signed: "+2", "−2", and 0 bare unless the screen always shows a sign', () => {
    expect(signed(2)).toBe('+2');
    expect(signed(-2)).toBe(`${MINUS}2`);
    expect(signed(0)).toBe('0');
    expect(signed(-0)).toBe('0');
    expect(signed(0, { plusZero: true })).toBe('+0');
    expect(signed(-1.5)).toBe(`${MINUS}1.5`);
    expect(MINUS).toBe('−');
  });

  it('plainNumber: a real minus and no plus', () => {
    expect(plainNumber(-3)).toBe('−3');
    expect(plainNumber(3)).toBe('3');
    expect(plainNumber(0)).toBe('0');
  });

  it('withMinusSigns: every hyphen used as a sign or an operator becomes U+2212', () => {
    expect(withMinusSigns('-1 - (-4)')).toBe('−1 − (−4)');
    expect(withMinusSigns('-6 + (-2)')).toBe('−6 + (−2)');
    expect(withMinusSigns('12 - 5')).toBe('12 − 5');
    // Not a minus: a hyphenated word.
    expect(withMinusSigns('Hi-Lo')).toBe('Hi-Lo');
  });
});
