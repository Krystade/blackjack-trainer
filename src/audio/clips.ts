/**
 * Pre-rendered clip playback for ANY drill utterance, via a longest-first
 * segmentation cascade over per-voice manifests plus native HTMLAudioElement
 * playback. Absence-guarded like speech.ts: unit tests run in node, where
 * `window`/`fetch`/`Audio` may be undefined or faked, and every export here
 * must behave as a silent no-op (never throw) so the app always has a safe
 * live-TTS fallback.
 *
 * Asset contract (generated separately -- this module never writes to
 * `public/clips/`, and gracefully degrades to live TTS whether the layout is
 * missing entirely or just a voice's manifest is):
 *
 *   public/clips/index.json               = { "voices": [{ "id", "label" }, ...], "default": "<voiceId>" }
 *   public/clips/<voiceId>/manifest.json   = { "clips": { "<exact spoken string>": "<slug>.mp3" } }
 *   public/clips/<voiceId>/<slug>.mp3
 *
 * Segmentation (`segmentForClips`) is a pure, longest-first cascade:
 *   a. Whole-string exact match against the manifest.
 *   b. Else split into SENTENCES on ". " / "? " / "! ", each sentence
 *      KEEPING its terminal punctuation (the final sentence keeps its
 *      trailing punctuation too, since there's nothing after it to strip).
 *   c. Any sentence that misses AND has no terminal sentence punctuation of
 *      its own (a list-like segment, e.g. a comma-joined card list) is split
 *      on ", " -- DROPPING the comma -- into items, each matched exactly.
 *   d. Anything still unmatched -> `null`. The caller then live-TTSes the
 *      WHOLE utterance; clip and live audio are never mixed within one
 *      utterance.
 * There is no fuzzy/substring matching anywhere in this cascade --
 * `manifestLookup` is exact-key-only, so "queen" never matches a "queen of
 * hearts" entry.
 */

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/* ------------------------------------------------------------------------ */
/* Clip-enable flag + current clip voice                                    */
/* ------------------------------------------------------------------------ */
/*
 * Wiring note: speech.ts must stay free of React/store imports (see its own
 * header comment), so both the enable flag and the selected voice can't flow
 * in as props/imports of AudioSettings. Instead these are plain module-level
 * flags: `useAudio.ts` (via effects keyed on `audio.useClips`/
 * `audio.clipVoice`) and the Settings screen's controls both call
 * `setClipsEnabled`/`setClipVoice` whenever the setting changes, and
 * speech.ts calls `isClipsEnabled()`/reads the current voice at speak-time.
 * Neither clips.ts nor speech.ts imports React or the store -- only
 * useAudio.ts and Settings.tsx (which already depend on both) do the wiring.
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

// '' means "use whatever public/clips/index.json names as its default" --
// matches DEFAULT_AUDIO.clipVoice (store/types.ts).
let currentClipVoice = '';

/** Sets the voice used to resolve manifests going forward. Pass `''` to fall
 * back to `index.json`'s `default`. Never throws/validates against the
 * index -- an unknown id simply resolves no manifest, degrading to live TTS. */
export function setClipVoice(voiceId: string): void {
  currentClipVoice = voiceId;
}

/* ------------------------------------------------------------------------ */
/* Manifest lookup -- pure, no I/O                                          */
/* ------------------------------------------------------------------------ */

export type ClipManifest = Record<string, string>;

export interface ClipVoiceInfo {
  id: string;
  label: string;
}

export interface ClipIndex {
  voices: ClipVoiceInfo[];
  default: string;
}

/**
 * Pure exact-key lookup -- no fuzzy/substring matching. Uses
 * `hasOwnProperty` (rather than a bare `manifest[text]`) so an inherited
 * `Object.prototype` member (e.g. `"constructor"`, `"toString"`) can never
 * be mistaken for a real clip entry.
 */
export function manifestLookup(manifest: ClipManifest, text: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(manifest, text)) return null;
  return manifest[text];
}

/** True when `sentence` ends with sentence-terminal punctuation of its own --
 * i.e. it is NOT a bare list-like segment eligible for comma-splitting. */
function hasTerminalPunctuation(sentence: string): boolean {
  return /[.?!]$/.test(sentence);
}

/**
 * Splits `text` into sentences on ". " / "? " / "! ", keeping the terminal
 * punctuation on the PRECEDING piece (a positive lookbehind split) so the
 * final sentence also keeps its own trailing punctuation -- there being
 * nothing after it to strip. Text with no sentence punctuation at all
 * (e.g. a bare comma list) comes back as a single one-element array.
 */
function splitIntoSentences(text: string): string[] {
  return text.split(/(?<=[.?!]) /);
}

/**
 * Matches a single sentence-shaped segment: an exact hit first, else --
 * only when the segment carries no terminal sentence punctuation of its own
 * (step c, list-like segments) -- a ", "-split (comma DROPPED) where every
 * item must match exactly. `null` if nothing matches.
 */
function matchSentence(sentence: string, manifest: ClipManifest): string[] | null {
  const direct = manifestLookup(manifest, sentence);
  if (direct !== null) return [direct];

  if (hasTerminalPunctuation(sentence)) return null;

  const items = sentence.split(', ');
  if (items.length <= 1) return null;

  const files: string[] = [];
  for (const item of items) {
    const file = manifestLookup(manifest, item);
    if (file === null) return null;
    files.push(file);
  }
  return files;
}

/**
 * Longest-first cascade (see the module header) turning `text` into an
 * ordered list of clip filenames, or `null` if any piece is unmatched. Pure
 * and fully unit-testable -- no I/O, no browser APIs.
 */
export function segmentForClips(text: string, manifest: ClipManifest): string[] | null {
  const whole = manifestLookup(manifest, text);
  if (whole !== null) return [whole];

  const files: string[] = [];
  for (const sentence of splitIntoSentences(text)) {
    const matched = matchSentence(sentence, manifest);
    if (matched === null) return null;
    files.push(...matched);
  }
  return files;
}

/* ------------------------------------------------------------------------ */
/* Index + per-voice manifest loading                                       */
/* ------------------------------------------------------------------------ */

function clipsBaseUrl(): string {
  const base = (import.meta.env.BASE_URL as string | undefined) ?? '/';
  return base;
}

let indexPromise: Promise<ClipIndex | null> | null = null;
let indexCache: ClipIndex | null = null;

function parseClipIndex(json: unknown): ClipIndex | null {
  const obj = json as { voices?: unknown; default?: unknown } | null;
  if (!obj || !Array.isArray(obj.voices) || typeof obj.default !== 'string') return null;

  const voices: ClipVoiceInfo[] = [];
  for (const v of obj.voices) {
    const id = (v as { id?: unknown } | null)?.id;
    const label = (v as { label?: unknown } | null)?.label;
    if (typeof id === 'string' && typeof label === 'string') {
      voices.push({ id, label });
    }
  }
  return { voices, default: obj.default };
}

/**
 * Fetches and memoizes `public/clips/index.json` (the voice list + default).
 * Built from `import.meta.env.BASE_URL` -- never a leading-slash absolute
 * path. Resolves to `null` on ANY failure (fetch unsupported, network error,
 * non-OK response, malformed JSON), so callers silently fall back to live
 * TTS rather than throwing or rejecting.
 */
export function loadClipIndex(): Promise<ClipIndex | null> {
  if (indexPromise) return indexPromise;

  indexPromise = (async () => {
    if (typeof fetch !== 'function') return null;
    try {
      const res = await fetch(`${clipsBaseUrl()}clips/index.json`);
      if (!res.ok) return null;
      const json = (await res.json()) as unknown;
      return parseClipIndex(json);
    } catch {
      return null;
    }
  })();

  void indexPromise.then((idx) => {
    indexCache = idx;
  });

  return indexPromise;
}

const voiceManifestPromises = new Map<string, Promise<ClipManifest>>();
const voiceManifestCache = new Map<string, ClipManifest>();

/**
 * Fetches and memoizes (per `voiceId`) `public/clips/<voiceId>/manifest.json`.
 * Resolves to `{}` on ANY failure, same rationale as `loadClipIndex`.
 */
export function loadVoiceManifest(voiceId: string): Promise<ClipManifest> {
  const existing = voiceManifestPromises.get(voiceId);
  if (existing) return existing;

  const pending = (async () => {
    if (typeof fetch !== 'function') return {};
    try {
      const res = await fetch(`${clipsBaseUrl()}clips/${voiceId}/manifest.json`);
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

  voiceManifestPromises.set(voiceId, pending);
  void pending.then((m) => {
    voiceManifestCache.set(voiceId, m);
  });
  return pending;
}

async function resolveDefaultVoiceId(): Promise<string | null> {
  const idx = await loadClipIndex();
  return idx?.default || null;
}

/** Sync (cache-only) resolution of "which voice manifest applies right now",
 * kicking off background loads as needed. Used by `hasClips`, which must
 * answer synchronously. */
function resolveVoiceIdSync(): string | null {
  if (currentClipVoice) return currentClipVoice;
  if (!indexPromise) {
    void loadClipIndex();
    return null;
  }
  return indexCache?.default || null;
}

function currentManifestSync(): ClipManifest | null {
  const voiceId = resolveVoiceIdSync();
  if (!voiceId) return null;
  const cached = voiceManifestCache.get(voiceId);
  if (cached) return cached;
  void loadVoiceManifest(voiceId);
  return null;
}

/**
 * Exact-cascade check (via `segmentForClips`) against whatever manifest is
 * CURRENTLY loaded for the current voice. Synchronous by design (callers
 * like speech.ts need a sync gate before deciding to `await
 * playClipsAsync`), so it reads caches rather than awaiting fetches. If
 * nothing has loaded yet, this kicks a load off in the background
 * (fire-and-forget) so a later call sees fresh data -- meaning the very
 * first lookup after enabling clips may miss once and fall back to live
 * TTS, then clips take over from then on.
 */
export function hasClips(text: string): boolean {
  const manifest = currentManifestSync();
  if (manifest === null) return false;
  return segmentForClips(text, manifest) !== null;
}

/* ------------------------------------------------------------------------ */
/* HTMLAudioElement playback                                                */
/* ------------------------------------------------------------------------ */

function getAudioCtor(): (new () => HTMLAudioElement) | undefined {
  if (!hasWindow()) return undefined;
  const w = window as unknown as { Audio?: new () => HTMLAudioElement };
  return w.Audio;
}

interface ActiveChain {
  audio: HTMLAudioElement | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  settle: (played: boolean) => void;
}

/** The clip chain currently playing (or awaiting its next-clip watchdog), if
 * any -- at most one at a time, matching speech.ts's single-utterance model. */
let activeChain: ActiveChain | null = null;

function clearActiveWatchdog(chain: ActiveChain): void {
  if (chain.watchdog !== null) clearTimeout(chain.watchdog);
  chain.watchdog = null;
}

function settleChain(chain: ActiveChain, played: boolean): void {
  if (chain.settled) return;
  chain.settled = true;
  clearActiveWatchdog(chain);
  if (activeChain === chain) activeChain = null;
  chain.settle(played);
}

function stopActiveChain(): void {
  const chain = activeChain;
  if (!chain) return;
  try {
    chain.audio?.pause();
  } catch {
    // never throw
  }
  // Settled by the interrupt/stop, not a failure -- a caller must never
  // wrongly fall back to live TTS over a clip that was cut off on purpose.
  settleChain(chain, true);
}

/** Stops any currently-playing clip chain and settles its pending promise. */
export function stopClips(): void {
  stopActiveChain();
}

// Generous per-clip ceiling so a lost `ended` event can never hang the
// caller forever (mirrors speech.ts's speakAsync watchdog). Re-armed on
// every clip in the chain rather than sized to a single total duration,
// since duration isn't known ahead of playback for an HTMLAudioElement.
const CLIP_WATCHDOG_PER_CLIP_MS = 8000;

/**
 * Plays the ordered clip list for `text` (via `segmentForClips` against the
 * current voice's manifest) as a chain of HTMLAudioElements, one per
 * segment, advancing on `ended`. `preservesPitch` is forced `true` and
 * `playbackRate` set from `opts.rate` (default 1) on every clip, so fast
 * playback stays natural instead of chipmunking. A small natural gap between
 * clips is fine -- there is no cross-fade/gapless stitching.
 *
 * Resolves `true` once the whole chain finishes (`ended` on every clip, an
 * explicit stop/interrupt, or a watchdog firing after a lost `ended`),
 * `false` if there's no clip-voice resolvable, no cascade match for `text`,
 * or playback fails -- the caller should then fall back to live TTS. Never
 * throws/rejects.
 */
export function playClipsAsync(
  text: string,
  opts?: { interrupt?: boolean; rate?: number },
): Promise<boolean> {
  return (async () => {
    try {
      if (opts?.interrupt) {
        stopActiveChain();
      }

      const voiceId = currentClipVoice || (await resolveDefaultVoiceId());
      if (!voiceId) return false;

      const manifest = await loadVoiceManifest(voiceId);
      const files = segmentForClips(text, manifest);
      if (!files || files.length === 0) return false;

      const AudioCtor = getAudioCtor();
      if (!AudioCtor) return false;

      const rate = opts?.rate ?? 1;
      const base = clipsBaseUrl();
      const fileList: string[] = files;

      return await new Promise<boolean>((resolve) => {
        const chain: ActiveChain = {
          audio: null,
          watchdog: null,
          settled: false,
          settle: resolve,
        };
        activeChain = chain;

        let index = 0;

        const armWatchdog = () => {
          clearActiveWatchdog(chain);
          chain.watchdog = setTimeout(() => settleChain(chain, true), CLIP_WATCHDOG_PER_CLIP_MS);
        };

        const playNext = () => {
          if (chain.settled) return;
          if (index >= fileList.length) {
            settleChain(chain, true);
            return;
          }
          try {
            const audio = new AudioCtor();
            audio.src = `${base}clips/${voiceId}/${fileList[index]}`;
            audio.preservesPitch = true;
            audio.playbackRate = rate;
            chain.audio = audio;
            armWatchdog();

            audio.onended = () => {
              index += 1;
              playNext();
            };
            audio.onerror = () => settleChain(chain, false);

            const playResult = audio.play();
            if (playResult && typeof playResult.catch === 'function') {
              playResult.catch(() => settleChain(chain, false));
            }
          } catch {
            settleChain(chain, false);
          }
        };

        playNext();
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
  currentClipVoice = '';
  indexPromise = null;
  indexCache = null;
  voiceManifestPromises.clear();
  voiceManifestCache.clear();
  if (activeChain) {
    clearActiveWatchdog(activeChain);
  }
  activeChain = null;
}
