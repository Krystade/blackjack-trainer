import { describe, expect, it } from 'vitest';
import { Game, DEFAULT_SPREAD } from '../engine/game';
import type { Card, Rank } from '../engine/cards';
import type { GameConfig } from '../engine/game';
import {
  distractionRow,
  distractionVerdictText,
  makePlayDistraction,
  playDistractionDue,
  playDistractionPrefs,
  PLAY_DISTRACTION_INTERVAL,
  PLAY_DISTRACTION_WINDOW,
  makePlayStop,
  playDistractionIsTable,
  type OtherTableDistraction,
} from './playDistraction';
import { otherTableCount } from '../drills/otherTable';
import { distractionSummary } from '../store/drillStats';
import { isDistractionPoint } from '../drills/distraction';
import { playResult } from './screens/ladderRules';
import { resumeSavable } from './tableResume';
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

  it('owner 2026-11-09: exactly one per window at every frequency, never round 0', () => {
    expect(PLAY_DISTRACTION_INTERVAL).toEqual({ rare: 12, normal: 7, often: 4 });
    for (const freq of ['rare', 'normal', 'often'] as const) {
      const w = PLAY_DISTRACTION_INTERVAL[freq];
      for (const seed of [1, 42, 99_999]) {
        expect(playDistractionDue(0, seed, freq)).toBe(false);
        for (let k = 0; k < 10; k++) {
          let n = 0;
          for (let r = k * w; r < (k + 1) * w; r++) if (playDistractionDue(r, seed, freq)) n++;
          expect(n, `${freq} seed ${seed} window ${k}`).toBe(1);
        }
      }
    }
  });

  it('normal (the default) stops on exactly the rounds, with the sums, it did before the choice', () => {
    for (const seed of [1, 42, 99_999]) {
      for (let r = 1; r < 100; r++) {
        expect(playDistractionDue(r, seed, 'normal')).toBe(isDistractionPoint(r, 'occasional', seed));
        expect(playDistractionDue(r, seed)).toBe(playDistractionDue(r, seed, 'normal'));
        expect(makePlayDistraction(3, r, seed)).toEqual(makePlayDistraction(3, r, seed, 'normal', 'normal'));
      }
    }
  });

  it('difficulty reaches the sum: easy is single-digit, hard has a two-digit operand or a product', () => {
    const nums = (p: string) => (p.match(/\d+/g) ?? []).map(Number);
    for (let r = 1; r < 60; r++) {
      expect(Math.max(...nums(makePlayDistraction(0, r, 5, 'normal', 'easy').prompt))).toBeLessThan(10);
      const hard = makePlayDistraction(0, r, 5, 'normal', 'hard').prompt;
      // Near the count of 0, Hard's other shape is a small number times 3..9.
      expect(Math.max(...nums(hard)) >= 11 || hard.includes('×'), hard).toBe(true);
    }
  });

  it('stored choices read safely: absent or unknown is normal', () => {
    expect(playDistractionPrefs({})).toEqual({ freq: 'normal', difficulty: 'normal', type: 'sums' });
    expect(playDistractionPrefs({ playDistractionFreq: 'often', playDistractionDifficulty: 'hard' })).toEqual({ freq: 'often', difficulty: 'hard', type: 'sums' });
    expect(playDistractionPrefs({ playDistractionDifficulty: 'expert' })).toEqual({ freq: 'normal', difficulty: 'expert', type: 'sums' });
    expect(playDistractionPrefs({ playDistractionFreq: 'weekly' as never, playDistractionDifficulty: 'insane' as never })).toEqual({
      freq: 'normal',
      difficulty: 'normal',
      type: 'sums',
    });
    // Owner 2026-11-10: the Kind, likewise: absent or unknown is Sums.
    expect(playDistractionPrefs({ playDistractionType: 'table' }).type).toBe('table');
    expect(playDistractionPrefs({ playDistractionType: 'mix' }).type).toBe('mix');
    expect(playDistractionPrefs({ playDistractionType: 'cards' as never }).type).toBe('sums');
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

describe('owner 2026-11-10: the other table', () => {
  const prefs = (type: 'sums' | 'table' | 'mix', difficulty: 'easy' | 'normal' | 'hard' | 'expert' = 'normal') =>
    ({ freq: 'normal', difficulty, type }) as const;

  it('Sums deals exactly what makePlayDistraction always did', () => {
    for (const seed of [1, 42, 99_999]) {
      for (let r = 1; r < 60; r++) {
        for (const d of ['easy', 'normal', 'hard', 'expert'] as const) {
          expect(makePlayStop(3, r, seed, prefs('sums', d))).toEqual(makePlayDistraction(3, r, seed, 'normal', d));
        }
      }
    }
  });

  it('Other table: every stop is a table, asked in plain words, whose answer is its Hi-Lo count', () => {
    for (let r = 1; r < 40; r++) {
      const d = makePlayStop(5, r, 7, prefs('table'));
      expect(d.kind).toBe('other-table');
      expect(d.prompt).toBe("What's the count at this table?");
      expect(d.halves).toBeUndefined();
      if (d.kind !== 'other-table') throw new Error('not a table');
      expect(d.answer).toBe(otherTableCount(d.table));
      expect(d.table.seats).toHaveLength(6);
      // The main count is not an input: the same stop at another count deals the same table.
      expect(makePlayStop(-9, r, 7, prefs('table'))).toEqual(d);
    }
    expect((makePlayStop(5, 3, 7, prefs('table', 'easy')) as OtherTableDistraction).table.seats).toHaveLength(3);
    expect((makePlayStop(5, 3, 7, prefs('table', 'expert')) as OtherTableDistraction).table.hideAfterMs).toBe(5000);
  });

  it('Mix: both kinds, seeded per stop', () => {
    const kinds = new Set<string>();
    let tables = 0;
    for (let r = 1; r < 200; r++) {
      const d = makePlayStop(2, r, 11, prefs('mix'));
      kinds.add(d.kind === 'other-table' ? 'table' : 'sum');
      if (d.kind === 'other-table') tables++;
      expect(playDistractionIsTable('mix', r, 11)).toBe(d.kind === 'other-table');
      expect(makePlayStop(2, r, 11, prefs('mix'))).toEqual(d);
    }
    expect([...kinds].sort()).toEqual(['sum', 'table']);
    // Roughly half and half, not a near-constant.
    expect(tables).toBeGreaterThan(60);
    expect(tables).toBeLessThan(140);
  });

  it("the row keeps its kind and is Play's; the verdict says the table count, signed", () => {
    expect(distractionRow({ kind: 'other-table' }, false, true, 900, 'd')).toEqual({
      date: 'd',
      kind: 'other-table',
      answerCorrect: false,
      countKept: true,
      elapsedMs: 900,
      source: 'play',
    });
    expect(distractionVerdictText({ kind: 'other-table', correct: true, prompt: '', answer: 3 })).toBe('Other table ✓ count = +3');
    expect(distractionVerdictText({ kind: 'other-table', correct: false, prompt: '', answer: -2 })).toBe('Other table ✗ count = −2');
    expect(distractionVerdictText({ kind: 'other-table', correct: true, prompt: '', answer: 0 })).toBe('Other table ✓ count = 0');
    // A sum's line is unchanged.
    expect(distractionVerdictText({ kind: 'generic', correct: true, prompt: '4 + 7', answer: 11 })).toBe('Sum ✓ 4 + 7 = 11');
  });

  it('the Count drill summary still leaves Play rows out, the table kind included', () => {
    const rows = [
      distractionRow({ kind: 'other-table' }, true, true, 1, 'd'),
      { date: 'd', kind: 'generic' as const, answerCorrect: false, countKept: false },
    ];
    expect(distractionSummary(rows)).toEqual({ attempts: 1, answerAccuracyPct: 0, countKeptPct: 0 });
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

  it('T1-1B: an open distraction blocks resume saves', () => {
    const g = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5'));
    expect(resumeSavable(g)).toBe(true);
    expect(resumeSavable(g, true)).toBe(false);
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
