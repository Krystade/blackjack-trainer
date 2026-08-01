import type { Card, Rank } from '../engine/cards';
import { mulberry32 } from '../engine/cards';

/**
 * ET1 (docs/BACKLOG.md, experiential training): the tilt-inoculation downswing.
 * Generates a rigged SOLO shoe (no bots) that deals a run of REAL but reliably
 * LOSING hands, so the learner experiences a sustained drawdown while being
 * graded on spread-conformity — the one thing CVCX can't rehearse: keeping to
 * your ramp (here, not CHASING with bigger bets) through a bad run.
 *
 * Robustness: every round is a PAT-HAND loss — the player is dealt a made hard
 * 17–19 and the dealer a higher made 18–20, both from two cards. Basic strategy
 * STANDS on hard 17+, so a competent player takes no hits and the dealer (17+)
 * doesn't draw either: exactly 4 cards are consumed per round in a fixed order
 * (player1, dealer-up, player2, dealer-hole), so the rig can't desync. No Ace
 * up-cards, so no insurance/peek detours. The high-card-heavy composition drives
 * the running count negative, so the ramp correctly calls for the MINIMUM bet —
 * the discipline the session tests is holding that minimum, not chasing.
 */

type Pattern = { player: [Rank, Rank]; dealerUp: Rank; dealerHole: Rank };

/** Each pattern is a two-card player pat hand that loses to a higher two-card
 * dealer pat hand. Varied for immersion; all are no-hit, no-Ace, guaranteed
 * losses. */
const LOSING_PATTERNS: readonly Pattern[] = [
  { player: ['10', '9'], dealerUp: '10', dealerHole: '10' }, // 19 v 20
  { player: ['10', '8'], dealerUp: '10', dealerHole: '9' }, //  18 v 19
  { player: ['10', '8'], dealerUp: '10', dealerHole: '10' }, // 18 v 20
  { player: ['9', '8'], dealerUp: '10', dealerHole: '8' }, //   17 v 18
  { player: ['10', '7'], dealerUp: '9', dealerHole: '10' }, //  17 v 19
];

const card = (rank: Rank): Card => ({ rank, suit: 's' });

/** Cards for one round, in the SOLO deal order the engine consumes them:
 * player card 1, dealer up-card, player card 2, dealer hole-card. */
function roundCards(p: Pattern): Card[] {
  return [card(p.player[0]), card(p.dealerUp), card(p.player[1]), card(p.dealerHole)];
}

/**
 * Build a rigged shoe (Card[]) of `rounds` reliably-losing solo rounds, seeded.
 * A small tail of high cards is appended as a buffer so the underlying Shoe
 * never underflows if a round consumes an unexpected extra card.
 */
export function makeDownswingShoe(rounds: number, seed?: number): Card[] {
  const rng = mulberry32(seed ?? Date.now());
  const cards: Card[] = [];
  for (let r = 0; r < rounds; r++) {
    const pattern = LOSING_PATTERNS[Math.floor(rng() * LOSING_PATTERNS.length)];
    cards.push(...roundCards(pattern));
  }
  // Buffer (uncounted-by-design tail) so nothing throws on a misplay's stray hit.
  for (let i = 0; i < 8; i++) cards.push(card('10'));
  return cards;
}

/** Exposed for tests / the view: the fixed cards-per-round of the rigged deal. */
export const DOWNSWING_CARDS_PER_ROUND = 4;
