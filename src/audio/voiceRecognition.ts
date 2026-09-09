/**
 * Speech recognition: capability detection, a constrained vocabulary, and a
 * persisted diagnostic log.
 *
 * WHY A SPIKE FIRST. Whether this works at all cannot be established from a
 * development machine. Playwright's Chromium exposes the whole API surface --
 * `SpeechRecognition`, `webkitSpeechRecognition`, `SpeechGrammarList`,
 * `getUserMedia` all present and constructible -- and then fires no events at
 * all when started, because there is no microphone and no speech backend
 * behind it. An API that is present and inert is the worst possible thing to
 * design against, so this module's first job is to report what a REAL device
 * does, and only its second job is to recognise words.
 *
 * Two targets, with quite different risks:
 *
 *   - iPhone, in the car. `webkitSpeechRecognition` exists on iOS Safari but
 *     its behaviour inside an installed home-screen PWA is not the same as in
 *     a tab, it wants a user gesture, and it is typically server-backed, so a
 *     tunnel or a dead zone breaks it.
 *   - Chrome, in a BACKGROUND tab, while the operator does something else.
 *     This is the harder one. Chrome throttles hidden tabs aggressively and
 *     recognition sessions tend to end on their own; a design that assumes a
 *     long-lived `continuous` session will quietly stop working the moment
 *     the tab loses focus, which is precisely the case being asked for.
 *
 * Everything here is defensive: the operator may be driving, and nothing in
 * this file may ever throw into that.
 */

/** The whole vocabulary. Deliberately tiny -- a closed set is far more
 * reliably recognised than open dictation, and these are every answer the
 * drills actually accept. */
export const VOICE_ACTIONS = {
  hit: 'hit',
  stand: 'stand',
  double: 'double',
  split: 'split',
  surrender: 'surrender',
  yes: 'yes',
  no: 'no',
  repeat: 'repeat',
} as const;

export type VoiceAction = keyof typeof VOICE_ACTIONS;

/**
 * Words a recogniser is likely to return for each action.
 *
 * Speech engines mishear short commands in predictable ways, and against a
 * closed vocabulary an alias table is both cheaper and more reliable than
 * fuzzy matching: "hit" comes back as "hid" or "it", "stand" as "stan",
 * "double" as "dubble". Anything not listed is rejected rather than guessed
 * -- acting on a wrong guess mid-drill is worse than asking again.
 */
const ALIASES: Record<string, VoiceAction> = {
  hit: 'hit', hid: 'hit', it: 'hit', hits: 'hit',
  stand: 'stand', stan: 'stand', stands: 'stand', standing: 'stand',
  double: 'double', dubble: 'double', doubles: 'double', 'double down': 'double',
  split: 'split', splits: 'split', spit: 'split',
  surrender: 'surrender', surrenders: 'surrender',
  yes: 'yes', yeah: 'yes', yep: 'yes', yup: 'yes',
  no: 'no', nope: 'no', nah: 'no',
  repeat: 'repeat', again: 'repeat', 'say again': 'repeat',
};

/**
 * Map a raw transcript to an action, or null to reject it.
 *
 * Takes the LAST recognised token rather than the first: engines routinely
 * prepend filler ("uh, stand", "okay hit"), and the operator's actual answer
 * is what they said last.
 */
export function matchVoiceAction(transcript: string): VoiceAction | null {
  const cleaned = transcript.toLowerCase().replace(/[^a-z ]/g, ' ').trim();
  if (!cleaned) return null;

  // Try the whole phrase first, so two-word aliases ("double down") win over
  // their own last token ("down", which means nothing).
  const whole = ALIASES[cleaned];
  if (whole) return whole;

  const tokens = cleaned.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const hit = ALIASES[tokens[i]!];
    if (hit) return hit;
  }
  return null;
}

export interface VoiceSupport {
  /** The constructor exists. Says nothing about whether it works. */
  api: boolean;
  /** A microphone can in principle be opened. */
  media: boolean;
  /** Which vendor prefix was found, for the diagnostic report. */
  flavour: 'standard' | 'webkit' | 'none';
}

type RecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function detectVoiceSupport(): VoiceSupport {
  if (typeof window === 'undefined') return { api: false, media: false, flavour: 'none' };
  const w = window as unknown as Record<string, unknown>;
  const flavour: VoiceSupport['flavour'] = w.SpeechRecognition
    ? 'standard'
    : w.webkitSpeechRecognition
      ? 'webkit'
      : 'none';
  return {
    api: flavour !== 'none',
    media:
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function',
    flavour,
  };
}

export { ctor as _recognitionCtorForTest };
