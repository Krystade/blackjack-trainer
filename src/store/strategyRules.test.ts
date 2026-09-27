import { describe, it, expect } from 'vitest';
import { strategyRulesFor } from './profiles';
import { indexSetFor, isIndexActive } from '../engine/deviations';
import { correctPlay } from '../engine/strategy';
import type { Profile } from './types';
import type { Card } from '../engine/cards';

const c = (rank: Card['rank']): Card => ({ rank, suit: 's' });

/**
 * `Omit` first: intersecting `Partial<Profile>` with a looser `rules` leaves
 * `rules` as `RuleSet & Partial<RuleSet>`, which is `RuleSet` -- so every
 * caller would have to spell out all six rules to change one. (`tsc --noEmit`
 * misses this; `tsc -b`, which the deploy runs, does not.)
 */
function profile(
  patch: Omit<Partial<Profile>, 'rules'> & { rules?: Partial<Profile['rules']> },
): Profile {
  return {
    id: 'p',
    name: 'P',
    rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false, ...(patch.rules ?? {}) },
    penetration: 0.75,
    spread: [{ minTc: -99, units: 1 }],
    bankrollStart: 100,
    countCheckEvery: 0,
    betSpreadOn: false,
    ...patch,
  } as Profile;
}

describe('strategyRulesFor', () => {
  it('passes the opt-in through at a table that offers surrender', () => {
    expect(strategyRulesFor(profile({ surrenderIndices: true })).surrenderIndices).toBe(true);
    expect(strategyRulesFor(profile({ surrenderIndices: false })).surrenderIndices).toBe(false);
    // Absent means off, which is what every caller passing a bare
    // `profile.rules` already relies on.
    expect(strategyRulesFor(profile({})).surrenderIndices).toBe(false);
  });

  it('will not carry surrender indices onto a table with no surrender', () => {
    const rules = strategyRulesFor(profile({ surrenderIndices: true, rules: { ls: false } }));
    expect(rules.surrenderIndices).toBe(false);
    expect(
      indexSetFor(rules).filter((d) => d.kind === 'surrender'),
      'the Fab 4 were offered at a table that cannot surrender',
    ).toEqual([]);
  });

  it('keeps the quiz from offering an index it would then grade', () => {
    // The symptom the operator sees: "15 v 10: surrender at TC >= 0" in the
    // Index dropdown at a table with no surrender. Drawn, the quiz asks it
    // under QUIZ_CTX_SURRENDER -- surrender ON, because a Fab 4 item is
    // about surrender -- and grades the one play the table does not offer.
    const noLs = strategyRulesFor(profile({ surrenderIndices: true, rules: { ls: false } }));
    expect(isIndexActive('sur15v10', noLs)).toBe(false);
    expect(
      correctPlay(
        [c('10'), c('5')],
        '10',
        2,
        { canDouble: true, canSplit: true, canSurrender: true },
        noLs,
      ).reason,
      'the advice still came from the surrender index',
    ).not.toMatch(/TC/);

    const withLs = strategyRulesFor(profile({ surrenderIndices: true }));
    expect(isIndexActive('sur15v10', withLs), 'the feature stopped working').toBe(true);
  });

  it('leaves the stored flag alone, so the choice comes back with the rule', () => {
    const stored = profile({ surrenderIndices: true, rules: { ls: false } });
    expect(stored.surrenderIndices, 'the profile itself was rewritten').toBe(true);
    expect(
      strategyRulesFor({ ...stored, rules: { ...stored.rules, ls: true } }).surrenderIndices,
    ).toBe(true);
  });
});
