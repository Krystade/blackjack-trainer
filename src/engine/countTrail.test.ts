import { describe, expect, it } from 'vitest';
import { Game, type GameConfig } from './game';
import { hiLoTag } from './count';
import type { Card } from './cards';

/**
 * Wave X (item 2): the trail a Rewind replays -- every card counted since the
 * shoe began or the running count was last answered right, in counting order.
 */

const CFG: GameConfig = {
  penetration: 0.75,
  betSpreadOn: false,
  spread: [{ minTc: -99, units: 1 }],
  bankrollStart: 1000,
  countCheckEvery: 1,
  countCheckAsk: 'running',
  seats: { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 },
};

/** Deal a round and stand on everything. */
function playRound(game: Game): void {
  game.startRound(1);
  if (game.phase === 'insurance') game.insuranceDecision(false);
  while (game.phase === 'player') game.act('stand');
}

const sum = (cards: readonly Card[]) => cards.reduce((s, c) => s + hiLoTag(c.rank), 0);

/** Every card on the felt after a round, in the order the counter saw it: the
 * deal as dealt with the hole held back, then the hole, then the draws. */
function seenThisRound(game: Game): Card[] {
  const out: Card[] = [];
  for (const slot of game.dealOrder) {
    if (slot.kind === 'player') out.push(game.hands[slot.handIndex]!.cards[slot.cardIndex]!);
    else if (slot.kind === 'dealer' && slot.cardIndex === 0) out.push(game.dealerCards[0]!);
  }
  for (const h of game.hands) out.push(...h.cards.slice(2));
  if (game.holeRevealed) out.push(game.dealerCards[1]!);
  out.push(...game.dealerCards.slice(2));
  return out;
}

describe('the count trail', () => {
  it('is every card counted, in counting order, and sums to the running count', () => {
    const game = new Game({ ...CFG, seed: 11 });
    playRound(game);
    expect(game.countTrail).toEqual(seenThisRound(game));
    expect(sum(game.countTrail)).toBe(game.runningCount);
  });

  it('a right running count starts it again; a wrong one leaves it growing from the last right one', () => {
    const game = new Game({ ...CFG, seed: 11 });
    playRound(game);
    game.poseCountCheck();
    game.submitCountCheck(game.runningCount);
    expect(game.countTrail).toEqual([]);

    playRound(game);
    const round2 = seenThisRound(game);
    expect(game.countTrail).toEqual(round2);
    game.poseCountCheck();
    const r = game.submitCountCheck(game.runningCount + 7);
    expect(r.rcCorrect).toBe(false);
    // The wrong answer is graded and stays graded; the trail is untouched.
    expect(game.events.filter((e) => e.kind === 'countCheck').map((e) => e.correct)).toEqual([true, false]);
    expect(game.countTrail).toEqual(round2);

    playRound(game);
    expect(game.countTrail).toEqual([...round2, ...seenThisRound(game)]);
  });

  it("a Rewind's right recount moves the checkpoint to the check: only later cards stay on the trail", () => {
    const game = new Game({ ...CFG, seed: 11 });
    playRound(game);
    game.poseCountCheck();
    const atCheck = [...game.countTrail];
    game.submitCountCheck(game.runningCount + 3);
    playRound(game);
    const later = seenThisRound(game);
    game.confirmCountAt(atCheck);
    expect(game.countTrail).toEqual(later);
    // And grades nothing.
    expect(game.events.filter((e) => e.kind === 'countCheck')).toHaveLength(1);
  });

  it('a stale snapshot (the trail was reset since) changes nothing', () => {
    const game = new Game({ ...CFG, seed: 11 });
    playRound(game);
    const stale = [...game.countTrail];
    game.poseCountCheck();
    game.submitCountCheck(game.runningCount);
    playRound(game);
    const now = [...game.countTrail];
    game.confirmCountAt(stale);
    expect(game.countTrail).toEqual(now);
  });

  it('a new shoe starts it again', () => {
    const game = new Game({ ...CFG, countCheckEvery: 0, penetration: 0.2, seed: 5 });
    let rounds = 0;
    while (!game.shuffleDue && rounds < 200) {
      playRound(game);
      rounds += 1;
    }
    expect(game.shuffleDue).toBe(true);
    expect(game.countTrail.length).toBeGreaterThan(0);
    playRound(game);
    expect(game.shuffledLastRound).toBe(true);
    expect(game.countTrail).toEqual(seenThisRound(game));
  });
});
