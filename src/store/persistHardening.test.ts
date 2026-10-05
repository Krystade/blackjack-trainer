import { describe, it, expect, beforeEach } from 'vitest';
import {
  _setStorage,
  loadStats,
  loadSettings,
  exportAll,
  importAll,
  saveStats,
  BACKED_UP_KEYS,
} from './persist';
import { persistedStorageKeys } from './storageKeyScan';
import { EMPTY_STATS, DEFAULT_SETTINGS } from './types';

function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

let store: ReturnType<typeof memStore>;
beforeEach(() => {
  store = memStore();
  _setStorage(store);
});

describe('mergeStats — nested array hardening', () => {
  it('replaces a null history with an empty array instead of passing it through', () => {
    // A stored `{"history": null}` reached Stats.tsx's `.filter(...)`, which
    // threw during render. With no error boundary React unmounts the root, so
    // the app goes blank -- and the Reset Stats button lives on the very
    // screen that crashes, leaving no in-app way back.
    store.map.set('bjtrainer.stats.v1', JSON.stringify({ version: 1, countDrill: { history: null } }));
    expect(loadStats().countDrill.history).toEqual([]);
  });

  it('replaces a null category tally with the default', () => {
    store.map.set('bjtrainer.stats.v1', JSON.stringify({ version: 1, categories: { hard: null } }));
    expect(loadStats().categories.hard).toEqual({ right: 0, wrong: 0 });
  });

  it('replaces a non-array history of the wrong type', () => {
    store.map.set('bjtrainer.stats.v1', JSON.stringify({ version: 1, pairCancel: { history: 'nope' } }));
    expect(loadStats().pairCancel.history).toEqual([]);
  });

  /**
   * V3-8's evCost section is shaped as `{ history: [...] }` specifically so
   * repairStats and capHistories, which both walk every section with a
   * `history` key, cover it without either one naming it. This pins that: if the
   * section is ever reshaped into a bare array, the generic repair stops
   * reaching it and a corrupt blob crashes the Stats screen again.
   */
  it('repairs the EV-cost history through the same generic sweep', () => {
    store.map.set('bjtrainer.stats.v1', JSON.stringify({ version: 1, evCost: { history: null } }));
    expect(loadStats().evCost.history).toEqual([]);
  });

  it('keeps a valid history intact', () => {
    const entry = { date: '1', cards: 52, intervalMs: 800, correct: true };
    store.map.set('bjtrainer.stats.v1', JSON.stringify({ version: 1, countDrill: { history: [entry] } }));
    expect(loadStats().countDrill.history).toEqual([entry]);
  });
});

describe('saveStats — never throws on a full quota', () => {
  it('reports failure rather than throwing into the caller', () => {
    _setStorage({
      getItem: () => null,
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    });
    // The throw used to escape into endSession/persistGrade, skipping the
    // session report and the answer feedback that follow the save.
    expect(() => saveStats(structuredClone(EMPTY_STATS))).not.toThrow();
    expect(saveStats(structuredClone(EMPTY_STATS))).toBe(false);
  });
});

describe('masteryDistractionFreq default and merge', () => {
  it('defaults to off for a fresh install', () => {
    expect(loadSettings().drill.masteryDistractionFreq).toBe('off');
  });

  it('a partial persisted blob backfills the field from defaults', () => {
    store.map.set('bjtrainer.settings.v1', JSON.stringify({ version: 1, drill: { flashCategory: 'hard' } }));
    expect(loadSettings().drill.masteryDistractionFreq).toBe('off');
    expect(loadSettings().drill.flashCategory).toBe('hard');
  });
});

describe('exportAll — is actually a backup', () => {
  it('includes profiles and both spaced-repetition decks', () => {
    // Stats.tsx offers this as a download and warns only that import
    // "overwrites current stats and settings". Restoring onto a wiped browser
    // silently lost every profile and the entire SR schedule -- and elapsed-
    // time scheduling state cannot be reconstructed.
    store.map.set('bjtrainer.profiles.v1', JSON.stringify([{ id: 'p1', name: 'Vegas 6D' }]));
    store.map.set('bjtrainer.activeProfile.v1', 'p1');
    store.map.set('bjtrainer.flashsr.v1', JSON.stringify({ '16v10': { box: 3 } }));
    store.map.set('bjtrainer.quizsr.v1', JSON.stringify({ ins: { box: 1 } }));

    const blob = JSON.parse(exportAll());
    expect(blob.profiles).toBeTruthy();
    expect(blob.activeProfile).toBe('p1');
    expect(blob.flashSr).toEqual({ '16v10': { box: 3 } });
    expect(blob.quizSr).toEqual({ ins: { box: 1 } });
  });

  it('round-trips those keys back through importAll', () => {
    store.map.set('bjtrainer.profiles.v1', JSON.stringify([{ id: 'p1', name: 'Vegas 6D' }]));
    store.map.set('bjtrainer.activeProfile.v1', 'p1');
    store.map.set('bjtrainer.flashsr.v1', JSON.stringify({ '16v10': { box: 3 } }));
    const blob = exportAll();

    const fresh = memStore();
    _setStorage(fresh);
    expect(importAll(blob).ok).toBe(true);
    expect(fresh.map.get('bjtrainer.profiles.v1')).toContain('Vegas 6D');
    expect(fresh.map.get('bjtrainer.activeProfile.v1')).toBe('p1');
    expect(fresh.map.get('bjtrainer.flashsr.v1')).toContain('16v10');
  });

  it('still imports an OLD export that has no profiles or SR keys', () => {
    // Backward compatibility: blobs exported before this change must not be
    // rejected, or users lose the backups they already took.
    const old = JSON.stringify({ settings: { version: 1 }, stats: { version: 1 } });
    expect(importAll(old).ok).toBe(true);
  });

  it('includes an in-progress mastery run', () => {
    store.map.set('bjtrainer.masteryrun.v1', JSON.stringify({ scope: 'pairs', seed: 42, index: 17 }));
    const blob = JSON.parse(exportAll());
    expect(blob.masteryRun).toEqual({ scope: 'pairs', seed: 42, index: 17 });
  });

  it('round-trips the mastery run key back through importAll', () => {
    store.map.set('bjtrainer.profiles.v1', JSON.stringify([{ id: 'p1', name: 'Vegas 6D' }]));
    store.map.set('bjtrainer.activeProfile.v1', 'p1');
    store.map.set('bjtrainer.masteryrun.v1', JSON.stringify({ scope: 'pairs', seed: 42, index: 17 }));
    const blob = exportAll();

    const fresh = memStore();
    _setStorage(fresh);
    expect(importAll(blob).ok).toBe(true);
    expect(fresh.map.get('bjtrainer.masteryrun.v1')).toContain('"scope":"pairs"');
  });
});

/* ---------------------------------------------------------------------- */
/* E1/E2/E3: corrupt, backed up, and imported                             */
/* ---------------------------------------------------------------------- */

describe('a blob that cannot be read is not the same as no blob', () => {
  /** A blob truncated the way an interrupted or quota-killed write leaves it. */
  const TRUNCATED = '{"version":1,"sessions":[{"date":"2026-01-01","hands":40';

  it('keeps the bytes it could not parse', () => {
    store.map.set('bjtrainer.stats.v1', TRUNCATED);
    expect(loadStats().sessions, 'a corrupt blob still reads as empty').toEqual([]);
    expect(
      store.map.get('bjtrainer.stats.v1.corrupt'),
      'the only copy of the history was thrown away on read',
    ).toBe(TRUNCATED);
  });

  it('keeps them through the write that replaces the original', () => {
    // This is the sequence that actually loses the data: every call site is
    // read-modify-write, so the next graded answer commits the empty read.
    store.map.set('bjtrainer.stats.v1', TRUNCATED);
    saveStats(loadStats());
    expect(store.map.get('bjtrainer.stats.v1.corrupt')).toBe(TRUNCATED);
  });

  it('does not overwrite an older quarantine with newer damage', () => {
    store.map.set('bjtrainer.stats.v1.corrupt', TRUNCATED);
    store.map.set('bjtrainer.stats.v1', '{"version":1,"sessions":[{"date":"later"');
    loadStats();
    expect(store.map.get('bjtrainer.stats.v1.corrupt')).toBe(TRUNCATED);
  });

  it('carries them into the backup the crash screen offers', () => {
    // `exportAll` takes its stats through the same reader, so it handed back
    // a structurally complete file with the history silently emptied -- at
    // the one moment the user is being told to take a backup.
    store.map.set('bjtrainer.stats.v1', TRUNCATED);
    const blob = JSON.parse(exportAll()) as Record<string, unknown>;
    expect(blob['bjtrainer.stats.v1.corrupt']).toBe(TRUNCATED);
  });

  it('reads a version it does not know as unreadable, not as empty', () => {
    store.map.set('bjtrainer.stats.v1', '{"version":2,"sessions":[{"date":"a"}]}');
    loadStats();
    expect(store.map.get('bjtrainer.stats.v1.corrupt')).toBeDefined();
  });
});

describe('import says what it actually did', () => {
  const BLOB = JSON.stringify({
    settings: { version: 1 },
    stats: { version: 1 },
    profiles: [{ id: 'imported', name: 'Imported' }],
    quizSr: { '16v10': { box: 3 } },
  });

  /**
   * A storage that refuses ONE key.
   *
   * The interesting failure is not "nothing can be written" -- that one
   * cannot be rolled back into by definition, and is its own test below.
   * It is a write that fails PART WAY: some keys already replaced, the
   * rest not. The SR decks go last, which is why the original could leave
   * stats replaced, profiles untouched and a deck missing.
   */
  function refusesKey(bad: string, seed: Record<string, string> = {}) {
    const map = new Map<string, string>(Object.entries(seed));
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === bad) throw new DOMException('quota', 'QuotaExceededError');
        map.set(k, v);
      },
      // Real `localStorage` has this; the injected type does not require it,
      // and the test below covers the storage that lacks it.
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
  }

  it('reports a failure instead of claiming success', () => {
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    _setStorage(refusing);
    const result = importAll(BLOB);
    expect(result.ok, 'nothing was written and the screen said "Import successful."').toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('leaves the previous data in place when it cannot finish', () => {
    // The destructive write went FIRST and the SR decks last, so a failure
    // part way through replaced the stats, left the profiles alone and
    // dropped a deck -- under "Import successful."
    const store2 = refusesKey('bjtrainer.quizsr.v1', {
      'bjtrainer.stats.v1': JSON.stringify({ version: 1, sessions: [{ date: 'OLD' }] }),
      'bjtrainer.profiles.v1': JSON.stringify([{ id: 'old', name: 'MY REAL PROFILE' }]),
    });
    _setStorage(store2);

    const result = importAll(BLOB);
    expect(result.ok, 'a partial import reported success').toBe(false);
    expect(result.error, 'the failure did not say the data was preserved').toMatch(
      /nothing was changed/,
    );
    const stats = JSON.parse(store2.map.get('bjtrainer.stats.v1')!) as {
      sessions?: { date: string }[];
    };
    expect(stats.sessions?.[0]?.date, 'the destination was overwritten by a failed import').toBe(
      'OLD',
    );
    expect(
      store2.map.get('bjtrainer.profiles.v1'),
      'the profiles written before the failure were left replaced',
    ).toContain('MY REAL PROFILE');
    expect(
      store2.map.has('bjtrainer.settings.v1'),
      'a key that did not exist before the import was left behind',
    ).toBe(false);
  });

  it('rolls a key that did not exist back to reading as absent, without removeItem', () => {
    // The injected storage type is `getItem`/`setItem` only, so rollback of
    // a key that was ABSENT cannot always delete it. Writing '' is the
    // fallback, and it is only acceptable because every reader here treats
    // an empty string as no value -- which is the part worth pinning.
    const map = new Map<string, string>();
    _setStorage({
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === 'bjtrainer.quizsr.v1') throw new DOMException('quota', 'QuotaExceededError');
        map.set(k, v);
      },
    });
    expect(importAll(BLOB).ok).toBe(false);
    expect(map.get('bjtrainer.settings.v1') ?? '').toBe('');
    // ...and '' reads as no value, which is the only reason the fallback is
    // tolerable: the defaults come back, not a parse failure.
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadStats()).toEqual(EMPTY_STATS);
  });

  it('says so when it could not even put the old data back', () => {
    // Rollback writes into the storage that just refused a write, so it can
    // fail too. Claiming "nothing was changed" then would be the same lie in
    // a different place.
    let writes = 0;
    const map = new Map<string, string>([['bjtrainer.stats.v1', 'OLD-STATS']]);
    _setStorage({
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        // The first write lands; everything after it, rollback included, fails.
        if (writes++ >= 1) throw new DOMException('quota', 'QuotaExceededError');
        map.set(k, v);
      },
    });
    const result = importAll(BLOB);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not be put back/);
  });

  it('brings quarantined bytes back through the round trip', () => {
    // Export then import is the sequence the crash screen asks for. If the
    // only copy of an unreadable blob does not survive it, carrying it in
    // the backup at all was theatre.
    const TRUNCATED = '{"version":1,"sessions":[{"date":"2026-01-01"';
    store.map.set('bjtrainer.stats.v1', TRUNCATED);
    const blob = exportAll();
    store.map.clear();
    expect(importAll(blob)).toEqual({ ok: true });
    expect(store.map.get('bjtrainer.stats.v1.corrupt')).toBe(TRUNCATED);
  });

  it('still imports a whole blob when storage cooperates', () => {
    // The other half: a rollback that fires on every import would satisfy
    // both tests above and break the feature.
    expect(importAll(BLOB)).toEqual({ ok: true });
    expect(store.map.get('bjtrainer.profiles.v1')).toContain('Imported');
    expect(store.map.get('bjtrainer.quizsr.v1')).toContain('16v10');
  });
});

/* ------------------------------------------------------------------------ */
/* Nothing the app saves escapes the backup unnoticed                       */
/* ------------------------------------------------------------------------ */

/**
 * WHY THIS READS THE SOURCE.
 *
 * `exportAll`'s own comment records that it shipped carrying only settings and
 * stats: profiles and both spaced-repetition decks were added to the app later
 * and never added here, so restoring onto a wiped browser returned stats and
 * settings and silently lost every profile plus the entire review schedule.
 * The SR loss is the unrecoverable one -- those boxes encode elapsed real
 * time, which no amount of re-drilling reconstructs.
 *
 * Fixing the three keys that had escaped does not stop the fourth. The thing
 * that does is making a new key impossible to add without a decision: every
 * `bjtrainer.*` literal in `src/` must appear either in the backup or in the
 * list below, which says why it is left out. An uncategorised key fails here
 * with its own name in the message.
 *
 * On 2026-09-30 the operator removed and re-added the home-screen icon, which
 * on iOS deletes the web app's storage container, and lost everything. The
 * backup existed; its completeness is what this protects.
 */

/** Keys deliberately left out of a backup, each with the reason. */
const NOT_BACKED_UP: Record<string, string> = {
  'bjtrainer.diagnostics.v1':
    'the diagnostic log: transient, capped, and the one store that carries cabin speech and Bluetooth device names -- it must not ride along in a file the user may hand to someone',
  'bjtrainer.diagnostics.dropped.v1': 'a counter belonging to the diagnostic buffer above',
  'bjtrainer.voiceHistory.v1': 'what the microphone heard: diagnostic, and speech',
  'bjtrainer.mediaSessionLog.v1': 'retired; deleted on load by dropRetiredKeys',
  'bjtrainer.voiceProbe.v1': 'retired; deleted on load by dropRetiredKeys',
  'bjtrainer.voiceLocal.v1': 'retired; deleted on load by dropRetiredKeys',
  'bjtrainer.voiceLocalProbe.v1': 'retired; deleted on load by dropRetiredKeys',
  'bjtrainer.fieldTestRun.v1': 'progress through a field-test leg, meaningless off the drive',
  'bjtrainer.fieldTestDraft.v1': 'an unsent note inside a field-test leg',
  'bjtrainer.reloadedFor': 'a one-shot guard against a reload loop',
  'bjtrainer.devicecheck.probe':
    'written and deleted inside one run of the device check, to find out whether this browser can store anything at all -- it holds no state to back up',
  'bjtrainer.stats.v1.corrupt':
    'written by the reader, not the app, and already carried verbatim by exportAll when present',
};

describe('every key the app writes is either backed up or deliberately not', () => {
  it('finds the keys at all, so an empty scan cannot pass', () => {
    const keys = persistedStorageKeys();
    expect(keys.length, 'the source scan found no storage keys').toBeGreaterThan(10);
    expect(keys).toContain('bjtrainer.settings.v1');
    expect(keys).toContain('bjtrainer.profiles.v1');
  });

  it('leaves nothing uncategorised', () => {
    const unclassified = persistedStorageKeys().filter(
      (key) => !BACKED_UP_KEYS.includes(key) && !(key in NOT_BACKED_UP),
    );
    expect(
      unclassified,
      `a storage key is in neither the backup nor the deliberately-excluded list: ${unclassified.join(', ')}`,
    ).toEqual([]);
  });

  it('actually carries every key it claims to', () => {
    for (const key of BACKED_UP_KEYS) {
      store.setItem(key, key === 'bjtrainer.activeProfile.v1' ? 'an-id' : '{"version":1}');
    }
    const blob = exportAll();
    store.map.clear();
    expect(importAll(blob).ok).toBe(true);
    for (const key of BACKED_UP_KEYS) {
      expect(store.getItem(key), `${key} did not survive the round trip`).not.toBeNull();
    }
  });
});
