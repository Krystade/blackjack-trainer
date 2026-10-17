import { describe, expect, it } from 'vitest';
import { betVerdictText } from './betVerdict';

describe('betVerdictText (B2 #19: the strip says what you tapped)', () => {
  it('a wrong bet names the tapped rung and the right one', () => {
    expect(betVerdictText(1, 'sit', false)).toBe('You bet 1u · Right Sit');
    expect(betVerdictText(8, 4, false)).toBe('You bet 8u · Right 4u');
  });
  it('a wrong sit says you sat out', () => {
    expect(betVerdictText('sit', 4, false)).toBe('You sat out · Right 4u');
  });
  it('a correct answer repeats what you tapped (a cover bet one rung off can differ from the ramp)', () => {
    expect(betVerdictText(4, 4, true)).toBe('Correct — 4u');
    expect(betVerdictText(2, 4, true)).toBe('Correct — 2u');
    expect(betVerdictText('sit', 'sit', true)).toBe('Correct — Sit');
  });
});
