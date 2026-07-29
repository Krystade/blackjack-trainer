import type { Card } from '../engine/cards';
import { Shoe, mulberry32 } from '../engine/cards';
import { hiLoTag } from '../engine/count';

/**
 * R8 / TS#6 (docs/BACKLOG.md, docs/research/2026-07-23-training-science.md):
 * the pair-cancellation drill. Expert counters read cards two at a time and
 * "cancel" a pair whose Hi-Lo tags sum to zero (e.g. a 3 and a jack net to 0
 * and are skipped as a unit) rather than adding each card serially — the
 * chunking stage after single-card speed, VERIFIED against qfit's "cancellation
 * principle". This drill shows two cards at once and asks for their NET tag,
 * training the pair as one recognized chunk.
 *
 * `net` is `hiLoTag(a) + hiLoTag(b)`, always in [-2, 2]. A net of 0 with two
 * non-zero-tag cards is the canonical "cancelling pair"; the drill grades the
 * net value directly (a 5-way answer: -2/-1/0/+1/+2) rather than a yes/no, so
 * it also trains the +2 / -2 "reinforcing pair" and the single-counter pair.
 */
export interface PairCancelRound {
  cards: [Card, Card];
  net: number;
}

/** The five possible net tag values, in ascending order — the drill's answer set. */
export const PAIR_CANCEL_NETS = [-2, -1, 0, 1, 2] as const;

/**
 * Draw a fresh two-card pair from a seeded single deck and compute its net
 * Hi-Lo tag. Pure/deterministic given the seed (a fresh Shoe per call), so it
 * is immune to React StrictMode double-invocation and trivially reproducible
 * in tests/e2e.
 *
 * `cancellingBias` (0–1, default 0) is the content-weighting follow-on from
 * TS#6: with that probability the pair is forced to be a GENUINE cancelling
 * pair (one +1 low card and one −1 high card, net 0). A purely random draw
 * under-represents the canonical chunk — most net-0 pairs are two zero-tag
 * cards (7,8) that don't actually cancel — so oversampling real cancels early
 * trains the recognition the drill is FOR. Default 0 keeps the unbiased draw
 * (and every existing caller/test) unchanged.
 */
export function makePairCancel(seed?: number, cancellingBias = 0): PairCancelRound {
  const shoe = new Shoe({ decks: 1, seed });

  // Independent coin stream (decorrelated from the shoe) decides whether to
  // force a cancel, so the bias never perturbs the unbiased draw's sequence.
  const forceCancel =
    cancellingBias > 0 && seed !== undefined && mulberry32((seed ^ 0x5f356495) >>> 0)() < cancellingBias;

  if (!forceCancel) {
    const a = shoe.draw();
    const b = shoe.draw();
    return { cards: [a, b], net: hiLoTag(a.rank) + hiLoTag(b.rank) };
  }

  // Force a genuine cancel: draw the whole deck (deterministic order) and take
  // the first +1 (low) and first −1 (high) card. A 52-card deck always has
  // both, so this never fails; the pair is presented in draw order.
  const all: Card[] = [];
  while (all.length < 52) all.push(shoe.draw());
  const low = all.find((c) => hiLoTag(c.rank) === 1)!;
  const high = all.find((c) => hiLoTag(c.rank) === -1)!;
  const cards: [Card, Card] = all.indexOf(low) < all.indexOf(high) ? [low, high] : [high, low];
  return { cards, net: 0 };
}

/**
 * Session content-weighting schedule (TS#6): the cancelling-pair bias for the
 * Nth round of a pair-cancellation session. Starts high so the learner sees
 * the canonical chunk often, then decays toward the natural (unbiased) draw as
 * they progress — the chunk-frequency logic chess/template theory describes.
 * Pure and clamped to [0, 1].
 */
export function pairCancelBias(roundIndex: number): number {
  const START = 0.6;
  const DECAY_PER_ROUND = 0.05;
  return Math.max(0, START - Math.max(0, roundIndex) * DECAY_PER_ROUND);
}

/** True when the pair cancels: both cards carry a non-zero tag and they sum to
 * zero (one +1 low card and one −1 high card). A net of 0 from two zero-tag
 * cards (e.g. 7 and 8) is NOT a cancelling pair in the chunking sense — nothing
 * was cancelled — so this is stricter than `net === 0`. Exposed for labelling/
 * feedback; the drill itself grades the net value, not this predicate. */
export function isCancellingPair(round: PairCancelRound): boolean {
  const [a, b] = round.cards;
  return round.net === 0 && hiLoTag(a.rank) !== 0 && hiLoTag(b.rank) !== 0;
}
