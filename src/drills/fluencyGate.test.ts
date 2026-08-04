import { describe, it, expect } from 'vitest';
import { isCountFluent, FLUENCY_MIN_RUNS, FLUENCY_MIN_ACCURACY } from './fluencyGate';

const runs = (n: number, correct: number) =>
  Array.from({ length: n }, (_, i) => ({ correct: i < correct }));

describe('isCountFluent (V3-4 soft gate)', () => {
  it('is not fluent with too few runs, even at 100% accuracy', () => {
    expect(isCountFluent(runs(FLUENCY_MIN_RUNS - 1, FLUENCY_MIN_RUNS - 1))).toBe(false);
    expect(isCountFluent([])).toBe(false);
  });

  it('is fluent at/above the run + accuracy floor', () => {
    const correctNeeded = Math.ceil(FLUENCY_MIN_RUNS * FLUENCY_MIN_ACCURACY);
    expect(isCountFluent(runs(FLUENCY_MIN_RUNS, correctNeeded))).toBe(true);
    expect(isCountFluent(runs(20, 20))).toBe(true);
  });

  it('is not fluent when accuracy is below the floor, even with enough runs', () => {
    // 10 runs, 5 correct = 50% < 70%.
    expect(isCountFluent(runs(FLUENCY_MIN_RUNS, Math.floor(FLUENCY_MIN_RUNS * 0.5)))).toBe(false);
  });
});
