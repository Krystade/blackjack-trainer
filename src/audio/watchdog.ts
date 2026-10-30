const WATCHDOG_FLOOR_MS = 4000;
const WATCHDOG_BASE_MS = 2000;
const WATCHDOG_PER_CHAR_MS = 90;

/** Generous, text-length-scaled bound so a lost `onend` can never hang the
 * caller forever. Pure, so the count drill can bound a card's time by it (R8). */
export function estimateWatchdogMs(text: string): number {
  return Math.max(WATCHDOG_FLOOR_MS, WATCHDOG_BASE_MS + text.length * WATCHDOG_PER_CHAR_MS);
}
