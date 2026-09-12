import { describe, it, expect } from 'vitest';
import { actionEvs, bestEv, evCostOf, standEv } from './handEv';
import { dealerOdds } from './dealerOdds';
import { basicPlay } from './strategy';
import { DEFAULT_RULES } from './ruleset';
import type { Card, Rank } from './cards';

const S17 = { ...DEFAULT_RULES, s17: true };
const H17 = DEFAULT_RULES;
const UPS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
const FULL = { canDouble: true, canSplit: true, canSurrender: true };
const NO_EXTRAS = { canDouble: false, canSplit: false, canSurrender: false };

function c(rank: Rank): Card {
  return { rank, suit: 's' };
}

describe('standEv', () => {
  it('wins every dealer bust and pushes an equal total', () => {
    // A hand-made distribution, so the arithmetic is checkable by eye: the
    // dealer busts half the time and makes exactly 20 the other half.
    const odds = { t17: 0, t18: 0, t19: 0, t20: 0.5, t21: 0, bust: 0.5, blackjack: 0 };
    expect(standEv(20, odds)).toBeCloseTo(0.5, 10); // win half, push half
    expect(standEv(21, odds)).toBeCloseTo(1, 10); // win everything
    expect(standEv(19, odds)).toBeCloseTo(0, 10); // win half, lose half
  });

  it('loses outright on a bust, whatever the dealer holds', () => {
    expect(standEv(22, dealerOdds('6', S17, { excludeBlackjack: true }))).toBe(-1);
  });
});

/**
 * Anchors from the published literature, kept few and chosen for being famous
 * enough that a misremembering would be obvious.
 *
 * 16 against a ten is the one every book uses to make the point that a close
 * decision is still a decision: standing and hitting differ by about six
 * ten-thousandths of a bet. If this engine reproduces that margin, it is doing
 * the same arithmetic the books are.
 */
describe('actionEvs against published values', () => {
  it('reproduces the 16-v-10 near-tie, hitting by a hair', () => {
    const evs = actionEvs([c('10'), c('6')], '10', NO_EXTRAS, S17);
    expect(evs.stand).toBeCloseTo(-0.5404, 3);
    expect(evs.hit).toBeCloseTo(-0.5398, 3);
    expect(evs.hit).toBeGreaterThan(evs.stand);
    // ...and the whole argument is worth less than a thousandth of a bet.
    expect(evs.hit - evs.stand).toBeLessThan(0.002);
  });

  it('prices doubling 11 against a five at about +0.61', () => {
    const evs = actionEvs([c('5'), c('6')], '5', FULL, S17);
    expect(evs.double).toBeCloseTo(0.6147, 2);
    expect(bestEv(evs).action).toBe('double');
  });

  it('keeps 12 v 4 a stand, by the famous whisker', () => {
    const evs = actionEvs([c('10'), c('2')], '4', NO_EXTRAS, S17);
    expect(evs.stand).toBeGreaterThan(evs.hit);
    expect(evs.stand - evs.hit).toBeLessThan(0.01);
  });

  /** The one pair the charts tell you NOT to split despite a made hand. */
  it('stands 9,9 against a seven rather than splitting', () => {
    const evs = actionEvs([c('9'), c('9')], '7', FULL, S17);
    expect(evs.split).toBeDefined();
    expect(evs.stand).toBeGreaterThan(evs.split!);
    expect(bestEv(evs).action).toBe('stand');
  });

  it('splits aces against a six, worth more than any other line', () => {
    const evs = actionEvs([c('A'), c('A')], '6', FULL, S17);
    expect(bestEv(evs).action).toBe('split');
  });
});

/**
 * The cross-validation that matters, and the reason this engine is worth having
 * at all: the app's basic-strategy chart is hand-entered, and this is computed
 * arithmetic. They share no code. Where they disagree, the disagreement must be
 * WORTH NOTHING -- a borderline cell where two lines differ by a rounding error.
 *
 * A real disagreement in either direction is a bug in one of them, and this test
 * cannot say which. That is fine: it says there is one, which nothing else in the
 * suite could.
 */
describe('the chart and the arithmetic agree', () => {
  const hands: { cards: Card[]; label: string }[] = [];
  // Hard totals, built from two cards that are not a pair.
  for (let total = 5; total <= 20; total++) {
    const first = Math.min(10, total - 2);
    const second = total - first;
    if (second < 2 || second > 10 || first === second) continue;
    hands.push({
      cards: [c(String(first) as Rank), c(String(second) as Rank)],
      label: `hard ${total}`,
    });
  }
  // Soft totals: an ace beside everything.
  for (let other = 2; other <= 9; other++) {
    hands.push({ cards: [c('A'), c(String(other) as Rank)], label: `soft ${11 + other}` });
  }
  // Pairs.
  for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'] as Rank[]) {
    hands.push({ cards: [c(rank), c(rank)], label: `${rank},${rank}` });
  }

  for (const rules of [S17, H17]) {
    const ruleLabel = rules.s17 ? 'S17' : 'H17';

    it(`only differs on cells worth under a hundredth of a bet (${ruleLabel})`, () => {
      // Structured, not formatted strings: a cost parsed back out of a message
      // would read `undefined` as NaN, and `NaN > 0.01` is false -- so a cell
      // whose cost could not be computed would pass this test silently.
      const disputes: { where: string; charted: string; computed: string; cost: number | null }[] = [];
      let compared = 0;

      for (const hand of hands) {
        for (const up of UPS) {
          // Surrender off: the chart's surrender cells are a separate decision
          // layer, and mixing them in would compare two different questions.
          const ctx = { canDouble: true, canSplit: true, canSurrender: false };
          const evs = actionEvs(hand.cards, up, ctx, rules);
          const computed = bestEv(evs).action;
          const charted = basicPlay(hand.cards, up, ctx, rules).action;
          compared += 1;
          if (computed === charted) continue;
          disputes.push({
            where: `${hand.label} v ${up}`,
            charted,
            computed,
            cost: evCostOf(evs, charted as 'hit'),
          });
        }
      }

      // Guards against a vacuous pass: this proves nothing if it never compared.
      expect(compared).toBeGreaterThan(300);

      const show = (d: (typeof disputes)[number]) =>
        `${d.where}: chart says ${d.charted}, EV says ${d.computed}, costing ` +
        (d.cost === null ? 'UNPRICED' : d.cost.toFixed(4));

      // A cell the chart names but the EV engine cannot price is its own failure:
      // the two disagree about what is even legal there.
      expect(
        disputes.filter((d) => d.cost === null).map(show),
        'the chart named a play the EV engine could not price',
      ).toEqual([]);

      // Everything else must be a coin-flip cell, and the list names itself.
      expect(
        disputes.filter((d) => (d.cost ?? 0) > 0.01).map(show),
        'chart and EV differ by a real margin',
      ).toEqual([]);
    });
  }
});

describe('evCostOf', () => {
  it('is zero for the best action and positive for anything else', () => {
    const evs = actionEvs([c('5'), c('6')], '5', FULL, S17);
    expect(evCostOf(evs, 'double')).toBe(0);
    expect(evCostOf(evs, 'stand')).toBeGreaterThan(0);
  });

  /**
   * The distinction the whole feature rests on: a wrong answer is not one size.
   * Standing on 16 v 10 is a mistake worth nearly nothing; hitting a hard 20 is
   * worth more than a third of a bet. Binary grading scores them identically.
   */
  it('separates a trivial mistake from an expensive one by two orders of magnitude', () => {
    const trivial = evCostOf(actionEvs([c('10'), c('6')], '10', NO_EXTRAS, S17), 'stand')!;
    const awful = evCostOf(actionEvs([c('10'), c('10')], '6', NO_EXTRAS, S17), 'hit')!;
    expect(trivial).toBeLessThan(0.01);
    expect(awful).toBeGreaterThan(0.5);
    expect(awful / trivial).toBeGreaterThan(100);
  });

  /** "You cannot do that" is not a quantity, and must not be reported as one. */
  it('returns null for an action that is not available', () => {
    const evs = actionEvs([c('10'), c('6')], '10', NO_EXTRAS, S17);
    expect(evCostOf(evs, 'double')).toBeNull();
    expect(evCostOf(evs, 'split')).toBeNull();
    expect(evCostOf(evs, 'surrender')).toBeNull();
  });

  it('never reports a negative cost, even at the floating-point edges', () => {
    for (const up of UPS) {
      for (let total = 5; total <= 20; total++) {
        const first = Math.min(10, total - 2);
        const second = total - first;
        if (second < 2 || second > 10) continue;
        const evs = actionEvs([c(String(first) as Rank), c(String(second) as Rank)], up, FULL, S17);
        for (const action of ['hit', 'stand', 'double'] as const) {
          const cost = evCostOf(evs, action);
          if (cost !== null) expect(cost, `${total} v ${up} ${action}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('surrender', () => {
  it('is always exactly half a bet, and taken only when everything else is worse', () => {
    const bad = actionEvs([c('10'), c('6')], '10', { ...NO_EXTRAS, canSurrender: true }, S17);
    expect(bad.surrender).toBe(-0.5);
    expect(bestEv(bad).action).toBe('surrender');

    const fine = actionEvs([c('10'), c('10')], '6', { ...NO_EXTRAS, canSurrender: true }, S17);
    expect(bestEv(fine).action).toBe('stand');
  });
});

describe('rules actually move the numbers', () => {
  it('makes the player worse off when the dealer hits soft 17', () => {
    // H17 gives the dealer another card on their weakest made hand, so standing
    // on a good total is worth less.
    const s17 = actionEvs([c('10'), c('9')], 'A', NO_EXTRAS, S17).stand;
    const h17 = actionEvs([c('10'), c('9')], 'A', NO_EXTRAS, H17).stand;
    expect(h17).toBeLessThan(s17);
  });

  it('makes splitting worth more when doubling after a split is allowed', () => {
    const withDas = actionEvs([c('2'), c('2')], '5', FULL, { ...S17, das: true }).split!;
    const without = actionEvs([c('2'), c('2')], '5', FULL, { ...S17, das: false }).split!;
    expect(withDas).toBeGreaterThan(without);
  });
});
