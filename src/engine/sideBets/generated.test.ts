import { describe, expect, it } from 'vitest';
import { SIDE_BET_ROWS } from './generated';
import { PAY_TABLES, payTableOf } from './payTables';
import { candidateCounts, chooseCount, MIN_PER100, NEARLY_AS_GOOD } from './select';
import type { Candidate } from './select';
import { countDefOf, CUT_FOR_DECKS, sidePlan } from './plan';
import { buildSideRow, seedFor } from './build';
import { fullComp } from './comp';
import { sideBetEv } from './odds';

/**
 * Wave L: generated.ts is the generator's output, committed. These re-derive
 * what is cheap -- every exact edge, every effect of removal, every derived
 * tag set, every choice -- and re-simulate one row in full, so a change to
 * the engine that the committed table no longer reflects fails here.
 */

const r6 = (x: number) => Number(x.toPrecision(6));

describe('the generated side-bet table', () => {
  it('has a row for every preset at 1, 2, 6 and 8 decks (Buster at S17 and H17)', () => {
    for (const t of PAY_TABLES) {
      for (const decks of [1, 2, 6, 8]) {
        for (const s17 of t.bet === 'buster' ? [true, false] : [null]) {
          const row = SIDE_BET_ROWS.find((r) => r.bet === t.bet && r.payTable === t.id && r.decks === decks && r.s17 === s17);
          expect(row, `${t.id} ${decks} ${s17}`).toBeDefined();
          expect(row!.cutDecks).toBe(CUT_FOR_DECKS[decks]);
          expect(row!.seed).toBe(seedFor(`${t.bet}/${t.id}/${decks}/${s17 === null ? '-' : s17 ? 's17' : 'h17'}`));
        }
      }
    }
    expect(SIDE_BET_ROWS).toHaveLength(PAY_TABLES.reduce((n, t) => n + (t.bet === 'buster' ? 8 : 4), 0));
  });

  it('every exact edge, effect of removal and derived count is what the engine computes now', () => {
    for (const row of SIDE_BET_ROWS) {
      const t = payTableOf(row.bet, row.payTable)!;
      const s17 = row.s17 ?? true;
      expect(row.edge, `${row.payTable} ${row.decks}`).toBe(r6(-sideBetEv(row.bet, t.pays, fullComp(row.decks), { s17 })));
      const { counts, eor } = candidateCounts(row.bet, t.pays, row.decks, s17);
      expect(row.eor).toEqual(eor.map(r6));
      expect(row.candidates.map((c) => c.id)).toEqual(counts.map((c) => c.def.id));
      for (const [i, c] of counts.entries()) {
        const stored = row.candidates[i]!;
        expect(countDefOf(stored).kind).toBe(c.def.kind);
        if (c.def.kind === 'tags') expect([...(countDefOf(stored).tags ?? [])]).toEqual([...(c.def.tags ?? [])]);
        expect(stored.betBelow ?? false).toBe(c.betBelow ?? false);
      }
    }
  }, 120_000);

  it('the chosen count is the selection rule applied to the stored candidates', () => {
    for (const row of SIDE_BET_ROWS) {
      const cands = row.candidates.map((c) => ({ ...c, def: countDefOf(c), correlation: c.correlation }) as Candidate);
      const choice = chooseCount(-row.edge, cands);
      expect(choice.always, row.payTable).toBe(row.always);
      expect(choice.chosen?.def.id ?? null, `${row.payTable} ${row.decks}`).toBe(row.chosen);
      if (row.chosen) {
        const c = row.candidates.find((x) => x.id === row.chosen)!;
        const best = Math.max(...row.candidates.filter((x) => x.trigger !== null && x.per100 >= MIN_PER100).map((x) => x.per100));
        expect(c.per100).toBeGreaterThanOrEqual(NEARLY_AS_GOOD * best);
      }
    }
  });

  it('a positive edge off the top is "every hand"; a countable bet has a trigger', () => {
    for (const row of SIDE_BET_ROWS) {
      const plan = sidePlan(row.bet, row.payTable, row.decks, row.s17 ?? true)!;
      if (row.edge < 0) expect(plan.always).toBe(true);
      if (plan.count) expect(plan.trigger).not.toBeNull();
    }
  });

  it('re-simulating a row with its own seed reproduces it exactly', () => {
    const row = SIDE_BET_ROWS.find((r) => r.bet === 'over13' && r.decks === 1)!;
    const again = buildSideRow({ bet: row.bet, payTable: row.payTable, decks: 1, s17: null, cutDecks: row.cutDecks, rounds: row.rounds, seed: row.seed });
    expect(again).toEqual(row);
  }, 120_000);
});
