import { trueCount, tcWithinEye } from '../engine/count';
import type { TcRounding } from '../engine/count';

/**
 * #54: grading and feedback for the true-count conversion drills.
 *
 * Both drills used to grade with `tcConversionAccepted`, which takes floor,
 * round OR truncate, while the result line printed only the profile's rule --
 * so "Correct!" sat above "the true count was -2" for an entered -1, and no
 * single convention was ever trained. Grading is now the profile's
 * `tcRounding` only, and a wrong answer that another convention would have
 * produced says so, so the convention mistake is visible as one.
 */

const ROUNDINGS: readonly TcRounding[] = ['floor', 'truncate', 'round'];

/** "floors" / "truncates" / "rounds" -- "your profile floors". */
const VERB: Record<TcRounding, string> = {
  floor: 'floors',
  truncate: 'truncates',
  round: 'rounds',
};

/** Signed, with a real minus sign: "+2", "−2", "0". */
export function signedTc(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** Plain number with a real minus sign and at most two decimals. */
function plain(n: number): string {
  const s = String(Number(n.toFixed(2)));
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
}

/** Strict grade: the profile's convention, nothing else. */
export function gradeTcConversion(
  guess: number,
  runningCount: number,
  decksRemaining: number,
  rounding: TcRounding,
): boolean {
  if (guess === trueCount(runningCount, decksRemaining, rounding)) return true;
  // 'round' on an exact half (−3 ÷ 2 = −1.5) is a tie the profile's rule does
  // not settle: Math.round sends it up to −1, half-away-from-zero to −2, and a
  // counter's book may mean either. Both neighbours are right there.
  if (rounding !== 'round') return false;
  const exact = runningCount / Math.max(0.5, decksRemaining);
  return Math.abs(exact - Math.trunc(exact)) === 0.5 && Math.abs(guess - exact) === 0.5;
}

/** The exact working: "−6 ÷ 5.5 = −1.09 → floor −2" (the count signed, "+7 ÷ …"). */
export function tcWorking(runningCount: number, decksRemaining: number, rounding: TcRounding): string {
  const decks = Math.max(0.5, decksRemaining);
  const exact = runningCount / decks;
  const answer = trueCount(runningCount, decksRemaining, rounding);
  return `${signedTc(runningCount)} ÷ ${plain(decks)} = ${plain(exact)} → ${rounding} ${signedTc(answer)}`;
}

/**
 * When a WRONG guess is what another convention gives, name it:
 * "−1 is truncate; your profile floors". Null when the guess is right under
 * the profile's rule or matches no convention at all.
 *
 * `eyeError` lets the produce-TC drill ask the same question of its by-eye
 * band: a guess outside the floor band but inside the truncate band is the
 * same convention mistake, made from a tray.
 */
export function tcConventionNote(
  guess: number,
  runningCount: number,
  decksRemaining: number,
  rounding: TcRounding,
  eyeError = 0,
): string | null {
  if (tcWithinEye(guess, runningCount, decksRemaining, eyeError, rounding)) return null;
  if (eyeError === 0 && gradeTcConversion(guess, runningCount, decksRemaining, rounding)) return null;
  const others = ROUNDINGS.filter(
    (r) => r !== rounding && tcWithinEye(guess, runningCount, decksRemaining, eyeError, r),
  );
  if (others.length === 0) return null;
  return `${signedTc(guess)} is ${others.join(' or ')}; your profile ${VERB[rounding]}`;
}
