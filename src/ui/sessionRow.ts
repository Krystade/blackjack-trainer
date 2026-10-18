/**
 * Wave B2, R1: the Play session's row in Stats, written as the shoe goes.
 *
 * The row used to be appended only by End. In the car End is never tapped --
 * iOS evicts the page -- so the rounds a shoe played and the bankroll they
 * moved reached Stats with no session to account for them, and Stats said
 * "play a shoe" to someone who just had. Now one row per session, keyed by a
 * stable id, is upserted after every settled round (provisional) and End
 * finalises the same row.
 */
import type { GradedEvent } from '../engine/grade';
import type { Stats } from '../store/types';
import { mistakeUnits } from './reportSections';

export type SessionRow = Stats['sessions'][number];

export interface SessionRowInput {
  id: string;
  date: string;
  rounds: number;
  hands: number;
  events: readonly GradedEvent[];
  bankrollDelta: number;
  profileId: string;
  profileName: string;
  peeks: number;
  hotShoe: boolean;
  provisional: boolean;
  /** G2: present only for a session played with Dealer mistakes on. */
  dealerErrors?: { made: number; caught: number; falseCalls: number };
}

/** Bet-size and play-or-sit decisions graded wrong. */
export function betMissCount(events: readonly GradedEvent[]): number {
  return events.filter((e) => (e.kind === 'bet' || e.kind === 'wong') && !e.correct).length;
}

export function sessionRowFor(i: SessionRowInput): SessionRow {
  const plays = i.events.filter((e) => e.kind === 'action');
  const betMisses = betMissCount(i.events);
  return {
    id: i.id,
    date: i.date,
    rounds: i.rounds,
    graded: i.events.length,
    correct: i.events.filter((e) => e.correct).length,
    bankrollDelta: i.bankrollDelta,
    profileId: i.profileId,
    profileName: i.profileName,
    // R7: only when peeks happened, as before.
    ...(i.peeks > 0 ? { peeks: i.peeks } : {}),
    hands: i.hands,
    mistakeUnits: Math.round(mistakeUnits(i.events) * 10000) / 10000,
    ...(i.hotShoe ? { hotShoe: true as const } : {}),
    plays: plays.length,
    playsCorrect: plays.filter((e) => e.correct).length,
    ...(betMisses > 0 ? { betMisses } : {}),
    ...(i.provisional ? { provisional: true as const } : {}),
    ...(i.dealerErrors ? { dealerErrors: { ...i.dealerErrors } } : {}),
  };
}

/** Replace the row with this id in place, or append it. Never two rows per id. */
export function upsertSession(stats: Stats, row: SessionRow): Stats {
  const at = row.id === undefined ? -1 : stats.sessions.findIndex((s) => s.id === row.id);
  if (at === -1) return { ...stats, sessions: [...stats.sessions, row] };
  const sessions = stats.sessions.slice();
  sessions[at] = row;
  return { ...stats, sessions };
}

/** A short random id; collisions only matter within one browser's Stats. */
export function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
