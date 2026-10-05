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

import { mentionsACount } from './voiceNumber';

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
 *
 * A TWO-WORD FORM FOR EVERY COMMAND, and the reason is in WebKit's source
 * rather than in any guess about accents. `WebSpeechRecognizerTask.mm` sets
 * `[_request setTaskHint:SFSpeechRecognitionTaskHintDictation]` and nothing on
 * the web can change it: the whole set of knobs that crosses the process
 * boundary is lang, continuous, interimResults and maxAlternatives.
 * `.confirmation`, which the Speech framework provides for exactly this job,
 * is unreachable.
 *
 * So the model decoding a one-word answer is a LONG-FORM PROSE model, and a
 * bare monosyllable is its worst case -- it would rather produce a fluent
 * English fragment than a stray imperative. The 2026-10-05 room test is the
 * cleanest evidence yet: a quiet room, the phone's own wideband microphone
 * (highRatio 0.28), and `audiostart afterStartMs=0` so nothing was clipped --
 * and "hit" still came back as "Add" at confidence 0.737, the only error in
 * five utterances and by far the lowest confidence of them.
 *
 * Both forms stay valid, deliberately. That makes the comparison something
 * the operator can run WITHIN one session by alternating, rather than across
 * two drives that differ in traffic, speed and fan setting as well as in
 * vocabulary.
 *
 * All are two words, which is the ceiling: `selfEcho.ts` never dismisses a
 * transcript shorter than ECHO_MIN_WORDS as the app's own voice, so a
 * three-word command would stop the app being able to tell its own prompt
 * from an answer. None of them is a phrase that occurs in the app's own
 * speech, which is the rule above.
 */
const ALIASES: Record<string, VoiceAction> = {
  hit: 'hit', hid: 'hit', hits: 'hit', 'hit me': 'hit',
  stand: 'stand', stan: 'stand', stant: 'stand', stands: 'stand', standing: 'stand',
  'stand pat': 'stand',
  double: 'double', dubble: 'double', doubles: 'double', 'double down': 'double',
  split: 'split', splits: 'split', spit: 'split', 'split them': 'split',
  surrender: 'surrender', surrenders: 'surrender', 'surrender this': 'surrender',
  yes: 'yes', yeah: 'yes', yep: 'yes', yup: 'yes', 'yes please': 'yes',
  no: 'no', nope: 'no', nah: 'no', 'no thanks': 'no',
  repeat: 'repeat', again: 'repeat', 'say again': 'repeat',
};

/**
 * Every phrase the operator can actually say, aliases included.
 *
 * Exported for one reason: audio/selfEcho.ts dismisses a late transcript as
 * the app's own voice when it is long enough, and "long enough" is only safe
 * while it is LONGER THAN ANYTHING IN HERE. That is a contract between two
 * modules, so it is checked against this list rather than against a number
 * somebody remembered -- add a three-word alias and the test fails before a
 * drive does.
 */
export const VOICE_PHRASES: readonly string[] = Object.keys(ALIASES);

/**
 * ALIASES THE OPERATOR ADDED, which the shipped table could not have guessed.
 *
 * Jack's drives are full of readings nothing here covers -- `heard=Strength`,
 * `heard=Touch`, `heard=Definitely` -- and the mapping cannot be recovered
 * from a log, because `heard=` records what the ENGINE returned and never
 * what was said. Only the person who spoke can supply it, so these arrive
 * from a setting rather than from a cleverer matcher.
 *
 * A module-level value set on load, like the output-route preference: the
 * seven screens that match speech should not each have to thread a map
 * through, and the one that forgot would silently ignore the operator's
 * settings.
 */
let userAliases: Record<string, VoiceAction> = {};

/**
 * Replace the operator's alias map.
 *
 * SHIPPED COMMANDS ARE THE FLOOR. A user entry whose key is already a real
 * command is dropped, because the alternative is that a typo in a settings
 * field rebinds "hit" to STAND -- and then the operator says the commonest
 * word in the game, watches the app do the opposite, and has nothing on
 * screen telling him why.
 */
export function setUserVoiceAliases(next: Record<string, VoiceAction>): void {
  const kept: Record<string, VoiceAction> = {};
  for (const [phrase, action] of Object.entries(next)) {
    if (phrase in VOICE_ACTIONS) continue;
    kept[phrase] = action;
  }
  userAliases = kept;
}

/**
 * Every phrase the operator can say right now, the added ones included.
 *
 * `VOICE_PHRASES` is the shipped list and is still what the self-echo length
 * contract is checked against at build time. This is the live one, and
 * audio/selfEcho.ts must use it: a user alias missing from the calculation
 * would sit outside the "too long to be a command" rule, and the app could
 * begin grading its own prompt as an answer.
 */
export function voicePhrases(): readonly string[] {
  return [...VOICE_PHRASES, ...Object.keys(userAliases)];
}

/** The alias tables, shipped first so a user entry can never shadow one. */
function lookupAlias(phrase: string): VoiceAction | undefined {
  return ALIASES[phrase] ?? userAliases[phrase];
}

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
 * How long a transcript may be and still count as "yes", "no" or "repeat".
 *
 * From the 2026-10-02 drive, at 19:00:32, while Jack was telling the app its
 * audio was broken:
 *
 *   heard="Ignored the app was speaking you're not saying anything
 *          there's no audio coming out"   -> verdict=no
 *
 * Thirteen words, graded as an answer, because one of them was "no".
 *
 * ACTIONS ARE NOT GATED THIS WAY and must not be. "Stand", "split" and
 * "surrender" are not words that turn up in ordinary speech in a moving car,
 * so one buried in a long transcript is still very probably the answer, and
 * dropping it costs a real play. "Yes" and "no" are the two commonest words in
 * English after the articles; buried in a sentence, a "no" is almost never an
 * answer, and grading one wrong writes a loss into the record and tells the
 * driver they were wrong.
 *
 * Three, because that is what the filler actually looks like: "uh yes",
 * "no thanks", "yeah okay". Every real answer in this app is one word.
 */
const META_MAX_TOKENS = 3;

/**
 * Map a raw transcript to an action, or null to reject it.
 *
 * Reads right to left: engines routinely prepend filler ("uh, stand", "okay
 * hit"), and where the operator says the same kind of word twice the last one
 * is the one they meant. But an action outranks a meta-word wherever it sits
 * -- see ACTIONS above for the sentence that forced that.
 */
export function matchVoiceAction(transcript: string): VoiceAction | null {
  const r = classify(transcript);
  return r === 'conflict' ? null : r;
}

/**
 * Words that retract the command before them: "hit NO stand", "hit SORRY
 * stand". A transcript naming two different actions is only a correction if
 * one of these sits between them.
 */
const RETRACTIONS: ReadonlySet<string> = new Set([
  'no', 'nope', 'sorry', 'wait', 'actually', 'mean', 'oops', 'rather', 'instead', 'scratch',
]);

/**
 * MORE THAN ONE DIFFERENT COMMAND, and why last-wins is not enough.
 *
 * The 2026-10-05 phone log graded "Stand hit hit hit" as hit and "Split them
 * surrender" as surrender. Last-wins is right for a correction and wrong for
 * a stutter or a list, and a correction is distinguishable: the speaker puts a
 * retraction word between the two ("hit no stand"). Without one the
 * transcript does not say which command was meant, and rejecting costs the
 * operator one repeated word where guessing plays a hand nobody chose.
 * Rejected rather than taking the FIRST command either: nothing says the
 * first is any likelier than the last.
 *
 * 'conflict' is distinct from null so resolveSpoken can refuse to rescue
 * such a transcript from a runner-up as well.
 */
function classify(transcript: string): VoiceAction | 'conflict' | null {
  const cleaned = normalise(transcript);
  if (!cleaned) return null;

  // Try the whole phrase first, so two-word aliases ("double down") win over
  // their own last token ("down", which means nothing).
  const whole = lookupAlias(cleaned);
  if (whole) return whole;

  const tokens = cleaned.split(/\s+/);
  const metaAllowed = tokens.length <= META_MAX_TOKENS;
  let lastMeta: VoiceAction | null = null;
  let lastAt = -1;
  let found: VoiceAction | null = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const hit = lookupAlias(tokens[i]!);
    if (!hit) continue;
    if (ACTIONS.has(hit)) {
      if (found === null) {
        found = hit;
        lastAt = i;
        continue;
      }
      if (hit === found) continue;
      // The nearest earlier DIFFERENT action: a retraction must sit between.
      const between = tokens.slice(i + 1, lastAt);
      return between.some((t) => RETRACTIONS.has(t)) ? found : 'conflict';
    }
    if (metaAllowed) lastMeta ??= hit;
  }
  return found ?? lastMeta;
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

/**
 * The shortest consonant skeleton one edit may be applied to. "But" and "bit"
 * are BT; one edit on a skeleton that short reaches a whole dictionary.
 */
const MIN_FUZZY_SKELETON = 3;

/** How far apart two skeletons may be. One edit: a dropped or swapped sound. */
export const MAX_FUZZY_DISTANCE = 1;

function skeleton(text: string): string {
  /*
   * Vowels carry least across a bad microphone, so the consonants are the
   * skeleton. Nothing collapses doubled letters, deliberately -- see below.
   *
   * THE LINE THAT WAS HERE, and why it is not any more. It read
   * `.replace(/(.)+/g, '$1')` in every editor and was really
   * `.replace(/(.)<0x01>+/g, '$1')`: a raw 0x01 control byte where a backreference had
   * been intended. The byte made it a no-op, and the no-op was the only
   * reason this function worked. Written as it APPEARED, the pattern matches
   * the whole string greedily and `$1` is the final capture, so every
   * skeleton becomes its last consonant:
   *
   *   stand -> d     good -> d     said -> d     food -> d
   *   double -> l    well -> l     surrender -> r    sure -> r
   *
   * which makes "good", "said" and "stand" exact matches for one another. It
   * is the "it" bug -- an ordinary English word silently playing a hand --
   * across a whole family of words, one invisible keystroke from happening.
   *
   * Removed rather than repaired to a backreference, because repairing it would CHANGE
   * matching ("surrender" skeletons srrndr today, srndr with the collapse)
   * and there is no evidence that is better. The behaviour the app has driven
   * on is the behaviour kept; voiceRecognition.test.ts pins it so neither the
   * trap nor a silent change can come back.
   */
  return text
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/[aeiou]/g, '');
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
  if (heard.length < MIN_FUZZY_SKELETON) return null;

  let best: VoiceAction | null = null;
  let bestAt = MAX_FUZZY_DISTANCE + 1;
  let tied = false;

  for (const target of FUZZY_TARGETS) {
    const want = skeleton(target);
    /*
     * A HAND-PLAYING COMMAND WHOSE SKELETON IS THREE LETTERS gets no edit at
     * all. DBL is one edit from bill, deal, dial, able, dull, bold and build,
     * and a double is a bet the operator never placed. REPEAT is exempt: it
     * plays nothing, and "read it" -> RDT is the near-miss that earned this
     * rule its place.
     */
    const cap = ACTIONS.has(target) && want.length <= 3 ? 0 : MAX_FUZZY_DISTANCE;
    const d = distanceWithin(heard, want, cap);
    if (d > cap) continue;
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

/**
 * The longest a COUNT-SHAPED utterance may be and still earn a cue.
 *
 * Length alone was the whole test, borrowed from MAX_RESCUE_TOKENS, and it
 * left a three-word try -- "it's minus three", "minus three please" -- with no
 * cue at all. That is the exact failure the cue exists to prevent: saying an
 * answer into a void with no way to tell a misheard word from a dead
 * microphone. Reported from the drive of 2026-09-11.
 *
 * Raising the length limit alone would not do, because the evidence forbids it:
 * "how did that" is three words of passenger conversation and "how was your
 * dad" is four, both verbatim from the 2026-09-10 drive. So the widening is on
 * CONTENT -- a slightly longer utterance earns a cue only when it mentions a
 * count, which conversation of this length does not.
 */
export const MAX_ATTEMPT_TOKENS = 4;

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

  const topRead = classify(top);
  // Several different commands with no retraction: not evidence for any of
  // them, and no runner-up may be allowed to pick one.
  if (topRead === 'conflict') return null;
  if (topRead) return { action: topRead, via: 'direct' };

  const cleanedTop = normalise(top);
  if (!isShort(cleanedTop)) return null;

  const shortRest = rest.map(normalise).filter(isShort);

  for (const alt of shortRest) {
    const exact = matchVoiceAction(alt);
    if (exact) return { action: exact, via: 'alternative' };
  }

  /*
   * APPROXIMATION IS THE WINNER'S ALONE. This used to try every short
   * runner-up too, and that is how heard="But" (conf 0.353) became SPLIT on
   * 2026-10-05: the winner was too short to approximate anything, so the loop
   * went on to a runner-up at 0.149 that was one consonant from SPLT. A
   * runner-up is the engine's second opinion; it may rescue a word it SAYS
   * (pass 2) but never one it merely resembles, because a resemblance
   * between two weak guesses is not evidence of anything.
   *
   * No confidence floor: iOS reports the maximum word-segment confidence, and
   * the genuine near-misses on record sit at 0.13 and 0.22, below the 0.35 the
   * false accept had.
   */
  const near = nearestVoiceAction(cleanedTop);
  if (near) return { action: near, via: 'approximate' };

  return null;
}

/**
 * Whether a rejected transcript looks like someone TRYING to answer.
 *
 * Eyes-free, a rejection is silence, and silence is ambiguous: the operator
 * cannot tell a misheard word from a dead microphone from their own timing
 * being wrong. The drive of 2026-09-10 produced 22 of them, each one a moment
 * of saying something into a void.
 *
 * A cue fixes that, but only if it stays quiet during conversation -- a chime
 * on every stray sentence in a moving car would be unbearable. Length is the
 * same signal used everywhere else here: the commands are one or two words,
 * so a short utterance during a drill was probably aimed at the app, and a
 * sentence was probably aimed at a passenger.
 *
 *   "send", "band", "selit", "read it"          -> an attempt, worth a cue
 *   "how was your dad", "that's on her head"    -> conversation, stay silent
 *
 * All four of those are verbatim from that drive.
 */
export function looksLikeAnAttempt(transcript: string): boolean {
  const cleaned = normalise(transcript);
  const n = tokenCount(cleaned);
  if (n === 0) return false;
  if (n <= MAX_RESCUE_TOKENS) return true;
  // Longer only if it was reaching for a count -- see MAX_ATTEMPT_TOKENS.
  return n <= MAX_ATTEMPT_TOKENS && mentionsACount(transcript);
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
