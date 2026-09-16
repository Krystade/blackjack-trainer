import { diag } from '../diag/diagnosticLog';

// Screen Wake Lock wrapper — keeps the display on while an audio mode is
// running (the whole point of the app: a long car ride where the phone
// never gets looked at). Absence-guarded end to end: unsupported browsers
// and non-browser test environments must never see a thrown error here.
//
// Browsers silently drop a screen wake lock when the tab is hidden (screen
// locked, app backgrounded, tab switched). We track whether a lock is
// *wanted* and re-acquire it on the next `visibilitychange` back to
// visible, for as long as it's still wanted.

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

/**
 * The lock's life is logged because losing it is invisible and expensive.
 *
 * A dropped screen wake lock means the display sleeps, the page goes hidden,
 * and speech recognition stops -- with nothing on screen to say so, because
 * the screen is off. From the driver's seat that is indistinguishable from
 * the microphone simply failing, which is exactly the report this is chasing.
 */

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

function handleSentinelRelease(): void {
  sentinel = null;
  // Not the same as releaseWakeLock(): this fires when the PLATFORM takes the
  // lock back, which is the case worth seeing in a log.
  diag('wake', 'lost', { stillWanted: wanted });
}

/** In-flight acquire, so two callers racing cannot both request a lock. */
let acquiring: Promise<void> | null = null;

async function acquire(): Promise<void> {
  if (!isSupported()) return;

  // Already holding one: requesting a second would overwrite `sentinel` and
  // ORPHAN the first, leaving a live lock nothing can ever release. The drill
  // views call requestWakeLock() on every round start, so this fired on every
  // round after the first and the screen simply never slept again — a battery
  // drain in the car-mount case this module exists to serve.
  if (sentinel) return;
  if (acquiring) return acquiring;

  acquiring = (async () => {
    try {
      const lock = await navigator.wakeLock.request('screen');
      // Re-check after the await: a visibilitychange could have acquired one
      // while this request was in flight. Keep the winner, release the loser.
      if (sentinel) {
        try {
          await lock.release();
        } catch {
          // never throw
        }
        return;
      }
      sentinel = lock;
      lock.addEventListener('release', handleSentinelRelease);
      diag('wake', 'held');
    } catch (e) {
      diag('wake', 'refused', { error: String(e) });
      // Rejects when the tab is hidden or the platform refuses the lock —
      // never let that surface as an unhandled error.
      sentinel = null;
    } finally {
      acquiring = null;
    }
  })();

  return acquiring;
}

function handleVisibilityChange(): void {
  if (
    wanted &&
    !sentinel &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  ) {
    diag('wake', 're-acquire', { reason: 'visible' });
    void acquire();
  }
}

function addVisibilityListener(): void {
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
}

function removeVisibilityListener(): void {
  if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
}

export async function requestWakeLock(): Promise<void> {
  wanted = true;
  addVisibilityListener();
  await acquire();
}

export async function releaseWakeLock(): Promise<void> {
  if (wanted) diag('wake', 'released');
  wanted = false;
  removeVisibilityListener();
  const lock = sentinel;
  sentinel = null;
  if (lock) {
    try {
      lock.removeEventListener('release', handleSentinelRelease);
      await lock.release();
    } catch {
      // Already released or the platform refused — nothing more to do.
    }
  }
}

export function isWakeLockActive(): boolean {
  return sentinel !== null;
}
