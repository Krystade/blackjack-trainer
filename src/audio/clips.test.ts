import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  manifestLookup,
  loadClipManifest,
  hasClip,
  playClipAsync,
  stopClips,
  setClipsEnabled,
  isClipsEnabled,
  _resetClipsForTest,
  type ClipManifest,
} from './clips';

/* ------------------------------------------------------------------------ */
/* manifestLookup — pure exact-key matching, no browser needed              */
/* ------------------------------------------------------------------------ */

describe('manifestLookup — pure exact-key matching', () => {
  const manifest: ClipManifest = {
    queen: 'queen.mp3',
    'queen of hearts': 'queen-of-hearts.mp3',
    'queen of spades': 'queen-of-spades.mp3',
  };

  it('returns the file for an exact key hit', () => {
    expect(manifestLookup(manifest, 'queen')).toBe('queen.mp3');
  });

  it('returns null for a miss', () => {
    expect(manifestLookup(manifest, 'king')).toBeNull();
  });

  it('returns null against an empty manifest', () => {
    expect(manifestLookup({}, 'queen')).toBeNull();
  });

  it('does not fuzzy/substring-match a shorter key against a longer phrase', () => {
    // "queen" must NOT match the "queen of hearts" entry.
    expect(manifestLookup(manifest, 'queen of hearts')).toBe('queen-of-hearts.mp3');
    expect(manifestLookup(manifest, 'queen of clubs')).toBeNull();
  });

  it('does not match a longer phrase against a shorter key (no partial/prefix matching)', () => {
    const small: ClipManifest = { queen: 'queen.mp3' };
    expect(manifestLookup(small, 'queen of hearts')).toBeNull();
  });

  it('is not fooled by inherited Object.prototype properties', () => {
    expect(manifestLookup({}, 'constructor')).toBeNull();
    expect(manifestLookup({}, 'toString')).toBeNull();
    expect(manifestLookup({}, 'hasOwnProperty')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* setClipsEnabled / isClipsEnabled                                         */
/* ------------------------------------------------------------------------ */

describe('setClipsEnabled / isClipsEnabled', () => {
  afterEach(() => _resetClipsForTest());

  it('defaults to false (matches DEFAULT_AUDIO.useClips)', () => {
    expect(isClipsEnabled()).toBe(false);
  });

  it('reflects the last value set', () => {
    setClipsEnabled(true);
    expect(isClipsEnabled()).toBe(true);
    setClipsEnabled(false);
    expect(isClipsEnabled()).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* loadClipManifest — memoized fetch, absence/failure guarded               */
/* ------------------------------------------------------------------------ */

function mockFetchOnce(impl: (url: string) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>): void {
  (globalThis as any).fetch = vi.fn(impl);
}

describe('loadClipManifest', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
  });

  it('resolves the clips object from a successful fetch', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ voice: 'en-US-AriaNeural', clips: { queen: 'queen.mp3' } }),
    }));
    const manifest = await loadClipManifest();
    expect(manifest).toEqual({ queen: 'queen.mp3' });
  });

  it('builds the URL from import.meta.env.BASE_URL, never a leading-slash absolute path', async () => {
    let seenUrl = '';
    mockFetchOnce(async (url) => {
      seenUrl = url;
      return { ok: true, json: async () => ({ clips: {} }) };
    });
    await loadClipManifest();
    expect(seenUrl).toBe(`${import.meta.env.BASE_URL}clips/manifest.json`);
    expect(seenUrl.startsWith('//')).toBe(false);
  });

  it('memoizes: a second call does not re-fetch', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) }));
    (globalThis as any).fetch = fetchSpy;
    await loadClipManifest();
    await loadClipManifest();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves to {} when fetch is not a function (no fetch support)', async () => {
    delete (globalThis as any).fetch;
    const manifest = await loadClipManifest();
    expect(manifest).toEqual({});
  });

  it('resolves to {} when fetch rejects', async () => {
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const manifest = await loadClipManifest();
    expect(manifest).toEqual({});
  });

  it('resolves to {} when the response is not ok', async () => {
    mockFetchOnce(async () => ({ ok: false }));
    const manifest = await loadClipManifest();
    expect(manifest).toEqual({});
  });

  it('resolves to {} when the JSON body has no clips object', async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => ({ voice: 'en-US-AriaNeural' }) }));
    const manifest = await loadClipManifest();
    expect(manifest).toEqual({});
  });

  it('resolves to {} when json() itself throws (malformed body)', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    }));
    const manifest = await loadClipManifest();
    expect(manifest).toEqual({});
  });
});

/* ------------------------------------------------------------------------ */
/* hasClip — sync exact-key check against whatever's currently loaded       */
/* ------------------------------------------------------------------------ */

describe('hasClip', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
  });

  it('returns false before any manifest has loaded', () => {
    delete (globalThis as any).fetch;
    expect(hasClip('queen')).toBe(false);
  });

  it('returns true for a key present in the loaded manifest, false for a miss', async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) }));
    await loadClipManifest();
    expect(hasClip('queen')).toBe(true);
    expect(hasClip('king')).toBe(false);
  });

  it('kicks off loading in the background so a later call sees fresh data', async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) }));
    expect(hasClip('queen')).toBe(false); // not loaded yet, but load has been kicked off
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hasClip('queen')).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* playClipAsync / stopClips — absence guards (no window/AudioContext)      */
/* ------------------------------------------------------------------------ */

describe('playClipAsync / stopClips — absence guards in node (no window)', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
    delete (globalThis as any).window;
  });

  it('playClipAsync resolves false (never throws) with no clip and no window', async () => {
    delete (globalThis as any).fetch;
    await expect(playClipAsync('anything')).resolves.toBe(false);
  });

  it('playClipAsync resolves false when a clip exists in the manifest but no AudioContext is available', async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) }));
    await expect(playClipAsync('queen')).resolves.toBe(false);
  });

  it('stopClips() never throws when nothing is playing', () => {
    expect(() => stopClips()).not.toThrow();
  });
});

/* ------------------------------------------------------------------------ */
/* playClipAsync — full happy path with a fake Web Audio environment        */
/* ------------------------------------------------------------------------ */

class FakeAudioBufferSourceNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeAudioContext {
  state: 'running' | 'suspended' = 'running';
  destination = {};
  sources: FakeAudioBufferSourceNode[] = [];
  createBufferSource(): FakeAudioBufferSourceNode {
    const node = new FakeAudioBufferSourceNode();
    this.sources.push(node);
    return node;
  }
  decodeAudioData(): Promise<{ duration: number }> {
    return Promise.resolve({ duration: 0.5 });
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
}

function installFakeWebAudioEnv(): FakeAudioContext {
  const ctx = new FakeAudioContext();
  (globalThis as any).window = { AudioContext: function () { return ctx; } };
  return ctx;
}

function mockFetchRouter(routes: Record<string, () => Promise<unknown>>): void {
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((r) => url.includes(r));
    if (!key) return { ok: false };
    const body = await routes[key]();
    return {
      ok: true,
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(8),
    };
  });
}

describe('playClipAsync — happy path (fake Web Audio + fetch)', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
    delete (globalThis as any).window;
  });

  it('resolves true once the source fires onended', async () => {
    installFakeWebAudioEnv();
    mockFetchRouter({
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3' } }),
      'queen.mp3': async () => ({}),
    });

    const playPromise = playClipAsync('queen');
    // Let the manifest + buffer fetch/decode microtasks resolve, then fire onended.
    await vi.waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalled();
    });
    // Allow the internal awaits (manifest fetch, arrayBuffer, decodeAudioData) to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ctx = (globalThis as any).window.AudioContext();
    const source = ctx.sources[ctx.sources.length - 1];
    expect(source.started).toBe(true);
    source.onended?.();

    await expect(playPromise).resolves.toBe(true);
  });

  it('resolves false for text with no manifest match, without touching AudioContext', async () => {
    installFakeWebAudioEnv();
    mockFetchRouter({ 'manifest.json': async () => ({ clips: { queen: 'queen.mp3' } }) });
    await expect(playClipAsync('nonexistent phrase')).resolves.toBe(false);
  });

  it("interrupt stops a currently-playing clip's source", async () => {
    const ctx = installFakeWebAudioEnv();
    mockFetchRouter({
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3', king: 'king.mp3' } }),
      'queen.mp3': async () => ({}),
      'king.mp3': async () => ({}),
    });

    const first = playClipAsync('queen');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const firstSource = ctx.sources[ctx.sources.length - 1];
    expect(firstSource.started).toBe(true);

    const second = playClipAsync('king', { interrupt: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(firstSource.stopped).toBe(true);
    await expect(first).resolves.toBe(true); // settled by the interrupt, not a failure

    const secondSource = ctx.sources[ctx.sources.length - 1];
    secondSource.onended?.();
    await expect(second).resolves.toBe(true);
  });

  it('stopClips() stops the active source and settles its promise', async () => {
    const ctx = installFakeWebAudioEnv();
    mockFetchRouter({
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3' } }),
      'queen.mp3': async () => ({}),
    });

    const playing = playClipAsync('queen');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const source = ctx.sources[ctx.sources.length - 1];
    expect(source.started).toBe(true);

    stopClips();
    expect(source.stopped).toBe(true);
    await expect(playing).resolves.toBe(true);
  });

  it('a lost onended is settled by the watchdog rather than hanging forever', async () => {
    vi.useFakeTimers();
    try {
      installFakeWebAudioEnv();
      mockFetchRouter({
        'manifest.json': async () => ({ clips: { queen: 'queen.mp3' } }),
        'queen.mp3': async () => ({}),
      });

      const playPromise = playClipAsync('queen');
      let settled = false;
      void playPromise.then(() => {
        settled = true;
      });

      // Flush the microtask chain (manifest fetch -> buffer fetch -> decode)
      // without touching timers, so the watchdog timer actually gets armed.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
