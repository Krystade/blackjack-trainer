import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type StrategyRules } from '../../engine/ruleset';
import { EMPTY_STATS } from '../../store/types';
import { askedIndexSet, drawQuizItem } from '../../drills/deviationQuiz';
import { indexTestSet } from '../../drills/indexTest';
import { activeIndices, readiness } from './readiness';

/**
 * D-R3 (Wave D, #23): Home's "Indices seen", the Stats index table and the
 * quiz denominators count ONE set -- the indexes the drills actually ask.
 */
const CASES: [string, StrategyRules][] = [
  ['6D H17', { ...DEFAULT_RULES, s17: false }],
  ['6D H17 + BJA extras', { ...DEFAULT_RULES, s17: false, bjaExtras: true }],
  ['6D H17 + Fab 4 + extras', { ...DEFAULT_RULES, s17: false, bjaExtras: true, surrenderIndices: true }],
  ['2D H17', { ...DEFAULT_RULES, decks: 2, s17: false }],
  ['6D S17 + Fab 4', { ...DEFAULT_RULES, s17: true, surrenderIndices: true }],
];

const ids = (xs: readonly { id: string }[]) => xs.map((d) => d.id).sort();

describe('D-R3: one index set for Home, Stats and the drills', () => {
  it.each(CASES)('%s: Home total, Stats rows, Index test and the quiz draw agree', (_, rules) => {
    const asked = ids(askedIndexSet(rules));
    expect(readiness(structuredClone(EMPTY_STATS), rules).indicesTotal).toBe(asked.length);
    expect(ids(activeIndices(rules))).toEqual(asked); // Stats' index table and quiz SR denominator
    expect(ids(indexTestSet(rules))).toEqual(asked);
    // The quiz itself asks exactly this set: every index comes up, nothing else does.
    const drawn = new Set<string>();
    for (let seed = 1; seed < 3000; seed++) {
      const item = drawQuizItem(seed, undefined, rules, 0, {}, 0);
      if (item.deviationId) drawn.add(item.deviationId);
    }
    expect([...drawn].sort()).toEqual(asked);
  });

  it('the cases differ where they should (vacuity guard)', () => {
    const h17 = ids(askedIndexSet(CASES[0][1]));
    expect(h17).not.toContain('11vA'); // inactive under H17: a basic-chart double
    expect(ids(askedIndexSet(CASES[1][1])).length).toBeGreaterThan(h17.length);
    expect(ids(askedIndexSet(CASES[3][1]))).not.toContain('9v2'); // the 2D chart already doubles it
    expect(h17).toContain('9v2');
  });
});
