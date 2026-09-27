import { describe, it, expect } from 'vitest';
import { pct, clockGap } from './statsFormat';

describe('pct', () => {
  it('never prints a perfect score that was not earned', () => {
    expect(pct(999, 1000)).toBe('99%');
    expect(pct(1000, 1000), 'an actually perfect score must still read 100%').toBe('100%');
  });

  it('never rounds a scored answer down to nothing', () => {
    expect(pct(1, 1000)).toBe('<1%');
    expect(pct(0, 1000)).toBe('0%');
  });

  it('is the ordinary rounding everywhere else', () => {
    expect(pct(1, 2)).toBe('50%');
    expect(pct(2, 3)).toBe('67%');
    expect(pct(0, 0)).toBe('\u2014');
  });
});

describe('clockGap', () => {
  it('refuses to call one answer each a finding', () => {
    const verdict = clockGap({ right: 0, wrong: 1 }, { right: 1, wrong: 0 });
    expect(verdict.distinguishable).toBe(false);
    expect(verdict.text).toContain('Too few');
    // The number is still shown -- hiding the data is not the fix -- but it
    // is shown as what it is.
    expect(verdict.gap).toBe(100);
  });

  it('still refuses at a sample that merely looks respectable', () => {
    // 7/10 against 6/10 is a ten-point "gap" and is nothing at all.
    expect(clockGap({ right: 6, wrong: 4 }, { right: 7, wrong: 3 }).distinguishable).toBe(false);
  });

  it('states the gap once the two are actually separated', () => {
    const verdict = clockGap({ right: 40, wrong: 60 }, { right: 90, wrong: 10 });
    expect(verdict.distinguishable).toBe(true);
    expect(verdict.gap).toBe(50);
    expect(verdict.text).toContain('50 points better without the clock');
  });

  it('says so when the clock is the better half, rather than hiding it', () => {
    const verdict = clockGap({ right: 90, wrong: 10 }, { right: 40, wrong: 60 });
    expect(verdict.distinguishable).toBe(true);
    expect(verdict.text).toContain('WITH the clock');
  });
});
