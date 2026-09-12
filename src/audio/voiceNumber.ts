/**
 * Spoken counts.
 *
 * A count check asks for a NUMBER, which the command vocabulary deliberately
 * does not contain: a misheard "hit" costs one hand, but a misheard count is
 * a silently corrupted session -- the drill would report a score against an
 * answer nobody gave. That risk is what made the count check typed.
 *
 * What makes it safe to say out loud instead is that nothing here submits
 * anything. A number is only ever a PROPOSAL, read back and confirmed before
 * it counts, so the worst a misheard digit costs is one "no". Two ways in:
 *
 *   - state a value outright -- "minus three", "seven", "-3";
 *   - nudge the standing proposal by one -- "plus", "minus", and repeats of
 *     them, so "plus plus plus" is +3.
 *
 * The two never collide, because a transcript containing a NUMBER is always a
 * value and a transcript containing only sign words is always a nudge. So
 * "minus three" sets minus three, while a bare "minus" subtracts one.
 *
 * This parser runs ONLY while a count check is open. That context is what
 * licenses it to be liberal about mishearings that would be reckless in open
 * conversation: when the app has just asked for a number and will read the
 * answer back, "ate" is far more likely to be eight than a verb.
 */

export type CountSpeech =
  | { kind: 'value'; value: number }
  /** Move the standing proposal by `delta`, which is never zero. */
  | { kind: 'adjust'; delta: number };

/**
 * Number words, with the substitutions engines actually return for them.
 *
 * The count in a six-deck shoe lives around plus or minus twenty, so the
 * words stop at twenty and anything larger has to be spoken as digits, which
 * engines transcribe reliably.
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, oh: 0, nought: 0, none: 0,
  one: 1, won: 1,
  two: 2, too: 2, to: 2,
  three: 3, tree: 3, free: 3,
  four: 4, for: 4, fore: 4,
  five: 5, fife: 5,
  six: 6, sicks: 6,
  seven: 7,
  eight: 8, ate: 8,
  nine: 9, niner: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const NEGATIVE_WORDS = new Set(['minus', 'negative', 'neg', 'down']);
const POSITIVE_WORDS = new Set(['plus', 'positive', 'up']);

/** The largest count worth believing. Beyond this, something was misheard. */
export const MAX_COUNT = 99;

/**
 * The vocabulary to bias the engine toward while a count check is open.
 * Sign words first: they are short, unstressed, and the easiest to lose.
 */
export const COUNT_BIAS_PHRASES: string[] = [
  'plus',
  'minus',
  'zero',
  ...Object.keys(NUMBER_WORDS).filter((w) => /^(one|two|three|four|five|six|seven|eight|nine|ten)$/.test(w)),
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
  'minus one', 'minus two', 'minus three', 'minus four', 'minus five',
];

function tokenize(transcript: string): string[] {
  return transcript
    .toLowerCase()
    // Keep digits and the minus sign; a spoken "-3" often arrives as "-3".
    .replace(/[^a-z0-9-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Read a transcript as either a value or a nudge, or reject it.
 *
 * Rejection is the default and it is deliberate: this runs against every word
 * said while the prompt is open, including thinking aloud, and proposing a
 * number nobody offered would make the read-back a trap rather than a check.
 */
export function parseCountSpeech(transcript: string): CountSpeech | null {
  const tokens = tokenize(transcript);
  if (tokens.length === 0) return null;

  let magnitude: number | null = null;
  let sign = 1;
  let signSeen = false;
  let netNudge = 0;
  let nudgeSeen = false;

  for (const token of tokens) {
    // A signed or bare numeral, e.g. "-3" or "12".
    const numeric = /^(-?)(\d+)$/.exec(token);
    if (numeric) {
      if (magnitude !== null) return null; // two numbers is not an answer
      magnitude = Number(numeric[2]);
      if (numeric[1] === '-') {
        sign = -1;
        signSeen = true;
      }
      continue;
    }

    const word = NUMBER_WORDS[token];
    if (word !== undefined) {
      if (magnitude !== null) return null;
      magnitude = word;
      continue;
    }

    if (NEGATIVE_WORDS.has(token)) {
      sign = -1;
      signSeen = true;
      netNudge -= 1;
      nudgeSeen = true;
      continue;
    }

    if (POSITIVE_WORDS.has(token)) {
      if (!signSeen) sign = 1;
      netNudge += 1;
      nudgeSeen = true;
      continue;
    }

    // Anything else is filler and is ignored: engines pad short answers with
    // it constantly ("uh minus three", "it's plus two").
  }

  if (magnitude !== null) {
    // A sign word next to a number names the value, so "minus three" is -3
    // rather than three nudges down.
    const value = sign * magnitude;
    if (Math.abs(value) > MAX_COUNT) return null;
    return { kind: 'value', value };
  }

  if (!nudgeSeen) return null;
  // "plus minus" cancels out, which is not a request for anything. Refusing
  // it is better than silently doing nothing to a value about to be
  // submitted -- the operator gets told it was not understood.
  if (netNudge === 0) return null;
  return { kind: 'adjust', delta: netNudge };
}

/**
 * The value spoken back for confirmation.
 *
 * Signs are said as words rather than left to the voice's punctuation
 * handling, which reads "-3" inconsistently and sometimes not at all -- and a
 * dropped minus turns a confirmation into a trap.
 */
/**
 * Does this transcript mention a count at all, however badly?
 *
 * Not "does it parse" -- `parseCountSpeech` answers that, and a transcript
 * reaching here has already failed it. This is the weaker question the
 * not-understood cue needs: was the operator TRYING to state a count? "it's
 * minus three" does not parse (the engine ran the words together, or the tail
 * was lost) but it is unmistakably an answer, and answering it with silence is
 * the one thing the cue exists to prevent.
 */
export function mentionsACount(transcript: string): boolean {
  const tokens = transcript
    .toLowerCase()
    .replace(/[^a-z0-9- ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return tokens.some(
    (t) =>
      NUMBER_WORDS[t] !== undefined ||
      NEGATIVE_WORDS.has(t) ||
      POSITIVE_WORDS.has(t) ||
      /^-?\d+$/.test(t),
  );
}

export function speakableCount(value: number): string {
  if (value === 0) return 'zero';
  return value < 0 ? `minus ${Math.abs(value)}` : `plus ${value}`;
}
