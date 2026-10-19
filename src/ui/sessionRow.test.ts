import { describe, it, expect } from 'vitest';
import type { GradedEvent } from '../engine/grade';
import { EMPTY_STATS } from '../store/types';
import { betMissCount, sessionRowFor, upsertSession, type SessionRow, type SessionRowInput } from './sessionRow';

const ev = (kind: GradedEvent['kind'], correct: boolean, evCost?: number): GradedEvent =>
  ({
    source: 'table',
    kind,
    category: kind === 'action' ? 'hard' : kind === 'countCheck' ? 'countCheck' : kind,
    correct,
    classification: correct ? 'correct' : 'basic-error',
    taken: 'x',
    expected: 'y',
    reason: '',
    tc: 0,
    ...(evCost !== undefined ? { evCost } : {}),
  }) as GradedEvent;

const input = (over: Partial<SessionRowInput> = {}): SessionRowInput => ({
  id: 's-1',
  date: '2026-10-17T10:00:00.000Z',
  rounds: 3,
  hands: 3,
  events: [ev('action', true), ev('action', false, 0.25), ev('wong', false), ev('bet', false), ev('bet', true), ev('countCheck', true)],
  bankrollDelta: -2,
  profileId: 'p',
  profileName: 'P',
  peeks: 0,
  hotShoe: false,
  provisional: true,
  ...over,
});

describe('sessionRowFor (B2, R1/R3/R4)', () => {
  it('counts play decisions apart from bets, sit-outs and count checks', () => {
    const row = sessionRowFor(input());
    expect(row).toMatchObject({ graded: 6, correct: 3, plays: 2, playsCorrect: 1, betMisses: 2, mistakeUnits: 0.25 });
  });
  it('is provisional until End, then drops the flag', () => {
    expect(sessionRowFor(input()).provisional).toBe(true);
    expect('provisional' in sessionRowFor(input({ provisional: false }))).toBe(false);
  });
  it('omits peeks, hotShoe and betMisses when there are none', () => {
    const row = sessionRowFor(input({ events: [ev('action', true)] }));
    expect('peeks' in row || 'hotShoe' in row || 'betMisses' in row).toBe(false);
  });
  it('betMissCount ignores play and count misses', () => {
    expect(betMissCount([ev('action', false), ev('countCheck', false), ev('insurance', false)])).toBe(0);
    expect(betMissCount([ev('bet', false), ev('wong', false), ev('wong', true)])).toBe(2);
  });
});

describe('upsertSession (B2, R1)', () => {
  it('replaces the row with the same id in place and appends a new id', () => {
    const old: SessionRow = { date: 'x', rounds: 1, graded: 1, correct: 1, bankrollDelta: 0 };
    let stats = { ...EMPTY_STATS, sessions: [old] };
    stats = upsertSession(stats, sessionRowFor(input({ rounds: 1 })));
    stats = upsertSession(stats, sessionRowFor(input({ rounds: 2 })));
    expect(stats.sessions).toHaveLength(2);
    expect(stats.sessions[0]).toBe(old);
    expect(stats.sessions[1]).toMatchObject({ id: 's-1', rounds: 2 });
    stats = upsertSession(stats, sessionRowFor(input({ id: 's-2', rounds: 1 })));
    expect(stats.sessions.map((s) => s.id)).toEqual([undefined, 's-1', 's-2']);
  });
});

describe('Wave J: betMissCount', () => {
  it('counts a missed back-count entry as a bet decision off', () => {
    const miss = { source: 'table', kind: 'wongIn', category: 'wongIn', correct: false, classification: 'basic-error', taken: 'watch', expected: 'sit-in', reason: '', tc: 2 } as const;
    expect(betMissCount([miss, { ...miss, correct: true }])).toBe(1);
  });
});
