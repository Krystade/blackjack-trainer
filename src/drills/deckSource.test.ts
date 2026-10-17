import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../store/types';
import type { CustomSelection, Settings } from '../store/types';

// The Custom lane owns the real weights; here the contract is what matters:
// cells it omits are not dealt, and its weights reach the draw.
vi.mock('./cellSelection', () => ({
  customWeights: (sel: CustomSelection | undefined, cellIds: readonly string[]) => {
    const out = new Map<string, number>();
    for (const id of cellIds) {
      const tier = sel?.tiers[id];
      if (tier) out.set(id, tier === 'focus' ? 6 : tier === 'regular' ? 3 : 1);
    }
    return out;
  },
}));

const { deckOf, emptyDeckMessage, handDeck, indexCellIds, settingsForCustomStart } = await import('./deckSource');
const { drawFlashcard } = await import('./flashcards');

const H17 = { decks: 6, s17: false };
const drill = (over: Partial<Settings['drill']>): Settings['drill'] => ({ ...DEFAULT_SETTINGS.drill, ...over });

describe('deckOf', () => {
  it('absent or unknown is the chart', () => {
    expect(deckOf(drill({}))).toBe('chart');
    expect(deckOf(drill({ deck: 'nope' as 'chart' }))).toBe('chart');
    expect(deckOf(drill({ deck: 'marked' }))).toBe('marked');
  });
});

describe('indexCellIds: derived from the deviation data', () => {
  it('H17, no surrender indices: the 16 active Illustrious 18 cells (11 v A is H17-inactive, insurance has no cell)', () => {
    const ids = indexCellIds(H17);
    expect(ids.size).toBe(16);
    for (const id of ['hard-16-v-10', 'hard-15-v-10', 'pair-10-v-5', 'pair-10-v-6', 'hard-12-v-4', 'hard-9-v-7']) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(ids.has('hard-11-v-A')).toBe(false);
  });

  it('S17 brings 11 v A in', () => {
    expect(indexCellIds({ decks: 6, s17: true }).has('hard-11-v-A')).toBe(true);
  });

  it('Fab 4 adds its surrender cells when enabled, and only the ones the rule set carries', () => {
    const h17 = indexCellIds({ ...H17, surrenderIndices: true });
    expect([...h17].filter((id) => !indexCellIds(H17).has(id)).sort()).toEqual([
      'hard-14-v-10',
      'hard-15-v-9',
      'hard-15-v-A',
      'hard-16-v-8',
    ]);
    expect(indexCellIds({ decks: 6, s17: true, surrenderIndices: true }).has('hard-16-v-8')).toBe(false);
  });
});

describe('handDeck', () => {
  it('chart: the scoped cells, no weights (the draw is untouched)', () => {
    const deck = handDeck(drill({ scopes: ['soft'] }), H17);
    expect(deck.ids).toHaveLength(80);
    expect(deck.weights).toBeNull();
  });

  it('indexes: intersected with the scope', () => {
    expect(handDeck(drill({ deck: 'indexes' }), H17).ids).toHaveLength(16);
    expect(handDeck(drill({ deck: 'indexes', scopes: ['pairs'] }), H17).ids.sort()).toEqual([
      'pair-10-v-5',
      'pair-10-v-6',
    ]);
    expect(handDeck(drill({ deck: 'indexes', scopes: ['soft'] }), H17).ids).toEqual([]);
  });

  it('marked: the cells carrying a marker, in scope', () => {
    const markers = { 'hard-16-v-10': 'red', 'pair-8-v-A': 'blue' } as const;
    expect(handDeck(drill({ deck: 'marked', markers }), H17).ids.sort()).toEqual(['hard-16-v-10', 'pair-8-v-A']);
    expect(handDeck(drill({ deck: 'marked', markers, scopes: ['pairs'] }), H17).ids).toEqual(['pair-8-v-A']);
    expect(handDeck(drill({ deck: 'marked' }), H17).ids).toEqual([]);
  });

  it('custom: the selection\'s cells with its weights, in scope', () => {
    const custom: CustomSelection = {
      tiers: { 'hard-16-v-10': 'focus', 'soft-18-v-9': 'rare' },
      mix: { focus: 60, regular: 30, rare: 10 },
      favourMissed: false,
    };
    const deck = handDeck(drill({ deck: 'custom', custom }), H17);
    expect(deck.ids.sort()).toEqual(['hard-16-v-10', 'soft-18-v-9']);
    expect(deck.weights!.get('hard-16-v-10')).toBe(6);
    expect(handDeck(drill({ deck: 'custom', custom, scopes: ['pairs'] }), H17).ids).toEqual([]);
  });
});

describe('drawFlashcard with a deck', () => {
  it('deals only the deck\'s cells', () => {
    const weights = new Map([
      ['hard-16-v-10', 1],
      ['pair-8-v-A', 1],
    ]);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) seen.add(drawFlashcard('all', {}, 0, seed, undefined, false, null, weights).cellId);
    expect([...seen].sort()).toEqual(['hard-16-v-10', 'pair-8-v-A']);
  });

  it('multiplies the deck weight into the SR weight', () => {
    const weights = new Map([
      ['hard-16-v-10', 9],
      ['pair-8-v-A', 1],
    ]);
    let heavy = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      if (drawFlashcard('all', {}, 0, seed, undefined, false, null, weights).cellId === 'hard-16-v-10') heavy++;
    }
    expect(heavy / 1000).toBeGreaterThan(0.85);
    expect(heavy / 1000).toBeLessThan(0.95);
  });

  it('an empty deck is refused, not dealt from undefined', () => {
    expect(() => drawFlashcard(['soft'], {}, 0, 1, undefined, false, null, new Map([['hard-16-v-10', 1]]))).toThrow(
      /no cells/,
    );
  });
});

describe('emptyDeckMessage / settingsForCustomStart', () => {
  it('says why the deck is empty', () => {
    expect(emptyDeckMessage({ source: 'marked', scopes: ['hard', 'soft', 'pairs'] })).toMatch(/No hands are marked yet/);
    expect(emptyDeckMessage({ source: 'indexes', scopes: ['soft'] })).toBe(
      'No index plays among Soft hands. Choose more hands or another deck.',
    );
  });

  it('Custom start: the custom deck over every scope', () => {
    const s = settingsForCustomStart({ ...DEFAULT_SETTINGS, drill: drill({ scopes: ['pairs'], flashCategory: 'pairs' }) });
    expect(s.drill.deck).toBe('custom');
    expect(s.drill.scopes).toEqual(['hard', 'soft', 'pairs']);
    expect(s.drill.flashCategory).toBe('all');
  });
});

describe('BJA extras in the index deck', async () => {
  const { cellIdForDeviation, indexCellIds } = await import('./deckSource');
  const { BJA_H17_EXTRAS } = await import('../engine/deviations');
  const dev = (id: string) => BJA_H17_EXTRAS.find((d) => d.id === id)!;
  it('soft, ten-pair and hard extras map to their cells', () => {
    expect(cellIdForDeviation(dev('A8v4'))).toBe('soft-19-v-4');
    expect(cellIdForDeviation(dev('TTv4'))).toBe('pair-10-v-4');
    expect(cellIdForDeviation(dev('8v6'))).toBe('hard-8-v-6');
  });
  it('the soft cells join the deck only with the option on', () => {
    expect(indexCellIds({ decks: 6, s17: false, bjaExtras: true }).has('soft-19-v-6')).toBe(true);
    expect(indexCellIds({ decks: 6, s17: false }).has('soft-19-v-6')).toBe(false);
  });
});
