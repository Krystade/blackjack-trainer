import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import { DEFAULT_RULES, type StrategyRules } from '../engine/ruleset';
import { indexSetFor } from '../engine/deviations';
import { indexPlayAt, indexPlayBelow, publishedIndex, publishedIndexText } from './indexDisplay';
import { indexTestItemFor, indexTestSet } from './indexTest';

/**
 * R6 (#20, #30): every surface that shows an index shows the PUBLISHED index
 * -- the number the Index test grades -- through one formatter. Stored `lte`
 * thresholds (12 v 6 "hit at TC <= -4") stay internal.
 */

const RULESETS: StrategyRules[] = [];
for (const decks of [1, 2, 6, 8] as const) {
  for (const s17 of [false, true]) {
    for (const surrenderIndices of [false, true]) {
      for (const bjaExtras of [false, true]) RULESETS.push({ ...DEFAULT_RULES, decks, s17, surrenderIndices, bjaExtras });
    }
  }
}

describe('publishedIndexText', () => {
  it('lte entries read one above the stored threshold, always as TC ≥', () => {
    const h17 = indexSetFor({ decks: 6, s17: false });
    const at = (id: string) => publishedIndexText(h17.find((d) => d.id === id)!);
    expect(at('12v6')).toBe('TC ≥ −3');
    expect(at('13v2')).toBe('TC ≥ −1');
    expect(at('12v4')).toBe('TC ≥ 0');
    expect(at('16v10')).toBe('TC ≥ 0');
    expect(at('ins')).toBe('TC ≥ +3');
  });
});

describe('every index label states the published index', () => {
  it.each(RULESETS.map((r) => [`${r.decks}D ${r.s17 ? 'S17' : 'H17'} fab4=${r.surrenderIndices} bja=${r.bjaExtras}`, r] as const))(
    '%s', (_, rules) => {
      for (const dev of indexSetFor(rules).filter((d) => d.active)) {
        expect(dev.label, dev.id).toContain(publishedIndexText(dev));
        expect(dev.label, dev.id).not.toMatch(/≤|any negative/);
      }
    });

  it('H17 12 v 6 is the published stand at −3 (not hit at ≤ −4); S17 is −1', () => {
    expect(indexSetFor({ decks: 6, s17: false }).find((d) => d.id === '12v6')!.label).toBe('12 v 6: stand at TC ≥ −3; hit below (H17)');
    expect(indexSetFor({ decks: 6, s17: true }).find((d) => d.id === '12v6')!.label).toBe('12 v 6: stand at TC ≥ −1; hit below (S17)');
    expect(indexSetFor({ decks: 6, s17: false, bjaExtras: true }).find((d) => d.id === 'A8v6')!.label).toBe('A,8 v 6: double at TC ≥ 0; stand below');
  });

  it('the plays named at and below the index are the ones the engine plays', () => {
    for (const rules of RULESETS) {
      for (const dev of indexTestSet(rules)) {
        const item = indexTestItemFor(dev, rules, mulberry32(7));
        expect(item.index, dev.id).toBe(publishedIndex(dev));
        expect(item.playAt, dev.id).toBe(indexPlayAt(dev));
        const below = indexPlayBelow(dev);
        if (below !== null) expect(item.playBelow, dev.id).toBe(below);
      }
    }
  });
});
