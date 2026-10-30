import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  _setStorage,
  exportAll,
  importAll,
  inspectBackup,
  restoreSnapshot,
  snapshotBackedUp,
  summarizeBackupBlob,
  BACKED_UP_KEYS,
} from './persist';
import { importConfirmText, summaryText } from '../ui/screens/backupText';

/**
 * B4/B22: a backup says when it was made and what it holds, the import is
 * asked about with that in front of the person, the question names what THIS
 * file replaces, and the import can be undone byte for byte.
 */

function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

let store: ReturnType<typeof memStore>;
beforeEach(() => {
  store = memStore();
  _setStorage(store);
});

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
let savedTz: string | undefined;
beforeAll(() => {
  savedTz = env.TZ;
  env.TZ = 'America/Los_Angeles';
});
afterAll(() => {
  if (savedTz === undefined) delete env.TZ;
  else env.TZ = savedTz;
});

function seedPhone() {
  store.setItem('bjtrainer.settings.v1', JSON.stringify({ version: 1 }));
  store.setItem(
    'bjtrainer.stats.v1',
    JSON.stringify({
      version: 1,
      categories: { hard: { right: 7, wrong: 3 }, soft: { right: 2, wrong: 0 } },
      sessions: [{ date: '2026-10-20T03:00:00.000Z', rounds: 1, graded: 1, correct: 1, bankrollDelta: 0 }],
      latencyHistory: [{ category: 'hard', elapsedMs: 900, date: '2026-10-28T02:30:00.000Z', correct: true }],
    }),
  );
  store.setItem('bjtrainer.profiles.v1', JSON.stringify([{ id: 'a' }, { id: 'b' }]));
  store.setItem('bjtrainer.activeProfile.v1', 'a');
  store.setItem('bjtrainer.flashsr.v1', JSON.stringify({ c1: { box: 1 }, c2: { box: 2 } }));
  store.setItem('bjtrainer.quizsr.v1', JSON.stringify({ q1: { box: 0 } }));
  store.setItem('bjtrainer.progress.v1', JSON.stringify({ version: 1, days: { '2026-10-27': { met: true } } }));
}

describe('a backup carries its own date and contents (B4)', () => {
  it('exportAll stamps meta, and inspectBackup reads it back', () => {
    seedPhone();
    const text = exportAll();
    const meta = (JSON.parse(text) as { meta: { exportedAt: string; summary: unknown } }).meta;
    expect(Number.isFinite(Date.parse(meta.exportedAt))).toBe(true);
    const r = inspectBackup(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.exportedAt).toBe(meta.exportedAt);
    expect(r.summary).toEqual({
      answers: 12,
      sessions: 1,
      profiles: 2,
      reviewCards: 3,
      newest: '2026-10-28T02:30:00.000Z',
    });
    expect(meta.summary).toEqual(r.summary);
  });

  it('meta does not get in the way of the import', () => {
    seedPhone();
    const text = exportAll();
    store.map.clear();
    expect(importAll(text).ok).toBe(true);
    expect(store.getItem('bjtrainer.profiles.v1')).toBe(JSON.stringify([{ id: 'a' }, { id: 'b' }]));
  });

  it('an older file with no meta still inspects, with no date', () => {
    const r = inspectBackup(JSON.stringify({ settings: { version: 1 }, stats: { version: 1 } }));
    expect(r.ok && r.exportedAt).toBe(null);
  });

  it('refuses a file that is not a backup before anything is asked', () => {
    expect(inspectBackup('not json {{').ok).toBe(false);
    expect(inspectBackup('[]').ok).toBe(false);
    expect(inspectBackup(JSON.stringify({ settings: { version: 1 } })).ok).toBe(false);
    expect(inspectBackup(JSON.stringify({ settings: { version: 1 }, stats: { version: 2 } })).ok).toBe(false);
  });
});

describe('the confirm names what this file replaces (B22)', () => {
  it('a full backup names streaks, achievements and guided sessions', () => {
    seedPhone();
    store.setItem('bjtrainer.guided.v1', JSON.stringify({ version: 1 }));
    const r = inspectBackup(exportAll());
    if (!r.ok) throw new Error(r.error);
    expect(r.replaces).toEqual(['stats', 'settings', 'profiles', 'both review schedules', 'streaks and achievements', 'guided sessions']);
  });

  it('an old file that carries only stats and settings says only those', () => {
    const r = inspectBackup(JSON.stringify({ settings: { version: 1 }, stats: { version: 1 } }));
    expect(r.ok && r.replaces).toEqual(['stats', 'settings']);
  });

  it('shows the file beside the phone, warns when the file is older, and says whether there is an undo', () => {
    const file = {
      exportedAt: '2026-10-21T02:30:00.000Z',
      summary: { answers: 1000, sessions: 4, profiles: 1, reviewCards: 50, newest: '2026-10-21T02:00:00.000Z' },
      replaces: ['stats', 'settings', 'profiles'],
    };
    const phone = { answers: 2345, sessions: 9, profiles: 2, reviewCards: 80, newest: '2026-10-28T02:30:00.000Z' };
    const text = importConfirmText(file, phone, true);
    expect(text).toBe(
      [
        'Import this backup?',
        '',
        'The file: made 20 Oct 2026, 19:30. 1,000 answers, 4 table sessions, 1 profile, 50 review cards, newest practice 20 Oct 2026, 19:00.',
        'This phone: 2,345 answers, 9 table sessions, 2 profiles, 80 review cards, newest practice 27 Oct 2026, 19:30.',
        '',
        'The file is older than this phone: what you practised since it was made will be replaced.',
        '',
        'It replaces your stats, settings and profiles.',
        'You can undo the import from this screen until the app is closed.',
      ].join('\n'),
    );
    expect(importConfirmText({ ...file, summary: phone }, phone, false)).not.toContain('older than this phone');
    expect(importConfirmText(file, phone, false)).toContain('There is no undo');
    expect(summaryText({ answers: 1, sessions: 0, profiles: 1, reviewCards: 0, newest: null })).toBe(
      '1 answer, 0 table sessions, 1 profile, 0 review cards',
    );
  });
});

describe('an import can be undone exactly (B4)', () => {
  it('puts every byte back, and removes a key the import added', () => {
    seedPhone();
    store.setItem('bjtrainer.stats.v1.corrupt', 'old grave bytes');
    const before = new Map(store.map);
    const snap = snapshotBackedUp();

    const other = JSON.stringify({
      settings: { version: 1 },
      stats: { version: 1 },
      profiles: [{ id: 'z' }],
      guided: { version: 1, sessions: [] },
      customLists: { version: 1, lists: [] },
    });
    expect(importAll(other).ok).toBe(true);
    expect(store.getItem('bjtrainer.guided.v1')).not.toBeNull();

    expect(restoreSnapshot(snap)).toBe(true);
    expect(new Map(store.map)).toEqual(before);
  });

  it('the snapshot covers every key the backup carries', () => {
    const snap = snapshotBackedUp();
    for (const key of BACKED_UP_KEYS) expect(key in snap, key).toBe(true);
  });

  it('summarizeBackupBlob never throws on junk', () => {
    expect(summarizeBackupBlob({ stats: { categories: { x: null }, a: [null, 3] }, profiles: 'x' })).toEqual({
      answers: 0,
      sessions: 0,
      profiles: 0,
      reviewCards: 0,
      newest: null,
    });
  });
});
