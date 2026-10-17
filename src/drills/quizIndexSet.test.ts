import { describe, it, expect } from 'vitest';
import { drawQuizItem, quizIndexSet, redundantForChart } from './deviationQuiz';
import { indexSetFor } from '../engine/deviations';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { StrategyRules } from '../engine/ruleset';

/**
 * Wave A (s08 high): the Deviation quiz must never grade against the rule it
 * is quoting. On 2 decks the basic chart already doubles 9 v 2 and 11 v A, so
 * "9 v 2: double at TC >= +1" asked at TC 0 was graded Double while its own
 * label said to hit.
 */
const TWO_DECK_S17: StrategyRules = { ...DEFAULT_RULES, decks: 2, s17: true, ls: false };

describe('quiz index set follows the profile basic chart', () => {
  it('drops 9 v 2 and 11 v A on 2D S17, keeps them on 6D', () => {
    const ids2 = quizIndexSet(TWO_DECK_S17).map((d) => d.id);
    expect(ids2).not.toContain('9v2');
    expect(ids2).not.toContain('11vA');
    const ids6 = quizIndexSet({ ...DEFAULT_RULES, s17: true }).map((d) => d.id);
    expect(ids6).toContain('9v2');
    expect(ids6).toContain('11vA');
    // The default game loses nothing.
    expect(quizIndexSet(DEFAULT_RULES)).toEqual(indexSetFor(DEFAULT_RULES));
  });

  it('no drawn item contradicts its label, on any deck count or soft-17 rule', () => {
    for (const decks of [1, 2, 6, 8] as const) {
      for (const s17 of [false, true]) {
        for (const ls of [false, true]) {
          const rules: StrategyRules = { ...DEFAULT_RULES, decks, s17, ls };
          for (let seed = 1; seed < 400; seed++) {
            const item = drawQuizItem(seed, undefined, rules, 0, {}, 0);
            if (item.cards === null || !item.deviationId) continue;
            const entry = indexSetFor(rules).find((d) => d.id === item.deviationId)!;
            if (!entry.active) continue;
            const onIndexSide = entry.dir === 'gte' ? item.tc >= entry.threshold : item.tc <= entry.threshold;
            // Short of a positive (or past a negative) index, the label says
            // "not this play yet": the graded answer must not be that play.
            const labelSaysNotYet = !onIndexSide && (entry.dir === 'gte' ? entry.threshold > 0 : entry.threshold < 0);
            if (labelSaysNotYet) {
              expect(item.correct, `${decks}D s17=${s17} ls=${ls} ${entry.id} at TC ${item.tc}`).not.toBe(entry.action);
            }
          }
        }
      }
    }
  });

  it('insurance is never redundant', () => {
    const ins = indexSetFor(TWO_DECK_S17).find((d) => d.id === 'ins')!;
    expect(redundantForChart(ins, TWO_DECK_S17)).toBe(false);
  });
});
