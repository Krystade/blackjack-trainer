import { getStorage, loadSettings, saveSettings } from './persist';
import { getActiveProfile, loadProfiles, saveProfiles } from './profiles';
import { diag } from '../diag/diagnosticLog';
import { CHECK_KEYS, checksShown, type CheckKey } from '../ui/whatToCheck';
import { patchOnboarding } from './onboarding';
import type { Profile } from './types';

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

/** Returns true when it migrated on this call. */
export function applyBeginnerPlay(): boolean {
  if (markerSet()) return false;
  const store = getStorage();
  const profiles = loadProfiles();
  const settings = loadSettings();
  const active = getActiveProfile();
  const shown = checksShown(active, settings);
  // A first run's default profile has its gates closed already, so nothing is listed.
  const turnedOff: CheckKey[] = CHECK_KEYS.filter((k) => shown[k]);

  const next: Profile[] = profiles.map((p) => ({
    ...p,
    playChecks: { ...CLOSED },
    seats: { ...p.seats, bots: 0, playerPosition: 0 },
  }));
  // First: a retry after a failed write below would find the gates already closed.
  if (turnedOff.length > 0) patchOnboarding({ migratedOff: turnedOff });
  saveProfiles(next);
  // saveProfiles reports nothing; read it back.
  if (store.getItem(PROFILES_KEY) !== JSON.stringify(next)) return false;
  const savedSettings = saveSettings({
    ...settings,
    tableChecks: { dealerMistakes: false, distractions: false },
    losingShoe: false,
  });
  if (!savedSettings) return false;
  diag('set', 'beginner-play-applied', { profiles: next.length, turnedOff: turnedOff.length });
  try {
    store.setItem(MIGRATIONS_KEY, JSON.stringify({ beginnerPlay: 1 }));
  } catch {
    return false;
  }
  return true;
}
