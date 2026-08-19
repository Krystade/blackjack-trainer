/**
 * Stop two open tabs from destroying each other's work.
 *
 * Every store here writes a WHOLE blob: `saveStats` serialises the entire
 * stats object, `saveSettings` the entire settings object. Each tab holds its
 * own copy in React state. So with two tabs open, the damage is not the write
 * itself -- it is that a tab keeps drilling against an in-memory snapshot
 * taken before the other tab's write, and then saves that stale snapshot back
 * over the newer one. Everything the other tab did in between is gone, with
 * no error and nothing to undo.
 *
 * The fix is to stop tabs from holding stale state: when another tab writes,
 * this notifies subscribers so they can re-read what is now on disk.
 *
 * THE ASYMMETRY THAT MAKES THIS WORK, and the easiest thing to get backwards:
 * the `storage` event fires in every OTHER tab and never in the one that
 * performed the write. That is exactly the semantics wanted -- a tab must not
 * react to itself -- and it means no echo-suppression bookkeeping is needed.
 * It also means nothing here writes to storage, so there is no feedback loop
 * to guard against: this module only ever listens and reports.
 *
 * INTEGRATION (this module deliberately knows nothing about React):
 *
 *     useSyncExternalStore(
 *       (cb) => subscribeToExternalWrites(['bjtrainer.settings.v1'], cb),
 *       () => externalWriteVersion(),
 *     )
 *
 * or, more simply, call `subscribeToExternalWrites` in an effect and re-read
 * the store in the callback. `externalWriteVersion` exists so a
 * `useSyncExternalStore` snapshot has a stable, changing scalar to compare.
 */

/** Every key this app owns. A write to anything else is not ours to care about. */
export const OWNED_KEYS = [
  'bjtrainer.settings.v1',
  'bjtrainer.stats.v1',
  'bjtrainer.profiles.v1',
  'bjtrainer.activeProfile.v1',
  'bjtrainer.flashsr.v1',
  'bjtrainer.quizsr.v1',
] as const;

export interface ExternalWrite {
  key: string;
  newValue: string | null;
}

/**
 * Bumped on every external write, so a `useSyncExternalStore` snapshot can be
 * a plain scalar rather than an object that would look new on every read.
 */
let version = 0;

export function externalWriteVersion(): number {
  return version;
}

type Listener = (write: ExternalWrite) => void;

/**
 * Call `listener` when ANOTHER tab writes one of `keys`.
 *
 * Returns an unsubscribe function, and is safe to call in an environment with
 * no window (SSR, the DOM-less test config) where it is simply inert.
 */
export function subscribeToExternalWrites(
  keys: readonly string[],
  listener: Listener,
): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }

  const watched = new Set(keys);

  const onStorage = (event: StorageEvent): void => {
    // A null key means the whole store was cleared (storage.clear()), which
    // affects everything we own and must not be ignored.
    if (event.key === null) {
      version += 1;
      listener({ key: '', newValue: null });
      return;
    }
    if (!watched.has(event.key)) return;
    // Some browsers fire for a write that did not change the value; there is
    // nothing to re-read in that case.
    if (event.oldValue === event.newValue) return;

    version += 1;
    listener({ key: event.key, newValue: event.newValue });
  };

  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** Test-only: reset the version counter between specs. */
export function _resetCrossTabForTest(): void {
  version = 0;
}
