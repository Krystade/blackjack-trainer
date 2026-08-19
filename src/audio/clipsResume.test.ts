import { describe, it, expect } from 'vitest';
import { segmentsForClips } from './clips';
import type { ClipManifest } from './clips';

/**
 * A clip chain that broke PART WAY through used to throw the whole utterance
 * away and re-speak it from the top in live TTS. The user heard the opening
 * twice -- once in the good neural voice, once in the robot one -- and the
 * clips that had already played correctly were wasted.
 *
 * Recovering needs the segmentation to remember which WORDS each clip was
 * standing in for, which is what `segmentsForClips` adds over the flat
 * `segmentForClips`. These specs pin that mapping; the player's use of it
 * (`playClipsResumable`) is exercised end to end by e2e/clip-playback.spec.ts,
 * which plays real mp3s.
 */

const manifest: ClipManifest = {
  'You have fourteen.': 'a.mp3',
  'Dealer shows ten.': 'b.mp3',
  'Hit.': 'c.mp3',
};

describe('segmentsForClips', () => {
  it('keeps each sentence beside the clips that speak it', () => {
    expect(segmentsForClips('You have fourteen. Dealer shows ten.', manifest)).toEqual([
      { text: 'You have fourteen.', files: ['a.mp3'] },
      { text: 'Dealer shows ten.', files: ['b.mp3'] },
    ]);
  });

  it('treats a whole-utterance hit as one segment', () => {
    const whole: ClipManifest = { 'You have fourteen. Dealer shows ten.': 'combo.mp3' };
    expect(segmentsForClips('You have fourteen. Dealer shows ten.', whole)).toEqual([
      { text: 'You have fourteen. Dealer shows ten.', files: ['combo.mp3'] },
    ]);
  });

  it('still refuses an utterance it cannot fully cover', () => {
    expect(segmentsForClips('You have fourteen. Dealer shows nine.', manifest)).toBeNull();
  });

  /**
   * The recovery arithmetic itself: given the clip index that failed, the
   * remainder is everything from THAT sentence onward. The partially spoken
   * sentence is repeated in full because there is no way to resume mid-
   * sentence -- a word or two of overlap rather than the entire utterance.
   */
  it('yields a remainder that starts at the failed sentence', () => {
    const segments = segmentsForClips(
      'You have fourteen. Dealer shows ten. Hit.',
      manifest,
    )!;
    const flat = segments.flatMap((seg, segIndex) =>
      seg.files.map((file) => ({ file, segIndex })),
    );
    const remainderFrom = (i: number) =>
      segments
        .slice(flat[i]!.segIndex)
        .map((s) => s.text)
        .join(' ');

    expect(remainderFrom(0)).toBe('You have fourteen. Dealer shows ten. Hit.');
    expect(remainderFrom(1)).toBe('Dealer shows ten. Hit.');
    expect(remainderFrom(2)).toBe('Hit.');
  });
});
