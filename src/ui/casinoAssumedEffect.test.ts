import { describe, it, expect } from 'vitest';
import { roundReturn } from '../engine/variants/ev';
import type { VariantRules } from '../engine/variants/rules';
import { blankGame, type CasinoGame } from '../store/casinoLog';
import { simInputFor } from '../store/casinoGameStats';
import { makeDefaultProfile } from '../store/profiles';
import { ASSUMED_EFFECT_PCT, MATERIAL_ASSUMED_PCT, assumedEffect, assumedRules, materialAssumedRules } from './casinoStatsText';

/**
 * Merge of Wave L and Wave M: a ranking row flags only the assumed rules that
 * can move the house edge by 0.05% of action or more; the stats card lists
 * them all. The cost of each assumption is the app's infinite-deck engine's,
 * recomputed here, so the table cannot drift from what it claims.
 */

// Standard blackjack in the variant engine: every variant feature off. H17, DAS, 3:2, split to 4, no RSA.
const STANDARD: VariantRules = {
  preset: 'freebet',
  variant: 'freebet',
  decks: 6,
  s17: false,
  spanishDeck: false,
  dealer22Push: false,
  bjPays: 1.5,
  playerBjBeatsDealerBj: false,
  ls: false,
  das: true,
  maxHands: 4,
  rsa: false,
  splitAcesDraw: false,
  doubleAnyCards: false,
  maxDoubles: 1,
  rescue: false,
  player21Wins: false,
  cardBonuses: false,
  freeDoubles: false,
  freeSplits: false,
};

/** House edge in % of action. */
const edge = (over: Partial<VariantRules> = {}) => -roundReturn({ ...STANDARD, ...over }) * 100;
/** What the conservative choice `worse` costs against `better`, % of action. */
const cost = (worse: Partial<VariantRules>, better: Partial<VariantRules> = {}) => edge(worse) - edge(better);

describe('the cost of each assumed rule', () => {
  it('matches the engine, and every rule lands on the same side of the 0.05% line', () => {
    const measured = {
      s17: cost({}, { s17: true }),
      das: cost({ das: false }),
      surrender: cost({}, { ls: true }),
      payout: cost({ bjPays: 1.2 }),
      rsa: cost({}, { rsa: true }),
      doubleSplitAces: cost({}, { doubleSplitAces: true }),
      maxSplitHands: cost({ maxHands: 2 }),
      doubleOn: cost({ doubleOn: '10-11' }),
    } as const;
    for (const [field, pct] of Object.entries(measured) as [keyof typeof measured, number][]) {
      expect(Math.abs(ASSUMED_EFFECT_PCT[field] - pct), field).toBeLessThan(0.01);
      expect(ASSUMED_EFFECT_PCT[field] >= MATERIAL_ASSUMED_PCT, field).toBe(pct >= MATERIAL_ASSUMED_PCT);
    }
    // The one the owner's notes leave out most: not ~0.02%, but over the line.
    expect(measured.doubleSplitAces).toBeGreaterThan(0.07);
    // Checks on the engine against the Wizard of Odds' published figures: hitting split aces 0.19%, double 9-11 0.09%.
    expect(cost({}, { splitAcesDraw: true })).toBeCloseTo(0.19, 1);
    expect(cost({ doubleOn: '9-11' })).toBeCloseTo(0.09, 1);
  });

  it('a rule the logged ones make moot costs nothing, in the engine and in the table', () => {
    expect(Math.abs(cost({ das: false }, { das: false, doubleSplitAces: true }))).toBeLessThan(1e-9);
    expect(Math.abs(cost({ doubleOn: '10-11' }, { doubleOn: '10-11', doubleSplitAces: true }))).toBeLessThan(1e-9);
    expect(Math.abs(cost({ doubleOn: '9-11' }, { doubleOn: '9-11', doubleSplitAces: true }))).toBeLessThan(1e-9);
    expect(Math.abs(cost({ maxHands: 2 }, { maxHands: 2, rsa: true }))).toBeLessThan(1e-9);
    expect(assumedEffect('doubleSplitAces', { das: false })).toBe(0);
    expect(assumedEffect('doubleSplitAces', { das: true, doubleOn: '10-11' })).toBe(0);
    expect(assumedEffect('doubleSplitAces', { das: true, doubleOn: '9-11' })).toBe(0);
    expect(assumedEffect('doubleSplitAces', { das: true, doubleOn: 'any2' })).toBe(ASSUMED_EFFECT_PCT.doubleSplitAces);
    // Unknown DAS or double-on: the real game may allow it, so it still counts.
    expect(assumedEffect('doubleSplitAces', { das: null, doubleOn: null })).toBe(ASSUMED_EFFECT_PCT.doubleSplitAces);
    expect(assumedEffect('rsa', { maxSplitHands: 2 })).toBe(0);
    expect(assumedEffect('rsa', { maxSplitHands: 3 })).toBe(ASSUMED_EFFECT_PCT.rsa);
  });
});

describe('which assumed rules a ranking row flags', () => {
  const profile = makeDefaultProfile();
  // Every rule logged but doubling split aces (the import's Yaamava / Morongo / Soboba games).
  const logged = (over: Partial<CasinoGame> = {}): CasinoGame => ({
    ...blankGame('g'),
    decks: 6,
    s17: false,
    das: true,
    surrender: true,
    payout: '3:2',
    cutDecksLeft: 1,
    minBet: 25,
    rsa: false,
    maxSplitHands: 4,
    doubleOn: 'any2',
    ...over,
  });
  const flagged = (g: CasinoGame, kind?: 'casino' | 'cardroom', threshold?: number) =>
    materialAssumedRules(simInputFor(g, profile, [], kind).assumed, g, threshold);
  const listed = (g: CasinoGame, kind?: 'casino' | 'cardroom') => assumedRules(simInputFor(g, profile, [], kind).assumed);

  it('doubling split aces alone is still flagged where it can happen', () => {
    expect(listed(logged())).toEqual(['doubleSplitAces']);
    expect(flagged(logged())).toEqual(['doubleSplitAces']);
  });

  it('a moot assumption is on the card but not the row', () => {
    for (const g of [logged({ das: false }), logged({ doubleOn: '10-11' }), logged({ doubleOn: '9-11' })]) {
      expect(listed(g)).toEqual(['doubleSplitAces']);
      expect(flagged(g)).toEqual([]);
    }
    const capped = logged({ rsa: null, maxSplitHands: 2, doubleSplitAces: false });
    expect(listed(capped)).toEqual(['rsa']);
    expect(flagged(capped)).toEqual([]);
    expect(flagged({ ...capped, maxSplitHands: 3 })).toEqual(['rsa']);
  });

  it('a game with nothing logged flags every rule; the threshold decides, not the list', () => {
    const blank = blankGame('b');
    const all = ['decks', 's17', 'das', 'surrender', 'rsa', 'payout', 'doubleSplitAces', 'maxSplitHands', 'doubleOn'];
    expect(flagged(blank)).toEqual(all);
    expect(flagged(blank, 'cardroom')).toEqual([...all, 'commission']);
    // At a 0.1% line the three smaller rules (0.06-0.08%) drop and the rest stay.
    expect(flagged(blank, undefined, 0.1)).toEqual(['decks', 's17', 'das', 'surrender', 'payout', 'doubleOn']);
  });
});
