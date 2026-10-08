/**
 * Putting a flight's worth of the app on the phone before it leaves the ground.
 *
 * The service worker serves whatever is in the cache, but it only caches what
 * the app has already asked for -- so without this the first offline drill
 * plays the handful of clips that happened to come up on the ground and falls
 * back to live speech for the rest. One voice is 615 files and about 9.5MB:
 * small enough to hold, far too many to leave to chance.
 *
 * This runs in the PAGE, not in the service worker. The Cache API is the same
 * either way, and in the page the work is visible (a count the operator can
 * watch), cancellable by walking away, and -- the reason that matters here --
 * testable without a browser.
 *
 * The shape of every decision below is "airport wifi": it must not stop on the
 * first failure, must not re-download what it has, must not open hundreds of
 * sockets, and must never store a response it would later serve as audio.
 */

/** The slice of `Cache` this needs, so a test can supply one. */
export interface CacheLike {
  match(request: RequestInfo): Promise<Response | undefined>;
  put(request: RequestInfo, response: Response): Promise<void>;
}

export interface WarmProgress {
  done: number;
  total: number;
  bytes: number;
}

export interface WarmResult {
  /** Urls present in the cache at the end, downloaded now or already there. */
  cached: number;
  /** Urls that could not be stored, in the order they were given. */
  failed: string[];
  /** Bytes downloaded by THIS run, as reported by `content-length`. */
  bytes: number;
}

export interface WarmOptions {
  urls: readonly string[];
  cache: CacheLike;
  fetchFn: (url: string) => Promise<Response>;
  onProgress?: (progress: WarmProgress) => void;
  /**
   * How many downloads may be open at once. Six is the per-host limit browsers
   * have used for years, so more does not go faster and iOS starts dropping
   * sockets it has too many of.
   */
  concurrency?: number;
}

const DEFAULT_CONCURRENCY = 6;

export async function warmOfflineCache(opts: WarmOptions): Promise<WarmResult> {
  const { urls, cache, fetchFn, onProgress } = opts;
  const total = urls.length;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);

  let done = 0;
  let bytes = 0;
  let cached = 0;
  const failures = new Set<string>();
  let next = 0;

  const advance = (): void => {
    done += 1;
    onProgress?.({ done, total, bytes });
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      const url = urls[i]!;
      try {
        // Already there: the second press of the button costs nothing, which
        // is the difference between a usable button and a trap on a metered
        // connection.
        if (await cache.match(url)) {
          cached += 1;
          advance();
          continue;
        }
        const res = await fetchFn(url);
        if (!res.ok) {
          // A stored error page is served later AS AUDIO. Not downloading is
          // recoverable; storing the server's apology is not.
          failures.add(url);
          advance();
          continue;
        }
        bytes += Number(res.headers.get('content-length') ?? 0) || 0;
        await cache.put(url, res);
        cached += 1;
      } catch {
        // One file that times out must not take the other 614 with it: a
        // half-downloaded voice fails in the middle of a hand, which is worse
        // than a voice that was never downloaded at all.
        failures.add(url);
      }
      advance();
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total || 1) }, worker));

  return {
    cached,
    failed: urls.filter((u) => failures.has(u)),
    bytes,
  };
}
