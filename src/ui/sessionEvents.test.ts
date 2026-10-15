import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../engine/cards';
import { Game, DEFAULT_SPREAD } from '../engine/game';
import { applyEvents } from '../store/stats';
import { EMPTY_STATS } from '../store/types';
import { datedSessionEvents } from './sessionEvents';

function rig(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

describe('datedSessionEvents (#25)', () => {
  it('a Play basic error lands in the cost-of-mistakes history, priced and dated', () => {
    const game = Game.withRiggedShoe(
      { penetration: 0.75, betSpreadOn: false, spread: DEFAULT_SPREAD, bankrollStart: 100, countCheckEvery: 0, seed: 1 },
      rig('10', '6', '7', '10', '2', '9'),
    );
    game.startRound();
    game.act('hit'); // 17 v 6: a basic error
    const at = '2026-10-14T12:00:00.000Z';
    const stats = applyEvents(EMPTY_STATS, datedSessionEvents(game.events, at));
    expect(stats.evCost.history).toHaveLength(1);
    const row = stats.evCost.history[0];
    expect(row.hand).toBe('10,7 v 6');
    expect(row.units).toBeGreaterThan(0);
    expect(row.date).toBe(at);
  });

  it('keeps a date an event already has', () => {
    const ev = { kind: 'bet', category: 'bet', correct: true, classification: 'correct', taken: '1', expected: '1', reason: '', tc: 0, at: 'x' } as const;
    expect(datedSessionEvents([ev], 'y')[0].at).toBe('x');
    expect(datedSessionEvents([{ ...ev, at: undefined }], 'y')[0].at).toBe('y');
  });
});
