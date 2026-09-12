import type { Card, Rank } from '../engine/cards';
import { mulberry32 } from '../engine/cards';

/**
 * ET1 (docs/BACKLOG.md, experiential training): the tilt-inoculation downswing.
 * Generates a rigged SOLO shoe (no bots) that deals a run of REAL but reliably
 * LOSING hands, so the learner experiences a sustained drawdown while being
 * graded on spread-conformity — the one thing CVCX can't rehearse: keeping to
 * your ramp (here, not CHASING with bigger bets) through a bad run.
 *
 * Robustness: every round consumes a KNOWN number of cards whatever the player
 * does, in a fixed order (player1, dealer-up, player2, dealer-hole, then any
 * draws), so the rig can't desync. No Ace up-cards anywhere, so no
 * insurance/peek detours, and no pairs, so no split branch.
 *
 * V3-7: it used to be a STAND-ONLY WALL. Every hand was a made hard 17-19, so
 * basic strategy stood on all of them and the play phase was one button pressed
 * twenty-five times -- which meant tilt, the entire subject of the drill, had
 * nothing to corrupt except the bet. Chasing a loss is not only a betting
 * behaviour: it is hitting a stiff you should stand, standing on one you should
 * hit, doubling to get it back in one hand, and giving up. `DECISION_LOSSES`
 * puts real, uncomfortable, CORRECT-but-losing decisions in front of the player
 * so the drill can grade the play too.
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
 * V3-7: STIFF HANDS THAT LOSE WHATEVER YOU DO — the family that gives tilt
 * something to corrupt.
 *
 * Every round here is five cards, `[P1, Dup, P2, Dhole, X]`, built to one shape:
 *
 *   - the player holds a hard 12-16 from two unpaired, ace-free cards;
 *   - the dealer's two cards total 7-11, so the dealer MUST draw exactly once;
 *   - the up-card is 2-8, so there is no peek, no insurance, and no hand on
 *     which basic strategy would surrender;
 *   - `X`, the fifth card, is a ten.
 *
 * That shape makes the round cost exactly five cards down EVERY line the player
 * can take, which is what keeps the rig from desyncing now that there is a real
 * decision to get wrong:
 *
 *   - STAND: the dealer draws X and makes 17-21, which beats a 12-16.
 *   - HIT: the player draws X and busts, so the dealer never draws (see
 *     game.ts's playDealerAndSettle -- with no live hand it takes no cards).
 *   - DOUBLE: exactly one card, the same X, the same bust.
 *
 * And every line LOSES, which is the drill's whole premise. Surrender is the one
 * exception at four cards; it is never the correct play against a 2-8 up-card,
 * so it is graded as the mistake it is, and the view realigns the shoe to the
 * next round boundary afterwards.
 *
 * The correct plays are deliberately mixed. Two of these six are STANDS that
 * lose to a dealer drawing out to 21 -- doing everything right and being
 * punished for it is the tilt trigger, and a family where the answer was always
 * "hit" would just be a different wall.
 */
export const DECISION_LOSSES: readonly Rank[][] = [
  ['10', '7', '6', '4', '10'], // P16 v 7  — HIT is correct;   D 11 -> 21
  ['10', '6', '5', '5', '10'], // P15 v 6  — STAND is correct; D 11 -> 21
  ['10', '2', '2', '5', '10'], // P12 v 2  — HIT is correct;   D 7  -> 17
  ['9', '8', '4', '3', '10'], //  P13 v 8  — HIT is correct;   D 11 -> 21
  ['10', '5', '3', '6', '10'], // P13 v 5  — STAND is correct; D 11 -> 21
  ['8', '7', '6', '4', '10'], //  P14 v 7  — HIT is correct;   D 11 -> 21
];

/** A built session: the cards, and where each round's script ends. */
export interface DownswingScript {
  cards: Card[];
  /**
   * Cumulative card count at the end of each scripted round, so the view can
   * realign the shoe when a player's line cost a different number of cards than
   * the script assumed (a surrender, or a hit on a hand the script had them
   * standing). Without this the whole remaining script shifts by a card and
   * every later round becomes noise instead of a designed loss.
   */
  boundaries: number[];
}

/**
 * Build a rigged session, seeded. `rounds` is how many hands the player will be
 * dealt; the script holds SLACK_ROUNDS more, because realigning past a
 * misplayed round consumes a scripted round without dealing it, and running out
 * of script mid-session would end the drill early.
 */
export const SLACK_ROUNDS = 8;

export function buildDownswingScript(rounds: number, seed?: number): DownswingScript {
  const rng = mulberry32(seed ?? Date.now());
  const cards: Card[] = [];
  const boundaries: number[] = [];
  for (let r = 0; r < rounds + SLACK_ROUNDS; r++) {
    // A deliberate two-phase ARC so every session visits BOTH count regimes:
    //   1st half — mostly PAT (high-card) losses -> the count grinds NEGATIVE,
    //     so the ramp calls for the minimum bet and you lose small, over and over.
    //   2nd half — mostly DRAW-OUT (low-card) losses -> the count climbs POSITIVE,
    //     so the ramp calls for a BIG bet that the dealer draws out to beat.
    // That "you did everything right, bet big at a good count, and lost anyway"
    // hand is the real tilt trigger. The 20% off-family mix + seeded pattern
    // choice keep it from feeling scripted.
    // V3-7: roughly a third of the session is a DECISION hand, spread evenly
    // across the arc rather than clustered, so the play is live throughout
    // instead of being a wall of Stand with a quiz bolted on one end.
    const drawOutProb = r < rounds / 2 ? 0.35 : 0.85;
    const pool =
      rng() < 0.35
        ? DECISION_LOSSES
        : rng() < drawOutProb
          ? DRAW_OUT_LOSSES
          : PAT_LOSSES;
    const ranks = pool[Math.floor(rng() * pool.length)]!;
    for (const rank of ranks) cards.push(card(rank));
    boundaries.push(cards.length);
  }
  // Buffer (uncounted-by-design tail) so nothing throws even if realignment is
  // somehow outrun -- the drill degrades to dull hands rather than throwing.
  for (let i = 0; i < 8; i++) cards.push(card('10'));
  return { cards, boundaries };
}

/**
 * The cards alone. Retained because the shoe is also built directly in tests
 * that do not care where the round boundaries fall.
 */
export function makeDownswingShoe(rounds: number, seed?: number): Card[] {
  return buildDownswingScript(rounds, seed).cards;
}
