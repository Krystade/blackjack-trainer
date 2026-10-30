/**
 * Drive checks: every car verification the field test owes, as one guided,
 * eyes-free run.
 *
 * Each check speaks its own instruction, takes its answer from the wheel
 * (forward is yes, back is no) and settles to pass / fail / skipped with the
 * evidence that decided it. The evidence is read from the diagnostic log
 * wherever the app already writes it -- D-R6's `echo-timing`, the misheard
 * ladder's `speak misheard`, the speech queue's `queued` / `queue-dropped`,
 * the wheel's `dispatch` -- so a check measures the same lines a drive
 * produces, not a parallel instrument.
 *
 * This module is the pure half: the catalogue, the spoken lines, and the
 * verdicts computed from log entries. The screen (ui/screens/DriveChecks.tsx)
 * runs the sequence; driveChecksReport.ts puts the results in the export.
 */

import { diag, type DiagEntry } from './diagnosticLog';
import { DRIVE_CHECK_EVENT } from './driveChecksReport';
import { medianMs } from '../drills/speedDrill';
import { mulberry32, type Card, type Rank, type Suit } from '../engine/cards';
import { hiLoTag } from '../engine/count';

export type DriveCheckId =
  | 'voice-timing'
  | 'misheard'
  | 'talk-back'
  | 'speech-queue'
  | 'wheel-speed'
  | 'wheel-bet'
  | 'count-pause'
  | 'mute'
  | 'drive-button'
  | 'status-line';

export type DriveCheckStatus = 'pass' | 'fail' | 'skipped';

export type Evidence = Record<string, string | number | boolean | null>;

export interface DriveCheckDef {
  id: DriveCheckId;
  n: number;
  title: string;
  /** Needs the screen: run only when stopped. */
  parked?: boolean;
}

export const DRIVE_CHECKS: readonly DriveCheckDef[] = [
  { id: 'voice-timing', n: 1, title: 'Voice timing' },
  { id: 'misheard', n: 2, title: 'Misheard escalation' },
  { id: 'talk-back', n: 3, title: 'Talk mode: back after the mic' },
  { id: 'speech-queue', n: 4, title: 'Speech queue' },
  { id: 'wheel-speed', n: 5, title: 'Wheel: Speed' },
  { id: 'wheel-bet', n: 6, title: 'Wheel: Bet sizing' },
  { id: 'count-pause', n: 7, title: 'Count pause, resume, final entry' },
  { id: 'mute', n: 8, title: 'Mute stops everything' },
  { id: 'drive-button', n: 9, title: 'Drive button, first tap', parked: true },
  { id: 'status-line', n: 10, title: 'Car status line at a glance', parked: true },
];

/** How many voice prompts check 1 runs. */
export const VOICE_TIMING_PROMPTS = 5;

/** The `context` the screen's microphone logs under. */
export const DRIVE_CHECKS_CONTEXT = 'drive-checks';

/**
 * Every fixed line the run speaks. Static strings, so each has a recorded
 * clip (scripts/clipCoverage.test.ts) -- except `QUEUE_TTS_LINE`, which must
 * NOT have one: check 4 exists to queue a live-TTS line behind a clip.
 */
export const DC_LINES = {
  intro: 'Drive checks. Forward on the wheel is yes, back is no.',
  yesNo: 'Forward for yes, back for no.',
  skipped: 'Skipped.',
  finished: 'Drive checks finished. Send the diagnostic log.',
  voiceTimingIntro: 'Check one, voice timing. After each prompt, say hit straight away.',
  voiceTimingPrompt: 'Say hit.',
  misheardIntro: 'Check two. When asked, mumble something that is not an answer. Do it twice.',
  misheardPrompt: 'Say stand.',
  misheardQuestion: 'Did you hear a tone, the question again, then a tone?',
  talkBackIntro: 'Check three, talk mode. Press forward, say anything, then wait for the microphone to close.',
  talkBackPress: 'Now press back.',
  gotIt: 'Got it.',
  noPress: 'No press arrived.',
  queueIntro: 'Check four, the speech queue. Two lines follow.',
  queueQuestion: 'Did they overlap or cut off?',
  speedIntro: 'Check five, Speed. Answer on the wheel.',
  betIntro: 'Check six, bet sizing. Answer on the wheel.',
  clearQuestion: 'Were the question and the verdict clear?',
  countIntro: 'Check seven, the count drill. Count the cards. To enter a count, forward adds one, back takes one away, then wait.',
  countPauseNow: 'Press back to pause.',
  countResumeNow: 'Press forward to resume.',
  countFinal: 'Final count. Your entry starts from your checkpoint answer.',
  countQuestion: 'Did it pause, pick up at the next card, and start from your checkpoint answer?',
  muteIntro: 'Check eight, mute. When it is safe, press the Mute button at the top of the screen. It keeps talking until you do.',
  muteProtected: 'Press Mute now. This line is protected, like the Drive line.',
  muteQueued: 'If you can hear this, mute did not stop the queue.',
  muteBack: 'Sound is back.',
  muteQuestion: 'Did all speech stop at once?',
  driveButtonQuestion: 'Parked check. On your first tap of Drive, did the voice start and the microphone open?',
  statusLineQuestion: 'Parked check. Glance at the status line on the screen. Could you read it at a glance?',
} as const;

/** Deliberately unrecorded: the live half of check 4's pair. */
export const QUEUE_TTS_LINE = 'This second line is spoken live, queued behind the first, and it has no recording.';

/* ------------------------------------------------------------------ */
/* Recording                                                          */
/* ------------------------------------------------------------------ */

export function newDriveChecksRunId(now: number = Date.now()): string {
  return `dc-${now.toString(36)}`;
}

/** One check's settled result, as the line the export block is built from. */
export function logDriveCheck(
  run: string,
  def: DriveCheckDef,
  status: DriveCheckStatus,
  evidence: Evidence,
): void {
  diag('test', DRIVE_CHECK_EVENT, { run, check: def.id, n: def.n, status, ...evidence });
}

/** The yes/no answer, as a status, for a question where yes is the good answer. */
export function statusFromYes(answer: YesNo): DriveCheckStatus {
  return answer === 'yes' ? 'pass' : answer === 'no' ? 'fail' : 'skipped';
}

export type YesNo = 'yes' | 'no' | 'skip';

/* ------------------------------------------------------------------ */
/* 1. Voice timing                                                    */
/* ------------------------------------------------------------------ */

export interface VoiceTimingRow {
  sincePromptEndMs: number | null;
  ownWords: boolean;
  outcome: string;
  tailMs: number;
}

function inWindow(e: DiagEntry, from: { session: string; ms: number }): boolean {
  return e.session === from.session && e.ms >= from.ms;
}

/** D-R6's `mic echo-timing` lines written for this screen since `from`. */
export function voiceTimingRows(
  entries: readonly DiagEntry[],
  from: { session: string; ms: number },
): VoiceTimingRow[] {
  return entries
    .filter(
      (e) =>
        e.category === 'mic' &&
        e.event === 'echo-timing' &&
        inWindow(e, from) &&
        e.detail?.context === DRIVE_CHECKS_CONTEXT,
    )
    .map((e) => ({
      sincePromptEndMs: typeof e.detail!.sincePromptEndMs === 'number' ? e.detail!.sincePromptEndMs : null,
      ownWords: e.detail!.ownWords === true,
      outcome: String(e.detail!.outcome),
      tailMs: typeof e.detail!.tailMs === 'number' ? e.detail!.tailMs : 0,
    }));
}

export interface VoiceTimingSummary {
  answers: number;
  medianMs: number | null;
  accepted: number;
  suppressed: number;
  /** Suppressed while inside the post-speech tail (SPEECH_TAIL_MS), not while speaking. */
  tailSuppressed: number;
  ownWords: number;
  tailMs: number | null;
  /** Each answer, `<ms>/<own|real>/<outcome>`, in order. */
  rows: string;
}

export function summariseVoiceTiming(rows: readonly VoiceTimingRow[]): VoiceTimingSummary {
  const times = rows.map((r) => r.sincePromptEndMs).filter((v): v is number => v !== null);
  const m = medianMs(times);
  return {
    answers: rows.length,
    medianMs: m === null ? null : Math.round(m),
    accepted: rows.filter((r) => r.outcome === 'accepted').length,
    suppressed: rows.filter((r) => r.outcome === 'suppressed').length,
    tailSuppressed: rows.filter(
      (r) =>
        r.outcome === 'suppressed' &&
        r.sincePromptEndMs !== null &&
        r.sincePromptEndMs >= 0 &&
        r.sincePromptEndMs < r.tailMs,
    ).length,
    ownWords: rows.filter((r) => r.ownWords).length,
    tailMs: rows[0]?.tailMs ?? null,
    rows: rows
      .map((r) => `${r.sincePromptEndMs ?? 'na'}/${r.ownWords ? 'own' : 'real'}/${r.outcome}`)
      .join(','),
  };
}

/**
 * Pass when nothing the DRIVER said was thrown away. The app hearing its own
 * words and dropping them is the tail working; a real answer dropped is the
 * tail costing an answer, which is the failure SPEECH_TAIL_MS is tuned against.
 *
 * AND WHEN AT LEAST ONE OF THE DRIVER'S ANSWERS ARRIVED (audit A14). A run
 * where the mic heard only the app's own "Say hit." and every wait timed out
 * passed -- the deaf-mic failure the check exists to catch.
 */
export function voiceTimingFailWhy(rows: readonly VoiceTimingRow[]): string | null {
  if (rows.some((r) => r.outcome === 'suppressed' && !r.ownWords)) return 'real-answer-suppressed';
  if (!rows.some((r) => r.outcome === 'accepted' && !r.ownWords)) return 'no-real-answer-accepted';
  return null;
}

export function voiceTimingStatus(rows: readonly VoiceTimingRow[]): DriveCheckStatus {
  if (rows.length === 0) return 'skipped';
  return voiceTimingFailWhy(rows) === null ? 'pass' : 'fail';
}

/**
 * Did a push-to-talk window actually go live since `from`? (audit A13) The
 * window opens 'waiting' and only `ptt-live` says the recogniser started; a
 * window that closed `never-opened` left the car out of call mode, so a back
 * press arriving afterwards proves nothing about the mic.
 */
export function pushToTalkWentLive(entries: readonly DiagEntry[], from: { session: string; ms: number }): boolean {
  return entries.some((e) => inWindow(e, from) && e.category === 'mic' && e.event === 'ptt-live');
}

/* ------------------------------------------------------------------ */
/* 2. Misheard escalation                                             */
/* ------------------------------------------------------------------ */

export interface MisheardEvidence {
  /** The ladder's steps, in order, e.g. "tone,reask". */
  steps: string;
  /** A turn tone sounded after the re-ask. */
  toneAfterReask: boolean;
  /** The re-ask said the question and nothing else. */
  noHint: boolean;
  /** The log shows tone, then re-ask, then a tone. */
  sequenceOk: boolean;
}

export function misheardEvidence(
  entries: readonly DiagEntry[],
  from: { session: string; ms: number },
  prompt: string,
): MisheardEvidence {
  const mine = entries.filter((e) => inWindow(e, from));
  const ladder = mine.filter(
    (e) => e.category === 'speak' && e.event === 'misheard' && e.detail?.context === DRIVE_CHECKS_CONTEXT,
  );
  const steps = ladder.map((e) => String(e.detail!.step));
  const reask = ladder.find((e) => e.detail!.step === 'reask');
  const after = reask ? mine.slice(mine.indexOf(reask) + 1) : [];
  const toneAfterReask = after.some(
    (e) =>
      e.category === 'speak' &&
      e.event === 'turn-cue' &&
      (e.detail?.kind === 'your-turn' || e.detail?.kind === 'mic-open'),
  );
  const reaskSaid = after.find((e) => e.category === 'test' && e.event === 'drive-check-reask');
  const noHint = reaskSaid !== undefined && reaskSaid.detail?.said === prompt;
  return {
    steps: steps.join(','),
    toneAfterReask,
    noHint,
    sequenceOk: steps[0] === 'tone' && steps[1] === 'reask' && toneAfterReask && noHint,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Talk-mode back                                                  */
/* ------------------------------------------------------------------ */

/** `wheel dispatch command=back` lines since `from`, and how many were handled. */
export function backPressesSince(
  entries: readonly DiagEntry[],
  from: { session: string; ms: number },
): { dispatched: number; handled: number } {
  const backs = entries.filter(
    (e) => inWindow(e, from) && e.category === 'wheel' && e.event === 'dispatch' && e.detail?.command === 'back',
  );
  return { dispatched: backs.length, handled: backs.filter((e) => e.detail?.handled === true).length };
}

/* ------------------------------------------------------------------ */
/* 4. Speech queue                                                    */
/* ------------------------------------------------------------------ */

export function queueEvidence(
  entries: readonly DiagEntry[],
  from: { session: string; ms: number },
  first: string,
  second: string,
): Evidence {
  const mine = entries.filter((e) => inWindow(e, from) && e.category === 'speak');
  const pathOf = (text: string): string | null => {
    const e = mine.find((x) => (x.event === 'path' || x.event === 'path-chosen') && x.detail?.said === text);
    return e ? String(e.detail!.path) : null;
  };
  return {
    secondQueued: mine.some((e) => e.event === 'queued' && e.detail?.said === second),
    dropped: mine.some((e) => e.event === 'queue-dropped' && (e.detail?.said === first || e.detail?.said === second)),
    firstPath: pathOf(first),
    secondPath: pathOf(second),
  };
}

/* ------------------------------------------------------------------ */
/* 7. Count drill pause / resume / final entry                        */
/* ------------------------------------------------------------------ */

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: Suit[] = ['s', 'h', 'd', 'c'];

/** Cards in the seeded run, and where its checkpoint and pause fall. */
export const COUNT_RUN_CARDS = 8;
export const COUNT_CHECKPOINT_AFTER = 3;

export function driveCountCards(seed: number, n: number = COUNT_RUN_CARDS): Card[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => ({
    rank: RANKS[Math.floor(rng() * RANKS.length)]!,
    suit: SUITS[Math.floor(rng() * SUITS.length)]!,
  }));
}

export function runningCountOf(cards: readonly Card[]): number {
  return cards.reduce((rc, c) => rc + hiLoTag(c.rank), 0);
}

export interface CountRunFacts {
  checkpointAnswer: number | null;
  checkpointTruth: number;
  paused: boolean;
  /** Cards spoken between the pause and the resume. */
  cardsWhilePaused: number;
  /** Index of the first card after the resume, and of the card after the pause. */
  resumedAt: number | null;
  expectedResumeAt: number;
  /** The value the final entry's first press proposed. */
  finalFirstProposal: number | null;
  finalFirstDirection: 'forward' | 'back' | null;
  finalAnswer: number | null;
  finalTruth: number;
}

/** Whether the final entry's first press started from the checkpoint answer. */
export function finalStartedFromCheckpoint(f: CountRunFacts): boolean | null {
  if (f.checkpointAnswer === null || f.finalFirstProposal === null || f.finalFirstDirection === null) return null;
  return f.finalFirstProposal === f.checkpointAnswer + (f.finalFirstDirection === 'forward' ? 1 : -1);
}

export function countRunMechanicsOk(f: CountRunFacts): boolean {
  return (
    f.paused &&
    f.cardsWhilePaused === 0 &&
    f.resumedAt === f.expectedResumeAt &&
    finalStartedFromCheckpoint(f) === true
  );
}

export function countRunEvidence(f: CountRunFacts): Evidence {
  return {
    checkpointAnswer: f.checkpointAnswer,
    checkpointTruth: f.checkpointTruth,
    paused: f.paused,
    cardsWhilePaused: f.cardsWhilePaused,
    resumedAt: f.resumedAt,
    expectedResumeAt: f.expectedResumeAt,
    finalFromCheckpoint: finalStartedFromCheckpoint(f),
    finalAnswer: f.finalAnswer,
    finalTruth: f.finalTruth,
  };
}

/* ------------------------------------------------------------------ */
/* 8. Mute                                                            */
/* ------------------------------------------------------------------ */

export function muteEvidence(
  entries: readonly DiagEntry[],
  from: { session: string; ms: number },
  queued: string,
): { queuedSpoke: boolean; queueDropped: boolean } {
  const mine = entries.filter((e) => inWindow(e, from) && e.category === 'speak');
  return {
    queuedSpoke: mine.some(
      (e) => (e.event === 'path' || e.event === 'path-chosen') && e.detail?.said === queued,
    ),
    queueDropped: mine.some((e) => e.event === 'queue-dropped' && e.detail?.said === queued),
  };
}

/* ------------------------------------------------------------------ */
/* 9. Drive button, first tap                                         */
/* ------------------------------------------------------------------ */

/** How long after the Drive tap the voice and the mic count as "on that tap". */
export const DRIVE_TAP_WINDOW_MS = 10_000;

/**
 * The last Drive tap in the log, and how long after it the app first spoke
 * and the microphone first opened, in the same page load.
 */
export function driveTapEvidence(entries: readonly DiagEntry[]): Evidence {
  let tap: DiagEntry | undefined;
  for (const e of entries) {
    if (e.category === 'nav' && e.event === 'eyes-free-on' && e.detail?.context === 'home-drive') tap = e;
  }
  if (!tap) return { tapInLog: false, speechMs: null, micMs: null };
  const after = entries.filter(
    (e) => e.session === tap!.session && e.ms >= tap!.ms && e.ms - tap!.ms <= DRIVE_TAP_WINDOW_MS,
  );
  const spoke = after.find((e) => e.category === 'speak' && (e.event === 'path' || e.event === 'path-chosen'));
  const mic = after.find((e) => e.category === 'mic' && e.event === 'session-start');
  return {
    tapInLog: true,
    tapAt: tap.at,
    speechMs: spoke ? spoke.ms - tap.ms : null,
    micMs: mic ? mic.ms - tap.ms : null,
  };
}
