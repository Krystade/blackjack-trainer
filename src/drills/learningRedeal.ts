/**
 * E2 (W2-2): the learning step's RE-DEAL, for Flashcards, the Deviation quiz,
 * Mixed and a Review session (not Mastery, which reshuffles its own way).
 *
 * A miss drops an item to box 0, due now -- and then it had to win a weighted
 * draw against every other cell in the deck to be seen again. A missed cell
 * weighs 6 against an unseen one's 8 across some 330 cells, so it almost never
 * came back in the same session, and the correction was never tested while it
 * was fresh. Now a miss books the item a slot a few cards on, and that slot
 * beats the weighted draw.
 *
 * The gap is 3 to 6 OTHER cards, at random, so the learner cannot count to
 * it. A pool too small for that (under `SMALL_POOL` items) brings the item
 * back after every other item has had one turn: pool - 1 cards.
 *
 * Until its slot comes up, a waiting item sits out the weighted draw, so it
 * cannot turn up early either -- the same cell two cards after its miss is
 * the correction still on screen, not a recall.
 *
 * PURE: the queue is a value; the views keep it in a ref for the session.
 * Keys are whatever the drill schedules by -- a cell id, an index id, or in
 * Mixed either one with its deck in front ("flash:..." / "quiz:...").
 */

export const REDEAL_MIN = 3;
export const REDEAL_MAX = 6;
/** Below this many items there is no room for a 3-card gap. */
export const SMALL_POOL = 4;

export interface RedealSlot {
  key: string;
  /** Cards still to be dealt before this one is; 0 or less = due now. */
  dueIn: number;
}

export type RedealQueue = readonly RedealSlot[];

export const NO_REDEALS: RedealQueue = [];

/**
 * How many other cards come between a miss and its re-deal: pool - 1 under
 * `SMALL_POOL`, otherwise 3 to 6 at random -- avoiding a gap that would land
 * on a slot already booked (`booked`, the other slots' `dueIn`), so two misses
 * never collide while there is a free gap left.
 */
export function redealGap(poolSize: number, rng: () => number, booked: ReadonlySet<number> = new Set()): number {
  if (poolSize < SMALL_POOL) return Math.max(0, poolSize - 1);
  const gaps: number[] = [];
  for (let g = REDEAL_MIN; g <= REDEAL_MAX; g++) gaps.push(g);
  const free = gaps.filter((g) => !booked.has(g));
  const choices = free.length > 0 ? free : gaps;
  return choices[Math.floor(rng() * choices.length)]!;
}

/**
 * The queue after an answer to `key`. A miss books (or re-books) its slot; a
 * right answer leaves the queue alone -- the item's own slot, if it had one,
 * was spent when it was dealt.
 */
export function afterRedealAnswer(
  queue: RedealQueue,
  key: string,
  correct: boolean,
  poolSize: number,
  rng: () => number,
): RedealQueue {
  if (correct) return queue;
  const rest = queue.filter((s) => s.key !== key);
  const booked = new Set(rest.map((s) => s.dueIn));
  return [...rest, { key, dueIn: redealGap(poolSize, rng, booked) }];
}

/** What the next draw must do: deal one item, or draw without some. */
export type RedealPlan = { redeal: string } | { exclude: ReadonlySet<string> };

/**
 * The plan for the next draw from `poolIds` (the items that draw may deal).
 *
 * A due slot wins, the longest-overdue first. Otherwise the waiting items are
 * left out of the weighted draw -- unless they are all that is left, when the
 * soonest of them comes now rather than the draw having nothing to deal.
 * Slots for items outside the pool (a scope change) are ignored, not dealt.
 */
export function planRedealDraw(queue: RedealQueue, poolIds: readonly string[]): RedealPlan {
  const inPool = new Set(poolIds);
  const live = queue.filter((s) => inPool.has(s.key));
  const soonest = [...live].sort((a, b) => a.dueIn - b.dueIn)[0];
  if (soonest && soonest.dueIn <= 0) return { redeal: soonest.key };
  const exclude = new Set(live.map((s) => s.key));
  if (soonest && exclude.size >= inPool.size) return { redeal: soonest.key };
  return { exclude };
}

/** The queue after `dealtKey` is dealt: its slot is spent, every other one is a card nearer. */
export function afterRedealDeal(queue: RedealQueue, dealtKey: string): RedealQueue {
  return queue.filter((s) => s.key !== dealtKey).map((s) => ({ key: s.key, dueIn: s.dueIn - 1 }));
}

/** The keys of one deck, from a Mixed key ("flash:hard-16-v-10" -> "hard-16-v-10"). */
export function keysOfDeck(keys: Iterable<string>, deck: 'flash' | 'quiz'): Set<string> {
  const prefix = `${deck}:`;
  const out = new Set<string>();
  for (const k of keys) if (k.startsWith(prefix)) out.add(k.slice(prefix.length));
  return out;
}

/** A plan as `drawFlashcard`'s options (FlashOptions.redeal / exclude). */
export function redealOptions(plan: RedealPlan): { redeal?: string; exclude?: ReadonlySet<string> } {
  return 'redeal' in plan ? { redeal: plan.redeal } : { exclude: plan.exclude };
}
