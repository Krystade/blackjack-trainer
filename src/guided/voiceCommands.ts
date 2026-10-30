import { matchVoiceAction, resolveSpoken } from '../audio/voiceRecognition';
import { looksLikeSelfEcho } from '../audio/selfEcho';
import { parseCountSpeech } from '../audio/voiceNumber';

/**
 * Wave L (lane v): the guided session's spoken commands -- skip a segment,
 * pause, end, and (paused) resume.
 *
 * TWO WORDS WHILE A DRILL RUNS. With a drill up, every utterance may be an
 * answer, and the phone gives one reading (iOS: offered=1 in 5 of 5 samples,
 * docs/TODO.md), so a bare "skip" cannot be told from a misheard "split" and a
 * bare "pause" is one syllable from the count check's "plus". There, only
 * the two-word forms count ("skip segment", "pause session", "end session"
 * ...), which also carry better in the car (two words 8/10 against one 3/10,
 * voiceRecognition.ts). The bare words, and "resume", work only on the pause
 * and transition screens, where no answer is expected.
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
 *   - The operator's aliases win: a phrase he has made an answer in Settings
 *     is his answer, whatever it says.
 *   - Not the app's own voice: a command whose words are in the line the app
 *     last said is dropped (the claim is asked before the controller's own
 *     late-echo checks, so it must make its own). No guided line contains a
 *     command (lines.ts), so this only ever drops an echo.
 */

export type GuidedCommand = 'skip' | 'pause' | 'end' | 'resume';

/** Where the session is: a drill running (answers expected), or its own pause / transition screen. */
export type GuidedScreen = 'running' | 'panel';

/** Heard while a drill runs: two words each, none of them an answer. */
export const RUNNING_PHRASES: Readonly<Record<string, GuidedCommand>> = {
  'skip segment': 'skip',
  'skip ahead': 'skip',
  'skip drill': 'skip',
  'pause session': 'pause',
  'pause drill': 'pause',
  'end session': 'end',
  'stop session': 'end',
};

/** Heard on the pause and transition screens: the above, the bare words, and resuming. */
export const COMMAND_PHRASES: Readonly<Record<string, GuidedCommand>> = {
  ...RUNNING_PHRASES,
  skip: 'skip',
  pause: 'pause',
  end: 'end',
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
  screen: GuidedScreen = 'panel',
): GuidedCommand | null {
  const phrase = normaliseCommand(heard);
  const cmd = (screen === 'running' ? RUNNING_PHRASES : COMMAND_PHRASES)[phrase];
  if (!cmd) return null;
  if (lastSaid && looksLikeSelfEcho(phrase, lastSaid)) return null;
  // The operator's own alias wins: no shipped answer is a command (tested),
  // but an alias added in Settings ("end session" = stand) is his answer.
  if (matchVoiceAction(phrase) !== null) return null;
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
let screenOf: () => GuidedScreen = () => 'panel';

/** `screen` says, at each utterance, whether a drill is running (two-word commands only). */
export function setGuidedCommandHandler(next: GuidedCommandHandler | null, screen: () => GuidedScreen = () => 'panel'): void {
  handler = next;
  screenOf = screen;
}

/**
 * useVoiceControl's first refusal. A label (shown as what was heard) when a
 * guided session took the utterance, else null and the drill gets it.
 */
export function claimGuidedTranscript(heard: string, offered: readonly string[], lastSaid?: string | null): string | null {
  if (!handler) return null;
  let cmd: GuidedCommand | null;
  try {
    cmd = matchGuidedCommand(heard, offered, lastSaid, screenOf());
  } catch {
    return null;
  }
  if (!cmd) return null;
  try {
    return handler(cmd) ? `guided ${cmd}` : null;
  } catch {
    return null;
  }
}

export function _resetGuidedCommandsForTest(): void {
  handler = null;
  screenOf = () => 'panel';
}
