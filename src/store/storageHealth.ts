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

/** Where diag/diagnosticLog.ts keeps its entries. */
export const DIAGNOSTICS_KEY = 'bjtrainer.diagnostics.v1';

type MinimalStore = Pick<Storage, 'getItem' | 'setItem'> & { removeItem?: (k: string) => void };

/**
 * Make room by keeping only the newest quarter of the stored diagnostic log
 * (or dropping it outright if even that cannot be written). Returns true when
 * something was freed, so the caller knows a retry is worth it.
 */
export function shrinkDiagnostics(store: MinimalStore, keepFraction = 0.25): boolean {
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
    if (typeof store.removeItem === 'function') store.removeItem(DIAGNOSTICS_KEY);
    else store.setItem(DIAGNOSTICS_KEY, '[]');
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
