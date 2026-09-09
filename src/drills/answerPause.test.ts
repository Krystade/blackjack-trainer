import { describe, it, expect } from 'vitest';
import { autoAdvanceDelayMs, spokenPauseFor, POST_CORRECTION_BEAT_MS } from './answerPause';

/**
 * The bug this exists to prevent, reported from real use: "during the
 * explanation of what I got wrong, it started talking about the next one".
 *
 * The auto-advance was timed for a silent pause, so once corrections were
 * spoken aloud it fired mid-sentence and the next prompt -- which interrupts
 * -- cut the explanation off. The pause has to outlast the talking.
 */

describe('autoAdvanceDelayMs', () => {
  it('keeps the configured pause when nothing is spoken', () => {
    expect(autoAdvanceDelayMs(1200, 0)).toBe(1200);
  });

  it('waits out speech that runs longer than the configured pause', () => {
    expect(autoAdvanceDelayMs(1200, 3000)).toBe(3000 + POST_CORRECTION_BEAT_MS);
  });

  // A short correction must not SHORTEN a deliberately long pause.
  it('never returns less than the configured pause', () => {
    expect(autoAdvanceDelayMs(4000, 500)).toBe(4000);
  });

  it('leaves a beat between the correction and the next question', () => {
    // Without the beat the two utterances run together into one.
    expect(autoAdvanceDelayMs(0, 2000)).toBeGreaterThan(2000);
  });

  it('never returns a negative delay from a nonsense setting', () => {
    expect(autoAdvanceDelayMs(-500, 0)).toBe(0);
  });
});

describe('spokenPauseFor', () => {
  it('is zero when nothing is said, so a silent correction is unaffected', () => {
    expect(spokenPauseFor(null, 1)).toBe(0);
    expect(spokenPauseFor('', 1)).toBe(0);
  });

  it('grows with the length of what is being said', () => {
    const short = spokenPauseFor('Correct.', 1);
    const long = spokenPauseFor(
      'Wrong. Basic error. You played Hit; the correct play is Stand against a six.',
      1,
    );
    expect(long).toBeGreaterThan(short);
  });

  // A faster voice finishes sooner, so the drill should not sit waiting.
  it('shortens when the voice is set faster', () => {
    const text = 'Wrong. You played Hit; the correct play is Stand.';
    expect(spokenPauseFor(text, 2)).toBeLessThan(spokenPauseFor(text, 1));
  });

  it('treats a missing rate as normal speed rather than dividing by nothing', () => {
    const text = 'Wrong. You played Hit.';
    expect(spokenPauseFor(text, undefined)).toBe(spokenPauseFor(text, 1));
  });
});
