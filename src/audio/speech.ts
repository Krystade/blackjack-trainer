/**
 * Thin, deliberately-untested-by-unit wrapper over the browser's speech and
 * audio APIs (`window.speechSynthesis`, `AudioContext`). This is the ONLY
 * file in the app allowed to touch those globals.
 *
 * Every export here is absence-guarded and never throws: unit tests run in
 * node, where `window`, `speechSynthesis`, and `AudioContext` are all
 * undefined, and this module must behave as a silent no-op there.
 *
 * `?e2e=1` in the page URL switches speak()/chime() into a log-only mode
 * (`window.__speechLog`) for Playwright assertions instead of calling the
 * real APIs. e2e mode is checked FIRST in speak()/speakAsync(), before the
 * clip gate below, so `?e2e=1` fully bypasses clips.ts too -- Web Audio is
 * never touched under e2e, keeping all existing e2e specs unaffected.
 *
 * Pre-rendered clip playback (`./clips.ts`) is layered on top: when clips
 * are enabled (`setClipsEnabled`, driven by `AudioSettings.useClips`) and a
 * `segmentForClips` cascade match exists for the text (possibly several
 * concatenated clips), speak()/speakAsync() play it instead of calling live
 * TTS, falling back to the live path below if the cascade misses or
 * playback fails. `opts.rate` flows through to clip playback too (clips.ts
 * forces `preservesPitch = true` so fast clip playback stays natural).
 * clips.ts has no store/React dependency, so this import doesn't change
 * speech.ts's dependency profile.
 */
import {
  hasClips,
  isClipChainActive,
  isClipsEnabled,
  playClipsResumable,
  playChimeTone,
  chimeWantsWebAudio,
  stopClips,
} from "./clips";
import { chimePeak, utteranceVolume } from "./volume";
// Only the test reset is still wanted here: nothing in speech.ts touches the
// Web Audio graph any more. The chimes were the last thing that did.
import { _resetSharedAudioContextForTest } from "./audioContext";
// Re-exported: existing specs import this reset helper from speech.ts.
export { _resetSharedAudioContextForTest };
import {
  initMediaSession,
  setNowPlaying,
  setPlaybackState,
} from "./mediaSession";
import { holdAudioFocus, reassertAudioFocus } from "./audioFocus";
import { invokeWheelCommand } from "./wheelCommands";
import { diag } from "../diag/diagnosticLog";
import {
  notifyActivityMs,
  notifySpeechEnded,
  setSpeechActivityListener,
  type SpeechActivityListener,
  type SpeechActivityPhase,
  whenSomethingFinishesSpeaking,
} from "./speechActivity";

declare global {
  interface Window {
    __speechLog?: string[];
    /**
     * The same utterances, with the options they were spoken WITH.
     *
     * A parallel array rather than a richer `__speechLog`, because every
     * existing spec reads that one as plain strings and rewriting them all to
     * prove one new thing would be a bad trade. This exists for assertions
     * about HOW something was said -- mute, in particular, is implemented as
     * a volume of zero, so "was it silent" is a question about the options
     * and is invisible in the text.
     */
    __speechOptsLog?: {
      text: string;
      volume?: number;
      rate?: number;
      voiceURI?: string;
    }[];
    /**
     * How long a swallowed utterance should pretend to take, in e2e mode only.
     *
     * Everything else here resolves instantly, which is right for a spec about
     * WHAT was said and useless for one about what the screen does WHILE it is
     * being said. Those questions are real — the answers are held back during a
     * measured line and must not be during a read-aloud instruction, and the
     * difference is only observable inside the utterance. Read inside the e2e
     * branch and nowhere else, so it cannot reach a real device: without
     * `?e2e=1` this path is not taken at all.
     */
    __e2eSpeechDelayMs?: number;
  }
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/** True when running under the Playwright e2e harness (`?e2e=1` in the URL). */
export function isE2eAudioMode(): boolean {
  return (
    hasWindow() &&
    typeof window.location !== "undefined" &&
    typeof window.location.search === "string" &&
    window.location.search.includes("e2e=1")
  );
}

function pushSpeechLog(entry: string, opts?: SpeechOpts): void {
  if (!hasWindow()) return;
  if (!window.__speechLog) {
    window.__speechLog = [];
  }
  window.__speechLog.push(entry);
  if (!window.__speechOptsLog) {
    window.__speechOptsLog = [];
  }
  window.__speechOptsLog.push({
    text: entry,
    volume: opts?.volume,
    rate: opts?.rate,
    voiceURI: opts?.voiceURI,
  });
}

/** True when this environment can actually speak (real speechSynthesis present). */
export function isSpeechSupported(): boolean {
  return hasWindow() && "speechSynthesis" in window && !!window.speechSynthesis;
}

/** Available voices, or [] when unsupported. */
export function listVoices(): { name: string; voiceURI: string }[] {
  return getRawVoices().map((v) => ({ name: v.name, voiceURI: v.voiceURI }));
}

/* ---------------------------------------------------------------------- */
/* Voice selection                                                        */
/* ---------------------------------------------------------------------- */

/**
 * The Web Speech API exposes no quality attribute on `SpeechSynthesisVoice`
 * (just `name`/`lang`/`voiceURI`/`localService`/`default`), so "pick a good
 * voice" is necessarily a curated heuristic over the name string. See
 * docs/research/2026-07-21-web-tts-options.md §1.
 */
const PREFERRED_VOICE_NAME_TOKENS = [
  "google",
  "natural",
  "neural",
  "premium",
  "enhanced",
  "siri",
];

/**
 * Legacy SAPI voices and Apple novelty voices — the "robotic" complaints.
 *
 * THE DRIVE OF 2026-09-29 was read its prompts by `Bahh`, which bleats. Three
 * of Apple's novelty voices were named here and Apple ships about twenty, so
 * the list was not the safeguard it looked like: on iOS every en-US voice
 * scores identically, the tie-break is alphabetical, and with `Albert` and
 * `Bad News` penalised the next name in the alphabet is `Bahh`. Not a glitch
 * -- the guaranteed pick whenever no voice is configured.
 *
 * Completed here, but a denylist of joke voices is a losing game and is no
 * longer what carries this: `DEFAULT_VOICE_WEIGHT` below lets the platform
 * nominate its own voice, which is a fact rather than a guess at one. This
 * list is the fallback for platforms that nominate nothing.
 */
const PENALIZED_VOICE_NAME_TOKENS = [
  "microsoft david",
  "microsoft zira",
  "microsoft mark",
  "espeak",
  // Apple's novelty set, in full.
  "albert",
  "bad news",
  "bahh",
  "bells",
  "boing",
  "bubbles",
  "cellos",
  "good news",
  "jester",
  "organ",
  "superstar",
  "trinoids",
  "whisper",
  "wobble",
  "zarvox",
];

const NAME_TOKEN_WEIGHT = 10;

/**
 * What the platform itself nominates, which the heuristic used to ignore
 * while guessing at the same question from name substrings.
 *
 * `SpeechSynthesisVoice.default` is the one quality-adjacent fact the Web
 * Speech API actually exposes, and this file's own header notes the API
 * exposes `default` before going on not to read it. Weighted BELOW a
 * genuinely premium name and ABOVE a plain one, so a nominated voice breaks
 * the ties that decide the outcome on iOS without outranking a Google or
 * Neural voice where one exists.
 */
const DEFAULT_VOICE_WEIGHT = 5;

/**
 * Voices a platform ships for actually reading text, as opposed to for a
 * joke or from 1984.
 *
 * WHY AN ALLOWLIST EXISTS AT ALL, having argued against one. Weighting the
 * platform's nomination only helps if some voice reports `default`, and
 * nothing here has ever logged whether this iPhone does -- so the first
 * version of that fix silently depended on it. With no nomination every
 * en-US voice ties, the alphabetical tie-break decides again, and from the
 * real iOS list the winner is `Fred`: the classic robotic Apple voice,
 * unlisted because the denylist was written for the NOVELTY voices. That is
 * the same fault as `Bahh` a few letters later, and it is the second name to
 * walk through a denylist, which is the argument against relying on one.
 *
 * Ranked BELOW the platform's nomination, so a phone that names its own
 * voice still wins, and below a premium name. Deliberately short: these are
 * the built-in voices Apple and Android actually use for speech, not a
 * ranking of them.
 */
const KNOWN_SPEECH_VOICE_TOKENS = ['samantha', 'alex', 'karen', 'daniel', 'moira', 'tessa'];

const KNOWN_VOICE_WEIGHT = 3;
/** Large enough that the language tier always dominates the name score. */
const LANG_EXACT_WEIGHT = 1000;
const LANG_FAMILY_WEIGHT = 500;

function scoreVoiceName(name: string): number {
  const lower = name.toLowerCase();
  let score = 0;
  for (const token of PREFERRED_VOICE_NAME_TOKENS) {
    if (lower.includes(token)) score += NAME_TOKEN_WEIGHT;
  }
  for (const token of PENALIZED_VOICE_NAME_TOKENS) {
    if (lower.includes(token)) score -= NAME_TOKEN_WEIGHT;
  }
  return score;
}

/** Whatever the platform nominated. See `DEFAULT_VOICE_WEIGHT`. */
function scoreVoiceDefault(voice: SpeechSynthesisVoice): number {
  return voice.default === true ? DEFAULT_VOICE_WEIGHT : 0;
}

/** A voice the platform ships for speech. See `KNOWN_SPEECH_VOICE_TOKENS`. */
function scoreKnownSpeechVoice(name: string): number {
  const lower = name.toLowerCase();
  return KNOWN_SPEECH_VOICE_TOKENS.some((t) => lower.includes(t)) ? KNOWN_VOICE_WEIGHT : 0;
}

function scoreVoiceLang(voiceLang: string, targetLang: string): number {
  const lower = (voiceLang || "").toLowerCase();
  const target = targetLang.toLowerCase();
  const targetFamily = target.split("-")[0];
  if (lower.startsWith(target)) return LANG_EXACT_WEIGHT;
  if (targetFamily && lower.startsWith(targetFamily)) return LANG_FAMILY_WEIGHT;
  return 0;
}

/**
 * Picks the best-sounding available voice via a name/lang heuristic (pure,
 * no browser APIs touched). Deterministic: calling it twice on the same
 * list returns the same voice, regardless of input order. Returns `null`
 * for an empty list.
 */
export function pickBestVoice(
  voices: SpeechSynthesisVoice[],
  lang: string = "en-US",
): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;

  for (const voice of voices) {
    const score =
      scoreVoiceName(voice.name) +
      scoreVoiceLang(voice.lang, lang) +
      scoreVoiceDefault(voice) +
      scoreKnownSpeechVoice(voice.name);
    const isBetter =
      best === null ||
      score > bestScore ||
      (score === bestScore && voice.name.localeCompare(best.name) < 0);
    if (isBetter) {
      best = voice;
      bestScore = score;
    }
  }

  return best;
}

/**
 * THE VOICE LIST, ONCE SEEN, IS KEPT.
 *
 * `getVoices()` is reached from exactly one place on the live path --
 * `resolveVoice` -- and clips never touch `speechSynthesis` at all. So on a
 * session that runs on clips until something falls back, the first fallback
 * utterance was also the first time the list had ever been asked for, and
 * WebKit populates it asynchronously on that first access. The utterance was
 * therefore built against an empty list and died with no `end` event.
 *
 * Run `vfktl7` in the car on 2026-09-29 is the evidence: five live
 * utterances, one sentence, one voice, the FIRST ending
 * `reason=watchdog ms=4615` and the next four ending normally at ~1.1s. Same
 * text, same voice, same route, 43 seconds into the page load -- so elapsed
 * time does not explain it and "first access" does.
 */
let voiceCache: SpeechSynthesisVoice[] = [];
let voicesSubscribed = false;

/**
 * Open the voice list early and keep it warm, so no drill line is ever the
 * call that opens it. Idempotent, never throws, and safe to call often: it is
 * called at boot and again on every clip utterance, because iOS may not
 * populate the list until a user gesture has happened and a clip is the first
 * gesture-driven audio in any session.
 */
export function primeVoices(): void {
  try {
    if (!isSpeechSupported()) return;
    const synth = window.speechSynthesis;
    const seen = synth.getVoices();
    if (seen.length > 0) voiceCache = seen;
    if (!voicesSubscribed && typeof synth.addEventListener === "function") {
      // Marked BEFORE the call, so a throwing addEventListener cannot leave
      // this retrying on every clip for the life of the page.
      voicesSubscribed = true;
      synth.addEventListener("voiceschanged", () => {
        try {
          const list = window.speechSynthesis.getVoices();
          if (list.length > 0) voiceCache = list;
        } catch {
          /* the late list is an optimisation; never let it throw into an event */
        }
      });
    }
  } catch {
    /* a voice inventory is a diagnostic: it must never break boot or a clip */
  }
}

export function _resetVoiceCacheForTest(): void {
  voiceCache = [];
  voicesSubscribed = false;
}

function getRawVoices(): SpeechSynthesisVoice[] {
  try {
    if (isSpeechSupported()) {
      const live = window.speechSynthesis.getVoices();
      // A NON-EMPTY live list always wins: the platform may add voices, and
      // the cache must not pin an early short list forever.
      if (live.length > 0) {
        voiceCache = live;
        return live;
      }
    }
  } catch {
    /* fall through to whatever was seen last */
  }
  // EMPTY DOES NOT ERASE. WebKit returns [] transiently, and a voice chosen
  // from [] is no voice at all -- which is the watchdog this exists to stop.
  return voiceCache;
}

/**
 * Resolves a stored `voiceURI` preference to an actual voice.
 * - A real value is matched on `voiceURI` OR `name`: iOS/Safari can report
 *   different (or empty) `voiceURI` values than desktop for the very same
 *   voice, so URI-only matching silently breaks voice switching there.
 * - Missing/`'default'` falls back to `pickBestVoice` so users get a good
 *   voice without configuring anything.
 * - If nothing matches (a stale explicit preference, or no voices at all),
 *   returns `null` so the caller leaves `utterance.voice` unset rather than
 *   silently substituting something the user didn't choose.
 */
function resolveVoice(
  voiceURI: string | undefined,
): SpeechSynthesisVoice | null {
  const voices = getRawVoices();
  if (voiceURI && voiceURI !== "default") {
    return (
      voices.find((v) => v.voiceURI === voiceURI || v.name === voiceURI) ?? null
    );
  }
  return pickBestVoice(voices);
}

/** Stops any in-progress/queued speech and settles any pending speakAsync()
 * promise (Safari does not fire `onend` after `cancel()`, so we can't rely
 * on the event to unblock an awaiting caller). No-op when unsupported. */
export function cancelSpeech(): void {
  // Clips play through HTMLAudioElement (or Web Audio), which speechSynthesis.cancel() knows
  // nothing about. `stopClips` existed for exactly this and had ZERO callers,
  // so leaving a screen mid-clip left the audio playing over whatever came
  // next, and an interrupting live-TTS line spoke ON TOP of the clip chain.
  /**
   * THE CUE GOES FIRST, before anything that produces an ending.
   *
   * `stopClips()` settles the chain, which tells every waiter the app has
   * stopped talking -- and a cue held for silence would take that as its
   * moment and beep. On a screen change that beep lands on the next screen;
   * on the mute button it lands in a room someone just silenced.
   */
  pendingCue?.();
  stopClips();
  settleAllPendingSpeeches();
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // never throw
  }
}

/**
 * The option bag every speaking entry point accepts. `volume` is 0..1 and
 * maps to `SpeechSynthesisUtterance.volume` (and to the chime's gain peak);
 * it is threaded through exactly the same paths `rate` already travels.
 */
export interface SpeechOpts {
  interrupt?: boolean;
  rate?: number;
  voiceURI?: string;
  volume?: number;
  /**
   * A correlation id written onto this utterance's `speak path` log entry.
   *
   * The path entry is the only record of WHICH voice spoke, and without a tag
   * it can be tied to the thing that asked for it by adjacency alone -- which
   * fails as soon as anything else speaks in between, and fails silently.
   */
  tag?: string;
}

/**
 * Apply `opts.volume` to an utterance.
 *
 * PRESENCE-checked, not truthiness-checked, unlike `rate` directly above every
 * call site of this helper. `volume: 0` is a legitimate setting — the operator
 * dragging the slider to the floor means silence — and `if (opts.volume)`
 * would silently discard it, leaving the engine default of full volume. That
 * is the single most surprising bug this feature could ship, so it is pinned
 * by its own test.
 */
function applyVolume(
  utterance: SpeechSynthesisUtterance,
  opts?: SpeechOpts,
): void {
  if (opts?.volume !== undefined) {
    // Above 1 the spec clamps silently, so this changes no behaviour -- it
    // states the ceiling in the one place someone would look for it. Live
    // speechSynthesis genuinely cannot be amplified; only the clips path can.
    utterance.volume = utteranceVolume(opts.volume);
  }
}

/* ---------------------------------------------------------------------- */
/* Last-utterance tracking — the "say that again" primitive                */
/* ---------------------------------------------------------------------- */

/**
 * The most recent thing the app SAID, backing the Repeat control.
 *
 * Deliberately the raw spoken string rather than a re-derived prompt. The
 * pre-existing eyes-free long-press (`ZonePad`'s `onRepeat`) rebuilds the
 * prompt from current state, which quietly makes it a different feature: it
 * can only ever repeat the prompt, never the correction, the result, or the
 * count that just went by — and it re-reads state that may have moved on
 * since. Storing what was actually uttered means Repeat is honest at every
 * point in the flow, which is the whole point when the user is driving and
 * missed a phrase.
 */
let lastSpoken: string | null = null;

/**
 * The options the last line was spoken WITH, remembered alongside the text.
 *
 * `repeatLast()` took an `opts` argument but its only real caller -- the
 * media-session `previoustrack` handler, i.e. skip-back on the steering wheel
 * -- passes none, so the repeat reached `applyVolume` with
 * `opts.volume === undefined` and played at the engine default of 1. A wheel
 * press therefore re-spoke the line at FULL volume while the app was muted or
 * turned down, and at the default rate rather than the configured one. The
 * options are part of the utterance, so they are remembered with it.
 */
let lastSpokenOpts: SpeechOpts | null = null;

/** Records an utterance. Called by every public speaking entry point, and by
 * nothing else — see `chime()`, which pointedly does not call it. */
function rememberSpoken(text: string, opts?: SpeechOpts): void {
  lastSpoken = text;
  // `tag` is deliberately dropped: it correlates ONE request with ONE path
  // entry, and reusing it would file the repeat's path under the original
  // request, which is exactly the adjacency confusion tags exist to remove.
  const { tag: _tag, interrupt: _interrupt, ...rest } = opts ?? {};
  lastSpokenOpts = rest;
}

/** The last spoken text, or `null` when nothing has been said yet. */
export function getLastSpoken(): string | null {
  return lastSpoken;
}

/* ------------------------------------------------------------------ */
/* Speech activity, for the microphone                                 */
/* ------------------------------------------------------------------ */

/**
 * Voice input and voice output share a room.
 *
 * When speech recognition is listening and the app says "Correct. Stand.",
 * the microphone hears it -- especially over a car speaker -- and would grade
 * a Stand the driver never said. Every utterance the app produces is a live
 * command unless the listener is told to ignore that stretch of audio.
 *
 * THE CHANNEL ITSELF NOW LIVES IN audio/speechActivity.ts, and the reason is
 * the half of it that reports an ENDING. Clips settle in clips.ts, which
 * cannot import this file -- this file imports clips.ts -- so while the
 * listener lived here only live TTS could say when it had stopped, and the
 * recorded voice ships on by default. Re-exported from here because every
 * caller already looks for it in this module.
 */
export { setSpeechActivityListener, whenSomethingFinishesSpeaking };
export type { SpeechActivityListener, SpeechActivityPhase };

/** Average characters per second of speech at rate 1.0, from ~150wpm. */
const SPEECH_CHARS_PER_SEC = 16;
/** Even one word occupies the microphone for a moment. */
const MIN_SPEECH_MS = 400;
/** A ceiling, so a freak input cannot deafen the microphone indefinitely. */
const MAX_SPEECH_MS = 10_000;

/**
 * Roughly how long `text` will take to say.
 *
 * An estimate is the honest tool here: clips and live TTS have different real
 * durations, `speechSynthesis` reports nothing useful up front, and the value
 * only has to be good enough to bracket the audio. Erring long costs a little
 * deafness; erring short lets the app grade its own voice, so the floor and
 * the tail that follows are both deliberate.
 */
export function estimateSpeechMs(text: string, rate = 1): number {
  const chars = text.trim().length;
  if (chars === 0) return 0;
  const safeRate = rate > 0 ? rate : 1;
  const ms = ((chars / SPEECH_CHARS_PER_SEC) * 1000) / safeRate;
  return Math.round(Math.min(MAX_SPEECH_MS, Math.max(MIN_SPEECH_MS, ms)));
}

/**
 * How long a held cue will wait before sounding regardless.
 *
 * Six seconds is longer than any single prompt this app speaks and shorter
 * than the operator's patience. The ceiling exists because a lost `onend` --
 * which Safari produces after a cancel, and which the watchdog exists for --
 * would otherwise swallow the cue entirely, and a microphone that opened and
 * said nothing is indistinguishable from one that never opened. That is the
 * exact failure this cue is here to rule out, so it must not be able to cause
 * it.
 */
export const CUE_WAIT_CEILING_MS = 6000;

/**
 * Utterances the harness has swallowed but which are still notionally sounding.
 *
 * WHY THE FAKE HAS TO BE HONEST ABOUT THIS. Under `?e2e=1` nothing is queued
 * and no clip chain runs, so "is the app speaking" answered NO for the entire
 * duration of every simulated utterance -- which meant the one rule the
 * 2026-10-04 drive was lost to, that the microphone must not open over the
 * app's own voice, could not be exercised by any test. The suite would have
 * gone green on a build that opened the microphone mid-prompt, which is
 * exactly the build Jack had just driven.
 *
 * Counted rather than flagged because a prompt is a chain and the app can
 * decide to say a second thing while the first is still going.
 */
let e2eUtterancesSounding = 0;

/** Is the app making a noise right now, by any path? */
export function isAppSpeaking(): boolean {
  return isSpeakingNow();
}

function isSpeakingNow(): boolean {
  return pendingSpeeches.length > 0 || isClipChainActive() || e2eUtterancesSounding > 0;
}

/**
 * Sound a chime once the app has stopped talking.
 *
 * WHY, from Jack's 2026-10-02 log with the car off Bluetooth:
 *
 *   16:22:58.527  speak clip-chain  files="you-have-ace-five.mp3, dealer-shows-ten.mp3"
 *   16:22:58.597  speak chime kind=ready volume=1
 *   16:23:01.556  speak clip-end   ms=3029
 *
 * He reported it as a chime that never played. It played: a 120ms sine at half
 * scale, seventy milliseconds into a three-second prompt, underneath a voice at
 * full level. There is no `chime-suspended` line, so the tone was generated and
 * simply masked.
 *
 * Holding it is not only about being heard. The cue is premature there too --
 * anything said during that prompt is suppressed as the app's own voice -- so
 * the moment worth marking is when the app shuts up, not when the recogniser
 * happens to confirm.
 *
 * Returns a canceller, so a screen that unmounts while waiting leaves no beep
 * behind for whatever is on screen next.
 */
/**
 * The one cue waiting for silence, so that something can call it off.
 *
 * One slot, not a list: the cue exists to mark the microphone opening, there
 * is one microphone, and a second cue would be marking the same moment twice.
 *
 * It needs calling off because an ENDING is what fires it, and leaving a
 * screen produces an ending -- `cancelSpeech()` stops the clip chain, the
 * chain settles, the waiter runs, and the operator gets a beep on whatever
 * screen they just moved to. Mute is the same story and worse: the whole point
 * of mute is that nothing makes a noise.
 */
let pendingCue: (() => void) | null = null;

export function chimeWhenQuiet(
  kind: ChimeKind,
  opts?: { volume?: number },
): () => void {
  // A cue already waiting is a cue for a moment that has passed.
  pendingCue?.();
  let done = false;
  let unregister: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (why: string): void => {
    if (done) return;
    done = true;
    unregister?.();
    unregister = null;
    if (timer !== null) clearTimeout(timer);
    // The reason rides along: "it waited" and "it gave up waiting" are
    // different stories about the same beep, and only one of them is healthy.
    pendingCue = null;
    diag("speak", "cue-held", { kind, why });
    chime(kind, opts);
  };

  const attempt = (): void => {
    if (done) return;
    if (!isSpeakingNow()) {
      fire("quiet");
      return;
    }
    // Still talking -- something else was in flight. Wait for the next ending.
    unregister = whenSomethingFinishesSpeaking(attempt);
  };

  if (!isSpeakingNow()) {
    fire("quiet");
    return () => {};
  }

  diag("speak", "cue-waiting", { kind });
  unregister = whenSomethingFinishesSpeaking(attempt);
  timer = setTimeout(() => fire("timeout"), CUE_WAIT_CEILING_MS);

  const drop = (): void => {
    if (done) return;
    done = true;
    unregister?.();
    unregister = null;
    if (timer !== null) clearTimeout(timer);
    pendingCue = null;
    diag("speak", "cue-dropped", { kind });
  };
  pendingCue = drop;
  return drop;
}

function notifySpeechActivity(text: string, rate?: number): void {
  notifyActivityMs(estimateSpeechMs(text, rate), text);
}

/**
 * How long a chime occupies the speaker.
 *
 * The tone itself is 120ms; this is what the microphone is told, and it is
 * deliberately longer. A chime is played while the microphone is open, and
 * the cue that says "I did not understand you" is played in response to
 * something not understood -- so a chime the microphone treats as speech
 * could be rejected in turn and cue another one. Deafening the microphone
 * for the sound it just made is what stops that being possible at all.
 */
export const CHIME_ACTIVITY_MS = 260;

/**
 * Re-speaks the last utterance, returning whether there was anything to say.
 *
 * Always interrupts, regardless of `opts`: a repeat that queued behind the
 * utterance it is repeating would make the user sit through the thing they
 * already missed before hearing it again.
 *
 * Does NOT re-record what it speaks. A repeat is not new information, so
 * repeating twice must not be able to shift what "last" means.
 */
export function repeatLast(opts?: SpeechOpts): boolean {
  const text = lastSpoken;
  if (text === null) return false;
  // REMEMBERED OPTIONS FIRST, caller's on top. A repeat with no options at all
  // is not "the default", it is a different utterance: full volume while muted
  // and the engine's rate instead of the configured one.
  const merged = { ...lastSpokenOpts, ...opts, interrupt: true };
  const keptOpts = lastSpokenOpts;
  speak(text, merged);
  lastSpoken = text;
  // `speak` just overwrote these with the merged set. A repeat is not new
  // information, so neither the text nor the options it was said with may
  // drift because it was repeated.
  lastSpokenOpts = keptOpts;
  return true;
}

/** Test-only reset of the module-level memory above. */
export function _resetLastSpokenForTest(): void {
  lastSpoken = null;
  lastSpokenOpts = null;
  // A simulated utterance left sounding would make the app look permanently
  // mid-sentence to the next test, which reads as a microphone that never
  // opens.
  e2eUtterancesSounding = 0;
}

/**
 * Speaks `text`. In e2e mode, records the raw text into `window.__speechLog`
 * instead of calling the real API (clips are fully bypassed in this mode).
 * Otherwise, when clips are enabled and a cascade match exists for `text`,
 * plays the concatenated clip(s) and falls back to live `speechSynthesis`
 * only if that fails. Never throws.
 */
/**
 * Which of the two voices spoke an utterance.
 *
 * `clip` is a recorded element; `tts` is the phone's own synthesiser; and
 * `clip-failed-to-tts` is the nasty one -- the voice changing MID-utterance
 * because a clip chain broke part way through.
 */
export type SpeechPath = "clip" | "clip-failed-to-tts" | "tts";

export interface SpeechPathRecord {
  path: SpeechPath;
  /** What was actually handed to the voice -- the REMAINDER on a partial break. */
  text: string;
  /**
   * The whole utterance this record is about.
   *
   * Differs from `text` exactly when a clip chain broke part way through, and
   * that difference is why this field exists: a caller matching on `text`
   * silently fails to recognise its own line in precisely the mid-utterance
   * break it most needs to hear about, so the screen went blank and the stamp
   * dropped its `paths` field in the one case the protocol was rewritten for.
   */
  for: string;
  /**
   * WRITTEN BEFORE THE VOICE SPOKE, so it is a prediction and not a fact.
   *
   * Only the clip branch can guess: it commits to a path at the moment it
   * hands the chain to the audio element, and finding out whether that was
   * true takes until the last clip ends. Every other record is written once
   * the outcome is known.
   *
   * This used to be inferred from `path === 'clip'`, which was the same thing
   * only for as long as a clip that PLAYED wrote nothing at all.
   */
  chosen?: boolean;
  /** The caller's correlation id, when one was supplied. */
  tag?: string;
  /**
   * Monotonic, so a caller can tell ITS record from one that overtook it.
   *
   * Text alone cannot: two steps deliberately speak the identical line, and a
   * stray wheel press routes to `repeatLast()`, which re-speaks the same
   * string and leaves a record indistinguishable from the original.
   */
  seq: number;
  /** Why it fell back, when it did: 'no-clip' (missing recording) or 'clips-off' (a setting). */
  why?: string;
  /** True when only the tail of the utterance fell back, not the whole thing. */
  partial?: boolean;
}

let lastPath: SpeechPathRecord | null = null;
let pathSeq = 0;

/**
 * Record which path spoke a line -- to the log, and to a variable a caller
 * can read back.
 *
 * BOTH, and the second half is the point. The log is for diagnosis after the
 * drive; the variable is so the app can tell the operator, in the moment,
 * which voice it just used. The field test used to ASK -- "was that the
 * recorded voice or your phone's?" -- which is asking a person to guess at
 * something the code decided with certainty three lines above. The operator's
 * response was the correct one: "it's not like they're played the same way
 * and the code doesn't know wtf?" It does know. Now it says so.
 */
/**
 * Which event name a path record gets: the guess, or the outcome.
 *
 * `path=clip` was written BEFORE the chain played and `path=clip-failed-to-tts`
 * after it failed, both under the event `path`, both carrying the same `tag`.
 * `clip` is a prefix of `clip-failed-to-tts`, so `grep 'path=clip'` counted a
 * broken utterance twice and a good one once, and the first of the two lines
 * was flatly contradicted by the second with nothing marking it provisional.
 */
function pathEvent(
  record: Omit<SpeechPathRecord, "seq">,
): "path" | "path-chosen" {
  // WHETHER IT HAS HAPPENED YET, not which voice it was. `speak path` is
  // counted as one line per utterance; a guess filed under it counts an
  // utterance that has not finished and may not survive.
  return record.chosen ? "path-chosen" : "path";
}

function recordSpeechPath(record: Omit<SpeechPathRecord, "seq">): void {
  const full: SpeechPathRecord = { ...record, seq: ++pathSeq };
  lastPath = full;
  const { path, text, partial, chosen: _chosen, ...rest } = full;
  // `said` rather than `text` in the log, because every other speak entry
  // already uses that key and the export is grepped by hand in a car park.
  //
  // `tag` rides along when the caller supplied one. Without it this entry --
  // the ONLY one that says which voice spoke -- could be joined to the step
  // that produced it by adjacency alone, and two steps deliberately speak the
  // same line, so even the text could not disambiguate them.
  /**
   * `said-remainder` WHEN THAT IS WHAT IT IS.
   *
   * On a clip chain that broke part way, `text` is what is LEFT to say, while
   * `said` on every other speak entry is the whole utterance. One key meant
   * two things, distinguished only by a `partial=true` further along the same
   * line, and the whole family is read by grep.
   */
  diag("speak", pathEvent(record), {
    path,
    ...(partial ? { "said-remainder": text, partial } : { said: text }),
    ...rest,
  });
}

/**
 * The most recent path decision, for a caller that wants to show it.
 *
 * Carries its own text so a caller can check the record is about the
 * utterance it just awaited rather than one that overtook it.
 */
export function lastSpeechPath(): SpeechPathRecord | null {
  return lastPath;
}

export function _resetSpeechPathForTest(): void {
  lastPath = null;
  pathSeq = 0;
}

export function speak(text: string, opts?: SpeechOpts): void {
  rememberSpoken(text, opts);
  // BEFORE the e2e short-circuit: the microphone has to know about every
  // utterance the app decides to make, including the ones the test harness
  // swallows, or suppression is untestable.
  notifySpeechActivity(text, opts?.rate);
  if (isE2eAudioMode()) {
    pushSpeechLog(text, opts);
    // AND THE ENDING TOO. The harness swallowed the sound and then never said
    // it had stopped, so under `?e2e=1` the microphone only ever saw half of
    // every utterance: the 'start' phase fired and 'end' never did. Anything
    // that hangs off the ending -- the speaker handoff reopening the
    // recogniser, the deaf window closing on the real stopping time rather
    // than on its estimate -- was therefore untestable, and the handoff's
    // backstop timer was silently carrying the whole feature in e2e.
    //
    // Scheduled at the estimate, which is what production approximates: the
    // real ending arrives when the utterance really stops, and the estimate is
    // the app's own best guess at that.
    // AND IT COUNTS AS SOUNDING WHILE IT RUNS, so that the microphone gate
    // sees the same shape of utterance it sees in the car. Decremented before
    // the notification, because the listeners woken by it ask whether the app
    // is still speaking in order to decide whether to open the microphone --
    // and the answer at that moment is no.
    e2eUtterancesSounding += 1;
    setTimeout(() => {
      e2eUtterancesSounding = Math.max(0, e2eUtterancesSounding - 1);
      notifySpeechEnded();
    }, estimateSpeechMs(text, opts?.rate));
    return;
  }

  if (isClipsEnabled() && hasClips(text)) {
    // WHICH PATH SPOKE IT, recorded before it speaks.
    //
    // The log said what was said and never how, so a voice that changed
    // mid-drill was invisible in it -- the operator had to hear the change
    // and report it out loud into the microphone (2026-09-20, 7:16). The two
    // paths are not interchangeable: a clip is audible on the loud speaker
    // (an element, or Web Audio once a mic has opened) while live speechSynthesis
    // can reach neither the head unit nor Web Audio, so which one spoke decides whether a line survives road noise
    // and whether the car even knows the app is talking.
    recordSpeechPath({
      path: "clip",
      text,
      for: text,
      tag: opts?.tag,
      chosen: true,
    });
    announceToMediaSession(text);
    void playClipsResumable(text, {
      interrupt: opts?.interrupt,
      rate: opts?.rate,
      volume: opts?.volume,
    }).then(({ played, remainder }) => {
      // Same re-assertion as `speakAsync` below, for the same reason: the
      // drills speak through this twin, and the count drill's wheel entry
      // submits in the silence after a line. A RE-ASSERTION, not a hold:
      // this settles after a cancel too, and the screen change that
      // cancelled it has just released the hold -- taking one here left the
      // silent loop running on Settings.
      reassertAudioFocus("after-speech");
      if (played) {
        // THE SETTLED LINE, for the case that worked. `path-chosen` is
        // written before the chain plays and is a guess; without this, a
        // successful clip utterance had no settled record at all and only
        // the failures did -- so counting `speak path` would have counted
        // exactly the utterances that went wrong.
        recordSpeechPath({ path: "clip", text, for: text, tag: opts?.tag });
        return;
      }
      // A clip chain that broke is the app switching voices MID-UTTERANCE,
      // which is the worst case for the operator and the hardest to notice.
      recordSpeechPath({
        path: "clip-failed-to-tts",
        text: remainder ?? text,
        for: text,
        tag: opts?.tag,
        // `remainder` is `string | null` (clips.ts), NEVER undefined -- the
        // nothing-played case is `{ played: false, remainder: null }`. So the
        // old `remainder !== undefined` was true in every case, and every
        // clip failure reported itself as a voice change MID-utterance. That
        // is the one thing the operator is asked to listen for, so the screen
        // was crying wolf on every plain failure.
        partial: remainder !== null && remainder !== text,
      });
      // A chain that broke PART WAY through reports what is still unsaid.
      // Speaking `text` there would repeat the half the clips already
      // delivered -- the user heard the opening twice and the good audio was
      // thrown away for nothing. Fall back to the remainder when there is
      // one, and to the whole utterance only when nothing played at all.
      void speakAsyncLive(remainder ?? text, opts).then(() =>
        reassertAudioFocus("after-speech"),
      );
    });
    return;
  }

  recordSpeechPath({
    path: "tts",
    text,
    for: text,
    tag: opts?.tag,
    // The reason it is on the fallback path at all, which is the actionable
    // half: clips off is a setting, no clip is a missing recording.
    why: isClipsEnabled() ? "no-clip" : "clips-off",
  });
  // ONE LIVE PATH. This twin had its own `speakLive`, which kept no
  // reference to the utterance and had no watchdog -- and this file's own
  // note (`pendingSpeeches`) says Safari collects such utterances and drops
  // their callbacks, so a re-assert hung on `onend` there could never fire.
  // `speakAsyncLive` retains the utterance, settles on a watchdog, writes
  // `tts-end`, and re-asserts the hold when the line is over.
  void speakAsyncLive(text, opts).then(() =>
    reassertAudioFocus("after-speech"),
  );
}

/**
 * Hand the car's transport controls to this app, and tell the head unit what
 * is being said.
 *
 * Called from the clips path only -- see mediaSession.ts for why live TTS
 * has nothing to announce (the field test registers on its own, from a
 * tap). Registration is one-shot and happens on first clip
 * playback rather than at startup, because a Media Session claimed before
 * any audio exists is either ignored or, worse, steals the now-playing slot
 * from whatever the driver actually had going.
 */
function announceToMediaSession(text: string): void {
  ensureMediaSessionHandlers();
  // ...AND OPEN THE VOICE LIST, here, where a clip is playing.
  //
  // This is the earliest gesture-driven moment in any session, and it always
  // precedes the first live fallback -- which is the utterance that used to
  // die because it was itself the first `getVoices()` call. Idempotent.
  primeVoices();
  // Hold the media slot BETWEEN clips, not merely during one.
  //
  // Registering handlers is not what makes the wheel work: a phone routes a
  // transport button to whoever it currently considers the active media app,
  // and that status comes from an element that is actually playing. A clip
  // ends, the element goes idle, and the next press goes to the radio. The
  // drive of 2026-09-19 reported exactly that -- "buttons worked only when
  // the bot was talking" -- which was not a mapping problem at all.
  //
  // Placed here because a clip is playing, so the engine is unlocked and
  // `play()` on the silent element will be allowed. Called for every clip
  // utterance and idempotent after the first (audio/audioFocus.ts); a live
  // utterance only re-asserts a hold someone else took (`speakAsync`, below).
  holdAudioFocus("speech");
  setNowPlaying(text, (import.meta.env.BASE_URL as string | undefined) ?? "");
  setPlaybackState("playing");
}

/**
 * Claim the transport controls, without saying anything.
 *
 * Registration normally rides along with the first clip, which is the right
 * moment for a drill. THE BUTTON TESTER NEEDS IT WITHOUT ONE: it holds its own
 * silent element to keep audio focus, and a driver can reach that panel before
 * the app has ever spoken. Without this the tester would arm its probe over an
 * unregistered session, hear nothing, and report every button on the wheel as
 * dead -- the exact false negative the panel exists to rule out.
 *
 * Safe to call repeatedly: `initMediaSession` registers once and ignores the
 * rest.
 */
export function ensureMediaSessionHandlers(): boolean {
  return initMediaSession(
    {
      // Routed rather than handled here: only the screen that is up knows what
      // a direction means to it, and speech.ts must not import React or the
      // store.
      forward: () => {
        invokeWheelCommand("forward");
      },
      back: () => {
        // Repeat is the FALLBACK, not the meaning. A screen that claims the
        // wheel decides what back does there -- minus one while a count is
        // being entered, "I missed it" on a self-check. But a press that
        // reaches no screen at all should still do the most useful thing a
        // driver could want from it rather than nothing, and that is "say that
        // again": the app is talking, the driver missed a word, and there is
        // no drill in the way.
        // ONE PRESS, ONE LINE. This used to call `invokeWheelCommand`, watch it
        // write `handled=false why=no-screen-listening`, and then write a
        // second entry saying `handled=true` -- so the export showed a press
        // reaching nothing immediately followed by a press reaching something,
        // for one thumb. The fallback goes in, so the line is written once by
        // the code that knows the outcome.
        invokeWheelCommand("back", { by: "repeat-last", run: repeatLast });
      },
    },
  );
}

/* ---------------------------------------------------------------------- */
/* speakAsync — speech-driven pacing primitive                            */
/* ---------------------------------------------------------------------- */

/** Why a live utterance stopped. Mirrors `ClipEndReason` in clips.ts. */
export type TtsEndReason = "ended" | "error" | "watchdog" | "cancelled";

type PendingSpeech = {
  // Kept even though nothing else reads it: holding the utterance here is
  // what stops the engine from garbage-collecting it mid-speech.
  utterance: SpeechSynthesisUtterance;
  resolve: () => void;
  watchdog: ReturnType<typeof setTimeout>;
  /** For the `tts-end` entry: what was said, when it started, and how it went. */
  text: string;
  startedAt: number;
  settled: boolean;
  /**
   * What the engine ACTUALLY got, as opposed to what the caller asked for.
   *
   * `utteranceVolume` clamps live TTS at 1, so a step requesting 1.5 is
   * recorded by `say-start` as 1.5 and delivered at 1 -- and `resolveVoice`
   * silently falls through to `pickBestVoice` when the configured voice is not
   * installed here. Both were invisible, on a screen whose entire subject is
   * which voice spoke and how loud.
   */
  appliedVolume: number;
  appliedVoice: string | null;
  voiceSubstituted: boolean;
};

/**
 * Utterances currently awaiting `onend`/`onerror`/timeout. Two jobs:
 *  1. Keep a module-level reference alive so the engine can't garbage
 *     collect the utterance mid-speech (a real, well-documented gotcha —
 *     a GC'd utterance silently drops its callbacks and hangs forever).
 *  2. Let `cancelSpeech()`/`{interrupt:true}` settle outstanding promises
 *     explicitly, since Safari won't fire `onend` after `cancel()`.
 */
let pendingSpeeches: PendingSpeech[] = [];

/**
 * THE TTS COUNTERPART TO `clip-end`, and the reason it had to exist.
 *
 * `speak path path=tts said="..."` is written before the engine is touched, and
 * nothing was written afterwards -- so an utterance that never happened, one
 * that errored, one abandoned by the watchdog and one that ran cleanly to the
 * end all produced the same single line. The clips path has carried a reason
 * code since round 2; this path is every drill line in the app and had none, so
 * "did it actually say it?" could not be answered for most of the log.
 *
 * `settled` guards it: `onend` after a watchdog, or a cancel racing an `onend`,
 * would otherwise report the same utterance twice with different reasons.
 */
function settlePendingSpeech(
  pending: PendingSpeech,
  reason: TtsEndReason = "ended",
): void {
  const idx = pendingSpeeches.indexOf(pending);
  if (idx !== -1) pendingSpeeches.splice(idx, 1);
  clearTimeout(pending.watchdog);
  if (!pending.settled) {
    pending.settled = true;
    diag("speak", "tts-end", {
      reason,
      ms: Date.now() - pending.startedAt,
      said: pending.text,
      // APPLIED, not requested. See `appliedVolume` on PendingSpeech.
      volume: pending.appliedVolume,
      voice: pending.appliedVoice,
      ...(pending.voiceSubstituted ? { voiceSubstituted: true } : {}),
    });
    // THE ONE FUNNEL. `ended`, `error` and the watchdog all land here, and the
    // microphone needs the real stopping time from every one of them -- an
    // utterance abandoned by the watchdog has stopped making noise just as
    // surely as one that ran to the end.
    notifySpeechEnded();
  }
  pending.resolve();
}

function settleAllPendingSpeeches(): void {
  const pending = pendingSpeeches;
  pendingSpeeches = [];
  for (const p of pending) {
    clearTimeout(p.watchdog);
    // CANCELLED IS AN OUTCOME TOO. Safari does not fire `onend` after
    // `cancel()`, so without this an interrupted line simply had no ending at
    // all -- and interrupting is what every `{interrupt: true}` call does.
    if (!p.settled) {
      p.settled = true;
      diag("speak", "tts-end", {
        reason: "cancelled",
        ms: Date.now() - p.startedAt,
        said: p.text,
      });
    }
    p.resolve();
  }
}

const WATCHDOG_FLOOR_MS = 4000;
const WATCHDOG_BASE_MS = 2000;
const WATCHDOG_PER_CHAR_MS = 90;

/** Generous, text-length-scaled bound so a lost `onend` can never hang the
 * caller forever. */
function estimateWatchdogMs(text: string): number {
  return Math.max(
    WATCHDOG_FLOOR_MS,
    WATCHDOG_BASE_MS + text.length * WATCHDOG_PER_CHAR_MS,
  );
}

/** The one live-`speechSynthesis` path, for `speak()` and `speakAsync()`
 * both: used directly when clips are disabled/absent, and as the fallback
 * when a clip lookup misses or playback fails. */
function speakAsyncLive(text: string, opts?: SpeechOpts): Promise<void> {
  if (!isSpeechSupported()) {
    // SAID SO, rather than resolving as though it had spoken. The path record
    // is already written by the caller at this point, so without this line the
    // export claims an utterance on a device with no synthesiser at all.
    diag("speak", "tts-end", {
      reason: "error",
      ms: 0,
      said: text,
      why: "unsupported",
    });
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    try {
      if (opts?.interrupt) {
        // A fresh interrupting call must settle whatever was previously
        // in-flight -- Safari won't fire onend for it after cancel(). It must
        // also stop any clip chain, which speechSynthesis cannot see.
        stopClips();
        settleAllPendingSpeeches();
        window.speechSynthesis.cancel();
      }

      const utterance = new SpeechSynthesisUtterance(text);
      if (opts?.rate) {
        utterance.rate = opts.rate;
      }
      applyVolume(utterance, opts);
      const voice = resolveVoice(opts?.voiceURI);
      if (voice) {
        utterance.voice = voice;
      }
      // A substitution is when the caller named a voice and got a different
      // one (or none). Asking for nothing and being given the default is not a
      // substitution, so it is not reported as one.
      const wanted = opts?.voiceURI;
      const voiceSubstituted =
        !!wanted &&
        wanted !== "default" &&
        (!voice || (voice.voiceURI !== wanted && voice.name !== wanted));

      const pending: PendingSpeech = {
        utterance,
        resolve,
        watchdog: setTimeout(
          () => settlePendingSpeech(pending, "watchdog"),
          estimateWatchdogMs(text),
        ),
        text,
        startedAt: Date.now(),
        settled: false,
        appliedVolume: utterance.volume,
        appliedVoice: voice?.name ?? null,
        voiceSubstituted,
      };
      pendingSpeeches.push(pending);

      utterance.onend = () => settlePendingSpeech(pending, "ended");
      utterance.onerror = () => settlePendingSpeech(pending, "error");

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      // Also an ending, and also invisible until now.
      diag("speak", "tts-end", {
        reason: "error",
        ms: 0,
        said: text,
        why: e instanceof Error ? e.name : String(e),
      });
      resolve();
    }
  });
}

/**
 * Like `speak()`, but returns a Promise that resolves once the utterance
 * finishes (or is abandoned) rather than firing and forgetting.
 * `speechSynthesis.speak()` silently *queues* — a caller advancing the UI on
 * a fixed interval falls permanently behind actual speech. Awaiting this
 * lets speech drive the UI instead.
 *
 * In e2e mode, records the raw text into `window.__speechLog` instead of
 * calling any real API (clips are fully bypassed in this mode). Otherwise,
 * when clips are enabled and a cascade match exists for `text`, awaits
 * `playClipsAsync` and falls back to live `speechSynthesis` only if that
 * resolves `false`.
 *
 * Never rejects — a failed/lost utterance (or clip) resolves the promise so
 * it can never break a caller's loop. Guards three real gotchas (see
 * docs/research/2026-07-21-web-tts-options.md §2-3): utterance GC mid-speech
 * (module-level reference kept until settled), Safari not firing `onend`
 * after `cancel()` (`cancelSpeech()`/`{interrupt:true}` settle explicitly),
 * and a lost/never-fired `onend` (watchdog timeout settles it anyway).
 */
export function speakAsync(text: string, opts?: SpeechOpts): Promise<void> {
  rememberSpoken(text, opts);
  // BEFORE THE E2E SHORT-CIRCUIT, exactly as `speak` does -- and missing here
  // until 2026-09-24. `speak` has notified the microphone since echo
  // suppression was written; this twin never did, and it has exactly one
  // call site in `notifySpeechActivity`'s grep. The field test speaks
  // EXCLUSIVELY through this function, so `suppressFor` was never called and
  // nothing was ever suppressed: on every microphone step the live recogniser
  // heard the app's own line and filed it as the operator's answer. On
  // `mic-heard` the app says "Did you have it?", the operator is asked to say
  // "double", and "It heard the wrong thing" became the honest tap for a
  // microphone working perfectly. `looksLikeSelfEcho` could not save it --
  // that guard is only consulted on a `suppressed` verdict, and there were
  // none. The count drill is the other caller and lost suppression too.
  notifySpeechActivity(text, opts?.rate);
  if (isE2eAudioMode()) {
    pushSpeechLog(text, opts);
    const delay = hasWindow() ? window.__e2eSpeechDelayMs : undefined;
    // And the ending, as `speak` does: the microphone now stays deaf until an
    // utterance REPORTS that it stopped, so a harness path that never reports
    // would hold it shut for the whole safety margin.
    e2eUtterancesSounding += 1;
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        e2eUtterancesSounding = Math.max(0, e2eUtterancesSounding - 1);
        notifySpeechEnded();
        resolve();
      }, typeof delay === "number" && delay > 0 ? delay : 0),
    );
  }

  // RECORDED HERE TOO, and it was not until 2026-09-23. `speak` has logged
  // the path since the voice-switch hunt, but this twin never did -- and the
  // field test speaks exclusively through this one, so every utterance the
  // protocol produced was invisible in the very log the protocol exists to
  // fill. Two entry points, one decision, one place that writes it down.
  if (isClipsEnabled() && hasClips(text)) {
    recordSpeechPath({
      path: "clip",
      text,
      for: text,
      tag: opts?.tag,
      chosen: true,
    });
    announceToMediaSession(text);
    return playClipsResumable(text, {
      interrupt: opts?.interrupt,
      rate: opts?.rate,
      volume: opts?.volume,
    }).then(({ played, remainder }) => {
      // RE-ASSERTED ONCE THE CHAIN HAS SETTLED. The hold above was taken
      // BEFORE the clip, and `holdAudioFocus` returns early on an element
      // that is playing -- so if the platform paused the silent loop to play
      // the clip (the suspected shape of 2026-09-19's "buttons worked only
      // when the bot was talking"), nothing restarted it when the clip
      // ended, and the app stopped being the active media app at precisely
      // the moment a driver presses something. A no-op if the loop is still
      // going; a restart, logged as one, if it lapsed; nothing if the hold
      // was released while the chain was in flight (a cancel settles it).
      reassertAudioFocus("after-speech");
      if (played) {
        // THE SETTLED LINE, for the case that worked. `path-chosen` is
        // written before the chain plays and is a guess; without this, a
        // successful clip utterance had no settled record at all and only
        // the failures did -- so counting `speak path` would have counted
        // exactly the utterances that went wrong.
        recordSpeechPath({ path: "clip", text, for: text, tag: opts?.tag });
        return;
      }
      recordSpeechPath({
        path: "clip-failed-to-tts",
        text: remainder ?? text,
        for: text,
        tag: opts?.tag,
        // `remainder` is `string | null` (clips.ts), NEVER undefined -- the
        // nothing-played case is `{ played: false, remainder: null }`. So the
        // old `remainder !== undefined` was true in every case, and every
        // clip failure reported itself as a voice change MID-utterance. That
        // is the one thing the operator is asked to listen for, so the screen
        // was crying wolf on every plain failure.
        partial: remainder !== null && remainder !== text,
      });
      // Same resume rule as `speak` above: only re-speak what the broken
      // chain never got to. This path also drives drill PACING, so repeating
      // the whole utterance here stretched the gap between cards as well as
      // saying the opening twice.
      return speakAsyncLive(remainder ?? text, opts).then(() =>
        reassertAudioFocus("after-speech"),
      );
    });
  }

  recordSpeechPath({
    path: "tts",
    text,
    for: text,
    tag: opts?.tag,
    why: isClipsEnabled() ? "no-clip" : "clips-off",
  });
  /**
   * Once a live utterance has settled, put back a hold that lapsed under it.
   *
   * `speechSynthesis` is not media, so this path re-asserted nothing -- and
   * every field-test instruction is live TTS: if the platform paused the
   * silent loop to speak, nothing restarted it, so `wheel-back` died for the
   * reason `wheel-gap` is suspected of and the two could not be told apart.
   * A RE-ASSERTION, NOT A HOLD: whoever wants the slot across an utterance
   * holds it (the field test does, for the whole run). Taking one here made
   * the count drill's narration, and the paused gate's cue, the active media
   * app with no handlers registered.
   */
  return speakAsyncLive(text, opts).then(() =>
    reassertAudioFocus("after-speech"),
  );
}

/**
 * The tones, and what each one is for.
 *
 * `mark` and `blocked` were added because the screen had two events an
 * eyes-free operator could not hear at all. Tapping a `modifier` answer arms a
 * marker and leaves the step OPEN, and it chimed `attention` -- the same tone
 * as a route answer, which stamps and advances -- so the one thing the driver
 * needs after a tap ("did we move on?") was the one thing the sound did not
 * carry. And a tap the screen REFUSES (the microphone gates, which last up to
 * ten seconds, and the 350ms bounce guard) made no sound whatsoever, which is
 * indistinguishable from missing the button.
 *
 * `ready` was added for the third such event: the microphone actually
 * becoming live. On the 2026-09-30 drive that took six seconds -- the first
 * session of a page load fires nothing for the whole five-second watchdog
 * while the permission is still being established -- and nothing marked the
 * moment it arrived, so the operator spoke into a microphone that was not
 * listening yet.
 *
 * Chosen to be distinguishable without pitch memory: `mark` sits a fourth
 * below `good` and so reads as "held, not finished" next to it, and `blocked`
 * is an octave below `bad`, which is already the lowest answer tone. `ready`
 * is deliberately NOT in a simple ratio with any of the verdict tones -- no
 * octave, no fifth -- because it is not a verdict, and a cue that reads as
 * "correct" in the one mode where sound is the only channel is worse than no
 * cue. No two kinds share a frequency -- `speech.test.ts` asserts exactly
 * that, because a duplicate would silently undo the distinction this table
 * exists for.
 */
export type ChimeKind = "good" | "bad" | "attention" | "mark" | "blocked" | "ready" | "turn" | "heard";

const CHIME_FREQUENCY_HZ: Record<ChimeKind, number> = {
  good: 880,
  bad: 220,
  attention: 1320,
  mark: 660,
  blocked: 110,
  ready: 523,
  // "Your turn" after each prompt: the same pitch as the live cue, because it
  // means the same thing -- speak now -- but its own kind, so the live cue
  // stays countable as the once-per-request event it is.
  turn: 523,
  // "Got it" -- below "ready" and well above "bad", so the pair a listener
  // must tell apart (your turn / got it) are a fourth apart, not a semitone.
  heard: 392,
};

/**
 * Plays a short (0.12s) gain-ramped sine tone. In e2e mode, records
 * `chime:<kind>` into `window.__speechLog` instead. Never throws.
 */
/**
 * The tone a kind plays at, for a test that has to assert they differ.
 *
 * Exported rather than duplicated in the spec: a test carrying its own copy
 * of the table would keep passing after the table changed, which is the
 * shape of test this codebase keeps finding and deleting.
 */
export function chimeFrequencyForTest(kind: ChimeKind): number {
  return CHIME_FREQUENCY_HZ[kind];
}

export function chime(kind: ChimeKind, opts?: { volume?: number }): void {
  // Before the e2e short-circuit, exactly as speak() does: the microphone's
  // bookkeeping is part of the behaviour under test, not part of the sound.
  //
  // `ready` IS THE EXCEPTION, and it is the only one. It is played at the
  // instant the microphone becomes live, after a wait that on the 2026-09-30
  // drive was six seconds, and its entire message is "start talking now".
  // Deafening the microphone for the sound announcing it is open defeats the
  // cue -- the first 260ms of the window it just opened would be deaf.
  //
  // Safe to exempt because of what the deafening is actually FOR: a feedback
  // loop. A chime heard as speech can be rejected, and a rejection cues
  // another chime, which is why `CHIME_ACTIVITY_MS` is longer than the tone.
  // `ready` fires at most once per time the operator asks for the microphone
  // and never in response to a transcript, so it cannot sustain that loop; the
  // worst case is one stray `attention`, which does deafen and ends it.
  // 'turn' and 'heard' are exempt for the same reason (2026-10-05): each fires
  // at most once per prompt or per ACCEPTED answer, never in response to a
  // rejection, so neither can feed the loop -- and deafening the microphone
  // for "got it" swallowed the next word said straight after it.
  if (kind !== 'ready' && kind !== 'turn' && kind !== 'heard') notifyActivityMs(CHIME_ACTIVITY_MS);

  /**
   * EVERY CHIME, LOGGED. The only line this used to write was
   * `chime-suspended`, so a sound the app made was in the export exactly when
   * it FAILED to make it.
   *
   * That matters here more than it looks. A chime is a Web Audio activation
   * and an audio-session event on iOS, and the field test's route samples are
   * measurements of where an audio session sends things -- so a chime shortly
   * before a sample is a confound the analysis has to be able to see. The
   * post-microphone cells were the only ones getting an arrival chime, which
   * correlated the run-up with the independent variable and left no trace of
   * it whatsoever.
   */
  diag("speak", "chime", {
    kind,
    ...(opts?.volume !== undefined ? { volume: opts.volume } : {}),
    path: chimeWantsWebAudio() ? "webaudio" : "element",
  });

  if (isE2eAudioMode()) {
    // Volume carried too: a chime that still sounds while the app is
    // muted is exactly the noise mute is for.
    pushSpeechLog(`chime:${kind}`, { volume: opts?.volume });
    return;
  }

  /**
   * ON AN ELEMENT BY DEFAULT, NOT AN OSCILLATOR, since 2026-10-03. Once a
   * microphone has been opened the same tone is played from a decoded-style
   * AudioBuffer through the shared context instead (playChimeTone in
   * clips.ts), because the element would come out of the earpiece; the element
   * is also the fallback when that context cannot run.
   *
   *
   * The graph version is in the history and its failure is in Jack's export:
   *
   *   17:12:10.573  audio-unlock    reason=gesture state=suspended rate=48000
   *   17:12:18.556  cue-held        kind=ready why=quiet
   *   17:12:18.556  chime           kind=ready volume=1
   *   17:12:18.658  chime-suspended kind=ready state=suspended
   *
   * A gesture resumed the context and eight seconds later it was still
   * suspended, so the tone was synthesised into silence -- twice in that
   * export, on two page loads -- while every recorded clip played. The held
   * cue had finally put the beep in the right place and the beep still could
   * not be heard. There is nothing left to fix inside the graph on a device
   * where the graph does not wake, so the tone is generated as WAV data
   * (audio/tone.ts) and played the way everything audible on that phone is
   * played.
   *
   * `chimePeak` still sets the level, now through the element's own `volume`
   * rather than an envelope, so the relationship to speech is unchanged: half
   * scale at 100%, because a beep at the same amplitude as a voice is startling
   * in a car.
   */
  try {
    playChimeTone(CHIME_FREQUENCY_HZ[kind], chimePeak(opts?.volume ?? 1));
  } catch {
    // never throw
  }
}
