import { describe, it, expect } from 'vitest';
import { playLabel } from './playLabel';
import { SELF_REPORT_HAD, SELF_REPORT_MISSED, TIMEOUT_ANSWER } from '../drills/gradeAnswer';

describe('printing what a drill graded', () => {
  it('names the five plays', () => {
    expect(playLabel('hit')).toBe('Hit');
    expect(playLabel('surrender')).toBe('Surrender');
  });

  /**
   * The whole reason this exists. `taken` is a plain string so drills can
   * record answers that are not plays, and every one of them read as a play
   * nobody made when printed raw.
   */
  it('never prints a sentinel at the operator', () => {
    for (const sentinel of [TIMEOUT_ANSWER, SELF_REPORT_HAD, SELF_REPORT_MISSED]) {
      const label = playLabel(sentinel);
      expect(label, sentinel).not.toBe(sentinel);
      expect(label, sentinel).not.toContain('-');
    }
  });

  it('says what a self-report actually was', () => {
    expect(playLabel(SELF_REPORT_HAD)).toBe('Said you had it');
    expect(playLabel(SELF_REPORT_MISSED)).toBe('Said you missed it');
  });

  it('passes anything it does not know through unchanged', () => {
    // Better a raw string than a wrong one: an unknown value is a bug to see,
    // not to paper over.
    expect(playLabel('something-new')).toBe('something-new');
  });
});
