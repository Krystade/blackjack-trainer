import { describe, expect, it } from 'vitest';
import { PUBLISHED_COUNTS, HI_LO_COUNT, describeTags } from './counts';
import { bettingCorrelation, deriveTags, effectsOfRemoval, HI_LO_TAGS } from './eor';
import { payTableOf } from './payTables';
import { sideBetRow } from './plan';
import { SideSim, countedResult, findTrigger } from './sideSim';
import { DEFAULT_RULES } from '../ruleset';

/**
 * Wave L: the app's counts against the published ones (Eliot Jacobson,
 * Advanced Advantage Play -- URLs in counts.ts). Where the app's simulation
 * and the source agree, the test holds them together; where they differ,
 * the test records the difference and fails if it goes away, so either
 * side's fix is noticed. Nothing is averaged.
 */

const pub = (bet: keyof typeof PUBLISHED_COUNTS, id: string) => PUBLISHED_COUNTS[bet]!.find((c) => c.id === id)!;
const cand = (bet: Parameters<typeof sideBetRow>[0], table: string, decks: number, id: string, s17 = true) =>
  sideBetRow(bet, table, decks, s17)!.candidates.find((c) => c.id === id)!;

describe('derived counts against the published ones', () => {
  it('Lucky Ladies: the level-2 count derived from the effects correlates as well as Jacobson\'s Ten count', () => {
    const eor = effectsOfRemoval('luckyLadies', payTableOf('luckyLadies', 'll-b')!.pays, 2);
    const ten = bettingCorrelation(eor, pub('luckyLadies', 'jacobson-ten').tags!);
    const derived = deriveTags(eor, 2);
    expect(ten).toBeGreaterThan(0.98);
    expect(Math.abs(derived.correlation - ten)).toBeLessThan(0.005);
    // Tens are the heavy tag in both.
    expect(derived.tags.slice(9)).toEqual([-2, -2, -2, -2]);
  });

  it('Hi-Lo correlates worse than the bet\'s own count for every countable bet', () => {
    for (const [bet, table] of [
      ['luckyLadies', 'll-b'],
      ['buster', 'bu-evo'],
      ['over13', 'ou-even'],
    ] as const) {
      const eor = effectsOfRemoval(bet, payTableOf(bet, table)!.pays, 6);
      const own = PUBLISHED_COUNTS[bet]![0]!.tags!;
      expect(Math.abs(bettingCorrelation(eor, HI_LO_TAGS)), bet).toBeLessThan(Math.abs(bettingCorrelation(eor, own)));
    }
  });

  it('Perfect Pairs is not countable by any tag set: its effects of removal are all equal', () => {
    const eor = effectsOfRemoval('perfectPairs', payTableOf('perfectPairs', 'pp-a')!.pays, 6);
    for (const e of eor) expect(e).toBeCloseTo(eor[0]!, 12);
    expect(deriveTags(eor, 2).correlation).toBeLessThan(0.5);
  });

  it('describes a tag set by groups', () => {
    expect(describeTags(pub('luckyLadies', 'jacobson-ten').tags!)).toBe('+1: 2–9 · −2: 10–K');
    expect(describeTags(HI_LO_COUNT.tags!)).toBe('+1: 2–6 · −1: A,10–K');
  });
});

describe('simulated triggers against the published ones', () => {
  it('INFORMATIONAL (review N5): Jacobson\'s Buster tags on the app\'s Evolution table -- 2 decks +5, 6 decks +4', () => {
    // Jacobson's figures (2 decks +5, 16.83% of hands, 1.228 units per 100;
    // 6 decks +4, 13.29%, 0.702) are for HIS "1,3,6" pay table, not the
    // Evolution table simulated here (3, 4, 5+ cards pay 1, 2, 9), so they
    // are not compared: agreement across different pay tables would prove
    // nothing. These pin the app's own result only.
    expect(cand('buster', 'bu-evo', 2, 'jacobson-buster').trigger).toBe(5);
    expect(cand('buster', 'bu-evo', 6, 'jacobson-buster').trigger).toBe(4);
  });

  it('Over 13 with the crush count, 6 decks cut at 260 cards: +3, as published', () => {
    expect(cand('over13', 'ou-even', 6, 'jacobson-crush').trigger).toBe(3);
  });

  it('CONVENTION, not a disagreement (review N2): Under 13, 6 decks -- floored <= -6 is truncated <= -5', () => {
    // A floored "<= -6" bets TC < -5; a truncated "<= -5" bets TC <= -5: the
    // same bet. The exact EV crosses zero near TC -4.85. The app floors
    // (SIDE_TC_ROUNDING) and finds -6; binned by truncation, the same count
    // finds Jacobson's -5.
    expect(cand('under13', 'ou-even', 6, 'jacobson-crush').trigger).toBe(-6);
    const crush = pub('over13', 'jacobson-crush');
    const rules = { ...DEFAULT_RULES, decks: 6 as const };
    const under = new SideSim(
      { bet: 'under13', pays: payTableOf('under13', 'ou-even')!.pays, rules, cutDecks: 1, counts: [{ def: crush, betBelow: true }], rounding: 'truncate' },
      7,
    );
    under.run(600_000);
    expect(findTrigger(under.binsOf(0), true)).toBe(-5);
  }, 120_000);

  it('Over/Under 13 at the published triggers (+3 / -5): truncated, the bet frequency is Jacobson\'s; the edge when bet is still lower', () => {
    const crush = pub('over13', 'jacobson-crush');
    const rules = { ...DEFAULT_RULES, decks: 6 as const };
    const pays = payTableOf('over13', 'ou-even')!.pays;
    const over = new SideSim({ bet: 'over13', pays, rules, cutDecks: 1, counts: [{ def: crush }] }, 7);
    over.run(300_000);
    const under = new SideSim({ bet: 'under13', pays: payTableOf('under13', 'ou-even')!.pays, rules, cutDecks: 1, counts: [{ def: crush, betBelow: true }] }, 7);
    under.run(300_000);
    const o = countedResult(over.binsOf(0), over.rounds, 3);
    const u = countedResult(under.binsOf(0), under.rounds, -5, true);
    // Published: 19.724% of hands, 5.242% average edge, 1.034 units per 100.
    // The app, floored: 21.3% of hands, 0.895 units per 100 -- a floored -5
    // reaches one count higher than Jacobson's truncated -5.
    expect(o.freq + u.freq).toBeGreaterThan(0.205);
    const per100 = o.per100 + u.per100;
    expect(per100).toBeGreaterThan(0.8);
    expect(per100).toBeLessThan(0.95);
    // Truncated, as the source counts (review N2): the frequency is the
    // published one (the review measured 19.67%). About 9% of the units per
    // 100 stays unexplained (0.94 against 1.034). Recorded, not reconciled.
    const sim = (bet: 'over13' | 'under13', betBelow: boolean) => {
      const s = new SideSim({ bet, pays: payTableOf(bet, 'ou-even')!.pays, rules, cutDecks: 1, counts: [{ def: crush, betBelow }], rounding: 'truncate' }, 7);
      s.run(300_000);
      return s;
    };
    const ot = sim('over13', false);
    const ut = sim('under13', true);
    const to = countedResult(ot.binsOf(0), ot.rounds, 3);
    const tu = countedResult(ut.binsOf(0), ut.rounds, -5, true);
    expect(Math.abs(to.freq + tu.freq - 0.19724)).toBeLessThan(0.004);
    expect(to.per100 + tu.per100).toBeLessThan(1.034 * 0.97);
  }, 240_000);

  it('21+3 (Classic 9 to 1, 6 decks) with the suit spread: +8, as published', () => {
    expect(cand('twentyOnePlus3', '213-v1', 6, 'jacobson-suit').trigger).toBe(8);
  });

  it('DISAGREES: Lucky Ladies table B, 2 decks -- the app finds +9 where Jacobson publishes +8', () => {
    // Bet frequencies agree (published 7.159% at +8; the app bets 7.1% at +9),
    // which points at a different true-count convention (the app floors the
    // running count over decks left to the half deck); units per 100 differ
    // (published 1.175, app 1.00 at a half-deck cut).
    const c = cand('luckyLadies', 'll-b', 2, 'jacobson-ten');
    expect(c.trigger).toBe(9);
    expect(c.freq).toBeCloseTo(0.07159, 2);
    expect(c.per100).toBeLessThan(1.175);
  });
});
