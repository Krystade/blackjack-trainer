/**
 * HOW OFTEN EACH CHART CELL ACTUALLY HAPPENS (V4-1, docs/BACKLOG.md).
 *
 * The flashcard draw weighted the 330 cells by spaced-repetition due-ness and
 * nothing else, so once two cells' schedules lined up they got the same share
 * of reps -- the 16 v 10 faced most shoes and the hard 5 v 7 faced once a
 * month, drilled equally. Practice time is the scarce thing; it should go
 * where the hands are.
 *
 * The model is the standard infinite-deck approximation: every rank is 1/13,
 * and the ten-family (10/J/Q/K) is 4/13 of the shoe. That is deliberately not
 * shoe-aware. A depth- and count-conditioned frequency would be more precise
 * and would also mean the draw shifted under the learner for reasons they
 * could not see; the point here is only to tell a common hand from a rare one,
 * and for that the approximation and the truth disagree by less than the
 * rounding in any one session's rep count.
 *
 * This is a SEPARATE axis from scheduling, and composes with it rather than
 * replacing it: how often you meet a hand and how well you know it are
 * different questions, and the answer to the second still comes from
 * spacedRepetition.ts.
 */

/** Probability of drawing one card of the given blackjack VALUE (1 = ace). */
function valueProb(value: number): number {
  return value === 10 ? 4 / 13 : 1 / 13;
}

/** Card values a hand can be built from: ace, then 2..10 (10 covers J/Q/K). */
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Probability that the player's two cards make this cell's hand.
 *
 * Unordered but position-aware: a hand of two DIFFERENT values arrives two
 * ways round, which is why those carry the factor of 2 and a pair does not.
 * Returns 0 for an id this does not recognise rather than guessing, so a new
 * cell shape shows up as "never drawn" in a test instead of silently getting
 * an invented weight.
 */
export function handProb(cellId: string): number {
  const [kind, key] = cellId.split('-');
  if (kind === 'hard') {
    const total = Number(key);
    let p = 0;
    for (const v1 of VALUES) {
      for (const v2 of VALUES) {
        // Ace-free and value-distinct: an ace makes it soft, equal values
        // make it a pair cell. Same definition buildHand.ts uses.
        if (v1 === 1 || v2 === 1 || v1 >= v2) continue;
        if (v1 + v2 !== total) continue;
        p += 2 * valueProb(v1) * valueProb(v2);
      }
    }
    return p;
  }
  if (kind === 'soft') {
    const other = Number(key) - 11;
    if (other < 2 || other > 9) return 0;
    return 2 * valueProb(1) * valueProb(other);
  }
  if (kind === 'pair') {
    const v = key === 'A' ? 1 : Number(key);
    if (!VALUES.includes(v)) return 0;
    return valueProb(v) * valueProb(v);
  }
  return 0;
}

/** Probability the dealer's upcard is this cell's upcard. */
export function upProb(cellId: string): number {
  const up = cellId.split('-v-')[1];
  if (up === undefined) return 0;
  return valueProb(up === 'A' ? 1 : Number(up));
}

/**
 * How often this cell comes up at a table, as a probability.
 *
 * The player's hand and the dealer's upcard are treated as independent, which
 * with an infinite deck they are.
 */
export function cellFrequency(cellId: string): number {
  return handProb(cellId) * upProb(cellId);
}

/**
 * The frequency term the draw multiplies an SR weight by.
 *
 * The raw probability spans nearly two orders of magnitude across the chart,
 * and using it directly would bury the rare cells so deep they effectively
 * left the deck -- a cell you meet once a month is still one you have to know,
 * and the whole point of a complete chart is that it is complete. The square
 * root compresses that: the commonest cell ends up drawn a few times as often
 * as the rarest rather than a hundred times, which reallocates reps without
 * abandoning anything.
 *
 * Never returns 0 for a real cell, so nothing can be permanently unreachable.
 */
export function frequencyWeight(cellId: string): number {
  const f = cellFrequency(cellId);
  return f <= 0 ? 0 : Math.sqrt(f);
}
