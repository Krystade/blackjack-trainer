import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../engine/cards';
import { PRESET_IDS } from '../engine/variants/rules';
import { afterDoublePlay, variantPlay, presetData } from '../engine/variants/strategy';
import { playFor } from '../engine/variants/cellCode';
import { feasible, UP_VALUES } from '../engine/variants/chartGen';
import { drawVariantItem, gradeVariantItem, variantItemLegal } from './variantDrill';

const c = (rank: Rank, suit: Suit = 'h'): Card => ({ rank, suit });
const FULL = { canDouble: true, canSplit: true, canSurrender: true };

describe('variant drill grading', () => {
  it('Free Bet: a free double on 11 v 10, a free split on 8,8 v 10, stand on tens', () => {
    expect(variantPlay('freebet', 'real', [c('6'), c('5')], '10', FULL).action).toBe('double');
    expect(variantPlay('freebet', 'real', [c('8'), c('8', 's')], '10', FULL).action).toBe('split');
    expect(variantPlay('freebet', 'real', [c('K'), c('Q')], '6', FULL).action).toBe('stand');
  });

  it('Free Bet: the free hand plays 14 v 2 differently from the real-money hand', () => {
    expect(variantPlay('freebet', 'real', [c('10'), c('4')], '2', FULL).action).toBe('stand');
    expect(variantPlay('freebet', 'free', [c('10'), c('4')], '2', FULL).action).toBe('hit');
  });

  it('Free Bet without surrender falls back to the cell\'s second letter (16 v 10 Rh -> hit)', () => {
    expect(variantPlay('freebet', 'real', [c('10'), c('6')], '10', FULL).action).toBe('surrender');
    expect(variantPlay('freebet', 'real', [c('10'), c('6')], '10', { ...FULL, canSurrender: false }).action).toBe('hit');
  });

  it('Spanish 21: 16 v 2 stands up to five cards and hits with six (the published six-deck step, S6)', () => {
    const noSplit = { ...FULL, canSplit: false, canSurrender: false };
    expect(variantPlay('s21-h17', 'main', [c('10'), c('6')], '2', FULL).action).toBe('stand');
    const five = [c('2'), c('3'), c('3', 's'), c('4'), c('4', 's')];
    const advice = variantPlay('s21-h17', 'main', five, '2', noSplit);
    expect(advice.action).toBe('stand');
    expect(advice.code).toBe('S6');
    // The infinite-deck step (S5, hit at five) is kept as the cell's note.
    expect(advice.note?.computed).toBe('S5');
    const six = [c('2'), c('2', 's'), c('3'), c('3', 's'), c('2', 'd'), c('4')];
    expect(variantPlay('s21-h17', 'main', six, '2', noSplit).action).toBe('hit');
  });

  it('grades the published six-deck play where a six-deck shoe flips the call (B1)', () => {
    // Free Bet A,5 v 6 and Switch 9 v 5: the infinite deck hits, six decks double.
    expect(variantPlay('freebet', 'real', [c('A'), c('5')], '6', FULL).action).toBe('double');
    expect(variantPlay('switch', 'main', [c('5'), c('4')], '5', FULL).action).toBe('double');
    expect(variantPlay('switch', 'main', [c('5'), c('4')], '5', FULL).note?.grade).toBe('published');
  });

  it('keeps the computed play where six decks agree with it, and accepts either on a casino rule', () => {
    // Redouble 11 v 7, four cards: the published D5 is a chart slip; computed D4 hits at four.
    const four = [c('2'), c('3'), c('2', 's'), c('4')];
    const rdd = variantPlay('s21-h17-rdd', 'main', four, '7', { ...FULL, canSplit: false, canSurrender: false });
    expect(rdd.action).toBe('hit');
    expect(rdd.alsoRight).toBeUndefined();
    // 2,2 v 8: split only if the casino pays bonuses after a split.
    const pair = variantPlay('s21-h17', 'main', [c('2'), c('2', 's')], '8', FULL);
    expect(new Set([pair.action, pair.alsoRight])).toEqual(new Set(['hit', 'split']));
  });

  it('Spanish 21: 14 v 4 is stand from 10,4 and hit from a 6,8 (a 7 makes 6-7-8)', () => {
    expect(variantPlay('s21-h17', 'main', [c('10'), c('4')], '4', FULL).action).toBe('stand');
    expect(variantPlay('s21-h17', 'main', [c('6'), c('8', 's')], '4', FULL).action).toBe('hit');
  });

  it('Spanish 21: rescue a doubled 13 v 10; with redouble, double a doubled 9 v 5 again', () => {
    expect(afterDoublePlay('s21-h17', 13, false, '10').action).toBe('surrender');
    expect(afterDoublePlay('s21-h17', 13, false, '5').action).toBe('stand');
    expect(afterDoublePlay('s21-h17-rdd', 9, false, '5').action).toBe('double');
  });

  it('Switch: hit 11 v 10 and 8,8 v 10, where the standard chart doubles and splits', () => {
    expect(variantPlay('switch', 'main', [c('6'), c('5')], '10', FULL).action).toBe('hit');
    expect(variantPlay('switch', 'main', [c('8'), c('8', 's')], 'K', FULL).action).toBe('hit');
  });

  it('an either cell grades both plays right, and only those', () => {
    let item = drawVariantItem('s21-h17', 1);
    for (let seed = 1; seed < 5000 && item.advice.alsoRight === undefined; seed++) item = drawVariantItem('s21-h17', seed + 1);
    expect(gradeVariantItem(item, item.advice.action).correct).toBe(true);
    expect(gradeVariantItem(item, item.advice.alsoRight!).correct).toBe(true);
    const wrong = variantItemLegal(item).find((x) => x !== item.advice.action && x !== item.advice.alsoRight)!;
    expect(gradeVariantItem(item, wrong).correct).toBe(false);
  });

  it('a Spanish deck never deals a 10, to the player or the dealer', () => {
    const ups = new Set<string>();
    for (let seed = 1; seed <= 500; seed++) {
      for (const p of ['s21-h17', 's21-s17', 's21-h17-rdd'] as const) {
        const item = drawVariantItem(p, seed);
        expect(item.cards.map((x) => x.rank)).not.toContain('10');
        expect(item.up).not.toBe('10');
        ups.add(item.up);
        // The id names the cell by value: a J, Q or K up is the ten column.
        if (['J', 'Q', 'K'].includes(item.up)) expect(item.id).toMatch(/\|10(\||$)/);
      }
    }
    // Ten-value up cards are still dealt, as J, Q and K.
    expect([...ups].filter((u) => ['J', 'Q', 'K'].includes(u)).sort()).toEqual(['J', 'K', 'Q']);
    const fb = Array.from({ length: 300 }, (_, i) => drawVariantItem('freebet', i + 1));
    expect(fb.flatMap((x) => x.cards.map((c) => c.rank))).toContain('10');
    expect(fb.map((x) => x.up)).toContain('10');
  });

  it('grades a right and a wrong answer', () => {
    const item = drawVariantItem('switch', 7);
    expect(gradeVariantItem(item, item.advice.action).correct).toBe(true);
    const wrong = variantItemLegal(item).find((a) => a !== item.advice.action)!;
    const g = gradeVariantItem(item, wrong);
    expect(g.correct).toBe(false);
    expect(g.expected).toBe(item.advice.action);
    expect(g.reason).toMatch(/^Basic (hit|stand|double|split|surrender) vs dealer (\d+|A)$/);
  });
});

describe('variant drill items', () => {
  it.each(PRESET_IDS)('%s: deterministic per seed, and the right play is always a legal one', (preset) => {
    for (let seed = 1; seed <= 400; seed++) {
      const a = drawVariantItem(preset, seed);
      const b = drawVariantItem(preset, seed);
      expect(a).toEqual(b);
      expect(variantItemLegal(a)).toContain(a.advice.action);
    }
  });

  it('Spanish 21 deals multi-card and after-double items; Free Bet deals free hands', () => {
    const kinds = (preset: (typeof PRESET_IDS)[number]) =>
      new Set(Array.from({ length: 300 }, (_, i) => drawVariantItem(preset, i + 1).kind));
    expect(kinds('s21-h17')).toEqual(new Set(['hand', 'multi', 'afterDouble']));
    expect(kinds('freebet')).toEqual(new Set(['hand', 'free']));
    expect(kinds('switch')).toEqual(new Set(['hand']));
  });

  it('never deals a Spanish 21 two-card 6-7 / 6-8 / 7-8 start (its play turns on suits)', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const item = drawVariantItem('s21-s17', seed);
      if (item.cards.length !== 2) continue;
      const vals = item.cards.map((x) => x.rank).sort().join(',');
      expect(['6,7', '6,8', '7,8']).not.toContain(vals);
    }
  });
});

describe('cell codes read back to the computed plays', () => {
  it.each(PRESET_IDS)('%s: playFor(code, n) equals the generated plays for every feasible card count', (preset) => {
    for (const table of presetData(preset).tables) {
      for (const section of ['HARD', 'SOFT'] as const) {
        for (const row of table.sections[section]) {
          row.cells.forEach((cell, i) => {
            cell.plays.forEach((play, k) => {
              const n = k + 2;
              if (!feasible(row.key, section === 'SOFT', n)) return;
              // Surrender is a two-card play; later counts read the fallback.
              expect(playFor(cell.code, n), `${preset} ${table.id} ${section} ${row.key} v ${UP_VALUES[i]} n=${n}`).toBe(play);
            });
          });
        }
      }
    }
  });
});
