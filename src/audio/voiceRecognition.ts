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
 * fuzzy matching: "hit" comes back as "hid", "stand" as "stan", "double" as
 * "dubble". Anything not listed is rejected rather than guessed -- acting on
 * a wrong guess mid-drill is worse than asking again.
 *
 * AN ALIAS MUST NOT BE A WORD OF ORDINARY ENGLISH. "it" was listed here as a
 * mishearing of "hit" and the first real device log caught it firing: the
 * sentence "damn this shit works really well does it" was graded as a HIT.
 * A recogniser transcribes the whole room, so any alias that also occurs in
 * conversation will eventually play a hand nobody asked for. The cost of a
 * missing alias is being asked to repeat a word; the cost of a common-word
 * alias is a wrong decision at the table. Those are not comparable.
 */
const ALIASES: Record<string, VoiceAction> = {
  hit: 'hit', hid: 'hit', hits: 'hit',
  stand: 'stand', stan: 'stand', stant: 'stand', stands: 'stand', standing: 'stand',
  double: 'double', dubble: 'double', doubles: 'double', 'double down': 'double',
  split: 'split', splits: 'split', spit: 'split',
  surrender: 'surrender', surrenders: 'surrender',
  yes: 'yes', yeah: 'yes', yep: 'yes', yup: 'yes',
  no: 'no', nope: 'no', nah: 'no',
  repeat: 'repeat', again: 'repeat', 'say again': 'repeat',
};

/**
 * The five that play a hand, as against the three that talk about one.
 *
 * The distinction earns its keep on sentences carrying both. A real drive
 * produced "Hit that again", which the plain last-token rule graded as REPEAT
 * -- "again" is an alias for repeat and it came last. The operator had asked
 * to hit. A word that plays a hand is the decision; "yes", "no" and "repeat"
 * are commentary around it, so an action present anywhere outranks them.
 */
const ACTIONS: ReadonlySet<VoiceAction> = new Set<VoiceAction>([
  'hit',
  'stand',
  'double',
  'split',
  'surrender',
]);

function normalise(transcript: string): string {
  return transcript.toLowerCase().replace(/[^a-z ]/g, ' ').trim();
}

/**
 * Map a raw transcript to an action, or null to reject it.
 *
 * Reads right to left: engines routinely prepend filler ("uh, stand", "okay
 * hit"), and where the operator says the same kind of word twice the last one
 * is the one they meant. But an action outranks a meta-word wherever it sits
 * -- see ACTIONS above for the sentence that forced that.
 */
export function matchVoiceAction(transcript: string): VoiceAction | null {
  const cleaned = normalise(transcript);
  if (!cleaned) return null;

  // Try the whole phrase first, so two-word aliases ("double down") win over
  // their own last token ("down", which means nothing).
  const whole = ALIASES[cleaned];
  if (whole) return whole;

  const tokens = cleaned.split(/\s+/);
  let lastMeta: VoiceAction | null = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const hit = ALIASES[tokens[i]!];
    if (!hit) continue;
    if (ACTIONS.has(hit)) return hit;
    lastMeta ??= hit;
  }
  return lastMeta;
}

/**
 * How many guesses to ask the engine for.
 *
 * Speech engines rank several readings of the same audio and hand back only
 * the winner unless asked otherwise. On a car microphone the winner is often
 * an ordinary English word and the command is sitting directly behind it.
 */
export const SPOKEN_ALTERNATIVES = 3;

/**
 * The longest a guess may be and still be treated as a command.
 *
 * Every word in the vocabulary is one token, and the longest alias is two
 * ("double down", "say again").
 */
export const MAX_RESCUE_TOKENS = 2;

function tokenCount(cleaned: string): number {
  return cleaned ? cleaned.split(/\s+/).length : 0;
}

/**
 * Match against everything the engine offered, not just its winner.
 *
 * Measured on a real drive, iPhone against a car microphone:
 *
 *   heard="Band"       conf=0.13  alternatives=["Send", "Stand"]
 *   heard="Split send" conf=0.22  alternatives=["Split sand", "Split stand"]
 *
 * The right word was there both times, ranked below a word that means
 * nothing here. Reading only the winner throws it away, and the operator
 * repeats themselves at 70mph for no reason.
 *
 * Two guards keep this from becoming a licence to hear commands in
 * conversation, because a lower-ranked guess is by definition the engine's
 * second opinion:
 *
 *   - The WINNER must itself be short. Someone whose top transcript is a
 *     sentence was talking, not answering, and their alternatives are not
 *     evidence of anything. "I'm pressing button for a lot of buttons now bud
 *     is being great" -- a real entry from the same drive -- must stay
 *     rejected however its runners-up read.
 *   - The RESCUING guess must be short too, for the same reason.
 *
 * Rank order is respected: the engine's own confidence ordering decides which
 * rescue wins, so this can only ever promote a guess the engine already made.
 */
export function matchSpokenAlternatives(transcripts: readonly string[]): VoiceAction | null {
  const [top, ...rest] = transcripts;
  if (top === undefined) return null;

  // The winner is matched exactly as a lone transcript always was, at any
  // length: "I would hit that" is someone answering, and it still counts.
  const direct = matchVoiceAction(top);
  if (direct) return direct;

  if (tokenCount(normalise(top)) > MAX_RESCUE_TOKENS) return null;

  for (const alt of rest) {
    const cleaned = normalise(alt);
    if (!cleaned || tokenCount(cleaned) > MAX_RESCUE_TOKENS) continue;
    const rescued = matchVoiceAction(cleaned);
    if (rescued) return rescued;
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
