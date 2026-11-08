import { betAnswerLabel, type BetAnswer } from './betSizing';

/**
 * B2 #19: the Bet sizing result line says what was tapped, so a miss reads
 * "You bet 1u · Right Sit" rather than a bare "Wrong — Sit". A correct answer
 * repeats the tapped rung too: with cover bets on, one rung either side of
 * the ramp is graded correct, so it can differ from the ramp's own rung (the
 * working line below still shows that).
 */
export function betVerdictText(
  taken: BetAnswer,
  correct: BetAnswer,
  ok: boolean,
  /** Track 3: Show chips names a rung in dollars ("$100"); default units ("4u"). */
  label: (a: BetAnswer) => string = betAnswerLabel,
): string {
  if (ok) return `Correct — ${label(taken)}`;
  const you = taken === 'sit' ? 'You sat out' : `You bet ${label(taken)}`;
  return `${you} · Right ${label(correct)}`;
}
