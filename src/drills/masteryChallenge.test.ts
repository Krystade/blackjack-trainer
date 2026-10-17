import { describe, it, expect } from 'vitest';
import {
  cellsForScope,
  startMasteryRun,
  advanceMasteryRun,
  MASTERY_MISS_RETRY_AT,
  placeMissedEarly,
  isMasteryRunComplete,
  currentCellId,
  hydrateMasteryRun,
  presentedCards,
  runCoversExactly,
  srCellWeight,
  weightedShuffle,
} from './masteryChallenge';
import { reviewCard } from './spacedRepetition';
import type { SrDeck } from './spacedRepetition';
import { fisherYatesShuffle, mulberry32 } from '../engine/cards';
import { handValue } from '../engine/hand';
import type { MasteryScope } from './masteryChallenge';
import type { HandScope } from './handScope';

const ids = (scope: MasteryScope | readonly HandScope[]) => cellsForScope(scope).map((c) => c.id);

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
      const run = startMasteryRun(ids(scope), 12345);
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
    let run = startMasteryRun(ids('pairs'), 999);
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
    const run = startMasteryRun(ids('hard'), 7);
    const next = advanceMasteryRun(run, true, 4242);
    expect(next.order).toEqual(run.order); // same array of ids, in the same order
    expect(next.seed).toBe(run.seed); // seed only ever changes on a RESET
    expect(next.index).toBe(run.index + 1);
  });
});

describe('advanceMasteryRun: a wrong answer resets AND reshuffles (not vacuous -- checked against the specific realistic bugs)', () => {
  it('resets index to 0', () => {
    let run = startMasteryRun(ids('soft'), 1);
    run = advanceMasteryRun(run, true, 0);
    run = advanceMasteryRun(run, true, 0); // index is now 2
    const reset = advanceMasteryRun(run, false, 5555);
    expect(reset.index).toBe(0);
  });

  it('uses the PASSED-IN seed, not the run\'s old seed (guards silently ignoring nextSeed)', () => {
    const run = startMasteryRun(ids('soft'), 1);
    const reset = advanceMasteryRun(run, false, 999999);
    expect(reset.seed).toBe(999999);
    expect(reset.seed).not.toBe(run.seed);
  });

  it('produces a genuinely different order for a fixed pair of seeds (guards a stale/copied-through array)', () => {
    const run = startMasteryRun(ids('soft'), 1);
    const reset = advanceMasteryRun(run, false, 2);
    expect(reset.order).not.toEqual(run.order); // fixed seeds 1 vs 2 -- deterministic, not flaky
    // ...but it's still a full, valid permutation of the SAME scope's cells.
    const expectedIds = cellsForScope('soft').map((c) => c.id).sort();
    expect([...reset.order].sort()).toEqual(expectedIds);
  });

  it('reshuffles even when the reset happens at index 0 already (guards a "nothing to reset" shortcut)', () => {
    const run = startMasteryRun(ids('pairs'), 10); // index 0, never advanced
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
    const original = startMasteryRun(ids(['soft', 'pairs']), 321);
    const advanced = advanceMasteryRun(original, true, 0);
    const rehydrated = hydrateMasteryRun({ seed: advanced.seed, index: advanced.index, order: advanced.order });
    expect(rehydrated).toEqual(advanced);
  });

  it('a pre-#13 blob ({scope, seed, index}) resumes on the order the old build dealt', () => {
    const legacy = fisherYatesShuffle(ids('all'), mulberry32(12345));
    const run = hydrateMasteryRun({ scope: 'all', seed: 12345, index: 110 });
    expect(run).toEqual({ seed: 12345, order: legacy, index: 110 });
    // The e2e specs pin pair-4-v-4 here.
    expect(run!.order[110]).toBe('pair-4-v-4');
  });

  it('falls back to a fresh run if the persisted index is out of range (corrupt/stale data)', () => {
    const bad = hydrateMasteryRun({ scope: 'pairs', seed: 1, index: 99999 });
    expect(bad).not.toBeNull();
    expect(bad!.index).toBe(0);
    const badOrder = hydrateMasteryRun({ seed: 1, index: 99999, order: ids('soft') });
    expect(badOrder!.index).toBe(0);
  });

  it('rejects an order with unknown or repeated cells rather than dealing them', () => {
    expect(hydrateMasteryRun({ seed: 1, index: 0, order: ['hard-16-v-10', 'nonsense'] })).toBeNull();
    expect(hydrateMasteryRun({ seed: 1, index: 0, order: ['hard-16-v-10', 'hard-16-v-10'] })).toBeNull();
  });
});

describe('#13: the run universe follows a multi-select scope', () => {
  it('Hard + Pairs walks exactly the 250 hard and pair cells', () => {
    const run = startMasteryRun(ids(['hard', 'pairs']), 4);
    expect(run.order).toHaveLength(250);
    expect(run.order.some((id) => id.startsWith('soft-'))).toBe(false);
    expect(runCoversExactly(run, ids(['pairs', 'hard']))).toBe(true);
  });

  it('runCoversExactly tells a saved run from a different scope', () => {
    const run = startMasteryRun(ids('pairs'), 4);
    expect(runCoversExactly(run, ids('pairs'))).toBe(true);
    expect(runCoversExactly(run, ids('soft'))).toBe(false);
    expect(runCoversExactly(run, ids(['pairs', 'soft']))).toBe(false);
  });

  it('a reset reshuffles the same universe', () => {
    const run = startMasteryRun(ids(['soft', 'pairs']), 4);
    const reset = advanceMasteryRun(run, false, 5);
    expect(runCoversExactly(reset, run.order)).toBe(true);
    expect(reset.order).not.toEqual(run.order);
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
    const run = startMasteryRun(ids('hard'), 31337);
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

describe('#29: the sweep is a seeded weighted shuffle by the flashcard SR weight', () => {
  const letters = Array.from({ length: 40 }, (_, i) => `c${i}`);

  it('every item exactly once, for any weights and seed', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const out = weightedShuffle(letters, (x) => (Number(x.slice(1)) % 7) + 0.1, mulberry32(seed));
      expect(out).toHaveLength(letters.length);
      expect([...out].sort()).toEqual([...letters].sort());
    }
  });

  it('a zero, negative or NaN weight still deals the item, last', () => {
    const out = weightedShuffle(['a', 'b', 'c', 'd'], (x) => ({ a: 0, b: -1, c: NaN, d: 1 })[x]!, mulberry32(3));
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(out[0]).toBe('d');
  });

  it('is pure: the same seed and weights give the same order', () => {
    const w = (x: string) => x.length;
    expect(weightedShuffle(letters, w, mulberry32(9))).toEqual(weightedShuffle(letters, w, mulberry32(9)));
  });

  it('twice the weight comes first about two times in three', () => {
    let aFirst = 0;
    const N = 4000;
    for (let seed = 1; seed <= N; seed++) {
      if (weightedShuffle(['a', 'b'], (x) => (x === 'a' ? 2 : 1), mulberry32(seed))[0] === 'a') aFirst++;
    }
    expect(aFirst / N).toBeGreaterThan(0.63);
    expect(aFirst / N).toBeLessThan(0.70);
  });

  it('missed and overdue cells come early in a sweep; cells reviewed today come late', () => {
    const DAY = 86_400_000;
    const now = 100 * DAY;
    const pairs = ids('pairs');
    // Everything answered right yesterday, so not due: weight 0.25...
    let deck: SrDeck = {};
    for (const id of pairs) deck[id] = reviewCard(undefined, true, now - 1000);
    // ...except one cell just missed and one a fortnight overdue.
    deck = { ...deck, 'pair-8-v-A': reviewCard(deck['pair-8-v-A'], false, now - 1000) };
    deck = { ...deck, 'pair-2-v-7': { ...deck['pair-2-v-7']!, dueAt: now - 14 * DAY } };
    const weightOf = srCellWeight(deck, now);

    let missed = 0;
    let overdue = 0;
    let ordinary = 0;
    const N = 300;
    for (let seed = 1; seed <= N; seed++) {
      const run = startMasteryRun(pairs, seed, weightOf);
      expect([...run.order].sort()).toEqual([...pairs].sort()); // still exactly once
      missed += run.order.indexOf('pair-8-v-A');
      overdue += run.order.indexOf('pair-2-v-7');
      ordinary += run.order.indexOf('pair-5-v-5');
    }
    // A uniform shuffle puts every cell at 49.5 on average.
    expect(missed / N).toBeLessThan(15);
    expect(overdue / N).toBeLessThan(15);
    expect(ordinary / N).toBeGreaterThan(40);
  });

  it('a reset reshuffles by the weights it is given', () => {
    const pairs = ids('pairs');
    const heavy = (id: string) => (id === 'pair-A-v-A' ? 1000 : 1);
    let first = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const reset = advanceMasteryRun(startMasteryRun(pairs, seed), false, seed + 1, heavy);
      if (reset.order[0] === 'pair-A-v-A') first++;
      expect(reset.index).toBe(0);
    }
    expect(first).toBeGreaterThan(80);
  });
});

describe('Wave A F16: the missed cell comes back early in the next sweep', () => {
  it('puts the just-missed cell at MASTERY_MISS_RETRY_AT for every seed', () => {
    for (let seed = 1; seed < 60; seed++) {
      let run = startMasteryRun(ids('all'), seed);
      for (let k = 0; k < seed % 40; k++) run = advanceMasteryRun(run, true, 0);
      const missed = run.order[run.index]!;
      const reset = advanceMasteryRun(run, false, seed * 7 + 3);
      expect(reset.order.indexOf(missed)).toBe(MASTERY_MISS_RETRY_AT);
      expect([...reset.order].sort()).toEqual([...run.order].sort());
    }
  });
  it('placeMissedEarly copes with a short run and an unknown cell', () => {
    expect(placeMissedEarly(['a', 'b'], 'b')).toEqual(['a', 'b']);
    expect(placeMissedEarly(['a', 'b', 'c', 'd'], 'a')).toEqual(['b', 'c', 'a', 'd']);
    expect(placeMissedEarly(['a', 'b'], 'z')).toEqual(['a', 'b']);
  });
});

describe('Wave A review: a miss in a resumed sweep restarts over the Hands picked now', () => {
  it('reshuffles over `restartOver`, with the missed cell early when it is still in scope', () => {
    const all = ids('all');
    const pairs = all.filter((id) => id.startsWith('pair-'));
    expect(pairs.length).toBeGreaterThan(0);
    // A resumed sweep over every cell, a few in, its current cell a pair.
    let run = startMasteryRun(all, 11);
    while (!run.order[run.index]!.startsWith('pair-')) run = advanceMasteryRun(run, true, 0);
    const missed = run.order[run.index]!;
    const reset = advanceMasteryRun(run, false, 99, undefined, pairs);
    expect([...reset.order].sort()).toEqual([...pairs].sort());
    expect(reset.index).toBe(0);
    expect(reset.order.indexOf(missed)).toBe(MASTERY_MISS_RETRY_AT);
    // Out of the new scope: a plain fresh sweep over it.
    const hard = all.filter((id) => id.startsWith('hard-'));
    expect([...advanceMasteryRun(run, false, 99, undefined, hard).order].sort()).toEqual([...hard].sort());
    // Not given: the sweep's own cells, as before.
    expect([...advanceMasteryRun(run, false, 99).order].sort()).toEqual([...all].sort());
  });
});
