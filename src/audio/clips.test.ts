import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  manifestLookup,
  segmentForClips,
  loadClipIndex,
  loadVoiceManifest,
  hasClips,
  prewarmClips,
  playClipsAsync,
  stopClips,
  setClipsEnabled,
  isClipsEnabled,
  setClipVoice,
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
/* segmentForClips — pure longest-first cascade, no browser needed          */
/* ------------------------------------------------------------------------ */

describe('segmentForClips — longest-first cascade', () => {
  it('takes the whole-string exact match fast path', () => {
    const manifest: ClipManifest = {
      'You have fourteen. Dealer shows ten.': 'combo.mp3',
      'You have fourteen.': 'a.mp3',
      'Dealer shows ten.': 'b.mp3',
    };
    expect(segmentForClips('You have fourteen. Dealer shows ten.', manifest)).toEqual(['combo.mp3']);
  });

  it('splits two sentences, each keeping its own terminal punctuation', () => {
    const manifest: ClipManifest = {
      'You have fourteen.': 'fourteen.mp3',
      'Dealer shows ten.': 'dealer-ten.mp3',
    };
    expect(segmentForClips('You have fourteen. Dealer shows ten.', manifest)).toEqual([
      'fourteen.mp3',
      'dealer-ten.mp3',
    ]);
  });

  it('comma-splits a bare list into items, dropping the comma', () => {
    const manifest: ClipManifest = {
      queen: 'queen.mp3',
      four: 'four.mp3',
      king: 'king.mp3',
    };
    expect(segmentForClips('queen, four, king', manifest)).toEqual(['queen.mp3', 'four.mp3', 'king.mp3']);
  });

  it('handles a mixed run of independent sentences', () => {
    const manifest: ClipManifest = {
      'Running count plus eight.': 'rc8.mp3',
      'Two decks remaining.': 'decks2.mp3',
    };
    expect(segmentForClips('Running count plus eight. Two decks remaining.', manifest)).toEqual([
      'rc8.mp3',
      'decks2.mp3',
    ]);
  });

  it('returns null when any single piece is missing', () => {
    const manifest: ClipManifest = { queen: 'queen.mp3', four: 'four.mp3' }; // no 'king'
    expect(segmentForClips('queen, four, king', manifest)).toBeNull();
  });

  it('returns null against an empty manifest', () => {
    expect(segmentForClips('queen', {})).toBeNull();
  });

  it('does not fuzzy-match a bare rank against a longer manifest entry', () => {
    const manifest: ClipManifest = { 'queen of hearts': 'qoh.mp3' };
    expect(segmentForClips('queen', manifest)).toBeNull();
  });

  it('never falls back to a substring/fuzzy match anywhere in the cascade', () => {
    const manifest: ClipManifest = { 'Dealer shows ten.': 'dealer-ten.mp3' };
    expect(segmentForClips('Dealer shows te', manifest)).toBeNull();
  });

  it('does not comma-split a sentence that carries its own terminal punctuation', () => {
    // "Wrong, try again." ends in '.', so it must be treated as ONE sentence
    // (matched whole or not at all), never split on the internal comma.
    const manifest: ClipManifest = { wrong: 'wrong.mp3', 'try again': 'try-again.mp3' };
    expect(segmentForClips('Wrong, try again.', manifest)).toBeNull();
  });

  it('matches a full sentence that itself contains a comma when present verbatim', () => {
    const manifest: ClipManifest = { 'Wrong, try again.': 'wrong-try-again.mp3' };
    expect(segmentForClips('Wrong, try again.', manifest)).toEqual(['wrong-try-again.mp3']);
  });
});

/* ------------------------------------------------------------------------ */
/* setClipsEnabled / isClipsEnabled / setClipVoice                         */
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
/* loadClipIndex — memoized fetch, absence/failure guarded                  */
/* ------------------------------------------------------------------------ */

function mockFetchOnce(impl: (url: string) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>): void {
  (globalThis as any).fetch = vi.fn(impl);
}

describe('loadClipIndex', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
  });

  it('resolves the voices + default from a successful fetch', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
    }));
    const idx = await loadClipIndex();
    expect(idx).toEqual({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' });
  });

  it('builds the URL from import.meta.env.BASE_URL, never a leading-slash absolute path', async () => {
    let seenUrl = '';
    mockFetchOnce(async (url) => {
      seenUrl = url;
      return { ok: true, json: async () => ({ voices: [], default: 'aria' }) };
    });
    await loadClipIndex();
    expect(seenUrl).toBe(`${import.meta.env.BASE_URL}clips/index.json`);
    expect(seenUrl.startsWith('//')).toBe(false);
  });

  it('memoizes: a second call does not re-fetch', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ voices: [], default: 'aria' }) }));
    (globalThis as any).fetch = fetchSpy;
    await loadClipIndex();
    await loadClipIndex();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves to null when fetch is not a function (no fetch support)', async () => {
    delete (globalThis as any).fetch;
    expect(await loadClipIndex()).toBeNull();
  });

  it('resolves to null when fetch rejects', async () => {
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await loadClipIndex()).toBeNull();
  });

  it('resolves to null when the response is not ok', async () => {
    mockFetchOnce(async () => ({ ok: false }));
    expect(await loadClipIndex()).toBeNull();
  });

  it('resolves to null when the JSON body is missing voices/default', async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => ({ voices: [] }) }));
    expect(await loadClipIndex()).toBeNull();
  });

  it('resolves to null when json() itself throws (malformed body)', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    }));
    expect(await loadClipIndex()).toBeNull();
  });

  it('drops malformed voice entries but keeps well-formed ones', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({
        voices: [{ id: 'aria', label: 'Aria' }, { id: 'bad' }, 'not-an-object'],
        default: 'aria',
      }),
    }));
    const idx = await loadClipIndex();
    expect(idx).toEqual({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' });
  });
});

/* ------------------------------------------------------------------------ */
/* loadVoiceManifest — memoized PER VOICE, absence/failure guarded          */
/* ------------------------------------------------------------------------ */

describe('loadVoiceManifest', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
  });

  it('resolves the clips object for the given voice from a successful fetch', async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) }));
    const manifest = await loadVoiceManifest('aria');
    expect(manifest).toEqual({ queen: 'queen.mp3' });
  });

  it('builds the URL from BASE_URL + voiceId, never a leading-slash absolute path', async () => {
    let seenUrl = '';
    mockFetchOnce(async (url) => {
      seenUrl = url;
      return { ok: true, json: async () => ({ clips: {} }) };
    });
    await loadVoiceManifest('aria');
    expect(seenUrl).toBe(`${import.meta.env.BASE_URL}clips/aria/manifest.json`);
    expect(seenUrl.startsWith('//')).toBe(false);
  });

  it('memoizes per voice: a second call for the same voice does not re-fetch', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) }));
    (globalThis as any).fetch = fetchSpy;
    await loadVoiceManifest('aria');
    await loadVoiceManifest('aria');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fetches independently for a different voice id', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) }));
    (globalThis as any).fetch = fetchSpy;
    await loadVoiceManifest('aria');
    await loadVoiceManifest('guy');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('resolves to {} when fetch is not a function (no fetch support)', async () => {
    delete (globalThis as any).fetch;
    expect(await loadVoiceManifest('aria')).toEqual({});
  });

  it('resolves to {} when fetch rejects', async () => {
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await loadVoiceManifest('aria')).toEqual({});
  });

  it('resolves to {} when the response is not ok (e.g. this voice has no assets)', async () => {
    mockFetchOnce(async () => ({ ok: false }));
    expect(await loadVoiceManifest('aria')).toEqual({});
  });

  it('resolves to {} when the JSON body has no clips object', async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => ({ voice: 'aria' }) }));
    expect(await loadVoiceManifest('aria')).toEqual({});
  });
});

/* ------------------------------------------------------------------------ */
/* hasClips — sync cascade check against whatever's currently loaded        */
/* ------------------------------------------------------------------------ */

describe('hasClips', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
  });

  it('returns false before anything has loaded', () => {
    delete (globalThis as any).fetch;
    expect(hasClips('queen')).toBe(false);
  });

  it('resolves via the index default once index + voice manifest have loaded', async () => {
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url.includes('index.json')) {
        return { ok: true, json: async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }) };
      }
      return { ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) };
    });
    await loadClipIndex();
    await loadVoiceManifest('aria');
    expect(hasClips('queen')).toBe(true);
    expect(hasClips('king')).toBe(false);
  });

  it('resolves via an explicitly set clip voice, bypassing the index default', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) }));
    setClipVoice('guy');
    await loadVoiceManifest('guy');
    expect(hasClips('queen')).toBe(true);
  });

  it('kicks off loading in the background so a later call sees fresh data', async () => {
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url.includes('index.json')) {
        return { ok: true, json: async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }) };
      }
      return { ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) };
    });
    expect(hasClips('queen')).toBe(false); // nothing loaded yet, but a load has been kicked off
    // Flush enough microtask ticks for index.json, then aria/manifest.json,
    // to both resolve and populate their sync caches.
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      hasClips('queen'); // each call may kick off the next hop
    }
    expect(hasClips('queen')).toBe(true);
  });

  /**
   * The whole reason prewarmClips exists: without it the FIRST utterance after
   * a cold load reads an empty cache, answers false, and goes to live TTS --
   * and in a car live speech opens no media element, so the opening line of a
   * session is the one the head unit cannot see.
   */
  it('is already true on the first call after a prewarm, with no load hop', async () => {
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url.includes('index.json')) {
        return { ok: true, json: async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }) };
      }
      return { ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) };
    });
    await prewarmClips();
    expect(hasClips('queen')).toBe(true);
  });

  it('prewarms the explicitly set voice rather than the index default', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('index.json')) {
        return { ok: true, json: async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }) };
      }
      return { ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) };
    });
    (globalThis as any).fetch = fetchMock;
    setClipVoice('guy');
    await prewarmClips();
    expect(hasClips('queen')).toBe(true);
    // A pinned voice needs no index at all -- fetching one would be a wasted
    // request on every app start.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('index.json'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('guy/manifest.json'))).toBe(true);
  });

  /** Prewarming is fire-and-forget: a failure must leave live TTS working, not
   * reject into whatever effect called it. */
  it('resolves quietly when there is nothing to prewarm', async () => {
    delete (globalThis as any).fetch;
    await expect(prewarmClips()).resolves.toBeUndefined();
    expect(hasClips('queen')).toBe(false);
  });

  it('reflects segmentForClips, not just a raw exact hit (e.g. a comma list)', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ clips: { queen: 'queen.mp3', four: 'four.mp3', king: 'king.mp3' } }),
    }));
    setClipVoice('aria');
    await loadVoiceManifest('aria');
    expect(hasClips('queen, four, king')).toBe(true);
    expect(hasClips('queen, four, jack')).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* playClipsAsync / stopClips — absence guards (no window)                  */
/* ------------------------------------------------------------------------ */

describe('playClipsAsync / stopClips — absence guards in node (no window)', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
    delete (globalThis as any).window;
  });

  it('resolves false (never throws) with no clip index and no window', async () => {
    delete (globalThis as any).fetch;
    await expect(playClipsAsync('anything')).resolves.toBe(false);
  });

  it('resolves false when a clip exists in the manifest but no Audio ctor is available', async () => {
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url.includes('index.json')) {
        return { ok: true, json: async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }) };
      }
      return { ok: true, json: async () => ({ clips: { queen: 'queen.mp3' } }) };
    });
    await expect(playClipsAsync('queen')).resolves.toBe(false);
  });

  it('stopClips() never throws when nothing is playing', () => {
    expect(() => stopClips()).not.toThrow();
  });
});

/* ------------------------------------------------------------------------ */
/* playClipsAsync — full happy path with a fake HTMLAudioElement env        */
/* ------------------------------------------------------------------------ */

/**
 * `load()` and the `src` setter are modelled, not stubbed.
 *
 * A real element runs the media load algorithm whenever `src` is set, and that
 * algorithm resets `playbackRate` to `defaultPlaybackRate`. That only became
 * observable once the chain started reusing one element: a `playbackRate`
 * written before the next clip's `src` is silently thrown away, so the clip
 * plays at 1 while the log still reports the rate that was asked for. A fake
 * that ignored `load` would let that through.
 */
class FakeAudioElement {
  #src = '';
  preservesPitch = false;
  defaultPlaybackRate = 1;
  playbackRate = 1;
  volume = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  played = false;
  paused = true;
  /** Every `src` assignment, so a chain can be read back as a sequence. */
  loads: string[] = [];
  get src(): string {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    this.load();
  }
  load(): void {
    this.loads.push(this.#src);
    this.playbackRate = this.defaultPlaybackRate;
  }
  play(): Promise<void> {
    this.played = true;
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

function installFakeAudioEnv(): { instances: FakeAudioElement[] } {
  const instances: FakeAudioElement[] = [];
  class TrackedFakeAudioElement extends FakeAudioElement {
    constructor() {
      super();
      instances.push(this);
    }
  }
  (globalThis as any).window = { Audio: TrackedFakeAudioElement };
  return { instances };
}

function mockFetchRouter(routes: Record<string, () => Promise<unknown>>): void {
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((r) => url.includes(r));
    if (!key) return { ok: false };
    const body = await routes[key]();
    return { ok: true, json: async () => body };
  });
}

describe('playClipsAsync — happy path (fake Audio + fetch)', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
    delete (globalThis as any).window;
  });

  it('plays a single-clip cascade and resolves true once it fires ended', async () => {
    const env = installFakeAudioEnv();
    mockFetchRouter({
      'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3' } }),
    });

    const playPromise = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances.length).toBe(1));

    const clip = env.instances[0];
    expect(clip.src).toBe(`${import.meta.env.BASE_URL}clips/aria/queen.mp3`);
    expect(clip.preservesPitch).toBe(true);
    expect(clip.playbackRate).toBe(1);
    expect(clip.played).toBe(true);

    clip.onended?.();
    await expect(playPromise).resolves.toBe(true);
  });

  it('applies opts.rate as playbackRate on every clip in the chain', async () => {
    const env = installFakeAudioEnv();
    mockFetchRouter({
      'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
      'manifest.json': async () => ({ clips: { 'You have fourteen.': 'a.mp3', 'Dealer shows ten.': 'b.mp3' } }),
    });

    const playPromise = playClipsAsync('You have fourteen. Dealer shows ten.', { rate: 3 });
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    const audio = env.instances[0];
    expect(audio.playbackRate).toBe(3);
    audio.onended?.();

    // EVERY clip, on a reused element: loading a new source resets
    // `playbackRate` to `defaultPlaybackRate`, so a rate set before the load
    // instead of after is silently discarded from the second clip on.
    await vi.waitFor(() => expect(audio.src).toBe(`${import.meta.env.BASE_URL}clips/aria/b.mp3`));
    expect(audio.playbackRate, 'the rate was lost when the next clip loaded').toBe(3);
    audio.onended?.();

    await expect(playPromise).resolves.toBe(true);
  });

  it('chains multiple clips in sequence, playing the next only after the previous ends', async () => {
    const env = installFakeAudioEnv();
    mockFetchRouter({
      'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3', four: 'four.mp3', king: 'king.mp3' } }),
    });

    const playPromise = playClipsAsync('queen, four, king');
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    const audio = env.instances[0];
    expect(audio.src).toContain('queen.mp3');

    // The next clip is loaded only once the previous one reports `ended` --
    // asserted by advancing one step at a time and reading the source each
    // time, which is the ordering the chain exists to guarantee.
    audio.onended?.();
    await vi.waitFor(() => expect(audio.src).toContain('four.mp3'));

    audio.onended?.();
    await vi.waitFor(() => expect(audio.src).toContain('king.mp3'));

    audio.onended?.();
    await expect(playPromise).resolves.toBe(true);
  });

  it('resolves false for text with no cascade match, without touching Audio', async () => {
    installFakeAudioEnv();
    mockFetchRouter({
      'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3' } }),
    });
    await expect(playClipsAsync('nonexistent phrase')).resolves.toBe(false);
  });

  it("interrupt stops a currently-playing chain and settles it true", async () => {
    const env = installFakeAudioEnv();
    mockFetchRouter({
      'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3', king: 'king.mp3' } }),
    });

    const first = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    expect(env.instances[0].paused).toBe(false);

    const second = playClipsAsync('king', { interrupt: true });
    // Settled by the interrupt, NOT a failure: `false` here would send the
    // caller off to speak the line again over the clip that replaced it.
    await expect(first).resolves.toBe(true);

    await vi.waitFor(() => expect(env.instances[0].src).toContain('king.mp3'));
    env.instances[0].onended?.();
    await expect(second).resolves.toBe(true);
  });

  it('stopClips() stops the active chain and settles its promise true', async () => {
    const env = installFakeAudioEnv();
    mockFetchRouter({
      'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3' } }),
    });

    const playing = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances.length).toBe(1));

    stopClips();
    expect(env.instances[0].paused).toBe(true);
    await expect(playing).resolves.toBe(true);
  });

  it('a lost ended event is settled by the watchdog rather than hanging forever', async () => {
    vi.useFakeTimers();
    try {
      installFakeAudioEnv();
      mockFetchRouter({
        'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
        'manifest.json': async () => ({ clips: { queen: 'queen.mp3' } }),
      });

      const playPromise = playClipsAsync('queen');
      let settled = false;
      void playPromise.then(() => {
        settled = true;
      });

      // Flush the microtask chain (index fetch -> manifest fetch -> play())
      // without touching timers, so the watchdog timer actually gets armed.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses an explicitly set clip voice over the index default', async () => {
    const env = installFakeAudioEnv();
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url.includes('index.json')) {
        return { ok: true, json: async () => ({ voices: [{ id: 'aria', label: 'Aria' }, { id: 'guy', label: 'Guy' }], default: 'aria' }) };
      }
      if (url.includes('/guy/')) {
        return { ok: true, json: async () => ({ clips: { queen: 'guy-queen.mp3' } }) };
      }
      return { ok: true, json: async () => ({ clips: { queen: 'aria-queen.mp3' } }) };
    });

    setClipVoice('guy');
    const playPromise = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    expect(env.instances[0].src).toBe(`${import.meta.env.BASE_URL}clips/guy/guy-queen.mp3`);
    env.instances[0].onended?.();
    await expect(playPromise).resolves.toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* One long-lived element, because iOS gates a fresh one                    */
/* ------------------------------------------------------------------------ */

/**
 * Why these exist.
 *
 * On the 2026-09-30 drive, every clip up to the first voice step played, and
 * then `echo-voice-1` logged `clip-broke why=play-rejected name=NotAllowedError`
 * fifty milliseconds after the recogniser confirmed it was listening. The step
 * fell through to live TTS in a different voice, which is the one thing the
 * clip path exists to avoid.
 *
 * `play()` on an HTMLAudioElement that has never played is subject to the
 * activation check; an element that HAS played is unlocked for the life of the
 * page. The chain was constructing a new element per clip, so it threw that
 * unlocked state away on every single line and re-faced the gate each time --
 * and the moment the gate is least likely to pass is exactly when the
 * recogniser has just taken the audio session.
 *
 * The element is therefore the thing that must persist. These tests pin that
 * it does, and -- the one that actually matters -- that the shared element is
 * never handed to the amplifying path, because `createMediaElementSource`
 * consumes an element permanently: once routed, its audio flows only through
 * the graph, and a suspended graph makes every later clip SILENT rather than
 * quiet.
 */
describe('the element that plays a clip outlives the clip', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
    delete (globalThis as any).window;
  });

  function twoClipVoice(): void {
    mockFetchRouter({
      'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3', four: 'four.mp3' } }),
    });
  }

  it('plays every clip in a chain through the same element', async () => {
    const env = installFakeAudioEnv();
    twoClipVoice();

    const playPromise = playClipsAsync('queen, four');
    await vi.waitFor(() => expect(env.instances[0]?.src).toContain('queen.mp3'));
    env.instances[0].onended?.();
    await vi.waitFor(() => expect(env.instances[0]?.src).toContain('four.mp3'));
    env.instances[0].onended?.();

    await expect(playPromise).resolves.toBe(true);
    expect(env.instances.length, 'a new element per clip re-faces the activation gate').toBe(1);
  });

  it('plays a second utterance through the element the first one unlocked', async () => {
    const env = installFakeAudioEnv();
    twoClipVoice();

    const first = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances[0]?.src).toContain('queen.mp3'));
    env.instances[0].onended?.();
    await expect(first).resolves.toBe(true);

    const second = playClipsAsync('four');
    await vi.waitFor(() => expect(env.instances[0]?.src).toContain('four.mp3'));
    env.instances[0].onended?.();
    await expect(second).resolves.toBe(true);

    expect(env.instances.length, 'the second utterance built a fresh, locked element').toBe(1);
  });

  it('does not leave the previous utterance’s volume on the element', async () => {
    const env = installFakeAudioEnv();
    twoClipVoice();

    const quiet = playClipsAsync('queen', { volume: 0.2 });
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    const audio = env.instances[0];
    expect(audio.volume).toBe(0.2);
    audio.onended?.();
    await expect(quiet).resolves.toBe(true);

    // A caller that passes no volume used to leave `volume` untouched, which
    // was the same thing as 1 on a brand-new element and is the PREVIOUS
    // utterance's level on a reused one. A step at 0.2 would then mute the
    // step after it, in a car, with the log reporting a clean `path=clip`.
    const next = playClipsAsync('four');
    await vi.waitFor(() => expect(audio.src).toContain('four.mp3'));
    expect(audio.volume, 'the earlier utterance’s volume carried over').toBe(1);
    audio.onended?.();
    await expect(next).resolves.toBe(true);
  });

  it('never hands the shared element to the amplifying path', async () => {
    const env = installFakeAudioEnv();
    twoClipVoice();

    const quiet = playClipsAsync('queen', { volume: 1 });
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    const shared = env.instances[0];
    shared.onended?.();
    await expect(quiet).resolves.toBe(true);

    // Above unity the clip is routed through a GainNode, and
    // createMediaElementSource consumes the element for good.
    const loud = playClipsAsync('four', { volume: 1.5 });
    await vi.waitFor(() => expect(env.instances.length).toBe(2));
    expect(env.instances[1], 'the amplified clip was routed through the shared element').not.toBe(shared);
    env.instances[1].onended?.();
    await expect(loud).resolves.toBe(true);

    // And the shared element is still the one the ordinary path uses.
    const quietAgain = playClipsAsync('queen', { volume: 1 });
    await vi.waitFor(() => expect(shared.src).toContain('queen.mp3'));
    shared.onended?.();
    await expect(quietAgain).resolves.toBe(true);
    expect(env.instances.length, 'the ordinary path stopped reusing the shared element').toBe(2);
  });
});
