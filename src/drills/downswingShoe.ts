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

const card = (rank: Rank): Card => ({ rank, suit: 's' });

/**
 * Each losing round is a full card SEQUENCE in the SOLO deal order the engine
 * consumes them: player card 1, dealer up-card, player card 2, dealer hole-card,
 * then any dealer hit-cards (the player never hits — every player hand is a made
 * hard 17-19 that basic strategy stands, and none is a pair, so there's no
 * split/double temptation either, keeping the deal deterministic).
 *
 * TWO families, interleaved so the running count SWINGS across the session:
 *  - HIGH-CARD PAT losses (4 cards): a 10-heavy loss to a higher dealer pat hand
 *    — pushes the count NEGATIVE, so the ramp calls for the minimum bet.
 *  - LOW-CARD DEALER-DRAW-OUT losses (6 cards): the dealer draws small cards out
 *    to 21 and beats the player's pat 18-19 — pushes the count POSITIVE, so the
 *    ramp calls for a BIG bet that then loses. That "bet big at a good count and
 *    lose anyway" hand is the real tilt trigger this session exists to inoculate.
 */
const PAT_LOSSES: readonly Rank[][] = [
  ['10', '10', '9', '10'], // P19 v D20
  ['10', '10', '8', '9'], //  P18 v D19
  ['10', '10', '8', '10'], // P18 v D20
  ['9', '10', '8', '8'], //   P17 v D18
  ['10', '9', '7', '10'], //  P17 v D19
];

const DRAW_OUT_LOSSES: readonly Rank[][] = [
  ['10', '5', '9', '4', '6', '6'], // P19; dealer 5,4 -> hit 6 (15) -> hit 6 (21)
  ['10', '6', '8', '5', '4', '6'], // P18; dealer 6,5 -> hit 4 (15) -> hit 6 (21)
  ['10', '4', '9', '3', '6', '8'], // P19; dealer 4,3 -> hit 6 (13) -> hit 8 (21)
];

/**
 * Build a rigged shoe (Card[]) of `rounds` reliably-losing solo rounds, seeded.
 * A small tail of high cards is appended as a buffer so the underlying Shoe
 * never underflows if a round consumes an unexpected extra card.
 */
export function makeDownswingShoe(rounds: number, seed?: number): Card[] {
  const rng = mulberry32(seed ?? Date.now());
  const cards: Card[] = [];
  for (let r = 0; r < rounds; r++) {
    // A deliberate two-phase ARC so every session visits BOTH count regimes:
    //   1st half — mostly PAT (high-card) losses -> the count grinds NEGATIVE,
    //     so the ramp calls for the minimum bet and you lose small, over and over.
    //   2nd half — mostly DRAW-OUT (low-card) losses -> the count climbs POSITIVE,
    //     so the ramp calls for a BIG bet that the dealer draws out to beat.
    // That "you did everything right, bet big at a good count, and lost anyway"
    // hand is the real tilt trigger. The 20% off-family mix + seeded pattern
    // choice keep it from feeling scripted.
    const drawOutProb = r < rounds / 2 ? 0.35 : 0.85;
    const pool = rng() < drawOutProb ? DRAW_OUT_LOSSES : PAT_LOSSES;
    const ranks = pool[Math.floor(rng() * pool.length)];
    for (const rank of ranks) cards.push(card(rank));
  }
  // Buffer (uncounted-by-design tail) so nothing throws on a misplay's stray hit.
  for (let i = 0; i < 8; i++) cards.push(card('10'));
  return cards;
}
