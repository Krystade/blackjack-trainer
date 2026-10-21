import { lazy } from 'react';
import type { ComponentType } from 'react';
import { reloadIfNewBuild } from '../updateCheck';
import { diag } from '../diag/diagnosticLog';

/**
 * F11 (W2-24): a rarely used screen, split into its own chunk and fetched the
 * first time it is opened.
 *
 * A failed fetch goes down the app's existing update path (updateCheck.ts,
 * `reloadIfNewBuild`): the usual cause is a tab on an older build asking for
 * a file a newer deploy has replaced, and the fix is to load the newer
 * build. While that reload is under way the screen stays suspended rather
 * than flashing an error. With no newer build to go to, the import error is
 * rethrown for the screen's ErrorBoundary, which keeps the tab bar alive.
 *
 * Offline is covered by the build, not here: every chunk is named in the
 * document's precache list (vite.config.ts), which the service worker stores
 * with the document.
 */
export function lazyScreen<P extends object>(
  name: string,
  load: () => Promise<ComponentType<P>>,
) {
  const screen = lazy(async () => {
    try {
      return { default: await load() };
    } catch (error) {
      diag('nav', 'chunk-load-failed', { screen: name, error: String(error) });
      if (await reloadIfNewBuild()) return new Promise<never>(() => {});
      throw error;
    }
  });
  /**
   * Wave O (review S2): fetch the chunk ahead of the first open. A failure
   * here is swallowed: the update path belongs to an actual open, not to a
   * background fetch on Home (that would reload the app under the user).
   */
  const preload = (): void => {
    load().catch(() => {});
  };
  return Object.assign(screen, { preload });
}

/**
 * Wave O (review S2): after the first paint, when the main thread is idle,
 * fetch the chunks of the screens opened most -- Play first -- so a first
 * open does not wait on the network or the parse.
 */
export function preloadWhenIdle(screens: readonly { preload: () => void }[]): () => void {
  if (typeof window === 'undefined') return () => {};
  let cancelled = false;
  let idleId: number | undefined;
  let timer: number | undefined;
  const run = () => {
    if (cancelled) return;
    for (const s of screens) s.preload();
  };
  const schedule = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === 'function') idleId = window.requestIdleCallback(run, { timeout: 3000 });
    else timer = window.setTimeout(run, 500);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', schedule);
    if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
