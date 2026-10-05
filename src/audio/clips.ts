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

import { elementVolume } from './volume';
import { getSharedAudioContext, ensureContextRunning } from './audioContext';
import { cachedToneDataUri, toneSamples, TONE_SAMPLE_RATE } from './tone';
import { isVoiceCaptureActive, micSessionCostPaid } from './micSessionCost';
import { diag } from '../diag/diagnosticLog';
import { notifySpeechEnded } from './speechActivity';

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
/**
 * Which voice the clip path would actually use right now.
 *
 * Resolves the index default when no voice has been chosen yet, exactly as
 * `prewarmClips` and the speech path do. The raw `currentClipVoice` is empty
 * until the audio settings are applied, so a diagnostic that read it directly
 * would look up a manifest for the empty string, find nothing, and report
 * that every line is unclipped -- which is what the car check did on its
 * first render.
 */
export async function activeClipVoice(): Promise<string | null> {
  return currentClipVoice || (await resolveDefaultVoiceId());
}

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

/**
 * The same cascade as `segmentForClips`, but keeping each sentence's TEXT
 * alongside the clips that speak it.
 *
 * `segmentForClips` flattens everything into one file list, which is all the
 * happy path needs. It is not enough to recover from a failure PART WAY
 * through: to speak only what is left, the player has to know which words the
 * clip that just failed was standing in for.
 */
export interface ClipSegment {
  text: string;
  files: string[];
}

export function segmentsForClips(text: string, manifest: ClipManifest): ClipSegment[] | null {
  const whole = manifestLookup(manifest, text);
  if (whole !== null) return [{ text, files: [whole] }];

  const segments: ClipSegment[] = [];
  for (const sentence of splitIntoSentences(text)) {
    const matched = matchSentence(sentence, manifest);
    if (matched === null) return null;
    segments.push({ text: sentence, files: matched });
  }
  return segments;
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

/**
 * Loads the current voice's manifest BEFORE anything asks to speak.
 *
 * `hasClips` is a cache read and has to be (speech.ts needs a synchronous
 * gate to decide between clips and live TTS), so without this the very first
 * utterance after a cold load always missed and went live -- see hasClips's
 * own note. That is worse than one line in the wrong voice: live speech opens
 * no media element, so in a car the OPENING line of a session is precisely
 * the one the head unit cannot see, and it is usually the one that says what
 * the drill is.
 *
 * Fire-and-forget by design. Every failure inside resolves to `{}`, which
 * leaves the live-TTS fallback exactly as it was.
 */
export async function prewarmClips(): Promise<void> {
  const voiceId = currentClipVoice || (await resolveDefaultVoiceId());
  if (!voiceId) return;
  await loadVoiceManifest(voiceId);
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

/**
 * Elements that have already played and are idle, waiting to be used again.
 *
 * WHY THEY ARE KEPT. `play()` on an element that has never played is subject
 * to the activation check; an element that HAS played is unlocked for the life
 * of the page. The chain used to build a new element per clip, which threw
 * that unlocked state away on every line and re-faced the gate each time. On
 * the 2026-09-30 drive it was refused exactly once -- `echo-voice-1`, fifty
 * milliseconds after the recogniser confirmed it was listening -- and the step
 * fell through to live TTS in a different voice, which is the one outcome the
 * clip path exists to prevent. The gate is least likely to pass precisely when
 * the recogniser has just taken the audio session, and that is when the drill
 * needs the clip.
 *
 * WHY A POOL AND NOT ONE ELEMENT, which is what this was first written as.
 * The comment on `activeChain` says "at most one at a time, matching
 * speech.ts's single-utterance model", and that is not true of the table:
 * `speak()` is fire-and-forget, so dealing a round starts five chains inside
 * one millisecond. Sharing a single element made each new chain's `src`
 * assignment abort the pending `play()` of the one before it -- four
 * `clip-broke why=play-rejected name=AbortError` in a row, four lines spoken
 * in the fallback voice, and a regression caught by the browser after the
 * fakes had passed.
 *
 * So: one chain at a time -- which is the drill, and is the case where the
 * activation gate actually bites -- always gets the same unlocked element
 * back, and overlapping chains each get their own exactly as before.
 *
 * ONE POOL, because clips never touch Web Audio any more. There used to be a
 * second pool for elements routed through a GainNode, which was the only way
 * past 100% -- `HTMLMediaElement.volume` throws above 1. Measured on the phone
 * on 2026-10-02, that route DAMAGES playback, and the clip durations in the
 * export say so plainly:
 *
 *   "You have fifteen. Dealer shows five."   3029ms at 100%, 4455ms at 200%
 *   "You have ace, seven. Dealer shows six." 3099ms at 100%, 7687ms at 150%
 *
 * Note which way round those last two are: 150% stretched a prompt further
 * than 200% did, so the damage is not proportional to the gain and therefore
 * is not the gain. Nor is it clipping -- the shipped clips peak at 0.34-0.81,
 * and not one sample in a 150-file sample exceeds full scale even at 2x. What
 * the two bad readings have in common is the ROUTE: the clips are 24kHz files,
 * a MediaElementSource has to resample them in real time into a graph clocked
 * by the hardware, and on iOS the open microphone moves that hardware rate
 * (play-and-record, and narrowband again over Bluetooth HFP). Choppy at 150%,
 * silent at 200%, exactly as reported.
 *
 * The boost it bought was never real anyway. Above unity the element is
 * consumed permanently, a suspended graph makes the clip SILENT rather than
 * quiet, and `AbortError` came back on the shared routed elements at
 * 18:59:27, 18:59:45 and 19:01:52 -- the very failure the ordinary pool
 * exists to prevent. Clips now clamp to 1.0 and stay on the plain element
 * path. Volume above 100% still raises the CHIMES, which are generated by an
 * oscillator already inside the graph and so cost nothing to amplify.
 */
/**
 * 50ms of 8-bit silence at 8kHz, as a data URI.
 *
 * Priming needs something an element will actually load and play: `play()`
 * with no source rejects, and a zero-length stream is refused by some
 * decoders. 8-bit PCM silence is 0x80, not 0x00.
 */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

/**
 * How many elements to prime.
 *
 * Three, from the shape of the thing being protected: dealing a round starts
 * five chains inside one millisecond, but they are short and settle fast, so
 * three in flight covers what the 2026-10-02 log actually shows (two
 * overlapping chains, twice). More elements cost a little memory; too few
 * costs a line in the fallback voice.
 */
const PRIMED_ELEMENTS = 3;

const idleAudio: HTMLAudioElement[] = [];

function takeIdleAudio(AudioCtor: new () => HTMLAudioElement): HTMLAudioElement {
  return idleAudio.pop() ?? new AudioCtor();
}

/** How long a 120ms tone is given before its element is reclaimed regardless. */
const TONE_RELEASE_MS = 1000;

/**
 * How a pooled one-shot finished.
 *
 * Returned rather than merely logged because the car check has to be able to
 * SAY which happened: `output-route` reported `fail why=NotAllowedError` twice
 * on the 2026-10-04 run and the operator was never asked anything, and a check
 * that cannot distinguish "the phone refused to play it" from "it played and
 * you did not answer" is a check that wastes a drive. Anything other than
 * 'ended' means no sound reached the cabin.
 */
export type PooledEnding = 'ended' | 'error' | 'timeout' | 'threw' | 'unavailable' | string;

/**
 * Play silence on fresh elements so they are unlocked before the drill needs
 * them. CALLED FROM A USER GESTURE ONLY -- see audio/unlock.ts, which is the
 * only caller and the only place where `play()` is allowed to succeed on an
 * element that has never played.
 *
 * The gate bites on a round that deals five overlapping chains inside a
 * millisecond: the fifth gets a brand-new element, and a brand-new element has
 * never played.
 */
export function primeClipAudio(count = PRIMED_ELEMENTS): void {
  const AudioCtor = getAudioCtor();
  if (!AudioCtor) return;
  for (let i = 0; i < count; i++) {
    try {
      const audio = new AudioCtor();
      audio.src = SILENT_WAV;
      if (typeof audio.load === 'function') audio.load();
      audio.volume = 0;
      const result = audio.play();
      const park = () => {
        try {
          audio.pause();
        } catch {
          /* never throw on the way in */
        }
        if (!idleAudio.includes(audio)) idleAudio.push(audio);
      };
      if (result && typeof result.then === 'function') {
        result.then(park, () => {
          // Refused even inside the gesture. The element is useless to the
          // pool -- a locked element handed to a chain is the failure this
          // exists to prevent -- so it is dropped rather than parked.
          diag('speak', 'prime-refused', {});
        });
      } else {
        park();
      }
    } catch {
      /* one element failing must not stop the rest */
    }
  }
}

/** How many idle ordinary elements the pool holds. Test-only. */
export function idleClipAudioCountForTest(): number {
  return idleAudio.length;
}

function returnIdleAudio(audio: HTMLAudioElement): void {
  try {
    // Paused on the way back, so an element released by the watchdog or by a
    // stop is not still rendering samples when the next chain picks it up.
    audio.pause();
  } catch {
    // never throw on the way out
  }
  // Handlers dropped: a late `ended` from the clip this element was playing
  // must not advance whichever chain takes it next.
  audio.onended = null;
  audio.onerror = null;
  if (!idleAudio.includes(audio)) idleAudio.push(audio);
}

/**
 * Play a short generated sound on a pooled element, outside the chain.
 *
 * FOR THE CHIMES, which until 2026-10-03 were an oscillator in the Web Audio
 * graph and on Jack's phone made no sound at all: `chime-suspended` twice in
 * one export, eight seconds after a gesture had resumed the graph, while
 * recorded clips played perfectly throughout. The element path works on that
 * device and the graph does not, so the chimes move to the element path.
 *
 * DELIBERATELY NOT A CHAIN. `activeChain` holds at most one, so routing a
 * 120ms beep through it would cancel whatever prompt was speaking -- and the
 * cue that says "the microphone is open" fires precisely when a prompt has
 * just finished and the next may have started. A chime and a sentence are
 * allowed to overlap; a chime must never stop one.
 *
 * It still draws from the same pool, because the pool is what makes an
 * element unlocked: a brand-new element on iOS has never played, so `play()`
 * on it is refused outside a gesture, which is the failure that silenced
 * clips on the 2026-10-02 drive.
 */
export function playPooledTone(
  src: string,
  volume: number,
  opts?: { releaseAfterMs?: number },
): Promise<PooledEnding> {
  const AudioCtor = getAudioCtor();
  if (!AudioCtor) return Promise.resolve('unavailable');
  let settle: (how: PooledEnding) => void = () => {};
  const ending = new Promise<PooledEnding>((resolve) => {
    settle = resolve;
  });
  try {
    const audio = takeIdleAudio(AudioCtor);
    let returned = false;
    const release = (how: PooledEnding) => {
      if (returned) return;
      returned = true;
      returnIdleAudio(audio);
      settle(how);
    };
    audio.src = src;
    if (typeof audio.load === 'function') audio.load();
    audio.volume = elementVolume(volume);
    audio.onended = () => release('ended');
    audio.onerror = () => {
      diag('speak', 'tone-broke', { why: 'element-error' });
      release('error');
    };
    const result = audio.play();
    if (result && typeof result.then === 'function') {
      result.catch((e: unknown) => {
        // Named, because the two reasons are different problems: a locked
        // element (NotAllowedError) means the gesture unlock did not happen,
        // and an AbortError means something reset `src` underneath it.
        diag('speak', 'tone-broke', {
          why: 'play-rejected',
          name: (e as { name?: string })?.name ?? 'unknown',
        });
        release(((e as { name?: string })?.name ?? 'play-rejected') as PooledEnding);
      });
    }
    // A belt-and-braces return: `ended` is not guaranteed on a sound this
    // short if the element is interrupted, and an element that never comes
    // back is an element the pool has lost.
    setTimeout(() => release('timeout'), opts?.releaseAfterMs ?? TONE_RELEASE_MS);
  } catch {
    /* a chime must never throw into whatever asked for it */
    settle('threw');
  }
  return ending;
}

/**
 * Should a chime go through Web Audio rather than a pooled <audio> element?
 * Same rule as the clip chains: once a microphone has been opened in this page
 * load the element is on the quiet earpiece and Web Audio is on the loud
 * speaker; before that, Web Audio would obey the ring switch and the element
 * does not, so the element stays.
 */
export function chimeWantsWebAudio(): boolean {
  return isVoiceCaptureActive() || micSessionCostPaid();
}

/** Decoded-equivalent tone buffers, per context and frequency. */
const toneBuffers = new WeakMap<AudioContext, Map<number, AudioBuffer>>();

function toneBuffer(ctx: AudioContext, frequencyHz: number): AudioBuffer {
  let perCtx = toneBuffers.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    toneBuffers.set(ctx, perCtx);
  }
  const hit = perCtx.get(frequencyHz);
  if (hit) return hit;
  const samples = toneSamples(frequencyHz);
  const buffer = ctx.createBuffer(1, samples.length, TONE_SAMPLE_RATE);
  buffer.getChannelData(0).set(samples);
  perCtx.set(frequencyHz, buffer);
  return buffer;
}

/**
 * Play a chime tone. Through Web Audio when the mic has been opened (see
 * {@link chimeWantsWebAudio}), otherwise, or if the context cannot run, on a
 * pooled element exactly as before. `peak` is the chime level (`chimePeak`):
 * the buffer is full scale and the gain node applies it, which is the same
 * arithmetic the element's `volume` did. NOT a chain, so it never stops a
 * prompt. Never throws.
 */
export function playChimeTone(frequencyHz: number, peak: number): void {
  const onElement = () => {
    void playPooledTone(cachedToneDataUri(frequencyHz), peak);
  };
  if (!chimeWantsWebAudio()) return onElement();
  const ctx = getSharedAudioContext();
  if (!ctx) {
    diag('speak', 'chime-fallback', { why: 'no-context' });
    return onElement();
  }
  const start = () => {
    try {
      const src = ctx.createBufferSource();
      src.buffer = toneBuffer(ctx, frequencyHz);
      const gain = ctx.createGain();
      gain.gain.value = Math.min(1, Math.max(0, peak));
      src.connect(gain);
      gain.connect(ctx.destination);
      src.onended = () => {
        try {
          gain.disconnect();
        } catch {
          /* already gone */
        }
      };
      src.start();
    } catch {
      diag('speak', 'chime-fallback', { why: 'threw' });
      onElement();
    }
  };
  if (ctx.state === 'running') return start();
  void ensureContextRunning(ctx).then((ok) => {
    if (ok) return start();
    diag('speak', 'chime-suspended', { state: ctx.state });
    onElement();
  });
}

/**
 * How a clip chain finished. `ended` is the only one that means the operator
 * heard the whole line -- the rest were indistinguishable from it in the log.
 */
type ClipEndReason = 'ended' | 'watchdog' | 'stopped' | 'element-error' | 'play-rejected' | 'threw';

interface ActiveChain {
  audio: HTMLAudioElement | null;
  /** Stops a Web Audio chain's current source; null on the element path. */
  stopSource: (() => void) | null;
  /** The pooled element to hand back on settle. */
  pooled: HTMLAudioElement | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  /** For the `ms` on `clip-end`: a stall reads as the watchdog's full timeout. */
  startedAt: number;
  settle: (played: boolean) => void;
}

/** The clip chain currently playing (or awaiting its next-clip watchdog), if
 * any -- at most one at a time, matching speech.ts's single-utterance model. */
let activeChain: ActiveChain | null = null;

/**
 * Is a recorded clip making a noise right now?
 *
 * Asked by `chimeWhenQuiet` in speech.ts, which can see its own pending
 * utterances but not these -- and the recorded voice is the one that ships on
 * by default, so without this the held cue would think the app was silent
 * through every prompt it actually speaks.
 */
export function isClipChainActive(): boolean {
  return activeChain !== null;
}

function clearActiveWatchdog(chain: ActiveChain): void {
  if (chain.watchdog !== null) clearTimeout(chain.watchdog);
  chain.watchdog = null;
}

/**
 * Settle a chain, saying WHY.
 *
 * The reason is the point. `played: true` was written by three completely
 * different events -- the last file's `ended`, the watchdog giving up, and a
 * deliberate interrupt -- and none of them logged anything, so all three
 * produced a byte-identical export: `speak path path=clip` plus
 * `speak clip-chain`, exactly what a flawless utterance produces. A route
 * that flips to a disconnected A2DP sink makes the element accept `play()`
 * and stall; eight seconds later the watchdog reports success and the log
 * says the app spoke. The operator taps "Heard nothing", and the analysis
 * goes looking at volume and car routing for a clip that never rendered a
 * sample. Three events, three lines.
 */
function settleChain(chain: ActiveChain, played: boolean, reason: ClipEndReason): void {
  if (chain.settled) return;
  chain.settled = true;
  clearActiveWatchdog(chain);
  if (activeChain === chain) activeChain = null;
  // THE ONE EXIT, which is why the release lives here: `ended`, the watchdog,
  // a deliberate stop, an element error and a rejected `play()` all land on
  // this function, and an element released on only some of those paths leaks
  // out of the pool and the next chain builds a locked one.
  if (chain.pooled) {
    returnIdleAudio(chain.pooled);
    chain.pooled = null;
  }
  // `fellBack`, NOT `played`. The boolean is the answer to "must the caller now
  // try live TTS?", not a claim that audio reached the cabin -- but rendered as
  // a plain field beside `reason` it read as the latter, and it is the more
  // assertive of the two: `clip-end reason=watchdog played=true` contradicts
  // itself on one line, and a reader counting `played=true` to tally delivered
  // lines counted every stall and every deliberate interruption as delivered.
  diag('speak', 'clip-end', {
    reason,
    fellBack: !played,
    ms: Date.now() - chain.startedAt,
  });
  /**
   * THE MICROPHONE IS TOLD THE REAL STOPPING TIME, from the one exit every
   * ending already funnels through.
   *
   * The deaf window is sized before the chain starts, from `estimateSpeechMs`,
   * and against recorded clips that guess is consistently short -- clips run
   * slower than sixteen characters a second and carry leading and trailing
   * silence. Both of these are measured off the 2026-10-02 drive:
   *
   *   "You have seventeen. Dealer shows nine."  estimate 2375ms, clip 3550ms
   *   "Stand."                                  estimate  400ms, clip 1240ms
   *
   * The first left the microphone live for the last 476ms of the prompt, under
   * the app's own voice. `looksLikeLateSelfEcho` catches the long ones on their
   * words but deliberately will not touch anything shorter than three words --
   * that floor is what protects real answers, every one of which is one or two
   * words -- so for the short ones the timer has to be right. Here it can be.
   *
   * `suppressFor` never shortens, so a chain that finished early keeps the
   * window its estimate bought.
   */
  notifySpeechEnded();
  chain.settle(played);
}

function stopActiveChain(): void {
  const chain = activeChain;
  if (!chain) return;
  try {
    chain.audio?.pause();
    chain.stopSource?.();
  } catch {
    // never throw
  }
  // Settled by the interrupt/stop, not a failure -- a caller must never
  // wrongly fall back to live TTS over a clip that was cut off on purpose.
  settleChain(chain, true, 'stopped');
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
/**
 * What a clip chain left unsaid.
 *
 * `played: false` with a `remainder` means some clips DID play before the
 * chain broke. Re-speaking the original text in that case says the opening
 * twice, which is what used to happen: one failed clip in the middle threw
 * away the whole utterance and the live-TTS fallback started again from the
 * top. The remainder lets the caller pick up where the clips stopped.
 */
export interface ClipPlayResult {
  played: boolean;
  /** Text still unspoken, or null when nothing was spoken (or all of it was). */
  remainder: string | null;
}

/** No clip was reached at all, so the caller should speak the whole text. */
const NOTHING_PLAYED: ClipPlayResult = { played: false, remainder: null };

/**
 * Decoded clips, by URL. Decoding resamples ONCE to the context's rate, which
 * is the difference from the MediaElementSource route `caa5a73` removed: that
 * one resampled 24kHz audio live into a graph whose hardware rate the open
 * microphone moves, and stretched and chopped the clips. Jack, on the decoded
 * path with the mic open, 2026-10-05: "they sounded identical".
 */
const decodedClips = new Map<string, Promise<AudioBuffer>>();

function decodeClip(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  let p = decodedClips.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`http-${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes));
    // A failed decode must not poison the cache for the next attempt.
    p.catch(() => decodedClips.delete(url));
    decodedClips.set(url, p);
  }
  return p;
}

/**
 * Play a clip chain through Web Audio rather than an <audio> element.
 *
 * WHY: with a microphone open, iOS sends <audio> to the earpiece and Web
 * Audio to the loud speaker. Measured blind on Jack's phone on 2026-10-05:
 * Web Audio 7 of 7 on the loud speaker across three runs, the element 2 of 7.
 * Used only while a voice session is running (see micSessionCost.ts) because
 * outside one, Web Audio obeys the ring switch and the element does not.
 *
 * Returns null if it could not start -- no context, still suspended, or the
 * first clip would not decode -- so the caller can fall back to the element
 * with nothing yet spoken. After the first sound it owns the outcome.
 *
 * Rate is applied as `playbackRate`, which on an AudioBufferSourceNode moves
 * pitch with speed (there is no preservesPitch). The default is 1; a rate
 * other than 1 is logged so a drive can say whether it matters.
 */
async function playChainThroughWebAudio(
  urls: string[],
  opts: {
    voiceId: string;
    files: string[];
    rate: number;
    volume: number | undefined;
    remainderFrom: (i: number) => string;
    /** True once a later interrupt has replaced this line. */
    superseded: () => boolean;
  },
): Promise<ClipPlayResult | null> {
  const ctx = getSharedAudioContext();
  if (!ctx) {
    diag('speak', 'clip-webaudio-skip', { why: 'no-context' });
    return null;
  }
  if (!(await ensureContextRunning(ctx))) {
    diag('speak', 'clip-webaudio-skip', { why: 'context-' + ctx.state });
    return null;
  }
  let first: AudioBuffer;
  try {
    first = await decodeClip(ctx, urls[0]!);
  } catch (e) {
    diag('speak', 'clip-webaudio-skip', { why: 'decode', name: e instanceof Error ? e.message : String(e) });
    return null;
  }
  if (opts.superseded()) {
    diag('speak', 'clip-skip', { why: 'superseded' });
    return { played: true, remainder: null };
  }
  // Warm the rest while the first plays.
  for (const u of urls.slice(1)) void decodeClip(ctx, u).catch(() => {});

  return new Promise<ClipPlayResult>((resolve) => {
    let index = 0;
    let current: AudioBufferSourceNode | null = null;
    const gain = ctx.createGain();
    gain.gain.value = opts.volume === undefined ? 1 : elementVolume(opts.volume);
    gain.connect(ctx.destination);

    const chain: ActiveChain = {
      audio: null,
      pooled: null,
      stopSource: () => {
        try {
          if (current) current.onended = null;
          current?.stop();
        } catch {
          /* already stopped */
        }
      },
      watchdog: null,
      settled: false,
      startedAt: Date.now(),
      settle: (ok) => {
        try {
          gain.disconnect();
        } catch {
          /* already gone */
        }
        if (ok) resolve({ played: true, remainder: null });
        else resolve({ played: false, remainder: index > 0 ? opts.remainderFrom(index) : null });
      },
    };
    activeChain = chain;

    diag('speak', 'clip-chain', {
      voiceId: opts.voiceId,
      n: urls.length,
      files: opts.files.join(', '),
      path: 'webaudio',
      ...(opts.rate !== 1 ? { rate: opts.rate } : {}),
    });

    const playBuffer = (buffer: AudioBuffer) => {
      if (chain.settled) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = opts.rate;
      src.connect(gain);
      current = src;
      clearActiveWatchdog(chain);
      chain.watchdog = setTimeout(
        () => settleChain(chain, true, 'watchdog'),
        (buffer.duration / Math.max(opts.rate, 0.1)) * 1000 + 3000,
      );
      src.onended = () => {
        index += 1;
        void next();
      };
      src.start();
    };

    const next = async () => {
      if (chain.settled) return;
      if (index >= urls.length) {
        settleChain(chain, true, 'ended');
        return;
      }
      try {
        playBuffer(index === 0 ? first : await decodeClip(ctx, urls[index]!));
      } catch {
        diag('speak', 'clip-broke', { file: opts.files[index] ?? '(none)', index, of: urls.length, why: 'decode', path: 'webaudio' });
        settleChain(chain, false, 'element-error');
      }
    };
    void next();
  });
}

/** Back-compat wrapper: the boolean half of {@link playClipsResumable}. */
export function playClipsAsync(
  text: string,
  opts?: { interrupt?: boolean; rate?: number; volume?: number },
): Promise<boolean> {
  return playClipsResumable(text, opts).then((r) => r.played);
}

/**
 * Bumped by every interrupting call, and read again after the awaits.
 *
 * Stopping the active chain at entry is not enough on its own: two calls a
 * few milliseconds apart both find nothing to stop while their manifests are
 * still loading, then both start a chain -- two prompts over each other, the
 * first orphaned until its watchdog gives up. An interrupt has to supersede
 * every call that STARTED before it, not just the chain that happened to be
 * playing at that instant.
 */
let interruptEpoch = 0;

export function playClipsResumable(
  text: string,
  opts?: { interrupt?: boolean; rate?: number; volume?: number },
): Promise<ClipPlayResult> {
  return (async () => {
    try {
      if (opts?.interrupt) {
        interruptEpoch++;
        stopActiveChain();
      }
      const epoch = interruptEpoch;

      const voiceId = currentClipVoice || (await resolveDefaultVoiceId());
      if (!voiceId) {
        // SAID, not silent. `speak path path=clip` is written BEFORE this
        // function runs, so a bare return left the export claiming the clip
        // path with nothing after it -- and "the manifest fetch failed", "the
        // deploy has no public/clips" and "this phrase has no recording" became
        // one outcome again, which is what `clip-chain` exists to prevent.
        diag('speak', 'clip-skip', { why: 'no-voice-resolved' });
        return NOTHING_PLAYED;
      }

      const manifest = await loadVoiceManifest(voiceId);
      const segments = segmentsForClips(text, manifest);
      if (!segments || segments.length === 0) {
        // The ordinary miss: this phrase has no recording in this voice. Named
        // so it can be told apart from a manifest that never loaded at all.
        diag('speak', 'clip-skip', { why: 'no-cascade-match', voice: voiceId });
        return NOTHING_PLAYED;
      }

      const AudioCtor = getAudioCtor();
      if (!AudioCtor) {
        diag('speak', 'clip-skip', { why: 'no-audio-element' });
        return NOTHING_PLAYED;
      }

      if (epoch !== interruptEpoch) {
        // Settled like a deliberate stop: the caller must not fall back to
        // live TTS and speak a line that was replaced while it loaded.
        diag('speak', 'clip-skip', { why: 'superseded' });
        return { played: true, remainder: null };
      }
      // An interrupting call that is still current stops whatever started
      // while it was loading -- a non-interrupting call that got there first.
      if (opts?.interrupt) stopActiveChain();

      const rate = opts?.rate ?? 1;
      // Presence-checked, never `?? 1` on a truthiness test: volume 0 means
      // silence and must survive the trip, exactly as on the live-TTS path.
      const volume = opts?.volume;
      const base = clipsBaseUrl();
      // Flattened for playback, but each entry remembers the sentence it came
      // from so a failure can be reported as "everything from here on".
      const fileList: { file: string; segIndex: number }[] = segments.flatMap((seg, segIndex) =>
        seg.files.map((file) => ({ file, segIndex })),
      );

      /**
       * The text from the sentence containing clip `i` to the end. The
       * partially-spoken sentence is repeated in full -- there is no way to
       * resume mid-sentence -- which is a word or two of overlap instead of
       * the entire utterance.
       */
      const remainderFrom = (i: number): string => {
        const segIndex = fileList[i]?.segIndex ?? 0;
        return segments.slice(segIndex).map((seg) => seg.text).join(' ');
      };

      // Once the microphone has been open in this page load, not just while it
      // is: the <audio> element stays on the earpiece for the rest of the page
      // after capture ends. Jack's 2026-10-05 Flashcards log has it -- voice
      // toggled off at 01:36:04, and the next two prompts played on the
      // element and came out of the earpiece. Web Audio after the mic closed
      // was on the loud speaker in the first desk run.
      if (isVoiceCaptureActive() || micSessionCostPaid()) {
        const viaWebAudio = await playChainThroughWebAudio(
          fileList.map((f) => `${base}clips/${voiceId}/${f.file}`),
          {
            voiceId,
            files: fileList.map((f) => f.file),
            rate,
            volume,
            remainderFrom,
            superseded: () => epoch !== interruptEpoch,
          },
        );
        if (viaWebAudio) return viaWebAudio;
        // null: Web Audio could not start at all, so nothing has played --
        // the element path below speaks the whole line instead.
      }

      return await new Promise<ClipPlayResult>((resolve) => {
        // The chain settles with a bare boolean (stopClips and the watchdog
        // both use it), so translate that into a result here, consulting the
        // live `index` to work out what was left unsaid.
        const settleResult = (ok: boolean) => {
          if (ok) resolve({ played: true, remainder: null });
          else resolve({ played: false, remainder: index > 0 ? remainderFrom(index) : null });
        };

        const audio = takeIdleAudio(AudioCtor);

        const chain: ActiveChain = {
          stopSource: null,
          audio,
          pooled: audio,
          watchdog: null,
          settled: false,
          startedAt: Date.now(),
          settle: settleResult,
        };
        activeChain = chain;

        let index = 0;

        const armWatchdog = () => {
          clearActiveWatchdog(chain);
          chain.watchdog = setTimeout(() => settleChain(chain, true, 'watchdog'), CLIP_WATCHDOG_PER_CLIP_MS);
        };

        const playNext = () => {
          if (chain.settled) return;
          if (index >= fileList.length) {
            settleChain(chain, true, 'ended');
            return;
          }
          try {
            if (index === 0) {
              // THE CHAIN, named. Without it the export could say a clip
              // played but never which recording, so "the phrase has no
              // clip", "this deploy is missing the clips directory" and "the
              // manifest fetch failed" were one indistinguishable outcome.
              diag('speak', 'clip-chain', {
                voiceId,
                n: fileList.length,
                files: fileList.map((f) => f.file).join(', '),
              });
            }
            audio.src = `${base}clips/${voiceId}/${fileList[index]!.file}`;
            // EXPLICIT, because the element is reused. The drill repeats a line
            // verbatim whenever the operator asks for it again, so the same src
            // is routinely assigned twice in a row; an element sitting at
            // `ended` that does not reload accepts `play()`, never fires
            // `ended` again, and the chain reports success eight seconds later
            // off the watchdog while the cabin hears nothing. Setting `src` is
            // specified to invoke the load algorithm either way -- this says so
            // out loud rather than relying on it.
            if (typeof audio.load === 'function') audio.load();
            // After the load, not before: loading resets `playbackRate` to
            // `defaultPlaybackRate`, which would silently undo `opts.rate`.
            audio.preservesPitch = true;
            audio.playbackRate = rate;
            // Never hand the element more than 1: the setter THROWS above
            // that, and a throw here would kill the whole utterance. Anything
            // above unity is carried by a GainNode instead.
            //
            // Set unconditionally, because the element is reused: a chain that
            // passed no volume used to leave the element untouched, which was
            // the same thing as 1 on a brand-new one but is the PREVIOUS
            // chain's level on a shared one -- so a quiet step could mute the
            // step after it.
            const wantedVolume = volume === undefined ? 1 : elementVolume(volume);
            audio.volume = wantedVolume;
            /**
             * READ BACK, because the setter may be a no-op.
             *
             * WebKit has long made `HTMLMediaElement.volume` read-only on
             * iOS -- the hardware buttons are the only volume control -- and
             * assignment is ignored silently rather than throwing. If that is
             * still true on Jack's phone then the Volume setting does nothing
             * to the recorded voice at all, which matters a great deal more now
             * that the GainNode above unity is gone (see the pool comment): it
             * would mean the app has NO software level control over the voice,
             * and the only levers left are the hardware buttons and the output
             * route. One line from a drive settles it.
             *
             * `elementVolume` already clamps to 1, so a request above 100%
             * arrives here as 100% and plays on the plain path. Nothing is
             * routed through Web Audio.
             *
             * First clip only: the same element, the same answer, every time.
             */
            if (index === 0 && Math.abs(audio.volume - wantedVolume) > 0.01) {
              diag('speak', 'volume-ignored', { wanted: wantedVolume, got: audio.volume });
            }
            armWatchdog();

            audio.onended = () => {
              index += 1;
              playNext();
            };
            audio.onerror = () => {
              diag('speak', 'clip-broke', {
                file: fileList[index]!.file,
                index,
                of: fileList.length,
                why: 'error',
              });
              settleChain(chain, false, 'element-error');
            };

            const playResult = audio.play();
            if (playResult && typeof playResult.catch === 'function') {
              // LOGGED, unlike before. `play()` rejecting -- autoplay or
              // `NotAllowedError` -- is the single most likely mechanical
              // cause of a dead clip on iOS, and it was the one failure that
              // wrote nothing, while the rarer `error` event right above it
              // was logged. The two were not symmetric.
              playResult.catch((e: unknown) => {
                /**
                 * A rejection AFTER the chain has settled is the stop we asked
                 * for, not a fault. Pausing an element whose `play()` is still
                 * pending is how a browser reports a deliberate interruption,
                 * and `stopActiveChain` has already settled this chain
                 * `stopped` and sent the caller on its way. Logging
                 * `clip-broke` here put the word that means trouble into the
                 * export on every voice toggle mid-sentence -- see the test
                 * that pins this, and the 2026-10-03 reading it came from.
                 *
                 * `chain.settled` rather than the error NAME on purpose: an
                 * AbortError can also arrive from a `src` reassignment that
                 * nothing asked for, and that one is still a broken clip.
                 */
                if (chain.settled) return;
                diag('speak', 'clip-broke', {
                  file: fileList[index]?.file ?? '(none)',
                  index,
                  of: fileList.length,
                  why: 'play-rejected',
                  name: e instanceof Error ? e.name : String(e),
                });
                settleChain(chain, false, 'play-rejected');
              });
            }
          } catch {
            settleChain(chain, false, 'threw');
          }
        };

        playNext();
      });
    } catch (e) {
      // The outer catch: a manifest fetch that rejected, a bad JSON body, a
      // throwing Audio constructor. Silent until now, which is why a missing
      // `public/clips/` deploy looked exactly like clips being switched off.
      diag('speak', 'clip-skip', {
        why: 'threw',
        error: e instanceof Error ? e.name : String(e),
      });
      return NOTHING_PLAYED;
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
  decodedClips.clear();
  if (activeChain) {
    clearActiveWatchdog(activeChain);
  }
  activeChain = null;
  idleAudio.length = 0;
}
