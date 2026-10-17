import { describe, it, expect } from 'vitest';
import { OFFLINE_CACHE } from './warmForFlight';
// The exact file that ships, as text (Vite's ?raw: no node types under src/).
import SW_SOURCE from '../../public/sw.js?raw';

/**
 * public/sw.js, run for real inside a stub worker scope.
 *
 * The worker is hand-written and has no build step, so the only way to test
 * what ships is to load that exact file. Cache Storage and fetch are faked;
 * timers are real but scaled down, so a 2.5s navigation timeout costs 25ms.
 */

const ORIGIN = 'https://jack.example';
const BASE = `${ORIGIN}/bj/`;
const TIME_SCALE = 100;

function keyOf(req: RequestInfo | URL): string {
  return typeof req === 'string' ? req : req instanceof URL ? req.toString() : req.url;
}

class FakeCache {
  store = new Map<string, Response>();
  async match(req: RequestInfo | URL): Promise<Response | undefined> {
    const hit = this.store.get(keyOf(req));
    return hit ? hit.clone() : undefined;
  }
  async put(req: RequestInfo | URL, res: Response): Promise<void> {
    this.store.set(keyOf(req), res);
  }
  async delete(req: RequestInfo | URL): Promise<boolean> {
    return this.store.delete(keyOf(req));
  }
  async keys(): Promise<Request[]> {
    return [...this.store.keys()].map((u) => new Request(u));
  }
}

type FetchFn = (req: Request) => Promise<Response>;

function loadWorker(fetchImpl: FetchFn) {
  const caches = new Map<string, FakeCache>();
  const listeners = new Map<string, (e: unknown) => void>();
  const waits: Promise<unknown>[] = [];
  const cacheStorage = {
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new FakeCache());
      return caches.get(name)!;
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
  };
  const self = {
    location: new URL(`${BASE}sw.js`),
    registration: { scope: BASE },
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
  };
  // The worker's globals, shadowed by parameters; Request/Response/URL are
  // the real ones.
  const run = new Function('self', 'caches', 'fetch', 'setTimeout', 'clearTimeout', SW_SOURCE);
  run(
    self,
    cacheStorage,
    (req: Request) => fetchImpl(req),
    (fn: () => void, ms: number) => setTimeout(fn, ms / TIME_SCALE),
    clearTimeout,
  );

  const fetchEvent = async (url: string, init: { navigate?: boolean } = {}) => {
    const request = new Request(url);
    // `mode` is read-only on a real Request; the worker only reads it.
    const req = init.navigate
      ? new Proxy(request, {
          get: (t, p) => {
            if (p === 'mode') return 'navigate';
            const v = Reflect.get(t, p, t);
            return typeof v === 'function' ? v.bind(t) : v;
          },
        })
      : request;
    let answer: Promise<Response> | undefined;
    listeners.get('fetch')!({
      request: req,
      respondWith: (p: Promise<Response>) => {
        answer = p;
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    return answer;
  };

  const activate = async () => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get('activate')!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };

  return { caches, cacheStorage, fetchEvent, activate, settle: () => Promise.all(waits) };
}

const text = (body: string, type = 'application/json') =>
  new Response(body, { status: 200, headers: { 'content-type': type } });

describe('service worker cache name', () => {
  it('is v2, and the page warms the same cache the worker reads', () => {
    expect(SW_SOURCE).toContain(`'${OFFLINE_CACHE}'`);
    expect(OFFLINE_CACHE).toBe('bjtrainer-offline-v2');
  });

  it('drops the v1 cache on activate', async () => {
    const w = loadWorker(async () => text('{}'));
    await w.cacheStorage.open('bjtrainer-offline-v1');
    await w.activate();
    expect(await w.cacheStorage.keys()).not.toContain('bjtrainer-offline-v1');
  });

  it('carries what v1 saved into v2, so the bump does not cost the saved voice or the shell', async () => {
    const w = loadWorker(async () => text('{}'));
    const v1 = await w.cacheStorage.open('bjtrainer-offline-v1');
    for (const f of ['', 'assets/index-A.js', 'clips/af_bella/a.mp3', 'clips/index.json']) {
      await v1.put(`${BASE}${f}`, text(`v1 ${f}`));
    }
    const v2 = await w.cacheStorage.open(OFFLINE_CACHE);
    await v2.put(`${BASE}clips/index.json`, text('v2 newer'));

    await w.activate();

    for (const f of ['', 'assets/index-A.js', 'clips/af_bella/a.mp3']) {
      expect(await (await v2.match(`${BASE}${f}`))?.text(), f || '(document)').toBe(`v1 ${f}`);
    }
    expect(await (await v2.match(`${BASE}clips/index.json`))!.text(), 'v2 copy is newer').toBe(
      'v2 newer',
    );
  });

  it("leaves other apps' caches on the same origin alone", async () => {
    // GitHub Pages serves every project of one account from one origin.
    const w = loadWorker(async () => text('{}'));
    await w.cacheStorage.open('lotus-tracker-shell');
    await w.activate();
    expect(await w.cacheStorage.keys()).toContain('lotus-tracker-shell');
  });
});

describe('clip manifests and the web manifest are network-first', () => {
  for (const path of ['clips/index.json', 'clips/af_bella/manifest.json', 'manifest.webmanifest']) {
    it(`${path}: a newer deployed copy replaces the cached one`, async () => {
      const w = loadWorker(async () => text('{"v":2}'));
      const cache = await w.cacheStorage.open(OFFLINE_CACHE);
      await cache.put(`${BASE}${path}`, text('{"v":1}'));

      const res = await w.fetchEvent(`${BASE}${path}`);
      expect(await res!.text(), 'served the stale cached copy').toBe('{"v":2}');
      await w.settle();
      expect(await (await cache.match(`${BASE}${path}`))!.text()).toBe('{"v":2}');
    });

    it(`${path}: offline, the cached copy is served`, async () => {
      const w = loadWorker(async () => {
        throw new TypeError('offline');
      });
      const cache = await w.cacheStorage.open(OFFLINE_CACHE);
      await cache.put(`${BASE}${path}`, text('{"v":1}'));
      const res = await w.fetchEvent(`${BASE}${path}`);
      expect(await res!.text()).toBe('{"v":1}');
    });
  }

  it('a hashed asset stays cache-first (no network at all)', async () => {
    let calls = 0;
    const w = loadWorker(async () => {
      calls += 1;
      return text('new');
    });
    const cache = await w.cacheStorage.open(OFFLINE_CACHE);
    await cache.put(`${BASE}assets/index-A.js`, text('old', 'text/javascript'));
    const res = await w.fetchEvent(`${BASE}assets/index-A.js`);
    expect(await res!.text()).toBe('old');
    expect(calls).toBe(0);
  });
});

describe('navigation', () => {
  it('a stalled document falls back to the cached shell after about 2.5s', async () => {
    const w = loadWorker(() => new Promise<Response>(() => undefined)); // never answers
    const cache = await w.cacheStorage.open(OFFLINE_CACHE);
    await cache.put(BASE, text('<html>cached shell</html>', 'text/html'));

    const started = Date.now();
    const res = await w.fetchEvent(`${BASE}?v=abc`, { navigate: true });
    const body = await res!.text();
    const waited = (Date.now() - started) * TIME_SCALE;
    expect(body).toBe('<html>cached shell</html>');
    // Scaled: between 1s and 10s of "real" time proves the worker's own
    // timeout fired, not the browser's 20s+ stall.
    expect(waited).toBeGreaterThanOrEqual(1000);
    expect(waited).toBeLessThan(10_000);
  });

  it('with no cached shell, it waits for the network rather than failing', async () => {
    const w = loadWorker(
      () =>
        new Promise<Response>((r) =>
          setTimeout(() => r(text('<html>late</html>', 'text/html')), 5000 / TIME_SCALE),
        ),
    );
    const res = await w.fetchEvent(BASE, { navigate: true });
    expect(await res!.text()).toBe('<html>late</html>');
  });

  it('a fresh document prunes /assets entries it no longer references', async () => {
    const html =
      '<html><head><script type="module" src="./assets/index-NEW.js"></script>' +
      '<link rel="stylesheet" href="./assets/index-NEW.css"></head></html>';
    const w = loadWorker(async () => text(html, 'text/html'));
    const cache = await w.cacheStorage.open(OFFLINE_CACHE);
    for (const f of [
      'assets/index-OLD.js',
      'assets/index-OLD.css',
      'assets/index-NEW.js',
      'clips/af_bella/a.mp3',
    ]) {
      await cache.put(`${BASE}${f}`, text('x'));
    }

    await w.fetchEvent(BASE, { navigate: true });
    await w.settle();

    // NEW.css was not cached yet: the document is stored only once it is.
    const left = [...cache.store.keys()].map((k) => k.slice(BASE.length)).sort();
    expect(left).toEqual(['', 'assets/index-NEW.css', 'assets/index-NEW.js', 'clips/af_bella/a.mp3']);
  });

  /** A built document naming one JS and one CSS file of build `v`. */
  const builtDoc = (v: string) =>
    `<html><head><script type="module" crossorigin src="./assets/index-${v}.js"></script>` +
    `<link rel="stylesheet" href="./assets/index-${v}.css"></head></html>`;

  /** Every `assets/` url the cached document names, and whether each is cached. */
  async function cachedDocAssets(cache: FakeCache) {
    const doc = await (await cache.match(BASE))!.text();
    const named = [...doc.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]!);
    return named.map((p) => [p, cache.store.has(`${BASE}${p}`)] as const);
  }

  it('a new build that arrives after the timeout is stored only with its assets, and the old build stays whole', async () => {
    // The phone holds build OLD. A deploy of NEW has landed; weak signal makes
    // the document take 5s, so this launch is answered with OLD.
    let online = true;
    const w = loadWorker(async (req) => {
      if (!online) throw new TypeError('offline');
      const path = new URL(req.url).pathname;
      if (path === '/bj/') {
        return new Promise<Response>((r) =>
          setTimeout(() => r(text(builtDoc('NEW'), 'text/html')), 5000 / TIME_SCALE),
        );
      }
      return text(`body of ${path}`, 'text/javascript');
    });
    const cache = await w.cacheStorage.open(OFFLINE_CACHE);
    await cache.put(BASE, text(builtDoc('OLD'), 'text/html'));
    await cache.put(`${BASE}assets/index-OLD.js`, text('old js', 'text/javascript'));
    await cache.put(`${BASE}assets/index-OLD.css`, text('old css', 'text/css'));

    const first = await (await w.fetchEvent(BASE, { navigate: true }))!.text();
    expect(first, 'the timeout should have served the cached build').toContain('index-OLD');
    await w.settle();

    // The cached document names only files that are in the cache...
    const named = await cachedDocAssets(cache);
    expect(named.length).toBeGreaterThan(0);
    for (const [path, present] of named) expect(present, `${path} is named but not cached`).toBe(true);
    // ...and the build the page is running was not pruned out from under it.
    expect(cache.store.has(`${BASE}assets/index-OLD.js`)).toBe(true);
    expect(cache.store.has(`${BASE}assets/index-OLD.css`)).toBe(true);

    // The next launch, on a plane: whatever document it gets, its JS loads.
    online = false;
    const second = await (await w.fetchEvent(BASE, { navigate: true }))!.text();
    const js = /src="\.\/(assets\/[^"]+\.js)"/.exec(second)![1]!;
    const res = await w.fetchEvent(`${BASE}${js}`);
    expect(res!.ok).toBe(true);
  });

  it('a late new build whose JS cannot be fetched is not stored: the old build stays the shell', async () => {
    const w = loadWorker(async (req) => {
      const path = new URL(req.url).pathname;
      if (path === '/bj/') {
        return new Promise<Response>((r) =>
          setTimeout(() => r(text(builtDoc('NEW'), 'text/html')), 5000 / TIME_SCALE),
        );
      }
      if (path.endsWith('index-NEW.js')) throw new TypeError('signal dropped');
      return text(`body of ${path}`, 'text/css');
    });
    const cache = await w.cacheStorage.open(OFFLINE_CACHE);
    await cache.put(BASE, text(builtDoc('OLD'), 'text/html'));
    await cache.put(`${BASE}assets/index-OLD.js`, text('old js', 'text/javascript'));
    await cache.put(`${BASE}assets/index-OLD.css`, text('old css', 'text/css'));

    await w.fetchEvent(BASE, { navigate: true });
    await w.settle();

    expect(await (await cache.match(BASE))!.text()).toContain('index-OLD');
    for (const [path, present] of await cachedDocAssets(cache)) expect(present, path).toBe(true);
  });

  it('a fresh build in time: the page and the background fill share one download per asset', async () => {
    const calls = new Map<string, number>();
    const w = loadWorker(async (req) => {
      const path = new URL(req.url).pathname;
      calls.set(path, (calls.get(path) ?? 0) + 1);
      if (path === '/bj/') return text(builtDoc('NEW'), 'text/html');
      // Slow enough that the page's request and the fill overlap.
      return new Promise<Response>((r) =>
        setTimeout(() => r(text(`body of ${path}`, 'text/javascript')), 30),
      );
    });
    const cache = await w.cacheStorage.open(OFFLINE_CACHE);

    const doc = await (await w.fetchEvent(BASE, { navigate: true }))!.text();
    expect(doc).toContain('index-NEW');
    // The browser asks for the document's files as soon as it has parsed it.
    const [js, css] = await Promise.all([
      w.fetchEvent(`${BASE}assets/index-NEW.js`),
      w.fetchEvent(`${BASE}assets/index-NEW.css`),
    ]);
    expect(await js!.text()).toBe('body of /bj/assets/index-NEW.js');
    expect(await css!.text()).toBe('body of /bj/assets/index-NEW.css');
    await w.settle();

    expect(calls.get('/bj/assets/index-NEW.js')).toBe(1);
    expect(calls.get('/bj/assets/index-NEW.css')).toBe(1);
    for (const [path, present] of await cachedDocAssets(cache)) expect(present, path).toBe(true);
  });

  it('a page that names no assets (a captive-portal login) does not replace the cached shell', async () => {
    const w = loadWorker(async () => text('<html>Log in to Airport WiFi</html>', 'text/html'));
    const cache = await w.cacheStorage.open(OFFLINE_CACHE);
    await cache.put(BASE, text(builtDoc('OLD'), 'text/html'));
    await cache.put(`${BASE}assets/index-OLD.js`, text('old js', 'text/javascript'));
    await cache.put(`${BASE}assets/index-OLD.css`, text('old css', 'text/css'));

    await w.fetchEvent(BASE, { navigate: true });
    await w.settle();
    expect(await (await cache.match(BASE))!.text()).toContain('index-OLD');
  });

  it('a document that names no assets (an error page) prunes nothing', async () => {
    const w = loadWorker(async () => text('<html>Site not found</html>', 'text/html'));
    const cache = await w.cacheStorage.open(OFFLINE_CACHE);
    await cache.put(`${BASE}assets/index-A.js`, text('x'));
    await w.fetchEvent(BASE, { navigate: true });
    await w.settle();
    expect(cache.store.has(`${BASE}assets/index-A.js`)).toBe(true);
  });
});
