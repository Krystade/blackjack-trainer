import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../store/types';
import type { Settings } from '../store/types';
import {
  ALL_SCOPES,
  filterCellsByScopes,
  legacyCategory,
  scopesFrom,
  scopesLabel,
  tapScope,
  withScopes,
} from './handScope';
import type { HandScope } from './handScope';
import { generateAllCells } from './flashcards';

const drill = (over: Partial<Settings['drill']>): Settings['drill'] => ({ ...DEFAULT_SETTINGS.drill, ...over });

describe('scopesFrom (#13)', () => {
  it('falls back to flashCategory when scopes is absent', () => {
    expect(scopesFrom(drill({ flashCategory: 'all' }))).toEqual(['hard', 'soft', 'pairs']);
    expect(scopesFrom(drill({ flashCategory: 'pairs' }))).toEqual(['pairs']);
    expect(scopesFrom(drill({ flashCategory: 'soft' }))).toEqual(['soft']);
  });

  it('prefers scopes over flashCategory, in canonical order without duplicates', () => {
    expect(scopesFrom(drill({ flashCategory: 'hard', scopes: ['pairs', 'soft', 'pairs'] }))).toEqual(['soft', 'pairs']);
  });

  it('never returns an empty set: empty or junk scopes fall back to flashCategory', () => {
    expect(scopesFrom(drill({ flashCategory: 'hard', scopes: [] }))).toEqual(['hard']);
    expect(scopesFrom(drill({ flashCategory: 'all', scopes: ['bogus' as HandScope] }))).toEqual([...ALL_SCOPES]);
  });
});

describe('tapScope (#13)', () => {
  it('"All" selects all three', () => {
    expect(tapScope(['pairs'], 'all')).toEqual(['hard', 'soft', 'pairs']);
  });

  it('from All, a chip narrows to just that chip', () => {
    expect(tapScope(['hard', 'soft', 'pairs'], 'pairs')).toEqual(['pairs']);
  });

  it('otherwise a chip toggles', () => {
    expect(tapScope(['pairs'], 'hard')).toEqual(['hard', 'pairs']);
    expect(tapScope(['hard', 'pairs'], 'hard')).toEqual(['pairs']);
    expect(tapScope(['hard', 'soft'], 'pairs')).toEqual(['hard', 'soft', 'pairs']);
  });

  it('the last chip cannot be removed', () => {
    expect(tapScope(['soft'], 'soft')).toEqual(['soft']);
  });
});

describe('withScopes / legacyCategory', () => {
  it('writes scopes and keeps flashCategory readable by older code', () => {
    const one = withScopes(DEFAULT_SETTINGS, ['pairs']);
    expect(one.drill.scopes).toEqual(['pairs']);
    expect(one.drill.flashCategory).toBe('pairs');
    const two = withScopes(DEFAULT_SETTINGS, ['soft', 'hard']);
    expect(two.drill.scopes).toEqual(['hard', 'soft']);
    expect(two.drill.flashCategory).toBe('all');
    expect(legacyCategory(['hard', 'soft', 'pairs'])).toBe('all');
  });

  it('refuses to write an empty set', () => {
    const s = withScopes({ ...DEFAULT_SETTINGS, drill: drill({ flashCategory: 'soft' }) }, []);
    expect(s.drill.scopes).toEqual(['soft']);
  });
});

describe('filterCellsByScopes', () => {
  const cells = generateAllCells();
  it('a two-scope selection is the union of the two', () => {
    const hs = filterCellsByScopes(cells, ['hard', 'soft']);
    expect(hs).toHaveLength(150 + 80);
    expect(hs.some((c) => c.id.startsWith('pair-'))).toBe(false);
    expect(filterCellsByScopes(cells, ['pairs'])).toHaveLength(100);
    expect(filterCellsByScopes(cells, ALL_SCOPES)).toHaveLength(330);
  });
});

describe('scopesLabel', () => {
  it('names the selection', () => {
    expect(scopesLabel(['hard', 'soft', 'pairs'])).toBe('All');
    expect(scopesLabel(['pairs', 'hard'])).toBe('Hard + Pairs');
  });
});
