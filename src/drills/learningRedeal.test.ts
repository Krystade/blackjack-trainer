import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import { DEFAULT_RULES } from '../engine/ruleset';
import { drawFlashcard, generateAllCells } from './flashcards';
import { askedIndexSet, drawQuizItem } from './deviationQuiz';
import { reviewCard, type SrDeck } from './spacedRepetition';
import { afterAnswer, reviewPool } from '../ui/screens/drills/reviewSession';
import {
  NO_REDEALS,
  REDEAL_MAX,
  REDEAL_MIN,
  afterRedealAnswer,
  afterRedealDeal,
  keysOfDeck,
  planRedealDraw,
  redealGap,
  redealOptions,
  type RedealQueue,
} from './learningRedeal';

/**
 * E2 (W2-2): a missed item is dealt again after 3-6 other cards (pool - 1 in
 * a pool under four), and sits out the weighted draw until then.
 */

const ALL = generateAllCells().map((c) => c.id);
const DAY = 86_400_000;

/**
 * One Flashcards session, driven exactly as FlashcardsView drives it: plan
 * the draw from the deck, deal, then grade and book. `wrongAt` lists the
 * draws answered wrong; every other draw is answered right.
 */
function runFlashSession(seed: number, draws: number, wrongAt: ReadonlySet<number>, deckIds: readonly string[] = ALL): string[] {
  const rng = mulberry32(seed);
  const weights = deckIds === ALL ? null : new Map(deckIds.map((id) => [id, 1]));
  let deck: SrDeck = {};
  let queue: RedealQueue = NO_REDEALS;
  let previous: string | null = null;
  let now = 1_700_000_000_000;
  const dealt: string[] = [];
  for (let i = 0; i < draws; i++) {
    const plan = planRedealDraw(queue, deckIds);
    const card = drawFlashcard('all', deck, now, seed * 7919 + i, DEFAULT_RULES, false, previous, weights, redealOptions(plan));
    queue = afterRedealDeal(queue, card.cellId);
    dealt.push(card.cellId);
    const correct = !wrongAt.has(i);
    deck = { ...deck, [card.cellId]: reviewCard(deck[card.cellId], correct, now, { repeat: previous === card.cellId, learning: true }) };
    queue = afterRedealAnswer(queue, card.cellId, correct, deckIds.length, rng);
    previous = card.cellId;
    now += 4000;
  }
  return dealt;
}

describe('E2: a missed cell comes back 3-6 cards later (330-cell Flashcards deck)', () => {
  it('after a miss at draw k the cell is next dealt at k+4..k+7, in 500 of 500 seeds', () => {
    const returns = new Map<number, number>();
    for (let seed = 1; seed <= 500; seed++) {
      const k = 3 + (seed % 17);
      const dealt = runFlashSession(seed, k + 12, new Set([k]));
      const missed = dealt[k]!;
      const back = dealt.indexOf(missed, k + 1);
      expect(back, `seed ${seed}: ${missed} missed at ${k}, next at ${back}`).toBeGreaterThanOrEqual(k + 1 + REDEAL_MIN);
      expect(back, `seed ${seed}: ${missed} missed at ${k}, next at ${back}`).toBeLessThanOrEqual(k + 1 + REDEAL_MAX);
      returns.set(back - k, (returns.get(back - k) ?? 0) + 1);
    }
    // At random, not fixed: every offset 4..7 turns up.
    expect([...returns.keys()].sort()).toEqual([4, 5, 6, 7]);
  });

  it('two misses close together both come back inside their window', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const dealt = runFlashSession(seed, 24, new Set([5, 6]));
      for (const k of [5, 6]) {
        const back = dealt.indexOf(dealt[k]!, k + 1);
        expect(back - k, `seed ${seed} k ${k}`).toBeGreaterThanOrEqual(4);
        expect(back - k, `seed ${seed} k ${k}`).toBeLessThanOrEqual(7);
      }
    }
  });

  it('a cell missed again on its re-deal is booked again', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const first = runFlashSession(seed, 20, new Set([2]));
      const back = first.indexOf(first[2]!, 3);
      const dealt = runFlashSession(seed, back + 10, new Set([2, back]));
      const again = dealt.indexOf(dealt[2]!, back + 1);
      expect(again - back, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(again - back, `seed ${seed}`).toBeLessThanOrEqual(7);
    }
  });

  it('a small deck brings the miss back after every other cell has had one turn (pool - 1)', () => {
    for (const size of [1, 2, 3]) {
      const ids = ALL.slice(100, 100 + size);
      for (let seed = 1; seed <= 100; seed++) {
        const dealt = runFlashSession(seed, 8, new Set([1]), ids);
        expect(dealt.indexOf(dealt[1]!, 2) - 1, `size ${size} seed ${seed}: ${dealt.join(' ')}`).toBe(size);
      }
    }
    // Four or more: the 3-6 gap is back.
    const ids = ALL.slice(100, 104);
    for (let seed = 1; seed <= 100; seed++) {
      const dealt = runFlashSession(seed, 14, new Set([1]), ids);
      const gap = dealt.indexOf(dealt[1]!, 2) - 1;
      expect(gap).toBeGreaterThanOrEqual(4);
      expect(gap).toBeLessThanOrEqual(7);
    }
  });
});

describe('E2: a Review session re-deals a missed due cell the same way', () => {
  /** FlashcardsView's review mode: the pool is the cells left, minus the one just answered. */
  function runReview(seed: number, due: readonly string[], wrongAt: ReadonlySet<number>) {
    const rng = mulberry32(seed);
    let remaining = [...due];
    let queue: RedealQueue = NO_REDEALS;
    let previous: string | null = null;
    const dealt: string[] = [];
    for (let i = 0; i < 200 && remaining.length > 0; i++) {
      const pool = reviewPool(remaining, previous);
      const plan = planRedealDraw(queue, pool);
      const weights = new Map(pool.map((id) => [id, 1]));
      const card = drawFlashcard('all', {}, 0, seed * 31 + i, DEFAULT_RULES, false, previous, weights, redealOptions(plan));
      queue = afterRedealDeal(queue, card.cellId);
      dealt.push(card.cellId);
      const correct = !wrongAt.has(i);
      remaining = afterAnswer(remaining, card.cellId, correct);
      queue = afterRedealAnswer(queue, card.cellId, correct, reviewPool(remaining, null).length, rng);
      previous = card.cellId;
    }
    return { dealt, remaining };
  }

  it('the miss comes back 3-6 cards on, and the review ends only when every cell was answered right', () => {
    const due = ALL.slice(40, 61);
    for (let seed = 1; seed <= 200; seed++) {
      const { dealt, remaining } = runReview(seed, due, new Set([0]));
      expect(remaining).toEqual([]);
      const back = dealt.indexOf(dealt[0]!, 1);
      expect(back, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(back, `seed ${seed}`).toBeLessThanOrEqual(7);
      // 21 right answers and the one miss: nothing dealt twice but the missed cell.
      expect(dealt).toHaveLength(22);
      expect(new Set(dealt).size).toBe(21);
    }
  });

  it('a miss near the end of a review comes back after what is left (pool - 1)', () => {
    const due = ALL.slice(40, 45); // five cells
    for (let seed = 1; seed <= 100; seed++) {
      // Wrong on the 3rd: three cells are left (it, and two more), so it is back after 2.
      const { dealt, remaining } = runReview(seed, due, new Set([2]));
      expect(remaining).toEqual([]);
      expect(dealt.indexOf(dealt[2]!, 3) - 2, `seed ${seed}: ${dealt.join(' ')}`).toBe(3);
    }
  });
});

describe('E2: the plan', () => {
  it('a due slot wins; a waiting one sits out; one outside the pool is ignored', () => {
    const queue: RedealQueue = [
      { key: 'a', dueIn: 2 },
      { key: 'b', dueIn: 0 },
      { key: 'gone', dueIn: -3 },
    ];
    expect(planRedealDraw(queue, ['a', 'b', 'c'])).toEqual({ redeal: 'b' });
    const waiting = planRedealDraw([{ key: 'a', dueIn: 2 }], ['a', 'b', 'c']);
    expect('exclude' in waiting && [...waiting.exclude]).toEqual(['a']);
    expect(planRedealDraw([{ key: 'gone', dueIn: -3 }], ['a', 'b'])).toEqual({ exclude: new Set() });
  });

  it('the longest-overdue slot goes first', () => {
    expect(planRedealDraw([{ key: 'x', dueIn: 0 }, { key: 'y', dueIn: -1 }], ['x', 'y', 'z'])).toEqual({ redeal: 'y' });
  });

  it('when only waiting items are left, the soonest is dealt rather than nothing', () => {
    expect(planRedealDraw([{ key: 'a', dueIn: 3 }, { key: 'b', dueIn: 1 }], ['a', 'b'])).toEqual({ redeal: 'b' });
  });

  it('dealing spends the slot and moves the rest a card nearer', () => {
    const q = afterRedealDeal([{ key: 'a', dueIn: 2 }, { key: 'b', dueIn: 0 }], 'b');
    expect(q).toEqual([{ key: 'a', dueIn: 1 }]);
  });

  it('a right answer books nothing; a miss books 3-6, avoiding a gap already taken', () => {
    const rng = mulberry32(4);
    expect(afterRedealAnswer(NO_REDEALS, 'a', true, 330, rng)).toEqual([]);
    for (let i = 0; i < 200; i++) {
      const booked = new Set([3, 4, 5]);
      expect(redealGap(330, rng, booked)).toBe(6);
      const g = redealGap(330, rng);
      expect(g).toBeGreaterThanOrEqual(REDEAL_MIN);
      expect(g).toBeLessThanOrEqual(REDEAL_MAX);
    }
    expect(redealGap(3, rng)).toBe(2);
    expect(redealGap(1, rng)).toBe(0);
  });

  it('Mixed keys split by deck', () => {
    expect([...keysOfDeck(['flash:hard-16-v-10', 'quiz:16v10', 'flash:pair-8-v-A'], 'flash')]).toEqual(['hard-16-v-10', 'pair-8-v-A']);
    expect([...keysOfDeck(['flash:hard-16-v-10', 'quiz:16v10'], 'quiz')]).toEqual(['16v10']);
  });
});

describe('E2: the draws honour the plan, and are unchanged without one', () => {
  it('drawFlashcard deals a due re-deal, and never a waiting cell', () => {
    for (let seed = 1; seed <= 200; seed++) {
      expect(drawFlashcard('all', {}, 0, seed, DEFAULT_RULES, false, null, null, { redeal: 'pair-8-v-A' }).cellId).toBe('pair-8-v-A');
      const exclude = new Set(ALL.slice(0, 320));
      expect(exclude.has(drawFlashcard('all', {}, 0, seed, DEFAULT_RULES, false, null, null, { exclude }).cellId)).toBe(false);
    }
  });

  it('drawFlashcard with an empty plan is seed-identical to today', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const before = drawFlashcard('all', {}, 0, seed, DEFAULT_RULES);
      expect(drawFlashcard('all', {}, 0, seed, DEFAULT_RULES, false, null, null, { exclude: new Set() })).toEqual(before);
    }
  });

  it('drawQuizItem never asks a waiting index, and is seed-identical with none waiting', () => {
    const ids = askedIndexSet(DEFAULT_RULES).map((d) => d.id);
    const exclude = new Set(ids.slice(0, ids.length - 2));
    for (let seed = 1; seed <= 300; seed++) {
      const item = drawQuizItem(seed, undefined, DEFAULT_RULES, 0, {}, 0, exclude);
      expect(exclude.has(item.deviationId!), `seed ${seed}: ${item.deviationId}`).toBe(false);
      expect(drawQuizItem(seed, undefined, DEFAULT_RULES, 25, {}, 0, new Set())).toEqual(drawQuizItem(seed, undefined, DEFAULT_RULES, 25, {}, 0));
    }
  });
});

describe('E2: the learning step in the schedule', () => {
  it('a re-dealt cell answered right twice, cards apart, leaves box 0 only on the second', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = mulberry32(seed);
      let deck: SrDeck = {};
      let queue: RedealQueue = NO_REDEALS;
      let previous: string | null = null;
      let now = 1_700_000_000_000;
      let missed: string | null = null;
      const boxes: number[] = [];
      for (let i = 0; i < 30; i++) {
        const plan = planRedealDraw(queue, ALL);
        const card = drawFlashcard('all', deck, now, seed * 101 + i, DEFAULT_RULES, false, previous, null, redealOptions(plan));
        queue = afterRedealDeal(queue, card.cellId);
        const correct = i !== 0;
        if (i === 0) missed = card.cellId;
        deck = { ...deck, [card.cellId]: reviewCard(deck[card.cellId], correct, now, { repeat: previous === card.cellId, learning: true }) };
        queue = afterRedealAnswer(queue, card.cellId, correct, ALL.length, rng);
        if (card.cellId === missed) boxes.push(deck[missed]!.box);
        previous = card.cellId;
        now += DAY / 1000;
      }
      // The miss, then its re-deal: box 0 both times, the re-deal still due now.
      expect(boxes.slice(0, 2), `seed ${seed}`).toEqual([0, 0]);
      expect(deck[missed!]!.learningStep === 1 || deck[missed!]!.box === 1).toBe(true);
    }
  });
});
