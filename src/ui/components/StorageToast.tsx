import { useEffect, useState } from 'react';
import { onStorageFailure, lastStorageFailure } from '../../store/storageHealth';
import './storageToast.css';

/**
 * "This phone could not save" -- shown when a write to storage fails even
 * after the diagnostic log was shrunk to make room (backlog F24).
 *
 * Every save in the app goes through persist.ts's writeKey, which reports here
 * rather than to its dozen callers, so one toast in the shell covers them all.
 * Not a modal: the drill underneath keeps going, and the operator can finish
 * the hand before dealing with it. It stays until dismissed, because a toast
 * that faded on its own in the car would be missed and the losses would carry
 * on silently.
 */
export function StorageToast() {
  const [failedKey, setFailedKey] = useState<string | null>(() => lastStorageFailure()?.key ?? null);

  useEffect(() => onStorageFailure((f) => setFailedKey(f.key)), []);

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
        onClick={() => setFailedKey(null)}
      >
        &times;
      </button>
    </div>
  );
}
