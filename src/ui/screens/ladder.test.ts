import { describe, expect, it } from 'vitest';
import { EMPTY_STATS } from '../../store/types';
import { isCountFluent } from '../../drills/fluencyGate';
import { ladder } from './nextStep';
import { NOW, iso, flags, runs, deckRows, tcRows, withBets, withIndices, stateAt, ctxFor } from './ladderFixtures';

describe('ladder: casino order (B2)', () => {
  it.each([
    [1, 'basic', 'flash'], [2, 'repair', 'mastery'], [3, 'count', 'count'], [4, 'tc', 'deckest'],
    [5, 'deviations', 'quiz'], [6, 'betramp', 'betsizing'], [7, 'play', 'play'],
  ] as const)('rung %i (%s) is current and Start opens %s', (r, id, kind) => {
    const l = ladder(stateAt(r), ctxFor(r));
    expect(l.current).toBe(r - 1);
    expect(l.rungs.map((x) => x.id)).toEqual(['basic', 'repair', 'count', 'tc', 'deviations', 'betramp', 'play']);
    expect(l.rungs[r - 1]!.id).toBe(id);
    expect(l.step).toMatchObject({ card: 'rung', kind });
    expect(l.rungs.slice(0, r - 1).every((x) => x.passed)).toBe(true);
  });

  it('every rung passed: no current rung', () => {
    expect(ladder(stateAt(8), ctxFor(8)).current).toBeNull();
  });

  it('a later rung already met reports passed while an earlier one is current', () => {
    const s = structuredClone(EMPTY_STATS);
    s.countDrill.history = runs(flags(5, 5));
    const l = ladder(s, { sweepDone: false, now: NOW });
    expect(l.current).toBe(0);
    expect(l.rungs[2]!.passed).toBe(true);
  });

  it('rung 3 is the Drills picker fluency rule (fluencyGate reads the same result)', () => {
    const cases = [[], runs(flags(4, 4)), runs(flags(5, 5)), runs([true, true, false, false, true]), runs([true, true, true, false, true]), [...runs(flags(5, 5), 20), ...runs([true])]];
    for (const h of cases) {
      const s = stateAt(3); s.countDrill.history = h;
      expect(ladder(s, ctxFor(3)).rungs[2]!.passed).toBe(isCountFluent(h));
    }
    const s = stateAt(3); s.countDrill.history = runs([true, true, true, false, false]);
    expect(ladder(s, ctxFor(3)).rungs[2]!.progress).toBe('3/5 right (need 4)');
  });

  it('rung 4: 8 of the last 10 each; deck estimation first; 9 rows are too few', () => {
    const s = stateAt(4); s.countDrill.history = runs(flags(5, 5));
    s.deckEstimation.history = deckRows(flags(7, 10)); s.trueCount.history = tcRows(flags(10, 10));
    expect(ladder(s, ctxFor(4)).step.kind).toBe('deckest');
    expect(ladder(s, ctxFor(4)).rungs[3]!.progress).toBe('Decks 7/10 · TC 10/10 (need 8/10 each)');
    s.deckEstimation.history = deckRows(flags(8, 10)); s.trueCount.history = tcRows(flags(7, 10));
    expect(ladder(s, ctxFor(4)).step.kind).toBe('truecount');
    s.trueCount.history = tcRows(flags(8, 10));
    expect(ladder(s, ctxFor(4)).rungs[3]!.passed).toBe(true);
    s.trueCount.history = tcRows(flags(9, 9));
    expect(ladder(s, ctxFor(4)).rungs[3]!.passed).toBe(false);
    // Old misses outside the last 10 do not count against you.
    s.trueCount.history = tcRows([false, false, false, ...flags(10, 10)]);
    expect(ladder(s, ctxFor(4)).rungs[3]!.passed).toBe(true);
  });

  it('rung 6 reads stats.betSizing.history (contract 1): 8 of last 10, absent = not met', () => {
    const s = stateAt(6); withIndices(s);
    expect(ladder(s, ctxFor(6)).rungs[5]!.progress).toBe('No bet sizing answers yet');
    withBets(s, flags(7, 10));
    expect(ladder(s, ctxFor(6))).toMatchObject({ current: 5, step: { kind: 'betsizing' } });
    expect(ladder(s, ctxFor(6)).rungs[5]!.progress).toBe('7/10 right (need 8/10)');
    withBets(s, flags(8, 10));
    expect(ladder(s, ctxFor(6)).current).toBe(6);
  });

  it('rung 7: a session of 40+ graded decisions at 90%, among the last 5', () => {
    const s = stateAt(7);
    const row = (graded: number, correct: number) => ({ date: iso(1), rounds: 45, graded, correct, bankrollDelta: 0 });
    s.sessions = [row(39, 39)];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(false);
    s.sessions = [row(40, 35)];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(false);
    s.sessions = [row(40, 36)];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(true);
    s.sessions = [row(40, 36), ...Array.from({ length: 5 }, () => row(10, 10))];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(false);
  });

  it('survives legacy and corrupt rows (Review Focus 2)', () => {
    const s = stateAt(8);
    s.sessions = [{ date: 'garbage', rounds: 0, graded: 0, correct: 0, bankrollDelta: 0 }];
    (s as unknown as { betSizing: unknown }).betSizing = { history: [{ date: '', ok: 'yes' }] };
    const l = ladder(s, ctxFor(8));
    expect(l.rungs[5]!.passed).toBe(false);
    expect(l.rungs[6]!.passed).toBe(false);
    expect(JSON.stringify(l)).not.toMatch(/NaN|Infinity/);
  });
});
