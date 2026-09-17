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
