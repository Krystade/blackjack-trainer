import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, type StrategyRules } from '../engine/ruleset';
import { generateAllCells } from './flashcards';
import {
  diffSummary, drawRulesQuestion, expectedRulesAnswer, explainRulesQuestion, gradeRulesAnswer, inertNotes,
  planRulesDrill, rulesAnswerOptions, rulesQuestionPrompt, sameChartNotice,
  type RulesDrillPlan, type RulesQuestion, type Side,
} from './rulesDiffDrill';

const r = (p: Partial<StrategyRules>): StrategyRules => ({ ...DEFAULT_RULES, ...p });
const poolOf = (plan: RulesDrillPlan) =>
  plan.pool.map((i) => (i.kind === 'play' ? `${i.cellId}:${i.tcs === null ? 'basic' : i.tcs.join(',')}` : `insurance:${i.tcs.join(',')}`)).sort();
const cell = (id: string) => generateAllCells().find((c) => c.id === id)!;
const play = (id: string, side: Side, tc: number | null): RulesQuestion => ({ kind: 'play', side, cellId: id, cards: cell(id).cards, up: cell(id).up, tc });

const H17S17 = planRulesDrill(r({ s17: false }), r({ s17: true }));

describe('planRulesDrill pools only what changes', () => {
  it('6D H17 vs S17: five basic cells, three counted ones, 16 v 9 inert under late surrender', () => {
    expect(poolOf(H17S17)).toEqual([
      'hard-10-v-A:3', 'hard-11-v-A:-6,-5,-4,-3,-2,-1,0', 'hard-12-v-6:-3,-2',
      'hard-15-v-A:basic', 'hard-17-v-A:basic', 'pair-8-v-A:basic', 'soft-18-v-2:basic', 'soft-19-v-6:basic',
    ]);
    expect(H17S17.inert.map((d) => d.id)).toEqual(['16v9']);
    expect(H17S17.trayDecks).toBeNull();
    expect(sameChartNotice(H17S17)).toBeNull();
  });
  it('6D with Fab 4', () => {
    const plan = planRulesDrill(r({ s17: false, surrenderIndices: true }), r({ s17: true, surrenderIndices: true }));
    expect(poolOf(plan)).toEqual([
      'hard-10-v-A:3', 'hard-11-v-A:-6,-5,-4,-3,-2,-1,0', 'hard-12-v-6:-3,-2', 'hard-15-v-A:-1,0',
      'hard-16-v-8:4,5,6', 'hard-16-v-9:-6,-5,-4,-3,-2,-1', 'hard-17-v-A:basic', 'pair-8-v-A:basic',
      'soft-18-v-2:basic', 'soft-19-v-6:basic',
    ]);
    expect(plan.inert).toEqual([]);
  });
  it('6D with late surrender off: 16 v 9 now matters at +4', () => {
    const plan = planRulesDrill(r({ s17: false, ls: false }), r({ s17: true, ls: false }));
    expect(poolOf(plan)).toEqual([
      'hard-10-v-A:3', 'hard-11-v-A:-6,-5,-4,-3,-2,-1,0', 'hard-12-v-6:-3,-2', 'hard-16-v-9:4',
      'soft-18-v-2:basic', 'soft-19-v-6:basic',
    ]);
  });
  it('no-LS plan never offers surrender', () => {
    const plan = planRulesDrill(r({ s17: false, ls: false }), r({ s17: true, ls: false }));
    for (let seed = 0; seed < 100; seed++) {
      const q = drawRulesQuestion(plan, seed, seed % 2)!;
      expect(rulesAnswerOptions(q, plan)).not.toContain('surrender');
    }
  });
  it('the buttons never give the answer away: same options under both rules', () => {
    for (const item of H17S17.pool) {
      if (item.kind !== 'play') continue;
      const tc = item.tcs === null ? null : item.tcs[0];
      expect(rulesAnswerOptions(play(item.cellId, 'a', tc), H17S17)).toEqual(rulesAnswerOptions(play(item.cellId, 'b', tc), H17S17));
    }
    expect(rulesAnswerOptions(play('pair-8-v-A', 'b', null), H17S17)).toContain('surrender');
  });
  it('2D: 11 v A is inert there', () => {
    const plan = planRulesDrill(r({ decks: 2, s17: false }), r({ decks: 2, s17: true }));
    expect(poolOf(plan)).toEqual([
      'hard-10-v-A:3', 'hard-12-v-6:-3,-2', 'hard-15-v-A:basic', 'hard-16-v-9:4', 'hard-17-v-A:basic',
      'soft-14-v-4:basic', 'soft-18-v-2:basic', 'soft-19-v-6:basic',
    ]);
    expect(plan.inert.map((d) => d.id)).toEqual(['11vA']);
  });
  it('6 vs 8 decks: nothing to ask on the chart, the 8-deck tray instead', () => {
    const plan = planRulesDrill(r({ decks: 6 }), r({ decks: 8 }));
    expect(plan.pool).toEqual([]);
    expect(plan.trayDecks).toBe(8);
    expect(sameChartNotice(plan)).toBe(
      '6 decks and 8 decks use the same basic chart and the same index plays. What changes is the shoe: you divide by more decks. Practise reading the 8-deck tray.');
    const q0 = drawRulesQuestion(plan, 7, 0)!;
    const q1 = drawRulesQuestion(plan, 7, 1)!;
    expect([q0.kind, q0.side, q1.kind, q1.side]).toEqual(['tray-decks', 'b', 'tray-tc', 'b']);
    if (q1.kind !== 'tray-tc') throw new Error('unreachable');
    expect(q1.cardsDealt % 26).toBe(0);
    expect(q1.cardsDealt).toBeGreaterThanOrEqual(52);
    expect(q1.cardsDealt).toBeLessThanOrEqual(364);
  });
  it('identical rules: nothing to ask', () => {
    const plan = planRulesDrill(r({}), r({}));
    expect(plan.pool).toEqual([]);
    expect(plan.trayDecks).toBeNull();
    expect(drawRulesQuestion(plan, 1, 0)).toBeNull();
  });
  it('6 vs 1 deck asks insurance at +2', () => {
    expect(poolOf(planRulesDrill(r({}), r({ decks: 1 })))).toContain('insurance:2');
  });
});

const PLANS: [string, StrategyRules, StrategyRules][] = [
  ['6D H17/S17', r({ s17: false }), r({ s17: true })],
  ['6D Fab 4', r({ s17: false, surrenderIndices: true }), r({ s17: true, surrenderIndices: true })],
  ['6D no LS', r({ s17: false, ls: false }), r({ s17: true, ls: false })],
  ['2D', r({ decks: 2, s17: false }), r({ decks: 2, s17: true })],
  ['1D', r({ decks: 1, s17: false }), r({ decks: 1, s17: true })],
  ['6D vs 1D', r({}), r({ decks: 1 })],
];
describe('drawRulesQuestion', () => {
  it.each(PLANS)('%s: every question is one the two games answer differently, and every change gets asked', (_, a, b) => {
    const plan = planRulesDrill(a, b);
    const seen = new Set<string>();
    for (let seed = 0; seed < 150; seed++) {
      for (let n = 0; n < 4; n++) {
        const q = drawRulesQuestion(plan, seed, n)!;
        expect(q.side).toBe(n % 2 === 0 ? 'a' : 'b');
        if (q.kind !== 'play' && q.kind !== 'insurance') throw new Error(`unexpected ${q.kind}`);
        expect(expectedRulesAnswer({ ...q, side: 'a' }, plan)).not.toEqual(expectedRulesAnswer({ ...q, side: 'b' }, plan));
        if (q.kind === 'play') {
          const item = plan.pool.find((i) => i.kind === 'play' && i.cellId === q.cellId)!;
          expect(item.kind === 'play' && (item.tcs === null ? q.tc === null : item.tcs.includes(q.tc!))).toBe(true);
        }
        seen.add(q.kind === 'play' ? q.cellId : 'insurance');
      }
    }
    expect(seen.size).toBe(plan.pool.length);
  });
  it('is seeded', () => {
    expect(drawRulesQuestion(H17S17, 42, 3)).toEqual(drawRulesQuestion(H17S17, 42, 3));
  });
});

describe('grading under the rules in force', () => {
  it('chart and index cells', () => {
    expect(gradeRulesAnswer(play('hard-11-v-A', 'a', 0), H17S17, 'double')).toBe(true);
    expect(gradeRulesAnswer(play('hard-11-v-A', 'b', 0), H17S17, 'hit')).toBe(true);
    expect(gradeRulesAnswer(play('hard-11-v-A', 'b', 0), H17S17, 'double')).toBe(false);
    expect(gradeRulesAnswer(play('hard-12-v-6', 'a', -3), H17S17, 'stand')).toBe(true);
    expect(gradeRulesAnswer(play('hard-12-v-6', 'b', -3), H17S17, 'hit')).toBe(true);
    expect(gradeRulesAnswer(play('soft-18-v-2', 'a', null), H17S17, 'double')).toBe(true);
    expect(gradeRulesAnswer(play('soft-18-v-2', 'b', null), H17S17, 'stand')).toBe(true);
    expect(gradeRulesAnswer(play('pair-8-v-A', 'b', null), H17S17, 'split')).toBe(true);
  });
  it('insurance: 1 deck takes at +2, 6 decks declines', () => {
    const plan = planRulesDrill(r({}), r({ decks: 1 }));
    expect(gradeRulesAnswer({ kind: 'insurance', side: 'b', tc: 2 }, plan, 'take-insurance')).toBe(true);
    expect(gradeRulesAnswer({ kind: 'insurance', side: 'a', tc: 2 }, plan, 'decline-insurance')).toBe(true);
    expect(rulesAnswerOptions({ kind: 'insurance', side: 'a', tc: 2 }, plan)).toEqual(['take-insurance', 'decline-insurance']);
  });
  it('tray questions grade with half-deck slack', () => {
    const plan = planRulesDrill(r({ decks: 6 }), r({ decks: 8 }));
    const decksQ: RulesQuestion = { kind: 'tray-decks', side: 'b', totalDecks: 8, cardsDealt: 130 };
    expect(gradeRulesAnswer(decksQ, plan, 5.5)).toBe(true);
    expect(gradeRulesAnswer(decksQ, plan, 4.5)).toBe(false);
    const tcQ: RulesQuestion = { kind: 'tray-tc', side: 'b', totalDecks: 8, cardsDealt: 182, rc: 9 }; // 4.5 decks left
    expect(gradeRulesAnswer(tcQ, plan, 2)).toBe(true);
    expect(gradeRulesAnswer(tcQ, plan, 1)).toBe(true); // 9 ÷ 5 = 1.8, a half-deck misread
    expect(gradeRulesAnswer(tcQ, plan, 3)).toBe(false);
  });
});

describe('copy', () => {
  it('prompts say which rules are in force', () => {
    expect(rulesQuestionPrompt(play('soft-18-v-2', 'b', null), H17S17)).toBe('Under S17: A,7 v 2?');
    expect(rulesQuestionPrompt(play('hard-12-v-6', 'a', -3), H17S17)).toBe('Under H17 at TC −3: 12 v 6?');
  });
  it('explanations name both rules', () => {
    expect(explainRulesQuestion(play('soft-18-v-2', 'b', null), H17S17)).toBe('Basic strategy, A,7 v 2: H17 doubles, S17 stands.');
    expect(explainRulesQuestion(play('hard-12-v-6', 'a', -3), H17S17)).toBe(
      'At TC −3, 12 v 6: H17 stands, S17 hits. Index: H17 hit ≤ −4, S17 hit ≤ −2.');
    expect(explainRulesQuestion(play('hard-11-v-A', 'b', 0), H17S17)).toBe(
      'At TC 0, 11 v A: H17 doubles, S17 hits. Index: H17 none, S17 double ≥ +1.');
    const p61 = planRulesDrill(r({}), r({ decks: 1 }));
    expect(explainRulesQuestion({ kind: 'insurance', side: 'b', tc: 2 }, p61)).toBe(
      'At TC +2: 6 decks declines insurance, 1 deck takes insurance.');
    const p68 = planRulesDrill(r({ decks: 6 }), r({ decks: 8 }));
    expect(explainRulesQuestion({ kind: 'tray-decks', side: 'b', totalDecks: 8, cardsDealt: 130 }, p68)).toBe('130 of 416 cards dealt: 5.5 decks left.');
    expect(explainRulesQuestion({ kind: 'tray-tc', side: 'b', totalDecks: 8, cardsDealt: 182, rc: 9 }, p68)).toBe(
      'RC +9 ÷ 4.5 decks → TC +2 (+1 to +2 accepted).');
  });
  it('summary and inert notes', () => {
    const lines = diffSummary(H17S17);
    expect(lines).toHaveLength(8);
    expect(lines).toContain('A,7 v 2: H17 doubles, S17 stands');
    expect(lines).toContain('12 v 6 at TC −3 to −2: H17 stands, S17 hits');
    expect(lines).toContain('10 v A at TC +3: H17 doubles, S17 hits');
    expect(lines).toContain('11 v A at TC 0 and below: H17 doubles, S17 hits');
    expect(inertNotes(H17S17)).toEqual([
      '16 v 9: the index differs (H17 stand ≥ +4, S17 stand ≥ +5) but never changes a play at this table.']);
  });
});
