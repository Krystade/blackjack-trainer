import type { GuidedSession } from './session';

/**
 * Wave L (lane v): the guided session Home asked Drills to run, handed across
 * one navigation in memory (like drillLaunch.ts): a fresh session, or the one
 * being resumed. Taken (and cleared) when the guided view mounts.
 */
let pending: GuidedSession | null = null;

export function setGuidedLaunch(session: GuidedSession): void {
  pending = session;
}

export function takeGuidedLaunch(): GuidedSession | null {
  const s = pending;
  pending = null;
  return s;
}
