import { describe, it, expect } from 'vitest';
import { mulberry32 } from './cards';
import type { Card, Rank } from './cards';
import { Game, DEFAULT_SPREAD } from './game';
import type { GameConfig } from './game';
import { correctPlay, basicPlay } from './strategy';
import type { PlayContext } from './strategy';
import type { StrategyRules } from './ruleset';
import type { TcRounding } from './count';

/**
 * W17 (Wave A): the rules-combination regression suite.
 *
 * F7, F10 and F19 each lived on a non-default switch -- a truncating profile,
 * a no-DAS table, resplit aces -- which the rest of the suite never turned.
 * This plays seeded shoes under every combination of the switches that change
 * what is legal or what is graded, choosing actions at random (splitting
 * whenever it can, to reach resplits), and checks at every decision and every
 * count check:
 *
 *   1. the play the table grades as correct is a play the table offers, both
 *      with the count's indices and by basic strategy alone;
 *   2. what the table offers obeys the rules: no double after a split without
 *      DAS, no surrender without LS, no hit or resplit of a split ace beyond
 *      what RSA allows;
 *   3. a count check answered with exactly `trueCountNow` is graded correct.
 */

const ROUNDINGS: TcRounding[] = ['floor', 'truncate', 'round'];

type Combo = { rules: StrategyRules; tcRounding: TcRounding };

function combos(): Combo[] {
  const out: Combo[] = [];
  for (const decks of [1, 2, 6, 8] as const)
    for (const s17 of [false, true])
      for (const das of [false, true])
        for (const ls of [false, true])
          for (const rsa of [false, true])
            for (const surrenderIndices of [false, true])
              for (const tcRounding of ROUNDINGS)
                out.push({ rules: { decks, s17, das, ls, rsa, bj65: false, surrenderIndices }, tcRounding });
  return out;
}

function label({ rules, tcRounding }: Combo): string {
  return `${rules.decks}D ${rules.s17 ? 'S17' : 'H17'} das=${rules.das} ls=${rules.ls} rsa=${rules.rsa} fab4=${rules.surrenderIndices} ${tcRounding}`;
}

function config(combo: Combo, seed: number): GameConfig {
  return {
    penetration: 0.8,
    betSpreadOn: true,
    spread: DEFAULT_SPREAD,
    tcRounding: combo.tcRounding,
    bankrollStart: 1000,
    countCheckEvery: 1,
    countCheckAsk: 'both',
    seed,
    rules: combo.rules,
  };
}

interface Tally {
  decisions: number;
  checks: number;
  acesResplit: number;
}

/** Play one round to its settle, checking every invariant on the way. */
function playCheckedRound(game: Game, combo: Combo, pick: () => number, tally: Tally): void {
  const where = label(combo);
  const { rules } = combo;
  game.startRound(1);
  if (game.phase === 'insurance') game.insuranceDecision(false);
  while (game.phase === 'player') {
    const legal = game.legalActions();
    const hand = game.hands[game.active];
    const up = game.dealerCards[0].rank;
    const cards = hand.cards.map((c) => c.rank).join(',');
    const at = `${where}: ${cards} v ${up}`;

    if (hand.fromSplit && !rules.das) expect(legal, `${at}: double after split without DAS`).not.toContain('double');
    if (!rules.ls) expect(legal, `${at}: surrender without LS`).not.toContain('surrender');
    if (hand.splitAces) {
      expect(legal, `${at}: hit on a split ace`).not.toContain('hit');
      if (!rules.rsa) expect(legal, `${at}: resplit aces without RSA`).not.toContain('split');
    }

    const ctx: PlayContext = {
      canDouble: legal.includes('double'),
      canSplit: legal.includes('split'),
      canSurrender: legal.includes('surrender'),
    };
    const withCount = correctPlay(hand.cards, up, game.trueCountNow, ctx, game.rules).action;
    const basic = basicPlay(hand.cards, up, ctx, game.rules).action;
    expect(legal, `${at} expected ${withCount}`).toContain(withCount);
    expect(legal, `${at} basic ${basic}`).toContain(basic);
    tally.decisions++;

    const action = legal.includes('split') && pick() < 0.9 ? 'split' : legal[Math.floor(pick() * legal.length)];
    game.act(action);
    if (game.hands.filter((h) => h.splitAces).length >= 3) tally.acesResplit++;
  }
  expect(game.phase, where).toBe('settled');
  if (game.poseCountCheck()) {
    const { rcCorrect, tcCorrect } = game.submitCountCheck(game.runningCount, game.trueCountNow);
    expect(rcCorrect, where).toBe(true);
    expect(tcCorrect, `${where}: TC ${game.trueCountNow}`).toBe(true);
    tally.checks++;
  }
}

function rig(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

describe('W17: every rules combination', () => {
  it('real shoes: graded plays are offered, offers obey the rules, trueCountNow passes the check', () => {
    const tally: Tally = { decisions: 0, checks: 0, acesResplit: 0 };
    for (const [i, combo] of combos().entries()) {
      const game = new Game(config(combo, 1000 + i));
      const pick = mulberry32(7000 + i);
      for (let round = 0; round < 40; round++) playCheckedRound(game, combo, pick, tally);
    }
    // Vacuity guards: the suite really did decide, check, and resplit aces.
    expect(tally.decisions).toBeGreaterThan(10_000);
    expect(tally.checks).toBeGreaterThan(5_000);
    expect(tally.acesResplit).toBeGreaterThan(0);
  });

  it('an aces-heavy shoe: resplitting to the 4-hand cap under every combination', () => {
    const tally: Tally = { decisions: 0, checks: 0, acesResplit: 0 };
    const aces = rig('A', '6', 'A', '10', ...(Array(10).fill('A') as Rank[]), ...(Array(40).fill('9') as Rank[]));
    for (const [i, combo] of combos().entries()) {
      const game = Game.withRiggedShoe(config(combo, 1), aces);
      playCheckedRound(game, combo, mulberry32(i), tally);
    }
    expect(tally.acesResplit).toBeGreaterThan(100);
  });
});
