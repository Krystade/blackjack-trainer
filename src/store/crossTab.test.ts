import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  subscribeToExternalWrites,
  externalWriteVersion,
  OWNED_KEYS,
  _resetCrossTabForTest,
} from './crossTab';
import { persistedStorageKeys } from './storageKeyScan';

/**
 * There is no DOM under this repo's `environment: 'node'` vitest config, so
 * these specs stand in a minimal window that records its listeners and lets
 * the test fire synthetic `storage` events.
 */

type Handler = (event: unknown) => void;

let handlers: Map<string, Set<Handler>>;
const originalWindow = (globalThis as { window?: unknown }).window;

function setWindow(value: unknown): void {
  Object.defineProperty(globalThis, 'window', { value, configurable: true, writable: true });
}

function fire(event: { key: string | null; oldValue?: string | null; newValue?: string | null }): void {
  for (const h of handlers.get('storage') ?? []) h(event);
}

beforeEach(() => {
  _resetCrossTabForTest();
  handlers = new Map();
  setWindow({
    addEventListener: (type: string, h: Handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(h);
    },
    removeEventListener: (type: string, h: Handler) => {
      handlers.get(type)?.delete(h);
    },
  });
});

afterEach(() => {
  setWindow(originalWindow);
  _resetCrossTabForTest();
});

describe('subscribeToExternalWrites', () => {
  it('reports a write to a watched key', () => {
    const seen: string[] = [];
    subscribeToExternalWrites(['bjtrainer.settings.v1'], (w) => seen.push(w.key));

    fire({ key: 'bjtrainer.settings.v1', oldValue: 'a', newValue: 'b' });
    expect(seen).toEqual(['bjtrainer.settings.v1']);
  });

  it('ignores keys it was not asked to watch', () => {
    const seen: string[] = [];
    subscribeToExternalWrites(['bjtrainer.settings.v1'], (w) => seen.push(w.key));

    fire({ key: 'bjtrainer.stats.v1', oldValue: 'a', newValue: 'b' });
    fire({ key: 'someone-elses-app', oldValue: 'a', newValue: 'b' });
    expect(seen).toEqual([]);
  });

  // Some browsers fire for a write that did not change anything; re-reading
  // the store would be pure churn, and in React a needless state swap.
  it('ignores a write that did not change the value', () => {
    const seen: string[] = [];
    subscribeToExternalWrites(['bjtrainer.stats.v1'], (w) => seen.push(w.key));

    fire({ key: 'bjtrainer.stats.v1', oldValue: 'same', newValue: 'same' });
    expect(seen).toEqual([]);
  });

  // storage.clear() fires once with a null key and wipes everything we own,
  // so it is the one case that must NOT be filtered out by the key check.
  it('treats a whole-store clear as affecting everything', () => {
    let calls = 0;
    subscribeToExternalWrites(['bjtrainer.settings.v1'], () => (calls += 1));

    fire({ key: null, oldValue: null, newValue: null });
    expect(calls).toBe(1);
  });

  it('reports a key being deleted', () => {
    const seen: (string | null)[] = [];
    subscribeToExternalWrites(['bjtrainer.stats.v1'], (w) => seen.push(w.newValue));

    fire({ key: 'bjtrainer.stats.v1', oldValue: '{}', newValue: null });
    expect(seen).toEqual([null]);
  });

  it('stops reporting after unsubscribe', () => {
    let calls = 0;
    const off = subscribeToExternalWrites(['bjtrainer.stats.v1'], () => (calls += 1));

    fire({ key: 'bjtrainer.stats.v1', oldValue: 'a', newValue: 'b' });
    off();
    fire({ key: 'bjtrainer.stats.v1', oldValue: 'b', newValue: 'c' });
    expect(calls).toBe(1);
  });

  it('supports several independent subscribers', () => {
    let a = 0;
    let b = 0;
    subscribeToExternalWrites(['bjtrainer.stats.v1'], () => (a += 1));
    subscribeToExternalWrites(['bjtrainer.settings.v1'], () => (b += 1));

    fire({ key: 'bjtrainer.stats.v1', oldValue: '1', newValue: '2' });
    expect([a, b]).toEqual([1, 0]);
  });

  it('is inert without a window rather than throwing', () => {
    setWindow(undefined);
    expect(() => subscribeToExternalWrites(['bjtrainer.stats.v1'], () => {})()).not.toThrow();
  });
});

describe('externalWriteVersion', () => {
  it('advances only on writes that are actually reported', () => {
    subscribeToExternalWrites(['bjtrainer.stats.v1'], () => {});
    const start = externalWriteVersion();

    fire({ key: 'bjtrainer.stats.v1', oldValue: 'a', newValue: 'b' });
    expect(externalWriteVersion()).toBe(start + 1);

    // Filtered out: unwatched key, and a no-op write.
    fire({ key: 'unrelated', oldValue: 'a', newValue: 'b' });
    fire({ key: 'bjtrainer.stats.v1', oldValue: 'same', newValue: 'same' });
    expect(externalWriteVersion()).toBe(start + 1);
  });
});

describe('OWNED_KEYS', () => {
  /**
   * Keys that are deliberately NOT synced across tabs, each with the reason.
   *
   * Every entry here is a claim that last-writer-wins is harmless for that
   * key, so the reason is part of the data: a future reader has to be able to
   * check the claim rather than assume the omission was considered.
   */
  const NOT_SYNCED: Record<string, string> = {
    // Append-only diagnostic buffers. Each tab logs its own page load under
    // its own session id, and the export is explicitly a merge of buffer and
    // stored, so a tab overwriting the other's tail loses nothing that tab
    // can see -- and re-reading would splice a foreign session into a
    // per-load elapsed clock.
    'bjtrainer.diagnostics.v1': 'append-only, per page load',
    'bjtrainer.testkit.progress.v1': 'test kit resume point across its own reload; one page, ten minutes',
    'bjtrainer.testkit.startedAt.v1': 'when the current test kit run began, to scope its log copy',
    // The running total of entries those buffers discarded, written beside
    // them on every flush so the count survives the reload the entries already
    // survive. Same reasoning as the buffer itself: a tab folding in its own
    // drops is additive, and re-reading another tab's total mid-flush would
    // double-count rather than correct anything.
    'bjtrainer.diagnostics.dropped.v1': 'append-only counter, follows the buffer',
    // Per-device caches of what the speech engine offered THIS tab. Voices
    // are enumerated per document; another tab's list is not evidence about
    // this one.
    'bjtrainer.voiceHistory.v1': 'per-document voice enumeration',
    'bjtrainer.mediaSessionLog.v1': 'retired; deleted on load by dropRetiredKeys',
    'bjtrainer.voiceProbe.v1': 'retired; deleted on load by dropRetiredKeys',
    'bjtrainer.voiceLocal.v1': 'retired; deleted on load by dropRetiredKeys',
    'bjtrainer.voiceLocalProbe.v1': 'retired; deleted on load by dropRetiredKeys',
    // Written and deleted inside one run of the device check, purely to find
    // out whether this browser can store anything at all
    // (diag/deviceChecks.ts). It never holds state, and by the time any other
    // tab could react to it, it is already gone.
    'bjtrainer.devicecheck.probe': 'write-read-delete probe, gone before it lands',
    // A sentinel the update check writes immediately before reloading ITSELF.
    // Reacting to it in another tab is how you get two tabs reloading each
    // other.
    'bjtrainer.reloadedFor': 'reload sentinel, reacting to it would loop',
    // A view preference on one screen, written on drag-end. The loser of a
    // race loses a column order, and re-reading mid-drag would yank the
    // columns out from under the finger doing the dragging.
    'bjtrainer.chartOrder.v1': 'view preference, re-reading mid-drag is worse',
    // Bounded to one challenge in one tab and cleared when it ends.
    'bjtrainer.masteryrun.v1': 'single in-flight challenge, cleared on finish',
    // A half-typed note, written on every keystroke so a reload or an iOS
    // kill cannot eat it. NOT one box in one tab -- the run itself is synced,
    // so two tabs can sit on the same step with a box each. It is excluded
    // because a keystroke is not a fact to agree on: syncing it would make
    // every character a storage event in the other tab, and the last writer
    // would win a half-typed line rather than either box being right.
    'bjtrainer.fieldTestDraft.v1': 'in-flight keystrokes, last writer wins a half line',
  };

  /**
   * Every `'bjtrainer.…'` literal in the source.
   *
   * SCANNED, not listed -- see `storageKeyScan.ts`, which holds the scan so
   * this test and the backup's key inventory cannot disagree about the set of
   * keys they are each classifying.
   */

  it('accounts for every key the app persists', () => {
    const unaccounted = persistedStorageKeys().filter(
      (k) => !(OWNED_KEYS as readonly string[]).includes(k) && !(k in NOT_SYNCED),
    );
    expect(
      unaccounted,
      'new persisted key: enrol it in OWNED_KEYS, or list it in NOT_SYNCED with the reason',
    ).toEqual([]);
  });

  it('finds the keys it is supposed to be scanning', () => {
    // The scan is the whole instrument. A typo in the glob or the regex would
    // return [] and make the test above pass unconditionally.
    const found = persistedStorageKeys();
    expect(found).toContain('bjtrainer.settings.v1');
    expect(found).toContain('bjtrainer.fieldTestRun.v1');
    expect(found.length).toBeGreaterThan(10);
  });

  it('does not exempt a key it also claims to own', () => {
    for (const key of OWNED_KEYS) {
      expect(key in NOT_SYNCED, `${key} is both owned and exempt`).toBe(false);
    }
  });

  it('syncs the field-test run, which caches a whole blob per tab', () => {
    expect(OWNED_KEYS).toContain('bjtrainer.fieldTestRun.v1');
  });
});
