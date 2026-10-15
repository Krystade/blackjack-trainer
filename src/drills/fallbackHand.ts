/**
 * #27 (spec 2026-10-13): double and surrender FALLBACKS.
 *
 * A chart cell that says Dh / Ds / Rh / Rs / Rp is really two answers: the
 * play when doubling or surrendering is allowed, and the play when it is not.
 * A two-card drill only ever asks the first. With "Fallbacks" on, about 15%
 * of the hands dealt on such cells are dealt so the first answer is illegal:
 *
 * - Dh / Ds / Rh / Rs: a THREE-card hand of the same total (hard 11 as
 *   2,4,5; soft 17 as A,3,3). After a hit there is no double and no
 *   surrender, so the right play is the fallback (Dh -> hit, Ds -> stand,
 *   Rh -> hit, Rs -> stand).
 * - Rp: the pair itself, with surrender off (a 3-card hand can never split,
 *   and Rp's fallback IS the split).
 *
 * The answer is never restated here: callers grade with `correctPlay` under
 * the returned ctx, so an index the engine applies at that count (16 v 10
 * stands at TC >= 0 when surrender is gone) is graded as the engine says.
 */

import type { Card, Rank, Suit } from '../engine/cards';
import { handValue, isPair } from '../engine/hand';
import { chartLookup } from '../engine/basicStrategy';
import type { PlayContext } from '../engine/strategy';
import type { RuleSet } from '../engine/ruleset';

/** About 15% of eligible hands, per the spec. */
export const FALLBACK_RATE = 0.15;

export const FULL_CTX: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };
/** A hand that has already taken a card: nothing but hit and stand. */
export const THREE_CARD_CTX: PlayContext = { canDouble: false, canSplit: false, canSurrender: false };
/** Rp dealt as the pair, surrender off. */
export const NO_SURRENDER_CTX: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };

const FALLBACK_CELLS = new Set(['Dh', 'Ds', 'Rh', 'Rs', 'Rp']);
const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
const TEN_FACES: readonly Rank[] = ['10', 'J', 'Q', 'K'];

export interface FallbackHand {
  cards: Card[];
  ctx: PlayContext;
}

/** The chart cell a (two-card) hand sits on, if it has a fallback. */
export function fallbackCellAction(cards: Card[], up: Rank, rules: RuleSet): 'Dh' | 'Ds' | 'Rh' | 'Rs' | 'Rp' | null {
  const a = chartLookup(cards, up, rules);
  return FALLBACK_CELLS.has(a) ? (a as 'Dh' | 'Ds' | 'Rh' | 'Rs' | 'Rp') : null;
}

function card(value: number, rng: () => number): Card {
  const rank: Rank =
    value === 1 ? 'A' : value === 10 ? (TEN_FACES[Math.floor(rng() * TEN_FACES.length)] ?? '10') : (String(value) as Rank);
  return { rank, suit: SUITS[Math.floor(rng() * SUITS.length)] ?? 's' };
}

/** Every way to write `sum` as two values from `values`, low <= high. */
function twoValueSplits(sum: number, values: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const a of values) for (const b of values) if (a <= b && a + b === sum) out.push([a, b]);
  return out;
}

const NON_ACE = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * A seeded three-card hand with the same total (and softness) as `cards`.
 * Hard: three non-ace cards. Soft: an ace plus two cards (ace allowed, so
 * soft 13 is A,A,A). `null` when no three-card version exists (hard 5).
 */
export function threeCardVersion(cards: Card[], rng: () => number): Card[] | null {
  const hv = handValue(cards);
  let values: number[];
  if (hv.soft) {
    const splits = twoValueSplits(hv.total - 11, [1, ...NON_ACE.slice(0, 8)]);
    if (splits.length === 0) return null;
    const [a, b] = splits[Math.floor(rng() * splits.length)]!;
    values = [1, a, b];
  } else {
    const triples: number[][] = [];
    for (const a of NON_ACE)
      for (const b of NON_ACE)
        for (const c of NON_ACE) if (a <= b && b <= c && a + b + c === hv.total) triples.push([a, b, c]);
    if (triples.length === 0) return null;
    values = [...triples[Math.floor(rng() * triples.length)]!];
  }
  const out = values.map((v) => card(v, rng));
  // Shuffle the deal order (Fisher-Yates) so the ace is not always first.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The fallback version of a hand, unconditionally: `null` when the cell has
 * no fallback (or no three-card version). Pure and seeded.
 */
export function buildFallback(cards: Card[], up: Rank, rules: RuleSet, rng: () => number): FallbackHand | null {
  const cell = fallbackCellAction(cards, up, rules);
  if (!cell) return null;
  if (cell === 'Rp') return { cards, ctx: NO_SURRENDER_CTX };
  const three = threeCardVersion(cards, rng);
  // A pair cell's action is about THOSE two cards: 7,7 v 10 single deck is
  // Rs (stand, because two sevens are gone) while hard 14 v 10 is plain H.
  // A three-card 14 would be a different cell, so a pair whose total row
  // disagrees keeps its cards and loses only the surrender.
  if (three && (!isPair(cards) || chartLookup(three, up, rules) === cell)) return { cards: three, ctx: THREE_CARD_CTX };
  if (isPair(cards) && (cell === 'Rh' || cell === 'Rs')) return { cards, ctx: NO_SURRENDER_CTX };
  return null;
}

/**
 * The drill draw: with `on`, an eligible hand becomes its fallback version
 * FALLBACK_RATE of the time. Off, or not eligible, it draws nothing from the
 * rng, so the draw sequence of a drill with the option off is unchanged.
 */
export function maybeFallback(
  cards: Card[],
  up: Rank,
  rules: RuleSet,
  rng: () => number,
  on: boolean,
): FallbackHand | null {
  if (!on || !fallbackCellAction(cards, up, rules)) return null;
  if (rng() >= FALLBACK_RATE) return null;
  return buildFallback(cards, up, rules, rng);
}
