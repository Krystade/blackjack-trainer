import { describe, it, expect, vi } from 'vitest';
import { warmOfflineCache, type CacheLike } from './warmCache';

/**
 * DOWNLOADING A FLIGHT'S WORTH OF AUDIO OVER AIRPORT WIFI.
 *
 * One voice is 615 files and 9.5MB. Everything here is about that shape: it
 * must not stop on the first failure, must not re-download what it already
 * has, must not open 615 sockets at once, and must never store a response it
 * would then serve as audio.
 */

function fakeCache(): CacheLike & { stored: Map<string, number> } {
  const stored = new Map<string, number>();
  return {
    stored,
    match: async (url: string) => (stored.has(url) ? ({ ok: true } as Response) : undefined),
    put: async (url: string, res: Response) => {
      stored.set(url, Number(res.headers.get('content-length') ?? 0));
    },
  };
}

function okResponse(bytes = 100): Response {
  return { ok: true, status: 200, headers: new Headers({ 'content-length': String(bytes) }) } as Response;
}

describe('warmOfflineCache', () => {
  it('stores every url it was given', async () => {
    const cache = fakeCache();
    const urls = ['a.mp3', 'b.mp3', 'c.mp3'];

    const result = await warmOfflineCache({ urls, cache, fetchFn: async () => okResponse() });

    expect([...cache.stored.keys()]).toEqual(urls);
    expect(result.cached).toBe(3);
    expect(result.failed).toEqual([]);
  });

  it('keeps going after a file that will not download', async () => {
    /*
     * THE WHOLE POINT. A download that abandons 600 files because one of them
     * timed out leaves a drill that half works in the air, which is worse than
     * one that does not work at all -- it fails in the middle of a hand.
     */
    const cache = fakeCache();
    const fetchFn = vi.fn(async (url: string) => {
      if (url === 'b.mp3') throw new Error('socket hung up');
      return okResponse();
    });

    const result = await warmOfflineCache({ urls: ['a.mp3', 'b.mp3', 'c.mp3'], cache, fetchFn });

    expect(result.failed, 'the failure was not reported').toEqual(['b.mp3']);
    expect([...cache.stored.keys()], 'the rest of the download was abandoned').toEqual(['a.mp3', 'c.mp3']);
  });

  it('never stores a response that was not ok', async () => {
    // A cached 404 body is served later as audio. Failing to download is
    // recoverable; storing the server's error page is not.
    const cache = fakeCache();
    const fetchFn = async (url: string) =>
      url === 'gone.mp3'
        ? ({ ok: false, status: 404, headers: new Headers() } as Response)
        : okResponse();

    const result = await warmOfflineCache({ urls: ['ok.mp3', 'gone.mp3'], cache, fetchFn });

    expect(cache.stored.has('gone.mp3')).toBe(false);
    expect(result.failed).toEqual(['gone.mp3']);
  });

  it('does not re-download what is already stored', async () => {
    // Pressing the button twice on a hotel connection must cost nothing. 9.5MB
    // of re-download is the difference between a usable button and a trap.
    const cache = fakeCache();
    cache.stored.set('a.mp3', 100);
    const fetchFn = vi.fn(async () => okResponse());

    const result = await warmOfflineCache({ urls: ['a.mp3', 'b.mp3'], cache, fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('b.mp3');
    // Still counted as present, or the progress read 1/2 on a finished job.
    expect(result.cached).toBe(2);
  });

  it('holds the number of open requests down', async () => {
    /*
     * 615 simultaneous fetches on airport wifi is how a download takes longer
     * than doing it one at a time, and iOS gives up on sockets it has too many
     * of. A few at a time is the whole difference.
     */
    const cache = fakeCache();
    let inFlight = 0;
    let peak = 0;
    const fetchFn = async (): Promise<Response> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      return okResponse();
    };

    await warmOfflineCache({
      urls: Array.from({ length: 50 }, (_, i) => `${i}.mp3`),
      cache,
      fetchFn,
      concurrency: 6,
    });

    expect(peak).toBeLessThanOrEqual(6);
    expect(peak, 'nothing ran in parallel at all').toBeGreaterThan(1);
  });

  it('reports progress that reaches the total exactly once', async () => {
    // The button says "142 of 615". A count that overshoots or stops short is
    // the reading Jack uses to decide whether it is safe to board.
    const cache = fakeCache();
    const seen: Array<[number, number]> = [];

    await warmOfflineCache({
      urls: ['a', 'b', 'c', 'd'],
      cache,
      fetchFn: async () => okResponse(),
      onProgress: (p) => seen.push([p.done, p.total]),
    });

    expect(seen.map(([d]) => d)).toEqual([1, 2, 3, 4]);
    expect(seen.every(([, t]) => t === 4)).toBe(true);
  });

  it('counts the bytes it actually stored', async () => {
    // So the button can say 9.5MB before, and how much landed after.
    const cache = fakeCache();
    const result = await warmOfflineCache({
      urls: ['a', 'b'],
      cache,
      fetchFn: async () => okResponse(1_000),
    });
    expect(result.bytes).toBe(2_000);
  });
});
