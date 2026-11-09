import { getStorage, loadSettings, SETTINGS_KEY } from './persist';
import { getActiveProfile } from './profiles';
import { diag } from '../diag/diagnosticLog';
import { CHECK_KEYS, checksShown, type CheckKey } from '../ui/whatToCheck';
import { patchOnboarding } from './onboarding';

/**
 * T1-1B: the one-time switch to a beginner Play table.
 *
 * Every stored profile gets its What-to-check gates closed and its bots sent
 * home (no other players, seat 0), and Settings get the table switches closed
 * and the losing shoe off (its only grading is the bet ramp). NOTHING ELSE:
 * the cadence, ramp, indexes and mistake rate are kept, so turning a switch
 * back on brings back exactly what was there.
 *
 * Runs once per device, before React mounts (main.tsx), guarded by a marker
 * written LAST: a failed write leaves it unset and the next load tries again.
 * The marker is neither backed up nor synced, so a restored backup keeps the
 * setup it was taken with and is never migrated a second time.
 *
 * Suite fix (2026-11-08): it writes ONLY what it owns. A cold install (no
 * stored profiles or settings) is already the beginner table -- the default
 * profile's gates are closed, DEFAULT_SEATS has no bots, the losing shoe and
 * dealer mistakes default off -- so it writes the marker and nothing else:
 * materialising a full default settings blob stored `audio.enabled` and
 * logged a settings change nobody made. Stored blobs are patched in place
 * (their other keys untouched, defaults never filled in), and a blob that
 * would not change is not written.
 */

export const MIGRATIONS_KEY = 'bjtrainer.migrations.v1';
const PROFILES_KEY = 'bjtrainer.profiles.v1';

const CLOSED = { count: false, deviations: false, bets: false };

function markerSet(): boolean {
  try {
    const raw = getStorage().getItem(MIGRATIONS_KEY);
    if (!raw) return false;
    const m = JSON.parse(raw) as { beginnerPlay?: unknown };
    return typeof m?.beginnerPlay === 'number' && m.beginnerPlay >= 1;
  } catch {
    return false;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every stored profile: gates closed, bots home. Other keys as stored. */
function closeProfiles(parsed: unknown): unknown {
  if (!Array.isArray(parsed)) return parsed;
  return parsed.map((p: unknown) =>
    isObject(p)
      ? { ...p, playChecks: { ...CLOSED }, ...(isObject(p.seats) ? { seats: { ...p.seats, bots: 0, playerPosition: 0 } } : {}) }
      : p,
  );
}

/** The table gates closed; the losing shoe off only where it is stored (absent = off). */
function closeSettings(parsed: unknown): unknown {
  if (!isObject(parsed)) return parsed;
  return { ...parsed, tableChecks: { dealerMistakes: false, distractions: false }, ...('losingShoe' in parsed ? { losingShoe: false } : {}) };
}

type Patched = 'unchanged' | 'written' | 'failed';

/** Patch one stored blob in place; unreadable JSON is left for its loader to deal with. */
function patchStored(key: string, close: (parsed: unknown) => unknown): Patched {
  const store = getStorage();
  const raw = store.getItem(key);
  if (raw === null) return 'unchanged';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'unchanged';
  }
  const next = JSON.stringify(close(parsed));
  if (next === JSON.stringify(parsed)) return 'unchanged';
  try {
    store.setItem(key, next);
  } catch {
    return 'failed';
  }
  return store.getItem(key) === next ? 'written' : 'failed';
}

/** Returns true when it migrated on this call. */
export function applyBeginnerPlay(): boolean {
  if (markerSet()) return false;
  const store = getStorage();
  if (store.getItem(PROFILES_KEY) !== null || store.getItem(SETTINGS_KEY) !== null) {
    // getActiveProfile loads the profiles: a settings-only install (from
    // before profiles) gets its profile built from those settings and stored
    // here, so it is migrated with the rest.
    const shown = checksShown(getActiveProfile(), loadSettings());
    const turnedOff: CheckKey[] = CHECK_KEYS.filter((k) => shown[k]);
    // First: a retry after a failed write below would find the gates already closed.
    if (turnedOff.length > 0) patchOnboarding({ migratedOff: turnedOff });
    const profiles = patchStored(PROFILES_KEY, closeProfiles);
    if (profiles === 'failed') return false;
    const settings = patchStored(SETTINGS_KEY, closeSettings);
    if (settings === 'failed') return false;
    if (profiles === 'written' || settings === 'written') {
      diag('set', 'beginner-play-applied', { profiles: profiles === 'written' ? 1 : 0, settings: settings === 'written' ? 1 : 0, turnedOff: turnedOff.length });
    }
  }
  try {
    store.setItem(MIGRATIONS_KEY, JSON.stringify({ beginnerPlay: 1 }));
  } catch {
    return false;
  }
  return true;
}
