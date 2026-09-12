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

describe('V4-1: frequency weighting is opt-in and actually reallocates', () => {
  const draw = (seed: number, byFrequency: boolean) =>
    drawFlashcard('all', {}, 0, seed, undefined, byFrequency).cellId;

  it('off, the draw is exactly what it always was', () => {
    for (let seed = 1; seed <= 50; seed++) {
      // The default arg and an explicit false must agree, and both must match
      // the pre-feature call shape.
      expect(draw(seed, false)).toBe(drawFlashcard('all', {}, 0, seed).cellId);
    }
  });

  // Sample sizes are held to what the assertion actually needs: each
  // drawFlashcard call rebuilds all 330 cells and their weights, and the
  // original 3000/6000 passed locally while timing out CI's 5s per-test
  // limit -- which failed the V4-1 deploy outright. The explicit timeout is
  // belt-and-braces so a slow runner degrades to slow, not red.
  it('on, common cells get more of the reps than rare ones', () => {
    const tally = (byFrequency: boolean) => {
      let tenUp = 0;
      for (let seed = 1; seed <= 1500; seed++) {
        if (draw(seed, byFrequency).endsWith('-v-10')) tenUp += 1;
      }
      return tenUp;
    };
    const flat = tally(false);
    const weighted = tally(true);
    // A ten upcard is 4/13 of real deals and 1/10 of the flat cell universe.
    expect(weighted).toBeGreaterThan(flat);
    // Vacuity guard: if the weighting did nothing these would be equal.
    expect(weighted - flat).toBeGreaterThan(100);
  });

  it('on, no cell becomes unreachable -- a rare hand is still one you must know', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 2000; seed++) seen.add(draw(seed, true));
    // The compression exists precisely so the tail keeps showing up.
    expect(seen.size).toBeGreaterThan(300);
  });
});

describe('V5-1: the draw follows a hand with one you would mix it up with', () => {
  const draw = (seed: number, on: boolean, prev: string | null) =>
    drawFlashcard('all', {}, 0, seed, undefined, false, on, prev).cellId;

  it('off, the draw is exactly what it always was -- even with a previous cell', () => {
    for (let seed = 1; seed <= 60; seed++) {
      expect(draw(seed, false, 'hard-16-v-10')).toBe(drawFlashcard('all', {}, 0, seed).cellId);
    }
  });

  it('on but with no previous cell, the draw is also unchanged', () => {
    // The first card of a session has nothing to be confusable WITH, so the
    // feature must be inert rather than doing something arbitrary.
    for (let seed = 1; seed <= 60; seed++) {
      expect(draw(seed, true, null)).toBe(drawFlashcard('all', {}, 0, seed).cellId);
    }
  });

  it('on, neighbours of the last hand come up far more often', () => {
    const prev = 'hard-16-v-10';
    const isNeighbour = (id: string) => confusabilityWeight(id, prev) > 1;
    const tally = (on: boolean) => {
      let n = 0;
      for (let seed = 1; seed <= 1500; seed++) if (isNeighbour(draw(seed, on, prev))) n += 1;
      return n;
    };
    const off = tally(false);
    const on = tally(true);
    expect(on).toBeGreaterThan(off);
    // Vacuity guard: if the term did nothing these would be within noise.
    expect(on - off).toBeGreaterThan(50);
  });

  it('on, the last hand itself is not simply repeated back', () => {
    // Massed practice is the thing being avoided; a term that boosted the
    // previous cell would produce exactly that.
    const prev = 'hard-16-v-10';
    let repeats = 0;
    let total = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      if (draw(seed, true, prev) === prev) repeats += 1;
      total += 1;
    }
    // 1/330 by chance; anything near that is fine, a boost would not be.
    expect(repeats / total).toBeLessThan(0.02);
  });

  it('on, no cell becomes unreachable -- the chart stays complete', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 2500; seed++) seen.add(draw(seed, true, 'hard-16-v-10'));
    expect(seen.size).toBeGreaterThan(300);
  });

  it('composes with the frequency term rather than replacing it', () => {
    // Both on must differ from either alone, or one axis is silently winning.
    const both = [];
    const freqOnly = [];
    const confOnly = [];
    for (let seed = 1; seed <= 200; seed++) {
      both.push(drawFlashcard('all', {}, 0, seed, undefined, true, true, 'hard-16-v-10').cellId);
      freqOnly.push(drawFlashcard('all', {}, 0, seed, undefined, true, false, 'hard-16-v-10').cellId);
      confOnly.push(drawFlashcard('all', {}, 0, seed, undefined, false, true, 'hard-16-v-10').cellId);
    }
    expect(both).not.toEqual(freqOnly);
    expect(both).not.toEqual(confOnly);
  });
});
