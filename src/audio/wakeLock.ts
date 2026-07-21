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

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

function handleSentinelRelease(): void {
  sentinel = null;
}

async function acquire(): Promise<void> {
  if (!isSupported()) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    sentinel = lock;
    lock.addEventListener('release', handleSentinelRelease);
  } catch {
    // Rejects when the tab is hidden or the platform refuses the lock —
    // never let that surface as an unhandled error.
    sentinel = null;
  }
}

function handleVisibilityChange(): void {
  if (
    wanted &&
    !sentinel &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  ) {
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
