import { describe, expect, it } from 'vitest';
import { Shoe, type Card } from './cards';
import { DEFAULT_SPREAD, Game, type GameConfig } from './game';
import { DEFAULT_RULES } from './ruleset';
import { makePlayGame, realignLosingShoe } from '../ui/losingShoe';

/**
 * Track 3: a table taken back from disk deals on exactly as the one that was
 * saved would have (U1, U2).
 */

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({
  penetration: 0.75,
  betSpreadOn: true,
  spread: DEFAULT_SPREAD,
  bankrollStart: 1000,
  countCheckEvery: 0,
  rules: DEFAULT_RULES,
  seats: { bots: 2, playerHands: 1, playerPosition: 1, botMistakePct: 0 },
  seed: 11,
  ...over,
});

/** One round, played by a fixed policy, so two tables fed the same cards play the same way. */
function playRound(g: Game, bet = 2): void {
  g.startRound(bet);
  if (g.phase === 'insurance') g.insuranceDecision(false);
  let guard = 0;
  while (g.phase === 'player' && guard++ < 40) {
    const legal = g.legalActions();
    const total = g.hands[g.active]!.cards.reduce((n, c) => n + (c.rank === 'A' ? 11 : ['J', 'Q', 'K', '10'].includes(c.rank) ? 10 : Number(c.rank)), 0);
    g.act(total < 15 && legal.includes('hit') ? 'hit' : 'stand');
  }
}

/** What a player sees and what grades them, round by round. */
function fingerprint(g: Game) {
  return JSON.stringify({
    round: g.roundNo,
    bankroll: g.bankroll,
    rc: g.runningCount,
    dealt: g.shoe.cardsDealt,
    hands: g.hands.map((h) => h.cards),
    events: g.events.length,
  });
}

describe('Shoe.upcoming / Shoe.restore (U1)', () => {
  it('a restored shoe deals the same cards in the same order, and keeps its dealt count and cut', () => {
    const a = new Shoe({ decks: 2, seed: 5 });
    for (let i = 0; i < 37; i++) a.draw();
    const b = new Shoe({ decks: 2, seed: 999 });
    b.restore({ upcoming: a.upcoming, dealt: a.cardsDealt, cut: a.cutCardPosition });
    expect(b.cardsDealt).toBe(37);
    expect(b.cutCardPosition).toBe(a.cutCardPosition);
    expect(b.cardsRemaining).toBe(a.cardsRemaining);
    const drawn: [Card, Card][] = [];
    for (let i = 0; i < 40; i++) drawn.push([a.draw(), b.draw()]);
    expect(drawn.every(([x, y]) => x.rank === y.rank && x.suit === y.suit)).toBe(true);
    expect(b.cardsDealt).toBe(77);
  });

  it('upcoming is a copy: changing it does not touch the shoe', () => {
    const a = new Shoe({ decks: 1, seed: 3 });
    const up = a.upcoming;
    const first = { ...up[0]! };
    up[0]!.rank = first.rank === 'A' ? 'K' : 'A';
    expect(a.upcoming[0]).toEqual(first);
  });
});

describe('Game.toResume / restoreResume (U2)', () => {
  it('a restored game plays on identically to the saved one until the shoe reshuffles', () => {
    const live = new Game(cfg());
    for (let r = 0; r < 12; r++) playRound(live);
    const saved = live.toResume();
    const back = new Game(cfg({ seed: 424242 }));
    back.restoreResume(structuredClone(saved));
    expect(fingerprint(back)).toBe(fingerprint(live));
    let compared = 0;
    // The shuffle after the cut card draws from each shoe's own stream, so the
    // tables part there (an accepted cost: a new shoe is a new shoe).
    while (!live.shuffleDue && compared < 60) {
      playRound(live);
      playRound(back);
      expect(fingerprint(back), `round ${live.roundNo}`).toBe(fingerprint(live));
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(8);
  });

  it('carries the session: rounds, bankroll, graded events, the in/out toggle', () => {
    const live = new Game(cfg());
    for (let r = 0; r < 5; r++) playRound(live);
    live.setIn(false);
    const back = new Game(cfg({ seed: 1 }));
    back.restoreResume(live.toResume());
    expect(back.roundNo).toBe(5);
    expect(back.bankroll).toBe(live.bankroll);
    expect(back.events).toEqual(live.events);
    expect(back.handsPlayed).toBe(live.handsPlayed);
    expect(back.isIn).toBe(false);
    expect(back.phase).toBe('settled');
  });

  it('is not resumable mid-round or with a count check open, and toResume refuses then', () => {
    const g = new Game(cfg({ countCheckEvery: 1, seed: 2 }));
    expect(g.resumable).toBe(true);
    let guard = 0;
    // Find a round that stops in the player phase.
    while (guard++ < 50) {
      g.startRound(1);
      if (g.phase === 'insurance') g.insuranceDecision(false);
      if (g.phase === 'player') break;
    }
    expect(g.phase).toBe('player');
    expect(g.resumable).toBe(false);
    expect(() => g.toResume()).toThrow();
    while (g.phase === 'player') g.act('stand');
    expect(g.resumable).toBe(true);
    expect(g.poseCountCheck()).toBe(true);
    expect(g.resumable).toBe(false);
    expect(() => g.toResume()).toThrow();
  });

  it('a restored game is not left with a check open', () => {
    const g = new Game(cfg({ countCheckEvery: 1, seed: 2 }));
    playRound(g);
    const s = g.toResume();
    expect(s.countCheckDue).toBe(true);
    const back = new Game(cfg({ countCheckEvery: 1, seed: 9 }));
    back.restoreResume(s);
    expect(back.countCheckOpen).toBe(false);
    // Still owed: the check is asked again before the next deal.
    expect(back.countCheckDue).toBe(true);
  });
});

describe('Game.cutOffRecord / voidCutOffRound (the round the page died in)', () => {
  it('burns the cut-off round: its shown cards stay counted, its bet is void, the shoe goes on after them', () => {
    const live = new Game(cfg({ seed: 21 }));
    for (let r = 0; r < 6; r++) playRound(live);
    const boundary = live.toResume();
    // Round 7 starts and the page dies in it.
    let rec = null;
    let guard = 0;
    while (guard++ < 30) {
      live.startRound(4);
      if (live.phase === 'insurance') live.insuranceDecision(false);
      if (live.phase === 'player') {
        rec = live.cutOffRecord();
        break;
      }
      // A round that never reached the player phase settled: it counts as played.
      playRound(live);
    }
    expect(rec).not.toBeNull();
    const boundaryNow = live.roundNo === rec!.round ? boundary : null;
    expect(boundaryNow, 'the record is for the round after a saved boundary').not.toBeNull();

    // Preconditions: the dead round moved the count and the shoe, or the checks below prove nothing.
    expect(rec!.runningCount).not.toBe(boundary.runningCount);
    expect(live.shoe.cardsDealt).toBeGreaterThan(boundary.shoe.dealt);
    const back = new Game(cfg({ seed: 77 }));
    back.restoreResume(boundary);
    back.voidCutOffRound(rec!);
    expect(back.roundNo).toBe(boundary.roundNo);
    expect(back.bankroll).toBe(boundary.bankroll);
    expect(back.runningCount).toBe(rec!.runningCount);
    expect(back.shoe.cardsDealt).toBe(live.shoe.cardsDealt);
    expect(back.phase).toBe('idle');
    expect(back.hands).toEqual([]);
    // The next card is the one the dead round would have dealt next.
    expect(back.shoe.upcoming[0]).toEqual(live.shoe.upcoming[0]);
  });

  it('is refused mid-round', () => {
    const g = new Game(cfg({ seed: 4 }));
    let guard = 0;
    while (guard++ < 30) {
      g.startRound(1);
      if (g.phase === 'insurance') g.insuranceDecision(false);
      if (g.phase === 'player') break;
    }
    expect(() => g.voidCutOffRound(g.cutOffRecord())).toThrow();
  });
});

describe('the losing shoe resumes on its own script', () => {
  it('rebuilt from the script seed and the dealt count, it deals what the saved one would', () => {
    const c = cfg({ seats: { bots: 0, playerHands: 1, playerPosition: 0, botMistakePct: 0 }, seed: 5 });
    const live = makePlayGame(c, true);
    for (let r = 0; r < 4; r++) {
      realignLosingShoe(live);
      playRound(live.game, 1);
    }
    const saved = live.game.toResume();
    expect(saved.shoe.kind).toBe('rigged');
    const back = makePlayGame({ ...c, seed: 31337 }, true, live.scriptSeed);
    back.game.restoreResume(saved);
    expect(back.game.shoe.upcoming).toEqual(live.game.shoe.upcoming);
    for (let r = 0; r < 3; r++) {
      realignLosingShoe(live);
      realignLosingShoe(back);
      playRound(live.game, 1);
      playRound(back.game, 1);
      expect(fingerprint(back.game)).toBe(fingerprint(live.game));
    }
  });

  it('a fair snapshot is refused by a rigged game (and the reverse)', () => {
    const fair = new Game(cfg());
    playRound(fair);
    const rigged = makePlayGame(cfg({ seats: { bots: 0, playerHands: 1, playerPosition: 0, botMistakePct: 0 } }), true);
    expect(() => rigged.game.restoreResume(fair.toResume())).toThrow();
    realignLosingShoe(rigged);
    playRound(rigged.game, 1);
    expect(() => new Game(cfg()).restoreResume(rigged.game.toResume())).toThrow();
  });
});
