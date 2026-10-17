/*
 * The service worker, which is the only reason this app can run on a plane.
 *
 * Written by hand and deliberately small: it answers requests out of one cache
 * and otherwise stays out of the way. The list of what to hold is worked out in
 * the page (see src/offline/offlineAssets.ts) and written into this cache from
 * there, so nothing here has to know a build's hashed filenames.
 *
 * Three rules carry all the weight.
 *
 *   1. A NAVIGATION GOES TO THE NETWORK FIRST. Cache-first on the document is
 *      how an installed phone gets stuck on an old build forever; the cached
 *      copy is the fallback, not the answer.
 *   2. version.json IS NEVER TOUCHED. `updateCheck` polls it to learn whether a
 *      newer build has shipped, and a cached copy freezes that answer at the
 *      day the cache was warmed. It is the one url where a stale hit is worse
 *      than a failed fetch.
 *   1b. SO DO THE FEW FILES THAT CHANGE UNDER THEIR OWN NAME: the clip voice
 *      list and each voice's manifest (`clips/*.json`), the web manifest and
 *      the document itself. Cache-first on those served the clip manifest
 *      from the day it was saved forever, so a regenerated phrase silently
 *      fell back to the iOS voice (backlog F8). When a cached copy exists the
 *      network gets NAV_TIMEOUT_MS to answer before the cached copy is served
 *      and the fetch finishes in the background: weak signal in the car
 *      stalled a launch for 20s, where a fully offline launch takes 34ms (W14).
 *   1c. A FRESH DOCUMENT PRUNES THE OLD BUILD. Hashed `assets/` files never
 *      change, so every deploy added a new bundle beside the old ones and none
 *      were removed; a fresh document names the only ones this build uses.
 *   3. RANGE REQUESTS ARE ANSWERED PROPERLY. Clips play through an
 *      HTMLAudioElement as well as through Web Audio (see clips.ts), and a
 *      media element asks for byte ranges. Handing it a whole 200 where it
 *      asked for a range is how offline playback fails silently, so a cached
 *      body is sliced into a real 206.
 */
// v2: the cache-first manifests of v1 are dropped on activate rather than
// trusted, so a phone that saved a voice under v1 refetches its manifests.
const CACHE = 'bjtrainer-offline-v2';
// How long a request for a cached, changeable file waits on the network.
const NAV_TIMEOUT_MS = 2500;
const VERSION_FILE = 'version.json';

self.addEventListener('install', () => {
  // Nothing is precached here: the page knows the urls, and a worker that
  // downloads 9.5MB the moment it installs would do it on cellular data.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/** The document asked for by a plain fetch (the offline save), not a navigation. */
function isChangeableDocument(url) {
  return url.pathname.endsWith('.html') || url.pathname.endsWith('/');
}

function documentKey(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** A cached whole body, sliced to the range a media element asked for. */
async function sliceToRange(cached, rangeHeader) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!m) return null;
  const buf = await cached.arrayBuffer();
  const size = buf.byteLength;

  let start;
  let end;
  if (m[1] === '') {
    // `bytes=-N`: the last N bytes.
    const suffix = Number(m[2]);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }

  const headers = new Headers(cached.headers);
  headers.set('Accept-Ranges', 'bytes');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, statusText: 'Range Not Satisfiable', headers });
  }

  const body = buf.slice(start, end + 1);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(body.byteLength));
  return new Response(body, { status: 206, statusText: 'Partial Content', headers });
}

/** Files that change under the same url, so a cached copy is only a fallback. */
function isChangeable(url) {
  const path = url.pathname;
  if (path.endsWith('.webmanifest')) return true;
  if (path.endsWith('.html') || path.endsWith('/')) return true;
  return /\/clips\/.*\.json$/.test(path);
}

/**
 * Delete cached `assets/` files the fresh document does not name. Only when it
 * names at least one: an error page or a captive-portal login names none, and
 * must not empty the cache. (The build is one JS and one CSS file today; a
 * lazily loaded chunk would be refetched online after a prune.)
 */
async function pruneAssets(cache, docKey, html) {
  const assetsDir = new URL('assets/', docKey).toString();
  const named = new Set();
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], docKey);
      u.search = '';
      u.hash = '';
      if (u.toString().startsWith(assetsDir)) named.add(u.toString());
    } catch {
      /* not a url */
    }
  }
  if (named.size === 0) return;
  for (const req of await cache.keys()) {
    const u = new URL(req.url);
    u.search = '';
    const key = u.toString();
    if (key.startsWith(assetsDir) && !named.has(key)) await cache.delete(req);
  }
}

/**
 * Network first, cache as the fallback -- and, when there IS a cached copy, a
 * timeout, so weak signal costs NAV_TIMEOUT_MS rather than the browser's own
 * 20-plus seconds. The network fetch keeps going after the timeout (the event
 * is held open with waitUntil) and refreshes the cache for next time.
 */
async function networkFirst(event, cache, key, onFresh) {
  const network = (async () => {
    const fresh = await fetch(event.request);
    if (fresh && fresh.ok && fresh.status === 200) {
      await cache.put(key, fresh.clone());
      if (onFresh) {
        try {
          await onFresh(fresh.clone());
        } catch {
          /* pruning is housekeeping; never fail the response over it */
        }
      }
    }
    return fresh;
  })();
  event.waitUntil(network.catch(() => undefined));

  const hit = await cache.match(key);
  if (!hit) return network;

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NAV_TIMEOUT_MS);
  });
  try {
    const winner = await Promise.race([network, timeout]);
    // A server error page is worse than yesterday's copy of the file.
    if (winner && winner.ok) return winner;
    return hit;
  } catch {
    return hit;
  } finally {
    clearTimeout(timer);
  }
}

async function respond(event, url) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  const range = request.headers.get('range');

  if (request.mode === 'navigate') {
    const key = documentKey(url);
    try {
      return await networkFirst(event, cache, key, async (fresh) =>
        pruneAssets(cache, key, await fresh.text()),
      );
    } catch {
      throw new Error('offline and no cached document');
    }
  }

  if (!range && isChangeable(url)) {
    const key = isChangeableDocument(url) ? documentKey(url) : url.toString();
    return networkFirst(event, cache, key);
  }

  // Hashed assets and clips never change under their own url, so a hit is the
  // right answer and costs no network at all.
  const hit = await cache.match(url.toString());
  if (hit) {
    if (!range) return hit;
    const partial = await sliceToRange(hit.clone(), range);
    return partial ?? hit;
  }

  const fresh = await fetch(request);
  // A 206 is not a whole file, so storing one would poison the url with a
  // fragment that every later reader would take for the whole recording.
  if (fresh && fresh.ok && fresh.status === 200 && !range) {
    await cache.put(url.toString(), fresh.clone());
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith(`/${VERSION_FILE}`)) return;

  event.respondWith(respond(event, url));
});
