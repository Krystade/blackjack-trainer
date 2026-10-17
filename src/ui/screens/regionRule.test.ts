import { describe, it, expect } from 'vitest';
import { getChart } from '../../engine/charts';
import type { RuleSet } from '../../engine/ruleset';
import { DEFAULT_RULES } from '../../engine/ruleset';
import { generateAllCells } from '../../drills/flashcards';
import { DEALER_UPCARDS } from './chartRows';
import { regionRuleFor } from './regionRule';

const RULESETS: RuleSet[] = [];
for (const decks of [1, 2, 6, 8] as const)
  for (const s17 of [false, true])
    for (const das of [false, true])
      for (const ls of [false, true]) RULESETS.push({ ...DEFAULT_RULES, decks, s17, das, ls });

function actionAt(rules: RuleSet, section: 'HARD' | 'SOFT' | 'PAIRS', row: number | string, up: string) {
  const chart = getChart(rules);
  const table = chart[section] as Record<string | number, string[] | undefined>;
  return table[row]?.[DEALER_UPCARDS.indexOf(up as never)];
}

describe('region rules cover every chart cell under every ruleset', () => {
  for (const rules of RULESETS) {
    it(`${rules.decks}D ${rules.s17 ? 'S17' : 'H17'} das=${rules.das} ls=${rules.ls}`, () => {
      for (const cell of generateAllCells()) {
        const rule = regionRuleFor(cell.id, rules);
        expect(rule, cell.id).not.toBeNull();
        const [, kind, rowRaw, up] = /^(hard|soft|pair)-(\w+)-v-(\w+)$/.exec(cell.id)!;
        const own =
          kind === 'pair' && getChart(rules).PAIRS[rowRaw as never] !== undefined
            ? { section: 'PAIRS' as const, row: rowRaw! }
            : kind === 'pair'
              ? { section: 'HARD' as const, row: (rowRaw === 'A' ? 11 : Number(rowRaw)) * 2 }
              : { section: kind === 'hard' ? ('HARD' as const) : ('SOFT' as const), row: Number(rowRaw) };
        expect(rule!.section, cell.id).toBe(own.section);
        // The cell is inside its own region...
        expect(rule!.rows.map(String), cell.id).toContain(String(own.row));
        expect(rule!.ups, cell.id).toContain(up);
        // ...and the rule is true of every cell it names.
        for (const r of rule!.rows) for (const u of rule!.ups) {
          expect(actionAt(rules, rule!.section, r, u), `${cell.id} names ${r} v ${u}`).toBe(rule!.action);
        }
        // Horizontally maximal: the neighbours just outside the run differ.
        const idx = rule!.ups.map((u) => DEALER_UPCARDS.indexOf(u));
        const lo = Math.min(...idx), hi = Math.max(...idx);
        if (lo > 0) expect(actionAt(rules, rule!.section, own.row, DEALER_UPCARDS[lo - 1]!)).not.toBe(rule!.action);
        if (hi < 9) expect(actionAt(rules, rule!.section, own.row, DEALER_UPCARDS[hi + 1]!)).not.toBe(rule!.action);
        expect(rule!.text.length, cell.id).toBeLessThanOrEqual(110);
      }
    });
  }
});

describe('region rule wording (6D H17 DAS LS)', () => {
  const r = (id: string) => regionRuleFor(id, DEFAULT_RULES)!.text;
  it('reads as one line a beginner can learn from', () => {
    expect(r('hard-16-v-10')).toBe("Hard 16 v 9–A: surrender (hit if you can't).");
    expect(r('hard-13-v-4')).toBe('Hard 13+ v 2–6: stand.');
    expect(r('hard-11-v-A')).toBe("Hard 11 v any dealer card: double (hit if you can't).");
    expect(r('pair-8-v-A')).toBe("8,8 v A: surrender (split if you can't).");
    expect(r('soft-18-v-9')).toBe('Soft A,2–7 v 9–A: hit.');
    expect(r('pair-5-v-6')).toBe("5,5: never split, play it as hard 10. Hard 10–11 v 2–9: double (hit if you can't).");
    expect(r('pair-10-v-6')).toBe('10,10: never split, play it as hard 20. Hard 18+ v any dealer card: stand.');
  });
  it('is null for anything that is not a cell', () => {
    expect(regionRuleFor('dealer A', DEFAULT_RULES)).toBeNull();
  });
});
