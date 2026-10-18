import { describe, expect, it } from 'vitest';
import type { Card, Rank } from './cards';
import { DEFAULT_SPREAD, Game } from './game';
import type { GameConfig } from './game';
import { applyEvents } from '../store/stats';
import { EMPTY_STATS } from '../store/types';

/** F5 (W2-17): the measured decision time and the slow tag ride on the act event. */
function rig(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}
const cfg: GameConfig = {
  penetration: 0.75,
  betSpreadOn: false,
  spread: DEFAULT_SPREAD,
  bankrollStart: 100,
  countCheckEvery: 0,
  seed: 1,
};

function playedHand(timing?: { elapsedMs?: number; slow?: boolean }) {
  // P(10,6) v D(9,8): hit to 21, then stand.
  const game = Game.withRiggedShoe(cfg, rig('10', '9', '6', '8', '5'));
  game.startRound();
  game.act('hit', timing);
  game.act('stand');
  return game.events.filter((e) => e.kind === 'action');
}

describe('act timing', () => {
  it('carries elapsedMs and the slow tag on the action event', () => {
    const [hit, stand] = playedHand({ elapsedMs: 5200, slow: true });
    expect(hit).toMatchObject({ elapsedMs: 5200, slow: true });
    expect(stand!.elapsedMs).toBeUndefined();
    expect(stand!.slow).toBeUndefined();
  });

  it('a decision inside the clock carries its time and no slow tag', () => {
    const [hit] = playedHand({ elapsedMs: 1500, slow: false });
    expect(hit!.elapsedMs).toBe(1500);
    expect('slow' in hit!).toBe(false);
  });

  it('table decision times go to tableDecisions, not the drills latency history', () => {
    const at = '2026-10-17T10:00:00.000Z';
    const events = playedHand({ elapsedMs: 5200, slow: true }).map((e) => ({ ...e, at }));
    const { slow: _slow, ...drillBase } = events[0]!;
    const drill = { ...drillBase, source: 'flashcard' as const, elapsedMs: 900 };
    const stats = applyEvents(EMPTY_STATS, [...events, drill]);
    expect(stats.tableDecisions?.history).toEqual([{ elapsedMs: 5200, date: at, slow: true }]);
    expect(stats.latencyHistory.map((r) => r.elapsedMs)).toEqual([900]);
  });

  it('untimed table events write no decision row', () => {
    const stats = applyEvents(EMPTY_STATS, playedHand());
    expect(stats.tableDecisions).toBeUndefined();
  });
});
