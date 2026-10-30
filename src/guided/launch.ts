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

/** How the page answered before a guided session took over (eyes-free, microphone). */
export interface GuidedModes {
  eyesFree: boolean;
  voice: boolean;
}

let prior: GuidedModes | null = null;

/**
 * Noted by Home's card BEFORE it sets the session's own modes, so the session
 * can put the page back as it found it. Kept (not taken) until the session
 * restores it: a dev StrictMode double render reads it twice.
 */
export function noteGuidedPriorModes(modes: GuidedModes): void {
  prior = modes;
}

export function peekGuidedPriorModes(): GuidedModes | null {
  return prior;
}

export function clearGuidedPriorModes(): void {
  prior = null;
}
