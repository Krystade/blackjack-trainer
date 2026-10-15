/**
 * Wave-1 review fix (c): a bounced double tap must not grade a hand the
 * learner never saw.
 *
 * The hand drills deal the next hand the instant an answer lands (B1), on the
 * same buttons. A finger that bounces, or a double tap, therefore lands its
 * second touch on a hand that has been on screen for a few milliseconds --
 * and grades it, into Stats and the review deck. Nobody reads a hand in under
 * a quarter of a second, so input that early is dropped.
 *
 * Pure: the caller passes both instants (performance.now()).
 */
export const ANSWER_BOUNCE_MS = 250;

export function isAnswerBounce(shownAtMs: number, nowMs: number, guardMs: number = ANSWER_BOUNCE_MS): boolean {
  return nowMs - shownAtMs < guardMs;
}
