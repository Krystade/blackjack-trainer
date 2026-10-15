import { describe, it, expect } from 'vitest';
import { getChart } from '../../engine/charts';
import { indexSetFor } from '../../engine/deviations';
import { DEFAULT_RULES } from '../../engine/ruleset';
import type { StrategyRules } from '../../engine/ruleset';
import { DEALER_UPCARDS, buildSectionRows } from './chartRows';
import type { ChartSection } from './chartRows';
import { formatIndex, indexList, indexesAtCell } from './indexChart';

const H17: StrategyRules = DEFAULT_RULES;
const S17: StrategyRules = { ...DEFAULT_RULES, s17: true };
const H17_FAB4: StrategyRules = { ...DEFAULT_RULES, surrenderIndices: true };
const S17_FAB4: StrategyRules = { ...S17, surrenderIndices: true };

describe('formatIndex', () => {
  it('signs the threshold the way the deviation labels do, with a real minus', () => {
    expect(formatIndex(3, 'gte')).toBe('TC ≥ +3');
    expect(formatIndex(0, 'gte')).toBe('TC ≥ 0');
    expect(formatIndex(-2, 'lte')).toBe('TC ≤ −2');
  });
});

describe('indexList', () => {
  it('writes each index as hand, dealer, index and play', () => {
    const byId = new Map(indexList(H17).entries.map((e) => [e.id, e]));
    expect(byId.get('16v10')?.text).toBe('16 v 10 · TC ≥ 0 · Stand');
    expect(byId.get('13v2')?.text).toBe('13 v 2 · TC ≤ −2 · Hit');
    expect(byId.get('TTv5')?.text).toBe('10,10 v 5 · TC ≥ +5 · Split');
    expect(byId.get('ins')?.text).toBe('Any hand v A · TC ≥ +3 · Take insurance');
  });

  it('is the active index set, in its own order, for every rules combination', () => {
    for (const rules of [H17, S17, H17_FAB4, S17_FAB4, { ...H17, decks: 1 as const }]) {
      const set = indexSetFor(rules);
      const list = indexList(rules);
      expect(list.entries.map((e) => e.id)).toEqual(set.filter((d) => d.active).map((d) => d.id));
      // The threshold on screen is the one the engine grades with.
      for (const e of list.entries) {
        const dev = set.find((d) => d.id === e.id)!;
        expect(e.index).toBe(formatIndex(dev.threshold, dev.dir));
      }
    }
  });

  it('follows the rules: S17 changes thresholds, single deck moves insurance', () => {
    const at = (rules: StrategyRules, id: string) => indexList(rules).entries.find((e) => e.id === id)?.index;
    expect(at(H17, '16v9')).toBe('TC ≥ +4');
    expect(at(S17, '16v9')).toBe('TC ≥ +5');
    expect(at(H17, 'ins')).toBe('TC ≥ +3');
    expect(at({ ...H17, decks: 1 }, 'ins')).toBe('TC ≥ +2');
  });

  it('names an index the rules switch off instead of dropping it silently', () => {
    expect(indexList(H17).entries.some((e) => e.id === '11vA')).toBe(false);
    expect(indexList(H17).inactive).toEqual([indexSetFor(H17).find((d) => d.id === '11vA')!.label]);
    expect(indexList(S17).entries.some((e) => e.id === '11vA')).toBe(true);
    expect(indexList(S17).inactive).toEqual([]);
  });

  it('adds the Fab 4 only when the profile plays them', () => {
    expect(indexList(H17).entries.filter((e) => e.group === 'fab4')).toEqual([]);
    const fab = indexList(H17_FAB4).entries.filter((e) => e.group === 'fab4');
    expect(fab.map((e) => e.id)).toEqual(indexSetFor(H17_FAB4).filter((d) => d.kind === 'surrender').map((d) => d.id));
    expect(fab.length).toBeGreaterThan(0);
    expect(fab.every((e) => e.play === 'Surrender' && e.family === 'surrender')).toBe(true);
    // S17 carries fewer (no 16 v 8 / 16 v 9 source).
    expect(indexList(S17_FAB4).entries.filter((e) => e.group === 'fab4').length).toBeLessThan(fab.length);
  });
});

describe('indexesAtCell', () => {
  /** Every (section, row, column) on the assembled chart that carries an index. */
  function marked(rules: StrategyRules): string[] {
    const chart = getChart(rules);
    const { entries } = indexList(rules);
    const out: string[] = [];
    for (const section of ['HARD', 'SOFT', 'PAIRS'] as ChartSection[]) {
      for (const row of buildSectionRows(chart, section, 'ascending')) {
        for (const up of DEALER_UPCARDS) {
          for (const e of indexesAtCell(entries, section, row, up)) out.push(`${row.id}:${up}:${e.id}`);
        }
      }
    }
    return out;
  }

  it('puts every index with a cell on exactly one HARD cell, and insurance on none', () => {
    for (const rules of [H17, S17, H17_FAB4, S17_FAB4]) {
      const cells = marked(rules);
      const { entries } = indexList(rules);
      const withCell = entries.filter((e) => e.hardTotal !== null);
      expect(cells.length).toBe(withCell.length);
      expect(new Set(cells.map((c) => c.split(':').pop())).size).toBe(withCell.length);
      expect(cells.every((c) => c.startsWith('HARD:'))).toBe(true);
      expect(cells.some((c) => c.endsWith(':ins'))).toBe(false);
    }
  });

  it('lands on the cell the index is about, including a folded row and a shared cell', () => {
    const cells = marked(H17_FAB4);
    expect(cells).toContain('HARD:16:10:16v10');
    expect(cells).toContain('HARD:12:4:12v4');
    // 10,10 plays as hard 20, which this chart folds into its 18+ row.
    expect(cells).toContain('HARD:18:5:TTv5');
    // 16 v 9 carries two different plays.
    expect(cells.filter((c) => c.startsWith('HARD:16:9:'))).toEqual(['HARD:16:9:16v9', 'HARD:16:9:sur16v9']);
  });

  it('leaves soft and pair cells, and unindexed hard cells, unmarked', () => {
    const chart = getChart(H17);
    const { entries } = indexList(H17);
    const hard17 = buildSectionRows(chart, 'HARD', 'ascending').find((r) => r.keys.includes(17))!;
    for (const up of DEALER_UPCARDS) expect(indexesAtCell(entries, 'HARD', hard17, up)).toEqual([]);
    const pair8 = buildSectionRows(chart, 'PAIRS', 'ascending').find((r) => r.id === 'PAIRS:8')!;
    expect(indexesAtCell(entries, 'PAIRS', pair8, '10')).toEqual([]);
  });
});
