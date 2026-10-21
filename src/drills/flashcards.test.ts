import { mulberry32 } from '../engine/cards';
import { DEFAULT_RULES } from '../engine/ruleset';
import { describe, it, expect } from 'vitest';
import { generateAllCells, filterCellsByCategory, drawFlashcard } from './flashcards';
import { confusabilityWeight } from './confusability';
import { handValue } from '../engine/hand';
import { correctPlay } from '../engine/strategy';

describe('generateAllCells (the "complete table" cell universe)', () => {
  const all = generateAllCells();

  it('has exactly 330 cells: 150 hard + 80 soft + 100 pairs', () => {
    expect(all).toHaveLength(330);
    expect(all.filter((c) => c.id.startsWith('hard-'))).toHaveLength(150);
    expect(all.filter((c) => c.id.startsWith('soft-'))).toHaveLength(80);
    expect(all.filter((c) => c.id.startsWith('pair-'))).toHaveLength(100);
  });

  it('has no duplicate cell ids', () => {
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it('every cell has exactly two cards and a valid upcard', () => {
    const upcards = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
    for (const c of all) {
      expect(c.cards).toHaveLength(2);
      expect(upcards).toContain(c.up);
    }
  });
});

describe('filterCellsByCategory', () => {
  const all = generateAllCells();

  it('all/hard/soft/pairs partition the universe with no overlap and no gaps', () => {
    const hard = filterCellsByCategory(all, 'hard');
    const soft = filterCellsByCategory(all, 'soft');
    const pairs = filterCellsByCategory(all, 'pairs');
    expect(hard).toHaveLength(150);
    expect(soft).toHaveLength(80);
    expect(pairs).toHaveLength(100);
    expect(hard.length + soft.length + pairs.length).toBe(all.length);
    expect(filterCellsByCategory(all, 'all')).toEqual(all);
  });
});

describe('V4-2: the cards vary, the cell does not', () => {
  it('the same hard cell is dealt in different compositions across draws', () => {
    // Force one cell by giving every other cell zero weight: an SR deck where
    // only 'hard-16-v-10' is due cannot be built directly, so instead draw
    // widely and look at what came up for the cells that repeated.
    const byCell = new Map<string, Set<string>>();
    for (let seed = 1; seed <= 400; seed++) {
      const card = drawFlashcard('hard', {}, 0, seed);
      const shape = card.cards.map((c) => c.rank).join('+');
      const set = byCell.get(card.cellId) ?? new Set<string>();
      set.add(shape);
      byCell.set(card.cellId, set);
    }
    const varied = [...byCell.values()].filter((s) => s.size > 1).length;
    // Vacuity guard: before this change EVERY cell had exactly one shape.
    expect(varied).toBeGreaterThan(0);
  });

  it('the composition never contradicts the cell it belongs to', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const card = drawFlashcard('hard', {}, 0, seed);
      const total = Number(card.cellId.split('-')[1]);
      const v = handValue(card.cards);
      expect(v.total, card.cellId).toBe(total);
      expect(v.soft).toBe(false);
    }
  });

  it('the graded answer still matches the hand actually shown', () => {
    // The cell fixes the total, but the ANSWER must come from the cards on
    // screen -- a mismatch here would mark a correct answer wrong.
    for (let seed = 1; seed <= 200; seed++) {
      const card = drawFlashcard('hard', {}, 0, seed);
      // The same context drawFlashcard grades in.
      const advice = correctPlay(card.cards, card.up, 0, {
        canDouble: true,
        canSplit: true,
        canSurrender: true,
      });
      expect(card.correct, card.cellId).toBe(advice.action);
    }
  });
});

describe('#52: "Follow with a look-alike" is a forced follow', () => {
  const draw = (seed: number, on: boolean, prev: string | null, category: 'all' | 'hard' | 'soft' | 'pairs' = 'all') =>
    drawFlashcard(category, {}, 0, seed, undefined, on, prev).cellId;
  const prev = 'hard-16-v-10';
  const isFollower = (id: string) => confusabilityWeight(id, prev) > 1;

  it('off, the draw is exactly what it always was -- even with a previous cell', () => {
    for (let seed = 1; seed <= 60; seed++) {
      expect(draw(seed, false, prev)).toBe(drawFlashcard('all', {}, 0, seed).cellId);
    }
  });

  it('on but with no previous cell, the draw is also unchanged', () => {
    for (let seed = 1; seed <= 60; seed++) {
      expect(draw(seed, true, null)).toBe(drawFlashcard('all', {}, 0, seed).cellId);
    }
  });

  it('on, about half the cards come only from the previous cell confusable set', () => {
    // Off, followers are a small slice of 330 cells; on, the forced half plus
    // whatever the free half lands on by chance.
    let offHits = 0;
    let onHits = 0;
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
      if (isFollower(draw(seed, false, prev))) offHits += 1;
      if (isFollower(draw(seed, true, prev))) onHits += 1;
    }
    const offRate = offHits / N;
    const onRate = onHits / N;
    expect(offRate).toBeLessThan(0.1);
    // 0.5 forced + 0.5 * offRate by chance.
    expect(onRate).toBeGreaterThan(0.5 + 0.5 * offRate - 0.05);
    expect(onRate).toBeLessThan(0.5 + 0.5 * offRate + 0.05);
  });

  it('the forced half is drawn from nothing but followers (which exclude the previous cell itself)', () => {
    // The coin is the seed's first rng value; recompute it here and check
    // every heads draw is a follower.
    let forced = 0;
    for (let seed = 1; seed <= 600; seed++) {
      if (mulberry32(seed)() >= 0.5) continue;
      forced += 1;
      const on = draw(seed, true, prev);
      expect(isFollower(on), `seed ${seed} drew ${on}`).toBe(true);
    }
    expect(forced).toBeGreaterThan(200);
  });

  it('respects the category: a forced follow never leaves it', () => {
    for (let seed = 1; seed <= 400; seed++) {
      expect(draw(seed, true, prev, 'soft').startsWith('soft-')).toBe(true);
    }
  });

  it('on, no cell becomes unreachable -- the free half keeps the chart complete', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 4000; seed++) seen.add(draw(seed, true, prev));
    expect(seen.size).toBeGreaterThan(300);
  });
});

describe('#13: a multi-select scope draws from the union of its categories', () => {
  it('Soft + Pairs deals soft and pair hands and never a hard one', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const card = drawFlashcard(['soft', 'pairs'], {}, 0, seed);
      seen.add(card.cellId.split('-')[0]!);
    }
    expect([...seen].sort()).toEqual(['pair', 'soft']);
  });

  it('all three scopes draw exactly as the legacy "all" category', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(drawFlashcard(['hard', 'soft', 'pairs'], {}, 0, seed)).toEqual(drawFlashcard('all', {}, 0, seed));
    }
  });
});

describe('#27 drawFlashcard with fallbacks', () => {
  const draw = (seed: number, fallbacks: boolean) =>
    drawFlashcard(['hard', 'soft', 'pairs'], {}, 0, seed, DEFAULT_RULES, false, null, null, { fallbacks });

  it('off: identical to a draw without options', () => {
    for (let seed = 0; seed < 300; seed++) {
      expect(draw(seed, false)).toEqual(drawFlashcard(['hard', 'soft', 'pairs'], {}, 0, seed, DEFAULT_RULES));
    }
  });

  it('on: some double/surrender hands come as fallbacks, graded under their ctx', () => {
    let fallbacks = 0;
    for (let seed = 0; seed < 3000; seed++) {
      const card = draw(seed, true);
      if (!card.ctx) continue;
      fallbacks++;
      expect(card.correct).toBe(correctPlay(card.cards, card.up, 0, card.ctx, DEFAULT_RULES).action);
      expect(card.correct).not.toBe('double');
      expect(card.correct).not.toBe('surrender');
      if (card.cards.length === 3) expect(card.ctx.canDouble).toBe(false);
    }
    expect(fallbacks).toBeGreaterThan(20);
  });
});

/**
 * Wave M (owner, 2026-10-20): soft hands always read "ace, four", never
 * "four, ace". A table deals the ace second half the time.
 */
describe('soft hands are dealt in both orders', () => {
  it('shows the ace first and second, with the same cell and the same play', async () => {
    const { narrateFlashcardPrompt } = await import('../audio/narrate');
    const { presentedCards } = await import('./masteryChallenge');
    let aceFirst = 0;
    let aceSecond = 0;
    for (let seed = 0; seed < 200; seed++) {
      const card = drawFlashcard('soft', {}, 0, seed);
      if (card.cards[0]!.rank === 'A' && card.cards[1]!.rank === 'A') continue;
      if (card.cards[0]!.rank === 'A') aceFirst++;
      else if (card.cards[1]!.rank === 'A') aceSecond++;
      const flipped = [card.cards[1]!, card.cards[0]!];
      expect(correctPlay(flipped, card.up, 0, { canDouble: true, canSplit: true, canSurrender: true }, DEFAULT_RULES).action)
        .toBe(correctPlay(card.cards, card.up, 0, { canDouble: true, canSplit: true, canSurrender: true }, DEFAULT_RULES).action);
      expect(card.cellId).toBe(`soft-${handValue(card.cards).total}-v-${card.up}`);
    }
    expect(aceFirst).toBeGreaterThan(60);
    expect(aceSecond).toBeGreaterThan(60);
    // Spoken in the order shown.
    expect(narrateFlashcardPrompt([{ rank: '4', suit: 'h' }, { rank: 'A', suit: 's' }], '9')).toMatch(/^You have four, ace\./);
    // Mastery presents both orders too, stable per position.
    const cell = generateAllCells().find((c) => c.id === 'soft-15-v-9')!;
    const orders = new Set<string>();
    for (let index = 0; index < 40; index++) {
      const a = presentedCards(cell, { seed: 7, index });
      expect(presentedCards(cell, { seed: 7, index })).toEqual(a);
      orders.add(a[0]!.rank);
    }
    expect(orders).toEqual(new Set(['A', '4']));
  });
});
