import { describe, it, expect } from 'vitest';
import type { Card } from '../engine/cards';
import { DEFAULT_RULES } from '../engine/ruleset';
import { drillLegalActions } from './legalActions';

const c = (rank: Card['rank'], suit: Card['suit'] = 's'): Card => ({ rank, suit });

const NO_SURRENDER = { ...DEFAULT_RULES, ls: false };

describe('drillLegalActions', () => {
  it('always offers hit and stand', () => {
    const legal = drillLegalActions([c('10'), c('6')], DEFAULT_RULES);
    expect(legal).toContain('hit');
    expect(legal).toContain('stand');
  });

  it('offers double on any two-card hand', () => {
    // Every drill hand is by construction a fresh two-card hand, which is
    // exactly when doubling is available -- so double is never greyed here.
    const legal = drillLegalActions([c('10'), c('6')], DEFAULT_RULES);
    expect(legal).toContain('double');
  });

  it('withholds split from a non-pair hand', () => {
    // The operator's motivating example: Split must be visibly unavailable
    // unless the hand is actually a pair.
    const legal = drillLegalActions([c('10'), c('6')], DEFAULT_RULES);
    expect(legal).not.toContain('split');
  });

  it('offers split on a rank pair', () => {
    const legal = drillLegalActions([c('8', 's'), c('8', 'h')], DEFAULT_RULES);
    expect(legal).toContain('split');
  });

  it('offers split on a mixed ten-value pair', () => {
    // K,Q is a splittable pair at the table (both count ten), and the PAIRS
    // chart row is keyed on ten-value, so the drill must agree.
    const legal = drillLegalActions([c('K', 's'), c('Q', 'h')], DEFAULT_RULES);
    expect(legal).toContain('split');
  });

  it('offers surrender when the ruleset allows late surrender', () => {
    const legal = drillLegalActions([c('10'), c('6')], DEFAULT_RULES);
    expect(legal).toContain('surrender');
  });

  it('withholds surrender when the ruleset has no late surrender', () => {
    // getChart() already strips Rh/Rs to their fallbacks when ls is off, so an
    // offered Surrender button could never be the graded-correct answer.
    const legal = drillLegalActions([c('10'), c('6')], NO_SURRENDER);
    expect(legal).not.toContain('surrender');
  });

  it('never withholds an action that is the graded-correct answer', () => {
    // The property that actually matters: greying out a button must never make
    // the right play unreachable. 8,8 v 10 under late surrender is the classic
    // trap -- surrender is correct there and must stay enabled.
    const legal = drillLegalActions([c('8', 's'), c('8', 'h')], DEFAULT_RULES);
    expect(legal).toEqual(expect.arrayContaining(['hit', 'stand', 'double', 'split', 'surrender']));
  });
});
