import { betAnswerLabel, type BetAnswer } from './betSizing';

/**
 * B2 #19: the Bet sizing result line says what was tapped, so a miss reads
 * "You bet 1u · Right Sit" rather than a bare "Wrong — Sit". A correct answer
 * repeats the tapped rung too: with cover bets on, one rung either side of
 * the ramp is graded correct, so it can differ from the ramp's own rung (the
 * working line below still shows that).
 */
export function betVerdictText(taken: BetAnswer, correct: BetAnswer, ok: boolean): string {
  if (ok) return `Correct — ${betAnswerLabel(taken)}`;
  const you = taken === 'sit' ? 'You sat out' : `You bet ${betAnswerLabel(taken)}`;
  return `${you} · Right ${betAnswerLabel(correct)}`;
}
