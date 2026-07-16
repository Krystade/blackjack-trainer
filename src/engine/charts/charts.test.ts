import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../cards';
import { DEFAULT_RULES } from '../ruleset';
import type { RuleSet } from '../ruleset';
import { getChart } from './index';
import { HARD, SOFT, PAIRS } from './d68_h17';
import { chartLookup } from '../basicStrategy';
import { correctPlay, basicPlay } from '../strategy';
import type { PlayContext } from '../strategy';

function cards(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

describe('getChart', () => {
  it('getChart(DEFAULT_RULES) deep-equals the v1 d68_h17 tables', () => {
    const chart = getChart(DEFAULT_RULES);
    expect(chart.HARD).toEqual(HARD);
    expect(chart.SOFT).toEqual(SOFT);
    expect(chart.PAIRS).toEqual(PAIRS);
  });

  it('throws a pinned message for an unregistered combo: d68 S17', () => {
    const rules: RuleSet = { ...DEFAULT_RULES, s17: true };
    expect(() => getChart(rules)).toThrow('No chart for d68 S17 yet');
  });

  it('throws a pinned message for an unregistered combo: d2 H17', () => {
    const rules: RuleSet = { ...DEFAULT_RULES, decks: 2 };
    expect(() => getChart(rules)).toThrow('No chart for d2 H17 yet');
  });

  it('throws a pinned message for an unregistered combo: d1 S17', () => {
    const rules: RuleSet = { ...DEFAULT_RULES, decks: 1, s17: true };
    expect(() => getChart(rules)).toThrow('No chart for d1 S17 yet');
  });
});

describe('chartLookup default-rules parity', () => {
  it('hard 16 vs 10 matches with and without an explicit rules arg', () => {
    const noArg = chartLookup(cards('9', '7'), '10');
    const withArg = chartLookup(cards('9', '7'), '10', DEFAULT_RULES);
    expect(noArg).toBe('Rh');
    expect(withArg).toBe(noArg);
  });

  it('pair 8s vs A matches with and without an explicit rules arg', () => {
    const noArg = chartLookup(cards('8', '8'), 'A');
    const withArg = chartLookup(cards('8', '8'), 'A', DEFAULT_RULES);
    expect(noArg).toBe('Rp');
    expect(withArg).toBe(noArg);
  });
});

describe('correctPlay/basicPlay default-rules parity', () => {
  const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };

  it('correctPlay: hard 16 vs 10 basic case matches with/without explicit rules', () => {
    const noArg = correctPlay(cards('9', '7'), '10', -5, ctx);
    const withArg = correctPlay(cards('9', '7'), '10', -5, ctx, DEFAULT_RULES);
    expect(withArg).toEqual(noArg);
  });

  it('correctPlay: 16v10 deviation (tc>=0) still fires identically with default rules threaded', () => {
    // canSurrender:false so the basic Rh fallback (surrender-unavailable ->
    // hit) doesn't short-circuit before the deviation check.
    const noSurrenderCtx: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };
    const noArg = correctPlay(cards('9', '7'), '10', 1, noSurrenderCtx);
    const withArg = correctPlay(cards('9', '7'), '10', 1, noSurrenderCtx, DEFAULT_RULES);
    expect(noArg.source).toBe('illustrious18');
    expect(noArg.deviationId).toBe('16v10');
    expect(withArg).toEqual(noArg);
  });

  it('basicPlay: soft 18 vs 9 matches with/without explicit rules', () => {
    const noArg = basicPlay(cards('A', '7'), '9', ctx);
    const withArg = basicPlay(cards('A', '7'), '9', ctx, DEFAULT_RULES);
    expect(withArg).toEqual(noArg);
  });
});
