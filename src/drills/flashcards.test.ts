import { describe, it, expect } from 'vitest';
import { generateAllCells, filterCellsByCategory, drawFlashcard } from './flashcards';
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
