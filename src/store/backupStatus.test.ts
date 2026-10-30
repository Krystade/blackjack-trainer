import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { _setStorage } from './persist';
import {
  BACKUP_MIN_ANSWERS,
  LAST_BACKUP_KEY,
  _resetBackupStatusForTest,
  backupIsDue,
  lastBackupAt,
  markBackedUp,
  noteStoragePersistence,
  onStoragePersistence,
  storagePersistence,
} from './backupStatus';
import { lastBackupText, persistenceText } from '../ui/screens/backupText';
import * as diagLog from '../diag/diagnosticLog';

/** B7: the training data's backup reminder. B25: the persistence answer, kept. */

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-29T15:00:00Z');

beforeEach(() => {
  const map = new Map<string, string>();
  _setStorage({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) });
  _resetBackupStatusForTest();
});
afterEach(() => {
  _setStorage(null);
  vi.restoreAllMocks();
});

describe('backupIsDue (B7)', () => {
  it('is quiet until there is something worth keeping', () => {
    expect(backupIsDue(NOW, BACKUP_MIN_ANSWERS - 1, null)).toBe(false);
    expect(backupIsDue(NOW, BACKUP_MIN_ANSWERS, null)).toBe(true);
  });

  it('is due 30 days after the last backup, not before', () => {
    expect(backupIsDue(NOW, 500, new Date(NOW - 30 * DAY).toISOString())).toBe(false);
    expect(backupIsDue(NOW, 500, new Date(NOW - 30 * DAY - 1).toISOString())).toBe(true);
  });

  it('remembers a backup', () => {
    expect(lastBackupAt()).toBeNull();
    markBackedUp(new Date(NOW));
    expect(lastBackupAt()).toBe(new Date(NOW).toISOString());
    expect(backupIsDue(NOW + DAY, 500)).toBe(false);
    expect(LAST_BACKUP_KEY).toBe('bjtrainer.lastBackup.v1');
  });
});

describe('lastBackupText counts local days', () => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
  let saved: string | undefined;
  beforeAll(() => {
    saved = env.TZ;
    env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    if (saved === undefined) delete env.TZ;
    else env.TZ = saved;
  });
  it('says never, yesterday, and N days ago', () => {
    expect(lastBackupText(null, NOW)).toBe('Never backed up');
    // 21:00 PDT on the 28th, read at 08:00 PDT on the 29th: yesterday, not "today".
    expect(lastBackupText('2026-10-29T04:00:00Z', Date.parse('2026-10-29T15:00:00Z'))).toBe('Last backup yesterday');
    expect(lastBackupText('2026-09-25T18:00:00Z', NOW)).toBe('Last backup 34 days ago');
  });
});

describe('the persistent-storage answer is kept and logged (B25)', () => {
  it('stores it, tells listeners, and writes a diag line', () => {
    const spy = vi.spyOn(diagLog, 'diag');
    const heard: unknown[] = [];
    onStoragePersistence(() => heard.push(storagePersistence()));
    expect(storagePersistence()).toBeUndefined();
    noteStoragePersistence(false);
    expect(storagePersistence()).toBe(false);
    expect(heard).toEqual([false]);
    expect(spy).toHaveBeenCalledWith('offline', 'storage-persist', { granted: false });
  });

  it('says it in words', () => {
    expect(persistenceText(true)).toBe('Protected from clearing');
    expect(persistenceText(false)).toBe('The phone may clear it: keep a backup');
    expect(persistenceText(null)).toBe('The browser cannot say: keep a backup');
    expect(persistenceText(undefined)).toBe('Checking…');
  });
});
