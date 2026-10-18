/**
 * C-R4 (W16): what to do about an answer the microphone heard but could not
 * match, escalating per prompt.
 *
 *   1st miss  -> the "say again" tone
 *   2nd miss  -> re-ask: the prompt line again
 *   3rd+ miss -> keep alternating: tone, re-ask, tone, ...
 *
 * D-R5: there is no spoken hint step. Jack ruled it out on 2026-10-17 --
 * the ladder never says anything but the prompt itself.
 *
 * The count resets on a recognised answer (`heard`) or on a new prompt. A
 * prompt is whatever identity the screen hands in -- the card object, say --
 * compared with Object.is (element-wise for an array key), so a fresh draw is a fresh count even when the
 * hand happens to be the same.
 */
export type MisheardStep = 'tone' | 'reask';

export interface MisheardLadder {
  miss(promptKey: unknown): MisheardStep;
  heard(): void;
}

/** Object.is, or element-wise for arrays (a fresh array each render). */
function sameKey(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  }
  return Object.is(a, b);
}

export function createMisheardLadder(): MisheardLadder {
  let key: unknown = Symbol('none');
  let misses = 0;
  return {
    miss(promptKey) {
      if (!sameKey(promptKey, key)) {
        key = promptKey;
        misses = 0;
      }
      misses += 1;
      return misses % 2 === 1 ? 'tone' : 'reask';
    },
    heard() {
      misses = 0;
    },
  };
}
