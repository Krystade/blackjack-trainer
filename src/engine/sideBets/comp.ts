import { RANKS } from '../cards';
import type { Card, Rank, Suit } from '../cards';

/**
 * Wave L: a shoe's composition, card by card. A side bet is decided by WHICH
 * cards come (21+3 and Royal Match read suits, Lucky Ladies the queen of
 * hearts), so the composition is kept per card type -- 13 ranks x 4 suits --
 * not per value as the blackjack engine reads it.
 *
 * Type index = rank index (RANKS order: A, 2..10, J, Q, K) x 4 + suit index
 * (SUITS order: s, h, d, c, the order `Shoe` builds in).
 */

export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
export const TYPES = 52;

export const RANK_INDEX: Record<Rank, number> = Object.fromEntries(RANKS.map((r, i) => [r, i])) as Record<Rank, number>;
export const SUIT_INDEX: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };

/** A composition: how many of each of the 52 card types are left. */
export type Comp = Int16Array;

export const typeOf = (c: Card): number => RANK_INDEX[c.rank] * 4 + SUIT_INDEX[c.suit];
export const rankOfType = (t: number): number => (t / 4) | 0;
export const suitOfType = (t: number): number => t & 3;

/** A full shoe of `decks` decks. */
export function fullComp(decks: number): Comp {
  return new Int16Array(TYPES).fill(decks);
}

export function compTotal(c: Comp): number {
  let n = 0;
  for (let i = 0; i < TYPES; i++) n += c[i]!;
  return n;
}

/** Per rank (13, RANKS order). */
export function rankCounts(c: Comp): number[] {
  const out = new Array<number>(13).fill(0);
  for (let i = 0; i < TYPES; i++) out[i >> 2]! += c[i]!;
  return out;
}

/** Per suit (s, h, d, c). */
export function suitCounts(c: Comp): number[] {
  const out = [0, 0, 0, 0];
  for (let i = 0; i < TYPES; i++) out[i & 3]! += c[i]!;
  return out;
}

/** Blackjack value with the ace as 1: index 1..10 (index 0 unused). */
export function valueCounts(c: Comp): number[] {
  const out = new Array<number>(11).fill(0);
  for (let r = 0; r < 13; r++) {
    const v = r >= 9 ? 10 : r + 1;
    for (let s = 0; s < 4; s++) out[v]! += c[r * 4 + s]!;
  }
  return out;
}

/** Ten-valued rank indices: 10, J, Q, K. */
export const TEN_RANKS: readonly number[] = [9, 10, 11, 12];
export const QUEEN = 11;
export const KING = 12;
export const ACE = 0;
export const HEARTS = 1;
