import { describe, expect, it } from 'vitest';
import { isFloorRow, spreadTcText, stepMinTc } from './spreadRows';

describe('bet ramp rows (Wave A leftover)', () => {
  it('the −99 sentinel is the any-count floor and is never printed as a number', () => {
    expect(isFloorRow({ minTc: -99, units: 1 })).toBe(true);
    expect(isFloorRow({ minTc: -20, units: 1 })).toBe(true);
    expect(isFloorRow({ minTc: -19, units: 1 })).toBe(false);
    expect(spreadTcText({ minTc: -99, units: 1 })).toBe('Any count');
  });
  it('real minus sign on negative counts', () => {
    expect(spreadTcText({ minTc: -2, units: 1 })).toBe('−2');
    expect(spreadTcText({ minTc: 0, units: 1 })).toBe('0');
  });
  it('the stepper stops at −10 and leaves the floor alone', () => {
    expect(stepMinTc({ minTc: -10, units: 1 }, -1)).toBe(-10);
    expect(stepMinTc({ minTc: 0, units: 1 }, 1)).toBe(1);
    expect(stepMinTc({ minTc: -99, units: 1 }, 1)).toBe(-99);
  });
});
