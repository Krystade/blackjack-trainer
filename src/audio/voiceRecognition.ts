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
 * A near-miss match, for the long words only.
 *
 * The car drive of 2026-09-10 produced 22 rejections, and most were the same
 * shape: the engine heard the right consonants and landed on an ordinary
 * English word one sound away from the command.
 *
 *   "send" / "sand" / "band"   for  stand
 *   "selit" / "gaslit"         for  split
 *   "read it" / "read that"    for  repeat
 *
 * Listing each of those as an alias is the wrong fix twice over: it never
 * ends, and most of them are ordinary English, which the alias table is
 * forbidden from containing for good reason. Comparing consonant skeletons
 * generalises instead -- "send" and "stand" reduce to SND and STND, one edit
 * apart -- and does it without ever adding a real word to the vocabulary.
 *
 * ONLY THE LONG WORDS. Reducing "hit" to HT also reduces "hat", "hot", "heat"
 * and "height" to HT, so the short commands would swallow half of English.
 * They are excluded outright: hit, yes and no match exactly or not at all.
 * That is the whole reason this is safe.
 */
const FUZZY_TARGETS: readonly VoiceAction[] = ['stand', 'split', 'double', 'surrender', 'repeat'];

/** The shortest transcript worth comparing. Below this, everything is close to everything. */
const MIN_FUZZY_LETTERS = 4;

/** How far apart two skeletons may be. One edit: a dropped or swapped sound. */
export const MAX_FUZZY_DISTANCE = 1;

function skeleton(text: string): string {
  // Vowels carry least across a bad microphone, and doubled letters are noise.
  return text
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/[aeiou]/g, '')
    .replace(/(.)+/g, '$1');
}

/** Levenshtein, bailing out as soon as it cannot come in under the cap. */
function distanceWithin(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * The command this transcript is nearly, or null.
 *
 * Deliberately refuses to choose: a transcript equally close to two commands
 * is not evidence for either, and guessing between them at 70mph is exactly
 * the mistake this whole module is built to avoid.
 */
export function nearestVoiceAction(transcript: string): VoiceAction | null {
  const bare = transcript.toLowerCase().replace(/[^a-z]/g, '');
  if (bare.length < MIN_FUZZY_LETTERS) return null;

  const heard = skeleton(transcript);
  if (!heard) return null;

  let best: VoiceAction | null = null;
  let bestAt = MAX_FUZZY_DISTANCE + 1;
  let tied = false;

  for (const target of FUZZY_TARGETS) {
    const d = distanceWithin(heard, skeleton(target), MAX_FUZZY_DISTANCE);
    if (d > MAX_FUZZY_DISTANCE) continue;
    if (d < bestAt) {
      best = target;
      bestAt = d;
      tied = false;
    } else if (d === bestAt && target !== best) {
      tied = true;
    }
  }

  return tied ? null : best;
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
/** How a transcript came to be understood. The log distinguishes them. */
export type SpokenMatch = {
  action: VoiceAction;
  /**
   * 'direct' -- the winner said it. 'alternative' -- a runner-up did.
   * 'approximate' -- nothing said it, but something was one sound away.
   */
  via: 'direct' | 'alternative' | 'approximate';
};

function isShort(cleaned: string): boolean {
  const n = tokenCount(cleaned);
  return n > 0 && n <= MAX_RESCUE_TOKENS;
}

/**
 * Resolve one utterance against everything the engine offered.
 *
 * Four passes, in descending order of evidence, so a weaker kind of match can
 * never displace a stronger one:
 *
 *   1. the winner says a command outright, at any length
 *   2. a runner-up says one outright
 *   3. the winner is one sound away from one
 *   4. a runner-up is
 *
 * Passes 2 to 4 require the WINNER to be short. Someone whose top transcript
 * is a sentence was talking, not answering, and neither their runners-up nor
 * their consonants are evidence of anything. "I'm pressing button for a lot
 * of buttons now bud is being great" -- the operator narrating a steering
 * wheel test mid-drill -- stays rejected however it is sliced.
 */
export function resolveSpoken(transcripts: readonly string[]): SpokenMatch | null {
  const [top, ...rest] = transcripts;
  if (top === undefined) return null;

  const direct = matchVoiceAction(top);
  if (direct) return { action: direct, via: 'direct' };

  const cleanedTop = normalise(top);
  if (!isShort(cleanedTop)) return null;

  const shortRest = rest.map(normalise).filter(isShort);

  for (const alt of shortRest) {
    const exact = matchVoiceAction(alt);
    if (exact) return { action: exact, via: 'alternative' };
  }

  const near = nearestVoiceAction(cleanedTop);
  if (near) return { action: near, via: 'approximate' };

  for (const alt of shortRest) {
    const alsoNear = nearestVoiceAction(alt);
    if (alsoNear) return { action: alsoNear, via: 'approximate' };
  }

  return null;
}

/** The action alone, for callers that do not care how it was reached. */
export function matchSpokenAlternatives(transcripts: readonly string[]): VoiceAction | null {
  return resolveSpoken(transcripts)?.action ?? null;
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
