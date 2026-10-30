import { diag } from '../diag/diagnosticLog';

/**
 * KEEP THE BYTES WE COULD NOT READ, BEFORE ANYTHING OVERWRITES THEM.
 *
 * "Corrupt" and "absent" return the same value from every reader in this app
 * (an empty deck, a fresh progress record, a default profile), and every
 * caller is read-modify-write. So a blob truncated by an interrupted write, or
 * written by a NEWER build (a rollback, a stale service-worker build), read as
 * empty, and the next answer committed that emptiness over the only copy.
 * persist.ts did this for settings and stats; B5 gives every store that holds
 * history the same step, through this one function.
 *
 * TWO SLOTS (B13). `<key>.corrupt` is written once and never replaced: the
 * first failure is the one closest to the original. A later, DIFFERENT bad
 * blob goes to `<key>.corrupt.2`, which always holds the newest -- so a second
 * failure months later keeps those months too, and the same bad bytes seen
 * again cost nothing. Both ride in every backup (persist.ts exportAll).
 *
 * Every quarantine is logged (once per distinct blob per page load), so a
 * later exported log says what was set aside and when.
 */

export type GraveStore = Pick<Storage, 'getItem' | 'setItem'>;

export type QuarantineOutcome = 'kept' | 'kept-newest' | 'duplicate' | 'failed';

export function graveKeys(key: string): [string, string] {
  return [`${key}.corrupt`, `${key}.corrupt.2`];
}

const logged = new Set<string>();

export function quarantineRaw(store: GraveStore, key: string, raw: string, reason: string): QuarantineOutcome {
  const [first, second] = graveKeys(key);
  let kept: QuarantineOutcome;
  try {
    const a = store.getItem(first);
    if (a === null) {
      store.setItem(first, raw);
      kept = 'kept';
    } else if (a === raw || store.getItem(second) === raw) {
      kept = 'duplicate';
    } else {
      store.setItem(second, raw);
      kept = 'kept-newest';
    }
  } catch {
    // A full quota is exactly when this matters and exactly when it cannot
    // be done. Nothing else in the load path may fail because of it.
    kept = 'failed';
  }
  const tag = `${key}|${raw.length}|${raw.slice(0, 64)}|${kept}`;
  if (!logged.has(tag)) {
    logged.add(tag);
    try {
      diag('err', 'storage-quarantined', { key, bytes: raw.length, reason, kept });
    } catch {
      /* a log must never cost a load */
    }
  }
  return kept;
}

/** The base keys (from `keys`) that have bytes set aside, for the notice that says so. */
export function quarantinedKeys(store: GraveStore, keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    try {
      const [a, b] = graveKeys(key);
      if (store.getItem(a) !== null || store.getItem(b) !== null) out.push(key);
    } catch {
      /* unreadable storage: nothing to report */
    }
  }
  return out;
}
