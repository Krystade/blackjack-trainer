import { describe, expect, it } from 'vitest';
import { fullComp } from './comp';
import { sideBetEv } from './odds';
import { PAY_TABLES, OUTCOMES, payTableOf } from './payTables';

/**
 * Every published house edge, against the app's own combinatorics. Where they
 * disagree beyond the source's rounding the test names the row: a
 * disagreement is recorded (in payTables.ts `note`), never averaged away.
 */
describe('side-bet house edges: computed vs published', () => {
  for (const t of PAY_TABLES) {
    for (const p of t.published) {
      it(`${t.bet} ${t.name}, ${p.decks} deck${p.decks > 1 ? 's' : ''}${p.s17 === undefined ? '' : p.s17 ? ' S17' : ' H17'}: ${(p.edge * 100).toFixed(2)}%`, () => {
        const edge = -sideBetEv(t.bet, t.pays, fullComp(p.decks), { s17: p.s17 });
        // The sources print two decimals of a percent (or six of a fraction).
        expect(Math.abs(edge - p.edge)).toBeLessThan(0.00006);
      });
    }
  }

  it('every pay table pays only outcomes its bet has', () => {
    for (const t of PAY_TABLES) {
      for (const k of Object.keys(t.pays)) expect(OUTCOMES[t.bet] as readonly string[]).toContain(k);
    }
  });

  it('ids are unique per bet', () => {
    const seen = new Set<string>();
    for (const t of PAY_TABLES) {
      const k = `${t.bet}/${t.id}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    expect(payTableOf('luckyLadies', 'll-a')?.name).toMatch(/1000/);
  });
});

describe('recorded disagreements still disagree', () => {
  for (const t of PAY_TABLES) {
    for (const p of t.disagree ?? []) {
      it(`${t.bet} ${t.name}, ${p.decks} decks: published ${(p.edge * 100).toFixed(2)}%`, () => {
        const edge = -sideBetEv(t.bet, t.pays, fullComp(p.decks), { s17: p.s17 });
        expect(Math.abs(edge - p.edge)).toBeGreaterThan(0.001);
      });
    }
  }
});
