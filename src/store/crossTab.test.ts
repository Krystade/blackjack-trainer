import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  subscribeToExternalWrites,
  externalWriteVersion,
  OWNED_KEYS,
  _resetCrossTabForTest,
} from './crossTab';

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
  // If a new store is added and not listed here, its cross-tab writes go
  // unnoticed and that store silently regains the last-writer-wins bug.
  it('covers every key the app persists', () => {
    expect([...OWNED_KEYS].sort()).toEqual(
      [
        'bjtrainer.activeProfile.v1',
        'bjtrainer.flashsr.v1',
        'bjtrainer.profiles.v1',
        'bjtrainer.quizsr.v1',
        'bjtrainer.settings.v1',
        'bjtrainer.stats.v1',
      ].sort(),
    );
  });
});
