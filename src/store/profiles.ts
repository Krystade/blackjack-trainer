import { DEFAULT_RULES } from '../engine/ruleset';
import { DEFAULT_SPREAD, DEFAULT_SEATS } from '../engine/game';
import type { SpreadRow, SeatConfig } from '../engine/game';
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

export function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for node test environments without a crypto.randomUUID shim.
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cloneProfile(p: Profile): Profile {
  return structuredClone(p);
}

/**
 * Backfill missing or partial seats in a profile by merging over DEFAULT_SEATS.
 * Ensures legacy profiles without seats get the defaults, and partially-specified
 * seats get filled in from the defaults.
 */
function backfillSeats(p: Profile): Profile {
  if (!p.seats) {
    return {
      ...p,
      seats: { ...DEFAULT_SEATS },
    };
  }

  // Merge partial seats with defaults
  const mergedSeats: SeatConfig = {
    playerHands: p.seats.playerHands ?? DEFAULT_SEATS.playerHands,
    bots: p.seats.bots ?? DEFAULT_SEATS.bots,
    botMistakePct: p.seats.botMistakePct ?? DEFAULT_SEATS.botMistakePct,
    playerPosition: p.seats.playerPosition ?? DEFAULT_SEATS.playerPosition,
  };

  return {
    ...p,
    seats: mergedSeats,
  };
}

/**
 * `seats` is REQUIRED on `Profile` (src/store/types.ts), but the load path
 * always backfills it (see `backfillSeats` below) -- so a profile with
 * `seats` entirely absent is NOT corrupt, it's just pre-seats-era legacy
 * data, and must still validate here. Only reject when `seats` is PRESENT
 * but hand-corrupted: not an object, or a present field of the wrong type.
 * A present-but-partial seats object (some fields missing) is fine --
 * backfillSeats merges the rest in from DEFAULT_SEATS via `??`, which only
 * catches null/undefined, not wrong-typed-but-defined values. Without this
 * check, a corrupted field (e.g. `playerHands: "two"`) would silently
 * survive the merge and crash `ProfileEditForm` at `draft.seats.playerHands`.
 */
function isValidSeats(seats: unknown): boolean {
  if (seats === undefined || seats === null) return true; // absent -- backfillSeats handles it
  if (typeof seats !== 'object' || Array.isArray(seats)) return false;
  const s = seats as Record<string, unknown>;
  if ('playerHands' in s && typeof s.playerHands !== 'number') return false;
  if ('bots' in s && typeof s.bots !== 'number') return false;
  if ('botMistakePct' in s && typeof s.botMistakePct !== 'number') return false;
  if ('playerPosition' in s && typeof s.playerPosition !== 'number') return false;
  return true;
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
    typeof obj.betSpreadOn === 'boolean' &&
    isValidSeats(obj.seats)
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
    seats: { ...DEFAULT_SEATS },
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
      seats: { ...base.seats },
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
 *   references with storage or between calls). Missing or partial seats are
 *   backfilled with DEFAULT_SEATS during load.
 */
export function loadProfiles(): Profile[] {
  const store = getStorage();
  const json = store.getItem(PROFILES_KEY);

  if (json !== null) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (isValidProfilesArray(parsed) && parsed.length > 0) {
        return parsed.map((p) => backfillSeats(cloneProfile(p)));
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
