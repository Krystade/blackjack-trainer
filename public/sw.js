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
 *   1c. A DOCUMENT IS STORED ONLY WITH ITS FILES, AND THEN PRUNES THE OLD
 *      BUILD. A cached document whose hashed `assets/` files are not cached is
 *      a white screen on the next offline launch -- which is what a document
 *      arriving after the timeout above used to leave behind, since the page
 *      running was the old build and never asked for the new files. So the
 *      worker fetches them first (storeDocument). And because hashed files
 *      never change, every deploy used to add a bundle beside the old ones;
 *      once a fresh document is stored, files neither it nor the document the
 *      page was given name are deleted.
 *   3. RANGE REQUESTS ARE ANSWERED PROPERLY. Clips play through an
 *      HTMLAudioElement as well as through Web Audio (see clips.ts), and a
 *      media element asks for byte ranges. Handing it a whole 200 where it
 *      asked for a range is how offline playback fails silently, so a cached
 *      body is sliced into a real 206.
 */
// v2: the manifests v1 served cache-first are network-first here. What v1
// saved is carried across on activate (see carryOver), not thrown away.
const CACHE = 'bjtrainer-offline-v2';
// Every cache this app has ever named starts with this. Nothing else on the
// origin is ours: GitHub Pages serves all of an account's projects from one.
const CACHE_PREFIX = 'bjtrainer-offline-';
// How long a request for a cached, changeable file waits on the network.
const NAV_TIMEOUT_MS = 2500;
// B8: how long an UPDATE RELOAD (a navigation carrying ?v=<build>, made by
// updateCheck once version.json named a newer build) waits for the new
// document. The 2.5s race above served the cached OLD document on weak
// signal, and the once-per-session guard then kept the phone on it. The
// reload is already held off while a run is live, so waiting is cheap here.
const UPDATE_NAV_TIMEOUT_MS = 15000;
const VERSION_FILE = 'version.json';

self.addEventListener('install', () => {
  // Nothing is precached here: the page knows the urls, and a worker that
  // downloads 9.5MB the moment it installs would do it on cellular data.
  self.skipWaiting();
});

/**
 * Copy what an older cache of this app holds into this one.
 *
 * The v1 -> v2 rename must not cost the voice saved for a flight (615 clips,
 * about 9.5MB) or the offline shell, and nothing on screen would tell the
 * operator to save again. Everything comes across, the manifests too: they are
 * network-first here, so the first online fetch replaces them, and offline a
 * stale manifest still beats none (a stale one loses only the phrases changed
 * since; a missing one loses every clip). An entry this cache already holds is
 * newer and stays.
 */
async function carryOver(oldName) {
  const from = await caches.open(oldName);
  const to = await caches.open(CACHE);
  const requests = await from.keys();
  let next = 0;
  const worker = async () => {
    while (next < requests.length) {
      const req = requests[next++];
      try {
        if (await to.match(req)) continue;
        const res = await from.match(req);
        if (res) await to.put(req, res);
      } catch {
        /* one entry that will not copy must not cost the rest */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key === CACHE || !key.startsWith(CACHE_PREFIX)) continue;
        try {
          await carryOver(key);
        } catch {
          /* the copy is a kindness; dropping the old cache is not optional */
        }
        await caches.delete(key);
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

/** The `assets/` urls a document names, without query or hash. */
function namedAssets(docKey, html) {
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
  return named;
}

/** Delete cached `assets/` files that are not in `keep`. */
async function pruneAssets(cache, docKey, keep) {
  const assetsDir = new URL('assets/', docKey).toString();
  for (const req of await cache.keys()) {
    const u = new URL(req.url);
    u.search = '';
    const key = u.toString();
    if (key.startsWith(assetsDir) && !keep.has(key)) await cache.delete(req);
  }
}

/** Downloads under way, by cache key, so two askers share one download. */
const inFlight = new Map();

/**
 * Fetch a whole file and store it -- joining a download of the same url that
 * is already under way rather than starting a second one. The page asks for a
 * new build's JS and CSS at the same moment the worker fills them in behind a
 * fresh document (storeDocument), and that is one download, not two, on
 * cellular data. Resolves to the network response when this call made the
 * request, or to the cached copy once another caller's download stored it.
 */
async function fetchAndStore(cache, key, request) {
  const pending = inFlight.get(key);
  if (pending) {
    await pending;
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  let finish;
  const mine = new Promise((resolve) => {
    finish = resolve;
  });
  inFlight.set(key, mine);
  try {
    const fresh = await fetch(request);
    // A 206 is not a whole file, so storing one would poison the url with a
    // fragment that every later reader would take for the whole recording.
    if (fresh && fresh.ok && fresh.status === 200) await cache.put(key, fresh.clone());
    return fresh;
  } finally {
    if (inFlight.get(key) === mine) inFlight.delete(key);
    finish();
  }
}

/**
 * Store a fresh document -- but only once every `assets/` file it names is in
 * the cache, and prune the old build only after that.
 *
 * A document is a promise about files: it names hashed JS and CSS, and an
 * offline launch that gets the document but not its files is a white screen.
 * When the network answers in time the page fetches those files itself; when
 * it answers late (the timeout already served the cached build) nothing
 * would, so they are fetched here. Until they are all stored the older
 * document stays, and the older document's files are all there.
 *
 * `served` is the document the page was actually given when that was not this
 * one: its files survive the prune, because the page now running is about to
 * ask for them.
 */
async function storeDocument(cache, key, fresh, served, prune) {
  const named = namedAssets(key, await fresh.clone().text());
  // An error page or a captive-portal login names no assets: it is not the
  // app, and must not replace the shell (or empty the cache by pruning).
  if (named.size === 0) return;
  const stored = await Promise.all(
    [...named].map(async (url) => {
      try {
        if (await cache.match(url)) return true;
        await fetchAndStore(cache, url, new Request(url));
        return Boolean(await cache.match(url));
      } catch {
        return false;
      }
    }),
  );
  if (stored.includes(false)) return;
  await cache.put(key, fresh);
  if (!prune) return;
  const keep = new Set(named);
  if (served) for (const url of namedAssets(key, await served.text())) keep.add(url);
  await pruneAssets(cache, key, keep);
}

/**
 * Network first, cache as the fallback -- and, when there IS a cached copy, a
 * timeout, so weak signal costs NAV_TIMEOUT_MS rather than the browser's own
 * 20-plus seconds.
 *
 * What the page is given and what the cache keeps are separate decisions.
 * `store(fresh, served)` runs in the background (held open with waitUntil)
 * once a whole 200 arrives, in time or not; `served` is null when the page was
 * given this very response, or a copy of the cached one when the timeout won.
 */
async function networkFirst(event, cache, key, store, timeoutMs = NAV_TIMEOUT_MS) {
  // Copied the moment it arrives, before the page can start reading the body.
  const network = fetch(event.request).then((fresh) => ({
    fresh,
    copy: fresh && fresh.ok && fresh.status === 200 ? fresh.clone() : null,
  }));
  let decide;
  const served = new Promise((resolve) => {
    decide = resolve;
  });
  event.waitUntil(
    (async () => {
      const { copy } = await network;
      if (!copy) return;
      try {
        await store(copy, await served);
      } catch {
        /* storing is housekeeping; never fail the response over it */
      }
    })().catch(() => undefined),
  );

  let hit;
  try {
    hit = await cache.match(key);
  } catch {
    hit = undefined;
  }
  if (!hit) {
    decide(null);
    return (await network).fresh;
  }

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  let winner = null;
  try {
    winner = await Promise.race([network, timeout]);
  } catch {
    winner = null;
  } finally {
    clearTimeout(timer);
  }
  // A server error page is worse than yesterday's copy of the file.
  if (winner && winner.fresh && winner.fresh.ok) {
    decide(null);
    return winner.fresh;
  }
  decide(hit.clone());
  return hit;
}

async function respond(event, url) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  const range = request.headers.get('range');

  if (request.mode === 'navigate') {
    const key = documentKey(url);
    const wait = url.searchParams.has('v') ? UPDATE_NAV_TIMEOUT_MS : NAV_TIMEOUT_MS;
    try {
      return await networkFirst(
        event,
        cache,
        key,
        (fresh, served) => storeDocument(cache, key, fresh, served, true),
        wait,
      );
    } catch {
      throw new Error('offline and no cached document');
    }
  }

  if (!range && isChangeable(url)) {
    if (isChangeableDocument(url)) {
      const key = documentKey(url);
      return networkFirst(event, cache, key, (fresh) =>
        storeDocument(cache, key, fresh, null, false),
      );
    }
    const key = url.toString();
    return networkFirst(event, cache, key, (fresh) => cache.put(key, fresh));
  }

  // Hashed assets and clips never change under their own url, so a hit is the
  // right answer and costs no network at all.
  const hit = await cache.match(url.toString());
  if (hit) {
    if (!range) return hit;
    const partial = await sliceToRange(hit.clone(), range);
    return partial ?? hit;
  }

  // B27: a RANGE for a clip that is not cached yet. A media element (the
  // <audio> path, before any microphone has opened) only ever asks in ranges,
  // and a fragment is never stored -- so clips heard for weeks online were
  // still missing offline. Fetch the WHOLE file once, store it, and answer
  // the range from it. Clips average ~15KB, so the whole file costs nothing.
  if (range && /\/clips\/.*\.mp3$/.test(url.pathname)) {
    try {
      const whole = await fetchAndStore(cache, url.toString(), new Request(url.toString(), { credentials: request.credentials }));
      if (whole && whole.status === 200) return (await sliceToRange(whole.clone(), range)) ?? whole;
    } catch {
      /* fall through to the plain range fetch */
    }
    return fetch(request);
  }
  // Any other range is a fragment: answered, never stored (see fetchAndStore).
  if (range) return fetch(request);
  return fetchAndStore(cache, url.toString(), request);
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
