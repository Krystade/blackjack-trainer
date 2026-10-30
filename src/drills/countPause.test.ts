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
