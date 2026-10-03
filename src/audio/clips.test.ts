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
import { _resetSharedAudioContextForTest } from './audioContext';
import { readDiagnosticLog, clearDiagnosticLog } from '../diag/diagnosticLog';
import { setSpeechActivityListener } from './speechActivity';

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

  /**
   * THE CASE THE FIRST VERSION OF THIS GOT WRONG, caught by the browser and
   * not by any fake.
   *
   * `clips.ts` claimed "at most one at a time, matching speech.ts's
   * single-utterance model", and that is false. `speak()` is fire-and-forget,
   * so a dealt round starts five chains inside one millisecond. With a single
   * shared element, each new chain's `src` assignment aborted the pending
   * `play()` of the one before it: four `clip-broke why=play-rejected
   * name=AbortError` in a row, and four lines spoken in the fallback voice.
   *
   * So the element is POOLED, not shared. One chain at a time -- which is the
   * drill, and is where the iOS gate matters -- always gets the same unlocked
   * element back; overlapping chains each get their own, exactly as before.
   */
  it('gives overlapping chains their own elements', async () => {
    const env = installFakeAudioEnv();
    twoClipVoice();

    const first = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    const second = playClipsAsync('four');
    await vi.waitFor(() => expect(env.instances.length).toBe(2));

    expect(env.instances[0].src, 'the second chain took the first chain’s element').toContain(
      'queen.mp3',
    );
    expect(env.instances[1].src).toContain('four.mp3');

    env.instances[0].onended?.();
    env.instances[1].onended?.();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it('hands a finished chain’s element back for the next one', async () => {
    const env = installFakeAudioEnv();
    twoClipVoice();

    const first = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    const overlapping = playClipsAsync('four');
    await vi.waitFor(() => expect(env.instances.length).toBe(2));
    env.instances[0].onended?.();
    env.instances[1].onended?.();
    await expect(first).resolves.toBe(true);
    await expect(overlapping).resolves.toBe(true);

    // Both are idle now, so a third chain reuses one rather than building a
    // locked third element.
    const third = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances.some((a) => a.src.includes('queen.mp3'))).toBe(true));
    expect(env.instances.length, 'a finished element was never reused').toBe(2);
    for (const a of env.instances) a.onended?.();
    await expect(third).resolves.toBe(true);
  });

  it('hands the shared element to a loud clip like any other', async () => {
    const env = installFakeAudioEnv();
    twoClipVoice();

    const quiet = playClipsAsync('queen', { volume: 1 });
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    const shared = env.instances[0];
    shared.onended?.();
    await expect(quiet).resolves.toBe(true);

    // THE OPPOSITE OF WHAT THIS USED TO ASSERT. A request above unity went to
    // its own element because it was about to be consumed by
    // `createMediaElementSource`. Nothing is routed any more -- measured on
    // the phone on 2026-10-02, routing stretched a 3029ms prompt to 4455ms --
    // so a loud request is an ordinary request that happens to clamp to 1, and
    // it must reuse the unlocked element like everything else. A brand-new
    // element on iOS is a LOCKED one.
    const loud = playClipsAsync('four', { volume: 1.5 });
    await vi.waitFor(() => expect(shared.src).toContain('four.mp3'));
    expect(env.instances.length, 'a loud clip built an element of its own').toBe(1);
    shared.onended?.();
    await expect(loud).resolves.toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* A clip never goes through Web Audio, however loud the setting            */
/* ------------------------------------------------------------------------ */

/**
 * WHY THE ROUTE IS GONE, from Jack's phone on 2026-10-02.
 *
 * `HTMLMediaElement.volume` throws above 1, so a GainNode was the only way
 * past 100%. It worked -- `amplify ok=true state=running` on every clip -- and
 * it wrecked the sound:
 *
 *   "You have fifteen. Dealer shows five."   3029ms at 100%, 4455ms at 200%
 *   "You have ace, seven. Dealer shows six." 3099ms at 100%, 7687ms at 150%
 *
 * 150% stretched a prompt further than 200% did, so the damage is not
 * proportional to the gain and is therefore not the gain; and it is not
 * clipping either, because the shipped clips peak at 0.34-0.81 and not one
 * sample in a 150-file sample reaches full scale even at 2x. What is left is
 * the route: 24kHz files resampled in real time into a graph clocked by
 * hardware whose rate the open microphone keeps moving. "150% is choppy and
 * 200% is just silent", reported exactly that way.
 *
 * So these tests assert the ABSENCE of something, which is only worth having
 * because the fake AudioContext below makes the route available: restore
 * `amplify()` and the first of them goes red.
 */
describe('a clip never goes through Web Audio', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => {
    _resetClipsForTest();
    _resetSharedAudioContextForTest();
  });
  afterEach(() => {
    _resetClipsForTest();
    _resetSharedAudioContextForTest();
    (globalThis as any).fetch = realFetch;
    delete (globalThis as any).window;
  });

  interface FakeGain {
    gain: { value: number };
    connect: (to: unknown) => void;
  }

  function installFakeAudioAndGraph(): {
    instances: FakeAudioElement[];
    gains: FakeGain[];
    routed: FakeAudioElement[];
    ctx: { state: AudioContextState };
  } {
    const instances: FakeAudioElement[] = [];
    const gains: FakeGain[] = [];
    const routed: FakeAudioElement[] = [];
    class TrackedFakeAudioElement extends FakeAudioElement {
      constructor() {
        super();
        instances.push(this);
      }
    }
    const ctx = {
      state: 'running' as AudioContextState,
      destination: {},
      createMediaElementSource(el: FakeAudioElement) {
        // The real one THROWS on an element it has already consumed, which is
        // the behaviour that made `amplify()` report ok=false from the second
        // clip of every chain onward.
        if (routed.includes(el)) throw new Error('InvalidStateError');
        routed.push(el);
        return { connect: () => {} };
      },
      createGain(): FakeGain {
        const g: FakeGain = { gain: { value: 1 }, connect: () => {} };
        gains.push(g);
        return g;
      },
      resume: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
    (globalThis as any).window = {
      Audio: TrackedFakeAudioElement,
      AudioContext: class {
        constructor() {
          return ctx as unknown as AudioContext;
        }
      },
    };
    mockFetchRouter({
      'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3', four: 'four.mp3' } }),
    });
    return { instances, gains, routed, ctx };
  }

  it('routes nothing through the graph, however loud the setting', async () => {
    const env = installFakeAudioAndGraph();

    // A RUNNING graph, deliberately: this is the state in which the old code
    // DID route, so a fake that refused would prove nothing. See
    // audio/clips.ts's pool comment for what routing cost on the phone.
    expect(env.ctx.state).toBe('running');

    const loud = playClipsAsync('queen', { volume: 2 });
    await vi.waitFor(() => expect(env.instances.length).toBe(1));

    expect(env.routed.length, 'a clip was handed to createMediaElementSource').toBe(0);
    expect(env.gains.length, 'a gain node was built for a clip').toBe(0);
    // And it still plays, at the only level an element will accept.
    expect(env.instances[0].volume, 'the element was handed a value above 1').toBe(1);
    expect(env.instances[0].played).toBe(true);
    env.instances[0].onended?.();
    await expect(loud).resolves.toBe(true);
  });

  it('keeps reusing one element across loud and quiet utterances alike', async () => {
    const env = installFakeAudioAndGraph();

    const loud = playClipsAsync('queen', { volume: 2 });
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    const shared = env.instances[0];
    shared.onended?.();
    await expect(loud).resolves.toBe(true);

    // The two pools existed only because a routed element could never come
    // back. Nothing is routed, so one pool serves both, and the element that
    // played the loud line is the one the quiet line gets -- unlocked.
    const quiet = playClipsAsync('four', { volume: 1 });
    await vi.waitFor(() => expect(shared.src).toContain('four.mp3'));
    expect(env.instances.length, 'a second element was built for a quiet clip').toBe(1);
    shared.onended?.();
    await expect(quiet).resolves.toBe(true);
  });

  it('says so when the element refuses the volume it was handed', async () => {
    const instances: FakeAudioElement[] = [];
    // WebKit has long made `volume` read-only on iOS -- the hardware buttons
    // are the only volume control -- and assignment is IGNORED rather than
    // refused. A Volume setting that does nothing then looks exactly like a
    // clip that played quietly, and only a read-back can tell them apart.
    class DeafToVolume extends FakeAudioElement {
      constructor() {
        super();
        // On the instance, because the base class sets `volume` as an own
        // field; a prototype accessor would be shadowed by it.
        Object.defineProperty(this, 'volume', { get: () => 1, set: () => {} });
        instances.push(this);
      }
    }
    (globalThis as any).window = { Audio: DeafToVolume };
    mockFetchRouter({
      'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3' } }),
    });
    clearDiagnosticLog();

    const quiet = playClipsAsync('queen', { volume: 0.2 });
    await vi.waitFor(() => expect(instances.length).toBe(1));
    instances[0].onended?.();
    await expect(quiet).resolves.toBe(true);

    const reported = readDiagnosticLog().filter((e) => e.event === 'volume-ignored');
    expect(reported.length, 'a volume the element threw away was never reported').toBe(1);
    expect(reported[0]!.detail).toMatchObject({ wanted: 0.2, got: 1 });
  });

  it('stays quiet when the element honours the volume', async () => {
    installFakeAudioAndGraph();
    clearDiagnosticLog();

    const quiet = playClipsAsync('queen', { volume: 0.2 });
    await vi.waitFor(() => expect(readDiagnosticLog().some((e) => e.event === 'clip-chain')).toBe(true));

    // The other half of the instrument: a report on every clip would be noise
    // nobody reads, and an export full of it says nothing about the one phone
    // where it matters.
    expect(readDiagnosticLog().filter((e) => e.event === 'volume-ignored').length).toBe(0);
    stopClips();
    await expect(quiet).resolves.toBe(true);
  });

  it('plays a loud clip whether the graph is awake or suspended', async () => {
    const env = installFakeAudioAndGraph();
    env.ctx.state = 'suspended';

    const loud = playClipsAsync('queen', { volume: 1.5 });
    await vi.waitFor(() => expect(env.instances.length).toBe(1));

    // THE FAILURE THAT CAN NO LONGER HAPPEN. A routed element plays only
    // through the graph, so a suspended one made the clip SILENT while
    // `play()` resolved and `ended` fired -- the log said `path=clip` and the
    // cabin heard nothing, which is the worst failure this app has. The graph
    // state is now irrelevant to a clip, and that is the point.
    expect(env.routed.length, 'a suspended graph was routed into').toBe(0);
    expect(env.instances[0].volume).toBe(1);
    expect(env.instances[0].played).toBe(true);
    env.instances[0].onended?.();
    await expect(loud).resolves.toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* A chain that ends tells the microphone it has stopped                    */
/* ------------------------------------------------------------------------ */

/**
 * The deaf window is sized before the chain starts, from `estimateSpeechMs`,
 * and against recorded clips that guess is consistently short -- clips run
 * slower than sixteen characters a second and carry leading and trailing
 * silence. Both measured off the 2026-10-02 drive:
 *
 *   "You have seventeen. Dealer shows nine."  estimate 2375ms, clip 3550ms
 *   "Stand."                                  estimate  400ms, clip 1240ms
 *
 * The first left the microphone live for the last 476ms of the prompt, under
 * the app's own voice. `looksLikeLateSelfEcho` catches long echoes on their
 * words and deliberately will not touch anything shorter than three words, so
 * a one-word echo depends on the timer alone -- and the timer should stop
 * guessing the moment it has a measurement.
 *
 * The live-TTS path has reported endings since the same change. This is the
 * path that actually speaks: the recorded voice ships on.
 */
describe('a clip chain says when it has stopped', () => {
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => _resetClipsForTest());
  afterEach(() => {
    setSpeechActivityListener(null);
    _resetClipsForTest();
    (globalThis as any).fetch = realFetch;
    delete (globalThis as any).window;
  });

  function oneClipVoice(): void {
    mockFetchRouter({
      'index.json': async () => ({ voices: [{ id: 'aria', label: 'Aria' }], default: 'aria' }),
      'manifest.json': async () => ({ clips: { queen: 'queen.mp3', four: 'four.mp3' } }),
    });
  }

  it('reports the ending of a chain that ran to the end', async () => {
    const env = installFakeAudioEnv();
    oneClipVoice();
    const phases: (string | undefined)[] = [];
    setSpeechActivityListener((_ms, _text, phase) => phases.push(phase));

    const play = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    expect(phases, 'the chain reported an ending before it had one').toEqual([]);

    env.instances[0].onended?.();
    await expect(play).resolves.toBe(true);

    expect(phases).toEqual(['end']);
  });

  it('reports it once per chain, not once per clip', async () => {
    const env = installFakeAudioEnv();
    oneClipVoice();
    const phases: (string | undefined)[] = [];
    setSpeechActivityListener((_ms, _text, phase) => phases.push(phase));

    // Two clips, one utterance. The microphone stops being deaf when the
    // SENTENCE is over, not between its halves.
    const play = playClipsAsync('queen, four');
    await vi.waitFor(() => expect(env.instances[0]?.src).toContain('queen.mp3'));
    env.instances[0].onended?.();
    await vi.waitFor(() => expect(env.instances[0]?.src).toContain('four.mp3'));
    expect(phases).toEqual([]);
    env.instances[0].onended?.();
    await expect(play).resolves.toBe(true);

    expect(phases).toEqual(['end']);
  });

  it('reports a chain that was cut off, which has also stopped making noise', async () => {
    const env = installFakeAudioEnv();
    oneClipVoice();
    const phases: (string | undefined)[] = [];
    setSpeechActivityListener((_ms, _text, phase) => phases.push(phase));

    const play = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    // An interrupted line is silent from that moment, and a window held open
    // for the rest of an utterance nobody heard is a deaf microphone.
    stopClips();
    await expect(play).resolves.toBe(true);

    expect(phases).toEqual(['end']);
  });

  it('does not throw when nothing is listening, or when the listener does', async () => {
    const env = installFakeAudioEnv();
    oneClipVoice();
    setSpeechActivityListener(() => {
      throw new Error('nope');
    });

    const play = playClipsAsync('queen');
    await vi.waitFor(() => expect(env.instances.length).toBe(1));
    env.instances[0].onended?.();
    // A consumer's bookkeeping must never take out the utterance that was
    // trying to tell it something.
    await expect(play).resolves.toBe(true);
  });
});
