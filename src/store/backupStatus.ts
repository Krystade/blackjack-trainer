import { getStorage, loadStats } from './persist';
import { diag } from '../diag/diagnosticLog';

/**
 * B7/B25: WHEN THE TRAINING DATA WAS LAST BACKED UP, AND WHETHER THE PHONE
 * PROMISED TO KEEP IT.
 *
 * On 2026-09-30 re-adding the home-screen icon wiped every answer, streak,
 * profile and review schedule. The casino log has had a "last exported" date
 * and a 30-day nudge since; the training data, the part no amount of drilling
 * rebuilds (the review schedule encodes elapsed real time), had neither.
 *
 * The date is written only once a file was actually handed over (a completed
 * share, or a download) -- a dismissed share sheet saved nothing, and marking
 * it would hide the nudge for a month with no backup.
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

export function backupIsDue(now: number, answers: number, last: string | null = lastBackupAt()): boolean {
  if (answers < BACKUP_MIN_ANSWERS) return false;
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
