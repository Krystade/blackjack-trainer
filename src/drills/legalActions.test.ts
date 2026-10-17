import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../engine/cards';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { StrategyRules } from '../engine/ruleset';
import { correctPlay } from '../engine/strategy';
import { drillLegalActions } from './legalActions';

const c = (rank: Card['rank'], suit: Card['suit'] = 's'): Card => ({ rank, suit });

const NO_SURRENDER = { ...DEFAULT_RULES, ls: false };

describe('drillLegalActions', () => {
  it('always offers hit and stand', () => {
    const legal = drillLegalActions([c('10'), c('6')], DEFAULT_RULES, '10');
    expect(legal).toContain('hit');
    expect(legal).toContain('stand');
  });

  it('offers double on any two-card hand', () => {
    // Every drill hand is by construction a fresh two-card hand, which is
    // exactly when doubling is available -- so double is never greyed here.
    const legal = drillLegalActions([c('10'), c('6')], DEFAULT_RULES, '10');
    expect(legal).toContain('double');
  });

  it('withholds split from a non-pair hand', () => {
    // The operator's motivating example: Split must be visibly unavailable
    // unless the hand is actually a pair.
    const legal = drillLegalActions([c('10'), c('6')], DEFAULT_RULES, '10');
    expect(legal).not.toContain('split');
  });

  it('offers split on a rank pair', () => {
    const legal = drillLegalActions([c('8', 's'), c('8', 'h')], DEFAULT_RULES, '10');
    expect(legal).toContain('split');
  });

  it('offers split on a mixed ten-value pair', () => {
    // K,Q is a splittable pair at the table (both count ten), and the PAIRS
    // chart row is keyed on ten-value, so the drill must agree.
    const legal = drillLegalActions([c('K', 's'), c('Q', 'h')], DEFAULT_RULES, '10');
    expect(legal).toContain('split');
  });

  it('offers surrender when the ruleset allows late surrender', () => {
    const legal = drillLegalActions([c('10'), c('6')], DEFAULT_RULES, '10');
    expect(legal).toContain('surrender');
  });

  it('withholds surrender when the ruleset has no late surrender', () => {
    // getChart() already strips Rh/Rs to their fallbacks when ls is off, so an
    // offered Surrender button could never be the graded-correct answer.
    const legal = drillLegalActions([c('10'), c('6')], NO_SURRENDER, '10');
    expect(legal).not.toContain('surrender');
  });

  it('never withholds an action that is the graded-correct answer', () => {
    // The property that actually matters: greying out a button must never make
    // the right play unreachable. 8,8 v A at six-deck H17 is the classic trap
    // -- the chart surrenders it, so surrender must stay enabled.
    const legal = drillLegalActions([c('8', 's'), c('8', 'h')], DEFAULT_RULES, 'A');
    expect(legal).toEqual(expect.arrayContaining(['hit', 'stand', 'double', 'split', 'surrender']));
  });
});

describe('#11: surrender on soft hands and pairs', () => {
  const RANKS_UP: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
  const PAIR_RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J'];
  const SOFT_OTHERS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9'];
  const RULESETS: StrategyRules[] = [];
  for (const decks of [1, 2, 6, 8] as const)
    for (const s17 of [false, true])
      for (const das of [false, true])
        for (const ls of [false, true])
          for (const surrenderIndices of [false, true])
            RULESETS.push({ ...DEFAULT_RULES, decks, s17, das, ls, surrenderIndices });

  it('A,2 v 2 has no surrender at a table that offers it', () => {
    expect(drillLegalActions([c('A'), c('2')], DEFAULT_RULES, '2')).not.toContain('surrender');
  });

  it('a soft hand never surrenders, whatever the dealer shows', () => {
    for (const other of SOFT_OTHERS)
      for (const up of RANKS_UP)
        expect(drillLegalActions([c('A'), c(other)], DEFAULT_RULES, up), `A,${other} v ${up}`).not.toContain(
          'surrender',
        );
  });

  it('hard hands keep surrender whenever the table offers it', () => {
    expect(drillLegalActions([c('9'), c('7')], DEFAULT_RULES, '2')).toContain('surrender');
    expect(drillLegalActions([c('10'), c('2')], DEFAULT_RULES, 'A')).toContain('surrender');
  });

  it('pairs surrender exactly on the chart cells that say so, per ruleset', () => {
    const offered = (rules: StrategyRules) => {
      const out: string[] = [];
      for (const rank of PAIR_RANKS.filter((r) => r !== 'J'))
        for (const up of RANKS_UP)
          if (drillLegalActions([c(rank, 's'), c(rank, 'h')], rules, up).includes('surrender'))
            out.push(`${rank},${rank} v ${up}`);
      return out;
    };
    const at = (decks: 1 | 2 | 6, s17: boolean, das = true, surrenderIndices = false) =>
      offered({ ...DEFAULT_RULES, decks, s17, das, surrenderIndices });
    // Surrender indices off (the default): only the chart's own cells.
    expect(at(1, false)).toEqual(['7,7 v 10', '7,7 v A']);
    expect(at(1, true)).toEqual(['7,7 v 10']);
    expect(at(2, false, false)).toEqual(['8,8 v A']);
    expect(at(2, false, true)).toEqual([]);
    expect(at(6, false)).toEqual(['8,8 v A']);
    expect(at(6, true)).toEqual([]);
    // F18: with surrender indices on, 7,7 v 10 is a 14 v 10 wherever the pair
    // cell does not split, so the Fab 4's 14 v 10 surrender can be the answer.
    expect(at(2, false, false, true)).toEqual(['7,7 v 10', '8,8 v A']);
    expect(at(2, false, true, true)).toEqual(['7,7 v 10']);
    expect(at(6, false, true, true)).toEqual(['7,7 v 10', '8,8 v A']);
    expect(at(6, true, true, true)).toEqual(['7,7 v 10']);
    expect(offered({ ...DEFAULT_RULES, ls: false })).toEqual([]);
    expect(offered({ ...DEFAULT_RULES, ls: false, surrenderIndices: true })).toEqual([]);
  });

  it('a plain RuleSet (no surrender-indices switch) never offers an index surrender on a pair', () => {
    // Flashcards and Mastery grade with the bare profile rules, where surrender
    // indices are undefined and therefore off: 7,7 v 10 cannot be a surrender.
    expect(drillLegalActions([c('7', 's'), c('7', 'h')], DEFAULT_RULES, '10')).not.toContain('surrender');
    expect(drillLegalActions([c('7', 's'), c('7', 'h')], { ...DEFAULT_RULES, surrenderIndices: true } as StrategyRules, '10')).toContain(
      'surrender',
    );
  });

  /**
   * The invariant from the top of legalActions.ts, checked over every pair and
   * soft hand, every ruleset (surrender indices on and off) and a wide band of
   * counts: withholding surrender must never hide the graded-correct answer.
   */
  it('never withholds surrender where correctPlay would return it', () => {
    // canSurrender follows the table's late-surrender rule, as at the table.
    const hands: Card[][] = [
      ...PAIR_RANKS.map((r) => [c(r, 's'), c(r === 'J' ? 'Q' : r, 'h')]),
      ...SOFT_OTHERS.map((r) => [c('A'), c(r)]),
    ];
    let withheld = 0;
    for (const rules of RULESETS)
      for (const cards of hands)
        for (const up of RANKS_UP) {
          const legal = drillLegalActions(cards, rules, up);
          if (legal.includes('surrender')) continue;
          withheld++;
          for (let tc = -10; tc <= 10; tc++) {
            const ctx = { canDouble: true, canSplit: true, canSurrender: rules.ls };
            const play = correctPlay(cards, up, tc, ctx, rules).action;
            expect(play, `${cards.map((x) => x.rank)} v ${up} tc ${tc}`).not.toBe('surrender');
          }
        }
    // Vacuity guard: the loop really did look at withheld hands.
    expect(withheld).toBeGreaterThan(1000);
  });
});

describe('#27 drillLegalActions under a fallback ctx', () => {
  it('a three-card hand offers only hit and stand; a no-surrender pair keeps split', () => {
    const three = [
      { rank: '2', suit: 's' },
      { rank: '4', suit: 'h' },
      { rank: '5', suit: 'd' },
    ] as const;
    expect(
      drillLegalActions([...three], DEFAULT_RULES, '5', { canDouble: false, canSplit: false, canSurrender: false }),
    ).toEqual(['hit', 'stand']);
    const eights = [
      { rank: '8', suit: 's' },
      { rank: '8', suit: 'h' },
    ] as const;
    const noSur = drillLegalActions([...eights], DEFAULT_RULES, 'A', { canDouble: true, canSplit: true, canSurrender: false });
    expect(noSur).toContain('split');
    expect(noSur).not.toContain('surrender');
  });
});
