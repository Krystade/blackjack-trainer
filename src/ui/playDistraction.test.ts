import { describe, expect, it } from 'vitest';
import { Game, DEFAULT_SPREAD } from '../engine/game';
import type { Card, Rank } from '../engine/cards';
import type { GameConfig } from '../engine/game';
import { distractionRow, distractionVerdictText, makePlayDistraction, playDistractionDue, PLAY_DISTRACTION_WINDOW } from './playDistraction';
import { playResult } from './screens/ladderRules';
import { EMPTY_STATS } from '../store/types';
import type { Stats } from '../store/types';

describe('Play distractions', () => {
  it('exactly one per 7-round window, never round 0', () => {
    for (const seed of [1, 42, 99_999]) {
      expect(playDistractionDue(0, seed)).toBe(false);
      for (let w = 0; w < 10; w++) {
        let n = 0;
        for (let r = w * PLAY_DISTRACTION_WINDOW; r < (w + 1) * PLAY_DISTRACTION_WINDOW; r++) if (playDistractionDue(r, seed)) n++;
        expect(n, `seed ${seed} window ${w}`).toBe(1);
      }
    }
  });

  it('both kinds occur across 4 windows, and the answer matches the prompt', () => {
    const kinds = new Set<string>();
    for (let r = 1; r < 4 * PLAY_DISTRACTION_WINDOW; r++) {
      const d = makePlayDistraction(5, r, 7);
      kinds.add(d.kind);
      expect(typeof d.answer).toBe('number');
    }
    expect([...kinds].sort()).toEqual(['generic', 'near-count']);
  });

  it('the stats row is marked as Play', () => {
    expect(distractionRow({ kind: 'generic' }, true, false, 1234.4, 'd')).toEqual({
      date: 'd',
      kind: 'generic',
      answerCorrect: true,
      countKept: false,
      elapsedMs: 1234,
      source: 'play',
    });
  });

  it('the verdict line uses real minus signs', () => {
    expect(distractionVerdictText({ correct: false, prompt: '-3 - (-6)', answer: 3 })).toBe('Sum ✗ −3 − (−6) = 3');
  });
});

describe('Game.oweCountCheck', () => {
  const rig = (...ranks: Rank[]): Card[] => ranks.map((rank) => ({ rank, suit: 's' }) as Card);
  const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({
    penetration: 0.75,
    betSpreadOn: false,
    spread: DEFAULT_SPREAD,
    bankrollStart: 100,
    countCheckEvery: 0,
    seed: 1,
    ...o,
  });

  it('makes the next poseCountCheck true, asks the running count only, and records one countCheck', () => {
    const g = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5'));
    expect(g.poseCountCheck()).toBe(false);
    g.oweCountCheck();
    expect(g.poseCountCheck()).toBe(true);
    expect(g.askRc).toBe(true);
    expect(g.askTcToo).toBe(false);
    const before = g.events.length;
    g.submitCountCheck(g.runningCount);
    const fresh = g.events.slice(before);
    expect(fresh.filter((e) => e.kind === 'countCheck')).toHaveLength(1);
    expect(g.countCheckDue).toBe(false);
  });

  it('a check already owed keeps its true-count half, and the running count is asked', () => {
    const g = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5'));
    g.countCheckDue = true;
    g.askRc = false;
    g.askTcToo = true;
    g.oweCountCheck();
    expect(g.askRc).toBe(true);
    expect(g.askTcToo).toBe(true);
  });
});

describe('D7: the play rung needs count checks and deviations', () => {
  const row = (checks?: { count: boolean; deviations: boolean; bets: boolean }): Stats['sessions'][number] => ({
    date: '2026-11-07T10:00:00Z',
    rounds: 30,
    graded: 50,
    correct: 50,
    bankrollDelta: 0,
    plays: 50,
    playsCorrect: 50,
    ...(checks ? { checks } : {}),
  });
  const stats = (s: Stats['sessions']): Stats => ({ ...structuredClone(EMPTY_STATS), sessions: s });

  it('a basic-only session does not pass; one with count and deviations does; old rows still count', () => {
    expect(playResult(stats([row({ count: false, deviations: false, bets: false })])).passed).toBe(false);
    expect(playResult(stats([row({ count: true, deviations: false, bets: false })])).passed).toBe(false);
    expect(playResult(stats([row({ count: true, deviations: true, bets: false })])).passed).toBe(true);
    expect(playResult(stats([row()])).passed).toBe(true);
  });
});
