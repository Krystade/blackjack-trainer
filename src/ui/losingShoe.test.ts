import { describe, it, expect } from 'vitest';
import { DEFAULT_SPREAD, type GameConfig } from '../engine/game';
import { DEFAULT_RULES } from '../engine/ruleset';
import { makePlayGame, realignLosingShoe, LOSING_SHOE_SEATS } from './losingShoe';

const cfg: GameConfig = {
  penetration: 0.75,
  betSpreadOn: true,
  spread: DEFAULT_SPREAD,
  bankrollStart: 1000,
  countCheckEvery: 0,
  rules: DEFAULT_RULES,
  seats: { bots: 3, playerHands: 2, playerPosition: 1, botMistakePct: 0 },
  seed: 7,
};

function play(pg: ReturnType<typeof makePlayGame>, rounds: number, action: 'stand' | 'hit' | 'surrender') {
  const { game } = pg;
  let lost = 0;
  for (let r = 0; r < rounds; r++) {
    realignLosingShoe(pg);
    const before = game.bankroll;
    game.startRound(Array(game.cfg.seats!.playerHands).fill(1));
    if (game.phase === 'insurance') game.insuranceDecision(false);
    if (game.phase === 'player') {
      const legal = game.legalActions();
      game.act(legal.includes(action) ? action : 'stand');
    }
    while (game.phase === 'player') game.act('stand');
    if (game.bankroll < before) lost += 1;
  }
  return lost;
}

describe('Play losing shoe (#48-51)', () => {
  it('off: a fair shoe at the profile seats', () => {
    const pg = makePlayGame(cfg, false);
    expect(pg.game.isRigged).toBe(false);
    expect(pg.boundaries).toBeNull();
    expect(pg.game.cfg.seats).toEqual(cfg.seats);
  });

  it('on: the rig, dealt solo whatever the profile seats say', () => {
    const pg = makePlayGame(cfg, true);
    expect(pg.game.isRigged).toBe(true);
    expect(pg.game.cfg.seats).toEqual(LOSING_SHOE_SEATS);
  });

  it.each(['stand', 'hit', 'surrender'] as const)(
    'every round loses, played past a restock, when the player always tries %s',
    (action) => {
      const pg = makePlayGame(cfg, true);
      // 150 rounds runs through the 60-round script and its restock.
      expect(play(pg, 150, action)).toBe(150);
    },
  );

  it('grades the bet against the normal ramp', () => {
    const pg = makePlayGame(cfg, true);
    play(pg, 5, 'stand');
    // C-R6: one graded bet decision per round -- bet size or play-or-sit.
    expect(pg.game.events.filter((e) => e.kind === 'bet' || e.kind === 'wong').length).toBe(5);
  });
});
