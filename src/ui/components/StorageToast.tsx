import { useEffect, useState } from 'react';
import { onStorageFailure, lastStorageFailure } from '../../store/storageHealth';
import './storageToast.css';

/**
 * Keys whose failure the operator has already dismissed this page load. Once
 * storage is full every answer fails the same stats write, and a toast that
 * came straight back after Dismiss kept the drill's top bar covered for the
 * rest of the run. A different key failing still shows it.
 */
const dismissed = new Set<string>();

const shown = (key: string | undefined | null): string | null =>
  key && !dismissed.has(key) ? key : null;

/**
 * "This phone could not save" -- shown when a write to storage fails even
 * after the diagnostic log was shrunk to make room (backlog F24).
 *
 * The saves that go through persist.ts's writeKey -- stats (every answer and
 * session), settings, and a backup restore -- report here rather than to their
 * dozen callers, so one toast in the shell covers them. NOT every write does:
 * the spaced-repetition decks (drills/gradeAnswer.ts), profiles
 * (store/profiles.ts), the Mastery record, the chart view and the field-test
 * and Test Kit progress still call localStorage themselves and swallow a
 * failure. Not a modal: the drill underneath keeps going, and the operator can
 * finish the hand before dealing with it. It stays until dismissed, because a
 * toast that faded on its own in the car would be missed.
 */
export function StorageToast() {
  const [failedKey, setFailedKey] = useState<string | null>(() => shown(lastStorageFailure()?.key));

  useEffect(
    () =>
      onStorageFailure((f) => {
        if (shown(f.key)) setFailedKey(f.key);
      }),
    [],
  );

  if (!failedKey) return null;

  return (
    <div className="storage-toast" role="alert" data-testid="storage-toast" data-key={failedKey}>
      <span className="storage-toast-text">
        <strong>Not saved.</strong> This phone&rsquo;s storage for the app is full, so recent
        answers may be lost. Export a backup from Stats, then clear the diagnostic log in
        Settings.
      </span>
      <button
        type="button"
        className="storage-toast-close"
        aria-label="Dismiss"
        onClick={() => {
          dismissed.add(failedKey);
          setFailedKey(null);
        }}
      >
        &times;
      </button>
    </div>
  );
}
