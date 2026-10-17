import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { correctPlay, basicPlay } from './strategy';
import type { PlayContext } from './strategy';
import { indexSetFor, isIndexActive, BJA_H17_EXTRAS } from './deviations';
import { DEFAULT_RULES } from './ruleset';
import type { StrategyRules } from './ruleset';

const H17_ON: StrategyRules = { ...DEFAULT_RULES, bjaExtras: true };
const H17_OFF: StrategyRules = { ...DEFAULT_RULES };
const S17_ON: StrategyRules = { ...DEFAULT_RULES, s17: true, bjaExtras: true };
const ALL: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };
const SUR: PlayContext = { ...ALL, canSurrender: true };
const c = (rank: Rank, suit: Card['suit'] = 's'): Card => ({ rank, suit });
const HANDS: Record<string, Card[]> = {
  '16vA': [c('10'), c('6')], '15vA': [c('9'), c('6')], '8v6': [c('5'), c('3')],
  A8v4: [c('A'), c('8')], A8v5: [c('A'), c('8')], A8v6: [c('A'), c('8')],
  A6v2: [c('A'), c('6')], TTv4: [c('10'), c('K')],
};
// [up, deviation-side tc, deviation play, other-side tc, basic play there]
const CASES: Record<string, [Rank, number, string, number, string]> = {
  '16vA': ['A', 3, 'stand', 2, 'hit'],
  '15vA': ['A', 5, 'stand', 4, 'hit'],
  '8v6': ['6', 2, 'double', 1, 'hit'],
  A8v4: ['4', 3, 'double', 2, 'stand'],
  A8v5: ['5', 1, 'double', 0, 'stand'],
  A8v6: ['6', -1, 'stand', 0, 'double'],
  A6v2: ['2', 1, 'double', 0, 'hit'],
  TTv4: ['4', 6, 'split', 5, 'stand'],
};

describe('BJA H17 extras: threshold and direction, one by one', () => {
  for (const [id, [up, devTc, devPlay, otherTc, basic]] of Object.entries(CASES)) {
    it(`${id}: ${devPlay} at TC ${devTc}, ${basic} at TC ${otherTc}, only with the option on`, () => {
      const hand = HANDS[id]!;
      const at = correctPlay(hand, up, devTc, ALL, H17_ON);
      expect(at.action).toBe(devPlay);
      expect(at.deviationId).toBe(id);
      expect(correctPlay(hand, up, otherTc, ALL, H17_ON).action).toBe(basic);
      // Off: the deviation side plays basic.
      expect(correctPlay(hand, up, devTc, ALL, H17_OFF).action).toBe(basic);
      // S17: the extras do not exist.
      expect(correctPlay(hand, up, devTc, ALL, S17_ON).deviationId).toBeUndefined();
      // Two counts further past the index still deviates (direction, not a point).
      const further = devTc + (devTc > otherTc ? 2 : -2);
      expect(correctPlay(hand, up, further, ALL, H17_ON).action).toBe(devPlay);
    });
  }
});

describe('BJA H17 extras: the cells are what the PDF prints', () => {
  it('basic play on each cell matches the chart the index changes', () => {
    const printed: Record<string, string> = {
      '16vA': 'hit', '15vA': 'hit', '8v6': 'hit', A8v4: 'stand', A8v5: 'stand',
      A8v6: 'double', A6v2: 'hit', TTv4: 'stand',
    };
    for (const [id, play] of Object.entries(printed)) {
      expect(basicPlay(HANDS[id]!, CASES[id]![0], ALL, H17_ON).action, id).toBe(play);
    }
  });
});

describe('BJA H17 extras: gating', () => {
  it('appear only under H17 with the option on, after the Fab 4', () => {
    expect(indexSetFor(H17_OFF).some((d) => d.extra)).toBe(false);
    expect(indexSetFor(S17_ON).some((d) => d.extra)).toBe(false);
    const on = indexSetFor({ ...H17_ON, surrenderIndices: true });
    expect(on.filter((d) => d.extra).map((d) => d.id)).toEqual(BJA_H17_EXTRAS.map((d) => d.id));
    expect(on.findIndex((d) => d.extra)).toBeGreaterThan(on.findLastIndex((d) => d.kind === 'surrender'));
    expect(isIndexActive('A8v4', { s17: false, bjaExtras: true })).toBe(true);
    expect(isIndexActive('A8v4', { s17: true, bjaExtras: true })).toBe(false);
    expect(isIndexActive('A8v4', { s17: false })).toBe(false);
  });
  it('the default set is untouched', () => {
    expect(indexSetFor(DEFAULT_RULES)).toEqual(indexSetFor({ ...DEFAULT_RULES, bjaExtras: false }));
  });
});

describe('BJA H17 extras: surrender, double and split availability', () => {
  it('16 v A and 15 v A surrender first while surrender is offered', () => {
    expect(correctPlay(HANDS['16vA']!, 'A', 6, SUR, H17_ON).action).toBe('surrender');
    expect(correctPlay(HANDS['15vA']!, 'A', 6, SUR, H17_ON).action).toBe('surrender');
  });
  it('a double index falls back to the chart when doubling is not allowed', () => {
    const noDouble = { ...ALL, canDouble: false };
    expect(correctPlay(HANDS['8v6']!, '6', 5, noDouble, H17_ON).action).toBe('hit');
    expect(correctPlay([c('A'), c('2'), c('6')], '5', 3, noDouble, H17_ON).action).toBe('stand');
    expect(correctPlay(HANDS.A6v2!, '2', 3, noDouble, H17_ON).action).toBe('hit');
  });
  it('A,8 v 6 stands below zero even when doubling is allowed, and soft 19 of three cards counts', () => {
    expect(correctPlay([c('A'), c('4'), c('4')], '6', -2, ALL, H17_ON).action).toBe('stand');
  });
  it('10,10 v 4 stands when splitting is unavailable', () => {
    expect(correctPlay(HANDS.TTv4!, '4', 8, { ...ALL, canSplit: false }, H17_ON).action).toBe('stand');
  });
  it('TTv5 and TTv6 are unchanged by the generalised ten-pair lookup', () => {
    expect(correctPlay(HANDS.TTv4!, '5', 5, ALL, H17_OFF).deviationId).toBe('TTv5');
    expect(correctPlay(HANDS.TTv4!, '6', 4, ALL, H17_OFF).deviationId).toBe('TTv6');
    expect(correctPlay(HANDS.TTv4!, '4', 6, ALL, H17_OFF).action).toBe('stand');
  });
});
