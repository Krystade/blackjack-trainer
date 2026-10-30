/**
 * The whole flight, in one call: the app's own files plus every recording of
 * the voice that will be speaking.
 *
 * Both halves matter and they fail differently. Without the shell the
 * installed app opens on Safari's no-internet page and there is nothing to
 * run. With the shell but no clips it runs and talks, in whatever live voice
 * iOS has locally, which is the fallback -- not the thing Jack recorded 615
 * files for.
 */
import { warmOfflineCache, type CacheLike, type WarmProgress, type WarmResult } from './warmCache';
import { shellUrls, clipUrlsFor } from './offlineAssets';

// Must match CACHE in public/sw.js (serviceWorker.test.ts checks).
export const OFFLINE_CACHE = 'bjtrainer-offline-v2';

export interface FlightWarmDeps {
  documentUrl: string;
  origin: string;
  /** Same-origin urls the running page has already loaded. */
  resources: readonly string[];
  clipsBase: string;
  /** The chosen clip voice, or null to warm the shell alone. */
  voiceId: string | null;
  loadManifest: (voiceId: string) => Promise<Readonly<Record<string, string>>>;
  cache: CacheLike;
  fetchFn: (url: string) => Promise<Response>;
  onProgress?: (progress: WarmProgress) => void;
  concurrency?: number;
}

export async function warmForFlight(deps: FlightWarmDeps): Promise<WarmResult> {
  const urls = shellUrls({
    documentUrl: deps.documentUrl,
    resources: deps.resources,
    origin: deps.origin,
  });

  if (deps.voiceId) {
    const manifest = await deps.loadManifest(deps.voiceId);
    urls.push(...clipUrlsFor(deps.voiceId, manifest, deps.clipsBase));
  }

  return warmOfflineCache({
    urls,
    cache: deps.cache,
    fetchFn: deps.fetchFn,
    onProgress: deps.onProgress,
    concurrency: deps.concurrency,
  });
}

/**
 * B26: "Clear" in Settings > Offline removes the SAVED VOICE only. It used to
 * delete the whole cache, the app shell with it (document, assets, icons), so
 * a cold launch with no signal before the next online one showed Safari's
 * cannot-open page in the installed app. The shell stays; only /clips/ go.
 * Returns how many entries were removed.
 */
export async function clearSavedVoice(cache: {
  keys: () => Promise<readonly Request[]>;
  delete: (req: Request) => Promise<boolean>;
}): Promise<number> {
  let n = 0;
  for (const req of await cache.keys()) {
    let path: string;
    try {
      path = new URL(req.url).pathname;
    } catch {
      continue;
    }
    if (!path.includes('/clips/')) continue;
    if (await cache.delete(req)) n += 1;
  }
  return n;
}
