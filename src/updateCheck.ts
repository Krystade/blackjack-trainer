/**
 * Keep an installed home-screen app on the current build.
 *
 * The operator runs this as a standalone app on an iPhone home screen. iOS
 * happily serves such an app its CACHED HTML on launch, and because the
 * document names hashed asset files, a stale document keeps loading the
 * stale bundle -- so the app can sit on an old version indefinitely while
 * the deployed site has moved on. There is no service worker here on
 * purpose: a misconfigured one on GitHub Pages can pin users to a stale
 * bundle permanently, which is the very failure this file exists to prevent.
 *
 * Instead, every build stamps `__BUILD_ID__` into the bundle and writes the
 * same id to `version.json` next to it (see vite.config.ts). A running tab
 * fetches that file on start and whenever it returns to the foreground; if
 * the deployed id differs from the one it is running, it reloads.
 *
 * The safety rule throughout: reload ONLY on positive evidence of a new
 * build. Every ambiguous case -- offline, a 404, GitHub's HTML error page,
 * malformed JSON -- must decide "not stale". A reload loop in an installed
 * app is far worse than briefly running an old build, because the app would
 * relaunch endlessly and never become usable.
 */

declare const __BUILD_ID__: string;

/** The build this tab is actually running. */
export function runningBuildId(): string | null {
  return typeof __BUILD_ID__ === 'string' && __BUILD_ID__ ? __BUILD_ID__ : null;
}

/** Pull the build id out of a fetched version document, or null if it isn't one. */
export function parseVersion(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return null;
  const id = (doc as { buildId?: unknown }).buildId;
  return typeof id === 'string' && id ? id : null;
}

export function isStale(running: string | null, deployed: string | null): boolean {
  if (!running || !deployed) return false;
  return running !== deployed;
}

/**
 * `version.json` sits beside the document. Resolving it relative to the
 * current URL (rather than as '/version.json') is what makes this work on a
 * GitHub Pages PROJECT subpath, where the domain root belongs to someone
 * else entirely.
 */
export function versionUrl(href: string): string {
  const url = new URL('version.json', href);
  // Defeat every layer of HTTP caching between here and the origin; the
  // whole point is to learn what is deployed right now.
  url.searchParams.set('t', String(Date.now()));
  return url.toString();
}

/**
 * Where to send the tab to pick up a new build. A plain `location.reload()`
 * is allowed to reuse the cached document -- which on iOS can mean landing
 * right back on the build we are trying to leave -- so the new id goes into
 * the query string, guaranteeing a URL the cache has never seen. Any
 * previous stamp is replaced rather than appended.
 */
export function reloadUrl(href: string, deployedId: string): string {
  const url = new URL(href);
  url.searchParams.set('v', deployedId);
  return url.toString();
}

/**
 * Belt-and-braces against a reload loop.
 *
 * The flow is sound in theory -- reload, get the new document, ids now
 * match -- but if anything ever served the OLD document from the new URL,
 * the tab would relaunch forever and the installed app would be bricked
 * until the user deleted it. So a given deployed id gets at most one reload
 * attempt per session; if that attempt does not take, the app simply keeps
 * running the older build, which is a bad day rather than a dead app.
 *
 * sessionStorage, not localStorage: the ceiling should lift on a genuine
 * fresh launch, not persist forever.
 */
const RELOAD_MARK = 'bjtrainer.reloadedFor';

function alreadyTried(deployedId: string): boolean {
  try {
    return window.sessionStorage.getItem(RELOAD_MARK) === deployedId;
  } catch {
    // Private mode or storage disabled: treat as "not tried", but the
    // minimum-interval guard still bounds how often we can attempt.
    return false;
  }
}

function markTried(deployedId: string): void {
  try {
    window.sessionStorage.setItem(RELOAD_MARK, deployedId);
  } catch {
    /* nothing to do; the interval guard remains */
  }
}

async function fetchDeployedId(href: string): Promise<string | null> {
  try {
    const res = await fetch(versionUrl(href), { cache: 'no-store' });
    if (!res.ok) return null;
    return parseVersion(await res.json());
  } catch {
    // Offline, blocked, or not JSON. Stay on the current build.
    return null;
  }
}

/**
 * Start watching for new builds: once now, and again each time the app comes
 * back to the foreground.
 *
 * `visibilitychange` is the event that fires when an installed app is
 * reopened or switched back to; `pageshow` covers the back/forward cache,
 * which iOS uses aggressively and which does NOT re-run module code.
 *
 * Returns a teardown function.
 */
export function startUpdateWatch(options: { minIntervalMs?: number } = {}): () => void {
  // A guard against hammering the network if the app is switched to and from
  // rapidly; also bounds any pathological reload attempt.
  const minInterval = options.minIntervalMs ?? 30_000;
  let lastCheck = 0;
  let stopped = false;

  const check = async (): Promise<void> => {
    if (stopped) return;
    const now = Date.now();
    if (now - lastCheck < minInterval) return;
    lastCheck = now;

    const deployed = await fetchDeployedId(window.location.href);
    if (stopped || !isStale(runningBuildId(), deployed)) return;
    if (alreadyTried(deployed!)) return;
    markTried(deployed!);
    window.location.replace(reloadUrl(window.location.href, deployed!));
  };

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void check();
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  window.addEventListener('focus', onVisible);
  void check();

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}
