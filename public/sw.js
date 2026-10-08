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
 *   3. RANGE REQUESTS ARE ANSWERED PROPERLY. Clips play through an
 *      HTMLAudioElement as well as through Web Audio (see clips.ts), and a
 *      media element asks for byte ranges. Handing it a whole 200 where it
 *      asked for a range is how offline playback fails silently, so a cached
 *      body is sliced into a real 206.
 */
const CACHE = 'bjtrainer-offline-v1';
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

async function respond(request, url) {
  const cache = await caches.open(CACHE);
  const range = request.headers.get('range');

  if (request.mode === 'navigate') {
    const key = documentKey(url);
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) await cache.put(key, fresh.clone());
      return fresh;
    } catch {
      const hit = await cache.match(key);
      if (hit) return hit;
      throw new Error('offline and no cached document');
    }
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

  event.respondWith(respond(request, url));
});
