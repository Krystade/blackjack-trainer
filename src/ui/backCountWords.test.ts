import { describe, it, expect } from 'vitest';
import { BACK_COUNT_WORDS, backCountWordIn } from './backCountWords';
import { VOICE_PHRASES } from '../audio/voiceRecognition';
import { ECHO_MIN_WORDS } from '../audio/selfEcho';
import { narrateRampPlays, narrateRampSitsOut, narrateSitOut, narrateShuffle } from '../audio/narrate';

describe('back-count words', () => {
  it('watching: watch, next and deal watch; sit, sit in, in and play sit in', () => {
    for (const w of ['watch', 'Next', 'deal', 'Deal me.', 'keep watching']) {
      expect(backCountWordIn([w], 'watching'), w).toBe('watch');
    }
    for (const w of ['sit', 'Sit in', 'in', 'play', 'sit down']) {
      expect(backCountWordIn([w], 'watching'), w).toBe('sit-in');
    }
  });

  it('seated: only a leave is claimed -- deal and sit in are not', () => {
    expect(backCountWordIn(['leave'], 'seated')).toBe('leave');
    expect(backCountWordIn(['sit out'], 'seated')).toBe('leave');
    expect(backCountWordIn(['deal'], 'seated')).toBeNull();
    expect(backCountWordIn(['sit in'], 'seated')).toBeNull();
    // ...and a leave word is nothing while watching: there is no seat to leave.
    expect(backCountWordIn(['leave'], 'watching')).toBeNull();
  });

  it('only a whole reading counts', () => {
    expect(backCountWordIn(['I will sit in a minute'], 'watching')).toBeNull();
    expect(backCountWordIn(['watch this'], 'watching')).toBeNull();
  });

  it('the best reading that is a word wins; runners-up are tried', () => {
    expect(backCountWordIn(['sitting', 'sit in'], 'watching')).toBe('sit-in');
    expect(backCountWordIn(['watch', 'sit in'], 'watching')).toBe('watch');
  });

  it('no word collides with the command vocabulary', () => {
    for (const w of BACK_COUNT_WORDS) {
      if (w === 'deal' || w === 'deal me') continue;
      expect(VOICE_PHRASES, w).not.toContain(w);
    }
  });

  it('every word is short enough for the self-echo contract', () => {
    for (const w of BACK_COUNT_WORDS) expect(w.split(' ').length, w).toBeLessThan(ECHO_MIN_WORDS);
  });

  it("none of the app's own back-count lines is itself a word", () => {
    const lines = [narrateRampPlays(2), narrateRampSitsOut(-3), narrateSitOut(), narrateShuffle()];
    for (const line of lines) {
      for (const sentence of line.split(/(?<=\.)\s*/)) {
        expect(backCountWordIn([sentence], 'watching'), sentence).toBeNull();
        expect(backCountWordIn([sentence], 'seated'), sentence).toBeNull();
      }
    }
  });
});
