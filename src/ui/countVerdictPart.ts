import { signedTc } from '../drills/tcFeedback';

/**
 * One part of the Play count check's verdict ("Count ✓ +3", "True count ✗
 * you said +1, it was −5").
 *
 * B2 #21: a true count is graded BY EYE (engine/count.ts tcWithinEye), so a
 * guess one off the graded figure can be accepted. The tick used to print the
 * graded figure, so typing −2 read "✓ −3", a number never entered. It now
 * repeats what was typed and names the graded figure as also right.
 */
export function countVerdictPart(
  label: string,
  guess: number | null | undefined,
  ok: boolean | undefined,
  actual: number,
): string {
  if (ok) {
    if (guess == null || guess === actual) return `${label} ✓ ${signedTc(actual)}`;
    return `${label} ✓ ${signedTc(guess)} (${signedTc(actual)} also right)`;
  }
  return `${label} ✗ you said ${guess == null ? '—' : signedTc(guess)}, it was ${signedTc(actual)}`;
}
