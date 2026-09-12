import type { Card } from './cards';
import type { Shoe } from './cards';

/**
 * The pre-stacked shoe every rigged session runs on, and the seed offset that
 * keeps bot behaviour off the shoe's own random stream.
 *
 * Lifted out of game.ts, which had grown past 1100 lines. This is the part that
 * was never coupled to the `Game` class: it takes a card list and hands back
 * something Shoe-shaped. The class itself stays in one file on purpose -- its
 * methods all mutate shared round state through `this`, and splitting them
 * across modules would mean either widening `private` or threading a Game
 * handle everywhere, which trades readability for a line count.
 */

/** The extra surface a rigged shoe has beyond `Shoe`. */
export interface RiggedShoe {
  /**
   * Bin the next `n` cards WITHOUT dealing them: they leave the shoe unseen and
   * uncounted, exactly like a burn.
   *
   * V3-7 needs this. A rigged shoe is a script, and a script only survives while
   * every round costs the number of cards it was written to cost. The moment a
   * drill offers a real decision, a player can take a line the script did not
   * budget for -- and then every later round is that round's leftovers glued to
   * the next round's opening, which is noise rather than the designed hand. The
   * caller realigns to its next round boundary with this instead.
   */
  discard(n: number): void;
}

/**
 * A minimal Shoe-surface object that deals a pre-stacked list of cards in
 * order, for deterministic tests. Cast to Shoe at the boundary (test-only;
 * see Game.withRiggedShoe).
 */
export function makeRiggedShoe(cards: Card[], penetration: number): Shoe & RiggedShoe {
  const queue = [...cards];
  const cutCardPosition = Math.floor(cards.length * penetration);
  let dealt = 0;
  const rigged = {
    draw(): Card {
      if (queue.length === 0) throw new Error('Rigged shoe exhausted');
      dealt++;
      return queue.shift()!;
    },
    discard(n: number): void {
      // Counted as dealt, because they are gone from the shoe: `cardsDealt` is
      // the caller's own alignment yardstick, and a discard that did not move
      // it would leave the caller unable to reach the boundary it is aiming at.
      const take = Math.min(Math.max(0, Math.floor(n)), queue.length);
      queue.splice(0, take);
      dealt += take;
    },
    get cardsRemaining(): number {
      return queue.length;
    },
    get cardsDealt(): number {
      return dealt;
    },
    get decksRemaining(): number {
      const rounded = Math.round(queue.length / 26);
      return Math.max(0.5, rounded / 2);
    },
    get cutCardReached(): boolean {
      return dealt >= cutCardPosition;
    },
    shuffle(): void {
      dealt = 0;
    },
  };
  return rigged as unknown as Shoe & RiggedShoe;
}

/**
 * M6: what the bot-mistake stream is offset by, so it is not the shoe's stream.
 *
 * 0x9E3779B9 is the 32-bit golden-ratio constant used for exactly this in
 * hashing: XORing with it scatters the bits of adjacent seeds instead of
 * shifting them, so seeds 1 and 2 give unrelated bot behaviour rather than
 * neighbouring streams. The value itself is arbitrary; that it is CONSTANT is
 * the part that matters -- the same seed must still replay the same session.
 */
const BOT_RNG_SALT = 0x9e3779b9;

/**
 * The seed the bot-mistake stream runs on, given the game's seed. Exported so
 * the separation itself can be asserted rather than assumed -- the old bug was
 * invisible precisely because both streams looked like independent generators
 * at the call site while being seeded identically.
 */
export function botRngSeed(gameSeed: number): number {
  return (gameSeed ^ BOT_RNG_SALT) >>> 0;
}
