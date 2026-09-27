import { describe, it, expect } from 'vitest';
import { makeRiggedShoe } from './riggedShoe';
import type { Card, Rank } from './cards';

const card = (rank: Rank): Card => ({ rank, suit: 's' });

/**
 * D1: `shuffle()` said the shoe was fresh and left it empty.
 *
 * The real `Shoe.shuffle` rebuilds all 312 cards. This one reset `dealt` and
 * nothing else, so afterwards `cardsDealt` was 0 and `cutCardReached` false
 * -- a fresh shoe by every reading -- over an empty queue, and the next draw
 * threw `Rigged shoe exhausted`. `game.ts` suppresses the pre-deal depth
 * guard for rigged shoes but leaves the cut card live, so the Downswing
 * drill can reach it.
 */
describe('a rigged shoe that has been shuffled', () => {
  it('is dealable again, and says so', () => {
    const shoe = makeRiggedShoe([card('2'), card('3'), card('4')], 0.5);
    shoe.draw();
    shoe.draw();
    shoe.draw();
    shoe.shuffle();
    expect(shoe.cardsRemaining, 'the shoe reported fresh and was empty').toBe(3);
    expect(() => shoe.draw()).not.toThrow();
    expect(shoe.cardsDealt).toBe(1);
  });

  it('deals the same script from the top', () => {
    const shoe = makeRiggedShoe([card('2'), card('3')], 0.5);
    expect(shoe.draw().rank).toBe('2');
    shoe.shuffle();
    expect(shoe.draw().rank).toBe('2');
  });

  it('measures the ruleset\u2019s shoe when it is told what it is', () => {
    // D2. Without `decks` it measures its own card list, which is right for
    // a unit stacking eight cards and wrong for a 6-deck drill.
    const script = Array.from({ length: 170 }, () => card('10'));
    expect(makeRiggedShoe(script, 0.75).decksRemaining).toBeLessThan(4);
    expect(makeRiggedShoe(script, 0.75, 6).decksRemaining).toBe(6);
  });

  it('defaults its penetration rather than going NaN', () => {
    // D4: `Math.floor(n * undefined)` is NaN, and `dealt >= NaN` is false
    // forever -- a cut card that can never be reached, in the module that
    // casts itself to `Shoe` through `as unknown`.
    const shoe = makeRiggedShoe([card('2'), card('3'), card('4'), card('5')]);
    expect(Number.isNaN(shoe.cardsDealt)).toBe(false);
    shoe.draw();
    shoe.draw();
    shoe.draw();
    expect(shoe.cutCardReached).toBe(true);
  });
});
