import { streakNumberWord } from '../habits/moment';
import { SEGMENTS, type GuidedPreset, type SegmentDef, type SegmentTarget } from './plan';

/**
 * Wave L (lane v): every line the guided session speaks. Finite on purpose:
 * each is recorded in all three voices (scripts/generate-audio-clips.py
 * guided_sentences() mirrors allGuidedSentences, and guidedClips.test.ts
 * holds the two together), so nothing here falls back to the live voice.
 *
 * NO LINE MAY CONTAIN A GUIDED VOICE COMMAND (voiceCommands.ts): the
 * microphone hears the app, and "pause" in a prompt would pause the session.
 * voiceCommands.test.ts checks every sentence below against every command.
 */

/** Largest answer target spoken (plan.ts clamps to it). */
export const ANSWERS_SPOKEN_MAX = 100;
/** Largest minute count spoken. */
export const MINUTES_SPOKEN_MAX = 30;

export const GUIDED_INTRO = 'Guided session.';
export const GUIDED_DONE = 'Guided session done.';
export const GUIDED_ENDED = 'Guided session ended.';
export const GUIDED_PAUSED = 'Paused.';
export const GUIDED_SKIPPED = 'Skipped.';
export const GUIDED_NO_ANSWERS = 'No answers this time.';

function cap(s: string): string {
  return s.length === 0 ? s : `${s[0]!.toUpperCase()}${s.slice(1)}`;
}

export function minutesSentence(n: number): string {
  const m = Math.max(1, Math.min(MINUTES_SPOKEN_MAX, Math.round(n)));
  return m === 1 ? 'One minute.' : `${cap(streakNumberWord(m))} minutes.`;
}

export function answersSentence(n: number): string {
  const a = Math.max(5, Math.min(ANSWERS_SPOKEN_MAX, Math.round(n / 5) * 5));
  return `${cap(streakNumberWord(a))} answers.`;
}

export function targetSentence(t: SegmentTarget): string {
  return t.kind === 'answers' ? answersSentence(t.n) : minutesSentence(t.ms / 60_000);
}

export function introLine(preset: GuidedPreset): string {
  return `${GUIDED_INTRO} ${minutesSentence(preset)}`;
}

/**
 * A9: the one line that names the commands, said once in the Drive tap.
 *
 * THE ONLY GUIDED LINE THAT CONTAINS A COMMAND, and deliberately kept out of
 * allGuidedSentences (whose test forbids that). It is safe where it is said:
 * in the tap, before any guided microphone opens, and the first transition
 * line queues straight behind it, so the self-echo guard's "last said" has
 * moved on before Jack would use a command. The echo of the whole sentence is
 * not a command either: commands match the whole transcript only.
 */
export const GUIDED_COMMANDS_HINT = 'Say skip segment, pause session or end session any time.';

export function driveIntroLine(preset: GuidedPreset): string {
  return `${introLine(preset)} ${GUIDED_COMMANDS_HINT}`;
}

export function segmentSentence(def: SegmentDef, first: boolean): string {
  return `${first ? 'First' : 'Next'}: ${def.spoken}.`;
}

export function transitionLine(def: SegmentDef, target: SegmentTarget, first: boolean): string {
  return `${segmentSentence(def, first)} ${targetSentence(target)}`;
}

export function resumeSentence(def: SegmentDef): string {
  return `Resuming ${def.spoken}.`;
}

/** 0..100 to the nearest five. */
export function percentSentence(pct: number): string {
  const p = Math.max(0, Math.min(100, Math.round(pct / 5) * 5));
  return `Overall, ${p === 0 ? 'zero' : streakNumberWord(p)} percent.`;
}

export function bestSentence(def: SegmentDef): string {
  return `Best: ${def.spoken}.`;
}

export function improvedSentence(def: SegmentDef): string {
  return `Most improved: ${def.spoken}.`;
}

/** Every sentence above, for the clip generator and the coverage test. */
export function allGuidedSentences(): string[] {
  const out = [GUIDED_INTRO, GUIDED_DONE, GUIDED_ENDED, GUIDED_PAUSED, GUIDED_SKIPPED, GUIDED_NO_ANSWERS];
  for (let m = 1; m <= MINUTES_SPOKEN_MAX; m++) out.push(minutesSentence(m));
  for (let a = 5; a <= ANSWERS_SPOKEN_MAX; a += 5) out.push(answersSentence(a));
  for (const def of SEGMENTS) {
    out.push(segmentSentence(def, true), segmentSentence(def, false), resumeSentence(def), bestSentence(def), improvedSentence(def));
  }
  for (let p = 0; p <= 100; p += 5) out.push(percentSentence(p));
  return [...new Set(out)];
}
