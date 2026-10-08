/**
 * Turning the service worker on, and only where it belongs.
 *
 * NOT IN DEVELOPMENT. Vite serves modules the worker would then answer from a
 * cache, so HMR stops arriving and the e2e suite -- 716 specs sharing one dev
 * server -- would carry one spec's cached page into the next. The offline
 * behaviour is verified against the real build instead (`e2e/offline.spec.ts`),
 * which is where it has to work anyway.
 */
import { diag } from '../diag/diagnosticLog';

export function registerOfflineWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('e2e')) {
    return;
  }

  const base = (import.meta.env.BASE_URL as string | undefined) ?? '/';
  void navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .then((reg) => diag('offline', 'sw-registered', { scope: reg.scope }))
    .catch((e) => diag('offline', 'sw-failed', { error: String(e) }));
}
