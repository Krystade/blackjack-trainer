/**
 * F7: the car status line on the eyes-free pad -- one row that says what is
 * being asked, what the two wheel buttons do right now, whether the
 * microphone is open, and the session score. Pure, so the wording each
 * screen shows is decided in one place.
 */
import type { ListenState } from '../audio/voiceControl';

export interface CarStatus {
  /** The current hand or prompt; the first part to give way at 375px. */
  hand: string;
  /** What the wheel does now, e.g. "▶ yes · ◀ no". */
  wheel: string;
  mic: string;
  score: string;
}

type WheelMode = 'answer' | 'talk';

const both = (forward: string, back: string) => `▶ ${forward} · ◀ ${back}`;

/** Push-to-talk mode: forward opens the microphone, back repeats. */
export const WHEEL_TALK = both('talk', 'repeat');

/** Flashcards, Deviation quiz, Mixed: mirrors useAnswerInputs' wheel. */
export function handWheelLabel(mode: WheelMode, phase: 'asking' | 'reporting' | 'feedback'): string {
  if (mode === 'talk') return WHEEL_TALK;
  if (phase === 'reporting') return both('yes', 'no');
  if (phase === 'feedback') return both('next', 'repeat');
  return both('reveal', 'repeat');
}

/** Speed: both buttons answer; on a verdict forward goes on, back repeats. */
export function speedWheelLabel(verdictPending: boolean): string {
  return verdictPending ? both('next', 'repeat') : both('yes', 'no');
}

/** Count drill: mirrors CountDrillView's wheel. */
export function countWheelLabel(mode: WheelMode, phase: string, paused: boolean): string {
  if (phase === 'flashing') return paused ? '▶ resume' : '◀ pause';
  if (mode === 'talk') return WHEEL_TALK;
  if (phase === 'answering' || phase === 'checkpoint' || phase === 'distraction') return both('+1', '−1');
  if (phase === 'selfreport') return both('yes', 'no');
  return both('yes', 'repeat');
}

/** Short enough to never push the wheel text off a 375px row. */
export const CAR_MIC_LABEL: Record<ListenState, string> = {
  off: 'mic off',
  starting: 'mic …',
  listening: 'mic on',
  restarting: 'mic …',
  denied: 'mic blocked',
  unsupported: 'no mic',
  error: 'mic error',
};

/** The recogniser's own state: off unless voice or a push-to-talk window has it open. */
export const carMic = (state: ListenState): string => CAR_MIC_LABEL[state];

export const carScore = (right: number, total: number) => `${right}/${total}`;

/** Count drill: the "hand" slot carries what the drill is asking now. */
export function countPrompt(phase: string, shown: number, total: number): string {
  switch (phase) {
    case 'flashing':
      return `Counting ${shown}/${total}`;
    case 'answering':
      return 'Running count?';
    case 'checkpoint':
      return 'Count so far?';
    case 'distraction':
      return 'Quick sum?';
    case 'selfcheck':
    case 'practice':
      return 'Say the count';
    case 'selfreport':
      return 'Did you have it?';
    case 'result':
      return 'Run done';
    default:
      return 'Ready to count';
  }
}
