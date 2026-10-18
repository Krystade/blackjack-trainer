import { describe, expect, it } from 'vitest';
import { DEFAULT_SPREAD } from './game';
import { DEFAULT_WONG_EXIT_TC, sitOutIsCorrect, wongExitTcOf } from './wong';

describe('D-R1: the Wong exit point', () => {
  it('defaults to -2 and clamps a stored value to -5..0', () => {
    expect(DEFAULT_WONG_EXIT_TC).toBe(-2);
    expect(wongExitTcOf(undefined)).toBe(-2);
    expect(wongExitTcOf(Number.NaN)).toBe(-2);
    expect(wongExitTcOf(-9)).toBe(-5);
    expect(wongExitTcOf(3)).toBe(0);
    expect(wongExitTcOf(-3)).toBe(-3);
  });
  it.each([
    [0, false],
    [-1, false],
    [-2, true],
    [-3, true],
  ])('tc %i sits=%s at the default exit, whatever the ramp bets there', (tc, sit) => {
    expect(sitOutIsCorrect(tc, DEFAULT_SPREAD)).toBe(sit);
    // A ramp that bets its minimum up to +2 does not move the line.
    expect(sitOutIsCorrect(tc, [{ minTc: -99, units: 1 }, { minTc: 3, units: 4 }])).toBe(sit);
  });
  it('the exit point is inclusive and moves the line', () => {
    expect(sitOutIsCorrect(-4, DEFAULT_SPREAD, -4)).toBe(true);
    expect(sitOutIsCorrect(-3, DEFAULT_SPREAD, -4)).toBe(false);
    expect(sitOutIsCorrect(0, DEFAULT_SPREAD, 0)).toBe(true);
  });
  it('an empty spread never sits', () => {
    expect(sitOutIsCorrect(-5, [])).toBe(false);
  });
});
