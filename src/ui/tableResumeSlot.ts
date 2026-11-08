import { getStorage } from '../store/persist';

/**
 * Track 3: the disk slot the open Play table lives in (ui/tableResume.ts),
 * without the engine. App and the ErrorBoundary clear it at first paint, so
 * this module must stay light: Wave O keeps the game and the side-bet tables
 * out of the entry chunk (scripts/entryGraph.test.ts).
 */

export const TABLE_RESUME_KEY = 'bjtrainer.tableResume.v1';
export const TABLE_ROUND_KEY = 'bjtrainer.tableRound.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'> & { removeItem?: (k: string) => void };

function store(): Store | null {
  try {
    return getStorage() as Store;
  } catch {
    return null;
  }
}

export function readSlot(key: string): unknown {
  try {
    const raw = store()?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** False when storage refused (full): the stats were written first, so a lost resume point costs a fresh shoe, never the session. */
export function writeSlot(key: string, value: string): boolean {
  try {
    store()?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeSlot(key: string): void {
  const s = store();
  if (!s) return;
  try {
    if (typeof s.removeItem === 'function') s.removeItem(key);
    else s.setItem(key, '');
  } catch {
    /* a lost clear leaves a table the key check still guards */
  }
}

/** Set when this page restored a table and it has not saved a round since. */
let restoredUnsaved = false;

export function markRestored(on: boolean): void {
  restoredUnsaved = on;
}

/** Discard the saved table: End, New shoe, a new table asked for (App.applyProfile). */
export function clearSavedTable(): void {
  removeSlot(TABLE_RESUME_KEY);
  removeSlot(TABLE_ROUND_KEY);
  restoredUnsaved = false;
}

/** ErrorBoundary: a crash before a restored table saved a round may be the restore itself -- don't restore into it again. */
export function noteCrash(): void {
  if (restoredUnsaved) clearSavedTable();
}
