import { describe, it, expect } from 'vitest';
import { DEFAULT_AUDIO } from '../store/types';
import { speechOptsFrom } from './speechOpts';

describe('speechOptsFrom', () => {
  it('carries rate, voice and volume together', () => {
    // The bug this exists to prevent (A4): every drill call site hand-copied
    // `{ rate, voiceURI }`, so when volume was added it reached NONE of the 23
    // of them -- the volume control did nothing in eyes-free drills, which is
    // the one place it matters most.
    const opts = speechOptsFrom({ ...DEFAULT_AUDIO, rate: 1.5, voiceURI: 'v1', volume: 0.4 });
    expect(opts).toEqual({ rate: 1.5, voiceURI: 'v1', volume: 0.4 });
  });

  it('preserves a volume of zero rather than dropping it', () => {
    expect(speechOptsFrom({ ...DEFAULT_AUDIO, volume: 0 }).volume).toBe(0);
  });

  it('merges an interrupt flag without losing the audio settings', () => {
    const opts = speechOptsFrom({ ...DEFAULT_AUDIO, rate: 2 }, { interrupt: true });
    expect(opts.interrupt).toBe(true);
    expect(opts.rate).toBe(2);
    expect(opts.volume).toBe(DEFAULT_AUDIO.volume);
  });

  it('omits interrupt entirely when not asked for', () => {
    expect(speechOptsFrom(DEFAULT_AUDIO).interrupt).toBeUndefined();
  });
});
