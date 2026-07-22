import { DEFAULT_SETTINGS, EMPTY_STATS, type Settings, type Stats } from './types';

// Storage injection for testing (guards missing localStorage in node)
let storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;

export function _setStorage(s: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  storage = s;
}

// Single persistent in-memory fallback for environments without localStorage.
// Created once at module level so save→load round-trips work in node.
const fallbackMap = new Map<string, string>();
const fallbackStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: (key) => fallbackMap.get(key) ?? null,
  setItem: (key, value) => {
    fallbackMap.set(key, value);
  },
};

// Default storage resolver (lazy, never throws)
function getStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  if (storage !== null) {
    return storage;
  }

  // Use real localStorage if available, otherwise the persistent in-memory fallback
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }

  return fallbackStorage;
}

function isVersion1Object(parsed: unknown): parsed is Record<string, unknown> {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { version?: unknown }).version === 1
  );
}

/**
 * Merge a parsed (possibly partial) settings blob over a deep copy of the
 * defaults: top-level fields plus the nested drill and audio objects.
 * Guarantees a complete Settings shape even if stored data is missing
 * fields (or predates cycle 3, i.e. has no audio object at all), and never
 * shares references with the DEFAULT_SETTINGS singleton.
 */
function mergeSettings(parsed: Record<string, unknown>): Settings {
  const base = structuredClone(DEFAULT_SETTINGS);
  const p = parsed as Partial<Settings>;
  const drill =
    typeof p.drill === 'object' && p.drill !== null
      ? { ...base.drill, ...p.drill }
      : base.drill;
  const audio =
    typeof p.audio === 'object' && p.audio !== null
      ? { ...base.audio, ...p.audio }
      : base.audio;
  return { ...base, ...p, version: 1, drill, audio };
}

/**
 * Merge a parsed (possibly partial) stats blob over a deep copy of the empty
 * stats: top-level fields plus the eight nested sections (categories,
 * perIndex, mistakes, countDrill, trueCount, deckEstimation, timedCount,
 * sessions). The three telemetry sections (trueCount/deckEstimation/
 * timedCount) postdate the original stats shape, so any blob persisted
 * before they existed lacks them entirely -- the same
 * `typeof ... === 'object'` guard used for countDrill backfills them to an
 * empty history rather than leaving them undefined.
 */
function mergeStats(parsed: Record<string, unknown>): Stats {
  const base = structuredClone(EMPTY_STATS);
  const p = parsed as Partial<Stats>;
  return {
    ...base,
    ...p,
    version: 1,
    categories:
      typeof p.categories === 'object' && p.categories !== null
        ? { ...base.categories, ...p.categories }
        : base.categories,
    perIndex:
      typeof p.perIndex === 'object' && p.perIndex !== null
        ? { ...base.perIndex, ...p.perIndex }
        : base.perIndex,
    mistakes:
      typeof p.mistakes === 'object' && p.mistakes !== null
        ? { ...base.mistakes, ...p.mistakes }
        : base.mistakes,
    countDrill:
      typeof p.countDrill === 'object' && p.countDrill !== null
        ? { ...base.countDrill, ...p.countDrill }
        : base.countDrill,
    trueCount:
      typeof p.trueCount === 'object' && p.trueCount !== null
        ? { ...base.trueCount, ...p.trueCount }
        : base.trueCount,
    deckEstimation:
      typeof p.deckEstimation === 'object' && p.deckEstimation !== null
        ? { ...base.deckEstimation, ...p.deckEstimation }
        : base.deckEstimation,
    timedCount:
      typeof p.timedCount === 'object' && p.timedCount !== null
        ? { ...base.timedCount, ...p.timedCount }
        : base.timedCount,
    sessions: Array.isArray(p.sessions) ? p.sessions : base.sessions,
  };
}

export function loadSettings(): Settings {
  const store = getStorage();
  const json = store.getItem('bjtrainer.settings.v1');

  if (!json) {
    return structuredClone(DEFAULT_SETTINGS);
  }

  try {
    const parsed = JSON.parse(json) as unknown;
    if (isVersion1Object(parsed)) {
      return mergeSettings(parsed);
    }
    return structuredClone(DEFAULT_SETTINGS);
  } catch {
    // JSON parse error
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  const store = getStorage();
  store.setItem('bjtrainer.settings.v1', JSON.stringify(s));
}

export function loadStats(): Stats {
  const store = getStorage();
  const json = store.getItem('bjtrainer.stats.v1');

  if (!json) {
    return structuredClone(EMPTY_STATS);
  }

  try {
    const parsed = JSON.parse(json) as unknown;
    if (isVersion1Object(parsed)) {
      return mergeStats(parsed);
    }
    return structuredClone(EMPTY_STATS);
  } catch {
    // JSON parse error
    return structuredClone(EMPTY_STATS);
  }
}

export function saveStats(s: Stats): void {
  const store = getStorage();
  store.setItem('bjtrainer.stats.v1', JSON.stringify(s));
}

export function exportAll(): string {
  const settings = loadSettings();
  const stats = loadStats();
  return JSON.stringify({ settings, stats });
}

export function importAll(json: string): { ok: boolean; error?: string } {
  try {
    const parsed = JSON.parse(json) as unknown;

    // Validate structure
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, error: 'Invalid JSON structure' };
    }

    const obj = parsed as { settings?: unknown; stats?: unknown };
    if (!('settings' in obj) || !('stats' in obj)) {
      return { ok: false, error: 'Missing settings or stats' };
    }

    if (!isVersion1Object(obj.settings)) {
      return { ok: false, error: 'Invalid settings version' };
    }
    if (!isVersion1Object(obj.stats)) {
      return { ok: false, error: 'Invalid stats version' };
    }

    // All validations passed: merge over defaults so a partial blob never
    // persists an incomplete shape, then save.
    saveSettings(mergeSettings(obj.settings));
    saveStats(mergeStats(obj.stats));

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
