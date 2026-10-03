/**
 * Did the microphone just hear the app's own voice?
 *
 * Suppression (audio/voiceControl.ts) exists because in a car the app's
 * speech comes back through the microphone, so everything heard while the app
 * is talking is thrown away. That is right, and it is also the one place an
 * answer can vanish without a trace: the operator talks over the end of a
 * prompt, the utterance is suppressed, and the drill sits there. Silence, and
 * silence is what a dead microphone sounds like too.
 *
 * So a suppressed utterance should earn the same "say it again" cue a rejected
 * one does -- EXCEPT when the thing suppressed was the app hearing itself, in
 * which case cueing would mean chiming at its own voice, every prompt, forever.
 *
 * The app knows what it is saying, which is what makes the two separable. If
 * the words heard appear in the words being spoken, it is an echo. Substring
 * and not equality because recognition returns a fragment of a long prompt far
 * more often than the whole of it.
 *
 * Erring toward "echo" costs a missed cue on the rare occasion the operator
 * says exactly the word the app is mid-way through saying. Erring the other
 * way puts a chime over every prompt, which is the failure this is here to
 * avoid being traded for.
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function looksLikeSelfEcho(heard: string, said: string | null | undefined): boolean {
  const h = normalize(heard);
  const s = said ? normalize(said) : '';
  if (!h || !s) return false;
  // Word-boundary containment: "and" inside "stand" is not an echo of it.
  return ` ${s} `.includes(` ${h} `);
}

/**
 * How long after the deaf window shut a transcript can still be the app's own
 * voice.
 *
 * Eight seconds, and deliberately generous. The measurement that produced
 * this is 2.3s -- on the 2026-10-02 drive the engine delivered the transcript
 * of a correction that long after the audio stopped -- but a tight bound here
 * buys nothing, because ECHO_MIN_WORDS already makes a false positive
 * impossible to hit with an answer. What this limit actually guards against is
 * an unbounded `lastSaid`, and in practice the app replaces that on its very
 * next utterance, usually a second later; the grace only binds when the app
 * then says nothing at all. So it is set to cover a slow engine rather than to
 * cover the fast one that was measured.
 */
export const ECHO_GRACE_MS = 8000;

/**
 * The shortest transcript that may be dismissed as an echo on its WORDS alone.
 *
 * Three, and the number comes from the vocabulary rather than from taste: the
 * longest thing the operator can say is two words ("double down", "say
 * again"), so at three nothing they can utter is ever long enough to be
 * thrown away by this. src/audio/selfEcho.test.ts checks that against
 * VOICE_PHRASES, so a three-word alias breaks the test instead of the drill.
 */
export const ECHO_MIN_WORDS = 3;

/**
 * Is this the app's own voice, arriving after the deaf window already closed?
 *
 * WHY A SECOND CHECK AT ALL. Suppression (audio/voiceControl.ts) brackets the
 * app's speech with a timer, and on 2026-10-02 that timer did its job and
 * still lost:
 *
 *   speak deafen ms=5000 said="Wrong. Basic hit versus dealer three. Correct
 *                             play was hit. True count was zero."
 *   tts-end  ms=5615                       (61ms before the window shut)
 *   mic result heard="Correct play was hit true count was zero"
 *     -> mic verdict verdict=hit           (2258ms AFTER it shut)
 *
 * The window covered the whole utterance. What beat it was delivery latency:
 * `isSuppressed` is asked when the result ARRIVES, and a Web Speech result
 * carries no timestamp for the audio it came from, so there is no way to ask
 * when the sound actually happened. Widening the tail to cover 2.3 seconds
 * would throw away every answer given over the end of a prompt -- the exact
 * failure the suppressed-utterance cue exists to stop.
 *
 * So the words decide instead of the clock. The app knows what it said, and
 * that knowledge does not expire. The word floor is what makes it safe to
 * act on: a transcript short enough to be an answer is never dismissed here,
 * however well it matches.
 *
 * `sinceWindowClosedMs` may be negative -- the window is still open -- which
 * counts as inside the grace period rather than outside it, so this can never
 * be the check that disagrees with the timer.
 */
export function looksLikeLateSelfEcho(
  heard: string,
  said: string | null | undefined,
  sinceWindowClosedMs: number,
): boolean {
  if (sinceWindowClosedMs > ECHO_GRACE_MS) return false;
  const h = normalize(heard);
  if (!h) return false;
  if (h.split(' ').length < ECHO_MIN_WORDS) return false;
  return looksLikeSelfEcho(heard, said);
}
