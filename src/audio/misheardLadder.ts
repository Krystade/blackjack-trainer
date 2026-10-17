/**
 * C-R4 (W16): what to do about an answer the microphone heard but could not
 * match, escalating per prompt.
 *
 *   1st miss  -> the "say again" tone
 *   2nd miss  -> re-ask: the prompt line again
 *   3rd+ miss -> a short hint naming the words this prompt accepts
 *
 * The count resets on a recognised answer (`heard`) or on a new prompt. A
 * prompt is whatever identity the screen hands in -- the card object, say --
 * compared with Object.is (element-wise for an array key), so a fresh draw is a fresh count even when the
 * hand happens to be the same.
 */
export type MisheardStep = 'tone' | 'reask' | 'hint';

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
      if (misses === 1) return 'tone';
      if (misses === 2) return 'reask';
      return 'hint';
    },
    heard() {
      misses = 0;
    },
  };
}

/** "Say hit, stand, double, split or surrender." */
export function hintLine(words: readonly string[]): string {
  if (words.length <= 1) return `Say ${words[0] ?? 'repeat'}.`;
  return `Say ${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}.`;
}

/** The play words, in the order the action bar shows them. */
const PLAY_WORDS = ['hit', 'stand', 'double', 'split', 'surrender'] as const;

/** The hint for a play decision: only the plays legal on this hand. */
export function playHint(legal: readonly string[]): string {
  return hintLine(PLAY_WORDS.filter((w) => legal.includes(w)));
}

export const INSURANCE_HINT = hintLine(['yes', 'no']);

/** The hint while a number is wanted. */
export const NUMBER_HINT = 'Say a number, like plus two or minus one, then yes.';
/** The hint between questions, where only moving on or hearing it again make sense. */
export const NEXT_HINT = hintLine(['yes', 'repeat']);
