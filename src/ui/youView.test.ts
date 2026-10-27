import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isYouScreen, lastYouView, rememberYouView } from './youView';

/** A Storage-shaped map; `broken` makes every call throw, as private mode can. */
function fakeStorage(broken = false) {
  const m = new Map<string, string>();
  const guard = () => {
    if (broken) throw new Error('SecurityError');
  };
  return {
    getItem: (k: string) => (guard(), m.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void m.set(k, v)),
    removeItem: (k: string) => (guard(), void m.delete(k)),
    map: m,
  };
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
function install(s: ReturnType<typeof fakeStorage>) {
  Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
}

describe('the You tab remembers which half was open', () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
    install(store);
  });
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('opens Progress the first time -- the achievements are what was asked for', () => {
    expect(lastYouView()).toBe('progress');
  });

  it('opens Stats after Stats was shown, and Progress again after Progress', () => {
    rememberYouView('stats');
    expect(lastYouView()).toBe('stats');
    expect(store.map.get('bjtrainer.youView.v1')).toBe('stats');
    rememberYouView('progress');
    expect(lastYouView()).toBe('progress');
  });

  it('reads anything else stored there as Progress', () => {
    store.map.set('bjtrainer.youView.v1', 'charts');
    expect(lastYouView()).toBe('progress');
  });

  it('works without storage: Progress, and remembering is a no-op rather than a throw', () => {
    install(fakeStorage(true));
    expect(() => rememberYouView('stats')).not.toThrow();
    expect(lastYouView()).toBe('progress');
  });

  it('knows its two screens and no others', () => {
    expect(isYouScreen('progress')).toBe(true);
    expect(isYouScreen('stats')).toBe(true);
    expect(isYouScreen('home')).toBe(false);
    expect(isYouScreen('casino')).toBe(false);
  });
});
