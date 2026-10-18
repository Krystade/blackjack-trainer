import { DIAG_BASE_KEY, listDiagKeys } from '../diag/diagStore';

/**
 * WHEN A SAVE DOES NOT LAND, SAY SO (backlog F24).
 *
 * `writeKey` in persist.ts never throws -- a throw used to escape into click
 * handlers and freeze the drill -- but it returned `false` to callers that all
 * ignored it, so a full localStorage dropped every answer from then on and
 * nothing on screen changed. The callers are spread over every screen, so the
 * news travels here instead: persist.ts reports, and the shell shows a toast.
 *
 * Before reporting, persist.ts tries once to make room by shrinking the
 * diagnostic log, which is the one large blob here that exists for debugging
 * rather than for the operator's progress.
 */

export interface StorageFailure {
  /** The storage key that could not be written. */
  key: string;
  /** When it happened (ms since epoch). */
  at: number;
}

type Listener = (failure: StorageFailure) => void;

const listeners = new Set<Listener>();
let lastFailure: StorageFailure | null = null;

/** Called by persist.ts when a write failed even after making room. */
export function reportStorageFailure(key: string, now = Date.now()): void {
  lastFailure = { key, at: now };
  for (const fn of [...listeners]) {
    try {
      fn(lastFailure);
    } catch {
      /* a subscriber must never turn a failed save into a crash */
    }
  }
}

/** Subscribe to failed saves; returns the unsubscribe function. */
export function onStorageFailure(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The most recent failure this page load, if any. */
export function lastStorageFailure(): StorageFailure | null {
  return lastFailure;
}

/** Where diag/diagnosticLog.ts keeps its entries: the legacy key, and the prefix of its segments. */
export const DIAGNOSTICS_KEY = DIAG_BASE_KEY;

type MinimalStore = Pick<Storage, 'getItem' | 'setItem'> & {
  removeItem?: (k: string) => void;
  key?: (i: number) => string | null;
  length?: number;
};

/**
 * Make room by keeping only the newest quarter of the stored diagnostic log
 * (or dropping it outright if even that cannot be written). Returns true when
 * something was freed, so the caller knows a retry is worth it.
 *
 * G5: the log is a run of segment keys now (diag/diagStore.ts). Whole OLDEST
 * segments are removed until about the newest quarter of the entries is
 * left; a log still held in the single legacy key is sliced as before.
 * Segments are only ever removed here, never rewritten, so the log's own
 * index of them (which notices a missing key on its next flush) stays true.
 */
export function shrinkDiagnostics(store: MinimalStore, keepFraction = 0.25): boolean {
  let keys: string[];
  try {
    keys = listDiagKeys(store);
  } catch {
    return false;
  }
  if (keys.length === 0) return false;
  if (keys.length === 1 && keys[0] === DIAGNOSTICS_KEY) return shrinkSingleKey(store, keepFraction);

  try {
    const counts = keys.map((k) => {
      try {
        const parsed: unknown = JSON.parse(store.getItem(k) ?? '[]');
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    });
    let remaining = counts.reduce((a, b) => a + b, 0);
    const keep = Math.max(1, Math.floor(remaining * keepFraction));
    let freed = false;
    for (let i = 0; i < keys.length; i++) {
      // Always free something; past that, stop before the newest quarter.
      if (freed && remaining - counts[i]! < keep) break;
      removeOrBlank(store, keys[i]!);
      remaining -= counts[i]!;
      freed = true;
    }
    return freed;
  } catch {
    return false;
  }
}

function removeOrBlank(store: MinimalStore, key: string): void {
  if (typeof store.removeItem === 'function') store.removeItem(key);
  else store.setItem(key, '[]');
}

/** The single-key log an older build wrote: keep its newest quarter. */
function shrinkSingleKey(store: MinimalStore, keepFraction: number): boolean {
  let raw: string | null;
  try {
    raw = store.getItem(DIAGNOSTICS_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 4) {
      const keep = Math.max(1, Math.floor(parsed.length * keepFraction));
      const next = JSON.stringify(parsed.slice(parsed.length - keep));
      if (next.length < raw.length) {
        store.setItem(DIAGNOSTICS_KEY, next);
        return true;
      }
    }
  } catch {
    /* unparseable or still too big: drop it below */
  }
  try {
    removeOrBlank(store, DIAGNOSTICS_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the browser not to evict this origin's storage under pressure. iOS can
 * clear a home-screen app's localStorage after weeks unused; a persisted
 * origin is exempt from that "best effort" eviction where the browser honours
 * it. Fire-and-forget: refusal is normal and changes nothing.
 */
export async function requestPersistentStorage(
  nav: { storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } } | undefined =
    typeof navigator === 'undefined' ? undefined : (navigator as never),
): Promise<boolean | null> {
  const s = nav?.storage;
  if (!s || typeof s.persist !== 'function') return null;
  try {
    if (typeof s.persisted === 'function' && (await s.persisted())) return true;
    return await s.persist();
  } catch {
    return null;
  }
}

/** Tests only. */
export function _resetStorageHealthForTest(): void {
  listeners.clear();
  lastFailure = null;
}
