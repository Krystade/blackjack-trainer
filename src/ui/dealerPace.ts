import type { Settings } from '../store/types';

/**
 * F5 (W2-17): Play's optional dealer-pace clock.
 *
 * A real dealer does not wait. The clock is a thin bar draining over each
 * decision; when it runs out NOTHING is played for you -- the decision is
 * only tagged slow, and the session report counts them. Off by default.
 *
 * Forced off eyes-free: a bar nobody can see is not a dealer, and a tag the
 * driver could not have known about is noise in the report.
 */

export const DEALER_PACE_MIN_SEC = 2;
export const DEALER_PACE_MAX_SEC = 8;
export const DEALER_PACE_DEFAULT_SEC = 4;

/** The configured limit in whole seconds, clamped to 2..8 (absent or junk = 4). */
export function dealerPaceSec(settings: Pick<Settings, 'dealerPaceSec'>): number {
  const raw = settings.dealerPaceSec;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEALER_PACE_DEFAULT_SEC;
  return Math.min(DEALER_PACE_MAX_SEC, Math.max(DEALER_PACE_MIN_SEC, Math.round(raw)));
}

/** The running limit in ms, or null when the clock is off (unset, or eyes-free). */
export function dealerPaceMs(
  settings: Pick<Settings, 'dealerPaceOn' | 'dealerPaceSec'>,
  eyesFree: boolean,
): number | null {
  if (settings.dealerPaceOn !== true || eyesFree) return null;
  return dealerPaceSec(settings) * 1000;
}

/**
 * Whether a decision was slow: the clock was running and the measured time
 * reached it. `>=`, the shot clock's rule (drills/shotClock.ts): at exactly
 * the limit the time is gone. An unmeasured decision is never slow.
 */
export function isSlowDecision(elapsedMs: number | null, paceMs: number | null): boolean {
  if (paceMs === null || elapsedMs === null) return false;
  return elapsedMs >= paceMs;
}

/** The report's line: "1 slow decision", "3 slow decisions". */
export function slowDecisionsText(n: number): string {
  return `${n} slow decision${n === 1 ? '' : 's'}`;
}
