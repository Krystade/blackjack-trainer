import { describe, expect, it } from 'vitest';
import { cutOffText, resumeSpoken, resumeTitle, sinceText } from './resumeCopy';

/** Track 3 (U4): what a resumed Play says. */

const T = 1_800_000_000_000;

describe('resume copy', () => {
  it('how long the shoe sat', () => {
    expect(sinceText(T, T + 20_000)).toBe('just now');
    expect(sinceText(T, T + 4 * 60_000)).toBe('4 min ago');
    expect(sinceText(T, T + 135 * 60_000)).toBe('2 h ago');
    expect(sinceText(T, T - 5000), 'a clock set back reads as now').toBe('just now');
  });

  it('the headline names the last round played and the age', () => {
    expect(resumeTitle({ roundNo: 14, cutOff: null, savedAt: T }, T + 4 * 60_000)).toBe('Shoe resumed after round 14 (4 min ago).');
  });

  it('a cut-off round is named, and only then', () => {
    expect(cutOffText({ roundNo: 14, cutOff: null, savedAt: T })).toBeNull();
    expect(cutOffText({ roundNo: 14, cutOff: 15, savedAt: T })).toBe('Round 15 was cut off: its cards are burned and counted, the bet is void.');
  });

  it('spoken: the round, and the cut-off when there was one', () => {
    expect(resumeSpoken({ roundNo: 3, cutOff: null, savedAt: T })).toBe('Shoe resumed after round 3.');
    expect(resumeSpoken({ roundNo: 3, cutOff: 4, savedAt: T })).toBe('Shoe resumed after round 3. Round 4 was cut off; its cards stay counted.');
  });
});
