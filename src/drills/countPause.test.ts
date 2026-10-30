import { describe, expect, it } from 'vitest';
import { isCountResumeWord } from './countPause';

describe('isCountResumeWord (review of A12)', () => {
  it('takes "go on" and "resume", however punctuated', () => {
    expect(isCountResumeWord(['go on'])).toBe(true);
    expect(isCountResumeWord(['Go on.'])).toBe(true);
    expect(isCountResumeWord(['Resume'])).toBe(true);
  });

  it('is not a number, a command or the probe line', () => {
    expect(isCountResumeWord(['minus three'])).toBe(false);
    expect(isCountResumeWord(['Resuming.'])).toBe(false);
    expect(isCountResumeWord(['go on then minus three'])).toBe(false);
    expect(isCountResumeWord([])).toBe(false);
  });
});

// R8 (review of C6): a card's line that the speech watchdog settled (WebKit
// lost its onend) took the whole watchdog, not the card; and a replayed
// card's "Again:" is not the card. Each card counts for at most what saying
// it could take, and only its share of a prefixed line.
describe('countedCardMs (R8)', () => {
  it('a normal card counts as measured', async () => {
    const { countedCardMs } = await import('./countPause');
    expect(countedCardMs(700, 'seven', 'seven')).toBe(700);
  });

  it('a watchdog-settled card is capped at a quarter of its watchdog', async () => {
    const { countedCardMs } = await import('./countPause');
    const { estimateWatchdogMs } = await import('../audio/watchdog');
    expect(countedCardMs(estimateWatchdogMs('seven'), 'seven', 'seven')).toBe(estimateWatchdogMs('seven') / 4);
    expect(countedCardMs(9000, 'seven, king', 'seven, king')).toBeLessThan(9000 / 4);
  });

  it('a replayed card counts only its share of "Again: ..."', async () => {
    const { countedCardMs, COUNT_AGAIN_PREFIX } = await import('./countPause');
    const spoken = `${COUNT_AGAIN_PREFIX} seven`;
    expect(countedCardMs(1200, spoken, 'seven')).toBeCloseTo((1200 * 'seven'.length) / spoken.length, 9);
  });
});
