import type { Card } from '../engine/cards';
import { Shoe, mulberry32 } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import { handValue, isBlackjack, isBust } from '../engine/hand';
import { DEFAULT_RULES, type RuleSet } from '../engine/ruleset';
import { basicPlay } from '../engine/strategy';

/**
 * #47: one round of the count drill's Table mode -- what a counter sees at a
 * real table once the round has played out: 1-6 player hands and the dealer's.
 * Read-only: only the count matters.
 *
 * Wave X review: dealt card by card, the old shapes (random 2-3 card hands, a
 * dealer of 2-6 cards whatever they held) showed a dealer hitting a hard 20.
 * Now every round is played: each player by basic strategy (no splits -- a
 * pair is played as its total -- and surrender where the rules offer it), the
 * dealer by the rules (hits soft 17 or not), and a dealer natural ends the
 * round at the peek. The seat count, still drawn 1-6, gives the variety.
 */
export interface TableRound {
  players: Card[][];
  dealer: Card[];
}

export interface CountTableRun {
  rounds: TableRound[];
  /** Every round's cards, flattened (players right to left order is the
   * caller's concern; a sum does not care), one group per round. */
  groups: Card[][];
  finalRc: number;
}

export const TABLE_ROUND_CHOICES = [5, 10, 20] as const;
export const DEFAULT_TABLE_ROUNDS = 10;
export const TABLE_SHOE_DECKS = 6;
/** A generous round: six seats of three cards and a dealer of six. Played
 * hands can run longer, but a run of them averages about half this. */
const MAX_CARDS_PER_ROUND = 6 * 3 + 6;

/** The rounds setting, read safely: anything but a listed choice is the default. */
export function tableRounds(setting: number | undefined): number {
  return (TABLE_ROUND_CHOICES as readonly number[]).includes(setting ?? -1) ? setting! : DEFAULT_TABLE_ROUNDS;
}

/** Six decks, or enough that the worst-case run cannot empty the shoe. */
export function tableShoeDecks(rounds: number): number {
  return Math.max(TABLE_SHOE_DECKS, Math.ceil((rounds * MAX_CARDS_PER_ROUND) / 52));
}

/** Cards on the table in one round. */
export function cardsInRound(r: TableRound): number {
  return r.players.reduce((n, h) => n + h.length, 0) + r.dealer.length;
}

/**
 * Deal `rounds` rounds from one seeded shoe, in table order: a card to each
 * player then the dealer, a second pass of the same, then each player's turn
 * first base first, then the dealer's draws. The shoe is six decks, or larger
 * when the run could need more; should a long run of long hands still empty
 * it, it is reshuffled as a casino would, and the count runs on.
 *
 * `rules`: the dealer's soft-17 rule and surrender. Strategy is the six-deck
 * chart for them, the shoe being six decks or more.
 */
export function makeCountTable(rounds: number, seed: number, rules: RuleSet = DEFAULT_RULES): CountTableRun {
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const decks = tableShoeDecks(rounds);
  const shoe = new Shoe({ decks, seed });
  const draw = (): Card => {
    if (shoe.cardsRemaining === 0) shoe.shuffle();
    return shoe.draw();
  };
  const chart: RuleSet = { ...rules, decks: 6 };
  const dealerHits = (cards: Card[]): boolean => {
    const hv = handValue(cards);
    return hv.total < 17 || (hv.total === 17 && hv.soft && !rules.s17);
  };
  const out: TableRound[] = [];
  for (let r = 0; r < rounds; r++) {
    const seats = 1 + Math.floor(rng() * 6);
    const players: Card[][] = Array.from({ length: seats }, () => []);
    const dealer: Card[] = [];
    for (let pass = 0; pass < 2; pass++) {
      for (const h of players) h.push(draw());
      dealer.push(draw());
    }
    // The peek: a dealer natural is the whole round.
    if (!isBlackjack(dealer)) {
      const up = dealer[0]!.rank;
      let live = false;
      for (const h of players) {
        if (isBlackjack(h)) continue;
        let surrendered = false;
        while (!isBust(h)) {
          const first = h.length === 2;
          const { action } = basicPlay(h, up, { canDouble: first, canSplit: false, canSurrender: rules.ls && first }, chart);
          if (action === 'hit') {
            h.push(draw());
            continue;
          }
          if (action === 'double') h.push(draw());
          if (action === 'surrender') surrendered = true;
          break;
        }
        if (!isBust(h) && !surrendered) live = true;
      }
      if (live) while (dealerHits(dealer)) dealer.push(draw());
    }
    out.push({ players, dealer });
  }
  const groups = out.map((r) => [...r.players.flat(), ...r.dealer]);
  const finalRc = groups.flat().reduce((s, c) => s + hiLoTag(c.rank), 0);
  return { rounds: out, groups, finalRc };
}
