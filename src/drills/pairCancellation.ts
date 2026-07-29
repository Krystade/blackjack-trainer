import type { Card } from '../engine/cards';
import { Shoe } from '../engine/cards';
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
 */
export function makePairCancel(seed?: number): PairCancelRound {
  const shoe = new Shoe({ decks: 1, seed });
  const a = shoe.draw();
  const b = shoe.draw();
  return { cards: [a, b], net: hiLoTag(a.rank) + hiLoTag(b.rank) };
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
