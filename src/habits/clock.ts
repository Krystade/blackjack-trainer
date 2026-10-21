/**
 * Wave N: the habit layer's clock, one seam for the store and the spoken
 * moment so a test that moves time moves both.
 */
let clock: () => number = () => Date.now();

export function habitClock(): number {
  return clock();
}

/** Test seam. */
export function _setHabitClockForTest(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}
