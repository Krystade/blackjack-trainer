import { describe, it, expect } from 'vitest';
import { roundReturn } from '../engine/variants/ev';
import type { VariantRules } from '../engine/variants/rules';
import { blankGame, type CasinoGame } from '../store/casinoLog';
import { ASSUMED_DOUBLE_ON, ASSUMED_MAX_SPLIT_HANDS, simInputFor } from '../store/casinoGameStats';
import { makeDefaultProfile } from '../store/profiles';
import {
  ASSUMED_EFFECT_PCT,
  ASSUMED_TEXT,
  DOUBLE_ON_EFFECT_PCT,
  MATERIAL_ASSUMED_PCT,
  SPLIT_CAP_EFFECT_PCT,
  assumedDirectionText,
  assumedLead,
  assumedEffect,
  assumedLabel,
  assumedRules,
  materialAssumedRules,
} from './casinoStatsText';

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
/**
 * What `worse` costs against `better`, % of action. For a conservative
 * assumption `worse` is the assumed rule and `better` the best real one; for a
 * best-case one (Wave P: the split cap, double-on) `better` is the assumed rule
 * and `worse` the worst real one -- the EV the figure overstates.
 */
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
      // Best case assumed (split to 4, double any two): what a real cap of 2 / double 10-11 takes away.
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

  it('Wave P: the split cap and double-on are assumed at the best case, split to 4 and double any two', () => {
    expect(ASSUMED_MAX_SPLIT_HANDS).toBe(4);
    expect(ASSUMED_DOUBLE_ON).toBe('any2');
    const spec = simInputFor(blankGame('b'), makeDefaultProfile(), []).spec;
    // The simulator reads an absent field as 4 hands / any two (casinoSim.ts).
    expect(spec.maxSplitHands ?? 4).toBe(4);
    expect(spec.doubleOn ?? 'any2').toBe('any2');
    expect(ASSUMED_TEXT.maxSplitHands).toBe('split to 4 hands');
    expect(ASSUMED_TEXT.doubleOn).toBe('double on any two cards');
    expect(assumedLabel('doubleOn')).toBe('double on any two cards (best case)');
    expect(assumedLabel('das')).toBe('no double after split');
  });

  it('the card says which way the assumptions can be wrong, plainly (Wave T)', () => {
    expect(assumedDirectionText(['das'])).toBe('Not logged, so guessed at the worse choice: if the real rule is better, every figure here is too low.');
    expect(assumedDirectionText(['das', 'rsa'])).toBe('Not logged, so guessed at the worse choice: if any real rule is better, every figure here is too low.');
    expect(assumedDirectionText(['doubleOn'])).toBe('Not logged, so guessed as the best case: if the real rule is worse, every figure here is too high.');
    expect(assumedDirectionText(['maxSplitHands', 'doubleOn'])).toBe(
      'Not logged, so guessed as the best case: if either real rule is worse, every figure here is too high.',
    );
    expect(assumedDirectionText(['das', 'doubleOn'])).toBe(
      'Not logged, so guessed at the worse choice except where marked best case: a wrong best-case guess makes every figure here too high.',
    );
    // "Flatters" read clearly but was not the plain word; nothing says it now.
    for (const a of [['das'], ['doubleOn'], ['das', 'doubleOn']] as const) expect(assumedDirectionText(a)).not.toMatch(/flatter|conservative/);
    expect(assumedLead(['das', 'cut'])).toBe('not logged, so guessed at the worse choice');
    expect(assumedLead(['das', 'maxSplitHands'])).toBe('not logged, so guessed at the worse choice except where marked best case');
  });

  /*
   * Wave P: the best-case assumptions' cost moves with the logged rules. Each
   * figure is the engine's, over every combination of the rules it does not
   * depend on (S17, surrender, payout, double-on or the cap), and each lands
   * on the same side of the line as the table says.
   */
  it('the split cap and double-on cost what the engine says where DAS, RSA or DSA is logged', () => {
    const others: Partial<VariantRules>[] = [];
    for (const s17 of [false, true]) for (const ls of [false, true]) for (const bjPays of [1.5, 1.2]) others.push({ s17, ls, bjPays });
    const check = (table: number, ctx: Partial<VariantRules>, real: Partial<VariantRules>, label: string) => {
      for (const o of others) {
        const pct = cost({ ...o, ...ctx, ...real }, { ...o, ...ctx });
        expect(Math.abs(table - pct), `${label} ${JSON.stringify(o)}`).toBeLessThan(0.01);
        expect(table >= MATERIAL_ASSUMED_PCT, label).toBe(pct >= MATERIAL_ASSUMED_PCT);
      }
    };
    check(SPLIT_CAP_EFFECT_PCT.base, {}, { maxHands: 2 }, 'cap base');
    check(SPLIT_CAP_EFFECT_PCT.noDas, { das: false }, { maxHands: 2 }, 'cap no DAS');
    check(SPLIT_CAP_EFFECT_PCT.rsa, { rsa: true }, { maxHands: 2 }, 'cap RSA');
    check(SPLIT_CAP_EFFECT_PCT.rsaNoDas, { rsa: true, das: false }, { maxHands: 2 }, 'cap RSA no DAS');
    check(DOUBLE_ON_EFFECT_PCT.base, {}, { doubleOn: '10-11' }, 'double base');
    check(DOUBLE_ON_EFFECT_PCT.noDas, { das: false }, { doubleOn: '10-11' }, 'double no DAS');
    check(DOUBLE_ON_EFFECT_PCT.dsa, { doubleSplitAces: true }, { doubleOn: '10-11' }, 'double DSA');
    // Under the line where doubling after a split is barred: the cap costs ~0.04%.
    expect(SPLIT_CAP_EFFECT_PCT.noDas).toBeLessThan(MATERIAL_ASSUMED_PCT);
    expect(assumedEffect('maxSplitHands', { das: false, doubleOn: null, maxSplitHands: null })).toBe(SPLIT_CAP_EFFECT_PCT.noDas);
    expect(assumedEffect('maxSplitHands', { das: false, doubleOn: null, maxSplitHands: null, rsa: true })).toBe(SPLIT_CAP_EFFECT_PCT.rsaNoDas);
    expect(assumedEffect('maxSplitHands', { das: null, doubleOn: null, maxSplitHands: null, rsa: true })).toBe(SPLIT_CAP_EFFECT_PCT.rsa);
    expect(assumedEffect('maxSplitHands', { das: null, doubleOn: null, maxSplitHands: null })).toBe(ASSUMED_EFFECT_PCT.maxSplitHands);
    expect(assumedEffect('doubleOn', { das: false, doubleOn: null, maxSplitHands: null, doubleSplitAces: true })).toBe(DOUBLE_ON_EFFECT_PCT.noDas);
    expect(assumedEffect('doubleOn', { das: true, doubleOn: null, maxSplitHands: null, doubleSplitAces: true })).toBe(DOUBLE_ON_EFFECT_PCT.dsa);
    expect(assumedEffect('doubleOn', { das: null, doubleOn: null, maxSplitHands: null })).toBe(ASSUMED_EFFECT_PCT.doubleOn);
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

  it('Wave P: the best-case split cap and double-on are flagged, the cap only where it can cost 0.05%', () => {
    const open = logged({ maxSplitHands: null, doubleOn: null, doubleSplitAces: false });
    expect(listed(open)).toEqual(['maxSplitHands', 'doubleOn']);
    expect(flagged(open)).toEqual(['maxSplitHands', 'doubleOn']);
    // No double after a split: a cap of 2 loses only ~0.04%, so the row drops it; the card keeps it.
    expect(listed({ ...open, das: false })).toEqual(['maxSplitHands', 'doubleOn']);
    expect(flagged({ ...open, das: false })).toEqual(['doubleOn']);
    // ...unless aces may be resplit: a cap of 2 stops that too.
    expect(flagged({ ...open, das: false, rsa: true })).toEqual(['maxSplitHands', 'doubleOn']);
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
