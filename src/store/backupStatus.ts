import { getStorage, loadStats } from './persist';
import { diag } from '../diag/diagnosticLog';
import type { SaveResult } from '../platform/saveFile';

/**
 * B7/B25: WHEN THE TRAINING DATA WAS LAST BACKED UP, AND WHETHER THE PHONE
 * PROMISED TO KEEP IT.
 *
 * On 2026-09-30 re-adding the home-screen icon wiped every answer, streak,
 * profile and review schedule. The casino log has had a "last exported" date
 * and a 30-day nudge since; the training data, the part no amount of drilling
 * rebuilds (the review schedule encodes elapsed real time), had neither.
 *
 * The date is written only once a completed share handed the file over -- a
 * dismissed share sheet saved nothing, and marking it would hide the nudge for
 * a month with no backup. R9: a download is not proof either (on an iPhone it
 * can open a preview that saves nothing), so it only rests the reminder for
 * DOWNLOAD_SNOOZE_DAYS and leaves "Never backed up" / the old date standing.
 *
 * Per device and left out of the backup on purpose: a restore onto a wiped
 * phone must not carry "backed up yesterday" from the phone that made it.
 */
export const LAST_BACKUP_KEY = 'bjtrainer.lastBackup.v1';

/** Days after which the reminder shows, as for the casino log. */
export const BACKUP_DUE_DAYS = 30;
const DAY_MS = 86_400_000;
/** Below this many graded answers there is nothing yet worth a reminder. */
export const BACKUP_MIN_ANSWERS = 50;

export function lastBackupAt(): string | null {
  try {
    const raw = getStorage().getItem(LAST_BACKUP_KEY);
    return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

export function markBackedUp(at: Date): void {
  try {
    getStorage().setItem(LAST_BACKUP_KEY, at.toISOString());
  } catch {
    /* the reminder simply stays up */
  }
}

/** R9: after a download the reminder rests until this time (ISO), per device like the date. */
export const BACKUP_SNOOZE_KEY = 'bjtrainer.backupSnooze.v1';
export const DOWNLOAD_SNOOZE_DAYS = 7;

export function backupSnoozedUntil(): number | null {
  try {
    const raw = getStorage().getItem(BACKUP_SNOOZE_KEY);
    const t = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

export function snoozeBackupReminder(at: Date): void {
  try {
    getStorage().setItem(BACKUP_SNOOZE_KEY, new Date(at.getTime() + DOWNLOAD_SNOOZE_DAYS * DAY_MS).toISOString());
  } catch {
    /* the reminder simply stays up */
  }
}

/** What an export's result means for the reminder: a share is a backup, a download a week's rest. */
export function noteBackupHandedOver(r: SaveResult, at: Date): void {
  if (r === 'shared') markBackedUp(at);
  else if (r === 'downloaded') snoozeBackupReminder(at);
}

/** Graded answers on this phone (the category tallies). */
export function answersOnPhone(): number {
  try {
    let n = 0;
    for (const t of Object.values(loadStats().categories)) n += (t?.right ?? 0) + (t?.wrong ?? 0);
    return n;
  } catch {
    return 0;
  }
}

export function backupIsDue(
  now: number,
  answers: number,
  last: string | null = lastBackupAt(),
  snoozedUntil: number | null = backupSnoozedUntil(),
): boolean {
  if (answers < BACKUP_MIN_ANSWERS) return false;
  if (snoozedUntil !== null && now < snoozedUntil) return false;
  if (last === null) return true;
  return now - Date.parse(last) > BACKUP_DUE_DAYS * DAY_MS;
}

/* ------------------------------------------------------------------ */
/* B25: the answer to navigator.storage.persist(), kept and logged      */
/* ------------------------------------------------------------------ */

/** true: exempt from eviction; false: refused; null: the browser cannot say; undefined: not asked yet. */
let persistence: boolean | null | undefined;
const persistenceListeners = new Set<() => void>();

export function storagePersistence(): boolean | null | undefined {
  return persistence;
}

export function onStoragePersistence(fn: () => void): () => void {
  persistenceListeners.add(fn);
  return () => persistenceListeners.delete(fn);
}

/** Record the answer (main.tsx passes requestPersistentStorage's result) and log it once. */
export function noteStoragePersistence(granted: boolean | null): void {
  persistence = granted;
  try {
    diag('offline', 'storage-persist', { granted: granted === null ? 'unknown' : granted });
  } catch {
    /* a log must never cost the launch */
  }
  for (const fn of [...persistenceListeners]) {
    try {
      fn();
    } catch {
      /* one listener must not stop the rest */
    }
  }
}

/** Tests only. */
export function _resetBackupStatusForTest(): void {
  persistence = undefined;
  persistenceListeners.clear();
}
