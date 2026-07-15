import { DEFAULT_SETTINGS, EMPTY_STATS, type Settings, type Stats } from './types';

// Storage injection for testing (guards missing localStorage in node)
let storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;

export function _setStorage(s: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  storage = s;
}

// Default storage resolver (lazy, never throws)
function getStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  if (storage !== null) {
    return storage;
  }

  // Use real localStorage if available, otherwise in-memory fallback
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }

  // Node environment or no localStorage: use in-memory fallback
  const fallback: Record<string, string> = {};
  return {
    getItem: (key) => fallback[key] ?? null,
    setItem: (key, value) => {
      fallback[key] = value;
    },
  };
}

export function loadSettings(): Settings {
  const store = getStorage();
  const key = 'bjtrainer.settings.v1';
  const json = store.getItem(key);

  if (!json) {
    return DEFAULT_SETTINGS;
  }

  try {
    const parsed = JSON.parse(json) as unknown;

    // Check version
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const obj = parsed as { version: unknown };
      if (obj.version === 1) {
        return parsed as Settings;
      }
    }

    return DEFAULT_SETTINGS;
  } catch {
    // JSON parse error or type mismatch
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  const store = getStorage();
  store.setItem('bjtrainer.settings.v1', JSON.stringify(s));
}

export function loadStats(): Stats {
  const store = getStorage();
  const key = 'bjtrainer.stats.v1';
  const json = store.getItem(key);

  if (!json) {
    return EMPTY_STATS;
  }

  try {
    const parsed = JSON.parse(json) as unknown;

    // Check version
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const obj = parsed as { version: unknown };
      if (obj.version === 1) {
        return parsed as Stats;
      }
    }

    return EMPTY_STATS;
  } catch {
    // JSON parse error or type mismatch
    return EMPTY_STATS;
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

    // Validate settings version
    const settingsObj = obj.settings as unknown;
    if (typeof settingsObj !== 'object' || settingsObj === null) {
      return { ok: false, error: 'Invalid settings object' };
    }
    const settingsWithVersion = settingsObj as { version?: unknown };
    if (settingsWithVersion.version !== 1) {
      return { ok: false, error: 'Invalid settings version' };
    }

    // Validate stats version
    const statsObj = obj.stats as unknown;
    if (typeof statsObj !== 'object' || statsObj === null) {
      return { ok: false, error: 'Invalid stats object' };
    }
    const statsWithVersion = statsObj as { version?: unknown };
    if (statsWithVersion.version !== 1) {
      return { ok: false, error: 'Invalid stats version' };
    }

    // All validations passed, save to storage
    saveSettings(settingsObj as Settings);
    saveStats(statsObj as Stats);

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
