import { describe, expect, it } from 'vitest';
import type { Rank } from '../../../engine/cards';
import { DEFAULT_RULES, type RuleSet } from '../../../engine/ruleset';
import { DEALER_UPCARDS } from '../chartRows';
import { MISS_WHY_RULES, missWhy, missWhyRule, whyCellFor } from './missWhy';

const RULESETS: RuleSet[] = [];
for (const decks of [1, 2, 6, 8] as const)
  for (const s17 of [false, true])
    for (const das of [false, true])
      for (const ls of [false, true]) RULESETS.push({ ...DEFAULT_RULES, decks, s17, das, ls });

const PAIR_RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

function allCellIds(): string[] {
  const ids: string[] = [];
  for (const up of DEALER_UPCARDS) {
    for (let t = 5; t <= 21; t++) ids.push(`hard-${t}-v-${up}`);
    for (let t = 13; t <= 21; t++) ids.push(`soft-${t}-v-${up}`);
    for (const r of PAIR_RANKS) ids.push(`pair-${r}-v-${up}`);
  }
  return ids;
}

describe('missWhy', () => {
  it("every cell of every ruleset is explained, only by a principle tagged with the cell's own play", () => {
    let checked = 0;
    for (const rules of RULESETS) {
      for (const id of allCellIds()) {
        const cell = whyCellFor(id, rules);
        expect(cell, id).not.toBeNull();
        const rule = missWhyRule(cell!);
        expect(rule, `${id} (${cell!.action}) under ${JSON.stringify(rules)}`).not.toBeNull();
        expect(rule!.tags, `${id}: ${rule!.id} explains ${cell!.action}`).toContain(cell!.action);
        const text = rule!.text(cell!, rules);
        expect(text.trim().endsWith('.'), `${id}: ${text}`).toBe(true);
        expect(text.length, `${id}: ${text}`).toBeLessThanOrEqual(170);
        checked++;
      }
    }
    expect(checked).toBe(RULESETS.length * 360);
  });

  it('the sweep can fail: a rule asked about a play outside its tags is caught', () => {
    const stiffStand = MISS_WHY_RULES.find((r) => r.id === 'hard-stiff-stand')!;
    expect(stiffStand.tags).not.toContain('H');
    // A stiff the chart HITS never reaches the stand principle.
    const cell = whyCellFor('hard-16-v-10', { ...DEFAULT_RULES, ls: false })!;
    expect(cell.action).toBe('H');
    expect(missWhyRule(cell)!.id).toBe('hard-stiff-hit');
  });

  it('the explicit cases win over the general rules they sit in', () => {
    const r = DEFAULT_RULES;
    expect(missWhyRule(whyCellFor('hard-12-v-2', r)!)!.id).toBe('hard-12-v-2-3');
    expect(missWhyRule(whyCellFor('hard-12-v-3', r)!)!.id).toBe('hard-12-v-2-3');
    expect(missWhyRule(whyCellFor('hard-12-v-4', r)!)!.id).toBe('hard-stiff-stand');
    expect(missWhyRule(whyCellFor('pair-5-v-10', r)!)!.id).toBe('pair-fives-strong-up');
    expect(missWhyRule(whyCellFor('pair-5-v-A', r)!)!.id).toBe('pair-fives-strong-up');
    expect(missWhyRule(whyCellFor('pair-5-v-6', r)!)!.id).toBe('pair-fives');
    expect(missWhyRule(whyCellFor('soft-18-v-7', r)!)!.id).toBe('soft-18-stand');
    expect(missWhyRule(whyCellFor('soft-19-v-6', r)!)!.id).not.toBe('soft-18-stand');
    expect(missWhyRule(whyCellFor('hard-16-v-10', r)!)!.id).toBe('surrender');
  });

  it('reads as a sentence a beginner can use', () => {
    expect(missWhy('hard-16-v-6', DEFAULT_RULES)).toMatch(/^Dealer busts \d+% with a 6 up\. 2–6 are bust cards: stand on your stiff/);
    expect(missWhy('hard-12-v-2', DEFAULT_RULES)).toBe(
      'Only a 10-value card busts a 12, and the dealer busts less with a 2 than with a 4 to 6, so hit.',
    );
    expect(missWhy('pair-8-v-10', { ...DEFAULT_RULES, ls: false })).toMatch(/^8,8 is 16/);
    expect(missWhy('not-a-cell', DEFAULT_RULES)).toBeNull();
  });
});
