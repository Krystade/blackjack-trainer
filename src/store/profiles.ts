import { DEFAULT_RULES } from '../engine/ruleset';
import { DEFAULT_SPREAD } from '../engine/game';
import type { SpreadRow } from '../engine/game';
import type { Profile } from './types';

// Storage injection for testing (guards missing localStorage in node).
// Deliberately local to this module (not shared with persist.ts) per the
// task's isolation constraint; in the real app both resolve to the same
// window.localStorage, so keys never collide across modules.
let storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;

export function _setStorage(s: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  storage = s;
}

// Single persistent in-memory fallback for environments without localStorage.
const fallbackMap = new Map<string, string>();
const fallbackStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: (key) => fallbackMap.get(key) ?? null,
  setItem: (key, value) => {
    fallbackMap.set(key, value);
  },
};

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  if (storage !== null) {
    return storage;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return fallbackStorage;
}

const PROFILES_KEY = 'bjtrainer.profiles.v1';
const ACTIVE_KEY = 'bjtrainer.activeProfile.v1';
// Raw read only (never via loadSettings) to avoid coupling to persist.ts.
const SETTINGS_KEY = 'bjtrainer.settings.v1';

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for node test environments without a crypto.randomUUID shim.
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cloneProfile(p: Profile): Profile {
  return structuredClone(p);
}

function isValidProfile(p: unknown): p is Profile {
  if (typeof p !== 'object' || p === null) {
    return false;
  }
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.rules === 'object' &&
    obj.rules !== null &&
    typeof obj.penetration === 'number' &&
    Array.isArray(obj.spread) &&
    typeof obj.bankrollStart === 'number' &&
    typeof obj.countCheckEvery === 'number' &&
    typeof obj.betSpreadOn === 'boolean'
  );
}

function isValidProfilesArray(parsed: unknown): parsed is Profile[] {
  return Array.isArray(parsed) && parsed.every(isValidProfile);
}

/** Fresh default profile: v1 parity rules, v1 default ramp/bankroll/cadence. */
export function makeDefaultProfile(): Profile {
  return {
    id: makeId(),
    name: 'Default (6D H17)',
    rules: structuredClone(DEFAULT_RULES),
    penetration: 0.75,
    spread: DEFAULT_SPREAD.map((row) => ({ ...row })),
    bankrollStart: 100,
    countCheckEvery: 5,
    betSpreadOn: false,
  };
}

/**
 * Build the migrated "Default (6D H17)" profile from a raw v1 settings blob
 * (read directly, not via loadSettings, to avoid coupling to persist.ts).
 * Carries over betSpreadOn, spread, bankrollStart, countCheckEvery,
 * penetration; everything else (rules, name, id) is fresh-default. Never
 * throws: missing/corrupt/wrong-version input falls back to the plain
 * default profile.
 */
function buildDefaultFromSettingsBlob(json: string | null): Profile {
  const base = makeDefaultProfile();
  if (!json) {
    return base;
  }

  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return base;
    }
    const p = parsed as Record<string, unknown>;
    if ((p as { version?: unknown }).version !== 1) {
      return base;
    }

    return {
      ...base,
      spread: Array.isArray(p.spread)
        ? (p.spread as SpreadRow[]).map((row) => ({ ...row }))
        : base.spread,
      bankrollStart:
        typeof p.bankrollStart === 'number' ? p.bankrollStart : base.bankrollStart,
      countCheckEvery:
        typeof p.countCheckEvery === 'number' ? p.countCheckEvery : base.countCheckEvery,
      penetration: typeof p.penetration === 'number' ? p.penetration : base.penetration,
      betSpreadOn: typeof p.betSpreadOn === 'boolean' ? p.betSpreadOn : base.betSpreadOn,
    };
  } catch {
    return base;
  }
}

function persistFreshDefault(profile: Profile): void {
  saveProfiles([profile]);
  setActiveProfile(profile.id);
}

/**
 * Always returns at least one profile.
 *
 * - Profiles key absent entirely (true first run): migrate from the v1
 *   settings blob if present, else a plain default. Persists immediately
 *   and sets it active, so this branch only ever runs once (idempotent).
 * - Profiles key present but corrupt/wrong-shape/empty: reset to a fresh
 *   plain default (never re-attempts settings migration) and persist.
 * - Profiles key present and valid: return a deep-cloned copy (no shared
 *   references with storage or between calls).
 */
export function loadProfiles(): Profile[] {
  const store = getStorage();
  const json = store.getItem(PROFILES_KEY);

  if (json !== null) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (isValidProfilesArray(parsed) && parsed.length > 0) {
        return parsed.map(cloneProfile);
      }
    } catch {
      // corrupt JSON: fall through to the plain-default reset below
    }

    const fresh = makeDefaultProfile();
    persistFreshDefault(fresh);
    return [cloneProfile(fresh)];
  }

  // Profiles key has never been written: first-run migration.
  const settingsJson = store.getItem(SETTINGS_KEY);
  const migrated = buildDefaultFromSettingsBlob(settingsJson);
  persistFreshDefault(migrated);
  return [cloneProfile(migrated)];
}

export function saveProfiles(profiles: Profile[]): void {
  const store = getStorage();
  store.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

/**
 * Returns the active profile, guaranteed to exist. If the stored active id
 * is missing or dangling (points at a deleted profile), falls back to the
 * first profile and heals the stored pointer to match.
 */
export function getActiveProfile(): Profile {
  const profiles = loadProfiles();
  const store = getStorage();
  const activeId = store.getItem(ACTIVE_KEY);
  const found = activeId !== null ? profiles.find((p) => p.id === activeId) : undefined;
  if (found) {
    return found;
  }

  const first = profiles[0]!;
  store.setItem(ACTIVE_KEY, first.id);
  return first;
}

export function setActiveProfile(id: string): void {
  const store = getStorage();
  store.setItem(ACTIVE_KEY, id);
}
