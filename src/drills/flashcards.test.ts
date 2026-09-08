import { describe, it, expect } from 'vitest';
import { generateAllCells, filterCellsByCategory } from './flashcards';

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
