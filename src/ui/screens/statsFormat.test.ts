import { describe, it, expect } from 'vitest';
import { pct, pctOfPercent, clockGap, formatUnits, costHandLabel, trendLine, signed } from './statsFormat';

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

describe('formatUnits (#25)', () => {
  it('never prints a priced mistake as free', () => {
    expect(formatUnits(0.0044)).toBe('0.004');
    expect(formatUnits(0.0004)).toBe('<0.001');
    expect(formatUnits(0)).toBe('0');
  });

  it('uses two places once the figure is large enough to carry them', () => {
    expect(formatUnits(0.31)).toBe('0.31');
    expect(formatUnits(0.088)).toBe('0.088');
    expect(formatUnits(12.345)).toBe('12.35');
  });
});

describe('costHandLabel (#25)', () => {
  it('names the cell as the chart does', () => {
    expect(costHandLabel('hard-16-v-10')).toBe('16 v 10');
    expect(costHandLabel('soft-18-v-2')).toBe('Soft 18 v 2');
    expect(costHandLabel('pair-8-v-A')).toBe('8,8 v A');
  });

  it('prints anything else as stored', () => {
    expect(costHandLabel('16 v 10: stand at TC ≥ 0')).toBe('16 v 10: stand at TC ≥ 0');
    expect(costHandLabel(undefined)).toBe('Unidentified hand');
  });
});

describe('trendLine (s04)', () => {
  const runs = (bits: string) => [...bits].map((b) => ({ correct: b === '1' }));
  it('says nothing below ten results', () => {
    expect(trendLine(runs('111111111'))).toBeNull();
  });
  it('states the last ten, then compares with the ten before', () => {
    expect(trendLine(runs('1111111000'))).toBe('Last 10: 7/10');
    expect(trendLine(runs('0000011111' + '1111111110'))).toBe('Last 10: 9/10, up from 5/10 the 10 before');
    expect(trendLine(runs('1111111111' + '1111100000'))).toBe('Last 10: 5/10, down from 10/10 the 10 before');
    expect(trendLine(runs('1'.repeat(20)))).toBe('Last 10: 10/10, same as 10/10 the 10 before');
  });
});

describe('signed', () => {
  it('uses a real minus sign', () => {
    expect(signed(-2)).toBe('\u22122');
    expect(signed(3)).toBe('+3');
    expect(signed(0)).toBe('0');
  });
});

describe('pctOfPercent (F23)', () => {
  it('never rounds 99.6% up to 100% or 0.4% down to 0%', () => {
    expect(pctOfPercent(99.6)).toBe('99%');
    expect(pctOfPercent(100)).toBe('100%');
    expect(pctOfPercent(0.4)).toBe('<1%');
    expect(pctOfPercent(null)).toBe('\u2014');
  });
});
