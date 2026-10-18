import { describe, it, expect } from 'vitest';
import {
  looksLikeSelfEcho,
  looksLikeLateSelfEcho,
  ECHO_GRACE_MS,
  ECHO_MIN_WORDS,
  looksLikeShortSelfEcho,
  SHORT_ECHO_WINDOW_MS,
} from './selfEcho';
import { VOICE_PHRASES } from './voiceRecognition';

describe('telling the app apart from the operator', () => {
  it('calls a fragment of what the app is saying an echo', () => {
    expect(looksLikeSelfEcho('correct play was stand', 'Wrong. Correct play was stand. True count was zero.')).toBe(true);
  });

  it('calls a single word of it an echo too, which is the common case', () => {
    expect(looksLikeSelfEcho('Stand', 'Correct play was stand.')).toBe(true);
  });

  it('does not call an answer an echo just because the app is talking', () => {
    // The operator talking over the end of the prompt: this is the utterance
    // that used to vanish in silence, and the one that must earn a cue.
    expect(looksLikeSelfEcho('double', 'Eight and eight, dealer shows six.')).toBe(false);
  });

  it('will not match across a word boundary', () => {
    // "and" is inside "stand", and a substring test without boundaries would
    // suppress the cue for half the vocabulary.
    expect(looksLikeSelfEcho('and', 'Correct play was stand.')).toBe(false);
  });

  it('ignores punctuation and case, because recognition returns neither', () => {
    expect(looksLikeSelfEcho('true count was plus three', 'True count was plus three.')).toBe(true);
  });

  it('says no when the app is not speaking at all', () => {
    expect(looksLikeSelfEcho('stand', null)).toBe(false);
    expect(looksLikeSelfEcho('stand', '')).toBe(false);
  });

  it('says no to an empty utterance rather than matching everything', () => {
    // A bare substring test makes '' a match against any prompt, which would
    // silently disable the cue.
    expect(looksLikeSelfEcho('', 'Correct play was stand.')).toBe(false);
    expect(looksLikeSelfEcho('  ', 'Correct play was stand.')).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* The echo that arrives AFTER the window has closed                        */
/* ------------------------------------------------------------------------ */

/**
 * The 2026-10-02 drive, reported as "it was also hearing its own corrections".
 *
 *   09:49:08.267  speak deafen ms=5000 said="Wrong. Basic hit versus dealer
 *                 three. Correct play was hit. True count was zero."
 *   09:49:08.290  clip-broke why=play-rejected name=NotAllowedError
 *   09:49:13.906  tts-end ms=5615
 *   09:49:16.225  mic result heard="Correct play was hit true count was zero"
 *                 -> mic verdict verdict=hit
 *
 * The window was 5000 + SPEECH_TAIL_MS(700), so it shut at 13.967 -- 61ms
 * after the audio actually stopped. It was open for the whole utterance and
 * it still lost, because `isSuppressed` is checked when the RESULT ARRIVES
 * and the engine delivered this transcript 2.3 seconds after the sound that
 * produced it. The Web Speech API attaches no timestamp to a result, so there
 * is no way to ask when the audio was captured.
 *
 * Widening the tail to cover 2.3s is the wrong answer: it throws away every
 * answer given over the end of a prompt, which is the complaint that produced
 * the cue in the first place. The app knows what it said, and that knowledge
 * does not expire with the clock -- so the words decide, not the timing.
 *
 * The word floor is what keeps it safe. Every entry in VOICE_ACTIONS is one
 * word and every alias is one or two, so no answer the operator can give is
 * long enough to be dismissed this way -- while "correct play was hit true
 * count was zero" is eight.
 */
describe('an echo that arrives after the deaf window closed', () => {
  const SAID = 'Wrong. Basic hit versus dealer three. Correct play was hit. True count was zero.';
  const HEARD = 'Correct play was hit true count was zero';

  it('catches the exact utterance that was graded as a HIT on the drive', () => {
    // 2258ms after the window shut, which is what the log shows.
    expect(looksLikeLateSelfEcho(HEARD, SAID, 2258)).toBe(true);
  });

  it('does not eat a one-word answer, even one the app just said', () => {
    // THE CASE THAT MUST NOT REGRESS. The app says "Correct play was hit",
    // moves to the next hand, and the operator answers "hit" a second later.
    // Containment alone would call that an echo and the drill would sit there.
    expect(looksLikeLateSelfEcho('hit', SAID, 500)).toBe(false);
    expect(looksLikeLateSelfEcho('stand', 'Correct play was stand.', 100)).toBe(false);
    expect(looksLikeLateSelfEcho('double down', 'You should double down here.', 100)).toBe(false);
  });

  it('gives up once the app has been quiet long enough', () => {
    // Unbounded, the app would go on dismissing anything resembling the last
    // thing it said for the rest of the drive.
    expect(looksLikeLateSelfEcho(HEARD, SAID, ECHO_GRACE_MS + 1)).toBe(false);
  });

  it('holds right up to the edge of the grace period', () => {
    expect(looksLikeLateSelfEcho(HEARD, SAID, ECHO_GRACE_MS)).toBe(true);
  });

  it('still refuses a sentence the app never said', () => {
    expect(looksLikeLateSelfEcho('i think it is a double', SAID, 100)).toBe(false);
  });

  it('says no when the app has said nothing yet', () => {
    expect(looksLikeLateSelfEcho(HEARD, null, 100)).toBe(false);
    expect(looksLikeLateSelfEcho(HEARD, '', 100)).toBe(false);
  });

  it('treats a negative elapsed time as inside the window, not outside it', () => {
    // The window has not closed yet. The time-based check handles that case,
    // but this must not be the thing that disagrees with it.
    expect(looksLikeLateSelfEcho(HEARD, SAID, -500)).toBe(true);
  });

  it('needs enough words to be sure, and ECHO_MIN_WORDS says how many', () => {
    // Pinned against the vocabulary rather than against a number: the floor
    // is only safe while it is longer than anything the operator can say.
    expect(ECHO_MIN_WORDS).toBeGreaterThan(2);
    const twoWords = 'was hit';
    expect(looksLikeLateSelfEcho(twoWords, SAID, 100)).toBe(false);
  });

  it('every phrase the operator can say is shorter than the floor', () => {
    // THE GUARD ON THE GUARD, and not a restatement of the constant: the floor
    // is only safe while nothing in the vocabulary reaches it. "double down"
    // and "say again" are already two words, so this has one word of slack --
    // add a three-word alias and this fails here rather than in a car.
    expect(VOICE_PHRASES.length).toBeGreaterThan(0);
    for (const phrase of VOICE_PHRASES) {
      const words = phrase.trim().split(/\s+/).length;
      expect(words, `"${phrase}" is long enough to be mistaken for an echo`).toBeLessThan(
        ECHO_MIN_WORDS,
      );
    }
  });
});

/* ------------------------------------------------------------------------ */
/* The SHORT echo, once the tail is 100ms                                    */
/* ------------------------------------------------------------------------ */

/**
 * 2026-10-18: SPEECH_TAIL_MS 700 -> 100. The tail used to be the only thing
 * stopping "hit" out of "Correct play was hit" from being graded, since
 * looksLikeLateSelfEcho only acts on three or more words.
 */
describe('a one- or two-word fragment of the last line', () => {
  const CORRECTION = 'Wrong. Basic hit versus dealer three. Correct play was hit. True count was zero.';

  it('rejects a one-word echo of a correction at 100, 700 and 2300ms after it ended', () => {
    for (const ms of [100, 700, 2300]) expect(looksLikeShortSelfEcho('hit', CORRECTION, ms), `${ms}ms`).toBe(true);
  });

  it('covers the slowest delivery measured in the car (2258ms), with margin', () => {
    expect(SHORT_ECHO_WINDOW_MS).toBeGreaterThanOrEqual(2258);
    expect(SHORT_ECHO_WINDOW_MS).toBeLessThanOrEqual(3000);
    expect(looksLikeShortSelfEcho('hit', CORRECTION, SHORT_ECHO_WINDOW_MS)).toBe(true);
    expect(looksLikeShortSelfEcho('hit', CORRECTION, SHORT_ECHO_WINDOW_MS + 1)).toBe(false);
  });

  it('counts a line still playing (negative time) as inside the window', () => {
    expect(looksLikeShortSelfEcho('hit', CORRECTION, -400)).toBe(true);
  });

  it('accepts a genuine answer at 150ms that the app did not just say', () => {
    expect(looksLikeShortSelfEcho('stand', CORRECTION, 150)).toBe(false);
    expect(looksLikeShortSelfEcho('double down', CORRECTION, 150)).toBe(false);
  });

  it('rejects two-word fragments too, and an answer echo ("Hit.")', () => {
    expect(looksLikeShortSelfEcho('was hit', CORRECTION, 300)).toBe(true);
    expect(looksLikeShortSelfEcho('hit', 'Hit.', 300)).toBe(true);
    expect(looksLikeShortSelfEcho('hits', 'Player two hits.', 300)).toBe(true);
  });

  it('leaves three words and more to looksLikeLateSelfEcho', () => {
    expect(looksLikeShortSelfEcho('correct play was hit', CORRECTION, 300)).toBe(false);
  });

  /*
   * DO PROMPTS CONTAIN ANSWER WORDS? Yes. "Hit or stand?" style choices, the
   * deviation quiz's questions, the field test's "say hit or stand out loud",
   * and every count-drill verdict ends "Say yes to go again." The driver
   * saying the word they were just offered is the most natural answer there
   * is, so a sentence that ASKS is never a source of echo.
   */
  it('accepts a word the driver was just OFFERED in a question or choice', () => {
    expect(looksLikeShortSelfEcho('stand', 'Soft eighteen against nine. Hit or stand?', 150)).toBe(false);
    expect(looksLikeShortSelfEcho('hit', 'Say hit or stand out loud.', 150)).toBe(false);
    expect(looksLikeShortSelfEcho('yes', 'Hit. Did you have it? Yes or no.', 150)).toBe(false);
  });

  it('accepts "yes" after an instruction to say it', () => {
    expect(looksLikeShortSelfEcho('yes', 'Correct. The count is plus two. Say yes to go again.', 150)).toBe(false);
    expect(looksLikeShortSelfEcho('yes', 'Okay. Say yes when you want another.', 150)).toBe(false);
  });

  it('still rejects the statement in a line that also asks something', () => {
    // "Hit." is the reveal; "Did you have it?" is the question. The driver's
    // answer is yes/no, so "hit" coming back is the reveal echoing.
    expect(looksLikeShortSelfEcho('hit', 'Hit. Did you have it?', 300)).toBe(true);
  });

  it('says no with nothing said, or nothing heard', () => {
    expect(looksLikeShortSelfEcho('hit', null, 100)).toBe(false);
    expect(looksLikeShortSelfEcho('hit', '', 100)).toBe(false);
    expect(looksLikeShortSelfEcho('  ', CORRECTION, 100)).toBe(false);
  });

  it('respects word boundaries ("and" is not in "stand")', () => {
    expect(looksLikeShortSelfEcho('and', 'Correct play was stand.', 100)).toBe(false);
  });
});
