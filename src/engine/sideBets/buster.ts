import { compTotal, valueCounts } from './comp';
import type { Comp } from './comp';
import type { OutcomeProbs } from './odds';

/**
 * Wave L: Buster Blackjack -- the dealer busts, paid by how many cards it took.
 *
 * EXACT FOR THE DEALER'S DRAW, FROM THE SHOE AS IT STANDS. The dealer's cards
 * are, unconditionally, random draws from what is left in the shoe (the
 * player's two cards are themselves random draws, and draws are
 * exchangeable), so the dealer's hand is played out recursively over the
 * finite composition, card by card, to every bust or stand -- with the shoe
 * shrinking at each draw. Memoised on the multiset drawn so far, which fixes
 * both the total and the cards left.
 *
 * THE ONE APPROXIMATION: the player's HIT cards come out between the hole card
 * and the dealer's draws, and how many the player takes depends on the
 * dealer's up card. That couples the two slightly; it is ignored, as the
 * Wizard of Odds' own dealer-probability analysis does (payTables.test.ts
 * compares the house edge with its published figures, and odds.test.ts
 * with a brute-force deal of a short shoe's dealer draws).
 *
 * The player-blackjack lines (pay table Version 2) need the player's cards:
 * P(player blackjack) times the dealer's distribution from the shoe less one
 * ace and one ten. The dealer plays out against a blackjack there, as the
 * source assumes.
 */

const MAX_CARDS = 16;
/** Base-16 digit per value drawn (ace = 1 .. ten = 10): the multiset's key. */
const POW = Array.from({ length: 11 }, (_, v) => (v === 0 ? 0 : 16 ** (v - 1)));

/**
 * P(the dealer busts with exactly k cards), k = 3..; index 0 holds P(no bust).
 * `vc` is per value (index 1 = aces .. 10 = ten-valued), and is restored.
 */
export function dealerBustDist(vc: number[], s17: boolean): Float64Array {
  let left = 0;
  for (let v = 1; v <= 10; v++) left += vc[v]!;
  const memo = new Map<number, Float64Array>();
  const rec = (hard: number, aces: number, n: number, key: number, remaining: number): Float64Array => {
    if (n >= 2) {
      if (hard > 21) {
        const out = new Float64Array(MAX_CARDS);
        out[Math.min(n, MAX_CARDS - 1)] = 1;
        return out;
      }
      const soft = aces > 0 && hard + 10 <= 21;
      const total = soft ? hard + 10 : hard;
      if (total > 17 || (total === 17 && (s17 || !soft))) {
        const out = new Float64Array(MAX_CARDS);
        out[0] = 1;
        return out;
      }
    }
    const hit = memo.get(key);
    if (hit) return hit;
    const out = new Float64Array(MAX_CARDS);
    if (remaining > 0) {
      for (let v = 1; v <= 10; v++) {
        const k = vc[v]!;
        if (k === 0) continue;
        const p = k / remaining;
        vc[v] = k - 1;
        const sub = rec(hard + v, aces + (v === 1 ? 1 : 0), n + 1, key + POW[v]!, remaining - 1);
        vc[v] = k;
        for (let i = 0; i < MAX_CARDS; i++) out[i]! += p * sub[i]!;
      }
    } else {
      out[0] = 1; // an empty shoe: never reached in play
    }
    memo.set(key, out);
    return out;
  };
  return rec(0, 0, 0, 0, left);
}

export function busterOdds(c: Comp, s17: boolean): OutcomeProbs {
  const vc = valueCounts(c);
  const N = compTotal(c);
  const all = dealerBustDist(vc, s17);
  // The player's blackjack: an ace and a ten among the first two cards.
  const pBj = N >= 2 ? (2 * vc[1]! * vc[10]!) / (N * (N - 1)) : 0;
  let bj: Float64Array = new Float64Array(MAX_CARDS);
  if (pBj > 0) {
    vc[1]! -= 1;
    vc[10]! -= 1;
    bj = dealerBustDist(vc, s17);
    vc[1]! += 1;
    vc[10]! += 1;
  }
  const atLeast = (d: Float64Array, k: number) => {
    let s = 0;
    for (let i = k; i < MAX_CARDS; i++) s += d[i]!;
    return s;
  };
  const b7Bj = pBj * bj[7]!;
  const b8Bj = pBj * atLeast(bj, 8);
  return {
    b3: all[3]!,
    b4: all[4]!,
    b5: all[5]!,
    b6: all[6]!,
    b7Bj,
    b7: all[7]! - b7Bj,
    b8Bj,
    b8: atLeast(all, 8) - b8Bj,
  };
}
