import { describe, it, expect } from 'vitest';
import { Game, DEFAULT_SPREAD } from '../engine/game';
import type { Card, Rank } from '../engine/cards';
import { narrateDeal } from './useGame';

function rig(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

describe('narrateDeal follows the deal order', () => {
  it('reads the rightmost hand first on each pass, then the up-card between passes', () => {
    const game = Game.withRiggedShoe(
      {
        penetration: 0.75,
        betSpreadOn: false,
        spread: DEFAULT_SPREAD,
        bankrollStart: 100,
        countCheckEvery: 0,
        seed: 1,
        seats: { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 },
      },
      // Dealt: hand1 2, hand0 3, up 9, hand1 4, hand0 5, hole 6.
      rig('2', '3', '9', '4', '5', '6'),
    );
    game.startRound();
    const said: string[] = [];
    narrateDeal(game, { say: (t: string) => void said.push(t), sayFull: (t: string) => void said.push(t) } as never);
    // The cards come out in exactly the order the shoe gave them.
    const ranks = said.map((line) => line.match(/^(two|three|four|five|nine)\b/i)?.[1]?.toLowerCase() ?? line);
    expect(ranks.slice(0, 2)).toEqual(['two', 'three']);
    expect(said[2]).toMatch(/nine/i);
    expect(ranks.slice(3, 5)).toEqual(['four', 'five']);
  });
});
