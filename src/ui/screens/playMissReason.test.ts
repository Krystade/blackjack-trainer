import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../../engine/cards';
import { DEFAULT_RULES } from '../../engine/ruleset';
import type { RuleSet } from '../../engine/ruleset';
import { dealerBustChance } from '../../engine/dealerOdds';
import { regionRuleFor } from './regionRule';
import { playMissReason, bustLine } from './playMissReason';

const H17: RuleSet = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };
const S17: RuleSet = { ...H17, s17: true };
const hand = (...ranks: Rank[]): Card[] => ranks.map((rank) => ({ rank, suit: 's' }));
const pct = (up: Rank, rules: RuleSet) => Math.round(dealerBustChance(up, rules, { excludeBlackjack: true }) * 100);

function basic(cards: Card[], up: Rank, rules: RuleSet = H17, canSplit?: boolean) {
  return playMissReason({
    reason: `Basic hit vs dealer ${up}`,
    classification: 'basic-error',
    cards,
    dealerUp: up,
    canSplit,
    rules,
  });
}

describe('E6: playMissReason', () => {
  it('a basic error on 10,6 v 7 reads the region rule, then the bust chance', () => {
    const got = basic(hand('10', '6'), '7');
    const rule = regionRuleFor('hard-16-v-7', H17)!.text;
    expect(got).toBe(`${rule} Dealer busts ${pct('7', H17)}% with a\u00a07\u00a0up.`);
    expect(got).not.toMatch(/Basic (hit|stand|double)/);
  });

  it('follows the ruleset: the S17 chart and S17 bust odds', () => {
    const got = basic(hand('10', '6'), '7', S17);
    expect(got).toBe(`${regionRuleFor('hard-16-v-7', S17)!.text} Dealer busts ${pct('7', S17)}% with a\u00a07\u00a0up.`);
  });

  it('index errors keep the engine label', () => {
    for (const classification of ['missed-deviation', 'phantom-deviation', 'wrong-anyway', 'correct', undefined] as const) {
      const got = playMissReason({
        reason: '16 v 10: stand at TC ≥ 0',
        classification,
        cards: hand('10', '6'),
        dealerUp: '10',
        canSplit: false,
        rules: H17,
      });
      expect(got).toBe('16 v 10: stand at TC ≥ 0');
    }
  });

  it('a pair is read as the engine read it: pair row when splittable, its total when not', () => {
    expect(basic(hand('8', '8'), '7', H17, true)).toBe(
      `${regionRuleFor('pair-8-v-7', H17)!.text} Dealer busts ${pct('7', H17)}% with a\u00a07\u00a0up.`,
    );
    expect(basic(hand('8', '8'), '7', H17, false)).toBe(
      `${regionRuleFor('hard-16-v-7', H17)!.text} Dealer busts ${pct('7', H17)}% with a\u00a07\u00a0up.`,
    );
  });

  it('a multi-card soft hand and a face-card up card land on the chart column', () => {
    expect(basic(hand('A', '2', '4'), 'K')).toBe(
      `${regionRuleFor('soft-17-v-10', H17)!.text} Dealer busts ${pct('10', H17)}% with a\u00a010\u00a0up.`,
    );
  });

  it('the bust chance is peek-conditioned (a ten or ace up has no natural behind it)', () => {
    const noPeek = Math.round(dealerBustChance('A', H17) * 100);
    expect(pct('A', H17)).not.toBe(noPeek);
    expect(bustLine('A', H17)).toBe(`Dealer busts ${pct('A', H17)}% with an\u00a0ace\u00a0up.`);
    expect(bustLine('8', DEFAULT_RULES)).toMatch(/with an\u00a08\u00a0up\.$/);
    expect(bustLine('6', DEFAULT_RULES)).toMatch(/with a\u00a06\u00a0up\.$/);
  });

  it('with no snapshot of the hand it keeps the engine label', () => {
    expect(
      playMissReason({ reason: 'Basic hit vs dealer 7', classification: 'basic-error', cards: undefined, dealerUp: '7', canSplit: false, rules: H17 }),
    ).toBe('Basic hit vs dealer 7');
  });

  it('a hand with no chart row (2,2 unsplittable = hard 4) still gets the bust line, never the engine string', () => {
    const got = basic(hand('2', '2'), '7', H17, false);
    expect(got).toBe(`Dealer busts ${pct('7', H17)}% with a\u00a07\u00a0up.`);
  });
});
