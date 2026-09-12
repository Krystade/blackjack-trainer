import type { Card } from '../engine/cards';
import { RANKS, rankValue } from '../engine/cards';

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
 * always returned -- so every existing caller and test is unaffected. Pass an
 * rng to vary the composition instead (see `hardCompositions` for why that
 * matters); the choice is uniform over the compositions and deterministic in
 * the caller's seed, like everything else in drills/.
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
  return options[Math.floor(rng() * options.length)] ?? options[0]!;
}
