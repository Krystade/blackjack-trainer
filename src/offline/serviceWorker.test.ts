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

    const left = [...cache.store.keys()].map((k) => k.slice(BASE.length)).sort();
    expect(left).toEqual(['', 'assets/index-NEW.js', 'clips/af_bella/a.mp3']);
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
