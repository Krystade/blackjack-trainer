/**
 * Pre-rendered clip playback over the Web Audio API. Absence-guarded like
 * speech.ts: unit tests run in node, where `window`/`fetch`/`AudioContext`
 * may be undefined or faked, and every export here must behave as a silent
 * no-op (never throw) so the app always has a safe live-TTS fallback.
 *
 * Manifest shape (`public/clips/manifest.json`):
 *   { "voice": "en-US-AriaNeural", "clips": { "<exact spoken string>": "<file>.mp3" } }
 * The keys are the EXACT strings `src/audio/narrate.ts` emits. Matching is
 * exact-string only (see `manifestLookup`) -- there is no fuzzy/substring
 * matching, so "queen" never matches the "queen of hearts" entry.
 */

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/* ------------------------------------------------------------------------ */
/* Clip-enable flag                                                         */
/* ------------------------------------------------------------------------ */
/*
 * Wiring note: speech.ts must stay free of React/store imports (see its own
 * header comment), so the enable flag can't flow in as a prop/import of
 * AudioSettings. Instead this is a plain module-level flag: `useAudio.ts`
 * (via a useEffect keyed on `audio.useClips`) and the Settings screen's
 * toggle both call `setClipsEnabled()` whenever the setting changes, and
 * speech.ts calls `isClipsEnabled()` to read it at speak-time. Neither
 * clips.ts nor speech.ts imports React or the store -- only useAudio.ts and
 * Settings.tsx (which already depend on both) do the wiring.
 */

// Default false: matches DEFAULT_AUDIO.useClips (store/types.ts) so a cold
// app load -- before any Settings/useAudio wiring has run -- behaves
// exactly like today (live TTS only) until something explicitly enables it.
let clipsEnabled = false;

export function setClipsEnabled(enabled: boolean): void {
  clipsEnabled = enabled;
}

export function isClipsEnabled(): boolean {
  return clipsEnabled;
}

/* ------------------------------------------------------------------------ */
/* Manifest loading                                                         */
/* ------------------------------------------------------------------------ */

export type ClipManifest = Record<string, string>;

let manifestPromise: Promise<ClipManifest> | null = null;
let manifestCache: ClipManifest = {};

/**
 * Pure exact-key lookup -- no fuzzy/substring matching. Uses
 * `hasOwnProperty` (rather than a bare `manifest[text]`) so an inherited
 * `Object.prototype` member (e.g. `"constructor"`, `"toString"`) can never
 * be mistaken for a real clip entry. Exported standalone so the matching
 * logic is unit-testable without a browser or fetch.
 */
export function manifestLookup(manifest: ClipManifest, text: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(manifest, text)) return null;
  return manifest[text];
}

function clipsBaseUrl(): string {
  const base = (import.meta.env.BASE_URL as string | undefined) ?? '/';
  return base;
}

/**
 * Fetches and memoizes `public/clips/manifest.json`. Built from
 * `import.meta.env.BASE_URL` -- never a leading-slash absolute path, since
 * the app is served from a non-root GitHub Pages base path. Resolves to
 * `{}` on ANY failure (fetch unsupported, network error, non-OK response,
 * malformed JSON), so callers silently fall back to live TTS rather than
 * throwing or rejecting.
 */
export function loadClipManifest(): Promise<ClipManifest> {
  if (manifestPromise) return manifestPromise;

  manifestPromise = (async () => {
    if (typeof fetch !== 'function') return {};
    try {
      const url = `${clipsBaseUrl()}clips/manifest.json`;
      const res = await fetch(url);
      if (!res.ok) return {};
      const json = (await res.json()) as unknown;
      const clips = (json as { clips?: unknown } | null)?.clips;
      if (typeof clips === 'object' && clips !== null) {
        return clips as ClipManifest;
      }
      return {};
    } catch {
      return {};
    }
  })();

  // Keep a synchronous-readable cache for hasClip() once this settles.
  void manifestPromise.then((m) => {
    manifestCache = m;
  });

  return manifestPromise;
}

/**
 * Exact-key check against whatever manifest is CURRENTLY loaded. Synchronous
 * by design (callers like speech.ts need a sync gate before deciding to
 * `await playClipAsync`), so it reads `manifestCache` rather than awaiting
 * the fetch. If no load has started yet, this kicks one off in the
 * background (fire-and-forget) so a later call sees fresh data -- meaning
 * the very first lookup after enabling clips may miss once and fall back to
 * live TTS, then clips take over from then on.
 */
export function hasClip(text: string): boolean {
  if (!manifestPromise) {
    void loadClipManifest();
  }
  return manifestLookup(manifestCache, text) !== null;
}

/* ------------------------------------------------------------------------ */
/* Web Audio playback                                                       */
/* ------------------------------------------------------------------------ */

type AudioContextCtor = new () => AudioContext;

let sharedAudioContext: AudioContext | null = null;

function getAudioContextCtor(): AudioContextCtor | undefined {
  if (!hasWindow()) return undefined;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

function getSharedAudioContext(): AudioContext | null {
  if (sharedAudioContext) return sharedAudioContext;
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    sharedAudioContext = new Ctor();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

// Decoded-buffer cache, memoized per filename so repeated plays of the same
// clip never re-fetch/re-decode.
const bufferCache = new Map<string, AudioBuffer>();
const bufferLoadPromises = new Map<string, Promise<AudioBuffer | null>>();

async function loadClipBuffer(ctx: AudioContext, file: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(file);
  if (cached) return cached;

  let pending = bufferLoadPromises.get(file);
  if (!pending) {
    pending = (async () => {
      try {
        if (typeof fetch !== 'function') return null;
        const res = await fetch(`${clipsBaseUrl()}clips/${file}`);
        if (!res.ok) return null;
        const arrayBuffer = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        bufferCache.set(file, buffer);
        return buffer;
      } catch {
        return null;
      } finally {
        bufferLoadPromises.delete(file);
      }
    })();
    bufferLoadPromises.set(file, pending);
  }
  return pending;
}

type PendingClip = {
  // Kept alive so the node can't be GC'd mid-play (same rationale as
  // speech.ts's PendingSpeech.utterance).
  source: AudioBufferSourceNode;
  resolve: (played: boolean) => void;
  watchdog: ReturnType<typeof setTimeout>;
};

/**
 * Clips currently awaiting `onended`/watchdog. A stop/interrupt settles
 * these as `true` (superseded/stopped deliberately, not a decode/playback
 * failure) so a caller never wrongly falls back to live TTS over a clip
 * that was intentionally cut off.
 */
let pendingClips: PendingClip[] = [];

function settlePendingClip(pending: PendingClip, played: boolean): void {
  const idx = pendingClips.indexOf(pending);
  if (idx !== -1) pendingClips.splice(idx, 1);
  clearTimeout(pending.watchdog);
  pending.resolve(played);
}

function stopAllPendingClips(): void {
  const pending = pendingClips;
  pendingClips = [];
  for (const p of pending) {
    clearTimeout(p.watchdog);
    try {
      p.source.stop();
    } catch {
      // Already stopped/ended -- never throw.
    }
    p.resolve(true);
  }
}

/** Stops any currently-playing clip(s) and settles their pending promises. */
export function stopClips(): void {
  stopAllPendingClips();
}

const CLIP_WATCHDOG_FLOOR_MS = 500;
const CLIP_WATCHDOG_MARGIN_MS = 1000;

/** Generous, buffer-duration-scaled bound so a lost `onended` can never hang
 * the caller forever (mirrors speech.ts's speakAsync watchdog). */
function estimateClipWatchdogMs(durationSec: number): number {
  return Math.max(CLIP_WATCHDOG_FLOOR_MS, durationSec * 1000 + CLIP_WATCHDOG_MARGIN_MS);
}

/**
 * Plays the pre-rendered clip for `text` via Web Audio buffer scheduling.
 * Resolves `true` once playback ends (`onended`, an explicit stop/interrupt,
 * or the watchdog firing after a lost `onended`), `false` if there is no
 * clip for `text` or anything fails (decode error, no AudioContext, etc) --
 * the caller should then fall back to live TTS. Never throws/rejects.
 */
export function playClipAsync(text: string, opts?: { interrupt?: boolean }): Promise<boolean> {
  return (async () => {
    try {
      const manifest = manifestPromise ? await manifestPromise : await loadClipManifest();
      const file = manifestLookup(manifest, text);
      if (!file) return false;

      const ctx = getSharedAudioContext();
      if (!ctx) return false;

      if (opts?.interrupt) {
        stopAllPendingClips();
      }

      // Some browsers create AudioContext in a 'suspended' state until a
      // user gesture resumes it; resume() is a no-op if already running.
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // Ignore -- proceed to try playback regardless.
        }
      }

      const buffer = await loadClipBuffer(ctx, file);
      if (!buffer) return false;

      return await new Promise<boolean>((resolve) => {
        try {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);

          const pending: PendingClip = {
            source,
            resolve,
            watchdog: setTimeout(
              () => settlePendingClip(pending, true),
              estimateClipWatchdogMs(buffer.duration),
            ),
          };
          pendingClips.push(pending);

          source.onended = () => settlePendingClip(pending, true);
          source.start(0);
        } catch {
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  })();
}

/* ------------------------------------------------------------------------ */
/* Test-only reset                                                          */
/* ------------------------------------------------------------------------ */

/** Resets all module-level state between unit tests. Test-only -- never
 * called from app code (mirrors persist.ts's `_setStorage` convention). */
export function _resetClipsForTest(): void {
  clipsEnabled = false;
  manifestPromise = null;
  manifestCache = {};
  sharedAudioContext = null;
  bufferCache.clear();
  bufferLoadPromises.clear();
  for (const p of pendingClips) {
    clearTimeout(p.watchdog);
  }
  pendingClips = [];
}
