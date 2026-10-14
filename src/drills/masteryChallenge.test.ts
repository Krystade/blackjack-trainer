import { describe, it, expect } from 'vitest';
import {
  cellsForScope,
  startMasteryRun,
  advanceMasteryRun,
  isMasteryRunComplete,
  currentCellId,
  hydrateMasteryRun,
  presentedCards,
} from './masteryChallenge';
import { handValue } from '../engine/hand';
import type { MasteryScope } from './masteryChallenge';

const SCOPES: { scope: MasteryScope; count: number }[] = [
  { scope: 'hard', count: 150 },
  { scope: 'soft', count: 80 },
  { scope: 'pairs', count: 100 },
  { scope: 'all', count: 330 },
];

describe('cellsForScope', () => {
  for (const { scope, count } of SCOPES) {
    it(`${scope} has exactly ${count} cells`, () => {
      expect(cellsForScope(scope)).toHaveLength(count);
    });
  }
});

describe('startMasteryRun: completeness (not vacuous -- checked by SET equality + uniqueness, not just length)', () => {
  for (const { scope } of SCOPES) {
    it(`${scope}: order is exactly the scope's cell ids, no duplicates, no omissions`, () => {
      const expectedIds = cellsForScope(scope).map((c) => c.id).sort();
      const run = startMasteryRun(scope, 12345);
      expect(run.order).toHaveLength(expectedIds.length);
      expect(new Set(run.order).size).toBe(run.order.length); // no duplicates
      expect([...run.order].sort()).toEqual(expectedIds); // exact same SET as the universe
      expect(run.index).toBe(0);
    });
  }
});

describe('advanceMasteryRun: correct answers walk the WHOLE order exactly once (the concrete completeness proof)', () => {
  it('a full clean pairs-scope run visits every cell exactly once, in the pre-shuffled order', () => {
    const expectedIds = cellsForScope('pairs').map((c) => c.id).sort();
    let run = startMasteryRun('pairs', 999);
    const visited: string[] = [];
    for (let i = 0; i < run.order.length; i++) {
      const id = currentCellId(run);
      expect(id).not.toBeNull();
      visited.push(id!);
      run = advanceMasteryRun(run, true, 0); // seed is irrelevant on a correct answer
    }
    expect(visited).toHaveLength(100);
    expect(new Set(visited).size).toBe(100); // every cell exactly once
    expect([...visited].sort()).toEqual(expectedIds); // and it's the RIGHT 100 cells
    expect(currentCellId(run)).toBeNull(); // nothing left
    expect(isMasteryRunComplete(run)).toBe(true);
  });

  it('a correct answer does not reshuffle -- order and seed are untouched, only index advances', () => {
    const run = startMasteryRun('hard', 7);
    const next = advanceMasteryRun(run, true, 4242);
    expect(next.order).toEqual(run.order); // same array of ids, in the same order
    expect(next.seed).toBe(run.seed); // seed only ever changes on a RESET
    expect(next.index).toBe(run.index + 1);
  });
});

describe('advanceMasteryRun: a wrong answer resets AND reshuffles (not vacuous -- checked against the specific realistic bugs)', () => {
  it('resets index to 0', () => {
    let run = startMasteryRun('soft', 1);
    run = advanceMasteryRun(run, true, 0);
    run = advanceMasteryRun(run, true, 0); // index is now 2
    const reset = advanceMasteryRun(run, false, 5555);
    expect(reset.index).toBe(0);
  });

  it('uses the PASSED-IN seed, not the run\'s old seed (guards silently ignoring nextSeed)', () => {
    const run = startMasteryRun('soft', 1);
    const reset = advanceMasteryRun(run, false, 999999);
    expect(reset.seed).toBe(999999);
    expect(reset.seed).not.toBe(run.seed);
  });

  it('produces a genuinely different order for a fixed pair of seeds (guards a stale/copied-through array)', () => {
    const run = startMasteryRun('soft', 1);
    const reset = advanceMasteryRun(run, false, 2);
    expect(reset.order).not.toEqual(run.order); // fixed seeds 1 vs 2 -- deterministic, not flaky
    // ...but it's still a full, valid permutation of the SAME scope's cells.
    const expectedIds = cellsForScope('soft').map((c) => c.id).sort();
    expect([...reset.order].sort()).toEqual(expectedIds);
  });

  it('reshuffles even when the reset happens at index 0 already (guards a "nothing to reset" shortcut)', () => {
    const run = startMasteryRun('pairs', 10); // index 0, never advanced
    const reset = advanceMasteryRun(run, false, 20);
    expect(reset.index).toBe(0);
    expect(reset.order).not.toEqual(run.order);
  });
});

describe('hydrateMasteryRun', () => {
  it('null persisted state yields null (fresh install / cleared run)', () => {
    expect(hydrateMasteryRun(null)).toBeNull();
  });

  it('reconstructs the exact same order the original run had, at the persisted index', () => {
    const original = startMasteryRun('hard', 321);
    const advanced = advanceMasteryRun(original, true, 0);
    const rehydrated = hydrateMasteryRun({ scope: advanced.scope, seed: advanced.seed, index: advanced.index });
    expect(rehydrated).toEqual(advanced);
  });

  it('falls back to a fresh run if the persisted index is out of range (corrupt/stale data)', () => {
    const bad = hydrateMasteryRun({ scope: 'pairs', seed: 1, index: 99999 });
    expect(bad).not.toBeNull();
    expect(bad!.index).toBe(0);
  });
});

describe('presentedCards (#18): a hard cell is dealt as any of its compositions', () => {
  const cells = new Map(cellsForScope('all').map((c) => [c.id, c]));
  const hard16 = cells.get('hard-16-v-10')!;

  it('hard 16 comes up as 10+6 and 9+7 about equally across positions and sweeps', () => {
    let nineSeven = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const cards = presentedCards(hard16, { seed: 1000 + (i % 40), index: Math.floor(i / 40) });
      const values = cards.map((c) => handValue([c]).total).sort((a, b) => a - b);
      expect(values[0] + values[1]).toBe(16);
      if (values[0] === 7) nineSeven++;
    }
    // The stored representative is always 6+10, so a view that ignored this
    // would score 0 here.
    expect(nineSeven / N).toBeGreaterThan(0.42);
    expect(nineSeven / N).toBeLessThan(0.58);
  });

  it('is stable for one position of one run, so a re-render shows the same hand', () => {
    for (let index = 0; index < 30; index++) {
      expect(presentedCards(hard16, { seed: 77, index })).toEqual(presentedCards(hard16, { seed: 77, index }));
    }
  });

  it('every hard cell keeps its total and stays hard', () => {
    const run = startMasteryRun('hard', 31337);
    for (let index = 0; index < run.order.length; index++) {
      const cell = cells.get(run.order[index]!)!;
      const v = handValue(presentedCards(cell, { seed: run.seed, index }));
      expect(v.total, cell.id).toBe(Number(cell.id.split('-')[1]));
      expect(v.soft).toBe(false);
    }
  });

  it('pairs and soft cells are shown exactly as stored', () => {
    for (const cell of cellsForScope('pairs').concat(cellsForScope('soft'))) {
      expect(presentedCards(cell, { seed: 5, index: 3 })).toBe(cell.cards);
    }
  });
});
