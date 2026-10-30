/**
 * D1b: what an eyes-free screen says when it crashes (see crashLine.ts).
 * Its own module, with no imports, so the clip vocabulary
 * (scripts/spokenPhrases.ts) can read it without loading the speech stack.
 */
export const CRASH_LINE = 'Something went wrong. Tap the screen to get back to Home.';
