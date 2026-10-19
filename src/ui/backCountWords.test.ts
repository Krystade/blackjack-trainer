import { describe, it, expect } from 'vitest';
import { TOGGLE_BIAS, TOGGLE_WORDS, toggleWordIn } from './backCountWords';
import { VOICE_PHRASES } from '../audio/voiceRecognition';
import { ECHO_MIN_WORDS } from '../audio/selfEcho';
import { narrateInOut, narrateRampPlays, narrateRampSitsOut, narrateSitOut, narrateShuffle } from '../audio/narrate';

describe('In/Out toggle words', () => {
  it('"in" and "sit in" set In; "out" and "sit out" set Out', () => {
    for (const w of ['in', 'In.', 'Sit in', 'get in']) expect(toggleWordIn([w]), w).toBe('in');
    for (const w of ['out', 'Out!', 'sit out', 'get out']) expect(toggleWordIn([w]), w).toBe('out');
  });

  it('only a whole reading counts', () => {
    expect(toggleWordIn(['I will sit in a minute'])).toBeNull();
    expect(toggleWordIn(['out of here'])).toBeNull();
    expect(toggleWordIn(['deal'])).toBeNull();
  });

  it('review S1: only the top reading counts -- a runner-up never flips the toggle', () => {
    expect(toggleWordIn(['yes', 'in'])).toBeNull();
    expect(toggleWordIn(['repeat', 'out'])).toBeNull();
    expect(toggleWordIn(['sitting', 'sit in'])).toBeNull();
    expect(toggleWordIn(['in', 'out'])).toBe('in');
    expect(toggleWordIn([])).toBeNull();
  });

  it('no word collides with the command vocabulary', () => {
    for (const w of TOGGLE_WORDS) expect(VOICE_PHRASES, w).not.toContain(w);
  });

  it('every word is short enough for the self-echo contract', () => {
    for (const w of TOGGLE_WORDS) expect(w.split(' ').length, w).toBeLessThan(ECHO_MIN_WORDS);
  });

  it("the app's own lines are not words -- except the toggle's cue, which names the state it set", () => {
    const lines = [narrateRampPlays(2), narrateRampSitsOut(-3), narrateSitOut(), narrateShuffle()];
    for (const line of lines) {
      for (const sentence of line.split(/(?<=\.)\s*/)) expect(toggleWordIn([sentence]), sentence).toBeNull();
    }
    // Heard back, the cue asks for the state it announced: a no-op.
    expect(toggleWordIn([narrateInOut(true)])).toBe('in');
    expect(toggleWordIn([narrateInOut(false)])).toBe('out');
  });

  it('review S1: only two-word forms are courted by the recogniser', () => {
    expect(TOGGLE_BIAS).toEqual(['sit in', 'get in', 'sit out', 'get out']);
  });
});
