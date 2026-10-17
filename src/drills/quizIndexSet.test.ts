import { describe, it, expect } from 'vitest';
import { drawQuizItem, quizIndexSet, redundantForChart } from './deviationQuiz';
import { indexSetFor, isIndexActive } from '../engine/deviations';
import { handValue } from '../engine/hand';
import { rankValue } from '../engine/cards';
import { basicPlay, correctPlay } from '../engine/strategy';
import type { QuizItem } from './deviationQuiz';

const NO_SUR = { canDouble: true, canSplit: true, canSurrender: false };
/** The count play for a distractor, which must equal plain basic strategy. */
function correctPlayFor(item: QuizItem, rules: StrategyRules): string {
  const withCount = correctPlay(item.cards!, item.up, item.tc, NO_SUR, rules).action;
  return withCount === basicPlay(item.cards!, item.up, NO_SUR, rules).action ? withCount : 'index-fires';
}
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
         for (const extras of [false, true]) {
          const rules: StrategyRules = { ...DEFAULT_RULES, decks, s17, ls, bjaExtras: extras, surrenderIndices: extras };
          for (let seed = 1; seed < 400; seed++) {
            const item = drawQuizItem(seed, undefined, rules, extras ? 30 : 0, {}, 0);
            if (item.isDistractor) {
              // A distractor must be plain basic strategy at this cell and count.
              expect(item.cards === null || correctPlayFor(item, rules) === item.correct).toBe(true);
              continue;
            }
            if (item.cards === null || !item.deviationId) continue;
            const entry = indexSetFor(rules).find((d) => d.id === item.deviationId)!;
            if (!entry.active) continue;
            const onIndexSide = entry.dir === 'gte' ? item.tc >= entry.threshold : item.tc <= entry.threshold;
            // Short of a positive (or past a negative) index, the label says
            // "not this play yet": the graded answer must not be that play.
            const labelSaysNotYet = !onIndexSide && (entry.dir === 'gte' ? entry.threshold > 0 : entry.threshold < 0);
            if (labelSaysNotYet) {
              expect(item.correct, `${decks}D s17=${s17} ls=${ls} extras=${extras} ${entry.id} at TC ${item.tc}`).not.toBe(entry.action);
            }
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

const H17_EXTRAS: StrategyRules = { ...DEFAULT_RULES, bjaExtras: true };

describe('BJA extras in the quiz', () => {
  it('a soft extra is asked on the soft hand, never a hard total', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const item = drawQuizItem(seed, 'A8v4', H17_EXTRAS);
      expect(item.cards!.some((c) => c.rank === 'A')).toBe(true);
      const v = handValue(item.cards!);
      expect(v).toEqual({ total: 19, soft: true });
      expect(item.up).toBe('4');
    }
  });
  it('10,10 v 4 is asked on a ten pair', () => {
    const item = drawQuizItem(3, 'TTv4', H17_EXTRAS);
    expect(item.cards!.map((c) => rankValue(c.rank))).toEqual([10, 10]);
  });
  it('the extras are in the quiz set only when on, and 1D drops the ones its chart already plays', () => {
    expect(quizIndexSet(DEFAULT_RULES).some((d) => d.extra)).toBe(false);
    const ids6 = quizIndexSet(H17_EXTRAS).map((d) => d.id);
    for (const id of ['16vA', '15vA', '8v6', 'A8v4', 'A8v5', 'A8v6', 'A6v2', 'TTv4']) expect(ids6).toContain(id);
    const ids1 = quizIndexSet({ ...H17_EXTRAS, decks: 1 }).map((d) => d.id);
    expect(ids1).not.toContain('8v6');
    expect(ids1).not.toContain('A6v2');
  });
  it('a saved pin on an extra falls back when the profile no longer has it', () => {
    expect(isIndexActive('A8v6', { s17: false, bjaExtras: false })).toBe(false);
    expect(isIndexActive('A8v6', { s17: true, bjaExtras: true })).toBe(false);
  });
});
