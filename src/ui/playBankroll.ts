import { loadProfiles, saveProfiles } from '../store/profiles';
import type { Profile } from '../store/types';

/**
 * #42: the Play bankroll carries over, per profile, in `Profile.bankrollNow`.
 *
 * READ FROM STORAGE, NOT FROM THE PROFILE PROP. The app keeps its own copy of
 * the active profile in React state and keys the Table on that copy's content
 * (App.tsx), so writing the bankroll back into that state would remount the
 * Table -- a new shoe and a reset count -- at the end of every round. The
 * write therefore goes to storage only, which leaves the app's copy stale by
 * design; the next Table mount reads storage here, which is current.
 */
export function resumeBankroll(profile: Profile): number {
  const stored = loadProfiles().find((p) => p.id === profile.id);
  // A profile that is not in storage (a test fixture, a race with a delete)
  // falls back to what the caller holds.
  const now = stored ? stored.bankrollNow : profile.bankrollNow;
  return typeof now === 'number' && Number.isFinite(now) ? now : profile.bankrollStart;
}

/**
 * Write (or clear, with `undefined`) one profile's carried bankroll, leaving
 * every other field and profile exactly as stored. A no-op when it is
 * already that value, so calling it after every engine step costs nothing
 * and logs nothing.
 */
export function storeBankrollNow(profileId: string, bankroll: number | undefined): void {
  const profiles = loadProfiles();
  const target = profiles.find((p) => p.id === profileId);
  if (!target || target.bankrollNow === bankroll) return;
  const next = profiles.map((p) => {
    if (p.id !== profileId) return p;
    const updated: Profile = { ...p, bankrollNow: bankroll };
    if (bankroll === undefined) delete updated.bankrollNow;
    return updated;
  });
  saveProfiles(next);
}
