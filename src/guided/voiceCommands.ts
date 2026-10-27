import { resolveSpoken } from '../audio/voiceRecognition';
import { looksLikeSelfEcho } from '../audio/selfEcho';
import { parseCountSpeech } from '../audio/voiceNumber';

/**
 * Wave L (lane v): the guided session's spoken commands -- skip a segment,
 * pause, end, and (paused) resume.
 *
 * ONE MICROPHONE PER PAGE (audio/voiceControl.ts), and it belongs to whichever
 * drill the segment is running. So these are not a second recogniser: the
 * drills' own useVoiceControl offers every transcript here first
 * (`claimGuidedTranscript`), and only while a guided session has registered a
 * handler. With none registered, nothing is claimed and every drill behaves
 * exactly as before.
 *
 * THE RULES, each tested in voiceCommands.test.ts:
 *   - Whole transcript only. "let's pause for a second" in a moving car is
 *     conversation, not a command; only the phrase on its own is.
 *   - Never an answer. No phrase here resolves to a drill answer or a count,
 *     and every answer alias is refused here.
 *   - Bare "skip" only when no reading of the utterance is an answer: it is one
 *     sound from "spit", which IS an alias of split, and losing a segment to a
 *     misheard Split is worse than saying "skip segment".
 *   - Not the app's own voice: a command whose words are in the line the app
 *     last said is dropped (the claim is asked before the controller's own
 *     late-echo checks, so it must make its own). No guided line contains a
 *     command (lines.ts), so this only ever drops an echo.
 */

export type GuidedCommand = 'skip' | 'pause' | 'end' | 'resume';

export const COMMAND_PHRASES: Readonly<Record<string, GuidedCommand>> = {
  'skip segment': 'skip',
  'skip ahead': 'skip',
  'skip drill': 'skip',
  skip: 'skip',
  pause: 'pause',
  'pause session': 'pause',
  'pause drill': 'pause',
  'end session': 'end',
  'stop session': 'end',
  resume: 'resume',
  'resume session': 'resume',
  'carry on': 'resume',
  'keep going': 'resume',
};

/** Single words that must lose to any answer reading of the same utterance. */
const YIELDS_TO_ANSWERS: ReadonlySet<string> = new Set(['skip']);

/** Fillers the engine prepends ("okay pause"), dropped from the front. */
const FILLERS: ReadonlySet<string> = new Set(['uh', 'um', 'okay', 'ok', 'please', 'so']);

export function normaliseCommand(transcript: string): string {
  const tokens = transcript.toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && FILLERS.has(tokens[0]!)) tokens.shift();
  while (tokens.length > 1 && FILLERS.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(' ');
}

/**
 * The command `heard` is, or null. `offered` is every reading the engine
 * gave (the winner first); `lastSaid` what the app last said.
 */
export function matchGuidedCommand(
  heard: string,
  offered: readonly string[] = [heard],
  lastSaid?: string | null,
): GuidedCommand | null {
  const phrase = normaliseCommand(heard);
  const cmd = COMMAND_PHRASES[phrase];
  if (!cmd) return null;
  if (lastSaid && looksLikeSelfEcho(phrase, lastSaid)) return null;
  if (YIELDS_TO_ANSWERS.has(phrase)) {
    const readings = offered.length > 0 ? offered : [heard];
    if (resolveSpoken(readings) !== null) return null;
    if (readings.some((r) => parseCountSpeech(r) !== null)) return null;
  }
  return cmd;
}

/** Returns true when the session acted on the command (and so claims the utterance). */
export type GuidedCommandHandler = (cmd: GuidedCommand) => boolean;

let handler: GuidedCommandHandler | null = null;

export function setGuidedCommandHandler(next: GuidedCommandHandler | null): void {
  handler = next;
}

/**
 * useVoiceControl's first refusal. A label (shown as what was heard) when a
 * guided session took the utterance, else null and the drill gets it.
 */
export function claimGuidedTranscript(heard: string, offered: readonly string[], lastSaid?: string | null): string | null {
  if (!handler) return null;
  const cmd = matchGuidedCommand(heard, offered, lastSaid);
  if (!cmd) return null;
  try {
    return handler(cmd) ? `guided ${cmd}` : null;
  } catch {
    return null;
  }
}

export function _resetGuidedCommandsForTest(): void {
  handler = null;
}
