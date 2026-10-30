/** B12: the crash screen's way to get the casino log off the phone. */
import {
  CASINO_LOG_KEY,
  LEGACY_CASINO_LOG_KEY,
  PREV_CASINO_LOG_KEY,
  emptyCasinoLog,
  loadCasinoLog,
  serializeExport,
} from '../store/casinoLog';

const CASINO_KEYS = [CASINO_LOG_KEY, PREV_CASINO_LOG_KEY, LEGACY_CASINO_LOG_KEY];

/** Whether any casino log is stored at all (raw, no parsing: this screen must not depend on the parser). */
export function hasCasinoLog(): boolean {
  try {
    return CASINO_KEYS.some((k) => window.localStorage.getItem(k) !== null);
  } catch {
    return false;
  }
}

/**
 * B12: the casino log's file, built so the Casino tab's own Import can read it
 * back. The parser may be the very thing that crashed, so every step falls
 * back to something simpler: the parsed log; then the raw stored text riding
 * as the export's 'unreadable' field (which Import keeps aside, not drops);
 * then a bare JSON object of the raw strings.
 */
export function casinoLogFileText(now: number): string {
  try {
    return serializeExport(loadCasinoLog(), now);
  } catch {
    /* the parser is suspect: carry the bytes instead */
  }
  const raw: Record<string, string> = {};
  for (const k of CASINO_KEYS) {
    try {
      const v = window.localStorage.getItem(k);
      if (v !== null) raw[k] = v;
    } catch {
      /* unreadable storage: nothing to carry */
    }
  }
  try {
    const first = raw[CASINO_LOG_KEY] ?? raw[PREV_CASINO_LOG_KEY] ?? raw[LEGACY_CASINO_LOG_KEY] ?? null;
    return serializeExport(emptyCasinoLog(), now, first);
  } catch {
    return JSON.stringify({ app: 'bjtrainer-casino-log-raw', savedAt: new Date(now).toISOString(), raw });
  }
}

/**
 * Catches a render throw so it blanks one screen instead of the whole app.
 *
 * This matters more here than in a typical app because there is no backend:
 * everything the user has ever practised lives in this browser's
 * localStorage, and a white screen with no controls is indistinguishable
 * from having lost it.
 *
 * The design is shaped by an incident that actually happened. A `null`
 * history array made the stats screen throw; the app blanked; and the
 * "Reset Stats" control that would have fixed it lived on the very screen
 * that was crashing, so the user was stranded with no way back. Two rules
 * follow from that, and both are load-bearing:
 *
 *   1. The fallback renders NOTHING from the crashed tree and reads no app
 *      state, so it cannot fail for the same reason the tree did. It uses
 *      inline styles off the theme tokens rather than app CSS classes.
 *   2. Salvage comes before repair. Exporting a backup is offered first and
 *      needs no working UI; only after that does the destructive option
 *      appear, and it is never the only way out.
 */
