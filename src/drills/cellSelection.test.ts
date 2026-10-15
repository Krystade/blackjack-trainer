import { describe, it, expect } from 'vitest';
import {
  ALL_PAINT_CELL_IDS,
  DEFAULT_MIX,
  autoTiers,
  cellsInRect,
  cellsOnLine,
  clearSelection,
  customWeights,
  defaultSelection,
  paintCell,
  paintRect,
  setMixShare,
  tierOf,
} from './cellSelection';
import { generateAllCells } from './flashcards';
import type { CustomSelection, Stats } from '../store/types';

/** B2 (#9): the Custom drill's painted selection, as weights and transforms. */

function sel(tiers: CustomSelection['tiers'], extra: Partial<CustomSelection> = {}): CustomSelection {
  return { tiers, painted: {}, mix: { ...DEFAULT_MIX }, favourMissed: false, ...extra };
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('the painter grid', () => {
  it('covers exactly the cells the flashcards deal', () => {
    const dealt = generateAllCells().map((c) => c.id).sort();
    expect([...ALL_PAINT_CELL_IDS].sort()).toEqual(dealt);
    expect(new Set(ALL_PAINT_CELL_IDS).size).toBe(330);
  });

  it('a rectangle covers every cell between its corners, in one section', () => {
    // Hard rows run 19 at the top down to 5, so 16..14 is three rows.
    const rect = cellsInRect('hard-16-v-5', 'hard-14-v-7');
    expect(rect.sort()).toEqual(
      ['hard-16-v-5', 'hard-16-v-6', 'hard-16-v-7', 'hard-15-v-5', 'hard-15-v-6', 'hard-15-v-7',
        'hard-14-v-5', 'hard-14-v-6', 'hard-14-v-7'].sort(),
    );
    expect(cellsInRect('hard-16-v-5', 'soft-18-v-7')).toEqual(['hard-16-v-5', 'soft-18-v-7']);
  });

  it('a stroke fills the cells a fast drag skipped', () => {
    expect(cellsOnLine('hard-16-v-2', 'hard-16-v-6')).toEqual([
      'hard-16-v-2', 'hard-16-v-3', 'hard-16-v-4', 'hard-16-v-5', 'hard-16-v-6',
    ]);
    expect(cellsOnLine('pair-8-v-9', 'pair-6-v-A')).toEqual(['pair-8-v-9', 'pair-7-v-10', 'pair-6-v-A']);
    expect(cellsOnLine('hard-12-v-2', 'hard-12-v-2')).toEqual(['hard-12-v-2']);
  });
});

describe('painting', () => {
  it('paints a cell and marks it hand-painted; Off removes the tier but keeps the mark', () => {
    let s = sel({ 'hard-16-v-10': 'regular' });
    s = paintCell(s, 'hard-16-v-10', 'focus');
    expect(tierOf(s, 'hard-16-v-10')).toBe('focus');
    expect(s.painted?.['hard-16-v-10']).toBe(true);
    s = paintCell(s, 'hard-16-v-10', 'off');
    expect(tierOf(s, 'hard-16-v-10')).toBe('off');
    expect('hard-16-v-10' in s.tiers).toBe(false);
    expect(s.painted?.['hard-16-v-10']).toBe(true);
  });

  it('paints a rectangle without touching the rest', () => {
    const s = paintRect(sel({ 'hard-19-v-2': 'rare' }), 'hard-12-v-2', 'hard-13-v-3', 'focus');
    expect(Object.keys(s.tiers).sort()).toEqual(['hard-12-v-2', 'hard-12-v-3', 'hard-13-v-2', 'hard-13-v-3', 'hard-19-v-2'].sort());
    expect(s.tiers['hard-19-v-2']).toBe('rare');
  });

  it('Clear turns everything Off and forgets the hand marks, keeping mix and toggle', () => {
    const s = clearSelection(sel({ a: 'focus' }, { painted: { a: true }, favourMissed: true, mix: { focus: 50, regular: 40, rare: 10 } }));
    expect(s.tiers).toEqual({});
    expect(s.painted).toEqual({});
    expect(s.favourMissed).toBe(true);
    expect(s.mix).toEqual({ focus: 50, regular: 40, rare: 10 });
  });

  it('starts from every cell Regular', () => {
    const s = defaultSelection();
    expect(Object.values(s.tiers).every((t) => t === 'regular')).toBe(true);
    expect(Object.keys(s.tiers)).toHaveLength(330);
    expect(s.mix).toEqual({ focus: 60, regular: 30, rare: 10 });
  });
});

describe('customWeights', () => {
  const ids = ['f1', 'f2', 'g1', 'g2', 'g3', 'r1', 'o1'];
  const tiers: CustomSelection['tiers'] = { f1: 'focus', f2: 'focus', g1: 'regular', g2: 'regular', g3: 'regular', r1: 'rare' };

  it('weighs every cell 1 when there is no selection', () => {
    const w = customWeights(undefined, ['a', 'b']);
    expect([...w.entries()]).toEqual([['a', 1], ['b', 1]]);
  });

  it('gives each tier its mix share, split evenly over its cells, and omits Off', () => {
    const w = customWeights(sel(tiers), ids);
    expect(w.has('o1')).toBe(false);
    expect(w.size).toBe(6);
    expect(w.get('f1')! + w.get('f2')!).toBeCloseTo(0.6);
    expect(w.get('f1')).toBeCloseTo(w.get('f2')!);
    expect(w.get('g1')! * 3).toBeCloseTo(0.3);
    expect(w.get('r1')).toBeCloseTo(0.1);
  });

  it('omits cells outside the drill scope and shares only over the cells in it', () => {
    const w = customWeights(sel(tiers), ['f1', 'g1', 'r1']);
    expect([...w.keys()].sort()).toEqual(['f1', 'g1', 'r1']);
    expect(w.get('f1')).toBeCloseTo(0.6);
    expect(w.get('g1')).toBeCloseTo(0.3);
  });

  it('hands an empty tier share to the others in proportion', () => {
    // No Focus cells: Regular and Rare split 100% as 30:10.
    const w = customWeights(sel({ g1: 'regular', r1: 'rare' }), ['g1', 'r1']);
    expect(w.get('g1')).toBeCloseTo(0.75);
    expect(w.get('r1')).toBeCloseTo(0.25);
    expect(sum(w)).toBeCloseTo(1);
  });

  it('does not draw a tier with a 0 share, but never leaves a selection undrawable', () => {
    const zeroRare = sel(tiers, { mix: { focus: 70, regular: 30, rare: 0 } });
    expect(customWeights(zeroRare, ids).has('r1')).toBe(false);
    const onlyRare = sel({ r1: 'rare', r2: 'rare' }, { mix: { focus: 70, regular: 30, rare: 0 } });
    const w = customWeights(onlyRare, ['r1', 'r2']);
    expect(w.get('r1')).toBeCloseTo(0.5);
    expect(w.get('r2')).toBeCloseTo(0.5);
  });

  it('favour missed multiplies by (1 + miss rate)', () => {
    const stats: Stats['cellStats'] = {
      g1: { right: 1, wrong: 3, lastAt: '' }, // 75% missed
      g2: { right: 4, wrong: 0, lastAt: '' },
    };
    const off = customWeights(sel(tiers), ids, stats);
    const on = customWeights(sel(tiers, { favourMissed: true }), ids, stats);
    expect(on.get('g1')).toBeCloseTo(off.get('g1')! * 1.75);
    expect(on.get('g2')).toBeCloseTo(off.get('g2')!);
    expect(on.get('g3')).toBeCloseTo(off.get('g3')!); // no data: unchanged
  });

  it('returns nothing for a selection with every cell Off', () => {
    expect(customWeights(sel({}), ids).size).toBe(0);
  });
});

describe('autoTiers', () => {
  const stats: Stats['cellStats'] = {
    weak: { right: 7, wrong: 3, lastAt: '' }, // 70%
    edgeFocus: { right: 78, wrong: 22, lastAt: '' }, // exactly 78% -> Regular
    mid: { right: 9, wrong: 1, lastAt: '' }, // 90%
    edgeRegular: { right: 92, wrong: 8, lastAt: '' }, // exactly 92% -> Rare
    strong: { right: 10, wrong: 0, lastAt: '' },
    empty: { right: 0, wrong: 0, lastAt: '' },
  };

  it('Focus below 78%, Regular below 92%, Rare at or above, no data Regular', () => {
    const t = autoTiers(['weak', 'edgeFocus', 'mid', 'edgeRegular', 'strong', 'empty', 'unseen'], stats, {});
    expect(t).toEqual({
      weak: 'focus',
      edgeFocus: 'regular',
      mid: 'regular',
      edgeRegular: 'rare',
      strong: 'rare',
      empty: 'regular',
      unseen: 'regular',
    });
  });

  it('leaves hand-painted cells as they are, Off included', () => {
    const t = autoTiers(['weak', 'strong', 'mid'], stats, { weak: true, strong: true }, { weak: 'rare' });
    expect(t).toEqual({ weak: 'rare', mid: 'regular' });
  });
});

describe('setMixShare', () => {
  it('keeps the three summing to 100, rebalancing the others in proportion', () => {
    expect(setMixShare(DEFAULT_MIX, 'focus', 80)).toEqual({ focus: 80, regular: 15, rare: 5 });
    expect(setMixShare({ focus: 100, regular: 0, rare: 0 }, 'focus', 40)).toEqual({ focus: 40, regular: 30, rare: 30 });
    for (const v of [0, 1, 33, 67, 99, 100, 150, -5]) {
      const m = setMixShare({ focus: 33, regular: 33, rare: 34 }, 'regular', v);
      expect(m.focus + m.regular + m.rare).toBe(100);
      expect(Math.min(m.focus, m.regular, m.rare)).toBeGreaterThanOrEqual(0);
    }
  });

  it('rebalances onto the slider step, so every share is a value its slider can show', () => {
    // 65 leaves 35 to split 30:10 -- unrounded that is 26/9, which a step-5
    // range input silently snaps to 25/10 while its label still reads 26%.
    expect(setMixShare(DEFAULT_MIX, 'focus', 65, 5)).toEqual({ focus: 65, regular: 25, rare: 10 });
    for (const v of [0, 5, 35, 65, 95, 100]) {
      const m = setMixShare({ focus: 60, regular: 30, rare: 10 }, 'rare', v, 5);
      expect(m.focus + m.regular + m.rare).toBe(100);
      for (const share of [m.focus, m.regular, m.rare]) expect(share % 5).toBe(0);
    }
  });
});

describe('a saved selection from storage', () => {
  // Persisted data: a hand edit or a later version's tier name must not
  // throw in the deck or the editor.
  const junk = { tiers: { a: 'focus', b: 'never' }, painted: {}, mix: { focus: 60, regular: 30, rare: 10 }, favourMissed: false } as unknown as CustomSelection;

  it('treats an unknown tier as Off', () => {
    expect(tierOf(junk, 'b')).toBe('off');
    const w = customWeights(junk, ['a', 'b']);
    expect([...w.keys()]).toEqual(['a']);
  });

  it('falls back to the default share for a missing or non-numeric mix entry', () => {
    const broken = { ...junk, tiers: { a: 'focus', c: 'regular' }, mix: { focus: 'x', regular: 30 } } as unknown as CustomSelection;
    const w = customWeights(broken, ['a', 'c']);
    expect(w.get('a')).toBeCloseTo(60 / 90);
    expect(w.get('c')).toBeCloseTo(30 / 90);
  });
});
