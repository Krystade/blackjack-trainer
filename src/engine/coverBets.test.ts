import { describe, it, expect } from 'vitest';
import {
  spreadSteps,
  betWithinStep,
  lockstepTell,
  TELL_MIN_ROUNDS,
  TELL_RATIO,
} from './coverBets';
import type { SpreadRow } from './game';

const SPREAD: SpreadRow[] = [
  { minTc: -99, units: 1 },
  { minTc: 1, units: 2 },
  { minTc: 2, units: 4 },
  { minTc: 3, units: 8 },
  { minTc: 4, units: 10 },
  { minTc: 5, units: 12 },
];

describe('spreadSteps', () => {
  it('lists the distinct sizes, ascending', () => {
    expect(spreadSteps(SPREAD)).toEqual([1, 2, 4, 8, 10, 12]);
  });

  it('collapses rungs that call for the same size', () => {
    expect(
      spreadSteps([
        { minTc: -99, units: 1 },
        { minTc: 1, units: 1 },
        { minTc: 2, units: 4 },
      ]),
    ).toEqual([1, 4]);
  });

  it('is empty for an empty spread', () => {
    expect(spreadSteps([])).toEqual([]);
  });
});

describe('betWithinStep', () => {
  it('accepts the exact bet', () => {
    expect(betWithinStep(4, 4, SPREAD)).toBe(true);
  });

  it('accepts one rung either side -- the rung, not one unit', () => {
    expect(betWithinStep(2, 4, SPREAD)).toBe(true);
    expect(betWithinStep(8, 4, SPREAD)).toBe(true);
    // 3 units sits between rungs; it is not a step of this ramp.
    expect(betWithinStep(3, 4, SPREAD)).toBe(false);
    expect(betWithinStep(5, 4, SPREAD)).toBe(false);
  });

  it('rejects two rungs away', () => {
    expect(betWithinStep(1, 4, SPREAD)).toBe(false);
    expect(betWithinStep(10, 4, SPREAD)).toBe(false);
  });

  it('the bottom rung has no rung below it, and the top none above', () => {
    expect(betWithinStep(2, 1, SPREAD)).toBe(true);
    expect(betWithinStep(4, 1, SPREAD)).toBe(false);
    expect(betWithinStep(10, 12, SPREAD)).toBe(true);
    expect(betWithinStep(8, 12, SPREAD)).toBe(false);
  });

  it('falls back to exact when the expected size is not a rung at all', () => {
    // A hand-edited profile can produce this; a tolerance around a position
    // that does not exist would be arbitrary.
    expect(betWithinStep(7, 7, SPREAD)).toBe(true);
    expect(betWithinStep(8, 7, SPREAD)).toBe(false);
    expect(betWithinStep(1, 1, [])).toBe(true);
    expect(betWithinStep(2, 1, [])).toBe(false);
  });
});

describe('lockstepTell', () => {
  const exactly = (n: number) => Array.from({ length: n }, () => ({ taken: 4, expected: 4 }));
  const off = (n: number) => Array.from({ length: n }, () => ({ taken: 2, expected: 4 }));

  it('a perfectly mechanical session is a tell', () => {
    const t = lockstepTell(exactly(TELL_MIN_ROUNDS));
    expect(t.ratio).toBe(1);
    expect(t.isTell).toBe(true);
  });

  it('too few rounds is not a pattern, however exact', () => {
    const t = lockstepTell(exactly(TELL_MIN_ROUNDS - 1));
    expect(t.ratio).toBe(1);
    expect(t.isTell).toBe(false);
  });

  it('a session with real cover in it is not a tell', () => {
    const t = lockstepTell([...exactly(5), ...off(5)]);
    expect(t.ratio).toBe(0.5);
    expect(t.isTell).toBe(false);
  });

  it('the threshold is a floor, not a strict inequality', () => {
    // 18 of 20 = exactly TELL_RATIO.
    const t = lockstepTell([...exactly(18), ...off(2)]);
    expect(t.ratio).toBeCloseTo(TELL_RATIO, 10);
    expect(t.isTell).toBe(true);
  });

  it('just under the threshold is not flagged', () => {
    const t = lockstepTell([...exactly(17), ...off(3)]);
    expect(t.ratio).toBeLessThan(TELL_RATIO);
    expect(t.isTell).toBe(false);
  });

  it('counts what it saw', () => {
    const t = lockstepTell([...exactly(3), ...off(2)]);
    expect(t.rounds).toBe(5);
    expect(t.exact).toBe(3);
  });

  it('no rounds is not a tell, and does not divide by zero', () => {
    const t = lockstepTell([]);
    expect(t.ratio).toBe(0);
    expect(t.isTell).toBe(false);
  });
});
