import { getStorage, quarantinedBackupKeys } from './persist';
import { graveKeys } from './quarantine';

/**
 * R4: the Stats notice about set-aside data can be dismissed. It is shown
 * again only when the set-aside copies CHANGE (something new could not be
 * read), not on every visit -- an always-on notice, lit on upgrade by an old
 * one-slot quarantine, is the warning that gets skipped.
 *
 * Dismissing hides the notice only: the copies stay, and every backup still
 * carries them.
 */
export const QUARANTINE_SEEN_KEY = 'bjtrainer.quarantineSeen.v1';

/** A fingerprint of every set-aside copy of a backed-up key ('' when there are none). */
export function setAsideFingerprint(): string {
  const store = getStorage();
  const parts: string[] = [];
  for (const key of quarantinedBackupKeys()) {
    for (const g of graveKeys(key)) {
      const v = store.getItem(g);
      if (v === null) continue;
      let h = 0x811c9dc5;
      for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 0x01000193);
      parts.push(`${g}:${v.length}:${(h >>> 0).toString(36)}`);
    }
  }
  return parts.join('|');
}

/** Whether the notice should show: something is set aside that has not been dismissed. */
export function quarantineNoticeDue(): boolean {
  const now = setAsideFingerprint();
  if (now === '') return false;
  try {
    return getStorage().getItem(QUARANTINE_SEEN_KEY) !== now;
  } catch {
    return true;
  }
}

export function dismissQuarantineNotice(): void {
  try {
    getStorage().setItem(QUARANTINE_SEEN_KEY, setAsideFingerprint());
  } catch {
    /* not saved: it shows again next time, which loses nothing */
  }
}
