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
  return lazy(async () => {
    try {
      return { default: await load() };
    } catch (error) {
      diag('nav', 'chunk-load-failed', { screen: name, error: String(error) });
      if (await reloadIfNewBuild()) return new Promise<never>(() => {});
      throw error;
    }
  });
}
