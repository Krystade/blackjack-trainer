import type { Card, Rank, Suit } from '../engine/cards';
import { RANKS, rankValue } from '../engine/cards';

const TEN_FACES: readonly Rank[] = ['10', 'J', 'Q', 'K'];
const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];

/**
 * The distinct two-card HARD rank pairs that make `total`, by VALUE: the four
 * ten-value ranks are one rank here. Each pair is [low, high], low < high, no
 * aces (A+x is soft) and no equal values (those are pair cells).
 *
 * Hard 16 is [[6, 10], [7, 9]] -- two compositions, not the five that
 * `hardCompositions` lists by face.
 */
export function rankPairsForTotal(total: number): [number, number][] {
  const out: [number, number][] = [];
  for (let low = 2; low <= 10; low++) {
    const high = total - low;
    if (high > low && high <= 10) out.push([low, high]);
  }
  return out;
}

/**
 * #18 (spec 2026-10-13): THE one way a drill builds a hard two-card hand.
 *
 * Uniform over the distinct rank pairs for the total (`rankPairsForTotal`),
 * so hard 16 is 10+6 or 9+7, each half the time. The old draw was uniform
 * over FACES, which made 16 a 9+7 only one time in five, because 6+10, 6+J,
 * 6+Q and 6+K were four separate options.
 *
 * Everything after the rank pair is cosmetic and drawn from the same rng:
 * which ten-value face, each card's suit, and which card is dealt first.
 * None of it changes the total or the graded play (buildHand.test.ts pins
 * that the play of a two-card hard hand depends on the total only).
 *
 * Used by mastery, flashcards, the deviation quiz and Mixed. Pairs and soft
 * hands are built elsewhere and are unchanged. `null` when the total has no
 * hard two-card composition (4 and 20 exist only as pairs).
 */
export function pickComposition(total: number, rng: () => number): [Card, Card] | null {
  const pairs = rankPairsForTotal(total);
  if (pairs.length === 0) return null;
  const [low, high] = pairs[Math.floor(rng() * pairs.length)] ?? pairs[0]!;
  const card = (value: number): Card => ({
    rank: value === 10 ? (TEN_FACES[Math.floor(rng() * TEN_FACES.length)] ?? '10') : (String(value) as Rank),
    suit: SUITS[Math.floor(rng() * SUITS.length)] ?? 's',
  });
  const a = card(low);
  const b = card(high);
  return rng() < 0.5 ? [a, b] : [b, a];
}

/**
 * Every two-card HARD composition of `total`, in a stable order.
 *
 * V4-2 (docs/BACKLOG.md): the drills used to show ONE fixed pair per total,
 * forever -- hard 16 was 6+10 every single time it was ever drawn. That
 * teaches the wrong thing twice over. A learner can memorise the card PAIR
 * instead of the total, which does not transfer to the 9+7 they will actually
 * be dealt; and recognising "this is a hard 16" from an unfamiliar
 * composition is itself a skill the drill then never touches.
 *
 * Face cards are included rather than collapsed to '10'. A jack has to READ
 * as a ten at speed, and the ten-family being four of the thirteen ranks
 * means a uniform pick over these compositions already leans toward
 * ten-heavy hands the way a real shoe does.
 *
 * - Aces excluded: A+x is always soft two-card, so it cannot be a hard total.
 * - Equal VALUES excluded: those are pair cells (which also rules out 10+J).
 * - Constructible range 5..19; 4 and 20 exist only as pairs.
 * - Each unordered pair appears once (6+10, never also 10+6).
 */
export function hardCompositions(total: number): [Card, Card][] {
  const out: [Card, Card][] = [];
  for (let i = 0; i < RANKS.length; i++) {
    const r1 = RANKS[i]!;
    if (r1 === 'A') continue;
    for (let j = i + 1; j < RANKS.length; j++) {
      const r2 = RANKS[j]!;
      if (r2 === 'A') continue;
      const v1 = rankValue(r1);
      const v2 = rankValue(r2);
      if (v1 === v2) continue;
      if (v1 + v2 !== total) continue;
      out.push([
        { rank: r1, suit: 's' },
        { rank: r2, suit: 'h' },
      ]);
    }
  }
  return out;
}

/**
 * Build a concrete two-card HARD hand for a given total.
 *
 * Without `rng` this returns the FIRST composition, which is exactly what it
 * always returned -- the fixed representative `generateAllCells` stores for
 * a cell. Pass an rng to draw a composition instead: that is
 * `pickComposition` (#18), uniform over rank pairs, deterministic in the
 * caller's seed like everything else in drills/.
 *
 * The hand's basic-strategy action is a function of the TOTAL for two-card
 * hard hands -- no two-card hard play in either chart is
 * composition-dependent -- so varying the cards cannot change what the right
 * answer is. `flashcards.test.ts` pins that rather than assuming it.
 *
 * Shared by flashcards.ts and deviationQuiz.ts so both build hard hands
 * identically.
 */
export function makeHardHand(total: number, rng?: () => number): [Card, Card] | null {
  const options = hardCompositions(total);
  if (options.length === 0) return null;
  if (!rng) return options[0]!;
  return pickComposition(total, rng);
}
